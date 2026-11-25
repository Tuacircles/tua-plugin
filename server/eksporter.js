// eksporter.js — eksporter leses der de lander (arbeidsstykke 36 del 2, grep 3 · 0.5.19, 26.11.2026).
//
// Før: bestille eksporten, vente på e-post, laste ned, finne Tua/Innboks, flytte fila dit — fem håndgrep.
// Nå:  bestill, last ned, ferdig. Tua kjenner igjen eksporter fra Claude, ChatGPT, Google (Gemini) og Microsoft (Copilot) i Nedlastinger
//      og leser dem der. Fila blir liggende urørt; Tua flytter og sletter ingenting i Nedlastinger.
//
//   NEDLASTINGER()          mappa som sjekkes (~/Downloads; TUA_NEDLASTINGER overstyrer i tester)
//   kjennIgjen(sti)         → { slag: claude|chatgpt|gemini|copilot, hvorfor } eller null. Zip-filer kjennes igjen på innholdslista
//                             (ingenting pakkes ut), mapper (Safari pakker ut selv) på filene i dem, csv/json på starten av fila.
//   finnEksporter()         alt i Nedlastinger som er en eksport, med «lest» fra .tua/nedlastinger.json
//   lesNedlastinger()       leser de som ikke er lest (samme importExport som Innboks). Claude-prosjektene først, så samtalene får prosjektnavn.
//   watchNedlastinger()     ser etter nye filer (20 s etter siste endring) og kaller `ved` når det ligger en ulest eksport der
//   eksportVeiviser()       den korte veiviseren: lenke rett til de fire bestillingssidene, og hva som skjer etterpå
//
// Hver fil sjekkes én gang (sti + størrelse + endret-tid huskes), så Nedlastinger gås ikke gjennom på nytt hver runde. Styres av samme
// bryter som resten av den automatiske lesingen (historikk.js autoHistorikk). Bare lokal lesing; ingen nettverk.

import fs from 'node:fs'
import path from 'node:path'
import { FILES_ROOT, filesMode, ensureArchive } from './store.js'
import { HOME } from './platform.js'
import { importExport, findRoot, detect } from './import.js'
import { finnGemini, erGeminiJson, erCopilotCsv } from './lesere-ai.js'
import { zipEntries } from './unzip.js'

export const NEDLASTINGER = () => process.env.TUA_NEDLASTINGER || path.join(HOME, 'Downloads')
const MAKS_ZIP = 6e9                                    // større enn dette åpnes ikke
const UFERDIG = /\.(crdownload|download|part|partial|tmp)$/i
const NAVN = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini (Google Takeout)', copilot: 'Copilot' }

const TILSTAND = () => path.join(FILES_ROOT, '.tua', 'nedlastinger.json')
const les = () => { try { return JSON.parse(fs.readFileSync(TILSTAND(), 'utf8')) } catch { return {} } }
const skriv = (t) => { fs.mkdirSync(path.dirname(TILSTAND()), { recursive: true }); fs.writeFileSync(TILSTAND(), JSON.stringify(t, null, 2) + '\n') }
const merke = (st) => `${st.size}:${Math.round(st.mtimeMs)}`

