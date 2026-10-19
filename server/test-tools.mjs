#!/usr/bin/env node
// test-tools.mjs — kaller ALLE verktøyene én gang over ekte MCP (stdio), slik Claude gjør, mot et tomt scratch-arkiv.
//
//   node server/test-tools.mjs
//
// Sjekker det katalogen krever av hvert verktøy (M18): tittel, readOnlyHint/destructiveHint, og at hvert kall svarer
// uten feil med gyldige argumenter. Rører aldri det ekte arkivet (TUA_FILES_ROOT/TUA_DATA_DIR peker på en temp-mappe,
// TUA_OPEN_DRYRUN hindrer at noe åpnes). Avslutter med kode 1 ved første feil.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-tools-'))
// Ingen TUA_FILES_ROOT: arkivet skal være «ikke valgt» ved start, så første-kjøringen (tua_setup) testes også. TUA_HOME peker
// på en tom mappe → ingen skytjenester finnes, bare «lokalt» — samme situasjon som en ny bruker uten Dropbox/iCloud.
const env = { ...process.env, TUA_FILES_ROOT: '', TUA_DATA_DIR: path.join(scratch, 'data'), TUA_HOME: path.join(scratch, 'home'), TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test' }
delete env.TUA_FILES_ROOT
fs.mkdirSync(env.TUA_HOME, { recursive: true })
const ROOT = path.join(env.TUA_HOME, 'Tua')
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, 'server.js')], cwd: HERE, env, stderr: 'pipe' })
const client = new Client({ name: 'tua-tools-test', version: '0.0.1' })
await client.connect(transport)

