// desktop.js — Desktop-cache-leseren (M17). Claude Desktop er en Chromium-app, og hvert svar fra claude.ai sitt
// API som appen har hentet, ligger igjen i appens HTTP-cache på disk — også hele samtaler (meldingstre, verktøykall,
// vedlegg), listesvar med prosjekt-kobling, prosjektkunnskap og artifact-versjoner. Alt brukeren har ÅPNET i Desktop
// finnes altså lokalt, i måneder. Denne leseren gjør cachen til atomer: uten nettverk, uten innlogging, uten eksport.
//
//   ~/Library/Application Support/Claude/Cache/Cache_Data/<hash>_0   (Chromiums «simple cache», én fil per svar)
//
// Filformat (verifisert mot Eriks maskin 14.10.2026, Chromium-versjon 5):
//   [24 B header: magic, versjon, nøkkel-lengde, nøkkel-hash] [nøkkel = «1/0/<URL>»] [strøm 1 = svaret, zstd eller ren JSON]
//   [24 B EOF: magic, flagg, crc32, 0] [strøm 0 = HTTP-headere] [32 B sha256 av nøkkelen hvis flagg 2] [24 B EOF: …, lengde strøm 0]
// Strøm 1 sin lengde regnes bakfra. CRC32 sjekkes — en fil appen er midt i å skrive, hoppes over til neste runde.
//
// Regler: cachen leses ALDRI på stedet — hver fil kopieres til en temp-mappe, leses, og kopien slettes (appen holder filer
// åpne). Ingenting skrives til ~/Library/Application Support/Claude. Nøkler (bare de første ~300 B av hver fil) huskes
// per fil i <arkiv>/.tua/desktop-state.json med størrelse + mtime, så en ny runde bare åpner filer som er nye eller endret.
// Idempotent på samtale-uuid + updated_at: en samtale som ikke har endret seg siden sist, dekodes ikke på nytt.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { DATA_DIR } from './store.js'
import { CLAUDE_APP_DIR } from './platform.js'
import { ChromeIndexedDb } from './idb.js'

// macOS: ~/Library/Application Support/Claude · Windows: %APPDATA%\Claude · Linux: ~/.config/Claude (platform.js)
export const CACHE_DIR = process.env.TUA_DESKTOP_CACHE || path.join(CLAUDE_APP_DIR, 'Cache', 'Cache_Data')
// 20.10.2026: fra Desktop 2.42304 (ca. 15.09.2026) ligger samtaleinnholdet ikke lenger i HTTP-cachen, men i appens IndexedDB
// («claude-conversation-store», objektlageret «trees»): de sist åpnede samtalene — chat og Cowork («hub») — med hele
// meldingstreet for korte samtaler og et utsnitt (historyWindow «windowed», fra floorIndex) for lange. HTTP-cachen har
// fortsatt listesvarene (tittel + prosjekt) og eldre samtaler, så begge leses og nyeste versjon per uuid vinner.
export const IDB_DIR = process.env.TUA_DESKTOP_IDB || path.join(CLAUDE_APP_DIR, 'IndexedDB', 'https_claude.ai_0.indexeddb.leveldb')
export const IDB_BLOB_DIR = IDB_DIR.replace(/\.leveldb$/, '.blob')
export const idbAvailable = () => { try { return fs.statSync(IDB_DIR).isDirectory() } catch { return false } }
// zstd-dekoding kom i Node 22.15 / 23.8. Eldre Node: cachen kan ikke leses, og det sies i stedet for å feile stille.
export const ZSTD_OK = typeof zlib.zstdDecompressSync === 'function'
const zstd = (b) => { if (!ZSTD_OK) throw new Error(`Desktop-cachen er zstd-komprimert og trenger Node ≥ 22.15 (har ${process.version})`); return zlib.zstdDecompressSync(b) }
const INITIAL_MAGIC = Buffer.from('305c72a71b6dfbfc', 'hex')      // 0xfcfb6d1ba7725c30, little-endian (sett i fila; Chromium simple cache)
const FINAL_MAGIC = Buffer.from('d8410d97456ffaf4', 'hex')        // 0xf4fa6f45970d41d8
const ZSTD_MAGIC = Buffer.from('28b52ffd', 'hex')
const HEADER = 24, EOF = 24, KEY_MAX = 4096
// Tilstanden er maskin-spesifikk (cachen er på denne maskinen) og ~2 MB — den ligger i den lokale datamappa, ikke i arkivet (Dropbox)
const STATE = () => path.join(DATA_DIR, 'desktop-state.json')
const UUID = '[0-9a-f-]{36}'

