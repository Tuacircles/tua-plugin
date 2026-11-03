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

import { upsert, markDirty, levelOf, statusOf, isVault, øktIdAv, hashOf, sha8, tråder } from './store.js'
import { samtaleS, samtaleM, samtaleFraSak, nyttPar, flat, clip, isoLokal } from './samtaletekst.js'

export const KILDE_TUA = 'Tua'
export const erTuaSamtale = (a) => a?.kind === 'samtale' && String(a.source || '').trim() === KILDE_TUA
export const nySamtaleId = () => 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
export const erReservertId = (s) => /^t_[a-z0-9]+_[a-z0-9]+$/.test(String(s || ''))
export const samtaleNøkkel = (id) => `samtale:tua:${id}`
// tittelen: første setning når den er kort nok, ellers de første 60 tegnene (Code-samtalene: clip(flat, 60)) — «Hva er fristen?» av «Hva er fristen?\nAndre linje.»
export const samtaleTittel = (melding) => { const s = flat(melding); const m = s.match(/^[\s\S]*?[.!?](?=\s|$)/); return clip(m && m[0].length <= 60 ? m[0] : s, 60) || 'Samtale' }
export const samtaleRef = (s) => ({ id: s.id, version: s.version || 1, level: 'L' })
const iso = (t) => (t ? isoLokal(t) : '')   // skive 3: lokal dato i hodet og på konklusjonsstrekene (midnattsfeilen — samtaleFraSak leser den som lokal)
const når = (t) => (t ? new Date(t).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' }) : '')
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase()
const navnAv = (s) => s.convo || s.name || ''
// rekkefølge: tid (dato i fila har sekundoppløsning), så tidsstempelet i id-en (uid() = a_<ms i base36>_…) — to spørsmål i samme sekund står riktig
const idTid = (a) => { const m = /^a_([0-9a-z]+)_/.exec(String(a?.id || '')); return m ? parseInt(m[1], 36) : 0 }
const påTid = (x, y) => ((x.capturedAt || 0) - (y.capturedAt || 0)) || (idTid(x) - idTid(y))

export function finnSamtale(atoms, id) {
  if (!id) return null
  const s = String(id).trim()
  const direkte = atoms.find((a) => a.kind === 'samtale' && (a.id === s || a.key === samtaleNøkkel(s) || a.key === `samtale:${s}` || a.key === `okt:${s}` || a.key === `codex:${s}`))   // codex: Codex-samtaler (28.10.2026)
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

// ── Arbeidsrommet (arbeidsstykke 35 skive 1, 03.11.2026): hvilke dokumenter og kilder som hører til en samtale eller en sak ──────────
// Samme kobling som raden i avisen (regler.flateRader, fraRad): et dokument hører til samtalen når det har samme prosjekt og samtalenavn, eller når bygget_av/derivedFrom peker
// på samtalen eller en av delene i den. Kildene er det delene ble bygget av, utenfor samtalen. Utfordringer og andre samtaler står aldri i lista.
const DELER = new Set(['samtale', 'prompt', 'svar', 'konklusjon'])
const erDel = (a) => !!a && (DELER.has(a.kind) || (a.tags || []).some((t) => ['svar', 'prompt', 'forskjeller'].includes(String(t).toLowerCase())) || /^(svar|prompt|okt|forskjeller|konklusjon):/.test(String(a.key || '')))
const erUtf = (a) => !!a && (a.utfordring != null || (a.tags || []).some((t) => ['utfordring', 'ny-versjon'].includes(String(t).toLowerCase())))
const pekerAv = (a) => [...(a?.derivedFrom || []), ...(a?.bygget_av || [])].map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean)
export function romKoblinger(atoms, id) {
  const byId = new Map((atoms || []).map((a) => [a.id, a]))
  const direkte = finnSamtale(atoms, id)
  const sak = byId.get(String(id).trim()) || direkte
  if (!sak) return null
  const iSamme = (a, navn, prosjekt) => !!navn && same(a.project, prosjekt) && (a.convo || '') === navn
  // samtalen: saken selv, delen av en samtale — eller for et dokument: samme samtalenavn, ellers samtalen til det dokumentet er bygget av
  const avDel = (x) => samtaleFor(atoms, x) || atoms.find((a) => a.kind === 'samtale' && iSamme({ project: x.project, convo: x.convo || '' }, navnAv(a), a.project)) || null   // fangede samtaler: delene peker ikke, de deler samtalenavn
  let samtale = erDel(sak) ? direkte || avDel(sak) : null
  if (!erDel(sak)) {
    samtale = atoms.find((a) => a.kind === 'samtale' && a.id !== sak.id && iSamme({ project: sak.project, convo: sak.convo || '' }, navnAv(a), a.project)) || null
    if (!samtale) for (const p of pekerAv(sak)) { const x = byId.get(p); if (x && erDel(x)) { samtale = avDel(x); if (samtale) break } }
  }
  const navn = samtale ? navnAv(samtale) : sak.convo || ''
  const prosjekt = samtale?.project || sak.project
  const deler = atoms.filter((a) => erDel(a) && !erUtf(a) && (a.id === samtale?.id || iSamme(a, navn, prosjekt) || (samtale && pekerAv(a).includes(samtale.id))))
  const delIder = new Set(deler.map((a) => a.id))
  const erDok = (a) => !!a && !erDel(a) && !erUtf(a)
  const nyestFørst = (x, y) => (y.capturedAt || 0) - (x.capturedAt || 0)
  const dokumenter = atoms.filter((a) => a.id !== sak.id && erDok(a) && (iSamme(a, navn, prosjekt) || pekerAv(a).some((p) => delIder.has(p)))).sort(nyestFørst)
  const dokIder = new Set(dokumenter.map((a) => a.id))
  const kildeIder = new Set(erDel(sak) ? deler.flatMap(pekerAv) : pekerAv(sak))
  const kilder = [...kildeIder].map((p) => byId.get(p)).filter((a) => a && a.id !== sak.id && !delIder.has(a.id) && !dokIder.has(a.id) && a.kind !== 'samtale' && !erUtf(a) && a.kind !== 'prompt').sort(nyestFørst)
  // naboene Sak.jsx slår opp i: delene, kildene, svarene saken ga, arbeidet den kan høre til og det som henger på den
  const naboIder = new Set([sak.id, ...delIder, ...pekerAv(sak), ...(sak.ga || []).map((g) => g.id), ...kildeIder, sak.hørerTilForslag, sak.hørerTil].filter(Boolean))
  const naboer = atoms.filter((a) => naboIder.has(a.id) || a.hørerTil === sak.id)
  return { sak, slag: samtale && erDel(sak) ? 'samtale' : 'sak', samtale, fra: samtale ? null : sak.convo || null, dokumenter, kilder, naboer }
}

// ── vendingene ───────────────────────────────────────────────────────────────
const erForskjeller = (a) => a?.kind === 'svar' && (a.tags || []).some((t) => String(t).toLowerCase() === 'forskjeller')
const erSvarSak = (a) => !!a && !erForskjeller(a) && (a.kind === 'svar' || (a.kind === 'capture' && (a.tags || []).includes('svar')))
export const modellAv = (a) => String(a?.source || '').split(' (')[0].trim() || 'modell'
const nivåAv = (a, utenom) => [...new Set((a.derivedFrom || []).filter((d) => !utenom.has(d.id)).map((d) => d.level).filter(Boolean))].join('/') || null
// Skive 3 (arb. 33, 28.10.2026): for en IMPORTERT samtale (Code/Cowork/Desktop, hookens okt:-saker) er vendingene ALLE vendingene lest ut av transkriptet
// (samtaleFraSak), ikke bare sakene importen laget (prompt ≥ 80 tegn, svar ≥ 3 000). Der en vending alt har en sak, peker vendingen på den (id = sakens id);
// ellers får den en stabil syntetisk id v_<sha8 av samtalens id>_<n> (n = plassen i transkriptet — nye vendinger legges bakerst ved ny import, så gamle id-er står).
// Tua-vendinger som peker på samtalen (en fortsettelse ført i Tua) kommer etter transkriptets, i tidsrekkefølge. Lar transkriptet seg ikke lese, som før.
export const erSyntetiskId = (id) => /^v_[0-9a-f]{8}_\d+$/.test(String(id || ''))
const syntetiskId = (samtale, n) => `v_${sha8(samtale.id)}_${n}`
const kortModell = (s) => { const k = String(s || '').trim(); return /^Claude\b/.test(k) ? 'Claude' : k.split(' (')[0] || 'modell' }
export function vendingerAvTranskript(atoms, samtale) {
  if (!samtale || erTuaSamtale(samtale)) return null
  const lest = samtaleFraSak(samtale.content)
  if (!lest?.pairs?.length) return null
  const sid8 = øktIdAv(samtale.key)
  const peker = (a) => (a.derivedFrom || []).some((d) => d.id === samtale.id)
  const iSamtalen = (a) => (sid8 && String(a.key || '').startsWith(`${a.kind === 'prompt' ? 'prompt' : 'svar'}:${sid8}:`)) || peker(a)
  const prompter = new Map(), svar = new Map()   // flatet tekst → saken (importens prompter er promptL — kortet ved 20 000 tegn — så vi matcher også på nøkkelen)
  for (const a of atoms) {
    if (a.id === samtale.id || !iSamtalen(a)) continue
    if (a.kind === 'prompt' && String(a.source || '') !== KILDE_TUA) { prompter.set(a.key, a); prompter.set(hashOf(a.content), a) }
    else if (erSvarSak(a) && a.kind !== 'svar') { svar.set(a.key, a); svar.set(hashOf(a.content), a) }
  }
  const rad = (a, rolle, ekstra = {}) => ({ id: a.id, rolle, kind: a.kind || 'capture', tid: a.capturedAt || 0, modell: rolle === 'bruker' ? null : modellAv(a), kilde: a.source || '', nivå: null, S: levelOf(a, 'S').text, L: a.content || '', tegn: (a.content || '').length, versjon: a.version || 1,
    beholdt: a.beholdt === true || a.fanget === false, status: statusOf(a), vault: isVault(a), låst: false, ...ekstra })
  const syntetisk = (n, rolle, tekst, ekstra = {}) => ({ id: syntetiskId(samtale, n), rolle, kind: 'vending', tid: ekstra.tid ?? null, modell: rolle === 'bruker' ? null : kortModell(samtale.source), kilde: samtale.source || '', nivå: null, S: clip(flat(tekst), 300), L: tekst, tegn: tekst.length, versjon: samtale.version || 1,
    beholdt: false, status: 'endelig', vault: isVault(samtale), låst: false, syntetisk: true, samtale: samtale.id, ...ekstra })
  const ut = []
  let n = 0, forrige = null
  for (const p of lest.pairs) {
    n++
    // skive A (§6, 28.10.2026): samme spørsmål to ganger på rad i transkriptet (Cowork skriver meldingen på nytt når en kjøring startes igjen) er ÉN vending —
    // svarene henges på den første. n telles likevel, så de syntetiske id-ene står som før.
    if (forrige && !forrige.svar && flat(p.prompt) === flat(forrige.tekst)) { forrige.svar = (p.answers?.length || 0) + (p.svar ? 1 : 0); for (const a of p.answers?.length ? p.answers : p.svar ? [p.svar] : []) { n++; const ss = svar.get(sid8 ? `svar:${sid8}:${sha8(a)}` : '') || svar.get(hashOf(a)) || null; ut.push(ss ? rad(ss, 'modell', { prompt: forrige.v.id, nivå: null }) : syntetisk(n, 'modell', a, { prompt: forrige.v.id })) } continue }
    const ps = prompter.get(sid8 ? `prompt:${sid8}:${hashOf(p.prompt)}` : '') || prompter.get(hashOf(p.prompt)) || null
    const bruker = ps ? rad(ps, 'bruker', { prompt: ps.id, forskjeller: [] }) : syntetisk(n, 'bruker', p.prompt, { tid: p.at || null })
    bruker.prompt = bruker.id
    ut.push(bruker)
    forrige = { v: bruker, tekst: p.prompt, svar: (p.answers?.length || 0) + (p.svar && !p.answers?.length ? 1 : 0) }
    for (const a of p.answers?.length ? p.answers : p.svar ? [p.svar] : []) {
      n++
      const ss = svar.get(sid8 ? `svar:${sid8}:${sha8(a)}` : '') || svar.get(hashOf(a)) || null
      ut.push(ss ? rad(ss, 'modell', { prompt: bruker.id, nivå: null }) : syntetisk(n, 'modell', a, { prompt: bruker.id }))
    }
  }
  return ut
}
export function vendingerFor(atoms, samtale) {
  if (!samtale) return []
  const peker = (a) => (a.derivedFrom || []).some((d) => d.id === samtale.id)
  const sid8 = øktIdAv(samtale.key)
  const tua = erTuaSamtale(samtale)
  const sammeNavn = (a) => same(a.project, samtale.project) && (a.convo || '') === navnAv(samtale)
  const fraTranskript = vendingerAvTranskript(atoms, samtale)   // skive 3: importerte samtaler — hele transkriptet først
  const alt = new Set((fraTranskript || []).map((v) => v.id))
  const importPrompt = (a) => !!sid8 && String(a.key || '').startsWith(`prompt:${sid8}:`)
  // etter transkriptet: Tua-vendingene som peker på samtalen (fortsettelsen), og importprompter transkriptet ikke fant igjen (forkortet transkript) — ingenting forsvinner
  const prompter = atoms.filter((a) => a.kind === 'prompt' && a.id !== samtale.id && !alt.has(a.id) && (peker(a) || importPrompt(a) || (tua && /^prompt:spor:/.test(String(a.key || '')) && sammeNavn(a)))).sort(påTid)
  const rad = (a, rolle, ekstra = {}) => ({ id: a.id, rolle, kind: a.kind || 'capture', tid: a.capturedAt || 0, modell: rolle === 'bruker' ? null : modellAv(a), kilde: a.source || '', nivå: null, S: levelOf(a, 'S').text, L: a.content || '', tegn: (a.content || '').length, versjon: a.version || 1,
    beholdt: a.beholdt === true || a.fanget === false, status: statusOf(a), vault: isVault(a), låst: false, ...ekstra })
  // rekkefølgen med transkript: importprompter transkriptet ikke fant igjen FØRST (de er eldre historikk — Desktop lagrer lange samtaler som utsnitt av de siste meldingene,
  // og sakene fra en fullere import står igjen), så transkriptets vendinger, så Tua-vendingene (fortsettelsen) etter tid
  const ut = []
  const eldre = fraTranskript ? prompter.filter(importPrompt) : [], etter = fraTranskript ? prompter.filter((a) => !importPrompt(a)) : prompter
  const leggTråd = (p) => {
    const svarIder = new Set((p.ga || []).map((g) => g.id))
    const svar = atoms.filter((a) => a.id !== p.id && erSvarSak(a) && !alt.has(a.id) && (svarIder.has(a.id) || (a.derivedFrom || []).some((d) => d.id === p.id))).sort(påTid)
    const fsk = atoms.filter((a) => erForskjeller(a) && (a.derivedFrom || []).some((d) => svar.some((s) => s.id === d.id))).map((a) => a.id)
    const konk = atoms.filter((a) => a.kind === 'konklusjon' && (a.derivedFrom || []).some((d) => d.id === p.id)).sort(påTid)
    ut.push(rad(p, 'bruker', { prompt: p.id, forskjeller: fsk }))
    for (const s of svar) ut.push(rad(s, 'modell', { prompt: p.id, nivå: nivåAv(s, new Set([p.id, samtale.id])) }))
    for (const k of konk) ut.push(rad(k, 'konklusjon', { prompt: p.id, låst: statusOf(k) === 'endelig' }))
  }
  for (const p of eldre) leggTråd(p)
  if (fraTranskript) ut.push(...fraTranskript)
  for (const p of etter) leggTråd(p)
  return ut
}
// Skive 3: én vending etter id — en sak, eller en syntetisk vending fra transkriptet (krever samtalen). Motoren (løsVendinger) bruker den.
export function vendingAv(atoms, id, samtale = null) {
  const s = String(id || '')
  if (!erSyntetiskId(s)) { const a = atoms.find((x) => x.id === s); return a ? { sak: a } : null }
  if (!samtale) return null
  const v = vendingerFor(atoms, samtale).find((x) => x.id === s)
  return v ? { vending: v } : null
}
export const antallVendinger = (vend) => vend.filter((v) => v.rolle === 'bruker').length
export const sistI = (samtale, vend) => Math.max(samtale?.capturedAt || 0, ...vend.map((v) => v.tid || 0))
// Skive 4 (arb. 33, 28.10.2026) — Claude-døra viser samtaler fullt ut: det kortet, tua_search, tua_get og Siden sist sier om en samtale-sak, regnet ÉN gang her.
//   { id, tittel, prosjekt, kilde ('Tua' | 'Claude Code' | …), tua, vendinger (antall spørsmål), siste (ms), modeller: ['gemma3', 'Claude'], konklusjon: 'låst' | 'utkast' | null,
//     syntetiske (vendinger lest ut av transkriptet uten egen sak), adresse: '#samtale/<id>' }
export function samtaleInfo(atoms, samtale, { base = '' } = {}) {
  const v = vendingerFor(atoms, samtale)
  const konk = v.filter((x) => x.rolle === 'konklusjon')
  return { id: samtale.id, tittel: samtale.name || navnAv(samtale) || 'Samtale', prosjekt: samtale.project, kilde: erTuaSamtale(samtale) ? KILDE_TUA : String(samtale.source || 'Claude'), tua: erTuaSamtale(samtale),
    vendinger: antallVendinger(v), siste: sistI(samtale, v), modeller: [...new Set(v.filter((x) => x.rolle === 'modell').map((x) => kortModell(x.modell)).filter(Boolean))],
    konklusjon: konk.some((k) => k.låst) ? 'låst' : konk.length ? 'utkast' : null, syntetiske: v.filter((x) => x.syntetisk).length, adresse: `${base}#samtale/${encodeURIComponent(samtale.id)}` }
}
// Én linje om samtalen, lik i tua_search, tua_get og kortet: «Samtale i Tua: 4 vendinger · siste 27.10.2026 · gemma3, Claude · konklusjon låst · fortsett: http://…#samtale/<id>»
export function samtaleLinje(info) {
  const dato = info.siste ? new Date(info.siste).toLocaleDateString('no-NO', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—'
  return `Samtale ${info.tua ? 'i Tua' : `fra ${info.kilde}`}: ${info.vendinger} ${info.vendinger === 1 ? 'vending' : 'vendinger'} · siste ${dato}${info.modeller.length ? ` · ${info.modeller.join(', ')}` : ''}${info.konklusjon ? ` · konklusjon ${info.konklusjon}` : ''} · fortsett i Tua: ${info.adresse}`
}

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
