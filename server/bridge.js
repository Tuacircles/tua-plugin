#!/usr/bin/env node
// bridge.js — Tua-kartet som egen lokal app (M12): én prosess som både serverer
// kartet (ferdigbygd fra tua2-sandbox/dist) og er broen til det EKTE arkivet
// (mappa ~/Dropbox/Tua, samme som MCP-serveren bruker).
//
//   GET  /                     → kartet (dist/kart.html)   · GET /index.html → hele sandkassen
//   GET  /assets/*             → bygde filer
//   GET  /api/atoms?offset&limit → { atoms, total, file }   (hvert atom har `links` ferdig utregnet + `file`)
//   GET  /api/search?q&context&project&limit&offset → { hits, total }  rangert: tittel/S > M > L (M12)
//   POST /api/link   {id, project, level?}   → gjør atomet synlig i prosjektet (referanse), valgfritt nivå S/M/L;
//                                        kall igjen med level for å endre nivået på en eksisterende referanse
//   POST /api/unlink {id, project}   → fjerner referansen
//   Passord (valgfritt): `node bridge.js --sett-passord` setter et passord (scrypt-hash i <arkiv>/.tua/passord.json).
//   Da krever alt — kartet og /api/* — innlogging på /logg-inn (HttpOnly-cookie, 30 dager). `--fjern-passord` fjerner det.
//   Uten passord er alt åpent som før, men bare for programmer på denne maskinen (127.0.0.1).
//   POST /api/save   {content, name?, source?, project?, convo?, summary?, short?, medium?, tags?, key?}
//                    → M11: lagrer et atom i mappa (Demo 7 «fang» over det ekte arkivet). S/M merkes menneskeskrevet.
//   POST /api/open   {id, target, href?}      → M9/V13: åpner LOKALT, bare fra en fast liste:
//        target = 'finder' → `open -R <fil>`  (fila må være atomets egen .md eller en av atomets file-lenker)
//        target = 'code'   → `open claude-cli://open?cwd=<repo>&q=…`  (repo må være en repo-lenke på atomet / i prosjektregisteret)
//        Ingen andre programmer, ingen shell, ingen frie stier. `claude://`-lenker (Desktop-prosjekt) åpnes
//        rett fra nettleseren og går aldri via broen.
//   GET  /innstillinger          → innstillinger-siden (M15): arkivsted, sky-connectors, AI-connectors (BYOK), Finder-mapper
//   GET  /api/settings           → { arkiv, steder, sky, ai, finder, trust } — aldri nøkkelverdier, bare «satt / ikke satt»
//   POST /api/settings {arkiv: {sted|sti}} | {finder: {folders}}  → velger arkivsted (flytter ingenting, V9) / Finder-mapper. Samme ~/.tua/config.json som tua_setup.
//   POST /api/keychain {provider, key}   → nøkkelen inn i macOS Keychain (security, uten shell, via stdin — aldri fil, aldri logg)
//   DELETE /api/keychain {provider}      → nøkkelen ut av Keychain
//   Trust Score per connector leses fra trust-scores.json (anslag — rettes der, uten kode).
//
// Lytter kun på 127.0.0.1, og slipper bare kartets origin inn (CORS).
// Kjør: npm run bridge   (i tua-plugin/). Ingen avhengigheter.
// TUA_OPEN_DRYRUN=1 → /api/open svarer med hva den ville kjørt, uten å kjøre det (test).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { openSpawn, FILE_MANAGER } from './platform.js'   // M18: «Åpne i …» på macOS, Windows og Linux
import os from 'node:os'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { load, save, setShare, upsert, search, FILE, FILES_ROOT, DATA_DIR, filesMode, linksFor, fileOf, ensureArchive, archiveOptions, archiveInfo, chooseArchive, finderFolders, FINDER_DEFAULTS, setFinderFolders, CONFIG_FILE } from './store.js'
import { watchInbox, watchDesktop } from './import.js'      // M14: Innboks — eksporter som legges i mappa blir atomer · M17: Desktop-cachen
import { watchFinder } from './finder.js'                   // M17: dokumenter med AI-opphav, ved referanse
import { PROVIDERS, isProvider, keyStatus, setKey, deleteKey, ollamaStatus } from './keychain.js'   // M15: BYOK — nøkler i Keychain, aldri her
ensureArchive()                                             // M14: første kjøring — lag arkivet om det ikke finnes
const ARKIV = () => (filesMode() ? FILES_ROOT : FILE)
// M15: Trust Score per connector — én JSON-fil, leses ved hvert kall så rettelser virker uten omstart.
const TRUST_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'trust-scores.json')
const trustScores = () => { try { return JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8')) } catch (e) { return { _merk: `trust-scores.json kunne ikke leses: ${e.message}`, sky: {}, ai: {} } } }
const countMd = (dir, depth = 2) => {   // hvor mange atomer (.md) ligger i en mappe — for «hva ville skjedd» ved bytte av arkivsted
  let n = 0
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'Innboks') continue; if (e.isFile() && e.name.endsWith('.md')) n++; else if (e.isDirectory() && depth > 0) n += countMd(path.join(dir, e.name), depth - 1) } } catch {}
  return n
}
async function settingsView() {
  const ts = trustScores()
  const info = archiveInfo()
  const steder = archiveOptions().map((o) => ({ id: o.id, label: o.label, path: o.path, base: o.base, available: o.available, exists: o.exists, current: !!info.root && info.root === o.path, atomer: o.exists ? countMd(o.path) : 0 }))
  const sky = ['icloud', 'dropbox', 'onedrive', 'googledrive'].map((id) => { const s = steder.find((x) => x.id === id); return { id, label: s.label, available: s.available, isArchive: s.current, trust: ts.sky?.[id] || null } })
  const keys = keyStatus(), ollama = await ollamaStatus()
  const ai = PROVIDERS.map((p) => ({ id: p.id, label: p.label, hint: p.hint, local: !!p.local, satt: p.local ? ollama.running : !!keys[p.id], ...(p.local ? { ollama } : {}), trust: ts.ai?.[p.id] || null }))
  return {
    arkiv: { ...info, atomer: info.exists ? countMd(info.root) : 0, config: CONFIG_FILE },
    steder, sky, ai,
    finder: { folders: finderFolders(), standard: FINDER_DEFAULTS(), home: os.homedir() },
    trust: { merk: ts._merk || '', om: ts._om || '' },
    platform: process.platform,
  }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
// npm run build:kart. Kartet bygges fra tua2-sandbox i Tua-repoet (ved siden av tua-plugin/); utenfor repoet: sett TUA_KART_DIST.
const DIST = process.env.TUA_KART_DIST || [path.join(HERE, '..', '..', 'tua2-sandbox', 'dist'), path.join(HERE, '..', 'tua2-sandbox', 'dist')].find((p) => fs.existsSync(p)) || path.join(HERE, '..', '..', 'tua2-sandbox', 'dist')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.map': 'application/json', '.ico': 'image/x-icon' }

const PORT = Number(process.env.TUA_BRIDGE_PORT || 5274)
const ORIGIN = process.env.TUA_BRIDGE_ORIGIN || 'http://localhost:5273'
const DRYRUN = process.env.TUA_OPEN_DRYRUN === '1'
const same = (x, y) => String(x).toLowerCase() === String(y).toLowerCase()

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

// ── Passord og innlogging ───────────────────────────────────────────────────
// Passordet lagres bare som scrypt-hash (salt + hash) — aldri i klartekst. Sesjoner er
// tilfeldige tokens; serveren husker sha256 av dem i .tua/sesjoner.json (overlever omstart).
const TUA_DIR = filesMode() ? path.join(FILES_ROOT, '.tua') : DATA_DIR
const AUTH_FILE = path.join(TUA_DIR, 'passord.json')
const SESS_FILE = path.join(TUA_DIR, 'sesjoner.json')
const SESS_DAYS = 30
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }) }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const hashPw = (pw, salt) => crypto.scryptSync(String(pw).normalize('NFKC'), salt, 32).toString('hex')
export const passwordSet = () => fs.existsSync(AUTH_FILE)
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  writeJson(AUTH_FILE, { salt, hash: hashPw(pw, salt), satt: new Date().toISOString() })
  writeJson(SESS_FILE, {})                                     // alle gamle sesjoner ut
}
function checkPassword(pw) {
  const a = readJson(AUTH_FILE, null)
  if (!a) return true
  const h = Buffer.from(hashPw(pw, a.salt), 'hex'), e = Buffer.from(a.hash, 'hex')
  return h.length === e.length && crypto.timingSafeEqual(h, e)
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]))
function isAuthed(req) {
  if (!passwordSet()) return true
  const tok = cookies(req).tua_sesjon
  if (!tok) return false
  const s = readJson(SESS_FILE, {})[sha(tok)]
  return !!s && Date.now() - s.at < SESS_DAYS * 864e5
}
function newSession() {
  const tok = crypto.randomBytes(32).toString('base64url')
  const all = readJson(SESS_FILE, {})
  for (const k of Object.keys(all)) if (Date.now() - all[k].at > SESS_DAYS * 864e5) delete all[k]
  all[sha(tok)] = { at: Date.now() }
  writeJson(SESS_FILE, all)
  return tok
}
function endSession(req) {
  const tok = cookies(req).tua_sesjon
  if (!tok) return
  const all = readJson(SESS_FILE, {}); delete all[sha(tok)]; writeJson(SESS_FILE, all)
}
const SESSION_COOKIE = (tok) => `tua_sesjon=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESS_DAYS * 86400}`
const CLEAR_COOKIE = 'tua_sesjon=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
let failedAttempts = 0                                          // bremser gjetting: 400 ms × antall feil (nullstilles ved riktig)
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')
const loginPage = (msg = '', next = '/') => `<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tua — logg inn</title>
<body style="margin:0;background:#F5F3EE;font-family:Georgia,serif;color:#1A1A1A"><form method="post" action="/api/login" style="max-width:380px;margin:12vh auto;background:#fff;border:1px solid #BFBFBF;border-radius:12px;padding:28px 30px">
<div style="font:700 10px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#C04A38">Tua · kartet</div>
<h1 style="font-size:22px;color:#1F3864;margin:10px 0 6px">Logg inn</h1><p style="margin:0 0 16px;font-size:13.5px;color:#595959">Arkivet ditt er låst med passord. Det forlater aldri denne maskinen.</p>
${msg ? `<p style="margin:0 0 12px;font-size:13px;color:#C04A38">${msg}</p>` : ''}
<input type="hidden" name="next" value="${next.replace(/"/g, '&quot;')}"><input name="passord" type="password" autocomplete="current-password" autofocus required style="width:100%;box-sizing:border-box;font:15px Georgia,serif;padding:10px 12px;border:1px solid #BFBFBF;border-radius:8px">
<button style="margin-top:12px;width:100%;font:700 13px ui-monospace,monospace;color:#fff;background:#1F3864;border:0;border-radius:8px;padding:11px;cursor:pointer">Logg inn</button>
<p style="margin:16px 0 0;font-size:11.5px;color:#8C8C8C">Glemt? Sett nytt i terminalen: <code>node tua-plugin/server/bridge.js --sett-passord</code></p></form></body></html>`
const html = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(body) }
const redirect = (res, to, extra = {}) => { res.writeHead(303, { Location: to, ...extra }); res.end() }
const readForm = async (req) => {
  const raw = await new Promise((resolve, reject) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy() }); req.on('end', () => resolve(d)); req.on('error', reject) })
  if ((req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(raw || '{}') } catch { return {} } }
  return Object.fromEntries(new URLSearchParams(raw))
}

