#!/usr/bin/env node
// bygg.mjs — bygger serveren slik at pluginen kjører uten `npm install` OG slik at katalogens sikkerhetsskanning kan lese alt.
//
//   node bygg.mjs   → server/tua-server.mjs            inngangen (.mcp.json og .mcpb peker hit)
//                   → server/bygd/tua/<modul>.mjs      Tuas egne moduler, én lesbar fil per kildefil (bygd fra server/*.js)
//                   → server/bygd/vendor/<pakke>/…     avhengighetene (@modelcontextprotocol/sdk, zod, ajv …) som vanlige ES-moduler,
//                                                      én fil per modul, samme stier som i node_modules — ikke minifisert
//                   → server/apps/kort-bibliotek.N.js   kortets klientbibliotek (@modelcontextprotocol/ext-apps «app» + sdk + zod),
//                                                      ubyggd, delt i tekstdeler under 256 KiB som apps.js setter sammen igjen
//
// Hvorfor to krav (20.–21.10.2026):
//   1. Claude Desktop laster ned konto-plugins fra katalogen som rene kopier av repoet og kjører aldri `npm install`; uten bygging
//      krasjet serveren der med «Cannot find package '@modelcontextprotocol/sdk'» (0.5.0–0.5.2).
//   2. Katalogens sikkerhetsskanning leser ikke filer over 256 KiB og holder tilbake «pakket» kode; én minifisert fil på 1,2 MB
//      (0.5.3–0.5.4) ble flagget «Ships code the scan can't read» og kunne ikke gå live. Derfor: mange små, lesbare filer.
//
// Kildefilene i server/ er fortsatt sannheten for utvikling, tester og hooks (hooks og kommandolinjeverktøyene bruker ingen
// eksterne pakker og trenger ingen bygging). Kjør etter hver endring i server/ — før commit, split og push. Testen «bundle» i
// server/test-platform.mjs sier fra om bygget er eldre enn kildefilene, har feil versjon eller har en fil over grensen.
//
// Verktøy: Rollup (+ node-resolve, commonjs, json) og esbuild fra ../tua2-sandbox/node_modules (dette repoets utviklerverktøy,
// aldri en del av pluginen). Ingen nettverk; ingenting publiseres.

import fs from 'node:fs'
import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(HERE, 'server')
const ENTRY = path.join(SERVER, 'server.js')
const OUT_ENTRY = 'tua-server.mjs'
const OUT_DIR = path.join(SERVER, 'bygd')
const APPS = path.join(SERVER, 'apps')
const LIB_PREFIX = 'kort-bibliotek.'
export const MAX_BYTES = 256 * 1024          // katalogens grense per fil — alt over leses ikke av skanningen
const PART_BYTES = 230 * 1024                // delstørrelse for kortbiblioteket, med margin
const version = JSON.parse(fs.readFileSync(path.join(HERE, '.claude-plugin', 'plugin.json'), 'utf8')).version

// ── utviklerverktøyene ligger i sandkassen (som før for esbuild)
const TOOLS = [path.join(HERE, '..', 'tua2-sandbox', 'node_modules'), path.join(HERE, 'node_modules')].find((d) => fs.existsSync(path.join(d, 'rollup')))
if (!TOOLS) throw new Error('fant ikke rollup — kjør `npm install` i ../tua2-sandbox (utviklerverktøyene) først')
const need = createRequire(path.join(TOOLS, 'x.js'))
const { rollup } = await import(pathToFileURL(need.resolve('rollup')).href)
const nodeResolve = (await import(pathToFileURL(need.resolve('@rollup/plugin-node-resolve')).href)).default
const commonjs = (await import(pathToFileURL(need.resolve('@rollup/plugin-commonjs')).href)).default
const json = (await import(pathToFileURL(need.resolve('@rollup/plugin-json')).href)).default
const esbuild = need('esbuild')

const banner = `// Tua-plugin ${version} — bygd av bygg.mjs ${new Date().toISOString().slice(0, 10)}. IKKE REDIGER: kilden er server/*.js og node_modules.`