// ── nøkkel → hva slags svar ─────────────────────────────────────────────────
// Bare svar fra claude.ai/api er interessante. Rekkefølgen betyr noe (docs/<uuid> før docs-lista).
const KINDS = [
  ['conv', new RegExp(`/chat_conversations/(${UUID})(\\?|$)`)],
  ['snapshot', new RegExp(`/chat_snapshots/(${UUID})(\\?|$)`)],          // delt lenke åpnet i Desktop (claude.ai/share/<id>)
  ['list', /\/chat_conversations_v2(\?|$)/],
  ['plist', new RegExp(`/projects/(${UUID})/conversations_v2(\\?|$)`)],
  ['doc', new RegExp(`/projects/(${UUID})/docs/(${UUID})(\\?|$)`)],
  ['docs', new RegExp(`/projects/(${UUID})/docs(\\?|$)`)],
  ['art', new RegExp(`/artifacts/(${UUID})/versions(\\?|$)`)],
  ['project', new RegExp(`/projects/(${UUID})(\\?|$)`)],
  ['projects', /\/projects(\?|$)/],
]
export function classify(key) {
  if (!/^1\/0\/https:\/\/claude\.ai\/api\//.test(key)) return null
  for (const [kind, re] of KINDS) { const m = key.match(re); if (m) return { kind, id: m[1] || null, id2: m[2] && m[2].length === 36 ? m[2] : null } }
  return null
}

// ── én fil ──────────────────────────────────────────────────────────────────
// Nøkkelen står i klartekst etter headeren; vi leser bare så mye som trengs (ingen kopi for dette).
export function readKey(file) {
  let fd = null
  try {
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(HEADER)
    if (fs.readSync(fd, head, 0, HEADER, 0) < HEADER || !head.subarray(0, 8).equals(INITIAL_MAGIC)) return null
    const keyLen = head.readUInt32LE(12)
    if (keyLen < 8 || keyLen > KEY_MAX) return null
    const key = Buffer.alloc(keyLen)
    if (fs.readSync(fd, key, 0, keyLen, HEADER) < keyLen) return null
    return key.toString('latin1')
  } catch { return null } finally { if (fd !== null) fs.closeSync(fd) }
}
// Hele svaret: kopi → dekod → slett kopien. Returnerer { key, status, json } eller null (ufullstendig/ugyldig fil).
export function readEntry(file, tmpDir) {
  const copy = path.join(tmpDir, path.basename(file))
  try {
    fs.copyFileSync(file, copy)
    const b = fs.readFileSync(copy)
    if (b.length < HEADER + EOF * 2 || !b.subarray(0, 8).equals(INITIAL_MAGIC)) return null
    const keyLen = b.readUInt32LE(12)
    const key = b.subarray(HEADER, HEADER + keyLen).toString('latin1')
    const e0 = b.length - EOF
    if (!b.subarray(e0, e0 + 8).equals(FINAL_MAGIC)) return null
    const flags0 = b.readUInt32LE(e0 + 8), size0 = b.readUInt32LE(e0 + 16)
    const e1 = e0 - (flags0 & 2 ? 32 : 0) - size0 - EOF
    if (e1 < HEADER + keyLen || !b.subarray(e1, e1 + 8).equals(FINAL_MAGIC)) return null
    const flags1 = b.readUInt32LE(e1 + 8), crc = b.readUInt32LE(e1 + 12)
    const body = b.subarray(HEADER + keyLen, e1)
    if ((flags1 & 1) && zlib.crc32(body) !== crc) return null                      // appen skriver fortsatt
    const headers = b.subarray(e1 + EOF, e1 + EOF + size0).toString('latin1')
    const status = Number((headers.match(/HTTP\/1\.1 (\d{3})/) || [])[1]) || 0
    if (status !== 200 || !body.length) return { key, status, json: null }
    const text = (body.subarray(0, 4).equals(ZSTD_MAGIC) ? zstd(body) : body).toString('utf8')
    let json = null
    try { json = JSON.parse(text) } catch { return { key, status, json: null } }
    return { key, status, json }
  } catch { return null } finally { try { fs.unlinkSync(copy) } catch {} }
}

// ── tilstand per fil ────────────────────────────────────────────────────────
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')) } catch { return {} } }
function writeState(s) {
  try { fs.mkdirSync(path.dirname(STATE()), { recursive: true }); const tmp = STATE() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s) + '\n'); fs.renameSync(tmp, STATE()) } catch {}
}
export const cacheAvailable = () => { try { return fs.statSync(CACHE_DIR).isDirectory() } catch { return false } }

