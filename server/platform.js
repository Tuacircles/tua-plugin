// platform.js — alt som er OS-spesifikt i Tua, samlet på ett sted (M18).
//
// Tua skal kjøre på macOS, Windows og Linux. Dette er de fire tingene som faktisk er forskjellige:
//   1. hvor Claude Desktop har datamappa si (cache, Cowork-økter)
//   2. hvor skytjenestene (iCloud Drive, Dropbox, OneDrive, Google Drive) legger mappene sine
//   3. hvordan man viser en fil i filbehandleren og åpner en adresse (open / explorer / xdg-open)
//   4. hvordan stier ser ut (skråstrek vs. omvendt skråstrek) når de testes mot regulære uttrykk
//
// TUA_PLATFORM=win32|linux|darwin simulerer et annet OS — brukes bare i tester, så fallback-grenene kan
// kjøres på en Mac. Kommandoer kjøres alltid med spawn + argv, aldri gjennom et shell.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const PLATFORM = process.env.TUA_PLATFORM || process.platform
export const IS_MAC = PLATFORM === 'darwin'
export const IS_WIN = PLATFORM === 'win32'
export const HOME = process.env.TUA_HOME || os.homedir()
const env = (k) => process.env[k] || ''
const exists = (p) => { try { return !!p && fs.existsSync(p) } catch { return false } }
const first = (...c) => c.find(exists) || c.find(Boolean) || null
export const firstDir = (dir, prefix) => { try { return fs.readdirSync(dir).filter((n) => n.startsWith(prefix)).map((n) => path.join(dir, n)).find((p) => fs.statSync(p).isDirectory()) || null } catch { return null } }

// Stier i «posix-form» for regex-tester (/\/(node_modules|\.git)\//): omvendt skråstrek → skråstrek. Endrer aldri stien som brukes mot disken.
export const posix = (p) => String(p || '').replace(/\\/g, '/')
export const insideTmp = (p) => { const q = posix(p); return /^\/(private\/)?tmp\//.test(q) || q.startsWith(posix(os.tmpdir()).replace(/\/$/, '') + '/') }

// 1. Claude Desktops datamappe (Electrons userData): cache i Cache/Cache_Data, Cowork-økter i local-agent-mode-sessions
export const CLAUDE_APP_DIR = IS_MAC
  ? path.join(HOME, 'Library', 'Application Support', 'Claude')
  : IS_WIN
    ? path.join(env('APPDATA') || path.join(HOME, 'AppData', 'Roaming'), 'Claude')
    : path.join(env('XDG_CONFIG_HOME') || path.join(HOME, '.config'), 'Claude')

// 2. Skytjenestene slik de ligger på hvert OS. `null` = tjenesten finnes ikke på dette OS-et (iCloud på Linux).
//    Mappa som returneres er den tjenesten synker; arkivet blir <mappe>/Tua. Lokalt (~/Tua) finnes alltid.
export function cloudBases() {
  if (IS_MAC) {
    const CLOUD = path.join(HOME, 'Library', 'CloudStorage')
    const gd = firstDir(CLOUD, 'GoogleDrive-')
    return {
      icloud: path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
      dropbox: first(path.join(HOME, 'Dropbox'), path.join(CLOUD, 'Dropbox')),
      onedrive: firstDir(CLOUD, 'OneDrive') || path.join(HOME, 'OneDrive'),
      googledrive: gd ? path.join(gd, 'My Drive') : path.join(HOME, 'Google Drive', 'My Drive'),
    }
  }
  if (IS_WIN) {
    return {
      icloud: first(path.join(HOME, 'iCloudDrive'), env('iCloudDrive')),
      dropbox: path.join(HOME, 'Dropbox'),
      onedrive: first(env('OneDrive'), env('OneDriveConsumer'), env('OneDriveCommercial'), path.join(HOME, 'OneDrive')),
      googledrive: first(path.join(HOME, 'Google Drive', 'My Drive'), 'G:\\My Drive', path.join(HOME, 'My Drive')),
    }
  }
  return {
    icloud: null,
    dropbox: path.join(HOME, 'Dropbox'),
    onedrive: path.join(HOME, 'OneDrive'),
    googledrive: first(path.join(HOME, 'Google Drive', 'My Drive'), path.join(HOME, 'GoogleDrive', 'My Drive'), path.join(HOME, 'Google Drive')),
  }
}

// 3. «Åpne i …» — vis en fil i filbehandleren, eller åpne en adresse (https://, claude://, claude-cli://) i det programmet
//    OS-et har registrert for den. Fast liste av kommandoer, argv uten shell.
export const FILE_MANAGER = IS_MAC ? 'Finder' : IS_WIN ? 'Utforsker' : 'filbehandleren'
export function openCommand(kind, target) {
  if (kind !== 'reveal' && kind !== 'url') throw new Error(`openCommand: ukjent type «${kind}»`)
  if (IS_MAC) return kind === 'reveal' ? ['open', ['-R', target]] : ['open', [target]]
  if (IS_WIN) return kind === 'reveal' ? ['explorer.exe', [`/select,${target}`]] : ['rundll32.exe', ['url.dll,FileProtocolHandler', target]]
  return ['xdg-open', [kind === 'reveal' ? path.dirname(target) : target]]
}
export const openSpawn = (kind, target, { dryrun = false } = {}) => new Promise((resolve, reject) => {
  const [cmd, args] = openCommand(kind, target)
  const ran = [cmd, ...args]
  if (dryrun) return resolve({ ok: true, ran, dryrun: true })
  let p
  try { p = spawn(cmd, args, { stdio: 'ignore' }) } catch (e) { return reject(e) }
  p.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)))
  // explorer.exe svarer med kode 1 også når alt gikk bra — bare macOS/Linux-kommandoene har meningsfull kode
  p.on('exit', (code) => (code === 0 || cmd === 'explorer.exe' ? resolve({ ok: true, ran }) : reject(new Error(`${cmd} avsluttet med kode ${code}`))))
})

// 4. Hvor en nedlastet fil kom fra. macOS: Spotlight (kMDItemWhereFroms, leses i finder.js med mdls).
//    Windows: NTFS-strømmen «Zone.Identifier» som nettlesere skriver (ZoneId, HostUrl, ReferrerUrl). Linux: ingen standard.
export function zoneIdentifierUrls(file) {
  if (!IS_WIN) return []
  try {
    const t = fs.readFileSync(`${file}:Zone.Identifier`, 'utf8')
    return [...new Set([...t.matchAll(/^(?:HostUrl|ReferrerUrl)=(https?:\/\/\S+)/gim)].map((m) => m[1]))]
  } catch { return [] }
}

export const describe = () => `${PLATFORM}${process.env.TUA_PLATFORM ? ' (simulert)' : ''} · hjem ${HOME} · Claude-data ${CLAUDE_APP_DIR}`
