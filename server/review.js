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
//   node review.js --samtaler --dry-run   friksjon 9 (24.10.2026) + friksjon 20 (25.10.2026): viser hvilke samtale-saker (og hookens «Økt: …»-saker) som får ny S (siste vending),
//                                         ny M (første spørsmål + siste svar + filene skrevet), tittel uten «Økt: » og kind samtale — lest ut av L, skriver ingenting
//   node review.js --samtaler [--modell]  skriver dem (S by: regel; M by: regel, eller «Ollama · <modell>» med --modell når den kjører). Menneskeskrevet S/M røres aldri (V10).
//                                         Samme funksjon som knappen «Samtalene på nytt» i Innstillinger › Spør (POST /api/samtaler/gjennomgang) — Erik trykker, dry-run først.
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
//   node review.js --traader              skive 1 i arbeidsstykke 33 (V22, 27.10.2026): gamle Tua-tråder (prompt:spor:-saker uten samtale-sak — 16 i Eriks arkiv) får en
//                                         samtale-sak med kilde Tua (nøkkel samtale:tua:<hash av prosjekt+samtalenavn>, transkript, S/M, start = første spørsmål), og prompt,
//                                         svar, Forskjeller og konklusjon får bygget_av → samtalen. DRY-RUN som standard (viser, skriver ingenting); --skriv gjør det.
//   node review.js --gjentatt [--skriv]   skive 3 i arbeidsstykke 33 (28.10.2026, §7): gjentatte kjøringer — samtale-saker med samme kortede tittel, prosjekt og kilde (en Cowork-oppgave som
//                                         kjører daglig) får `gjentatt: true`, alle unntatt den første i gruppa; visningen folder dem til én linje. Dry-run som standard.
//   node review.js --rydd                 runde 3c: Tuas ryddeforslag (store.ryddeforslag) — duplikater (identisk innhold · samme ingress · samme tittel i samme prosjekt),
//                                         «---»-titler og tomme saker. Viser bare; utføres i appen (Slå sammen / Kast per forslag) eller med --rydd --kast-tomme.

import fs from 'node:fs'
import path from 'node:path'
import { load, save, saveAll, needsLevel, isStale, mkLevel, FILES_ROOT, filesMode, LONG_L, S_MAX, M_MAX, fangetKandidater, slagAvNøkkel, driftKandidater, erDriftEtterRegel, driftProsjekter, driftSlag, tellKlasser, klasseAv, KLASSER } from './store.js'

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

if (args.includes('--traader')) {
  // skive 4 (arb. 33): samme funksjon som knappen «Gamle tråder → samtaler» i Innstillinger › Spør (POST /api/samtaler/traader)
  const { traaderGjennomgang } = await import('./gjennomgang.js')
  const skriv = args.includes('--skriv')
  const r = await traaderGjennomgang({ atoms, dryRun: !skriv })
  console.log(`${r.saker} saker · ${r.samtaler} samtale-saker (${r.tua} ført i Tua) · ${r.antall} gamle Tua-tråder uten samtale-sak${skriv ? '' : ' · DRY-RUN, ingenting skrevet (legg til --skriv)'}`)
  for (const v of r.vis.slice(0, 30)) console.log(`  ${v.tekst}`)
  if (r.vis.length > 30) console.log(`  … og ${r.vis.length - 30} til`)
  if (skriv && r.laget) console.log(`\n${r.laget} samtale-saker laget · ${r.filer} filer skrevet`)
  else if (skriv) console.log('\nIngenting å skrive.')
  process.exit(0)
}

if (args.includes('--gjentatt')) {
  // skive 3 (arb. 33 §7, 28.10.2026): eksisterende gjentatte kjøringer (samme kortede tittel, prosjekt og kilde — Cowork-oppgaver som kjører daglig) får `gjentatt: true`,
  // alle unntatt den første i hver gruppe. DRY-RUN som standard; --skriv setter flagget (nøkler og innhold røres ikke — to økter er fortsatt to økter).
  // skive 4: samme funksjon som knappen «Gjentatte kjøringer» i Innstillinger › Spør (POST /api/samtaler/gjentatt)
  const { gjentattGjennomgang } = await import('./gjennomgang.js')
  const skriv = args.includes('--skriv')
  const r = await gjentattGjennomgang({ atoms, dryRun: !skriv })
  console.log(`${r.saker} saker · ${r.samtaler} samtale-saker · ${r.grupper} grupper med samme tittel, prosjekt og kilde · ${r.nye} ${skriv ? 'får' : 'ville fått'} gjentatt: true (${r.alt} alt merket)${skriv ? '' : ' · DRY-RUN, ingenting skrevet (legg til --skriv)'}`)
  for (const v of r.vis.slice(0, 30)) console.log(`  ${v.tekst}`)
  if (r.vis.length > 30) console.log(`  … og ${r.vis.length - 30} til`)
  if (skriv && r.merket) console.log(`\n${r.merket} samtaler merket gjentatt · ${r.filer} filer skrevet`)
  else if (skriv) console.log('\nIngenting å skrive.')
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
  // Friksjon 20 (økt-sakene): samme funksjon som POST /api/samtaler/gjennomgang (Innstillinger › Spør). S = siste vending, M = første spørsmål + siste svar + filene,
  // tittelen uten «Økt: », kind samtale. --modell: M skrives av den lokale modellen (Ollama) når den kjører, ellers regelen. Menneskeskrevet røres aldri.
  const { samtalerGjennomgang } = await import('./gjennomgang.js')
  const dryRun = args.includes('--dry-run')
  const r = await samtalerGjennomgang({ atoms, dryRun, skriver: args.includes('--modell') ? 'auto' : 'regel', klient: 'kommandolinje' })
  console.log(`${r.samtaler} samtale-saker · ${r.saker} får ny S/M (${r.S} S · ${r.M} M · ${r.tittel} titler uten «Økt:» · ${r.kind} blir samtale-saker) · ${r.menneske} menneskeskrevet (røres ikke) · ${r.uendret} uendret · ${r.uleselig} uten lesbart innhold · skriver: ${r.av}${dryRun ? ' · DRY-RUN, ingenting skrevet' : ''}\n`)
  for (const v of r.vis) console.log(`${v.project} / ${v.name}  [${v.endringer.join(', ')}]\n    S før: ${v.S_før || '(mangler)'}\n    S nå:  ${v.S}\n    M nå:  ${v.M}${v.M.length >= 160 ? '…' : ''}`)
  if (r.saker > r.vis.length) console.log(`… og ${r.saker - r.vis.length} til`)
  if (!dryRun && r.saker) { const written = saveAll(atoms); console.log(`\n${r.saker} samtale-saker skrevet på nytt · ${written} filer skrevet`) }
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
