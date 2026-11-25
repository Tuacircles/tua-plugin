// lesere-ai.js — lesere for eksporter fra Gemini og Copilot (arbeidsstykke 36 del 2, grep 4 · 0.5.19, 26.11.2026).
//
// Utredet i arbeidsstykke 23 (§ andre kilder), ikke bygget før nå. Begge formatene er skrevet etter beskrivelser — INGEN av dem er
// prøvd mot en ekte eksport ennå (Erik har verken Takeout- eller Copilot-fil liggende). Leserne er derfor romslige: de godtar flere
// former og sier i rapporten hva de ikke kjente igjen, i stedet for å gjette.
//
//   Gemini   Google Takeout › «Min aktivitet» › bare «Gemini-apper», format JSON. Fila (MyActivity.json / MinAktivitet.json) er en liste
//            med én rad per spørsmål: { header, title: «Prompted <spørsmålet>», time, products: ['Gemini Apps'], safeHtmlItem: [{ html: <svaret> }] }.
//            Det finnes ingen samtale-id — radene grupperes på tid (ny samtale etter 30 minutters stillhet). En annen form er også sett
//            omtalt: { conversations: [{ id, title, createdTime, lastModifiedTime, messages: [{ role: user|model, text }] }] } — den leses også.
//            Standardformatet i Takeout er HTML; den leses ikke. Zip-en har da ingen json, og Tua sier «velg JSON».
//   Copilot  account.microsoft.com/privacy › Copilot › «Export all activity history»: CSV med Date, Time, Type (Prompt/Response), Content, Source.
//            Ingen samtale-id (grupperes på tid), og lange svar er avkortet av Microsoft — det sier rapporten.
//
// Ingen nettverk, ingen skriving. Returnerer samme form som parseChatGPT i import.js, så importParsed gjør resten (samtale, prompter, svar).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { nyttPar } from './samtaletekst.js'

const sha8 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8)
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const tittelAv = (t) => { const f = flat(t); return f.length > 80 ? f.slice(0, 77).replace(/\s+\S*$/, '') + '…' : f || 'Uten tittel' }
const PAUSE_MS = 30 * 60 * 1000          // ny samtale etter så lang stillhet (ingen av eksportene har samtale-id)
const tid = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; const t = Date.parse(v); return Number.isNaN(t) ? null : t }

const ENTITET = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const htmlTilTekst = (html) => String(html || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|tr|pre|blockquote)>/gi, '\n\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '').replace(/<\/(ul|ol)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITET[n.toLowerCase()] ?? m)
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

// meldinger [{role: 'user'|'assistant', text, t}] → samtaler, delt på stillhet
function tilSamtaler(meldinger, { kilde, navn, idPrefiks, href = '' }) {
  const grupper = []
  let forrige = null
  for (const m of meldinger) {
    if (!m.text.trim()) continue
    const ny = !grupper.length || (m.role === 'user' && m.t && forrige && m.t - forrige > PAUSE_MS)
    if (ny) grupper.push([])
    grupper.at(-1).push(m)
    if (m.t) forrige = m.t
  }
  return grupper.filter((g) => g.some((m) => m.role === 'user')).map((g) => {
    const første = g.find((m) => m.role === 'user')
    const tider = g.map((m) => m.t).filter(Boolean)
    const pairs = []
    for (const m of g) { if (m.role === 'user') pairs.push(nyttPar(m.text.trim(), m.t)); else pairs.at(-1)?.answers.push(m.text.trim()) }
    return {
      id: `${idPrefiks}:${sha8(`${første.t || ''}|${første.text}`)}`, title: tittelAv(første.text), created: tider[0] || null, updated: tider.at(-1) || tider[0] || null,
      project: null, projectUuid: null, source: kilde, href, summary: '', firstUser: første.text,
      transcript: g.map((m) => `**${m.role === 'user' ? 'Bruker' : navn}:** ${m.text.trim()}`).join('\n\n'),
      messages: g.length, artifacts: [], attachments: [], pairs,
    }
  })
}

