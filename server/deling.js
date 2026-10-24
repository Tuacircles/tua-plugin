// deling.js — runde 3b (arbeidsstykke 32, planen videre §4 3b; Erik 24.10.2026: «kollegaer først, deretter relasjoner»): første menneskelige mottaker.
//
// Dette er første gang primitiv 2, «mottaker er en fasett» (CLAUDE.md §2.1), finnes i Tua 2.0. Fila holder tre ting, alle i arkivets .tua/ og
// aldri i sakene:
//
//   .tua/mottakere.json   PERSONER {id, navn, epost, merke: kollega|relasjon, opprettet, sist, delinger} — opprettes når de brukes første gang
//                         («del med Anna» → Anna legges til; neste gang finnes hun). SIRKLER EMERGER, konfigureres ikke: når de samme to eller flere
//                         personene får noe sammen for tredje gang, foreslår Tua en sirkel («Anna og Bjarte → en sirkel?»); Erik gir den navn
//                         («Prosjektgruppa») eller sier nei. Mønstrene (hvem som brukes sammen, hvor ofte) ligger i samme fil. `eier` {navn, epost}
//                         er den som deler — står på mottakersiden og er adressen «Be om hele» går til.
//   .tua/delinger.json    DELINGER per token: hvem (person-id-er), nivå, radene slik de ble delt (skjermet tekst per sak på nivået — aldri originaler),
//                         når, trukket tilbake (tidspunkt) og forespørslene («Be om hele»). Tokenet er tilfeldig (128 bit, base64url); lenka er
//                         tua://del/<token> og http://127.0.0.1:5274/del/<token>, som broen serverer som MOTTAKERSIDEN. Trekkes delingen tilbake,
//                         slutter lenka å virke (410) — det logges i Utlevert.
//   mottakerside(…)       MOTTAKERSIDEN som frittstående HTML (Classical i farger og form, Georgia som skrift så fila ikke trenger noe): mottakerens navn,
//                         hvem som delte og når, sakene som LÅSTE RADER på nivået de ble delt (S som standard, V11: tittel + ingress; M/L bare når
//                         Erik valgte det), skjermet (plassholdere, aldri originaler), «Be om hele» som åpner en forhåndsutfylt e-post til den som
//                         delte (mailto) og meldes til broen som forespørsel (logges i Utlevert når broen er nådd — fra en annen maskin går bare
//                         e-posten), og linja om at ingenting er sendt til noen modell. /del/<token>.html er samme side til nedlasting.
//
// Motoren (motor.js del()) er den eneste som lager delinger: lese → klippe (Vault → S) → skjerme → minimere → lagre → logge. Denne fila er lageret
// og gjengivelsen; den leser aldri en sak selv. Ingen server i skyen ennå (M21/fase 1): alt virker lokalt og på samme nett, og HTML-fila er veien når
// mottakeren ikke er det. Identitet (avklaring 7) er åpen: mottakeren er navn + e-post, uten innlogging.
// Tester: server/test-deling.mjs (mot testarkiv i scratch, aldri ~/Dropbox/Tua).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { FILES_ROOT, filesMode, DATA_DIR, readConfig } from './store.js'

const TUA = () => (filesMode() ? path.join(FILES_ROOT, '.tua') : DATA_DIR)
const MOTTAKERE = () => path.join(TUA(), 'mottakere.json')
const DELINGER = () => path.join(TUA(), 'delinger.json')
const lesJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const skrivJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }) }
const kort = (pre) => pre + crypto.randomBytes(4).toString('hex')
export const nyttToken = () => crypto.randomBytes(16).toString('base64url')
export const BASE = () => (process.env.TUA_APP_URL || 'http://127.0.0.1:5274').replace(/\/$/, '')
export const MERKER = ['kollega', 'relasjon']
export const SIRKEL_TERSKEL = 3   // tredje gang samme personer får noe sammen → forslag

