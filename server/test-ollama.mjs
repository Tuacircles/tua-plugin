#!/usr/bin/env node
// test-ollama.mjs — friksjon 12: velge beste Ollama-modell fra Innstillinger (ollama.js, broen, motoren) mot et testarkiv i scratch
// og en FALSK Ollama-server på en annen port (TUA_OLLAMA_URL). ALDRI mot ~/Dropbox/Tua, ALDRI den ekte Ollama på 11434, ALDRI en ekte
// nedlasting (den falske /api/pull strømmer fremdrift på noen millisekunder), ALDRI ~/.tua/config.json (TUA_HOME peker til scratch).
//
//   TUA_FILES_ROOT=/tmp/tua-test-ollama/arkiv TUA_DATA_DIR=/tmp/tua-test-ollama/data node server/test-ollama.mjs
//
// Sjekker: maskin() og passer() (ja/trangt/nei på minne og disk), modeller() med lokale fra /api/tags (størrelse, parametre), anbefalte
// med «anbefalt for denne maskinen», standard = første når ingenting er valgt; i broen: GET /api/ollama/modeller, POST /api/ollama/standard
// (lagres i config, /api/mottakere viser den, motoren sender til den — den falske /api/chat husker modellnavnet), ugyldig/ukjent → 400,
// POST /api/ollama/hent som SSE (fremdrift med stigende prosent og MB → ferdig med ny liste; feil i strømmen → event feil; HTTP-feil → event feil;
// ugyldig navn → 400), DELETE /api/ollama/modeller/<navn> (var standard → valget nullstilles, Tua faller tilbake til første; ukjent → 404),
// og Ollama som ikke kjører (kjører: false, start-kommandoen, mottakeren «ikke klar»).
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR
if (!ROOT || !DATA || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
const HJEM = process.env.TUA_HOME || path.join(path.dirname(ROOT), 'hjem')
process.env.TUA_HOME = HJEM
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
const KONFIG = path.join(HJEM, '.tua', 'config.json')
const lesKonfig = () => { try { return JSON.parse(fs.readFileSync(KONFIG, 'utf8')) } catch { return {} } }

// ── Den falske Ollama-serveren ─────────────────────────────────────────────
const OLLAMA_PORT = 5294
process.env.TUA_OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`
const GB = 1e9
const falsk = {
  modeller: [
    { name: 'gemma3:4b', model: 'gemma3:4b', size: 3.35 * GB, modified_at: '2026-10-23T21:59:55Z', details: { parameter_size: '3.9B', quantization_level: 'Q4_K_M', family: 'gemma3' } },
    { name: 'qwen3:8b', model: 'qwen3:8b', size: 5.2 * GB, modified_at: '2026-10-24T08:00:00Z', details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M', family: 'qwen3' } },
  ],
  sisteChatModell: null, pullKall: [], deleteKall: [],
}
const lesJson = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c }); req.on('end', () => { try { r(JSON.parse(d || '{}')) } catch { r({}) } }) })
const nd = (res, obj) => res.write(JSON.stringify(obj) + '\n')
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const ollama = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: falsk.modeller })) }
  if (req.method === 'POST' && req.url === '/api/pull') {
    const b = await lesJson(req); const navn = b.model || b.name; falsk.pullKall.push(navn)
    if (navn === 'kaputt:1b') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'internal server error (falsk)' })) }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    nd(res, { status: 'pulling manifest' }); await vent(5)
    if (navn === 'finnes-ikke:1b') { nd(res, { error: 'pull model manifest: file does not exist' }); return res.end() }
    const total = 8.1 * GB
    for (const p of [0, 10, 25, 25, 50, 75, 100]) { nd(res, { status: 'pulling 4f0a1b2c3d4e', digest: 'sha256:4f0a', total, completed: Math.round(total * p / 100) }); await vent(5) }
    nd(res, { status: 'verifying sha256 digest' }); nd(res, { status: 'writing manifest' }); nd(res, { status: 'success' })
    falsk.modeller.push({ name: navn, model: navn, size: total, modified_at: new Date().toISOString(), details: { parameter_size: '12.2B', quantization_level: 'Q4_K_M', family: 'gemma3' } })
    return res.end()
  }
  if (req.method === 'DELETE' && req.url === '/api/delete') {
    const b = await lesJson(req); const navn = b.model || b.name; falsk.deleteKall.push(navn)
    const i = falsk.modeller.findIndex((m) => m.name === navn)
    if (i < 0) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `model '${navn}' not found` })) }
    falsk.modeller.splice(i, 1); res.writeHead(200); return res.end()
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    const b = await lesJson(req); falsk.sisteChatModell = b.model
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    nd(res, { model: b.model, message: { role: 'assistant', content: `Svar fra ${b.model}` }, done: false })
    nd(res, { model: b.model, message: { role: 'assistant', content: '.' }, done: true, prompt_eval_count: 12, eval_count: 4 })
    return res.end()
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => ollama.listen(OLLAMA_PORT, '127.0.0.1', r))

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }

const { save, upsert } = await import('./store.js')
const { maskin, passer, modeller, standardModell, ANBEFALTE, OLLAMA_VERT } = await import('./ollama.js')
const { ollamaStatus } = await import('./keychain.js')
const { mottakere, spor } = await import('./motor.js')

// ── 1) maskin() og passer() ─────────────────────────────────────────────────
const mask = maskin()
ok('maskin(): minne i GB, chip og ledig plass leses uten shell', mask.minneGB >= 4 && typeof mask.chip === 'string' && (mask.ledigGB == null || mask.ledigGB >= 0), JSON.stringify(mask))
const m16 = { minneGB: 16, ledigGB: 152 }
const finn = (n) => ANBEFALTE.find((a) => a.navn === n)
ok('passer(): gemma3:12b passer en 16 GB-maskin (ja)', passer(finn('gemma3:12b'), m16).passer === 'ja')
ok('passer(): gpt-oss:20b er trangt på 16 GB (bruker hele minnet)', passer(finn('gpt-oss:20b'), m16).passer === 'trangt' && /hele minnet/.test(passer(finn('gpt-oss:20b'), m16).hvorforIkke))
ok('passer(): gemma3:27b passer ikke 16 GB (nei, minne)', passer(finn('gemma3:27b'), m16).passer === 'nei' && /minne/.test(passer(finn('gemma3:27b'), m16).hvorforIkke))
ok('passer(): for lite plass på disken → nei med grunn', passer(finn('gemma3:12b'), { minneGB: 16, ledigGB: 6 }).passer === 'nei' && /disken/.test(passer(finn('gemma3:12b'), { minneGB: 16, ledigGB: 6 }).hvorforIkke))
ok('passer(): 8 GB-maskin: gemma3:4b ja, gemma3:12b nei', passer(finn('gemma3:4b'), { minneGB: 8, ledigGB: 100 }).passer === 'ja' && passer(finn('gemma3:12b'), { minneGB: 8, ledigGB: 100 }).passer === 'nei')
ok('ANBEFALTE: hver rad har navn, størrelse, minnekrav, norsk god/ok, passerTil og hvorfor', ANBEFALTE.length >= 5 && ANBEFALTE.every((a) => a.navn && a.størrelseGB > 0 && a.krevMinneGB > 0 && ['god', 'ok'].includes(a.norsk) && a.passerTil.length && a.hvorfor))
ok('OLLAMA_VERT følger TUA_OLLAMA_URL (den falske serveren)', OLLAMA_VERT === `127.0.0.1:${OLLAMA_PORT}`)

// ── 2) modeller() direkte mot den falske serveren ──────────────────────────
const m0 = await modeller()
ok('modeller(): kjører, to lokale med størrelse i GB og parametre', m0.kjører && m0.lokale.length === 2 && m0.lokale[0].navn === 'gemma3:4b' && m0.lokale[0].størrelseGB === 3.4 && m0.lokale[0].parametre === '3.9B' && m0.lokale[1].størrelseGB === 5.2, JSON.stringify(m0.lokale.map((l) => [l.navn, l.størrelseGB])))
ok('modeller(): standard = den første når ingenting er valgt (kilde «første»)', m0.standard.modell === 'gemma3:4b' && m0.standard.kilde === 'første' && m0.lokale[0].standard && !m0.lokale[1].standard)
ok('modeller(): anbefalte merket lokal der de ligger på maskinen', m0.anbefalte.find((a) => a.navn === 'gemma3:4b').lokal && m0.anbefalte.find((a) => a.navn === 'qwen3:8b').lokal && !m0.anbefalte.find((a) => a.navn === 'gemma3:12b').lokal)
ok('modeller(): nøyaktig én «anbefalt for denne maskinen», og den passer (ja)', m0.anbefalte.filter((a) => a.anbefalt).length === 1 && m0.anbefalte.find((a) => a.anbefalt).passer === 'ja', m0.anbefalte.find((a) => a.anbefalt)?.navn)
ok('modeller(): hver anbefalt rad har passer ja/trangt/nei', m0.anbefalte.every((a) => ['ja', 'trangt', 'nei'].includes(a.passer)))
ok('modeller(): start-kommandoen er serveren, ikke appens innstillinger', /open \/Applications\/Ollama\.app|ollama serve/.test(m0.start))
ok('standardModell(): valgt i config brukes bare når den ligger lokalt', standardModell(['a:1', 'b:2']).modell === 'a:1' && (() => { fs.mkdirSync(path.dirname(KONFIG), { recursive: true }); fs.writeFileSync(KONFIG, JSON.stringify({ ollama: { modell: 'b:2' } })); const r1 = standardModell(['a:1', 'b:2']); const r2 = standardModell(['a:1']); fs.rmSync(KONFIG); return r1.modell === 'b:2' && r1.kilde === 'valgt' && r2.modell === 'a:1' && r2.kilde === 'første' && r2.valgtFinnes === false })())
const st0 = await ollamaStatus()
ok('ollamaStatus(): running, models og modell (standard)', st0.running && st0.models.length === 2 && st0.modell === 'gemma3:4b')

// ── 3) testarkiv ───────────────────────────────────────────────────────────
const atoms = []
const a1 = upsert(atoms, { content: 'Kort sak om lagerdrift uten personopplysninger.', name: 'Kort sak', project: 'Testprosjekt', by: 'menneske' }).atom
save(atoms)

// ── 4) broen ───────────────────────────────────────────────────────────────
const PORT = 5295
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, init); return { status: r.status, type: r.headers.get('content-type') || '', tekst: await r.text() } }
const jsonAv = async (p, init) => { const r = await hent(p, init); return { status: r.status, j: JSON.parse(r.tekst || '{}') } }
const send = (metode, p, body) => jsonAv(p, { method: metode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const sse = async (p, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!/text\/event-stream/.test(r.headers.get('content-type') || '')) return { status: r.status, json: JSON.parse(await r.text()), events: [] }
  const tekst = await r.text()
  return { status: r.status, events: tekst.split('\n\n').filter(Boolean).map((b) => ({ ev: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || '{}') })) }
}
try {
  const g1 = await jsonAv('/api/ollama/modeller')
  ok('GET /api/ollama/modeller: kjører, maskin, lokale, anbefalte, standard', g1.status === 200 && g1.j.kjører && g1.j.maskin.minneGB > 0 && g1.j.lokale.length === 2 && g1.j.anbefalte.length >= 5 && g1.j.standard.modell === 'gemma3:4b', `${g1.j.maskin.chip} · ${g1.j.maskin.minneGB} GB · anbefalt ${g1.j.anbefalte.find((a) => a.anbefalt)?.navn}`)
  const mo0 = await jsonAv('/api/mottakere')
  ok('GET /api/mottakere før valg: Ollama aktiv, standard, modell = første (gemma3:4b), tegnPerToken 3,5', (() => { const o = mo0.j.mottakere.find((m) => m.id === 'ollama'); return o.aktiv && o.standard && o.modell === 'gemma3:4b' && o.tegnPerToken === 3.5 && o.endpoint === `127.0.0.1:${OLLAMA_PORT}` })())

  // standardvalg
  const s1 = await send('POST', '/api/ollama/standard', { navn: 'qwen3:8b' })
  ok('POST /api/ollama/standard {qwen3:8b}: ok, mottakere med', s1.status === 200 && s1.j.ok && s1.j.modell === 'qwen3:8b' && Array.isArray(s1.j.mottakere))
  ok('valget ligger i config (TUA_HOME/.tua/config.json → ollama.modell), ingenting annet overskrevet', lesKonfig().ollama?.modell === 'qwen3:8b' && !!lesKonfig().ollama?.valgt)
  const mo1 = await jsonAv('/api/mottakere')
  ok('GET /api/mottakere etter valg: Ollama-raden viser qwen3:8b (Spør-raden bruker samme felt)', mo1.j.mottakere.find((m) => m.id === 'ollama').modell === 'qwen3:8b' && mo1.j.mottakere.find((m) => m.id === 'ollama').standard)
  const g2 = await jsonAv('/api/ollama/modeller')
  ok('GET /api/ollama/modeller etter valg: standard qwen3:8b (kilde «valgt»), lokal rad merket', g2.j.standard.modell === 'qwen3:8b' && g2.j.standard.kilde === 'valgt' && g2.j.lokale.find((l) => l.navn === 'qwen3:8b').standard && !g2.j.lokale.find((l) => l.navn === 'gemma3:4b').standard && g2.j.anbefalte.find((a) => a.navn === 'qwen3:8b').standard)
  ok('POST /api/ollama/standard med modell som ikke ligger lokalt → 400', (await send('POST', '/api/ollama/standard', { navn: 'gemma3:12b' })).status === 400)
  ok('POST /api/ollama/standard med ugyldig navn → 400', (await send('POST', '/api/ollama/standard', { navn: 'rm -rf /' })).status === 400 && (await send('POST', '/api/ollama/standard', {})).status === 400)
  // motoren bruker den valgte: én sending til Ollama (den falske /api/chat husker modellnavnet) — i denne prosessen leser motoren samme config
  const r1 = await spor({ melding: 'Hva handler saken om?', saker: [{ id: a1.id, nivå: 'S' }], mottaker: 'ollama', prosjekt: 'Testprosjekt' })
  ok('motoren sender til den valgte modellen (falsk /api/chat fikk model=qwen3:8b), svaret lagret', falsk.sisteChatModell === 'qwen3:8b' && !!r1.svar, `modell i kallet: ${falsk.sisteChatModell}`)
  // og gjennom broen (egen prosess, samme config)
  const sp = await sse('/api/spor', { melding: 'Og hva mer?', saker: [{ id: a1.id, nivå: 'S' }], mottaker: 'ollama', prosjekt: 'Testprosjekt' })
  ok('POST /api/spor via broen: ferdig med modell qwen3:8b', sp.events.some((e) => e.ev === 'ferdig' && e.data.modell === 'qwen3:8b') && falsk.sisteChatModell === 'qwen3:8b', JSON.stringify(sp.events.map((e) => e.ev)))

  // hent (SSE)
  const h1 = await sse('/api/ollama/hent', { navn: 'gemma3:12b' })
  const fremdrift = h1.events.filter((e) => e.ev === 'fremdrift')
  const prosenter = fremdrift.map((e) => e.data.prosent).filter((p) => p != null)
  ok('POST /api/ollama/hent: SSE med fremdrift (status, prosent, MB) som stiger, så ferdig', h1.status === 200 && fremdrift.length >= 5 && prosenter.every((p, i) => i === 0 || p >= prosenter[i - 1]) && prosenter.at(-1) === 100 && fremdrift.some((e) => e.data.mbTotal > 7000 && e.data.mb != null) && h1.events.at(-1).ev === 'ferdig', `${fremdrift.length} fremdrift · ${prosenter.join(',')} · ${h1.events.at(-1).ev}`)
  ok('hent: ferdig har navn og ny modelliste med gemma3:12b lokal; samme prosent to ganger sendes ikke', h1.events.at(-1).data.navn === 'gemma3:12b' && h1.events.at(-1).data.modeller.lokale.some((l) => l.navn === 'gemma3:12b') && h1.events.at(-1).data.modeller.anbefalte.find((a) => a.navn === 'gemma3:12b').lokal && new Set(prosenter).size === prosenter.length)
  ok('hent: Ollama fikk ett /api/pull-kall for gemma3:12b (nedlastingen gjør Ollama, fra ollama.com)', falsk.pullKall.filter((n) => n === 'gemma3:12b').length === 1)
  const h2 = await sse('/api/ollama/hent', { navn: 'finnes-ikke:1b' })
  ok('hent av modell som ikke finnes: Ollamas feil i strømmen → event feil med teksten', h2.events.at(-1).ev === 'feil' && /does not exist/.test(h2.events.at(-1).data.feil), JSON.stringify(h2.events.at(-1)))
  const h3 = await sse('/api/ollama/hent', { navn: 'kaputt:1b' })
  ok('hent når Ollama svarer HTTP 500 → event feil', h3.events.at(-1).ev === 'feil' && /internal server error/.test(h3.events.at(-1).data.feil))
  const h4 = await sse('/api/ollama/hent', { navn: 'rm -rf /' })
  ok('hent med ugyldig navn → event feil (ikke et modellnavn), ingen kall til Ollama', h4.events.at(-1)?.ev === 'feil' && /modellnavn/.test(h4.events.at(-1).data.feil) && !falsk.pullKall.includes('rm -rf /'))
  ok('hent uten navn → 400 JSON', (await send('POST', '/api/ollama/hent', {})).status === 400)
  const g3 = await jsonAv('/api/ollama/modeller')
  ok('etter henting: tre lokale, standard fortsatt qwen3:8b (henting bytter ikke standard av seg selv)', g3.j.lokale.length === 3 && g3.j.standard.modell === 'qwen3:8b')

  // fjern
  const d1 = await jsonAv(`/api/ollama/modeller/${encodeURIComponent('qwen3:8b')}`, { method: 'DELETE' })
  ok('DELETE /api/ollama/modeller/qwen3%3A8b: ok, varStandard, ny liste med', d1.status === 200 && d1.j.ok && d1.j.navn === 'qwen3:8b' && d1.j.varStandard === true && d1.j.modeller.lokale.length === 2 && falsk.deleteKall.includes('qwen3:8b'))
  ok('etter fjerning av standarden: valget er nullstilt i config, Tua faller tilbake til første (gemma3:4b)', lesKonfig().ollama?.modell === null && d1.j.modeller.standard.modell === 'gemma3:4b' && d1.j.modeller.standard.kilde === 'første' && (await jsonAv('/api/mottakere')).j.mottakere.find((m) => m.id === 'ollama').modell === 'gemma3:4b')
  ok('DELETE av modell som ikke finnes → 404', (await jsonAv(`/api/ollama/modeller/${encodeURIComponent('finnes-ikke:1b')}`, { method: 'DELETE' })).status === 404)
  ok('DELETE med ugyldig navn → 400', (await jsonAv(`/api/ollama/modeller/${encodeURIComponent('rm -rf /')}`, { method: 'DELETE' })).status === 400)
  const d2 = await jsonAv(`/api/ollama/modeller/${encodeURIComponent('gemma3:12b')}`, { method: 'DELETE' })
  ok('DELETE av en som ikke var standard: varStandard false, standard uendret', d2.j.ok && d2.j.varStandard === false && d2.j.modeller.standard.modell === 'gemma3:4b')

  // Ollama kjører ikke
  await new Promise((r) => ollama.close(r))
  const g4 = await jsonAv('/api/ollama/modeller')
  ok('Ollama nede: GET /api/ollama/modeller → kjører false, ingen lokale, anbefalte og start-kommandoen står', g4.status === 200 && g4.j.kjører === false && g4.j.lokale.length === 0 && g4.j.anbefalte.length >= 5 && /open \/Applications\/Ollama\.app|ollama serve/.test(g4.j.start))
  const mo2 = await jsonAv('/api/mottakere')
  ok('Ollama nede: mottakeren er ikke klar med grunn «Ollama kjører ikke», ikke standard', (() => { const o = mo2.j.mottakere.find((m) => m.id === 'ollama'); return !o.aktiv && /kjører ikke/.test(o.hvorfor) && !o.standard })())
  const h5 = await sse('/api/ollama/hent', { navn: 'gemma3:12b' })
  ok('Ollama nede: hent → event feil «svarer ikke»', h5.events.at(-1)?.ev === 'feil' && /svarer ikke/.test(h5.events.at(-1).data.feil))
  ok('aldri en nøkkelverdi eller sakstekst i noen av svarene', ![g1, g2, g3, g4].some((g) => JSON.stringify(g.j).includes('lagerdrift')))
} finally { bro.kill(); try { ollama.close() } catch {} }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT} · config: ${KONFIG}`)
process.exit(feil ? 1 : 0)
