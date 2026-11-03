#!/usr/bin/env node
// test-sidefelt.mjs — skive 4 «Rydding og Claude-døra» i arbeidsstykke 33 (V22, 28.10.2026): det lette sidefelt-endepunktet og standardmottakeren ved oppstart.
// ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall, ALDRI en ekte nøkkel (Keychain-prefikset byttes ut), ALDRI Eriks Ollama (TUA_OLLAMA_URL peker på en død port).
//
//   TUA_FILES_ROOT=/tmp/tua-test-sidefelt/arkiv TUA_DATA_DIR=/tmp/tua-test-sidefelt/data TUA_HOME=/tmp/tua-test-sidefelt/hjem node server/test-sidefelt.mjs
//
// Sjekker: GET /api/sidefelt gir bare sakene og feltene sidefeltet trenger (ingen content på vanlige saker, ingen M/L), og regler.sidefeltTre gir NØYAKTIG samme tre av dem
// som av /api/atoms · ?prosjekt= avgrenser · svaret er mye mindre enn /api/atoms · store svar går gzip med ETag, og If-None-Match gir 304 · mottakere(): Ollama-raden er
// `usikker` til Ollama har svart eller ventetida (TUA_OLLAMA_VENT) er gått — da er ingen standard; etter ventetida er den avgjort (ikke klar, ikke usikker) · GET /api/mottakere
// sender `usikker` øverst.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_OLLAMA_URL = 'http://127.0.0.1:1'   // død port: Ollama «kjører ikke» straks (connection refused)
process.env.TUA_TESTMOTTAKERE = '2'

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const { load, save, upsert, setStatus } = await import('./store.js')
const regler = await import(pathToFileURL(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'regler.js')).href)

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${String(info).replace(/\s+/g, ' ').slice(0, 200)}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 0) arbeidsstykke 35 skive 2: det ryddede sidefeltet, byttet Avis | Arbeid og «Nytt arbeid» ────────────────
{
  const rd = (id, sist = 1) => ({ id, navn: id, sist })
  const tre = [
    { navn: 'A', sist: 9, antall: 5, flere: 0, samtaler: [rd('a1', 9), rd('a2', 8)], arbeider: [{ id: 'w1', navn: 'Leie', sist: 7, antall: 2, flere: 0, samtaler: [rd('w1s1', 7), { ...rd('w1s2', 6), kjøringer: [{ id: 'k1' }, { id: 'k2' }] }] }, { id: 'w2', navn: 'Annet', sist: 5, antall: 1, flere: 0, samtaler: [rd('w2s1', 5)] }] },
    { navn: 'B', sist: 4, antall: 1, flere: 0, samtaler: [rd('b1', 4)], arbeider: [] },
    { navn: 'C', sist: 3, antall: 1, flere: 0, samtaler: [rd('c1', 3)], arbeider: [] },
  ]
  const f = regler.sidefeltFlate(tre, [rd('a1'), rd('b1'), rd('w2s1')], { prosjektNå: 'A', aktivId: 'a1' })
  ok('sidefeltFlate: prosjektet du står i først, de andre foldet for seg', f.her.navn === 'A' && f.andre.map((p) => p.navn).join() === 'B,C')
  ok('sidefeltFlate: et arbeid er lukket til du er inne i det', f.her.arbeider.every((w) => w.åpen === false))
  ok('sidefeltFlate: Sist brukt gjentar ikke det som alt vises over; det i et lukket arbeid står igjen', f.sist.map((s) => s.id).join() === 'b1,w2s1')
  ok('sidefeltFlate: arbeidet åpnes av adressen, av en samtale i det og av en kjøring i det', regler.sidefeltFlate(tre, [], { prosjektNå: 'A', aktivArbeid: 'w1' }).her.arbeider[0].åpen === true && regler.sidefeltFlate(tre, [], { prosjektNå: 'A', aktivId: 'w1s1' }).her.arbeider[0].åpen === true && regler.sidefeltFlate(tre, [], { prosjektNå: 'A', aktivId: 'k2' }).her.arbeider[0].åpen === true && regler.sidefeltFlate(tre, [], { prosjektNå: 'A', aktivId: 'k2' }).her.arbeider[1].åpen === false)
  ok('sidefeltFlate: samtalene i et åpent arbeid gjentas ikke i Sist brukt', regler.sidefeltFlate(tre, [rd('w1s1')], { prosjektNå: 'A', aktivArbeid: 'w1' }).sist.length === 0)
  ok('sidefeltFlate: uten prosjekt er alle prosjektene foldet og Sist brukt står urørt', (() => { const u = regler.sidefeltFlate(tre, [rd('a1')], {}); return u.her === null && u.andre.length === 3 && u.sist.length === 1 })())
  ok('sidefeltFlate: tomt gir tomt', (() => { const u = regler.sidefeltFlate(null, null); return u.her === null && !u.sist.length && !u.andre.length })())
  ok('arbeidMål: dit du var i Arbeid (samtale eller dokument) går først', regler.arbeidMål({ adresse: '/#les/x1', sist: ['a1'], tre }) === '/#les/x1' && regler.arbeidMål({ adresse: '/#samtale/t_ny', tre }) === '/#samtale/t_ny')
  ok('arbeidMål: en adresse i avisen teller ikke', regler.arbeidMål({ adresse: '/', sist: ['b1'], tre }) === regler.samtaleAdresse('b1'))
  ok('arbeidMål: siste brukte som finnes, også inne i et arbeid; en borte id hoppes over', regler.arbeidMål({ sist: ['borte', 'w1s1'], tre }) === regler.samtaleAdresse('w1s1'))
  ok('arbeidMål: ingen sist brukt → den nyeste samtalen; tomt arkiv → null (da startes noe nytt)', regler.arbeidMål({ tre }) === regler.samtaleAdresse('a1') && regler.arbeidMål({ tre: [] }) === null && regler.arbeidMål() === null)

  const src = (f) => fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', f), 'utf8')
  const kode = (f) => src(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const topp = kode('components/Topplinje.jsx'), forside = kode('pages/Forside.jsx'), arbeid = kode('pages/Arbeid.jsx'), felt = kode('pages/Sidefelt.jsx'), start = kode('arbeid-start.js')
  ok('Topplinje: byttet Avis | Arbeid med aria-current, + Nytt arbeid og Innstillinger, én komponent', topp.includes("fane('avis', 'Avis'") && topp.includes("fane('arbeid', 'Arbeid'") && topp.includes("aria-current={aktiv === hvem ? 'page'") && topp.includes('+ Nytt arbeid') && topp.includes('/innstillinger'))
  ok('Avis og Arbeid bruker samme topplinje, med hver sin aktive tilstand', forside.includes('<Topplinje aktiv="avis"') && arbeid.includes('<Topplinje aktiv="arbeid"'))
  ok('Avisen har ikke egen lenke til Innstillinger eller eget ordmerke ved siden av topplinja', !forside.includes('fs-innst') && !forside.includes('fs-merke'))
  ok('«Nytt arbeid» fører foreløpig til en ny samtale, uten å spørre om prosjekt', /nyttArbeid = \(prosjekt = ''\) => nySamtale\(\{ prosjekt: prosjekt \|\| UTEN_PROSJEKT \}\)/.test(start) && forside.includes('nyttArbeid(prosjekt)') && arbeid.includes('nyttArbeid(prosjektNå)'))
  ok('«Arbeid» sender ingenting: bare /api/sidefelt leses før det navigeres', /export async function tilArbeidSist[\s\S]*?\n\}/.exec(start)?.[0].match(/api\(/g)?.length === 1 && /api\('\/api\/sidefelt'\)/.test(start))
  ok('Tilbake bor i topplinja: ingen «‹ Avis» eller «‹ Finn» som egen knapp i rommet eller sidefeltet', !['pages/Samtale.jsx', 'pages/Sak.jsx', 'pages/Arbeid.jsx', 'pages/Sidefelt.jsx'].some((f) => /‹ (Avis|Finn)/.test(kode(f))))
  ok('Brukerordet er Avis: «Finn» står ikke i teksten om å gå tilbake', !/(til|i) Finn\b/.test(arbeid))
  ok('Sidefeltet: ingen «+ Ny samtale» nederst, en samtale kan fortsatt legges i et åpent arbeid', !felt.includes('+ Ny samtale') && !felt.includes('sb-bunn') && felt.includes('onNyIArbeid') && felt.includes('+ samtale') && arbeid.includes('onNyIArbeid'))
  ok('Sidefeltet: reglene kommer fra sidefeltFlate, prosjektene foldes med aria-expanded', felt.includes('sidefeltFlate(tre, sist') && felt.includes('aria-expanded={åpen}'))
  ok('Brukerordet er samtale: «økt» står ikke i topplinja eller sidefeltet', !/\bøkt/i.test(topp) && !/\bøkt/i.test(felt))
  ok('☰ bor i topplinja også i bredder der sidefeltet er skuff (600–899), ikke bare under 600', arbeid.includes('venstre={<button type="button" className="ab-skuff-knapp"') && !/\{smal && <button[^\n]*ab-skuff-knapp/.test(arbeid))
}

// ── 1) mottakere(): usikker til Ollama har svart eller ventetida er gått ──────────────────────────────────────────
{
  process.env.TUA_OLLAMA_VENT = '600000'   // ti minutter: prosessen er ung → usikker
  const motor = await import('./motor.js')
  const m1 = await motor.mottakere()
  const o1 = m1.find((m) => m.id === 'ollama')
  ok('mottakere() rett etter start: Ollama svarer ikke → raden er usikker, ikke klar, og INGEN er standard (Claude står ikke som standard et øyeblikk)', o1 && o1.usikker === true && o1.aktiv === false && m1.every((m) => !m.standard) && m1.usikker === true, JSON.stringify(m1.map((m) => [m.id, m.aktiv, m.standard, m.usikker])))
  process.env.TUA_OLLAMA_VENT = '0'        // ventetida er gått → avgjort
  const m2 = await motor.mottakere()
  const o2 = m2.find((m) => m.id === 'ollama')
  ok('mottakere() etter ventetida: Ollama er avgjort «ikke klar» (ikke usikker); ingen standard fordi Claude mangler nøkkel under testprefikset', o2 && !o2.usikker && o2.aktiv === false && m2.usikker === false && m2.every((m) => !m.standard), JSON.stringify(m2.map((m) => [m.id, m.aktiv, m.standard, m.usikker])))
  ok('ollamaAvgjort(): usant mens ventetida løper, sant etter', (process.env.TUA_OLLAMA_VENT = '600000', !motor.ollamaAvgjort()) && (process.env.TUA_OLLAMA_VENT = '0', motor.ollamaAvgjort()))
  process.env.TUA_OLLAMA_VENT = '600000'   // broen under skal starte i «usikker»
}

// ── 2) testarkiv: to prosjekter, et arbeid, Tua-samtaler (Spør-tråder), Code-samtaler med saker, en gjentatt Cowork-oppgave, Forskjeller, drift ─────
const T0 = Date.parse('2026-10-20T10:00:00+02:00'), t = (h) => T0 + h * 36e5
{
  const atoms = []
  const lang = 'Lang tekst om saken. '.repeat(400)   // ~8 000 tegn — /api/atoms bærer den, /api/sidefelt ikke
  const W = upsert(atoms, { key: 'arbeid:anke', content: `# Anken til Energima\n\n${lang}`, name: 'Anken til Energima', project: 'Energima', by: 'menneske', short: 'Arbeidet: anken.' }).atom
  W.arbeid = true; W.capturedAt = t(0)
  // Code-samtale med to saker (svar) som hører til arbeidet
  const s1 = upsert(atoms, { key: 'samtale:code-0001-aaaa', kind: 'samtale', content: `# Fristen for anke\n\n_Claude Code · 3 vendinger · 2026-10-20 · Energima_\n\n**Bruker:** Hva er fristen?\n\n**Claude:** Tre uker.\n\n**Bruker:** Og klagen?\n\n**Claude:** Fire uker.\n\n**Bruker:** Takk.\n\n**Claude:** Bare hyggelig.`, name: 'Fristen for anke', project: 'Energima', convo: 'Fristen for anke', source: 'Claude Code', by: 'regel', tags: ['samtale', 'code'], short: 'Sist: Takk. → Bare hyggelig. · 3 vendinger · 20.10.2026', links: [{ kind: 'claude-chat', href: 'claude://claude.ai/chat/c1' }] }).atom
  s1.hørerTil = W.id; s1.capturedAt = t(2)
  const sv1 = upsert(atoms, { key: 'svar:code0001:abcd', content: `Svar om fristen. ${lang}`, name: 'Svar om fristen', project: 'Energima', convo: 'Fristen for anke', source: 'Claude', by: 'regel', tags: ['svar'], short: 'Fristen er tre uker.' }).atom
  sv1.capturedAt = t(3); sv1.fanget = true
  // Tua-samtale (Spør-tråd) i arbeidet: prompt:spor: + svar + Forskjeller + konklusjon, samtale-sak med kilde Tua
  const ts = upsert(atoms, { key: 'samtale:tua:t_x_y', kind: 'samtale', content: '# Hva er fristen?\n\n_Tua · 1 vending · 2026-10-21 · Energima_\n\n**Du · 21.10.2026, 10:00:** Hva er fristen?\n\n**Test · M:** Ekko: tre uker.', name: 'Hva er fristen?', project: 'Energima', convo: 'Hva er fristen?', source: 'Tua', by: 'regel', tags: ['samtale', 'tua'], short: 'Sist: Hva er fristen? → Ekko: tre uker. · 1 vending · 21.10.2026' }).atom
  ts.hørerTil = W.id; ts.capturedAt = t(26)
  const p1 = upsert(atoms, { key: 'prompt:spor:deadbeef', kind: 'prompt', content: 'Hva er fristen?', name: 'Hva er fristen?', project: 'Energima', convo: 'Hva er fristen?', source: 'Tua', by: 'regel', tags: ['prompt'], short: 'Hva er fristen?', derivedFrom: [{ id: ts.id, version: 1, level: 'L' }] }).atom
  p1.capturedAt = t(24); p1.hørerTil = W.id
  const sv2 = upsert(atoms, { kind: 'svar', content: 'Ekko: tre uker.', name: 'Svar fra Test: fristen', project: 'Energima', convo: 'Hva er fristen?', source: 'Test (ekko — sender ingenting)', by: 'regel', tags: ['svar', 'test'], derivedFrom: [{ id: p1.id, version: 1, level: 'L' }, { id: ts.id, version: 1, level: 'L' }], short: 'Ekko: tre uker.' }).atom
  sv2.capturedAt = t(25)
  const sv3 = upsert(atoms, { kind: 'svar', content: 'Ekko B: tre uker og to dager.', name: 'Svar fra Test 2: fristen', project: 'Energima', convo: 'Hva er fristen?', source: 'Test 2 (ekko B — sender ingenting)', by: 'regel', tags: ['svar', 'test2'], derivedFrom: [{ id: p1.id, version: 1, level: 'L' }], short: 'Ekko B.' }).atom
  sv3.capturedAt = t(25.1)
  p1.ga = [{ id: sv2.id, version: 1 }, { id: sv3.id, version: 1 }]
  const fsk = upsert(atoms, { kind: 'svar', content: '## Enig\n\n- tre uker\n\n## Uenig\n\n- to dager', name: 'Forskjeller: fristen', project: 'Energima', convo: 'Hva er fristen?', source: 'Test', by: 'regel', tags: ['svar', 'forskjeller'], derivedFrom: [{ id: sv2.id, version: 1, level: 'L' }, { id: sv3.id, version: 1, level: 'L' }], short: 'Forskjeller.' }).atom
  fsk.capturedAt = t(25.2)
  const k = upsert(atoms, { key: `konklusjon:${p1.id}`, kind: 'konklusjon', content: 'Tre uker.', name: 'Konklusjon: fristen', project: 'Energima', convo: 'Hva er fristen?', source: 'Test', by: 'regel', tags: ['konklusjon'], derivedFrom: [{ id: p1.id, version: 1, level: 'L' }, { id: sv2.id, version: 1, level: 'L' }], short: 'Tre uker.' }).atom
  k.capturedAt = t(25.3); setStatus(k, 'utkast')
  // Skigaarden: tre Cowork-kjøringer med samme tittel (foldes), ett notat med samtalenavn, en gammel sak uten samtalenavn (ikke i sidefeltet)
  const DAGLIG = 'Du lager min daglige morgenbriefing. Gå gjennom nyhetene og lag et sammendrag på norsk.'
  for (let i = 0; i < 3; i++) { const c = upsert(atoms, { key: `samtale:cw-000${i}`, kind: 'samtale', content: `# ${regler.kortTittel(DAGLIG)}\n\n_Claude Cowork · 1 vending · 2026-10-2${i} · Skigaarden_\n\n**Bruker:** ${DAGLIG}\n\n**Claude:** Her er briefingen ${i}.`, name: regler.kortTittel(DAGLIG), project: 'Skigaarden', convo: `Kjøring ${i}`, source: 'Claude Cowork', by: 'regel', tags: ['samtale', 'cowork'], short: `Sist: … · 1 vending · 2${i}.10.2026`, ...(i ? { gjentatt: true } : {}), links: [{ kind: 'claude-project', href: 'claude://claude.ai/project/p1' }] }).atom; c.capturedAt = t(48 + i * 24) }
  const n = upsert(atoms, { content: `Notat om skiene. ${lang}`, name: 'Skinotat', project: 'Skigaarden', convo: 'Kjøring 1', by: 'menneske', short: 'Et notat i samtalen.' }).atom; n.capturedAt = t(80)
  const u = upsert(atoms, { content: `Løst notat uten samtale. ${lang}`, name: 'Løst notat', project: 'Skigaarden', by: 'menneske', short: 'Står ikke i sidefeltet.' }).atom; u.capturedAt = t(81)
  // drift-prosjekt — aldri i sidefeltet
  const d = upsert(atoms, { key: 'samtale:drift-0001', kind: 'samtale', content: '# Byggeøkt\n\n_Claude Code · 1 vending · 2026-10-22 · Tua_tua_\n\n**Bruker:** bygg\n\n**Claude:** bygd', name: 'Byggeøkt', project: 'Tua_tua', convo: 'Byggeøkt', source: 'Claude Code', by: 'regel', tags: ['samtale', 'code'], short: 'drift' }).atom; d.drift = true; d.capturedAt = t(90)
  save(atoms)
  ok('testarkiv skrevet', load().length === 15, `${load().length} saker`)
}

// ── 3) broen: /api/sidefelt mot /api/atoms, gzip + ETag, /api/mottakere usikker ─────────────────────────────────────────
const PORT = 5334
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
// rå bytes: Node sin fetch pakker ut gzip selv, så størrelsen og hodene leses med egne hoder
const hent = async (p, headers = {}) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { headers }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, bytes: b.length, enc: r.headers.get('content-encoding') || '', etag: r.headers.get('etag') || '', ms: r.headers.get('x-tua-ms'), json: r.status === 200 ? JSON.parse(b.toString('utf8')) : null } }
try {
  ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
  const t0 = Date.now()
  const sf = await hent('/api/sidefelt', { 'accept-encoding': 'identity' })
  const ms = Date.now() - t0
  const at = await hent('/api/atoms', { 'accept-encoding': 'identity' })
  ok('GET /api/sidefelt svarer med saker og total, tida i hodet X-Tua-Ms', sf.status === 200 && Array.isArray(sf.json.saker) && sf.json.total === 15 && /^\d+$/.test(sf.ms || ''), `${sf.json?.saker?.length} saker · ${ms} ms (server ${sf.ms})`)
  const sf2 = await hent('/api/sidefelt', { 'accept-encoding': 'identity' })
  ok('GET /api/sidefelt igjen: nøyaktig samme kropp når ingenting er endret (tida står i hodet, ikke i kroppen — så ETag/304 virker på store arkiv)', JSON.stringify(sf.json) === JSON.stringify(sf2.json) && sf.etag === sf2.etag, `${sf.bytes} B`)
  ok('bare det sidefeltet trenger: det løse notatet uten samtalenavn er ikke med; samtalene, prompten, svarene, konklusjonen, notatet i samtalen og arbeidet er', !sf.json.saker.some((a) => a.name === 'Løst notat') && sf.json.saker.filter((a) => a.kind === 'samtale').length === 6 && sf.json.saker.some((a) => a.id === load().find((x) => x.key === 'arbeid:anke').id && a.name === 'Anken til Energima') && sf.json.saker.some((a) => a.kind === 'konklusjon'), sf.json.saker.map((a) => a.kind).join())
  ok('ingen innhold på vanlige saker (bare prompt-teksten kortet og Forskjeller-teksten), ingen M/L-nivåer, S-tekst bare på samtaler', sf.json.saker.every((a) => a.content == null || a.kind === 'prompt' || (a.tags || []).includes('forskjeller')) && sf.json.saker.every((a) => !a.levels || (Object.keys(a.levels).join() === 'S' && a.kind === 'samtale')) && sf.json.saker.filter((a) => a.kind === 'prompt').every((a) => a.content.length <= 120 && a.key), JSON.stringify(sf.json.saker.find((a) => a.kind === 'prompt')))
  ok('svaret er mye mindre enn /api/atoms (under en tidel her)', sf.bytes * 10 < at.bytes, `${sf.bytes} B mot ${at.bytes} B`)
  const treSf = regler.sidefeltTre(sf.json.saker, { maks: 100 }), treAt = regler.sidefeltTre(at.json.atoms, { maks: 100 })
  ok('regler.sidefeltTre gir NØYAKTIG samme tre av /api/sidefelt som av /api/atoms (prosjekter, arbeider, samtaler, kjøringer, ulest, kilde, antall)', JSON.stringify(treSf) === JSON.stringify(treAt), JSON.stringify(treSf).slice(0, 300))
  ok('treet: Energima med arbeidet «Anken til Energima» (Code-samtalen og Tua-tråden under), Skigaarden med de tre kjøringene foldet til én, drift-prosjektet borte', treSf.map((p) => p.navn).sort().join() === 'Energima,Skigaarden' && treSf.find((p) => p.navn === 'Energima').arbeider[0]?.samtaler.length === 2 && treSf.find((p) => p.navn === 'Skigaarden').samtaler.length === 1 && treSf.find((p) => p.navn === 'Skigaarden').samtaler[0].antallKjøringer === 3, JSON.stringify(treSf.map((p) => [p.navn, p.arbeider.length, p.samtaler.length])))
  ok('sistBrukt virker på de samme radene', regler.sistBrukt([treSf[0].arbeider[0]?.samtaler[0]?.id || treSf[0].samtaler[0].id], treSf).length === 1)
  const pf = await hent('/api/sidefelt?prosjekt=Skigaarden', { 'accept-encoding': 'identity' })
  ok('?prosjekt= avgrenser til prosjektet (arbeid i andre prosjekter kan følge med som navneoppslag)', pf.json.saker.every((a) => a.project === 'Skigaarden' || a.name === 'Anken til Energima') && pf.json.saker.filter((a) => a.kind === 'samtale').length === 3 && pf.json.prosjekt === 'Skigaarden', pf.json.saker.map((a) => a.project).join())
  // gzip + ETag på store svar (/api/atoms er over 16 KiB her — notatene er 8 000 tegn). Rå bytes over node:http — fetch pakker ut gzip av seg selv og skjuler størrelsen.
  const rå = (p, headers = {}) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, (r) => { const d = []; r.on('data', (c) => d.push(c)); r.on('end', () => { const b = Buffer.concat(d); res({ status: r.statusCode, bytes: b.length, enc: r.headers['content-encoding'] || '', etag: r.headers.etag || '', json: r.headers['content-encoding'] === 'gzip' ? JSON.parse(zlib.gunzipSync(b).toString('utf8')) : r.statusCode === 200 ? JSON.parse(b.toString('utf8')) : null }) }) }).on('error', rej))
  const gz = await rå('/api/atoms', { 'accept-encoding': 'gzip' })
  ok('/api/atoms med Accept-Encoding gzip: Content-Encoding gzip, pakket under en tredel av rått, ETag satt, JSON lik etter utpakking', gz.enc === 'gzip' && gz.bytes < at.bytes / 3 && !!gz.etag && gz.json.total === at.json.total, `${gz.bytes} B pakket mot ${at.bytes} B · ETag ${gz.etag.slice(0, 12)}`)
  const r304 = await fetch(`http://127.0.0.1:${PORT}/api/atoms`, { headers: { 'if-none-match': gz.etag, 'accept-encoding': 'gzip' } })
  ok('samme svar igjen med If-None-Match → 304 uten kropp (avisens runde hvert 10. sekund koster ingen bytes når ingenting er endret)', r304.status === 304 && (await r304.arrayBuffer()).byteLength === 0)
  ok('små svar pakkes ikke (ingen Content-Encoding, ingen ETag)', (await hent('/api/prosjekter', { 'accept-encoding': 'gzip' })).enc === '' && !(await hent('/api/prosjekter', { 'accept-encoding': 'gzip' })).etag)
  // mottakere via broen: usikker øverst, ingen standard
  const mo = await hent('/api/mottakere')
  ok('GET /api/mottakere ved oppstart (Ollama har ikke svart): usikker: true øverst, Ollama-raden usikker, ingen standard', mo.json.usikker === true && mo.json.mottakere.find((m) => m.id === 'ollama').usikker === true && mo.json.mottakere.every((m) => !m.standard), JSON.stringify(mo.json.mottakere.map((m) => [m.id, m.standard, m.usikker])))
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
