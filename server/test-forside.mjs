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

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
