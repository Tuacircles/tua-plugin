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
//   standardNivå(m, sak)     friksjon 15: nivået en sak får som kilde når ingen har valgt — det høyeste mottakeren får (L lokal, M ekstern, S Vault).
//   forhåndsvis(…)           friksjon 15: det samme som spor() ser FØR noe sendes (minimer → fail closed → skjerm → tokens) — ingenting sendes eller logges.
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
import { load, save, upsert, levelOf, clampLevel, maxLevel, isVault, logDelivery, setStatus, statusOf, LEVELS, LONG_L, FILES_ROOT, filesMode, DATA_DIR, hashOf, markDirty, readConfig } from './store.js'
import { samtaleForSpor, samtaleFor, finnSamtale, vendingerFor, standardVendinger, oppdaterSamtale, pekPåSamtale, erTuaSamtale, erSyntetiskId } from './samtale.js'   // skive 1 (arb. 33, V22): samtalen som sak, vendingene i hvert kall
import { readKey, hasKey, ollamaStatus } from './keychain.js'
import { SJEKKER, sjekkAv, instruksFor, tolkInnvendinger, STATUSER, utfordringerFor, infoAv, samtaleDokumenter, resultatVending, kortKontroll } from './utfordring.js'   // skive C (arb. 34): Utfordre — de rene reglene
import { OLLAMA_URL, OLLAMA_VERT } from './ollama.js'   // friksjon 12: adressen og standardmodellen (ollamaStatus().modell) bor der
import { løsMottakere, registrerDeling, skrivMottakere, lagreDeling, hentDeling, delingerFor, trekkTilbake, noterForespørsel, lenkerFor, nyttToken, eier, mottakerside, trukketSide, BASE } from './deling.js'   // runde 3b: personer, sirkler som emerger, delinger med token, mottakersiden

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
// Mistral: 3,0 er et anslag (ikke målt ennå — rettes etter første ekte sending; eksakt usage kommer tilbake i Utlevert).
export const TEGN_PER_TOKEN = { claude: 1.9, ollama: 3.5, mistral: 3.0, test: 3.5, test2: 3.5 }
export const anslåTokens = (t, mottaker) => Math.round(String(t || '').length / (TEGN_PER_TOKEN[mottaker] || 3.5))
// Skive 1 (arb. 33, V22): BUDSJETT per mottaker i tokens — hvor mye av en samtale (vendinger + kilder + spørsmålet) som får plass i ett kall. Claude og Mistral
// har store vinduer (200k/128k; vi holder igjen plass til svaret). Ollama: modellens kontekstvindu slik Ollama kjører den — standard num_ctx er 4096 uansett
// modell (gemma3:4b får ikke mer før det er satt opp), så 3 000 til det som sendes; rettes i ~/.tua/config.json → ollama.kontekst (eller TUA_OLLAMA_KONTEKST).
// Test-mottakerne har et lite budsjett med vilje, så kuttet bakfra kan prøves uten modell. standardVendinger (samtale.js) kutter bakfra og sier hva som falt utenfor.
export const BUDSJETT = { claude: 150_000, mistral: 100_000, openai: 150_000, test: 1_500, test2: 1_500, testlokal: 1_500 }
export const budsjettOllama = () => { const k = Number(process.env.TUA_OLLAMA_KONTEKST) || Number(readConfig().ollama?.kontekst) || 4096; return Math.max(500, Math.round(k * 0.75)) }
export const budsjettFor = (id) => (id === 'ollama' ? budsjettOllama() : BUDSJETT[id] || null)

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
// Skive 1 (arb. 33, V22): `messages` som EKTE samtale. Vendingene (alt skjermet) vekselvis user/assistant — to like roller etter hverandre slås sammen —
// kildene (minimer) i den FØRSTE brukermeldingen slik byggMelding gjør, den nye meldingen sist. Begynner lista med et modellsvar, settes en kort
// brukermelding først (Claude krever at første melding er fra brukeren), og kildene havner der. Uten vendinger: nøyaktig én melding, som før.
export function byggMeldinger({ vendinger = [], melding = '', kontekst = '' } = {}) {
  const ut = []
  const legg = (role, tekst) => { const c = String(tekst || '').trim(); if (!c) return; const sist = ut.at(-1); if (sist && sist.role === role) sist.content += `\n\n${c}`; else ut.push({ role, content: c }) }
  for (const v of vendinger) legg(v.rolle === 'bruker' ? 'user' : 'assistant', v.tekst)
  legg('user', melding)
  if (!ut.length) ut.push({ role: 'user', content: '' })
  if (ut[0].role !== 'user') ut.unshift({ role: 'user', content: kontekst ? `(Fortsettelse av en samtale — tidligere svar følger.)\n\n---\n\nKontekst\n\n${kontekst}` : '(Fortsettelse av en samtale — tidligere svar følger.)' })
  else if (kontekst) ut[0].content = byggMelding(ut[0].content, kontekst)
  return ut
}
// Teksten slik den sendes, til tokens, ord, «se hva som sendes» og test-ekkoet: én melding = selve innholdet (som før); flere = merket per rolle.
export const tekstAv = (messages) => (messages.length === 1 ? messages[0].content : messages.map((m) => `[${m.role === 'user' ? 'Du' : 'Modellen'}]\n${m.content}`).join('\n\n'))
const meldingerAv = ({ messages, melding, kontekst }) => (Array.isArray(messages) && messages.length ? messages : [{ role: 'user', content: byggMelding(melding || '', kontekst || '') }])
// Skive 6: send() tar også `json` (svaret skal være ett JSON-objekt — Ollama får format: json, Claude får det i system-teksten) og `oppgave`
// ('forskjeller' | 'konklusjon' — bare test-mottakeren bryr seg: den svarer med et fast, tolkbart svar så testene aldri trenger en modell).
const JSON_KRAV = ' Svar BARE med ett gyldig JSON-objekt — ingen tekst før eller etter, ingen kodeblokk.'

export const CLAUDE_MODELL = 'claude-opus-5-5'
// Claude via egen nøkkel (D2'). Nøkkelen leses fra Keychain i selve kallet og lever bare i klient-objektet til kallet er ferdig.
// Strømmer tekstbiter til onDel; adaptiv tenkning; server-side fallback «default» slik at et avslag fra sikkerhetsklassifisering
// kjøres på nytt på modellen Anthropic anbefaler (beta server-side-fallback-2026-07-01). Avslag etter fallback → MotorFeil.
async function sendClaude({ system, melding, kontekst, json, messages }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('claude')
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for Claude i Keychain. Legg den inn under Innstillinger › AI-mottakere (console.anthropic.com › API keys).')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: nøkkel })
  nøkkel = null
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODELL, max_tokens: 64000, thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system: json ? system + JSON_KRAV : system, messages: meldingerAv({ messages, melding, kontekst }),   // skive 1 (arb. 33): hele samtalen, ikke én melding
  }, { signal })
  for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onDel(ev.delta.text)
  const fm = await stream.finalMessage()
  if (fm.stop_reason === 'refusal') throw new MotorFeil(`Claude avslo forespørselen${fm.stop_details?.explanation ? `: ${fm.stop_details.explanation}` : ''}. Ingenting er lagret som svar.`)
  const tekst = fm.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return { tekst, modell: fm.model, usage: { input_tokens: fm.usage?.input_tokens ?? null, output_tokens: fm.usage?.output_tokens ?? null }, stopp: fm.stop_reason }
}

// Ollama lokalt (V18: lokal modell først når den finnes). Modell (friksjon 12): den som er valgt som standard i Innstillinger › AI-mottakere › Modeller
// (~/.tua/config.json → ollama.modell), TUA_OLLAMA_MODELL foran (bare tester), ellers den første i lista — ollama.js: standardModell(). NDJSON-strøm fra /api/chat.
async function sendOllama({ system, melding, kontekst, json, messages }, { onDel = () => {}, signal } = {}) {
  const st = await ollamaStatus()
  if (!st.running || !st.models.length) throw new MotorFeil(`Ollama kjører ikke på ${OLLAMA_VERT}, eller har ingen modell (hent én under Innstillinger › AI-mottakere › Modeller).`)
  const model = st.modell || st.models[0]
  const body = { model, stream: true, messages: [{ role: 'system', content: json ? system + JSON_KRAV : system }, ...meldingerAv({ messages, melding, kontekst })], ...(json ? { format: 'json' } : {}) }
  const r = await fetch(OLLAMA_URL + '/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

// Mistral (skive 6-tillegg, arbeidsstykke 30: «første skymodell å prøve for europeiske forretningsdata» — api.mistral.ai, EU). Egen nøkkel fra
// Keychain (tua-ai-mistral), lest i kallet og glemt etterpå. Chat completions strømmet som SSE («data: {…}», «data: [DONE]»); siste bit har
// usage. json → response_format json_object + JSON_KRAV i systemet. Modell: TUA_MISTRAL_MODELL eller mistral-large-latest. Aldri kalt i tester
// (nøkkelen finnes ikke under testprefikset).
export const MISTRAL_MODELL = process.env.TUA_MISTRAL_MODELL || 'mistral-large-latest'
async function sendMistral({ system, melding, kontekst, json, messages }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('mistral')
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for Mistral i Keychain. Legg den inn under Innstillinger › AI-mottakere (console.mistral.ai › API keys).')
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${nøkkel}` },
    body: JSON.stringify({ model: MISTRAL_MODELL, stream: true, ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: json ? system + JSON_KRAV : system }, ...meldingerAv({ messages, melding, kontekst })] }),
  })
  nøkkel = null
  if (!r.ok || !r.body) { const t = await r.text().catch(() => ''); throw new MotorFeil(`Mistral svarte ${r.status}${t ? `: ${t.slice(0, 200)}` : ''}`) }
  let tekst = '', rest = '', modell = MISTRAL_MODELL, stopp = 'end_turn', usage = { input_tokens: null, output_tokens: null }
  const dec = new TextDecoder()
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true })
    const linjer = rest.split('\n'); rest = linjer.pop()
    for (const l of linjer) {
      const d = l.startsWith('data:') ? l.slice(5).trim() : ''
      if (!d || d === '[DONE]') continue
      let j; try { j = JSON.parse(d) } catch { continue }
      const bit = j.choices?.[0]?.delta?.content
      if (typeof bit === 'string' && bit) { tekst += bit; onDel(bit) }
      if (j.choices?.[0]?.finish_reason) stopp = j.choices[0].finish_reason
      if (j.model) modell = j.model
      if (j.usage) usage = { input_tokens: j.usage.prompt_tokens ?? null, output_tokens: j.usage.completion_tokens ?? null }
    }
  }
  return { tekst, modell, usage, stopp }
}

// OpenAI (28.10.2026, etter arbeidsstykke 33: Erik la inn nøkkelen i Innstillinger, men motoren hadde ingen mottaker — nøkkelen ga ingen rad). Samme form som
// Mistral: egen nøkkel fra Keychain (tua-ai-openai), lest i kallet og glemt etterpå; chat completions strømmet som SSE, usage i siste bit
// (stream_options.include_usage); json → response_format json_object + JSON_KRAV. Modell: TUA_OPENAI_MODELL eller gpt-5.5 (nyeste daterte
// utgave nøkkelen ga 28.10.2026; «gpt-6-…»-navnene var kodenavn uten dato). Aldri kalt i tester (nøkkelen finnes ikke under testprefikset).
export const OPENAI_MODELL = process.env.TUA_OPENAI_MODELL || 'gpt-5.5'
async function sendOpenAI({ system, melding, kontekst, json, messages }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('openai')
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for OpenAI i Keychain. Legg den inn under Innstillinger › AI-mottakere (platform.openai.com › API keys).')
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${nøkkel}` },
    body: JSON.stringify({ model: OPENAI_MODELL, stream: true, stream_options: { include_usage: true }, ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: json ? system + JSON_KRAV : system }, ...meldingerAv({ messages, melding, kontekst })] }),
  })
  nøkkel = null
  if (!r.ok || !r.body) { const t = await r.text().catch(() => ''); throw new MotorFeil(`OpenAI svarte ${r.status}${t ? `: ${t.slice(0, 200)}` : ''}`) }
  let tekst = '', rest = '', modell = OPENAI_MODELL, stopp = 'end_turn', usage = { input_tokens: null, output_tokens: null }
  const dec = new TextDecoder()
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true })
    const linjer = rest.split('\n'); rest = linjer.pop()
    for (const l of linjer) {
      const d = l.startsWith('data:') ? l.slice(5).trim() : ''
      if (!d || d === '[DONE]') continue
      let j; try { j = JSON.parse(d) } catch { continue }
      const bit = j.choices?.[0]?.delta?.content
      if (typeof bit === 'string' && bit) { tekst += bit; onDel(bit) }
      if (j.choices?.[0]?.finish_reason) stopp = j.choices[0].finish_reason
      if (j.model) modell = j.model
      if (j.usage) usage = { input_tokens: j.usage.prompt_tokens ?? null, output_tokens: j.usage.completion_tokens ?? null }
    }
  }
  return { tekst, modell, usage, stopp }
}

