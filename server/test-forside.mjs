#!/usr/bin/env node
// test-forside.mjs — friksjonsrunde 1 (bruksdag 1, 24.10.2026): forsiden og Innboks, mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall.
//
//   TUA_FILES_ROOT=/tmp/tua-test-forside/arkiv TUA_DATA_DIR=/tmp/tua-test-forside/data TUA_HOME=/tmp/tua-test-forside/hjem node server/test-forside.mjs
//
// Sjekker: (9) S for samtaler etter regelen «siste vending» (samtaleS): «Sist: <siste prompt> → <første setning av svaret> · N vendinger · periode»;
// importen av et falskt Code-transkript skriver den, ny import etter nye vendinger oppdaterer den (ny versjon, tittelen beholdes), en menneskeskrevet
// S røres aldri (V10); samtaleSFraTranskript leser samme S ut av den lagrede saken; `node review.js --samtaler --dry-run` viser uten å skrive,
// uten --dry-run skriver den (by: regel) og lar menneskeskrevet stå. (11) /api/atoms gir feltene lista trenger. (5) /innboks svarer med app-fila,
// /api/innboks teller dokumentene som venter, og /api/innboks/antall gir bare tellingen.
// Runde 1 (arb. 32 §6, 24.10.2026): reglene i tua2-sandbox/src/regler.js (hovedsak, ekte samtaler, tråder, maskert visning), store.tråder/deliveryCounts,
// brukbarTittel (PDF-tittel fra filnavn når metadata er teknisk), og POST /api/innboks/les som SSE med fremdrift.
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

const { load, save, upsert, mkLevel, tråder, deliveryCounts, logDelivery } = await import('./store.js')
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
  // menneskeskrevet S → røres ikke av neste import (V10)
  const atoms = load(); const m = atoms.find((x) => x.key === `samtale:${SID}`); m.levels.S = mkLevel('Eriks egen ingress om lagerflyttingen.', 'menneske', m.version); save(atoms)
  fs.appendFileSync(øktfil, [linje('user', 'Og en ting til: legg ved budsjettet som tabell, med alle postene fra møtenotatet.', 6), linje('assistant', 'Tabellen ligger under.', 7)].join('\n') + '\n')
  importCode({ files: [øktfil], source: 'code', minChars: 100 })
  const c = load().find((x) => x.key === `samtale:${SID}`)
  ok('menneskeskrevet S røres ikke av ny import (V10) — innholdet får ny versjon, S står', c.levels.S.text === 'Eriks egen ingress om lagerflyttingen.' && c.levels.S.by === 'menneske' && c.version === 3)
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

// ── 4) broen: /innboks, /api/atoms-feltene, /api/innboks og /api/innboks/antall ─
const PORT = 5298
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
fs.writeFileSync(path.join(ROOT, 'Innboks', 'notat.txt'), 'Et notat som venter i Innboks. '.repeat(40))
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1', TUA_SKRIVER: 'regel' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const hent = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, type: r.headers.get('content-type') || '', tekst: await r.text() } }
try {
  const side = await hent('/innboks')
  ok('GET /innboks → app-fila (Innboks er en rute i appen, friksjon 5)', side.status === 200 && /text\/html/.test(side.type) && side.tekst.includes('app-test'))
  const at = JSON.parse((await hent('/api/atoms')).tekst)
  const s = at.atoms.find((a) => a.key === `samtale:${SID}`)
  ok('GET /api/atoms: feltene lista trenger — id, name, project, kind, capturedAt, convo, tags, levels.S, ord, tegn, max, vault, status, source', !!s && ['id', 'name', 'project', 'kind', 'capturedAt', 'convo', 'tags', 'levels', 'ord', 'tegn', 'max', 'vault', 'status', 'source'].every((f) => s[f] !== undefined) && s.kind === 'samtale' && typeof s.levels.S.text === 'string' && typeof s.ord.S === 'number', s ? Object.keys(s).join(',') : 'mangler')
  ok('GET /api/atoms: nyeste først (lista og avisen sorterer selv, men svaret er alt sortert)', at.atoms.every((a, i) => i === 0 || at.atoms[i - 1].capturedAt >= a.capturedAt))
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
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
