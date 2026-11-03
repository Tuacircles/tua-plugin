// innlesing.js — fra fil til sak (M16, skive 7 i arbeidsstykke 31). Lese (lesere.js) → sak i lageret med L = hele teksten, S og M skrevet
// av standardmodellen lokalt (motor.js skrivNivåer: Ollama → regler; Claude bare på forespørsel, og da gjennom motoren med Utlevert).
//
//   lesInn(fil, {prosjekt, samtale, …}) → sak      én fil → én sak (kind: capture). Nøkkelen er fil-innholdets sha256, så samme fil lest inn igjen
//                                                   i samme prosjekt gir samme sak (ny versjon om teksten er endret), ikke en kopi. Originalfila blir
//                                                   der den lå: saken får en file-lenke (peker), ingen kopi inn i arkivet (V9: mappa er sannheten).
//   lesInnInnboks({prosjekt, dryRun})               løse dokumenter i <arkiv>/Innboks/ → saker (standard prosjekt «Innboks» til Erik flytter fila i Finder,
//                                                   V9); dokumentet flyttes til Innboks/Ferdig som eksportene. Dry-run lister tallene uten å skrive.
//   innboksDokumenter()                             hva som ligger og venter (PDF, tekst, md, html, csv, docx, xlsx, pptx, eml) — aldri Tuas egne saker i Innboks, aldri lenkefiler.
//
// Ingenting sendes fra denne fila. Hendelser (på): leser → lest → skriver → ferdig, eller feil — broen (POST /api/les) bærer dem som SSE.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { les, formatAv, FORMATER, LeseFeil, kanLese } from './lesere.js'
import { load, save, upsert, levelOf, LEVELS, INBOX_DIR, FILES_ROOT, filesMode, ensureArchive, noteImport, erTuaSak } from './store.js'
import { skrivNivåer, ord, lagSkjermer, kjentePersoner } from './motor.js'

export const STANDARD_PROSJEKT = 'Innboks'
export { LeseFeil, FORMATER, kanLese, formatAv }