// Alle relevante filer i cachen: { file, kind, id, size, mtime } — nøkler fra forrige runde gjenbrukes når fila er uendret.
// Tilstanden per fil er kompakt: [størrelse, mtime] for uinteressante filer, [størrelse, mtime, kind, id, id2] for svar fra claude.ai/api.
export function scanCache({ state = readState(), log = () => {} } = {}) {
  const out = []
  if (!cacheAvailable()) return out
  const files = state.files || {}
  const seen = new Set()
  let opened = 0
  for (const name of fs.readdirSync(CACHE_DIR)) {
    if (!name.endsWith('_0')) continue
    const file = path.join(CACHE_DIR, name)
    let st; try { st = fs.statSync(file) } catch { continue }
    if (st.size < HEADER + EOF * 2) continue
    seen.add(name)
    const prev = files[name]
    if (Array.isArray(prev) && prev[0] === st.size && prev[1] === st.mtimeMs) { if (prev[2]) out.push({ file, name, size: prev[0], mtime: prev[1], kind: prev[2], id: prev[3] || null, id2: prev[4] || null }); continue }
    opened++
    const key = readKey(file)
    const c = key ? classify(key) : null
    files[name] = c ? [st.size, st.mtimeMs, c.kind, c.id || '', c.id2 || ''] : [st.size, st.mtimeMs]
    if (c) out.push({ file, name, size: st.size, mtime: st.mtimeMs, kind: c.kind, id: c.id, id2: c.id2 })
  }
  for (const name of Object.keys(files)) if (!seen.has(name)) delete files[name]          // cachen kastet fila
  state.files = files
  state.scanned = Date.now()
  log(`Desktop-cache: ${Object.keys(files).length} filer, ${opened} nye/endrede lest, ${out.length} svar fra claude.ai/api`)
  return out
}

