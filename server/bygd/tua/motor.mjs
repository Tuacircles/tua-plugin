// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import path__default from 'node:path';
import { fileURLToPath } from 'node:url';
import { LONG_L, load, logDelivery, LEVELS, filesMode, FILES_ROOT, DATA_DIR, clampLevel, maxLevel, isVault, levelOf, upsert, save } from './store.mjs';
import { hasKey, ollamaStatus, readKey } from './keychain.mjs';
import { OLLAMA_VERT, OLLAMA_URL } from './ollama.mjs';
import { løsMottakere as l_sMottakere, delingerFor, nyttToken, lenkerFor, eier, lagreDeling, registrerDeling, skrivMottakere } from './deling.mjs';

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


const HERE = path__default.dirname(fileURLToPath(new URL("../../motor.js", import.meta.url).href));
const TRUST_FILE = path__default.join(HERE, 'trust-scores.json');
// Trust Score per connector — én JSON-fil, leses ved hvert kall så rettelser virker uten omstart (M15). Anslag; rettes i fila.
// Skive 5 (arbeidsstykke 30 §7): fila har `endepunkter` — én rad per endepunkt (id, leverandør, label, endpoint, region, score, de fire
// parametrene, anbefaling, svakest, kilde, dato). `ai` avledes av den (første rad per leverandør) så Spør-raden, /api/settings og alt
// som leser ts.ai.<leverandør> virker som før. Den gamle forma (bare `ai`) leses også: da avledes `endepunkter` fra den.
const trustScores = () => {
  let ts;
  try { ts = JSON.parse(fs__default.readFileSync(TRUST_FILE, 'utf8')); } catch (e) { return { _merk: `trust-scores.json kunne ikke leses: ${e.message}`, sky: {}, ai: {}, endepunkter: [] } }
  const endepunkter = Array.isArray(ts.endepunkter) ? ts.endepunkter
    : Object.entries(ts.ai || {}).map(([id, v]) => ({ id, leverandør: id, ...v }));
  const ai = {};
  for (const e of endepunkter) { const lev = e.leverandør || e.id; if (lev && !ai[lev]) ai[lev] = e; }
  return { ...ts, sky: ts.sky || {}, endepunkter, ai: { ...ai, ...(Array.isArray(ts.endepunkter) ? {} : ts.ai || {}) } }
};
const trustFor = (id) => { const ts = trustScores(); return ts.endepunkter.find((e) => e.id === id) || ts.ai[id] || null };

class Blokkert extends Error { constructor(msg, detaljer = []) { super(msg); this.name = 'Blokkert'; this.kode = 'blokkert'; this.detaljer = detaljer; } }
class MotorFeil extends Error { constructor(msg) { super(msg); this.name = 'MotorFeil'; this.kode = 'feil'; } }

// ── Ord og tokens ───────────────────────────────────────────────────────────
// Tokens kan ikke måles eksakt før sending (K7). Lokalt anslag = tegn / faktor, alltid merket «ca.»; eksakt fra usage etter svar.
// Faktoren er per mottaker, målt 23.10.2026 på samme norske tekst: gemma3:4b (Ollama) ≈ 3,5 tegn per token (788 eksakt mot 826 anslått),
// Claude Opus 5.5 ≈ 1,9 (1 645 eksakt mot 826 anslått med 3,5) — Claudes tokenizer deler norsk finere. Ukjent mottaker: 3,5.
const ord = (t) => (String(t || '').match(/\S+/g) || []).length;
// Mistral: 3,0 er et anslag (ikke målt ennå — rettes etter første ekte sending; eksakt usage kommer tilbake i Utlevert).
const TEGN_PER_TOKEN = { claude: 1.9, ollama: 3.5, mistral: 3.0, test: 3.5, test2: 3.5 };
const anslåTokens = (t, mottaker) => Math.round(String(t || '').length / (TEGN_PER_TOKEN[mottaker] || 3.5));

// ── 1) Skjerming ────────────────────────────────────────────────────────────
// Fornavn-lista oppdager «Fornavn Etternavn» i tekst (K5: navn uten typisk etternavnsending slapp gjennom). Ikke uttømmende —
// det er det kjent-personer-lista er til, og modellbasert gjenkjenning kommer som tredje lag når lokal modell finnes (D3).
const FORNAVN = new Set((
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
).split(/\s+/).filter(Boolean));

// Stoppliste: ord som gjør at en kandidat IKKE er en person (firma, produkt, Tuas egne ord). Sjekkes mot hvert ord i kandidaten.
const STOPP = new Set(('Tua Circles Claude Code Desktop Cowork Vault Trust Score Drive Google Apple Dropbox OneDrive Copilot ChatGPT ' +
  'Gemini Mistral Ollama Anthropic OpenAI Microsoft Keychain Holding AS ASA Business Innboks Finder Spotlight Kartet Forsiden Spør ' +
  'Innstillinger Design Classical Vite React Node Mac iPhone iPad Windows Linux BankID Altinn Entra Okta Skigaarden Skado').split(/\s+/));

const ETTERNAVN = '[A-ZÆØÅ][a-zæøåé]+(?:-[A-ZÆØÅ][a-zæøåé]+)?';
const navneKandidat = (s) => s.split(/\s+/).every((w) => !STOPP.has(w)) && s.split(/\s+/).length >= 2;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Fødselsnummer: 11 siffer, to kontrollsiffer etter mod 11. D-nummer (dag + 40) og H-nummer går gjennom samme kontroll.
const V1 = [3, 7, 6, 1, 8, 9, 4, 5, 2], V2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const kontroll = (d, v) => { const s = d.reduce((a, x, i) => a + x * v[i], 0); const r = 11 - (s % 11); return r === 11 ? 0 : r };
function gyldigFødselsnummer(s) {
  const d = String(s).replace(/\s/g, '').split('').map(Number);
  if (d.length !== 11 || d.some(Number.isNaN)) return false
  const k1 = kontroll(d.slice(0, 9), V1); if (k1 === 10 || k1 !== d[9]) return false
  const k2 = kontroll(d.slice(0, 10), V2); return k2 !== 10 && k2 === d[10]
}

