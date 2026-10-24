#!/usr/bin/env node
// helsesjekk.js — Tuas nattlige helsesjekk. Instruksen (hva og hvorfor) står i docs/rutine-helsesjekk.md; denne fila gjør
// nøyaktig det, ikke mer. Tre lag: koden (her) · instruksen (docs) · minnet (atomet «Helsesjekk — minne» i prosjekt Tua).
//
//   node server/helsesjekk.js                 kjør: samle feil, regresjonssjekker, arkivtall → rapport-atom + minne (+ varsel ved rødt)
//   node server/helsesjekk.js --dry-run       samme, men skriv rapporten til stdout og rør ikke arkivet
//   node server/helsesjekk.js --install-launchd   legg inn/oppdater launchd-jobben (hver natt 03:30) og vis hvordan den fjernes
//   node server/helsesjekk.js --uninstall-launchd
//
// Regler (instruksen §«Regler som aldri brytes»): sletter/flytter/endrer aldri et atom · endrer aldri config · ingen nettverk ·
// tester bare mot scratch-arkiv · feiler sjekken selv, er det rapporten. Skriver bare: rapport-atomet, minne-atomet,
// <arkiv>/.tua/helsesjekk-varsel.txt (ved rødt) og <data>/helsesjekk-state.json (rekker og forrige resultat, maskinlokalt).
// Runde 2d (03-avisen §2 A): rapporten og minnet er drift (`drift: true`) — Tua om seg selv, aldri i avisen.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { load, save, upsert, FILES_ROOT, DATA_DIR, ensureArchive } from './store.js'
import { CLAUDE_APP_DIR, HOME } from './platform.js'
import { desktopStaleness, IDB_DIR, CACHE_DIR } from './desktop.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const REPO = path.resolve(PLUGIN, '..')
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const SINCE = NOW - DAY
const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const today = new Date(NOW).toISOString().slice(0, 10)
const STATE = path.join(DATA_DIR, 'helsesjekk-state.json')
const VARSEL = () => path.join(FILES_ROOT, '.tua', 'helsesjekk-varsel.txt')
const PROJECT = 'Tua'

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }
const exists = (p) => { try { fs.accessSync(p); return true } catch { return false } }
const lines = (p) => { try { return fs.readFileSync(p, 'utf8').split('\n') } catch { return [] } }
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const fmt = (ms) => (ms ? new Date(ms).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const version = readJson(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), {}).version || '?'

