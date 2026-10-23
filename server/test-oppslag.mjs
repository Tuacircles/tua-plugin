#!/usr/bin/env node
// test-oppslag.mjs — sak-panelet i Oppslag (M23, skive 4) mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte kall til en modell.
//
//   TUA_FILES_ROOT=/tmp/tua-test-oppslag/arkiv TUA_DATA_DIR=/tmp/tua-test-oppslag/data node server/test-oppslag.mjs
//
// Sjekker: status utkast/endelig i lageret (standard svar = utkast, alt annet = endelig; nøkkelen skrives bare når satt, leses tilbake,
// overlever en omskriving), og i broen: /oppslag gir app-fila, /api/atoms og /api/search har status, GET /api/utlevert?id gir linjene for én sak
// (nivå for den saken plukket ut, nyeste først, aldri originaler), GET /api/versions?id, POST /api/status (400 på ugyldig, 404 på ukjent,
// skriver gjennom lageret så fila får `status` og forrige tilstand bevares i .tua/versions), og at /api/link med nivå svarer med status.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR
if (!ROOT || !DATA || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true })

const { load, save, upsert, statusOf, setStatus, STATUSER, deliveries, versions, fileOf } = await import('./store.js')
const { spor } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }

// ── testarkiv ──────────────────────────────────────────────────────────────
const PERSON = 'Yrjan Kvalheim', EPOST = 'yrjan@example.no'
const atoms = []
const a1 = upsert(atoms, { content: `# Notat\n\n${PERSON} (${EPOST}) vil flytte lageret. ` + 'Mer tekst. '.repeat(200), name: 'Notat om lageret', project: 'Testprosjekt', convo: `Møte med ${PERSON}`, short: 'Flytte lageret.', by: 'menneske', tags: ['lager'] }).atom
const a2 = upsert(atoms, { content: 'En kort sak.', name: 'Kort sak', project: 'Testprosjekt', by: 'menneske' }).atom
const a3 = upsert(atoms, { content: 'Sak i et annet prosjekt.', name: 'Annen sak', project: 'Annet', short: 'Ingressen.', by: 'menneske' }).atom
save(atoms)
ok('testarkiv skrevet', fs.existsSync(path.join(ROOT, 'Testprosjekt')), ROOT)

// ── 1) status i lageret ────────────────────────────────────────────────────
ok('statusOf: en vanlig sak er endelig som standard', statusOf(a1) === 'endelig' && statusOf({ kind: 'prompt' }) === 'endelig')
ok('statusOf: et svar er utkast som standard', statusOf({ kind: 'svar' }) === 'utkast')
ok('status skrives ikke i fila før den er satt', !fs.readFileSync(fileOf(a1), 'utf8').includes('\nstatus:'))
let e = null; try { setStatus(a1, 'ferdig') } catch (x) { e = x }
ok('setStatus: bare utkast eller endelig', e && /utkast eller endelig/.test(e.message) && STATUSER.length === 2, e?.message)
{
  const alle = load()
  const x = alle.find((a) => a.id === a2.id)
  setStatus(x, 'utkast'); save(alle)
  const fil = fs.readFileSync(fileOf(x), 'utf8')
  ok('setStatus + save: nøkkelen status står i frontmatter', fil.includes('status: "utkast"'), fil.split('\n').find((l) => l.startsWith('status')))
  const igjen = load().find((a) => a.id === a2.id)
  ok('status leses tilbake fra fila', igjen.status === 'utkast' && statusOf(igjen) === 'utkast')
  ok('forrige tilstand bevart i .tua/versions (versjonen som før)', versions(a2.id).length === 1, JSON.stringify(versions(a2.id)))
  // En omskriving av innholdet (upsert med key ville gjort det; her: direkte) skal ikke miste status.
  igjen.content = 'En kort sak, rettet.'; igjen.version = 2
  const alle2 = load().map((a) => (a.id === a2.id ? igjen : a)); save(alle2)
  ok('status overlever en omskriving av saken', load().find((a) => a.id === a2.id).status === 'utkast')
}