// ── Gemini (Google Takeout) ─────────────────────────────────────────────────
const GEMINI_RE = /gemini|bard/i
const SPURTE = /^(prompted|said|asked|you said|you asked|spurte|du sa|du skrev|du spurte|sa)[:\s ]+/i
const erAktivitet = (r) => r && typeof r === 'object' && typeof r.title === 'string' && r.time && (GEMINI_RE.test(r.header || '') || (Array.isArray(r.products) && r.products.some((p) => GEMINI_RE.test(p))))
const samtaleListe = (j) => (Array.isArray(j?.conversations) ? j.conversations : Array.isArray(j) && j[0] && Array.isArray(j[0].messages) ? j : null)
const lesJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''))
// Er denne json-fila en Gemini-eksport? Leser bare starten når fila er stor.
export function erGeminiJson(p) {
  try {
    if (!/\.json$/i.test(p)) return false
    const st = fs.statSync(p)
    if (!st.isFile() || st.size > 400e6 || st.size < 20) return false
    const fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(Math.min(st.size, 20000)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd)
    const hode = buf.toString('utf8')
    if (/"header"\s*:/.test(hode) && /"title"\s*:/.test(hode) && /"time"\s*:/.test(hode) && GEMINI_RE.test(hode)) return true
    return /"conversations"\s*:/.test(hode) && /"messages"\s*:/.test(hode) && /"role"\s*:\s*"model"/.test(hode)
  } catch { return false }
}
// Finn Gemini-fila i en utpakket Takeout (mappenavnene er oversatt: «My Activity/Gemini Apps», «Min aktivitet/Gemini-apper» …)
export function finnGemini(dir, dybde = 0) {
  try {
    if (fs.statSync(dir).isFile()) return erGeminiJson(dir) ? dir : null
    const inn = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'))
    for (const e of inn) if (e.isFile() && erGeminiJson(path.join(dir, e.name))) return path.join(dir, e.name)
    if (dybde < 5) for (const e of inn) if (e.isDirectory()) { const r = finnGemini(path.join(dir, e.name), dybde + 1); if (r) return r }
  } catch {}
  return null
}
export function parseGemini(fil) {
  const j = lesJson(fil)
  const liste = samtaleListe(j)
  let convs = [], rader = 0, ukjente = 0, form = ''
  if (liste) {
    form = 'samtaler med meldinger'
    for (const c of liste) {
      const m = (c.messages || []).map((x) => ({ role: /^(user|human)$/i.test(x.role || x.author || '') ? 'user' : 'assistant', text: String(x.text ?? x.content ?? ''), t: tid(x.createdTime || x.time || x.timestamp) }))
      rader += m.length
      const [s] = tilSamtaler(m.map((x) => ({ ...x, t: null })), { kilde: 'Gemini', navn: 'Gemini', idPrefiks: 'gemini' })
      if (!s) continue
      const id = c.id || c.conversationId
      convs.push({ ...s, id: id ? `gemini:${id}` : s.id, title: flat(c.title) || s.title, created: tid(c.createdTime) || m.find((x) => x.t)?.t || null, updated: tid(c.lastModifiedTime) || tid(c.createdTime) || null })
    }
  } else if (Array.isArray(j)) {
    form = 'Min aktivitet (én rad per spørsmål)'
    const mine = j.filter(erAktivitet).map((r) => ({ r, t: tid(r.time) })).sort((a, b) => (a.t || 0) - (b.t || 0))
    const meldinger = []
    for (const { r, t } of mine) {
      const svar = (r.safeHtmlItem || []).map((s) => htmlTilTekst(s?.html)).filter(Boolean).join('\n\n')
      const kjent = SPURTE.test(r.title)
      if (!kjent && !svar) { ukjente++; continue }                             // «Used Gemini Apps», tilbakemeldinger o.l. — ikke et spørsmål
      rader++
      meldinger.push({ role: 'user', text: r.title.replace(SPURTE, '').trim(), t })
      if (svar) meldinger.push({ role: 'assistant', text: svar, t })
    }
    convs = tilSamtaler(meldinger, { kilde: 'Gemini', navn: 'Gemini', idPrefiks: 'gemini', href: 'https://gemini.google.com/app' })
  } else throw new Error(`${path.basename(fil)}: kjenner ikke igjen formen (verken en liste med aktivitet eller «conversations»)`)
  return {
    kind: 'gemini', convs, docs: [], projects: [], format: { felter: [form], prosjektkobling: null, prosjekterIFila: 0 },
    merknader: [
      `- **Gemini (Google Takeout):** ${path.basename(fil)} · form: ${form} · ${rader} ${liste ? 'meldinger' : 'spørsmål'} → ${convs.length} samtaler${liste ? '' : ' (gruppert på tid, ny samtale etter 30 minutters stillhet — eksporten har ingen samtale-id)'}${ukjente ? ` · ${ukjente} rader som ikke var spørsmål hoppet over` : ''}`,
      '- Bare det som er skrevet på gemini.google.com er med; sidepanelet i Gmail og Docs er ikke i eksporten. Leseren er skrevet etter beskrivelser av formatet og er ikke prøvd mot mange ekte eksporter — si fra om noe ser galt ut.',
    ],
  }
}

