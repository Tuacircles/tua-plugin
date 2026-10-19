// finder.js — Finder-connectoren (M17): dokumenter på disk som kom fra AI, indeksert VED REFERANSE.
//
// Mapper: Nedlastinger, Dokumenter, Skrivebord (brukeren velger i M15; `finder.folders` i ~/.tua/config.json overstyrer).
// To kriterier, begge må kunne begrunnes i noe konkret — «alt i Nedlastinger» er ikke AI-output:
//   1. OPPHAV: Spotlight-feltet kMDItemWhereFroms peker på et AI-domene (chatgpt.com, oaiusercontent.com, claude.ai, …).
//      ChatGPT-nedlastinger har også samtale-adressen (chatgpt.com/c/<id>) der → kobles til samtale-atomet når det finnes.
//      claude.ai-nedlastinger mangler WhereFroms på Eriks maskin (arbeidsstykke 23) — derfor kriterium 2.
//   2. INNHOLD: sha256 av fila er lik sha256 av noe Claude har skrevet — create_file-innhold i Desktop-cachen, Write-innhold
//      i Code-økter, eller en fil i en Cowork-økts outputs/-mappe. Bare filer med samme STØRRELSE som noe kjent hashes.
// Atomet er en peker: kind «capture», `file`-lenke til fila, teksten som L når den er lesbar (md/txt/csv/json/html), ellers
// en kort beskrivelse. Aldri kopi, aldri flytting, aldri sletting. Nøkkel fil:<sti> — samme som hooks og Code-importen.
// Tilstand (hash per sti+størrelse+mtime) i den lokale datamappa, ikke i arkivet.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { load, save, upsert, DATA_DIR, FILES_ROOT, filesMode, ensureArchive, noteImport, finishOnboarding, S_MAX, SHORT_L } from './store.js'
import { COWORK_ROOT, listCodeSessions, parseCodeSession, projectOfCwd, ruleS, titleOf, firstPara } from './import.js'
import { HOME, IS_MAC, IS_WIN, zoneIdentifierUrls, posix } from './platform.js'   // M18: Windows-opphav via Zone.Identifier
export const AI_DOMAINS = {
  'chatgpt.com': 'ChatGPT', 'oaiusercontent.com': 'ChatGPT', 'openai.com': 'ChatGPT',
  'claude.ai': 'Claude', 'downloads.claude.ai': 'Claude', 'anthropic.com': 'Claude',
  'gemini.google.com': 'Gemini', 'perplexity.ai': 'Perplexity', 'copilot.microsoft.com': 'Copilot', 'chat.mistral.ai': 'Mistral', 'grok.com': 'Grok',
}
export const DEFAULT_FOLDERS = () => {
  try { const c = JSON.parse(fs.readFileSync(path.join(HOME, '.tua', 'config.json'), 'utf8')); if (Array.isArray(c.finder?.folders) && c.finder.folders.length) return c.finder.folders } catch {}
  return ['Downloads', 'Documents', 'Desktop'].map((d) => path.join(os.homedir(), d))
}
const DOC_EXT = /\.(pdf|docx?|pptx?|xlsx?|md|markdown|txt|rtf|html?|csv|json|png|jpe?g|svg)$/i
const TEXT_EXT = /\.(md|markdown|txt|csv|json|html?)$/i
const SKIP_DIR = /^(node_modules|\.git|Library|\.Trash)$|\.(app|photoslibrary|bundle|framework|xcodeproj)$/i
const MAX_SIZE = 50e6, MAX_TEXT = 300_000, MAX_DEPTH = 3
const STATE = () => path.join(DATA_DIR, 'finder-state.json')
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')) } catch { return { files: {} } } }
const writeState = (s) => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE(), JSON.stringify(s) + '\n') } catch {} }
const sha256File = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') } catch { return null } }
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const iso = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '')
const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} B`)

// ── kriterium 1: opphav ─────────────────────────────────────────────────────
// macOS: Spotlight-feltet kMDItemWhereFroms (mdfind finner kandidatene, mdls leser adressene).
// Windows: NTFS-strømmen Zone.Identifier (HostUrl/ReferrerUrl) som nettlesere skriver på nedlastinger — leses per fil.
// Linux: ingen standard for opphav; bare kriterium 2 (innhold) gjelder der.
const domainOf = (url) => { try { const h = new URL(url).hostname; return Object.keys(AI_DOMAINS).find((d) => h === d || h.endsWith('.' + d)) || null } catch { return null } }
export function whereFroms(file) {
  if (IS_WIN) return zoneIdentifierUrls(file)
  if (!IS_MAC || process.platform !== 'darwin') return []
  const r = spawnSync('mdls', ['-name', 'kMDItemWhereFroms', '-raw', file], { encoding: 'utf8' })
  if (r.status !== 0) return []
  return [...new Set((r.stdout.match(/https?:\/\/[^\s"',)]+/g) || []))]
}
const asCandidate = (p, urls) => {
  const dom = urls.map(domainOf).find(Boolean)
  const convo = urls.find((u) => /chatgpt\.com\/c\/[0-9a-f-]+/.test(u)) || urls.find((u) => /claude\.ai\/chat\/[0-9a-f-]+/.test(u)) || null
  return { path: p, criterion: 'opphav', origin: dom ? AI_DOMAINS[dom] : 'AI', domain: dom, urls, convo }
}
const wantedFile = (p) => { const q = posix(p); return DOC_EXT.test(q) && !/\/manifest-[0-9a-f-]+\.json$/.test(q) && !/\.dmg$/i.test(q) }
export function originCandidates(folder) {
  if (IS_WIN) return walkFolders([folder]).map((f) => f.path).filter(wantedFile).map((p) => asCandidate(p, zoneIdentifierUrls(p))).filter((c) => c.domain)
  if (!IS_MAC || process.platform !== 'darwin') return []
  const q = Object.keys(AI_DOMAINS).map((d) => `kMDItemWhereFroms == '*${d}*'`).join(' || ')
  const r = spawnSync('mdfind', ['-onlyin', folder, q], { encoding: 'utf8', maxBuffer: 50e6 })
  if (r.status !== 0) return []
  return r.stdout.split('\n').filter((p) => p && wantedFile(p)).map((p) => asCandidate(p, whereFroms(p))).filter((c) => c.domain)
}

// ── kriterium 2: innhold (sha256 mot det Claude har skrevet) ────────────────
// Kjent innhold indekseres etter STØRRELSE først; hash regnes bare når en fil i mappene har samme størrelse.
export function knownContent({ desktop = null, log = () => {} } = {}) {
  const bySize = new Map()                                     // størrelse → [{sha?, text?, file?, label, origin, project, convo}]
  const add = (size, item) => { if (!bySize.has(size)) bySize.set(size, []); bySize.get(size).push(item) }
  const addText = (text, item) => { const t = String(text); add(Buffer.byteLength(t), { ...item, text: t }); if (!t.endsWith('\n')) add(Buffer.byteLength(t) + 1, { ...item, text: t + '\n' }) }
  let n = 0
  // Desktop-cachen: create_file-innhold + artifacts, per samtale
  for (const c of desktop?.convs || []) for (const a of c.artifacts || []) if (a.content) { addText(a.content, { label: a.title, origin: 'Claude Desktop', project: c.project, convo: c.title, href: c.href }); n++ }
  // Code-økter: Write-innhold
  for (const s of listCodeSessions()) { try { const p = parseCodeSession(s.file); for (const [fp, content] of p.files) { addText(content, { label: path.basename(fp), origin: 'Claude Code', project: projectOfCwd(p.cwd), convo: p.convo }); n++ } } catch {} }
  // Cowork: filene i outputs/ (det Cowork skrev) — hashes lat
  const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) } catch { return [] } }
  const walkOut = (dir, depth, item) => {
    if (depth > 4) return
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIR.test(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walkOut(p, depth + 1, item)
      else if (e.isFile() && DOC_EXT.test(e.name)) { try { const st = fs.statSync(p); if (st.size > 0 && st.size <= MAX_SIZE) { add(st.size, { ...item, file: p, label: e.name }); n++ } } catch {} }
    }
  }
  for (const acct of dirs(COWORK_ROOT)) for (const room of dirs(acct)) for (const sess of dirs(room).filter((p) => path.basename(p).startsWith('local_'))) {
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(sess + '.json', 'utf8')) } catch {}
    const folder = Array.isArray(meta.userSelectedFolders) && meta.userSelectedFolders[0] ? String(meta.userSelectedFolders[0]) : ''
    walkOut(path.join(sess, 'outputs'), 0, { origin: 'Claude Cowork', project: folder ? projectOfCwd(folder) : 'Cowork', convo: meta.title ? String(meta.title) : '' })
  }
  log(`Finder: ${n} kjente innhold (create_file i Desktop-cachen, Write i Code-økter, Cowork outputs/) fordelt på ${bySize.size} størrelser`)
  return bySize
}
const hashOf = (item) => { if (item.sha) return item.sha; item.sha = item.text != null ? sha256(item.text) : sha256File(item.file); return item.sha }

// Alle dokumentfiler i mappene (grunt: maks 3 nivåer, ikke pakker/skjulte)
export function walkFolders(folders) {
  const out = []
  const walk = (dir, folder, depth) => {
    if (depth > MAX_DEPTH) return
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIR.test(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, folder, depth + 1)
      else if (e.isFile() && DOC_EXT.test(e.name)) { try { const st = fs.statSync(p); if (st.size > 0 && st.size <= MAX_SIZE) out.push({ path: p, folder, size: st.size, mtime: st.mtimeMs }) } catch {} }
    }
  }
  for (const f of folders) walk(f, f, 0)
  return out
}
export function contentCandidates(folders, known, { state = readState() } = {}) {
  const out = []
  const files = state.files || (state.files = {})
  for (const f of walkFolders(folders)) {
    const items = known.get(f.size)
    if (!items?.length) continue
    const prev = files[f.path]
    const sha = prev && prev.size === f.size && prev.mtime === f.mtime ? prev.sha : sha256File(f.path)
    if (!sha) continue
    files[f.path] = { size: f.size, mtime: f.mtime, sha }
    const hit = items.find((it) => !(it.file && path.resolve(it.file) === path.resolve(f.path)) && hashOf(it) === sha)
    if (hit) out.push({ path: f.path, folder: f.folder, criterion: 'innhold', origin: hit.origin, known: hit, convo: hit.href || null })
  }
  return out
}

// ── alt sammen → atomer ─────────────────────────────────────────────────────
export function findCandidates({ folders = DEFAULT_FOLDERS(), desktop = null, log = () => {} } = {}) {
  const real = folders.filter((f) => { try { return fs.statSync(f).isDirectory() } catch { return false } })
  const byPath = new Map()
  for (const f of real) for (const c of originCandidates(f)) byPath.set(c.path, { ...c, folder: f })
  const state = readState()
  const known = knownContent({ desktop, log })
  for (const c of contentCandidates(real, known, { state })) {
    const prev = byPath.get(c.path)
    if (prev) { prev.criterion = 'opphav+innhold'; prev.known = c.known; prev.convo = prev.convo || c.convo } else byPath.set(c.path, c)
  }
  writeState(state)
  return { candidates: [...byPath.values()].filter((c) => !insideArchive(c.path)), folders: real }
}
const insideArchive = (p) => { if (!filesMode()) return false; const r = path.relative(FILES_ROOT, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r) }
// Filer inne i et git-repo er Claude Codes domene (hooks + Code-importen, nøkkel fil:<sti>) — ikke Finder-connectorens
const insideRepo = (p) => { let d = path.dirname(p); for (let i = 0; i < 8 && d && d !== path.dirname(d); i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, '.git'))) return true; return false }
export function countFinderCandidates({ desktop = null, quick = false } = {}) {
  try {
    const atoms = load()
    const list = quick ? DEFAULT_FOLDERS().filter((f) => fs.existsSync(f)).flatMap((f) => originCandidates(f)) : findCandidates({ desktop }).candidates
    return list.filter((c) => !insideRepo(c.path) && !insideArchive(c.path) && !atoms.some((a) => a.key === `fil:${c.path}`)).length
  } catch { return 0 }
}

export function scanFinder({ dryRun = false, log = () => {}, folders = null, desktop = null, minChars = SHORT_L } = {}) {
  const t0 = Date.now()
  const { candidates, folders: real } = findCandidates({ folders: folders || DEFAULT_FOLDERS(), desktop, log })
  const atoms = load()
  const stats = { kandidater: candidates.length, nye: 0, oppdatert: 0, uendret: 0, lesbare: 0, koblet: 0, repo: 0, alleredeITua: 0, feil: 0 }
  const perFolder = {}
  const convAtom = (url) => {
    if (!url) return null
    const id = (url.match(/\/(?:c|chat)\/([0-9a-f-]+)/) || [])[1]
    return id ? atoms.find((a) => a.key === `samtale:${id}`) || null : null
  }
  for (const c of candidates) {
    try {
      if (insideRepo(c.path)) { stats.repo++; continue }                                                   // Claude Codes domene
      const old = atoms.find((a) => a.key === `fil:${c.path}`)
      if (old && !(old.tags || []).includes('finder')) { stats.alleredeITua++; continue }                 // lagret av hook/Code-import — rør ikke
      const fk = `${path.basename(c.folder)} · ${c.criterion}`
      perFolder[fk] = (perFolder[fk] || 0) + 1
      const st = fs.statSync(c.path)
      const name = path.basename(c.path, path.extname(c.path))
      const conv = convAtom(c.convo)
      if (conv) stats.koblet++
      const readable = TEXT_EXT.test(c.path) && st.size <= 5e6
      let text = ''
      if (readable) { try { text = fs.readFileSync(c.path, 'utf8'); if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n\n_(forkortet: ${text.length - MAX_TEXT} tegn til i fila)_` } catch { text = '' } }
      if (text.trim()) stats.lesbare++
      const origin = c.origin || 'AI'
      const whereLine = (c.urls || []).filter((u) => !/oaiusercontent|storage\.googleapis/.test(u)).slice(0, 3).join(' · ')
      const desc = `_Dokument · ${path.extname(c.path).slice(1).toLowerCase()} · ${fmtSize(st.size)} · ${iso(st.mtimeMs)} · fra ${origin}${c.known?.convo ? ` («${c.known.convo}»)` : ''} · kriterium: ${c.criterion}_`
      const content = text.trim()
        ? `# ${titleOf(text, name)}\n\n${desc}\n\nFil: ${c.path}\n\n${text}`
        : `# ${name}\n\n${desc}\n\nFila ligger i ${c.path} og er ikke kopiert — dette atomet er pekeren.${whereLine ? `\n\nOpphav: ${whereLine}` : ''}${c.known ? `\n\nInnholdet er identisk med ${c.known.file ? `fila ${c.known.label} i en Cowork-økt` : `«${c.known.label}» som Claude skrev i ${c.known.origin}`}${c.known.convo ? ` (samtalen «${c.known.convo}»)` : ''}.` : ''}`
      const project = conv?.project || c.known?.project || (origin === 'ChatGPT' ? 'ChatGPT-samtaler' : origin === 'Claude' || /^Claude/.test(origin) ? 'Claude-samtaler' : 'Dokumenter')
      const links = [{ kind: 'file', href: c.path, label: 'Fila (Finder)' }, ...(c.convo && /^https?:/.test(c.convo) ? [{ kind: 'url', href: c.convo, label: `Samtalen i ${origin}` }] : [])]
      const { atom, status } = upsert(atoms, {
        key: `fil:${c.path}`, kind: 'capture', name: text.trim() ? titleOf(text, name) : name, content, project: old ? old.project : project, convo: conv?.convo || c.known?.convo || old?.convo || '',
        source: origin, by: 'regel', tags: ['dokument', 'finder'], links, ...(conv ? { derivedFrom: [{ id: conv.id, version: conv.version || 1, level: 'L' }] } : {}),
        short: clip(text.trim() ? firstPara(text) : `${name} (${path.extname(c.path).slice(1)}, ${fmtSize(st.size)}) fra ${origin}, ${iso(st.mtimeMs)}. Ligger i ${path.basename(c.folder)}.`, S_MAX),
        summary: `Funnet av Finder-connectoren (${c.criterion}); fila er referert, ikke kopiert.`,
      })
      if (status === 'ny') { atom.capturedAt = st.mtimeMs; atom.createdAt = st.mtimeMs; stats.nye++ } else if (status === 'oppdatert') stats.oppdatert++; else stats.uendret++
    } catch (e) { stats.feil++; log(`  ⚠ ${c.path}: ${e.message}`) }
  }
  const folderLine = Object.entries(perFolder).sort().map(([k, n]) => `${k}: ${n}`).join(' · ') || '—'
  const taken = candidates.filter((c) => !insideRepo(c.path))
  const listed = taken.slice(0, dryRun ? 120 : 40).map((c) => `- ${path.basename(c.folder)}/${path.relative(c.folder, c.path)} · ${c.criterion} · ${c.origin}${c.known?.convo ? ` · «${c.known.convo}»` : ''}`)
  const report = [
    '# Import: Finder (dokumenter ved referanse)', '',
    `${real.map((f) => path.basename(f)).join(', ')} · ${candidates.length} kandidater · ${new Date().toLocaleString('no-NO')}${dryRun ? ' · **dry-run, ingenting skrevet**' : ''}`, '',
    `- **Dokumenter:** ${stats.nye} nye · ${stats.oppdatert} oppdatert · ${stats.uendret} uendret`,
    `- **Per mappe og kriterium:** ${folderLine}`,
    `- **Lesbare (teksten som L):** ${stats.lesbare} · **koblet til samtale-atom:** ${stats.koblet}`,
    stats.repo || stats.alleredeITua ? `- **Ikke tatt:** ${stats.repo} inne i git-repoer (Claude Codes domene) · ${stats.alleredeITua} allerede i Tua fra hooks/Code-import` : null,
    stats.feil ? `- **Feil:** ${stats.feil}` : null, '',
    'Kriterier: **opphav** = Spotlight (kMDItemWhereFroms) peker på et AI-domene; **innhold** = sha256 lik noe Claude har skrevet (create_file i Desktop-cachen, Write i Code-økter, Cowork outputs/). ' +
    'Hvert atom er en peker (file-lenke) — fila er ikke kopiert, flyttet eller endret. PDF/Word/PowerPoint får bare en beskrivelse som L (teksten kommer med M16). Slett atomet i Finder om det er feil.', '',
    `## Dokumentene (${taken.length})`, '', ...listed, taken.length > listed.length ? `- … og ${taken.length - listed.length} til (se atomene)` : null,
  ].filter((l) => l !== null).join('\n')
  let written = 0
  if (!dryRun) {
    upsert(atoms, { key: 'import:finder', name: 'Import: Finder', content: report, project: 'Tua', convo: 'Historikk', source: 'Tua', by: 'regel', tags: ['import'], short: clip(`Finder: ${stats.nye} nye og ${stats.oppdatert} oppdaterte dokument-atomer av ${candidates.length} kandidater (${folderLine}).`, S_MAX), summary: `Rapport fra Finder-connectoren ${new Date().toLocaleDateString('no-NO')}.` })
    written = save(atoms)
    noteImport('finder', { kandidater: candidates.length, nye: stats.nye, oppdatert: stats.oppdatert })
    if (stats.nye + stats.oppdatert) finishOnboarding('import')
    log(`Finder: ${stats.nye} nye · ${stats.oppdatert} oppdatert · ${stats.uendret} uendret · ${written} filer skrevet · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }
  return { report, stats, kind: 'finder', count: candidates.length, candidates }
}
// Vakt: nye filer i mappene (fs.watch på toppnivå, 10 s debounce) + den periodiske runden fra watchDesktop
export function watchFinder({ log = () => {}, folders = null, debounceMs = 10000 } = {}) {
  if (ensureArchive().needsChoice) return () => {}
  let timer = null
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => { try { const r = scanFinder({ log: () => {}, folders }); if (r.stats.nye || r.stats.oppdatert) log(`Finder: ${r.stats.nye} nye · ${r.stats.oppdatert} oppdaterte dokument-atomer`) } catch (e) { log(`Finder: ${e.message}`) } }, debounceMs) }
  const watchers = []
  for (const f of folders || DEFAULT_FOLDERS()) { try { watchers.push(fs.watch(f, { persistent: false }, kick)) } catch {} }
  return () => { clearTimeout(timer); for (const w of watchers) w.close() }
}
