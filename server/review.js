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
//
//   node review.js --samtaler --dry-run   friksjon 9 (24.10.2026): viser hvilke samtale-saker som får ny ingress etter regelen «siste vending»
//                                         («Sist: <siste prompt> → <første setning av svaret> · N vendinger · periode»), skriver ingenting
//   node review.js --samtaler             skriver S på nytt (by: regel) for de samtalene. Menneskeskrevet S røres aldri (V10); S skrevet av
//                                         Claude røres bare når den er utdatert (fra en eldre versjon). Lest ut av transkriptet (L) — trenger
//                                         ikke øktfila eller Desktop-cachen, så det virker også for samtaler kildene er borte for.
//
//   node review.js --fanget --dry-run     runde 2c (arb. 32 §5 sp. 1, 24.10.2026): viser hvor mange eksisterende saker som ville fått `fanget: true` etter regelen
//                                         (store.erFangetEtterRegel): nøkkelen er svar:<økt>:…, prompt:<økt>:… (ikke prompt:spor:), okt:<økt> eller samtale:<id>
//                                         — det hook og import fanget — OG ingen har arbeidet med saken (ikke menneskeskrevet S/M, ikke gjort synlig i annet prosjekt,
//                                         ikke satt status, ikke vært med i en sending). Skriver ingenting.
//   node review.js --fanget               setter flagget på dem. Angres per sak med Behold i appen (POST /api/fanget/behold). Kjør dry-run først.

import fs from 'node:fs'
import path from 'node:path'
import { load, save, needsLevel, isStale, mkLevel, FILES_ROOT, filesMode, LONG_L, S_MAX, M_MAX, erFangetEtterRegel, FANGET_NØKLER, deliveryCounts } from './store.js'
import { samtaleSFraTranskript } from './import.js'

const args = process.argv.slice(2)
const atoms = load()

if (args.includes('--fanget')) {
  const dryRun = args.includes('--dry-run')
  const sendinger = deliveryCounts()
  const slagAv = (a) => { const k = String(a.key || ''); return k.startsWith('okt:') ? 'økt' : k.startsWith('samtale:') ? 'samtale' : k.startsWith('prompt:') ? 'prompt' : k.startsWith('svar:') ? 'svar' : a.kind || 'capture' }
  const tell = (m, k) => { m[k] = (m[k] || 0) + 1 }
  const tall = { saker: atoms.length, altFanget: 0, kandidater: 0, nye: 0, holdt: { menneske: 0, synlig: 0, status: 0, utlevert: 0 } }
  const perSlag = {}, perKilde = {}, perProsjekt = {}
  const vis = []
  for (const a of atoms) {
    if (a.fanget) { tall.altFanget++; continue }
    if (!a.key || !FANGET_NØKLER.test(a.key)) continue
    tall.kandidater++
    const utlevert = sendinger.get(a.id) || 0
    if (!erFangetEtterRegel(a, { utlevert })) {
      if (a.levels?.S?.by === 'menneske' || a.levels?.M?.by === 'menneske') tall.holdt.menneske++
      else if ((a.refs || []).length) tall.holdt.synlig++
      else if (a.status) tall.holdt.status++
      else if (utlevert) tall.holdt.utlevert++
      continue
    }
    tall.nye++; tell(perSlag, slagAv(a)); tell(perKilde, a.source || '—'); tell(perProsjekt, a.project)
    if (vis.length < 12) vis.push(`  ${a.project} / ${a.name}  (${slagAv(a)} · ${a.source || '—'} · ${a.key})`)
    if (!dryRun) a.fanget = true
  }
  const linje = (m) => Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`).join(', ') || '—'
  console.log(`${tall.saker} saker · ${tall.altFanget} alt merket fanget · ${tall.kandidater} med fangst-nøkkel · ${tall.nye} ${dryRun ? 'ville fått' : 'får'} fanget: true${dryRun ? ' · DRY-RUN, ingenting skrevet' : ''}`)
  console.log(`Holdt utenfor fordi noen har arbeidet med saken: ${tall.holdt.menneske} menneskeskrevet S/M · ${tall.holdt.synlig} synlig i annet prosjekt · ${tall.holdt.status} status satt · ${tall.holdt.utlevert} vært med i en sending`)
  console.log(`Per slag: ${linje(perSlag)}\nPer kilde: ${linje(perKilde)}\nPer prosjekt: ${linje(perProsjekt)}\n`)
  for (const v of vis) console.log(v)
  if (tall.nye > vis.length) console.log(`  … og ${tall.nye - vis.length} til`)
  if (!dryRun && tall.nye) { const written = save(atoms); console.log(`\n${tall.nye} saker merket fanget · ${written} filer skrevet. Angre per sak: Behold i appen (POST /api/fanget/behold {id}).`) }
  else if (!dryRun) console.log('\nIngenting å skrive.')
  process.exit(0)
}

if (args.includes('--samtaler')) {
  const dryRun = args.includes('--dry-run')
  const tall = { samtaler: 0, endres: 0, uendret: 0, menneske: 0, annen: 0, uleselig: 0 }
  const vis = []
  for (const a of atoms) {
    if (a.kind !== 'samtale') continue
    tall.samtaler++
    const S = samtaleSFraTranskript(a.content, { first: a.createdAt, last: a.capturedAt })
    if (!S) { tall.uleselig++; continue }
    const old = a.levels?.S
    if (old?.by === 'menneske') { tall.menneske++; continue }                       // V10: menneskeskrevet overskrives aldri
    if (old && old.by !== 'regel' && !isStale(a, 'S')) { tall.annen++; continue }   // Claude-skrevet og gjeldende: la stå
    if (old?.text === S) { tall.uendret++; continue }
    tall.endres++
    if (vis.length < 12) vis.push(`${a.project} / ${a.name}\n    før: ${old?.text || '(mangler)'}\n    nå:  ${S}`)
    if (!dryRun) { a.levels = { ...(a.levels || {}), S: mkLevel(S, 'regel', a.version || 1) } }
  }
  console.log(`${tall.samtaler} samtale-saker · ${tall.endres} får ny S (siste vending) · ${tall.uendret} har den alt · ${tall.menneske} menneskeskrevet (røres ikke) · ${tall.annen} skrevet av Claude og gjeldende (røres ikke) · ${tall.uleselig} uten lesbart transkript${dryRun ? ' · DRY-RUN, ingenting skrevet' : ''}\n`)
  for (const v of vis) console.log(v)
  if (tall.endres > vis.length) console.log(`… og ${tall.endres - vis.length} til`)
  if (!dryRun && tall.endres) { const written = save(atoms); console.log(`\n${tall.endres} ingresser skrevet (by: regel) · ${written} filer skrevet`) }
  else if (!dryRun) console.log('\nIngenting å skrive.')
  process.exit(0)
}
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
