#!/usr/bin/env node
// test-spor.mjs — friksjonsrunde 1 «Spør» (bruksdag 1, 24.10.2026) mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte kall til en modell.
//
//   TUA_FILES_ROOT=/tmp/tua-test-spor/arkiv TUA_DATA_DIR=/tmp/tua-test-spor/data node server/test-spor.mjs
//
// Sjekker (friksjon 6, 7/3, 8 og 4 på serversiden):
//   prosjekt KREVES i POST /api/spor (400 uten; motoren bruker det eksplisitte valget foran kildenes prosjekt) · «nytt prosjekt …» = POST /api/prosjekter
//   lager mappa i arkivet og GET /api/prosjekter tar den med før den har saker · spor inn i det nye prosjektet: prompt- og svar-sak ligger i mappa,
//   samtale = spørsmålets første linje · «Kjør igjen» på en eldre prompt-sak: prompten står, svaret lander i det valgte prosjektet · flere mottakere
//   (test + test2) → to svar-saker i valgt prosjekt, forskjeller og konklusjon også der · «Stopp» (POST /api/spor/stopp {kjøring}) midt i strømmen →
//   event ferdig {avbrutt}, svar-sak med taggen avbrutt, Utlevert-linje med avbrutt: true, SSE-rekkefølgen ellers uendret (skjermet → del… → ferdig) ·
//   stopp FØR noe kom → event feil {avbrutt}, ingen svar-sak · motoren direkte: spor() med signal avbrutt → avbrutt svar · GET /api/sak gir teksten per nivå.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '2'
process.env.TUA_VURDERER = 'test'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR
if (!ROOT || !DATA || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true })

const { load, save, upsert, fileOf } = await import('./store.js')
const { spor, MotorFeil } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const UTLEVERT = () => fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

// ── testarkiv: to prosjekter ───────────────────────────────────────────────
const PERSON = 'Ylva Brekkestad', EPOST = 'ylva@example.no'
const atoms = []
const a1 = upsert(atoms, { content: `# Anke\n\n${PERSON} (${EPOST}) mener vedtaket bygger på feil faktum. Fristen er 14 dager. ` + 'Mer om anken. '.repeat(150), name: 'Anke-notat', project: 'Energima', convo: 'energima anke', short: 'Notat om anken; fristen er 14 dager.', by: 'menneske', tags: ['anke'] }).atom
const a2 = upsert(atoms, { content: 'Oppgjøret: kravet er 120 000 kr, motkravet 30 000 kr.', name: 'Oppgjør-status', project: 'Oppgjør Skado', convo: 'oppgjør', short: 'Status for oppgjøret.', by: 'menneske' }).atom
save(atoms)
ok('testarkiv skrevet (Energima, Oppgjør Skado)', fs.existsSync(path.join(ROOT, 'Energima')) && fs.existsSync(path.join(ROOT, 'Oppgjør Skado')), ROOT)
const iMappe = (a, mappe) => fileOf(a).startsWith(path.join(ROOT, mappe) + path.sep)

