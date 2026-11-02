#!/usr/bin/env node
// test-appvakt.mjs — appvakten mot et ekte git-repo i scratch, med hookene sync-tua.js installerer og en vite-stubb.
//
//   node server/test-appvakt.mjs
//
// Dekker: commit på main bygger · fast-forward-fletting bygger · worktree bygger ikke · commit utenfor appen bygger ikke ·
// commiten venter ikke på bygget · feilet bygg lar gammel dist stå og legger lapp. Rører verken det ekte arkivet eller hovedutsjekken.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tua-appvakt-')))
const rot = path.join(scratch, 'repo'), wt = path.join(scratch, 'wt'), arkiv = path.join(scratch, 'arkiv')
const app = path.join(rot, 'tua2-sandbox'), dist = path.join(app, 'dist'), teller = path.join(scratch, 'bygg.txt'), lapp = path.join(arkiv, '.tua', 'helsesjekk-varsel.txt')
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
Object.assign(env, { TUA_FILES_ROOT: arkiv, TUA_DATA_DIR: path.join(scratch, 'data'), TUA_HOME: path.join(scratch, 'home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', STUB_TELLER: teller })
const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
const skriv = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }
const commit = (cwd, fil, tekst) => { skriv(path.join(cwd, fil), tekst); git(cwd, 'add', fil); git(cwd, 'commit', '-qm', `endret ${fil}`) }
const bygg = () => { try { return fs.readFileSync(teller, 'utf8').split('\n').filter(Boolean).length } catch { return 0 } }
const innhold = () => { try { return fs.readFileSync(path.join(dist, 'innhold.txt'), 'utf8') } catch { return '' } }
const tre = () => git(rot, 'rev-parse', 'HEAD:tua2-sandbox')
const stempel = () => { try { return fs.readFileSync(path.join(dist, '.bygd-fra'), 'utf8').trim() } catch { return '' } }
const sov = (ms) => new Promise((r) => setTimeout(r, ms))
// Bygget er ferdig når låsen er borte og stempelet er satt; ved feil blir stempelet aldri satt, derfor grensen
const lasBorte = () => !fs.existsSync(path.join(rot, '.git', 'tua-appbygg.lock'))
const vent = async (f, hva, ms = 20000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) assert.fail(`tidsavbrudd: ${hva}\n${fs.readFileSync(path.join(rot, '.git', 'tua-appbygg.log'), 'utf8')}`); await sov(50) } }

// Stubben oppfører seg som vite: skriver til --outDir, kopierer kilden, kan være treg og kan feile
const STUB = `import fs from 'node:fs'; import path from 'node:path'
const ut = process.argv[process.argv.indexOf('--outDir') + 1]
fs.appendFileSync(process.env.STUB_TELLER, 'bygg\\n')
const v = fs.readFileSync('src/app.js', 'utf8')
if (v.includes('TREG')) await new Promise((r) => setTimeout(r, 6000))
if (v.includes('FEIL')) { console.error('stubben feiler'); process.exit(3) }
fs.rmSync(ut, { recursive: true, force: true }); fs.mkdirSync(ut, { recursive: true })
fs.writeFileSync(path.join(ut, 'index.html'), '<!doctype html>'); fs.writeFileSync(path.join(ut, 'innhold.txt'), v)
`

try {
  fs.mkdirSync(rot)
  git(rot, 'init', '-q', '-b', 'main')
  skriv(path.join(rot, '.gitignore'), 'dist/\nnode_modules/\n.tua-sync.json\n')
  skriv(path.join(app, 'node_modules', 'vite', 'bin', 'vite.js'), STUB)
  skriv(path.join(app, 'src', 'app.js'), 'v0')
  skriv(path.join(rot, 'annet.txt'), 'x')
  git(rot, 'add', '.'); git(rot, 'commit', '-qm', 'start')
  const inst = spawnSync(process.execPath, [path.join(HERE, 'sync-tua.js'), '--install-hook'], { cwd: rot, encoding: 'utf8', env })
  assert.match(inst.stdout, /post-commit-hook installert/); assert.match(inst.stdout, /post-merge-hook installert/)
  assert.equal(bygg(), 0, 'installasjonen bygger ingenting')

  // 1. Commit på main som endrer appen → ny dist med stempel
  commit(rot, 'tua2-sandbox/src/app.js', 'v1')
  await vent(() => stempel() === tre(), 'dist etter commit på main')
  assert.equal(innhold(), 'v1'); assert.equal(bygg(), 1)
  await vent(lasBorte, 'låsen slippes')
  console.log('ok: commit på main bygger')

  // 2. Commit på main utenfor appen → ikke noe bygg
  commit(rot, 'annet.txt', 'y')
  await sov(600)
  assert.equal(bygg(), 1, 'commit utenfor appen skal ikke bygge')
  console.log('ok: commit utenfor appen bygger ikke')

  // 3. Commit i en worktree → hovedutsjekken er urørt
  git(rot, 'worktree', 'add', '-q', '-b', 'gren', wt)
  commit(wt, 'tua2-sandbox/src/app.js', 'v2')
  await sov(600)
  assert.equal(bygg(), 1, 'worktree skal ikke bygge'); assert.equal(innhold(), 'v1')
  assert.ok(!fs.existsSync(path.join(wt, 'tua2-sandbox', 'dist')), 'worktree skal ikke få dist')
  console.log('ok: commit i worktree bygger ikke')

  // 4. Fast-forward-fletting til main (post-commit går ikke) → bygges
  git(rot, 'merge', '-q', '--ff-only', 'gren')
  await vent(() => stempel() === tre(), 'dist etter fletting')
  assert.equal(innhold(), 'v2'); assert.equal(bygg(), 2)
  await vent(lasBorte, 'låsen slippes')
  console.log('ok: fletting til main bygger')

  // 5. Commiten venter ikke på bygget, og en commit underveis fanges av samme bygg
  commit(rot, 'tua2-sandbox/src/app.js', 'v3 TREG')
  assert.notEqual(stempel(), tre(), 'commiten skal være ferdig før bygget')
  commit(rot, 'tua2-sandbox/src/app.js', 'v4')
  await vent(() => stempel() === tre(), 'siste commit bygget')
  assert.equal(innhold(), 'v4')
  await vent(lasBorte, 'låsen slippes')
  console.log('ok: commiten venter ikke, og siste commit vinner')

  // 6. Feilet bygg → gammel dist står, lapp til neste økt, commiten gikk gjennom
  const forFeil = bygg()
  fs.rmSync(lapp, { force: true })
  commit(rot, 'tua2-sandbox/src/app.js', 'v5 FEIL')
  await vent(() => bygg() > forFeil && lasBorte(), 'feilet bygg ferdig')
  await vent(() => fs.existsSync(lapp), 'lapp etter feilet bygg')
  assert.equal(innhold(), 'v4', 'gammel dist skal stå'); assert.notEqual(stempel(), tre())
  assert.match(fs.readFileSync(lapp, 'utf8'), /appen ble ikke bygget/)
  console.log('ok: feilet bygg lar dist stå og legger lapp')

  // 7. Neste commit på main prøver igjen
  skriv(path.join(app, 'src', 'app.js'), 'v6'); git(rot, 'add', '.'); git(rot, 'commit', '-qm', 'rettet')
  await vent(() => stempel() === tre() && innhold() === 'v6', 'bygg etter retting')
  console.log('ok: neste commit bygger igjen')

  console.log('test-appvakt: alt ok')
} finally {
  await vent(lasBorte, 'låsen slippes til slutt').catch(() => {})
  fs.rmSync(scratch, { recursive: true, force: true })
}