const FERDIG = () => path.join(INBOX_DIR, 'Ferdig')
const stem = (n) => String(n || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
const uniq = (dir, base) => { let p = path.join(dir, base); if (!fs.existsSync(p)) return p; const e = path.extname(base), b = base.slice(0, base.length - e.length); return path.join(dir, `${b} (${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')})${e}`) }

// ── Skive 3 i arbeidsstykke 33 (planen §6 «Tekst inn», 28.10.2026): tekst limt inn, og et utdrag av en sak ──
//   lagreTekst({tekst, prosjekt, samtale, hørerTil})      tekst limt inn i feltet i Arbeid (over LIM_INN_GRENSE tegn, regelen bor i appen/regler.js) blir en sak i samtalens prosjekt:
//                                                          kind capture, tittel «Limt inn 28.10 14:02 — <første ord>», kilde «limt inn», S/M etter regel (ingen modell), hører_til når samtalen hører til et arbeid.
//                                                          Nøkkelen er tekstens sha256, så samme tekst limt inn igjen i samme prosjekt er samme sak. Angre = papirkurven (POST /api/rydd/kast).
//   lagUtdrag({id, tekst, fra, til, prosjekt, …})          merket tekst i en sak («Bruk i samtalen») blir en sak: tittel «Utdrag av <sakens tittel>», kilde «utdrag», bygget_av → saken (L, versjon),
//                                                          og lenke {kind: 'utdrag', id, versjon, fra, til} som sier hvor i saken utdraget står. Nivået i kildelinja er L (hele utdraget).
export const LIM_INN_GRENSE = 800
const datoKlokke = (t) => { const d = new Date(t); const to = (n) => String(n).padStart(2, '0'); return `${to(d.getDate())}.${to(d.getMonth() + 1)} ${to(d.getHours())}:${to(d.getMinutes())}` }
const førsteOrd = (t, n = 6) => String(t || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ')
export async function lagreTekst({ tekst, prosjekt, samtale = '', hørerTil = null, tittel = null, klient = 'app' } = {}) {
  const t = String(tekst || '').replace(/\r\n?/g, '\n').trim()
  if (!t) throw new Error('tekst kreves')
  const proj = String(prosjekt || '').trim() || STANDARD_PROSJEKT
  const nå = Date.now()
  const navn = String(tittel || '').trim() || `Limt inn ${datoKlokke(nå)} — ${førsteOrd(t)}`.slice(0, 90)
  const nøkkel = `tekst:${crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)}`
  const { S, M } = await skrivNivåer(t, { tittel: navn, skriver: 'regel' })
  const atoms = load()
  const finnes = atoms.find((a) => a.key === nøkkel && a.project.toLowerCase() === proj.toLowerCase())
  const { atom, status } = upsert(atoms, { key: nøkkel, kind: 'capture', content: t, name: finnes?.name || navn, project: proj, convo: finnes?.convo || samtale || 'Limt inn', source: 'limt inn', by: 'regel', tags: ['tekst', 'limt-inn'], short: S, medium: M,
    ...(hørerTil && atoms.some((a) => a.id === hørerTil) ? { hørerTil: String(hørerTil) } : {}) })
  save(atoms)
  return sakUt(atom, { status, tegnInn: t.length, klient })
}
export function lagUtdrag({ id, tekst, fra = null, til = null, prosjekt = null, samtale = '', hørerTil = null } = {}) {
  const atoms = load()
  const sak = atoms.find((a) => a.id === String(id || ''))
  if (!sak) throw new Error(`fant ikke sak ${id}`)
  const t = String(tekst || '').replace(/\r\n?/g, '\n').trim()
  if (!t) throw new Error('tekst kreves (den merkede teksten)')
  const L = String(sak.content || '')
  let f = Number.isFinite(Number(fra)) && fra !== null ? Number(fra) : L.indexOf(t)
  let s = Number.isFinite(Number(til)) && til !== null ? Number(til) : (f >= 0 ? f + t.length : -1)
  if (f < 0) { f = null; s = null }
  const proj = String(prosjekt || sak.project || '').trim() || sak.project
  const navn = `Utdrag av ${sak.name}`.slice(0, 90)
  const nøkkel = `utdrag:${sak.id}:${crypto.createHash('sha256').update(t).digest('hex').slice(0, 12)}`
  const S = t.length <= 300 ? t.replace(/\s+/g, ' ') : t.replace(/\s+/g, ' ').slice(0, 299).trimEnd() + '…'
  const { atom, status } = upsert(atoms, { key: nøkkel, kind: 'capture', content: t, name: navn, project: proj, convo: samtale || sak.convo || '', source: 'utdrag', by: 'regel', tags: ['utdrag'], short: S,
    summary: `Utdrag av «${sak.name}» (v${sak.version || 1}${f != null ? `, tegn ${f}–${s}` : ''}).`,
    links: [{ kind: 'utdrag', href: `#sak/${sak.id}`, label: `Utdrag av ${sak.name}`, id: sak.id, versjon: sak.version || 1, ...(f != null ? { fra: f, til: s } : {}) }],
    derivedFrom: [{ id: sak.id, version: sak.version || 1, level: 'L' }], ...(hørerTil && atoms.some((a) => a.id === hørerTil) ? { hørerTil: String(hørerTil) } : sak.hørerTil ? { hørerTil: sak.hørerTil } : {}) })
  save(atoms)
  return sakUt(atom, { status, av: { id: sak.id, name: sak.name, version: sak.version || 1, fra: f, til: s } })
}

// Tittelen på saken: dokumentets egen tittel når leseren fant en (første overskrift i md/html/docx, PDF-metadata), ellers filnavnet uten endelse.
export const tittelFor = (meta) => (meta.tittel && meta.tittel.length <= 120 ? meta.tittel : stem(meta.navn)).slice(0, 90) || 'Uten tittel'
const ordPer = (a) => Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)]))
const tegnPer = (a) => Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length]))
const sakUt = (a, ekstra = {}) => ({ id: a.id, name: a.name, project: a.project, convo: a.convo, kind: a.kind || 'capture', version: a.version || 1, S: a.levels?.S?.text || '', S_av: a.levels?.S?.by || null, M_av: a.levels?.M?.by || null, harM: !!a.levels?.M?.text, ord: ordPer(a), tegn: tegnPer(a), max: 'L', vault: false, source: a.source, links: a.links || [], ...ekstra })

