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
//
//   node review.js --drift --dry-run      runde 2d (03-avisen §2 A og §7 B, 24.10.2026): viser hvor mange eksisterende saker som ville fått `drift: true` etter regelen
//                                         (store.erDriftEtterRegel): nøkkelen er sync (commit-logg, manifest, status, lenker, beslutningslogg), import:…, helsesjekk:…,
//                                         eller en byggeøkt-sak (okt:, samtale:, svar:, prompt: — ikke prompt:spor:) i Tuas eget prosjekt (registrert repo er Tua-repoet, eller «Tua»).
//                                         Menneskeskrevet (S/M av menneske, eller kilde som ikke er en maskin) merkes aldri; drift: false (Behold) røres aldri. Skriver ingenting.
//   node review.js --drift                setter flagget. Begge viser tall per klasse (arbeid · spor · drift · tråd) før og etter, og per prosjekt. Angres per sak med POST /api/behold {id}.
//   Rekkefølge for Erik: --drift --dry-run → --drift → --fanget --dry-run → --fanget (drift først, så det som er byggeøkter ikke havner i Fanget-bøtta).
//   Runde 3c (24.10.2026): regelen strammet — `dok:`-saker i Tuas egne prosjekter (byggeøktenes overleveringsnotater og arbeidsstykker om Tua) og «Økt: …»-saker uten
//   hook-nøkkel regnes som drift der (slag «dokument» og «økt-tittel» i tallene); «Økt: …» uten nøkkel i andre prosjekter er fangst. Samme regel bak knappen
//   «Merk arkivet» i Innstillinger › Arkivsted (POST /api/arkiv/merk) — det er Erik som trykker. Skrivingen går gjennom saveAll (én skriver: bare det som er
//   endret skrives, og en fil en annen prosess har endret siden lesing flettes treveis, aldri overskrives).
//
//   node review.js --rydd                 runde 3c: Tuas ryddeforslag (store.ryddeforslag) — duplikater (identisk innhold · samme ingress · samme tittel i samme prosjekt),
//                                         «---»-titler og tomme saker. Viser bare; utføres i appen (Slå sammen / Kast per forslag) eller med --rydd --kast-tomme.

import fs from 'node:fs'
import path from 'node:path'
import { load, save, saveAll, needsLevel, isStale, mkLevel, FILES_ROOT, filesMode, LONG_L, S_MAX, M_MAX, fangetKandidater, slagAvNøkkel, driftKandidater, erDriftEtterRegel, driftProsjekter, driftSlag, tellKlasser, klasseAv, KLASSER } from './store.js'
import { samtaleSFraTranskript } from './import.js'

const args = process.argv.slice(2)
const atoms = load()