// CLI: --sett-passord (spør to ganger, skjult) · --fjern-passord
async function promptHidden(q) {
  if (process.env.TUA_KART_PASSORD) return process.env.TUA_KART_PASSORD        // for skript/test
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  process.stderr.write(q)
  rl._writeToOutput = () => {}
  return new Promise((resolve) => rl.question('', (v) => { rl.close(); process.stderr.write('\n'); resolve(v) }))
}
if (process.argv.includes('--fjern-passord')) {
  try { fs.unlinkSync(AUTH_FILE) } catch {}
  try { fs.unlinkSync(SESS_FILE) } catch {}
  console.error('Passordet er fjernet — kartet er åpent igjen (bare for denne maskinen).'); process.exit(0)
}
if (process.argv.includes('--sett-passord')) {
  const a = await promptHidden('Nytt passord (minst 8 tegn): ')
  if (a.length < 8) { console.error('For kort — minst 8 tegn.'); process.exit(1) }
  const b = process.env.TUA_KART_PASSORD ? a : await promptHidden('Gjenta: ')
  if (a !== b) { console.error('Passordene er ikke like.'); process.exit(1) }
  setPassword(a)
  console.error(`Passord satt (${AUTH_FILE}). Alle sesjoner er logget ut. Start broen: npm run kart`); process.exit(0)
}
const json = (res, code, body, extra = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })

