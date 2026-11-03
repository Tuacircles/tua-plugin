// skjermvalg.js — det Erik har bestemt om skjermingen i et arbeid (arbeidsstykke 35 skive 3, 03.11.2026).
//
// Reglene i motoren (motor.lagSkjermer) finner det de finner. Her ligger det de ikke kan vite: hva Erik la til, hva han tok bort, hvilke filer han har sett over, og forslagene
// den lokale modellen kom med. Alt ligger i .tua/skjerm-valg.json (mode 600), ved siden av kjente-personer.json. Fila inneholder navn i klartekst og sendes aldri noe sted.
//
//   arbeid[<nøkkel>] = { legg: [{tekst, type}], fjern: [tekst], avvist: [tekst], sett: { <sakId>: {versjon, tid} } }     nøkkelen er arbeidet (hører_til) eller samtalen (reservert id og a_-id)
//   forslag[<sakId>] = { versjon, navn: [], firma: [], modell, tid, dekket: {tegn, av}, feilet }                         forslagene hører til fila, ikke arbeidet: samme fil gir samme forslag
//
// Et arbeid kan ha flere nøkler (en ny samtale har t_-id til første sending, deretter a_-id, og den kan henge på et arbeid): lesing slår dem sammen, skriving bruker den første.

import fs from 'node:fs'
import path from 'node:path'
import { FILES_ROOT, DATA_DIR, filesMode } from './store.js'

const FIL = () => (filesMode() ? path.join(FILES_ROOT, '.tua', 'skjerm-valg.json') : path.join(DATA_DIR, 'skjerm-valg.json'))
const les = () => { try { const j = JSON.parse(fs.readFileSync(FIL(), 'utf8')); return { arbeid: j.arbeid && typeof j.arbeid === 'object' ? j.arbeid : {}, forslag: j.forslag && typeof j.forslag === 'object' ? j.forslag : {} } } catch { return { arbeid: {}, forslag: {} } } }
function skriv(alt) {
  const f = FIL(), tmp = `${f}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify({ ...alt, oppdatert: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, f)
}
export const TYPER = ['navn', 'firma', 'annet']
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const MAKS = 2000

// Vask det som kommer inn: tomme og for korte ut, like slått sammen, «legg til» vinner over «fjern» for samme tekst.
export function renskValg(v = {}) {
  const legg = [], sett = new Set()
  for (const l of Array.isArray(v?.legg) ? v.legg : []) {
    const tekst = String((typeof l === 'string' ? l : l?.tekst) || '').replace(/\s+/g, ' ').trim()
    if (tekst.length < 2 || tekst.length > 200 || sett.has(norm(tekst))) continue
    sett.add(norm(tekst)); legg.push({ tekst, type: TYPER.includes(l?.type) ? l.type : 'annet' })
  }
  const unike = (liste, nei = new Set()) => { const s = new Set(); const ut = []; for (const x of Array.isArray(liste) ? liste : []) { const t = String(x || '').replace(/\s+/g, ' ').trim(); if (t && !s.has(norm(t)) && !nei.has(norm(t))) { s.add(norm(t)); ut.push(t) } } return ut }
  return { legg: legg.slice(0, MAKS), fjern: unike(v?.fjern, sett).slice(0, MAKS), avvist: unike(v?.avvist, sett).slice(0, MAKS) }
}
export function valgFor(nøkler = []) {
  const a = les().arbeid
  const inn = nøkler.map((n) => a[n]).filter(Boolean)
  return renskValg({ legg: inn.flatMap((x) => x.legg || []), fjern: inn.flatMap((x) => x.fjern || []), avvist: inn.flatMap((x) => x.avvist || []) })
}
export const erSett = (nøkler, id, versjon) => { const a = les().arbeid; return nøkler.some((n) => a[n]?.sett?.[id]?.versjon === versjon) }
// Claude-døra vet ikke hvilket arbeid den er i: er fila sett over i ETT arbeid, regnes den som sett over, og alt Erik har lagt til noe sted gjelder der (fjerninger gjør det ikke: skjerm heller for mye).
export const erSettNoensteds = (id, versjon) => Object.values(les().arbeid).some((x) => x?.sett?.[id]?.versjon === versjon)
export const alleLagtTil = () => renskValg({ legg: Object.values(les().arbeid).flatMap((x) => x?.legg || []) }).legg
export function bekreft(nøkkel, saker = [], valg = {}) {
  if (!nøkkel) throw new Error('arbeidet mangler')
  const alt = les()
  const før = alt.arbeid[nøkkel] || {}
  const r = renskValg(valg)
  const tid = new Date().toISOString()
  alt.arbeid[nøkkel] = { ...før, ...r, sett: { ...(før.sett || {}), ...Object.fromEntries(saker.map((s) => [s.id, { versjon: s.version, tid }])) } }
  skriv(alt)
  return r
}
export const forslagFor = (id, versjon) => { const f = les().forslag[id]; return f && f.versjon === versjon ? f : null }
export function lagreForslag(id, data) { const alt = les(); alt.forslag[id] = { ...data, tid: new Date().toISOString() }; skriv(alt); return alt.forslag[id] }