// ── samtale-JSON → samme form som eksport-leseren (import.js parseClaude) ──
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const ms = (v) => (v == null ? null : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || null)
const textOfBlocks = (blocks) => blocks.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n')
// Den grenen brukeren ser: fra current_leaf_message_uuid opp parent_message_uuid-kjeden (samme logikk som eksportørene).
function visibleChain(j) {
  const msgs = Array.isArray(j.chat_messages) ? j.chat_messages : []
  const byUuid = new Map(msgs.map((m) => [m.uuid, m]))
  const leaf = j.current_leaf_message_uuid
  if (leaf && byUuid.has(leaf)) {
    const chain = []
    const guard = new Set()
    for (let m = byUuid.get(leaf); m && !guard.has(m.uuid); m = m.parent_message_uuid ? byUuid.get(m.parent_message_uuid) : null) { guard.add(m.uuid); chain.unshift(m) }
    return { chain, branches: msgs.length - chain.length }
  }
  return { chain: msgs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || (ms(a.created_at) || 0) - (ms(b.created_at) || 0)), branches: 0 }
}
// Ett samtale-objekt (chat_conversations/<uuid> eller chat_snapshots/<id>) → { id, title, created, updated, projectUuid,
// transcript, firstUser, messages, artifacts, attachments, files, tools, thinking, branches }
export function convFromJson(j, { id = null } = {}) {
  const { chain, branches } = visibleChain(j)
  const artifacts = [], attachments = [], files = []
  const tools = {}
  let thinking = 0, created = [], firstUser = ''
  const lines = chain.map((m) => {
    const who = m.sender === 'human' ? 'Bruker' : 'Claude'
    const parts = []
    const blocks = Array.isArray(m.content) && m.content.length ? m.content : [{ type: 'text', text: m.text || '' }]
    for (const b of blocks) {
      if (!b) continue
      if (b.type === 'text' && b.text) parts.push(b.text)
      else if (b.type === 'thinking') thinking++
      else if (b.type === 'tool_use') {
        const name = String(b.name || 'verktøy')
        tools[name] = (tools[name] || 0) + 1
        const inp = b.input || {}
        if (name === 'create_file' && typeof inp.file_text === 'string') {
          const p = String(inp.path || inp.file_path || 'fil')
          artifacts.push({ id: p, title: path.basename(p), content: inp.file_text, type: 'file', path: p })
          parts.push(`[fil skrevet: ${p}]`)
        } else if (/artifacts?/i.test(name) && (inp.content || inp.new_str) && ['create', 'rewrite', 'update', undefined].includes(inp.command)) {
          artifacts.push({ id: inp.id || '', title: inp.title || inp.id || 'Artifact', content: String(inp.content || inp.new_str || ''), type: inp.type || '' })
          parts.push(`[artifact: ${inp.title || inp.id || 'Artifact'}]`)
        } else if (name === 'web_search') parts.push(`[søk: ${flat(inp.query || '').slice(0, 80)}]`)
        else if (name === 'bash_tool' || name === 'view' || name === 'str_replace') parts.push(`[${name}${inp.path ? `: ${inp.path}` : ''}]`)
        else parts.push(`[verktøy: ${name}]`)
      }
      // tool_result: verktøyresultater (det meste av volumet) tas ikke med i L — som Code-importen
    }
    for (const a of m.attachments || []) {
      if (a?.extracted_content) attachments.push({ name: a.file_name || 'vedlegg', content: String(a.extracted_content) })
      parts.push(`[vedlegg: ${a?.file_name || 'fil'}]`)
    }
    for (const f of m.files || []) { files.push(f?.file_name || 'fil'); parts.push(`[fil: ${f?.file_name || 'fil'}]`) }
    if (m.sender === 'human' && !firstUser) firstUser = textOfBlocks(blocks) || String(m.text || '')
    if (m.created_at) created.push(ms(m.created_at))
    return `**${who}:** ${parts.join('\n').trim()}`
  })
  return {
    id: id || j.uuid, title: flat(j.name || j.title) || 'Uten tittel', created: ms(j.created_at) || Math.min(...created.filter(Boolean), Infinity) || null,
    updated: ms(j.updated_at) || ms(j.created_at) || null, projectUuid: j.project_uuid || j.project?.uuid || null, projectName: j.project?.name || null,
    summary: flat(j.summary || ''), model: j.model || '', firstUser, transcript: lines.join('\n\n'), messages: chain.length,
    artifacts, attachments, files, tools, thinking, branches,
  }
}

// Tittel fra første melding når lageret ikke har noe navn: første setning eller ordgrense, maks 72 tegn.
export function shortTitle(s) {
  const t = flat(s).replace(/^[#*>\-\s]+/, '')
  if (!t) return 'Uten tittel'
  const sentence = t.match(/^(.{12,72}?[.!?])(\s|$)/)
  if (sentence) return sentence[1]
  if (t.length <= 72) return t
  const cut = t.slice(0, 72)
  return (cut.lastIndexOf(' ') > 40 ? cut.slice(0, cut.lastIndexOf(' ')) : cut) + '…'
}

// Mappene brukeren ga Cowork/chat tilgang til, fra Desktops egen config (bare lesing): Cowork-økt «session_<id>» → mapper,
// og chat-samtale <uuid> → mapper. Samtalelageret har ingen prosjektnavn; mappa er det nærmeste vi kommer (som Cowork-importen).
export function desktopFolderGrants() {
  const bySession = new Map(), byConversation = new Map()
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CLAUDE_APP_DIR, 'claude_desktop_config.json'), 'utf8'))
    const p = cfg?.preferences || {}
    for (const [k, v] of Object.entries(p.remoteSessionFolderGrants || {})) if (Array.isArray(v)) bySession.set(k.replace(/^session_/, ''), v.map(String))
    for (const [k, v] of Object.entries(p.remoteChatFolderGrants || {})) if (Array.isArray(v?.folders)) byConversation.set(k, v.folders.map(String))
  } catch {}
  return { bySession, byConversation }
}

