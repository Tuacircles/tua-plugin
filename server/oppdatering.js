// oppdatering.js — varsel om ny utgave ved oppstart (0.5.21, 26.11.2026 — Eriks ja: «bygg varselet om ny utgave ved oppstart»).
//
// Hvorfor: en plugin fra GitHub oppdateres ikke av seg selv (auto-oppdatering er av for tredjeparts markedsplasser), og en .mcpb som er
// installert for hånd oppdateres aldri. Uten et varsel blir folk stående på gamle utgaver uten å vite det.
//
// Dette er det ENESTE Tua henter fra nettet uten at brukeren ber om det. Derfor er det gjort så smått som mulig:
//   - én GET til https://api.github.com/repos/tuacircles/tua-plugin/releases/latest, høyst én gang i døgnet per maskin
//   - ingen innlogging, ingen cookies, ingen opplysninger om brukeren eller arkivet; User-Agent er bare «tua-plugin» (ikke engang versjonen)
//   - GitHub ser det enhver nettside ser: IP-adressen og tidspunktet
//   - én bryter: tua_setup(oppdateringsvarsel=false) (oppdatering.varsel i ~/.tua/config.json) · TUA_OPPDATERING=0/1 overstyrer
//   - aldri i tester: et arkiv i en midlertidig mappe sjekker ikke, uten TUA_OPPDATERING=1
// Tua laster ALDRI ned eller installerer noe selv. Varselet er én linje med hva brukeren selv kan gjøre.
//
//   varselPå() / settVarsel(b)      bryteren
//   sjekkOppdatering({versjon})     hent siste utgave (strupet), lagre i ~/.tua/oppdatering.json
//   watchOppdatering({versjon})     ved start (etter 8 s) og hvert døgn
//   oppdateringsLinje({versjon})    linja til Claude — én gang per ny utgave (delt mellom serveren og SessionStart-hooken)
//   installasjon()                  hvordan Tua er installert her: plugin (med markedsplassens navn), mcpb eller kildekode

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FILES_ROOT, filesMode, readConfig, writeConfig } from './store.js'
import { HOME, insideTmp, posix } from './platform.js'

const URL_SISTE = () => process.env.TUA_OPPDATERING_URL || 'https://api.github.com/repos/tuacircles/tua-plugin/releases/latest'
const DØGN = 24 * 60 * 60 * 1000
const FIL = () => path.join(HOME, '.tua', 'oppdatering.json')
export const oppdateringTilstand = () => { try { return JSON.parse(fs.readFileSync(FIL(), 'utf8')) } catch { return {} } }
const skriv = (patch) => { const n = { ...oppdateringTilstand(), ...patch }; fs.mkdirSync(path.dirname(FIL()), { recursive: true }); fs.writeFileSync(FIL(), JSON.stringify(n, null, 2) + '\n'); return n }

export function varselPå() {
  const e = String(process.env.TUA_OPPDATERING || '')
  if (e === '0') return false
  if (readConfig().oppdatering?.varsel === false) return false
  if (e !== '1' && (!FILES_ROOT || insideTmp(FILES_ROOT))) return false       // ikke før arkivet er valgt, og aldri i et testarkiv
  return true
}
export function settVarsel(på) { writeConfig({ oppdatering: { ...(readConfig().oppdatering || {}), varsel: !!på, endret: new Date().toISOString() } }); return !!på }

// «0.5.21» / «v0.5.21» → [0,5,21]; alt annet → null
const tall = (v) => { const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : null }
export const nyere = (a, b) => { const x = tall(a), y = tall(b); if (!x || !y) return false; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false }