// ── Steg 2: feilmeldinger siste døgn ────────────────────────────────────────
// Hver kilde gir { kilde, mønster, antall, første, siste, eksempel }. Tidsstempler leses fra linjene der de finnes.
function collectErrors() {
  const out = []
  const add = (map, kilde, key, ts, text) => {
    const k = `${kilde}|${key}`
    const e = map.get(k) || { kilde, mønster: key, antall: 0, første: ts, siste: ts, eksempel: clip(text, 120) }
    e.antall++; if (ts && (!e.første || ts < e.første)) e.første = ts; if (ts && ts > e.siste) e.siste = ts
    map.set(k, e)
  }
  const map = new Map()
  // Desktop-serveren
  // Linjer uten tidsstempel (stack-spor) hører til siste tidsstemplede linje — ellers teller gamle krasj hver natt.
  const desk = path.join(HOME, 'Library', 'Logs', 'Claude', 'mcp-server-tua.log')
  let last = 0
  for (const l of lines(desk)) {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/); if (m) last = Date.parse(m[1])
    const ts = last
    if (ts < SINCE) continue
    const pat = /Cannot find module/.test(l) ? 'Cannot find module' : /Server disconnected/.test(l) ? 'Server disconnected' : /Couldn't start/.test(l) ? "Couldn't start (Cowork/Code)" : /Connection closed/.test(l) ? 'Connection closed' : /\[error\]/.test(l) ? 'error' : null
    if (pat) add(map, 'Desktop-serveren (mcp-server-tua.log)', pat, ts, l)
  }
  // Desktops hovedlogg: bare linjer om Tua-serveren/-pluginen (ikke alt som nevner mappa «tua»)
  for (const l of lines(path.join(HOME, 'Library', 'Logs', 'Claude', 'main.log'))) {
    if (!/\[tua\]|server "tua"|"tua"|mcp-server-tua|plugin.*tua|localMcpBridge\] .*tua/i.test(l)) continue
    const m = l.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/); const ts = m ? Date.parse(m[1].replace(' ', 'T')) : 0
    if (ts && ts < SINCE) continue
    const pat = /dropping server/.test(l) ? 'brua kastet serveren' : /config references plugin user configuration/.test(l) ? 'user_config i .mcp.json (brua støtter ikke)' : /\[error\].*(tua)/i.test(l) && !/Git command failed/.test(l) ? 'error' : null
    if (pat) add(map, 'Desktops hovedlogg (main.log)', pat, ts, l)
  }
  // Code-øktenes MCP-logger
  const cacheRoot = path.join(HOME, 'Library', 'Caches', 'claude-cli-nodejs')
  try {
    for (const proj of fs.readdirSync(cacheRoot)) {
      const dir = path.join(cacheRoot, proj, 'mcp-logs-tua'); if (!exists(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f); if (mtime(p) < SINCE) continue
        for (const l of lines(p)) {
          let j = null; try { j = JSON.parse(l) } catch { continue }
          const text = String(j.error || j.message || j.text || '')
          // Code logger serverens stderr som «error» selv når det er info («[tua] MCP-server klar …») — bare ekte feil teller
          const real = /Skipping connection|recent failure|Cannot find module|Connection closed|exited|ENOENT|TypeError|ReferenceError|SyntaxError|Error:/.test(text) && !/MCP-server klar/.test(text)
          if (!real) continue
          const ts = Date.parse(j.timestamp || j.time || '') || mtime(p)
          if (ts < SINCE) continue
          add(map, 'Code-økter (mcp-logs-tua)', /Skipping connection|recent failure/.test(text) ? 'hoppet over tilkobling (feil i cache)' : 'error', ts, text)
        }
      }
    }
  } catch {}
  // Hook-loggen: feil + tellinger
  const hooks = { per: {}, feil: 0, poster: 0 }
  for (const l of lines(path.join(FILES_ROOT, '.tua', 'hooks.jsonl'))) {
    let j; try { j = JSON.parse(l) } catch { continue }
    if ((j.at || 0) < SINCE) continue
    hooks.poster++
    const k = j.error ? `${j.mode}:feil` : j.skipped ? `${j.mode}:hoppet over (${j.skipped})` : j.status ? `${j.mode}:${j.status}` : j.mode
    hooks.per[k] = (hooks.per[k] || 0) + 1
    if (j.error) { hooks.feil++; add(map, 'Hooks (hooks.jsonl)', 'error', j.at, j.error) }
  }
  // Utleveringer (bare telles)
  let utlev = 0
  for (const l of lines(path.join(FILES_ROOT, '.tua', 'utlevering.jsonl'))) { try { const j = JSON.parse(l); if ((j.at || Date.parse(j.ts || '') || 0) >= SINCE) utlev++ } catch {} }
  // Speilingen: commits siste døgn mot atomer endret i Tua_tua siste døgn
  let commits = 0, speilet = 0
  try { commits = spawnSync('git', ['-C', REPO, 'log', '--since=24 hours ago', '--oneline'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).length } catch {}
  try { for (const f of fs.readdirSync(path.join(FILES_ROOT, 'Tua_tua'))) if (mtime(path.join(FILES_ROOT, 'Tua_tua', f)) >= SINCE) speilet++ } catch {}
  return { feil: [...map.values()].sort((a, b) => b.antall - a.antall), hooks, utlev, commits, speilet }
}

// ── Steg 3: regresjonslista R1–R8 ───────────────────────────────────────────
const G = 'grønn', Y = 'gul', R = 'rød'
const run = (script, extraEnv = {}, ms = 120000) => spawnSync(process.execPath, [path.join(HERE, script)], { cwd: PLUGIN, encoding: 'utf8', timeout: ms, env: { ...process.env, ...extraEnv } })
function scratch(name) { const d = fs.mkdtempSync(path.join(os.tmpdir(), `tua-helse-${name}-`)); fs.mkdirSync(path.join(d, 'arkiv'), { recursive: true }); return d }

