#!/usr/bin/env node
// byggvakt.js — vakten i post-commit-hooken (Erik 29.10.2026): sier fra i commit-øyeblikket når bygget er eldre enn
// kildene, i stedet for at helsesjekken finner det kl. 03:30 (R7 rød natt til 24.10 og 29.10 — begge ganger var
// server/*.js endret uten `node bygg.mjs`). Samme regel som R7: kildefiler som inngår i bygget (server/bygd/tua/<navn>.mjs
// finnes) må være eldre enn server/tua-server.mjs, og versjonen i server.js, package.json og plugin.json må være lik.
//
//   node server/byggvakt.js          → stille og 0 når alt er i takt; ellers en tydelig advarsel på stderr og 1
//   node server/byggvakt.js --quiet  → bare avslutningskode
//
// Vakten blokkerer ingenting (commiten er alt gjort) og skriver bare én ting: <arkiv>/.tua/helsesjekk-varsel.txt, som
// SessionStart-hooken leser høyt i første Claude-økt, så advarselen ikke drukner i terminalen.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const quiet = process.argv.includes('--quiet')
const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} } }

const problems = []
const entry = path.join(HERE, 'tua-server.mjs')
if (!fs.existsSync(entry)) problems.push('server/tua-server.mjs finnes ikke')
else {
  const built = mtime(entry)
  const stale = fs.readdirSync(HERE).filter((f) => /\.js$/.test(f) && fs.existsSync(path.join(HERE, 'bygd', 'tua', f.replace(/\.js$/, '.mjs'))) && mtime(path.join(HERE, f)) > built)
  if (stale.length) problems.push(`bygget er eldre enn ${stale.map((f) => `server/${f}`).join(', ')}`)
}
const vPlugin = readJson(path.join(PLUGIN, '.claude-plugin', 'plugin.json')).version
const vPkg = readJson(path.join(PLUGIN, 'package.json')).version
const vSrv = (() => { try { return (fs.readFileSync(path.join(HERE, 'server.js'), 'utf8').match(/name: 'tua', version: '([^']+)'/) || [])[1] } catch { return undefined } })()
if (!(vPlugin && vPlugin === vPkg && vPlugin === vSrv)) problems.push(`versjonene spriker: plugin.json ${vPlugin} · package.json ${vPkg} · server.js ${vSrv}`)

if (!problems.length) process.exit(0)
const msg = `Bygget er ikke i takt med kildene: ${problems.join('; ')}. Kjør \`cd tua-plugin && node bygg.mjs\`, hev versjonen, og commit bygget — ellers kjører pluginen gammel kode og helsesjekken blir rød i natt (R7).`
if (!quiet) {
  console.error('')
  console.error('[tua-byggvakt] ADVARSEL — ' + msg)
  console.error('')
}
// Lapp til første Claude-økt (samme fil som helsesjekken bruker; SessionStart-hooken leser og sletter den)
try {
  const { FILES_ROOT } = await import('./store.js')
  if (FILES_ROOT) {
    const f = path.join(FILES_ROOT, '.tua', 'helsesjekk-varsel.txt')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, `${new Date().toISOString().slice(0, 10)} (byggvakten etter commit): ${msg}\n`)
  }
} catch {}
process.exit(1)