// ── samtalelageret (IndexedDB) → samme samtale-JSON som cachen gir ──────────
// Leses fra en kopi av LevelDB-mappa (appen skriver i den); blob-filene (store verdier) er uforanderlige og leses der de
// ligger. Ingenting skrives til appens mappe. Gir [{ id, updated, n, json, store: { product, cowork, windowed } }].
export function collectDesktopStore({ log = () => {} } = {}) {
  const out = []
  if (!idbAvailable()) return { entries: out, stats: { lagerSamtaler: 0, lagerHoppet: 0 } }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-idb-'))
  const stats = { lagerSamtaler: 0, lagerHoppet: 0 }
  try {
    for (const f of fs.readdirSync(IDB_DIR)) if (/^[0-9a-f]{6}\.(ldb|log|sst)$/i.test(f)) { try { fs.copyFileSync(path.join(IDB_DIR, f), path.join(tmp, f)) } catch {} }
    const db = new ChromeIndexedDb(tmp, IDB_BLOB_DIR)
    const skipped = {}
    for (const { value: v } of db.records('claude-conversation-store', 'trees', skipped)) {
      const tree = v && typeof v === 'object' ? v.tree : null
      if (!tree || !Array.isArray(tree.messages) || !v.conversationUuid) continue
      const win = tree.historyWindow && tree.historyWindow.mode === 'windowed' ? { from: tree.historyWindow.floorIndex ?? null, of: tree.treeSize ?? null } : null
      const json = { uuid: v.conversationUuid, chat_messages: tree.messages, updated_at: v.conversationUpdatedAt || v.fetchedAt || null }
      out.push({ id: v.conversationUuid, updated: ms(json.updated_at) || 0, n: tree.messages.length, json, name: 'samtalelager', file: null, snapshot: false,
        store: { product: v.product || '', cowork: tree.proxiedCoworkSessionId || null, windowed: win } })
    }
    stats.lagerSamtaler = out.length
    stats.lagerHoppet = skipped.skipped || 0
    log(`Desktop-lager: ${db.files} LevelDB-filer, ${db.errors} feil, ${out.length} samtaler, ${stats.lagerHoppet} poster hoppet over`)
  } catch (e) {
    log(`Desktop-lager: ${e.message}`)
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} }
  return { entries: out, stats }
}

