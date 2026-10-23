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
//
// Skive 6 (M20b): spor() tar flere mottakere samtidig — ett skjerm, ett minimer, én sjekkTillatt per mottaker (én blokkert stopper alle, V21),
// samme melding til alle parallelt, ett svar-sak og én Utlevert-linje per mottaker, prompt-saken får `ga` med alle svarene. Når mer enn én svarte:
//   forskjeller(svar[])      tre lister enig / uenig / unikt, vurdert av standardmodellen lokalt (vurderer(): Ollama → Claude → ikke tilgjengelig
//                            med grunn), som JSON fra modellen med robust tolker (tolkForskjeller) og fallback. Går gjennom motoren: skjerm → send → logg.
//   konklusjon(…)            vurdereren skriver et utkast; lagres som sak kind: konklusjon, status utkast, bygget_av → prompten og alle svarene.
//                            rettKonklusjon() tar brukerens rettelse som ny versjon; låsing er POST /api/status. Ingen kodevei utenom.
// Tester: server/test-motor.mjs og server/test-forskjeller.mjs (mot testarkiv i scratch, aldri ~/Dropbox/Tua; ingen ekte kall).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, save, upsert, levelOf, clampLevel, maxLevel, isVault, logDelivery, setStatus, statusOf, LEVELS, LONG_L, FILES_ROOT, filesMode, DATA_DIR } from './store.js'
import { readKey, hasKey, ollamaStatus } from './keychain.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TRUST_FILE = path.join(HERE, 'trust-scores.json')
// Trust Score per connector — én JSON-fil, leses ved hvert kall så rettelser virker uten omstart (M15). Anslag; rettes i fila.
// Skive 5 (arbeidsstykke 30 §7): fila har `endepunkter` — én rad per endepunkt (id, leverandør, label, endpoint, region, score, de fire
// parametrene, anbefaling, svakest, kilde, dato). `ai` avledes av den (første rad per leverandør) så Spør-raden, /api/settings og alt
// som leser ts.ai.<leverandør> virker som før. Den gamle forma (bare `ai`) leses også: da avledes `endepunkter` fra den.
export const trustScores = () => {
  let ts
  try { ts = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8')) } catch (e) { return { _merk: `trust-scores.json kunne ikke leses: ${e.message}`, sky: {}, ai: {}, endepunkter: [] } }
  const endepunkter = Array.isArray(ts.endepunkter) ? ts.endepunkter
    : Object.entries(ts.ai || {}).map(([id, v]) => ({ id, leverandør: id, ...v }))
  const ai = {}
  for (const e of endepunkter) { const lev = e.leverandør || e.id; if (lev && !ai[lev]) ai[lev] = e }
  return { ...ts, sky: ts.sky || {}, endepunkter, ai: { ...ai, ...(Array.isArray(ts.endepunkter) ? {} : ts.ai || {}) } }
}
export const trustFor = (id) => { const ts = trustScores(); return ts.endepunkter.find((e) => e.id === id) || ts.ai[id] || null }

export class Blokkert extends Error { constructor(msg, detaljer = []) { super(msg); this.name = 'Blokkert'; this.kode = 'blokkert'; this.detaljer = detaljer } }
export class MotorFeil extends Error { constructor(msg) { super(msg); this.name = 'MotorFeil'; this.kode = 'feil' } }

// ── Ord og tokens ───────────────────────────────────────────────────────────
// Tokens kan ikke måles eksakt før sending (K7). Lokalt anslag = tegn / faktor, alltid merket «ca.»; eksakt fra usage etter svar.
// Faktoren er per mottaker, målt 23.10.2026 på samme norske tekst: gemma3:4b (Ollama) ≈ 3,5 tegn per token (788 eksakt mot 826 anslått),
// Claude Opus 5.5 ≈ 1,9 (1 645 eksakt mot 826 anslått med 3,5) — Claudes tokenizer deler norsk finere. Ukjent mottaker: 3,5.
export const ord = (t) => (String(t || '').match(/\S+/g) || []).length
export const TEGN_PER_TOKEN = { claude: 1.9, ollama: 3.5, test: 3.5, test2: 3.5 }
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
// Skive 6: send() tar også `json` (svaret skal være ett JSON-objekt — Ollama får format: json, Claude får det i system-teksten) og `oppgave`
// ('forskjeller' | 'konklusjon' — bare test-mottakeren bryr seg: den svarer med et fast, tolkbart svar så testene aldri trenger en modell).
const JSON_KRAV = ' Svar BARE med ett gyldig JSON-objekt — ingen tekst før eller etter, ingen kodeblokk.'

export const CLAUDE_MODELL = 'claude-opus-5-5'
// Claude via egen nøkkel (D2'). Nøkkelen leses fra Keychain i selve kallet og lever bare i klient-objektet til kallet er ferdig.
// Strømmer tekstbiter til onDel; adaptiv tenkning; server-side fallback «default» slik at et avslag fra sikkerhetsklassifisering
// kjøres på nytt på modellen Anthropic anbefaler (beta server-side-fallback-2026-07-01). Avslag etter fallback → MotorFeil.
async function sendClaude({ system, melding, kontekst, json }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('claude')
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for Claude i Keychain. Legg den inn under Innstillinger › AI-mottakere (console.anthropic.com › API keys).')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: nøkkel })
  nøkkel = null
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODELL, max_tokens: 64000, thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system: json ? system + JSON_KRAV : system, messages: [{ role: 'user', content: byggMelding(melding, kontekst) }],
  }, { signal })
  for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onDel(ev.delta.text)
  const fm = await stream.finalMessage()
  if (fm.stop_reason === 'refusal') throw new MotorFeil(`Claude avslo forespørselen${fm.stop_details?.explanation ? `: ${fm.stop_details.explanation}` : ''}. Ingenting er lagret som svar.`)
  const tekst = fm.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return { tekst, modell: fm.model, usage: { input_tokens: fm.usage?.input_tokens ?? null, output_tokens: fm.usage?.output_tokens ?? null }, stopp: fm.stop_reason }
}