const EXPECTED = ['tua_setup', 'tua_import', 'tua_save', 'tua_search', 'tua_get', 'tua_list', 'tua_compose', 'tua_link', 'tua_unlink', 'tua_card', 'tua_open']
const READ_ONLY = new Set(['tua_search', 'tua_get', 'tua_list', 'tua_card', 'tua_open'])
const { tools } = await client.listTools()
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED].sort(), 'verktøylista')
for (const t of tools) {
  assert.ok(t.title || t.annotations?.title, `${t.name}: mangler title`)
  assert.ok(t.name.length <= 64, `${t.name}: navn over 64 tegn`)
  assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name}: mangler readOnlyHint`)
  assert.equal(typeof t.annotations?.destructiveHint, 'boolean', `${t.name}: mangler destructiveHint`)
  assert.equal(t.annotations.readOnlyHint, READ_ONLY.has(t.name), `${t.name}: readOnlyHint skal være ${READ_ONLY.has(t.name)}`)
  assert.equal(t.annotations.destructiveHint, false, `${t.name}: ingen Tua-verktøy sletter`)
  assert.ok(t.description && t.description.length > 40, `${t.name}: for kort beskrivelse`)
}
console.log(`✔ ${tools.length} verktøy, alle med title + readOnlyHint/destructiveHint: ${tools.map((t) => `${t.name}${t.annotations.readOnlyHint ? ' (les)' : ''}`).join(', ')}`)

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = (r.content || []).map((c) => c.text || '').join('\n')
  assert.ok(!r.isError, `${name} svarte med feil: ${text.slice(0, 300)}`)
  return { r, text }
}
const step = (label, text) => console.log(`✔ ${label}: ${text.replace(/\s+/g, ' ').slice(0, 110)}…`)

// Første kjøring: arkivet er ikke valgt → tua_setup uten argumenter viser steder; med sted=lokalt lages arkivet (testklienten har ikke elicitation)
let { text } = await call('tua_setup'); assert.ok(/ikke valgt/.test(text), text.slice(0, 200)); assert.ok(/lokalt = /.test(text)); step('tua_setup (uten arg)', text)
// et annet verktøy før valget → «oppsett:»-linja (klienten har ikke elicitation), ingenting lages
;({ text } = await call('tua_list')); assert.ok(/^oppsett:/.test(text) && !fs.existsSync(ROOT), 'skal spørre, ikke gjette: ' + text.slice(0, 120)); step('tua_list før valg → oppsett-linje', text)
;({ text } = await call('tua_setup', { sted: 'lokalt' })); assert.ok(/opprettet/.test(text) && fs.existsSync(path.join(ROOT, 'Tua', 'Velkommen til Tua.md'))); step('tua_setup (sted=lokalt)', text)

// Lagre to atomer i hvert sitt prosjekt, med S og M
const long = 'Likviditeten i prosjektet holder til mars 2027 med dagens burn. '.repeat(60)
;({ text } = await call('tua_save', { content: long, name: 'Likviditet høst 2026', project: 'Riulf', convo: 'Styrenotat', short: 'Likviditeten holder til mars 2027 med dagens burn.', medium: 'Sammendrag: likviditet til mars 2027; burn uendret; ingen nye kilder.', tags: ['likviditet'] }))
const id1 = (text.match(/atom (a_[a-z0-9_]+)/) || [])[1]; assert.ok(id1); step('tua_save #1', text)
;({ text } = await call('tua_save', { content: 'Vedlikehold 2027: beise terrasse (vår), male vindskier (sommer), tømme vannsystem (høst). Pris-estimat materialer ca 6 000 kr.', project: 'Hytta', convo: 'Vedlikeholdsplan', short: 'Årshjul for hytta med prisestimat 6 000 kr.', tags: ['hytte'] }))
const id2 = (text.match(/atom (a_[a-z0-9_]+)/) || [])[1]; assert.ok(id2); step('tua_save #2', text)

;({ text } = await call('tua_search', { query: 'likviditet' })); assert.ok(text.includes(id1)); step('tua_search', text)
;({ text } = await call('tua_get', { id: id1, level: 'M' })); assert.ok(/Nivå: M/.test(text)); step('tua_get (M)', text)
;({ text } = await call('tua_list', {})); assert.ok(/3 atomer/.test(text), text.slice(0, 80)); step('tua_list', text)
;({ text } = await call('tua_link', { id: id2, project: 'Riulf', level: 'S' })); assert.ok(/synlig i Riulf/.test(text)); step('tua_link', text)
;({ text } = await call('tua_search', { query: 'hytta', context: 'Riulf' })); assert.ok(text.includes(id2) && /referert inn/.test(text)); step('tua_search (context)', text)
;({ text } = await call('tua_compose', { ids: [id1, id2], name: 'Styrenotat — test', level: 'M', key: 'lev:test' })); assert.ok(/bygget av 2 atomer/.test(text)); step('tua_compose', text)
;({ text } = await call('tua_unlink', { id: id2, project: 'Riulf' })); assert.ok(/ikke lenger synlig/.test(text)); step('tua_unlink', text)
;({ text } = await call('tua_import', { kilde: 'innboks', dryRun: true })); assert.ok(/Ingenting å importere/.test(text)); step('tua_import (innboks, dryRun)', text)
const card = await call('tua_card', { id: id1 }); assert.ok(card.r.structuredContent?.atom?.id === id1 || /Likviditet/.test(card.text)); step('tua_card (atom)', card.text)
const list = await call('tua_card', { query: 'hytta' }); assert.ok(/hytta/i.test(list.text)); step('tua_card (query)', list.text)
;({ text } = await call('tua_open', { id: id1, target: 'finder' })); assert.ok(/Åpnet finder|dryrun/.test(text)); step('tua_open (finder, dryrun)', text)

// Ressursen for kortet (MCP App)
const { resources } = await client.listResources()
assert.ok(resources.some((r) => r.uri === 'ui://tua/kort'), 'ressursen ui://tua/kort mangler')
console.log('✔ ressurs ui://tua/kort finnes')

await client.close()
const files = fs.readdirSync(ROOT, { recursive: true }).filter((f) => String(f).endsWith('.md'))
console.log(`✔ ${files.length} markdown-filer i scratch-arkivet · ingenting utenfor ${scratch}`)
fs.rmSync(scratch, { recursive: true, force: true })
console.log('alle verktøy kjørte én gang')
