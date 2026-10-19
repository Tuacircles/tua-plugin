#!/usr/bin/env node
// import.js — «Ta med historikken» (M14 + M17): tidligere samtaler og dokumenter blir atomer. Kildene:
//
//   1. Code-øktene lokalt: ~/.claude/projects/<prosjekt>/<session>.jsonl — komplette, uten eksport. PRIMÆRKILDEN.
//      Én atom per økt (kind «samtale», prosjekt fra øktas cwd, convo = første brukermelding, S etter regel),
//      og Claudes substansielle svar (≥ 1 500 tegn) og filer skrevet (.md/.txt, ≥ 600 tegn) som egne atomer
//      koblet til økta (bygget_av). Samme nøkler som pluginens hooks (svar:<sid>:<sha>, fil:<sti>) → ingen duplikater.
//      Leser bare — skriver aldri til ~/.claude.
//   2. Cowork-øktene (M17): ~/Library/Application Support/Claude/local-agent-mode-sessions/<org>/<konto>/local_<økt>/audit.jsonl
//      — HMAC-signert strøm i samme SDK-format som Code; samme leser, kilde «Claude Cowork», økt-id = mappenavnet.
//   3. Desktop-cachen (M17, desktop.js): alt brukeren har åpnet i Claude Desktop ligger i appens HTTP-cache — hele samtaler
//      med prosjekt, prosjektkunnskap og artifacts. Leses ved serverstart og hvert 10. minutt. Uten nettverk, uten innlogging.
//   4. Delte lenker (M17): claude.ai/share/<id> limt inn i chatten (tua_import kilde=lenke) eller lagt i Innboks som
//      .url/.webloc/.txt. Siden hentes uten innlogging; innholdet fanges når lenken åpnes i Desktop (cachen).
//   5. Finder (M17, finder.js): dokumenter i Nedlastinger/Dokumenter/Skrivebord med AI-opphav — ved referanse, aldri kopi.
//   6. Tua/Innboks: en eksport (zip eller mappe) fra Claude (manifest + kategori-zip) eller ChatGPT (conversations.json).
//
//   node import.js --code|--cowork|--desktop|--finder|--alt [--project <navn>] [--etter <ÅÅÅÅ-MM-DD>] [--min-tegn <n>] [--dry-run]
//   node import.js --lenke <https://claude.ai/share/…> [--dry-run]
//   node import.js <zip|mappe> [--dry-run] [--project <navn>] [--min-tegn <n>] [--etter <ÅÅÅÅ-MM-DD>]
//   node import.js --innboks [--dry-run]        én gjennomgang av Innboks nå
//
// Eksport-atomer (V13/V14): kind «samtale», prosjekt fra eksporten (ellers «Claude-samtaler»/«ChatGPT-samtaler»),
// links med claude://claude.ai/chat/<uuid> eller https://chatgpt.com/c/<id>, S = tittel + første brukermelding (≤ 300),
// M bare via «ny gjennomgang» (review.js). Dokumenter/artifacts/vedlegg som egne atomer. Én rapport per import (prosjekt «Tua»).
// Standard hopper over samtaler under 600 tegn. Idempotent: key «samtale:<uuid>», ny versjon bare ved endret innhold.
// Fila flyttes til Innboks/Ferdig. Flere prosesser kan overvåke Innboks: den som får flyttet fila til .behandles eier den.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipToTemp } from './unzip.js'   // 19.10.2026: utpakking uten shell, skilt ut (validatoren så fetch + spawn i samme fil)
import {
  load, save, upsert, FILES_ROOT, INBOX_DIR, ensureArchive, registerProject, projectOf as registeredProject, claudeProjectHref,
  finishOnboarding, noteImport, importState, S_MAX, SHORT_L, filesMode,
} from './store.js'
import { collectDesktop, countDesktopConversations, importedDesktop, noteImportedDesktop, cacheAvailable, CACHE_DIR } from './desktop.js'   // M17
import { scanFinder, countFinderCandidates, DEFAULT_FOLDERS } from './finder.js'                                                         // M17
import { CLAUDE_APP_DIR, posix } from './platform.js'                                                                                     // M18: Windows/Linux

const FERDIG = () => path.join(INBOX_DIR, 'Ferdig')
const BEHANDLES = () => path.join(INBOX_DIR, '.behandles')
export const DEFAULT_MIN = SHORT_L                               // 600 tegn — kortere samtaler har sjelden noe å finne igjen
export const MIN_SVAR = Number(process.env.TUA_MIN_SVAR) || 3000  // et «substansielt» svar fra Claude (Erik 15.10.2026: 3 000, var 1 500)
export const CODE_PROJECTS = path.join(process.env.TUA_CODE_HOME || os.homedir(), '.claude', 'projects')
// Cowork (Claude Desktop, lokal agent-modus) lagrer øktene sine her — samme transkript-format som Code.
// <konto>/<rom>/local_<økt>.json er metadata (title, userSelectedFolders, createdAt, lastActivityAt, initialMessage);
// <konto>/<rom>/local_<økt>/.claude/projects/<mappe>/<uuid>.jsonl er transkriptet. Bare lesing.
export const COWORK_ROOT = process.env.TUA_COWORK_ROOT || path.join(CLAUDE_APP_DIR, 'local-agent-mode-sessions')   // M18: per OS (platform.js)

