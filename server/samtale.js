// samtale.js — skive 1 «Tråden» i arbeidsstykke 33 (V22 «Samtalen først», Erik 27.10.2026): SAMTALEN SOM SAK, og vendingene i den.
//
// Før: en samtale ført i Tua fantes ikke som sak — bare som en felles streng i `samtale`-feltet på promptene og lenkene ga/bygget_av, og
// tråder() regnet ut sammenhengen hver gang. En samtale fanget fra Claude Code/Cowork/Desktop var derimot en samtale-sak (kind samtale, V14).
// Nå: ÉN samtaletype. En samtale ført i Tua er en samtale-sak med kilde «Tua» (nøkkel samtale:tua:<id>, tagger samtale · tua) i prosjektet,
// tittel = første spørsmål kortet som Code-samtalene (clip(flat, 60)), `start` = når den begynte, hører_til arvet når den hører til et arbeid.
// Innholdet er transkriptet — hode + vendingene «**Du · tid:**» / «**<modell> · nivå:**», konklusjoner som streker — skrevet på nytt ved hver vending
// (ny versjon som for andre saker); S = siste vending (samtaleS), M etter friksjon 20-regelen (samtaleM). Prompt, svar, Forskjeller og konklusjon
// peker på samtalen med bygget_av (i tillegg til det de hadde), og `samtale` (convo) = samtalens tittel. Importerte samtaler eies fortsatt av
// importen (transkriptet skrives ikke om — idempotens), men kan FORTSETTES: en ny vending er en prompt-/svar-sak som peker på samtalen.
//
//   finnSamtale(atoms, id)        samtalen for en id: samtale-sakens id, nøkkelen (samtale:tua:<t_…>, samtale:<økt>, okt:<økt>), eller en sak i samtalen
//   samtaleFor(atoms, sak)        samtalen en prompt/svar/konklusjon hører til (bygget_av → samtale, via prompten, via øktnøkkel, eller samme navn)
//   vendingerFor(atoms, samtale)  vendingene i rekkefølge: {id, rolle: bruker|modell|konklusjon, modell, nivå, tid, S, L, tegn, beholdt, låst, prompt, forskjeller}
//                                 — for Tua-samtaler promptene som peker på samtalen (eller gamle: samme navn i prosjektet), for importerte prompt-/capture-sakene
//                                 med øktas nøkkel (prompt:<økt8>:…, svar:<økt8>:…) — og nye vendinger fra Tua som peker på samtalen, uansett kilde
//   standardVendinger(vend, m)    standardvalget: alt etter siste LÅSTE konklusjon (ellers alt), begrenset BAKFRA av mottakerens budsjett i tokens.
//                                 Ingenting kuttes stille: `utenfor` sier hvilke vendinger som falt utenfor og hvorfor
//   transkript(samtale, vend)     L for en Tua-samtale (samtaleFraSak i samtaletekst.js leser den tilbake)
//   lagSamtale / oppdaterSamtale  skriver samtale-saken (én upsert: innhold, S, M) — bare Tua-samtaler skrives om
//   samtaleForSpor(atoms, …)      det motoren trenger: finn samtalen (id, reservert id, gammelt samtalenavn, «kjør igjen»-prompten) eller lag en ny
//   gamleTråder / gjørOmTråd      review --traader: gamle Tua-tråder (prompt:spor: uten samtale-sak) får samtale-sak, sakene får bygget_av → den
//
// Alt leser og skriver gjennom lageret (store.js). Ingen modell kalles her — sendingen går gjennom motoren (motor.spor med `vendinger`).

import { upsert, markDirty, levelOf, statusOf, isVault, øktIdAv, hashOf, tråder } from './store.js'
import { samtaleS, samtaleM, nyttPar, flat, clip } from './samtaletekst.js'