// ── /api/open: fast liste (V13) ────────────────────────────────────────────
// spawn med argv — aldri shell. Returnerer { ok, ran } eller kaster med forklaring.
// M18: macOS open · Windows explorer/rundll32 · Linux xdg-open — se platform.js
const run = (kind, target) => openSpawn(kind, target, { dryrun: DRYRUN })
const realpath = (p) => { try { return fs.realpathSync(p) } catch { return null } }
function openTarget(a, target, href) {
  const links = linksFor(a)
  if (target === 'finder') {
    // Lov: atomets egen fil, eller en file-lenke som står på atomet. Må finnes.
    const allowed = [fileOf(a), ...links.filter((l) => l.kind === 'file').map((l) => l.href), ...(a.renders || []).map((r) => r.path)].filter(Boolean).map(realpath).filter(Boolean)
    const want = realpath(href || fileOf(a))
    if (!want || !allowed.includes(want)) throw new Error(`${FILE_MANAGER}: stien er ikke en av atomets egne filer`)
    return run('reveal', want)
  }
  if (target === 'code') {
    // Lov: en repo-lenke på atomet (eller fra prosjektregisteret). Må være en mappe.
    const repos = links.filter((l) => l.kind === 'repo').map((l) => realpath(l.href)).filter((p) => p && fs.statSync(p).isDirectory())
    const cwd = href ? realpath(href) : repos[0]
    if (!cwd || !repos.includes(cwd)) throw new Error('Code: mappa er ikke en repo-lenke på atomet')
    const q = `Hent atom ${a.id} («${a.name}») fra Tua med tua_get(level=M) og fortsett derfra.`
    return run('url', `claude-cli://open?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`)
  }
  throw new Error(`ukjent target «${target}» — broen åpner bare finder og code (V13)`)
}