// ── Copilot (CSV fra Microsofts personvernside) ─────────────────────────────
// Liten CSV-leser (RFC 4180: anførselstegn, doble anførselstegn, linjeskift inne i felt). Skilletegn: det som finnes flest av i første linje.
export function lesCsv(tekst) {
  const t = String(tekst || '').replace(/^﻿/, '')
  const hode = t.slice(0, t.search(/\r?\n/) < 0 ? t.length : t.search(/\r?\n/))
  const skille = [',', ';', '\t'].map((c) => [c, hode.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rader = []; let rad = [], felt = '', iAnf = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (iAnf) { if (c === '"') { if (t[i + 1] === '"') { felt += '"'; i++ } else iAnf = false } else felt += c }
    else if (c === '"') iAnf = true
    else if (c === skille) { rad.push(felt); felt = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; rad.push(felt); felt = ''; if (rad.some((x) => x !== '')) rader.push(rad); rad = [] }
    else felt += c
  }
  rad.push(felt); if (rad.some((x) => x !== '')) rader.push(rad)
  return rader
}
const KOL = { dato: /^(date|dato|created( at)?|timestamp|date ?time|tidspunkt)$/i, tid: /^(time|tid|klokkeslett)$/i, type: /^(type|author|role|sender|avsender|rolle)$/i, innhold: /^(content|message|text|innhold|melding|tekst)$/i, kilde: /^(source|kilde|app|product)$/i }
const kolonner = (hode) => Object.fromEntries(Object.entries(KOL).map(([k, re]) => [k, hode.findIndex((h) => re.test(flat(h)))]))
const BRUKER = /^(prompt|user|human|you|bruker|deg|spørsmål)/i, MODELL = /^(response|copilot|ai|bot|assistant|bing|svar)/i
export function erCopilotCsv(p) {
  try {
    if (!/\.csv$/i.test(p)) return false
    const st = fs.statSync(p)
    if (!st.isFile() || st.size > 200e6 || st.size < 20) return false
    const fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(Math.min(st.size, 60000)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd)
    const rader = lesCsv(buf.toString('utf8')).slice(0, 12)
    if (rader.length < 2) return false
    const k = kolonner(rader[0])
    if (k.type < 0 || k.innhold < 0) return false
    const typer = rader.slice(1, -1).concat(rader.length === 2 ? [rader[1]] : []).map((r) => flat(r[k.type]))
    const rolleKjent = typer.length > 0 && typer.every((t) => BRUKER.test(t) || MODELL.test(t))
    return rolleKjent && (/copilot/i.test(path.basename(p)) || /copilot|bing/i.test(buf.toString('utf8')) || typer.some((t) => /^prompt$/i.test(t)))
  } catch { return false }
}
// «03.11.2026 14:05», «11/3/2026 2:05 PM», «2026-11-03T14:05:00Z» → ms. Tvetydig a/b/åååå leses som måned/dag (Microsofts engelske eksport) når ikke dagen er over 12.
const datoTid = (d, kl) => {
  const s = flat(`${d || ''} ${kl || ''}`)
  if (!s) return null
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ ,T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm)?)?/i)
  if (m) {
    let [, a, b, år, t = '0', min = '0', sek = '0', ap] = m
    const punktum = /^\d{1,2}\./.test(s)
    let dag = Number(punktum || Number(a) > 12 ? a : b), mnd = Number(punktum || Number(a) > 12 ? b : a), time = Number(t)
    if (ap) { if (/pm/i.test(ap) && time < 12) time += 12; if (/am/i.test(ap) && time === 12) time = 0 }
    const ms = new Date(Number(år), mnd - 1, dag, time, Number(min), Number(sek)).getTime()
    return Number.isNaN(ms) ? null : ms
  }
  return tid(s)
}
export function parseCopilotCsv(fil) {
  const rader = lesCsv(fs.readFileSync(fil, 'utf8'))
  if (rader.length < 2) throw new Error(`${path.basename(fil)}: ingen rader`)
  const k = kolonner(rader[0])
  if (k.type < 0 || k.innhold < 0) throw new Error(`${path.basename(fil)}: fant ikke kolonnene Type og Content (har: ${rader[0].map(flat).join(', ')})`)
  let meldinger = rader.slice(1).map((r) => ({ role: BRUKER.test(flat(r[k.type])) ? 'user' : 'assistant', text: String(r[k.innhold] || ''), t: datoTid(k.dato >= 0 ? r[k.dato] : '', k.tid >= 0 ? r[k.tid] : '') })).filter((m) => m.text.trim())
  const medTid = meldinger.filter((m) => m.t).length
  if (medTid === meldinger.length) meldinger = meldinger.map((m, i) => ({ ...m, i })).sort((a, b) => a.t - b.t || (a.role === b.role ? a.i - b.i : a.role === 'user' ? -1 : 1))
  else if (meldinger.length > 1 && meldinger[0].role !== 'user' && meldinger.at(-1).role === 'user') meldinger.reverse()   // nyeste først uten lesbar tid
  const convs = tilSamtaler(meldinger, { kilde: 'Copilot', navn: 'Copilot', idPrefiks: 'copilot', href: 'https://copilot.microsoft.com/' })
  return {
    kind: 'copilot', convs, docs: [], projects: [], format: { felter: rader[0].map(flat), prosjektkobling: null, prosjekterIFila: 0 },
    merknader: [
      `- **Copilot (CSV):** ${path.basename(fil)} · ${meldinger.length} meldinger → ${convs.length} samtaler (gruppert på tid, ny samtale etter 30 minutters stillhet — eksporten har ingen samtale-id)${medTid < meldinger.length ? ` · ${meldinger.length - medTid} rader uten lesbar dato` : ''}`,
      '- Microsoft avkorter lange svar i denne eksporten; det som mangler der, mangler også her. Leseren er skrevet etter beskrivelser av formatet og er ikke prøvd mot mange ekte eksporter — si fra om noe ser galt ut.',
    ],
  }
}
