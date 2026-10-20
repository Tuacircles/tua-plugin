// test-tuaprat.mjs — regelen som holder Tua-prat om Tua ute av arkivet (isTuaCommand / isTuaEcho), og stillhetsvakten.
import assert from 'node:assert/strict'
import { isTuaCommand, isTuaEcho } from './import.js'
import { desktopStaleness } from './desktop.js'

// samtaler som starter med en Tua-kommando
assert.equal(isTuaCommand('/tua_card brygge'), true)
assert.equal(isTuaCommand('  /tua lagre dette'), true)
assert.equal(isTuaCommand('/tua'), true)
assert.equal(isTuaCommand('/tuareg er ikke tua'), false)
assert.equal(isTuaCommand('kan du lese den nye folderen som er lagt til?'), false)
assert.equal(isTuaCommand(''), false)

// svar som bare gjengir et Tua-søk eller -kort
assert.equal(isTuaEcho('Fem treff på «brygge» vises i kortet over. De to øverste fra 12.10. er arbeidsnotatene …'), true)
assert.equal(isTuaEcho('Søket på «skado» gir 43 treff, og kortet viser de fem nyeste.\n\n1. Skado – energima …'), false)   // «43 treff,» uten «på «» — men:
assert.equal(isTuaEcho('43 treff på «skado» i 1 prosjekt:\n\n1. [a_mv9pk93d_bzvy0a] Energima-saken\n2. [a_mv9pk93b_u90bin] Skado'), true)
assert.equal(isTuaEcho('Kortet viser to atomer: [a_mv5gcszh_yreohl] og [a_mv5gby7b_q3xzj4] — begge om Tua-kortet.'), true)
// ekte innhold som nevner id-er eller «treff» i forbifarten
assert.equal(isTuaEcho('# Tua 2.0 — status og veikart\n\nM13 ferdig. Kortet [a_mv6kapgo_0szz03] og importen [a_mv89hzf7_ahn9q5] ' + 'x'.repeat(3500)), false)
assert.equal(isTuaEcho('Tre veier, i rekkefølge etter hvor mye de koster oss hvis de lykkes. Brev C hever det rettslige registeret.'), false)
assert.equal(isTuaEcho('Retten kjøpte Energimas linje. Ingen treff på «avtaleloven § 36» i dommen, men …'), false)   // «treff på «» midt i et avsnitt er vanlig språk, ikke et Tua-svar

// stillhetsvakten svarer alltid med samme form
const ds = desktopStaleness()
assert.equal(typeof ds.stale, 'boolean'); assert.equal(typeof ds.active, 'boolean')
console.log(`tua-prat-regelen ✔ · stillhetsvakt: ${ds.stale ? `STILLE i ${ds.days} dager` : 'ok'} (nyeste importerte samtale ${ds.days ?? '—'} dager gammel, Desktop ${ds.active ? 'i bruk' : 'ikke i bruk'})`)