// Reglene i prioritert rekkefølge: en tidligere regel vinner der treff overlapper (fødselsnummer før telefon, org.nr før beløp, adresse før navn).
const GATE = '(?:gate|gata|gaten|veien|vegen|vei|veg|plass|plassen|allé|alleen|svingen|stien|terrasse|terrassen|bakken|lia|haugen|tunet|kroken|faret|løkka|toppen|åsen|moen|jordet|brygge|kaia|torget|torg)';
const REGLER = [
  { type: 'fødselsnummer', plass: 'Fødselsnummer', re: /(?<!\d)(\d{6})\s?(\d{5})(?!\d)/g, ok: (m) => gyldigFødselsnummer(m[1] + m[2]) },
  { type: 'epost', plass: 'E-post', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { type: 'orgnr', plass: 'Org.nr', re: /\b(?:org\.?\s?nr\.?|orgnr|organisasjonsnummer|organisasjonsnr\.?)\s*:?\s*(\d{3}\s?\d{3}\s?\d{3})(?!\d)|\bNO\s?(\d{3}\s?\d{3}\s?\d{3})\s?MVA\b/gi, gruppe: true },
  { type: 'adresse', plass: 'Adresse', re: new RegExp(`\\b[A-ZÆØÅ][a-zæøåé.'-]*(?:\\s[A-ZÆØÅa-zæøåé.'-]+){0,2}?\\s?${GATE}\\s\\d{1,4}\\s?[A-Za-z]?\\b(?:,?\\s\\d{4}\\s[A-ZÆØÅ][a-zæøåé]+)?`, 'g') },
  { type: 'telefon', plass: 'Telefon', re: /(?<![\d+])(?:(?:\+47|0047)\s?(?:\d{3}\s?\d{2}\s?\d{3}|\d{2}\s?\d{2}\s?\d{2}\s?\d{2})|[2-9]\d{2}\s\d{2}\s\d{3}|[2-9]\d\s\d{2}\s\d{2}\s\d{2}|[49]\d{7})(?!\d)/g },
  { type: 'beløp', plass: 'Beløp', re: /(?:\b(?:kr|NOK)\.?\s?\d[\d  .]*(?:,\d{1,2})?(?:\s?(?:mill\.?|millioner|mrd\.?|milliarder))?)|(?:(?<![\d,.])\d[\d  .]*(?:,\d{1,2})?\s?(?:mill\.?|millioner|mrd\.?|milliarder)?\s?(?:kr\b|kroner\b|NOK\b|,-))/g },
];
const bokstav = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s };

// En skjermer holder plassholderne stabile på tvers av flere tekster i SAMME sending (meldingen og konteksten).
// kobling: plassholder → original (bare her, hos kalleren) · antall: per type · nye: personer oppdaget av fornavn-regelen (lagres i kjent-lista).
function lagSkjermer(kjente = []) {
  const kobling = {}, tilPlass = {}, antall = {}, teller = {}, nye = new Set();
  const kjentRe = kjente.length ? new RegExp(`\\b(?:${[...kjente].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`, 'g') : null;
  const fornavnRe = new RegExp(`\\b(${[...FORNAVN].map(escapeRe).join('|')})(\\s${ETTERNAVN}){1,2}\\b`, 'g');
  const plassFor = (type, plass, original) => {
    const key = type + '\u0000' + original.replace(/\s+/g, ' ');
    if (tilPlass[key]) return tilPlass[key]
    teller[type] = (teller[type] || 0) + 1;
    const p = type === 'navn' ? `[Person ${bokstav(teller[type] - 1)}]` : `[${plass} ${teller[type]}]`;
    tilPlass[key] = p; kobling[p] = original;
    return p
  };
  function skjerm(tekst) {
    const t = String(tekst || '');
    const treff = [];
    // nøkkel: hva plassholderen står for (for «Kari» alene: hele «Kari Nordmann», så begge får [Person A])
    const legg = (type, plass, start, end, prio, nøkkel) => {
      const original = t.slice(start, end).replace(/\s+$/, ''); end = start + original.length;
      if (!original) return
      if (treff.some((x) => start < x.end && end > x.start)) return   // tidligere regel vinner
      treff.push({ type, plass, start, end, original: nøkkel || original, prio });
    };
    REGLER.forEach((r, prio) => {
      for (const m of t.matchAll(r.re)) {
        if (r.ok && !r.ok(m)) continue
        if (r.gruppe) { const g = m[1] ?? m[2]; const off = m[0].indexOf(g); legg(r.type, r.plass, m.index + off, m.index + off + g.length, prio); continue }
        legg(r.type, r.plass, m.index, m.index + m[0].length, prio);
      }
    });
    // Navn: kjent-lista først (hele navn), så fornavn-regelen. Deretter samme persons fornavn/etternavn alene → samme plassholder.
    const personer = new Set();
    if (kjentRe) for (const m of t.matchAll(kjentRe)) { legg('navn', 'Person', m.index, m.index + m[0].length, 10); personer.add(m[0]); }
    for (const m of t.matchAll(fornavnRe)) { if (!navneKandidat(m[0])) continue; legg('navn', 'Person', m.index, m.index + m[0].length, 11); personer.add(m[0]); if (!kjente.includes(m[0])) nye.add(m[0]); }
    for (const navn of personer) {
      const deler = navn.split(/\s+/);
      for (const del of deler) {
        if (del.length < 4 && !FORNAVN.has(del)) continue
        for (const m of t.matchAll(new RegExp(`\\b${escapeRe(del)}\\b`, 'g'))) legg('navn', 'Person', m.index, m.index + del.length, 12, navn);
      }
    }
    treff.sort((a, b) => a.start - b.start);
    let ut = '', pos = 0;
    for (const x of treff) {
      antall[x.type] = (antall[x.type] || 0) + 1;
      ut += t.slice(pos, x.start) + plassFor(x.type, x.plass, x.original);
      pos = x.end;
    }
    return ut + t.slice(pos)
  }
  return { skjerm, kobling, antall, nye, get treff() { return Object.values(antall).reduce((a, b) => a + b, 0) } }
}
// Svaret kommer tilbake med plassholderne — de byttes tilbake lokalt før svaret vises og lagres.
function avskjerm(tekst, kobling = {}) {
  let t = String(tekst || '');
  for (const [p, o] of Object.entries(kobling)) t = t.split(p).join(o);
  return t
}