// ── 2) en sending gjennom motoren til «test» (ekko, ingenting forlater maskinen) — gir Utlevert-linje og et svar ──
const r = await spor({ melding: `Hva vil ${PERSON}?`, saker: [{ id: a1.id, nivå: 'M' }, { id: a2.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: 'Test av panelet' })
ok('sending til test gikk: svar og prompt lagret', /^a_/.test(r.svar) && /^a_/.test(r.prompt))
ok('svaret er utkast som standard (statusOf), prompten endelig', statusOf(load().find((a) => a.id === r.svar)) === 'utkast' && statusOf(load().find((a) => a.id === r.prompt)) === 'endelig')
ok('deliveries(a1) har sendingen', deliveries(a1.id).some((u) => u.svar === r.svar))

// ── 3) broen ───────────────────────────────────────────────────────────────
const PORT = 5297
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, init); return { status: r.status, type: r.headers.get('content-type') || '', tekst: await r.text() } }
const post = async (p, body) => hent(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
try {
  const side = await hent('/oppslag')
  ok('GET /oppslag → app-fila (Oppslag er en rute i appen)', side.status === 200 && /text\/html/.test(side.type) && side.tekst.includes('app-test'))
  const at = JSON.parse((await hent('/api/atoms')).tekst)
  ok('GET /api/atoms: status per sak (svar = utkast, sak = endelig, satt status vinner)', at.atoms.find((a) => a.id === r.svar)?.status === 'utkast' && at.atoms.find((a) => a.id === a1.id)?.status === 'endelig' && at.atoms.find((a) => a.id === a2.id)?.status === 'utkast')
  const s = JSON.parse((await hent('/api/search?q=lageret')).tekst)
  ok('GET /api/search: status per treff', s.hits.find((h) => h.id === a1.id)?.status === 'endelig')

  // Utlevert for én sak
  const u1 = JSON.parse((await hent(`/api/utlevert?id=${a1.id}`)).tekst)
  ok('GET /api/utlevert?id: linjene som tok med saken, nivå for DENNE saken plukket ut', u1.id === a1.id && u1.utlevert.length === 1 && u1.utlevert[0].nivå === 'M' && u1.utlevert[0].mottaker === 'test' && u1.utlevert[0].svar === r.svar && typeof u1.utlevert[0].at === 'number', JSON.stringify(u1.utlevert[0]))
  const u2 = JSON.parse((await hent(`/api/utlevert?id=${a2.id}`)).tekst)
  ok('GET /api/utlevert?id: samme sending, nivå S for den andre saken', u2.utlevert.length === 1 && u2.utlevert[0].nivå === 'S')
  ok('GET /api/utlevert: antall skjermet per type, ord og tokens — aldri innhold eller originaler', typeof u1.utlevert[0].skjermet === 'object' && typeof u1.utlevert[0].ord === 'number' && typeof u1.utlevert[0].tokens?.inn === 'number' && !JSON.stringify(u1).includes(PERSON) && !JSON.stringify(u1).includes(EPOST) && !JSON.stringify(u1).includes('lageret'))
  ok('GET /api/utlevert for en sak som aldri har gått ut → tom liste', JSON.parse((await hent(`/api/utlevert?id=${a3.id}`)).tekst).utlevert.length === 0)
  ok('GET /api/utlevert uten id → hele loggen samlet (skive 5, Innstillinger), ikke 400', (await hent('/api/utlevert')).status === 200 && JSON.parse((await hent('/api/utlevert')).tekst).total === 1)

  // Versjoner
  const v = JSON.parse((await hent(`/api/versions?id=${a2.id}`)).tekst)
  ok('GET /api/versions?id: versjonen nå og tidligere versjoner fra lageret', v.id === a2.id && v.version === 2 && v.versions.length >= 1 && v.versions[0].name === 'v1' && typeof v.versions[0].mtime === 'number', JSON.stringify(v))
  ok('GET /api/versions for ukjent id → 404', (await hent('/api/versions?id=finnes-ikke')).status === 404)

  // Status gjennom broen
  const antallVersjoner = (id) => { try { return fs.readdirSync(path.join(ROOT, '.tua', 'versions', id)).length } catch { return 0 } }
  const før = antallVersjoner(r.svar)
  const st = await post('/api/status', { id: r.svar, status: 'endelig' })
  const stJ = JSON.parse(st.tekst)
  ok('POST /api/status: svaret låst som endelig — svarer med saken og forrige status', st.status === 200 && stJ.atom.status === 'endelig' && stJ.før === 'utkast', st.tekst.slice(0, 120))
  const svarFil = fs.readFileSync(fileOf(load().find((a) => a.id === r.svar)), 'utf8')
  ok('POST /api/status: fila har status: "endelig" i frontmatter', svarFil.includes('status: "endelig"'))
  ok('POST /api/status: forrige tilstand bevart i .tua/versions', antallVersjoner(r.svar) === før + 1)
  ok('GET /api/atoms etterpå: status endelig', JSON.parse((await hent('/api/atoms')).tekst).atoms.find((a) => a.id === r.svar)?.status === 'endelig')
  ok('POST /api/status med ugyldig status → 400', (await post('/api/status', { id: r.svar, status: 'ferdig' })).status === 400)
  ok('POST /api/status for ukjent id → 404', (await post('/api/status', { id: 'finnes-ikke', status: 'endelig' })).status === 404)
  ok('POST /api/status uten felt → 400', (await post('/api/status', {})).status === 400)
  // Tilbake til utkast
  ok('POST /api/status: tilbake til utkast', JSON.parse((await post('/api/status', { id: r.svar, status: 'utkast' })).tekst).atom.status === 'utkast')

  // Synlig for: /api/link med nivå svarer med status (panelet oppdaterer lista fra svaret)
  const ln = JSON.parse((await post('/api/link', { id: a1.id, project: 'Annet', level: 'S' })).tekst)
  ok('POST /api/link med nivå: refs og share satt, status med i svaret', ln.atom.refs.includes('Annet') && ln.atom.share?.Annet === 'S' && ln.atom.status === 'endelig', JSON.stringify({ refs: ln.atom.refs, share: ln.atom.share, status: ln.atom.status }))
  const ln2 = JSON.parse((await post('/api/link', { id: a1.id, project: 'Annet', level: 'M' })).tekst)
  ok('POST /api/link igjen med nytt nivå → nivået endres på referansen', ln2.atom.share?.Annet === 'M')
  const un = JSON.parse((await post('/api/unlink', { id: a1.id, project: 'Annet' })).tekst)
  ok('POST /api/unlink → referansen borte', !un.atom.refs.includes('Annet') && !un.atom.share?.Annet)

  // «Vis i Finder» via broen (dryrun): bare sakens egen fil
  const op = await post('/api/open', { id: a1.id, target: 'finder' })
  ok('POST /api/open finder (dryrun): bare sakens egen fil, ingen shell', op.status === 200 && JSON.parse(op.tekst).dryrun === true, op.tekst.slice(0, 100))
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
