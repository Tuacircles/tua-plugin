// motor.js — Tua-motoren (M20a bak, skive 1 i arbeidsstykke 31): lese → skjerme → minimere → sende → logge.
//
// Én motor, to dører: appen (bridge.js, POST /api/spor) og Claude (MCP) skal kalle samme spor() — det er det som gjør
// at «Utlevert» alltid stemmer. Ingen kodevei utenom: mottakernes send() nås bare gjennom spor(), og spor() går alltid
// gjennom alle fire trinn i denne rekkefølgen (V21: skjerming før alt eksternt).
//
//   skjerm(tekst)            regelbasert skjerming av norske opplysninger med stabile plassholdere ([Person A], [Adresse 1] …).
//                            Koblingen plassholder → original holdes BARE lokalt: den returneres til kalleren og skrives aldri
//                            til loggen, aldri til en fil. Regler (D4): fødselsnummer (mod 11), e-post, telefon, org.nr (bare
//                            «org.nr … » / «NO … MVA»), adresse (gate/vei/plass + nummer), beløp (med kr/NOK), og navn fra en
//                            kjent-personer-liste bygget av arkivets egne saker (titler, samtale, prosjekt, tagger) pluss en
//                            fast liste over norske fornavn som oppdager «Fornavn Etternavn» i teksten som sendes. Lista vokser
//                            av bruk (.tua/kjente-personer.json) og har stoppliste for firma- og produktnavn.
//   minimer(saker, nivå)     konteksten av valgte saker på S/M/L via lageret (levelOf/clampLevel/maxLevel). L bare når valgt.
//   send(mottaker, …)        mottaker-grensesnittet {id, label, endpoint, trust, send()}. Første mottaker er Claude med egen
//                            nøkkel fra Keychain (lest per kall, glemt etter kallet), så Ollama når den finnes lokalt, og «test»
//                            som ekkoer uten å sende noe. FAIL CLOSED: nivå over det Trust Score eller Vault-taggen tillater
//                            gir Blokkert (en feil som sier hva som må endres), aldri en advarsel.
//   logg                     én Utlevert-linje per sending i .tua/utlevering.jsonl: mottaker, nivå per sak, antall skjermet per
//                            type, ord og tokens (ca. lokalt ≈ tegn/3,5; eksakt fra usage etter svar). Aldri innhold, aldri originaler.
//
// Svaret lagres som sak (kind: svar) med bygget_av → prompt-saken (kind: prompt, V16) og kildene som ble sendt.
// Tester: server/test-motor.mjs (mot testarkiv i scratch, aldri ~/Dropbox/Tua; ingen ekte kall).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, save, upsert, levelOf, clampLevel, maxLevel, isVault, logDelivery, LEVELS, FILES_ROOT, filesMode, DATA_DIR } from './store.js'
import { readKey, hasKey, ollamaStatus } from './keychain.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TRUST_FILE = path.join(HERE, 'trust-scores.json')
// Trust Score per connector — én JSON-fil, leses ved hvert kall så rettelser virker uten omstart (M15). Anslag; rettes i fila.
export const trustScores = () => { try { return JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8')) } catch (e) { return { _merk: `trust-scores.json kunne ikke leses: ${e.message}`, sky: {}, ai: {} } } }

export class Blokkert extends Error { constructor(msg, detaljer = []) { super(msg); this.name = 'Blokkert'; this.kode = 'blokkert'; this.detaljer = detaljer } }
export class MotorFeil extends Error { constructor(msg) { super(msg); this.name = 'MotorFeil'; this.kode = 'feil' } }

// ── Ord og tokens ───────────────────────────────────────────────────────────
// Tokens kan ikke måles eksakt før sending (K7). Lokalt anslag = tegn / faktor, alltid merket «ca.»; eksakt fra usage etter svar.
// Faktoren er per mottaker, målt 23.10.2026 på samme norske tekst: gemma3:4b (Ollama) ≈ 3,5 tegn per token (788 eksakt mot 826 anslått),
// Claude Opus 5.5 ≈ 1,9 (1 645 eksakt mot 826 anslått med 3,5) — Claudes tokenizer deler norsk finere. Ukjent mottaker: 3,5.
export const ord = (t) => (String(t || '').match(/\S+/g) || []).length
export const TEGN_PER_TOKEN = { claude: 1.9, ollama: 3.5, test: 3.5 }
export const anslåTokens = (t, mottaker) => Math.round(String(t || '').length / (TEGN_PER_TOKEN[mottaker] || 3.5))

// ── 1) Skjerming ────────────────────────────────────────────────────────────
// Fornavn-lista oppdager «Fornavn Etternavn» i tekst (K5: navn uten typisk etternavnsending slapp gjennom). Ikke uttømmende —
// det er det kjent-personer-lista er til, og modellbasert gjenkjenning kommer som tredje lag når lokal modell finnes (D3).
export const FORNAVN = new Set((
  'Erik Anna Kari Ole Per Lars Bjarte Christine Marius Anne Hans Nils Jan Knut Arne Svein Tor Odd Bjørn Geir Terje Jon John Morten Rune ' +
  'Kjell Trond Stein Steinar Øyvind Frode Espen Thomas Tomas Henrik Anders Andreas Martin Kristian Christian Magnus Daniel Jonas Sander ' +
  'Mathias Emil Oskar Oscar Jakob Jacob Noah Lucas Lukas William Filip Fredrik Fridtjof Håkon Haakon Olav Olaf Harald Sverre Sigurd Eirik ' +
  'Einar Ivar Leif Roar Roy Rolf Ragnar Rune Ronny Robert Richard Stian Simen Sindre Sondre Sigve Vegard Vidar Vetle Ulrik Tobias Torbjørn ' +
  'Torgeir Torstein Truls Trygve Yngve Åsmund Ådne Alf Alexander Aleksander Axel Aksel Bent Bendik Birger Brede Dag Eivind Elias Endre ' +
  'Erlend Even Finn Gaute Gunnar Gustav Halvor Helge Herman Isak Jens Jens Johan Johannes Jørgen Jørn Kasper Kjetil Kristoffer Lasse ' +
  'Leon Ludvig Mads Marcus Markus Mats Mikkel Nikolai Oliver Pål Paul Petter Peter Reidar Roger Sebastian Sigbjørn Sivert Snorre Stig ' +
  'Sturla Tarjei Theodor Tord Tore Torkel Ulf Vebjørn Viktor Victor Åge Åsmund Øystein ' +
  'Marte Mari Maria Marit Marie Mette Monica Monika Nina Ida Ingrid Inger Ingeborg Ingunn Ingvild Iselin Hanne Hanna Hege Heidi Helene ' +
  'Hilde Helga Siri Sissel Silje Solveig Sofie Sophie Sara Sarah Synne Synnøve Tone Tonje Torill Toril Trine Tuva Thea Tea Turid Unni ' +
  'Vilde Vigdis Wenche Åse Åshild Astrid Aud Aurora Bente Berit Birgitte Bodil Brit Britt Camilla Cathrine Cecilie Charlotte Dina Eli ' +
  'Elin Eline Elise Ella Ellen Else Emma Emilie Eva Frida Frøydis Gerd Grete Grethe Gro Gunhild Guro Gunn Hedda Ina Irene Jenny Julie ' +
  'Kaja Karen Karin Karoline Kirsten Kjersti Kristin Kristine Laila Lene Linda Line Linn Linnea Lise Liv Live Louise Maja Malin Maren ' +
  'Margrethe Marianne Martine Mia Mina Nora Oda Olivia Pernille Ragnhild Randi Reidun Rikke Ruth Selma Signe Sigrid Siv Sol Stine Sunniva ' +
  'Susanne Tiril Tora Torunn Vera Victoria Viktoria Wenke Ylva Amalie Andrea Anette Anita Anja Ann Annika Benedicte Beate Caroline ' +
  'Dorthe Edel Elisabeth Ellinor Gina Hannah Henriette Ina Janne Jorunn Josefine Kamilla Kine Lea Leah Lena Lilly Lotte Madeleine ' +
  'Magnhild Mathilde Merete Nathalie Oline Rebekka Renate Rita Sandra Sofia Sonja Therese Vibeke'
).split(/\s+/).filter(Boolean))

// Stoppliste: ord som gjør at en kandidat IKKE er en person (firma, produkt, Tuas egne ord). Sjekkes mot hvert ord i kandidaten.
export const STOPP = new Set(('Tua Circles Claude Code Desktop Cowork Vault Trust Score Drive Google Apple Dropbox OneDrive Copilot ChatGPT ' +
  'Gemini Mistral Ollama Anthropic OpenAI Microsoft Keychain Holding AS ASA Business Innboks Finder Spotlight Kartet Forsiden Spør ' +
  'Innstillinger Design Classical Vite React Node Mac iPhone iPad Windows Linux BankID Altinn Entra Okta Skigaarden Skado').split(/\s+/))

const ETTERNAVN = '[A-ZÆØÅ][a-zæøåé]+(?:-[A-ZÆØÅ][a-zæøåé]+)?'
const navneKandidat = (s) => s.split(/\s+/).every((w) => !STOPP.has(w)) && s.split(/\s+/).length >= 2
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Fødselsnummer: 11 siffer, to kontrollsiffer etter mod 11. D-nummer (dag + 40) og H-nummer går gjennom samme kontroll.
const V1 = [3, 7, 6, 1, 8, 9, 4, 5, 2], V2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
const kontroll = (d, v) => { const s = d.reduce((a, x, i) => a + x * v[i], 0); const r = 11 - (s % 11); return r === 11 ? 0 : r }
export function gyldigFødselsnummer(s) {
  const d = String(s).replace(/\s/g, '').split('').map(Number)
  if (d.length !== 11 || d.some(Number.isNaN)) return false
  const k1 = kontroll(d.slice(0, 9), V1); if (k1 === 10 || k1 !== d[9]) return false
  const k2 = kontroll(d.slice(0, 10), V2); return k2 !== 10 && k2 === d[10]
}

// Reglene i prioritert rekkefølge: en tidligere regel vinner der treff overlapper (fødselsnummer før telefon, org.nr før beløp, adresse før navn).
const GATE = '(?:gate|gata|gaten|veien|vegen|vei|veg|plass|plassen|allé|alleen|svingen|stien|terrasse|terrassen|bakken|lia|haugen|tunet|kroken|faret|løkka|toppen|åsen|moen|jordet|brygge|kaia|torget|torg)'
const REGLER = [
  { type: 'fødselsnummer', plass: 'Fødselsnummer', re: /(?<!\d)(\d{6})\s?(\d{5})(?!\d)/g, ok: (m) => gyldigFødselsnummer(m[1] + m[2]) },
  { type: 'epost', plass: 'E-post', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { type: 'orgnr', plass: 'Org.nr', re: /\b(?:org\.?\s?nr\.?|orgnr|organisasjonsnummer|organisasjonsnr\.?)\s*:?\s*(\d{3}\s?\d{3}\s?\d{3})(?!\d)|\bNO\s?(\d{3}\s?\d{3}\s?\d{3})\s?MVA\b/gi, gruppe: true },
  { type: 'adresse', plass: 'Adresse', re: new RegExp(`\\b[A-ZÆØÅ][a-zæøåé.'-]*(?:\\s[A-ZÆØÅa-zæøåé.'-]+){0,2}?\\s?${GATE}\\s\\d{1,4}\\s?[A-Za-z]?\\b(?:,?\\s\\d{4}\\s[A-ZÆØÅ][a-zæøåé]+)?`, 'g') },
  { type: 'telefon', plass: 'Telefon', re: /(?<![\d+])(?:(?:\+47|0047)\s?(?:\d{3}\s?\d{2}\s?\d{3}|\d{2}\s?\d{2}\s?\d{2}\s?\d{2})|[2-9]\d{2}\s\d{2}\s\d{3}|[2-9]\d\s\d{2}\s\d{2}\s\d{2}|[49]\d{7})(?!\d)/g },
  { type: 'beløp', plass: 'Beløp', re: /(?:\b(?:kr|NOK)\.?\s?\d[\d  .]*(?:,\d{1,2})?(?:\s?(?:mill\.?|millioner|mrd\.?|milliarder))?)|(?:(?<![\d,.])\d[\d  .]*(?:,\d{1,2})?\s?(?:mill\.?|millioner|mrd\.?|milliarder)?\s?(?:kr\b|kroner\b|NOK\b|,-))/g },
]
const bokstav = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

// En skjermer holder plassholderne stabile på tvers av flere tekster i SAMME sending (meldingen og konteksten).
// kobling: plassholder → original (bare her, hos kalleren) · antall: per type · nye: personer oppdaget av fornavn-regelen (lagres i kjent-lista).
export function lagSkjermer(kjente = []) {
  const kobling = {}, tilPlass = {}, antall = {}, teller = {}, nye = new Set()
  const kjentRe = kjente.length ? new RegExp(`\\b(?:${[...kjente].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`, 'g') : null
  const fornavnRe = new RegExp(`\\b(${[...FORNAVN].map(escapeRe).join('|')})(\\s${ETTERNAVN}){1,2}\\b`, 'g')
  const plassFor = (type, plass, original) => {
    const key = type + '\u0000' + original.replace(/\s+/g, ' ')
    if (tilPlass[key]) return tilPlass[key]
    teller[type] = (teller[type] || 0) + 1
    const p = type === 'navn' ? `[Person ${bokstav(teller[type] - 1)}]` : `[${plass} ${teller[type]}]`
    tilPlass[key] = p; kobling[p] = original
    return p
  }
  function skjerm(tekst) {
    const t = String(tekst || '')
    const treff = []
    // nøkkel: hva plassholderen står for (for «Kari» alene: hele «Kari Nordmann», så begge får [Person A])
    const legg = (type, plass, start, end, prio, nøkkel) => {
      const original = t.slice(start, end).replace(/\s+$/, ''); end = start + original.length
      if (!original) return
      if (treff.some((x) => start < x.end && end > x.start)) return   // tidligere regel vinner
      treff.push({ type, plass, start, end, original: nøkkel || original, prio })
    }
    REGLER.forEach((r, prio) => {
      for (const m of t.matchAll(r.re)) {
        if (r.ok && !r.ok(m)) continue
        if (r.gruppe) { const g = m[1] ?? m[2]; const off = m[0].indexOf(g); legg(r.type, r.plass, m.index + off, m.index + off + g.length, prio); continue }
        legg(r.type, r.plass, m.index, m.index + m[0].length, prio)
      }
    })
    // Navn: kjent-lista først (hele navn), så fornavn-regelen. Deretter samme persons fornavn/etternavn alene → samme plassholder.
    const personer = new Set()
    if (kjentRe) for (const m of t.matchAll(kjentRe)) { legg('navn', 'Person', m.index, m.index + m[0].length, 10); personer.add(m[0]) }
    for (const m of t.matchAll(fornavnRe)) { if (!navneKandidat(m[0])) continue; legg('navn', 'Person', m.index, m.index + m[0].length, 11); personer.add(m[0]); if (!kjente.includes(m[0])) nye.add(m[0]) }
    for (const navn of personer) {
      const deler = navn.split(/\s+/)
      for (const del of deler) {
        if (del.length < 4 && !FORNAVN.has(del)) continue
        for (const m of t.matchAll(new RegExp(`\\b${escapeRe(del)}\\b`, 'g'))) legg('navn', 'Person', m.index, m.index + del.length, 12, navn)
      }
    }
    treff.sort((a, b) => a.start - b.start)
    let ut = '', pos = 0
    for (const x of treff) {
      antall[x.type] = (antall[x.type] || 0) + 1
      ut += t.slice(pos, x.start) + plassFor(x.type, x.plass, x.original)
      pos = x.end
    }
    return ut + t.slice(pos)
  }
  return { skjerm, kobling, antall, nye, get treff() { return Object.values(antall).reduce((a, b) => a + b, 0) } }
}
// Én tekst, én gang (tester og «se hva som sendes»). Koblingen returneres til kalleren — den skal aldri logges.
export function skjerm(tekst, { kjente = [] } = {}) {
  const sk = lagSkjermer(kjente)
  const ut = sk.skjerm(tekst)
  return { tekst: ut, kobling: sk.kobling, antall: sk.antall, treff: sk.treff, nye: [...sk.nye] }
}
// Svaret kommer tilbake med plassholderne — de byttes tilbake lokalt før svaret vises og lagres.
export function avskjerm(tekst, kobling = {}) {
  let t = String(tekst || '')
  for (const [p, o] of Object.entries(kobling)) t = t.split(p).join(o)
  return t
}

// ── Kjent-personer-lista ────────────────────────────────────────────────────
// Bygges av arkivets egne saker (titler, samtale, prosjekt, tagger) med fornavn-regelen, og vokser av bruk: navn som skjermingen
// oppdager i det som sendes, legges til. Lagres lokalt i .tua/kjente-personer.json — bare navn, aldri hva de ble sendt med.
const KJENTE = () => (filesMode() ? path.join(FILES_ROOT, '.tua', 'kjente-personer.json') : path.join(DATA_DIR, 'kjente-personer.json'))
const lesKjente = () => { try { const j = JSON.parse(fs.readFileSync(KJENTE(), 'utf8')); return { navn: Array.isArray(j.navn) ? j.navn : [], stopp: Array.isArray(j.stopp) ? j.stopp : [] } } catch { return { navn: [], stopp: [] } } }
function skrivKjente(k) { try { fs.mkdirSync(path.dirname(KJENTE()), { recursive: true }); fs.writeFileSync(KJENTE(), JSON.stringify({ ...k, oppdatert: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 }) } catch {} }
export function kjentePersoner(atoms = [], { lær = [] } = {}) {
  const k = lesKjente()
  const før = k.navn.length
  const sett = new Set(k.navn), stopp = new Set(k.stopp)
  // To mønstre i feltene: «Fornavn Etternavn» med kjent fornavn, og «med/fra/til/hos/… Ukjent Etternavn» — det siste er det som
  // fanger navnene fornavn-lista ikke kjenner («Møte med Xenia Fjeldstad»). Treffene gjelder bare felt, aldri innholdet (det tar skjerm()).
  const fornavnRe = new RegExp(`\\b(${[...FORNAVN].map(escapeRe).join('|')})(\\s${ETTERNAVN}){1,2}\\b`, 'g')
  const kontekstRe = new RegExp(`\\b(?:med|fra|til|hos|for|av|ved|v/|og|kontakt|møte|intervju|samtale)\\s+(${ETTERNAVN}(?:\\s${ETTERNAVN}){1,2})\\b`, 'g')
  const felt = (a) => [a.name, a.convo, a.project, ...(a.tags || [])].filter(Boolean).join(' · ')
  for (const a of atoms) {
    const f = felt(a)
    for (const m of f.matchAll(fornavnRe)) if (navneKandidat(m[0]) && !stopp.has(m[0])) sett.add(m[0])
    for (const m of f.matchAll(kontekstRe)) if (navneKandidat(m[1]) && !stopp.has(m[1])) sett.add(m[1])
  }
  for (const n of lær) if (n && navneKandidat(n) && !stopp.has(n)) sett.add(n)
  k.navn = [...sett].sort()
  if (k.navn.length !== før) skrivKjente(k)
  return k.navn
}

// ── 2) Minimering ───────────────────────────────────────────────────────────
// Konteksten bygges av valgte saker på valgt nivå per sak (S standard når nivå mangler; L bare når eksplisitt valgt).
// Nivået klampes til det prosjektet får se (maxLevel, V11). Vault klampes IKKE her — det er fail closed i sjekkTillatt().
// Det som sendes om saken er tittel, versjon og nivå — ikke prosjekt, samtale eller tagger (Trust Score-teksten lover det).
export function minimer(atoms, saker = [], { prosjekt } = {}) {
  const kilder = [], deler = [], notater = []
  for (const s of saker) {
    const id = typeof s === 'string' ? s : s.id
    const a = atoms.find((x) => x.id === id)
    if (!a) { notater.push(`fant ikke sak ${id}`); continue }
    const ønsket = LEVELS.includes(s.nivå) ? s.nivå : LEVELS.includes(s.level) ? s.level : 'S'
    const eff = clampLevel(ønsket, maxLevel(a, prosjekt))
    if (eff !== ønsket) notater.push(`«${a.name}»: ${prosjekt} ser bare ${eff}, ikke ${ønsket}`)
    const got = levelOf(a, eff)
    const tekst = got.text.trim()
    kilder.push({ id: a.id, name: a.name, version: a.version || 1, level: eff, ønsket, vault: isVault(a), fallback: got.fallback ? got.level : null, tegn: tekst.length, ord: ord(tekst) })
    deler.push(`## ${a.name}\n_v${a.version || 1} · nivå ${eff}_\n\n${tekst}`)
  }
  return { kontekst: deler.join('\n\n'), kilder, notater }
}

// ── 3) Mottakere og fail closed ─────────────────────────────────────────────
// Hva Trust Score (1–5) tillater: S til alle, M fra 3, L fra 4. Vault-merkede saker (V15) bare som S — unntatt til en lokal
// modell (trust-scores.json: «den eneste modellen som får lese L av Vault-merkede atomer»).
export const NIVÅ_KREVER_TRUST = { S: 1, M: 3, L: 4 }
export function sjekkTillatt(mottaker, kilder) {
  const score = Number(mottaker.trust?.score) || 1
  const maks = LEVELS.filter((l) => NIVÅ_KREVER_TRUST[l] <= score).at(-1) || 'S'
  const problemer = []
  for (const k of kilder) {
    if (k.vault && k.level !== 'S' && !mottaker.local) problemer.push(`«${k.name}» er Vault-merket og kan bare sendes som S til ${mottaker.label}. Sett nivået til S, ta saken ut, eller send til en lokal modell.`)
    else if (NIVÅ_KREVER_TRUST[k.level] > score) problemer.push(`${mottaker.label} har Trust Score ${score}/5 — nivå ${k.level} krever minst ${NIVÅ_KREVER_TRUST[k.level]}. Sett «${k.name}» til ${maks}, eller velg en mottaker med høyere Trust Score.`)
  }
  if (problemer.length) throw new Blokkert(`Sendingen er stoppet (${problemer.length} ${problemer.length === 1 ? 'sak' : 'saker'}): ${problemer.join(' ')}`, problemer)
  return { maks }
}

const SYSTEM = 'Du svarer på norsk, kort og presist. Teksten under «Kontekst» er hentet fra brukerens eget arkiv (Tua) og kan inneholde ' +
  'plassholdere som [Person A], [E-post 1] eller [Adresse 1]. Det er skjermede opplysninger: bruk plassholderne uendret i svaret, ' +
  'og ikke gjett hva de står for.'
const byggMelding = (melding, kontekst) => (kontekst ? `${melding.trim()}\n\n---\n\nKontekst\n\n${kontekst}` : melding.trim())

export const CLAUDE_MODELL = 'claude-opus-5-5'
// Claude via egen nøkkel (D2'). Nøkkelen leses fra Keychain i selve kallet og lever bare i klient-objektet til kallet er ferdig.
// Strømmer tekstbiter til onDel; adaptiv tenkning; server-side fallback «default» slik at et avslag fra sikkerhetsklassifisering
// kjøres på nytt på modellen Anthropic anbefaler (beta server-side-fallback-2026-07-01). Avslag etter fallback → MotorFeil.
async function sendClaude({ system, melding, kontekst }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('claude')
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for Claude i Keychain. Legg den inn under Innstillinger › AI-mottakere (console.anthropic.com › API keys).')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: nøkkel })
  nøkkel = null
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODELL, max_tokens: 64000, thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system, messages: [{ role: 'user', content: byggMelding(melding, kontekst) }],
  }, { signal })
  for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onDel(ev.delta.text)
  const fm = await stream.finalMessage()
  if (fm.stop_reason === 'refusal') throw new MotorFeil(`Claude avslo forespørselen${fm.stop_details?.explanation ? `: ${fm.stop_details.explanation}` : ''}. Ingenting er lagret som svar.`)
  const tekst = fm.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return { tekst, modell: fm.model, usage: { input_tokens: fm.usage?.input_tokens ?? null, output_tokens: fm.usage?.output_tokens ?? null }, stopp: fm.stop_reason }
}

// Ollama lokalt (V18: lokal modell først når den finnes). Modell: TUA_OLLAMA_MODELL eller den første i lista. NDJSON-strøm fra /api/chat.
async function sendOllama({ system, melding, kontekst }, { onDel = () => {}, signal } = {}) {
  const st = await ollamaStatus()
  if (!st.running || !st.models.length) throw new MotorFeil('Ollama kjører ikke på 127.0.0.1:11434, eller har ingen modell (ollama pull …).')
  const model = process.env.TUA_OLLAMA_MODELL || st.models[0]
  const r = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: byggMelding(melding, kontekst) }] }) })
  if (!r.ok || !r.body) throw new MotorFeil(`Ollama svarte ${r.status}`)
  let tekst = '', rest = '', usage = { input_tokens: null, output_tokens: null }
  const dec = new TextDecoder()
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true })
    const linjer = rest.split('\n'); rest = linjer.pop()
    for (const l of linjer) {
      if (!l.trim()) continue
      const j = JSON.parse(l)
      const bit = j.message?.content || ''
      if (bit) { tekst += bit; onDel(bit) }
      if (j.done) usage = { input_tokens: j.prompt_eval_count ?? null, output_tokens: j.eval_count ?? null }
    }
  }
  return { tekst, modell: model, usage, stopp: 'end_turn' }
}