// Ollama lokalt (V18: lokal modell først når den finnes). Modell: TUA_OLLAMA_MODELL eller den første i lista. NDJSON-strøm fra /api/chat.
async function sendOllama({ system, melding, kontekst, json }, { onDel = () => {}, signal } = {}) {
  const st = await ollamaStatus()
  if (!st.running || !st.models.length) throw new MotorFeil('Ollama kjører ikke på 127.0.0.1:11434, eller har ingen modell (ollama pull …).')
  const model = process.env.TUA_OLLAMA_MODELL || st.models[0]
  const body = { model, stream: true, messages: [{ role: 'system', content: json ? system + JSON_KRAV : system }, { role: 'user', content: byggMelding(melding, kontekst) }], ...(json ? { format: 'json' } : {}) }
  const r = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

// Test-mottakerne: ekkoer det som ville blitt sendt, i biter, uten å sende noe ut av maskinen. Trust 3 → S og M går, L blokkeres (fail closed kan prøves).
// Som vurderer (TUA_VURDERER=test) svarer «test» med faste, tolkbare forskjeller (JSON over bokstavene A, B … i konteksten) og en fast konklusjon.
// «test2» (bare med TUA_TESTMOTTAKERE=2, til testene) ekkoer ANNERLEDES enn «test» — overskriftene i konteksten og et tilleggspunkt — så to
// svar på samme spørsmål faktisk er forskjellige og Forskjeller har noe å finne.
const strøm = async (ut, onDel) => { for (const b of ut.match(/[\s\S]{1,120}/g) || []) { await new Promise((r) => setTimeout(r, 2)); onDel(b) } }
const testSvar = (ut, inn, id) => ({ tekst: ut, modell: 'ekko', usage: { input_tokens: anslåTokens(inn, id), output_tokens: anslåTokens(ut, id) }, stopp: 'end_turn' })
async function sendTest({ system, melding, kontekst, oppgave }, { onDel = () => {} } = {}) {
  const inn = system + melding + kontekst
  if (oppgave === 'forskjeller') {
    const bokstaver = [...String(kontekst).matchAll(/^## Svar ([A-Z]+)\b/gm)].map((m) => m[1])
    const ut = JSON.stringify({
      enig: [{ punkt: 'Alle svarene gjengir spørsmålet og konteksten som ble sendt.', svar: bokstaver }],
      uenig: [{ punkt: 'Svarene formulerer seg ulikt om det samme innholdet.', svar: bokstaver }],
      unikt: bokstaver.length ? [{ punkt: `Svar ${bokstaver.at(-1)} har et tilleggspunkt de andre ikke har med.`, svar: [bokstaver.at(-1)] }] : [],
    })
    await strøm(ut, onDel); return testSvar(ut, inn, 'test')
  }
  if (oppgave === 'konklusjon') {
    const ut = 'Utkast til konklusjon (test-mottakeren, ingenting sendt ut av maskinen): svarene er enige om hovedsaken, uenige i formuleringen, og ett av dem har et tilleggspunkt. Rett teksten og lås den når den stemmer.'
    await strøm(ut, onDel); return testSvar(ut, inn, 'test')
  }
  if (oppgave === 'nivåer') {   // skive 7: fast, tolkbar S/M for en innlest fil — første linje i konteksten (etter overskriften) som ingress, teksten flatet som sammendrag
    const flat = String(kontekst).replace(/^## .*\n+/, '').replace(/\s+/g, ' ').trim()
    const ut = JSON.stringify({ S: `Test-ingress: ${flat.slice(0, 200)}`, M: `Test-sammendrag (ingenting sendt ut av maskinen): ${flat.slice(0, 1200)}` })
    await strøm(ut, onDel); return testSvar(ut, inn, 'test')
  }
  const ut = `Ekko fra test-mottakeren (ingenting er sendt ut av maskinen).\n\nSystem: ${system}\n\n${byggMelding(melding, kontekst)}`
  await strøm(ut, onDel); return testSvar(ut, inn, 'test')
}
async function sendTest2({ melding, kontekst }, { onDel = () => {} } = {}) {
  const overskrifter = [...String(kontekst).matchAll(/^## (.+)$/gm)].map((m) => m[1])
  const ut = `EKKO B (test-mottaker 2 — ingenting er sendt ut av maskinen).\n\nSpørsmålet var: ${melding.trim()}\n\nKildene jeg fikk: ${overskrifter.length ? overskrifter.join(' · ') : 'ingen'}.\n\nTilleggspunkt bare fra B: dette svaret ser saken fra en annen vinkel enn test-mottaker 1.`
  await strøm(ut, onDel); return testSvar(ut, melding + kontekst, 'test2')
}

const TEST_TRUST = (label, kilde) => ({ score: 3, label, endpoint: 'lokalt', region: 'lokalt', metadata: 'Ingen — ingenting sendes.', innhold: 'Forlater aldri maskinen; viser bare det som ville blitt sendt.', mining: 'Ingen.', retensjon: 'Bare Tuas egen Utlevert-linje (metadata).', svakest: null, kilde, dato: '2026-10-23' })
// Mottaker-grensesnittet. status() svarer klar/ikke klar med grunn — aldri nøkkelverdier. send() nås bare gjennom spor(), forskjeller() og konklusjon().
function lagMottakere() {
  const ts = trustScores().ai || {}
  const liste = [
    { id: 'claude', label: 'Claude (Anthropic)', endpoint: 'api.anthropic.com', modell: CLAUDE_MODELL, trust: ts.claude || null, nøkkel: true,
      status: async () => (hasKey('claude') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendClaude },
    { id: 'ollama', label: 'Ollama (lokal)', endpoint: '127.0.0.1:11434', modell: process.env.TUA_OLLAMA_MODELL || null, trust: ts.ollama || null, local: true,
      status: async () => { const s = await ollamaStatus(); return s.running && s.models.length ? { klar: true, modeller: s.models } : { klar: false, hvorfor: s.running ? 'Ollama kjører, men har ingen modell' : 'Ollama kjører ikke' } }, send: sendOllama },
    { id: 'test', label: 'Test (ekko — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: TEST_TRUST('Test', 'Tua selv: ekko-mottakeren i motor.js. Score 3 er satt lavt med vilje så fail closed kan prøves (L blokkeres).'), test: true,
      status: async () => ({ klar: true }), send: sendTest },
  ]
  if (process.env.TUA_TESTMOTTAKERE === '2') liste.push({ id: 'test2', label: 'Test 2 (ekko B — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: TEST_TRUST('Test 2', 'Tua selv: andre ekko-mottaker i motor.js (TUA_TESTMOTTAKERE=2) — svarer annerledes enn Test så Forskjeller kan testes uten modell.'), test: true, status: async () => ({ klar: true }), send: sendTest2 })
  return liste
}
// Lista til appen (GET /api/mottakere): uten send(), med status. Nøkkel: satt/ikke satt — aldri verdien.
// standard (V18): lokal modell først når den finnes, ellers Claude når nøkkelen finnes, ellers ingen (test er aldri standard).
export async function mottakere() {
  const liste = await Promise.all(lagMottakere().map(async (m) => {
    const st = await m.status()
    return { id: m.id, label: m.label, endpoint: m.endpoint, modell: st.modeller?.[0] || m.modell, trust: m.trust, local: !!m.local, test: !!m.test,
      tegnPerToken: TEGN_PER_TOKEN[m.id] || 3.5,                 // Spør-skjermens anslag før sending bruker samme faktor som motoren (skive 2)
      ...(m.nøkkel ? { nøkkel: hasKey(m.id) ? 'satt' : 'ikke satt' } : {}), aktiv: st.klar, ...(st.hvorfor ? { hvorfor: st.hvorfor } : {}) }
  }))
  const std = liste.find((m) => m.local && m.aktiv) || liste.find((m) => m.id === 'claude' && m.aktiv)
  return liste.map((m) => ({ ...m, standard: !!std && m.id === std.id }))
}
export const standardMottaker = async () => (await mottakere()).find((m) => m.standard)?.id || null

// Vurdereren (skive 6, V21): Forskjeller og konklusjonen skrives av standardmodellen lokalt — Ollama når den kjører, ellers Claude med nøkkel,
// ellers ikke tilgjengelig med grunn. TUA_VURDERER overstyrer (testene setter «test»). Går gjennom de samme trinnene som spor():
// sjekkTillatt (svar-sakene på L — arver et svar Vault-merket, stoppes en ekstern vurderer) → skjerm → send → Utlevert-linje med mottaker.
// Nivået en vurderer får lese svar-sakene på: det høyeste Trust Score tillater (L for lokal og Claude, M for test). Vault-arv stoppes
// fortsatt hos en ekstern vurderer i sjekkTillatt — det klampes ikke ned til S i det stille (forskjeller av ingresser ville være verdiløse).
export const maksNivå = (m) => { const score = Number(m?.trust?.score) || 1; return LEVELS.filter((l) => NIVÅ_KREVER_TRUST[l] <= score).at(-1) || 'S' }
const svarKilde = (atoms, s, nivå) => { const a = s.id ? atoms.find((x) => x.id === s.id) : null; const tekst = a ? levelOf(a, nivå).text : String(s.tekst || ''); return { id: s.id || null, name: a?.name || `Svar fra ${s.label || s.mottaker}`, version: a?.version || s.version || 1, level: nivå, vault: a ? isVault(a) : false, tekst } }
export async function vurderer() {
  const alle = lagMottakere()
  const ønsket = process.env.TUA_VURDERER
  const rekke = ønsket ? alle.filter((m) => m.id === ønsket) : [alle.find((m) => m.id === 'ollama'), alle.find((m) => m.id === 'claude')]
  const grunner = []
  for (const m of rekke.filter(Boolean)) { const st = await m.status(); if (st.klar) return { m, modell: st.modeller?.[0] || m.modell }; grunner.push(`${m.label}: ${st.hvorfor}`) }
  return { m: null, grunn: `Ingen modell kan vurdere svarene${grunner.length ? ` — ${grunner.join('; ')}` : ønsket ? ` — ukjent vurderer «${ønsket}»` : ''}. Start Ollama, eller legg inn en Claude-nøkkel under Innstillinger › AI-mottakere.` }
}

// ── 0) Lese: S og M for en innlest fil (M16, skive 7) ──────────────────────
// En fil som leses inn (lesere.js → innlesing.js) blir en sak med L = hele teksten. S og M skrives av standardmodellen LOKALT — Ollama når den
// kjører — ellers etter regler (regelNivåer). Claude skriver bare når det bes om det (skriver: 'claude'); da går teksten gjennom de samme trinnene
// som spor(): sjekkTillatt (L til Claude krever Trust 4) → skjerm → send → avskjerm → én Utlevert-linje (tool: innlesing). En lokal modell logges
// IKKE som utlevering — ingenting forlot maskinen. V10: nivået merkes med hvem som skrev det (`av`: «regel», «Ollama · gemma3:4b», «Claude · …»).
// TUA_SKRIVER overstyrer (regel | test | ollama | claude) — testene bruker regel og test.
export async function skriver(ønsket = process.env.TUA_SKRIVER || 'auto') {
  if (ønsket === 'regel') return { m: null, regel: true }
  const alle = lagMottakere()
  const rekke = ønsket === 'auto' ? [alle.find((m) => m.id === 'ollama')] : alle.filter((m) => m.id === ønsket)
  const grunner = []
  for (const m of rekke.filter(Boolean)) { const st = await m.status(); if (st.klar) return { m, modell: st.modeller?.[0] || m.modell }; grunner.push(`${m.label}: ${st.hvorfor}`) }
  return { m: null, regel: true, grunn: grunner.length ? grunner.join('; ') : ønsket === 'auto' ? 'ingen lokal modell' : `ukjent skriver «${ønsket}»` }
}
const setningKutt = (t, maks) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  if (s.length <= maks) return s
  const k = s.slice(0, maks)
  const i = Math.max(k.lastIndexOf('. '), k.lastIndexOf('! '), k.lastIndexOf('? '))
  return i > maks * 0.4 ? k.slice(0, i + 1) : k.slice(0, maks - 1).trimEnd() + '…'
}
// Regelbasert S/M: S = første avsnitt med brødtekst (ikke overskrift, ikke liste, ikke tabell) flatet til ≤ 300 tegn; M (bare når teksten er lang,
// > LONG_L) = overskriftene og første setning i hvert avsnitt under, til 2 500 tegn. Forutsigbart og uten modell — merket «regel».
export function regelNivåer(tekst, { tittel = '' } = {}) {
  const t = String(tekst || '').replace(/\r\n?/g, '\n')
  const avsnitt = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const erOverskrift = (p) => /^#{1,6}\s/.test(p)
  const brød = avsnitt.filter((p) => !erOverskrift(p) && !/^[-*|>`]/.test(p) && ord(p) >= 4)
  const S = setningKutt((brød[0] || avsnitt.find((p) => !erOverskrift(p)) || avsnitt[0] || tittel || '').replace(/^#+\s*/, ''), 300)
  if (t.length <= LONG_L) return { S, M: '' }
  const linjer = []
  let n = 0
  for (const p of avsnitt) {
    const l = erOverskrift(p) ? p.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim() : setningKutt(p.replace(/^[-*>]\s*/, ''), 220)
    if (!l || l === S) continue
    if (n + l.length + 2 > 2400) break
    linjer.push(erOverskrift(p) ? `**${l}**` : `– ${l}`); n += l.length + 2
  }
  return { S, M: setningKutt(linjer.join('\n'), 2500) }
}
const NIVÅ_OPPGAVE = (medM, tegn, kuttet) => `Teksten under er et dokument fra brukerens arkiv (${tegn.toLocaleString('no-NO')} tegn${kuttet ? ', bare begynnelsen er med' : ''}). Svar med ett JSON-objekt: ` +
  (medM ? '{"S": "…", "M": "…"}. S = ingress: én til to setninger, høyst 300 tegn, som sier hva dokumentet er og hva det handler om. M = sammendrag, høyst 2 500 tegn: hovedpunktene, tallene og navnene som står i teksten, i den rekkefølgen de står. '
    : '{"S": "…"}. S = ingress: én til to setninger, høyst 300 tegn, som sier hva dokumentet er og hva det handler om. ') +
  'På norsk. Ikke finn på noe som ikke står i teksten. Plassholdere som [Person A] brukes uendret.'
export const NIVÅ_MAKS_TEGN = 12000
// Skriv S (og M når teksten er lang) for én tekst. Returnerer { S, M, av, modell, tokens, utlevert, grunn? } — faller alltid tilbake til regler, aldri feil.
export async function skrivNivåer(tekst, { tittel = '', sak = null, prosjekt, klient = 'app', skriver: ønsket, signal, på = () => {} } = {}) {
  const t = String(tekst || '')
  const regel = regelNivåer(t, { tittel })
  const v = await skriver(ønsket)
  if (!v.m) return { ...regel, av: 'regel', modell: null, tokens: null, utlevert: false, ...(v.grunn ? { grunn: v.grunn } : {}) }
  const m = v.m
  const medM = t.length > LONG_L
  const atoms = load()
  if (!m.test) {   // fail closed som i spor(): en ekstern skriver må ha Trust Score for L (Claude 4 → ok); lokal og test går alltid
    const kilder = [{ id: sak?.id || null, name: tittel || sak?.name || 'fila', version: sak?.version || 1, level: 'L', vault: false }]
    try { sjekkTillatt(m, kilder) } catch (e) { if (e instanceof Blokkert) return { ...regel, av: 'regel', modell: null, tokens: null, utlevert: false, grunn: `${m.label} fikk ikke lese fila: ${e.message}` }; throw e }
  }
  const sk = lagSkjermer(kjentePersoner(atoms))
  const kuttet = t.length > NIVÅ_MAKS_TEGN
  const kontekst = `## ${sk.skjerm(tittel || 'Dokument')}\n\n${sk.skjerm(kuttet ? t.slice(0, NIVÅ_MAKS_TEGN) : t)}${kuttet ? '\n\n[…]' : ''}`
  const oppgave = NIVÅ_OPPGAVE(medM, t.length, kuttet)
  const sendes = `${SYSTEM}${JSON_KRAV}\n\n${byggMelding(oppgave, kontekst)}`
  const tokensCa = anslåTokens(sendes, m.id)
  på('skriver', { mottaker: m.id, label: m.label, modell: v.modell, lokalt: !!m.local || !!m.test, tokens: { ca: tokensCa }, medM })
  let r
  try { r = await m.send({ system: SYSTEM, melding: oppgave, kontekst, json: true, oppgave: 'nivåer' }, { signal }) }
  catch (e) { return { ...regel, av: 'regel', modell: null, tokens: null, utlevert: false, grunn: `${m.label} svarte ikke (${e.message}) — S og M er skrevet etter regler.` } }
  const j = plukkJson(r.tekst) || {}
  const S = setningKutt(avskjerm(typeof j.S === 'string' ? j.S : typeof j.s === 'string' ? j.s : typeof j.ingress === 'string' ? j.ingress : '', sk.kobling), 300)
  const Mrå = typeof j.M === 'string' ? j.M : typeof j.m === 'string' ? j.m : typeof j.sammendrag === 'string' ? j.sammendrag : ''
  const M = medM ? avskjerm(Mrå, sk.kobling).trim().slice(0, 2500) : ''
  const tokens = { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
  const av = m.test ? 'test' : `${m.label.split(' (')[0]} · ${r.modell || v.modell}`
  let utlevert = false
  if (!m.local && !m.test) {   // bare en ekstern modell er en utlevering
    logDelivery({ tool: 'innlesing', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: sak?.id ? [{ id: sak.id, version: sak.version || 1, level: 'L' }] : [], skjermet: { ...sk.antall }, ord: ord(sendes), tokens, ...(prosjekt ? { context: prosjekt } : {}) })
    utlevert = true
  }
  if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] })
  if (!S) return { ...regel, av: 'regel', modell: r.modell, tokens, utlevert, grunn: `${m.label} ga ingen ingress — S og M er skrevet etter regler.` }
  return { S, M: M || (medM ? regel.M : ''), av, M_av: M ? av : medM ? 'regel' : null, modell: r.modell, tokens, utlevert, skjermet: { ...sk.antall } }
}

// ── 4) spor(): hele løpet, ingen vei utenom ────────────────────────────────
// på(hendelse, data) får: skjermet {mottaker, mottakere, antall, treff, tokens:{ca, per}, ord, tekst (det som sendes), saker, notater} ·
// del {mottaker, tekst} · ferdig {mottaker, svar, prompt, tokens, tekst} — én per mottaker · (flere mottakere:) feil {mottaker, feil} når én svikter
// underveis mens de andre fortsetter · vurderer {steg, mottaker} · forskjeller {enig, uenig, unikt, …} · konklusjon-del {tekst} · konklusjon {id, tekst, …} · slutt.
// Feil kastes: Blokkert (fail closed — med flere mottakere stoppes HELE sendingen når én er blokkert, og linja sier hvilken, V21) eller MotorFeil.
// Prompten lagres FØR sending (V16: den er brukerens investering, også når sendingen feiler) og får `ga` med hvert svar den ga.
const tittelAv = (s) => (String(s || '').split('\n').find((l) => l.trim()) || 'Spørsmål').trim().replace(/^#+\s*/, '').slice(0, 70)
export async function spor({ melding, saker = [], mottaker: mId, mottakere: mIds, prosjekt, samtale, klient = 'app', signal, på = () => {} }) {
  if (!melding || !String(melding).trim()) throw new MotorFeil('melding kreves')
  const alle = lagMottakere()
  const ids = [...new Set([...(Array.isArray(mIds) ? mIds : []), ...(mId ? [mId] : [])].map((x) => String(x || '').trim()).filter(Boolean))]
  if (!ids.length) throw new MotorFeil('mottaker kreves')
  const ms = ids.map((id) => { const m = alle.find((x) => x.id === id); if (!m) throw new MotorFeil(`ukjent mottaker «${id}» — en av ${alle.map((x) => x.id).join(', ')}`); return m })
  for (const m of ms) { const st = await m.status(); if (!st.klar) throw new MotorFeil(`${m.label} er ikke klar: ${st.hvorfor}`) }
  const flere = ms.length > 1

  const atoms = load()
  const { kontekst, kilder, notater } = minimer(atoms, saker, { prosjekt })
  // fail closed for ALLE mottakerne før noe skjermes eller sendes: er én blokkert, sendes ingenting til noen, og linja sier hvilken og hvorfor
  const maks = {}
  for (const m of ms) {
    try { maks[m.id] = sjekkTillatt(m, kilder).maks } catch (e) {
      if (!(e instanceof Blokkert)) throw e
      const b = flere ? new Blokkert(`Stoppet hos ${m.label} — ingenting er sendt til noen av mottakerne. ${e.message}`, e.detaljer) : e
      b.mottaker = m.id; throw b
    }
  }

  const sk = lagSkjermer(kjentePersoner(atoms))
  const meldingS = sk.skjerm(String(melding)), kontekstS = sk.skjerm(kontekst)
  const sendes = `${SYSTEM}\n\n${byggMelding(meldingS, kontekstS)}`
  const tokensCa = Object.fromEntries(ms.map((m) => [m.id, anslåTokens(sendes, m.id)]))
  if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] })                   // lista vokser av bruk
  på('skjermet', { mottaker: ms[0].id, mottakere: ids, antall: { ...sk.antall }, treff: sk.treff, ord: ord(sendes), tokens: { ca: tokensCa[ms[0].id], per: tokensCa }, maks: maks[ms[0].id], maksPer: maks, tekst: sendes,
    saker: kilder.map(({ id, name, version, level, ord: o, tegn }) => ({ id, name, version, level, ord: o, tegn })), notater })

  const proj = prosjekt || atoms.find((x) => x.id === kilder[0]?.id)?.project || 'Uten prosjekt'
  const tittel = tittelAv(melding)
  const til = ms.map((m) => m.label).join(' og ')
  const { atom: promptAtom } = upsert(atoms, { kind: 'prompt', content: String(melding), name: tittel, project: proj, convo: samtale || tittel, tags: ['prompt'], source: 'Tua', by: 'regel',
    short: `Spørsmål stilt i Tua til ${til}${kilder.length ? ` med ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} som kontekst` : ''}.`.slice(0, 300) })
  save(atoms)

  const vaultArv = kilder.some((k) => k.vault)                                 // et svar bygget på en Vault-merket sak arver merket (V15): går aldri over S ut av maskinen
  const nivåer = [...new Set(kilder.map((k) => k.level))].join('/')
  // Samme skjermede og minimerte melding til alle, samtidig. Hvert svar blir egen sak og egen Utlevert-linje idet det kommer.
  async function sendEn(m) {
    let strømmet = ''
    const r = await m.send({ system: SYSTEM, melding: meldingS, kontekst: kontekstS }, { signal, onDel: (t) => { strømmet += t; på('del', { mottaker: m.id, tekst: t }) } })
    const svarTekst = avskjerm(r.tekst || strømmet, sk.kobling)
    const tokens = { ca: tokensCa[m.id], inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
    const { atom: svarAtom } = upsert(atoms, { kind: 'svar', content: svarTekst, name: `Svar fra ${m.label}: ${tittel}`.slice(0, 90), project: proj, convo: samtale || tittel, tags: ['svar', m.id, ...(vaultArv ? ['vault'] : [])], source: m.label, by: 'regel',
      derivedFrom: [{ id: promptAtom.id, version: promptAtom.version || 1, level: 'L' }, ...kilder.map(({ id, version, level }) => ({ id, version, level }))],
      short: `Svar fra ${m.label} (${r.modell}) på «${tittel}»${kilder.length ? `, med ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} på nivå ${nivåer}` : ''}.`.slice(0, 300) })
    promptAtom.ga = [...(promptAtom.ga || []).filter((g) => g.id !== svarAtom.id), { id: svarAtom.id, version: svarAtom.version || 1 }]
    save(atoms)
    logDelivery({ tool: 'spor', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: kilder.map(({ id, version, level }) => ({ id, version, level })),
      skjermet: { ...sk.antall }, ord: ord(sendes), tokens, prompt: promptAtom.id, svar: svarAtom.id, ...(prosjekt ? { context: prosjekt } : {}) })
    const ferdig = { svar: svarAtom.id, prompt: promptAtom.id, mottaker: m.id, label: m.label, modell: r.modell, tokens, tekst: svarTekst }
    på('ferdig', ferdig)
    return ferdig
  }
  const utfall = await Promise.allSettled(ms.map(sendEn))
  const ok = utfall.filter((u) => u.status === 'fulfilled').map((u) => u.value)
  const feilet = utfall.map((u, i) => (u.status === 'rejected' ? { mottaker: ms[i].id, label: ms[i].label, feil: u.reason } : null)).filter(Boolean)
  if (!flere) { if (feilet.length) throw feilet[0].feil; return ok[0] }

  for (const f of feilet) på('feil', { mottaker: f.mottaker, feil: `${f.label}: ${f.feil?.message || f.feil}` })
  if (!ok.length) throw new MotorFeil(`Ingen av mottakerne svarte — ${feilet.map((f) => `${f.label}: ${f.feil?.message || f.feil}`).join(' · ')}`)
  // Forskjeller og konklusjon bare når mer enn én faktisk svarte (V21). Svikter vurdereren, står svarene likevel lagret — det sies med grunn.
  let fsk = null, konk = null
  if (ok.length > 1) {
    const svar = ok.map((s) => ({ id: s.svar, mottaker: s.mottaker, label: s.label, modell: s.modell, tekst: s.tekst }))
    try { fsk = await forskjeller(svar, { melding: String(melding), prosjekt: proj, klient, signal, på }) } catch (e) { fsk = { tilgjengelig: false, grunn: e.message, enig: [], uenig: [], unikt: [] } }
    på('forskjeller', fsk)
    try { konk = await konklusjon({ prompt: promptAtom.id, svar, forskjeller: fsk.tilgjengelig ? fsk : null, melding: String(melding), prosjekt: proj, samtale, klient, signal, på }) } catch (e) { konk = { tilgjengelig: false, grunn: e.message } }
    på('konklusjon', konk)
  }
  const ut = { prompt: promptAtom.id, mottakere: ok.map((s) => s.mottaker), svar: ok.map((s) => s.svar), resultater: ok, feilet: feilet.map((f) => ({ mottaker: f.mottaker, label: f.label, feil: f.feil?.message || String(f.feil) })), forskjeller: fsk, konklusjon: konk }
  på('slutt', { prompt: ut.prompt, svar: ut.svar, mottakere: ut.mottakere, forskjeller: !!fsk?.tilgjengelig, konklusjon: konk?.id || null })
  return ut
}

// ── 5) Forskjeller (M20b, skive 6) ──────────────────────────────────────────
// Tre lister — enig · uenig · unikt — vurdert av vurdereren ut fra svarene. Hvert punkt: tekst + hvilke mottakere (og svar-saker) det gjelder.
// Modellen bes om JSON over bokstavene A, B …; tolkForskjeller() tåler kodeblokker, hengende komma, andre nøkkelnavn, og faller tilbake til
// overskrifter med kulepunkter — og til slutt til «kunne ikke tolkes» med råteksten, aldri en feil. Svarene skjermes på nytt før de sendes
// (de har originalene satt inn igjen), punktene får originalene tilbake lokalt. Én Utlevert-linje (tool: forskjeller) med vurdereren som mottaker.
export async function forskjeller(svar, { melding = '', prosjekt, klient = 'app', signal, på = () => {} } = {}) {
  const tom = { enig: [], uenig: [], unikt: [] }
  if (!Array.isArray(svar) || svar.length < 2) return { tilgjengelig: false, grunn: 'Forskjeller vises bare når mer enn én har svart.', ...tom }
  const v = await vurderer()
  if (!v.m) return { tilgjengelig: false, grunn: v.grunn, ...tom }
  const atoms = load()
  const bokstaver = svar.map((_, i) => bokstav(i))
  const nivå = maksNivå(v.m)
  const kilder = svar.map((s) => svarKilde(atoms, s, nivå))
  try { sjekkTillatt(v.m, kilder) } catch (e) { if (e instanceof Blokkert) return { tilgjengelig: false, grunn: `Vurdering hos ${v.m.label} er stoppet: ${e.message}`, ...tom, vurdert_av: v.m.id }; throw e }
  const sk = lagSkjermer(kjentePersoner(atoms))
  const meldingS = sk.skjerm(String(melding || '')).trim()
  const kontekst = kilder.map((k, i) => `## Svar ${bokstaver[i]} (${svar[i].label || svar[i].mottaker}${svar[i].modell ? `, ${svar[i].modell}` : ''})\n\n${sk.skjerm(k.tekst).trim()}`).join('\n\n')
  const oppgave = `Under står ${svar.length} svar (${bokstaver.join(', ')}) på samme spørsmål${meldingS ? `: «${meldingS}»` : ''}. Sammenlikn dem og svar med ett JSON-objekt på denne formen:\n` +
    '{"enig": [{"punkt": "…", "svar": ["A", "B"]}], "uenig": [{"punkt": "…", "svar": ["A"]}], "unikt": [{"punkt": "…", "svar": ["B"]}]}\n' +
    'enig = det svarene sier likt · uenig = der de motsier hverandre eller vektlegger ulikt (si kort hva hvert svar mener) · unikt = det bare ett svar har med. ' +
    'Hvert punkt er én setning på norsk; «svar» er bokstavene på svarene punktet gjelder. Bruk plassholdere som [Person A] uendret.'
  const sendes = `${SYSTEM}${JSON_KRAV}\n\n${byggMelding(oppgave, kontekst)}`
  const tokensCa = anslåTokens(sendes, v.m.id)
  på('vurderer', { steg: 'forskjeller', mottaker: v.m.id, modell: v.modell, tokens: { ca: tokensCa } })
  const r = await v.m.send({ system: SYSTEM, melding: oppgave, kontekst, json: true, oppgave: 'forskjeller' }, { signal })
  const tolket = tolkForskjeller(r.tekst, svar.map((s, i) => ({ ...s, bokstav: bokstaver[i] })))
  for (const k of ['enig', 'uenig', 'unikt']) tolket[k] = tolket[k].map((p) => ({ ...p, tekst: avskjerm(p.tekst, sk.kobling) }))
  if (tolket.rå) tolket.rå = avskjerm(tolket.rå, sk.kobling)
  const tokens = { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
  logDelivery({ tool: 'forskjeller', client: klient, mottaker: v.m.id, endpoint: v.m.endpoint, modell: r.modell, saker: kilder.filter((k) => k.id).map(({ id, version, level }) => ({ id, version, level })),
    skjermet: { ...sk.antall }, ord: ord(sendes), tokens, ...(prosjekt ? { context: prosjekt } : {}) })
  return { tilgjengelig: true, ...tolket, vurdert_av: v.m.id, modell: r.modell, tokens, nivå, svar: svar.map((s, i) => ({ bokstav: bokstaver[i], id: s.id || null, mottaker: s.mottaker, label: s.label || s.mottaker })) }
}
// Finn ett JSON-objekt i en modelltekst: kodeblokk først, så første «{» til siste «}», med reparasjon av hengende komma og typografiske anførselstegn.
function plukkJson(t) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  for (const k of [fence?.[1], t]) {
    if (!k) continue
    const s = k.indexOf('{'), e = k.lastIndexOf('}')
    if (s < 0 || e <= s) continue
    const sub = k.slice(s, e + 1)
    for (const forsøk of [sub, sub.replace(/,\s*([}\]])/g, '$1'), sub.replace(/[“”«»]/g, '"').replace(/,\s*([}\]])/g, '$1')]) { try { const j = JSON.parse(forsøk); if (j && typeof j === 'object') return j } catch {} }
  }
  return null
}
// svar: [{bokstav, id, mottaker, label, modell}] — det punktene kan peke på. Returnerer alltid {enig, uenig, unikt, tolket} og aldri kaster.
export function tolkForskjeller(tekst, svar = []) {
  const t = String(tekst || '')
  const tom = () => ({ enig: [], uenig: [], unikt: [] })
  const finnSvar = (x) => {
    if (x == null) return null
    if (typeof x === 'number') return svar[x - 1] || svar[x] || null
    const s = String(x).trim().replace(/^svar\s+/i, '')
    const låg = s.toLowerCase()
    return svar.find((v) => v.bokstav && v.bokstav.toLowerCase() === låg) || svar.find((v) => v.mottaker && String(v.mottaker).toLowerCase() === låg) || svar.find((v) => v.id && v.id === s)
      || svar.find((v) => v.label && (v.label.toLowerCase() === låg || v.label.toLowerCase().startsWith(låg) || låg.includes(v.label.toLowerCase().split(' ')[0])))
      || svar.find((v) => v.modell && String(v.modell).toLowerCase() === låg) || null
  }
  const hvemTil = (hvem) => {
    const liste = Array.isArray(hvem) ? hvem : hvem == null ? [] : String(hvem).split(/\s*(?:,|;|\/|&| og | and )\s*/i)
    const funnet = liste.map((h) => [h, finnSvar(h)])
    return { mottakere: [...new Set(funnet.map(([h, s]) => (s ? s.mottaker : String(h).trim())).filter(Boolean))], saker: [...new Set(funnet.map(([, s]) => s?.id).filter(Boolean))] }
  }
  const punkt = (p) => {
    if (p == null) return null
    if (typeof p === 'string' || Array.isArray(p)) { const tekst = (Array.isArray(p) ? p.map(String).join(' ') : p).trim(); return tekst ? { tekst, mottakere: [], saker: [] } : null }
    if (typeof p !== 'object') return null
    const tekst = String(p.punkt ?? p.tekst ?? p.text ?? p.point ?? p.beskrivelse ?? p.innhold ?? p.claim ?? '').trim()
    const hvem = p.svar ?? p.mottakere ?? p.kilder ?? p.hvem ?? p.fra ?? p.sources ?? p.answers ?? p.models ?? p.modeller ?? []
    return tekst ? { tekst, ...hvemTil(hvem) } : null
  }
  const obj = plukkJson(t)
  if (obj) {
    const alts = { enig: ['enig', 'enige', 'agree', 'agreed', 'likt', 'felles', 'samsvar'], uenig: ['uenig', 'uenige', 'disagree', 'disagreement', 'motstrid', 'ulikt', 'forskjell', 'forskjeller'], unikt: ['unikt', 'unike', 'unique', 'bare', 'eget', 'only'] }
    const ut = tom(); let noe = false
    for (const [k, navn] of Object.entries(alts)) {
      const nøkkel = Object.keys(obj).find((n) => navn.includes(n.toLowerCase()))
      if (!nøkkel) continue
      const v = obj[nøkkel]; noe = true
      const liste = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v ? [v] : []
      ut[k] = liste.map(punkt).filter(Boolean)
    }
    if (noe) return { ...ut, tolket: 'json' }
  }
  // Fallback: overskrifter «Enig» / «Uenig» / «Unikt» med kulepunkter; «(A, B)» eller «— svar A» på slutten av linja peker ut svarene.
  const ut = tom(); let nå = null
  for (const l of t.split('\n')) {
    const h = l.match(/^\s*(?:#+\s*|\*\*|["']?)\s*(enig|uenig|unikt)\b/i)
    if (h) { nå = h[1].toLowerCase(); continue }
    const b = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/)
    if (!b || !nå) continue
    const m = b[1].match(/^(.*?)\s*[\(\[—–-]\s*(?:svar\s*)?([A-Z](?:\s*(?:,|\/|&|og)\s*[A-Z])*)\s*[\)\]]?\s*$/i)
    ut[nå].push(m ? { tekst: m[1].trim(), ...hvemTil(m[2].split(/[^A-Za-z]+/).filter(Boolean)) } : { tekst: b[1].trim(), mottakere: [], saker: [] })
  }
  if (ut.enig.length + ut.uenig.length + ut.unikt.length) return { ...ut, tolket: 'tekst' }
  return { ...tom(), tolket: 'ingen', rå: t.slice(0, 2000), merk: 'Vurderingen kunne ikke tolkes som tre lister — teksten vises som den kom.' }
}

// ── 6) Konklusjon (M20b, skive 6, V21) ──────────────────────────────────────
// Vurdereren skriver et utkast ut fra spørsmålet, svarene og forskjellene. Lagres som sak kind: konklusjon, status utkast, med bygget_av →
// prompten og alle svar-sakene, under nøkkelen konklusjon:<prompt-id> — så «kjør igjen» gir ny versjon av samme sak, ikke en ny sak.
// Brukeren retter teksten (rettKonklusjon) og låser med POST /api/status (utkast → endelig). Én Utlevert-linje (tool: konklusjon).
export async function konklusjon({ prompt: promptId, svar, forskjeller: f = null, melding, prosjekt, samtale, klient = 'app', signal, på = () => {} }) {
  const atoms = load()
  const promptAtom = atoms.find((a) => a.id === promptId) || null
  const spørsmål = String(melding || promptAtom?.content || '').trim()
  if (!spørsmål) throw new MotorFeil('konklusjon: fant ikke spørsmålet (prompt-saken)')
  if (!Array.isArray(svar) || !svar.length) throw new MotorFeil('konklusjon: ingen svar å konkludere ut fra')
  const v = await vurderer()
  if (!v.m) return { tilgjengelig: false, grunn: v.grunn }
  const bokstaver = svar.map((_, i) => bokstav(i))
  const nivå = maksNivå(v.m)
  const svarKilder = svar.map((s) => svarKilde(atoms, s, nivå))
  const kilder = [
    ...(promptAtom ? [{ id: promptAtom.id, name: promptAtom.name, version: promptAtom.version || 1, level: nivå, vault: isVault(promptAtom) }] : []),
    ...svarKilder,
  ]
  try { sjekkTillatt(v.m, kilder) } catch (e) { if (e instanceof Blokkert) return { tilgjengelig: false, grunn: `Konklusjon hos ${v.m.label} er stoppet: ${e.message}`, vurdert_av: v.m.id }; throw e }
  const sk = lagSkjermer(kjentePersoner(atoms))
  const liste = (p) => (p || []).map((x) => `- ${sk.skjerm(x.tekst)}${x.mottakere?.length ? ` (${x.mottakere.map((m) => svar.find((s) => s.mottaker === m)?.label || m).join(', ')})` : ''}`).join('\n')
  const kontekst = [`## Spørsmålet\n\n${sk.skjerm(spørsmål)}`,
    ...svarKilder.map((k, i) => `## Svar ${bokstaver[i]} (${svar[i].label || svar[i].mottaker}${svar[i].modell ? `, ${svar[i].modell}` : ''})\n\n${sk.skjerm(k.tekst).trim()}`),
    ...(f && (f.enig?.length || f.uenig?.length || f.unikt?.length) ? [`## Forskjeller\n\nEnig:\n${liste(f.enig) || '- (ingen)'}\n\nUenig:\n${liste(f.uenig) || '- (ingen)'}\n\nUnikt:\n${liste(f.unikt) || '- (ingen)'}`] : [])].join('\n\n')
  const oppgave = 'Skriv et utkast til konklusjon på norsk ut fra svarene under: først det som er sikkert (der svarene er enige), så det som står åpent (der de er uenige, med hvem som mener hva), ' +
    'så det bare ett svar fikk med og som bør sjekkes. Som en notis brukeren kan rette og låse: høyst 200 ord, ingen innledning, ingen overskrifter. Bruk plassholdere som [Person A] uendret.'
  const sendes = `${SYSTEM}\n\n${byggMelding(oppgave, kontekst)}`
  const tokensCa = anslåTokens(sendes, v.m.id)
  på('vurderer', { steg: 'konklusjon', mottaker: v.m.id, modell: v.modell, tokens: { ca: tokensCa } })
  const r = await v.m.send({ system: SYSTEM, melding: oppgave, kontekst, oppgave: 'konklusjon' }, { signal, onDel: (t) => på('konklusjon-del', { tekst: t }) })
  const tekst = avskjerm(r.tekst, sk.kobling).trim()
  const tokens = { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
  const proj = prosjekt || promptAtom?.project || 'Uten prosjekt'
  const tittel = tittelAv(spørsmål)
  const { atom } = upsert(atoms, { key: `konklusjon:${promptId || tittel}`, kind: 'konklusjon', content: tekst, name: `Konklusjon: ${tittel}`.slice(0, 90), project: proj, convo: samtale || promptAtom?.convo || tittel, tags: ['konklusjon', ...(kilder.some((k) => k.vault) ? ['vault'] : [])], source: v.m.label, by: 'regel',
    derivedFrom: kilder.filter((k) => k.id).map(({ id, version, level }) => ({ id, version, level })),
    short: `Utkast til konklusjon fra ${v.m.label} (${r.modell}) på «${tittel}», ut fra ${svar.length} svar (${svar.map((s) => s.label || s.mottaker).join(', ')}). Rettes og låses av brukeren.`.slice(0, 300) })
  setStatus(atom, 'utkast')
  save(atoms)
  logDelivery({ tool: 'konklusjon', client: klient, mottaker: v.m.id, endpoint: v.m.endpoint, modell: r.modell, saker: kilder.filter((k) => k.id).map(({ id, version, level }) => ({ id, version, level })),
    skjermet: { ...sk.antall }, ord: ord(sendes), tokens, prompt: promptId || null, konklusjon: atom.id, ...(prosjekt ? { context: prosjekt } : {}) })
  return { tilgjengelig: true, id: atom.id, tekst, status: 'utkast', version: atom.version || 1, mottaker: v.m.id, modell: r.modell, tokens, nivå, prompt: promptId || null, svar: svar.map((s) => s.id).filter(Boolean) }
}
// Brukerens rettelse av utkastet: ny versjon av samme konklusjon-sak (forrige bevares i .tua/versions), ingen modell, ingenting sendes. Status urørt — låsing er /api/status.
export function rettKonklusjon({ id, tekst }) {
  if (!id || !String(tekst || '').trim()) throw new MotorFeil('id og tekst kreves')
  const atoms = load()
  const a = atoms.find((x) => x.id === id)
  if (!a) throw new MotorFeil(`fant ikke sak ${id}`)
  if (a.kind !== 'konklusjon') throw new MotorFeil(`«${a.name}» er ikke en konklusjon`)
  if (!a.key) a.key = `konklusjon:${a.derivedFrom?.[0]?.id || a.id}`
  const { atom, status } = upsert(atoms, { key: a.key, kind: 'konklusjon', content: String(tekst), name: a.name, project: a.project, convo: a.convo, tags: a.tags, source: a.source, derivedFrom: a.derivedFrom })
  if (status !== 'uendret') save(atoms)
  return { id: atom.id, tekst: atom.content, status: statusOf(atom), version: atom.version || 1, endret: status }
}
// Svar-sakene en prompt ga, slik «kjør igjen» trenger dem (POST /api/konklusjon uten tekst): id, mottaker (fra taggen), label (kilden), teksten.
export function svarFor(atoms, promptId, ids = null) {
  const p = atoms.find((a) => a.id === promptId)
  const ønsket = Array.isArray(ids) && ids.length ? ids : (p?.ga || []).map((g) => g.id)
  const kjente = new Set(lagMottakere().map((m) => m.id))
  return ønsket.map((id) => atoms.find((a) => a.id === id)).filter((a) => a && a.kind === 'svar')
    .map((a) => ({ id: a.id, version: a.version || 1, mottaker: (a.tags || []).find((t) => kjente.has(t)) || a.source, label: a.source, modell: null, tekst: a.content }))
}