// ── Personer og sirkler ─────────────────────────────────────────────────────
const tom = () => ({ personer: [], sirkler: [], mønstre: {}, eier: null })
export function lesMottakere() { const m = lesJson(MOTTAKERE(), null) || tom(); return { ...tom(), ...m, personer: Array.isArray(m.personer) ? m.personer : [], sirkler: Array.isArray(m.sirkler) ? m.sirkler : [], mønstre: m.mønstre && typeof m.mønstre === 'object' ? m.mønstre : {} } }
export function skrivMottakere(m) { skrivJson(MOTTAKERE(), { ...m, oppdatert: new Date().toISOString() }) }
const norm = (s) => String(s || '').trim().toLowerCase()
export const erEpost = (s) => /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(String(s || '').trim())
// «Anna <anna@firma.no>» · «anna@firma.no» · «Anna» → { navn, epost }
export function tolkMottaker(tekst) {
  const t = String(tekst || '').trim()
  const m = t.match(/^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/)
  if (m) return { navn: m[1].trim() || m[2].split('@')[0], epost: m[2].trim().toLowerCase() }
  if (erEpost(t)) return { navn: t.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), epost: t.toLowerCase() }
  return { navn: t, epost: null }
}
export const finnPerson = (m, tekst) => {
  const { navn, epost } = tolkMottaker(tekst)
  return m.personer.find((p) => (epost && norm(p.epost) === epost) || (p.id === tekst)) || m.personer.find((p) => norm(p.navn) === norm(navn)) || null
}
export const finnSirkel = (m, tekst) => m.sirkler.find((s) => s.navn && !s.foreslått && (norm(s.navn) === norm(tekst) || s.id === tekst)) || null
// Løs «til» (streng eller liste av navn/e-post/sirkelnavn) til personer — nye opprettes (merke kollega som standard, Erik 24.10: kollegaer først).
// Returnerer { personer: [{...person, ny}], sirkler: [navn] , m } — kalleren skriver med skrivMottakere når delingen faktisk lages.
export function løsMottakere(til, { merke = 'kollega', opprett = true } = {}) {
  const m = lesMottakere()
  const liste = (Array.isArray(til) ? til : [til]).flatMap((t) => String(t || '').split(/\s*(?:,|;| og )\s*/)).map((t) => t.trim()).filter(Boolean)   // «Anna, Bjarte» og «Anna og Bjarte» er to — også inne i en liste
  const ut = [], sirkler = [], sett = new Set()
  const legg = (p, ny = false) => { if (!sett.has(p.id)) { sett.add(p.id); ut.push({ ...p, ny }) } }
  for (const t of liste) {
    const s = finnSirkel(m, t)
    if (s) { sirkler.push(s.navn); for (const p of s.medlemmer.map((id) => m.personer.find((x) => x.id === id)).filter(Boolean).sort((x, y) => x.navn.localeCompare(y.navn, 'no'))) legg(p); continue }   // medlemmene alfabetisk — stabil rekkefølge i setningen
    let p = finnPerson(m, t)
    if (!p) {
      if (!opprett) { ut.push({ id: null, ...tolkMottaker(t), merke, ny: true }); continue }
      const { navn, epost } = tolkMottaker(t)
      p = { id: kort('p_'), navn, epost, merke: MERKER.includes(merke) ? merke : 'kollega', opprettet: Date.now(), sist: null, delinger: 0 }
      m.personer.push(p); legg(p, true)
    } else { if (!p.epost && erEpost(t)) p.epost = t.toLowerCase(); legg(p) }
  }
  return { personer: ut, sirkler, m }
}
// Etter en deling: tell per person, og mønsteret for personene som fikk noe sammen. Tredje gang → sirkelforslag (om ingen sirkel med samme medlemmer finnes).
export function registrerDeling(m, personIder, når = Date.now()) {
  for (const id of personIder) { const p = m.personer.find((x) => x.id === id); if (p) { p.sist = når; p.delinger = (p.delinger || 0) + 1 } }
  let forslag = null
  if (personIder.length >= 2) {
    const nøkkel = [...personIder].sort().join('+')
    const mø = m.mønstre[nøkkel] || { antall: 0, sist: null }
    mø.antall++; mø.sist = når; m.mønstre[nøkkel] = mø
    const finnes = m.sirkler.find((s) => [...s.medlemmer].sort().join('+') === nøkkel)
    if (mø.antall >= SIRKEL_TERSKEL && !finnes) {
      const navn = personIder.map((id) => m.personer.find((x) => x.id === id)?.navn || id)
      forslag = { id: kort('c_'), navn: null, forslag: navn.length === 2 ? `${navn[0]} og ${navn[1]}` : `${navn.slice(0, -1).join(', ')} og ${navn.at(-1)}`, medlemmer: [...personIder].sort(), foreslått: true, antall: mø.antall, opprettet: når }
      m.sirkler.push(forslag)
    } else if (finnes?.foreslått) { finnes.antall = mø.antall; forslag = finnes }
  }
  return forslag
}
export function navngiSirkel(id, navn) {
  const m = lesMottakere(); const s = m.sirkler.find((x) => x.id === id)
  if (!s) throw new Error(`fant ikke sirkel ${id}`)
  const n = String(navn || '').trim(); if (!n) throw new Error('sirkelen trenger et navn')
  s.navn = n; s.foreslått = false; s.navngitt = Date.now(); skrivMottakere(m); return s
}
export function avvisSirkel(id) {
  const m = lesMottakere(); const s = m.sirkler.find((x) => x.id === id)
  if (!s) throw new Error(`fant ikke sirkel ${id}`)
  m.sirkler = m.sirkler.filter((x) => x.id !== id)
  const nøkkel = [...s.medlemmer].sort().join('+'); if (m.mønstre[nøkkel]) m.mønstre[nøkkel].avvist = Date.now()   // foreslås ikke igjen før tre nye
  if (m.mønstre[nøkkel]) m.mønstre[nøkkel].antall = 0
  skrivMottakere(m); return true
}
export function oppdaterPerson(id, { navn, epost, merke } = {}) {
  const m = lesMottakere(); const p = m.personer.find((x) => x.id === id)
  if (!p) throw new Error(`fant ikke person ${id}`)
  if (navn != null && String(navn).trim()) p.navn = String(navn).trim()
  if (epost != null) p.epost = String(epost).trim() ? String(epost).trim().toLowerCase() : null
  if (merke && MERKER.includes(merke)) p.merke = merke
  skrivMottakere(m); return p
}
export function nyPerson({ navn, epost, merke = 'kollega' }) {
  const { personer, m } = løsMottakere([epost && navn ? `${navn} <${epost}>` : navn || epost], { merke })
  skrivMottakere(m); return personer[0]
}
// Den som deler: .tua/mottakere.json `eier`, ellers ~/.tua/config.json `eier` (tua_setup kan sette den senere), ellers bare «den som delte».
export function eier() { const m = lesMottakere(); const c = readConfig().eier; const e = m.eier || (c && typeof c === 'object' ? c : null); return { navn: String(e?.navn || '').trim(), epost: String(e?.epost || '').trim().toLowerCase() } }
export function settEier({ navn, epost } = {}) { const m = lesMottakere(); m.eier = { navn: String(navn || '').trim(), epost: String(epost || '').trim().toLowerCase() }; skrivMottakere(m); return m.eier }