// Test-mottaker: ekkoer det som ville blitt sendt, i biter, uten å sende noe ut av maskinen. Trust 3 → S og M går, L blokkeres (fail closed kan prøves).
async function sendTest({ system, melding, kontekst }, { onDel = () => {} } = {}) {
  const ut = `Ekko fra test-mottakeren (ingenting er sendt ut av maskinen).\n\nSystem: ${system}\n\n${byggMelding(melding, kontekst)}`
  const biter = ut.match(/[\s\S]{1,120}/g) || []
  for (const b of biter) { await new Promise((r) => setTimeout(r, 2)); onDel(b) }
  return { tekst: ut, modell: 'ekko', usage: { input_tokens: anslåTokens(system + melding + kontekst, 'test'), output_tokens: anslåTokens(ut, 'test') }, stopp: 'end_turn' }
}

// Mottaker-grensesnittet. status() svarer klar/ikke klar med grunn — aldri nøkkelverdier. send() nås bare gjennom spor().
function lagMottakere() {
  const ts = trustScores().ai || {}
  return [
    { id: 'claude', label: 'Claude (Anthropic)', endpoint: 'api.anthropic.com', modell: CLAUDE_MODELL, trust: ts.claude || null, nøkkel: true,
      status: async () => (hasKey('claude') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendClaude },
    { id: 'ollama', label: 'Ollama (lokal)', endpoint: '127.0.0.1:11434', modell: process.env.TUA_OLLAMA_MODELL || null, trust: ts.ollama || null, local: true,
      status: async () => { const s = await ollamaStatus(); return s.running && s.models.length ? { klar: true, modeller: s.models } : { klar: false, hvorfor: s.running ? 'Ollama kjører, men har ingen modell' : 'Ollama kjører ikke' } }, send: sendOllama },
    { id: 'test', label: 'Test (ekko — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: { score: 3, label: 'Test', innhold: 'Forlater aldri maskinen; viser bare det som ville blitt sendt.' }, test: true,
      status: async () => ({ klar: true }), send: sendTest },
  ]
}
// Lista til appen (GET /api/mottakere): uten send(), med status. Nøkkel: satt/ikke satt — aldri verdien.
// standard (V18): lokal modell først når den finnes, ellers Claude når nøkkelen finnes, ellers ingen (test er aldri standard).
export async function mottakere() {
  const liste = await Promise.all(lagMottakere().map(async (m) => {
    const st = await m.status()
    return { id: m.id, label: m.label, endpoint: m.endpoint, modell: st.modeller?.[0] || m.modell, trust: m.trust, local: !!m.local, test: !!m.test,
      ...(m.nøkkel ? { nøkkel: hasKey(m.id) ? 'satt' : 'ikke satt' } : {}), aktiv: st.klar, ...(st.hvorfor ? { hvorfor: st.hvorfor } : {}) }
  }))
  const std = liste.find((m) => m.local && m.aktiv) || liste.find((m) => m.id === 'claude' && m.aktiv)
  return liste.map((m) => ({ ...m, standard: !!std && m.id === std.id }))
}
export const standardMottaker = async () => (await mottakere()).find((m) => m.standard)?.id || null

// ── 4) spor(): hele løpet, ingen vei utenom ────────────────────────────────
// på(hendelse, data) får: skjermet {antall, treff, tokens:{ca}, ord, tekst (det som sendes), saker, notater} · del {tekst} · ferdig {svar, prompt, tokens, tekst}.
// Feil kastes: Blokkert (fail closed) eller MotorFeil. Prompten lagres FØR sending (V16: den er brukerens investering, også når sendingen feiler).
const tittelAv = (s) => (String(s || '').split('\n').find((l) => l.trim()) || 'Spørsmål').trim().replace(/^#+\s*/, '').slice(0, 70)
export async function spor({ melding, saker = [], mottaker: mId, prosjekt, samtale, klient = 'app', signal, på = () => {} }) {
  if (!melding || !String(melding).trim()) throw new MotorFeil('melding kreves')
  const m = lagMottakere().find((x) => x.id === mId)
  if (!m) throw new MotorFeil(`ukjent mottaker «${mId}» — en av ${lagMottakere().map((x) => x.id).join(', ')}`)
  const st = await m.status()
  if (!st.klar) throw new MotorFeil(`${m.label} er ikke klar: ${st.hvorfor}`)

  const atoms = load()
  const { kontekst, kilder, notater } = minimer(atoms, saker, { prosjekt })
  const { maks } = sjekkTillatt(m, kilder)                                   // fail closed — før noe skjermes eller sendes

  const sk = lagSkjermer(kjentePersoner(atoms))
  const meldingS = sk.skjerm(String(melding)), kontekstS = sk.skjerm(kontekst)
  const sendes = `${SYSTEM}\n\n${byggMelding(meldingS, kontekstS)}`
  const tokensCa = anslåTokens(sendes, m.id)
  if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] })                   // lista vokser av bruk
  på('skjermet', { mottaker: m.id, antall: { ...sk.antall }, treff: sk.treff, ord: ord(sendes), tokens: { ca: tokensCa }, maks, tekst: sendes,
    saker: kilder.map(({ id, name, version, level, ord: o, tegn }) => ({ id, name, version, level, ord: o, tegn })), notater })

  const proj = prosjekt || atoms.find((x) => x.id === kilder[0]?.id)?.project || 'Uten prosjekt'
  const tittel = tittelAv(melding)
  const { atom: promptAtom } = upsert(atoms, { kind: 'prompt', content: String(melding), name: tittel, project: proj, convo: samtale || tittel, tags: ['prompt'], source: 'Tua', by: 'regel',
    short: `Spørsmål stilt i Tua til ${m.label}${kilder.length ? ` med ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} som kontekst` : ''}.` })
  save(atoms)

  let strømmet = ''
  const r = await m.send({ system: SYSTEM, melding: meldingS, kontekst: kontekstS }, { signal, onDel: (t) => { strømmet += t; på('del', { tekst: t }) } })
  const svarTekst = avskjerm(r.tekst || strømmet, sk.kobling)
  const tokens = { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
  const { atom: svarAtom } = upsert(atoms, { kind: 'svar', content: svarTekst, name: `Svar fra ${m.label}: ${tittel}`.slice(0, 90), project: proj, convo: samtale || tittel, tags: ['svar', m.id], source: m.label, by: 'regel',
    derivedFrom: [{ id: promptAtom.id, version: promptAtom.version || 1, level: 'L' }, ...kilder.map(({ id, version, level }) => ({ id, version, level }))],
    short: `Svar fra ${m.label} (${r.modell}) på «${tittel}»${kilder.length ? `, med ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} på nivå ${[...new Set(kilder.map((k) => k.level))].join('/')}` : ''}.`.slice(0, 300) })
  save(atoms)
  logDelivery({ tool: 'spor', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: kilder.map(({ id, version, level }) => ({ id, version, level })),
    skjermet: { ...sk.antall }, ord: ord(sendes), tokens, prompt: promptAtom.id, svar: svarAtom.id, ...(prosjekt ? { context: prosjekt } : {}) })
  const ferdig = { svar: svarAtom.id, prompt: promptAtom.id, mottaker: m.id, modell: r.modell, tokens, tekst: svarTekst }
  på('ferdig', ferdig)
  return ferdig
}