export const KILDE_TUA = 'Tua'
export const erTuaSamtale = (a) => a?.kind === 'samtale' && String(a.source || '').trim() === KILDE_TUA
export const nySamtaleId = () => 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
export const erReservertId = (s) => /^t_[a-z0-9]+_[a-z0-9]+$/.test(String(s || ''))
export const samtaleNøkkel = (id) => `samtale:tua:${id}`
// tittelen: første setning når den er kort nok, ellers de første 60 tegnene (Code-samtalene: clip(flat, 60)) — «Hva er fristen?» av «Hva er fristen?\nAndre linje.»
export const samtaleTittel = (melding) => { const s = flat(melding); const m = s.match(/^[\s\S]*?[.!?](?=\s|$)/); return clip(m && m[0].length <= 60 ? m[0] : s, 60) || 'Samtale' }
export const samtaleRef = (s) => ({ id: s.id, version: s.version || 1, level: 'L' })
const iso = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '')
const når = (t) => (t ? new Date(t).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' }) : '')
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase()
const navnAv = (s) => s.convo || s.name || ''
// rekkefølge: tid (dato i fila har sekundoppløsning), så tidsstempelet i id-en (uid() = a_<ms i base36>_…) — to spørsmål i samme sekund står riktig
const idTid = (a) => { const m = /^a_([0-9a-z]+)_/.exec(String(a?.id || '')); return m ? parseInt(m[1], 36) : 0 }
const påTid = (x, y) => ((x.capturedAt || 0) - (y.capturedAt || 0)) || (idTid(x) - idTid(y))

export function finnSamtale(atoms, id) {
  if (!id) return null
  const s = String(id).trim()
  const direkte = atoms.find((a) => a.kind === 'samtale' && (a.id === s || a.key === samtaleNøkkel(s) || a.key === `samtale:${s}` || a.key === `okt:${s}`))
  if (direkte) return direkte
  const sak = atoms.find((a) => a.id === s)
  return sak ? samtaleFor(atoms, sak) : null
}
export function samtaleFor(atoms, sak, dybde = 0) {
  if (!sak || dybde > 3) return null
  if (sak.kind === 'samtale') return sak
  const viaRef = (sak.derivedFrom || []).map((d) => atoms.find((a) => a.id === d.id && a.kind === 'samtale')).find(Boolean)
  if (viaRef) return viaRef
  if (sak.kind !== 'prompt') {
    const prompt = (sak.derivedFrom || []).map((d) => atoms.find((a) => a.id === d.id && a.kind === 'prompt')).find(Boolean)
    if (prompt) { const r = samtaleFor(atoms, prompt, dybde + 1); if (r) return r }
  }
  const sid8 = øktIdAv(sak.key)
  if (sid8) { const s = atoms.find((a) => a.kind === 'samtale' && øktIdAv(a.key) === sid8); if (s) return s }
  return atoms.find((a) => erTuaSamtale(a) && same(a.project, sak.project) && navnAv(a) === (sak.convo || '')) || null   // gammel Tua-tråd: samtalenavnet
}

// ── vendingene ───────────────────────────────────────────────────────────────
const erForskjeller = (a) => a?.kind === 'svar' && (a.tags || []).some((t) => String(t).toLowerCase() === 'forskjeller')
const erSvarSak = (a) => !!a && !erForskjeller(a) && (a.kind === 'svar' || (a.kind === 'capture' && (a.tags || []).includes('svar')))
export const modellAv = (a) => String(a?.source || '').split(' (')[0].trim() || 'modell'
const nivåAv = (a, utenom) => [...new Set((a.derivedFrom || []).filter((d) => !utenom.has(d.id)).map((d) => d.level).filter(Boolean))].join('/') || null
export function vendingerFor(atoms, samtale) {
  if (!samtale) return []
  const peker = (a) => (a.derivedFrom || []).some((d) => d.id === samtale.id)
  const sid8 = øktIdAv(samtale.key)
  const tua = erTuaSamtale(samtale)
  const sammeNavn = (a) => same(a.project, samtale.project) && (a.convo || '') === navnAv(samtale)
  const prompter = atoms.filter((a) => a.kind === 'prompt' && a.id !== samtale.id && (peker(a) || (sid8 && String(a.key || '').startsWith(`prompt:${sid8}:`)) || (tua && /^prompt:spor:/.test(String(a.key || '')) && sammeNavn(a)))).sort(påTid)
  const rad = (a, rolle, ekstra = {}) => ({ id: a.id, rolle, kind: a.kind || 'capture', tid: a.capturedAt || 0, modell: rolle === 'bruker' ? null : modellAv(a), kilde: a.source || '', nivå: null, S: levelOf(a, 'S').text, L: a.content || '', tegn: (a.content || '').length, versjon: a.version || 1,
    beholdt: a.beholdt === true || a.fanget === false, status: statusOf(a), vault: isVault(a), låst: false, ...ekstra })
  const ut = []
  for (const p of prompter) {
    const svarIder = new Set((p.ga || []).map((g) => g.id))
    const svar = atoms.filter((a) => a.id !== p.id && erSvarSak(a) && (svarIder.has(a.id) || (a.derivedFrom || []).some((d) => d.id === p.id))).sort(påTid)
    const fsk = atoms.filter((a) => erForskjeller(a) && (a.derivedFrom || []).some((d) => svar.some((s) => s.id === d.id))).map((a) => a.id)
    const konk = atoms.filter((a) => a.kind === 'konklusjon' && (a.derivedFrom || []).some((d) => d.id === p.id)).sort(påTid)
    ut.push(rad(p, 'bruker', { prompt: p.id, forskjeller: fsk }))
    for (const s of svar) ut.push(rad(s, 'modell', { prompt: p.id, nivå: nivåAv(s, new Set([p.id, samtale.id])) }))
    for (const k of konk) ut.push(rad(k, 'konklusjon', { prompt: p.id, låst: statusOf(k) === 'endelig' }))
  }
  return ut
}
export const antallVendinger = (vend) => vend.filter((v) => v.rolle === 'bruker').length
export const sistI = (samtale, vend) => Math.max(samtale?.capturedAt || 0, ...vend.map((v) => v.tid || 0))

// Standardvalget regnes HER, ikke i appen (plan §5): alt etter siste låste konklusjon, ellers alt; så bakfra til budsjettet er brukt. anslå(tekst) → tokens for mottakeren.
export function standardVendinger(vend, mottaker = {}, { anslå = (t) => Math.round(String(t || '').length / 3.5), reservert = 0 } = {}) {
  const label = mottaker.label ? String(mottaker.label).split(' (')[0] : mottaker.id || 'mottakeren'
  const budsjett = Number(mottaker.budsjett) || 0
  const sisteLåst = vend.reduce((s, v, i) => (v.rolle === 'konklusjon' && v.låst ? i : s), -1)
  const utenfor = new Map()
  vend.forEach((v, i) => {
    if (i < sisteLåst) utenfor.set(v.id, { id: v.id, hvorfor: 'før siste låste konklusjon — konklusjonen oppsummerer det' })
    else if (i === sisteLåst) utenfor.set(v.id, { id: v.id, hvorfor: 'den låste konklusjonen står som strek i samtalen; kryss av om den skal med' })
    else if (v.rolle === 'konklusjon') utenfor.set(v.id, { id: v.id, hvorfor: 'konklusjon (utkast) — kryss av om den skal med' })
  })
  const kandidater = vend.filter((v) => !utenfor.has(v.id))
  const valgt = []
  let brukt = reservert, stoppet = false
  for (const v of [...kandidater].reverse()) {
    const t = anslå(v.L)
    if (!stoppet && (!budsjett || brukt + t <= budsjett)) { brukt += t; valgt.unshift(v.id); continue }
    stoppet = true   // bakfra: faller én utenfor, faller alle eldre også — nyeste beholdes
    utenfor.set(v.id, { id: v.id, hvorfor: `utenfor budsjettet til ${label} (ca. ${t.toLocaleString('no-NO')} tokens; ${budsjett.toLocaleString('no-NO')} er grensen, ${brukt.toLocaleString('no-NO')} er alt brukt av nyere vendinger)`, tokens: t })
  }
  const rekkefølge = new Map(vend.map((v, i) => [v.id, i]))
  return { vendinger: valgt, utenfor: [...utenfor.values()].sort((x, y) => rekkefølge.get(x.id) - rekkefølge.get(y.id)), tokens: brukt, budsjett: budsjett || null, mottaker: mottaker.id || null }
}

// ── transkriptet og S/M for en Tua-samtale ──────────────────────────────────
const parAv = (vend) => {
  const pairs = []
  for (const v of vend) {
    if (v.rolle === 'bruker') pairs.push(nyttPar(v.L, v.tid))
    else if (v.rolle === 'modell' && pairs.length) { pairs.at(-1).answers.push(v.L); pairs.at(-1).svar = v.L }
  }
  return pairs
}
export function transkript(samtale, vend) {
  const n = antallVendinger(vend)
  const tider = [samtale.createdAt, ...vend.map((v) => v.tid)].filter(Boolean)
  const d1 = iso(tider.length ? Math.min(...tider) : Date.now()), d2 = iso(tider.length ? Math.max(...tider) : Date.now())
  const hode = `# ${samtale.name}\n\n_${KILDE_TUA} · ${n ? `${n} ${n === 1 ? 'vending' : 'vendinger'}` : 'samtalen er i gang'} · ${d1}${d2 !== d1 ? ` – ${d2}` : ''} · ${samtale.project}_`
  const linjer = vend.map((v) => (v.rolle === 'bruker' ? `**Du · ${når(v.tid)}:** ${v.L}`
    : v.rolle === 'konklusjon' ? `---\n\n**Konklusjon · ${v.låst ? 'låst' : 'utkast'} · ${iso(v.tid)}:** ${v.L}`
      : `**${v.modell}${v.nivå ? ` · ${v.nivå}` : ''}:** ${v.L}`))
  return [hode, ...linjer].join('\n\n')
}
// Én upsert for samtale-saken: innhold (transkriptet), S (siste vending), M (regelen). Bare Tua-samtaler skrives om — en importert eies av importen.
function skrivSamtale(atoms, { key, name, project, hørerTil = null, summary = '', vendinger: vend, mal }) {
  const pairs = parAv(vend), turns = pairs.length
  const tider = [mal?.createdAt, ...vend.map((v) => v.tid)].filter(Boolean)
  const first = tider.length ? Math.min(...tider) : Date.now(), last = tider.length ? Math.max(...tider) : first
  const skall = { ...(mal || {}), name, project, createdAt: mal?.createdAt || first }
  const content = transkript(skall, vend)
  const short = turns ? samtaleS({ pairs, turns, first, last }) : `${name} · samtale i Tua, ingen vendinger ennå`
  const medium = turns ? samtaleM({ prompts: pairs.map((p) => p.prompt), lastAssistant: pairs.at(-1)?.svar || '', turns, first, last, kilde: KILDE_TUA }) : undefined
  return upsert(atoms, { key, kind: 'samtale', name, content, project, convo: name, source: KILDE_TUA, by: 'regel', tags: ['samtale', 'tua'], short, ...(medium ? { medium } : {}),
    summary: summary || `Samtale ført i Tua i ${project}.`, ...(hørerTil ? { hørerTil } : {}) })
}
export function lagSamtale(atoms, { id = nySamtaleId(), prosjekt, navn = null, melding = '', hørerTil = null } = {}) {
  const name = String(navn || samtaleTittel(melding)).trim() || 'Samtale'
  const project = String(prosjekt || '').trim() || 'Uten prosjekt'
  const { atom } = skrivSamtale(atoms, { key: samtaleNøkkel(id), name, project, hørerTil, vendinger: [] })
  return atom
}
export function oppdaterSamtale(atoms, samtale, { vendinger = null } = {}) {
  if (!erTuaSamtale(samtale)) return { atom: samtale, status: 'uendret', vendinger: vendinger || vendingerFor(atoms, samtale) }   // importert: transkriptet står, vendingene peker på den
  const vend = vendinger || vendingerFor(atoms, samtale)
  if (!samtale.key) samtale.key = samtaleNøkkel(samtale.id)
  const r = skrivSamtale(atoms, { key: samtale.key, name: samtale.name, project: samtale.project, hørerTil: samtale.hørerTil || null, summary: samtale.summary, vendinger: vend, mal: samtale })
  return { ...r, vendinger: vend }
}

// Motoren: samtalen for et spørsmål. `samtale` kan være en samtale-sak (id/nøkkel — også en importert, som da fortsettes), en reservert id fra
// POST /api/samtale/ny (lagres nå), et samtalenavn fra før (gammel form: en Tua-samtale med det navnet i prosjektet fortsettes, ellers lages den
// med det navnet), eller tomt: «kjør igjen»-prompten (gammel) avgjør, ellers samme spørsmål igjen = samme samtale (navnet), ellers en ny.
export function samtaleForSpor(atoms, { samtale, prosjekt, melding, gammel = null, hørerTil = null } = {}) {
  const ønsket = samtale == null ? '' : String(samtale).trim()
  let s = ønsket ? finnSamtale(atoms, ønsket) : null
  if (!s && gammel) s = samtaleFor(atoms, gammel)
  const navn = ønsket && !s && !erReservertId(ønsket) ? ønsket : null
  const proj = String(gammel?.project || prosjekt || '').trim() || 'Uten prosjekt'
  if (!s && navn) s = atoms.find((a) => erTuaSamtale(a) && same(a.project, proj) && navnAv(a) === navn) || null
  if (!s && !ønsket && !gammel) s = atoms.find((a) => erTuaSamtale(a) && same(a.project, proj) && a.name === samtaleTittel(melding)) || null
  if (s) return { samtale: s, ny: false }
  const id = erReservertId(ønsket) ? ønsket : nySamtaleId()
  return { samtale: lagSamtale(atoms, { id, prosjekt: proj, navn: navn || gammel?.convo || null, melding, hørerTil }), ny: true }
}
// Legg samtalen til i bygget_av på en sak (uten dublett), merk den endret. Brukes av motoren og av review --traader.
export function pekPåSamtale(atoms, sak, samtale) {
  if (!sak || !samtale || sak.id === samtale.id) return false
  const ref = samtaleRef(samtale)
  const har = (sak.derivedFrom || []).find((d) => d.id === ref.id)
  if (har && har.version === ref.version) return false
  sak.derivedFrom = [...(sak.derivedFrom || []).filter((d) => d.id !== ref.id), ref]
  markDirty(atoms, sak.id)
  return true
}

// ── review --traader: gamle Tua-tråder (16 i Eriks arkiv) får samtale-sak ─────────────────────────────────────────
export function gamleTråder(atoms) {
  const { per } = tråder(atoms)
  const grupper = new Map()
  for (const p of atoms.filter((a) => a.kind === 'prompt' && (/^prompt:spor:/.test(String(a.key || '')) || same(a.source, KILDE_TUA)))) {
    if (samtaleFor(atoms, p)) continue   // har alt en samtale (peker, eller en Tua-samtale med navnet finnes)
    const k = `${p.project}\n${p.convo || p.name}`
    const g = grupper.get(k) || { project: p.project, convo: p.convo || p.name, prompter: [], saker: [], hørerTil: null, start: Infinity }
    const t = per.get(p.id) || { svar: [], forskjeller: [], konklusjon: null }
    g.prompter.push(p); g.hørerTil = g.hørerTil || p.hørerTil || null; g.start = Math.min(g.start, p.capturedAt || Infinity)
    for (const id of [p.id, ...t.svar, ...t.forskjeller, ...(t.konklusjon ? [t.konklusjon] : [])]) { const a = atoms.find((x) => x.id === id); if (a && !g.saker.includes(a)) g.saker.push(a) }
    grupper.set(k, g)
  }
  return [...grupper.values()].sort((x, y) => x.start - y.start)
}
export function gjørOmTråd(atoms, g) {
  const id = hashOf(`${g.project}\n${g.convo}`)
  const s = lagSamtale(atoms, { id, prosjekt: g.project, navn: g.convo, hørerTil: g.hørerTil })
  if (Number.isFinite(g.start)) s.createdAt = g.start
  for (const a of g.saker) pekPåSamtale(atoms, a, s)
  const r = oppdaterSamtale(atoms, s)
  if (r.status !== 'uendret') r.atom.version = 1   // laget og fylt i samme vending — én versjon
  return r.atom
}
