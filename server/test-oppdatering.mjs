#!/usr/bin/env node
// test-oppdatering.mjs — varselet om ny utgave (0.5.21). ALDRI mot GitHub: en liten http-server på 127.0.0.1 spiller «siste utgave»
// (TUA_OPPDATERING_URL), og alt annet pekes til en midlertidig mappe.
//
//   node server/test-oppdatering.mjs
//
// Sjekker: versjonssammenligning · av i testarkiv uten TUA_OPPDATERING=1 · én GET uten opplysninger om brukeren (User-Agent «tua-plugin», ingen
// cookies, ingen spørringsparametre) · høyst én gang i døgnet · linja kommer én gang per utgave og igjen når en nyere kommer · riktig råd for
// plugin og for .mcpb · uten nett: stille, prøver i morgen · bryteren (tua_setup oppdateringsvarsel=false) stopper både henting og varsel ·
// over MCP: «oppdatering:»-linja i første verktøysvar, og bare der · hooken sier det samme uten å hente noe selv.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-oppdatering-'))
const HJEM = path.join(S, 'home'), ROOT = path.join(S, 'arkiv')
for (const d of [HJEM, ROOT, path.join(S, 'data'), path.join(S, 'tom'), path.join(HJEM, '.tua')]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [path.join(S, 'tom')] } }) + '\n')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const VERSJON = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version

