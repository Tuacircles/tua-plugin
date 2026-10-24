// ollama.js — modellene i Ollama, sett fra Tua (friksjon 12, bruksdag 1, 24.10.2026).
//
// Erik: «Bør kunne gå inn i Ollama og finne best mulig modell (i innstillinger).» Dette er det ene stedet Tua snakker med Ollama om
// MODELLER (ikke om svar — det er motoren): hvilke som ligger på maskinen, hvilke vi anbefaler for akkurat denne maskinen, hente én
// med fremdrift, fjerne én, og hvilken som er STANDARD — den motoren bruker når Ollama er mottaker, vurderer eller skriver av S/M.
//
// Bare Ollama-serverens HTTP-API brukes (/api/tags, /api/pull strømmet, /api/delete). Aldri appens GUI eller innstillinger
// (hendelsen 23.10 kl. 22:08: appens Claude-knapp skrev om Claude Desktop). TUA_OLLAMA_URL peker et annet sted (bare for tester —
// test-ollama.mjs kjører en falsk Ollama på en annen port). Nedlasting skjer fra ollama.com; det sies i linja i appen.
//
// Standardmodellen lagres i ~/.tua/config.json som { ollama: { modell, valgt } } (store.readConfig/writeConfig — samme fil som
// arkivstedet og onboardingen). Rekkefølgen motoren bruker: TUA_OLLAMA_MODELL (bare tester/overstyring) → config, hvis modellen
// fortsatt ligger lokalt → den første i Ollamas liste. Er den valgte fjernet, faller Tua stille tilbake til den første og sier det i appen.

import os from 'node:os'
import fs from 'node:fs'
import { readConfig, writeConfig } from './store.js'