export function installasjon(her = process.argv[1] || fileURLToPath(import.meta.url)) {
  const p = posix(her)
  const m = p.match(/\/plugins\/cache\/([^/]+)\/([^/]+)\//)
  if (m) return { slag: 'plugin', markedsplass: m[1], navn: m[2] }
  if (/Claude Extensions|\/extensions\//i.test(p)) return { slag: 'mcpb' }
  return { slag: 'kilde' }
}

export async function sjekkOppdatering({ versjon, tving = false, log = () => {} } = {}) {
  if (!tving && !varselPå()) return { hoppet: 'slått av' }
  const t = oppdateringTilstand()
  if (!tving && t.sjekket && Date.now() - t.sjekket < DØGN) return { hoppet: 'sjekket nylig', siste: t.siste || null }
  try {
    const r = await fetch(URL_SISTE(), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tua-plugin' }, signal: AbortSignal.timeout(5000), redirect: 'follow' })
    if (!r.ok) { skriv({ sjekket: Date.now(), feil: `HTTP ${r.status}` }); return { feil: `HTTP ${r.status}` } }
    const j = await r.json()
    const siste = String(j.tag_name || '').replace(/^v/, '')
    if (!tall(siste)) { skriv({ sjekket: Date.now(), feil: 'ukjent svar' }); return { feil: 'ukjent svar' } }
    const mcpb = (j.assets || []).find((a) => /\.mcpb$/i.test(a.name || ''))?.browser_download_url || ''
    skriv({ sjekket: Date.now(), siste, side: String(j.html_url || ''), mcpb, feil: null })
    if (nyere(siste, versjon)) log(`Ny utgave av Tua er ute: ${siste} (denne er ${versjon})`)
    return { siste, ny: nyere(siste, versjon) }
  } catch (e) { skriv({ sjekket: Date.now(), feil: String(e?.message || e) }); return { feil: String(e?.message || e) } }   // uten nett: prøv igjen i morgen, ingen støy
}
let vakt = null
export function watchOppdatering({ versjon, log = () => {}, delayMs = 8000 } = {}) {
  if (vakt || !filesMode()) return () => {}
  const run = () => { sjekkOppdatering({ versjon, log }).catch(() => {}) }
  const first = setTimeout(run, delayMs), timer = setInterval(run, DØGN)
  first.unref?.(); timer.unref?.()
  vakt = () => { clearTimeout(first); clearInterval(timer); vakt = null }
  return vakt
}

// Linja til Claude. Bygger på det som sist ble hentet (ingen nettverk her). Én gang per ny utgave; `merk: false` bare ser.
export function oppdateringsLinje({ versjon, merk = true, inst = installasjon() } = {}) {
  let t
  try { if (!varselPå()) return ''; t = oppdateringTilstand() } catch { return '' }
  if (!t.siste || !nyere(t.siste, versjon) || t.varslet === t.siste) return ''
  if (merk) skriv({ varslet: t.siste, varsletAt: Date.now() })
  const slik = inst.slag === 'plugin'
    ? `Oppdater slik: skriv /plugin, velg Installed › ${inst.navn} › Update now (eller i terminalen: claude plugin update ${inst.navn}@${inst.markedsplass}), og start Claude på nytt. Vil brukeren slippe dette neste gang: /plugin › Marketplaces › ${inst.markedsplass} › slå på auto-update.`
    : inst.slag === 'mcpb'
      ? `Oppdater slik: last ned den nye fila${t.mcpb ? ` (${t.mcpb})` : ''} og åpne den i Claude Desktop (Innstillinger › Utvidelser). En utvidelse som er installert for hånd oppdateres ikke av seg selv.`
      : `Utgaven ligger her: ${t.side || 'https://github.com/tuacircles/tua-plugin/releases/latest'}.`
  return `En ny utgave av Tua er ute: ${t.siste} (denne maskinen har ${versjon}). Si det til brukeren i én setning, én gang, etter at du har svart på det brukeren ba om. ${slik} Hva som er nytt: ${t.side || 'https://github.com/tuacircles/tua-plugin/releases/latest'}. Tua installerer ingenting selv. Varselet slås av med tua_setup(oppdateringsvarsel=false).`
}