// fil: sti på disk — eller `data` (Buffer) + `navn` for en opplasting (da finnes ingen sti; saken får ingen file-lenke, bare kilden).
// lenke: stien saken skal peke på når fila FLYTTES etter lesing (Innboks → Ferdig). skriver: auto (Ollama → regel) | regel | test | ollama | claude.
export async function lesInn(fil, { navn = null, data = null, prosjekt = STANDARD_PROSJEKT, samtale = '', lenke = null, skriver = undefined, klient = 'app', signal, på = () => {} } = {}) {
  const n = navn || path.basename(String(fil || ''))
  const proj = String(prosjekt || '').trim() || STANDARD_PROSJEKT
  på('leser', { navn: n, format: formatAv(n), label: FORMATER[formatAv(n)]?.label || null })
  const buf = data || fs.readFileSync(fil)
  const { tekst, meta } = await les(fil, { navn: n, data: buf, på: (ev, d) => på(ev, { ...d, navn: n }) })   // side {side, av} underveis (pdf)
  const nøkkel = `fil:${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}`
  const tittel = tittelFor(meta)
  const kilde = `${n} (${meta.label}${meta.sider ? `, ${meta.sider} ${meta.sider === 1 ? 'side' : 'sider'}` : ''})`
  // arb. 35 skive 3: hva reglene finner i fila, så appen kan si det per fil. Ingen læring, ingen sending.
  const funn = (() => { const sk = lagSkjermer(kjentePersoner(load()), { utvidet: true }); sk.skjerm(tittel); sk.skjerm(tekst); return { ...sk.antall } })()
  const ekstraUt = { funn, ...(meta.merknad ? { merknad: meta.merknad } : {}) }
  på('lest', { navn: n, format: meta.format, label: meta.label, sider: meta.sider, ord: meta.ord, tegn: meta.tegn, verktøy: meta.verktøy, tittel })
  // 1) saken først, med S/M etter regler — så den finnes selv om modellen er treg eller svikter
  const atoms = load()
  const { S: rS, M: rM } = (await skrivNivåer(tekst, { tittel, skriver: 'regel' }))
  const href = lenke || (data ? null : path.resolve(fil))
  const finnes = atoms.find((a) => a.key === nøkkel && a.project.toLowerCase() === proj.toLowerCase())   // samme fil igjen: samtalen den ble til i beholdes (ellers ville ny samtale gitt falsk ny versjon)
  const { atom, status } = upsert(atoms, {
    key: nøkkel, kind: 'capture', content: tekst, name: tittel, project: proj, convo: finnes?.convo || samtale || 'Innlest fra fil', source: kilde, by: 'regel',
    tags: ['fil', meta.format, 'se-over'], short: rS, medium: rM, links: href ? [{ kind: 'file', href, label: n }] : [],
  })
  save(atoms)
  // 2) S og M fra standardmodellen lokalt (eller regler når ingen finnes) — merket med hvem som skrev (V10). Samme nøkkel → samme sak, bare nivåene byttes.
  const sm = await skrivNivåer(tekst, { tittel, sak: { id: atom.id, name: atom.name, version: atom.version || 1 }, prosjekt: proj, klient, skriver, signal, på })
  if (sm.av !== 'regel') {
    const alle = load()
    const r2 = upsert(alle, { key: nøkkel, kind: 'capture', content: tekst, name: tittel, project: proj, convo: atom.convo, source: kilde, by: sm.av, tags: atom.tags, short: sm.S, medium: sm.M, links: atom.links })
    if (sm.M && sm.M_av === 'regel' && r2.atom.levels?.M) r2.atom.levels.M.by = 'regel'
    if (r2.status !== 'uendret') save(alle)
    const ut = sakUt(r2.atom, { ...ekstraUt, status, format: meta.format, label: meta.label, sider: meta.sider, verktøy: meta.verktøy, skriver: { av: sm.av, modell: sm.modell, tokens: sm.tokens, utlevert: sm.utlevert, ...(sm.grunn ? { grunn: sm.grunn } : {}) } })
    på('ferdig', ut); return ut
  }
  const ut = sakUt(atom, { ...ekstraUt, status, format: meta.format, label: meta.label, sider: meta.sider, verktøy: meta.verktøy, skriver: { av: 'regel', modell: null, tokens: null, utlevert: false, ...(sm.grunn ? { grunn: sm.grunn } : {}) } })
  på('ferdig', ut); return ut
}

// ── Innboks ─────────────────────────────────────────────────────────────────
// Løse dokumenter i <arkiv>/Innboks/: filer med et format leserne tar, som ikke er Tuas egne saker (en sak skrevet til prosjekt «Innboks» ligger i samme
// mappe til den flyttes i Finder), ikke lenkefiler (.txt/.md med en delt claude.ai-lenke — de tas av import.js), ikke «(feilet)»-merkede.
const SHARE = /https?:\/\/claude\.ai\/share\//i
const erLenkefil = (p) => { try { return /\.(txt|md)$/i.test(p) && fs.statSync(p).size < 1e6 && SHARE.test(fs.readFileSync(p, 'utf8')) } catch { return false } }
export function innboksDokumenter() {
  if (!filesMode() || !INBOX_DIR) return []
  let navn = []
  try { navn = fs.readdirSync(INBOX_DIR) } catch { return [] }
  return navn.filter((n) => !n.startsWith('.') && !/ \(feilet\)\./i.test(n) && kanLese(n)).map((n) => path.join(INBOX_DIR, n))
    .filter((p) => { try { return fs.statSync(p).isFile() && !erTuaSak(p) && !erLenkefil(p) } catch { return false } })
    .sort((a, b) => a.localeCompare(b, 'no'))
    .map((p) => { const st = fs.statSync(p); const f = formatAv(p); return { sti: p, navn: path.basename(p), format: f, label: FORMATER[f].label, bytes: st.size, mtime: st.mtimeMs } })
}
export const ferdigAntall = () => { try { return fs.readdirSync(FERDIG()).filter((n) => !n.startsWith('.')).length } catch { return 0 } }

