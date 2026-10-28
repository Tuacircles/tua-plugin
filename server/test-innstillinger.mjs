#!/usr/bin/env node
// test-innstillinger.mjs — Innstillinger › AI-mottakere og Utlevert-loggen (M15 utvidet, skive 5) mot et testarkiv i scratch.
// ALDRI mot ~/Dropbox/Tua, ALDRI et ekte kall til en modell, ALDRI en ekte nøkkel i Keychain (prefikset byttes ut, så Claude er aldri «klar»).
//
//   TUA_FILES_ROOT=/tmp/tua-test-innstillinger/arkiv TUA_DATA_DIR=/tmp/tua-test-innstillinger/data node server/test-innstillinger.mjs
//
// Sjekker: trust-scores.json i endepunkt-form (endepunkter[] med kilde og dato; ai avledet så gamle lesere virker; gammel form leses også),
// mottakere() har kilde og dato per rad, og i broen: /innstillinger gir app-fila, /api/settings gir fortsatt ai[].trust og sky[].trust,
// /api/mottakere har kilde/dato per rad og aldri en nøkkelverdi, GET /api/utlevert uten id gir alle linjer med saknavn nyeste først med
// limit/offset og filter (mottaker, dager) — aldri innhold eller originaler, GET /api/utlevert.csv gir text/csv med header og én rad per sending,
// og /api/keychain under testprefikset: satt → vises som satt i /api/settings → fjernet (slettes etterpå).
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