// liksom-GitHub
let siste = '9.0.0', kall = [], nede = false
const srv = http.createServer((req, res) => {
  kall.push({ url: req.url, headers: req.headers })
  if (nede) { res.writeHead(503); res.end('nede'); return }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ tag_name: `v${siste}`, html_url: `https://github.com/tuacircles/tua-plugin/releases/tag/v${siste}`, assets: [{ name: 'tua.mcpb', browser_download_url: `https://github.com/tuacircles/tua-plugin/releases/download/v${siste}/tua.mcpb` }] }))
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const URLEN = `http://127.0.0.1:${srv.address().port}/repos/tuacircles/tua-plugin/releases/latest`
const env = { TUA_FILES_ROOT: ROOT, TUA_DATA_DIR: path.join(S, 'data'), TUA_HOME: HJEM, TUA_NEDLASTINGER: path.join(S, 'tom'), TUA_CODE_HOME: path.join(S, 'tom'), TUA_COWORK_ROOT: path.join(S, 'tom'), TUA_CODEX_HOME: path.join(S, 'tom'), TUA_OPPDATERING_URL: URLEN, TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test' }
Object.assign(process.env, env); delete process.env.TUA_OPPDATERING; delete process.env.TUA_HISTORIKK_AUTO
const opp = await import('./oppdatering.js')
const fil = path.join(HJEM, '.tua', 'oppdatering.json')
const tilstand = () => { try { return JSON.parse(fs.readFileSync(fil, 'utf8')) } catch { return {} } }

ok('nyere(): 0.5.21 > 0.5.20, 0.6.0 > 0.5.99, v1.0.0 > 0.9.9; lik og eldre er ikke nyere; tull er ikke nyere', opp.nyere('0.5.21', '0.5.20') && opp.nyere('0.6.0', '0.5.99') && opp.nyere('v1.0.0', '0.9.9') && !opp.nyere('0.5.20', '0.5.20') && !opp.nyere('0.5.9', '0.5.20') && !opp.nyere('siste', '0.5.20'))
ok('installasjon(): plugin fra markedsplass, .mcpb og kildekode kjennes fra hverandre', opp.installasjon('/Users/x/.claude/plugins/cache/tua-plugin/tua/0.5.21/server/tua-server.mjs').markedsplass === 'tua-plugin' && opp.installasjon('/Users/x/Library/Application Support/Claude/Claude Extensions/local.mcpb.tua/server/tua-server.mjs').slag === 'mcpb' && opp.installasjon('/Users/x/kode/tua-plugin/server/server.js').slag === 'kilde')
{
  const r = await opp.sjekkOppdatering({ versjon: VERSJON })
  ok('et arkiv i en midlertidig mappe henter aldri noe av seg selv (testsvitene er trygge)', r.hoppet === 'slått av' && kall.length === 0 && opp.varselPå() === false)
}
process.env.TUA_OPPDATERING = '1'
{
  const r = await opp.sjekkOppdatering({ versjon: VERSJON })
  const k = kall[0] || { headers: {} }
  ok('én GET, og siste utgave er lagret', kall.length === 1 && r.siste === '9.0.0' && r.ny === true && tilstand().siste === '9.0.0' && /tua\.mcpb$/.test(tilstand().mcpb))
  ok('forespørselen bærer ingenting om brukeren: User-Agent «tua-plugin», ingen cookie, ingen authorization, ingen spørring, ingen versjon', k.headers['user-agent'] === 'tua-plugin' && !k.headers.cookie && !k.headers.authorization && !/\?/.test(k.url) && !JSON.stringify(k.headers).includes(VERSJON) && !JSON.stringify(k).includes(os.userInfo().username), JSON.stringify(Object.keys(k.headers)))
  await opp.sjekkOppdatering({ versjon: VERSJON }); await opp.sjekkOppdatering({ versjon: VERSJON })
  ok('høyst én gang i døgnet', kall.length === 1)
  const pl = opp.oppdateringsLinje({ versjon: VERSJON, merk: false, inst: { slag: 'plugin', markedsplass: 'tua-plugin', navn: 'tua' } })
  const mc = opp.oppdateringsLinje({ versjon: VERSJON, merk: false, inst: { slag: 'mcpb' } })
  ok('linja for plugin: begge versjoner, «Update now», kommandoen og auto-update', pl.includes('9.0.0') && pl.includes(VERSJON) && /Update now/.test(pl) && /claude plugin update tua@tua-plugin/.test(pl) && /auto-update/.test(pl))
  ok('linja for .mcpb: lenke rett til den nye fila, og at den ikke oppdateres av seg selv', /releases\/download\/v9\.0\.0\/tua\.mcpb/.test(mc) && /ikke av seg selv/.test(mc) && /installerer ingenting selv/.test(mc))
  ok('linja kommer én gang per utgave', opp.oppdateringsLinje({ versjon: VERSJON }) !== '' && opp.oppdateringsLinje({ versjon: VERSJON }) === '')
  ok('har maskinen siste utgave, kommer ingen linje', opp.oppdateringsLinje({ versjon: '9.0.0', merk: false }) === '' && opp.oppdateringsLinje({ versjon: '9.1.0', merk: false }) === '')
  siste = '9.1.0'; fs.writeFileSync(fil, JSON.stringify({ ...tilstand(), sjekket: Date.now() - 25 * 3600 * 1000 }))
  await opp.sjekkOppdatering({ versjon: VERSJON })
  ok('etter et døgn sjekkes det igjen, og en enda nyere utgave varsles på nytt', kall.length === 2 && /9\.1\.0/.test(opp.oppdateringsLinje({ versjon: VERSJON })))
  nede = true; fs.writeFileSync(fil, JSON.stringify({ ...tilstand(), sjekket: 0 }))
  const r2 = await opp.sjekkOppdatering({ versjon: VERSJON })
  ok('GitHub nede: stille, forrige kjente utgave står, og det prøves ikke igjen før i morgen', /503/.test(r2.feil) && tilstand().siste === '9.1.0' && (await opp.sjekkOppdatering({ versjon: VERSJON })).hoppet === 'sjekket nylig')
  nede = false
}

// over MCP
const medServer = async (ekstra, fn) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.TUA_TEST_INNGANG ? path.resolve(process.env.TUA_TEST_INNGANG) : path.join(HERE, 'server.js')], cwd: HERE, env: { ...process.env, ...env, ...ekstra }, stderr: 'pipe' })
  const c = new Client({ name: 'tua-oppdatering-test', version: '0.0.1' }); await c.connect(transport)
  try { return await fn((name, args = {}) => c.callTool({ name, arguments: args }).then((r) => r.content[0].text)) } finally { await c.close() }
}
fs.writeFileSync(fil, JSON.stringify({ sjekket: Date.now(), siste: '9.1.0', side: 'https://github.com/tuacircles/tua-plugin/releases/tag/v9.1.0', mcpb: 'https://github.com/tuacircles/tua-plugin/releases/download/v9.1.0/tua.mcpb' }))
await medServer({ TUA_OPPDATERING: '1' }, async (kall2) => {
  const a = await kall2('tua_list'), b = await kall2('tua_list')
  ok('over MCP: første verktøysvar har «oppdatering:»-linja, det neste har den ikke', /\noppdatering: En ny utgave av Tua er ute: 9\.1\.0/.test(a) && !/oppdatering:/.test(b))
  const st = await kall2('tua_setup')
  ok('tua_setup viser versjonen og bryteren', st.includes(`Tua ${VERSJON} · varsel om ny utgave: på`) && /siste utgave sett: 9\.1\.0/.test(st))
})
{
  fs.writeFileSync(fil, JSON.stringify({ ...tilstand(), varslet: null }))
  const h = spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), 'start'], { input: JSON.stringify({ session_id: 'hook-opp', cwd: S, hook_event_name: 'SessionStart' }), env: { ...process.env, ...env, TUA_OPPDATERING: '1' }, encoding: 'utf8' })
  const før = kall.length
  ok('hooken sier det samme ved øktstart, uten å hente noe selv', h.status === 0 && /En ny utgave av Tua er ute: 9\.1\.0/.test(h.stdout) && kall.length === før, h.stdout.trim().slice(0, 80))
}
await medServer({ TUA_OPPDATERING: '' }, async (kall2) => {
  process.env.TUA_OPPDATERING = ''
  const av = await kall2('tua_setup', { oppdateringsvarsel: false })
  ok('bryteren: tua_setup(oppdateringsvarsel=false) lagres og sier at Tua ikke henter noe selv', /slått av/.test(av) && /ikke lenger noe fra nettet/.test(av) && JSON.parse(fs.readFileSync(path.join(HJEM, '.tua', 'config.json'), 'utf8')).oppdatering?.varsel === false)
})
{
  process.env.TUA_OPPDATERING = '1'                                           // selv med «på» i miljøet for arkivregelen: bryteren i config vinner
  fs.writeFileSync(fil, JSON.stringify({ siste: '9.9.0' })); const n = kall.length
  const r = await opp.sjekkOppdatering({ versjon: VERSJON })
  ok('avslått: ingen henting og ingen linje', r.hoppet === 'slått av' && kall.length === n && opp.oppdateringsLinje({ versjon: VERSJON, merk: false }) === '')
  ok('bryteren rører ikke de andre innstillingene', Array.isArray(JSON.parse(fs.readFileSync(path.join(HJEM, '.tua', 'config.json'), 'utf8')).finder?.folders))
}
srv.close()
fs.rmSync(S, { recursive: true, force: true })
console.log(feil ? `\n${feil} feil` : '\nAlt grønt')
process.exit(feil ? 1 : 0)