// Statisk: kartet og sandkassen fra dist/. Ingen stier utenfor dist (realpath-sjekk).
function serveStatic(res, pathname) {
  let rel = pathname === '/' || pathname === '/kart' ? '/kart.html' : pathname === '/sandkasse' ? '/index.html' : pathname === '/innstillinger' ? '/innstillinger.html' : pathname === '/forside' ? '/forside.html' : pathname
  const abs = path.normalize(path.join(DIST, rel))
  if (!abs.startsWith(DIST + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    if (!fs.existsSync(path.join(DIST, 'kart.html'))) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><meta charset="utf-8"><title>Tua — Kartet</title><body style="font-family:Georgia;padding:40px;color:#1A1A1A"><h1 style="color:#1F3864">Kartet er ikke bygget ennå</h1><p>Kjør <code>cd tua-plugin && npm run kart</code> (bygger kartet og starter broen), så last siden på nytt.</p><p>Broen svarer uansett på <code>/api/*</code>.</p></body>')
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ikke funnet')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache' })
  fs.createReadStream(abs).pipe(res)
}
const num = (v, d) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d }

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    try {
      // ── innlogging ──
      if (url.pathname === '/logg-inn') return passwordSet() ? html(res, 200, loginPage('', safeNext(url.searchParams.get('next')))) : redirect(res, '/')
      if (url.pathname === '/logg-ut') { endSession(req); return redirect(res, passwordSet() ? '/logg-inn' : '/', { 'Set-Cookie': CLEAR_COOKIE }) }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const b = await readForm(req)
        if (failedAttempts) await new Promise((r) => setTimeout(r, Math.min(5000, 400 * failedAttempts)))
        if (!checkPassword(b.passord || '')) {
          failedAttempts++
          console.error(`[tua-bro] feil passord (${failedAttempts})`)
          return (req.headers.accept || '').includes('text/html') ? html(res, 401, loginPage('Feil passord.', safeNext(b.next))) : json(res, 401, { error: 'feil passord' })
        }
        failedAttempts = 0
        const tok = newSession()
        console.error('[tua-bro] innlogget')
        return (req.headers.accept || '').includes('text/html') ? redirect(res, safeNext(b.next), { 'Set-Cookie': SESSION_COOKIE(tok) }) : json(res, 200, { ok: true }, { 'Set-Cookie': SESSION_COOKIE(tok) })
      }
      if (!isAuthed(req)) {
        if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'ikke logget inn', login: '/logg-inn' })
        if (url.pathname.startsWith('/assets/')) return serveStatic(res, url.pathname)       // css/js er ikke hemmelig; siden uten data
        return redirect(res, `/logg-inn?next=${encodeURIComponent(url.pathname + url.search)}`)
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname)
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        const all = load().sort((x, y) => y.capturedAt - x.capturedAt)
        const offset = num(url.searchParams.get('offset'), 0), limit = num(url.searchParams.get('limit'), all.length)
        const atoms = all.slice(offset, offset + limit).map((a) => ({ ...a, links: linksFor(a), file: fileOf(a) }))   // lenker regnes ut ved lesing, lagres ikke her
        return json(res, 200, { atoms, total: all.length, offset, file: ARKIV() })
      }
      if (req.method === 'GET' && url.pathname === '/api/search') {
        const q = url.searchParams.get('q') || ''
        const hits = search(load(), q, {
          context: url.searchParams.get('context') || undefined, project: url.searchParams.get('project') || undefined,
          limit: num(url.searchParams.get('limit'), 50), offset: num(url.searchParams.get('offset'), 0),
        })
        return json(res, 200, {
          q, total: hits.total, offset: num(url.searchParams.get('offset'), 0),
          hits: hits.map(({ atom: a, S, max, score, snippet }) => ({ id: a.id, name: a.name, project: a.project, convo: a.convo, source: a.source, capturedAt: a.capturedAt, version: a.version || 1, S: S.text, sLevel: S.level, max, score, snippet })),
        })
      }
      if (req.method === 'POST' && url.pathname === '/api/save') {
        const b = await readBody(req)
        if (!b.content || !String(b.content).trim()) return json(res, 400, { error: 'content kreves' })
        const atoms = load()
        const { atom, status } = upsert(atoms, {
          content: String(b.content), name: b.name, source: b.source || 'Claude', project: b.project, convo: b.convo,
          summary: b.summary, short: b.short, medium: b.medium, tags: Array.isArray(b.tags) ? b.tags : [], key: b.key || undefined, by: 'menneske',
        })
        if (status !== 'uendret') save(atoms)
        console.error(`[tua-bro] save ${status} «${atom.name}» ← ${atom.source} · ${atom.project}`)
        return json(res, 200, { atom: { ...atom, links: linksFor(atom), file: fileOf(atom) }, status })
      }
      if (req.method === 'POST' && url.pathname === '/api/open') {
        const { id, target, href } = await readBody(req)
        if (!id || !target) return json(res, 400, { error: 'id og target kreves' })
        const a = load().find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${id}` })
        try {
          const r = await openTarget(a, target, href)
          console.error(`[tua-bro] open ${target} «${a.name}»${DRYRUN ? ' (dryrun)' : ''}: ${r.ran.join(' ')}`)
          return json(res, 200, r)
        } catch (e) {
          console.error(`[tua-bro] open ${target} «${a.name}» AVVIST: ${e.message}`)
          return json(res, 403, { error: e.message })
        }
      }
      // ── M15: innstillinger ──
      if (req.method === 'GET' && url.pathname === '/api/settings') return json(res, 200, await settingsView())
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const b = await readBody(req)
        if (b.arkiv && (b.arkiv.sted || b.arkiv.sti)) {
          // Bytte av arkivsted: valget lagres og mappa lages om den ikke finnes. INGEN filer flyttes (V9) — det gjør brukeren i Finder.
          const before = archiveInfo().root
          let r
          try { r = chooseArchive(b.arkiv.sti || b.arkiv.sted) } catch (e) { return json(res, 400, { error: e.message }) }
          console.error(`[tua-bro] arkivsted ${r.created ? 'opprettet' : 'valgt'}: ${r.root} (${r.label})${before && before !== r.root ? ` — før: ${before}; ingenting flyttet` : ''}`)
          return json(res, 200, { ok: true, arkiv: archiveInfo(), created: r.created, before, restart: before !== r.root })
        }
        if (b.finder && Array.isArray(b.finder.folders)) {
          try { const list = setFinderFolders(b.finder.folders); console.error(`[tua-bro] Finder-mapper: ${list.join(' · ')}`); return json(res, 200, { ok: true, folders: list, restart: true }) } catch (e) { return json(res, 400, { error: e.message }) }
        }
        return json(res, 400, { error: 'send {arkiv: {sted|sti}} eller {finder: {folders: [...]}}' })
      }
      if (url.pathname === '/api/keychain' && (req.method === 'POST' || req.method === 'DELETE')) {
        const { provider, key } = await readBody(req)
        if (!isProvider(provider)) return json(res, 400, { error: `ukjent leverandør — en av ${PROVIDERS.filter((p) => !p.local).map((p) => p.id).join(', ')}` })
        if (req.method === 'DELETE') { const ok = deleteKey(provider); console.error(`[tua-bro] keychain ${provider}: ${ok ? 'fjernet' : 'fantes ikke'}`); return json(res, 200, { ok, provider, satt: false }) }
        try { await setKey(provider, key) } catch (e) { return json(res, 400, { error: e.message }) }   // nøkkelen logges aldri — bare leverandøren
        console.error(`[tua-bro] keychain ${provider}: satt`)
        return json(res, 200, { ok: true, provider, satt: true })
      }
      const isLink = url.pathname === '/api/link'
      if (req.method === 'POST' && (isLink || url.pathname === '/api/unlink')) {
        const { id, project, level } = await readBody(req)
        if (!id || !project) return json(res, 400, { error: 'id og project kreves' })
        if (level && !['S', 'M', 'L'].includes(level)) return json(res, 400, { error: 'level må være S, M eller L' })
        const atoms = load()
        const a = atoms.find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${id}` })
        const p = String(project).trim()
        a.refs = a.refs || []
        if (isLink) {
          if (same(a.project, p)) return json(res, 200, { atom: a })      // oppsto her — ser alt
          if (!a.refs.some((r) => same(r, p))) a.refs.push(p)
          if (level) setShare(a, p, level)                                 // nivå bor på referansen (V11)
        } else {
          a.refs = a.refs.filter((r) => !same(r, p))
          setShare(a, p, 'L')
        }
        save(atoms)
        console.error(`[tua-bro] ${isLink ? 'link' : 'unlink'} «${a.name}» ${isLink ? '→' : '⤫'} ${p}${level ? ` (${level})` : ''}`)
        return json(res, 200, { atom: a })
      }
      return json(res, 404, { error: 'ukjent rute' })
    } catch (e) {
      return json(res, 500, { error: String(e?.message || e) })
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    const built = fs.existsSync(path.join(DIST, 'kart.html'))
    console.error(`[tua-bro] kartet: http://127.0.0.1:${PORT}/${built ? '' : ' (ikke bygget — npm run kart)'} · innstillinger: http://127.0.0.1:${PORT}/innstillinger · arkiv: ${ARKIV()} · ${passwordSet() ? 'passord: på (logg inn på /logg-inn)' : 'passord: AV — sett med «node bridge.js --sett-passord»'} · dev-origin: ${ORIGIN}${DRYRUN ? ' · DRYRUN' : ''}`)
    const log = (m) => console.error(`[tua-bro] ${m}`)
    watchInbox({ log }); watchDesktop({ log, delayMs: 8000 }); watchFinder({ log })     // M17: samme vakter som MCP-serveren; fil-låsen i save() holder dem fra hverandre
  })