// ── små hjelpere ────────────────────────────────────────────────────────────
const ms = (v) => (v == null ? null : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || null)
const iso = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '')
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const exists = (p) => { try { fs.accessSync(p); return true } catch { return false } }
const stem = (f) => String(f || '').replace(/\.(md|markdown|txt|pdf|docx?|csv|json|html?)$/i, '')   // «plan.md» → «plan» (fila får .md uansett)
const sha8 = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
// S etter regel: «Tittel: første brukermelding» innenfor 300 tegn
export const ruleS = (title, firstUser) => clip(flat(title ? `${title}: ${firstUser}` : firstUser) || flat(title), S_MAX)
export const titleOf = (md, fallback) => (String(md || '').split('\n').find((l) => l.trim()) || fallback).replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().slice(0, 80) || fallback
export const firstPara = (md) => flat((String(md || '').split(/\n\s*\n/).map((p) => p.replace(/^#+\s*/, '').trim()).filter((p) => p && !/^[-*|`>]/.test(p))[1] || String(md || '').split(/\n\s*\n/)[0] || ''))

// Prosjektnavn for en Code-økt: .tua-sync.json i cwd (eller en forelder) vinner, ellers repo-mappenavnet (worktrees → repoet).
export const repoRootOf = (cwd) => { const m = String(cwd || '').match(/^(.*)\/\.claude\/worktrees\/[^/]+/); return m ? m[1] : String(cwd || '') }
export function projectOfCwd(cwd) {
  let d = cwd
  for (let i = 0; i < 6 && d; i++) {
    try { const p = JSON.parse(fs.readFileSync(path.join(d, '.tua-sync.json'), 'utf8')).project; if (p) return p } catch {}
    const up = path.dirname(d); if (up === d) break; d = up
  }
  return path.basename(repoRootOf(cwd)) || 'Claude Code'
}

// ── Code-økter (jsonl) ──────────────────────────────────────────────────────
// Linjer: {type: user|assistant|…, message: {role, content: [{type: text|tool_use|tool_result, …}]}, cwd, sessionId,
// timestamp, isSidechain}. Verifisert mot Eriks filer 14.10.2026 (6 økter). Systemets <system-reminder>-blokker og
// kommando-markører i brukermeldinger fjernes; tool_result-blokker (det meste av volumet) tas ikke med i L.
export const stripReminders = (t) => String(t || '').replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '').replace(/<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>/g, '').trim()
const TEXT_FILE = /\.(md|markdown|txt|rst)$/i
export function parseCodeSession(file, { maxChars = 300_000 } = {}) {
  const s = { id: '', cwd: '', title: '', prompts: [], answers: [], files: new Map(), edited: new Set(), lastAssistant: '', first: null, last: null, turns: 0, lines: [] }
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return s }
  for (const line of text.split('\n')) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    s.id ||= o.sessionId || o.session_id || ''                       // Cowork audit.jsonl: session_id, _audit_timestamp (M17)
    s.cwd ||= o.cwd || ''
    const when = ms(o.timestamp || o._audit_timestamp)
    if (o.type === 'custom-title' && o.customTitle) s.title = String(o.customTitle)
    if (o.isSidechain) continue
    const blocks = Array.isArray(o.message?.content) ? o.message.content : typeof o.message?.content === 'string' ? [{ type: 'text', text: o.message.content }] : []
    if (o.type === 'user') {
      const t = stripReminders(blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n'))
      if (t && !/^\[Request interrupted/.test(t)) { s.prompts.push(t); s.turns++; s.first ??= when; s.last = when || s.last; s.lines.push(`**Bruker:** ${t}`) }
    } else if (o.type === 'assistant') {
      const t = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim()
      if (t) { s.lastAssistant = t; s.lines.push(`**Claude:** ${t}`); if (t.length >= MIN_SVAR) s.answers.push(t) }
      for (const b of blocks) {
        if (b.type !== 'tool_use' || !b.input?.file_path) continue
        if (b.name === 'Write' && typeof b.input.content === 'string') s.files.set(b.input.file_path, b.input.content)
        else if (/^(Edit|NotebookEdit)$/.test(b.name)) s.edited.add(b.input.file_path)
        if (/^(Write|Edit|NotebookEdit)$/.test(b.name)) s.lines.push(`[${b.name}: ${b.input.file_path}]`)
      }
      s.last = when || s.last
    }
  }
  s.id ||= path.basename(file, '.jsonl')
  const full = s.lines.join('\n\n')
  s.transcript = full.length > maxChars ? full.slice(0, maxChars) + `\n\n_(forkortet: ${full.length - maxChars} tegn til i øktfila)_` : full
  s.chars = full.length
  s.firstUser = s.prompts[0] || ''
  s.convo = s.title || clip(flat(s.firstUser), 60) || `Code-økt ${s.id.slice(0, 8)}`
  s.file = file
  return s
}
// Alle øktfiler: <prosjektmappe>/<uuid>.jsonl (ikke undermapper, ikke agent-*). Nyeste først.
export function listCodeSessions(root = CODE_PROJECTS) {
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { return out }
  for (const d of dirs) {
    const dir = path.join(root, d.name)
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue
      const abs = path.join(dir, f)
      const st = fs.statSync(abs)
      out.push({ file: abs, dir: d.name, size: st.size, mtime: st.mtimeMs })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}
// Cowork-økter (M17): én økt = én mappe local_<uuid>/ med audit.jsonl (HMAC-signert strøm: type user|assistant|system|result,
// message, session_id, _audit_timestamp; system/init bærer cwd og modell). Verifisert mot Eriks 118 økter 14.10.2026: alle har
// audit.jsonl, og session_id = mappe-uuid-en. Finnes ikke audit.jsonl, brukes det indre transkriptet (.claude/projects/*.jsonl,
// samme format, annen økt-id) som reserve. Økt-id = mappenavnet uansett → stabil nøkkel «samtale:<uuid>».
// Prosjektet er mappa brukeren valgte i Cowork (userSelectedFolders[0] i local_<uuid>.json), tittelen likeså.
export function listCoworkSessions(root = COWORK_ROOT) {
  const out = []
  const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) } catch { return [] } }
  for (const acct of dirs(root)) for (const room of dirs(acct)) {
    for (const sess of dirs(room).filter((p) => path.basename(p).startsWith('local_'))) {
      let meta = {}
      try { meta = JSON.parse(fs.readFileSync(sess + '.json', 'utf8')) } catch {}
      const audit = path.join(sess, 'audit.jsonl')
      let file = exists(audit) ? audit : null, kind = 'audit'
      if (!file) {
        file = dirs(path.join(sess, '.claude', 'projects')).flatMap((p) => { try { return fs.readdirSync(p).filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-')).map((f) => path.join(p, f)) } catch { return [] } })
          .map((f) => ({ f, size: fs.statSync(f).size })).sort((a, b) => b.size - a.size)[0]?.f || null
        kind = 'transkript'
      }
      if (!file) continue
      const st = fs.statSync(file)
      // prosjekt = mappa brukeren valgte i Cowork; hjemmemappa og dens standardmapper (Documents, Downloads, Desktop) er ikke prosjekter
      const folders = (Array.isArray(meta.userSelectedFolders) ? meta.userSelectedFolders : []).map(String)
      const home = os.homedir()
      const generic = (f) => { const p = path.resolve(String(f || '')); return p === home || ['Documents', 'Downloads', 'Desktop', 'Library'].some((d) => p === path.join(home, d)) }
      const folder = folders.find((f) => !generic(f)) || folders[0] || ''
      out.push({
        file, size: st.size, mtime: st.mtimeMs, kind,
        over: { id: path.basename(sess).replace(/^local_/, ''), project: folder && !generic(folder) ? projectOfCwd(folder) : 'Cowork', repo: folder, convo: meta.title ? String(meta.title) : '', created: meta.createdAt || null, last: meta.lastActivityAt || null, archived: !!meta.isArchived },
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

// source = 'code' (Claude Code, ~/.claude/projects) eller 'cowork' (Claude Desktop Cowork). Samme parser, samme atom-form.
export function importCode({ files = null, source = 'code', dryRun = false, project = null, minChars = DEFAULT_MIN, after = null, log = () => {}, skipSession = '' } = {}) {
  const t0 = Date.now()
  const list = files ? files.map((f) => ({ file: f })) : source === 'cowork' ? listCoworkSessions() : listCodeSessions()
  const srcLabel = source === 'cowork' ? 'Claude Cowork' : 'Claude Code'
  const srcRoot = source === 'cowork' ? COWORK_ROOT : CODE_PROJECTS
  const atoms = load()
  const stats = { økter: list.length, nye: 0, oppdatert: 0, uendret: 0, korte: 0, filtrert: 0, svar: 0, filer: 0, feil: 0 }
  const perProject = {}
  const afterMs = after ? Date.parse(after) : null
  const put = (data, when) => {
    const old = atoms.find((a) => a.key === data.key)
    const { atom, status } = upsert(atoms, { ...data, project: old ? old.project : data.project, convo: old && old.content === String(data.content).trim() ? old.convo : data.convo })
    if (when && status === 'ny') { atom.capturedAt = when; atom.createdAt = when }
    else if (when && status === 'oppdatert') atom.capturedAt = Math.max(when, old?.capturedAt || 0)
    return { atom, status }
  }
  const count = (st) => { if (st === 'ny') stats.nye++; else if (st === 'oppdatert') stats.oppdatert++; else stats.uendret++ }
  log(`${srcLabel}-økter: ${list.length} øktfiler i ${srcRoot}${dryRun ? ' · DRY-RUN' : ''}`)
  for (const { file, over = {} } of list) {
    try {
      const s = parseCodeSession(file)
      if (over.id) s.id = over.id                                              // Cowork: mappe-uuid-en er økt-id (M17)
      if (skipSession && s.id === skipSession) continue
      if (over.convo) { s.title = over.convo; s.convo = over.convo }          // Cowork: tittelen brukeren ser i Desktop
      if (over.last) s.last = Math.max(s.last || 0, over.last)
      const proj = over.project || projectOfCwd(s.cwd)
      if (project && proj.toLowerCase() !== project.toLowerCase()) { stats.filtrert++; continue }
      if (afterMs && (s.last || 0) < afterMs) { stats.filtrert++; continue }
      if (s.chars < minChars || !s.prompts.length) { stats.korte++; continue }
      const repo = over.repo !== undefined ? over.repo : repoRootOf(s.cwd)
      const links = repo ? [{ kind: 'repo', href: repo, label: `Repo — ${proj}` }] : []
      const header = `# ${s.convo}\n\n_${srcLabel} · ${s.turns} oppgaver · ${iso(s.first)}${s.last && iso(s.last) !== iso(s.first) ? ` – ${iso(s.last)}` : ''} · ${proj}${repo ? ` · ${repo}` : ''} · øktfil ${path.basename(file)}_\n\n`
      const { atom, status } = put({
        key: `samtale:${s.id}`, kind: 'samtale', name: s.convo, content: header + s.transcript, project: proj, convo: s.convo, source: srcLabel, by: 'regel',
        tags: ['samtale', source], links, short: ruleS(s.title, s.firstUser), summary: `${srcLabel}-økt importert fra ${path.basename(file)} (${s.turns} oppgaver).`,
      }, s.last)
      count(status); perProject[proj] = (perProject[proj] || 0) + 1
      const derived = [{ id: atom.id, version: atom.version || 1, level: 'L' }]
      for (const a of s.answers) {
        const r = put({
          key: `svar:${s.id.slice(0, 8)}:${sha8(a)}`, kind: 'capture', name: titleOf(a, `Svar i ${s.convo}`), content: a, project: proj, convo: s.convo, source: 'Claude', by: 'regel',
          tags: ['svar', 'auto'], links, derivedFrom: derived, short: clip(firstPara(a), S_MAX), summary: `Substansielt svar i Code-økta «${s.convo}».`,
        }, s.last)
        if (r.status !== 'uendret') stats.svar++
      }
      for (const [fp, content] of s.files) {
        const fq = posix(fp)
        if (!TEXT_FILE.test(fq) || /\/(node_modules|\.tua|\.git)\//.test(fq) || /\/\.claude\/(?!worktrees\/)/.test(fq) || /\/CLAUDE\.md$/.test(fq) || content.trim().length < SHORT_L) continue   // samme filter som hooken: ikke Claude-oppsett/minne
        if (filesMode() && !path.relative(FILES_ROOT, fp).startsWith('..')) continue                 // fila ligger i arkivet selv
        const r = put({
          key: `fil:${fp}`, kind: 'capture', name: titleOf(content, path.basename(fp, path.extname(fp))), content, project: proj, convo: s.convo, source: 'Claude', by: 'regel',
          tags: ['dokument', 'auto'], links: [{ kind: 'file', href: fp }, ...links], derivedFrom: derived, short: clip(firstPara(content), S_MAX),
          summary: `Skrevet i Code-økta «${s.convo}» (${fp}).`,
        }, s.last)
        if (r.status !== 'uendret') stats.filer++
      }
    } catch (e) { stats.feil++; log(`  ⚠ ${path.basename(file)}: ${e.message}`) }
  }
  const projLine = Object.entries(perProject).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} (${n})`).join(', ') || '—'
  const filters = [project && `prosjekt = ${project}`, `minst ${minChars} tegn`, after && `etter ${after}`].filter(Boolean).join(' · ')
  const title = `Import: ${srcLabel}-økter`
  const report = [
    `# ${title}`, '',
    `${srcRoot} · ${list.length} øktfiler · ${new Date().toLocaleString('no-NO')}${dryRun ? ' · **dry-run, ingenting skrevet**' : ''}`, '',
    `- **Økter:** ${stats.nye} nye · ${stats.oppdatert} oppdatert · ${stats.uendret} uendret`,
    `- **Hoppet over:** ${stats.korte} under ${minChars} tegn${stats.filtrert ? ` · ${stats.filtrert} utenfor filter` : ''}`,
    `- **Egne atomer:** ${stats.svar} substansielle svar (≥ ${MIN_SVAR} tegn) · ${stats.filer} tekstdokumenter skrevet i øktene`,
    `- **Prosjekter:** ${projLine}`,
    `- **Filter:** ${filters}`,
    stats.feil ? `- **Feil:** ${stats.feil} (se loggen)` : null, '',
    'Hver økt er ett atom (kind «samtale») med transkript av brukerens meldinger og Claudes svar (verktøyresultater er ikke med). ' +
    `Svar og filer som er lagret av pluginens hooks har samme nøkler og dupliseres ikke. Øktfilene (${srcRoot}) er bare lest.`,
    source === 'cowork' ? 'Kilde per økt: audit.jsonl (HMAC-signert strøm); økt-id = mappenavnet local_<uuid>.' : 'Desktop-samtaler fanges fra appens cache (tua_import kilde=desktop); web/mobil via delt lenke eller eksport i Innboks.',
  ].filter((l) => l !== null).join('\n')
  if (!dryRun) {
    upsert(atoms, {
      key: `import:${source}-økter`, name: title, content: report, project: 'Tua', convo: 'Innboks', source: 'Tua', by: 'regel', tags: ['import'],
      short: clip(`${srcLabel}-økter: ${stats.nye} nye og ${stats.oppdatert} oppdaterte økter, ${stats.svar} svar og ${stats.filer} dokumenter som egne atomer. Prosjekter: ${projLine}.`, S_MAX),
      summary: `Rapport fra import av ${srcLabel}-økter ${new Date().toLocaleDateString('no-NO')}.`,
    })
    const written = save(atoms)
    noteImport(source, { økter: list.length, nye: stats.nye, oppdatert: stats.oppdatert })
    if (stats.nye + stats.oppdatert) finishOnboarding('import')
    log(`${srcLabel}-økter: ${stats.nye} nye · ${stats.oppdatert} oppdatert · ${stats.uendret} uendret · ${stats.korte} korte · ${written} filer skrevet · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }
  return { report, stats, kind: source, count: list.length }
}
// Hvor mange øktfiler er endret siden siste import (SessionStart-påminnelsen)
export function pendingCodeSessions(since = 0) { return listCodeSessions().filter((s) => s.mtime > since && s.size > 2000).length }
export function pendingCoworkSessions(since = 0) { return listCoworkSessions().filter((s) => s.mtime > since && s.size > 20000).length }

// ── Claude-eksport ──────────────────────────────────────────────────────────
// conversations.json: [{uuid, name, summary, created_at, updated_at, chat_messages: [{uuid, sender: human|assistant,
//   text, content: [{type: text|tool_use|tool_result, text, name, input}], attachments: [{file_name, extracted_content}],
//   files: [{file_name}], created_at}]}]  — prosjekt-kobling (project_uuid) finnes ikke i alle eksporter; sjekkes.
// projects.json: [{uuid, name, description, docs: [{uuid, filename, content, created_at}], created_at, updated_at}]
const blockText = (m) => {
  if (typeof m.text === 'string' && m.text.trim()) return m.text
  return (m.content || []).filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n')
}
const artifactsIn = (m) => (m.content || [])
  .filter((b) => b && b.type === 'tool_use' && /artifacts?/i.test(b.name || '') && b.input && (b.input.content || b.input.new_str))
  .filter((b) => ['create', 'rewrite', 'update'].includes(b.input.command || 'create'))
  .map((b) => ({ id: b.input.id || '', title: b.input.title || b.input.id || 'Artifact', content: String(b.input.content || b.input.new_str || ''), type: b.input.type || '' }))

// Alle json-filer under en mappe (maks 4 nivåer), klassifisert etter INNHOLD, ikke filnavn — eksporten har endret form:
// samtaler som conversations.json (liste) eller én fil per samtale; prosjekter som projects.json (liste) eller
// projects/<uuid>.json (ett objekt per prosjekt, slik det faktisk kom hos Erik 14.10.2026).
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o)
const isProject = (o) => isObj(o) && typeof o.name === 'string' && 'docs' in o && !('chat_messages' in o)
const isConversation = (o) => isObj(o) && Array.isArray(o.chat_messages)
const isDesignChat = (o) => isObj(o) && Array.isArray(o.messages) && 'title' in o && 'project' in o          // design_chats-*.zip: {uuid, title, project:{uuid,name}, messages:[{role, content:{content, attachments}}]}
const isMemories = (o) => isObj(o) && ('conversations_memory' in o || 'project_memories' in o || 'memory_files' in o)   // memories-*.zip: Claudes minne om brukeren
export function collectClaude(dir, depth = 0) {
  const out = { conversations: [], projects: [], design: [], memories: [], other: [] }
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (depth < 4 && !e.name.startsWith('.')) { const sub = collectClaude(p, depth + 1); for (const k of Object.keys(out)) out[k].push(...sub[k]) }; continue }
    if (!e.name.toLowerCase().endsWith('.json') || fs.statSync(p).size > 400e6) continue
    let d; try { d = readJson(p) } catch { continue }
    const list = Array.isArray(d) ? d : [d]
    if (list.length && list.every(isConversation)) out.conversations.push(...list)
    else if (list.length && list.every(isProject)) out.projects.push(...list)
    else if (list.length && list.every(isDesignChat)) out.design.push(...list)
    else if (list.length && list.every(isMemories)) out.memories.push(...list)
    else out.other.push(e.name)
  }
  return out
}
const cleanName = (s) => flat(s).replace(/[. ]+$/, '')                    // «Skigaarden diverse.» → «Skigaarden diverse» (samme mappe som fra før)
export function parseClaude(dir, { extraProjects = [] } = {}) {
  const found = collectClaude(dir)
  const conversations = found.conversations
  const projects = [...found.projects, ...extraProjects]                   // prosjektene kan ligge i en annen kategori-zip (Innboks/Ferdig)
  const projByUuid = new Map(projects.map((p) => [p.uuid, p]))
  const seen = new Set()
  const projectField = ['project_uuid', 'project_id', 'project'].find((f) => conversations.some((c) => c && c[f] != null)) || null
  const convs = conversations.filter(Boolean).map((c) => {
    for (const k of Object.keys(c)) seen.add(k)
    const msgs = (c.chat_messages || []).slice().sort((a, b) => (ms(a.created_at) || 0) - (ms(b.created_at) || 0))
    const pid = projectField ? (typeof c[projectField] === 'object' ? c[projectField]?.uuid : c[projectField]) : null
    const proj = pid ? projByUuid.get(pid) : null
    const artifacts = [], attachments = []
    const lines = msgs.map((m) => {
      const who = m.sender === 'human' ? 'Bruker' : 'Claude'
      let t = blockText(m)
      for (const a of m.attachments || []) {
        if (a.extracted_content) attachments.push({ name: a.file_name || 'vedlegg', content: String(a.extracted_content) })
        t += `\n[vedlegg: ${a.file_name || 'fil'}]`
      }
      for (const f of m.files || []) t += `\n[fil: ${f.file_name || 'fil'}]`
      const arts = artifactsIn(m)
      for (const a of arts) { artifacts.push(a); t += `\n[artifact: ${a.title}]` }
      return `**${who}:** ${t.trim()}`
    })
    const firstUser = blockText(msgs.find((m) => m.sender === 'human') || {})
    return {
      id: c.uuid, title: flat(c.name) || 'Uten tittel', created: ms(c.created_at), updated: ms(c.updated_at) || ms(c.created_at),
      project: proj?.name ? cleanName(proj.name) : null, projectUuid: proj?.uuid || pid || null, source: 'Claude',
      href: c.uuid ? `claude://claude.ai/chat/${c.uuid}` : '', summary: flat(c.summary || ''),
      firstUser, transcript: lines.join('\n\n'), messages: msgs.length, artifacts, attachments,
    }
  })
  // Design-samtaler (Claude Design): har prosjekt-kobling, i motsetning til vanlige samtaler. Samme atom-form, kilde «Claude Design».
  for (const d of found.design) {
    const msgs = (d.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    const textOf = (m) => (typeof m.content === 'string' ? m.content : typeof m.content?.content === 'string' ? m.content.content : '')
    const lines = msgs.map((m) => `**${m.role === 'user' ? 'Bruker' : 'Claude Design'}:** ${textOf(m).trim()}${m.content?.attachments?.length ? `\n[${m.content.attachments.length} vedlegg]` : ''}`)
    const projName = cleanName(d.project?.name || projByUuid.get(d.project?.uuid)?.name || '')
    convs.push({
      id: d.uuid, title: flat(d.title) || 'Design uten tittel', created: ms(d.created_at), updated: ms(d.updated_at) || ms(d.created_at),
      project: projName || null, projectUuid: d.project?.uuid || null, source: 'Claude Design', href: '', summary: '',
      firstUser: textOf(msgs.find((m) => m.role === 'user') || {}), transcript: lines.join('\n\n'), messages: msgs.length, artifacts: [], attachments: [],
    })
  }
  // Claudes eget minne om brukeren: ett atom per prosjektminne (prosjekt fra uuid-mappingen), ett for det generelle. memory_files telles.
  const minner = [], memoryFiles = []
  for (const mem of found.memories) {
    const acc = String(mem.account_uuid || '').slice(0, 8) || 'konto'
    if (typeof mem.conversations_memory === 'string' && mem.conversations_memory.trim()) minner.push({ key: `minne:generelt:${acc}`, name: 'Claude-minne — generelt', content: mem.conversations_memory, project: 'Claude-samtaler', projectUuid: null })
    for (const [uuid, txt] of Object.entries(mem.project_memories || {})) {
      if (typeof txt !== 'string' || !txt.trim()) continue
      const p = projByUuid.get(uuid)
      const pn = p?.name ? cleanName(p.name) : null
      minner.push({ key: `minne:${uuid}`, name: `Claude-minne — ${pn || `prosjekt ${uuid.slice(0, 8)}`}`, content: txt, project: pn || 'Claude-samtaler', projectUuid: uuid })
    }
    for (const f of mem.memory_files || []) if (f && f.path) memoryFiles.push(f.path)
  }
  const docs = projects.flatMap((p) => (p.docs || []).filter((d) => d && d.content).map((d) => ({
    id: d.uuid, title: d.filename || 'Dokument', content: String(d.content), project: cleanName(p.name) || 'Uten navn', projectUuid: p.uuid, created: ms(d.created_at),
  })))
  return {
    kind: 'claude', convs, docs, minner, memoryFiles, projects: projects.filter((p) => p.uuid && p.name).map((p) => ({ uuid: p.uuid, name: cleanName(p.name) })),
    format: {
      felter: [...seen].sort(), prosjektkobling: projectField, prosjekterIFila: found.projects.length, prosjekterFraNabo: extraProjects.length,
      design: found.design.length, minnefiler: memoryFiles.length,
      meldingsfelter: [...new Set(conversations.flatMap((c) => Object.keys(c?.chat_messages?.[0] || {})))].sort(), andreFiler: found.other,
    },
  }
}

// ── ChatGPT-eksport ─────────────────────────────────────────────────────────
// conversations.json: [{id|conversation_id, title, create_time, update_time (sekunder), current_node,
//   mapping: {nodeId: {id, parent, children, message: {author: {role}, content: {content_type, parts}, create_time}}}}]
const partText = (p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? (p.text || p.content || '') : '')
export function parseChatGPT(dir) {
  const conversations = readJson(path.join(dir, 'conversations.json'))
  if (!Array.isArray(conversations)) throw new Error('conversations.json er ikke en liste')
  const seen = new Set()
  const convs = conversations.filter(Boolean).map((c) => {
    for (const k of Object.keys(c)) seen.add(k)
    const map = c.mapping || {}
    // følg kjeden fra current_node tilbake til roten (den «gjeldende» grenen); mangler den, ta alt sortert på tid
    let chain = []
    if (c.current_node && map[c.current_node]) {
      for (let n = map[c.current_node]; n; n = n.parent ? map[n.parent] : null) chain.unshift(n)
    } else chain = Object.values(map).sort((a, b) => (a.message?.create_time || 0) - (b.message?.create_time || 0))
    const msgs = chain.map((n) => n.message).filter((m) => m && m.author && ['user', 'assistant'].includes(m.author.role))
      .map((m) => ({ role: m.author.role, text: (m.content?.parts || []).map(partText).filter(Boolean).join('\n'), t: ms(m.create_time) }))
      .filter((m) => m.text.trim())
    const id = c.conversation_id || c.id
    return {
      id, title: flat(c.title) || 'Uten tittel', created: ms(c.create_time), updated: ms(c.update_time) || ms(c.create_time),
      project: null, projectUuid: null, source: 'ChatGPT', href: id ? `https://chatgpt.com/c/${id}` : '', summary: '',
      firstUser: msgs.find((m) => m.role === 'user')?.text || '',
      transcript: msgs.map((m) => `**${m.role === 'user' ? 'Bruker' : 'ChatGPT'}:** ${m.text.trim()}`).join('\n\n'),
      messages: msgs.length, artifacts: [], attachments: [],
    }
  })
  return { kind: 'chatgpt', convs, docs: [], projects: [], format: { felter: [...seen].sort(), prosjektkobling: null, prosjekterIFila: 0 } }
}

// Hvilken eksport er dette? ChatGPT har conversations.json med `mapping`; Claude har samtaler (chat_messages) eller
// prosjekter (name + docs) i en eller flere json-filer. null = ingen av delene.
export function detect(dir) {
  const p = path.join(dir, 'conversations.json')
  if (exists(p)) {
    const head = fs.readFileSync(p, { encoding: 'utf8', flag: 'r' }).slice(0, 20000)
    if (/"mapping"/.test(head) && !/"chat_messages"/.test(head)) return 'chatgpt'
  }
  const f = collectClaude(dir)
  return f.conversations.length || f.projects.length || f.design.length || f.memories.length ? 'claude' : null
}

// Finn mappa med conversations.json (eksporten kan ligge ett nivå ned i zip-en); ellers mappa med json-filer (loose).
const jsonsIn = (dir) => { try { return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')) } catch { return [] } }
const allJsons = (dir, depth = 0) => { let out = []; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory() && depth < 4) out.push(...allJsons(path.join(dir, e.name), depth + 1)); else if (e.name.toLowerCase().endsWith('.json')) out.push(e.name) } } catch {} return out }
function findRoot(dir, loose = false) {
  if (exists(path.join(dir, 'conversations.json')) || exists(path.join(dir, 'projects.json'))) return dir
  if (loose) return allJsons(dir).length ? dir : null
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) { const r = findRoot(path.join(dir, e.name)); if (r) return r }
  }
  return null
}

// Zip → temp-mappe (bare json-filene; medier i ChatGPT-eksporten pakkes ikke ut). Selve utpakkingen ligger i unzip.js.
const unzip = (zipPath) => unzipToTemp(zipPath, (tmp) => !!findRoot(tmp, true))

// ── Claude-eksporten slik den faktisk kommer (sett hos Erik 14.10.2026) ────
// Eksportsiden gir en manifest-<uuid>-<tid>.json med `data_files[]` ({filename, category, part, batch_index, export_url})
// og ÉN zip per kategori: conversations-000.zip, projects-000.zip, memories-000.zip, design_chats-000.zip,
// frames-000.zip, light_metadata-000.zip — store kontoer får flere deler (-001, …). Lenkene utløper etter 24 t.
// Derfor: manifestet alene gir en mottaksstatus (hva mangler), kategori-zipene importeres hver for seg (samtaler
// finner projects.json i projects-*.zip ved siden av seg), flere deler er bare flere filer, og kategorier vi ikke
// kan lese ennå flyttes til Ferdig med beskjed — de stopper ikke resten.
const isManifest = (p) => { try { return /\.json$/i.test(p) && fs.statSync(p).size < 2e6 && Array.isArray(readJson(p).data_files) } catch { return false } }
const inboxFiles = () => [INBOX_DIR, FERDIG(), BEHANDLES()].flatMap((d) => { try { return fs.readdirSync(d).map((n) => path.join(d, n)) } catch { return [] } })
export function manifestStatus() {
  const m = inboxFiles().filter(isManifest).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  if (!m) return null
  const data = readJson(m)
  const have = new Set(inboxFiles().map((p) => path.basename(p).replace(/ \(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\)(?=\.zip$)/, '')))
  const files = (data.data_files || []).map((f) => ({ ...f, present: have.has(f.filename) }))
  return { manifest: path.basename(m), created: data.created_at || '', total: data.total_files || files.length, files, missing: files.filter((f) => !f.present), present: files.filter((f) => f.present) }
}
export const manifestReport = (st) => [
  `# Claude-eksport: ${st.present.length} av ${st.files.length} filer mottatt`, '',
  `Manifest ${st.manifest}${st.created ? ` (laget ${st.created})` : ''} · ${new Date().toLocaleString('no-NO')}`, '',
  ...st.files.map((f) => `- ${f.present ? '✓' : '○'} ${f.filename} — ${f.category}${f.part != null ? ` del ${f.part}` : ''}${f.present ? '' : ' — **mangler** (last ned fra eksportsiden og legg i Innboks)'}`), '',
  st.missing.length ? `Nedlastingslenkene i manifestet utløper etter 24 timer og kan dø etter én bruk; åpne dem én og én. Tua laster aldri ned noe selv.` : 'Alle filene er mottatt.',
  'Kategoriene conversations (samtaler), projects (prosjekter med dokumenter), design_chats (design-samtaler med prosjekt) og memories (Claudes minne om deg) blir atomer. frames og light_metadata legges i Ferdig uten atomer.',
].join('\n')
// projects.json fra en annen kategori-zip (Innboks eller Ferdig) — så samtaler får prosjektnavn selv om projects-000.zip kom separat
function siblingProjects(log) {
  const out = []
  for (const z of inboxFiles().filter((p) => /^projects-\d+(?: \(.*\))?\.zip$/i.test(path.basename(p)))) {
    try { const t = unzip(z); out.push(...collectClaude(t).projects); fs.rmSync(t, { recursive: true, force: true }) } catch (e) { log(`  prosjekter i ${path.basename(z)} kunne ikke leses: ${e.message}`) }
  }
  return out
}
// Hva en kategori vi ikke importerer faktisk inneholder — så rapporten kan si det, og Erik kan bestemme senere
const DESCRIBE = {
  'frames': 'Design-rammer (index.html, view-state.md, thumbnail.json per ramme) — gjengivelser, ikke tekst',
  'light_metadata': 'users.json og login_history.json — konto-metadata, ikke innhold',
}

// ── eksport-import ──────────────────────────────────────────────────────────
// Returnerer rapporten (tekst + tall). Skriver ingenting når dryRun.
export function importExport(src, { dryRun = false, project = null, minChars = DEFAULT_MIN, after = null, log = () => {}, moveTo = null } = {}) {
  const t0 = Date.now()
  const name = path.basename(src)
  // manifestet alene: mottaksstatus, ingen atomer utover rapporten
  if (fs.statSync(src).isFile() && isManifest(src)) {
    const st = manifestStatus() || { manifest: name, files: [], missing: [], present: [] }
    const report = manifestReport(st)
    if (!dryRun) { const atoms = load(); upsert(atoms, { key: 'import:eksport-manifest', name: 'Claude-eksport: mottak', content: report, project: 'Tua', convo: 'Innboks', source: 'Tua', by: 'regel', tags: ['import'], short: clip(`Claude-eksport: ${st.present.length} av ${st.files.length} filer mottatt${st.missing.length ? `; mangler ${st.missing.map((f) => f.filename).join(', ')}` : ''}.`, S_MAX) }); save(atoms) }
    log(`${name}: manifest — ${st.present.length} av ${st.files.length} filer mottatt`)
    return { report, stats: { manifest: true, present: st.present.length, total: st.files.length }, kind: 'manifest', count: 0 }
  }
  let dir = src, tmp = null
  if (fs.statSync(src).isFile()) { if (!/\.zip$/i.test(src)) throw new Error(`${name}: ikke en zip og ikke en mappe`); tmp = unzip(src); dir = tmp }
  const root = findRoot(dir) || findRoot(dir, true)
  if (!root) throw new Error(`${name}: fant ingen json-filer`)
  const kind = detect(root)
  if (!kind) {
    // en kategori vi ikke leser ennå (memories, design_chats, frames, light_metadata …): flyttes til Ferdig med beskjed om hva den inneholder
    const found = allJsons(root)
    const cat = (name.match(/^([a-z_]+)-\d+/i) || [])[1] || ''
    const report = `# Import: ${name}\n\nInnhold: ${found.length} json-fil${found.length === 1 ? '' : 'er'} (${[...new Set(found.map((f) => f.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/i, '<uuid>')))].slice(0, 6).join(', ')}).${DESCRIBE[cat] ? ` ${DESCRIBE[cat]}.` : ''} Denne kategorien av Claude-eksporten blir ikke atomer ennå. Fila er lagt i Innboks/Ferdig og kan slettes i Finder.`
    log(`${name}: ikke støttet (${cat || found.join(', ')}) — flyttes til Ferdig`)
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    return { report, stats: { unsupported: true }, kind: 'ukjent', count: 0 }
  }
  const data = kind === 'claude' ? parseClaude(root, { extraProjects: collectClaude(root).projects.length ? [] : siblingProjects(log) }) : parseChatGPT(root)
  const label = kind === 'claude' ? 'Claude-eksport' : 'ChatGPT-eksport'
  log(`${name}: ${label} · ${data.convs.length} samtaler · ${data.docs.length} dokumenter · ${(data.minner || []).length} minner${dryRun ? ' · DRY-RUN' : ''}`)
  const r = importParsed(data, {
    name, label, kind, dryRun, project, minChars, after, log, moveTo, via: 'Innboks',
    defaultProject: kind === 'claude' ? 'Claude-samtaler' : 'ChatGPT-samtaler',
    reportKey: `import:${name.replace(/ \(.*\)(?=\.zip$)/, '')}`, reportName: `Import: ${name}`, reportConvo: 'Innboks',
    afterSave: (atoms) => {
      const st = manifestStatus()                                      // oppdater mottaksstatusen når en kategori-zip er lest
      if (st) upsert(atoms, { key: 'import:eksport-manifest', name: 'Claude-eksport: mottak', content: manifestReport(st), project: 'Tua', convo: 'Innboks', source: 'Tua', by: 'regel', tags: ['import'], short: clip(`Claude-eksport: ${st.present.length} av ${st.files.length} filer mottatt${st.missing.length ? `; mangler ${st.missing.map((f) => f.filename).join(', ')}` : ''}.`, S_MAX) })
      noteImport('eksport', { fil: name, kind, nye: stats.nye, oppdatert: stats.oppdatert })
    },
  })
  if (!dryRun) log(`${name}: ${r.stats.nye} nye · ${r.stats.oppdatert} oppdatert · ${r.stats.uendret} uendret · ${r.stats.korte} korte · ${r.written} filer skrevet · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  return { report: r.report, stats: r.stats, kind, count: data.convs.length }
}

// ── parsede samtaler → atomer (felles for Innboks-eksport, Desktop-cache og delte lenker) ──
// data = { convs: [{id, title, created, updated, project, projectUuid, source, href, summary, firstUser, transcript, messages,
//          artifacts: [{id,title,content}], attachments: [{name,content}], meta?}], docs: [{id,title,content,project,projectUuid,created}],
//          minner?: [], projects: [{uuid,name}], format?: {...} }
// Nøkler: samtale:<id> · artifact:<id>:<x> · vedlegg:<id>:<x> · claude-doc:<id> · minne:<…>. Idempotent: finnes nøkkelen fra før,
// oppdateres atomet der det ligger — UNNTATT når det ligger i samlemappa («Claude-samtaler») og vi nå vet prosjektet:
// da flyttes det til prosjektmappa (M17: cachen kjenner prosjektet som eksporten manglet). save() flytter fila.
export function importParsed(data, {
  name, label, kind = 'claude', dryRun = false, project = null, minChars = DEFAULT_MIN, after = null, log = () => {}, moveTo = null, via = '',
  defaultProject = 'Claude-samtaler', reportKey, reportName, reportConvo = 'Innboks', extraLines = [], afterSave = null, noteKind = null,
} = {}) {
  const afterMs = after ? Date.parse(after) : null
  const atoms = load()
  const stats = { nye: 0, oppdatert: 0, uendret: 0, flyttet: 0, korte: 0, filtrert: 0, dokumenter: 0, artifacts: 0, vedlegg: 0, minner: 0, feil: 0 }
  const perProject = {}
  const byKey = (key) => atoms.find((a) => a.key === key)
  const put = (data2, when, { moveFromDefault = false } = {}) => {
    const old = byKey(data2.key)
    if (old && moveFromDefault && old.project === defaultProject && data2.project && data2.project !== defaultProject) { old.project = data2.project; stats.flyttet++ }
    const { atom, status } = upsert(atoms, { ...data2, project: old ? old.project : data2.project })
    if (status === 'ny' && when) { atom.capturedAt = when; atom.createdAt = when }
    else if (status === 'oppdatert' && when) atom.capturedAt = Math.max(when, old?.capturedAt || 0)
    return { atom, status }
  }
  const count = (status) => { if (status === 'ny') stats.nye++; else if (status === 'oppdatert') stats.oppdatert++; else stats.uendret++ }

  // prosjekter → registeret (claude://-lenke på alle atomer i prosjektet), bare der uuid ikke er satt
  if (!dryRun) for (const p of data.projects || []) if (p.uuid && p.name && !registeredProject(p.name).claudeProject) registerProject(p.name, { claudeProject: p.uuid })

  for (const c of data.convs) {
    try {
      const proj = c.project || defaultProject
      const chars = c.transcript.length + [...c.artifacts, ...c.attachments].reduce((n, x) => n + (x.content || '').length, 0)   // en kort chat med en lang artifact er ikke kort
      if (project && proj.toLowerCase() !== project.toLowerCase()) { stats.filtrert++; continue }
      if (afterMs && (c.updated || 0) < afterMs) { stats.filtrert++; continue }
      if (chars < minChars || !c.messages) { stats.korte++; continue }
      const isClaude = /^Claude/.test(c.source)
      const links = [c.href ? { kind: /^claude:\/\//.test(c.href) ? 'claude-chat' : 'url', href: c.href, label: `Samtalen i ${c.source}` } : null,
        c.projectUuid && isClaude ? { kind: 'claude-project', href: claudeProjectHref(c.projectUuid), label: `Claude-prosjekt — ${proj}` } : null,
        ...(c.extraLinks || [])].filter(Boolean)
      const header = `# ${c.title}\n\n_${c.source} · ${c.messages} meldinger · ${iso(c.created)}${c.updated && iso(c.updated) !== iso(c.created) ? ` – ${iso(c.updated)}` : ''}${c.project ? ` · prosjekt ${c.project}` : ''}${c.meta ? ` · ${c.meta}` : ''}_\n\n`
      const { atom, status } = put({
        key: `samtale:${c.id}`, kind: 'samtale', name: c.title, content: header + c.transcript, project: proj, convo: c.title,
        source: c.source, by: 'regel', tags: ['samtale', ...(c.tags || [])], links,
        short: ruleS(c.title, c.firstUser), summary: c.summary ? clip(c.summary, 200) : `Importert fra ${label}${via ? ` via ${via}` : ''}.`,
      }, c.updated, { moveFromDefault: !!c.project })
      count(status); perProject[atom.project] = (perProject[atom.project] || 0) + 1
      // artifacts og vedlegg med tekst → egne atomer, bygget av samtalen (men ikke leveranser)
      for (const [list, tag, statKey] of [[c.artifacts, 'artifact', 'artifacts'], [c.attachments, 'vedlegg', 'vedlegg']]) {
        for (const x of list) {
          if ((x.content || '').trim().length < minChars) continue
          const r = put({
            key: `${tag}:${c.id}:${x.id || x.name || x.title}`, kind: 'capture', name: stem(x.title || x.name), content: x.content, project: atom.project, convo: c.title,
            source: c.source, by: 'regel', tags: [tag], links, derivedFrom: [{ id: atom.id, version: atom.version || 1, level: 'L' }],
            short: ruleS(x.title || x.name, `${tag} fra samtalen «${c.title}»${x.path ? ` (${x.path})` : ''}`), summary: `${tag === 'artifact' ? 'Artifact/fil' : 'Vedlegg'} i samtalen «${c.title}» (${c.source}).`,
          }, c.updated, { moveFromDefault: !!c.project })
          if (r.status !== 'uendret') stats[statKey]++
        }
      }
    } catch (e) { stats.feil++; log(`  ⚠ ${c.title}: ${e.message}`) }
  }
  for (const d of data.docs || []) {
    try {
      if (project && d.project.toLowerCase() !== project.toLowerCase()) continue
      if ((d.content || '').trim().length < minChars) continue
      const r = put({
        key: `claude-doc:${d.id}`, name: stem(path.basename(d.title)), content: d.content, project: d.project, source: 'Claude', by: 'regel', tags: ['dokument'],   // «claude/notat.md» → «notat»
        links: d.projectUuid ? [{ kind: 'claude-project', href: claudeProjectHref(d.projectUuid), label: `Claude-prosjekt — ${d.project}` }] : [],
        short: ruleS(d.title, `dokument i Claude-prosjektet «${d.project}»`), summary: `Prosjektkunnskap i Claude (${d.project}), fra ${label}.`,
      }, d.created)
      if (r.status !== 'uendret') stats.dokumenter++
    } catch (e) { stats.feil++; log(`  ⚠ dokument ${d.title}: ${e.message}`) }
  }
  // Claudes minne — «alt Claude vet om brukeren» hører hjemme i Tua. Nøkkel per prosjekt-uuid → idempotent ved ny eksport.
  for (const m of data.minner || []) {
    try {
      if (project && m.project.toLowerCase() !== project.toLowerCase()) continue
      const r = put({
        key: m.key, kind: 'minne', name: m.name, content: m.content, project: m.project, source: 'Claude', by: 'regel', tags: ['minne'],
        links: m.projectUuid ? [{ kind: 'claude-project', href: claudeProjectHref(m.projectUuid), label: `Claude-prosjekt — ${m.project}` }] : [],
        short: ruleS(m.name, firstPara(m.content)), summary: 'Claudes eget minne om brukeren, fra eksporten (memories).',
      }, null)
      if (r.status !== 'uendret') stats.minner++
    } catch (e) { stats.feil++; log(`  ⚠ minne ${m.name}: ${e.message}`) }
  }

  // rapporten — som tekst her, og som atom i prosjekt «Tua»
  const filters = [project && `prosjekt = ${project}`, `minst ${minChars} tegn`, after && `etter ${after}`].filter(Boolean).join(' · ')
  const projLine = Object.entries(perProject).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} (${n})`).join(', ') || '—'
  const f = data.format || null
  const report = [
    `# ${reportName || `Import: ${name}`}`, '',
    `${label} · ${data.convs.length} samtaler${f ? ' i fila' : ''} · ${new Date().toLocaleString('no-NO')}${dryRun ? ' · **dry-run, ingenting skrevet**' : ''}`, '',
    `- **Samtaler:** ${stats.nye} nye · ${stats.oppdatert} oppdatert · ${stats.uendret} uendret${stats.flyttet ? ` · ${stats.flyttet} flyttet fra «${defaultProject}» til prosjektmappa` : ''}`,
    `- **Hoppet over:** ${stats.korte} under ${minChars} tegn${stats.filtrert ? ` · ${stats.filtrert} utenfor filter` : ''}`,
    `- **Egne atomer:** ${stats.dokumenter} prosjektdokumenter · ${stats.artifacts} artifacts/filer · ${stats.vedlegg} vedlegg${kind === 'claude' && f ? ` · ${stats.minner} Claude-minner (kind minne)` : ''}`,
    kind === 'claude' && data.memoryFiles?.length ? `- **Venter:** ${data.memoryFiles.length} minne-filer (memory_files, markdown-notater Claude har skrevet om deg) — blir atomer i en senere milepæl` : null,
    `- **Prosjekter:** ${projLine}`,
    `- **Filter:** ${filters}`,
    stats.feil ? `- **Feil:** ${stats.feil} (se serverloggen)` : null,
    ...extraLines, '',
    ...(f ? [
      '## Format (verifisert mot fila)', '',
      `- Felter på samtalen: ${(f.felter || []).join(', ') || '—'}`,
      f.meldingsfelter ? `- Felter på meldingen: ${f.meldingsfelter.join(', ')}` : null,
      kind === 'claude' ? `- Prosjekt-kobling på samtalene: ${f.prosjektkobling ? `ja (${f.prosjektkobling})` : `nei — samtaler uten prosjekt ligger i «${defaultProject}»`}${f.design ? ` · ${f.design} design-samtaler (har prosjekt)` : ''}${f.prosjekterIFila ? ` · ${f.prosjekterIFila} prosjekter i fila` : ''}${f.prosjekterFraNabo ? ` · ${f.prosjekterFraNabo} prosjekter lest fra projects-*.zip ved siden av` : ''}${f.andreFiler?.length ? ` · ikke brukt: ${f.andreFiler.slice(0, 4).join(', ')}` : ''}` : null, '',
    ] : []),
    `Hver samtale er ett atom (kind «samtale») med peker tilbake til samtalen; S er laget etter regel (tittel + første melding). M lages med «ny gjennomgang» (\`node tua-plugin/server/review.js\`).`,
    moveTo ? `Fila er flyttet til ${moveTo}.` : null, 'Alt kan slettes igjen i Finder.',
  ].filter((l) => l !== null).join('\n')

  let written = 0
  if (!dryRun) {
    const changed = stats.nye + stats.oppdatert + stats.flyttet + stats.dokumenter + stats.artifacts + stats.vedlegg + stats.minner
    if (afterSave) afterSave(atoms, stats)
    upsert(atoms, {
      key: reportKey || `import:${name}`, name: reportName || `Import: ${name}`, content: report, project: 'Tua', convo: reportConvo, source: 'Tua', by: 'regel', tags: ['import'],
      short: clip(`${label}${name ? ` «${name}»` : ''}: ${stats.nye} nye og ${stats.oppdatert} oppdaterte samtaler, ${stats.korte} hoppet over (under ${minChars} tegn)${stats.dokumenter ? `, ${stats.dokumenter} dokumenter` : ''}${stats.artifacts ? `, ${stats.artifacts} artifacts/filer` : ''}${stats.minner ? `, ${stats.minner} Claude-minner` : ''}. Prosjekter: ${projLine}.`, S_MAX),
      summary: `Rapport fra import (${label}) ${new Date().toLocaleDateString('no-NO')}.`,
    })
    written = save(atoms)
    if (noteKind) noteImport(noteKind, { nye: stats.nye, oppdatert: stats.oppdatert, samtaler: data.convs.length })
    if (changed) finishOnboarding('import')
  }
  return { report, stats, written, count: data.convs.length }
}

// ── M17: Desktop-cachen → atomer ────────────────────────────────────────────
// Samme atom-form som eksporten (importParsed), men kilden er «Claude Desktop» og samtalene kommer MED prosjekt der cachen
// vet det (liste-svarene), verktøykall-markører og filer Claude skrev (create_file) som egne atomer. Nøkkel samtale:<uuid>
// er den samme som eksporten bruker → en samtale fra conversations-000.zip oppgraderes (ny versjon) i stedet for å dupliseres,
// og flyttes fra «Claude-samtaler» til prosjektmappa når cachen kjenner prosjektet. Idempotent på uuid + updated_at.
const DESKTOP_LABEL = 'Claude Desktop (cache)'
export function desktopData({ log = () => {}, all = false } = {}) {
  const since = all ? null : importedDesktop()
  const d = collectDesktop({ log, since })
  const convs = d.convs.map((c) => {
    const toolN = Object.values(c.tools).reduce((a, b) => a + b, 0)
    const meta = [toolN ? `${toolN} verktøykall` : null, c.thinking ? `${c.thinking} tankeblokker (ikke med)` : null, c.branches ? `${c.branches} meldinger på andre grener (ikke med)` : null, c.model || null].filter(Boolean).join(' · ')
    return {
      id: c.id, title: c.title, created: c.created, updated: c.updated, project: c.projectName ? c.projectName.replace(/[. ]+$/, '') : null, projectUuid: c.projectUuid,
      source: c.snapshot ? 'Claude (delt lenke)' : 'Claude Desktop', href: c.snapshot ? `https://claude.ai/share/${c.id.replace(/^share:/, '')}` : `claude://claude.ai/chat/${c.id}`,
      summary: c.summary, firstUser: c.firstUser, transcript: c.transcript, messages: c.messages, artifacts: c.artifacts, attachments: c.attachments, meta, tags: c.snapshot ? ['delt'] : ['desktop'],
    }
  })
  const projects = [...d.projects].map(([uuid, name]) => ({ uuid, name: String(name).replace(/[. ]+$/, '') }))
  const byUuid = new Map(projects.map((p) => [p.uuid, p.name]))
  const docs = d.docs.map((x) => ({ ...x, project: byUuid.get(x.projectUuid) || 'Claude-prosjekter' }))
  return { kind: 'claude', convs, docs, projects, artifacts: d.artifacts, stats: d.stats, best: d.best, minner: [], memoryFiles: [] }
}
export function importDesktop({ dryRun = false, project = null, minChars = DEFAULT_MIN, after = null, log = () => {}, all = false } = {}) {
  const t0 = Date.now()
  if (!cacheAvailable()) return { report: `Fant ingen Desktop-cache (${CACHE_DIR}) — er Claude Desktop installert på denne maskinen?`, stats: { samtaler: 0 }, kind: 'desktop', count: 0 }
  const data = desktopData({ log, all })
  const st = data.stats
  log(`Desktop-cache: ${st.samtaler} samtaler i cachen (${data.convs.length} nye/endrede), ${st.prosjekter} prosjekter, ${st.dokumenter} dokumenter med tekst, ${st.artifactVersjoner} artifact-versjoner${dryRun ? ' · DRY-RUN' : ''}`)
  // artifact-versjoner (artifacts/<uuid>/versions) → egne atomer når de har tekst. Formatet er bare delvis sett (Eriks cache hadde 2 ikke-tomme).
  const artAtoms = []
  for (const [uuid, versions] of data.artifacts) {
    const v = versions[versions.length - 1]
    const content = typeof v?.content === 'string' ? v.content : typeof v?.text === 'string' ? v.text : typeof v?.file_text === 'string' ? v.file_text : ''
    if (content.trim().length >= minChars) artAtoms.push({ uuid, title: String(v.title || v.artifact_identifier || v.artifact_uuid || uuid).replace(/^compass_artifact_|_text\/markdown$/g, ''), content, versions: versions.length, type: v.artifact_type || '' })
  }
  const r = importParsed(data, {
    name: 'Desktop-cache', label: DESKTOP_LABEL, kind: 'claude', dryRun, project, minChars, after, log, via: 'cachen',
    reportKey: 'import:desktop', reportName: 'Import: Claude Desktop (cache)', reportConvo: 'Historikk', noteKind: 'desktop',
    extraLines: [
      `- **Cachen:** ${CACHE_DIR} · ${st.filer} svar fra claude.ai/api · ${st.samtaler} samtaler (${st.dekodet} filer dekodet, ${st.ufullstendige} ufullstendige hoppet over) · ${st.lister} listesvar med prosjekt-kobling · ${st.snapshots} delte lenker åpnet i Desktop`,
      artAtoms.length ? `- **Artifact-versjoner:** ${artAtoms.length} med tekst (${[...data.artifacts.values()].reduce((n, v) => n + v.length, 0)} versjoner i cachen)` : null,
      '- **Hva som er med i L:** brukerens meldinger og Claudes svar på den grenen brukeren ser, markører for verktøykall, filer Claude skrev (create_file) og vedlegg med tekst som egne atomer. Ikke med: verktøyresultater og tankeblokker.',
      '- **Grense:** cachen har bare samtaler som har vært ÅPNET i Claude Desktop, og slik de så ut sist de ble åpnet. Åpne en samtale i Desktop, så er den med innen 10 minutter.',
    ].filter(Boolean),
    afterSave: (atoms) => {
      for (const a of artAtoms) upsert(atoms, { key: `artifact:${a.uuid}`, kind: 'capture', name: stem(a.title), content: a.content, project: 'Claude-samtaler', convo: '', source: 'Claude Desktop', by: 'regel', tags: ['artifact', 'desktop'], short: ruleS(a.title, `artifact (${a.versions} versjoner) fra Claude Desktop-cachen`), summary: `Artifact fra Claude Desktop (${a.type || 'ukjent type'}).` })
      const map = {}; for (const [id, b] of data.best) map[id] = b.updated
      noteImportedDesktop(map)
    },
  })
  if (!dryRun) log(`Desktop-cache: ${r.stats.nye} nye · ${r.stats.oppdatert} oppdatert · ${r.stats.flyttet} flyttet · ${r.stats.uendret} uendret · ${r.stats.korte} korte · ${r.written} filer skrevet · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  return { report: r.report, stats: { ...r.stats, samtaler: st.samtaler }, kind: 'desktop', count: data.convs.length }
}
// Overvåker: ved start og hvert 10. minutt — alt brukeren åpner i Desktop fanges av seg selv. Aldri skriv til cachen.
export function watchDesktop({ log = () => {}, everyMs = 10 * 60 * 1000, delayMs = 4000 } = {}) {
  if (ensureArchive().needsChoice || !cacheAvailable()) return () => {}
  const run = () => { try { const r = importDesktop({ log: () => {} }); if (r.stats.nye || r.stats.oppdatert || r.stats.flyttet) log(`Desktop-cache: ${r.stats.nye} nye · ${r.stats.oppdatert} oppdaterte · ${r.stats.flyttet} flyttet (av ${r.stats.samtaler} i cachen)`) } catch (e) { log(`Desktop-cache: ${e.message}`) } }
  const first = setTimeout(run, delayMs)
  const timer = setInterval(run, everyMs)
  timer.unref?.(); first.unref?.()
  return () => { clearTimeout(first); clearInterval(timer) }
}

// ── M17: delte lenker (claude.ai/share/<id>) ────────────────────────────────
// En delt lenke er en offentlig side brukeren selv har laget med «Del». Vi henter siden uten innlogging og uten cookies.
// Slik den er i dag (sett 14.10.2026) er den et tomt app-skall som laster samtalen etterpå via et eget endepunkt — det
// endepunktet kaller Tua IKKE (interne API-et, Consumer Terms §3). Derfor: atomet blir en peker med det siden gir, og
// innholdet fylles når brukeren åpner lenken i Claude Desktop — da ligger svaret i cachen (chat_snapshots/<id>) og
// Desktop-leseren oppgraderer atomet (samme nøkkel samtale:share:<id>).
export const SHARE_RE = /https?:\/\/claude\.ai\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
export const shareLinksIn = (text) => [...new Set([...String(text || '').matchAll(SHARE_RE)].map((m) => `https://claude.ai/share/${m[1].toLowerCase()}`))]
export async function fetchSharePage(url, { timeoutMs = 15000 } = {}) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'Tua/0.3 (lokalt arkiv; henter offentlig delt side)', accept: 'text/html' } })
    const loc = res.headers.get('location') || ''
    if (res.status >= 300 && res.status < 400) return { status: res.status, state: /login|auth/i.test(loc) ? 'innlogging' : 'omdirigert', title: '', html: '' }
    if (res.status === 404 || res.status === 410) return { status: res.status, state: 'borte', title: '', html: '' }
    if (res.status === 401 || res.status === 403) return { status: res.status, state: 'innlogging', title: '', html: '' }
    const html = res.ok ? await res.text() : ''
    if (!res.ok) return { status: res.status, state: 'feil', title: '', html: '' }
    const title = (html.match(/<meta property="og:title" content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/) || [])[1] || ''
    const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''
    // ligger samtalen i selve siden (server-rendret)? Da tar vi den. Ellers er det skallet.
    let json = null
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || html.match(/window\.__remixContext\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
    if (m) { try { json = JSON.parse(m[1]) } catch {} }
    const inPage = /"chat_messages"\s*:\s*\[/.test(html)
    return { status: res.status, state: inPage ? 'innhold' : 'skall', title: title && title !== 'Claude' ? title : '', desc, html, json, inPage }
  } catch (e) { return { status: 0, state: e.name === 'AbortError' ? 'tidsavbrudd' : 'feil', error: e.message, title: '', html: '' } }
  finally { clearTimeout(t) }
}
export async function importShare(url, { dryRun = false, log = () => {}, via = 'chat', minChars = DEFAULT_MIN } = {}) {
  const links = shareLinksIn(url)
  if (!links.length) return { report: `«${String(url).slice(0, 120)}» er ikke en delt Claude-lenke (claude.ai/share/<id>).`, stats: { lenker: 0 }, kind: 'lenke', count: 0 }
  const lines = [], stats = { lenker: links.length, innhold: 0, pekere: 0, innlogging: 0, borte: 0, feil: 0 }
  const atoms = load()
  for (const link of links) {
    const id = link.split('/').pop()
    const key = `samtale:share:${id}`
    const page = await fetchSharePage(link)
    log(`Delt lenke ${id.slice(0, 8)}…: ${page.state}${page.title ? ` «${page.title}»` : ''}`)
    const old = atoms.find((a) => a.key === key)
    let note
    if (page.state === 'innlogging') { stats.innlogging++; note = 'siden krever innlogging — Tua omgår ikke det; åpne lenken selv i Claude Desktop, så fanges samtalen fra cachen' }
    else if (page.state === 'borte') { stats.borte++; note = 'lenken finnes ikke lenger (404)' }
    else if (page.state === 'feil' || page.state === 'tidsavbrudd') { stats.feil++; note = `kunne ikke hente siden (${page.error || page.status})` }
    else if (page.state === 'innhold' && page.json) { note = 'samtalen lå i siden' }
    else { note = 'siden er et app-skall uten samtalen — innholdet fylles når lenken åpnes i Claude Desktop (cache-leseren, innen 10 min)' }
    // innholdet: Desktop-cachen (chat_snapshots/<id>) hvis lenken alt er åpnet der. (Server-rendret innhold i selve siden
    // er ikke sett ennå — skulle det dukke opp, er `page.json` stedet å lese det fra.)
    let conv = null
    try { conv = cacheAvailable() ? desktopData({ all: true }).convs.find((c) => c.id === `share:${id}`) || null : null } catch (e) { log(`  cache-oppslag: ${e.message}`) }
    if (conv) {
      const r = importParsed({ kind: 'claude', convs: [{ ...conv, source: 'Claude (delt lenke)', href: link }], docs: [], projects: [] }, { name: `delt lenke ${id.slice(0, 8)}`, label: 'Claude (delt lenke)', dryRun, minChars, log, via, reportKey: 'import:lenker', reportName: 'Import: delte lenker', reportConvo: 'Historikk' })
      stats.innhold++
      lines.push(`- ${link} — samtalen «${conv.title}» (${conv.messages} meldinger) fra Desktop-cachen → ${r.stats.nye ? 'nytt atom' : r.stats.oppdatert ? 'oppdatert' : 'uendret'}`)
      continue
    }
    stats.pekere++
    const content = [
      `# Delt Claude-samtale${page.title ? `: ${page.title}` : ''}`, '',
      `_Claude (delt lenke) · ${new Date().toLocaleDateString('no-NO')} · mottatt via ${via}_`, '',
      `Lenke: ${link}`, '',
      `Status ved mottak: ${note}.`, '',
      page.state === 'skall' ? 'Den offentlige siden inneholder ikke samtalen selv (den lastes i nettleseren etterpå). Tua kaller ikke claude.ai sitt interne API. **Åpne lenken i Claude Desktop** — da ligger samtalen i appens cache, og dette atomet får hele transkriptet ved neste runde (hvert 10. minutt, eller `tua_import kilde=desktop`).' : '',
      page.desc ? `\nBeskrivelse fra siden: ${page.desc}` : '',
    ].filter((l) => l !== null).join('\n')
    if (!dryRun) {
      const { status } = upsert(atoms, {
        key, kind: 'samtale', name: page.title ? `Delt: ${page.title}` : `Delt Claude-samtale ${id.slice(0, 8)}`, content, project: 'Claude-samtaler', convo: page.title || `Delt lenke ${id.slice(0, 8)}`,
        source: 'Claude (delt lenke)', by: 'regel', tags: ['samtale', 'delt'], links: [{ kind: 'url', href: link, label: 'Delt lenke (claude.ai/share)' }],
        short: clip(`Delt Claude-samtale${page.title ? ` «${page.title}»` : ''} — ${note}.`, S_MAX), summary: `Delt lenke mottatt via ${via}; innholdet fanges fra Desktop-cachen når lenken åpnes der.`,
      })
      lines.push(`- ${link} — ${old ? status : 'peker-atom lagret'}: ${note}`)
    } else lines.push(`- ${link} — ville lagret peker-atom: ${note}`)
  }
  const report = [`# Import: delte lenker`, '', `${links.length} lenke${links.length === 1 ? '' : 'r'} · ${new Date().toLocaleString('no-NO')}${dryRun ? ' · **dry-run, ingenting skrevet**' : ''}`, '', ...lines, '',
    `- **Med innhold (fra Desktop-cachen):** ${stats.innhold} · **pekere:** ${stats.pekere}${stats.innlogging ? ` · **krever innlogging:** ${stats.innlogging}` : ''}${stats.borte ? ` · **borte:** ${stats.borte}` : ''}${stats.feil ? ` · **feil:** ${stats.feil}` : ''}`,
    'Delte lenker er offentlige sider brukeren selv lager med «Del» i Claude. Tua henter dem uten innlogging og uten cookies, og kaller aldri det interne API-et; derfor fylles innholdet først når lenken åpnes i Claude Desktop.'].join('\n')
  if (!dryRun && stats.pekere) { save(atoms); noteImport('lenke', { lenker: links.length, pekere: stats.pekere }) }
  return { report, stats, kind: 'lenke', count: links.length }
}
// Innboks: .url (Windows), .webloc (macOS: dra en lenke til Finder), .txt/.md med en delt lenke i — også delt fra mobil via
// «Lagre i Filer» til iCloud/Dropbox-mappa Tua/Innboks. Små filer; behandles asynkront, flyttes til Ferdig.
const SHARE_FILE = /\.(url|webloc|txt|md)$/i
const shareLinksInFile = (p) => { try { if (fs.statSync(p).size > 1e6) return []; return shareLinksIn(fs.readFileSync(p, 'utf8')) } catch { return [] } }
export function inboxShareFiles() { try { return fs.readdirSync(INBOX_DIR).filter((n) => !n.startsWith('.') && SHARE_FILE.test(n) && shareLinksInFile(path.join(INBOX_DIR, n)).length).map((n) => path.join(INBOX_DIR, n)) } catch { return [] } }
export async function processInboxShares({ dryRun = false, log = () => {} } = {}) {
  if (ensureArchive().needsChoice) return []
  const done = []
  for (const src of inboxShareFiles()) {
    const n = path.basename(src)
    const links = shareLinksInFile(src)
    try {
      const r = await importShare(links.join('\n'), { dryRun, log, via: `Innboks (${n})` })
      if (!dryRun) { fs.mkdirSync(FERDIG(), { recursive: true }); fs.renameSync(src, uniq(FERDIG(), n)) }
      done.push({ name: n, ...r })
    } catch (e) { log(`⚠ ${n}: ${e.message}`) }
  }
  return done
}

// ── M17: Finder-connector (finder.js) + «alt» + tallene til onboardingen ───
export function importFinder({ dryRun = false, log = () => {}, folders = null, desktop = null, minChars = DEFAULT_MIN } = {}) {
  return scanFinder({ dryRun, log, folders, desktop: desktop || (cacheAvailable() ? desktopData({ all: true }) : null), minChars })
}
export async function importAll(opts = {}) {
  const parts = []
  const safe = (label, fn) => { try { return fn() } catch (e) { opts.log?.(`${label}: ${e.message}`); return { report: `${label}: ${e.message}` } } }
  parts.push(safe('Code', () => importCode({ ...opts, source: 'code' })))
  parts.push(safe('Cowork', () => importCode({ ...opts, source: 'cowork' })))
  parts.push(safe('Desktop', () => importDesktop(opts)))
  parts.push(safe('Finder', () => importFinder(opts)))
  const inbox = processInbox(opts); for (const r of inbox) parts.push(r)
  for (const r of await processInboxShares(opts)) parts.push(r)
  return { report: parts.map((p) => p.report).join('\n\n---\n\n'), parts }
}
// «Jeg fant N Code-økter, N Cowork-økter, N Desktop-samtaler, N dokumenter — vil du ta dem med?» Tallene koster ~1–12 s
// første gang (Desktop-cachen har 60 000 filer); huskes i 10 minutter per prosess.
// `quick`: bare det som er raskt (SessionStart-hooken har 10 s): Desktop-tallet fra forrige skanning, Finder bare opphavs-kriteriet.
let countsMemo = null
export function historyCounts({ fresh = false, quick = false } = {}) {
  if (!fresh && countsMemo && Date.now() - countsMemo.at < 10 * 60 * 1000) return countsMemo
  const st = importState()
  const c = {
    at: Date.now(),
    code: pendingCodeSessions(st.code?.at || 0), codeAll: listCodeSessions().filter((s) => s.size > 2000).length,
    cowork: pendingCoworkSessions(st.cowork?.at || 0), coworkAll: listCoworkSessions().filter((s) => s.size > 20000).length,
    desktop: 0, desktopNew: 0, dokumenter: 0, innboks: inboxPending().length + inboxShareFiles().length, quick,
  }
  try {
    if (cacheAvailable()) {
      c.desktop = countDesktopConversations({ quick })
      const imp = importedDesktop(); c.desktopNew = Math.max(0, c.desktop - Object.keys(imp).filter((k) => !k.startsWith('share:')).length)
    }
  } catch {}
  try { c.dokumenter = countFinderCandidates({ desktop: !quick && cacheAvailable() ? desktopData({ all: true }) : null, quick }) } catch {}
  if (!quick) countsMemo = c
  return c
}
export const historyLine = (c = historyCounts()) => {
  const parts = [c.code && `${c.code} Code-økt${c.code === 1 ? '' : 'er'}`, c.cowork && `${c.cowork} Cowork-økt${c.cowork === 1 ? '' : 'er'}`, c.desktopNew > 0 && `${c.desktopNew} Desktop-samtale${c.desktopNew === 1 ? '' : 'r'}`, c.dokumenter && `${c.dokumenter} dokument${c.dokumenter === 1 ? '' : 'er'}`].filter(Boolean)
  return parts.length ? `Jeg fant ${parts.join(', ')} på denne maskinen som ikke er i Tua — vil du ta dem med?` : ''
}

// ── Innboks: overvåking ─────────────────────────────────────────────────────
const isCandidate = (p) => { try { if (/ \(feilet\)/.test(p)) return false; const st = fs.statSync(p); return (st.isFile() && (/\.zip$/i.test(p) || isManifest(p))) || (st.isDirectory() && !!findRoot(p)) } catch { return false } }
const stable = (p) => { try { const a = fs.statSync(p).size; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); return fs.statSync(p).size === a } catch { return false } }
const uniq = (dir, base) => { let p = path.join(dir, base); if (!exists(p)) return p; const e = path.extname(base), b = base.slice(0, base.length - e.length); return path.join(dir, `${b} (${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')})${e}`) }
export function inboxPending() { try { return fs.readdirSync(INBOX_DIR).filter((n) => !n.startsWith('.') && n !== 'Ferdig' && isCandidate(path.join(INBOX_DIR, n))) } catch { return [] } }