// ── Delinger (token → det som ble delt) ─────────────────────────────────────
export function lesDelinger() { const d = lesJson(DELINGER(), {}); return d && typeof d === 'object' ? d : {} }
export function skrivDelinger(d) { skrivJson(DELINGER(), d) }
export function lagreDeling(deling) { const d = lesDelinger(); d[deling.token] = deling; skrivDelinger(d); return deling }
export const hentDeling = (token) => lesDelinger()[String(token || '')] || null
export const delingerFor = (sakId) => Object.values(lesDelinger()).filter((d) => !sakId || d.sak === sakId || (d.rader || []).some((r) => r.id === sakId)).sort((a, b) => (b.opprettet || 0) - (a.opprettet || 0))
export function trekkTilbake(token, når = Date.now()) {
  const d = lesDelinger(); const x = d[token]
  if (!x) throw new Error('fant ikke delingen')
  if (!x.trukket) { x.trukket = når; skrivDelinger(d) }
  return x
}
export function noterForespørsel(token, { saker = [], når = Date.now() } = {}) {
  const d = lesDelinger(); const x = d[token]
  if (!x) throw new Error('fant ikke delingen')
  x.forespørsler = [...(x.forespørsler || []), { at: når, saker: saker.filter((id) => (x.rader || []).some((r) => r.id === id)) }]
  skrivDelinger(d); return x.forespørsler.at(-1)
}
export const lenkerFor = (token, base) => { const b = String(base || BASE()).replace(/\/$/, ""); return { tua: `tua://del/${token}`, http: `${b}/del/${token}`, html: `${b}/del/${token}.html` } }