export const OLLAMA_URL = (process.env.TUA_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
export const OLLAMA_VERT = OLLAMA_URL.replace(/^https?:\/\//, '')

// ── Den kuraterte tabellen ───────────────────────────────────────────────────
// Størrelser er nedlastingen (GB, Ollamas standardkvantisering Q4_K_M), krevMinneGB er det Ollama trenger av minne for å kjøre modellen med
// rom til resten av maskinen (vekter + KV-cache + system). Norsk-evne er Tuas egen vurdering fra bruk og modellkortene: «god» = flytende
// norsk uten engelske innslag i vanlige svar; «ok» = forstår norsk, svarer stort sett på norsk, men glipper i lengre tekster.
// «passerTil» er oppgavene Tua gir en lokal modell: spør (svar i Spør), S/M (ingress og sammendrag av innleste filer), forskjeller
// (enig/uenig/unikt mellom svar), konklusjon (utkast). Skjerming er regler i motoren, ikke en modell — derfor står den ikke her.
export const ANBEFALTE = [
  { navn: 'gemma3:4b', størrelseGB: 3.3, krevMinneGB: 6, norsk: 'god', passerTil: ['spør', 'S/M'], hvorfor: 'Rask og lett — den Tua ble satt opp med. God norsk til korte svar og ingresser; svakere på lange resonnementer og Forskjeller.' },
  { navn: 'gemma3:12b', størrelseGB: 8.1, krevMinneGB: 10, norsk: 'god', passerTil: ['spør', 'S/M', 'forskjeller', 'konklusjon'], hvorfor: 'Merkbart bedre norsk og resonnement enn 4b, fortsatt rask nok på en M1 med 16 GB. Beste valget for en maskin med 16 GB.' },
  { navn: 'gpt-oss:20b', størrelseGB: 14, krevMinneGB: 16, norsk: 'god', passerTil: ['spør', 'forskjeller', 'konklusjon'], hvorfor: 'OpenAIs åpne modell med resonnering — best på Forskjeller og konklusjon. Trenger hele minnet på en 16 GB-maskin; lukk andre tunge programmer.' },
  { navn: 'qwen3:8b', størrelseGB: 5.2, krevMinneGB: 8, norsk: 'ok', passerTil: ['spør', 'forskjeller', 'konklusjon'], hvorfor: 'Sterk på resonnering og struktur (JSON), norsk er greit men ikke flytende. Et godt andrevalg til Forskjeller.' },
  { navn: 'llama3.1:8b', størrelseGB: 4.9, krevMinneGB: 8, norsk: 'ok', passerTil: ['spør', 'S/M'], hvorfor: 'Metas allrounder. Forstår norsk godt, svarer stort sett på norsk; kjent og stabil.' },
  { navn: 'gemma3:27b', størrelseGB: 17, krevMinneGB: 24, norsk: 'god', passerTil: ['spør', 'S/M', 'forskjeller', 'konklusjon'], hvorfor: 'Den beste Gemma-modellen — krever en maskin med 24 GB eller mer. For stor for 16 GB.' },
]

// ── Maskinen ─────────────────────────────────────────────────────────────────
// Minne og chip fra Node (os), ledig plass på disken hjemmemappa ligger på (fs.statfsSync, Node 22) — ingen spawn, ingen shell.
export function maskin() {
  const minneGB = Math.round(os.totalmem() / 1073741824)
  let chip = os.cpus()[0]?.model || ''
  if (process.platform === 'darwin' && /^Apple\s/.test(chip)) chip = chip.replace(/^Apple\s+/, 'Apple ')
  let ledigGB = null
  try { const st = fs.statfsSync(os.homedir()); ledigGB = Math.round(Number(st.bavail) * Number(st.bsize) / 1073741824) } catch {}
  return { minneGB, chip: chip.trim(), ledigGB, arch: os.arch() }
}
// Passer modellen denne maskinen? «ja» når det er rom til resten (krevMinneGB ≤ 3/4 av minnet), «trangt» når det akkurat går (≤ minnet),
// «nei» når minnet er for lite — eller disken ikke har plass til nedlastingen.
export function passer(m, mask) {
  if (mask.ledigGB != null && m.størrelseGB > mask.ledigGB - 2) return { passer: 'nei', hvorforIkke: `trenger ${m.størrelseGB} GB plass på disken — bare ${mask.ledigGB} GB ledig` }
  if (m.krevMinneGB > mask.minneGB) return { passer: 'nei', hvorforIkke: `trenger ${m.krevMinneGB} GB minne — maskinen har ${mask.minneGB} GB` }
  if (m.krevMinneGB > mask.minneGB * 0.75) return { passer: 'trangt', hvorforIkke: `bruker nesten hele minnet (${m.krevMinneGB} av ${mask.minneGB} GB) — lukk andre tunge programmer mens den svarer` }
  return { passer: 'ja', hvorforIkke: null }
}

// ── Ollama-serveren ──────────────────────────────────────────────────────────
const gb = (bytes) => Math.round(Number(bytes || 0) / 1e9 * 10) / 10
async function hentJson(sti, { timeoutMs = 1500, ...init } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs)
  try { const r = await fetch(OLLAMA_URL + sti, { ...init, signal: init.signal || ctl.signal }); return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) } } finally { clearTimeout(t) }
}
// Lokale modeller fra /api/tags: navn, størrelse, parametre, kvantisering, familie. kjører=false når serveren ikke svarer.
export async function lokale(timeoutMs = 1500) {
  try {
    const r = await hentJson('/api/tags', { timeoutMs })
    if (!r.ok) return { kjører: false, lokale: [] }
    return { kjører: true, lokale: (r.json.models || []).map((m) => ({ navn: m.name, størrelseGB: gb(m.size), parametre: m.details?.parameter_size || null, kvantisering: m.details?.quantization_level || null, familie: m.details?.family || null, endret: m.modified_at || null })) }
  } catch { return { kjører: false, lokale: [] } }
}

// Standardmodellen: TUA_OLLAMA_MODELL → config (når den fortsatt ligger lokalt) → første lokale. `valgtFinnes` sier om config-valget ble fulgt.
export const lagretStandard = () => { const c = readConfig().ollama; return c && typeof c === 'object' && c.modell ? String(c.modell) : null }
export function standardModell(navnListe = []) {
  const env = process.env.TUA_OLLAMA_MODELL || null
  if (env) return { modell: env, kilde: 'miljøvariabel', valgtFinnes: true }
  const lagret = lagretStandard()
  if (lagret && navnListe.includes(lagret)) return { modell: lagret, kilde: 'valgt', valgtFinnes: true }
  return { modell: navnListe[0] || null, kilde: navnListe[0] ? 'første' : 'ingen', valgtFinnes: !lagret, lagret }
}
const gyldigNavn = (n) => /^[a-z0-9][a-z0-9._\-\/]{0,80}(:[a-z0-9._\-]{1,40})?$/i.test(String(n || ''))
export function settStandard(navn, navnListe) {
  const n = String(navn || '').trim()
  if (!gyldigNavn(n)) throw new Error(`«${navn}» er ikke et modellnavn (f.eks. gemma3:12b)`)
  if (Array.isArray(navnListe) && !navnListe.includes(n)) throw new Error(`${n} ligger ikke på maskinen — hent den først`)
  writeConfig({ ollama: { ...(readConfig().ollama || {}), modell: n, valgt: new Date().toISOString() } })
  return n
}

