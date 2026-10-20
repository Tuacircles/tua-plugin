// test-idb.mjs — tørrkjøring av IndexedDB-leseren mot Claude Desktops samtalelager. Bare lesing.
//   node server/test-idb.mjs [leveldb-mappe] [blob-mappe] [søkeord]
// Uten argumenter: appens egen mappe (platform.js). Skriver ut databaser, objektlagre og samtalene i
// «claude-conversation-store» (uuid, oppdatert, antall meldinger, utdrag/fullt tre, Cowork-id), nyeste først.
import path from 'node:path'
import { ChromeIndexedDb } from './idb.js'
import { CLAUDE_APP_DIR } from './platform.js'

const dir = process.argv[2] || path.join(CLAUDE_APP_DIR, 'IndexedDB', 'https_claude.ai_0.indexeddb.leveldb')
const blobDir = process.argv[3] || dir.replace(/\.leveldb$/, '.blob')
const needle = (process.argv[4] || '').toLowerCase()
const t0 = Date.now()
const db = new ChromeIndexedDb(dir, blobDir)
console.log(`${dir}\n${db.files} filer lest, ${db.errors} feil, ${db.all.length} levende nøkler, ${Date.now() - t0} ms`)
for (const d of db.databases) console.log(`  db ${d.id} «${d.name}»: ${[...db.stores(d.id).keys()].join(', ')}`)

const stats = {}
const rows = []
const fmt = (ms) => (ms ? new Date(ms).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?')
for (const { key, value: v } of db.records('claude-conversation-store', 'trees', stats)) {
  if (!v || typeof v !== 'object') continue
  const tree = v.tree || {}
  const msgs = Array.isArray(tree.messages) ? tree.messages : []
  const text = msgs.flatMap((m) => (m.content || []).filter((b) => b && b.type === 'text').map((b) => b.text || '')).join('\n')
  rows.push({
    key, updated: v.conversationUpdatedAt || 0, n: msgs.length, treeSize: tree.treeSize, mode: tree.historyWindow?.mode, floor: tree.historyWindow?.floorIndex,
    cowork: tree.proxiedCoworkSessionId || '', bytes: v.approxBytes, chars: text.length, hit: needle && text.toLowerCase().includes(needle),
  })
}
rows.sort((a, b) => b.updated - a.updated)
console.log(`\n${rows.length} samtaler i «trees» (${stats.skipped || 0} poster hoppet over):`)
console.log('oppdatert         n  tre      tegn   utdrag?            cowork                       uuid')
for (const r of rows) console.log(`${fmt(r.updated).padEnd(16)} ${String(r.n).padStart(3)} ${String(r.treeSize).padStart(5)} ${String(r.chars).padStart(8)}   ${(r.mode === 'windowed' ? `fra ${r.floor}` : 'fullt').padEnd(16)} ${r.cowork.padEnd(28)} ${r.key}${r.hit ? '  ← TREFF' : ''}`)
const cutoff = Date.parse('2026-09-15')
console.log(`\nSamtaler oppdatert etter 15.09.2026: ${rows.filter((r) => r.updated > cutoff).length}`)