// ── Kjent-personer-lista ────────────────────────────────────────────────────
// Bygges av arkivets egne saker (titler, samtale, prosjekt, tagger) med fornavn-regelen, og vokser av bruk: navn som skjermingen
// oppdager i det som sendes, legges til. Lagres lokalt i .tua/kjente-personer.json — bare navn, aldri hva de ble sendt med.
const KJENTE = () => (filesMode() ? path__default.join(FILES_ROOT, '.tua', 'kjente-personer.json') : path__default.join(DATA_DIR, 'kjente-personer.json'));
const lesKjente = () => { try { const j = JSON.parse(fs__default.readFileSync(KJENTE(), 'utf8')); return { navn: Array.isArray(j.navn) ? j.navn : [], stopp: Array.isArray(j.stopp) ? j.stopp : [] } } catch { return { navn: [], stopp: [] } } };
function skrivKjente(k) { try { fs__default.mkdirSync(path__default.dirname(KJENTE()), { recursive: true }); fs__default.writeFileSync(KJENTE(), JSON.stringify({ ...k, oppdatert: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 }); } catch {} }
function kjentePersoner(atoms = [], { lær = [] } = {}) {
  const k = lesKjente();
  const før = k.navn.length;
  const sett = new Set(k.navn), stopp = new Set(k.stopp);
  // To mønstre i feltene: «Fornavn Etternavn» med kjent fornavn, og «med/fra/til/hos/… Ukjent Etternavn» — det siste er det som
  // fanger navnene fornavn-lista ikke kjenner («Møte med Xenia Fjeldstad»). Treffene gjelder bare felt, aldri innholdet (det tar skjerm()).
  const fornavnRe = new RegExp(`\\b(${[...FORNAVN].map(escapeRe).join('|')})(\\s${ETTERNAVN}){1,2}\\b`, 'g');
  const kontekstRe = new RegExp(`\\b(?:med|fra|til|hos|for|av|ved|v/|og|kontakt|møte|intervju|samtale)\\s+(${ETTERNAVN}(?:\\s${ETTERNAVN}){1,2})\\b`, 'g');
  const felt = (a) => [a.name, a.convo, a.project, ...(a.tags || [])].filter(Boolean).join(' · ');
  for (const a of atoms) {
    const f = felt(a);
    for (const m of f.matchAll(fornavnRe)) if (navneKandidat(m[0]) && !stopp.has(m[0])) sett.add(m[0]);
    for (const m of f.matchAll(kontekstRe)) if (navneKandidat(m[1]) && !stopp.has(m[1])) sett.add(m[1]);
  }
  for (const n of lær) if (n && navneKandidat(n) && !stopp.has(n)) sett.add(n);
  k.navn = [...sett].sort();
  if (k.navn.length !== før) skrivKjente(k);
  return k.navn
}

// ── 2) Minimering ───────────────────────────────────────────────────────────
// Konteksten bygges av valgte saker på valgt nivå per sak (S standard når nivå mangler; L bare når eksplisitt valgt).
// Nivået klampes til det prosjektet får se (maxLevel, V11). Vault klampes IKKE her — det er fail closed i sjekkTillatt().
// Det som sendes om saken er tittel, versjon og nivå — ikke prosjekt, samtale eller tagger (Trust Score-teksten lover det).
function minimer(atoms, saker = [], { prosjekt } = {}) {
  const kilder = [], deler = [], notater = [];
  for (const s of saker) {
    const id = typeof s === 'string' ? s : s.id;
    const a = atoms.find((x) => x.id === id);
    if (!a) { notater.push(`fant ikke sak ${id}`); continue }
    const ønsket = LEVELS.includes(s.nivå) ? s.nivå : LEVELS.includes(s.level) ? s.level : 'S';
    const eff = clampLevel(ønsket, maxLevel(a, prosjekt));
    if (eff !== ønsket) notater.push(`«${a.name}»: ${prosjekt} ser bare ${eff}, ikke ${ønsket}`);
    const got = levelOf(a, eff);
    const tekst = got.text.trim();
    kilder.push({ id: a.id, name: a.name, version: a.version || 1, level: eff, ønsket, vault: isVault(a), fallback: got.fallback ? got.level : null, tegn: tekst.length, ord: ord(tekst) });
    deler.push(`## ${a.name}\n_v${a.version || 1} · nivå ${eff}_\n\n${tekst}`);
  }
  return { kontekst: deler.join('\n\n'), kilder, notater }
}

// ── 3) Mottakere og fail closed ─────────────────────────────────────────────
// Hva Trust Score (1–5) tillater: S til alle, M fra 3, L fra 4. Vault-merkede saker (V15) bare som S — unntatt til en lokal
// modell (trust-scores.json: «den eneste modellen som får lese L av Vault-merkede atomer»).
const NIVÅ_KREVER_TRUST = { S: 1, M: 3, L: 4 };
function sjekkTillatt(mottaker, kilder) {
  const score = Number(mottaker.trust?.score) || 1;
  const maks = LEVELS.filter((l) => NIVÅ_KREVER_TRUST[l] <= score).at(-1) || 'S';
  const problemer = [];
  for (const k of kilder) {
    if (k.vault && k.level !== 'S' && !mottaker.local) problemer.push(`«${k.name}» er Vault-merket og kan bare sendes som S til ${mottaker.label}. Sett nivået til S, ta saken ut, eller send til en lokal modell.`);
    else if (NIVÅ_KREVER_TRUST[k.level] > score) problemer.push(`${mottaker.label} har Trust Score ${score}/5 — nivå ${k.level} krever minst ${NIVÅ_KREVER_TRUST[k.level]}. Sett «${k.name}» til ${maks}, eller velg en mottaker med høyere Trust Score.`);
  }
  if (problemer.length) throw new Blokkert(`Sendingen er stoppet (${problemer.length} ${problemer.length === 1 ? 'sak' : 'saker'}): ${problemer.join(' ')}`, problemer)
  return { maks }
}

const SYSTEM = 'Du svarer på norsk, kort og presist. Teksten under «Kontekst» er hentet fra brukerens eget arkiv (Tua) og kan inneholde ' +
  'plassholdere som [Person A], [E-post 1] eller [Adresse 1]. Det er skjermede opplysninger: bruk plassholderne uendret i svaret, ' +
  'og ikke gjett hva de står for.';
const byggMelding = (melding, kontekst) => (kontekst ? `${melding.trim()}\n\n---\n\nKontekst\n\n${kontekst}` : melding.trim());
// Skive 6: send() tar også `json` (svaret skal være ett JSON-objekt — Ollama får format: json, Claude får det i system-teksten) og `oppgave`
// ('forskjeller' | 'konklusjon' — bare test-mottakeren bryr seg: den svarer med et fast, tolkbart svar så testene aldri trenger en modell).
const JSON_KRAV = ' Svar BARE med ett gyldig JSON-objekt — ingen tekst før eller etter, ingen kodeblokk.';

const CLAUDE_MODELL = 'claude-opus-5-5';
// Claude via egen nøkkel (D2'). Nøkkelen leses fra Keychain i selve kallet og lever bare i klient-objektet til kallet er ferdig.
// Strømmer tekstbiter til onDel; adaptiv tenkning; server-side fallback «default» slik at et avslag fra sikkerhetsklassifisering
// kjøres på nytt på modellen Anthropic anbefaler (beta server-side-fallback-2026-07-01). Avslag etter fallback → MotorFeil.
async function sendClaude({ system, melding, kontekst, json }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('claude');
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for Claude i Keychain. Legg den inn under Innstillinger › AI-mottakere (console.anthropic.com › API keys).')
  const { default: Anthropic } = await import('../vendor/@anthropic-ai/sdk/index.mjs');
  const client = new Anthropic({ apiKey: nøkkel });
  nøkkel = null;
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODELL, max_tokens: 64000, thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system: json ? system + JSON_KRAV : system, messages: [{ role: 'user', content: byggMelding(melding, kontekst) }],
  }, { signal });
  for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onDel(ev.delta.text);
  const fm = await stream.finalMessage();
  if (fm.stop_reason === 'refusal') throw new MotorFeil(`Claude avslo forespørselen${fm.stop_details?.explanation ? `: ${fm.stop_details.explanation}` : ''}. Ingenting er lagret som svar.`)
  const tekst = fm.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { tekst, modell: fm.model, usage: { input_tokens: fm.usage?.input_tokens ?? null, output_tokens: fm.usage?.output_tokens ?? null }, stopp: fm.stop_reason }
}

