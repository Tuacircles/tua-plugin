#!/usr/bin/env node
// appvakt.js — holder tua2-sandbox/dist i takt med main (Erik 02.11.2026): broen serverer den ferdigbygde mappa, og dist er
// gitignorert, så bb507cb og 734c303 nådde ham ikke — dist var fra 29.10 og «ingenting hadde endret seg».
//
//   node server/appvakt.js   → fra post-commit og post-merge (en fast-forward-fletting kjører bare post-merge). Står du på main
//                              i hovedutsjekken og dist er bygget av noe annet enn det main har, startes bygget i bakgrunnen.
//                              Ellers stille. I en worktree skjer ingenting: der er ingenting flettet ennå.
//
// Regelen er git-treet til hele tua2-sandbox/ (HEAD:tua2-sandbox), ikke klokkeslett: bygget legger treets hash i dist/.bygd-fra.
// Slik fanges også det hooken ikke så — neste commit på main retter opp — og en commit utenfor appen bygger ingenting.
//
// Bygget stopper aldri commiten (løsrevet prosess, logg i .git/tua-appbygg.log), går til en midlertidig mappe og byttes inn først
// når det lyktes, så appen aldri står tom eller halvbygget. Feiler det, står gammel dist igjen, stempelet er uendret (neste commit
// prøver igjen) og det legges en lapp som neste Claude-økt leser høyt, samme fil som byggvakten bruker.

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const STEMPEL = '.bygd-fra'
const LAS_MAKS_MS = 10 * 60 * 1000   // en lås eldre enn dette er etter et krasj (bygget selv har 5 min tak)

// Hooken arver GIT_DIR og GIT_INDEX_FILE; de skal ikke styre kallene her
const renMiljo = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: renMiljo() }); return r.status === 0 ? r.stdout.trim() : '' }
const appTre = (rot) => git(rot, 'rev-parse', 'HEAD:tua2-sandbox')
const stempel = (rot) => { try { return fs.readFileSync(path.join(rot, 'tua2-sandbox', 'dist', STEMPEL), 'utf8').trim() } catch { return '' } }
const gitDir = (rot) => fs.realpathSync(path.resolve(rot, git(rot, 'rev-parse', '--git-dir')))

// Hovedutsjekken på main: en worktree har egen git-dir under den felles
function erMainIHovedutsjekken(rot) {
  const felles = fs.realpathSync(path.resolve(rot, git(rot, 'rev-parse', '--git-common-dir')))
  return gitDir(rot) === felles && git(rot, 'symbolic-ref', '--short', '-q', 'HEAD') === 'main'
}

async function leggLapp(msg) {
  try {
    const { FILES_ROOT } = await import('./store.js')
    if (!FILES_ROOT) return
    const f = path.join(FILES_ROOT, '.tua', 'helsesjekk-varsel.txt')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.appendFileSync(f, `${new Date().toISOString().slice(0, 10)} (appvakten etter commit): ${msg}\n`)
  } catch {}
}

// Ett bygg av det som nå er sjekket ut; byttes inn bare om det lyktes
function byggEn(rot, tre) {
  const app = path.join(rot, 'tua2-sandbox')
  const vite = path.join(app, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(vite)) return 'fant ikke vite (tua2-sandbox/node_modules mangler — kjør npm install der)'
  const neste = path.join(app, 'node_modules', '.tua-appbygg'), gammel = path.join(app, 'node_modules', '.tua-appbygg-gammel'), dist = path.join(app, 'dist')
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', neste, '--emptyOutDir'], { cwd: app, stdio: 'inherit', env: renMiljo(), timeout: 5 * 60 * 1000 })
  if (r.status !== 0 || !fs.existsSync(path.join(neste, 'index.html'))) return `vite build feilet (kode ${r.status ?? r.signal})`
  fs.writeFileSync(path.join(neste, STEMPEL), tre + '\n')
  fs.rmSync(gammel, { recursive: true, force: true })
  if (fs.existsSync(dist)) fs.renameSync(dist, gammel)
  fs.renameSync(neste, dist)
  fs.rmSync(gammel, { recursive: true, force: true })
  return null
}

async function bygg(rot) {
  const las = path.join(gitDir(rot), 'tua-appbygg.lock')
  try { if (Date.now() - fs.statSync(las).mtimeMs > LAS_MAKS_MS) fs.rmSync(las, { recursive: true, force: true }) } catch {}
  try { fs.mkdirSync(las) } catch { return }   // et bygg går allerede, og det ser etter ny commit når det er ferdig
  try {
    // Treet leses før bygget: kommer en commit underveis, stemmer ikke stempelet, og runden tas om igjen
    for (let i = 0; i < 5; i++) {
      const tre = appTre(rot)
      if (!tre || tre === stempel(rot)) return
      const feil = byggEn(rot, tre)
      if (feil) {
        console.error(feil)
        await leggLapp(`appen ble ikke bygget på nytt: ${feil}. Erik ser fortsatt forrige versjon på 127.0.0.1:5274. Loggen er .git/tua-appbygg.log; neste commit på main prøver igjen, eller kjør \`cd tua2-sandbox && npx vite build\`.`)
        return
      }
    }
  } finally { fs.rmSync(las, { recursive: true, force: true }) }
}

const SCRIPT = fileURLToPath(import.meta.url)
const i = process.argv.indexOf('--bygg')
if (i >= 0) await bygg(process.argv[i + 1])
else {
  const rot = git(process.cwd(), 'rev-parse', '--show-toplevel')
  if (!rot || !fs.existsSync(path.join(rot, 'tua2-sandbox', 'src')) || !erMainIHovedutsjekken(rot)) process.exit(0)
  const tre = appTre(rot)
  if (!tre || tre === stempel(rot)) process.exit(0)
  const logg = fs.openSync(path.join(gitDir(rot), 'tua-appbygg.log'), 'w')
  spawn(process.execPath, [SCRIPT, '--bygg', rot], { detached: true, stdio: ['ignore', logg, logg], cwd: rot, env: renMiljo() }).unref()
  console.error('[tua-appvakt] tua2-sandbox er endret på main — appen bygges i bakgrunnen (logg: .git/tua-appbygg.log).')
}