export function kjennIgjen(sti) {
  let st
  try { st = fs.statSync(sti) } catch { return null }
  const navn = path.basename(sti)
  if (navn.startsWith('.') || UFERDIG.test(navn)) return null
  if (st.isDirectory()) {
    // Safari pakker ut zip-filer selv: en mappe «Takeout», eller en mappe med conversations.json rett i seg
    if (/^takeout/i.test(navn)) return finnGemini(sti) ? { slag: 'gemini', hvorfor: 'Takeout-mappe med Gemini-aktivitet' } : null
    const direkte = ['conversations.json', 'projects.json'].some((f) => fs.existsSync(path.join(sti, f)))
    if (!direkte) return null
    const k = detect(sti)
    return k ? { slag: k, hvorfor: 'utpakket eksportmappe' } : null
  }
  if (!st.isFile()) return null
  if (/\.csv$/i.test(navn)) return erCopilotCsv(sti) ? { slag: 'copilot', hvorfor: 'CSV med kolonnene Type og Content' } : null
  if (/\.json$/i.test(navn)) return erGeminiJson(sti) ? { slag: 'gemini', hvorfor: 'aktivitetsfil fra Google' } : null
  if (!/\.zip$/i.test(navn) || st.size > MAKS_ZIP) return null
  // Claudes kategori-zip har faste navn; alt annet kjennes igjen på innholdslista
  if (/^(conversations|projects|memories|design_chats)-\d+.*\.zip$/i.test(navn)) return { slag: 'claude', hvorfor: 'Claude-eksportens filnavn' }
  const inn = zipEntries(sti)
  if (!inn.length) return null
  const base = inn.map((e) => e.replace(/\\/g, '/'))
  const har = (re) => base.some((e) => re.test(e))
  if (har(/(^|\/)conversations\.json$/i) && har(/(^|\/)(chat\.html|message_feedback\.json|user\.json)$/i)) return { slag: 'chatgpt', hvorfor: 'conversations.json sammen med chat.html / user.json' }
  if (har(/(^|\/)conversations\.json$/i) && har(/(^|\/)(projects|users|memories)\.json$/i)) return { slag: 'claude', hvorfor: 'conversations.json sammen med projects.json / users.json' }
  if (/^takeout-/i.test(navn) || har(/^Takeout\//)) {
    if (har(/gemini|bard/i) && har(/\.json$/i)) return { slag: 'gemini', hvorfor: 'Takeout med Gemini-aktivitet som JSON' }
    if (har(/gemini|bard/i)) return { slag: 'gemini', hvorfor: 'Takeout med Gemini-aktivitet, men som HTML', uleselig: 'Eksporten er bestilt som HTML. Bestill på nytt og velg JSON under «Min aktivitet» › «Flere formater».' }
  }
  return null
}

// Alt i Nedlastinger (bare toppnivået) som er en eksport. Sjekken huskes per fil, så en zip åpnes én gang.
export function finnEksporter({ mappe = NEDLASTINGER() } = {}) {
  if (!filesMode()) return []
  let navn = []
  try { navn = fs.readdirSync(mappe) } catch { return [] }
  const t = les(); t.sjekket ||= {}; t.lest ||= {}
  let endret = false
  const ut = []
  const sett = new Set()
  for (const n of navn) {
    const sti = path.join(mappe, n)
    let st
    try { st = fs.statSync(sti) } catch { continue }
    if (Date.now() - st.mtimeMs < 8000) continue                                 // skrives kanskje ennå — tas neste gang
    sett.add(sti)
    const m = merke(st)
    let s = t.sjekket[sti]
    if (!s || s.merke !== m) { const k = kjennIgjen(sti); s = { merke: m, ...(k || { slag: null }) }; t.sjekket[sti] = s; endret = true }
    if (!s.slag) continue
    const l = t.lest[sti]
    ut.push({ sti, navn: n, slag: s.slag, kilde: NAVN[s.slag], hvorfor: s.hvorfor || '', uleselig: s.uleselig || '', bytes: st.size, mtime: st.mtimeMs, lest: l && l.merke === m ? l : null })
  }
  for (const k of Object.keys(t.sjekket)) if (k.startsWith(mappe + path.sep) && !sett.has(k)) { delete t.sjekket[k]; endret = true }   // fila er borte
  if (endret) { try { skriv(t) } catch {} }
  // Claudes prosjekter først (samtalene får prosjektnavn), ellers eldste først
  return ut.sort((a, b) => (/^projects-/i.test(b.navn) ? 1 : 0) - (/^projects-/i.test(a.navn) ? 1 : 0) || a.mtime - b.mtime)
}
export const ulesteEksporter = (o) => finnEksporter(o).filter((e) => !e.lest && !e.uleselig)

export function lesNedlastinger({ dryRun = false, log = () => {}, mappe = NEDLASTINGER(), alle = false } = {}) {
  if (ensureArchive().needsChoice || !filesMode()) return { funnet: [], lest: [], report: 'Arkivet er ikke valgt ennå (tua_setup).' }
  const funnet = finnEksporter({ mappe })
  const skal = funnet.filter((e) => (alle || !e.lest) && !e.uleselig)
  const søsken = funnet.filter((e) => /^projects-\d+.*\.zip$/i.test(e.navn)).map((e) => e.sti)
  const lest = [], linjer = []
  for (const e of skal) {
    try {
      const r = importExport(e.sti, { dryRun, log, via: 'Nedlastinger', søsken })
      lest.push({ ...e, stats: r.stats, report: r.report })
      linjer.push(`- ${dryRun ? '○' : '✓'} ${e.navn} — ${e.kilde}: ${r.count ?? 0} samtaler i fila${dryRun ? '' : ` · ${r.stats?.nye || 0} nye · ${r.stats?.oppdatert || 0} oppdatert`}`)
      if (!dryRun) { const t = les(); t.lest ||= {}; t.lest[e.sti] = { merke: merke(fs.statSync(e.sti)), at: Date.now(), slag: e.slag, nye: r.stats?.nye || 0, oppdatert: r.stats?.oppdatert || 0 }; skriv(t) }
    } catch (err) {
      log(`Nedlastinger: ${e.navn}: ${err.message}`)
      linjer.push(`- ✗ ${e.navn} — ${e.kilde}: ${err.message}`)
      if (!dryRun) { const t = les(); t.lest ||= {}; t.lest[e.sti] = { merke: merke(fs.statSync(e.sti)), at: Date.now(), slag: e.slag, feil: err.message }; skriv(t) }   // prøves ikke igjen før fila endres
    }
  }
  for (const e of funnet.filter((x) => x.uleselig)) linjer.push(`- ✗ ${e.navn} — ${e.kilde}: ${e.uleselig}`)
  const alt = funnet.filter((e) => e.lest && !skal.includes(e))
  const report = [
    `# Eksporter i Nedlastinger`, '',
    `${mappe} · ${funnet.length} ${funnet.length === 1 ? 'eksport' : 'eksporter'} kjent igjen${dryRun ? ' · **dry-run, ingenting skrevet**' : ''}`, '',
    ...linjer,
    ...(alt.length ? [`- Lest før: ${alt.map((e) => e.navn).join(', ')}`] : []),
    ...(funnet.length ? ['', 'Filene ligger urørt i Nedlastinger; Tua flytter og sletter ingenting der. Du kan slette dem selv når du vil.'] : []),
  ].join('\n')
  return { funnet, lest, report, nye: lest.reduce((n, e) => n + (e.stats?.nye || 0), 0) }
}

// Ser etter nye filer i Nedlastinger. `ved(uleste)` kalles når det ligger minst én ulest eksport der.
let vakt = null
export function watchNedlastinger({ log = () => {}, ved = () => {}, mappe = NEDLASTINGER(), ventMs = 20000, på = () => true } = {}) {
  if (vakt || ensureArchive().needsChoice) return () => {}
  let timer = null
  const sjekk = () => { try { if (!på()) return; const u = ulesteEksporter({ mappe }); if (u.length) { log(`Nedlastinger: ${u.length} ${u.length === 1 ? 'eksport' : 'eksporter'} å lese (${u.map((e) => `${e.navn} — ${e.kilde}`).join(', ')})`); ved(u) } } catch (e) { log(`Nedlastinger: ${e.message}`) } }
  let w = null
  try { w = fs.watch(mappe, { persistent: false }, () => { clearTimeout(timer); timer = setTimeout(sjekk, ventMs); timer.unref?.() }) } catch {}
  vakt = () => { clearTimeout(timer); w?.close(); vakt = null }
  return vakt
}

// ── veiviseren ──────────────────────────────────────────────────────────────
export const BESTILL = [
  { slag: 'claude', navn: 'Claude', url: 'https://claude.ai/settings/data-privacy-controls', slik: 'Trykk «Export data». Lenka kommer på e-post og varer i 24 timer. Last ned alle filene i e-posten.' },
  { slag: 'chatgpt', navn: 'ChatGPT', url: 'https://chatgpt.com/#settings/DataControls', slik: 'Trykk «Export data» og bekreft. Lenka kommer på e-post og varer i 24 timer.' },
  { slag: 'gemini', navn: 'Gemini', url: 'https://takeout.google.com/', slik: 'Trykk «Fjern alle merker», kryss av bare «Min aktivitet», åpne «Alle aktivitetsdata er inkludert» og velg bare «Gemini-apper». Under «Flere formater» velger du JSON (ikke HTML). Lenka kommer på e-post og varer i 7 dager.' },
  { slag: 'copilot', navn: 'Copilot', url: 'https://account.microsoft.com/privacy', slik: 'Finn Copilot og velg «Export all activity history». Fila lastes ned med en gang. Lange svar er avkortet av Microsoft.' },
]
export function eksportVeiviser({ mappe = NEDLASTINGER(), auto = true } = {}) {
  return [
    '# Ta med samtalene fra nettleser og mobil', '',
    'Samtaler som bare finnes hos leverandøren, kommer inn via en eksport. Du bestiller, laster ned, og er ferdig:', '',
    ...BESTILL.map((b, i) => `${i + 1}. **${b.navn}:** ${b.url}\n   ${b.slik}`), '',
    auto
      ? `La fila ligge i ${mappe}. Tua kjenner den igjen og leser den der, vanligvis innen et halvt minutt. Fila blir liggende urørt.`
      : `Automatisk lesing er slått av. Når fila ligger i ${mappe}, si «les eksporten» (tua_import kilde=eksport).`,
    'Ingenting sendes noe sted; alt leses på denne maskinen.',
  ].join('\n')
}