function r1() {
  const cfg = readJson(path.join(CLAUDE_APP_DIR, 'claude_desktop_config.json'), {})
  const a = cfg?.mcpServers?.tua?.args?.[0]
  if (!a) return [Y, 'ingen «tua»-server i claude_desktop_config.json (Desktop-chat uten Tua)']
  return exists(a) ? [G, `peker på ${a} (finnes)`] : [R, `peker på ${a} — fila finnes ikke`]
}
// Inngangen Claude faktisk starter: args[0] i .mcp.json (0.5.5: server/tua-server.mjs bygd av bygg.mjs; før: bundelen)
function entryPoint() {
  const mcp = readJson(path.join(PLUGIN, '.mcp.json'), {})
  const a = mcp?.mcpServers?.tua?.args?.find((x) => /\.m?js$/.test(x)) || '${CLAUDE_PLUGIN_ROOT}/server/server.js'
  return a.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN)
}
function builtFiles() {
  const out = []
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }; for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name)) out.push(p) } }
  const entry = entryPoint(); if (exists(entry) && path.basename(entry) !== 'server.js') out.push(entry)
  walk(path.join(HERE, 'bygd'))
  return out
}
function r2() {
  return new Promise((resolve) => {
    const bundle = entryPoint()
    if (!exists(bundle)) return resolve([R, `inngangen ${path.relative(PLUGIN, bundle)} finnes ikke — kjør node bygg.mjs`])
    const d = scratch('r2')
    const child = spawn(process.execPath, [bundle], { env: { ...process.env, TUA_FILES_ROOT: path.join(d, 'arkiv'), TUA_DATA_DIR: path.join(d, 'data'), TUA_CLIENT: 'helsesjekk' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', done = false
    const finish = (res) => { if (done) return; done = true; try { child.kill() } catch {}; try { fs.rmSync(d, { recursive: true, force: true }) } catch {}; resolve(res) }
    const timer = setTimeout(() => finish([R, `serveren svarte ikke på initialize innen 5 s (${clip(err, 100) || 'ingen feilmelding'})`]), 5000)
    child.stdout.on('data', (b) => {
      out += b
      for (const l of out.split('\n')) {
        try { const j = JSON.parse(l); if (j.id === 1 && j.result) { clearTimeout(timer); const v = j.result.serverInfo?.version; finish(v === version ? [G, `svarer på initialize, versjon ${v}`] : [R, `svarer, men versjon ${v} ≠ plugin.json ${version} — kjør node bygg.mjs`]) } } catch {}
      }
    })
    child.stderr.on('data', (b) => { err += b })
    child.on('exit', (code) => { if (!done) { clearTimeout(timer); finish([R, `serveren avsluttet (kode ${code}): ${clip(err, 120)}`]) } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'helsesjekk', version: '1' } } }) + '\n')
  })
}
function r3() {
  const ds = desktopStaleness()
  const used = Math.max(mtime(IDB_DIR), mtime(CACHE_DIR)) >= SINCE
  if (!used) return [Y, 'Desktop ikke brukt siste døgn — ingenting å måle']
  if (ds.stale) return [R, `stillhetsvakten: ingen ny samtale sett på ${ds.days} dager selv om Desktop er i bruk`]
  if (ds.days === null) return [Y, 'ingen samtale er importert fra Desktop ennå (første kjøring?)']
  return ds.days <= 2 ? [G, `nyeste importerte samtale er ${ds.days} dag(er) gammel`] : [Y, `nyeste importerte samtale er ${ds.days} dager gammel (Desktop brukt — brukes samtaler som alt er importert?)`]
}
function r4() {
  if (!exists(IDB_DIR)) return [Y, 'samtalelageret finnes ikke på denne maskinen']
  const r = run('test-idb.mjs')
  const m = (r.stdout || '').match(/(\d+) samtaler i «trees» \((\d+) poster hoppet over\)/), e = (r.stdout || '').match(/(\d+) feil/)
  if (r.status !== 0 || !m) return [R, `test-idb.mjs feilet: ${clip(r.stderr || r.stdout, 120)}`]
  const feil = e ? Number(e[1]) : 0
  return feil === 0 && Number(m[2]) === 0 ? [G, `${m[1]} samtaler lest, 0 feil, 0 hoppet over`] : [R, `${m[1]} samtaler, ${feil} feil, ${m[2]} poster hoppet over`]
}
function r5(atoms) {
  const r = run('test-tuaprat.mjs')
  if (r.status !== 0) return [R, `test-tuaprat.mjs feilet: ${clip(r.stderr, 120)}`]
  const bad = atoms.filter((a) => (a.updatedAt || a.createdAt || 0) >= SINCE && (/^\s*\/tua/i.test(a.name) || /^\s*(\d+|fem|fire|tre|to|ett|én|ingen)\s+treff på «/i.test(a.content || '') || /^\s*\/tua/i.test(a.content || '')))
  return bad.length ? [R, `${bad.length} nye atomer siste døgn er Tua-prat: ${bad.slice(0, 3).map((a) => `«${clip(a.name, 40)}» (${a.project})`).join(', ')}`] : [G, 'regelen grønn, ingen Tua-prat lagret siste døgn']
}
function r6() {
  const r = run('test-tools.mjs', {}, 180000)
  if (r.status !== 0) return [R, `test-tools.mjs feilet: ${clip((r.stdout || '').split('\n').filter((l) => /✘|Error/.test(l)).join(' ') || r.stderr, 140)}`]
  return /ressurs ui:\/\/tua\/kort finnes/.test(r.stdout) ? [G, 'alle verktøy kjørte, ressursen ui://tua/kort finnes'] : [R, 'test-tools.mjs grønn, men ressursen ui://tua/kort ble ikke bekreftet']
}
function r7() {
  const cache = path.join(HOME, '.claude', 'plugins', 'cache', 'tua-lokal', 'tua')
  let newest = null
  try { newest = fs.readdirSync(cache).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop() || null } catch {}
  const built = builtFiles()
  // bare kildefiler som faktisk inngår i bygget (server/bygd/tua/<navn>.mjs finnes) — ikke tester, ikke denne fila
  let newestSrc = 0; for (const f of fs.readdirSync(HERE)) if (/\.js$/.test(f) && exists(path.join(HERE, 'bygd', 'tua', f.replace(/\.js$/, '.mjs')))) newestSrc = Math.max(newestSrc, mtime(path.join(HERE, f)))
  const newestBuilt = built.reduce((m, p) => Math.max(m, mtime(p)), 0)
  const usesBuild = path.basename(entryPoint()) !== 'server.js'
  if (newest && newest !== version) return [R, `cachen har ${newest}, repoet ${version} — claude plugin update tua@tua-lokal`]
  if (usesBuild && !built.length) return [R, `inngangen ${path.relative(PLUGIN, entryPoint())} er ikke bygd — kjør node bygg.mjs`]
  if (usesBuild && newestBuilt < newestSrc) return [R, `bygget er eldre enn server/*.js — kjør node bygg.mjs`]
  return [G, `plugin ${version} i cache og repo${usesBuild ? ', bygget er nyere enn kildene' : ''}`]
}
function r8() {
  let codeUsed = false
  try { for (const p of fs.readdirSync(path.join(HOME, '.claude', 'projects'))) { const d = path.join(HOME, '.claude', 'projects', p); for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl') && mtime(path.join(d, f)) >= SINCE) codeUsed = true } } catch {}
  const hooksAt = mtime(path.join(FILES_ROOT, '.tua', 'hooks.jsonl'))
  const st = readJson(path.join(FILES_ROOT, '.tua', 'import-state.json'), {})
  const deskRunning = mtime(path.join(HOME, 'Library', 'Logs', 'Claude', 'mcp-server-tua.log')) >= NOW - 3600000
  const problems = []
  if (codeUsed && hooksAt < SINCE) problems.push('Code brukt siste døgn, men hooks.jsonl har ingen ny post')
  if (deskRunning && (st.desktop?.at || 0) < NOW - 3600000) problems.push('Desktop-serveren kjører, men Desktop-importen har ikke kjørt siste time')
  if (problems.length) return [R, problems.join('; ')]
  return [codeUsed || deskRunning ? G : Y, `hooks sist ${fmt(hooksAt)} · Desktop-import sist ${fmt(st.desktop?.at)}${codeUsed || deskRunning ? '' : ' · verken Code eller Desktop-serveren i bruk'}`]
}

// ── Steg 4: arkivets tilstand ───────────────────────────────────────────────
function archiveState(atoms) {
  const nye = {}, utenS = [], streker = [], dupl = [], konflikt = []
  const sig = new Map()
  for (const a of atoms) {
    if ((a.createdAt || 0) >= SINCE) nye[a.project] = (nye[a.project] || 0) + 1
    if (!(a.levels?.S?.text || a.short)) utenS.push(a)
    if (/^-{2,}/.test(a.name || '')) streker.push(a)
    const k = `${(a.name || '').toLowerCase()}|${(a.content || '').slice(0, 500)}`
    const prev = sig.get(k); if (prev && prev.project !== a.project) dupl.push([prev, a]); else sig.set(k, a)
  }
  const walk = (d, depth = 0) => { if (depth > 3) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }; for (const e of es) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (/conflicted copy/i.test(e.name)) konflikt.push(p) } }
  walk(FILES_ROOT)
  const lock = path.join(FILES_ROOT, '.tua', '.lock'); const lockAge = exists(lock) ? NOW - mtime(lock) : 0
  const index = readJson(path.join(FILES_ROOT, '.tua', 'index.json'), null)
  const indexN = Array.isArray(index) ? index.length : Array.isArray(index?.atoms) ? index.atoms.length : null
  const hooksMb = (() => { try { return fs.statSync(path.join(FILES_ROOT, '.tua', 'hooks.jsonl')).size / 1e6 } catch { return 0 } })()
  const forslag = []
  for (const a of streker) forslag.push(`Tittel «${a.name}» i ${a.project} (${a.id}): sett tittel fra innholdet — ${clip(a.content, 60)}`)
  for (const [x, y] of dupl.slice(0, 10)) forslag.push(`Dobbeltimport: «${clip(x.name, 50)}» i ${x.project} (${x.id}) og ${y.project} (${y.id}) — behold den med best ingress`)
  for (const p of konflikt) forslag.push(`Dropbox-konflikt: ${p}`)
  if (lockAge > 10 * 60 * 1000) forslag.push(`.tua/.lock er ${Math.round(lockAge / 60000)} min gammel — henger en prosess?`)
  if (hooksMb > 5) forslag.push(`hooks.jsonl er ${hooksMb.toFixed(1)} MB — rotér`)
  if (indexN != null && Math.abs(indexN - atoms.length) > 5) forslag.push(`index.json har ${indexN} atomer, disken ${atoms.length} — indeksen bør bygges på nytt`)
  return { total: atoms.length, nye, utenS: utenS.length, streker: streker.length, dupl: dupl.length, konflikt: konflikt.length, lockAge, indexN, hooksMb, forslag }
}