// Én gjennomgang: hvert dokument → sak i `prosjekt` (standard «Innboks»), så flyttes fila til Innboks/Ferdig og saken peker dit. Feiler lesingen
// (ingen tekstlag, passord …), får fila « (feilet)» i navnet så den ikke prøves igjen — og rapporten sier hvorfor. Dry-run: bare tallene.
export async function lesInnInnboks({ prosjekt = STANDARD_PROSJEKT, dryRun = false, skriver = undefined, klient = 'app', log = () => {}, på = () => {}, signal } = {}) {
  if (ensureArchive().needsChoice) return { dryRun, filer: [], tall: { filer: 0, lest: 0, feilet: 0 }, report: 'Arkivet er ikke valgt ennå (tua_setup).' }
  const proj = String(prosjekt || '').trim() || STANDARD_PROSJEKT
  const filer = innboksDokumenter()
  const tall = { filer: filer.length, lest: 0, feilet: 0 }
  const linjer = []
  const ut = []
  på('start', { antall: filer.length, prosjekt: proj, dryRun })
  log(`Innboks: ${filer.length} dokument${filer.length === 1 ? '' : 'er'} å lese inn${dryRun ? ' · DRY-RUN' : ''} → prosjekt «${proj}»`)
  for (const f of filer) {
    if (dryRun) { ut.push({ ...f, dryRun: true }); linjer.push(`- ○ ${f.navn} — ${f.label}, ${Math.round(f.bytes / 1024)} kB`); continue }
    const dest = uniq(FERDIG(), f.navn)
    try {
      const sak = await lesInn(f.sti, { navn: f.navn, prosjekt: proj, samtale: 'Innboks', lenke: dest, skriver, klient, signal, på: (ev, d) => på(ev, { ...d, fil: f.navn }) })
      fs.mkdirSync(FERDIG(), { recursive: true }); fs.renameSync(f.sti, dest)
      tall.lest++
      ut.push({ ...f, id: sak.id, name: sak.name, project: sak.project, S_av: sak.S_av, sider: sak.sider, ord: sak.ord, status: sak.status, flyttetTil: path.relative(FILES_ROOT, dest) })
      linjer.push(`- ✓ ${f.navn} → «${sak.name}» i ${sak.project} (${f.label}${sak.sider ? `, ${sak.sider} sider` : ''}, ${sak.ord.L.toLocaleString('no-NO')} ord; ingress av ${sak.S_av || 'regel'}) — flyttet til Innboks/Ferdig`)
      log(`Innboks: ${f.navn} → «${sak.name}» (${sak.id}, ${sak.status}) · S av ${sak.S_av}`)
    } catch (e) {
      tall.feilet++
      const grunn = e?.message || String(e)
      ut.push({ ...f, feil: grunn, kode: e?.kode || 'feil' })
      linjer.push(`- ✗ ${f.navn} — ${grunn}`)
      log(`Innboks: ⚠ ${f.navn}: ${grunn}`)
      try { const e2 = path.extname(f.navn); fs.renameSync(f.sti, uniq(INBOX_DIR, `${f.navn.slice(0, f.navn.length - e2.length)} (feilet)${e2}`)) } catch {}
      på('feil', { fil: f.navn, feil: grunn, kode: e?.kode || 'feil' })
    }
  }
  if (!dryRun && (tall.lest || tall.feilet)) noteImport('dokumenter', { filer: tall.filer, lest: tall.lest, feilet: tall.feilet, prosjekt: proj })
  const report = [`# Innboks: dokumenter${dryRun ? ' (dry-run, ingenting skrevet)' : ''}`, '',
    `${filer.length} dokument${filer.length === 1 ? '' : 'er'} i ${INBOX_DIR}${dryRun ? '' : ` · ${tall.lest} lest inn som saker i «${proj}» · ${tall.feilet} feilet`} · ${new Date().toLocaleString('no-NO')}`, '',
    ...(linjer.length ? linjer : ['(ingen dokumenter å lese inn — legg en PDF, .txt, .md, .html, .csv, .docx, .xlsx, .pptx eller .eml i Innboks)']), '',
    dryRun ? 'Kjør igjen uten dry-run for å lese inn. Hver fil leses lokalt, får ingress (S) og sammendrag (M) fra den lokale modellen når den kjører (ellers etter regler), og flyttes til Innboks/Ferdig.' : 'Sakene ligger i prosjektmappa — flytt .md-fila i Finder for å legge saken i et annet prosjekt (V9).'].join('\n')
  på('slutt', { ...tall, prosjekt: proj })
  return { dryRun, prosjekt: proj, filer: ut, tall, report }
}