// ── hele cachen → samtaler, prosjekter, dokumenter, artifacts ──────────────
// Samme samtale ligger ofte flere ganger (én per gang den ble åpnet); den med nyest updated_at vinner, så flest meldinger.
export function collectDesktop({ log = () => {}, since = null } = {}) {
  const state = readState()
  const entries = scanCache({ state, log })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-desktop-'))
  const projects = new Map()                   // uuid → navn
  const listed = new Map()                     // samtale-uuid → { project_uuid, updated_at, is_archived, name }
  const bestFile = new Map()                   // samtale-uuid → { file, updated, n }
  const docs = new Map(), artifacts = new Map(), snapshots = new Map()
  const convFiles = state.convs || {}          // filnavn → { id, updated, n }  (dekodet før; slipper å dekode igjen for å velge beste)
  const stats = { filer: entries.length, dekodet: 0, ufullstendige: 0, samtaler: 0, snapshots: 0, lister: 0, prosjekter: 0, dokumenter: 0, artifacts: 0, artifactVersjoner: 0 }
  const decode = (e) => { stats.dekodet++; const r = readEntry(e.file, tmp); if (!r) stats.ufullstendige++; return r }
  try {
    // 1) lister, prosjekter, dokumenter, artifacts — små svar, dekodes alltid
    for (const e of entries) {
      if (e.kind === 'conv' || e.kind === 'snapshot') continue
      const r = decode(e); if (!r?.json) continue
      const j = r.json
      if (e.kind === 'list' || e.kind === 'plist') {
        stats.lister++
        for (const c of Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []) {
          if (!c?.uuid) continue
          const pid = c.project_uuid || c.project?.uuid || (e.kind === 'plist' ? e.id : null)
          const prev = listed.get(c.uuid)
          if (!prev || (ms(c.updated_at) || 0) >= (prev.updated || 0)) listed.set(c.uuid, { projectUuid: pid || prev?.projectUuid || null, updated: ms(c.updated_at) || 0, archived: !!c.is_archived, name: c.name || '' })
          if (c.project?.uuid && c.project?.name) projects.set(c.project.uuid, c.project.name)
        }
      } else if (e.kind === 'projects') {
        for (const p of Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : []) if (p?.uuid && p?.name) projects.set(p.uuid, p.name)
      } else if (e.kind === 'project') {
        if (j?.uuid && j?.name) projects.set(j.uuid, j.name)
      } else if (e.kind === 'docs' || e.kind === 'doc') {
        // lista (projects/<uuid>/docs) har ofte tomt `content`; enkeltdokumentet (docs/<doc-uuid>) har teksten. Teksten vinner.
        for (const d of Array.isArray(j) ? j : [j]) {
          if (!d?.uuid || typeof d.content !== 'string') continue
          const prev = docs.get(d.uuid)
          if (prev && prev.content.length >= d.content.length) continue
          docs.set(d.uuid, { id: d.uuid, title: d.file_name || d.filename || 'Dokument', content: d.content, projectUuid: d.project_uuid || e.id, created: ms(d.created_at) })
        }
      } else if (e.kind === 'art') {
        const list = Array.isArray(j.artifact_versions) ? j.artifact_versions : Array.isArray(j) ? j : []
        if (list.length) { artifacts.set(e.id, list); stats.artifactVersjoner += list.length }
      }
    }
    for (const [k, d] of docs) if (!d.content.trim()) docs.delete(k)           // bare navnet, ingen tekst — ikke noe å finne igjen
    stats.prosjekter = projects.size
    stats.dokumenter = docs.size
    stats.artifacts = artifacts.size
    // 2) samtaler: hvilken fil er beste versjon per uuid? Nye/endrede filer må dekodes én gang for å vite updated_at + antall.
    for (const e of entries) {
      if (e.kind !== 'conv' && e.kind !== 'snapshot') continue
      let info = convFiles[e.name]
      if (!info || info.size !== e.size || info.mtime !== e.mtime) {
        const r = decode(e)
        if (!r?.json || !(Array.isArray(r.json.chat_messages))) { if (r && r.json === null && r.status !== 200) convFiles[e.name] = { size: e.size, mtime: e.mtime, id: null }; continue }
        const j = r.json
        info = { size: e.size, mtime: e.mtime, id: e.kind === 'snapshot' ? `share:${e.id}` : (j.uuid || e.id), updated: ms(j.updated_at) || ms(j.created_at) || 0, n: j.chat_messages.length, snapshot: e.kind === 'snapshot' }
        convFiles[e.name] = info
        info.json = j                                                // allerede dekodet — gjenbrukes under hvis den vinner
      }
      if (!info.id) continue
      const cur = bestFile.get(info.id)
      if (!cur || info.updated > cur.updated || (info.updated === cur.updated && info.n > cur.n)) bestFile.set(info.id, { ...info, file: e.file, name: e.name })
    }
    for (const name of Object.keys(convFiles)) if (!entries.some((e) => e.name === name)) delete convFiles[name]
    // 2b) samtalelageret (IndexedDB): nyeste versjon per uuid vinner også her — lageret har som regel den ferskeste
    const storeRes = collectDesktopStore({ log })
    Object.assign(stats, storeRes.stats)
    for (const s of storeRes.entries) {
      const cur = bestFile.get(s.id)
      if (!cur || s.updated > cur.updated || (s.updated === cur.updated && s.n > cur.n)) bestFile.set(s.id, s)
    }
    // 3) dekod vinnerne (bare de som er nye/endret siden sist, når `since` er gitt)
    const convs = []
    for (const [id, b] of bestFile) {
      if (since && since[id] === b.updated) continue
      const j = b.json || decode({ file: b.file })?.json
      if (!j) continue
      const c = convFromJson(j, { id })
      const l = listed.get(c.id)
      if (b.store) {
        c.store = b.store
        if (!c.title || c.title === 'Uten tittel') c.title = shortTitle(l?.name || c.firstUser)
        if (b.store.windowed) c.transcript = `_[Utsnitt fra Claude Desktops samtalelager: de siste ${c.messages} av ${b.store.windowed.of ?? '?'} meldinger (fra nr. ${b.store.windowed.from ?? '?'}). Åpne samtalen i Desktop og bla opp for mer.]_\n\n${c.transcript}`
      }
      c.projectUuid = c.projectUuid || l?.projectUuid || null
      c.projectName = c.projectName || (c.projectUuid ? projects.get(c.projectUuid) : null) || null
      c.archived = !!l?.archived
      c.cacheFile = b.name
      c.snapshot = !!b.snapshot
      convs.push(c)
      if (b.snapshot) snapshots.set(id, c)
    }
    for (const k of Object.keys(convFiles)) delete convFiles[k].json
    for (const b of bestFile.values()) if (b.store) delete b.json
    stats.samtaler = [...bestFile.values()].filter((b) => !b.snapshot).length
    stats.snapshots = [...bestFile.values()].filter((b) => b.snapshot).length
    state.convs = convFiles
    writeState(state)
    return { convs, projects, docs: [...docs.values()], artifacts, snapshots, listed, stats, best: bestFile }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} }
}

