// keychain.js — API-nøkler for AI-connectors (M15, BYOK — V15/arbeidsstykke 20).
//
// Nøkkelen lagres i macOS Keychain (login-nøkkelringen) som et «generic password»:
//   tjeneste  tua-ai-<leverandør>   konto  tua
// Vi bruker `security` fra Apple, spawnet UTEN shell. Selve nøkkelen går inn på STDIN
// (`security -i` leser kommandoer fra stdin), ikke som argument — da står den aldri i
// prosesslista (ps), aldri i en fil, aldri i en logg. Ut av modulen kommer bare «satt / ikke satt».
// Lesing av nøkkelen (-w) skjer i M20a (readKey): motoren leser den per kall og holder den ikke lenger enn kallet.
// TUA_KEYCHAIN_PREFIX overstyrer tjenestenavnet (bare for tester).

import { spawn, spawnSync } from 'node:child_process'
import { OLLAMA_URL, OLLAMA_VERT, standardModell } from './ollama.js'   // friksjon 12: adressen og standardmodellen bor der

export const PROVIDERS = [
  { id: 'claude', label: 'Claude (Anthropic)', hint: 'console.anthropic.com › API keys' },
  { id: 'openai', label: 'OpenAI (GPT)', hint: 'platform.openai.com › API keys' },
  { id: 'gemini', label: 'Gemini (Google)', hint: 'aistudio.google.com › Get API key' },
  { id: 'mistral', label: 'Mistral', hint: 'console.mistral.ai › API keys' },
  { id: 'ollama', label: 'Ollama (lokal)', hint: `ingen nøkkel — oppdages på ${OLLAMA_VERT}`, local: true },
]
const ACCOUNT = 'tua'
const service = (p) => `${process.env.TUA_KEYCHAIN_PREFIX || 'tua-ai'}-${p}`
export const isProvider = (p) => PROVIDERS.some((x) => x.id === p && !x.local)
const onMac = () => process.platform === 'darwin'

// Finnes nøkkelen? find-generic-password uten -w skriver aldri hemmeligheten ut — bare exit-koden brukes.
export function hasKey(provider) {
  if (!onMac() || !isProvider(provider)) return false
  return spawnSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', service(provider)], { stdio: 'ignore' }).status === 0
}

// Nøkkelformat: tegn uten mellomrom, anførselstegn eller skråstrek bakover, 8–512 tegn. Det dekker Anthropic (sk-ant-…),
// OpenAI (sk-…), Google (AIza…) og Mistral — og holder stdin-kommandoen til `security` entydig.
const KEY_RE = /^[A-Za-z0-9_\-.:+/=]{8,512}$/
export function setKey(provider, key) {
  return new Promise((resolve, reject) => {
    if (!onMac()) return reject(new Error('Keychain finnes bare på macOS'))
    if (!isProvider(provider)) return reject(new Error(`ukjent leverandør «${provider}»`))
    const k = String(key || '').trim()
    if (!KEY_RE.test(k)) return reject(new Error('nøkkelen ser ikke ut som en API-nøkkel (8–512 tegn, uten mellomrom eller anførselstegn)'))
    const p = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve(true) : reject(new Error(`Keychain avviste nøkkelen (security kode ${code})`))))
    // -U: oppdater hvis den finnes fra før. Ett kommandolinje-oppsett, så stdin lukkes.
    p.stdin.end(`add-generic-password -a ${ACCOUNT} -s ${service(provider)} -U -w ${k}\n`)
  })
}

export function deleteKey(provider) {
  if (!onMac() || !isProvider(provider)) return false
  return spawnSync('security', ['delete-generic-password', '-a', ACCOUNT, '-s', service(provider)], { stdio: 'ignore' }).status === 0
}

// M20a: les nøkkelen — BARE for motoren (motor.js), per kall. Returnerer strengen eller null; logges aldri, holdes aldri i en modul-variabel.
// `-w` skriver bare hemmeligheten til stdout; stderr kastes. Resultatet skal glemmes så snart kallet mot modellen er ferdig.
export function readKey(provider) {
  if (!onMac() || !isProvider(provider)) return null
  const r = spawnSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', service(provider), '-w'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
  if (r.status !== 0) return null
  const k = String(r.stdout || '').trim()
  return KEY_RE.test(k) ? k : null
}

// Status for alle leverandører — aldri nøkkelverdier.
export const keyStatus = () => Object.fromEntries(PROVIDERS.filter((p) => !p.local).map((p) => [p.id, hasKey(p.id)]))

// Ollama lokalt: GET /api/tags på OLLAMA_URL (127.0.0.1:11434; TUA_OLLAMA_URL bare i tester). Kort tidsavbrudd; aldri et kall mot en modell (det er M20).
// Friksjon 12: `modell` er standardmodellen motoren vil bruke (valgt i Innstillinger, lagret i config; ellers den første), `kilde` sier hvorfor.
export async function ollamaStatus(timeoutMs = 1500) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(OLLAMA_URL + '/api/tags', { signal: ctl.signal })
    if (!r.ok) return { running: false, models: [], modell: null }
    const j = await r.json()
    const models = (j.models || []).map((m) => m.name).slice(0, 20)
    const std = standardModell(models)
    return { running: true, models, modell: std.modell, kilde: std.kilde }
  } catch { return { running: false, models: [], modell: null } } finally { clearTimeout(t) }
}

// CLI (test): node keychain.js status · node keychain.js slett <leverandør>
if (process.argv[1] && process.argv[1].endsWith('keychain.js')) {
  const [cmd, prov] = process.argv.slice(2)
  if (cmd === 'status') console.log(JSON.stringify({ ...keyStatus(), ollama: await ollamaStatus() }, null, 2))
  else if (cmd === 'slett' && prov) console.log(deleteKey(prov) ? `fjernet ${prov}` : `ingen nøkkel for ${prov}`)
  else console.log('bruk: node keychain.js status | slett <claude|openai|gemini|mistral>')
}
