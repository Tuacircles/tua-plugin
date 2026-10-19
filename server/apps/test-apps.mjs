// test-apps.mjs — snakker ekte MCP over stdio mot server.js og sjekker kortet:
//   tools/list har _meta.ui på tua_card og tua_open · resources/read gir ui://tua/kort med riktig MIME
//   tua_card(query) og tua_card(id, level=M) gir content + structuredContent · tua_open i dryrun
// Skriver en test-vert (falsk host som snakker postMessage-protokollen) til --out <mappe>/index.html,
// med kortets HTML og ekte svar inlinet, slik at kortet kan ses i en nettleser uten Claude Desktop.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : ''
const q = process.argv.includes('--query') ? process.argv[process.argv.indexOf('--query') + 1] : 'likviditet'

// M18: aldri mot det ekte arkivet — TUA_FILES_ROOT og TUA_DATA_DIR må peke på en testmappe
if (!process.env.TUA_FILES_ROOT || !process.env.TUA_DATA_DIR) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, '..', 'server.js')], cwd: path.join(HERE, '..'), env: { ...process.env, TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test' } })
const client = new Client({ name: 'tua-apps-test', version: '0.0.1' })
await client.connect(transport)

const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) process.exitCode = 1 }

const tools = (await client.listTools()).tools
const card = tools.find((t) => t.name === 'tua_card'), op = tools.find((t) => t.name === 'tua_open')
ok(card?._meta?.ui?.resourceUri === 'ui://tua/kort', 'tua_card peker på ui://tua/kort')
ok(op?._meta?.ui?.visibility?.includes('app') && !op._meta.ui.visibility.includes('model'), 'tua_open er bare synlig for appen')

const res = await client.readResource({ uri: 'ui://tua/kort' })
const html = res.contents[0]
ok(html.mimeType === 'text/html;profile=mcp-app', `ressursen har MIME ${html.mimeType}`)
ok(html.text.includes('window.McpApps') && html.text.includes('tua_card'), `HTML ${(html.text.length / 1024).toFixed(0)} KB med SDK inlinet`)

const list = await client.callTool({ name: 'tua_card', arguments: { query: q, limit: 5 } })
ok(list.structuredContent?.mode === 'list' && list.structuredContent.items.length > 0, `treffliste «${q}»: ${list.structuredContent?.total} treff, ${list.structuredContent?.items?.length} vist`)
const firstId = list.structuredContent?.items?.[0]?.id
const atom = firstId ? await client.callTool({ name: 'tua_card', arguments: { id: firstId, level: 'M' } }) : null
ok(atom?.structuredContent?.mode === 'atom' && atom.structuredContent.atom.level, `atom-kort ${firstId}: nivå ${atom?.structuredContent?.atom?.level}, ${atom?.structuredContent?.atom?.text?.length} tegn`)
const opened = firstId ? await client.callTool({ name: 'tua_open', arguments: { id: firstId, target: 'finder' } }) : null
ok(opened?.structuredContent?.ok, `tua_open finder (dryrun): ${opened?.structuredContent?.ran?.join(' ')}`)