const linjeAv = (m) => Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`).join(', ') || '—'
const klasseLinje = (liste) => { const t = tellKlasser(liste); return KLASSER.map((k) => `${k} ${t[k]}`).join(' · ') }
const perProsjektKlasse = (liste) => { const m = {}; for (const a of liste) { const p = m[a.project] || (m[a.project] = { arbeid: 0, spor: 0, drift: 0, tråd: 0 }); p[klasseAv(a)]++ } return Object.entries(m).sort((x, y) => (y[1].arbeid + y[1].spor + y[1].drift + y[1].tråd) - (x[1].arbeid + x[1].spor + x[1].drift + x[1].tråd)) }

if (args.includes('--drift')) {
  const dryRun = args.includes('--dry-run')
  const prosjekter = driftProsjekter()
  const før = klasseLinje(atoms)
  const { tall, perSlag, perProsjekt, nye } = driftKandidater(atoms, { prosjekter })       // friksjon 15: samme regel som POST /api/arkiv/merk (Innstillinger › Arkivsted)
  const vis = nye.slice(0, 12).map((a) => `  ${a.project} / ${a.name}  (${driftSlag(a)} · ${a.source || '—'} · ${a.key})`)
  if (!dryRun) for (const a of nye) a.drift = true
  console.log(`${tall.saker} saker · ${tall.altDrift} alt merket drift · ${tall.kandidater} med drift-nøkkel · ${tall.nye} ${dryRun ? 'ville fått' : 'får'} drift: true${dryRun ? ' · DRY-RUN, ingenting skrevet' : ''}`)
  console.log(`Holdt utenfor: ${tall.holdt.menneske} menneskeskrevet · ${tall.holdt.behold} brukeren sa «dette er arbeid» (drift: false)`)
  console.log(`Tuas egne prosjekter (byggeøkter er drift): ${[...prosjekter].join(', ')}`)
  console.log(`Per slag: ${linjeAv(perSlag)}\nPer prosjekt: ${linjeAv(perProsjekt)}`)
  const etter = dryRun ? klasseLinje(atoms.map((a) => (a.drift !== true && erDriftEtterRegel(a, { prosjekter }) ? { ...a, drift: true } : a))) : klasseLinje(atoms)
  console.log(`Klasser før: ${før}\nKlasser etter: ${etter}\n`)
  for (const v of vis) console.log(v)
  if (tall.nye > vis.length) console.log(`  … og ${tall.nye - vis.length} til`)
  if (!dryRun && tall.nye) { const written = saveAll(atoms); console.log(`\n${tall.nye} saker merket drift · ${written} filer skrevet. Angre per sak: POST /api/behold {id} (saken blir arbeid, og regelen rører den aldri igjen).`) }
  else if (!dryRun) console.log('\nIngenting å skrive.')
  process.exit(0)
}

if (args.includes('--fanget')) {
  const dryRun = args.includes('--dry-run')
  const før = klasseLinje(atoms)
  const { tall, perSlag, perKilde, perProsjekt, nye } = fangetKandidater(atoms)       // samme regel som POST /api/fanget/merk (Innstillinger › Arkiv)
  const vis = nye.slice(0, 12).map((a) => `  ${a.project} / ${a.name}  (${slagAvNøkkel(a)} · ${a.source || '—'} · ${a.key})`)
  if (!dryRun) for (const a of nye) a.fanget = true
  const linje = (m) => Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`).join(', ') || '—'
  console.log(`${tall.saker} saker · ${tall.altFanget} alt merket fanget · ${tall.kandidater} med fangst-nøkkel · ${tall.nye} ${dryRun ? 'ville fått' : 'får'} fanget: true${dryRun ? ' · DRY-RUN, ingenting skrevet' : ''}`)
  console.log(`Holdt utenfor fordi noen har arbeidet med saken: ${tall.holdt.menneske} menneskeskrevet S/M · ${tall.holdt.synlig} synlig i annet prosjekt · ${tall.holdt.status} status satt · ${tall.holdt.utlevert} vært med i en sending`)
  console.log(`Per slag: ${linje(perSlag)}\nPer kilde: ${linje(perKilde)}\nPer prosjekt: ${linje(perProsjekt)}\n`)
  const etter = dryRun ? klasseLinje(atoms.map((a) => (nye.includes(a) ? { ...a, fanget: true } : a))) : klasseLinje(atoms)
  console.log(`Klasser før: ${før}\nKlasser etter: ${etter}`)   // runde 2d: tall per klasse (arbeid · spor · drift · tråd)
  console.log(`Per prosjekt etter: ${perProsjektKlasse(atoms).slice(0, 12).map(([p, t]) => `${p} (arbeid ${t.arbeid}, spor ${t.spor}, drift ${t.drift}, tråd ${t.tråd})`).join(' · ')}\n`)
  for (const v of vis) console.log(v)
  if (tall.nye > vis.length) console.log(`  … og ${tall.nye - vis.length} til`)
  if (!dryRun && tall.nye) { const written = saveAll(atoms); console.log(`\n${tall.nye} saker merket fanget · ${written} filer skrevet. Angre per sak: Behold i appen (POST /api/fanget/behold {id}).`) }
  else if (!dryRun) console.log('\nIngenting å skrive.')
  process.exit(0)
}

if (args.includes('--rydd')) {
  const { ryddeforslag, kast } = await import('./store.js')
  const r = ryddeforslag(atoms)
  console.log(`${atoms.length} saker · ${r.antall} ryddeforslag${r.tekst ? ` — ${r.tekst}` : ''}`)
  console.log(`Per slag: ${linjeAv(r.perSlag)}\nPer prosjekt: ${linjeAv(r.perProsjekt)}\n`)
  for (const f of r.forslag.slice(0, 30)) console.log(`  [${f.slag}] ${f.project}: ${f.saker.map((x) => `«${x.name}» v${x.version} (${x.tegn} tegn)`).join(' · ')} — ${f.grunn}${f.behold ? ` · behold ${f.behold}` : ''}`)
  if (r.antall > 30) console.log(`  … og ${r.antall - 30} til`)
  if (args.includes('--kast-tomme')) { const tomme = r.forslag.filter((f) => f.slag === 'tom'); for (const f of tomme) for (const id of f.kast) kast(atoms, id, { grunn: 'tom sak (review --rydd --kast-tomme)' }); console.log(`\n${tomme.length} tomme saker lagt i papirkurven (angre: POST /api/fanget/angre {id})`) }
  else console.log('\nIngenting skrevet — forslagene utføres i appen (Siden sist › Tua foreslår), eller --rydd --kast-tomme legger de tomme i papirkurven.')
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
  if (!dryRun && tall.endres) { const written = saveAll(atoms); console.log(`\n${tall.endres} ingresser skrevet (by: regel) · ${written} filer skrevet`) }
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