// ── 1) motoren: prosjektet er det eksplisitte valget; signal avbrutt midt i strømmen → avbrutt svar ──────────────────────
{
  const hendelser = []
  const r = await spor({ melding: 'Hva er fristen?\nAndre linje.', saker: [{ id: a1.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Oppgjør Skado', på: (ev, d) => hendelser.push([ev, d]) })
  const all = load()
  const p = all.find((a) => a.id === r.prompt), s = all.find((a) => a.id === r.svar)
  ok('spor: eksplisitt prosjekt vinner over kildens prosjekt (kilde i Energima, valgt Oppgjør Skado)', p?.project === 'Oppgjør Skado' && s?.project === 'Oppgjør Skado' && iMappe(p, 'Oppgjør Skado') && iMappe(s, 'Oppgjør Skado'), `${p?.project} / ${s?.project}`)
  ok('spor: samtale = spørsmålets første linje', p?.convo === 'Hva er fristen?' && s?.convo === 'Hva er fristen?', p?.convo)
  ok('spor: SSE-rekkefølgen uendret (skjermet → del… → ferdig), ferdig uten avbrutt', hendelser[0][0] === 'skjermet' && hendelser.at(-1)[0] === 'ferdig' && !hendelser.at(-1)[1].avbrutt && hendelser.some((h) => h[0] === 'del'), hendelser.map((h) => h[0]).join(' '))
  // «Kjør igjen» på den prompt-saken med et annet valgt prosjekt: prompten står der den er, svaret lander i det valgte
  const r2 = await spor({ melding: 'Hva er fristen?\nAndre linje.', saker: [], mottaker: 'test', prosjekt: 'Energima', prompt: p.id })
  const all2 = load()
  ok('kjør igjen med annet prosjekt: samme prompt-sak (står i Oppgjør Skado), svaret i det valgte (Energima)', r2.prompt === p.id && all2.find((a) => a.id === p.id).project === 'Oppgjør Skado' && all2.find((a) => a.id === r2.svar).project === 'Energima' && all2.find((a) => a.id === p.id).ga.length === 2)
  // stopp midt i strømmen (motoren direkte): avbryt ved første del
  const ctl = new AbortController(), hs = []
  const lang = 'Si noe langt. ' + 'Mange ord her. '.repeat(400)
  const r3 = await spor({ melding: lang, saker: [{ id: a1.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Energima', signal: ctl.signal, på: (ev, d) => { hs.push([ev, d]); if (ev === 'del' && hs.filter((h) => h[0] === 'del').length === 2) ctl.abort() } })
  const s3 = load().find((a) => a.id === r3.svar)
  ok('spor med signal avbrutt midt i strømmen: ferdig {avbrutt: true}, det som kom er lagret', r3.avbrutt === true && s3?.kind === 'svar' && s3.tags.includes('avbrutt') && s3.name.startsWith('Avbrutt svar') && s3.content.length > 0 && s3.content.length < lang.length, `${s3?.content.length} tegn`)
  ok('avbrutt svar: bygget_av → prompten og kilden, Utlevert-linje med avbrutt: true og tokens ca.', s3.derivedFrom[0].id === r3.prompt && s3.derivedFrom.some((d) => d.id === a1.id && d.level === 'M') && UTLEVERT().at(-1).avbrutt === true && UTLEVERT().at(-1).svar === s3.id && typeof UTLEVERT().at(-1).tokens.ca === 'number', JSON.stringify(UTLEVERT().at(-1).tokens))
  ok('avbrutt svar: SSE-rekkefølgen uendret (skjermet → del → del → ferdig)', hs.map((h) => h[0]).join(' ') === 'skjermet del del ferdig', hs.map((h) => h[0]).join(' '))
  // stopp før noe kom: feilen kastes, ingen svar-sak
  const ctl2 = new AbortController(); ctl2.abort()
  let e = null; const før = load().length
  try { await spor({ melding: 'Hei', saker: [], mottaker: 'test', prosjekt: 'Energima', signal: ctl2.signal }) } catch (x) { e = x }
  ok('spor med signal avbrutt FØR noe kom: feil kastes, bare prompt-saken lagret (V16), ingen svar-sak', e?.name === 'AbortError' && load().length === før + 1 && !load().some((a) => a.kind === 'svar' && a.name.includes('Hei')), e?.message)
  e = null
  try { await spor({ melding: 'x', saker: [], mottaker: 'test', prosjekt: 'Energima', prompt: 'a_finnes_ikke' }) } catch (x) { e = x }
  ok('spor med ukjent prompt-sak → MotorFeil (som før)', e instanceof MotorFeil)
}

// ── 2) broen ───────────────────────────────────────────────────────────────
const PORT = 5296
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const B = `http://127.0.0.1:${PORT}`
const post = async (p, body) => { const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, json: await r.json().catch(() => ({})) } }
// SSE lest bit for bit — `på(ev, d)` kalles idet hver hendelse kommer, så testen kan stoppe midt i strømmen.
async function sse(body, på = () => {}) {
  const res = await fetch(`${B}/api/spor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const ut = { status: res.status, hendelser: [] }
  if (!res.body) return ut
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = ''
  const håndter = (blokk) => { const ev = blokk.match(/^event: (.+)$/m)?.[1], data = blokk.match(/^data: (.+)$/m)?.[1]; if (ev && data) { const d = JSON.parse(data); ut.hendelser.push([ev, d]); på(ev, d) } }
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { håndter(buf.slice(0, i)); buf = buf.slice(i + 2) } }
  if (buf.trim()) håndter(buf)
  return ut
}
try {
  // prosjekt kreves
  const u = await post('/api/spor', { melding: 'Hei', mottaker: 'test' })
  ok('POST /api/spor uten prosjekt → 400 som sier at prosjekt kreves (fail closed, aldri usynlig valg)', u.status === 400 && /prosjekt kreves/.test(u.json.error), u.json.error)
  const u2 = await post('/api/spor', { melding: 'Hei', mottaker: 'test', prosjekt: '   ' })
  ok('POST /api/spor med tomt prosjekt («   ») → 400', u2.status === 400 && /prosjekt/.test(u2.json.error))
  // nytt prosjekt
  const p0 = await get('/api/prosjekter')
  ok('GET /api/prosjekter: prosjektene i arkivet (+ Innboks)', p0.json.prosjekter.includes('Energima') && p0.json.prosjekter.includes('Oppgjør Skado') && p0.json.prosjekter.includes('Innboks') && !p0.json.prosjekter.includes('Nytt prosjekt'))
  const n = await post('/api/prosjekter', { navn: '  Nytt   prosjekt ' })
  ok('POST /api/prosjekter: nytt prosjekt → mappe i arkivet (V9), navnet renset', n.status === 200 && n.json.prosjekt === 'Nytt prosjekt' && n.json.ny === true && fs.statSync(path.join(ROOT, 'Nytt prosjekt')).isDirectory(), JSON.stringify(n.json))
  ok('GET /api/prosjekter tar med den tomme mappa med en gang', (await get('/api/prosjekter')).json.prosjekter.includes('Nytt prosjekt') && n.json.prosjekter.includes('Nytt prosjekt'))
  const n2 = await post('/api/prosjekter', { navn: 'nytt PROSJEKT' })
  ok('POST /api/prosjekter: samme navn (annen skrivemåte) → fantes, ingen ny mappe', n2.json.ny === false && n2.json.prosjekt === 'Nytt prosjekt' && !fs.readdirSync(ROOT).includes('nytt PROSJEKT'), JSON.stringify(n2.json))
  for (const dårlig of ['', '../ut', 'a/b', '.skjult', 'x'.repeat(81)]) ok(`POST /api/prosjekter «${dårlig.slice(0, 12)}» → 400`, (await post('/api/prosjekter', { navn: dårlig })).status === 400)
  // spor inn i det nye prosjektet
  const r = await sse({ melding: `Hva mener ${PERSON}?\nMer tekst.`, saker: [{ id: a1.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Nytt prosjekt', kjøring: 'k1' })
  const navn = r.hendelser.map((h) => h[0])
  ok('POST /api/spor med prosjekt: skjermet → del… → ferdig (uendret rekkefølge)', r.status === 200 && navn[0] === 'skjermet' && navn.at(-1) === 'ferdig' && navn.includes('del'), navn.join(' '))
  const f = r.hendelser.at(-1)[1]
  const all = load(), pr = all.find((a) => a.id === f.prompt), sv = all.find((a) => a.id === f.svar)
  ok('prompt- og svar-saken ligger i det nye prosjektets mappe, samtale = første linje', pr?.project === 'Nytt prosjekt' && sv?.project === 'Nytt prosjekt' && iMappe(pr, 'Nytt prosjekt') && iMappe(sv, 'Nytt prosjekt') && pr.convo === `Hva mener ${PERSON}?`, `${pr?.project} · ${pr?.convo}`)
  ok('ferdig: ikke avbrutt, eksakt usage fra mottakeren', !f.avbrutt && typeof f.tokens.inn === 'number')
  ok('kjøring-id er glemt etter at sendingen er ferdig (stopp → 404)', (await post('/api/spor/stopp', { kjøring: 'k1' })).status === 404)
  // flere mottakere valgt → to svar-saker i valgt prosjekt, forskjeller og konklusjon der også
  const m = await sse({ melding: 'Sammenlikn.', saker: [{ id: a2.id, nivå: 'S' }], mottakere: ['test', 'test2'], prosjekt: 'Nytt prosjekt' })
  const mn = m.hendelser.map((h) => h[0])
  const ferdige = m.hendelser.filter((h) => h[0] === 'ferdig').map((h) => h[1])
  ok('to mottakere valgt: skjermet → del/ferdig ×2 → vurderer → forskjeller → konklusjon → slutt', mn[0] === 'skjermet' && ferdige.length === 2 && mn.includes('forskjeller') && mn.includes('konklusjon') && mn.at(-1) === 'slutt', [...new Set(mn)].join(' '))
  // runde 1 (arb. 32 §6): fremdrift mens Forskjeller vurderes — vurderer-del {steg, tegn} mellom vurderer og forskjeller, tegn stiger, aldri tekst
  const vd = m.hendelser.filter((h) => h[0] === 'vurderer-del').map((h) => h[1])
  ok('runde 1: vurderer-del strømmer mens Forskjeller vurderes (etter vurderer, før forskjeller), tegn stiger, uten tekst', vd.length > 0 && vd.every((d) => d.steg === 'forskjeller' && typeof d.tegn === 'number' && !('tekst' in d)) && vd.every((d, i) => i === 0 || d.tegn >= vd[i - 1].tegn) && mn.indexOf('vurderer') < mn.indexOf('vurderer-del') && mn.lastIndexOf('vurderer-del') < mn.indexOf('forskjeller'), `${vd.length} biter · ${vd.at(-1)?.tegn} tegn`)
  const all3 = load()
  ok('to svar-saker, forskjeller-saken og konklusjonen ligger alle i det valgte prosjektet', ferdige.every((x) => all3.find((a) => a.id === x.svar)?.project === 'Nytt prosjekt') && all3.find((a) => a.id === m.hendelser.find((h) => h[0] === 'forskjeller')[1].sak)?.project === 'Nytt prosjekt' && all3.find((a) => a.id === m.hendelser.find((h) => h[0] === 'konklusjon')[1].id)?.project === 'Nytt prosjekt')
  ok('GET /api/prosjekter: ingen dublett av prosjektet nå som det har saker', (await get('/api/prosjekter')).json.prosjekter.filter((p) => p === 'Nytt prosjekt').length === 1)
  // «Stopp» midt i strømmen via broen
  const lang = 'Skriv langt. ' + 'Mange ord. '.repeat(1500)
  let stoppSvar = null
  const st = await sse({ melding: lang, saker: [{ id: a1.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Energima', kjøring: 'k-stopp' }, async (ev) => { if (ev === 'del' && !stoppSvar) { stoppSvar = post('/api/spor/stopp', { kjøring: 'k-stopp' }) } })
  const stRes = await stoppSvar
  const stn = st.hendelser.map((h) => h[0]), stF = st.hendelser.at(-1)[1]
  ok('POST /api/spor/stopp {kjøring} → 200 {stoppet: true}', stRes?.status === 200 && stRes.json.stoppet === true, JSON.stringify(stRes?.json))
  ok('stopp midt i strømmen: skjermet → del… → ferdig {avbrutt: true} med svar-id — rekkefølgen uendret', stn[0] === 'skjermet' && stn.at(-1) === 'ferdig' && stF.avbrutt === true && /^a_/.test(stF.svar) && !stn.includes('feil'), stn.slice(0, 2).join(' ') + ' … ' + stn.at(-1))
  const avb = load().find((a) => a.id === stF.svar)
  ok('det som kom er lagret som svar merket avbrutt (tagg, navn, ingress), kortere enn hele ekkoet', avb?.tags.includes('avbrutt') && avb.name.startsWith('Avbrutt svar') && /Avbrutt svar/.test(avb.levels?.S?.text || '') && avb.content.length < lang.length && avb.project === 'Energima', `${avb?.content.length} tegn`)
  ok('Utlevert-linja for det avbrutte svaret har avbrutt: true', UTLEVERT().find((u) => u.svar === stF.svar)?.avbrutt === true)
  ok('POST /api/spor/stopp med ukjent kjøring → 404', (await post('/api/spor/stopp', { kjøring: 'finnes-ikke' })).status === 404)
  // GET /api/sak
  const sak = await get(`/api/sak?id=${encodeURIComponent(a1.id)}`)
  ok('GET /api/sak: teksten per nivå (S = ingressen, L = alt), ord/tegn, prosjekt, kind', sak.status === 200 && sak.json.nivåer.S.tekst === 'Notat om anken; fristen er 14 dager.' && sak.json.nivåer.L.tekst.includes(PERSON) && sak.json.nivåer.M.fallback && sak.json.ord.L > sak.json.ord.S && sak.json.project === 'Energima' && sak.json.kind === 'capture', JSON.stringify({ S: sak.json.nivåer?.S, fallbackM: sak.json.nivåer?.M?.fallback }))
  ok('GET /api/sak med ukjent id → 404', (await get('/api/sak?id=a_finnes_ikke')).status === 404)
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