// ── Steg 5–7: rapport, minne, varsel ────────────────────────────────────────
const CHECKS = [['R1', 'Desktop-configen peker på en fil som finnes', r1], ['R2', 'Serveren starter og svarer', r2], ['R3', 'Desktop-leseren ser nye samtaler', r3], ['R4', 'Samtalelageret lar seg lese', r4], ['R5', 'Tua-prat holdes ute', r5], ['R6', 'Kortet finnes', r6], ['R7', 'Pluginen er i takt', r7], ['R8', 'Vaktene lever', r8]]

async function main() {
  if (args.has('--install-launchd')) return installLaunchd()
  if (args.has('--uninstall-launchd')) return uninstallLaunchd()
  const t0 = Date.now()
  const state = readJson(STATE, { streak: {}, prev: {}, forslagSett: {}, nyeMønstre: {} })
  let atoms = []
  const report = []
  try {
    if (!FILES_ROOT || ensureArchive().needsChoice) throw new Error('arkivet er ikke valgt (tua_setup)')
    atoms = load()
    const errs = collectErrors()
    const results = []
    for (const [id, title, fn] of CHECKS) {
      let res
      try { res = await fn(atoms) } catch (e) { res = [R, `sjekken feilet: ${clip(e.message, 120)}`] }
      results.push({ id, title, status: res[0], bevis: res[1] })
    }
    // rød = var grønn i går og er rød nå, eller ny feilmelding ≥ 3 ganger. En sjekk som er rød første gang er også rød (ingen fasit å sammenlikne med).
    const red = results.filter((r) => r.status === R)
    const newErr = errs.feil.filter((e) => e.antall >= 3 && !state.nyeMønstre[`${e.kilde}|${e.mønster}`])
    const arkiv = archiveState(atoms)
    // rekker og læring
    for (const r of results) state.streak[r.id] = r.status === G ? (state.streak[r.id] || 0) + 1 : 0
    const forslagTilErik = []
    for (const r of results) if (state.streak[r.id] >= 14 && state.streak[r.id] % 14 === 0) forslagTilErik.push(`${r.id} «${r.title}» har vært grønn ${state.streak[r.id]} netter på rad — nedgradere til ukentlig?`)
    for (const f of arkiv.forslag) { state.forslagSett[f] = (state.forslagSett[f] || 0) + 1; if (state.forslagSett[f] === 3) forslagTilErik.push(`Ryddeforslaget «${clip(f, 80)}» har stått identisk tre netter — automatisere? (angres ved å flytte tilbake fra .tua/papirkurv)`) }
    for (const k of Object.keys(state.forslagSett)) if (!arkiv.forslag.includes(k)) delete state.forslagSett[k]
    for (const e of newErr) { state.nyeMønstre[`${e.kilde}|${e.mønster}`] = today; forslagTilErik.push(`Ny feilmelding uten sjekk: «${e.mønster}» i ${e.kilde} (${e.antall} ganger) — ny sjekk R${CHECKS.length + 1}?`) }
    const prevStatus = { ...state.prev }
    const changed = results.filter((r) => prevStatus[r.id] && prevStatus[r.id] !== r.status)
    state.prev = Object.fromEntries(results.map((r) => [r.id, r.status]))
    const isRed = red.length > 0 || newErr.length > 0
    const nyeN = Object.values(arkiv.nye).reduce((a, b) => a + b, 0)
    const S = isRed
      ? `RØD: ${[...red.map((r) => `${r.id} ${r.title}`), ...newErr.map((e) => `ny feil «${e.mønster}» ×${e.antall}`)].join(' · ')}`
      : `Grønn ${results.filter((r) => r.status === G).length}/${results.length}${results.some((r) => r.status === Y) ? ` (gul: ${results.filter((r) => r.status === Y).map((r) => r.id).join(', ')})` : ''} · ${errs.feil.reduce((n, e) => n + e.antall, 0)} feil i loggene · ${nyeN} nye atomer · ${arkiv.forslag.length} ryddeforslag`
    report.push(`# Helsesjekk ${today}`, '', `**${S}** · plugin ${version} · ${((Date.now() - t0) / 1000).toFixed(1)} s`, '')
    report.push('## Regresjonslista', '', '| # | Sjekk | Status | Bevis |', '|---|---|---|---|')
    for (const r of results) report.push(`| ${r.id} | ${r.title} | ${r.status}${changed.includes(r) ? ` (i går: ${prevStatus[r.id]})` : ''} | ${r.bevis} |`)
    report.push('', '## Feilmeldinger siste døgn', '')
    if (!errs.feil.length) report.push('Ingen.')
    for (const e of errs.feil) report.push(`- ${e.kilde} · ${e.mønster} · ${e.antall} ganger · ${fmt(e.første)}–${fmt(e.siste)} · «${e.eksempel}»`)
    report.push('', `Hooks: ${errs.hooks.poster} poster (${Object.entries(errs.hooks.per).map(([k, v]) => `${k} ${v}`).join(', ') || 'ingen'}) · ${errs.utlev} utleveringer · ${errs.commits} commits, ${errs.speilet} filer endret i Tua_tua`)
    report.push('', '## Arkivet', '', `${arkiv.total} atomer · nye siste døgn: ${Object.entries(arkiv.nye).map(([p, n]) => `${p} ${n}`).join(', ') || 'ingen'} · uten S: ${arkiv.utenS} · «---»-titler: ${arkiv.streker} · mulige dobbeltimporter: ${arkiv.dupl} · Dropbox-konflikter: ${arkiv.konflikt}${arkiv.indexN != null ? ` · index.json: ${arkiv.indexN}` : ''} · hooks.jsonl ${arkiv.hooksMb.toFixed(1)} MB`)
    report.push('', '## Ryddeforslag (ikke utført)', '', ...(arkiv.forslag.length ? arkiv.forslag.map((f) => `- ${f}`) : ['Ingen.']))
    if (changed.length) report.push('', '## Siden i går', '', ...changed.map((r) => `- ${r.id} ${r.title}: ${prevStatus[r.id]} → ${r.status}`))
    if (forslagTilErik.length) report.push('', '## Forslag som venter på Erik', '', ...forslagTilErik.map((f) => `- ${f}`))
    const text = report.join('\n')
    // minne (≤ 3 000 tegn)
    const minne = [
      `Helsesjekk — minne (oppdatert ${today})`,
      `Siste status: ${S}`,
      `Rekker (netter grønn på rad): ${results.map((r) => `${r.id} ${state.streak[r.id]}`).join(' · ')}`,
      `Sjekk spesielt i morgen: ${[...red.map((r) => `${r.id} (${clip(r.bevis, 60)})`), ...results.filter((r) => r.status === Y).map((r) => `${r.id} (gul: ${clip(r.bevis, 50)})`)].join('; ') || 'ingenting spesielt'}`,
      `Kjente feilmønstre: ${Object.entries(state.nyeMønstre).map(([k, d]) => `${k} (fra ${d})`).join('; ') || 'R1–R8 fra 20.10.2026'}`,
      `Terskler: stillhet 14 dager (R3) · ny feil ≥ 3 ganger = rød · grønn 14 netter → forslag ukentlig · identisk ryddeforslag 3 netter → forslag automatisering`,
      `Forslag som venter på Erik: ${forslagTilErik.length ? forslagTilErik.map((f) => `• ${f}`).join(' ') : 'ingen'}`,
      `Forslag til endringer i instruksen (docs/rutine-helsesjekk.md): ingen — endres bare etter Eriks ja.`,
    ].join('\n').slice(0, 3000)
    // M — rutinens eget sammendrag (150–400 ord): status, det som er rødt/gult med bevis, feilene, tallene, forslagene, endringene
    const M = [
      `Helsesjekk ${today}: ${S}.`,
      `Regresjonslista: ${results.filter((r) => r.status === G).length} grønne, ${results.filter((r) => r.status === Y).length} gule, ${red.length} røde av ${results.length}.` +
        (red.length ? ` Rødt: ${red.map((r) => `${r.id} ${r.title} — ${clip(r.bevis, 90)}`).join('; ')}.` : '') +
        (results.some((r) => r.status === Y) ? ` Gult: ${results.filter((r) => r.status === Y).map((r) => `${r.id} — ${clip(r.bevis, 70)}`).join('; ')}.` : ''),
      errs.feil.length ? `Feilmeldinger siste døgn: ${errs.feil.slice(0, 4).map((e) => `${e.mønster} i ${e.kilde.replace(/ \(.*\)/, '')} ×${e.antall}`).join('; ')}${errs.feil.length > 4 ? ` (+${errs.feil.length - 4} til)` : ''}.` : 'Ingen feilmeldinger i loggene siste døgn.',
      `Hooks: ${errs.hooks.poster} poster${errs.hooks.feil ? `, ${errs.hooks.feil} feil` : ''}; ${errs.utlev} utleveringer; ${errs.commits} commits speilet som ${errs.speilet} filendringer i Tua_tua.`,
      `Arkivet: ${arkiv.total} atomer, ${nyeN} nye siste døgn${Object.keys(arkiv.nye).length ? ` (${Object.entries(arkiv.nye).map(([p, n]) => `${p} ${n}`).join(', ')})` : ''}; ${arkiv.utenS} uten ingress, ${arkiv.streker} «---»-titler, ${arkiv.dupl} mulige dobbeltimporter, ${arkiv.konflikt} Dropbox-konflikter.`,
      arkiv.forslag.length ? `Ryddeforslag (ikke utført): ${arkiv.forslag.slice(0, 3).map((f) => clip(f, 90)).join('; ')}${arkiv.forslag.length > 3 ? ` (+${arkiv.forslag.length - 3} til)` : ''}.` : 'Ingen ryddeforslag.',
      changed.length ? `Siden i går: ${changed.map((r) => `${r.id} ${prevStatus[r.id]} → ${r.status}`).join(', ')}.` : 'Ingen endring i regresjonslista siden forrige kjøring.',
      forslagTilErik.length ? `Forslag som venter på Erik: ${forslagTilErik.map((f) => clip(f, 110)).join('; ')}.` : 'Ingen forslag venter på Erik.',
    ].join('\n\n').slice(0, 2500)
    if (DRY) { console.log(text); console.log('\n--- M ---\n' + M); console.log('\n--- minne ---\n' + minne); console.log(`\n(dry-run: ingenting skrevet${isRed ? ' — ville skrevet varsel' : ''})`); return }
    const { atom: rapport } = upsert(atoms, { key: `helsesjekk:${today}`, name: `Helsesjekk ${today}`, content: text, project: PROJECT, convo: 'Helsesjekk', source: 'Tua', by: 'regel', kind: 'capture', drift: true, tags: ['helsesjekk', 'auto'], short: clip(S, 300), medium: M, summary: 'Nattlig helsesjekk av Tua: feilmeldinger, regresjonslista R1–R8, arkivets tilstand og ryddeforslag.' })
    upsert(atoms, { key: 'helsesjekk:minne', name: 'Helsesjekk — minne', content: minne, project: PROJECT, convo: 'Helsesjekk', source: 'Tua', by: 'regel', kind: 'capture', drift: true, tags: ['helsesjekk', 'minne'], short: clip(`Minne for helsesjekken. ${S}`, 300), summary: 'Rutinens eget minne: rekker, kjente feil, hva som skal sjekkes i morgen, forslag som venter.' })
    save(atoms)
    fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n')
    if (isRed) fs.writeFileSync(VARSEL(), `${today}: ${S}\n`)
    // Kortet: rutinen kan ikke åpne en samtale selv — den legger igjen en lapp som SessionStart-hooken leser, så første
    // Claude-økt etterpå viser rapporten som Tua-kort (tua_card id=…) én gang. I Desktop-chat: «vis helsesjekken fra i natt».
    try { fs.writeFileSync(path.join(FILES_ROOT, '.tua', 'helsesjekk-siste.json'), JSON.stringify({ date: today, id: rapport.id, S, red: isRed, at: Date.now(), shown: false }, null, 2) + '\n') } catch {}
    console.log(`${S} · rapport «Helsesjekk ${today}» i prosjekt ${PROJECT}${isRed ? ' · varsel skrevet' : ''} · vis som kort: tua_card id=${rapport.id}`)
  } catch (e) {
    // Regel 5: feiler sjekken selv, er det rapporten
    const S = `RØD: helsesjekken feilet — ${clip(e.message, 160)}`
    console.error(S)
    if (DRY) return
    try {
      if (atoms.length || FILES_ROOT) { const a = atoms.length ? atoms : load(); upsert(a, { key: `helsesjekk:${today}`, name: `Helsesjekk ${today}`, content: `# Helsesjekk ${today}\n\n**${S}**\n\n${e.stack || ''}`, project: PROJECT, convo: 'Helsesjekk', source: 'Tua', by: 'regel', kind: 'capture', drift: true, tags: ['helsesjekk', 'auto'], short: clip(S, 300), summary: 'Helsesjekken feilet.' }); save(a) }
      if (FILES_ROOT) fs.writeFileSync(VARSEL(), `${today}: ${S}\n`)
    } catch {}
    process.exitCode = 1
  }
}

