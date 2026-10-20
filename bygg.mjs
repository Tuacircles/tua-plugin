#!/usr/bin/env node
// bygg.mjs — bygger serveren til ÉN fil uten eksterne pakker, så pluginen kjører der ingen installerer avhengigheter.
//
//   node bygg.mjs            → server/tua-server.bundle.mjs   (serveren + @modelcontextprotocol/sdk, ext-apps og zod, ~1,2 MB)
//                            → server/apps/app-with-deps.js   (kortets klientbibliotek, lest av apps.js ved resources/read)
//
// Hvorfor (funnet 20.10.2026): Claude Desktop laster ned konto-plugins fra katalogen som rene kopier av repoet og kjører aldri
// `npm install`. Derfor krasjet `server/server.js` der med «Cannot find package '@modelcontextprotocol/sdk'» — i Cowork og i
// Code-økter startet fra Desktop. `.mcp.json` og `.mcpb` peker nå på bundelen; kildefilene i server/ er fortsatt sannheten
// for utvikling, tester og hooks (hooks og kommandolinjeverktøyene bruker ingen eksterne pakker og trenger ingen bundel).
//
// Kjør etter hver endring i server/ — før commit, split og push. Testen «bundle» i server/test-platform.mjs sier fra om
// bundelen er eldre enn kildefilene eller har feil versjon. Krever esbuild: fra ../tua2-sandbox/node_modules (dette repoet)
// eller `npx esbuild@0.21.5` (eget repo). Ingen nettverk ellers; ingenting publiseres.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'server', 'tua-server.bundle.mjs')
const VENDOR = path.join(HERE, 'server', 'apps', 'app-with-deps.js')
const version = JSON.parse(fs.readFileSync(path.join(HERE, '.claude-plugin', 'plugin.json'), 'utf8')).version

// 1) kortets klientbibliotek — samme fil apps.js ellers finner via import.meta.resolve
const extApps = path.join(HERE, 'node_modules', '@modelcontextprotocol', 'ext-apps', 'dist', 'src', 'app-with-deps.js')
if (!fs.existsSync(extApps)) throw new Error(`fant ikke ${extApps} — kjør npm ci i ${HERE} først`)
fs.copyFileSync(extApps, VENDOR)

// 2) serveren som én ESM-fil. Banneret: __TUA_BUNDLE sier til kildefilene at de er buntet (import.js sin kommandolinje-gren
// skal ikke kjøre), og `require` må finnes for CommonJS-pakker inne i bundelen.
const candidates = [path.join(HERE, '..', 'tua2-sandbox', 'node_modules', '.bin', 'esbuild'), path.join(HERE, 'node_modules', '.bin', 'esbuild')]
const esbuild = candidates.find((p) => fs.existsSync(p))
const args = ['server/server.js', '--bundle', '--platform=node', '--format=esm', '--target=node22', '--log-level=warning', `--outfile=${OUT}`,
  `--banner:js=// Tua-plugin ${version} — bygd av bygg.mjs ${new Date().toISOString().slice(0, 10)}. IKKE REDIGER: kilden er server/*.js.\nglobalThis.__TUA_BUNDLE = true; import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);`]
if (esbuild) execFileSync(esbuild, args, { cwd: HERE, stdio: 'inherit' })
else execFileSync('npx', ['--yes', 'esbuild@0.21.5', ...args], { cwd: HERE, stdio: 'inherit' })

const kb = (p) => `${Math.round(fs.statSync(p).size / 1024)} kB`
console.log(`server/tua-server.bundle.mjs (${kb(OUT)}) · server/apps/app-with-deps.js (${kb(VENDOR)}) · versjon ${version}`)