// Én gjennomgang av Innboks. Hver fil «kreves» ved å flyttes til .behandles (atomisk) før den leses.
export function processInbox({ dryRun = false, log = () => {}, ...opts } = {}) {
  if (ensureArchive().needsChoice) return []
  let entries = []
  try { entries = fs.readdirSync(INBOX_DIR).filter((n) => !n.startsWith('.') && n !== 'Ferdig') } catch { return [] }
  const done = []
  // projects-*.zip først, så samtaler, design og minner får prosjektnavn; manifestet sist, så statusen stemmer
  entries.sort((a, b) => (/^projects-/.test(b) ? 1 : 0) - (/^projects-/.test(a) ? 1 : 0) || (/\.json$/i.test(a) ? 1 : 0) - (/\.json$/i.test(b) ? 1 : 0))
  for (const n of entries) {
    const src = path.join(INBOX_DIR, n)
    if (!isCandidate(src) || !stable(src)) continue
    let work = src
    if (!dryRun) {
      fs.mkdirSync(BEHANDLES(), { recursive: true })
      work = path.join(BEHANDLES(), n)
      try { fs.renameSync(src, work) } catch { continue }           // en annen prosess tok den
    }
    try {
      const dest = dryRun ? null : uniq(FERDIG(), n)
      const r = importExport(work, { ...opts, dryRun, log, moveTo: dest ? path.relative(FILES_ROOT, dest) : null })
      if (!dryRun) { fs.mkdirSync(FERDIG(), { recursive: true }); fs.renameSync(work, dest) }
      done.push({ name: n, ...r })
    } catch (e) {
      log(`⚠ ${n}: ${e.message}`)
      if (!dryRun) { try { fs.renameSync(work, uniq(INBOX_DIR, n.replace(/(\.(zip|json))?$/i, ' (feilet)$1'))) } catch {} }   // «(feilet)» i navnet → prøves ikke igjen
    }
  }
  return done
}

