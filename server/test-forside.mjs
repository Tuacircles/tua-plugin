#!/usr/bin/env node
// test-forside.mjs — friksjonsrunde 1 (bruksdag 1, 24.10.2026): forsiden og Innboks, mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall.
//
//   TUA_FILES_ROOT=/tmp/tua-test-forside/arkiv TUA_DATA_DIR=/tmp/tua-test-forside/data TUA_HOME=/tmp/tua-test-forside/hjem node server/test-forside.mjs
//
// Sjekker: (9) S for samtaler etter regelen «siste vending» (samtaleS): «Sist: <siste prompt> → <første setning av svaret> · N vendinger · periode»;
// importen av et falskt Code-transkript skriver den, ny import etter nye vendinger oppdaterer den (ny versjon, tittelen beholdes), en menneskeskrevet
// S røres aldri (V10); samtaleSFraTranskript leser samme S ut av den lagrede saken; `node review.js --samtaler --dry-run` viser uten å skrive,
// uten --dry-run skriver den (by: regel) og lar menneskeskrevet stå. (11) /api/atoms gir feltene lista trenger. (5) /innboks svarer med app-fila,
// /api/innboks teller dokumentene som venter, og /api/innboks/antall gir bare tellingen. (13) POST /api/open finder med en sti som står i sakens tekst:
// mappa + filnavn, «X.pdf/.docx», uten id; avvist når stien ikke står i teksten, ligger utenfor hjemmemappa eller ikke finnes.
// Runde 1 (arb. 32 §6, 24.10.2026): reglene i tua2-sandbox/src/regler.js (hovedsak, ekte samtaler, tråder, maskert visning), store.tråder/deliveryCounts,
// brukbarTittel (PDF-tittel fra filnavn når metadata er teknisk), og POST /api/innboks/les som SSE med fremdrift.
// Runde 2a+2b (planen videre §1 og §3): ett sted — regler.normaliserAdresse/lesHash (/oppslag, /spor, /innboks → /, #atom → #sak), sidenSist, mapper/filnavn, radFor, runder, kortS;
// broen svarer med app-fila for de gamle rutene og gir mtime på /api/atoms (Mapper sorterer som Finder).
// Runde 2c (app): regler.nesteRad (j/k), fangetTekst, innlesingTekst, slippProsjekt, sidenSist med fanget, lesHash #fanget; broen: POST /api/les med fila som rå kropp
// (dra og slipp) — SSE med side {side, av} for PDF, lander i «Uten prosjekt»; POST /api/flytt (dra en sak til en mappe); /api/search bærer fangetUtenfor;
// POST /api/konklusjon {strøm: true} som SSE (vurderer {svar: N} → forskjeller → konklusjon-del → konklusjon → slutt).
// Friksjon 18 (25.10.2026): tallene i bryteren «Avis · N Mapper · N Filer» regnet av /api/atoms og /api/mappe (regler.mapperMed/tellVisning), Filer-lista (regler.filerFlat)
// sortert dato sist først med mappefiler på mtime, klasse-regelen (spor og drift bare med «ta med» — i Mapper alltid), og passerFil (filter på mappefiler).
// Arbeidsstykke 33 skive 2 (27.10.2026, V22): Arbeid-tilstanden — regler.sidefeltTre/sistBrukt/leggSistBrukt (prosjekt › arbeid › samtaler, sist brukt), standardValg/utenforFor
// (avkryssingen fra standard[<mottaker>]), vendingHode, sendesTekst (Sendes-linja, kort på mobil), lesHash #samtale/ og #arbeid/; og at kurven, samtalespalta og SporISak er borte.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
const SCRATCH = path.dirname(ROOT)
const CODE_HOME = path.join(SCRATCH, 'code-home')
for (const d of [ROOT, DATA, HJEM, CODE_HOME, path.join(ROOT, 'Innboks')]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODE_HOME = CODE_HOME
process.env.TUA_COWORK_ROOT = path.join(SCRATCH, 'cowork-tom')
process.env.TUA_CODEX_HOME = path.join(path.dirname(process.env.TUA_FILES_ROOT), 'codex-tom')   // 28.10.2026: aldri Eriks ekte ~/.codex

const { load, save, upsert, mkLevel, isStale, needsLevel, tråder, deliveryCounts, logDelivery } = await import('./store.js')
const { samtalerGjennomgang } = await import('./gjennomgang.js')
const { samtaleS, samtaleSFraTranskript, nyttPar, importCode, parseCodeSession } = await import('./import.js')
const { brukbarTittel } = await import('./lesere.js')
const { tittelFor } = await import('./innlesing.js')
const regler = await import(pathToFileURL(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'regler.js')).href)   // runde 1: appens rene regler, prøvd uten nettleser

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }

// ── 1) regelen samtaleS ────────────────────────────────────────────────────
{
  const p1 = nyttPar('Kan du skrive et sammendrag av møtenotatet om lagerflytting?', Date.parse('2026-10-01T10:00:00Z')); p1.svar = '# Sammendrag\n\nLageret flyttes til Industriveien 4 i neste kvartal. Budsjettet er 45 000 kroner.'
  const p2 = nyttPar('Lag en liste over leverandørene som ble nevnt i notatet, med kontaktperson.', Date.parse('2026-10-24T09:00:00Z')); p2.svar = '**Her er lista over leverandørene.** Bring, PostNord og Schenker.'
  const S = samtaleS({ pairs: [p1, p2], turns: 2, first: p1.at, last: p2.at })
  ok('samtaleS: begynner med «Sist:» og siste prompt — ikke første', S.startsWith('Sist: Lag en liste over leverandørene') && !S.includes('sammendrag av møtenotatet'), S)
  ok('samtaleS: første setning av svaret, uten markdown', S.includes('→ Her er lista over leverandørene.') && !S.includes('**') && !S.includes('Bring'))
  ok('samtaleS: antall vendinger og periode (første–siste dato)', S.endsWith('· 2 vendinger · 1.10.–24.10.2026'), S)
  ok('samtaleS: aldri over 300 tegn, også med lang prompt og langt svar', samtaleS({ pairs: [Object.assign(nyttPar('x'.repeat(500), 0), { svar: 'y'.repeat(900) })], turns: 40, first: p1.at, last: p2.at }).length <= 300)
  ok('samtaleS: én vending på én dag → «1 vending · dato»', samtaleS({ pairs: [p1], turns: 1, first: p1.at, last: p1.at }).endsWith('· 1 vending · 1.10.2026'))
  ok('samtaleS: uten svar står bare prompten', !samtaleS({ pairs: [nyttPar('Bare et spørsmål uten svar ennå', p2.at)], turns: 1, first: p2.at, last: p2.at }).includes('→'))
}

// ── 2) importen av et falskt Code-transkript: S skrives, oppdateres ved nye vendinger, menneskeskrevet røres ikke ─
const P1 = 'Kan du skrive et sammendrag av møtenotatet om lagerflytting og foreslå tre tiltak for neste kvartal? Ta med budsjettet.'
const P2 = 'Lag en liste over alle leverandørene som ble nevnt i notatet, med hva hver av dem leverer og hvem som er kontaktperson hos oss.'
const P3 = 'Skriv et utkast til e-post til styret om flyttingen av lageret: hva som er bestemt, hva det koster og når det skjer.'
const A1 = 'Her er sammendraget av møtenotatet. ' + 'Lageret flyttes til Industriveien 4 i løpet av neste kvartal, og budsjettet er 45 000 kroner. '.repeat(30)
const A2 = 'Leverandørene som ble nevnt er Bring, PostNord og Schenker. Kontaktpersonene står under.'
const A3 = 'Utkastet til styret ligger under. Det er kort og sier hva som er bestemt.'
const SID = 'sess-aaaa-bbbb-cccc-dddd'
const T0 = Date.parse('2026-10-20T10:00:00+02:00')
const linje = (type, text, i) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] }, cwd: '/Users/test/Lagerprosjekt', sessionId: SID, timestamp: new Date(T0 + i * 36e5 * 6).toISOString() })
const dir = path.join(CODE_HOME, '-Users-test-Lagerprosjekt'); fs.mkdirSync(dir, { recursive: true })
const øktfil = path.join(dir, `${SID}.jsonl`)
fs.writeFileSync(øktfil, [linje('user', P1, 0), linje('assistant', A1, 1), linje('user', P2, 2), linje('assistant', A2, 3)].join('\n') + '\n')
{
  const s = parseCodeSession(øktfil)
  ok('parseCodeSession: hvert par har svar (siste assistent-tekst, uansett lengde)', s.pairs.length === 2 && s.pairs[1].svar === A2 && s.pairs[0].svar === A1.trim())
  importCode({ files: [øktfil], source: 'code', minChars: 100 })
  const a = load().find((x) => x.key === `samtale:${SID}`)
  ok('import: samtale-saken har S etter regelen — siste vending (P2 → A2), 2 vendinger', !!a && a.levels?.S?.text.startsWith('Sist: Lag en liste over alle leverandørene') && a.levels.S.text.includes('→ Leverandørene som ble nevnt er Bring, PostNord og Schenker.') && a.levels.S.text.includes('2 vendinger') && a.levels.S.by === 'regel', a?.levels?.S?.text)
  ok('import: tittelen er samtalens (første prompt klippet), ikke endret av regelen', a.name.startsWith('Kan du skrive et sammendrag'))
  ok('import: samme S lest ut av det lagrede transkriptet (review bruker denne)', samtaleSFraTranskript(a.content) === a.levels.S.text, samtaleSFraTranskript(a.content))
  // nye vendinger → ny import → S oppdatert, ny versjon, samme tittel
  fs.appendFileSync(øktfil, [linje('user', P3, 4), linje('assistant', A3, 5)].join('\n') + '\n')
  importCode({ files: [øktfil], source: 'code', minChars: 100 })
  const b = load().find((x) => x.key === `samtale:${SID}`)
  ok('ny import etter nye vendinger: S er siste vending (P3 → A3), 3 vendinger, versjon 2, tittelen beholdt', b.levels.S.text.startsWith('Sist: Skriv et utkast til e-post til styret') && b.levels.S.text.includes('3 vendinger') && b.version === 2 && b.name === a.name && b.levels.S.of === 2, b.levels.S.text)
  // modellens S → overlever ny import og regel-gjennomgang, merket utdatert; M følger fortsatt samtalen (Erik 02.11.2026)
  {
    const atoms0 = load(); const x0 = atoms0.find((x) => x.key === `samtale:${SID}`); const regelS = x0.levels.S
    x0.levels.S = mkLevel('Modellens ingress om styret.', 'Ollama · gemma3:4b', x0.version); save(atoms0)
    fs.appendFileSync(øktfil, [linje('user', 'Kan du også ta med fristene fra møtenotatet i utkastet til styret, som egen liste?', 4), linje('assistant', 'Fristene står nå som egen liste.', 5)].join('\n') + '\n')
    importCode({ files: [øktfil], source: 'code', minChars: 100 })
    const x1 = load().find((x) => x.key === `samtale:${SID}`)
    ok('ny import etter nye vendinger: modellens S står, gammel `of`, ny versjon', x1.levels.S.text === 'Modellens ingress om styret.' && x1.levels.S.by === 'Ollama · gemma3:4b' && x1.version === x0.version + 1 && x1.levels.S.of === x0.version, JSON.stringify(x1.levels.S))
    ok('…og den regnes som utdatert, så en ny gjennomgang fanger den', isStale(x1, 'S') && needsLevel(x1, 'S'))
    ok('…mens M etter regel følger samtalen, så antall vendinger er riktig', /4 vendinger/.test(x1.levels.M?.text || ''), x1.levels.M?.text)
    const r = await samtalerGjennomgang({ dryRun: false, skriver: 'regel' })
    const x2 = load().find((x) => x.key === `samtale:${SID}`)
    ok('samtale-gjennomgang etter regel: modellens S står', x2.levels.S.text === 'Modellens ingress om styret.' && r.S === 0, JSON.stringify(x2.levels.S))
    const atoms1 = load(); const x3 = atoms1.find((x) => x.key === `samtale:${SID}`); x3.levels.S = { ...regelS, of: x3.version }; save(atoms1)
  }
  // menneskeskrevet S → røres ikke av neste import (V10)
  const atoms = load(); const m = atoms.find((x) => x.key === `samtale:${SID}`); m.levels.S = mkLevel('Eriks egen ingress om lagerflyttingen.', 'menneske', m.version); save(atoms)
  fs.appendFileSync(øktfil, [linje('user', 'Og en ting til: legg ved budsjettet som tabell, med alle postene fra møtenotatet.', 6), linje('assistant', 'Tabellen ligger under.', 7)].join('\n') + '\n')
  importCode({ files: [øktfil], source: 'code', minChars: 100 })
  const c = load().find((x) => x.key === `samtale:${SID}`)
  ok('menneskeskrevet S røres ikke av ny import (V10) — innholdet får ny versjon, S står', c.levels.S.text === 'Eriks egen ingress om lagerflyttingen.' && c.levels.S.by === 'menneske' && c.version === m.version + 1)
}

// ── 3) review.js --samtaler: dry-run viser, ekte kjøring skriver, menneskeskrevet står ─
{
  const atoms = load()
  const L = `# Budsjettmøtet\n\n_Claude Desktop · 4 meldinger · 2026-09-02 – 2026-09-05 · prosjekt Lager_\n\n**Bruker:** Hva kostet flyttingen i fjor?\n\n**Claude:** Flyttingen i fjor kostet 38 000 kroner. Det meste gikk til transport.\n\n**Bruker:** Og hva er anslaget for i år, med samme leverandør?\n\n**Claude:** Anslaget for i år er 45 000 kroner. Prisen har økt med rundt 18 prosent.`
  const gammel = upsert(atoms, { key: 'samtale:desk-1', kind: 'samtale', name: 'Budsjettmøtet', content: L, project: 'Lager', convo: 'Budsjettmøtet', source: 'Claude Desktop', by: 'regel', tags: ['samtale', 'desktop'], short: 'Budsjettmøtet: Hva kostet flyttingen i fjor?' }).atom
  const kort = upsert(atoms, { key: 'sak:notat', kind: 'capture', name: 'Et notat', content: 'Et vanlig notat uten transkript. '.repeat(30), project: 'Lager', by: 'regel', short: 'Notatets egen ingress.' }).atom
  save(atoms)
  const env = { ...process.env }
  const kjør = (...args) => spawnSync(process.execPath, [path.join(HERE, 'review.js'), ...args], { env, encoding: 'utf8' })
  const dry = kjør('--samtaler', '--dry-run')
  ok('review --samtaler --dry-run: teller samtalene, sier hvem som får ny S og hvem som er menneskeskrevet, skriver ingenting', dry.status === 0 && /2 samtale-saker · 1 får ny S/.test(dry.stdout) && /1 menneskeskrevet/.test(dry.stdout) && /DRY-RUN/.test(dry.stdout) && dry.stdout.includes('før: Budsjettmøtet: Hva kostet') && dry.stdout.includes('nå:  Sist: Og hva er anslaget for i år'), dry.stdout.split('\n')[0] + (dry.stderr ? ' | ' + dry.stderr.slice(0, 200) : ''))
  ok('dry-run: S på disk er fortsatt den gamle', load().find((x) => x.id === gammel.id).levels.S.text === 'Budsjettmøtet: Hva kostet flyttingen i fjor?')
  const ekte = kjør('--samtaler')
  const etter = load()
  const g = etter.find((x) => x.id === gammel.id), mm = etter.find((x) => x.key === `samtale:${SID}`), k = etter.find((x) => x.id === kort.id)
  ok('review --samtaler: S skrevet på nytt (by: regel) — siste vending, 2 vendinger, perioden fra hodelinja', ekte.status === 0 && g.levels.S.text === 'Sist: Og hva er anslaget for i år, med samme leverandør? → Anslaget for i år er 45 000 kroner. · 2 vendinger · 2.9.–5.9.2026' && g.levels.S.by === 'regel', g.levels.S.text)
  ok('review --samtaler: menneskeskrevet S står (V10), vanlige saker røres ikke', mm.levels.S.text === 'Eriks egen ingress om lagerflyttingen.' && k.levels.S.text === 'Notatets egen ingress.')
  ok('review --samtaler igjen: ingenting å skrive', /1 får ny S/.test(kjør('--samtaler', '--dry-run').stdout) === false && /0 får ny S/.test(kjør('--samtaler', '--dry-run').stdout))
  const fil = fs.readFileSync(path.join(ROOT, 'Lager', 'Budsjettmøtet.md'), 'utf8')
  ok('fila i arkivet har den nye ingressen (S) og S_av: regel', fil.includes('Sist: Og hva er anslaget') && /S_av: "regel"/.test(fil))
}