// Ollama lokalt (V18: lokal modell først når den finnes). Modell (friksjon 12): den som er valgt som standard i Innstillinger › AI-mottakere › Modeller
// (~/.tua/config.json → ollama.modell), TUA_OLLAMA_MODELL foran (bare tester), ellers den første i lista — ollama.js: standardModell(). NDJSON-strøm fra /api/chat.
async function sendOllama({ system, melding, kontekst, json }, { onDel = () => {}, signal } = {}) {
  const st = await ollamaStatus();
  if (!st.running || !st.models.length) throw new MotorFeil(`Ollama kjører ikke på ${OLLAMA_VERT}, eller har ingen modell (hent én under Innstillinger › AI-mottakere › Modeller).`)
  const model = st.modell || st.models[0];
  const body = { model, stream: true, messages: [{ role: 'system', content: json ? system + JSON_KRAV : system }, { role: 'user', content: byggMelding(melding, kontekst) }], ...(json ? { format: 'json' } : {}) };
  const r = await fetch(OLLAMA_URL + '/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) throw new MotorFeil(`Ollama svarte ${r.status}`)
  let tekst = '', rest = '', usage = { input_tokens: null, output_tokens: null };
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true });
    const linjer = rest.split('\n'); rest = linjer.pop();
    for (const l of linjer) {
      if (!l.trim()) continue
      const j = JSON.parse(l);
      const bit = j.message?.content || '';
      if (bit) { tekst += bit; onDel(bit); }
      if (j.done) usage = { input_tokens: j.prompt_eval_count ?? null, output_tokens: j.eval_count ?? null };
    }
  }
  return { tekst, modell: model, usage, stopp: 'end_turn' }
}