// Overvåk Innboks: sjekk ved oppstart (etter 2 s, så MCP-håndtrykket går først) og ved endringer (debounce 3 s).
// Er arkivet ikke valgt ennå, gjøres ingenting (kall igjen etter tua_setup).
export function watchInbox({ log = () => {} } = {}) {
  if (ensureArchive().needsChoice) return () => {}
  let timer = null
  const kick = (delay) => { clearTimeout(timer); timer = setTimeout(async () => {
    try { const d = processInbox({ log }); for (const r of d) log(`Innboks: ${r.name} importert — ${r.stats.nye} nye, ${r.stats.oppdatert} oppdatert (rapport lagret som atom)`) } catch (e) { log(`Innboks: ${e.message}`) }
    try { for (const r of await processInboxShares({ log })) log(`Innboks: ${r.name} — ${r.stats.lenker} delt${r.stats.lenker === 1 ? '' : 'e'} lenke${r.stats.lenker === 1 ? '' : 'r'} (${r.stats.innhold} med innhold, ${r.stats.pekere} pekere)`) } catch (e) { log(`Innboks (lenker): ${e.message}`) }   // M17
  }, delay) }
  try { fs.mkdirSync(INBOX_DIR, { recursive: true }) } catch {}
  let watcher = null
  try { watcher = fs.watch(INBOX_DIR, { persistent: false }, () => kick(3000)) } catch (e) { log(`Innboks: kan ikke overvåke ${INBOX_DIR} (${e.message})`) }
  kick(2000)
  return () => { clearTimeout(timer); watcher?.close() }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
  const opts = { dryRun: args.includes('--dry-run'), project: flag('--project'), minChars: Number(flag('--min-tegn')) || DEFAULT_MIN, after: flag('--etter'), log: (m) => console.error(m) }
  const src = args.find((a) => !a.startsWith('--') && ![flag('--project'), flag('--min-tegn'), flag('--etter'), flag('--lenke')].includes(a))
  if (!filesMode()) { console.error(`Arkivet er ikke valgt ennå — sett TUA_FILES_ROOT eller velg sted i Claude (tua_setup).`); process.exit(2) }
  if (args.includes('--code')) {
    console.log(importCode(opts).report)
  } else if (args.includes('--cowork')) {
    console.log(importCode({ ...opts, source: 'cowork' }).report)
  } else if (args.includes('--desktop')) {
    console.log(importDesktop({ ...opts, all: args.includes('--alle') }).report)
  } else if (args.includes('--finder')) {
    console.log(importFinder(opts).report)
  } else if (flag('--lenke')) {
    importShare(flag('--lenke'), { ...opts, via: 'kommandolinje' }).then((r) => console.log(r.report))
  } else if (args.includes('--tall')) {
    const c = historyCounts({ fresh: true }); console.log(JSON.stringify(c, null, 2)); console.log(historyLine(c) || 'Ingenting nytt å ta med.')
  } else if (args.includes('--alt')) {
    importAll(opts).then((r) => console.log(r.report))
  } else if (args.includes('--innboks')) {
    const d = processInbox(opts)
    processInboxShares(opts).then((s) => { const all = [...d, ...s]; console.log(all.length ? all.map((r) => r.report).join('\n\n---\n\n') : `Ingenting å importere i ${INBOX_DIR}`) })
  } else if (src) {
    console.log(importExport(path.resolve(src), opts).report)
  } else {
    console.error('Bruk: node import.js --code|--cowork|--desktop [--alle]|--finder|--alt [--project <navn>] [--etter <ÅÅÅÅ-MM-DD>] [--min-tegn <n>] [--dry-run]\n      node import.js --lenke <https://claude.ai/share/…> [--dry-run]\n      node import.js --tall           (hva onboardingen ville sagt)\n      node import.js <zip|mappe> [--dry-run] [--project <navn>] [--min-tegn <n>] [--etter <ÅÅÅÅ-MM-DD>]\n      node import.js --innboks [--dry-run]')
    process.exit(2)
  }
}