// ── Kildefarger (28.10.2026): regler.kildeKlasse — én klasse per leverandør, ingen for Tua/Erik/test ─────────────────────────────
{
  const kk = regler.kildeKlasse
  ok('kildeKlasse: Claude-kildene (Claude, Claude Code · sync, Cowork, Desktop, Anthropic, modellnavn) → kf-claude', ['Claude', 'Claude Code · sync', 'Claude Cowork', 'Claude Desktop', 'Claude (Anthropic)', 'claude-sonnet-4-5'].every((s) => kk(s) === 'kf kf-claude'))
  ok('kildeKlasse: ChatGPT, Codex, OpenAI (GPT), gpt-5.5 → kf-gpt', ['ChatGPT', 'Codex', 'OpenAI (GPT)', 'gpt-5.5'].every((s) => kk(s) === 'kf kf-gpt'))
  ok('kildeKlasse: Gemini → kf-gemini, Ollama (lokal)/gemma3:4b → kf-lokal, Mistral → kf-mistral, Perplexity → kf-perplexity', kk('Gemini') === 'kf kf-gemini' && kk('Ollama (lokal)') === 'kf kf-lokal' && kk('gemma3:4b', 'Ollama (lokal)') === 'kf kf-lokal' && kk('Mistral') === 'kf kf-mistral' && kk('Perplexity') === 'kf kf-perplexity')
  ok('kildeKlasse: Tua, Erik, Test (ekko), tomt → ingen tone', ['Tua', 'Erik', 'Test (ekko — sender ingenting)', '', null, undefined].every((s) => kk(s) === ''))
  ok('kildeKlasse: flere navn slås sammen — modellen vinner ikke over kilden, men tom kilde + modell gir modellens farge', kk(null, 'Claude') === 'kf kf-claude' && kk('ekko', 'Test (ekko)') === '')
}

// ── Runde 1 — lette og rydde (arbeidsstykke 32 §6, 24.10.2026): reglene appen deler (tua2-sandbox/src/regler.js), tråder i lageret, PDF-tittel ─
{
  const T0 = Date.parse('2026-10-24T12:00:00+02:00'), T = (h) => T0 - h * 36e5
  // hovedsak: mest arbeidet med siste døgn, ellers nyeste
  const nyest = { id: 'n', capturedAt: T(1), version: 1 }, versjonert = { id: 'v', capturedAt: T(5), version: 3 }, sendt = { id: 's', capturedAt: T(20), version: 1, utlevert: 4 }, gammel = { id: 'g', capturedAt: T(40), version: 9, utlevert: 9 }
  ok('hovedsak: den med mest arbeid siste døgn vinner (4 utleveringer > 2 versjoner), ikke den nyeste', regler.hovedsak([nyest, versjonert, sendt, gammel], T0)?.id === 's')
  ok('hovedsak: arbeid eldre enn ett døgn teller ikke — da er det den nyeste', regler.hovedsak([nyest, gammel], T0)?.id === 'n' && regler.hovedsak([], T0) === null)
  ok('hovedsak: en samtale med mange vendinger i dag er mest arbeidet med', regler.hovedsak([nyest, { id: 'sam', kind: 'samtale', capturedAt: T(3), levels: { S: { text: 'Sist: x → y · 18 vendinger · 24.10.2026' } } }], T0)?.id === 'sam')
  // ekte samtaler
  const liste = [{ id: 1, convo: 'A', kind: 'capture', capturedAt: 1 }, { id: 2, convo: 'B', kind: 'capture', capturedAt: 2 }, { id: 3, convo: 'B', kind: 'capture', capturedAt: 3 }, { id: 4, convo: 'C', kind: 'samtale', capturedAt: 4 }, { id: 5, convo: '', capturedAt: 5 }]
  ok('ekte samtaler: én sak med navn er ingen samtale; flere saker med samme navn, eller en samtalelogg, er det', [...regler.ekteSamtaler(liste)].sort().join() === 'B,C')
  // tråder i lageret: prompt → to svar, Forskjeller, konklusjon
  const at = load()
  const pr = upsert(at, { key: 'prompt:t', kind: 'prompt', name: 'Hva er fristen?', content: 'Hva er fristen?', project: 'Lager', convo: 'Hva er fristen?', by: 'regel', short: 'Hva er fristen?' }).atom
  const s1 = upsert(at, { key: 'svar:t1', kind: 'svar', name: 'Svar fra Ollama', content: 'Fristen er 14 dager. '.repeat(5), project: 'Lager', convo: 'Hva er fristen?', source: 'Ollama (lokal)', by: 'regel', derivedFrom: [{ id: pr.id, version: 1, level: 'L' }], tags: ['svar'] }).atom
  const s2 = upsert(at, { key: 'svar:t2', kind: 'svar', name: 'Svar fra Test', content: 'Fristen er 10 dager. '.repeat(5), project: 'Lager', convo: 'Hva er fristen?', source: 'Test', by: 'regel', derivedFrom: [{ id: pr.id, version: 1, level: 'L' }], tags: ['svar'] }).atom
  s2.capturedAt = s1.capturedAt + 1000   // skive 3: to svar i samme sekund (fila har sekundoppløsning) ga ustabil rekkefølge i «nyeste svar er representanten» (vaklende sjekk)
  const fsk = upsert(at, { key: 'forskjeller:t', kind: 'svar', name: 'Forskjeller: Hva er fristen?', content: '## Uenig\n- 14 mot 10 dager', project: 'Lager', convo: 'Hva er fristen?', by: 'regel', tags: ['svar', 'forskjeller'], derivedFrom: [{ id: s1.id, version: 1, level: 'L' }, { id: s2.id, version: 1, level: 'L' }] }).atom
  const ko = upsert(at, { key: 'konklusjon:t', kind: 'konklusjon', name: 'Konklusjon: fristen', content: 'Fristen er 14 dager.', project: 'Lager', convo: 'Hva er fristen?', by: 'regel', derivedFrom: [{ id: pr.id, version: 1, level: 'L' }, { id: s1.id, version: 1, level: 'L' }], short: 'Fristen er 14 dager.' }).atom
  pr.ga = [{ id: s1.id, version: 1 }, { id: s2.id, version: 1 }]
  const ensom = upsert(at, { key: 'notat:ensom', kind: 'capture', name: 'Notat med fødselsnummer', content: 'Ola, fnr 01019012345 og konto 1234.56.78903.', project: 'Lager', by: 'menneske', short: 'Ola Hansen, fødselsnummer 010190 12345, konto 1234 56 78903, telefon 912 34 567.' }).atom
  save(at)
  const t = tråder(load())
  ok('store.tråder: prompt, begge svarene, Forskjeller og konklusjonen har samme tråd (prompt-id); et notat har ingen', [pr, s1, s2, fsk, ko].every((a) => t.av.get(a.id) === pr.id) && !t.av.has(ensom.id) && t.per.get(pr.id).svar.length === 2 && t.per.get(pr.id).forskjeller[0] === fsk.id && t.per.get(pr.id).konklusjon === ko.id)
  const medTråd = load().map((a) => ({ ...a, tråd: t.av.get(a.id) || null })).filter((a) => a.kind !== 'prompt').sort((x, y) => y.capturedAt - x.capturedAt)
  const rader = regler.slåSammenTråder(medTråd, load().map((a) => ({ ...a, tråd: t.av.get(a.id) || null })))
  const rad = rader.find((a) => regler.erTråd(a))
  ok('regler.slåSammenTråder: fire saker blir ÉN oppføring — representant = konklusjonen, tittel = spørsmålet, svar/forskjeller/konklusjon i tråden', rader.filter(regler.erTråd).length === 1 && rad.id === ko.id && regler.trådTittel(rad) === 'Hva er fristen?' && rad.tråd.svar.length === 2 && rad.tråd.forskjeller.length === 1 && rad.tråd.konklusjon.id === ko.id && rader.some((a) => a.id === ensom.id && !regler.erTråd(a)), `${rader.length} rader av ${medTråd.length}`)
  ok('regler.slåSammenTråder: uten konklusjon er nyeste svar representanten', regler.slåSammenTråder(medTråd.filter((a) => a.id !== ko.id)).find(regler.erTråd)?.id === [s1, s2].sort((x, y) => y.capturedAt - x.capturedAt)[0].id)
  // maskering i visning
  const m = regler.maskerVisning(ensom.levels.S.text)
  ok('regler.maskerVisning: fødselsnummer og kontonummer får prikker i visningen, telefon og navn står', m.includes('010190 •••••') && m.includes('1234 56 •••••') && !m.includes('12345') && !m.includes('78903') && m.includes('912 34 567') && m.includes('Ola Hansen'), m)
  ok('regler.maskerVisning: 11 siffer uten mellomrom og konto med punktum', regler.maskerVisning('fnr 01019012345 konto 1234.56.78903 år 2026 beløp 1 480 000 kr') === 'fnr 010190 ••••• konto 1234 56 ••••• år 2026 beløp 1 480 000 kr', regler.maskerVisning('fnr 01019012345 konto 1234.56.78903 år 2026 beløp 1 480 000 kr'))
  ok('fila røres ikke av maskeringen (S på disk har tallene)', fs.readFileSync(path.join(ROOT, 'Lager', 'Notat med fødselsnummer.md'), 'utf8').includes('010190 12345'))
  ok('regler.SANN er den sanne setningen (§7 spørsmål 3), uten master-key', regler.SANN.startsWith('Alt ligger på denne maskinen.') && !/master-key/i.test(regler.SANN))
  // utlevert-teller fra loggen
  logDelivery({ tool: 'spor', mottaker: 'test', saker: [{ id: ensom.id, version: 1, level: 'S' }, { id: s1.id, version: 1, level: 'M' }] }); logDelivery({ tool: 'tua_get', id: ensom.id, level: 'M' })
  const dc = deliveryCounts()
  ok('store.deliveryCounts: antall sendinger per sak (motorens saker[] og MCP-døras id), bare tellinger', dc.get(ensom.id) === 2 && dc.get(s1.id) === 1 && !dc.has(ko.id))
  // PDF-tittel fra filnavn når metadata-tittelen er tom eller teknisk
  ok('brukbarTittel: «pdf.html», «rapport_v2.docx», «Microsoft Word», «Untitled», «Document1», en sti, bare tall og tomt → null', ['pdf.html', 'rapport_v2.docx', 'Microsoft Word', 'Untitled', 'Document1', 'C:/Users/x/fil', '2026-10-24', '', ' ', 'ab', 'IMG_0042'].every((x) => brukbarTittel(x) === null))
  ok('brukbarTittel: en ekte tittel brukes som den er (mellomrom flatet)', brukbarTittel('Leieavtale Storgata 12  –  forhandlingsnotat') === 'Leieavtale Storgata 12 – forhandlingsnotat' && brukbarTittel('Årsoppgjør 2025') === 'Årsoppgjør 2025')
  ok('tittelFor: teknisk metadata-tittel → filnavnet uten endelse', tittelFor({ tittel: brukbarTittel('pdf.html'), navn: 'Leieavtale Storgata 12.pdf' }) === 'Leieavtale Storgata 12' && tittelFor({ tittel: 'Referat', navn: 'x.pdf' }) === 'Referat')
}

// ── Runde 2a+2b (arb. 32, planen videre §1 og §3, 24.10.2026): ett sted — adressene, Siden sist, Mapper, raden for #sak/<id>, rundene i en tråd ─
{
  ok('regler.normaliserAdresse: /oppslag, /spor og /forside sendes til / med hashen i behold', ['/oppslag', '/spor/', '/forside'].every((p) => { const n = regler.normaliserAdresse(p, '#sak/a_1'); return n.sti === '/' && n.hash === '#sak/a_1' && n.endret }))
  ok('regler.normaliserAdresse: #atom/<id> (kortet i Claude) blir #sak/<id>; /innboks blir / med #innboks; / med #sak er uendret', regler.normaliserAdresse('/', '#atom/a_1').hash === '#sak/a_1' && regler.normaliserAdresse('/oppslag', '#atom/a_1').hash === '#sak/a_1' && regler.normaliserAdresse('/innboks').hash === '#innboks' && regler.normaliserAdresse('/', '#sak/a_1').endret === false && regler.normaliserAdresse('/innstillinger', '#utlevert').sti === '/innstillinger')
  ok('regler.lesHash: sak, innboks, samtale, ingenting', regler.lesHash('#sak/a_1').sak === 'a_1' && regler.lesHash('#sak/a%201').sak === 'a 1' && regler.lesHash('#innboks').innboks === true && regler.lesHash('#samtale/Budsjett').samtale === 'Budsjett' && Object.keys(regler.lesHash('')).length === 0)
  const T0 = Date.parse('2026-10-24T12:00:00+02:00'), T = (h) => T0 - h * 36e5
  const liste = [
    { id: 'p', kind: 'prompt', convo: 'Hva nå?', capturedAt: T(3), tråd: 'p', project: 'A', content: 'Hva nå?' },
    { id: 's1', kind: 'svar', convo: 'Hva nå?', capturedAt: T(2), tråd: 'p', project: 'A', status: 'utkast', tags: ['svar'] },
    { id: 's2', kind: 'svar', convo: 'Hva nå?', capturedAt: T(1.5), tråd: 'p', project: 'A', status: 'utkast', tags: ['svar'] },
    { id: 'f', kind: 'svar', convo: 'Hva nå?', capturedAt: T(1.2), tråd: 'p', project: 'A', status: 'utkast', tags: ['svar', 'forskjeller'] },
    { id: 'k', kind: 'konklusjon', convo: 'Hva nå?', capturedAt: T(1), tråd: 'p', project: 'A', status: 'utkast' },
    { id: 'p2', kind: 'prompt', convo: 'Hva nå?', capturedAt: T(0.5), tråd: 'p2', project: 'A', content: 'Og så?' },
    { id: 's3', kind: 'svar', convo: 'Hva nå?', capturedAt: T(0.4), tråd: 'p2', project: 'A', status: 'endelig', tags: ['svar'] },
    { id: 'd', kind: 'capture', capturedAt: T(30), project: 'B', file: '/x/B/Notat om noe.md', mtime: T(0.2) },
    { id: 'e', kind: 'capture', capturedAt: T(10), project: 'B', file: '/x/B/Eldre.md', mtime: T(40) },
    { id: 'gammel', kind: 'svar', capturedAt: T(60), tråd: 'q', project: 'B', status: 'utkast', tags: ['svar'] },
  ]
  const ss = regler.sidenSist(liste, { sist: T(24), innboks: 2 })
  ok('regler.sidenSist: svar etter forrige besøk (ikke Forskjeller, ikke eldre), konklusjoner som er utkast, filer i Innboks', ss.svar.map((a) => a.id).join() === 's3,s2,s1' && ss.konklusjoner.map((a) => a.id).join() === 'k' && ss.innboks === 2 && ss.noe === true)
  ok('regler.sidenSist: ingenting → noe = false', regler.sidenSist([{ id: 'x', kind: 'capture', capturedAt: T(1) }], { sist: T(24), innboks: 0 }).noe === false)
  const m = regler.mapper(liste)
  ok('regler.mapper: prosjektene som mapper (sortert på navn), sakene som filer under, nyeste øverst etter mtime (ellers capturedAt), prompter med, ingen tråder', m.map((x) => x.navn).join() === 'A,B' && m[1].saker.map((a) => a.id).join() === 'd,e,gammel' && m[0].saker.length === 7 && m[0].saker[0].id === 's3')
  ok('regler.filnavn: fila slik den heter i mappa', regler.filnavn(liste[7]) === 'Notat om noe.md' && regler.filnavn({ name: 'Uten fil' }) === 'Uten fil.md')
  const rader = regler.slåSammenTråder(liste.filter((a) => a.kind !== 'prompt').sort((x, y) => y.capturedAt - x.capturedAt), liste)
  ok('regler.radFor: #sak/<id> finner raden selv, eller tråd-oppføringen som har prompten, et svar, Forskjeller eller konklusjonen', regler.radFor(rader, 'd')?.id === 'd' && regler.radFor(rader, 'p')?.id === 'k' && regler.radFor(rader, 's1')?.id === 'k' && regler.radFor(rader, 'f')?.id === 'k' && regler.radFor(rader, 'p2')?.id === 's3' && regler.radFor(rader, 'finnes-ikke') === null && regler.radFor(rader, null) === null)
  const r = regler.runder(liste, 'Hva nå?')
  ok('regler.runder: samtalen som runder, eldste først — hver prompt med svarene (uten Forskjeller), Forskjeller og konklusjonen', r.length === 2 && r[0].prompt.id === 'p' && r[0].svar.map((a) => a.id).join() === 's1,s2' && r[0].forskjeller?.id === 'f' && r[0].konklusjon?.id === 'k' && r[1].prompt.id === 'p2' && r[1].svar.length === 1 && r[1].forskjeller === null && r[1].konklusjon === null && regler.runder(liste, '').length === 0)
  ok('regler.kortS: første setning innen ~170 tegn, ellers klippet på ord med …', regler.kortS('Kort.') === 'Kort.' && regler.kortS('Første setning er lang nok til å telle som en ingress i seg selv, med tall og alt. Andre setning som ikke skal med fordi den er for lang til kortet.', 120) === 'Første setning er lang nok til å telle som en ingress i seg selv, med tall og alt.' && regler.kortS('x'.repeat(100) + ' ' + 'y'.repeat(100)).endsWith(' …'))
  ok('regler.sakAdresse: /#sak/<id> (kodet)', regler.sakAdresse('a 1') === '/#sak/a%201')
  // runde 2c: hender og tastatur
  ok('regler.nesteRad: j/k flytter blant radene som vises; uten fokus starter j øverst og k nederst; stopper i endene', regler.nesteRad(['a', 'b', 'c'], 'a', 1) === 'b' && regler.nesteRad(['a', 'b', 'c'], 'c', 1) === 'c' && regler.nesteRad(['a', 'b', 'c'], 'b', -1) === 'a' && regler.nesteRad(['a', 'b', 'c'], null, 1) === 'a' && regler.nesteRad(['a', 'b', 'c'], null, -1) === 'c' && regler.nesteRad([], 'a', 1) === null && regler.nesteRad(['a', 'b'], 'x', 1) === 'a')
  ok('regler.fangetTekst: «12 fangede saker fra Claude Code, Desktop og Cowork» — kildene etter antall, Claude Desktop som Desktop; 0 → tom', regler.fangetTekst(12, { 'Claude Code': 6, Cowork: 2, 'Claude Desktop': 4 }) === '12 fangede saker fra Claude Code, Desktop og Cowork' && regler.fangetTekst(1, { Cowork: 1 }) === '1 fanget sak fra Cowork' && regler.fangetTekst(3) === '3 fangede saker' && regler.fangetTekst(0, { Cowork: 1 }) === '')
  ok('regler.innlesingTekst: leser → side 2 av 5 → lest (ord, sider) → skriver ingress → «Navn» ligger i Prosjekt; feil; ukjent hendelse → null', regler.innlesingTekst('leser', {}, 'x.pdf') === 'leser «x.pdf» …' && regler.innlesingTekst('side', { side: 2, av: 5 }, 'x.pdf') === 'leser «x.pdf» … side 2 av 5' && regler.innlesingTekst('lest', { ord: 812, sider: 5 }) === 'lest: 812 ord · 5 sider — skriver ingress …' && regler.innlesingTekst('skriver', { modell: 'gemma3:4b', medM: true }) === 'gemma3:4b skriver ingress og sammendrag …' && regler.innlesingTekst('ferdig', { name: 'Leieavtale', project: 'Uten prosjekt' }) === '«Leieavtale» ligger i Uten prosjekt' && regler.innlesingTekst('feil', { feil: 'tom' }) === 'gikk ikke: tom' && regler.innlesingTekst('tull', {}) === null)
  ok('regler.slippProsjekt: prosjektet fila slippes på, ellers «Uten prosjekt»', regler.slippProsjekt('Lager') === 'Lager' && regler.slippProsjekt('') === 'Uten prosjekt' && regler.slippProsjekt(undefined) === regler.UTEN_PROSJEKT)
  ok('regler.sidenSist: fangede teller som «noe» (bøtta vises); lesHash(#fanget) åpner den', regler.sidenSist([], { sist: 0, innboks: 0, fanget: 3 }).fanget === 3 && regler.sidenSist([], { fanget: 3 }).noe === true && regler.sidenSist([], { fanget: 0 }).noe === false && regler.lesHash('#fanget').fanget === true)
}