// ── 1) serveren: én ES-modul per kildefil, avhengighetene som vendor/-moduler
fs.rmSync(OUT_DIR, { recursive: true, force: true })
for (const old of ['tua-server.bundle.mjs']) fs.rmSync(path.join(SERVER, old), { force: true })   // 0.5.3–0.5.4
const chunkName = (id) => {
  const clean = id.replace(/^\0/, '').replace(/\?.*$/, '')
  const nm = clean.split('/node_modules/').pop()
  // mappenavn som dist/ og node_modules/ er gitignorert og hoppes over av kopier/validatorer — de fjernes fra vendor-stiene
  if (clean.includes('/node_modules/')) return 'vendor/' + nm.replace(/\/dist\/(esm\/|cjs\/)?/g, '/').replace(/\/node_modules\//g, '/').replace(/\.[cm]?js$/, '')
  if (clean.startsWith(SERVER + path.sep)) return 'tua/' + path.basename(clean).replace(/\.js$/, '')
  return 'vendor/_rollup/' + path.basename(clean).replace(/[^\w.-]/g, '_').replace(/\.js$/, '')
}
const build = await rollup({
  input: ENTRY,
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node', 'import', 'module', 'default'] }),
    commonjs({ ignoreDynamicRequires: true }),
    json(),
    {
      name: 'tua-stier',
      // Tuas moduler bruker import.meta.url for å finne apps/kort.html, trust-scores.json osv. ved siden av seg i server/.
      // Bygd ligger de i server/bygd/tua/, så import.meta.url pekes tilbake på kildefila i server/ (mappa er det som teller).
      resolveImportMeta(prop, { chunkId, moduleId }) {
        if (prop !== 'url' || !moduleId.startsWith(SERVER + path.sep)) return null
        const up = '../'.repeat(chunkId.split('/').length - 1)
        return `new URL(${JSON.stringify(up + path.basename(moduleId))}, import.meta.url).href`
      },
      renderChunk(code, chunk) {
        code = code.replace(/^#![^\n]*\n/, '')          // server.js sin shebang — inngangen startes alltid med `node`
        return chunk.isEntry ? `${banner}\nglobalThis.__TUA_BUNDLE = true;\n${code}` : `${banner}\n${code}`
      },
    },
  ],
  external: (id) => id.startsWith('node:') || builtinModules.includes(id),
  onwarn(w, warn) { if (!['CIRCULAR_DEPENDENCY', 'THIS_IS_UNDEFINED', 'EMPTY_BUNDLE'].includes(w.code)) warn(w) },
})
await build.write({
  dir: SERVER, format: 'es', entryFileNames: OUT_ENTRY, chunkFileNames: 'bygd/[name].mjs', manualChunks: chunkName,
  minifyInternalExports: false, hoistTransitiveImports: false, generatedCode: { constBindings: true }, sourcemap: false,
})
await build.close()
// tomme moduler (bare re-eksporter som Rollup har flatet ut) skrives som tomme filer — fjern dem som ingen importerer
const walkAll = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(path.join(d, e.name)) : [path.join(d, e.name)]))
const sources = [path.join(SERVER, OUT_ENTRY), ...walkAll(OUT_DIR)].map((f) => fs.readFileSync(f, 'utf8'))
const imported = (f) => { const rel = '/' + path.relative(OUT_DIR, f).split(path.sep).join('/') + "'"; return sources.some((s) => s.includes(rel)) }
let fjernet = 0
for (const f of walkAll(OUT_DIR)) if (fs.readFileSync(f, 'utf8').replace(banner, '').trim() === '' && !imported(f)) { fs.rmSync(f); fjernet++ }
for (const d of walkAll(OUT_DIR).map(path.dirname)) { try { if (!fs.readdirSync(d).length) fs.rmdirSync(d) } catch {} }

// ── 2) kortets klientbibliotek: ubyggd ESM for nettleseren, delt på linjegrenser i tekstdeler under grensen
for (const f of fs.readdirSync(APPS)) if (f.startsWith(LIB_PREFIX) || f === 'app-with-deps.js') fs.rmSync(path.join(APPS, f))
const extDir = path.join(HERE, 'node_modules', '@modelcontextprotocol', 'ext-apps')       // pakkas «exports» skjuler dist/src/app.js, så stien tas direkte
const extApps = path.join(extDir, 'dist', 'src', 'app.js')
if (!fs.existsSync(extApps)) throw new Error(`fant ikke ${extApps} — kjør npm ci i ${HERE} først`)
const extVersion = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8')).version
const lib = await esbuild.build({ entryPoints: [extApps], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: false, write: false, logLevel: 'warning', absWorkingDir: HERE })
const lines = lib.outputFiles[0].text.split('\n')
const parts = [[]]
let size = 0
for (const line of lines) {
  if (size + line.length + 1 > PART_BYTES && parts.at(-1).length) { parts.push([]); size = 0 }
  parts.at(-1).push(line); size += line.length + 1
}
parts.forEach((p, i) => {
  const head = i === 0 ? `// Tua-plugin ${version}: kortets klientbibliotek (@modelcontextprotocol/ext-apps ${extVersion} med sdk og zod) i ${parts.length} tekstdeler;\n// apps.js setter dem sammen i rekkefølge før de inlines i kort.html. Bygd av bygg.mjs, ikke minifisert. IKKE REDIGER.\n` : ''
  fs.writeFileSync(path.join(APPS, `${LIB_PREFIX}${i + 1}.js`), head + p.join('\n') + (i === parts.length - 1 ? '' : '\n'))
})

// ── 3) kontroll: ingen fil over grensen, og rapport
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
const built = [path.join(SERVER, OUT_ENTRY), ...walk(OUT_DIR), ...fs.readdirSync(APPS).filter((f) => f.startsWith(LIB_PREFIX)).map((f) => path.join(APPS, f))]
const over = built.filter((f) => fs.statSync(f).size > MAX_BYTES)
if (over.length) throw new Error(`filer over ${MAX_BYTES / 1024} KiB (skanningen leser dem ikke): ${over.map((f) => path.relative(HERE, f)).join(', ')}`)
const total = built.reduce((a, f) => a + fs.statSync(f).size, 0)
const biggest = built.map((f) => [fs.statSync(f).size, f]).sort((a, b) => b[0] - a[0])[0]
console.log(`server/${OUT_ENTRY} + ${walk(OUT_DIR).length} moduler i server/bygd/ · kortbiblioteket i ${parts.length} deler · ${built.length} filer, ${Math.round(total / 1024)} kB, største ${Math.round(biggest[0] / 1024)} kB (${path.relative(HERE, biggest[1])}) · versjon ${version}`)