// Hele bildet til appen (GET /api/ollama/modeller).
export async function modeller() {
  const mask = maskin()
  const { kjører, lokale: lok } = await lokale()
  const navn = lok.map((m) => m.navn)
  const std = standardModell(navn)
  const anbefalte = ANBEFALTE.map((m) => {
    const p = passer(m, mask)
    const l = lok.find((x) => x.navn === m.navn || x.navn === m.navn.replace(/:latest$/, ''))
    return { ...m, ...p, lokal: !!l, standard: !!l && std.modell === l.navn, anbefalt: false }
  })
  // «Anbefalt for denne maskinen»: den beste som passer helt (ja) med god norsk — lista er ordnet fra lett til tung, så siste «ja» med god norsk vinner.
  const beste = [...anbefalte].reverse().find((m) => m.passer === 'ja' && m.norsk === 'god') || [...anbefalte].reverse().find((m) => m.passer === 'ja')
  if (beste) beste.anbefalt = true
  return {
    kjører, vert: OLLAMA_VERT, maskin: mask,
    lokale: lok.map((m) => ({ ...m, standard: std.modell === m.navn, anbefaling: ANBEFALTE.find((a) => a.navn === m.navn) || null })),
    standard: { ...std, lagret: lagretStandard() },
    anbefalte,
    start: process.platform === 'darwin' ? 'open -a Ollama' : 'ollama serve',
  }
}

// Hent en modell: POST /api/pull strømmet (NDJSON). på(ev, data): fremdrift {status, prosent, mb, mbTotal} … ferdig {navn} | feil {feil}.
// Ollama sender feil både som HTTP-status og som en linje {"error": …} i strømmen — begge fanges. signal avbryter (klienten lukket).
export async function hent(navn, { på = () => {}, signal } = {}) {
  const n = String(navn || '').trim()
  if (!gyldigNavn(n)) throw new Error(`«${navn}» er ikke et modellnavn (f.eks. gemma3:12b)`)
  let r
  try { r = await fetch(OLLAMA_URL + '/api/pull', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: n, name: n, stream: true }) }) }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'avbrutt' : `Ollama svarer ikke på ${OLLAMA_VERT} (${e.message})`) }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Ollama svarte ${r.status}`) }
  const dec = new TextDecoder(); let rest = '', sist = null, ferdig = false
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true })
    const linjer = rest.split('\n'); rest = linjer.pop()
    for (const l of linjer) {
      if (!l.trim()) continue
      let j; try { j = JSON.parse(l) } catch { continue }
      if (j.error) throw new Error(String(j.error))
      const total = Number(j.total || 0), completed = Number(j.completed || 0)
      const d = { status: String(j.status || ''), prosent: total ? Math.min(100, Math.round(completed / total * 100)) : null, mb: total ? Math.round(completed / 1048576) : null, mbTotal: total ? Math.round(total / 1048576) : null }
      if (d.status === 'success') { ferdig = true; continue }
      // samme prosent to ganger på rad er støy — bare endringer går ut
      const nøkkel = `${d.status}|${d.prosent}`; if (nøkkel === sist) continue; sist = nøkkel
      på('fremdrift', d)
    }
  }
  if (!ferdig) throw new Error('Ollama avsluttet hentingen uten å si at den ble ferdig')
  return n
}

// Fjern en modell: DELETE /api/delete {model}. Var den standard, slettes valget i config, så Tua faller tilbake til den første.
export async function fjern(navn) {
  const n = String(navn || '').trim()
  if (!gyldigNavn(n)) throw new Error(`«${navn}» er ikke et modellnavn`)
  const r = await hentJson('/api/delete', { method: 'DELETE', timeoutMs: 15000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: n, name: n }) })
  if (!r.ok) throw new Error(r.json.error || (r.status === 404 ? `${n} ligger ikke på maskinen` : `Ollama svarte ${r.status}`))
  const c = readConfig().ollama
  const varStandard = c && c.modell === n
  if (varStandard) writeConfig({ ollama: { ...c, modell: null, fjernet: new Date().toISOString() } })
  return { navn: n, varStandard }
}