// ── 4) broen: /innboks, /api/atoms-feltene, /api/innboks og /api/innboks/antall ─
const PORT = 5298
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
fs.writeFileSync(path.join(ROOT, 'Innboks', 'notat.txt'), 'Et notat som venter i Innboks. '.repeat(40))
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1', TUA_SKRIVER: 'regel', TUA_TESTMOTTAKERE: '2', TUA_VURDERER: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, init); return { status: r.status, type: r.headers.get('content-type') || '', tekst: await r.text() } }
try {
  const side = await hent('/innboks')
  ok('GET /innboks → app-fila (appen sender videre til / med #innboks — Innboks er en linje, ikke et sted, runde 2a)', side.status === 200 && /text\/html/.test(side.type) && side.tekst.includes('app-test'))
  for (const rute of ['/oppslag', '/spor', '/forside']) ok(`GET ${rute} → app-fila (ruta finnes ikke lenger i appen; router.jsx sender til / med hashen i behold — gamle lenker virker)`, (await hent(rute)).tekst.includes('app-test'))
  const at = JSON.parse((await hent('/api/atoms')).tekst)
  const s = at.atoms.find((a) => a.key === `samtale:${SID}`)
  ok('GET /api/atoms: feltene lista trenger — id, name, project, kind, capturedAt, convo, tags, levels.S, ord, tegn, max, vault, status, source', !!s && ['id', 'name', 'project', 'kind', 'capturedAt', 'convo', 'tags', 'levels', 'ord', 'tegn', 'max', 'vault', 'status', 'source'].every((f) => s[f] !== undefined) && s.kind === 'samtale' && typeof s.levels.S.text === 'string' && typeof s.ord.S === 'number', s ? Object.keys(s).join(',') : 'mangler')
  ok('GET /api/atoms: nyeste først (lista og avisen sorterer selv, men svaret er alt sortert)', at.atoms.every((a, i) => i === 0 || at.atoms[i - 1].capturedAt >= a.capturedAt))
  ok('runde 2a: GET /api/atoms gir det Mapper trenger — project, file (stien i arkivet) og mtime (filas tid, et tall) på hver sak', at.atoms.every((a) => typeof a.project === 'string' && typeof a.file === 'string' && a.file.startsWith(ROOT) && typeof a.mtime === 'number' && a.mtime > 0), JSON.stringify({ file: s?.file, mtime: s?.mtime }))
  const ib = JSON.parse((await hent('/api/innboks')).tekst)
  ok('GET /api/innboks: teller dokumentet som venter (notat.txt), Tuas egne saker og skjulte filer teller ikke', ib.antall === 1 && ib.dokumenter[0].navn === 'notat.txt' && !!ib.dokumenter[0].label, JSON.stringify({ antall: ib.antall, dok: ib.dokumenter.map((d) => d.navn) }))
  const an = JSON.parse((await hent('/api/innboks/antall')).tekst)
  ok('GET /api/innboks/antall: bare tellingen og navnene (til app-hodet og forsidens linje)', an.antall === 1 && an.dokumenter.length === 1 && an.dokumenter[0] === 'notat.txt' && Object.keys(an).length === 2, JSON.stringify(an))
  fs.unlinkSync(path.join(ROOT, 'Innboks', 'notat.txt'))
  ok('GET /api/innboks/antall etter at fila er borte → 0', JSON.parse((await hent('/api/innboks/antall')).tekst).antall === 0)
  // runde 1: innlesing med fremdrift — POST /api/innboks/les er SSE: start → leser → lest → skriver? → sak per fil → slutt
  fs.writeFileSync(path.join(ROOT, 'Innboks', 'brev.md'), '# Brev om lageret\n\nLageret flyttes. ' + 'Mer tekst om flyttingen. '.repeat(30))
  const sse = await fetch(`http://127.0.0.1:${PORT}/api/innboks/les`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prosjekt: 'Lager' }) })
  const råSSE = await sse.text()
  const hendelser = råSSE.split('\n\n').filter(Boolean).map((b) => [b.match(/^event: (.+)$/m)?.[1], JSON.parse(b.match(/^data: (.+)$/m)?.[1] || '{}')])
  const navnSSE = hendelser.map((h) => h[0])
  ok('runde 1: POST /api/innboks/les er SSE med fremdrift per fil (start → leser → lest → sak → slutt), fila lest inn i valgt prosjekt', sse.status === 200 && /event-stream/.test(sse.headers.get('content-type') || '') && navnSSE[0] === 'start' && navnSSE.includes('leser') && navnSSE.includes('lest') && navnSSE.includes('sak') && navnSSE.at(-1) === 'slutt' && hendelser.find((h) => h[0] === 'sak')[1].fil === 'brev.md' && hendelser.find((h) => h[0] === 'sak')[1].project === 'Lager' && hendelser.at(-1)[1].lest === 1, navnSSE.join(' '))
  ok('runde 1: fila er flyttet til Innboks/Ferdig, saken har tittel fra overskriften, Innboks er tom igjen', fs.existsSync(path.join(ROOT, 'Innboks', 'Ferdig', 'brev.md')) && load().some((a) => a.name === 'Brev om lageret' && a.project === 'Lager') && JSON.parse((await hent('/api/innboks/antall')).tekst).antall === 0)

  // ── runde 2c (app): dra og slipp → POST /api/les med fila som rå kropp (SSE), flytt via /api/flytt, søk med fangetUtenfor, konklusjon som strøm ─
  const post = async (p, body) => hent(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const sseAv = (rå) => rå.split('\n\n').filter(Boolean).map((b) => [b.match(/^event: (.+)$/m)?.[1], JSON.parse(b.match(/^data: (.+)$/m)?.[1] || '{}')])
  const md = '# Snøbrøyting hytta\n\n' + 'Brøyteavtalen gjelder fra 1. november til 30. april og koster 6 500 kr per sesong. '.repeat(12)
  const les1 = await fetch(`http://127.0.0.1:${PORT}/api/les?navn=${encodeURIComponent('Snøbrøyting.md')}&prosjekt=${encodeURIComponent('Uten prosjekt')}&samtale=${encodeURIComponent('Dratt inn')}`, { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: md })
  const h1 = sseAv(await les1.text()), n1 = h1.map((h) => h[0]), ferdig1 = h1.find((h) => h[0] === 'ferdig')?.[1]
  ok('dra og slipp: POST /api/les med fila som rå kropp (?navn&prosjekt) → SSE leser → lest → ferdig; saken lander i «Uten prosjekt» med tittel fra overskriften', les1.status === 200 && /event-stream/.test(les1.headers.get('content-type') || '') && n1[0] === 'leser' && n1.includes('lest') && n1.at(-1) === 'ferdig' && ferdig1.project === 'Uten prosjekt' && ferdig1.name === 'Snøbrøyting hytta' && fs.existsSync(path.join(ROOT, 'Uten prosjekt', 'Snøbrøyting hytta.md')), n1.join(' '))
  // PDF: fremdrift side for side
  const esc = (x) => x.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const lagPdf = (sider) => {
    const objs = []; const add = (x) => { objs.push(x); return objs.length }
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); const pagesId = objs.length + 1 + sider.length * 2; const pageIds = []
    for (const linjer of sider) { const inner = linjer.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 16} Td (${esc(l)}) Tj ET`).join('\n'); const c = add(`<< /Length ${Buffer.byteLength(inner, 'latin1')} >>\nstream\n${inner}\nendstream`); pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`)) }
    const pages = add(`<< /Type /Pages /Kids [${pageIds.map((x) => `${x} 0 R`).join(' ')}] /Count ${pageIds.length} >>`); const cat = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`)
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = []
    objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = Buffer.byteLength(out, 'latin1')
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(out, 'latin1')
  }
  const pdf = lagPdf([['Leieavtale Storgata 12', 'Leien er 1 480 000 kr per aar.'], ['Side to med vilkaar.'], ['Side tre: signaturer.']])
  const les2 = await fetch(`http://127.0.0.1:${PORT}/api/les?navn=${encodeURIComponent('Leieavtale.pdf')}&prosjekt=Lager`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf })
  const h2 = sseAv(await les2.text()), sider = h2.filter((h) => h[0] === 'side').map((h) => `${h[1].side}/${h[1].av}`)
  ok('dra og slipp (PDF): SSE gir side {side, av} per side mellom leser og lest — «leser … side 2 av 3» — og saken har 3 sider', les2.status === 200 && sider.join(' ') === '1/3 2/3 3/3' && h2.map((h) => h[0]).indexOf('side') > h2.map((h) => h[0]).indexOf('leser') && h2.find((h) => h[0] === 'lest')?.[1].sider === 3 && h2.at(-1)[0] === 'ferdig' && h2.at(-1)[1].project === 'Lager', h2.map((h) => h[0]).join(' '))
  ok('dra og slipp: uten ?navn → 400; JSON-kropp uten sti → 400 (som før)', (await fetch(`http://127.0.0.1:${PORT}/api/les`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status === 400 && (await post('/api/les', {})).status === 400)
  // dra en sak til en mappe = /api/flytt (ett spørsmål i appen, så dette kallet)
  const fl = await post('/api/flytt', { id: ferdig1.id, prosjekt: 'Lager' })
  ok('dra en sak til en mappe: POST /api/flytt {id, prosjekt} flytter fila i arkivet og svarer med saken i det nye prosjektet', fl.status === 200 && JSON.parse(fl.tekst).atom.project === 'Lager' && JSON.parse(fl.tekst).før === 'Uten prosjekt' && fs.existsSync(path.join(ROOT, 'Lager', 'Snøbrøyting hytta.md')) && !fs.existsSync(path.join(ROOT, 'Uten prosjekt', 'Snøbrøyting hytta.md')))
  // søket bærer fangetUtenfor (0 her — ingen fangede i dette arkivet), så forsiden kan tilby «ta med fangede»
  const sø = JSON.parse((await hent('/api/search?q=lageret&limit=5')).tekst)
  ok('/api/search svarer med fangetUtenfor (tall) og fanget per treff — forsidens «ta med fangede» bygger på det', typeof sø.fangetUtenfor === 'number' && sø.hits.every((h) => h.fanget === false))
  // konklusjon som strøm: «Også til …» og «Kjør igjen» på konklusjonen viser fremdriften (vurderer {svar: N} → forskjeller → konklusjon-del → konklusjon → slutt)
  const pr = load().find((a) => a.key === 'prompt:t')
  const ks = await fetch(`http://127.0.0.1:${PORT}/api/konklusjon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: pr.id, strøm: true }) })
  const h3 = sseAv(await ks.text()), n3 = h3.map((h) => h[0])
  const v0 = h3.find((h) => h[0] === 'vurderer')?.[1]
  ok('POST /api/konklusjon {strøm: true}: SSE — vurderer {steg: forskjeller, svar: 2} først, så forskjeller, vurderer {konklusjon}, konklusjon-del, konklusjon, slutt med begge', ks.status === 200 && /event-stream/.test(ks.headers.get('content-type') || '') && v0?.steg === 'forskjeller' && v0?.svar === 2 && n3.includes('forskjeller') && n3.includes('konklusjon-del') && n3.includes('konklusjon') && n3.at(-1) === 'slutt' && h3.at(-1)[1].konklusjon?.tilgjengelig === true && h3.at(-1)[1].forskjeller?.tilgjengelig === true, n3.join(' '))
  ok('POST /api/konklusjon uten strøm: JSON som før', JSON.parse((await post('/api/konklusjon', { prompt: pr.id })).tekst).konklusjon?.tilgjengelig === true)

  // ── 5) friksjon 13: stier i sakens tekst kan vises i Finder (dryrun) — ingen frie stier ─
  const MAPPE = path.join(HJEM, 'Dropbox', 'Advokat – Energima anke')
  fs.mkdirSync(MAPPE, { recursive: true })
  for (const f of ['00 Orientering.pdf', 'Anke-v3.pdf', 'Anke-v3.docx', 'pakke.zip']) fs.writeFileSync(path.join(MAPPE, f), 'x')
  fs.writeFileSync(path.join(HJEM, 'hemmelig.txt'), 'x')
  const utenfor = path.join(SCRATCH, 'utenfor.txt'); fs.writeFileSync(utenfor, 'x')
  const L = `# Lenkeliste\n\nAlle under ${MAPPE}/\n\n- \`00 Orientering.pdf\` — innledende\n- \`Anke-v3.pdf/.docx\` — utkast\n- \`${path.join(HJEM, 'pakke-finnes-ikke.zip')}\` — hele pakken\n- ${utenfor} — utenfor hjemmemappa`
  const atomsL = load(); const lenkeliste = upsert(atomsL, { key: 'sak:lenkeliste', name: 'Lenkeliste', content: L, project: 'Lager', by: 'menneske' }).atom; save(atomsL)
  const åpne = (body) => post('/api/open', { target: 'finder', ...body })
  ok('mappa + filnavn hver for seg i teksten → vist (dryrun)', (await åpne({ id: lenkeliste.id, href: path.join(MAPPE, '00 Orientering.pdf') })).status === 200)
  ok('«Anke-v3.pdf/.docx»: både .pdf og .docx → vist', (await åpne({ id: lenkeliste.id, href: path.join(MAPPE, 'Anke-v3.pdf') })).status === 200 && (await åpne({ id: lenkeliste.id, href: path.join(MAPPE, 'Anke-v3.docx') })).status === 200)
  ok('fil i hjemmemappa som IKKE står i teksten → 403', (await åpne({ id: lenkeliste.id, href: path.join(HJEM, 'hemmelig.txt') })).status === 403)
  ok('fil i mappa som ikke står i teksten → 403', (await åpne({ id: lenkeliste.id, href: path.join(MAPPE, 'pakke.zip') })).status === 403)
  ok('sti som står i teksten men ligger utenfor hjemmemappa → 403', (await åpne({ id: lenkeliste.id, href: utenfor })).status === 403)
  ok('sti som står i teksten men ikke finnes → 403', (await åpne({ id: lenkeliste.id, href: path.join(HJEM, 'pakke-finnes-ikke.zip') })).status === 403)
  ok('uten id: broen finner saken som nevner stien → vist; ukjent sti → 403', (await åpne({ href: path.join(MAPPE, 'Anke-v3.docx') })).status === 200 && (await åpne({ href: path.join(HJEM, 'hemmelig.txt') })).status === 403)
  ok('sakens egen fil virker som før', (await åpne({ id: lenkeliste.id })).status === 200)

  // ── 6) friksjon 18: «Avis · N Mapper · N Filer» med ekte tall, Filer som flat liste, klasse-regelen, filter på mappefiler ─
  const LAGER = path.join(ROOT, 'Lager'), DAG = 86400e3, nå = Date.now()
  fs.writeFileSync(path.join(LAGER, 'Leieavtale-signert.pdf'), '%PDF-1.4 ' + 'x'.repeat(5000)); fs.utimesSync(path.join(LAGER, 'Leieavtale-signert.pdf'), new Date('2020-03-01T10:00:00Z'), new Date('2020-03-01T10:00:00Z'))
  fs.writeFileSync(path.join(LAGER, 'Oversikt.html'), '<html><body><h1>Oversikt</h1></body></html>')
  fs.mkdirSync(path.join(LAGER, 'Vedlegg'), { recursive: true }); fs.writeFileSync(path.join(LAGER, 'Vedlegg', 'Notat.docx'), Buffer.alloc(3000)); fs.utimesSync(path.join(LAGER, 'Vedlegg', 'Notat.docx'), new Date(nå - 3 * DAG), new Date(nå - 3 * DAG))
  { const at6 = load(); upsert(at6, { key: 'svar:hook:fanget1', name: 'Fanget svar fra en Code-økt', content: 'Et svar hooken fanget. '.repeat(30), project: 'Lager', fanget: true, by: 'regel', short: 'Et svar hooken fanget.' }); upsert(at6, { key: 'commit-logg', name: 'Commit-logg', content: 'Speilet fra repoet. '.repeat(20), project: 'Lager', drift: true, by: 'regel', short: 'Commit-logg speilet fra repoet.' }); save(at6) }
  const at6 = JSON.parse((await hent('/api/atoms')).tekst).atoms
  const mp = JSON.parse((await hent('/api/mappe')).tekst).prosjekter
  const lagerInfo = mp.find((p) => p.navn === 'Lager')
  ok('friksjon 18: GET /api/mappe teller filene som ikke er saker per prosjekt (Lager: 3 — pdf, html og docx i undermappe; .md teller som sak, ikke fil)', lagerInfo?.filer === 3 && lagerInfo.saker === at6.filter((a) => a.project === 'Lager').length, JSON.stringify(lagerInfo))
  const filer6 = []   // slik appen gjør det: filene hentes for hvert prosjekt som har noen
  for (const p of mp) if (p.filer > 0) { const j = JSON.parse((await hent(`/api/mappe?prosjekt=${encodeURIComponent(p.navn)}`)).tekst); for (const f of j.filer) filer6.push({ ...f, project: p.navn }) }
  ok('friksjon 18: GET /api/mappe?prosjekt gir mtime (tall) og sti på hver fil, nyeste først', filer6.length === 3 && filer6.every((f) => typeof f.mtime === 'number' && f.mtime > 0 && typeof f.sti === 'string') && filer6.find((f) => f.navn === 'Notat.docx')?.sti === 'Vedlegg/Notat.docx', JSON.stringify(filer6.map((f) => [f.navn, f.sti])))
  const mapperL = regler.mapperMed(at6, filer6), flatAlle = regler.filerFlat(regler.utvalg(at6), filer6), tallene = { ...regler.tellVisning(mapperL, [], flatAlle), filer: flatAlle.length }   // friksjon 19: tellVisning(mapper, samtaler, dokumenter); «filer» her = Filer-lista fra 18
  const prosjekterMedFil = new Set([...at6.map((a) => a.project), ...filer6.map((f) => f.project)])
  ok('friksjon 18: tallet på Mapper-knappen = prosjekter med minst én fil (saker eller mappefiler) — regnet av /api/atoms + /api/mappe', tallene.mapper === prosjekterMedFil.size && tallene.mapper === mp.filter((p) => p.saker + p.filer > 0).length, `${tallene.mapper} · ${prosjekterMedFil.size} · ${mp.filter((p) => p.saker + p.filer > 0).length}`)
  ok('friksjon 18: tallet på Filer-knappen = saker etter klasse-regelen + mappefiler; Mapper-raden «Lager · N» = alle saker i mappa + 3 filer', tallene.filer === regler.utvalg(at6).length + 3 && mapperL.find((m) => m.navn === 'Lager')?.antall === at6.filter((a) => a.project === 'Lager').length + 3, `${tallene.filer} · ${mapperL.find((m) => m.navn === 'Lager')?.antall}`)
  ok('friksjon 18: Filer-lista er dato sist først — mappefiler på mtime: Oversikt.html (nå) først, Leieavtale-signert.pdf (2020) sist', flatAlle.every((r, i) => i === 0 || flatAlle[i - 1].tid >= r.tid) && flatAlle[0].slag === 'fil' && flatAlle[0].fil.navn === 'Oversikt.html' && flatAlle.at(-1).fil?.navn === 'Leieavtale-signert.pdf', flatAlle.slice(0, 3).map((r) => r.navn).join(' | '))
  ok('friksjon 18: én linje per fil — saker i Filer er ikke slått sammen til tråder (prompt-saken står ikke, svarene i tråden står som filer i treff)', !flatAlle.some((r) => r.slag === 'sak' && r.sak.kind === 'prompt') && regler.filerFlat(regler.utvalg(at6, { treff: true }), []).some((r) => r.sak?.kind === 'svar'))
  const fanget6 = at6.find((a) => a.key === 'svar:hook:fanget1'), drift6 = at6.find((a) => a.key === 'commit-logg')
  ok('friksjon 18: klasse-regelen i Filer — fanget og drift står utenfor uten «ta med» …', !!fanget6 && !!drift6 && !flatAlle.some((r) => r.sak?.id === fanget6.id || r.sak?.id === drift6.id))
  const flatMed = regler.filerFlat(regler.utvalg(at6, { med: true }), filer6)
  const u6 = regler.utenfor(at6)   // arkivet har alt fangede og drift fra importen over — tallet vokser med akkurat det utenfor-linja sier
  ok('… og er med når «ta med» er på; tallet på Filer-knappen vokser med det som sto utenfor', flatMed.some((r) => r.sak?.id === fanget6.id) && flatMed.some((r) => r.sak?.id === drift6.id) && flatMed.length === tallene.filer + u6.fanget + u6.drift, `${tallene.filer} → ${flatMed.length} (${u6.fanget} fangede, ${u6.drift} drift)`)
  ok('friksjon 18: Mapper viser alt i mappa, som Finder — fanget og drift ligger under Lager uansett', mapperL.find((m) => m.navn === 'Lager').saker.some((a) => a.id === fanget6.id) && mapperL.find((m) => m.navn === 'Lager').saker.some((a) => a.id === drift6.id))
  ok('friksjon 18: en mappe med bare mappefiler er også en mappe (teller på Mapper-knappen), og antall = filene', regler.mapperMed([], filer6).find((m) => m.navn === 'Lager')?.antall === 3 && regler.tellVisning(regler.mapperMed([], filer6), [], []).mapper === 1)
  ok('friksjon 18: utenfor-linja under Filer sier det samme som knappen holder utenfor («N fangede · N drift holdt utenfor»)', u6.fanget >= 1 && u6.drift >= 1 && regler.utenforTekst(u6) === `${u6.fanget} ${u6.fanget === 1 ? 'fanget' : 'fangede'} · ${u6.drift} drift holdt utenfor`, regler.utenforTekst(u6))
  const pdf6 = filer6.find((f) => f.navn === 'Leieavtale-signert.pdf'), html6 = filer6.find((f) => f.navn === 'Oversikt.html'), docx6 = filer6.find((f) => f.navn === 'Notat.docx')
  ok('friksjon 18: passerFil — navnefilteret treffer filnavn og sti (uavhengig av store/små bokstaver)', regler.passerFil(pdf6, { q: 'leieavtale' }) && !regler.passerFil(html6, { q: 'leieavtale' }) && regler.passerFil(docx6, { q: 'vedlegg' }))
  ok('friksjon 18: passerFil — perioden gjelder filas tid: siste 7 dager tar html og docx, ikke PDF-en fra 2020; egen periode med til-dato', regler.passerFil(html6, { fra: nå - 7 * DAG }) && regler.passerFil(docx6, { fra: nå - 7 * DAG }) && !regler.passerFil(pdf6, { fra: nå - 7 * DAG }) && regler.passerFil(pdf6, { fra: Date.parse('2020-01-01'), til: Date.parse('2020-06-01') }) && !regler.passerFil(html6, { fra: Date.parse('2020-01-01'), til: Date.parse('2020-06-01') }))
  ok('friksjon 18: passerFil — prosjektfilteret på mappa; type/samtale/tagg er sakens egenskaper og holder mappefiler utenfor', regler.passerFil(pdf6, { prosjekt: 'Lager' }) && !regler.passerFil(pdf6, { prosjekt: 'Hytta' }) && !regler.passerFil(pdf6, { type: 'dokument' }) && !regler.passerFil(pdf6, { samtale: 'x' }) && !regler.passerFil(pdf6, { tagg: 'x' }))
  ok('friksjon 18: tallene følger filteret — med «leieavtale» i navnefilteret er bare PDF-en med blant mappefilene', regler.tellVisning(regler.mapperMed([], filer6.filter((f) => regler.passerFil(f, { q: 'leieavtale' }))), [], regler.filerFlat([], filer6.filter((f) => regler.passerFil(f, { q: 'leieavtale' })))).dokumenter === 1)

  // ── 7) friksjon 19: «Avis · N Mapper · N Samtaler · N Dokumenter» — Samtaler = samtalelogger (uansett fanget) + Spør-tråder, Dokumenter = Filer minus samtalene ─
  { const at7 = load()
    upsert(at7, { key: 'samtale:desk-fanget', kind: 'samtale', name: 'Fanget Desktop-samtale om lageret', content: 'Transkript. '.repeat(40), project: 'Lager', convo: 'Fanget Desktop-samtale om lageret', source: 'Claude Desktop', by: 'regel', fanget: true, short: 'Sist: … · 3 vendinger', links: [{ kind: 'claude-chat', href: 'claude://claude.ai/chat/aaaa-bbbb', label: 'Samtalen i Claude Desktop' }] })
    upsert(at7, { key: 'svar:hook:i-samtalen', kind: 'svar', name: 'Svar i den fangede samtalen', content: 'Et svar fanget i samtalen. '.repeat(20), project: 'Lager', convo: 'Fanget Desktop-samtale om lageret', source: 'Claude Desktop', by: 'regel', fanget: true, short: 'Et svar i samtalen.' })
    upsert(at7, { key: 'sak:notat-i-samtalen', kind: 'capture', name: 'Notat fra samtalen om lageret', content: 'Et notat Erik beholdt fra samtalen. '.repeat(20), project: 'Lager', convo: 'Fanget Desktop-samtale om lageret', source: 'Claude Desktop', by: 'menneske', short: 'Notat beholdt fra samtalen.' })
    upsert(at7, { key: 'samtale:bygg-drift', kind: 'samtale', name: 'Byggeøkt: friksjon 19', content: 'Tuas egen økt. '.repeat(40), project: 'Tua_tua', convo: 'Byggeøkt: friksjon 19', source: 'Claude Code', by: 'regel', drift: true, short: 'Sist: bygg · 12 vendinger' })
    upsert(at7, { key: 'prompt:spor:ensom', kind: 'prompt', name: 'Hva koster flyttingen totalt?', content: 'Hva koster flyttingen totalt?', project: 'Lager', convo: 'Hva koster flyttingen totalt?', source: 'Tua', by: 'regel', short: 'Hva koster flyttingen totalt?' })
    save(at7) }
  const at7 = JSON.parse((await hent('/api/atoms')).tekst).atoms
  const logger = at7.filter((a) => a.kind === 'samtale'), fangetLogg = at7.find((a) => a.key === 'samtale:desk-fanget'), driftLogg = at7.find((a) => a.key === 'samtale:bygg-drift'), ensomPrompt = at7.find((a) => a.key === 'prompt:spor:ensom'), prT = at7.find((a) => a.key === 'prompt:t')
  ok('friksjon 19: /api/atoms gir det Samtaler trenger — tråd = prompt-id på svar/konklusjon, prompten har tråd = egen id, loggene har kind samtale og klasse', prT && prT.tråd === prT.id && at7.filter((a) => a.tråd === prT.id && a.id !== prT.id).length >= 3 && fangetLogg?.klasse === 'spor' && driftLogg?.klasse === 'drift' && logger.length >= 3, `${logger.length} logger`)
  const sm = regler.samtalerFlat(at7), smMed = regler.samtalerFlat(at7, { med: true })
  const samtaleRader = sm.filter((r) => r.slag === 'samtale'), trådRader = sm.filter((r) => r.slag === 'tråd')
  ok('friksjon 19: Samtaler = alle samtalelogger uansett fanget-flagg (beholdere, V14) — den fangede Desktop-samtalen og Code-importen er med; drift (byggeøkta) bare med «ta med»', samtaleRader.some((r) => r.id === fangetLogg.id) && samtaleRader.some((r) => r.logg.key === `samtale:${SID}`) && !sm.some((r) => r.id === driftLogg.id) && smMed.some((r) => r.id === driftLogg.id) && samtaleRader.length === logger.filter((a) => a.klasse !== 'drift').length, `${samtaleRader.length} samtaler · ${trådRader.length} tråder · med drift ${smMed.length}`)
  const fr = samtaleRader.find((r) => r.id === fangetLogg.id)
  ok('friksjon 19: samtalelinja — tittel, prosjekt, N saker (sakene som deler samtalenavnet, ikke loggen selv), dato = siste aktivitet, «Fortsett i Claude» fra loggens lenke', fr.navn === 'Fanget Desktop-samtale om lageret' && fr.project === 'Lager' && fr.antall === 2 && fr.saker.every((a) => a.id !== fangetLogg.id) && fr.tid >= fangetLogg.capturedAt && fr.claude === 'claude://claude.ai/chat/aaaa-bbbb', JSON.stringify({ antall: fr.antall, saker: fr.saker.map((a) => a.name) }))
  ok('friksjon 19: Spør-tråden (prompt, svarene, Forskjeller, konklusjonen) er ÉN linje med tråd-oppføringen som i avisen (tittel = spørsmålet, N = alle sakene i tråden); en Spør-prompt uten svar er også en tråd (1 sak)', trådRader.some((r) => r.id === prT.id && regler.erTråd(r.rad) && r.navn === 'Hva er fristen?' && r.antall === at7.filter((a) => a.tråd === prT.id).length && r.antall >= 5 && r.rad.tråd.konklusjon) && trådRader.some((r) => r.id === ensomPrompt.id && r.antall === 1 && regler.erTråd(r.rad) && r.rad.tråd.prompt.id === ensomPrompt.id), trådRader.map((r) => `${r.navn} (${r.antall})`).join(' | '))
  ok('friksjon 19: Samtaler er dato sist først', sm.every((r, i) => i === 0 || sm[i - 1].tid >= r.tid))
  const passerLager = (a) => a.project === 'Lager', passerNotat = (a) => a.id === at7.find((x) => x.key === 'sak:notat-i-samtalen').id
  ok('friksjon 19: filteret gjelder loggen ELLER en sak i samtalen — prosjektfilteret tar bare Lager-samtalene; et filter som bare treffer notatet i samtalen tar samtalen med (beholderen), ingen andre', regler.samtalerFlat(at7, { passer: passerLager }).every((r) => r.project === 'Lager') && regler.samtalerFlat(at7, { passer: passerNotat }).length === 1 && regler.samtalerFlat(at7, { passer: passerNotat })[0].id === fangetLogg.id)
  const dok = regler.dokumenterAv(regler.utvalg(at7)), dokFlat = regler.filerFlat(dok, filer6), dokTreff = regler.dokumenterAv(regler.utvalg(at7, { treff: true }))
  ok('friksjon 19: Dokumenter = Filer minus samtalene — ingen samtalelogg, ingen prompt, ingen tråd-sak (også i treff), notatet fra samtalen og mappefilene er med', !dok.some((a) => a.kind === 'samtale' || a.kind === 'prompt') && !dokTreff.some((a) => a.kind === 'samtale' || a.kind === 'prompt' || a.klasse === 'tråd') && dok.some((a) => a.key === 'sak:notat-i-samtalen') && dokFlat.filter((r) => r.slag === 'fil').length === 3 && dokFlat.every((r, i) => i === 0 || dokFlat[i - 1].tid >= r.tid), `${dok.length} saker + 3 filer`)
  const t19 = regler.tellVisning(regler.mapperMed(at7, filer6), sm, dokFlat)
  ok('friksjon 19: tallene i bryteren — Mapper = prosjekter med filer, Samtaler = radene i Samtaler, Dokumenter = radene i Dokumenter; samtaler + dokumenter dekker alt arbeid som ikke er en samtale pluss trådene', t19.mapper === new Set([...at7.map((a) => a.project), ...filer6.map((f) => f.project)]).size && t19.samtaler === sm.length && t19.dokumenter === dokFlat.length && t19.dokumenter === regler.utvalg(at7).filter((a) => a.kind !== 'samtale').length + 3, JSON.stringify(t19))
  ok('friksjon 19: med «ta med» vokser Samtaler med drift-samtalene og Dokumenter med fangede og drift-saker (ikke samtalene)', smMed.length === sm.length + logger.filter((a) => a.klasse === 'drift').length && regler.dokumenterAv(regler.utvalg(at7, { med: true })).length > dok.length && !regler.dokumenterAv(regler.utvalg(at7, { med: true })).some((a) => a.kind === 'samtale'))
} finally { bro.kill() }


// ── Friksjon 20 (25.10.2026): arbeidet som samler — reglene appen bruker, og ordet «økt» utgår ───────────────────────────────────────
{
  ok('typeOrd: en hook-samtale (okt:) er «samtale», ikke «økt»; en gammel sak med taggen økt også', regler.typeOrd({ kind: 'samtale', key: 'okt:abc', tags: ['samtale', 'code'] }) === 'samtale' && regler.typeOrd({ kind: 'capture', tags: ['økt', 'auto'] }) === 'samtale')
  ok('øktTekst: «I Claude i dag: 3 samtaler, 2 filer skrevet» — ordet økt utgår', regler.øktTekst({ tekst: 'I Claude i dag: 3 økter, 2 filer skrevet, 0 svar beholdt', antall: 3, filer: 2, beholdt: 0 }) === 'I Claude i dag: 3 samtaler, 2 filer skrevet' && regler.øktTekst({ tekst: 'I Claude i går: 1 økt', antall: 1 }) === 'I Claude i går: 1 samtale')
  ok('delAvTekst / arbeidTall: «Del av: Anken · samtale 7 av 12», «3 samtaler, 2 tråder, 1 fil»', regler.delAvTekst({ del_av: { id: 'w', name: 'Anken', slag: 'samtale', nr: 7, av: 12 } }) === 'Del av: Anken · samtale 7 av 12' && regler.arbeidTall({ samtaler: 3, tråder: 2, filer: 1 }) === '3 samtaler, 2 tråder, 1 fil' && regler.arbeidTall({ samtaler: 1 }) === '1 samtale' && regler.delAvTekst({}) === '')
  const løp = { id: 'w', tidslinje: [{ tid: 1, type: 'samtale', id: 's1', navn: 'Første', kilde: 'Claude Code' }, { tid: 2, type: 'svar', id: 'v1', navn: 'Svar', kilde: 'Ollama (lokal)' }, { tid: 3, type: 'versjon', id: 'w', navn: 'v1', kilde: '' }, { tid: 4, type: 'utlevert', id: 'w', navn: 'Utlevert til test', kilde: 'ekko' }, { tid: 5, type: 'fil', id: 'f1', navn: 'anke.md', kilde: 'Claude', href: '/x/anke.md' }] }
  const rader = regler.løpRader(løp)
  ok('løpRader: rekkefølgen beholdes (nyeste nederst), versjon og utlevert uten lenke, kilden kortet («Ollama»), typeord på norsk', rader.map((r) => r.lenke) .join() === 'true,true,false,false,true' && rader[1].kilde === 'Ollama' && rader[0].typeOrd === 'samtale' && rader[4].typeOrd === 'fil')
  // treMedArbeid: samtalene og sakene som hører til et arbeid flyttes inn under det; resten står; arbeidet selv står ikke som fil under seg selv
  const W = { id: 'w1', name: 'Anken til Energima', status: 'utkast', kind: 'samtale' }
  const tre = [{ navn: 'Energima', via: 'navn', samtaler: [
    { navn: 'Utkastet', sist: 10, saker: [{ id: 'p1', hører_til: 'w1' }], logg: { id: 's1', hører_til: 'w1' } },
    { navn: 'Strømprisene', sist: 20, saker: [{ id: 'p2' }], logg: { id: 's2' } },
    { navn: 'Anken til Energima', sist: 5, saker: [], logg: W },
  ], filer: [{ slag: 'sak', sak: { id: 'f1', hører_til: 'w1', capturedAt: 30 } }, { slag: 'sak', sak: { id: 'w1', name: 'Anken til Energima', capturedAt: 1 } }, { slag: 'fil', fil: { sti: 'faktura.pdf' } }], antallSamtaler: 3, antallFiler: 3 }]
  const t2 = regler.treMedArbeid(tre, [W])
  ok('treMedArbeid: ett arbeid med samtalen og fila som hører til, resten av samtalene og filene står i prosjektet, arbeidet selv er ikke en fil under seg selv', t2[0].arbeider.length === 1 && t2[0].arbeider[0].navn === 'Anken til Energima' && t2[0].arbeider[0].samtaler.length === 1 && t2[0].arbeider[0].filer.length === 1 && t2[0].arbeider[0].sak?.id === 'w1' && t2[0].samtaler.length === 2 && t2[0].filer.length === 1 && t2[0].filer[0].slag === 'fil', JSON.stringify(t2[0].arbeider[0]))
  ok('treMedArbeid: uten koblinger er treet som før (arbeider tomt)', regler.treMedArbeid([{ navn: 'X', samtaler: [{ navn: 'a', saker: [{ id: 'q' }], logg: null }], filer: [] }])[0].arbeider.length === 0)
  ok('erArbeidSak: feltet fra broen', regler.erArbeidSak({ arbeid: true }) && !regler.erArbeidSak({ hører_til: 'w1' }))
}

// ── Arbeidsstykke 33 skive 2 (27.10.2026, V22 «Samtalen først»): Arbeid-tilstanden — reglene appen bruker, og det Finn mistet ───────────────────────────
{
  // adressene: #samtale/<id> og #arbeid/<id> er Arbeid; #sak/<id> er fortsatt Finn
  ok('lesHash: #samtale/<id>, #arbeid/<id> og (skive A, A6) #les/<id> leses; erArbeidHash skiller Arbeid fra Finn — en sak (#les, gamle #sak) åpnes i Arbeid; adressene lages med encodeURIComponent', regler.lesHash('#samtale/a_1').samtale === 'a_1' && regler.lesHash('#arbeid/w1').arbeid === 'w1' && regler.erArbeidHash('#samtale/t_x_y') && regler.erArbeidHash('#arbeid/w1') && regler.erArbeidHash('#sak/a_1') && regler.erArbeidHash('#les/a_1') && regler.lesHash('#les/a_1').les === 'a_1' && regler.lesAdresse('a 1') === '/#les/a%201' && !regler.erArbeidHash('#innboks') && !regler.erArbeidHash('') && regler.samtaleAdresse('a 1') === '/#samtale/a%201' && regler.arbeidAdresse('w1') === '/#arbeid/w1')
  // sidefeltets tre: prosjekt › arbeid › samtaler, nyeste først, «+ N til» over fem, drift aldri
  const t = (n) => Date.parse('2026-10-01T10:00:00Z') + n * 3600e3
  const W = { id: 'w1', name: 'Anken til Energima', project: 'Energima', kind: 'capture', capturedAt: t(0), arbeid: true }
  const samt = (id, project, n, ekstra = {}) => ({ id, name: `Samtale ${id}`, project, kind: 'samtale', convo: `Samtale ${id}`, source: 'Claude Code', capturedAt: t(n), levels: { S: { text: `Sist: x → y · ${n} vendinger · 1.10.2026` } }, ...ekstra })
  const alle = [W,
    samt('s1', 'Energima', 1, { hører_til: 'w1' }), samt('s2', 'Energima', 2, { hører_til: 'w1' }), samt('s3', 'Energima', 3),
    samt('s4', 'Skigaarden', 9), samt('s5', 'Skigaarden', 5), samt('s6', 'Skigaarden', 6), samt('s7', 'Skigaarden', 7), samt('s8', 'Skigaarden', 8), samt('s9', 'Skigaarden', 4),
    samt('d1', 'Tua_tua', 20, { drift: true, klasse: 'drift' }),
    { id: 'p1', name: 'Hva er fristen?', content: 'Hva er fristen?', project: 'Energima', kind: 'prompt', key: 'prompt:spor:abc', source: 'Tua', capturedAt: t(10), tråd: 'p1', hører_til: 'w1' },
    { id: 'sv1', name: 'Svar fra Test', content: 'Tre uker.', project: 'Energima', kind: 'svar', source: 'Test (ekko)', capturedAt: t(10.5), tråd: 'p1', derivedFrom: [{ id: 'p1' }] },
  ]
  const tre = regler.sidefeltTre(alle)
  const en = tre.find((p) => p.navn === 'Energima'), sk = tre.find((p) => p.navn === 'Skigaarden')
  ok('sidefeltTre: prosjektene nyeste først (Skigaarden sist rørt 9 > Energima 10.5? — nei: tråden i Energima er nyest), drift-prosjektet er ikke med', tre.map((p) => p.navn).join() === 'Energima,Skigaarden' && !tre.some((p) => p.navn === 'Tua_tua'), tre.map((p) => `${p.navn}@${p.sist}`).join(' | '))
  ok('sidefeltTre: arbeidet «Anken til Energima» samler samtalene som hører til det (s2, s1 og tråden p1 — nyeste først), s3 står løst i prosjektet', en.arbeider.length === 1 && en.arbeider[0].navn === 'Anken til Energima' && en.arbeider[0].samtaler.map((s) => s.id).join() === 'p1,s2,s1' && en.samtaler.map((s) => s.id).join() === 's3' && en.antall === 4, JSON.stringify(en.arbeider[0].samtaler.map((s) => s.id)))
  ok('sidefeltTre: en Spør-tråd er en samtale-rad med kilde Tua og tittel = spørsmålet; en Code-samtale har kilde «Code» og antall vendinger fra S', en.arbeider[0].samtaler[0].kilde === 'Tua' && en.arbeider[0].samtaler[0].navn === 'Hva er fristen?' && en.samtaler[0].kilde === 'Code' && en.samtaler[0].antall === 3)
  ok('sidefeltTre: høyst fem per prosjekt, «+ N til» for resten — og alt når prosjektet er åpnet', sk.samtaler.length === 5 && sk.flere === 1 && sk.samtaler[0].id === 's4' && regler.sidefeltTre(alle, { åpne: new Set(['Skigaarden']) }).find((p) => p.navn === 'Skigaarden').samtaler.length === 6, `${sk.samtaler.length} + ${sk.flere}`)
  // sist brukt: fem, nyeste først, uten dubletter, bare de som finnes
  const sist = regler.leggSistBrukt(regler.leggSistBrukt(regler.leggSistBrukt(['s1', 's2', 's3', 's4', 's5'], 's6'), 's2'), 'finnes-ikke')
  ok('leggSistBrukt: ny fremst, dubletter bort, høyst fem; sistBrukt gir radene som finnes i treet (ikke «finnes-ikke»)', sist.join() === 'finnes-ikke,s2,s6,s1,s3' && regler.sistBrukt(sist, regler.sidefeltTre(alle, { maks: 100 })).map((s) => s.id).join() === 's2,s6,s1,s3', sist.join())
  // standardavkryssingen: standard[<mottaker>].vendinger fra broen; uten standard (mottakeren ikke klar) alt etter siste låste konklusjon, konklusjoner aldri
  const v = (id, rolle, ekstra = {}) => ({ id, rolle, L: 'x', S: 'x', tid: t(1), ...ekstra })
  const samtale = { id: 'a_s', vendinger: [v('v1', 'bruker'), v('v2', 'modell', { modell: 'gemma3', nivå: 'M' }), v('k1', 'konklusjon', { låst: true }), v('v3', 'bruker'), v('v4', 'modell', { modell: 'Claude' }), v('k2', 'konklusjon', { låst: false })],
    standard: { ollama: { vendinger: ['v4'], utenfor: [{ id: 'v1', hvorfor: 'før siste låste konklusjon' }, { id: 'v3', hvorfor: 'utenfor budsjettet til gemma3' }], tokens: 900, budsjett: 3072 } } }
  ok('standardValg: standard[<valgt mottaker>].vendinger når broen har regnet det (ollama: bare v4)', [...regler.standardValg(samtale, 'ollama')].join() === 'v4')
  ok('standardValg: uten standard for mottakeren (ikke klar) — alt etter siste låste konklusjon, konklusjoner aldri (v3, v4)', [...regler.standardValg(samtale, 'claude')].join() === 'v3,v4' && [...regler.standardValg(samtale, null)].join() === 'v3,v4' && regler.standardValg(null, 'x').size === 0)
  ok('utenforFor: id → hvorfor for valgt mottaker (dempet i samtalen, hvorfor ved hover); tom for en mottaker uten standard', regler.utenforFor(samtale, 'ollama').get('v3') === 'utenfor budsjettet til gemma3' && regler.utenforFor(samtale, 'ollama').size === 2 && regler.utenforFor(samtale, 'claude').size === 0)
  ok('vendingHode: «Du · 01.10 12:00» / «gemma3 · M» / «Konklusjon låst 01.10»', /^Du · \d\d\.\d\d \d\d:\d\d$/.test(regler.vendingHode(samtale.vendinger[0])) && regler.vendingHode(samtale.vendinger[1]) === 'gemma3 · M' && /^Konklusjon låst \d\d\.\d\d$/.test(regler.vendingHode(samtale.vendinger[2])) && /^Konklusjon utkast/.test(regler.vendingHode(samtale.vendinger[5])) && regler.vendingHode({ rolle: 'modell', modell: 'Claude' }) === 'Claude', [regler.vendingHode(samtale.vendinger[0]), regler.vendingHode(samtale.vendinger[2])].join(' | '))
  // Sendes-linja — én per mottaker; kort på mobil; «over budsjettet» når broen sier over
  const lang = regler.sendesTekst({ valgt: 2, totalt: 3, kilder: 1, nivåer: ['S'], skjermet: 2, tokens: 900, modell: 'gemma3' })
  ok('sendesTekst: «Sendes: 2 av 3 vendinger · 1 kilde på S · 2 skjermet · ca. 900 tokens → gemma3»', lang === 'Sendes: 2 av 3 vendinger · 1 kilde på S · 2 skjermet · ca. 900 tokens → gemma3', lang)
  ok('sendesTekst: kort på mobil «2 av 3 · 1 kilde · gemma3»; uten kilder «ingen kilder»; over budsjettet sies fra; 1 vending i entall', regler.sendesTekst({ valgt: 2, totalt: 3, kilder: 1, modell: 'gemma3', kort: true }) === '2 av 3 · 1 kilde · gemma3' && regler.sendesTekst({ valgt: 0, totalt: 1, modell: 'Claude', tokens: 12 }) === 'Sendes: 0 av 1 vending · ingen kilder · ingenting skjermet · ca. 12 tokens → Claude' && regler.sendesTekst({ valgt: 3, totalt: 3, kilder: 2, nivåer: ['S', 'M'], tokens: 4000, over: true, modell: 'gemma3' }).replace(/[\u00a0\u202f]/g, ' ').includes('ca. 4 000 tokens — over budsjettet') && regler.sendesTekst({ valgt: 1, totalt: 2, kilder: 0, modell: 'gemma3', kort: true }) === '1 av 2 · gemma3')
  ok('samtaleTittelAv: tittelen fra GET /api/samtale (tittel), en sak (name) eller en rad (navn); «Samtale» uten', regler.samtaleTittelAv({ tittel: ' Hva er  fristen? ' }) === 'Hva er fristen?' && regler.samtaleTittelAv({ name: 'X' }) === 'X' && regler.samtaleTittelAv({}) === 'Samtale')
  // Finn mistet tre ting (planen §3.1): kurven (sessionStorage tua.kurv), samtalespalta (fs-samtaler) og Spør inne i saken (SporISak) — og Arbeid finnes
  const src = (f) => fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', f), 'utf8')
  const kode = (f) => src(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const forside = kode('pages/Forside.jsx'), sak = kode('pages/Sak.jsx')
  ok('Finn: «Ta med»-kurven er borte — ingen tua.kurv, ingen fs-kurv, ingen taMed/erMed i Forside.jsx eller Sak.jsx', !/tua\.kurv|fs-kurv|\btaMed\b|\berMed\b|onTaMed/.test(forside) && !/tua\.kurv|onTaMed|\berMed\b|\bkurv\b/.test(sak))
  ok('Finn: samtalespalta er borte — ingen <aside className="fs-samtaler"> i Forside.jsx, ingen .fs-samtaler i forside.css', !forside.includes('className="fs-samtaler"') && !/\.fs-samtaler\b/.test(src('forside.css')))
  ok('Finn: Spør inne i saken er borte — SporISak.jsx finnes ikke, ingen import av den; Sak.jsx og Forside.jsx går til Arbeid (arbeid-start.js)', !fs.existsSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'pages', 'SporISak.jsx')) && !forside.includes('SporISak') && !sak.includes('SporISak') && forside.includes("from '../arbeid-start.js'") && sak.includes("from '../arbeid-start.js'"))
  ok('Arbeid finnes: pages/Arbeid.jsx, Sidefelt.jsx, Samtale.jsx og arbeid.css; tua.jsx ruter #samtale/ og #arbeid/ dit (erArbeidHash)', ['pages/Arbeid.jsx', 'pages/Sidefelt.jsx', 'pages/Samtale.jsx', 'arbeid.css'].every((f) => fs.existsSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', f))) && kode('tua.jsx').includes('erArbeidHash') && kode('pages/Samtale.jsx').includes('/api/spor/forhandsvis') && kode('pages/Samtale.jsx').includes('vendinger: avkryssetRekkefølge'))
  ok('Finn: feltet øverst gjør én ting (finner) — plassholderen er «Finn …», ⌘↵ starter en ny samtale (nySamtale), ingen Spør-knapp med kurv', forside.includes('placeholder="Finn …"') && /nySamtale\(/.test(forside) && !forside.includes('Spør med sakene i kurven'))
}

// ── Arbeidsstykke 33 skive 3 (28.10.2026, V22): «Fortsett og tekst inn» — Claude-knappen etter én regel, gjentatte kjøringer foldet, lim inn-grensen, utdragsposisjon, lenker som ikke finnes ──
{
  // (2) claudeKnapp: samtalelenke → «Fortsett i Claude ›»; bare prosjektlenke → «Åpne prosjektet i Claude ›»; ingen lenke → null. Tar links, lenker eller saken.
  const chat = { kind: 'claude-chat', href: 'claude://claude.ai/chat/abc' }, proj = { kind: 'claude-project', href: 'claude://claude.ai/project/uuid-1' }
  ok('claudeKnapp: «Fortsett i Claude ›» bare når lenka er en samtale (claude-chat) — også når prosjektlenka står ved siden av', regler.claudeKnapp([proj, chat]).tekst === 'Fortsett i Claude ›' && regler.claudeKnapp([chat]).href === chat.href && regler.claudeKnapp({ links: [chat] }).kind === 'claude-chat' && regler.claudeKnapp({ lenker: [chat] }).tekst === 'Fortsett i Claude ›')
  ok('claudeKnapp: bare prosjektlenke → «Åpne prosjektet i Claude ›» (lover ikke mer enn den gjør); ingen lenke, bare repo/url, eller ingenting → null', regler.claudeKnapp([proj]).tekst === 'Åpne prosjektet i Claude ›' && regler.claudeKnapp([proj]).href === proj.href && regler.claudeKnapp([{ kind: 'repo', href: '/x' }, { kind: 'url', href: 'https://x' }]) === null && regler.claudeKnapp([]) === null && regler.claudeKnapp(null) === null && regler.claudeKnapp({}) === null)
  // (5) kortTittel og foldingen av gjentatte kjøringer: samme kilde (ikke Tua), prosjekt og kortede tittel → én linje med «N kjøringer», nyeste øverst inne i linja
  ok('kortTittel: ≤ 60 tegn urørt; lengre → første setning når den er ≤ 60, ellers 60 tegn med …; whitespace flatet', regler.kortTittel('Oppgjøret med Skado') === 'Oppgjøret med Skado' && regler.kortTittel('Gå gjennom innboksen. Lag en liste over alt som venter på svar, sortert etter hvem.') === 'Gå gjennom innboksen.' && regler.kortTittel('a'.repeat(100)).length === 60 && regler.kortTittel('a'.repeat(100)).endsWith('…') && regler.kortTittel('  to\n ord ') === 'to ord')
  const t = (n) => Date.parse('2026-10-20T07:00:00Z') + n * 86400e3
  const DAGLIG = 'Gå gjennom innboksen og lag en liste over alt som venter på svar, sortert etter hvem som sendte det'
  const kj = (id, n, ekstra = {}) => ({ id, name: regler.kortTittel(DAGLIG), project: 'Innboksrutine', kind: 'samtale', convo: regler.kortTittel(DAGLIG), source: 'Claude Cowork', capturedAt: t(n), fanget: true, levels: { S: { text: `Sist: x → y · 1 vending · 2${n}.10.2026` } }, links: [{ kind: 'claude-project', href: 'claude://claude.ai/project/p1' }], ...ekstra })
  const alle = [kj('k1', 1), kj('k2', 2, { gjentatt: true }), kj('k3', 3, { gjentatt: true, ulest: true }),
    { id: 'annen', name: regler.kortTittel(DAGLIG), project: 'Innboksrutine', kind: 'samtale', convo: regler.kortTittel(DAGLIG), source: 'Claude Code', capturedAt: t(4), fanget: true },   // annen kilde: egen linje
    { id: 'tua1', name: 'Ukentlig status', project: 'Innboksrutine', kind: 'samtale', convo: 'Ukentlig status', source: 'Tua', capturedAt: t(5) }, { id: 'tua2', name: 'Ukentlig status', project: 'Innboksrutine', kind: 'samtale', convo: 'Ukentlig status', source: 'Tua', capturedAt: t(6) },   // Tua-samtaler foldes aldri
    { id: 'e1', name: 'Samtale e1', project: 'Energima', kind: 'samtale', convo: 'Samtale e1', source: 'Claude Desktop', capturedAt: t(7), links: [{ kind: 'claude-chat', href: 'claude://claude.ai/chat/e1' }] }]
  const sm = regler.samtalerFlat(alle)
  const foldet = sm.find((r) => r.kjøringer)
  ok('samtalerFlat (§7): de tre Cowork-kjøringene er ÉN linje — den nyeste (k3) med antallKjøringer 3 og kjøringene nyeste øverst; ulest når én av dem er ulest; Samtaler-tellingen teller linjer (5, ikke 7)', sm.length === 5 && foldet?.id === 'k3' && foldet.antallKjøringer === 3 && foldet.kjøringer.map((r) => r.id).join() === 'k3,k2,k1' && foldet.ulest === true && foldet.navn === regler.kortTittel(DAGLIG) && regler.tellVisning([], sm, []).samtaler === 5, JSON.stringify(sm.map((r) => [r.id, r.antallKjøringer || 1])))
  ok('samtalerFlat (§7): en samtale med samme tittel fra en annen kilde står for seg; to Tua-samtaler med samme tittel foldes ikke (kjøringer er fangst); e1 urørt', sm.some((r) => r.id === 'annen' && !r.kjøringer) && sm.filter((r) => r.project === 'Innboksrutine' && r.logg.source === 'Tua').length === 2 && sm.find((r) => r.id === 'e1') && !sm.find((r) => r.id === 'e1').kjøringer)
  ok('samtalerFlat: claudeKnapp per linje etter regelen — e1 «Fortsett i Claude ›», den foldede Cowork-linja «Åpne prosjektet i Claude ›» (bare prosjektlenke), Tua-samtalen ingen; `claude` (href) står som før', sm.find((r) => r.id === 'e1').claudeKnapp.tekst === 'Fortsett i Claude ›' && foldet.claudeKnapp.tekst === 'Åpne prosjektet i Claude ›' && sm.find((r) => r.id === 'tua2').claudeKnapp === null && sm.find((r) => r.id === 'e1').claude === 'claude://claude.ai/chat/e1', JSON.stringify(sm.map((r) => [r.id, r.claudeKnapp?.tekst])))
  const tre = regler.sidefeltTre(alle)
  const ib = tre.find((p) => p.navn === 'Innboksrutine')
  ok('sidefeltTre (§7): den foldede linja bærer kjøringene (id, navn, sist, ulest — nyeste øverst) og antallKjøringer; prosjektet teller linjer', ib.samtaler.find((s) => s.id === 'k3')?.antallKjøringer === 3 && ib.samtaler.find((s) => s.id === 'k3').kjøringer.map((k) => k.id).join() === 'k3,k2,k1' && !ib.samtaler.some((s) => s.id === 'k1' || s.id === 'k2') && ib.antall === 4, JSON.stringify(ib.samtaler.map((s) => [s.id, s.antallKjøringer])))
  ok('foldKjøringer: én kjøring foldes ikke; rader som ikke er samtaler går uendret gjennom', regler.foldKjøringer([{ slag: 'samtale', id: 'x', navn: 'A', project: 'P', tid: 1, logg: { source: 'Claude Code' } }, { slag: 'tråd', id: 'y', navn: 'B', project: 'P', tid: 2 }]).map((r) => r.id).join() === 'x,y' && !regler.foldKjøringer([{ slag: 'samtale', id: 'x', navn: 'A', project: 'P', tid: 1, logg: { source: 'Claude Code' } }])[0].kjøringer)
  // (3) lim inn-grensen: over 800 tegn etter trim → kilde
  ok('erLimInnKilde: 801 tegn → kilde; 800 → ikke; whitespace rundt telles ikke; grensen er 800 (LIM_INN_GRENSE)', regler.LIM_INN_GRENSE === 800 && regler.erLimInnKilde('x'.repeat(801)) && !regler.erLimInnKilde('x'.repeat(800)) && !regler.erLimInnKilde('   ' + 'x'.repeat(800) + '\n\n') && regler.erLimInnKilde('x'.repeat(801), 100) && !regler.erLimInnKilde(''))
  // (4) utdragsposisjon: hvor i L den merkede teksten står
  const L = 'Første avsnitt om lageret.\n\nBudsjett 45 000 kr. Flytting i mars.\n\nTredje avsnitt.'
  ok('utdragPosisjon: {fra, til} = indexOf i L; finnes ikke ordrett (annen linjedeling i visningen) → starten på de første ordene; helt ukjent → null; tomt → null', JSON.stringify(regler.utdragPosisjon(L, 'Budsjett 45 000 kr.')) === JSON.stringify({ fra: L.indexOf('Budsjett'), til: L.indexOf('Budsjett') + 'Budsjett 45 000 kr.'.length }) && regler.utdragPosisjon(L, 'Budsjett 45 000 kr. Flytting\ni mars.').fra === L.indexOf('Budsjett') && regler.utdragPosisjon(L, 'finnes ikke i det hele tatt her') === null && regler.utdragPosisjon(L, '') === null)
  // (6) lenker som ikke finnes: finnTekst gjør svaret fra GET /api/finn til én setning og én handling
  const e = { id: 'a_ny', name: 'Samlenotat', project: 'Testprosjekt', kind: 'capture' }
  ok('finnTekst: funnet → null; nøkkel/slått sammen/flyttet/ny versjon → setningen med navnet og handlingen «Åpne» (id, kind)', regler.finnTekst({ funnet: true }) === null && regler.finnTekst(null) === null
    && /Lenka pekte på nøkkelen — saken er «Samlenotat» i Testprosjekt/.test(regler.finnTekst({ funnet: false, hvorfor: 'nøkkel', erstattet_av: e }).tekst) && regler.finnTekst({ funnet: false, hvorfor: 'nøkkel', erstattet_av: e }).handling.slag === 'åpne' && regler.finnTekst({ funnet: false, hvorfor: 'nøkkel', erstattet_av: e }).handling.id === 'a_ny'
    && regler.finnTekst({ funnet: false, hvorfor: 'slått sammen', erstattet_av: e }).tekst === 'Saken er slått sammen med «Samlenotat».' && /flyttet til Testprosjekt og heter «Samlenotat»/.test(regler.finnTekst({ funnet: false, hvorfor: 'flyttet', erstattet_av: e }).tekst) && /lever videre som «Samlenotat»/.test(regler.finnTekst({ funnet: false, hvorfor: 'ny versjon', erstattet_av: e }).tekst)
    && regler.finnTekst({ funnet: false, hvorfor: 'slått sammen', erstattet_av: { ...e, kind: 'samtale' } }).handling.kind === 'samtale')
  ok('finnTekst: papirkurv → «ligger i papirkurven» med handlingen «Gjenopprett»; versjoner → setningen uten handling; ukjent → «Fant ikke saken <id>»', regler.finnTekst({ funnet: false, hvorfor: 'papirkurv', papirkurv: { id: 'a_k', name: 'Notat som kastes' } }).tekst === 'Saken «Notat som kastes» ligger i papirkurven.' && regler.finnTekst({ funnet: false, hvorfor: 'papirkurv', papirkurv: { id: 'a_k', name: 'N' } }).handling.slag === 'gjenopprett' && regler.finnTekst({ funnet: false, hvorfor: 'papirkurv', papirkurv: { id: 'a_k', name: 'N' } }).handling.id === 'a_k'
    && regler.finnTekst({ funnet: false, hvorfor: 'versjoner', versjoner: 2 }).handling === null && /2 eldre versjoner/.test(regler.finnTekst({ funnet: false, hvorfor: 'versjoner', versjoner: 2 }).tekst) && regler.finnTekst({ funnet: false, hvorfor: null, id: 'a_x' }).tekst === 'Fant ikke saken a_x i arkivet.')
  // koden: appen bruker reglene og endepunktene — lim inn i feltet, kilden åpnet fra kildelinja, Utdrag-komponenten, /api/finn i Finn og Arbeid, Claude-knappen etter regelen overalt
  const src = (f) => fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', f), 'utf8')
  const kode = (f) => src(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const samtale = kode('pages/Samtale.jsx'), forside = kode('pages/Forside.jsx'), arbeid = kode('pages/Arbeid.jsx'), sak = kode('pages/Sak.jsx')
  ok('Samtale.jsx: onPaste → erLimInnKilde → POST /api/tekst, «angre» → POST /api/rydd/kast; «les» på en kilde → GET /api/sak + Utdrag; Claude-knappen via claudeKnapp; syntetiske vendinger uten «Åpne sak»', samtale.includes('onPaste={limInn}') && samtale.includes("'/api/tekst'") && samtale.includes('erLimInnKilde(') && samtale.includes("'/api/rydd/kast'") && samtale.includes('ab-kilde-les') && samtale.includes('<Utdrag ') && samtale.includes('claudeKnapp(samtale') && !samtale.includes("l.kind === 'claude-chat'") && samtale.includes('er-syntetisk'))
  ok('components/Utdrag.jsx finnes: POST /api/utdrag med utdragPosisjon, knappen «Bruk i samtalen» ved markeringen (mus og touch); Sak.jsx legger den rundt innholdet og starter ny samtale med utdraget som kilde', fs.existsSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'components', 'Utdrag.jsx')) && kode('components/Utdrag.jsx').includes("'/api/utdrag'") && kode('components/Utdrag.jsx').includes('utdragPosisjon(') && kode('components/Utdrag.jsx').includes('Bruk i samtalen') && kode('components/Utdrag.jsx').includes('touchend') && sak.includes('<Utdrag ') && sak.includes('brukUtdrag') && sak.includes('claudeKnapp(ls)'))
  ok('Forside.jsx og Arbeid.jsx: GET /api/finn før «Fant ikke», finnTekst med Åpne/Gjenopprett (POST /api/rydd/angre); Samtaler-linja folder kjøringer (fs-kjøringer) og bruker claudeKnapp; Siden sist-øktene har Claude-knappen', forside.includes('`/api/finn?id=') && forside.includes('finnTekst(') && forside.includes("'/api/rydd/angre'") && forside.includes('fs-kjøringer') && forside.includes('r.claudeKnapp') && forside.includes('ss-claude') && !/>Fortsett i Claude ›</.test(forside) && arbeid.includes('`/api/finn?id=') && arbeid.includes('finnTekst(') && arbeid.includes("'/api/rydd/angre'"))
  ok('Sidefelt.jsx: den foldede raden viser «N kjøringer» og folder kjøringene ut', kode('pages/Sidefelt.jsx').includes('antallKjøringer') && kode('pages/Sidefelt.jsx').includes('sb-kjøringer'))
}

// ── Skive A «Rydd flaten» (arbeidsstykke 34, V23, 28.10.2026): samtalen er én rad, dokumentet er én rad, drift i én linje, tittelen først ──
{
  const T = Date.parse('2026-10-28T12:00:00'); const DAY = 86400e3
  const s = (id, o) => ({ id, project: 'Oppgjør Skado', capturedAt: T, kind: 'capture', tags: [], ...o })
  const alleA = [
    s('logg', { kind: 'samtale', name: 'Skado – energima m.m.', convo: 'Skado – energima', source: 'Claude Cowork', key: 'samtale:x', levels: { S: { text: 'Sist: … · 61 vendinger' } }, links: [{ kind: 'claude-chat', href: 'claude://claude.ai/chat/x' }] }),
    s('p1', { kind: 'prompt', name: 'Les dokumentene', convo: 'Skado – energima', source: 'Claude Cowork', capturedAt: T - 5000 }),
    s('sv1', { name: 'Nå setter jeg opp en arbeidsplan', convo: 'Skado – energima', source: 'Claude Cowork', key: 'svar:x:1', tags: ['svar', 'auto'], capturedAt: T - 4000 }),
    s('sv2', { name: 'Samlet analyse — Energima-saken', convo: 'Skado – energima', source: 'Claude Cowork', key: 'svar:x:2', tags: ['svar', 'auto'], capturedAt: T - 3000 }),
    s('d-md', { name: 'Ankeerklæring v4', convo: 'Skado – energima', source: 'Claude Cowork', key: 'fil:/x/Ankeerklæring v4.md', tags: ['dokument'], capturedAt: T - 2500 }),
    s('d-md5', { name: 'Ankeerklæring v5', convo: 'Skado – energima', source: 'Claude Cowork', key: 'fil:/x/Ankeerklæring v5.md', tags: ['dokument'], capturedAt: T - 2000 }),
    s('d-pdf', { name: 'Ankeerklæring v5', convo: 'Skado – energima', source: 'Claude Cowork', key: 'fil:/x/Ankeerklæring v5.pdf', tags: ['dokument'], capturedAt: T - 1900 }),
    // fangede svar uten samtale-sak: samlet rad for gruppen, ingen skriving
    s('g1', { project: 'aksjer', name: 'Jeg legger opp et kurs i trinn', convo: 'Tokenisering av eiendeler', source: 'ChatGPT', key: 'svar:y:1', tags: ['svar', 'auto'] }),
    s('g2', { project: 'aksjer', name: 'Trinn 2', convo: 'Tokenisering av eiendeler', source: 'ChatGPT', key: 'svar:y:2', tags: ['svar', 'auto'], capturedAt: T + 1000 }),
    // økt-sak fra hooken: samtalen selv, tittel uten «Økt:»
    s('økt', { project: 'empty', name: 'Økt: Opptre som en advokat med spesialfelt innen avtale og e', convo: 'Opptre som en advokat med spesialfelt innen avtale og eiend…', source: 'Claude', key: 'okt:z', tags: ['økt', 'auto'] }),
    s('økt-sv', { project: 'empty', name: 'Verifisering og oppdatert anke (v3)', convo: 'Opptre som en advokat med spesialfelt innen avtale og eiend…', source: 'Claude', key: 'svar:z:1', tags: ['svar', 'auto'] }),
    // drift: sync, helsesjekk, status-kopier, gjentatte kjøringer
    s('h', { project: 'TUA', name: 'Helsesjekk 2026-10-28', source: 'Tua', key: 'helsesjekk:2026-10-28', tags: ['helsesjekk', 'auto'] }),
    s('c', { project: 'Tua_tua', name: 'Commit-logg — tua', source: 'Claude Code · sync', key: 'commit-logg:tua' }),
    s('st1', { project: 'Tua_tua', name: 'Tua 2.0 — status', source: 'Claude', key: 'fil:/a/status.md', tags: ['dokument'] }),
    s('st2', { project: 'Tua_tua', name: 'Tua 2.0 — status', source: 'Claude', key: 'fil:/b/status.md', tags: ['dokument'], capturedAt: T - DAY }),
    s('dok', { project: 'Tua_tua', name: 'Gjennomgang av appen', source: 'Claude Code · sync', key: 'dok:concepts/34/samlet.html', tags: ['dokument'] }),
    ...[1, 2, 3].map((i) => s('uke' + i, { project: 'Ionian', kind: 'samtale', name: 'Ionian realty weekly sweep', convo: 'Ionian realty weekly sweep', source: 'Claude Cowork', key: 'samtale:u' + i, capturedAt: T - i * 7 * DAY })),
    s('erik', { project: 'Intern Erik', name: 'Status for meg selv', source: 'Erik', key: 'status:meg' }),
  ]
  const f = regler.flateRader(alleA)
  const sk = f.samtaler.find((r) => r.convo === 'Skado – energima')
  ok('A0: samtalen er ÉN rad — spørsmålet og svarene (også fangede svar:-saker) foldes inn, ingen egne rader', !!sk && sk.id === 'logg' && sk.spørsmål === 1 && sk.svar === 2 && f.samtaler.filter((r) => r.convo === 'Skado – energima').length === 1
    && !f.dokumenter.some((r) => ['p1', 'sv1', 'sv2'].includes(r.id)) && regler.avisRader(f).every((r) => !['p1', 'sv1', 'sv2'].includes(r.id)))
  ok('A0: dokumentene er egne rader med «fra samtalen», og samtalen viser dokumentene den laget', f.dokumenter.some((r) => r.fra?.id === 'logg') && sk.dokumenter.length === 1 && sk.dokumenter[0].id === 'd-md5')
  const g = f.samtaler.find((r) => r.convo === 'Tokenisering av eiendeler')
  ok('A0: uten samtale-sak lages en samlet rad for gruppen (ingen skriving) — åpnes på nyeste sak', !!g && g.samlet === true && g.svar === 2 && f.samtaler.filter((r) => r.convo === 'Tokenisering av eiendeler').length === 1)
  const ø = f.samtaler.find((r) => r.project === 'empty')
  ok('A0/A4: hookens «Økt:»-sak er samtalen selv, og tittelen er kort og uten prefiks', !!ø && ø.id === 'økt' && ø.svar === 1 && ø.navn === 'Advokat med spesialfelt innen avtale', ø?.navn)
  ok('A0b: kildefargen følger raden — samtalen med modellen den ble ført med (ChatGPT → kf-gpt), dokumentet med modellen som skrev (Cowork → kf-claude)', g.kilde === 'kf kf-gpt' && sk.kilde === 'kf kf-claude' && f.dokumenter.find((r) => r.id === 'd-md5')?.kilde === 'kf kf-claude')
  const ank = f.dokumenter.filter((r) => /ankeerklæring/i.test(r.navn))
  ok('A3: ett dokument, én rad — md og PDF er merker, eldre versjon (v4) bak «v2»', ank.length === 1 && ank[0].formater.includes('md') && ank[0].formater.includes('PDF') && ank[0].antallVersjoner === 3 && ank[0].sak.id === 'd-md5', JSON.stringify(ank.map((r) => [r.navn, r.formater, r.antallVersjoner])))
  ok('A2: drift (helsesjekk, commit-logg fra sync, «— status»-kopier som én linje, gjentatte kjøringer ≥ 3) står ikke i avisen; dok: fra sync og Eriks egne saker gjør det',
    ['h', 'c', 'st1', 'st2', 'uke1'].every((id) => !regler.avisRader(f).some((r) => r.ider.includes(id))) && f.drift.filter((r) => r.ider.includes('st1')).length === 1 && f.drift.find((r) => r.ider.includes('st1')).ider.includes('st2')
    && f.drift.some((r) => r.ider.includes('uke1') && r.ider.includes('uke3')) && f.dokumenter.some((r) => r.id === 'dok') && f.dokumenter.some((r) => r.id === 'erik'))
  ok('A2: «Tua-drift · N i dag»', regler.driftTekst(f.drift, T) === `Tua-drift · ${f.drift.filter((r) => r.tid >= new Date(new Date(T).setHours(0, 0, 0, 0)).getTime()).length} i dag` && /^Tua-drift · \d+$/.test(regler.driftTekst([], T)))
  ok('A4: visTittel — «Økt:» bort, promptstart kort; vanlige titler uendret', regler.visTittel('Økt: Tua 2.0 onboarding') === 'Tua 2.0 onboarding' && regler.visTittel('Du lager min daglige greske morgenbriefing.') === 'Daglige greske morgenbriefing' && regler.visTittel('Ankeerklæring v5') === 'Ankeerklæring v5')
  ok('A7: «empty» vises som «Uten prosjekt»', regler.prosjektVis('empty') === 'Uten prosjekt' && regler.prosjektVis('') === 'Uten prosjekt' && regler.prosjektVis('Tua_tua') === 'Tua_tua')
  ok('A5: Siden sist høyst tre linjer, resten bak «+ N til»', regler.sidenSistKutt([1, 2, 3, 4, 5]).vis.length === 3 && regler.sidenSistKutt([1, 2, 3, 4, 5]).flere === 2 && regler.sidenSistKutt([1, 2]).flere === 0 && regler.sidenSistKutt([1, 2, 3, 4], true).vis.length === 4)
  // A1: søket som én liste, gruppert prosjekt → samtaler → dokumenter; relevans virker i alle visninger
  const rang = new Map([['dok', 0], ['sv2', 1], ['økt-sv', 2], ['d-pdf', 3]])
  const fl = regler.søkeFlate('energima anke', { flate: f, rang, prosjekter: [{ navn: 'Energima anke', via: 'navn', alias: [] }], sortering: 'relevans' })
  ok('A1: søket er én liste gruppert prosjekt → samtaler → dokumenter; prosjektnavnet som treffer står øverst, så etter beste treff', fl[0]?.navn === 'Energima anke' && fl[1]?.navn === 'Tua_tua' && fl.find((p) => p.navn === 'Oppgjør Skado')?.samtaler[0]?.id === 'logg'
    && fl.find((p) => p.navn === 'Oppgjør Skado')?.dokumenter[0]?.id === 'd-md5' && fl.find((p) => p.navn === 'empty')?.vis === 'Uten prosjekt', JSON.stringify(fl.map((p) => [p.navn, p.rang])))
  const flD = regler.søkeFlate('energima anke', { flate: f, rang, prosjekter: [], sortering: 'dato' })
  ok('A1: dato-bryteren sorterer prosjektene og radene på dato', flD.length === 3 && flD.every((p, i) => i === 0 || flD[i - 1].sist >= p.sist))
  const rader2 = [{ id: 'a', ider: ['x'], tid: 3 }, { id: 'b', ider: ['y'], tid: 2 }, { id: 'c', ider: ['z'], tid: 1 }]
  ok('A1/§6: sorterRader — relevans følger rangen (også i Dokumenter), uten rang sist; dato siste først', regler.sorterRader(rader2, { sortering: 'relevans', rang: new Map([['z', 0], ['y', 1]]) }).map((r) => r.id).join('') === 'cba'
    && regler.sorterRader(rader2).map((r) => r.id).join('') === 'abc')
  { const src = fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'arbeid-start.js'), 'utf8')
    ok('A6: «‹ Finn» går aldri til en Arbeid-adresse (husket «/#sak/<id>» fra før ga én sak i løkke) — fraFinn sjekker erArbeidHash; Forside åpner saker med tilLes (husker hvor du sto)', /fraFinn = \(\) => \{[^\n]*erArbeidHash/.test(src) && src.includes('export function tilLes') && !/navigate\((les|sak)Adresse\(/.test(fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'pages', 'Forside.jsx'), 'utf8'))) }
  ok('flateRader: filteret (passer) gjelder en sak i raden', regler.flateRader(alleA, { passer: (a) => a?.id === 'sv2' }).samtaler.map((r) => r.id).join() === 'logg' && regler.flateRader(alleA, { passer: (a) => a?.id === 'sv2' }).dokumenter.length === 0)
}

// ── Skive C «Utfordre» (arb. 34 §5 C1–C6, V23): reglene i appen ─────────────────────────────────────────────────────────────
{
  const u = { id: 'u1', tekst: 'Utfordret av ChatGPT 28.10 · 3 innvendinger · 2 tatt inn', dato: '2026-10-28T10:00:00', låst: false }
  const alle = [
    { id: 'dok1', kind: 'capture', name: 'Ankeerklæring v5', project: 'Energima', source: 'Claude Cowork', capturedAt: 3, utfordret: u },
    { id: 'dok2', kind: 'capture', name: 'Prisliste for lageret', project: 'Energima', source: 'Claude Cowork', capturedAt: 2 },
    { id: 'k1', kind: 'konklusjon', name: 'Konklusjon: skal vi anke', project: 'Energima', convo: 'Anke?', source: 'Tua', capturedAt: 4 },
    { id: 'ut1', kind: 'svar', name: 'Utfordring (finn svakhetene): Ankeerklæring', project: 'Energima', source: 'OpenAI (GPT)', tags: ['svar', 'utfordring', 'openai'], er_utfordring: true, capturedAt: 5 },
    { id: 'up1', kind: 'prompt', name: 'Utfordre: Finn svakhetene', project: 'Energima', source: 'Tua', tags: ['prompt', 'utfordring'], capturedAt: 5 },
    { id: 'nv1', kind: 'svar', name: 'Ny versjon: Ankeerklæring', project: 'Energima', source: 'Claude', tags: ['svar', 'ny-versjon'], capturedAt: 6 },
  ]
  const f = regler.flateRader(alle)
  const ider = [...f.samtaler, ...f.dokumenter].flatMap((r) => r.ider)
  ok('C4: utfordringer, deres prompter og nye versjoner får ingen egne rader (de står på saken)', !ider.includes('ut1') && !ider.includes('up1') && !ider.includes('nv1') && ider.includes('dok1') && ider.includes('k1'), ider.join())
  const r1 = f.dokumenter.find((r) => r.id === 'dok1'), r2 = f.dokumenter.find((r) => r.id === 'dok2'), rk = f.samtaler.find((r) => r.ider.includes('k1'))
  ok('C5: raden bærer `utfordret` fra saken', r1?.utfordret?.id === 'u1' && !r2?.utfordret)
  ok('C5: «utfordret» (grønt) med «Utfordret av …» som tittel', regler.utfordringMerke(r1)?.tekst === 'utfordret' && regler.utfordringMerke(r1).klasse === 'er-utfordret' && /Utfordret av ChatGPT/.test(regler.utfordringMerke(r1).tittel))
  ok('C5: «ikke utfordret» bare på konklusjoner og hovedsaker — ikke på et vanlig dokument', regler.utfordringMerke(rk)?.tekst === 'ikke utfordret' && regler.utfordringMerke(r2) === null && regler.utfordringMerke(r2, { hoved: true })?.tekst === 'ikke utfordret' && regler.utfordringMerke({ sak: { arbeid: true } })?.tekst === 'ikke utfordret')
  ok('C5: nyesteUtfordret velger den nyeste av flere', regler.nyesteUtfordret([{ utfordret: { id: 'a', dato: '2026-10-27' } }, { utfordret: { id: 'b', dato: '2026-10-28' } }, {}])?.id === 'b')
  const ms = [{ id: 'ollama', label: 'Ollama (lokal)', modell: 'gemma3:4b', aktiv: true, local: true }, { id: 'claude', label: 'Claude (Anthropic)', aktiv: true }, { id: 'openai', label: 'OpenAI (GPT)', aktiv: true }, { id: 'mistral', label: 'Mistral', aktiv: false }, { id: 'test', label: 'Test (ekko — sender ingenting)', aktiv: true, test: true }]
  const k1 = regler.kontrollmodeller(ms, { forfatter: 'Claude (Anthropic)' })
  ok('C2: forfatter Claude → en annen familie foreslås øverst (Ollama), Claude etter de andre, test sist, Mistral (ikke klar) ute', k1.map((x) => x.m.id).join() === 'ollama,openai,claude,test' && k1[0].forslag && !k1[1].forslag && k1[2].samme, k1.map((x) => x.m.id).join())
  ok('C2: forfatter gemma3 (lokal) → Claude foreslås, Ollama som samme familie', regler.kontrollmodeller(ms, { forfatter: 'gemma3:4b' }).map((x) => x.m.id).join() === 'claude,openai,ollama,test')
  ok('C2: Vault-merket → bare lokale modeller', regler.kontrollmodeller(ms, { forfatter: 'Claude', vault: true }).map((x) => x.m.id).join() === 'ollama')
  ok('C2: familieAv kjenner igjen leverandøren som kildefargene', regler.familieAv('OpenAI (GPT)') === 'gpt' && regler.familieAv('Claude Cowork') === 'claude' && regler.familieAv('Test (ekko)') === 'test' && regler.familieAv('Tua') === '')
  const vend = [{ id: 'b1', rolle: 'bruker', L: 'Lag ankeutkast' }, { id: 'm1', rolle: 'modell', L: 'Nå setter jeg opp en arbeidsplan og begynner å lese kildedokumentene.' }, { id: 'm2', rolle: 'modell', L: 'La meg lese vedtaket først.' },
    { id: 'm3', rolle: 'modell', L: 'Ankeutkastet er klart. ' + 'Begrunnelse og påstand. '.repeat(40) }, { id: 'b2', rolle: 'bruker', L: 'Lag zip' }, { id: 'm4', rolle: 'modell', L: 'Ferdig.' }]
  const res = regler.samtaleResultat(vend)
  ok('C6: resultatet er siste svar med innhold (ikke «Ferdig.»), arbeidsstegene er resten av de korte', res.resultat?.id === 'm3' && [...res.steg].join() === 'm1,m2,m4' && res.antallSteg === 3)
  ok('C6: en samtale ført i Tua folder ingenting', regler.samtaleResultat(vend, { tua: true }).steg.size === 0)
  const fold = regler.foldSteg(vend, res.steg)
  ok('C6: foldSteg slår sammenhengende arbeidssteg sammen til én rad («2 arbeidssteg»)', fold.map((x) => (x.type === 'steg' ? `steg${x.vendinger.length}` : x.id)).join() === 'b1,steg2,m3,b2,steg1' && regler.stegTekst(2) === '2 arbeidssteg')
  ok('C6: et langt svar som begynner som et arbeidsnotat, er ikke et arbeidssteg', !regler.erArbeidssteg({ rolle: 'modell', L: 'Nå har jeg lest alt. ' + 'Funn. '.repeat(400) }))
  const src = fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'pages', 'Samtale.jsx'), 'utf8')
  ok('C1: «Også til» bare på siste svar i runden i en Tua-samtale; «Utfordre» står på resultatet', /const kanOgså = \(v\) => \{ if \(!samtale\?\.tua\) return \[\];[^\n]*iRunden\.at\(-1\)\?\.id !== v\.id/.test(src) && src.includes("utfordreKnapp({ sak: samtale.id, vending: res.resultat.id })"))
}

// Avissiden (arbeidsstykke 34, skissen skisse-avisside.png, Erik 29.10.2026) + skive B1: funn i stedet for systemtekst, hovedsak aldri Tua-bygging, kolonner per prosjekt
{
  const T = Date.now(), t = (h) => T - h * 3600e3
  const sak = (id, o) => ({ id, name: id, project: 'P', capturedAt: t(1), tags: [], links: [], version: 1, ...o })
  const alle = [
    sak('tua1', { kind: 'samtale', project: 'Tua_tua', convo: 'Bygg', name: 'Bygg', vekt: 99, capturedAt: t(1), content: '# Bygg\n\n**Claude:** Avisen er bygget og testene er grønne, og alt er flettet til main etter prøving i nettleseren.', levels: { S: { text: 'Background (from the session that started this one): …', by: 'regel' } } }),
    sak('tua2', { kind: 'notat', project: 'Tua_tua', name: 'Notat om bygging', vekt: 5, capturedAt: t(2) }),
    sak('ank', { kind: 'samtale', project: 'Energima anke', convo: 'Anke', name: 'energima anke', vekt: 30, capturedAt: t(3),
      content: '# energima anke\n\n_Tua · 1 vending · 2026-10-24 · Energima anke_\n\n**Du · 24.10.2026:** kan du vurdere anken?\n\n**Claude · L/M:** # Ny vurdering\n\n**Hovedfunn:** Det sterkeste ankepunktet mangler i utkastet. Tingretten tok ikke stilling til fakturaene, jf. tvl. § 19-6. Dette bør stå først.\n\n' + 'Mer begrunnelse. '.repeat(30),
      levels: { S: { text: 'This session is being continued from a previous conversation that ran out of context.', by: 'regel' } } }),
    sak('ank-p1', { kind: 'prompt', project: 'Energima anke', convo: 'Anke', name: 'kan du vurdere anken?', capturedAt: t(3) }),
    sak('ank-p2', { kind: 'prompt', project: 'Energima anke', convo: 'Anke', name: 'og fakturaene?', capturedAt: t(2) }),
    sak('dok', { kind: 'leveranse', project: 'Energima anke', name: 'Ankeerklæring v5', vekt: 6, capturedAt: t(5), levels: { S: { text: 'Ankeerklæring v5 (10 sider, fristavbrytende form). Fem hovedlinjer, jf. § 36.', by: 'Claude' } } }),
    sak('ski', { kind: 'notat', project: 'Skigaarden', name: 'Gjeld', vekt: 8, capturedAt: t(6), content: '# Gjeld\n\n*Laget 28.10.2026 · fra Claude*\n\nUten Danske Bank er gjelden 533 MNOK. Resten er pant i eiendommen.', levels: { S: { text: 'Gjeld', by: 'regel' } } }),
    sak('gml', { kind: 'notat', project: 'Gammelt', name: 'Gammelt notat', vekt: 50, capturedAt: T - 20 * 86400e3 }),
    sak('log', { kind: 'notat', project: 'P', key: 'helsesjekk:1', name: 'Helsesjekk 29.10', source: 'Tua', capturedAt: t(1) }),
  ]
  const f = regler.flateRader(alle)
  const side = regler.avisSide(regler.avisRader(f), { now: T })
  ok('Avis: hovedsaken er mest arbeid siste 48 t — aldri Tua_tua (vekt 99) og aldri eldre enn uka (vekt 50)', side.hoved?.id === 'ank')
  ok('Avis: kolonnene er prosjektene utenom Tua-bygging og drift, uten hovedsaken', side.prosjekter.map((p) => p.vis).join() === 'Skigaarden,Energima anke' && !side.prosjekter.some((p) => p.rader.some((r) => r.id === 'ank')))
  ok('Avis: lenger — TIDLIGERE har prosjektene med eldre arbeid (sist rørt først); denne uka har ingen tak på antall prosjekter', side.tidligere.map((p) => p.vis).join() === 'Gammelt' && side.tidligere[0].rader.length === 1 && side.flere.length === 0
    && regler.avisSide([{ slag: 'dokument', id: 'ny', project: 'Ny', tid: T - 1000, vekt: 1, sak: {} }, ...Array.from({ length: 20 }, (_, i) => ({ slag: 'dokument', id: 'x' + i, project: 'P' + (i % 10), tid: T - 1000 * (i + 1) - 30 * 86400e3, vekt: 0, sak: {} }))], { now: T }).tidligere.length === 10)
  const mange = (id, tid) => Array.from({ length: 40 }, (_, i) => ({ slag: 'dokument', id: id + i, project: id, tid: tid - i * 1000, vekt: 1, sak: {} }))
  const langAvis = regler.avisSide([...mange('Nå', T - 1000), ...mange('Før', T - 30 * 86400e3)], { now: T })
  ok('Avis: langt flere (Erik 02.11) — 25 saker per prosjekt denne uka, 15 under Tidligere, resten bak «+ N til»', langAvis.prosjekter[0].rader.length === 25 && langAvis.prosjekter[0].alle === 39 && langAvis.tidligere[0].rader.length === 15 && langAvis.tidligere[0].alle === 40)
  const pr = (vis, n) => ({ vis, rader: Array(n).fill({}) })
  const st = regler.fordelKolonner([pr('A', 20), pr('B', 1), pr('C', 1), pr('D', 1), pr('E', 1)])
  ok('Avis: kolonnene — et prosjekt legges i den korteste av tre, så et langt prosjekt ikke gir tomrom ved siden av', st.map((l) => l.map((p) => p.vis).join('')).join() === 'A,BD,CE')
  const stFør = regler.fordelKolonner([pr('A', 20), pr('B', 1), pr('C', 1)]), stEtter = regler.fordelKolonner([pr('A', 20), pr('B', 1), pr('C', 1), pr('D', 5)])
  ok('Avis: kolonnene — nye prosjekter legges under; det som alt står, flytter seg ikke', stFør.every((l, i) => l.every((p, j) => stEtter[i][j].vis === p.vis)) && regler.fordelKolonner([]).length === 0)
  ok('Avis: «N prosjekter i arbeid denne uka» teller ikke Tua_tua eller eldre prosjekter', side.antallProsjekter === 2)
  ok('Avis: Tua-byggingen i én linje — «Bygging av Tua · 1 samtale, 1 dokument i dag»', regler.byggingTekst(side.bygging) === 'Bygging av Tua · 1 samtale, 1 dokument i dag' && regler.erTuaBygging('Tua_tua') && regler.erTuaBygging('TUA') && !regler.erTuaBygging('Tua Business'))
  const fa = regler.funnAv(side.hoved)
  ok('B1: hovedsakens tittel er et funn fra siste svar — «Hovedfunn:» tatt bort, aldri «This session …»', fa.tittel === 'Det sterkeste ankepunktet mangler i utkastet' && /^Tingretten tok ikke stilling til fakturaene, jf\. tvl\. § 19-6\./.test(fa.ingress) && fa.kilde === 'regel')
  const fd = regler.funnAv(f.dokumenter.find((r) => r.id === 'dok'))
  ok('B1: modell-ingressen (S.by ≠ regel) brukes først; «jf.» deler ikke setningen', fd.kilde === 'modell' && fd.tittel === 'Ankeerklæring v5 (10 sider, fristavbrytende form)' && fd.ingress === 'Fem hovedlinjer, jf. § 36.')
  const fs2 = regler.funnAv(f.dokumenter.find((r) => r.id === 'ski'))
  ok('B1: dokumentets første avsnitt — kursiv metalinje og overskrift hoppes over', fs2.tittel === 'Uten Danske Bank er gjelden 533 MNOK' && fs2.ingress === 'Resten er pant i eiendommen.')
  ok('B1: lesbare tar aldri systemtekst, verktøylinjer eller arbeidssteg', regler.lesbare('Background (from the session that started this one): x\n\nThis session is being continued from a previous conversation.\n\n[søk: noe]\n\nLa meg sjekke dette først.\n\nSist: a → b\n\n12 oppgaver i Tua_tua, 3 filer skrevet.').length === 0)
  ok('B1: statussetninger («Begge er oppdatert til v2 …») blir ikke tittel', regler.funnAv({ slag: 'dokument', navn: 'X', sak: { content: 'Begge er oppdatert til v2 — samme atom-id. Anken bør bygge på Red Rock-dommen.' } }).tittel === 'Anken bør bygge på Red Rock-dommen')
  ok('B1: frontmatter-linjer («name: …») er ikke funn', regler.lesbare('name: project-manifest-status-2026-06-11\ndescription: noe her som er langt nok\n\nPrislisten for 2027 er klar til gjennomgang.').join('|') === 'Prislisten for 2027 er klar til gjennomgang.')
  ok('B1: uten lesbar tekst er navnet tittelen', regler.funnAv({ slag: 'samtale', navn: 'Terje Bjerkan oversikt', sak: { content: '# Terje\n\n_meta_' } }).kilde === 'navn')
  ok('Avis: kolonnetittelen er funnet for samtaler og modell-ingresser, ellers navnet', regler.kolonneTittel(side.hoved) === 'Det sterkeste ankepunktet mangler i utkastet' && regler.kolonneTittel(f.dokumenter.find((r) => r.id === 'ski')) === 'Gjeld')
  ok('Avis: metalinja og typen — «Claude · N vendinger», «samtale»/«konklusjon»', regler.avisMeta({ kildeNavn: 'Claude Desktop', dokumenter: [1, 2, 3, 4], vendinger: 12 }) === 'Claude · 4 dokumenter · 12 vendinger' && regler.avisType({ slag: 'samtale', konklusjon: {} }) === 'konklusjon' && regler.avisType({ slag: 'dokument', sak: {} }) === 'dokument')
  const src = fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'pages', 'Forside.jsx'), 'utf8')
  ok('Avis: fanen har ikke lenger den flate lista («Siste sju dager» / «Tidligere»); den bor i Samtaler og Dokumenter', !src.includes('>Siste sju dager<') && !src.includes('key="sek-tidl"') && src.includes("avisSide(flateAvis") && src.includes('className="av-tidligere"'))
  ok("Avis: «Tidligere» henter neste ni prosjekter av seg selv når bunnen kommer til syne (Erik 29.10: «vil gjerne scrolle nedover»)", src.includes("new IntersectionObserver") && src.includes("ref={tidlBunn}"))
  // Erik 29.10: HELE samtalen er atomet — dokumentene den laget står bare inne i samtalens rad, ikke som egne rader i avisen
  const sd = [
    sak('økt', { kind: 'samtale', project: 'Tua_tua', convo: 'Skive A', name: 'Økt: Skive A', key: 'okt:1', capturedAt: t(2) }),
    sak('d1', { kind: 'notat', project: 'Tua_tua', convo: 'Skive A', name: 'Skive A — slik ble det', key: 'fil:/x/02-skive-a.md', capturedAt: t(1) }),
    sak('d2', { kind: 'notat', project: 'Tua_tua', name: 'Skive A overlevering', key: 'fil:/x/over.md', bygget_av: ['økt'], capturedAt: t(1) }),
    sak('d3', { kind: 'notat', project: 'Tua_tua', name: 'Frittstående notat om noe annet', capturedAt: t(3) }),
  ]
  const fsd = regler.flateRader(sd), ar = regler.avisRader(fsd)
  ok('Avis: samtale + 2 egne dokumenter → 1 rad (dokumentene under «2 dokumenter»); dokument uten samtale får egen rad; Dokumenter viser alle', ar.length === 2 && ar.some((r) => r.slag === 'samtale' && r.dokumenter.length === 2) && ar.some((r) => r.id === 'd3') && fsd.dokumenter.length === 3)
  ok('Avis: Tua_tua havner uansett bare i bunnlinja «Bygging av Tua»', (() => { const sx = regler.avisSide(ar, { now: T }); return !sx.hoved && sx.prosjekter.length === 0 && regler.byggingTekst(sx.bygging) === 'Bygging av Tua · 1 samtale, 1 dokument i dag' })())
  // Erik 29.10: samtalefraser er ikke funn — hopp over og prøv neste kilde; ender alt der, er tittelen navnet. Uten prosjekt får ingen kolonne.
  const fraseRad = (navn, svar, S = '') => ({ slag: 'samtale', navn, sak: { kind: 'samtale', name: navn, content: `# ${navn}\n\n**Bruker:** spørsmål\n\n**Claude:** ${svar}`, levels: { S: { text: S, by: 'regel' } } } })
  const fem = [
    ['Tokenisering av eiendeler', 'Kort svar: nei, ikke i dag.'],
    ['Sammendrag av vedlagt fil', 'Sammendrag av vedlagt fil.'],
    ['Fjellbadet prosjekt analyse', 'Jeg har sjekket mot atomet om OCB-vinlageret i Tua (sist oppdatert 13.10).'],
    ['Lese aksjer.md og gi en vurdering av løsningen?', 'Vennligst last opp filen «aksjer.md» slik at jeg kan lese den og gi en vurdering.'],
    ['har du samme oppfatning som claude', 'Jeg må vite hva Claude mener for å kunne svare på det spørsmålet.'],
  ]
  for (const [navn, svar] of fem) { const fx = regler.funnAv(fraseRad(navn, svar)); ok(`Funn: «${svar.slice(0, 40)}» er en samtalefrase → tittelen er navnet «${navn}»`, fx.kilde === 'navn' && fx.tittel === navn && regler.kolonneTittel(fraseRad(navn, svar), fx) === navn) }
  ok('Funn: frasen hoppes over og neste setning med innhold brukes; under fem ord er ikke et funn', regler.funnAv(fraseRad('X', 'Kort svar: nei. Tokenisering løser et problem dere neppe har nå.')).tittel === 'Tokenisering løser et problem dere neppe har nå' && regler.funnAv(fraseRad('Y', 'Ferdig med det.')).kilde === 'navn')
  ok('Funn: neste kilde prøves — frase i siste svar, funn i regel-ingressens «→»-del', regler.funnAv(fraseRad('Z', 'Ok.', 'Sist: hva nå? → Leieavtalen bør reforhandles før nyttår, med kortere binding. · 4 vendinger')).tittel === 'Leieavtalen bør reforhandles før nyttår, med kortere binding')
  const up = regler.avisSide([{ slag: 'samtale', id: 'h', project: 'A', tid: T - 1000, vekt: 10, sak: {} }, { slag: 'samtale', id: 'u1', project: 'empty', tid: T - 2000, vekt: 50, sak: {} }, { slag: 'dokument', id: 'u2', project: 'Uten prosjekt', tid: T - 3000, vekt: 40, sak: {} }, { slag: 'dokument', id: 'b', project: 'B', tid: T - 3000, vekt: 1, sak: {} }], { now: T })
  ok('Avis: Uten prosjekt (også «empty») får ingen egen kolonne', !up.prosjekter.some((p) => p.vis === 'Uten prosjekt') && up.prosjekter.some((p) => p.vis === 'B'))
  // Erik 02.11: «hverken det mest aktive, siste arbeid, eller det største» — en lang samtale som ikke er rørt på tre dager taper for den du jobber i nå
  const del = (id, convo, h, o = {}) => sak(id, { kind: 'prompt', project: 'P', convo, name: id, capturedAt: t(h), ...o })
  const lang = [sak('lang', { kind: 'samtale', project: 'P', convo: 'Lang', name: 'Lang samtale', vekt: 90, capturedAt: t(30) }), ...Array.from({ length: 20 }, (_, i) => del('l' + i, 'Lang', 72 + i, { vekt: 4 }))]
  const aktiv = [sak('aktiv', { kind: 'samtale', project: 'Q', convo: 'Aktiv', name: 'Aktiv samtale', capturedAt: t(1) }), del('a1', 'Aktiv', 2, { project: 'Q' }), del('a2', 'Aktiv', 3, { project: 'Q' })]
  const hvs = (l, now = T) => regler.avisSide(regler.avisRader(regler.flateRader(l)), { now }).hoved?.id
  ok('Hovedsak: mest arbeid siste 48 t slår en lang samtale som er eldre (vekt teller ikke)', hvs([...lang, ...aktiv]) === 'aktiv')
  ok('Hovedsak: arkivet står stille — 48 timer regnes fra det sist rørte, ikke fra nå', hvs([...lang, ...aktiv], T + 10 * 86400e3) === 'aktiv')
  ok('Hovedsak: en sak uten prosjekt fortrenger ikke prosjektenes arbeid, men blir hovedsak når ingen har prosjekt', hvs([...aktiv, sak('tom', { kind: 'samtale', project: 'empty', convo: 'Tom', name: 'Uten prosjekt-samtale', capturedAt: T - 60000 })]) === 'aktiv' && hvs([sak('tom', { kind: 'samtale', project: 'empty', convo: 'Tom', name: 'Uten prosjekt-samtale', capturedAt: T - 60000 })]) === 'tom')
  ok('Avis: antall vendinger står igjen når modellen har skrevet ingressen', regler.avisMeta({ kildeNavn: 'Claude', sak: { levels: { S: { text: 'Funnet.', by: 'Ollama · gemma3:4b' }, M: { text: '_Claude Cowork · 17 vendinger · 31.7.2026_', by: 'regel' } } } }) === 'Claude · 17 vendinger')
  const raderA = regler.flateRader([...aktiv, sak('ver2', { kind: 'leveranse', project: 'R', name: 'Leieavtale v2', capturedAt: t(1) }), sak('ver2p', { kind: 'leveranse', project: 'R', name: 'Leieavtale v2', file: 'Leieavtale v2.pdf', capturedAt: t(1) }), sak('ver1', { kind: 'leveranse', project: 'R', name: 'Leieavtale v1', capturedAt: t(2) }), sak('ver0', { kind: 'leveranse', project: 'R', name: 'Leieavtale v0', capturedAt: t(100) })])
  const rS = raderA.samtaler.find((r) => r.id === 'aktiv'), rD = raderA.dokumenter.find((r) => r.project === 'R')
  ok('Hovedsak: arbeidet telles — logg + vendinger 1 hver, ny dokumentversjon 2, gammel versjon 0', regler.arbeidSiden(rS, t(48)) === 3 && regler.arbeidSiden(rS, t(2.5)) === 2 && regler.arbeidSiden(rD, t(48)) === 4)
  const regelRad = { slag: 'samtale', navn: 'Samtalens navn', sak: { content: '# X\n\n**Claude:** Liv-ex er en elektronisk markedsplass i London for handel med vin. Den brukes som prisreferanse av hele bransjen.' } }
  const hv = regler.hovedVisning(regelRad), hm = regler.hovedVisning({ slag: 'dokument', navn: 'N', sak: { levels: { S: { text: 'Gjelden er 533 MNOK uten Danske Bank. Resten er pant.', by: 'Ollama · gemma3:4b' } } } })
  ok('Hovedsak: en setning plukket av regelen er aldri tittelen — navnet er tittelen, setningen er ingressen; modellens funn er tittelen', hv.tittel === 'Samtalens navn' && /^Liv-ex er en elektronisk/.test(hv.ingress) && hm.tittel === 'Gjelden er 533 MNOK uten Danske Bank')
  const nyeDeler = regler.funnAv({ slag: 'samtale', navn: 'X', sak: {}, deler: [{ kind: 'capture', levels: { S: { text: 'Gammelt funn fra første del av samtalen.', by: 'Claude' } } }, { kind: 'capture', levels: { S: { text: 'Nyeste funn fra siste del av samtalen.', by: 'Claude' } } }] })
  ok('Funn: uten ingress på selve samtalen brukes modellens ingress fra den nyeste delen', nyeDeler.kilde === 'modell' && /^Nyeste funn/.test(nyeDeler.tittel))
  ok('Avis: et klikk til på en sak folder sammen; knappen går til Arbeid (Erik 29.10)', /const klikkRad = \(r\) => \{ const k = radNøkkel\(r\); if \(utfoldet === k\) \{ setUtfoldet\(null\); return \}/.test(src) && src.includes('{ut && a && radKnapper(r, ut)}'))
}

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