// ── launchd ─────────────────────────────────────────────────────────────────
const LABEL = 'com.tuacircles.helsesjekk'
const PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`)
function installLaunchd() {
  if (process.platform !== 'darwin') { console.error('launchd finnes bare på macOS — bruk cron/Task Scheduler her'); process.exitCode = 1; return }
  const logDir = DATA_DIR; fs.mkdirSync(logDir, { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(HERE, 'helsesjekk.js')}</string></array>
  <key>WorkingDirectory</key><string>${PLUGIN}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${path.join(logDir, 'helsesjekk.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(logDir, 'helsesjekk.log')}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin</string><key>HOME</key><string>${HOME}</string></dict>
</dict></plist>
`
  fs.mkdirSync(path.dirname(PLIST), { recursive: true })
  fs.writeFileSync(PLIST, plist)
  const uid = os.userInfo().uid
  spawnSync('launchctl', ['bootout', `gui/${uid}`, PLIST], { stdio: 'ignore' })
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST], { encoding: 'utf8' })
  if (r.status !== 0) { console.error(`launchctl bootstrap feilet: ${r.stderr || r.stdout}`); process.exitCode = 1; return }
  console.log(`launchd-jobben ${LABEL} er lagt inn: hver natt kl. 03:30 (${PLIST}).\nLogg: ${path.join(logDir, 'helsesjekk.log')} · kjør nå: launchctl kickstart gui/${uid}/${LABEL} · fjern: node server/helsesjekk.js --uninstall-launchd`)
}
function uninstallLaunchd() {
  const uid = os.userInfo().uid
  spawnSync('launchctl', ['bootout', `gui/${uid}`, PLIST], { stdio: 'ignore' })
  try { fs.unlinkSync(PLIST) } catch {}
  console.log(`launchd-jobben ${LABEL} er fjernet.`)
}

main()
