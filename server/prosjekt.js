#!/usr/bin/env node
// prosjekt.js — slå sammen to prosjekter i arkivet (skive A, A7, arbeidsstykke 34, V23 — Erik 28.10.2026: «TUA» slås sammen med «Tua_tua»).
// Alt går gjennom lageret (store.slåSammenProsjekt → flytt → save): filene flyttes, indeks og written.json følger. Aliaset settes så nye fangster med det
// gamle navnet havner i målet (.tua/project-aliases.json, brukt av upsert for alle kilder).
//
//   node server/prosjekt.js --slå-sammen TUA Tua_tua --dry-run    tallene: hvor mange saker, per slag, navnekollisjoner — skriver ingenting
//   node server/prosjekt.js --slå-sammen TUA Tua_tua              flytter sakene og setter aliaset TUA → Tua_tua
import { load, save, slåSammenProsjekt, settProsjektAlias, FILES_ROOT } from './store.js'

const arg = process.argv.slice(2)
const i = arg.findIndex((a) => a === '--slå-sammen' || a === '--sla-sammen')
if (i < 0 || !arg[i + 1] || !arg[i + 2]) { console.error('bruk: node server/prosjekt.js --slå-sammen <fra> <til> [--dry-run]'); process.exit(2) }
const fra = arg[i + 1], til = arg[i + 2], tørr = arg.includes('--dry-run')
const atoms = load()
const r = slåSammenProsjekt(atoms, fra, til, { tørr })
console.log(`Arkiv: ${FILES_ROOT}`)
console.log(`${tørr ? 'Tørrkjøring — ingenting skrives.' : 'Slår sammen.'} «${r.fra}» → «${r.til}»: ${r.saker} saker (${Object.entries(r.perSlag).map(([k, n]) => `${n} ${k}`).join(', ')}); «${r.til}» har ${r.iMåletFør}, får ${r.iMåletEtter}; ${r.kollisjoner} navnekollisjoner (får id-suffiks).`)
if (!tørr) {
  const filer = save(atoms)
  const al = settProsjektAlias(fra, til)
  console.log(`Flyttet ${r.flyttet} saker · ${filer} filer skrevet · alias ${fra} → ${til}${al.endret ? ' satt' : ' fantes'} (${Object.entries(al.aliaser).filter(([k]) => k !== '_').map(([k, v]) => `${k} → ${v}`).join(', ')})`)
}