// Mistral (skive 6-tillegg, arbeidsstykke 30: «første skymodell å prøve for europeiske forretningsdata» — api.mistral.ai, EU). Egen nøkkel fra
// Keychain (tua-ai-mistral), lest i kallet og glemt etterpå. Chat completions strømmet som SSE («data: {…}», «data: [DONE]»); siste bit har
// usage. json → response_format json_object + JSON_KRAV i systemet. Modell: TUA_MISTRAL_MODELL eller mistral-large-latest. Aldri kalt i tester
// (nøkkelen finnes ikke under testprefikset).
const MISTRAL_MODELL = process.env.TUA_MISTRAL_MODELL || 'mistral-large-latest';
async function sendMistral({ system, melding, kontekst, json }, { onDel = () => {}, signal } = {}) {
  let nøkkel = readKey('mistral');
  if (!nøkkel) throw new MotorFeil('Ingen API-nøkkel for Mistral i Keychain. Legg den inn under Innstillinger › AI-mottakere (console.mistral.ai › API keys).')
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${nøkkel}` },
    body: JSON.stringify({ model: MISTRAL_MODELL, stream: true, ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: json ? system + JSON_KRAV : system }, { role: 'user', content: byggMelding(melding, kontekst) }] }),
  });
  nøkkel = null;
  if (!r.ok || !r.body) { const t = await r.text().catch(() => ''); throw new MotorFeil(`Mistral svarte ${r.status}${t ? `: ${t.slice(0, 200)}` : ''}`) }
  let tekst = '', rest = '', modell = MISTRAL_MODELL, stopp = 'end_turn', usage = { input_tokens: null, output_tokens: null };
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true });
    const linjer = rest.split('\n'); rest = linjer.pop();
    for (const l of linjer) {
      const d = l.startsWith('data:') ? l.slice(5).trim() : '';
      if (!d || d === '[DONE]') continue
      let j; try { j = JSON.parse(d); } catch { continue }
      const bit = j.choices?.[0]?.delta?.content;
      if (typeof bit === 'string' && bit) { tekst += bit; onDel(bit); }
      if (j.choices?.[0]?.finish_reason) stopp = j.choices[0].finish_reason;
      if (j.model) modell = j.model;
      if (j.usage) usage = { input_tokens: j.usage.prompt_tokens ?? null, output_tokens: j.usage.completion_tokens ?? null };
    }
  }
  return { tekst, modell, usage, stopp }
}

// Test-mottakerne: ekkoer det som ville blitt sendt, i biter, uten å sende noe ut av maskinen. Trust 3 → S og M går, L blokkeres (fail closed kan prøves).
// Som vurderer (TUA_VURDERER=test) svarer «test» med faste, tolkbare forskjeller (JSON over bokstavene A, B … i konteksten) og en fast konklusjon.
// «test2» (bare med TUA_TESTMOTTAKERE=2, til testene) ekkoer ANNERLEDES enn «test» — overskriftene i konteksten og et tilleggspunkt — så to
// svar på samme spørsmål faktisk er forskjellige og Forskjeller har noe å finne.
// Friksjonsrunde 1: strømmen stopper når signal avbrytes (som en ekte mottaker) — så «Stopp» kan testes uten modell.
const avbruttFeil = () => { const e = new Error('avbrutt'); e.name = 'AbortError'; return e };
const strøm = async (ut, onDel, signal) => { for (const b of ut.match(/[\s\S]{1,120}/g) || []) { if (signal?.aborted) throw avbruttFeil(); await new Promise((r) => setTimeout(r, 2)); onDel(b); } };
const testSvar = (ut, inn, id) => ({ tekst: ut, modell: 'ekko', usage: { input_tokens: anslåTokens(inn, id), output_tokens: anslåTokens(ut, id) }, stopp: 'end_turn' });
async function sendTest({ system, melding, kontekst, oppgave }, { onDel = () => {}, signal } = {}) {
  const inn = system + melding + kontekst;
  if (oppgave === 'forskjeller') {
    const bokstaver = [...String(kontekst).matchAll(/^## Svar ([A-Z]+)\b/gm)].map((m) => m[1]);
    const ut = JSON.stringify({
      enig: [{ punkt: 'Alle svarene gjengir spørsmålet og konteksten som ble sendt.', svar: bokstaver }],
      uenig: [{ punkt: 'Svarene formulerer seg ulikt om det samme innholdet.', svar: bokstaver }],
      unikt: bokstaver.length ? [{ punkt: `Svar ${bokstaver.at(-1)} har et tilleggspunkt de andre ikke har med.`, svar: [bokstaver.at(-1)] }] : [],
    });
    await strøm(ut, onDel); return testSvar(ut, inn, 'test')
  }
  if (oppgave === 'konklusjon') {
    const ut = 'Utkast til konklusjon (test-mottakeren, ingenting sendt ut av maskinen): svarene er enige om hovedsaken, uenige i formuleringen, og ett av dem har et tilleggspunkt. Rett teksten og lås den når den stemmer.';
    await strøm(ut, onDel); return testSvar(ut, inn, 'test')
  }
  if (oppgave === 'nivåer') {   // skive 7: fast, tolkbar S/M for en innlest fil — første linje i konteksten (etter overskriften) som ingress, teksten flatet som sammendrag
    const flat = String(kontekst).replace(/^## .*\n+/, '').replace(/\s+/g, ' ').trim();
    const ut = JSON.stringify({ S: `Test-ingress: ${flat.slice(0, 200)}`, M: `Test-sammendrag (ingenting sendt ut av maskinen): ${flat.slice(0, 1200)}` });
    await strøm(ut, onDel); return testSvar(ut, inn, 'test')
  }
  const ut = `Ekko fra test-mottakeren (ingenting er sendt ut av maskinen).\n\nSystem: ${system}\n\n${byggMelding(melding, kontekst)}`;
  await strøm(ut, onDel, signal); return testSvar(ut, inn, 'test')
}
async function sendTest2({ melding, kontekst }, { onDel = () => {}, signal } = {}) {
  const overskrifter = [...String(kontekst).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const ut = `EKKO B (test-mottaker 2 — ingenting er sendt ut av maskinen).\n\nSpørsmålet var: ${melding.trim()}\n\nKildene jeg fikk: ${overskrifter.length ? overskrifter.join(' · ') : 'ingen'}.\n\nTilleggspunkt bare fra B: dette svaret ser saken fra en annen vinkel enn test-mottaker 1.`;
  await strøm(ut, onDel, signal); return testSvar(ut, melding + kontekst, 'test2')
}

const TEST_TRUST = (label, kilde) => ({ score: 3, label, endpoint: 'lokalt', region: 'lokalt', metadata: 'Ingen — ingenting sendes.', innhold: 'Forlater aldri maskinen; viser bare det som ville blitt sendt.', mining: 'Ingen.', retensjon: 'Bare Tuas egen Utlevert-linje (metadata).', svakest: null, kilde, dato: '2026-10-23' });
// Mottaker-grensesnittet. status() svarer klar/ikke klar med grunn — aldri nøkkelverdier. send() nås bare gjennom spor(), forskjeller() og konklusjon().
function lagMottakere() {
  const ts = trustScores().ai || {};
  const liste = [
    { id: 'claude', label: 'Claude (Anthropic)', endpoint: 'api.anthropic.com', modell: CLAUDE_MODELL, trust: ts.claude || null, nøkkel: true,
      status: async () => (hasKey('claude') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendClaude },
    { id: 'ollama', label: 'Ollama (lokal)', endpoint: OLLAMA_VERT, modell: process.env.TUA_OLLAMA_MODELL || null, trust: ts.ollama || null, local: true,
      // friksjon 12: modell = standardmodellen (valgt i Innstillinger, ellers første), modeller = alle lokale
      status: async () => { const s = await ollamaStatus(); return s.running && s.models.length ? { klar: true, modeller: s.models, modell: s.modell } : { klar: false, hvorfor: s.running ? 'Ollama kjører, men har ingen modell — hent én under Innstillinger › AI-mottakere › Modeller' : 'Ollama kjører ikke' } }, send: sendOllama },
    // Mistral (skive 6-tillegg): første ekstra skymodell. Raden blir av seg selv en rad i Innstillinger › AI-mottakere og en avkryssing i Spør.
    { id: 'mistral', label: 'Mistral', endpoint: 'api.mistral.ai', modell: MISTRAL_MODELL, trust: ts.mistral || null, nøkkel: true,
      status: async () => (hasKey('mistral') ? { klar: true } : { klar: false, hvorfor: 'ingen API-nøkkel i Keychain (Innstillinger › AI-mottakere)' }), send: sendMistral },
    { id: 'test', label: 'Test (ekko — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: TEST_TRUST('Test', 'Tua selv: ekko-mottakeren i motor.js. Score 3 er satt lavt med vilje så fail closed kan prøves (L blokkeres).'), test: true,
      status: async () => ({ klar: true }), send: sendTest },
  ];
  const tm = String(process.env.TUA_TESTMOTTAKERE || '');
  if (tm === '2' || tm === '3') liste.push({ id: 'test2', label: 'Test 2 (ekko B — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: TEST_TRUST('Test 2', 'Tua selv: andre ekko-mottaker i motor.js (TUA_TESTMOTTAKERE=2) — svarer annerledes enn Test så Forskjeller kan testes uten modell.'), test: true, status: async () => ({ klar: true }), send: sendTest2 });
  // friksjon 15 (TUA_TESTMOTTAKERE=3): en LOKAL ekko-mottaker med Trust 5 — så testene kan vise at standardnivået blir L og at L faktisk sendes, uten Ollama.
  if (tm === '3') liste.push({ id: 'testlokal', label: 'Test lokal (ekko — sender ingenting)', endpoint: 'lokalt', modell: 'ekko', trust: { ...TEST_TRUST('Test lokal', 'Tua selv: lokal ekko-mottaker i motor.js (TUA_TESTMOTTAKERE=3) — Trust 5 som Ollama, så standardnivå L kan testes uten modell.'), score: 5 }, local: true, test: true, status: async () => ({ klar: true }), send: sendTest });
  return liste
}

// Vurdereren (skive 6, V21): Forskjeller og konklusjonen skrives av standardmodellen lokalt — Ollama når den kjører, ellers Claude med nøkkel,
// ellers ikke tilgjengelig med grunn. TUA_VURDERER overstyrer (testene setter «test»). Går gjennom de samme trinnene som spor():
// sjekkTillatt (svar-sakene på L — arver et svar Vault-merket, stoppes en ekstern vurderer) → skjerm → send → Utlevert-linje med mottaker.
// Nivået en vurderer får lese svar-sakene på: det høyeste Trust Score tillater (L for lokal og Claude, M for test). Vault-arv stoppes
// fortsatt hos en ekstern vurderer i sjekkTillatt — det klampes ikke ned til S i det stille (forskjeller av ingresser ville være verdiløse).
const maksNivå = (m) => { const score = Number(m?.trust?.score) || 1; return LEVELS.filter((l) => NIVÅ_KREVER_TRUST[l] <= score).at(-1) || 'S' };

// ── 0) Lese: S og M for en innlest fil (M16, skive 7) ──────────────────────
// En fil som leses inn (lesere.js → innlesing.js) blir en sak med L = hele teksten. S og M skrives av standardmodellen LOKALT — Ollama når den
// kjører — ellers etter regler (regelNivåer). Claude skriver bare når det bes om det (skriver: 'claude'); da går teksten gjennom de samme trinnene
// som spor(): sjekkTillatt (L til Claude krever Trust 4) → skjerm → send → avskjerm → én Utlevert-linje (tool: innlesing). En lokal modell logges
// IKKE som utlevering — ingenting forlot maskinen. V10: nivået merkes med hvem som skrev det (`av`: «regel», «Ollama · gemma3:4b», «Claude · …»).
// TUA_SKRIVER overstyrer (regel | test | ollama | claude) — testene bruker regel og test.
async function skriver(ønsket = process.env.TUA_SKRIVER || 'auto') {
  if (ønsket === 'regel') return { m: null, regel: true }
  const alle = lagMottakere();
  const rekke = ønsket === 'auto' ? [alle.find((m) => m.id === 'ollama')] : alle.filter((m) => m.id === ønsket);
  const grunner = [];
  for (const m of rekke.filter(Boolean)) { const st = await m.status(); if (st.klar) return { m, modell: st.modell || st.modeller?.[0] || m.modell }; grunner.push(`${m.label}: ${st.hvorfor}`); }
  return { m: null, regel: true, grunn: grunner.length ? grunner.join('; ') : ønsket === 'auto' ? 'ingen lokal modell' : `ukjent skriver «${ønsket}»` }
}
const setningKutt = (t, maks) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maks) return s
  const k = s.slice(0, maks);
  const i = Math.max(k.lastIndexOf('. '), k.lastIndexOf('! '), k.lastIndexOf('? '));
  return i > maks * 0.4 ? k.slice(0, i + 1) : k.slice(0, maks - 1).trimEnd() + '…'
};
// Regelbasert S/M: S = første avsnitt med brødtekst (ikke overskrift, ikke liste, ikke tabell) flatet til ≤ 300 tegn; M (bare når teksten er lang,
// > LONG_L) = overskriftene og første setning i hvert avsnitt under, til 2 500 tegn. Forutsigbart og uten modell — merket «regel».
function regelNivåer(tekst, { tittel = '' } = {}) {
  const t = String(tekst || '').replace(/\r\n?/g, '\n');
  const avsnitt = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const erOverskrift = (p) => /^#{1,6}\s/.test(p);
  const brød = avsnitt.filter((p) => !erOverskrift(p) && !/^[-*|>`]/.test(p) && ord(p) >= 4);
  const S = setningKutt((brød[0] || avsnitt.find((p) => !erOverskrift(p)) || avsnitt[0] || tittel || '').replace(/^#+\s*/, ''), 300);
  if (t.length <= LONG_L) return { S, M: '' }
  const linjer = [];
  let n = 0;
  for (const p of avsnitt) {
    const l = erOverskrift(p) ? p.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim() : setningKutt(p.replace(/^[-*>]\s*/, ''), 220);
    if (!l || l === S) continue
    if (n + l.length + 2 > 2400) break
    linjer.push(erOverskrift(p) ? `**${l}**` : `– ${l}`); n += l.length + 2;
  }
  return { S, M: setningKutt(linjer.join('\n'), 2500) }
}
const NIVÅ_OPPGAVE = (medM, tegn, kuttet) => `Teksten under er et dokument fra brukerens arkiv (${tegn.toLocaleString('no-NO')} tegn${kuttet ? ', bare begynnelsen er med' : ''}). Svar med ett JSON-objekt: ` +
  (medM ? '{"S": "…", "M": "…"}. S = ingress: én til to setninger, høyst 300 tegn, som sier hva dokumentet er og hva det handler om. M = sammendrag, høyst 2 500 tegn: hovedpunktene, tallene og navnene som står i teksten, i den rekkefølgen de står. '
    : '{"S": "…"}. S = ingress: én til to setninger, høyst 300 tegn, som sier hva dokumentet er og hva det handler om. ') +
  'På norsk. Ikke finn på noe som ikke står i teksten. Plassholdere som [Person A] brukes uendret.';
const NIVÅ_MAKS_TEGN = 12000;
// Skriv S (og M når teksten er lang) for én tekst. Returnerer { S, M, av, modell, tokens, utlevert, grunn? } — faller alltid tilbake til regler, aldri feil.
async function skrivNivåer(tekst, { tittel = '', sak = null, prosjekt, klient = 'app', skriver: ønsket, signal, på = () => {} } = {}) {
  const t = String(tekst || '');
  const regel = regelNivåer(t, { tittel });
  const v = await skriver(ønsket);
  if (!v.m) return { ...regel, av: 'regel', modell: null, tokens: null, utlevert: false, ...(v.grunn ? { grunn: v.grunn } : {}) }
  const m = v.m;
  const medM = t.length > LONG_L;
  const atoms = load();
  if (!m.test) {   // fail closed som i spor(): en ekstern skriver må ha Trust Score for L (Claude 4 → ok); lokal og test går alltid
    const kilder = [{ id: sak?.id || null, name: tittel || sak?.name || 'fila', version: sak?.version || 1, level: 'L', vault: false }];
    try { sjekkTillatt(m, kilder); } catch (e) { if (e instanceof Blokkert) return { ...regel, av: 'regel', modell: null, tokens: null, utlevert: false, grunn: `${m.label} fikk ikke lese fila: ${e.message}` }; throw e }
  }
  const sk = lagSkjermer(kjentePersoner(atoms));
  const kuttet = t.length > NIVÅ_MAKS_TEGN;
  const kontekst = `## ${sk.skjerm(tittel || 'Dokument')}\n\n${sk.skjerm(kuttet ? t.slice(0, NIVÅ_MAKS_TEGN) : t)}${kuttet ? '\n\n[…]' : ''}`;
  const oppgave = NIVÅ_OPPGAVE(medM, t.length, kuttet);
  const sendes = `${SYSTEM}${JSON_KRAV}\n\n${byggMelding(oppgave, kontekst)}`;
  const tokensCa = anslåTokens(sendes, m.id);
  på('skriver', { mottaker: m.id, label: m.label, modell: v.modell, lokalt: !!m.local || !!m.test, tokens: { ca: tokensCa }, medM });
  let r;
  try { r = await m.send({ system: SYSTEM, melding: oppgave, kontekst, json: true, oppgave: 'nivåer' }, { signal }); }
  catch (e) { return { ...regel, av: 'regel', modell: null, tokens: null, utlevert: false, grunn: `${m.label} svarte ikke (${e.message}) — S og M er skrevet etter regler.` } }
  const j = plukkJson(r.tekst) || {};
  const S = setningKutt(avskjerm(typeof j.S === 'string' ? j.S : typeof j.s === 'string' ? j.s : typeof j.ingress === 'string' ? j.ingress : '', sk.kobling), 300);
  const Mrå = typeof j.M === 'string' ? j.M : typeof j.m === 'string' ? j.m : typeof j.sammendrag === 'string' ? j.sammendrag : '';
  const M = medM ? avskjerm(Mrå, sk.kobling).trim().slice(0, 2500) : '';
  const tokens = { ca: tokensCa, inn: r.usage?.input_tokens ?? null, ut: r.usage?.output_tokens ?? null };
  const av = m.test ? 'test' : `${m.label.split(' (')[0]} · ${r.modell || v.modell}`;
  let utlevert = false;
  if (!m.local && !m.test) {   // bare en ekstern modell er en utlevering
    logDelivery({ tool: 'innlesing', client: klient, mottaker: m.id, endpoint: m.endpoint, modell: r.modell, saker: sak?.id ? [{ id: sak.id, version: sak.version || 1, level: 'L' }] : [], skjermet: { ...sk.antall }, ord: ord(sendes), tokens, ...(prosjekt ? { context: prosjekt } : {}) });
    utlevert = true;
  }
  if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] });
  if (!S) return { ...regel, av: 'regel', modell: r.modell, tokens, utlevert, grunn: `${m.label} ga ingen ingress — S og M er skrevet etter regler.` }
  return { S, M: M || (medM ? regel.M : ''), av, M_av: M ? av : medM ? 'regel' : null, modell: r.modell, tokens, utlevert, skjermet: { ...sk.antall } }
}
function plukkJson(t) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const k of [fence?.[1], t]) {
    if (!k) continue
    const s = k.indexOf('{'), e = k.lastIndexOf('}');
    if (s < 0 || e <= s) continue
    const sub = k.slice(s, e + 1);
    for (const forsøk of [sub, sub.replace(/,\s*([}\]])/g, '$1'), sub.replace(/[“”«»]/g, '"').replace(/,\s*([}\]])/g, '$1')]) { try { const j = JSON.parse(forsøk); if (j && typeof j === 'object') return j } catch {} }
  }
  return null
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
function endepunkt(id = 'claude') {
  const t = trustFor(id);
  return { id, label: t?.label || id, endpoint: t?.endpoint || '', trust: t, local: id === 'ollama' || t?.region === 'lokalt' }
}
// Ett skjermings-oppsett for et helt verktøysvar: samme person får samme plassholder i tittel, ingress og tekst. Lista vokser av bruk (som spor()).
function skjermerFor(atoms) {
  const sk = lagSkjermer(kjentePersoner(atoms));
  // treff er en getter på skjermeren — den må defineres på nytt her (en spredning ville fryst den til 0)
  return { skjerm: (t) => sk.skjerm(t), kobling: sk.kobling, antall: sk.antall, nye: sk.nye, get treff() { return sk.treff }, lær: () => { if (sk.nye.size) kjentePersoner([], { lær: [...sk.nye] }); } }
}
// lever(): én sak til Claude på et nivå. Returnerer { nivå (det som faktisk gis), ønsket, maks, linje (hvorfor klippet, '' når ikke), felt (navn, samtale,
// S, hvorfor — skjermet), tekst (skjermet), got (levelOf-svaret), antall, treff, tokens, ord, logget }. `versjon` er en tidligere versjon av saken
// (readVersion) — nivået vurderes på saken slik den er nå (Vault-taggen), teksten tas fra versjonen. `logg: false` skjermer uten Utlevert-linje.
function lever(atoms, sak, { nivå = 'L', mottaker = 'claude', tool = 'tua_get', klient = 'Claude', context, versjon = null, logg = true, sk = null } = {}) {
  const m = typeof mottaker === 'string' ? endepunkt(mottaker) : mottaker;
  const kilde = versjon || sak;
  const ønsket = LEVELS.includes(nivå) ? nivå : 'L';
  const maks = clampLevel(ønsket, maxLevel(sak, context));                   // referansens nivå (V11) først — det er ikke fail closed, bare synlighet
  let eff = maks, linje = '';
  try { sjekkTillatt(m, [{ id: sak.id, name: sak.name, version: kilde.version || 1, level: eff, vault: isVault(sak) }]); }
  catch (e) {
    if (!(e instanceof Blokkert)) throw e
    eff = 'S';
    linje = isVault(sak)
      ? `«${sak.name}» er Vault-merket: ${m.label} får bare S (V15, fail closed). Hele innholdet finnes bare i Tua-appen på denne maskinen.`
      : `${m.label} har Trust Score ${Number(m.trust?.score) || 1}/5 — nivå ${maks} krever minst ${NIVÅ_KREVER_TRUST[maks]} (fail closed, V21). Du får S.`;
  }
  const got = levelOf(kilde, eff);
  const egen = !sk;
  sk = sk || skjermerFor(atoms);
  const S = levelOf(kilde, 'S');
  const felt = { navn: sk.skjerm(kilde.name || sak.name), samtale: sk.skjerm(kilde.convo || ''), S: S.level === 'S' ? sk.skjerm(S.text) : '', hvorfor: kilde.summary && kilde.summary !== S.text ? sk.skjerm(kilde.summary) : '' };
  const tekst = sk.skjerm(got.text);
  if (egen) sk.lær();
  const alt = `${felt.navn}\n${felt.samtale}\n${felt.S}\n${felt.hvorfor}\n${tekst}`;
  const tokens = { ca: anslåTokens(alt, m.id) };
  const antall = { ...sk.antall };
  let logget = false;
  if (logg) {
    logDelivery({ tool, client: klient, mottaker: m.id, endpoint: m.endpoint, id: sak.id, version: kilde.version || 1, level: eff,
      saker: [{ id: sak.id, version: kilde.version || 1, level: eff }], skjermet: antall, ord: ord(alt), tokens, ...(linje ? { klippet: `${ønsket}→${eff}` } : {}), ...(context ? { context } : {}) });
    logget = true;
  }
  return { nivå: eff, ønsket, maks, linje, felt, tekst, got, S, antall, treff: Object.values(antall).reduce((a, b) => a + b, 0), tokens, ord: ord(alt), logget, mottaker: m }
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
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mottaker';
const navneliste = (n) => (n.length <= 1 ? n[0] || '' : `${n.slice(0, -1).join(', ')} og ${n.at(-1)}`);
function del(atoms, { ids = [], til, nivå = 'S', prosjekt, klient = 'Claude', convo, forhåndsvis = false, base, merke = 'kollega' } = {}) {
  const tilRå = Array.isArray(til) ? til.map((t) => String(t || '').trim()).filter(Boolean) : String(til || '').trim();
  if (!tilRå || (Array.isArray(tilRå) && !tilRå.length)) throw new MotorFeil('mottaker kreves («del med <navn eller e-post>»)')
  if (!Array.isArray(ids) || !ids.length) throw new MotorFeil('minst én sak-id kreves')
  const { personer, sirkler: sirkelnavn, m } = l_sMottakere(tilRå, { merke, opprett: !forhåndsvis });
  if (!personer.length) throw new MotorFeil('fant ingen mottaker i «' + (Array.isArray(tilRå) ? tilRå.join(', ') : tilRå) + '»')
  const mottakerNavn = navneliste(personer.map((p) => p.navn));
  const ønsket = LEVELS.includes(nivå) ? nivå : 'S';
  const { kilder, notater } = minimer(atoms, ids.map((id) => ({ id, nivå: ønsket })));
  if (!kilder.length) throw new MotorFeil(`Ingen av sakene finnes: ${notater.join('; ')}`)
  const linjer = [];
  for (const k of kilder) if (k.vault && k.level !== 'S') { k.level = 'S'; k.klippet = true; linjer.push(`«${k.name}» er Vault-merket og deles bare som S (V15, fail closed).`); }
  const sk = skjermerFor(atoms);
  const rader = kilder.map((k) => {
    const a = atoms.find((x) => x.id === k.id);
    const got = levelOf(a, k.level);
    k.tegn = got.text.trim().length; k.ord = ord(got.text);
    return { id: a.id, version: a.version || 1, level: k.level, fallback: got.fallback ? got.level : null, name: sk.skjerm(a.name), tekst: sk.skjerm(got.text.trim()) }
  });
  const gjengivelse = rader.map((r) => `## ${r.name}\n_v${r.version} · nivå ${r.level}${r.fallback ? ` (${r.fallback})` : ''}_\n\n${r.tekst}`).join('\n\n');
  const antall = { ...sk.antall }, treff = Object.values(antall).reduce((a, b) => a + b, 0);
  const nivåer = [...new Set(kilder.map((k) => k.level))].join('/');
  const når = new Date();
  const skjermetTekst = treff ? `${treff} opplysning${treff === 1 ? '' : 'er'} skjermet (${Object.entries(antall).map(([t, n]) => `${n} ${t}`).join(', ')})` : 'ingen opplysninger å skjerme';
  const setning = `${mottakerNavn} får ${nivåer} av ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'}, ${skjermetTekst}.`;
  const tokens = { ca: anslåTokens(gjengivelse, 'claude') };
  const mottakere = personer.map(({ id, navn, epost, merke: mk, ny }) => ({ id, navn, epost: epost || null, merke: mk, ny: !!ny }));
  if (forhåndsvis) return { forhåndsvis: true, til: mottakerNavn, mottakere, sirkler: sirkelnavn, nivå: nivåer, kilder, antall, treff, linjer, notater, setning, tokens, ord: ord(gjengivelse), gjengivelse }
  // ── lagre: token + deling, delingssaken, Utlevert per person, personer og mønstre. Samme personer, samme saker på samme nivå, delingen ikke trukket → samme
  // token og samme delingssak (lenka kollegaen alt har, virker fortsatt; radene skrives på nytt om saken har endret seg); ellers et nytt token.
  const tilNøkkel = personer.map((p) => p.id).sort().join('+');
  const samme = delingerFor(null).find((d) => !d.trukket && (d.til || []).map((t) => t.id).sort().join('+') === tilNøkkel && (d.rader || []).length === rader.length && d.rader.every((r, i) => r.id === rader[i].id && r.level === rader[i].level));
  const token = samme?.token || nyttToken();
  const lenker = lenkerFor(token, base);
  const proj = String(prosjekt || '').trim() || atoms.find((x) => x.id === kilder[0].id)?.project || 'Uten prosjekt';
  const tittel = `Deling til ${mottakerNavn}: ${kilder.length === 1 ? kilder[0].name : `${kilder.length} saker`}`.slice(0, 90);
  const hode = `# Deling til ${mottakerNavn}\n\n_Delt med: ${personer.map((p) => (p.epost ? `${p.navn} <${p.epost}>` : p.navn)).join(', ')} · nivå ${nivåer} · ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} · ${skjermetTekst} · utlevert ${fmtTid(når)} fra ${klient}_` +
    (linjer.length ? `\n\n${linjer.map((l) => `> ${l}`).join('\n')}` : '');
  const content = `${hode}\n\n**Lenke til mottakersiden:** ${lenker.http} · ${lenker.tua}\n**Som fil:** ${lenker.html}\n\n${gjengivelse}\n\n---\n\n_Gjengivelsen er skjermet: plassholdere som [Person A] står for opplysninger som ikke er delt. Mottakersiden viser sakene som låste rader på nivået de ble delt, med «Be om hele»._`;
  const key = `deling:${slug(mottakerNavn)}:${token.slice(0, 8)}`;
  const { atom, status } = upsert(atoms, { key, kind: 'leveranse', name: tittel, content, project: proj, convo: convo || `Deling til ${mottakerNavn}`, source: 'Tua', by: 'regel', tags: ['deling'],
    derivedFrom: kilder.map(({ id, version, level }) => ({ id, version, level })),
    short: `Delt med ${mottakerNavn} på nivå ${nivåer}: ${kilder.length} ${kilder.length === 1 ? 'sak' : 'saker'} (${kilder.map((k) => k.name).join(', ')}), ${skjermetTekst}.`.slice(0, 300),
    summary: `Deling laget fra ${klient} ${fmtTid(når)}; mottakersiden er ${lenker.http}.` });
  atom.links = [...(atom.links || []).filter((l) => ![lenker.tua, lenker.http].includes(l.href)), { kind: 'url', href: lenker.http, label: `Mottakersiden til ${mottakerNavn}` }, { kind: 'url', href: lenker.tua, label: `Delingen (tua://)` }];
  save(atoms);
  const eierNå = eier();
  lagreDeling({ token, sak: atom.id, til: mottakere, sirkler: sirkelnavn, nivå: nivåer, rader, opprettet: samme?.opprettet || når.getTime(), oppdatert: når.getTime(), av: eierNå, klient, treff, antall, prosjekt: proj, trukket: null, forespørsler: samme?.forespørsler || [] });
  for (const p of personer) {
    logDelivery({ tool: 'tua_share', client: klient, mottaker: p.id, mottakerNavn: p.navn, personer: mottakere.map(({ id, navn }) => ({ id, navn })), endpoint: 'deling (lenke)', token, saker: kilder.map(({ id, version, level }) => ({ id, version, level })),
      skjermet: antall, ord: ord(gjengivelse), tokens, deling: atom.id, ...({ context: proj } ) });
  }
  const sirkelForslag = registrerDeling(m, personer.map((p) => p.id), når.getTime());
  skrivMottakere(m);
  sk.lær();
  const kopierbar = `${gjengivelse}\n\n— Delt fra Tua ${fmtTid(når)} · nivå ${nivåer} · ${skjermetTekst}\nMottakersiden: ${lenker.http}`;
  return { id: atom.id, version: atom.version || 1, status, til: mottakerNavn, mottakere, sirkler: sirkelnavn, nivå: nivåer, kilder, antall, treff, linjer, notater, setning, token, lenke: lenker.http, lenker, kopierbar, tokens, ord: ord(gjengivelse), prosjekt: atom.project,
    sirkelForslag: sirkelForslag ? { id: sirkelForslag.id, forslag: sirkelForslag.forslag, medlemmer: sirkelForslag.medlemmer, antall: sirkelForslag.antall, navn: sirkelForslag.navn || null } : null }
}
const fmtTid = (d) => d.toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' });

export { anslåTokens, del, endepunkt, lever, maksNivå, ord, skjermerFor, skrivNivåer };
