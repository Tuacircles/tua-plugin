// test-client.js — snakker EKTE MCP over stdio mot server.js, slik Claude gjør.
// Beviser hele loopen: list → save → search på tvers → get.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// M18: kjør ALDRI mot det ekte arkivet. TUA_FILES_ROOT må peke på en scratch-mappe, og miljøet må sendes eksplisitt til
// serveren (SDK-ens stdio-transport videresender ellers bare et lite, fast sett miljøvariabler — ikke TUA_*).
if (!process.env.TUA_FILES_ROOT || !process.env.TUA_DATA_DIR) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, 'server.js')], cwd: HERE, env: { ...process.env, TUA_CLIENT: 'test' } })
const client = new Client({ name: 'tua-test', version: '0.0.1' })
await client.connect(transport)

const show = (label, r) => console.log(`\n=== ${label} ===\n` + r.content.map((c) => c.text).join('\n'))

const tools = await client.listTools()
console.log('Verktøy:', tools.tools.map((t) => t.name).join(', '))

show('save #1 (Tua Business)', await client.callTool({
  name: 'tua_save',
  arguments: {
    content: '# A2 — Tua som MCP-server\nClaude lagrer output direkte via tua_save. Proveniens (prosjekt, samtale, tid) festes automatisk. Ingen mappe. tua_search henter det inn i enhver senere samtale — prosjekt-siloen er borte.',
    project: 'Tua Business',
    convo: 'A2 — MCP-server',
    summary: 'MCP erstatter inn-liming; lagring og gjenfinning skjer inne i Claude.',
    tags: ['mcp', 'a2'],
  },
}))

show('save #2 (Hytta — annet prosjekt)', await client.callTool({
  name: 'tua_save',
  arguments: {
    content: 'Vedlikehold 2027: beise terrasse (vår), male vindskier (sommer), tømme vannsystem (høst). Pris-estimat materialer ca 6 000 kr.',
    project: 'Hytta',
    convo: 'Vedlikeholdsplan',
    summary: 'Årshjul med grovt prisestimat.',
    tags: ['hytte'],
  },
}))

show('search «pris» (på tvers)', await client.callTool({ name: 'tua_search', arguments: { query: 'pris' } }))
show('search «mcp»', await client.callTool({ name: 'tua_search', arguments: { query: 'mcp' } }))

const list = await client.callTool({ name: 'tua_list', arguments: {} })
show('list', list)
const firstId = (list.content[0].text.match(/\[(a_[a-z0-9_]+)\]/) || [])[1]
if (firstId) show(`get ${firstId}`, await client.callTool({ name: 'tua_get', arguments: { id: firstId } }))

await client.close()
