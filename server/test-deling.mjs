#!/usr/bin/env node
// test-deling.mjs — runde 3b: kollega som første menneskelige mottaker (arbeidsstykke 32, planen videre §4 3b; Erik 24.10.2026: kollegaer først).
// Mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall, ALDRI en ekte nøkkel.
//
//   TUA_FILES_ROOT=/tmp/tua-test-deling/arkiv TUA_DATA_DIR=/tmp/tua-test-deling/data TUA_HOME=/tmp/tua-test-deling/hjem node server/test-deling.mjs
//
// Sjekker: en person opprettes ved første deling (og gjenbrukes ved neste, på navn og e-post) · forhåndsvis oppretter ingenting · sirkel foreslås ved
// tredje felles deling, kan få navn og brukes som mottaker · delingslenka serveres av broen uten innlogging med låste rader på riktig nivå og uten
// originaler · Vault → S med linje · HTML-fila er frittstående (ingen eksterne referanser) og lastes ned · «Be om hele» logges som forespørsel ·
// trekk tilbake stopper lenka (410) og logges · samme personer + samme saker gir samme lenke · Utlevert per person med mottakerNavn ·
// GET/POST /api/mottakere-personer · tua_share over MCP gir lenke, nedlastingslenke og kopierbar tekst · kortet viser delingen.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const { load, save, upsert, deliveries } = await import('./store.js')
const { del, trekkDeling, beOmHele, mottakersideFor } = await import('./motor.js')
const deling = await import('./deling.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${String(info).slice(0, 220)}` : ''}`); if (!cond) feil++ }

// ── testarkiv ──────────────────────────────────────────────────────────────
const PERSON = 'Kari Nordmann', EPOST = 'kari.nordmann@example.no', ADRESSE = 'Storgata 12, 0184 Oslo'
const atoms = []
const notat = upsert(atoms, { content: `# Forhandlingsnotat\n\n${PERSON} (${EPOST}) foreslo nytt lager i ${ADRESSE}. Budsjett 45 000 kr.\n\n## Punkter\n- Frist 1. desember\n- **Ansvar:** Marius Holt\n\n` + 'Lang brødtekst om lageret. '.repeat(120), name: 'Forhandlingsnotat lager', project: 'Fjellstua', convo: `Møte med ${PERSON}`, short: `Nytt lager foreslått av ${PERSON}; budsjett 45 000 kr.`, medium: `Sammendrag: ${PERSON} vil flytte lageret til ${ADRESSE}. Budsjett 45 000 kr, frist 1. desember.`, by: 'menneske' }).atom
const vault = upsert(atoms, { content: 'Hemmelige betingelser i avtalen med Per Olsen.', name: 'Vault-avtale', project: 'Fjellstua', short: 'En hemmelig avtale.', by: 'menneske', tags: ['vault'] }).atom
const kortSak = upsert(atoms, { content: 'Kort sak om lagerdrift uten personopplysninger.', name: 'Kort sak', project: 'Fjellstua', short: 'Kort om lagerdrift.', by: 'menneske' }).atom
save(atoms)
const ingenOriginaler = (t) => !t.includes(PERSON) && !t.includes(EPOST) && !t.includes('Storgata') && !t.includes('45 000') && !t.includes('Per Olsen')
const utlevert = () => deliveries(null, 1000)
const BASE = 'http://127.0.0.1:5299'

// ── 1) forhåndsvis oppretter ingenting ──────────────────────────────────────
{
  const r = del(atoms, { ids: [notat.id], til: 'Anna Berg', forhåndsvis: true, base: BASE })
  ok('forhåndsvis: setningen med S som standard og hva som skjermes', r.forhåndsvis && /Anna Berg får S av 1 sak/.test(r.setning), r.setning)
  ok('forhåndsvis: Anna er merket ny, men ikke opprettet; ingen Utlevert-linje', r.mottakere[0].ny && r.mottakere[0].id === null && deling.lesMottakere().personer.length === 0 && utlevert().length === 0)
}
// ── 2) første deling: person opprettes, lenke, Utlevert per person ──────────
const r1 = del(atoms, { ids: [notat.id, vault.id], til: 'Anna Berg', nivå: 'M', klient: 'test', base: BASE })
const anna = deling.lesMottakere().personer.find((p) => p.navn === 'Anna Berg')
ok('person opprettes ved første deling (merke kollega, 1 deling)', anna && anna.merke === 'kollega' && anna.delinger === 1 && r1.mottakere[0].ny && r1.mottakere[0].id === anna.id, JSON.stringify(anna))
ok('delingen har token (base64url ≥ 16 tegn) og lenker tua://del, http …/del/<token> og …/del/<token>.html', /^[A-Za-z0-9_-]{16,}$/.test(r1.token) && r1.lenker.tua === `tua://del/${r1.token}` && r1.lenke === `${BASE}/del/${r1.token}` && r1.lenker.html === `${BASE}/del/${r1.token}.html`, r1.lenke)
ok('Vault → S med linje (fail closed), notatet på M', r1.kilder.find((k) => k.id === vault.id).level === 'S' && r1.kilder.find((k) => k.id === notat.id).level === 'M' && r1.linjer.length === 1 && /Vault-merket/.test(r1.linjer[0]), r1.linjer.join(' '))
ok('kopierbar tekst er skjermet (plassholdere, ingen originaler) og har lenka', ingenOriginaler(r1.kopierbar) && /\[Person [A-Z]\]/.test(r1.kopierbar) && r1.kopierbar.includes(r1.lenke))
const sak1 = load().find((x) => x.id === r1.id)
ok('delingssaken: leveranse med tagg deling, bygget_av med nivå, lenkene på saken, skjermet innhold', sak1 && sak1.kind === 'leveranse' && sak1.tags.includes('deling') && sak1.derivedFrom.find((d) => d.id === notat.id).level === 'M' && (sak1.links || []).some((l) => l.href === r1.lenke) && (sak1.links || []).some((l) => l.href === r1.lenker.tua) && ingenOriginaler(sak1.content), JSON.stringify(sak1?.links))
{
  const u = utlevert()
  ok('én Utlevert-linje for Anna: mottaker = person-id, mottakerNavn, personer[], token, deling, endpoint «deling (lenke)», saker med nivå', u.length === 1 && u[0].mottaker === anna.id && u[0].mottakerNavn === 'Anna Berg' && u[0].personer?.[0]?.id === anna.id && u[0].token === r1.token && u[0].deling === r1.id && u[0].endpoint === 'deling (lenke)' && u[0].saker.length === 2 && u[0].saker.find((s) => s.id === vault.id).level === 'S', JSON.stringify(u[0]))
  ok('Utlevert-linja har ingen originaler', ingenOriginaler(JSON.stringify(u[0])))
}
const d1 = deling.hentDeling(r1.token)
ok('delingen i .tua/delinger.json: til Anna, radene skjermet på riktig nivå, av = eier, ikke trukket', d1 && d1.til[0].id === anna.id && d1.rader.length === 2 && d1.rader.find((r) => r.id === notat.id).level === 'M' && d1.rader.every((r) => ingenOriginaler(r.tekst) && ingenOriginaler(r.name)) && !d1.trukket && Array.isArray(d1.forespørsler), JSON.stringify(d1?.rader.map((r) => [r.name, r.level])))
ok('.tua/mottakere.json og .tua/delinger.json ligger i arkivets .tua, ikke i en sak', fs.existsSync(path.join(ROOT, '.tua', 'mottakere.json')) && fs.existsSync(path.join(ROOT, '.tua', 'delinger.json')) && !load().some((a) => (a.content || '').includes(r1.token) && a.id !== r1.id))

// ── 3) samme person igjen, på e-post og «Navn <epost>» ─────────────────────
{
  const r = del(atoms, { ids: [kortSak.id], til: 'anna.berg@firma.no', base: BASE })
  ok('ny e-post på et nytt navn → ny person (Anna Berg fra e-posten er en annen enn «Anna Berg» uten e-post? nei: navnet matcher)', r.mottakere.length === 1, JSON.stringify(r.mottakere))
  const m = deling.lesMottakere()
  ok('«anna.berg@firma.no» matchet Anna Berg på navn og ga henne e-posten', m.personer.length === 1 && m.personer[0].epost === 'anna.berg@firma.no' && !r.mottakere[0].ny, JSON.stringify(m.personer))
  const r2 = del(atoms, { ids: [kortSak.id], til: 'Anna B. <anna.berg@firma.no>', base: BASE })
  ok('e-posten gjenkjenner personen selv med annet navn; samme saker på samme nivå gir samme lenke (ikke trukket)', !r2.mottakere[0].ny && r2.mottakere[0].id === anna.id && r2.token === r.token && r2.status === 'uendret', `${r.token} / ${r2.token} / ${r2.status}`)
  ok('S er standard når ingen valgte nivå (V11)', r2.nivå === 'S')
}
// ── 4) sirkel foreslås ved tredje felles deling ────────────────────────────
let forslag = null
for (let i = 0; i < 3; i++) {
  const r = del(atoms, { ids: [i === 0 ? notat.id : i === 1 ? kortSak.id : vault.id], til: ['Anna Berg', 'Bjarte Lie'], base: BASE })
  if (i < 2) ok(`felles deling ${i + 1}: ingen sirkel ennå`, !r.sirkelForslag, JSON.stringify(r.sirkelForslag))
  else { forslag = r.sirkelForslag; ok('felles deling 3: Tua foreslår sirkelen «Anna Berg og Bjarte Lie»', forslag && forslag.forslag === 'Anna Berg og Bjarte Lie' && forslag.antall === 3 && forslag.medlemmer.length === 2 && forslag.navn === null, JSON.stringify(forslag)) }
  if (i === 0) ok('Bjarte ble opprettet ved den første felles delingen', r.mottakere.find((p) => p.navn === 'Bjarte Lie')?.ny)
}
ok('«Anna og Bjarte» i én streng løses til begge', del(atoms, { ids: [kortSak.id], til: 'Anna Berg og Bjarte Lie', forhåndsvis: true, base: BASE }).mottakere.length === 2)
ok('forslaget står som foreslått i mottakere.json til Erik svarer', deling.lesMottakere().sirkler.some((s) => s.id === forslag?.id && s.foreslått))
const sirkel = deling.navngiSirkel(forslag.id, 'Prosjektgruppa')
ok('sirkelen får navn («Prosjektgruppa») og er ikke lenger et forslag', sirkel.navn === 'Prosjektgruppa' && !sirkel.foreslått)
{
  const r = del(atoms, { ids: [kortSak.id], til: 'Prosjektgruppa', forhåndsvis: true, base: BASE })
  ok('sirkelnavnet som mottaker gir medlemmene', r.mottakere.length === 2 && r.sirkler[0] === 'Prosjektgruppa' && /Anna Berg og Bjarte Lie får S/.test(r.setning), r.setning)
  const r4 = del(atoms, { ids: [notat.id], til: ['Bjarte Lie', 'Anna Berg'], forhåndsvis: true, base: BASE })
  ok('ingen nytt forslag når sirkelen finnes (samme medlemmer)', !r4.sirkelForslag)
}
{
  // avvist forslag: Christine + Dag tre ganger → forslag → avvis → teller nullstilles
  for (let i = 0; i < 3; i++) del(atoms, { ids: [kortSak.id], til: ['Christine Haug', 'Dag Moe'], base: BASE })
  const f = deling.lesMottakere().sirkler.find((s) => s.foreslått)
  ok('et annet par får sitt eget forslag', f && f.forslag === 'Christine Haug og Dag Moe')
  deling.avvisSirkel(f.id)
  const r = del(atoms, { ids: [vault.id], til: ['Christine Haug', 'Dag Moe'], base: BASE })
  ok('avvist: forslaget er borte og kommer ikke igjen ved neste deling', !deling.lesMottakere().sirkler.some((s) => s.foreslått) && !r.sirkelForslag)
}
// ── 5) Be om hele og trekk tilbake (motoren) ───────────────────────────────
{
  const f = beOmHele(r1.token, { saker: [notat.id] })
  const u = utlevert().at(-1)
  ok('«Be om hele» logges som forespørsel i Utlevert (hendelse, saken, ønsket L, ingen ord/tokens)', f.rader.length === 1 && u.hendelse === 'forespørsel' && u.saker[0].id === notat.id && u.saker[0].ønsket === 'L' && u.ord === 0 && u.mottakerNavn === 'Anna Berg' && u.token === r1.token, JSON.stringify(u))
  ok('forespørselen står på delingen', deling.hentDeling(r1.token).forespørsler.length === 1)
  const side = mottakersideFor(r1.token, { base: BASE })
  ok('mottakersiden (200): Til Anna Berg, to låste rader, nivåene M og S, «Be om hele», ingen originaler, linja om modeller', side.kode === 200 && /Til Anna Berg/.test(side.html) && (side.html.match(/class="linje"/g) || []).length === 2 && /M · sammendraget/.test(side.html) && /S · ingressen/.test(side.html) && (side.html.match(/Be om hele/g) || []).length >= 2 && ingenOriginaler(side.html) && /sendt til noen modell/.test(side.html), side.html.length)
  ok('mottakersiden: plassholderne står som skjermet, Vault-linja gjelder ikke mottakeren (bare S-raden)', /\[Person [A-Z]\]/.test(side.html) && !/Vault-merket/.test(side.html))
  const lSide = mottakersideFor(del(atoms, { ids: [notat.id], til: 'Anna Berg', nivå: 'L', base: BASE }).token, { base: BASE })
  ok('mottakersiden på L: markdown gjengitt (liste, fet), «Hele saken er delt», ingen originaler', /<li>Frist 1\. desember<\/li>/.test(lSide.html) && /<b>Ansvar:<\/b> <span class="plass"[^>]*>\[Person [A-Z]\]<\/span>/.test(lSide.html) && /Hele saken er delt/.test(lSide.html) && ingenOriginaler(lSide.html), lSide.html.match(/<li>[^<]*<\/li>/g)?.join(' '))
  const t = trekkDeling(r1.token, { klient: 'test' })
  ok('trekk tilbake: trukket-tidspunkt satt, logget i Utlevert som hendelse trukket', t.trukket > 0 && utlevert().at(-1).hendelse === 'trukket' && utlevert().at(-1).token === r1.token)
  ok('etter trekk: siden gir 410 og innholdet er borte', mottakersideFor(r1.token).kode === 410 && !/Forhandlingsnotat/.test(mottakersideFor(r1.token).html) && /trukket tilbake/.test(mottakersideFor(r1.token).html))
  ok('ukjent token gir 404', mottakersideFor('finnes-ikke-xxxxxxxxxxxx').kode === 404)
  let kastet = false; try { beOmHele(r1.token) } catch { kastet = true }
  ok('«Be om hele» på en trukket deling avvises', kastet)
  const r = del(atoms, { ids: [notat.id, vault.id], til: 'Anna Berg', nivå: 'M', base: BASE })
  ok('samme deling etter trekk gir et NYTT token (den gamle lenka er død)', r.token !== r1.token && mottakersideFor(r.token).kode === 200)
}
// ── 6) broen: mottakersiden uten innlogging, HTML-fila, Be om hele, API-ene ──
const PORT = 5299
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const get = async (p, opts) => { const r = await fetch(`${BASE}${p}`, opts); const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() } }
const post = (p, b, h = {}) => get(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) })
try {
  // deling fra appen: POST /api/del
  const fv = await post('/api/del', { ids: [notat.id], til: ['Eli Vik'], forhåndsvis: true })
  ok('POST /api/del forhåndsvis: setning, mottaker ny, gjengivelse skjermet, ingenting opprettet', fv.status === 200 && fv.body.forhåndsvis && /Eli Vik får S av 1 sak/.test(fv.body.setning) && fv.body.mottakere[0].ny && ingenOriginaler(fv.body.gjengivelse) && !deling.lesMottakere().personer.some((p) => p.navn === 'Eli Vik'), fv.body.setning)
  const d = await post('/api/del', { ids: [notat.id], til: ['Eli Vik'] })
  ok('POST /api/del: delingen laget fra appen — lenke med broens egen port, token, kopierbar, mottaker opprettet', d.status === 200 && d.body.lenke === `${BASE}/del/${d.body.token}` && d.body.kopierbar && deling.lesMottakere().personer.some((p) => p.navn === 'Eli Vik'), d.body.lenke)
  const tok = d.body.token
  // mottakersiden er åpen for mottakeren
  const side = await get(`/del/${tok}`)
  ok('GET /del/<token> uten innlogging: 200, HTML med Til Eli Vik, én låst rad på S, ingen originaler, no-store', side.status === 200 && /Til Eli Vik/.test(side.body) && (side.body.match(/class="linje"/g) || []).length === 1 && /S · ingressen/.test(side.body) && ingenOriginaler(side.body) && side.headers.get('cache-control') === 'no-store', side.status)
  const fil = await get(`/del/${tok}.html`)
  ok('GET /del/<token>.html: attachment med filnavn, samme innhold, merket «lagret som fil»', fil.status === 200 && /attachment; filename="Tua-deling-Eli-Vik\.html"/.test(fil.headers.get('content-disposition') || '') && /Til Eli Vik/.test(fil.body) && /lagret som fil/.test(fil.body), fil.headers.get('content-disposition'))
  const eksterne = [...fil.body.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => /^(https?:)?\/\//.test(u) && !u.startsWith(BASE))
  ok('HTML-fila er frittstående: ingen eksterne skript, stilark eller fonter', !/<link[^>]+stylesheet/.test(fil.body) && !/<script[^>]+src=/.test(fil.body) && eksterne.length === 0, eksterne.join(', '))
  // «Be om hele» fra siden (text/plain-kropp, som fra fila; CORS *)
  const be = await get(`/del/${tok}/be-om-hele`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ saker: [notat.id] }) })
  ok('POST /del/<token>/be-om-hele: ok, CORS * (fra den frittstående fila), logget som forespørsel', be.status === 200 && be.body.ok && be.headers.get('access-control-allow-origin') === '*' && utlevert().at(-1).hendelse === 'forespørsel' && utlevert().at(-1).mottakerNavn === 'Eli Vik', JSON.stringify(be.body))
  // /api/delinger og trekk fra appen
  const liste = await get(`/api/delinger?id=${notat.id}`)
  ok('GET /api/delinger?id: delingene av saken, nyeste først, med til, nivå, forespørsler, lenker — aldri innhold', liste.status === 200 && liste.body.delinger.length >= 2 && liste.body.delinger[0].token === tok && liste.body.delinger[0].forespørsler === 1 && liste.body.delinger[0].til[0].navn === 'Eli Vik' && !JSON.stringify(liste.body).includes('Lang brødtekst'), liste.body.delinger.length)
  const tr = await post('/api/del/trekk', { token: tok })
  ok('POST /api/del/trekk: trukket; lenka gir 410; fila gir 410', tr.status === 200 && tr.body.ok && (await get(`/del/${tok}`)).status === 410 && (await get(`/del/${tok}.html`)).status === 410)
  ok('GET /del/ukjent: 404 uten innhold', (await get('/del/xxxxxxxxxxxxxxxxxxxxxx')).status === 404)
  // mottakere-personer
  const mp = await get('/api/mottakere-personer')
  const eli = mp.body.personer.find((p) => p.navn === 'Eli Vik')
  ok('GET /api/mottakere-personer: personer med «har fått» (saker, nivå, når), forespørsler og aktive/trukne; sirkler; eier; merker', mp.status === 200 && eli && eli.fått.length === 1 && eli.fått[0].name === 'Forhandlingsnotat lager' && eli.fått[0].level === 'S' && eli.forespørsler === 1 && eli.trukne === 1 && eli.aktive === 0 && mp.body.sirkler.some((s) => s.navn === 'Prosjektgruppa') && mp.body.merker.includes('relasjon') && 'eier' in mp.body, JSON.stringify(eli))
  ok('«har fått» har aldri innhold', !JSON.stringify(mp.body).includes('Lang brødtekst'))
  const e = await post('/api/mottakere-personer', { eier: { navn: 'Erik Teigen', epost: 'erik@example.no' } })
  ok('POST eier: den som deler lagres og står på nye mottakersider med mailto', e.status === 200 && deling.eier().navn === 'Erik Teigen')
  const d2 = await post('/api/del', { ids: [kortSak.id], til: ['Eli Vik'] })
  const side2 = await get(`/del/${d2.body.token}`)
  ok('mottakersiden: «Delt av Erik Teigen» og mailto:erik@example.no med emne', /Delt av <b>Erik Teigen<\/b>/.test(side2.body) && /mailto:erik@example\.no\?subject=/.test(side2.body))
  const m2 = await post('/api/mottakere-personer', { id: eli.id, merke: 'relasjon', epost: 'eli@example.no' })
  ok('POST {id, merke, epost}: personen rettes', m2.status === 200 && m2.body.person.merke === 'relasjon' && m2.body.person.epost === 'eli@example.no')
  const ny = await post('/api/mottakere-personer', { navn: 'Fredrik Aas', epost: 'fredrik@example.no' })
  ok('POST {navn, epost}: ny person legges til uten deling', ny.status === 200 && ny.body.person.navn === 'Fredrik Aas' && deling.lesMottakere().personer.some((p) => p.navn === 'Fredrik Aas'))
  const feilet = await post('/api/del', { ids: ['finnes-ikke'], til: ['Eli Vik'] })
  ok('POST /api/del med ukjent sak: 400 med feilmelding', feilet.status === 400 && /finnes/.test(feilet.body.error))
  const ut = await get('/api/utlevert?limit=100')
  ok('GET /api/utlevert: delingslinjene har mottakerNavn og hendelse der det gjelder', ut.body.utlevert.some((u) => u.mottakerNavn === 'Eli Vik' && u.hendelse === 'forespørsel') && ut.body.utlevert.some((u) => u.mottakerNavn === 'Eli Vik' && !u.hendelse && u.saker.length === 1))
} finally { bro.kill() }