// ── Mottakersiden ───────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const NIVÅ_ORD = { S: 'ingressen', M: 'sammendraget', L: 'hele saken' }
export const fmtNår = (ts) => new Date(ts).toLocaleString('no-NO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
// En liten markdown → HTML for det skjermede innholdet (overskrifter, lister, fete, avsnitt). Alt er escapet først; ingen rå HTML slipper gjennom.
export function mdTilHtml(md) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>')
  const ut = []; let liste = null, avsnitt = []
  const flush = () => { if (avsnitt.length) { ut.push(`<p>${inline(avsnitt.join(' '))}</p>`); avsnitt = [] } if (liste) { ut.push(`</${liste}>`); liste = null } }
  for (const rå of String(md || '').split('\n')) {
    const l = rå.trimEnd()
    if (!l.trim()) { flush(); continue }
    const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { flush(); ut.push(`<h${Math.min(6, h[1].length + 1)}>${inline(h[2])}</h${Math.min(6, h[1].length + 1)}>`); continue }
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (li) { if (avsnitt.length) { ut.push(`<p>${inline(avsnitt.join(' '))}</p>`); avsnitt = [] } const slag = /^\s*\d/.test(l) ? 'ol' : 'ul'; if (liste !== slag) { if (liste) ut.push(`</${liste}>`); ut.push(`<${slag}>`); liste = slag } ut.push(`<li>${inline(li[1])}</li>`); continue }
    if (/^\s*\|/.test(l)) { if (/^\s*\|?\s*:?-{2,}/.test(l)) continue; flush(); ut.push(`<p class="rad">${l.split('|').filter((c) => c.trim()).map((c) => inline(c.trim())).join(' · ')}</p>`); continue }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { flush(); ut.push('<hr>'); continue }
    if (liste) { ut.push(`</${liste}>`); liste = null }
    avsnitt.push(l.trim())
  }
  flush(); return ut.join('\n')
}
const CSS = `
:root{--navy:#1F3864;--coral:#C04A38;--ink:#1A1A1A;--grey:#595959;--soft:#8C8C8C;--paper:#F5F3EE;--hair:#BFBFBF;--gull:#b68235}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font:17px/1.55 Georgia,"Iowan Old Style",Palatino,serif}
.side{max-width:680px;margin:0 auto;padding:28px 20px 56px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--coral);margin:0 0 10px}
h1{font-weight:400;font-size:32px;line-height:1.1;letter-spacing:-.01em;margin:0 0 8px;color:var(--navy)}
.delt{margin:0 0 22px;color:var(--grey);font-size:15px}
.linje{border-top:1px solid var(--hair);padding:18px 0 20px}
.linje:last-of-type{border-bottom:1px solid var(--hair)}
.meta{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:12px;color:var(--soft);letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px}
.niva{display:inline-block;border:1px solid var(--gull);color:#7d5411;border-radius:10px;padding:0 8px;font-size:11px;letter-spacing:.08em;line-height:18px}
h2{font-weight:400;font-size:22px;line-height:1.2;margin:0 0 8px;color:var(--navy)}
.tekst{font-size:16px;color:var(--ink)}.tekst p{margin:0 0 .7em}.tekst h2,.tekst h3,.tekst h4{font-size:17px;margin:.9em 0 .3em;color:var(--ink)}
.tekst ul,.tekst ol{padding-left:1.3em;margin:.3em 0 .7em}.tekst code{font:14px ui-monospace,Menlo,monospace;background:var(--paper);padding:0 4px}
.tekst .rad{color:var(--grey);font-size:15px}
.laast{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0 0;padding:10px 14px;background:var(--paper);border-left:2px solid var(--gull);font-size:14px;color:var(--grey)}
.laast svg{flex:none}
.knapp{font:inherit;font-size:14px;color:var(--gull);background:none;border:1px solid var(--gull);border-radius:4px;padding:4px 12px;cursor:pointer;text-decoration:none;display:inline-block;line-height:1.4}
.knapp:hover{background:#fff3e4}
.fot{margin-top:28px;font-size:14px;color:var(--grey)}.fot p{margin:0 0 8px}
.plass{background:var(--paper);padding:0 3px;border-radius:2px;color:var(--grey)}
.borte{border:1px solid var(--hair);padding:18px;color:var(--grey)}
.ok{color:#2f6b3a;font-size:14px}
@media (min-width:700px){.side{padding:48px 24px 72px}h1{font-size:40px}}
@media print{.knapp{display:none}}
`
const LÅS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
const plass = (html) => html.replace(/\[(Person [A-Z]+|E-post \d+|Telefon \d+|Adresse \d+|Beløp \d+|Org\.nr \d+|Fødselsnummer \d+)\]/g, '<span class="plass" title="Opplysning som ikke er delt">[$1]</span>')
// deling: { token, til: [{navn, epost}], nivå, rader: [{id, name, level, tekst, version}], opprettet, av: {navn, epost}, treff, antall, trukket, klient }
export function mottakerside(deling, { base = BASE(), frittstående = false } = {}) {
  const til = (deling.til || []).map((p) => p.navn).filter(Boolean)
  const tilTekst = til.length ? (til.length === 1 ? til[0] : `${til.slice(0, -1).join(', ')} og ${til.at(-1)}`) : 'deg'
  const av = deling.av?.navn || 'den som delte'
  const n = (deling.rader || []).length
  const nivåer = [...new Set((deling.rader || []).map((r) => r.level))].join('/')
  const emne = encodeURIComponent(`Tua: be om hele — ${n === 1 ? deling.rader[0].name : `${n} saker`}`)
  const kropp = (ids) => encodeURIComponent(`Hei ${av},\n\nJeg har fått ${n === 1 ? 'saken' : `${n} saker`} på nivå ${nivåer} fra Tua${ids.length ? ` og vil gjerne ha hele:\n${ids.map((r) => `– ${r.name}`).join('\n')}` : ' og vil gjerne ha hele.'}\n\nDeling: ${deling.token}\n\nVennlig hilsen\n${tilTekst}`)
  const mailto = (rader) => `mailto:${esc(deling.av?.epost || '')}?subject=${emne}&body=${kropp(rader)}`
  const rader = (deling.rader || []).map((r) => `
<section class="linje" data-sak="${esc(r.id)}">
  <p class="meta"><span>Sak${r.version > 1 ? ` · v${r.version}` : ''}</span><span class="niva" title="Nivået du har fått">${esc(r.level)} · ${esc(NIVÅ_ORD[r.level] || r.level)}</span></p>
  <h2>${plass(esc(r.name))}</h2>
  <div class="tekst">${plass(mdTilHtml(r.tekst))}</div>
  ${r.level !== 'L' ? `<p class="laast">${LÅS}<span>Du har fått ${NIVÅ_ORD[r.level]}. Resten av saken er ikke delt.</span><a class="knapp" href="${mailto([r])}" data-be="${esc(r.id)}">Be om hele</a></p>` : `<p class="laast">${LÅS}<span>Hele saken er delt — slik den så ut ${esc(fmtNår(deling.opprettet))}.</span></p>`}
</section>`).join('\n')
  const skjermet = deling.treff ? `${deling.treff} ${deling.treff === 1 ? 'opplysning er' : 'opplysninger er'} skjermet` : 'ingen opplysninger å skjerme'
  const be = `${base}/del/${encodeURIComponent(deling.token)}/be-om-hele`
  const js = `<script>
(function(){var base=${JSON.stringify(be)};document.querySelectorAll('[data-be]').forEach(function(a){a.addEventListener('click',function(){var id=a.getAttribute('data-be');
try{fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({saker:[id]}),keepalive:true}).then(function(r){if(r.ok){var s=document.createElement('span');s.className='ok';s.textContent='Forespørselen er notert hos '+${JSON.stringify(av)}+'.';a.after(s)}}).catch(function(){})}catch(e){}})})})();
</script>`
  return `<!doctype html>
<html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Til ${esc(tilTekst)} — delt fra Tua</title><style>${CSS}</style></head>
<body><main class="side">
<p class="eyebrow">Tua · delt med deg</p>
<h1>Til ${esc(tilTekst)}</h1>
<p class="delt">Delt av <b>${esc(av)}</b> ${esc(fmtNår(deling.opprettet))} · ${n} ${n === 1 ? 'sak' : 'saker'} på ${esc(nivåer)} · ${esc(skjermet)}${frittstående ? ' · lagret som fil' : ''}</p>
${rader}
<footer class="fot">
<p>Ingenting her er sendt til noen modell. Plassholdere som <span class="plass">[Person A]</span> står for opplysninger som ikke er delt; ${esc(av)} har originalene.</p>
<p>Lenka: <code>${esc(`${base}/del/${deling.token}`)}</code>${frittstående ? ' (virker på samme nett som den som delte)' : ''}. Den som delte kan trekke delingen tilbake; da virker ikke lenka lenger. Du kan laste siden ned som én fil: <a href="${esc(`${base}/del/${deling.token}.html`)}">${esc(`del/${deling.token.slice(0, 8)}….html`)}</a>.</p>
</footer>
</main>${js}</body></html>`
}
export const trukketSide = (deling) => `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delingen er trukket tilbake — Tua</title><style>${CSS}</style></head>
<body><main class="side"><p class="eyebrow">Tua</p><h1>Delingen er trukket tilbake</h1><p class="borte">${deling ? `${esc(deling.av?.navn || 'Den som delte')} trakk delingen tilbake ${esc(fmtNår(deling.trukket))}. Innholdet vises ikke lenger her.` : 'Denne lenka finnes ikke, eller delingen er trukket tilbake.'}</p></main></body></html>`
