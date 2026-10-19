#!/usr/bin/env node
// review.js — «Ny gjennomgang» for nivåene (AI3 i vedlikeholdsform):
// finner atomer som mangler eller har utdatert S (ingress) / M (sammendrag),
// og skriver inn nivåer som Claude har laget. Kjører uten LLM selv — Claude
// (i Code/Desktop) leser lista, skriver S/M, og dette skriptet fester dem.
//
//   node review.js                 liste: hva mangler, per atom (id · fil · tegn)
//   node review.js --json          samme som JSON (id, name, project, file, size, needs)
//   node review.js --apply fil.json
//        fil.json = [{ "id": "...", "short": "...", "medium": "..." }, …]
//        by: 'Claude' (standard) — overskriver aldri et menneskeskrevet nivå (V10)
//   TUA_REVIEW_BY=menneske node review.js --apply …   merk som menneskeskrevet

import fs from 'node:fs'
import path from 'node:path'
import { load, save, needsLevel, isStale, mkLevel, FILES_ROOT, filesMode, LONG_L, S_MAX, M_MAX } from './store.js'

const args = process.argv.slice(2)
const atoms = load()
const index = (() => { try { return filesMode() ? JSON.parse(fs.readFileSync(path.join(FILES_ROOT, '.tua', 'index.json'), 'utf8')) : {} } catch { return {} } })()
const fileOf = (a) => (filesMode() && index[a.id] ? path.join(FILES_ROOT, index[a.id]) : '')
const needsOf = (a) => ['S', 'M'].filter((L) => needsLevel(a, L)).map((L) => (a.levels?.[L] ? `${L} utdatert (fra v${a.levels[L].of}, nå v${a.version || 1})` : `${L} mangler`))

if (args.includes('--apply')) {
  const file = args[args.indexOf('--apply') + 1]
  const by = process.env.TUA_REVIEW_BY || 'Claude'
  const jobs = JSON.parse(fs.readFileSync(file, 'utf8'))
  let n = 0, skipped = []
  for (const j of jobs) {
    const a = atoms.find((x) => x.id === j.id)
    if (!a) { skipped.push(`${j.id}: finnes ikke`); continue }
    const v = a.version || 1
    a.levels = a.levels || {}
    for (const [L, txt, max] of [['S', j.short, S_MAX], ['M', j.medium, M_MAX]]) {
      const lv = mkLevel(txt, by, v)
      if (!lv) continue
      if (a.levels[L]?.by === 'menneske' && by !== 'menneske') { skipped.push(`${a.name} · ${L} er menneskeskrevet — ikke overskrevet`); continue }
      if (lv.text.length > max) console.error(`  ⚠ ${a.name} · ${L} er ${lv.text.length} tegn (maks ${max})`)
      a.levels[L] = lv
      n++
    }
  }
  const written = save(atoms)
  console.log(`${n} nivåer festet (by: ${by}) · ${written} filer skrevet`)
  for (const s of skipped) console.log(`hoppet over: ${s}`)
  process.exit(0)
}

const todo = atoms
  .map((a) => ({ a, needs: needsOf(a) }))
  .filter((x) => x.needs.length)
  .sort((x, y) => x.a.project.localeCompare(y.a.project) || x.a.name.localeCompare(y.a.name))

if (args.includes('--json')) {
  console.log(JSON.stringify(todo.map(({ a, needs }) => ({
    id: a.id, name: a.name, project: a.project, version: a.version || 1, size: (a.content || '').length,
    file: fileOf(a), needs, wantM: (a.content || '').length > LONG_L,
    summary: a.summary || '', S: a.levels?.S?.text || '', M: a.levels?.M?.text || '',
  })), null, 2))
} else {
  console.log(`${atoms.length} atomer · ${todo.length} trenger ny gjennomgang\n`)
  for (const { a, needs } of todo) console.log(`${a.id}  ${a.project} / ${a.name}\n    ${(a.content || '').length} tegn · ${needs.join(', ')}\n    ${fileOf(a)}`)
}