// ── 7) tua_share over MCP ───────────────────────────────────────────────────
{
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, 'server.js')], cwd: HERE, env: { ...process.env, TUA_CLIENT: 'test-deling', TUA_OPEN_DRYRUN: '1', TUA_APP_URL: BASE }, stderr: 'pipe' })
  const client = new Client({ name: 'tua-deling-test', version: '0.0.1' })
  await client.connect(transport)
  const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { r, text: (r.content || []).map((c) => c.text || '').join('\n') } }
  const fv = await call('tua_share', { ids: [notat.id], til: 'Gro Lund', forhandsvis: true })
  ok('tua_share forhåndsvis: setningen, «ny kollega», ett spørsmål', /Gro Lund får S av 1 sak/.test(fv.text) && /legges til som ny/.test(fv.text) && /— ok\?/.test(fv.text), fv.text.slice(0, 200))
  const s = await call('tua_share', { ids: [notat.id], til: 'Gro Lund <gro@example.no>' })
  const tok = (s.text.match(/\/del\/([A-Za-z0-9_-]{16,})(?:\s|$)/) || [])[1]
  ok('tua_share: lenke til mottakersiden, nedlastings-HTML, tua://-lenke, kopierbar tekst, mottaker med e-post (ny)', tok && s.text.includes(`${BASE}/del/${tok}`) && s.text.includes(`${BASE}/del/${tok}.html`) && s.text.includes(`tua://del/${tok}`) && /Kopierbar tekst til Gro Lund/.test(s.text) && /Gro Lund <gro@example\.no> \(ny\)/.test(s.text), s.text.slice(0, 300))
  ok('tua_share: delingen finnes i lageret med Gro som person', deling.hentDeling(tok)?.til[0].navn === 'Gro Lund' && deling.lesMottakere().personer.some((p) => p.epost === 'gro@example.no'))
  const flere = await call('tua_share', { ids: [kortSak.id], til: ['Gro Lund', 'Anna Berg'], forhandsvis: true })
  ok('tua_share: til som liste → begge', /Gro Lund og Anna Berg får S av 1 sak/.test(flere.text), flere.text.slice(0, 120))
  const id = (s.text.match(/atom (a_[a-z0-9_]+)/) || [])[1]
  const kort = await call('tua_card', { id })
  ok('kortet viser delingen: mottaker som person, lenke og fil', kort.r.structuredContent?.atom?.deling?.til?.[0]?.navn === 'Gro Lund' && kort.r.structuredContent.atom.deling.http === `${BASE}/del/${tok}` && /Delt med: Gro Lund/.test(kort.text), JSON.stringify(kort.r.structuredContent?.atom?.deling))
  await client.close()
}

console.log(feil ? `${feil} feil` : 'alle grønne')
process.exit(feil ? 1 : 0)