if (out) {
  fs.mkdirSync(out, { recursive: true })
  const fixtures = { list, atom }
  const J = (x) => JSON.stringify(x).replace(/<\//g, '<\\/')      // «</script>» inne i strenger må ikke lukke script-taggen
  const host = `<!DOCTYPE html><html lang="nb"><head><meta charset="utf-8"><title>Tua-kort — testvert</title>
<style>body{margin:0;background:#F5F4ED;font-family:system-ui,sans-serif;padding:24px}.wrap{max-width:640px;margin:0 auto}
h1{font-size:14px;color:#73726C;font-weight:500}iframe{width:100%;border:1px solid rgba(31,30,29,.3);border-radius:12px;background:#fff;display:block;margin:12px 0 24px}
.bar{display:flex;gap:8px;margin:8px 0 16px}.bar button{padding:6px 12px;border:1px solid #999;border-radius:999px;background:#fff;cursor:pointer}
pre{font-size:11px;color:#555;white-space:pre-wrap;background:#fff;padding:8px;border-radius:8px;max-height:160px;overflow:auto}</style></head>
<body><div class="wrap"><h1>Falsk vert for Tua-kortet (postMessage-protokollen, som Claude Desktop). Svar fra den ekte serveren er inlinet.</h1>
<div class="bar"><button data-k="list">Treffliste</button><button data-k="atom">Atom-kort (M)</button><button data-k="dark">Mørk</button></div>
<iframe id="f" title="Tua-kort"></iframe><!-- uten sandbox her, så innholdet kan inspiseres fra testverten; Claude kjører kortet i sandkasse --><pre id="log"></pre></div>
<script>
const FIX = ${J(fixtures)}
const HTML = ${J(html.text)}
const log = (s) => { const p = document.getElementById('log'); p.textContent = (s + '\\n' + p.textContent).slice(0, 4000) }
const f = document.getElementById('f'); let dark = false
const vars = (d) => d ? {'--color-background-primary':'#30302E','--color-background-secondary':'#262624','--color-text-primary':'#FAF9F5','--color-text-secondary':'#C2C0B6','--color-text-tertiary':'#9C9A92','--color-border-primary':'rgba(222,220,209,.4)','--color-border-tertiary':'rgba(222,220,209,.15)'} : {}
const send = (m) => f.contentWindow.postMessage({ jsonrpc: '2.0', ...m }, '*')
let current = 'list'
function boot(k) { current = k; f.srcdoc = HTML; log('→ laster kortet (' + k + ')') }
window.addEventListener('message', async (ev) => {
  const m = ev.data; if (!m || m.jsonrpc !== '2.0') return
  if (m.method === 'ui/initialize') {
    send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2026-01-26', hostCapabilities: { openLinks: {}, serverTools: {}, updateModelContext: {} }, hostInfo: { name: 'testvert', version: '0' }, hostContext: { theme: dark ? 'dark' : 'light', displayMode: 'inline', styles: { variables: vars(dark) }, locale: 'nb-NO', platform: 'desktop' } } })
    log('← ui/initialize besvart'); return
  }
  if (m.method === 'ui/notifications/initialized') {
    const r = FIX[current]
    send({ method: 'ui/notifications/tool-input', params: { arguments: current === 'list' ? { query: ${J(q)} } : { id: r.structuredContent.atom.id, level: 'M' } } })
    send({ method: 'ui/notifications/tool-result', params: r })
    log('← tool-input + tool-result sendt (' + current + ')'); return
  }
  if (m.method === 'ui/notifications/size-changed') { f.style.height = Math.min(1400, m.params.height + 2) + 'px'; return }
  if (m.method === 'tools/call') {
    log('→ tools/call ' + m.params.name + ' ' + JSON.stringify(m.params.arguments))
    const a = m.params.arguments || {}
    let result
    if (m.params.name === 'tua_open') result = { content: [{ type: 'text', text: 'Åpnet (testvert)' }], structuredContent: { ok: true, target: a.target, ran: ['open', '(testvert)'] } }
    else if (a.id) result = FIX.atom.structuredContent.atom.id === a.id ? { ...FIX.atom, structuredContent: { ...FIX.atom.structuredContent, atom: { ...FIX.atom.structuredContent.atom, level: a.level || 'S', text: a.level === 'S' ? FIX.atom.structuredContent.atom.S : FIX.atom.structuredContent.atom.text } } } : { content: [{ type: 'text', text: 'Testverten har bare ett atom inlinet: ' + FIX.atom.structuredContent.atom.id }], structuredContent: { mode: 'error', error: 'Testverten har bare ett atom (' + FIX.atom.structuredContent.atom.name + '). I Claude ville dette hentet ' + a.id + '.' } }
    else result = FIX.list
    send({ id: m.id, result }); return
  }
  if (m.method === 'ui/open-link') { log('→ ui/open-link ' + m.params.url); send({ id: m.id, result: {} }); return }
  if (m.method === 'ui/update-model-context') { log('→ modellkontekst: ' + (m.params.content?.[0]?.text || '')); send({ id: m.id, result: {} }); return }
  if (m.id != null && m.method) { send({ id: m.id, result: {} }); log('← ' + m.method + ' (tomt svar)') }
})
document.querySelectorAll('.bar button').forEach((b) => b.onclick = () => { if (b.dataset.k === 'dark') { dark = !dark; document.body.style.background = dark ? '#262624' : '#F5F4ED'; boot(current) } else boot(b.dataset.k) })
boot('list')
</script></body></html>`
  fs.writeFileSync(path.join(out, 'index.html'), host)
  console.log(`Testvert: ${path.join(out, 'index.html')}`)
}
await client.close()