// Hvor mange Desktop-samtaler ligger i cachen (onboarding + SessionStart). Bare nøkler, ingen dekoding (~1 s når
// tilstanden finnes, ~10 s første gang). `quick`: les bare forrige skanning (SessionStart-hooken har 10 s på seg).
export function countDesktopConversations({ quick = false } = {}) {
  if (!cacheAvailable()) return 0
  const state = readState()
  if (quick) return new Set(Object.values(state.files || {}).filter((v) => Array.isArray(v) && v[2] === 'conv').map((v) => v[3])).size
  const entries = scanCache({ state })
  writeState(state)
  const ids = new Set(entries.filter((e) => e.kind === 'conv').map((e) => e.id))
  for (const s of collectDesktopStore().entries) ids.add(s.id)                      // samtalelageret (IndexedDB), ~20 ms
  return ids.size
}
// Hvilke samtaler (uuid → updated_at) er importert fra cachen før — for idempotens
export const importedDesktop = () => readState().imported || {}
// Stillhetsvakt (20.10.2026): leseren var blind fra 15.09 til 20.10 uten at noen merket det. Desktop er i bruk når
// IndexedDB-mappa eller cachen er endret siste to døgn; er likevel ingen importert samtale nyere enn 14 dager, er noe galt
// (Desktop har trolig flyttet samtalene igjen). Brukes av SessionStart-hooken, vakten og importrapporten. Bare lesing.
const DAY = 24 * 60 * 60 * 1000
export function desktopStaleness({ maxDays = 14 } = {}) {
  let newest = 0
  for (const [k, v] of Object.entries(importedDesktop())) if (!k.startsWith('share:') && Number(v) > newest) newest = Number(v)
  const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }
  const active = Math.max(mtime(IDB_DIR), mtime(CACHE_DIR)) > Date.now() - 2 * DAY
  const days = newest ? Math.floor((Date.now() - newest) / DAY) : null
  return { newest, days, active, stale: active && newest > 0 && days >= maxDays }
}
export function noteImportedDesktop(map) { const s = readState(); s.imported = { ...(s.imported || {}), ...map }; writeState(s) }
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