const { load, save, upsert, deliveries, logDelivery, fileOf } = await import('./store.js')
const { spor, mottakere, trustScores, trustFor } = await import('./motor.js')
const { deleteKey, hasKey } = await import('./keychain.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }

// ── 1) trust-scores.json i endepunkt-form ───────────────────────────────────
const fil = JSON.parse(fs.readFileSync(path.join(HERE, 'trust-scores.json'), 'utf8'))
ok('trust-scores.json: endepunkter[] i fila, ikke ai{}', Array.isArray(fil.endepunkter) && fil.endepunkter.length >= 2 && !fil.ai)
ok('hvert endepunkt har id, label, endpoint, score, de fire parametrene, anbefaling, kilde og dato', fil.endepunkter.every((e) => e.id && e.label && e.endpoint && Number.isInteger(e.score) && e.metadata && e.innhold && e.mining && e.retensjon && e.anbefaling && e.kilde && /^\d{4}-\d{2}-\d{2}$/.test(e.dato)), fil.endepunkter.map((e) => e.id).join(', '))
ok('kilde er merket anslag der den ikke er egen vurdering', fil.endepunkter.filter((e) => e.id !== 'ollama').every((e) => /anslag/.test(e.kilde)))
ok('sky-delen er beholdt per skytjeneste', fil.sky && ['icloud', 'dropbox', 'onedrive', 'googledrive'].every((k) => fil.sky[k]?.score))
const ts = trustScores()
ok('trustScores(): ai avledet av endepunkter (claude, ollama) — gamle lesere virker uendret', ts.ai?.claude?.score === fil.endepunkter.find((e) => e.id === 'claude').score && ts.ai?.ollama?.score === 5 && ts.endepunkter.length === fil.endepunkter.length)
ok('trustScores(): ai[].kilde og dato følger med', !!ts.ai.claude.kilde && ts.ai.claude.dato === fil.endepunkter.find((e) => e.id === 'claude').dato)
ok('trustFor(id) finner endepunktet', trustFor('claude')?.endpoint === 'api.anthropic.com' && trustFor('finnes-ikke') === null)
// Gammel form leses også (bakoverkompatibelt): skriv en midlertidig kopi i gammel form og les med samme logikk
{
  const gammel = { _merk: 'x', sky: {}, ai: { claude: { label: 'Claude', score: 4, metadata: 'm', innhold: 'i', mining: 'g', retensjon: 'r', anbefaling: 'a' } } }
  const endepunkter = Array.isArray(gammel.endepunkter) ? gammel.endepunkter : Object.entries(gammel.ai || {}).map(([id, v]) => ({ id, leverandør: id, ...v }))
  ok('gammel form (ai per leverandør) kan avledes til endepunkter', endepunkter.length === 1 && endepunkter[0].id === 'claude' && endepunkter[0].score === 4)
}

// ── 2) mottakere() med kilde og dato ────────────────────────────────────────
const liste = await mottakere()
ok('mottakere(): claude, ollama og test har trust med kilde og dato', ['claude', 'ollama', 'test'].every((id) => { const m = liste.find((x) => x.id === id); return m && m.trust && m.trust.kilde && m.trust.dato }), JSON.stringify(liste.map((m) => [m.id, m.trust?.dato])))
ok('mottakere(): claude er ikke satt under testprefikset (ingen ekte nøkkel leses)', liste.find((m) => m.id === 'claude').nøkkel === 'ikke satt')
ok('mottakere(): svakest parameter er med der den er satt', liste.find((m) => m.id === 'claude').trust.svakest === 'retensjon')

// ── 3) testarkiv og to sendinger til «test» (ekko, ingenting forlater maskinen) ──
const PERSON = 'Yrjan Kvalheim', EPOST = 'yrjan@example.no'
const atoms = []
const a1 = upsert(atoms, { content: `# Notat\n\n${PERSON} (${EPOST}) vil flytte lageret. ` + 'Mer tekst. '.repeat(200), name: 'Notat om lageret', project: 'Testprosjekt', convo: `Møte med ${PERSON}`, short: 'Flytte lageret.', by: 'menneske' }).atom
const a2 = upsert(atoms, { content: 'En kort sak.', name: 'Kort sak', project: 'Testprosjekt', by: 'menneske' }).atom
save(atoms)
const r1 = await spor({ melding: `Hva vil ${PERSON}?`, saker: [{ id: a1.id, nivå: 'M' }, { id: a2.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Testprosjekt' })
await new Promise((r) => setTimeout(r, 20))
const r2 = await spor({ melding: 'Og hva mer?', saker: [{ id: a2.id, nivå: 'S' }], mottaker: 'test' })
// og én eldre linje fra MCP-døra (tool get: id/level, ikke saker[]) — tre dager gammel
logDelivery({ at: Date.now() - 3 * 86400e3, tool: 'get', id: a1.id, version: 1, level: 'S', context: 'Annet' })
ok('tre linjer i Utlevert-loggen (to fra motoren, én fra MCP-døra)', deliveries(null, 100).length === 3)
// skive 4: en gammel Tua-tråd (prompt:spor: uten samtale-sak) og tre Cowork-kjøringer med samme tittel — til knappene i Innstillinger › Spør
let gpId, cw = []
{
  const at = load()
  const gp = upsert(at, { key: 'prompt:spor:gammel9', kind: 'prompt', content: 'Gammelt spørsmål fra før skive 1: hva er fristen?', name: 'Hva er fristen?', project: 'Testprosjekt', convo: 'Hva er fristen?', source: 'Tua', by: 'regel', short: 'Gammelt spørsmål.' }).atom
  const gs = upsert(at, { key: 'svar:spor:gammel9', kind: 'svar', content: 'Tre uker.', name: 'Svar fra Test: Hva er fristen?', project: 'Testprosjekt', convo: 'Hva er fristen?', source: 'Test (ekko — sender ingenting)', tags: ['svar', 'test'], by: 'regel', derivedFrom: [{ id: gp.id, version: 1, level: 'L' }] }).atom
  gp.ga = [{ id: gs.id, version: 1 }]; gpId = gp.id
  const DAGLIG = 'Du lager min daglige morgenbriefing. Gå gjennom nyhetene og lag et sammendrag på norsk for meg.'
  for (let i = 0; i < 3; i++) cw.push(upsert(at, { key: `samtale:cw-900${i}`, kind: 'samtale', content: `# Briefing\n\n_Claude Cowork · 1 vending · 2026-10-2${i} · Skigaarden_\n\n**Bruker:** ${DAGLIG}\n\n**Claude:** Briefing ${i}.`, name: DAGLIG, project: 'Skigaarden', convo: `Kjøring ${i}`, source: 'Claude Cowork', by: 'regel', tags: ['samtale', 'cowork'], short: `Sist: … · 1 vending · 2${i}.10.2026` }).atom)
  cw.forEach((c, i) => { c.createdAt = Date.parse(`2026-10-2${i}T08:00:00+02:00`); c.capturedAt = c.createdAt })
  save(at)
}

// ── 4) broen ────────────────────────────────────────────────────────────────
const PORT = 5298
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
// tekst via bytes så BOM-en i CSV-en ikke strippes av TextDecoder (fetch().text() tar den bort)
const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, init); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '', tekst: b.toString('utf8'), bom: b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf } }
const jsonAv = async (p) => JSON.parse((await hent(p)).tekst)
const send = async (metode, p, body) => hent(p, { method: metode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
try {
  const side = await hent('/innstillinger')
  ok('GET /innstillinger → app-fila (Innstillinger er en rute i appen)', side.status === 200 && /text\/html/.test(side.type) && side.tekst.includes('app-test'))

  // settings og mottakere
  const st = await jsonAv('/api/settings')
  ok('GET /api/settings: ai[].trust fortsatt per leverandør (claude 4, ollama 5) med kilde og dato', st.ai.find((p) => p.id === 'claude')?.trust?.score === ts.ai.claude.score && st.ai.find((p) => p.id === 'ollama')?.trust?.score === 5 && !!st.ai.find((p) => p.id === 'claude').trust.kilde && !!st.ai.find((p) => p.id === 'claude').trust.dato)
  ok('GET /api/settings: sky[].trust som før', st.sky.length === 4 && st.sky.every((c) => c.trust?.score))
  ok('GET /api/settings: ingen nøkkelverdier, bare satt/ikke satt', st.ai.every((p) => typeof p.satt === 'boolean') && !JSON.stringify(st).includes('sk-ant'))
  const mo = await jsonAv('/api/mottakere')
  ok('GET /api/mottakere: kilde og dato per rad', mo.mottakere.length >= 3 && mo.mottakere.every((m) => m.trust?.kilde && m.trust?.dato), JSON.stringify(mo.mottakere.map((m) => [m.id, m.trust?.dato])))
  ok('GET /api/mottakere: endpoint og region på Claude-raden', mo.mottakere.find((m) => m.id === 'claude').endpoint === 'api.anthropic.com' && mo.mottakere.find((m) => m.id === 'claude').trust.region === 'USA')

  // Utlevert samlet
  const alle = await jsonAv('/api/utlevert')
  ok('GET /api/utlevert uten id: alle linjer, total, nyeste først', alle.total === 3 && alle.utlevert.length === 3 && alle.utlevert[0].svar === r2.svar && alle.utlevert[1].svar === r1.svar && alle.utlevert[2].tool === 'get', JSON.stringify(alle.utlevert.map((u) => [u.mottaker, u.svar])))
  ok('GET /api/utlevert: saker[] med navn og prosjekt fra lageret, nivå per sak', alle.utlevert[1].saker.length === 2 && alle.utlevert[1].saker[0].name === 'Notat om lageret' && alle.utlevert[1].saker[0].level === 'M' && alle.utlevert[1].saker[0].project === 'Testprosjekt' && alle.utlevert[1].saker[1].name === 'Kort sak' && alle.utlevert[1].saker[1].level === 'S', JSON.stringify(alle.utlevert[1].saker))
  ok('GET /api/utlevert: MCP-linja (id/level) normalisert til saker[] med navn, mottaker = tool', alle.utlevert[2].saker.length === 1 && alle.utlevert[2].saker[0].name === 'Notat om lageret' && alle.utlevert[2].saker[0].level === 'S' && alle.utlevert[2].mottaker === 'get')
  ok('GET /api/utlevert: aldri innhold eller originaler', !JSON.stringify(alle).includes(PERSON) && !JSON.stringify(alle).includes(EPOST) && !JSON.stringify(alle).includes('Mer tekst') && !JSON.stringify(alle).includes('content'))
  const s1 = await jsonAv('/api/utlevert?limit=1')
  ok('GET /api/utlevert?limit=1: én linje, total 3', s1.utlevert.length === 1 && s1.total === 3 && s1.limit === 1 && s1.offset === 0 && s1.utlevert[0].svar === r2.svar)
  const s2 = await jsonAv('/api/utlevert?limit=1&offset=1')
  ok('GET /api/utlevert?limit=1&offset=1: den nest nyeste', s2.utlevert.length === 1 && s2.offset === 1 && s2.utlevert[0].svar === r1.svar)
  ok('GET /api/utlevert?mottaker=test: bare motorens to', (await jsonAv('/api/utlevert?mottaker=test')).total === 2)
  ok('GET /api/utlevert?mottaker=get: bare MCP-linja', (await jsonAv('/api/utlevert?mottaker=get')).total === 1)
  ok('GET /api/utlevert?dager=1: de to fra i dag; dager=7: alle tre', (await jsonAv('/api/utlevert?dager=1')).total === 2 && (await jsonAv('/api/utlevert?dager=7')).total === 3)
  ok('GET /api/utlevert?mottaker=claude: tom — ingenting har gått til Claude', (await jsonAv('/api/utlevert?mottaker=claude')).total === 0)
  ok('GET /api/utlevert?id= virker som før (skive 4)', (await jsonAv(`/api/utlevert?id=${a1.id}`)).utlevert.length === 2)

  // CSV
  const csv = await hent('/api/utlevert.csv')
  const linjer = csv.tekst.replace(/^﻿/, '').split('\r\n').filter(Boolean)
  ok('GET /api/utlevert.csv → text/csv, nedlasting med filnavn, BOM for Excel', csv.status === 200 && /text\/csv/.test(csv.type) && /attachment; filename="tua-utlevert-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.disp) && csv.tekst.startsWith('﻿'), `${csv.type} · ${csv.disp}`)
  ok('CSV: header med semikolon og én rad per sending', linjer.length === 4 && linjer[0].startsWith('når;mottaker;endepunkt;modell;klient;saker;nivåer;skjermet;') && linjer.slice(1).every((l) => l.split(';').length === linjer[0].split(';').length), linjer[0])
  ok('CSV: sakene som «navn (nivå)», nivåer, tokens og id-er — aldri innhold', linjer[2].includes('Notat om lageret (M) | Kort sak (S)') && linjer[2].includes(';M/S;') && linjer[2].includes(r1.svar) && !csv.tekst.includes(PERSON) && !csv.tekst.includes(EPOST) && !csv.tekst.includes('Mer tekst'), linjer[2])
  ok('CSV: filteret følger med (mottaker=get → én rad)', (await hent('/api/utlevert.csv?mottaker=get')).tekst.replace(/^﻿/, '').split('\r\n').filter(Boolean).length === 2)

  // Keychain under testprefikset — aldri en ekte nøkkel, aldri claude (så Claude-raden forblir «ikke satt»)
  if (process.platform === 'darwin') {
    const TESTNØKKEL = 'tua-testnokkel-ikke-ekte-0123456789'
    const før = (await jsonAv('/api/settings')).ai.find((p) => p.id === 'mistral').satt
    const p1 = await send('POST', '/api/keychain', { provider: 'mistral', key: TESTNØKKEL })
    ok('POST /api/keychain (testprefiks, mistral): satt', p1.status === 200 && JSON.parse(p1.tekst).satt === true && !før, p1.tekst)
    ok('GET /api/settings etterpå: mistral satt, Claude fortsatt ikke satt', (await jsonAv('/api/settings')).ai.find((p) => p.id === 'mistral').satt === true && (await jsonAv('/api/mottakere')).mottakere.find((m) => m.id === 'claude').nøkkel === 'ikke satt')
    ok('nøkkelverdien står aldri i svar fra broen', !JSON.stringify(await jsonAv('/api/settings')).includes(TESTNØKKEL) && !JSON.stringify(await jsonAv('/api/mottakere')).includes(TESTNØKKEL))
    const d1 = await send('DELETE', '/api/keychain', { provider: 'mistral' })
    ok('DELETE /api/keychain: fjernet', d1.status === 200 && JSON.parse(d1.tekst).satt === false && !hasKey('mistral'))
    ok('POST /api/keychain med ugyldig nøkkel → 400', (await send('POST', '/api/keychain', { provider: 'mistral', key: 'kort' })).status === 400)
    ok('POST /api/keychain for ukjent leverandør → 400', (await send('POST', '/api/keychain', { provider: 'finnes-ikke', key: TESTNØKKEL })).status === 400)
  }
  // skive 4: knappene «Gamle tråder → samtaler» og «Gjentatte kjøringer» — SSE, dry-run først, så skriv
  {
    const sse = async (p, body) => { const r = await hent(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const ev = []; for (const b of r.tekst.split('\n\n')) { const e = b.match(/^event: (.+)$/m)?.[1], d = b.match(/^data: (.+)$/m)?.[1]; if (e && d) ev.push([e, JSON.parse(d)]) } return { status: r.status, ev, slutt: ev.find((x) => x[0] === 'slutt')?.[1] } }
    const før = load().length
    const t1 = await sse('/api/samtaler/traader', { dryRun: true })
    ok('POST /api/samtaler/traader {dryRun}: SSE start · rad · slutt — 1 gammel tråd med tekst, ingenting skrevet', t1.status === 200 && t1.ev[0][0] === 'start' && t1.ev[0][1].antall === 1 && t1.ev.some((x) => x[0] === 'rad' && /Testprosjekt \/ «Hva er fristen\?»  1 spørsmål · 2 saker/.test(x[1].tekst)) && t1.slutt.antall === 1 && t1.slutt.laget === 0 && t1.slutt.dryRun === true && load().length === før, JSON.stringify(t1.slutt))
    const t2 = await sse('/api/samtaler/traader', { dryRun: false })
    const S2 = load().find((a) => a.kind === 'samtale' && a.source === 'Tua' && a.name === 'Hva er fristen?')
    ok('POST /api/samtaler/traader {dryRun: false}: samtale-sak laget (kilde Tua), prompt og svar peker på den, filer skrevet', t2.slutt.laget === 1 && t2.slutt.filer >= 1 && !!S2 && load().find((a) => a.id === gpId).derivedFrom.some((d) => d.id === S2.id) && load().length === før + 1, JSON.stringify(t2.slutt))
    ok('POST /api/samtaler/traader igjen: 0 gamle tråder', (await sse('/api/samtaler/traader', { dryRun: true })).slutt.antall === 0)
    const g1 = await sse('/api/samtaler/gjentatt', { dryRun: true })
    ok('POST /api/samtaler/gjentatt {dryRun}: 1 gruppe, 2 nye ville fått gjentatt, rad med «3 kjøringer · Cowork», ingenting skrevet', g1.slutt.grupper === 1 && g1.slutt.nye === 2 && g1.slutt.merket === 0 && g1.ev.some((x) => x[0] === 'rad' && /Skigaarden \/ «Du lager min daglige morgenbriefing\.»  3 kjøringer · Cowork/.test(x[1].tekst)) && load().filter((a) => a.gjentatt === true).length === 0, JSON.stringify(g1.slutt))
    const g2 = await sse('/api/samtaler/gjentatt', { dryRun: false })
    const merket = load().filter((a) => a.gjentatt === true)
    ok('POST /api/samtaler/gjentatt {dryRun: false}: de to nyeste merket gjentatt: true i fila, den eldste ikke', g2.slutt.merket === 2 && merket.length === 2 && !merket.some((a) => a.id === cw[0].id) && /gjentatt: true/.test(fs.readFileSync(fileOf(load().find((a) => a.id === cw[1].id)), 'utf8')), JSON.stringify(g2.slutt))
    ok('POST /api/samtaler/gjentatt igjen: 0 nye, 2 alt merket', (await sse('/api/samtaler/gjentatt', { dryRun: true })).slutt.nye === 0 && (await sse('/api/samtaler/gjentatt', { dryRun: true })).slutt.alt === 2)
  }
} finally { bro.kill(); if (process.platform === 'darwin') deleteKey('mistral') }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