// Test-mottakerne: ekkoer det som ville blitt sendt, i biter, uten å sende noe ut av maskinen. Trust 3 → S og M går, L blokkeres (fail closed kan prøves).
// Som vurderer (TUA_VURDERER=test) svarer «test» med faste, tolkbare forskjeller (JSON over bokstavene A, B … i konteksten) og en fast konklusjon.
// «test2» (bare med TUA_TESTMOTTAKERE=2, til testene) ekkoer ANNERLEDES enn «test» — overskriftene i konteksten og et tilleggspunkt — så to
// svar på samme spørsmål faktisk er forskjellige og Forskjeller har noe å finne.
// Friksjonsrunde 1: strømmen stopper når signal avbrytes (som en ekte mottaker) — så «Stopp» kan testes uten modell.
const avbruttFeil = () => { const e = new Error('avbrutt'); e.name = 'AbortError'; return e }
const strøm = async (ut, onDel, signal) => { for (const b of ut.match(/[\s\S]{1,120}/g) || []) { if (signal?.aborted) throw avbruttFeil(); await new Promise((r) => setTimeout(r, 2)); onDel(b) } }
const testSvar = (ut, inn, id) => ({ tekst: ut, modell: 'ekko', usage: { input_tokens: anslåTokens(inn, id), output_tokens: anslåTokens(ut, id) }, stopp: 'end_turn' })
async function sendTest({ system, melding, kontekst, oppgave, messages }, { onDel = () => {}, signal } = {}) {
  const inn = system + (messages?.length ? tekstAv(messages) : melding + kontekst)
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
  if (oppgave === 'utfordre') {   // skive C: faste, tolkbare innvendinger — tre stykker på formen instruksen ber om
    const ut = '1. Påstanden i første avsnitt er ikke begrunnet.\n   Hvor: første avsnitt\n   Begrunnelse: Svaret sier det som sikkert, men viser ikke til noe i kildene (test-mottakeren, ingenting sendt ut av maskinen).\n\n' +
      '2. Et tall er ikke sjekket mot kilden.\n   Hvor: midt i svaret\n   Begrunnelse: Tallet bør stå i kilden det er hentet fra.\n\n3. Motpartens syn er ikke nevnt.\n   Hvor: konklusjonen\n   Begrunnelse: Uten den andre siden virker svaret ensidig.'
    await strøm(ut, onDel, signal); return testSvar(ut, inn, 'test')
  }
  if (oppgave === 'ny-versjon') {
    const ut = `Ny versjon fra test-mottakeren (ingenting er sendt ut av maskinen), med ${(String(kontekst).match(/^- /gm) || []).length} godtatte innvendinger tatt inn.\n\n${String(kontekst).split('## Svaret')[1]?.split('## ')[0]?.trim().slice(0, 400) || ''}`
    await strøm(ut, onDel, signal); return testSvar(ut, inn, 'test')
  }
  const ut = `Ekko fra test-mottakeren (ingenting er sendt ut av maskinen).\n\nSystem: ${system}\n\n${tekstAv(meldingerAv({ messages, melding, kontekst }))}`   // skive 1: med vendinger ekkoes hele lista, merket per rolle
  await strøm(ut, onDel, signal); return testSvar(ut, inn, 'test')
}
async function sendTest2({ melding, kontekst }, { onDel = () => {}, signal } = {}) {
  const overskrifter = [...String(kontekst).matchAll(/^## (.+)$/gm)].map((m) => m[1])
  const ut = `EKKO B (test-mottaker 2 — ingenting er sendt ut av maskinen).\n\nSpørsmålet var: ${melding.trim()}\n\nKildene jeg fikk: ${overskrifter.length ? overskrifter.join(' · ') : 'ingen'}.\n\nTilleggspunkt bare fra B: dette svaret ser saken fra en annen vinkel enn test-mottaker 1.`
  await strøm(ut, onDel, signal); return testSvar(ut, melding + kontekst, 'test2')
}

const TEST_TRUST = (label, kilde) => ({ score: 3, label, endpoint: 'lokalt', region: 'lokalt', metadata: 'Ingen — ingenting sendes.', innhold: 'Forlater aldri maskinen; viser bare det som ville blitt sendt.', mining: 'Ingen.', retensjon: 'Bare Tuas egen Utlevert-linje (metadata).', svakest: null, kilde, dato: '2026-10-23' })
// Mottaker-grensesnittet. status() svarer klar/ikke klar med grunn — aldri nøkkelverdier. send() nås bare gjennom spor(), forskjeller() og konklusjon().
function lagMottakere() {
  const ts = trustScores().ai || {}
  const liste = [
    { id: 'claude', label: 'Claude (Anthropic)', endpoint: 'api.anthropic.com', modell: CLAUDE_MODELL, trust: ts.claude || null, nøkkel: true,
      status: async () => (hasKey('claude') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendClaude },
    { id: 'ollama', label: 'Ollama (lokal)', endpoint: OLLAMA_VERT, modell: process.env.TUA_OLLAMA_MODELL || null, trust: ts.ollama || null, local: true,
      // friksjon 12: modell = standardmodellen (valgt i Innstillinger, ellers første), modeller = alle lokale
      status: async () => { const s = await ollamaStatus(); return s.running && s.models.length ? { klar: true, modeller: s.models, modell: s.modell } : { klar: false, hvorfor: s.running ? 'Ollama kjører, men har ingen modell — hent én under Innstillinger › AI-mottakere › Modeller' : 'Ollama kjører ikke' } }, send: sendOllama },
    // Mistral (skive 6-tillegg): første ekstra skymodell. Raden blir av seg selv en rad i Innstillinger › AI-mottakere og en avkryssing i Spør.
    { id: 'mistral', label: 'Mistral', endpoint: 'api.mistral.ai', modell: MISTRAL_MODELL, trust: ts.mistral || null, nøkkel: true,
      status: async () => (hasKey('mistral') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendMistral },
    // OpenAI (28.10.2026): ChatGPT som mottaker gjennom samme motor — raden blir av seg selv en rad i Innstillinger › AI-mottakere og en avkryssing i Spør/Arbeid.
    { id: 'openai', label: 'OpenAI (GPT)', endpoint: 'api.openai.com', modell: OPENAI_MODELL, trust: ts.openai || null, nøkkel: true,
      status: async () => (hasKey('openai') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendOpenAI },
    { id: 'test', label: 'Test (ekko — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: TEST_TRUST('Test', 'Tua selv: ekko-mottakeren i motor.js. Score 3 er satt lavt med vilje så fail closed kan prøves (L blokkeres).'), test: true,
      status: async () => ({ klar: true }), send: sendTest },
  ]
  const tm = String(process.env.TUA_TESTMOTTAKERE || '')
  if (tm === '2' || tm === '3') liste.push({ id: 'test2', label: 'Test 2 (ekko B — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: TEST_TRUST('Test 2', 'Tua selv: andre ekko-mottaker i motor.js (TUA_TESTMOTTAKERE=2) — svarer annerledes enn Test så Forskjeller kan testes uten modell.'), test: true, status: async () => ({ klar: true }), send: sendTest2 })
  // friksjon 15 (TUA_TESTMOTTAKERE=3): en LOKAL ekko-mottaker med Trust 5 — så testene kan vise at standardnivået blir L og at L faktisk sendes, uten Ollama.
  if (tm === '3') liste.push({ id: 'testlokal', label: 'Test lokal (ekko — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: { ...TEST_TRUST('Test lokal', 'Tua selv: lokal ekko-mottaker i motor.js (TUA_TESTMOTTAKERE=3) — Trust 5 som Ollama, så standardnivå L kan testes uten modell.'), score: 5 }, local: true, test: true, status: async () => ({ klar: true }), send: sendTest })
  for (const m of liste) m.budsjett = budsjettFor(m.id)   // skive 1 (arb. 33): budsjettet i tokens per mottaker — standardVendinger kutter bakfra mot det
  return liste
}
// Skive 1: standardvalget av vendinger for én mottaker, med mottakerens tokens-anslag og budsjett (regelen bor i samtale.js, tallene her).
export function standardFor(vendinger, mottakerId, { reservert = 0 } = {}) {
  const m = lagMottakere().find((x) => x.id === mottakerId) || { id: mottakerId, budsjett: budsjettFor(mottakerId) }
  return standardVendinger(vendinger, m, { anslå: (t) => anslåTokens(t, m.id), reservert })
}
// Lista til appen (GET /api/mottakere): uten send(), med status. Nøkkel: satt/ikke satt — aldri verdien.
// standard (V18): lokal modell først når den finnes, ellers Claude når nøkkelen finnes, ellers ingen (test er aldri standard).
// Skive 4 (arb. 33, 28.10.2026): standardmottakeren ved oppstart. Rett etter at broen starter kan Ollama.app ennå ikke svare (tjeneren er ikke oppe, eller modellen
// lastes) — da sto Claude som standard et øyeblikk (skive 2 «Å vite» (3)). Nå er Ollama-statusen USIKKER til den har svart ja én gang, eller til prosessen har levd
// TUA_OLLAMA_VENT ms (standard 20 s): så lenge den er usikker, får Ollama-raden `usikker: true`, ingen er standard, og appen viser «…» i modellbrikken og spør igjen.
// Svarer Ollama ja, er den avgjort for resten av prosessens liv (en Ollama som stopper midt i dagen er bare «ikke klar», som før).
const PROSESS_START = Date.now()
let ollamaHarSvart = false
export const OLLAMA_VENT_MS = () => (process.env.TUA_OLLAMA_VENT != null ? Math.max(0, Number(process.env.TUA_OLLAMA_VENT) || 0) : 20_000)
export const ollamaAvgjort = (nå = Date.now()) => ollamaHarSvart || nå - PROSESS_START >= OLLAMA_VENT_MS()
export async function mottakere() {
  const liste = await Promise.all(lagMottakere().map(async (m) => {
    const st = await m.status()
    if (m.id === 'ollama' && st.klar) ollamaHarSvart = true
    const usikker = m.id === 'ollama' && !st.klar && !ollamaAvgjort()
    return { id: m.id, label: m.label, endpoint: m.endpoint, modell: st.modell || st.modeller?.[0] || m.modell, trust: m.trust, local: !!m.local, test: !!m.test,
      nivå: standardNivå(m), nivåVault: standardNivå(m, { vault: true }),   // friksjon 15: standardnivået en sak får som kilde til denne mottakeren (vanlig sak / Vault-merket)
      tegnPerToken: TEGN_PER_TOKEN[m.id] || 3.5,                 // Spør-skjermens anslag før sending bruker samme faktor som motoren (skive 2)
      budsjett: m.budsjett || null,                               // skive 1 (arb. 33): tokens som får plass i ett kall — Sendes-linja og standardvalget av vendinger
      ...(m.nøkkel ? { nøkkel: hasKey(m.id) ? 'satt' : 'ikke satt' } : {}), aktiv: st.klar, ...(st.hvorfor ? { hvorfor: st.hvorfor } : {}), ...(usikker ? { usikker: true } : {}) }
  }))
  const usikker = liste.some((m) => m.usikker)
  const std = usikker ? null : liste.find((m) => m.local && m.aktiv) || liste.find((m) => m.id === 'claude' && m.aktiv)
  const ut = liste.map((m) => ({ ...m, standard: !!std && m.id === std.id }))
  ut.usikker = usikker   // GET /api/mottakere sender flagget videre øverst i svaret
  return ut
}
export const standardMottaker = async () => (await mottakere()).find((m) => m.standard)?.id || null

// Vurdereren (skive 6, V21): Forskjeller og konklusjonen skrives av standardmodellen lokalt — Ollama når den kjører, ellers Claude med nøkkel,
// ellers ikke tilgjengelig med grunn. TUA_VURDERER overstyrer (testene setter «test»). Går gjennom de samme trinnene som spor():
// sjekkTillatt (svar-sakene på L — arver et svar Vault-merket, stoppes en ekstern vurderer) → skjerm → send → Utlevert-linje med mottaker.
// Nivået en vurderer får lese svar-sakene på: det høyeste Trust Score tillater (L for lokal og Claude, M for test). Vault-arv stoppes
// fortsatt hos en ekstern vurderer i sjekkTillatt — det klampes ikke ned til S i det stille (forskjeller av ingresser ville være verdiløse).
export const maksNivå = (m) => { const score = Number(m?.trust?.score) || 1; return LEVELS.filter((l) => NIVÅ_KREVER_TRUST[l] <= score).at(-1) || 'S' }

// ── Friksjon 15 (24.10.2026): standardnivået en sak får som kilde når man spør ──────────────────────────────────────────
// Før gikk saken alltid på S inne i saken (bare ingressen), så en lokal modell svarte uten å ha sett saken. Regelen bor her, ikke i appen:
//   det høyeste mottakeren får — L til en lokal modell (Trust 5: ingenting forlater maskinen), M til en ekstern med Trust ≥ 3 (V15: S+M som
//   standard, L bare på forespørsel), S til lavere Trust — og S for Vault-merkede saker uansett mottaker (brukeren kan heve til L for en lokal
//   modell; sjekkTillatt tillater det). Klampes til sak.max (V11) når det er gitt. Brukeren kan alltid velge noe annet før sending; fail closed står.
//   Flere mottakere: nivået per mottaker, og det LAVESTE felles er det som sendes til alle — Forskjeller sammenlikner svar bygget på samme tekst.
export const NIVÅ_STANDARD_EKSTERN = 'M'
export function standardNivå(mottaker, sak = null) {
  const vault = sak ? (typeof sak.vault === 'boolean' ? sak.vault : isVault(sak)) : false
  let n = vault ? 'S' : mottaker?.local ? 'L' : clampLevel(NIVÅ_STANDARD_EKSTERN, maksNivå(mottaker))
  if (sak?.max && LEVELS.includes(sak.max)) n = clampLevel(n, sak.max)
  return n
}
export const lavesteNivå = (nivåer = []) => { const l = nivåer.filter((n) => LEVELS.includes(n)); return l.length ? l.sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b))[0] : 'S' }
export function standardNivåer(mottakere = [], sak = null) {
  const per = Object.fromEntries((mottakere || []).filter(Boolean).map((m) => [m.id, standardNivå(m, sak)]))
  return { per, felles: lavesteNivå(Object.values(per)) }
}
const svarKilde = (atoms, s, nivå) => { const a = s.id ? atoms.find((x) => x.id === s.id) : null; const tekst = a ? levelOf(a, nivå).text : String(s.tekst || ''); return { id: s.id || null, name: a?.name || `Svar fra ${s.label || s.mottaker}`, version: a?.version || s.version || 1, level: nivå, vault: a ? isVault(a) : false, tekst } }
export async function vurderer() {
  const alle = lagMottakere()
  const ønsket = process.env.TUA_VURDERER
  const rekke = ønsket ? alle.filter((m) => m.id === ønsket) : [alle.find((m) => m.id === 'ollama'), alle.find((m) => m.id === 'claude'), alle.find((m) => m.id === 'mistral')]   // lokal først (V18), så egne nøkler
  const grunner = []
  for (const m of rekke.filter(Boolean)) { const st = await m.status(); if (st.klar) return { m, modell: st.modell || st.modeller?.[0] || m.modell }; grunner.push(`${m.label}: ${st.hvorfor}`) }
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
  for (const m of rekke.filter(Boolean)) { const st = await m.status(); if (st.klar) return { m, modell: st.modell || st.modeller?.[0] || m.modell }; grunner.push(`${m.label}: ${st.hvorfor}`) }
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
// M19 (skive 8): prompt-saken har nøkkel prompt:spor:<sha8(tekst)> i prosjektet — samme spørsmål igjen gir SAMME sak og `ga` vokser (samlingen
// vokser av bruk). «Kjør igjen» fra sak-panelet sender `prompt` (id på en prompt-sak): den brukes som den er; er teksten endret, blir det ny
// versjon av samme sak (versjon bare når teksten endres), og svaret kobles til den.
const tittelAv = (s) => (String(s || '').split('\n').find((l) => l.trim()) || 'Spørsmål').trim().replace(/^#+\s*/, '').slice(0, 70)
const førsteSetning = (t, maks = 300) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); if (s.length <= maks) return s; const m = s.slice(0, maks).match(/^[\s\S]*?[.!?](?=\s|$)/); return m && m[0].length >= 20 ? m[0] : s.slice(0, maks - 1).trimEnd() + '…' }
// Friksjon 15: «før du sender, ser du hva som sendes». Samme trinn som spor() fram til sendingen — minimer → sjekkTillatt per mottaker → skjerm → tokens —
// men ingenting sendes, lagres eller logges, og kjent-personer-lista lærer ingenting. Svaret har samme form som hendelsen `skjermet` i spor(), pluss
// `blokkert` {feil, detaljer, mottaker} når fail closed ville stoppet sendingen (da er `tekst` likevel med, så linja kan vise hva som ville gått).
// Skive 1 (arb. 33, V22): vendingene som skal med — [{id, rolle: 'bruker'|'modell'}] i rekkefølge (id = prompt-/svar-saken; for importerte samtaler prompt-/capture-sakene).
// Rollen leses av saken når den ikke er oppgitt. Vendingene minimeres IKKE (de er brukerens egne ord og modellens svar på dem) og går hele; en ukjent id stopper.
// Vault: et svar bygget på en Vault-merket sak arver merket (V15) — det går aldri til en ekstern mottaker som vending (sjekkes i vendingerTillatt).
// Skive 3 (arb. 33): en vending kan også være SYNTETISK (id v_<samtale8>_<n>) — en vending lest ut av en importert samtales transkript som ikke har egen sak.
// Da hentes teksten fra transkriptet via samtalen (samtale.vendingAv), så `samtale` må være med i kallet. Bare det nye lagres (prompt- og svar-sak som peker på samtalen).
export function løsVendinger(atoms, vendinger = [], samtaleAtom = null) {
  let transkript = null   // vendingene fra samtalen, regnet én gang
  return (Array.isArray(vendinger) ? vendinger : []).map((v) => {
    const id = typeof v === 'string' ? v : v?.id
    if (erSyntetiskId(id)) {
      if (!samtaleAtom) throw new MotorFeil(`vendingen ${id} er lest ut av et transkript — send samtalen (samtale) med i kallet`)
      transkript = transkript || vendingerFor(atoms, samtaleAtom)
      const t = transkript.find((x) => x.id === id)
      if (!t) throw new MotorFeil(`fant ikke vendingen ${id} i samtalen «${samtaleAtom.name}»`)
      return { id: t.id, rolle: t.rolle === 'bruker' ? 'bruker' : 'modell', tekst: t.L || '', name: `${t.rolle === 'bruker' ? 'Du' : t.modell || 'modellen'}: ${String(t.S || t.L || '').slice(0, 60)}`, version: t.versjon || 1, vault: !!t.vault, kind: 'vending', syntetisk: true }
    }
    const a = atoms.find((x) => x.id === id)
    if (!a) throw new MotorFeil(`fant ikke vendingen ${id} i arkivet`)
    const rolle = v?.rolle === 'bruker' || v?.rolle === 'modell' ? v.rolle : a.kind === 'prompt' ? 'bruker' : 'modell'
    return { id: a.id, rolle, tekst: a.content || '', name: a.name, version: a.version || 1, vault: isVault(a), kind: a.kind || 'capture' }
  })
}
function vendingerTillatt(mottaker, vend) {
  const v = vend.filter((x) => x.vault)
  if (v.length && !mottaker.local) throw new Blokkert(`Sendingen er stoppet: ${v.length === 1 ? 'vendingen' : `${v.length} vendinger`} ${v.map((x) => `«${x.name}»`).join(', ')} bygger på Vault-merket innhold og kan ikke sendes til ${mottaker.label}. Ta ${v.length === 1 ? 'den' : 'dem'} ut, eller send til en lokal modell.`, v.map((x) => `«${x.name}» er Vault-merket (vending)`))
}
const budsjettLinje = (ms, tokensCa) => Object.fromEntries(ms.map((m) => [m.id, { budsjett: m.budsjett || null, tokens: tokensCa[m.id], over: !!m.budsjett && tokensCa[m.id] > m.budsjett }]))

export function forhåndsvis({ melding = '', saker = [], mottaker: mId, mottakere: mIds, prosjekt, vendinger = [], samtale = null } = {}) {
  const alle = lagMottakere()
  const ids = [...new Set([...(Array.isArray(mIds) ? mIds : []), ...(mId ? [mId] : [])].map((x) => String(x || '').trim()).filter(Boolean))]
  if (!ids.length) throw new MotorFeil('mottaker kreves')
  const ms = ids.map((id) => { const m = alle.find((x) => x.id === id); if (!m) throw new MotorFeil(`ukjent mottaker «${id}» — en av ${alle.map((x) => x.id).join(', ')}`); return m })
  const atoms = load()
  const { kontekst, kilder, notater } = minimer(atoms, saker, { prosjekt })
  const samtaleGitt = samtale ? finnSamtale(atoms, samtale) : null
  const vend = løsVendinger(atoms, vendinger, samtaleGitt)
  const samtaleAtom = samtaleGitt || (vend.length ? samtaleFor(atoms, atoms.find((a) => a.id === vend[0].id)) : null)
  const maks = {}
  let blokkert = null
  for (const m of ms) {
    try { maks[m.id] = sjekkTillatt(m, kilder).maks; vendingerTillatt(m, vend) } catch (e) {
      if (!(e instanceof Blokkert)) throw e
      maks[m.id] = maks[m.id] || maksNivå(m)
      if (!blokkert) blokkert = { feil: ms.length > 1 ? `Stoppet hos ${m.label} — ingenting sendes til noen av mottakerne. ${e.message}` : e.message, detaljer: e.detaljer, mottaker: m.id }
    }
  }
  const sk = lagSkjermer(kjentePersoner(atoms))
  const vendS = vend.map((v) => ({ ...v, tekst: sk.skjerm(v.tekst) }))   // samme kobling gjennom hele samtalen: vendinger, melding og kilder
  const messages = byggMeldinger({ vendinger: vendS, melding: sk.skjerm(String(melding || '')), kontekst: sk.skjerm(kontekst) })
  const sendes = `${SYSTEM}\n\n${tekstAv(messages)}`
  const tokensCa = Object.fromEntries(ms.map((m) => [m.id, anslåTokens(sendes, m.id)]))
  return { mottaker: ms[0].id, mottakere: ids, antall: { ...sk.antall }, treff: sk.treff, ord: ord(sendes), tokens: { ca: tokensCa[ms[0].id], per: tokensCa }, maks: maks[ms[0].id], maksPer: maks, tekst: sendes,
    meldinger: messages, vendinger: vend.map(({ id, rolle }) => ({ id, rolle })), samtale: samtaleAtom?.id || null, budsjett: budsjettLinje(ms, tokensCa),   // skive 1: hele `messages` slik modellen får dem, og budsjettet per mottaker
    saker: kilder.map(({ id, name, version, level, ord: o, tegn }) => ({ id, name, version, level, ord: o, tegn })), notater, blokkert }
}

// Friksjon 20: `hørerTil` = arbeidet (sak-id) spørsmålet stilles inne i — prompt-, svar-, Forskjeller- og konklusjon-sakene får hører_til, så løpet samler dem.
// Uten parameter arver «kjør igjen» koblingen fra prompt-saken; nye spørsmål uten arbeid får ingen.
// Skive 1 (arb. 33, V22): `samtale` er samtale-saken (id eller nøkkel — også en importert, som da fortsettes), en reservert id fra POST /api/samtale/ny, eller
// (gammel form) et samtalenavn; uten: samme spørsmål igjen = samme samtale, ellers en ny Tua-samtale. `vendinger` = [{id, rolle}] som skal med i kallet, i
// rekkefølge — motoren bygger `messages` som ekte samtale (byggMeldinger) og skjermer hver vending med samme kobling som meldingen og kildene. Uten vendinger:
// én melding, som før. Prompt, svar, Forskjeller og konklusjon får samtalen i bygget_av; samtale-saken (Tua) skrives på nytt ved hver vending.
export async function spor({ melding, saker = [], mottaker: mId, mottakere: mIds, prosjekt, samtale, vendinger = [], prompt: promptId, hørerTil = null, klient = 'app', signal, på = () => {} }) {
  if (!melding || !String(melding).trim()) throw new MotorFeil('melding kreves')
  const alle = lagMottakere()
  const ids = [...new Set([...(Array.isArray(mIds) ? mIds : []), ...(mId ? [mId] : [])].map((x) => String(x || '').trim()).filter(Boolean))]
  if (!ids.length) throw new MotorFeil('mottaker kreves')
  const ms = ids.map((id) => { const m = alle.find((x) => x.id === id); if (!m) throw new MotorFeil(`ukjent mottaker «${id}» — en av ${alle.map((x) => x.id).join(', ')}`); return m })
  for (const m of ms) { const st = await m.status(); if (!st.klar) throw new MotorFeil(`${m.label} er ikke klar: ${st.hvorfor}`) }
  const flere = ms.length > 1

  const atoms = load()
  const { kontekst, kilder, notater } = minimer(atoms, saker, { prosjekt })
  const vend = løsVendinger(atoms, vendinger, samtale ? finnSamtale(atoms, samtale) : null)   // skive 3: syntetiske vendinger (transkript) trenger samtalen
  // fail closed for ALLE mottakerne før noe skjermes eller sendes: er én blokkert, sendes ingenting til noen, og linja sier hvilken og hvorfor
  const maks = {}
  for (const m of ms) {
    try { maks[m.id] = sjekkTillatt(m, kilder).maks; vendingerTillatt(m, vend) } catch (e) {
      if (!(e instanceof Blokkert)) throw e
      const b = flere ? new Blokkert(`Stoppet hos ${m.label} — ingenting er sendt til noen av mottakerne. ${e.message}`, e.detaljer) : e
      b.mottaker = m.id; throw b
    }
  }

  const sk = lagSkjermer(kjentePersoner(atoms))
  const vendS = vend.map((v) => ({ ...v, tekst: sk.skjerm(v.tekst) }))   // samme kobling gjennom hele samtalen: [Person A] er den samme i vending, melding og kilde
  const meldingS = sk.skjerm(String(melding)), kontekstS = sk.skjerm(kontekst)
  const messages = byggMeldinger({ vendinger: vendS, melding: meldingS, kontekst: kontekstS })
  const sendes = `${SYSTEM}\n\n${tekstAv(messages)}`
  const tokensCa = Object.fromEntries(ms.map((m) => [m.id, anslåTokens(sendes, m.id)]))
  if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] })                   // lista vokser av bruk

  const tittel = tittelAv(melding)
  const til = ms.map((m) => m.label).join(' og ')
  const gammel = promptId ? atoms.find((x) => x.id === promptId && x.kind === 'prompt') || null : null
  if (promptId && !gammel) throw new MotorFeil(`fant ingen prompt-sak ${promptId} å kjøre igjen`)
  if (gammel && !gammel.key) gammel.key = `prompt:spor:${hashOf(gammel.content)}`          // eldre prompt-saker fra Spør (uten nøkkel) får en nå
  // Friksjonsrunde 1 (friksjon 6): prosjektet er brukerens eksplisitte valg i Spør (broen avviser tomt). Uten valg (andre kallere) som før: kildenes
  // prosjekt, ellers «Uten prosjekt». Prompt-, svar-, forskjeller- og konklusjon-sakene lander i det valgte prosjektet. «Kjør igjen» på en eldre
  // prompt-sak lar prompten stå der den er (samme sak), men svarene lander i det valgte prosjektet.
  const proj = String(prosjekt || '').trim() || gammel?.project || atoms.find((x) => x.id === kilder[0]?.id)?.project || 'Uten prosjekt'
  const promptProj = gammel?.project || proj
  // skive 1: samtalen først — finn eller lag samtale-saken; arbeidet arves fra samtalen når ingen har valgt
  const sakForVending = vend.length ? atoms.find((x) => x.id === vend[0].id) || null : null   // syntetisk vending: ingen sak (samtalen er gitt)
  let { samtale: samtaleAtom, ny: nySamtale } = samtaleForSpor(atoms, { samtale: samtale || (sakForVending ? samtaleFor(atoms, sakForVending)?.id : null), prosjekt: proj, melding, gammel, hørerTil: hørerTil && atoms.some((x) => x.id === hørerTil) ? String(hørerTil) : gammel?.hørerTil || null })
  const arbeidId = hørerTil && atoms.some((x) => x.id === hørerTil) ? String(hørerTil) : gammel?.hørerTil || samtaleAtom.hørerTil || null   // friksjon 20 + skive 1: arvet fra samtalen
  if (arbeidId && !samtaleAtom.hørerTil && arbeidId !== samtaleAtom.id) { samtaleAtom.hørerTil = arbeidId; markDirty(atoms, samtaleAtom.id) }
  const samtaleNavn = samtaleAtom.name
  på('skjermet', { mottaker: ms[0].id, mottakere: ids, antall: { ...sk.antall }, treff: sk.treff, ord: ord(sendes), tokens: { ca: tokensCa[ms[0].id], per: tokensCa }, maks: maks[ms[0].id], maksPer: maks, tekst: sendes,
    meldinger: messages, vendinger: vend.map(({ id, rolle }) => ({ id, rolle })), samtale: samtaleAtom.id, budsjett: budsjettLinje(ms, tokensCa),   // skive 1: hele `messages`, vendingene som gikk, samtalen og budsjettet per mottaker
    saker: kilder.map(({ id, name, version, level, ord: o, tegn }) => ({ id, name, version, level, ord: o, tegn })), notater })
  // M19: samme spørsmål i prosjektet = samme prompt-sak (ga vokser). Skive 1: men en prompt-sak peker på ÉN samtale — er den alt i en annen samtale, får spørsmålet en egen sak i denne
  const nøkkelFri = `prompt:spor:${hashOf(melding)}`
  const eksisterende = gammel ? null : atoms.find((x) => x.key === nøkkelFri && x.kind === 'prompt' && String(x.project).toLowerCase() === promptProj.toLowerCase())
  const annenSamtale = !!eksisterende && (() => { const s = samtaleFor(atoms, eksisterende); return !!s && s.id !== samtaleAtom.id })()
  const { atom: promptAtom } = upsert(atoms, { key: gammel ? gammel.key : annenSamtale ? `prompt:spor:${hashOf(`${samtaleAtom.id}\n${melding}`)}` : nøkkelFri, kind: 'prompt', content: String(melding), name: gammel && gammel.content.trim() === String(melding).trim() ? gammel.name : tittel,
    project: promptProj, convo: gammel ? gammel.convo : samtaleNavn, tags: ['prompt'], source: gammel?.source || 'Tua', by: 'regel', short: førsteSetning(melding),   // gammel: samme samtale (også tom) → ingen falsk ny versjon; ny: samtalens tittel
    derivedFrom: [...(gammel?.derivedFrom || []).filter((d) => atoms.find((x) => x.id === d.id)?.kind !== 'samtale'), { id: samtaleAtom.id, version: samtaleAtom.version || 1, level: 'L' }],   // skive 1: prompten peker på samtalen
    summary: gammel ? gammel.summary : `Spørsmål stilt i Tua til ${til}${kilder.length ? ` med ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} som kontekst` : ''}.`.slice(0, 300), ...(arbeidId ? { hørerTil: arbeidId } : {}) })
  if (arbeidId && promptAtom.hørerTil !== arbeidId && arbeidId !== promptAtom.id) { promptAtom.hørerTil = arbeidId; if (promptAtom.hørerTilForslag !== undefined) promptAtom.hørerTilForslag = ''; markDirty(atoms, promptAtom.id) }   // et eksplisitt valg vinner
  // prompten (og en ny samtale-saks stubb) lagres FØR sending (V16: investeringen står også når sendingen feiler); transkriptet skrives når svaret er der —
  // én versjon av samtale-saken per vending (spørsmål + svar), og en ny samtale er fortsatt versjon 1 etter første vending
  save(atoms)

  const vaultArv = kilder.some((k) => k.vault)                                 // et svar bygget på en Vault-merket sak arver merket (V15): går aldri over S ut av maskinen
  const nivåer = [...new Set(kilder.map((k) => k.level))].join('/')
  // Samme skjermede og minimerte melding til alle, samtidig. Hvert svar blir egen sak og egen Utlevert-linje idet det kommer.
  // Friksjonsrunde 1 (friksjon 8, «Stopp»): avbrytes signalet mens svaret strømmer, lagres det som kom som svar-sak merket avbrutt (tagg `avbrutt`,
  // ingressen sier det) — sendingen er gjort og logges som Utlevert som vanlig; `ferdig` får avbrutt: true. Kom ingenting, kastes feilen som før.
  async function sendEn(m) {
    let strømmet = ''
    let r, avbrutt = false
    try { r = await m.send({ system: SYSTEM, melding: meldingS, kontekst: kontekstS, messages }, { signal, onDel: (t) => { strømmet += t; på('del', { mottaker: m.id, tekst: t }) } }) }
    catch (e) {
      if (!(e?.name === 'AbortError' || signal?.aborted) || !strømmet.trim()) throw e
      avbrutt = true; r = { tekst: strømmet, modell: (await m.status().catch(() => null))?.modeller?.[0] || m.modell || m.id, usage: { input_tokens: null, output_tokens: null }, stopp: 'avbrutt' }
    }
    const svarTekst = avskjerm(r.tekst || strømmet, sk.kobling)
    const tokens = { ca: tokensCa[m.id], inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
    const { atom: svarAtom } = upsert(atoms, { kind: 'svar', content: svarTekst, name: `${avbrutt ? 'Avbrutt svar' : 'Svar'} fra ${m.label}: ${tittel}`.slice(0, 90), project: proj, convo: samtaleNavn, tags: ['svar', m.id, ...(avbrutt ? ['avbrutt'] : []), ...(vaultArv ? ['vault'] : [])], source: m.label, by: 'regel',
      ...(promptAtom.hørerTil ? { hørerTil: promptAtom.hørerTil } : {}),   // friksjon 20: svaret henger på samme arbeid som spørsmålet
      derivedFrom: [{ id: promptAtom.id, version: promptAtom.version || 1, level: 'L' }, ...kilder.map(({ id, version, level }) => ({ id, version, level })), { id: samtaleAtom.id, version: samtaleAtom.version || 1, level: 'L' }],   // skive 1: … og samtalen sist
      short: `${avbrutt ? 'Avbrutt svar (stoppet av brukeren mens det strømmet)' : 'Svar'} fra ${m.label} (${r.modell}) på «${tittel}»${kilder.length ? `, med ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} på nivå ${nivåer}` : ''}${vend.length ? `, med ${vend.length} ${vend.length === 1 ? 'vending' : 'vendinger'} fra samtalen` : ''}.`.slice(0, 300) })
    promptAtom.ga = [...(promptAtom.ga || []).filter((g) => g.id !== svarAtom.id), { id: svarAtom.id, version: svarAtom.version || 1 }]
    { const r = oppdaterSamtale(atoms, samtaleAtom); if (nySamtale && r.status !== 'uendret') r.atom.version = 1; samtaleAtom = r.atom }   // skive 1: transkriptet, S og M på nytt — ny versjon per vending (upsert kan bytte objektet i lista)
    save(atoms)
    logDelivery({ tool: 'spor', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: kilder.map(({ id, version, level }) => ({ id, version, level })),
      vendinger: vend.map(({ id, rolle }) => ({ id, rolle })), samtale: samtaleAtom.id,   // skive 1: nøyaktig hvilke vendinger som gikk, og samtalen de gikk fra
      skjermet: { ...sk.antall }, ord: ord(sendes), tokens, prompt: promptAtom.id, svar: svarAtom.id, ...(avbrutt ? { avbrutt: true } : {}), ...(prosjekt ? { context: prosjekt } : {}) })
    const ferdig = { svar: svarAtom.id, prompt: promptAtom.id, samtale: samtaleAtom.id, mottaker: m.id, label: m.label, modell: r.modell, tokens, tekst: svarTekst, ...(avbrutt ? { avbrutt: true } : {}) }
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
  if (ok.length > 1 && !signal?.aborted) {   // stoppet av brukeren: svarene står lagret, men ingen vurdering (ingenting mer sendes)
    const svar = ok.map((s) => ({ id: s.svar, mottaker: s.mottaker, label: s.label, modell: s.modell, tekst: s.tekst }))
    try { fsk = await forskjeller(svar, { melding: String(melding), prosjekt: proj, klient, signal, på }) } catch (e) { fsk = { tilgjengelig: false, grunn: e.message, enig: [], uenig: [], unikt: [] } }
    på('forskjeller', fsk)
    try { konk = await konklusjon({ prompt: promptAtom.id, svar, forskjeller: fsk.tilgjengelig ? fsk : null, melding: String(melding), prosjekt: proj, samtale: samtaleNavn, klient, signal, på }) } catch (e) { konk = { tilgjengelig: false, grunn: e.message } }
    på('konklusjon', konk)
    if (konk?.id || fsk?.sak) { const a2 = load(); const s2 = a2.find((x) => x.id === samtaleAtom.id); if (s2 && oppdaterSamtale(a2, s2).status !== 'uendret') save(a2) }   // skive 1: konklusjonen som strek i transkriptet
  }
  const ut = { prompt: promptAtom.id, samtale: samtaleAtom.id, mottakere: ok.map((s) => s.mottaker), svar: ok.map((s) => s.svar), resultater: ok, feilet: feilet.map((f) => ({ mottaker: f.mottaker, label: f.label, feil: f.feil?.message || String(f.feil) })), forskjeller: fsk, konklusjon: konk }
  på('slutt', { prompt: ut.prompt, samtale: ut.samtale, svar: ut.svar, mottakere: ut.mottakere, forskjeller: !!fsk?.tilgjengelig, konklusjon: konk?.id || null, ...(signal?.aborted ? { avbrutt: true } : {}) })
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
  på('vurderer', { steg: 'forskjeller', mottaker: v.m.id, modell: v.modell, tokens: { ca: tokensCa }, svar: svar.length })   // runde 2c: appen sier «leser N svar …» til første ord kommer
  let tegn = 0   // runde 1 (arb. 32 §6): fremdrift mens Forskjeller vurderes — hver bit fra modellen gir event vurderer-del {steg, tegn} (ikke teksten: den er JSON med plassholdere)
  const r = await v.m.send({ system: SYSTEM, melding: oppgave, kontekst, json: true, oppgave: 'forskjeller' }, { signal, onDel: (t) => { tegn += String(t || '').length; på('vurderer-del', { steg: 'forskjeller', tegn }) } })
  const tolket = tolkForskjeller(r.tekst, svar.map((s, i) => ({ ...s, bokstav: bokstaver[i] })))
  for (const k of ['enig', 'uenig', 'unikt']) tolket[k] = tolket[k].map((p) => ({ ...p, tekst: avskjerm(p.tekst, sk.kobling) }))
  if (tolket.rå) tolket.rå = avskjerm(tolket.rå, sk.kobling)
  const tokens = { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
  // Forskjeller lagres som egen sak (skive 6-tillegg; plan §3 regel 4: svarene er saker — vurderingen av dem er det også): kind svar med taggen
  // forskjeller, bygget_av → svar-sakene på nivået de ble lest, nøkkel forskjeller:<prompt> så «kjør igjen» gir ny versjon av samme sak. Da står
  // den i Oppslag (stikktittel FORSKJELLER) og Utlevert-linja peker til den. Innholdet er de tre listene som lesbar markdown (originalene satt inn igjen lokalt).
  const svarAtomer = kilder.map((k) => (k.id ? atoms.find((x) => x.id === k.id) : null))
  const promptAtom = svarAtomer.map((a) => a && atoms.find((x) => x.kind === 'prompt' && (a.derivedFrom || []).some((d) => d.id === x.id))).find(Boolean) || null
  const tittel = tittelAv(melding || promptAtom?.content || svarAtomer.find(Boolean)?.name || 'Forskjeller')
  const navnFor = (id) => svar.find((s) => s.mottaker === id)?.label || id
  const { atom: fAtom } = upsert(atoms, { key: `forskjeller:${promptAtom?.id || tittel}`, kind: 'svar', content: forskjellerTilMarkdown(tolket, navnFor), name: `Forskjeller: ${tittel}`.slice(0, 90),
    project: prosjekt || promptAtom?.project || svarAtomer.find(Boolean)?.project || 'Uten prosjekt', convo: promptAtom?.convo || svarAtomer.find(Boolean)?.convo || tittel,
    tags: ['svar', 'forskjeller', v.m.id, ...(kilder.some((k) => k.vault) ? ['vault'] : [])], source: v.m.label, by: 'regel', ...(promptAtom?.hørerTil ? { hørerTil: promptAtom.hørerTil } : {}),   // friksjon 20
    derivedFrom: kilder.filter((k) => k.id).map(({ id, version, level }) => ({ id, version, level })),
    short: `Forskjeller mellom ${svar.length} svar på «${tittel}», vurdert av ${v.m.label} (${r.modell}): ${tolket.enig.length} enig · ${tolket.uenig.length} uenig · ${tolket.unikt.length} unikt.`.slice(0, 300) })
  { const s = promptAtom ? samtaleFor(atoms, promptAtom) : null; if (s) pekPåSamtale(atoms, fAtom, s) }   // skive 1: Forskjeller peker på samtalen
  save(atoms)
  logDelivery({ tool: 'forskjeller', client: klient, mottaker: v.m.id, endpoint: v.m.endpoint, modell: r.modell, saker: kilder.filter((k) => k.id).map(({ id, version, level }) => ({ id, version, level })),
    skjermet: { ...sk.antall }, ord: ord(sendes), tokens, forskjeller: fAtom.id, ...(prosjekt ? { context: prosjekt } : {}) })
  return { tilgjengelig: true, ...tolket, sak: fAtom.id, vurdert_av: v.m.id, modell: r.modell, tokens, nivå, svar: svar.map((s, i) => ({ bokstav: bokstaver[i], id: s.id || null, mottaker: s.mottaker, label: s.label || s.mottaker })) }
}
// Finn ett JSON-objekt i en modelltekst: kodeblokk først, så første «{» til siste «}», med reparasjon av hengende komma og typografiske anførselstegn.
// De tre listene som markdown til Forskjeller-saken. navnFor(mottaker-id) → mottakerens navn.
export function forskjellerTilMarkdown(f, navnFor = (id) => id) {
  if (f.tolket === 'ingen') return `## Forskjeller (ustrukturert)\n\n${f.merk || ''}\n\n${f.rå || ''}`.trim()
  const del = (tittel, liste) => `## ${tittel}\n\n${liste.length ? liste.map((p) => `- ${p.tekst}${p.mottakere?.length ? ` (${p.mottakere.map(navnFor).join(', ')})` : ''}`).join('\n') : '_ingen_'}`
  return [del('Enig', f.enig), del('Uenig', f.uenig), del('Unikt', f.unikt)].join('\n\n')
}
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
  const fAtom = f?.sak ? atoms.find((a) => a.id === f.sak) || null : null       // Forskjeller-saken (skive 6-tillegg): konklusjonen bygger også på den
  const kilder = [
    ...(promptAtom ? [{ id: promptAtom.id, name: promptAtom.name, version: promptAtom.version || 1, level: nivå, vault: isVault(promptAtom) }] : []),
    ...svarKilder,
    ...(fAtom ? [{ id: fAtom.id, name: fAtom.name, version: fAtom.version || 1, level: nivå, vault: isVault(fAtom), tekst: '' }] : []),
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
    ...(promptAtom?.hørerTil ? { hørerTil: promptAtom.hørerTil } : {}),   // friksjon 20: konklusjonen henger på arbeidet
    derivedFrom: kilder.filter((k) => k.id).map(({ id, version, level }) => ({ id, version, level })),
    short: `Utkast til konklusjon fra ${v.m.label} (${r.modell}) på «${tittel}», ut fra ${svar.length} svar (${svar.map((s) => s.label || s.mottaker).join(', ')}). Rettes og låses av brukeren.`.slice(0, 300) })
  setStatus(atom, 'utkast')
  { const s = promptAtom ? samtaleFor(atoms, promptAtom) : null; if (s) pekPåSamtale(atoms, atom, s) }   // skive 1: konklusjonen peker på samtalen (streken i transkriptet)
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

// ── 7) Claude-døra (runde 3a i arbeidsstykke 32, §5.7 og 03-avisen §5): det MCP-verktøyene gir Claude går gjennom motoren ──────
// «Én motor, to dører» var til nå bare appens dør: server.js hentet L rett fra lageret og logget. Fra runde 3a går tua_get, tua_compose,
// tua_card og tua_search-treffene (S) gjennom de samme trinnene som spor(): lese → klippe (fail closed) → skjerme → logge. Ingen kodevei utenom.
//
// Mottakeren er Claude som ENDEPUNKT (trust-scores.json «claude», api.anthropic.com) uansett klient — Desktop, Code og Cowork er samme dør,
// og Trust Score-fila er stedet Erik retter hva den får. Det Claude får er skjermet med skjerm(); koblingen plassholder → original kastes
// her og settes ALDRI inn igjen i det Claude får (V21). Vault-merkede saker og nivåer over det Trust Score tillater gir S og én linje om hvorfor
// (fail closed, aldri en advarsel) — ikke en feil, for Claude skal kunne svare på S. Hver utlevering er én Utlevert-linje med antall skjermet
// per type, ord og tokens (ca.), som Spør — aldri innhold, aldri originaler.
export function endepunkt(id = 'claude') {
  const t = trustFor(id)
  return { id, label: t?.label || id, endpoint: t?.endpoint || '', trust: t, local: id === 'ollama' || t?.region === 'lokalt' }
}
// Ett skjermings-oppsett for et helt verktøysvar: samme person får samme plassholder i tittel, ingress og tekst. Lista vokser av bruk (som spor()).
export function skjermerFor(atoms) {
  const sk = lagSkjermer(kjentePersoner(atoms))
  // treff er en getter på skjermeren — den må defineres på nytt her (en spredning ville fryst den til 0)
  return { skjerm: (t) => sk.skjerm(t), kobling: sk.kobling, antall: sk.antall, nye: sk.nye, get treff() { return sk.treff }, lær: () => { if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] }) } }
}
// lever(): én sak til Claude på et nivå. Returnerer { nivå (det som faktisk gis), ønsket, maks, linje (hvorfor klippet, '' når ikke), felt (navn, samtale,
// S, hvorfor — skjermet), tekst (skjermet), got (levelOf-svaret), antall, treff, tokens, ord, logget }. `versjon` er en tidligere versjon av saken
// (readVersion) — nivået vurderes på saken slik den er nå (Vault-taggen), teksten tas fra versjonen. `logg: false` skjermer uten Utlevert-linje.
export function lever(atoms, sak, { nivå = 'L', mottaker = 'claude', tool = 'tua_get', klient = 'Claude', context, versjon = null, logg = true, sk = null } = {}) {
  const m = typeof mottaker === 'string' ? endepunkt(mottaker) : mottaker
  const kilde = versjon || sak
  const ønsket = LEVELS.includes(nivå) ? nivå : 'L'
  const maks = clampLevel(ønsket, maxLevel(sak, context))                   // referansens nivå (V11) først — det er ikke fail closed, bare synlighet
  let eff = maks, linje = ''
  try { sjekkTillatt(m, [{ id: sak.id, name: sak.name, version: kilde.version || 1, level: eff, vault: isVault(sak) }]) }
  catch (e) {
    if (!(e instanceof Blokkert)) throw e
    eff = 'S'
    linje = isVault(sak)
      ? `«${sak.name}» er Vault-merket: ${m.label} får bare S (V15, fail closed). Hele innholdet finnes bare i Tua-appen på denne maskinen.`
      : `${m.label} har Trust Score ${Number(m.trust?.score) || 1}/5 — nivå ${maks} krever minst ${NIVÅ_KREVER_TRUST[maks]} (fail closed, V21). Du får S.`
  }
  const got = levelOf(kilde, eff)
  const egen = !sk
  sk = sk || skjermerFor(atoms)
  const S = levelOf(kilde, 'S')
  const felt = { navn: sk.skjerm(kilde.name || sak.name), samtale: sk.skjerm(kilde.convo || ''), S: S.level === 'S' ? sk.skjerm(S.text) : '', hvorfor: kilde.summary && kilde.summary !== S.text ? sk.skjerm(kilde.summary) : '' }
  const tekst = sk.skjerm(got.text)
  if (egen) sk.lær()
  const alt = `${felt.navn}\n${felt.samtale}\n${felt.S}\n${felt.hvorfor}\n${tekst}`
  const tokens = { ca: anslåTokens(alt, m.id) }
  const antall = { ...sk.antall }
  let logget = false
  if (logg) {
    logDelivery({ tool, client: klient, mottaker: m.id, endpoint: m.endpoint, id: sak.id, version: kilde.version || 1, level: eff,
      saker: [{ id: sak.id, version: kilde.version || 1, level: eff }], skjermet: antall, ord: ord(alt), tokens, ...(linje ? { klippet: `${ønsket}→${eff}` } : {}), ...(context ? { context } : {}) })
    logget = true
  }
  return { nivå: eff, ønsket, maks, linje, felt, tekst, got, S, antall, treff: Object.values(antall).reduce((a, b) => a + b, 0), tokens, ord: ord(alt), logget, mottaker: m }
}

// Skive 4 (arb. 33, V22, 28.10.2026): EN SAMTALE til Claude-døra (tua_compose med `samtale`) — gjennom motoren som spor(): vendingene velges (de oppgitte, ellers
// standardvalget for mottakeren: alt etter siste låste konklusjon, kuttet bakfra mot budsjettet), Vault-merkede vendinger holdes utenfor hos en ekstern mottaker (fail
// closed, med linje — ikke en feil, resten går), hver vending skjermes med samme kobling som resten av svaret, og `messages` bygges med byggMeldinger slik modellen
// ville fått dem. Returnerer { samtale, vendinger: [{id, rolle}], messages (skjermet), tekst (markdown: **user:** / **assistant:**-blokker), standard, utenfor,
// vault: [navn…], linje }. Logger ingenting selv — kalleren skriver én Utlevert-linje med `vendinger` og `samtale` (som spor).
export function leverSamtale(atoms, samtale, { vendinger = null, mottaker = 'claude', sk = null } = {}) {
  const m = typeof mottaker === 'string' ? endepunkt(mottaker) : mottaker
  const alle = vendingerFor(atoms, samtale)
  const std = standardFor(alle, m.id)
  const ønsket = Array.isArray(vendinger) && vendinger.length ? vendinger.map((v) => (typeof v === 'string' ? v : v?.id)).filter(Boolean) : std.vendinger
  const rekkefølge = new Map(alle.map((v, i) => [v.id, i]))
  const ukjent = ønsket.filter((id) => !rekkefølge.has(id))
  if (ukjent.length) throw new MotorFeil(`${ukjent.length === 1 ? 'vendingen' : 'vendingene'} ${ukjent.join(', ')} finnes ikke i samtalen «${samtale.name}»`)
  const løst = løsVendinger(atoms, [...ønsket].sort((a, b) => rekkefølge.get(a) - rekkefølge.get(b)), samtale)
  const vault = m.local ? [] : løst.filter((v) => v.vault)
  const med = løst.filter((v) => !vault.includes(v))
  sk = sk || skjermerFor(atoms)
  const vendS = med.map((v) => ({ ...v, tekst: sk.skjerm(v.tekst) }))
  const messages = vendS.length ? byggMeldinger({ vendinger: vendS }) : []
  const tekst = messages.map((x) => `**${x.role}:**\n\n${x.content}`).join('\n\n')
  const linje = vault.length ? `${vault.length === 1 ? 'Én vending' : `${vault.length} vendinger`} (${vault.map((v) => `«${v.name}»`).join(', ')}) bygger på Vault-merket innhold og er holdt utenfor hos ${m.label} (V15, fail closed).` : ''
  return { samtale: samtale.id, vendinger: med.map(({ id, rolle }) => ({ id, rolle })), messages, tekst, standard: std, valgtStandard: !(Array.isArray(vendinger) && vendinger.length), antall: alle.length, utenfor: std.utenfor, vault: vault.map((v) => v.name), linje, mottaker: m }
}

// del(): «del med …» — runde 3a laget delingssaken; runde 3b (planen videre §4 3b, Erik: kollegaer først) gjør mottakeren til en PERSON og gir delingen en
// LENKE. Første gang primitiv 2, «mottaker er en fasett» (CLAUDE.md §2.1), finnes i Tua 2.0. Gjennom motoren: lese (minimer) → klippe (Vault → S, fail
// closed, med linje) → skjerme → minimere → lagre → logge. Ingen kodevei utenom.
//   til            navn, e-post, «Navn <epost>» eller et sirkelnavn — én streng (også «Anna, Bjarte» / «Anna og Bjarte») eller en liste. Finnes personen i
//                  .tua/mottakere.json, brukes den; et nytt navn blir en ny person (merke «kollega»). Et sirkelnavn gir medlemmene. (deling.js)
//   nivå           S som standard (V11) — M/L bare når brukeren valgte det; Vault-merkede saker deles bare som S (V15/V21, fail closed, med linje).
//   forhåndsvis    regner ut det samme (hvem får hva, hva skjermes) uten å opprette personer, lagre eller logge — til ETT spørsmål før deling.
//   base           broens adresse (http://127.0.0.1:5274) — lenka på delingssaken og i svaret. tua://del/<token> i tillegg.
// Lager: (1) delingssaken (kind leveranse, tagg deling) med den skjermede gjengivelsen og lenkene, (2) delingen i .tua/delinger.json (token → radene
// slik de ble delt, skjermet — mottakersiden tegnes av dem, aldri av originalene), (3) én Utlevert-linje PER PERSON (mottaker = person-id, mottakerNavn,
// personer[], deling, token, endpoint «deling (lenke)»), (4) personer og mønstre i .tua/mottakere.json — tredje felles deling gir et sirkelforslag.
// Svaret har lenke (http), lenker {tua, http, html}, token, kopierbar tekst, mottakere (med `ny`) og sirkelforslag — det samme til Claude og appen.
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mottaker'
const navneliste = (n) => (n.length <= 1 ? n[0] || '' : `${n.slice(0, -1).join(', ')} og ${n.at(-1)}`)
export function del(atoms, { ids = [], til, nivå = 'S', prosjekt, klient = 'Claude', convo, forhåndsvis = false, base, merke = 'kollega' } = {}) {
  const tilRå = Array.isArray(til) ? til.map((t) => String(t || '').trim()).filter(Boolean) : String(til || '').trim()
  if (!tilRå || (Array.isArray(tilRå) && !tilRå.length)) throw new MotorFeil('mottaker kreves («del med <navn eller e-post>»)')
  if (!Array.isArray(ids) || !ids.length) throw new MotorFeil('minst én sak-id kreves')
  const { personer, sirkler: sirkelnavn, m } = løsMottakere(tilRå, { merke, opprett: !forhåndsvis })
  if (!personer.length) throw new MotorFeil('fant ingen mottaker i «' + (Array.isArray(tilRå) ? tilRå.join(', ') : tilRå) + '»')
  const mottakerNavn = navneliste(personer.map((p) => p.navn))
  const ønsket = LEVELS.includes(nivå) ? nivå : 'S'
  const { kilder, notater } = minimer(atoms, ids.map((id) => ({ id, nivå: ønsket })))
  if (!kilder.length) throw new MotorFeil(`Ingen av sakene finnes: ${notater.join('; ')}`)
  const linjer = []
  for (const k of kilder) if (k.vault && k.level !== 'S') { k.level = 'S'; k.klippet = true; linjer.push(`«${k.name}» er Vault-merket og deles bare som S (V15, fail closed).`) }
  const sk = skjermerFor(atoms)
  const rader = kilder.map((k) => {
    const a = atoms.find((x) => x.id === k.id)
    const got = levelOf(a, k.level)
    k.tegn = got.text.trim().length; k.ord = ord(got.text)
    return { id: a.id, version: a.version || 1, level: k.level, fallback: got.fallback ? got.level : null, name: sk.skjerm(a.name), tekst: sk.skjerm(got.text.trim()) }
  })
  const gjengivelse = rader.map((r) => `## ${r.name}\n_v${r.version} · nivå ${r.level}${r.fallback ? ` (${r.fallback})` : ''}_\n\n${r.tekst}`).join('\n\n')
  const antall = { ...sk.antall }, treff = Object.values(antall).reduce((a, b) => a + b, 0)
  const nivåer = [...new Set(kilder.map((k) => k.level))].join('/')
  const når = new Date()
  const skjermetTekst = treff ? `${treff} opplysning${treff === 1 ? '' : 'er'} skjermet (${Object.entries(antall).map(([t, n]) => `${n} ${t}`).join(', ')})` : 'ingen opplysninger å skjerme'
  const setning = `${mottakerNavn} får ${nivåer} av ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'}, ${skjermetTekst}.`
  const tokens = { ca: anslåTokens(gjengivelse, 'claude') }
  const mottakere = personer.map(({ id, navn, epost, merke: mk, ny }) => ({ id, navn, epost: epost || null, merke: mk, ny: !!ny }))
  if (forhåndsvis) return { forhåndsvis: true, til: mottakerNavn, mottakere, sirkler: sirkelnavn, nivå: nivåer, kilder, antall, treff, linjer, notater, setning, tokens, ord: ord(gjengivelse), gjengivelse }
  // ── lagre: token + deling, delingssaken, Utlevert per person, personer og mønstre. Samme personer, samme saker på samme nivå, delingen ikke trukket → samme
  // token og samme delingssak (lenka kollegaen alt har, virker fortsatt; radene skrives på nytt om saken har endret seg); ellers et nytt token.
  const tilNøkkel = personer.map((p) => p.id).sort().join('+')
  const samme = delingerFor(null).find((d) => !d.trukket && (d.til || []).map((t) => t.id).sort().join('+') === tilNøkkel && (d.rader || []).length === rader.length && d.rader.every((r, i) => r.id === rader[i].id && r.level === rader[i].level))
  const token = samme?.token || nyttToken()
  const lenker = lenkerFor(token, base)
  const proj = String(prosjekt || '').trim() || atoms.find((x) => x.id === kilder[0].id)?.project || 'Uten prosjekt'
  const tittel = `Deling til ${mottakerNavn}: ${kilder.length === 1 ? kilder[0].name : `${kilder.length} saker`}`.slice(0, 90)
  const hode = `# Deling til ${mottakerNavn}\n\n_Delt med: ${personer.map((p) => (p.epost ? `${p.navn} <${p.epost}>` : p.navn)).join(', ')} · nivå ${nivåer} · ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} · ${skjermetTekst} · utlevert ${fmtTid(når)} fra ${klient}_` +
    (linjer.length ? `\n\n${linjer.map((l) => `> ${l}`).join('\n')}` : '')
  const content = `${hode}\n\n**Lenke til mottakersiden:** ${lenker.http} · ${lenker.tua}\n**Som fil:** ${lenker.html}\n\n${gjengivelse}\n\n---\n\n_Gjengivelsen er skjermet: plassholdere som [Person A] står for opplysninger som ikke er delt. Mottakersiden viser sakene som låste rader på nivået de ble delt, med «Be om hele»._`
  const key = `deling:${slug(mottakerNavn)}:${token.slice(0, 8)}`
  const { atom, status } = upsert(atoms, { key, kind: 'leveranse', name: tittel, content, project: proj, convo: convo || `Deling til ${mottakerNavn}`, source: 'Tua', by: 'regel', tags: ['deling'],
    derivedFrom: kilder.map(({ id, version, level }) => ({ id, version, level })),
    short: `Delt med ${mottakerNavn} på nivå ${nivåer}: ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} (${kilder.map((k) => k.name).join(', ')}), ${skjermetTekst}.`.slice(0, 300),
    summary: `Deling laget fra ${klient} ${fmtTid(når)}; mottakersiden er ${lenker.http}.` })
  atom.links = [...(atom.links || []).filter((l) => ![lenker.tua, lenker.http].includes(l.href)), { kind: 'url', href: lenker.http, label: `Mottakersiden til ${mottakerNavn}` }, { kind: 'url', href: lenker.tua, label: `Delingen (tua://)` }]
  save(atoms)
  const eierNå = eier()
  lagreDeling({ token, sak: atom.id, til: mottakere, sirkler: sirkelnavn, nivå: nivåer, rader, opprettet: samme?.opprettet || når.getTime(), oppdatert: når.getTime(), av: eierNå, klient, treff, antall, prosjekt: proj, trukket: null, forespørsler: samme?.forespørsler || [] })
  for (const p of personer) {
    logDelivery({ tool: 'tua_share', client: klient, mottaker: p.id, mottakerNavn: p.navn, personer: mottakere.map(({ id, navn }) => ({ id, navn })), endpoint: 'deling (lenke)', token, saker: kilder.map(({ id, version, level }) => ({ id, version, level })),
      skjermet: antall, ord: ord(gjengivelse), tokens, deling: atom.id, ...(proj ? { context: proj } : {}) })
  }
  const sirkelForslag = registrerDeling(m, personer.map((p) => p.id), når.getTime())
  skrivMottakere(m)
  sk.lær()
  const kopierbar = `${gjengivelse}\n\n— Delt fra Tua ${fmtTid(når)} · nivå ${nivåer} · ${skjermetTekst}\nMottakersiden: ${lenker.http}`
  return { id: atom.id, version: atom.version || 1, status, til: mottakerNavn, mottakere, sirkler: sirkelnavn, nivå: nivåer, kilder, antall, treff, linjer, notater, setning, token, lenke: lenker.http, lenker, kopierbar, tokens, ord: ord(gjengivelse), prosjekt: atom.project,
    sirkelForslag: sirkelForslag ? { id: sirkelForslag.id, forslag: sirkelForslag.forslag, medlemmer: sirkelForslag.medlemmer, antall: sirkelForslag.antall, navn: sirkelForslag.navn || null } : null }
}
// trekkDeling(): lenka slutter å virke (410 på mottakersiden); logges i Utlevert som hendelse «trukket» (aldri innhold). Delingssaken står (den er historikk).
export function trekkDeling(token, { klient = 'app' } = {}) {
  const d = trekkTilbake(token)
  logDelivery({ tool: 'tua_share', hendelse: 'trukket', client: klient, mottaker: d.til?.[0]?.id || null, mottakerNavn: navneliste((d.til || []).map((p) => p.navn)), personer: d.til || [], endpoint: 'deling (lenke)', token, saker: (d.rader || []).map(({ id, version, level }) => ({ id, version, level })), skjermet: {}, ord: 0, tokens: { ca: 0 }, deling: d.sak, ...(d.prosjekt ? { context: d.prosjekt } : {}) })
  return d
}
// beOmHele(): mottakeren ba om hele (fra mottakersiden) — noteres på delingen og logges i Utlevert som hendelse «forespørsel» med sakene det gjelder. Ingenting sendes.
export function beOmHele(token, { saker = [] } = {}) {
  const d = hentDeling(token)
  if (!d) throw new MotorFeil('fant ikke delingen')
  if (d.trukket) throw new MotorFeil('delingen er trukket tilbake')
  const f = noterForespørsel(token, { saker })
  const rader = (d.rader || []).filter((r) => !f.saker.length || f.saker.includes(r.id))
  logDelivery({ tool: 'tua_share', hendelse: 'forespørsel', client: 'mottakersiden', mottaker: d.til?.[0]?.id || null, mottakerNavn: navneliste((d.til || []).map((p) => p.navn)), personer: d.til || [], endpoint: 'deling (lenke)', token, saker: rader.map(({ id, version, level }) => ({ id, version, level, ønsket: 'L' })), skjermet: {}, ord: 0, tokens: { ca: 0 }, deling: d.sak, ...(d.prosjekt ? { context: d.prosjekt } : {}) })
  return { ...f, deling: d.sak, til: d.til, rader: rader.map(({ id, name, level }) => ({ id, name, level })) }
}
// Mottakersiden for et token: { kode, html } — 404 ukjent, 410 trukket, 200 siden (frittstående = /del/<token>.html til nedlasting). Kalles bare av broen.
export function mottakersideFor(token, { base, frittstående = false } = {}) {
  const d = hentDeling(token)
  if (!d) return { kode: 404, html: trukketSide(null), deling: null }
  if (d.trukket) return { kode: 410, html: trukketSide(d), deling: d }
  return { kode: 200, html: mottakerside(d, { base: base || BASE(), frittstående }), deling: d }
}
const fmtTid = (d) => d.toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' })

// ── 8) Utfordre (skive C i arbeidsstykke 34, §5 C1–C4, V23, 28.10.2026) ──────────────────────────────────────────────
// «Også til …» spurte på nytt; ingen modell ble bedt om å finne feil i SVARET. Nå: en kontrollmodell Erik velger hver gang får bare RESULTATET og
// KILDENE det bygger på (C3) — aldri transkriptet — med én av fire ferdige instrukser (utfordring.SJEKKER), gjennom de samme trinnene som spor():
// fail closed (Vault bare lokalt, nivå etter Trust Score) → skjerm → send → avskjerm → Utlevert-linje (tool: utfordre). Svaret tolkes til innvendinger.
//   utfordringsGrunnlag()  hva som sendes: resultatet (saken på L, en konklusjon, eller et svar i en samtale — også en vending fra transkriptet) på det høyeste
//                          kontrollmodellen får, og kildene (bygget_av, dokumentene samtalen skrev) på standardnivået. Over budsjettet: kildene ned L → M → S,
//                          så færre kilder, og først til slutt kuttes resultatet — hvert kutt er en notat-linje («Kildene er kuttet til M …»).
//   forhåndsvisUtfordring() Sendes-linja før noe sendes: nivå, ca. tokens, budsjett, antall skjermet, kildene — ingenting sendes eller logges.
//   utfordre()             sender; lagrer instruksen som prompt-sak (V16, prompt:utfordre:<sjekk> i sakens prosjekt, `ga` vokser) og utfordringen som egen sak:
//                          kind svar, tagger svar + utfordring + mottakeren, `utfordrer` → saken {id, version, vending?}, `utfordring` {sjekk, mottaker, label, modell,
//                          forfatter, dato, innvendinger [{nr, tekst, hvor, begrunnelse, status}], låst}. Bygget_av → prompten, resultatet og kildene.
//   settInnvending()       åpen · godtatt · avvist — metadata på utfordringen, ingen ny versjon av teksten.
//   nyVersjon()            forfattermodellen (eller valgt) skriver resultatet på nytt med de GODTATTE innvendingene: sak kind svar, tagg ny-versjon, nøkkel ny-versjon:<utfordring>
//                          («igjen» gir ny versjon av samme sak), bygget_av → utfordringen og resultatet. Samme trinn og egen Utlevert-linje (tool: ny-versjon).
//   låsUtfordring()        «Lås med innvendingene»: en konklusjon (endelig, tagg utfordring — den står på saken, ikke som egen rad) med det som ble tatt inn,
//                          avvist og ikke vurdert, bygget_av → saken, utfordringen og en ny versjon når den finnes. Utfordringen merkes låst. Ingenting sendes.
const SYSTEM_KONTROLL = `${SYSTEM} Du er kontrollmodell: du vurderer et svar en annen modell har skrevet. Svar bare med innvendingene, på formen du blir bedt om.`
const UTFORDRE_MAKS_KILDER = 8
const ned = (n) => (n === 'L' ? 'M' : 'S')
const nivåTekst = (ks) => [...new Set(ks.map((k) => k.level))].join('/')
function finnKontroll(mId) {
  const m = lagMottakere().find((x) => x.id === mId)
  if (!m) throw new MotorFeil(`ukjent kontrollmodell «${mId}» — en av ${lagMottakere().map((x) => x.id).join(', ')}`)
  return m
}
// Resultatet som skal utfordres, og kildene det bygger på. sak = en sak-id (dokument, svar, konklusjon) eller en samtale; vending = et svar i samtalen.
export function utfordringsMål(atoms, { sak: sakId, vending: vId = null } = {}) {
  const a = atoms.find((x) => x.id === sakId) || null
  const samtale = a?.kind === 'samtale' ? a : vId ? finnSamtale(atoms, sakId) : null
  if (!a && !samtale) throw new MotorFeil(`fant ikke sak ${sakId}`)
  let resultat, mål = a || samtale, vending = null
  if (samtale && (a?.kind === 'samtale' || vId)) {
    const vend = vendingerFor(atoms, samtale)
    const v = vId ? vend.find((x) => x.id === vId) : resultatVending(vend)
    if (!v) throw new MotorFeil(vId ? `fant ikke svaret ${vId} i samtalen «${samtale.name}»` : `samtalen «${samtale.name}» har ikke noe svar å utfordre ennå`)
    vending = v
    const sakV = v.syntetisk ? null : atoms.find((x) => x.id === v.id) || null
    resultat = sakV ? { atom: sakV, id: sakV.id, name: sakV.name, version: sakV.version || 1, vault: isVault(sakV) }
      : { atom: { id: samtale.id, name: `Resultat: ${samtale.name}`, content: v.L || '', levels: v.S ? { S: { text: v.S } } : undefined, version: samtale.version || 1 }, id: samtale.id, name: `Resultat i «${samtale.name}»`, version: samtale.version || 1, vault: isVault(samtale) || !!v.vault, syntetisk: true }
    mål = samtale
  } else resultat = { atom: a, id: a.id, name: a.name, version: a.version || 1, vault: isVault(a) }
  const forfatter = String(vending ? (vending.kilde && vending.kilde !== 'Tua' ? vending.kilde : vending.modell) || '' : resultat.atom.source || '').trim()
  // kildene: det resultatet er bygget av (ikke prompten, samtalen, Forskjeller eller andre utfordringer), og dokumentene samtalen skrev
  const nei = new Set([resultat.id, mål.id])
  const fraBygget = (resultat.atom.derivedFrom || []).map((d) => atoms.find((x) => x.id === d.id)).filter((x) => x && !['prompt', 'samtale'].includes(x.kind) && !(x.tags || []).includes('forskjeller') && !x.utfordring)
  const fraSamtale = samtale ? samtaleDokumenter(atoms, samtale) : []
  const kilder = [...new Map([...fraBygget, ...fraSamtale].filter((x) => !nei.has(x.id)).map((x) => [x.id, x])).values()].slice(0, UTFORDRE_MAKS_KILDER)
  return { mål, samtale, vending, resultat, forfatter, kilder }
}
export function utfordringsGrunnlag(atoms, { sak, vending = null, sjekk, mottaker: mId, sk = null } = {}) {
  const s = sjekkAv(sjekk); if (!s) throw new MotorFeil(`ukjent sjekk «${sjekk}» — en av ${SJEKKER.map((x) => x.id).join(', ')}`)
  const m = finnKontroll(mId)
  const mål = utfordringsMål(atoms, { sak, vending })
  const maks = maksNivå(m)
  // Vault (V15, C2): bare en lokal modell får utfordre. Ikke klipp i stillhet til S — en kontroll av ingressen er verdiløs.
  const vaultSaker = [mål.resultat, ...mål.kilder.map((k) => ({ name: k.name, vault: isVault(k) }))].filter((x) => x.vault)
  if (vaultSaker.length && !m.local) throw new Blokkert(`Utfordringen er stoppet: ${vaultSaker.map((x) => `«${x.name}»`).join(', ')} er Vault-merket og kan bare utfordres av en lokal modell. Velg Ollama (eller en annen lokal modell).`, vaultSaker.map((x) => `«${x.name}» er Vault-merket`))
  const notater = []
  let resNivå = clampLevel('L', maks)
  if (resNivå !== 'L') notater.push(`${m.label} har Trust Score ${Number(m.trust?.score) || 1}/5 og får svaret på ${resNivå}, ikke hele (L).`)
  let ks = mål.kilder.map((k) => ({ atom: k, id: k.id, name: k.name, version: k.version || 1, vault: isVault(k), level: standardNivå(m, k) }))
  sk = sk || lagSkjermer(kjentePersoner(atoms))
  const instruks = instruksFor(s.id)
  let resTekst = levelOf(mål.resultat.atom, resNivå).text.trim(), kuttet = false
  const bygg = () => {
    const deler = [`## Svaret som skal utfordres (${mål.forfatter ? `skrevet av ${mål.forfatter}` : 'forfatter ukjent'}, nivå ${resNivå}${kuttet ? ', kuttet' : ''})\n\n${sk.skjerm(resTekst)}`,
      ...ks.map((k) => `## Kilde: ${sk.skjerm(k.name)}\n_v${k.version} · nivå ${k.level}_\n\n${sk.skjerm(levelOf(k.atom, k.level).text.trim())}`)]
    const kontekst = deler.join('\n\n')
    return { kontekst, sendes: `${SYSTEM_KONTROLL}\n\n${byggMelding(instruks, kontekst)}` }
  }
  // budsjettet (C3): kildene ned først, så færre kilder, så kuttes svaret — og det sies
  const budsjett = m.budsjett || budsjettFor(m.id)
  let b = bygg(), tokens = anslåTokens(b.sendes, m.id)
  const førKilder = ks.map((k) => k.level).join('')
  for (const steg of ['M', 'S']) { if (!budsjett || tokens <= budsjett) break; let endret = false; for (const k of ks) if (LEVELS.indexOf(k.level) > LEVELS.indexOf(steg)) { k.level = steg; endret = true } if (endret) { b = bygg(); tokens = anslåTokens(b.sendes, m.id) } }
  if (ks.map((k) => k.level).join('') !== førKilder) notater.push(`Kildene er kuttet til ${nivåTekst(ks)} for å holde budsjettet (${budsjett.toLocaleString('no-NO')} tokens hos ${m.label}).`)
  const førAntall = ks.length
  while (budsjett && tokens > budsjett && ks.length) { ks = ks.slice(0, -1); b = bygg(); tokens = anslåTokens(b.sendes, m.id) }
  if (ks.length < førAntall) notater.push(`${førAntall - ks.length} av ${førAntall} kilder er tatt ut for å holde budsjettet.`)
  if (budsjett && tokens > budsjett) {
    const tegnPer = TEGN_PER_TOKEN[m.id] || 3.5
    const rom = Math.max(400, Math.floor((budsjett - anslåTokens(`${SYSTEM_KONTROLL}\n\n${instruks}`, m.id) - 60) * tegnPer))
    const før = resTekst.length
    resTekst = resTekst.slice(0, rom).trimEnd() + '…'; kuttet = true; b = bygg(); tokens = anslåTokens(b.sendes, m.id)
    notater.push(`Svaret er kuttet til de første ${resTekst.length.toLocaleString('no-NO')} av ${før.toLocaleString('no-NO')} tegn for å holde budsjettet — resten blir ikke sjekket.`)
  }
  const kilderSendt = [{ id: mål.resultat.id, name: mål.resultat.name, version: mål.resultat.version, level: resNivå, vault: mål.resultat.vault }, ...ks.map(({ id, name, version, level, vault }) => ({ id, name, version, level, vault }))]
  sjekkTillatt(m, kilderSendt)   // fail closed som alltid (Trust Score) — Vault er tatt over
  return { m, sjekk: s, instruks, ...b, tokens: { ca: tokens }, budsjett: budsjett || null, over: !!budsjett && tokens > budsjett, sk, notater, mål, resultat: { id: mål.resultat.id, name: mål.resultat.name, nivå: resNivå, tegn: resTekst.length, kuttet, syntetisk: !!mål.resultat.syntetisk },
    kilder: ks.map(({ id, name, version, level }) => ({ id, name, version, level })), kilderSendt }
}
const linjeAv = (g) => `Sendes: svaret på ${g.resultat.nivå}${g.kilder.length ? ` · ${g.kilder.length} ${g.kilder.length === 1 ? 'kilde' : 'kilder'} på ${nivåTekst(g.kilder.map((k) => ({ level: k.level })))}` : ' · ingen kilder'} · ${g.sk.treff ? `${g.sk.treff} skjermet` : 'ingenting skjermet'} · ca. ${g.tokens.ca.toLocaleString('no-NO')} tokens${g.over ? ' — over budsjettet' : ''} → ${g.m.label}`
export function forhåndsvisUtfordring({ sak, vending = null, sjekk = 'svakheter', mottaker } = {}) {
  if (!sak) throw new MotorFeil('sak kreves')
  if (!mottaker) throw new MotorFeil('mottaker kreves — velg kontrollmodellen')
  const atoms = load()
  try {
    const g = utfordringsGrunnlag(atoms, { sak, vending, sjekk, mottaker })
    return { mottaker: g.m.id, label: g.m.label, sjekk: g.sjekk.id, instruks: g.instruks, tekst: g.sendes, tokens: g.tokens, budsjett: g.budsjett, over: g.over, antall: { ...g.sk.antall }, treff: g.sk.treff,
      resultat: g.resultat, kilder: g.kilder, notater: g.notater, forfatter: g.mål.forfatter, linje: linjeAv(g), blokkert: null }
  } catch (e) {
    if (!(e instanceof Blokkert)) throw e
    return { mottaker, blokkert: { feil: e.message, detaljer: e.detaljer } }
  }
}
// Utfordringene av en sak (nyeste først) slik panelet viser dem — og hvem som skrev resultatet
export function utfordringerAv(sak, { vending = null } = {}) {
  const atoms = load()
  const mål = utfordringsMål(atoms, { sak, vending })
  return { sak: mål.mål.id, navn: mål.mål.name, forfatter: mål.forfatter, vault: !!mål.resultat.vault || isVault(mål.mål), resultat: { id: mål.resultat.id, name: mål.resultat.name, syntetisk: !!mål.resultat.syntetisk, vending: mål.vending?.id || null },
    kilder: mål.kilder.map((k) => ({ id: k.id, name: k.name })), sjekker: SJEKKER.map(({ id, navn, kort, instruks }) => ({ id, navn, kort, instruks: instruksFor(id) })),
    utfordringer: utfordringerFor(atoms, mål.mål).map(utfordringVis) }
}
export const utfordringVis = (u) => ({ id: u.id, version: u.version || 1, ...u.utfordring, sjekkNavn: sjekkAv(u.utfordring?.sjekk)?.navn || '', tekst: u.content || '', info: infoAv(u) })

export async function utfordre({ sak, vending = null, sjekk = 'svakheter', mottaker, klient = 'app', signal, på = () => {} } = {}) {
  if (!sak) throw new MotorFeil('sak kreves')
  if (!mottaker) throw new MotorFeil('mottaker kreves — Erik velger kontrollmodellen hver gang (V23)')
  const atoms = load()
  const g = utfordringsGrunnlag(atoms, { sak, vending, sjekk, mottaker })
  const { m, mål } = g
  const st = await m.status(); if (!st.klar) throw new MotorFeil(`${m.label} er ikke klar: ${st.hvorfor}`)
  if (g.sk.nye.size) kjentePersoner([], { lær: [...g.sk.nye] })
  på('skjermet', { mottaker: m.id, antall: { ...g.sk.antall }, treff: g.sk.treff, ord: ord(g.sendes), tokens: g.tokens, tekst: g.sendes, budsjett: g.budsjett, over: g.over, resultat: g.resultat, kilder: g.kilder, notater: g.notater, linje: linjeAv(g) })
  const proj = mål.mål.project || 'Uten prosjekt'
  // V16: instruksen er en prompt-sak — samme sjekk i samme prosjekt er samme sak, og `ga` vokser
  const { atom: promptAtom } = upsert(atoms, { key: `prompt:utfordre:${g.sjekk.id}`, kind: 'prompt', content: g.instruks, name: `Utfordre: ${g.sjekk.navn}`, project: proj, convo: '', tags: ['prompt', 'utfordring'], source: 'Tua', by: 'regel',
    short: `Tuas faste instruks til kontrollmodellen: ${g.sjekk.navn.toLowerCase()} — ${g.sjekk.kort}`.slice(0, 300), summary: 'Instruksen «Utfordre» sender sammen med resultatet og kildene (skive C, V23).' })
  save(atoms)
  let strømmet = ''
  const r = await m.send({ system: SYSTEM_KONTROLL, melding: g.instruks, kontekst: g.kontekst, oppgave: 'utfordre' }, { signal, onDel: (t) => { strømmet += t; på('del', { mottaker: m.id, tekst: t }) } })
  const svarTekst = avskjerm(r.tekst || strømmet, g.sk.kobling).trim()
  const innvendinger = tolkInnvendinger(svarTekst)
  const tokens = { ca: g.tokens.ca, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }
  const dato = new Date().toISOString()
  const tittel = String(mål.mål.name || 'saken').slice(0, 60)
  const vault = !!mål.resultat.vault || g.kilderSendt.some((k) => k.vault)
  const { atom: u } = upsert(atoms, { key: `utfordring:${mål.mål.id}:${Date.now().toString(36)}`, kind: 'svar', content: svarTekst, name: `Utfordring (${g.sjekk.navn.toLowerCase()}): ${tittel}`.slice(0, 90), project: proj, convo: mål.mål.convo || (mål.samtale ? mål.samtale.name : ''),
    tags: ['svar', 'utfordring', m.id, ...(vault ? ['vault'] : [])], source: m.label, by: 'regel', ...(mål.mål.hørerTil ? { hørerTil: mål.mål.hørerTil } : {}),
    derivedFrom: [{ id: promptAtom.id, version: promptAtom.version || 1, level: 'L' }, ...g.kilderSendt.map(({ id, version, level }) => ({ id, version, level }))],
    short: `${kortKontroll({ mottaker: m.id, label: m.label, modell: r.modell })} utfordret «${tittel}» (${g.sjekk.navn.toLowerCase()}): ${innvendinger.length ? `${innvendinger.length} ${innvendinger.length === 1 ? 'innvending' : 'innvendinger'}` : 'ingen innvendinger'}.`.slice(0, 300) })
  u.utfordrer = { id: mål.mål.id, version: mål.mål.version || 1, ...(mål.vending ? { vending: mål.vending.id } : {}) }
  u.utfordring = { sjekk: g.sjekk.id, mottaker: m.id, label: m.label, modell: r.modell || st.modell || m.modell || '', forfatter: mål.forfatter, dato, innvendinger, låst: false, resultat: g.resultat.id, nivå: g.resultat.nivå, ...(g.notater.length ? { notater: g.notater } : {}) }
  setStatus(u, 'utkast')
  promptAtom.ga = [...(promptAtom.ga || []).filter((x) => x.id !== u.id), { id: u.id, version: u.version || 1 }]
  markDirty(atoms, u.id); markDirty(atoms, promptAtom.id)
  save(atoms)
  logDelivery({ tool: 'utfordre', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: g.kilderSendt.map(({ id, version, level }) => ({ id, version, level })),
    skjermet: { ...g.sk.antall }, ord: ord(g.sendes), tokens, prompt: promptAtom.id, svar: u.id, utfordrer: mål.mål.id, sjekk: g.sjekk.id, context: proj })
  const ferdig = { utfordring: utfordringVis(u), tokens, modell: r.modell }
  på('ferdig', ferdig)
  return ferdig
}
function hentUtfordring(atoms, id) {
  const u = atoms.find((x) => x.id === id)
  if (!u || !u.utfordring) throw new MotorFeil(`fant ikke utfordringen ${id}`)
  return u
}
export function settInnvending({ id, nr, status } = {}) {
  if (!STATUSER.includes(status)) throw new MotorFeil(`status må være ${STATUSER.join(', ')}`)
  const atoms = load()
  const u = hentUtfordring(atoms, id)
  const iv = (u.utfordring.innvendinger || []).find((x) => Number(x.nr) === Number(nr))
  if (!iv) throw new MotorFeil(`utfordringen har ingen innvending nr. ${nr}`)
  if (u.utfordring.låst) throw new MotorFeil('utfordringen er låst — start en ny utfordring for å vurdere på nytt')
  iv.status = status
  u.utfordring = { ...u.utfordring, innvendinger: [...u.utfordring.innvendinger] }
  markDirty(atoms, u.id); save(atoms)
  return utfordringVis(u)
}
const mottakerAvKilde = (navn) => { const s = String(navn || '').toLowerCase(); return lagMottakere().find((m) => s && (s.includes(m.id) || s.includes(String(m.label).split(' (')[0].toLowerCase()) || (m.id === 'openai' && /gpt|chatgpt/.test(s)) || (m.id === 'ollama' && /gemma|llama|qwen|lokal/.test(s)) || (m.id === 'claude' && /claude|opus|sonnet|haiku/.test(s)))) || null }
export async function nyVersjon({ id, mottaker = null, klient = 'app', signal, på = () => {} } = {}) {
  const atoms = load()
  const u = hentUtfordring(atoms, id)
  const godtatt = (u.utfordring.innvendinger || []).filter((x) => x.status === 'godtatt')
  if (!godtatt.length) throw new MotorFeil('godta minst én innvending før du ber om en ny versjon')
  // forfattermodellen når den er klar, ellers kontrollmodellen (som da skriver om sitt eget utgangspunkt — det sies i svaret: label)
  const forfatterM = mottaker ? null : mottakerAvKilde(u.utfordring.forfatter)
  const mId = mottaker || (forfatterM && (await forfatterM.status()).klar ? forfatterM.id : u.utfordring.mottaker)
  const g = utfordringsGrunnlag(atoms, { sak: u.utfordrer.id, vending: u.utfordrer.vending || null, sjekk: u.utfordring.sjekk, mottaker: mId })
  const { m, mål } = g
  const st = await m.status(); if (!st.klar) throw new MotorFeil(`${m.label} er ikke klar: ${st.hvorfor}`)
  const oppgave = 'Skriv SVARET under på nytt, med de godtatte innvendingene tatt inn. Behold det som ikke berøres av dem, og behold formen og språket. ' +
    'Svar bare med den nye teksten — ingen innledning, ingen liste over endringer. Bruk plassholdere som [Person A] uendret.'
  const kontekst = `${g.kontekst.replace(/^## Svaret som skal utfordres[^\n]*/, '## Svaret')}\n\n## Godtatte innvendinger\n\n${godtatt.map((x) => `- ${g.sk.skjerm(x.tekst)}${x.hvor ? ` (hvor: ${g.sk.skjerm(x.hvor)})` : ''}${x.begrunnelse ? ` — ${g.sk.skjerm(x.begrunnelse)}` : ''}`).join('\n')}`
  const sendes = `${SYSTEM}\n\n${byggMelding(oppgave, kontekst)}`
  const tokensCa = anslåTokens(sendes, m.id)
  på('skjermet', { mottaker: m.id, treff: g.sk.treff, tokens: { ca: tokensCa }, notater: g.notater })
  const r = await m.send({ system: SYSTEM, melding: oppgave, kontekst, oppgave: 'ny-versjon' }, { signal, onDel: (t) => på('del', { mottaker: m.id, tekst: t }) })
  const tekst = avskjerm(r.tekst, g.sk.kobling).trim()
  const tittel = String(mål.mål.name || 'saken').slice(0, 70)
  const { atom: nv } = upsert(atoms, { key: `ny-versjon:${u.id}`, kind: 'svar', content: tekst, name: `Ny versjon: ${tittel}`.slice(0, 90), project: mål.mål.project, convo: mål.mål.convo || (mål.samtale ? mål.samtale.name : ''),
    tags: ['svar', 'ny-versjon', m.id, ...((u.tags || []).includes('vault') ? ['vault'] : [])], source: m.label, by: 'regel', ...(mål.mål.hørerTil ? { hørerTil: mål.mål.hørerTil } : {}),
    derivedFrom: [{ id: u.id, version: u.version || 1, level: 'L' }, ...g.kilderSendt.map(({ id: kid, version, level }) => ({ id: kid, version, level }))],
    short: `Ny versjon av «${tittel}» fra ${m.label}, med ${godtatt.length} ${godtatt.length === 1 ? 'innvending' : 'innvendinger'} fra ${kortKontroll(u.utfordring)} tatt inn.`.slice(0, 300) })
  setStatus(nv, 'utkast')
  u.utfordring = { ...u.utfordring, nyVersjon: nv.id }
  markDirty(atoms, u.id); save(atoms)
  logDelivery({ tool: 'ny-versjon', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: [{ id: u.id, version: u.version || 1, level: 'L' }, ...g.kilderSendt.map(({ id: kid, version, level }) => ({ id: kid, version, level }))],
    skjermet: { ...g.sk.antall }, ord: ord(sendes), tokens: { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null }, svar: nv.id, utfordrer: mål.mål.id, context: mål.mål.project })
  const ferdig = { id: nv.id, version: nv.version || 1, name: nv.name, tekst, mottaker: m.id, label: m.label, modell: r.modell, utfordring: utfordringVis(u) }
  på('ferdig', ferdig)
  return ferdig
}
export function låsUtfordring({ id } = {}) {
  const atoms = load()
  const u = hentUtfordring(atoms, id)
  const sak = atoms.find((x) => x.id === u.utfordrer.id)
  const iv = u.utfordring.innvendinger || []
  const info = infoAv(u)
  const nv = u.utfordring.nyVersjon ? atoms.find((x) => x.id === u.utfordring.nyVersjon) : null
  const liste = (l) => l.map((x) => `- ${x.tekst}${x.begrunnelse ? ` — ${x.begrunnelse}` : ''}`).join('\n')
  const tatt = iv.filter((x) => x.status === 'godtatt'), avvist = iv.filter((x) => x.status === 'avvist'), åpne = iv.filter((x) => !x.status || x.status === 'åpen')
  const tekst = [`${info.tekst} (${info.sjekkNavn.toLowerCase()}).`,
    tatt.length ? `## Tatt inn\n\n${liste(tatt)}` : '', avvist.length ? `## Avvist\n\n${liste(avvist)}` : '', åpne.length ? `## Ikke vurdert\n\n${liste(åpne)}` : '',
    !iv.length ? 'Kontrollmodellen hadde ingen innvendinger.' : '', nv ? `## Ny versjon\n\n${nv.content || ''}` : ''].filter(Boolean).join('\n\n')
  const navn = String(sak?.name || u.name).slice(0, 70)
  const { atom: k } = upsert(atoms, { key: `konklusjon:utfordring:${u.id}`, kind: 'konklusjon', content: tekst, name: `Konklusjon etter utfordring: ${navn}`.slice(0, 90), project: u.project, convo: u.convo || '', tags: ['konklusjon', 'utfordring', ...((u.tags || []).includes('vault') ? ['vault'] : [])],
    source: 'Tua', by: 'regel', ...(u.hørerTil ? { hørerTil: u.hørerTil } : {}),
    derivedFrom: [...(sak ? [{ id: sak.id, version: sak.version || 1, level: 'L' }] : []), { id: u.id, version: u.version || 1, level: 'L' }, ...(nv ? [{ id: nv.id, version: nv.version || 1, level: 'L' }] : [])],
    short: `${info.tekst}. Låst av brukeren.`.slice(0, 300) })
  setStatus(k, 'endelig')
  u.utfordring = { ...u.utfordring, låst: true, konklusjon: k.id, låstDato: new Date().toISOString() }
  setStatus(u, 'endelig')
  markDirty(atoms, u.id); save(atoms)
  return { konklusjon: { id: k.id, name: k.name, version: k.version || 1, tekst }, utfordring: utfordringVis(u) }
}
