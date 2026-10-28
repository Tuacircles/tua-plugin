// arbeid.js — friksjon 20 (Erik 25.10.2026, friksjonskortet «arbeidet som samler»; V21 «arbeidsløp som status på sak»):
// en samtale skal ikke stå alene — mellom prosjektet og samtalen mangler nivået ARBEID («Anken til Energima»: flere samtaler i Code, Cowork og
// Desktop, Spør-tråder, versjoner og delinger mot ett mål). Eriks svar: (1) ingen ny saktype — arbeidet er en sak med status som andre saker
// peker på; (2) Tua foreslår en kobling med én gang en Code-økt starter; (3) «Vurder dette arbeidet» er en kort kritisk gjennomgang som standard.
//
// Benevnelser heretter: prosjekt · arbeid · samtale (ordet «økt» utgår i UI og titler; kilden Code/Cowork/Desktop vises) · tråd · sak.
//
//   erArbeid(a, følgere)        en sak er et arbeid når andre saker peker på den (hører_til), eller brukeren sa «Gjør til arbeid» (arbeid: true)
//   følgereAv(atoms)            id → sakene som har hører_til = id (én gjennomgang)
//   arbeider(atoms, {prosjekt}) arbeidene med tall (samtaler, tråder, filer, sist) — nyeste først
//   åpneArbeider(…)             de som ikke er låst (status endelig) og er rørt siste 14 dager — det hooken foreslår blant
//   løpFor(atoms, id)           LØPET: samtalene, trådene, sakene, filene, versjonene og utleveringene som henger på arbeidet, og én tidslinje (nyeste nederst)
//   delAv(atoms, a, følgere)    «Del av: <arbeid> · samtale 7 av 12» for en sak som hører til et arbeid
//   settHørerTil / løsne / avvisForslag / gjørTilArbeid   skriver koblingen i minnet (markDirty) — kalleren lagrer med save()
//   arbeidForslag(atoms, …)     regelen hooken og importen bruker: automatisk kobling via forelder (vert), gren (felles stamme) eller tittel; ellers et forslag
//   vurderPakke(atoms, id)      «Vurder dette arbeidet»: siste svar + filene som ble skrevet, som kilder til Spør, med den faste vurderingsprompten
//   vurderingsprompt()          standard: kort kritisk gjennomgang; kan endres i Innstillinger › Spør (~/.tua/config.json → spor.vurderingsprompt)
// Alt leser og skriver gjennom lageret (store.js). Ingen modell kalles her — sendingen går gjennom motoren (spor) med hørerTil.

import path from 'node:path'
import { statusOf, tråder, versions, deliveries, markDirty, readConfig, writeConfig, setStatus } from './store.js'

const DØGN = 86400e3
export const DAGER_ÅPENT = 14
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase()
export const norm = (t) => String(t || '').toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim()

export function følgereAv(atoms) {
  const m = new Map()
  for (const a of atoms || []) { if (!a?.hørerTil) continue; const l = m.get(a.hørerTil) || []; l.push(a); m.set(a.hørerTil, l) }
  return m
}
export const erArbeid = (a, følgere = null) => !!a && (a.arbeid === true || !!(følgere && (følgere.get(a.id) || []).length))
export const arbeidAv = (a) => (a ? a.hørerTil || a.id : null)             // samtalen peker på et arbeid → det; ellers er samtalen selv arbeidet (forelderøkta)

const sistI = (a, medlemmer = []) => Math.max(a?.capturedAt || 0, ...medlemmer.map((x) => x.capturedAt || 0))
const startAv = (x) => x?.createdAt || x?.capturedAt || 0                 // en samtale ordnes etter når den begynte (hooken setter createdAt = første melding), ikke når fila sist ble skrevet
export const erFilSak = (a) => /^fil:/.test(String(a?.key || '')) || ((a?.tags || []).includes('dokument') && (a?.links || []).some((l) => l.kind === 'file'))
// filene en samtale skrev: fil:-saker som peker på arbeidet, eller som deler samtalenavn med en samtale i løpet — eller med arbeidet selv når det er en samtale (samme regel som claudeØkter)
const filerFor = (atoms, arbeidId, samtaler, følgere) => {
  const arbeidet = atoms.find((a) => a.id === arbeidId)
  const nøkler = new Set([...samtaler, ...(arbeidet?.kind === 'samtale' ? [arbeidet] : [])].filter(Boolean).map((s) => `${(s.project || '').toLowerCase()}\n${(s.convo || s.name || '').toLowerCase()}`))
  const egne = (følgere.get(arbeidId) || []).filter(erFilSak)
  const viaSamtale = atoms.filter((a) => erFilSak(a) && a.hørerTil !== arbeidId && a.convo && nøkler.has(`${(a.project || '').toLowerCase()}\n${a.convo.toLowerCase()}`))
  return [...egne, ...viaSamtale].sort((x, y) => (x.capturedAt || 0) - (y.capturedAt || 0))
}
export function arbeider(atoms, { prosjekt = '' } = {}) {
  const følgere = følgereAv(atoms)
  const ut = []
  for (const a of atoms) {
    if (!erArbeid(a, følgere)) continue
    if (prosjekt && !same(a.project, prosjekt)) continue
    const f = følgere.get(a.id) || []
    const samtaler = f.filter((x) => x.kind === 'samtale'), tråder_ = f.filter((x) => x.kind === 'prompt')
    const filer = filerFor(atoms, a.id, samtaler, følgere)
    ut.push({ id: a.id, name: a.name, project: a.project, kind: a.kind || 'capture', status: statusOf(a), åpen: a.status !== 'endelig', samtaler: samtaler.length, tråder: tråder_.length, filer: filer.length, saker: f.length, sist: sistI(a, [...f, ...filer]), capturedAt: a.capturedAt })
  }
  return ut.sort((x, y) => y.sist - x.sist)
}
export const åpneArbeider = (atoms, { prosjekt = '', nå = Date.now(), dager = DAGER_ÅPENT } = {}) => arbeider(atoms, { prosjekt }).filter((r) => r.åpen && r.sist >= nå - dager * DØGN)

// Løpet — tidslinja på arbeidet. Hver rad: { tid, type, id, navn, kilde, detalj }. Typer: samtale · spørsmål · svar · forskjeller · konklusjon · sak · fil · versjon · utlevert · deling.
export function løpFor(atoms, id, { medVersjoner = true, medUtleveringer = true } = {}) {
  const byId = new Map(atoms.map((a) => [a.id, a]))
  const a = byId.get(id)
  if (!a) throw new Error(`fant ikke sak ${id}`)
  const følgere = følgereAv(atoms)
  const f = (følgere.get(id) || []).slice().sort((x, y) => startAv(x) - startAv(y))
  const { per } = tråder(atoms)
  const rad = (x, type, detalj = '') => ({ tid: type === 'samtale' ? startAv(x) : x.capturedAt || 0, type, id: x.id, navn: x.name, kilde: x.source || '', prosjekt: x.project, detalj, status: statusOf(x) })
  const samtaler = f.filter((x) => x.kind === 'samtale').map((x, i) => ({ ...rad(x, 'samtale'), nr: i + 1 }))
  const tråderUt = []
  const iTråd = new Set()
  for (const p of f.filter((x) => x.kind === 'prompt')) {
    const t = per.get(p.id) || { svar: [], forskjeller: [], konklusjon: null }
    const svar = t.svar.map((sid) => byId.get(sid)).filter(Boolean), fsk = t.forskjeller.map((sid) => byId.get(sid)).filter(Boolean), k = t.konklusjon ? byId.get(t.konklusjon) : null
    for (const x of [...svar, ...fsk, k].filter(Boolean)) iTråd.add(x.id)
    tråderUt.push({ ...rad(p, 'spørsmål'), svar: svar.map((s) => ({ id: s.id, kilde: s.source, tid: s.capturedAt })), forskjeller: fsk.map((s) => s.id), konklusjon: k ? { id: k.id, status: statusOf(k), tid: k.capturedAt } : null, sist: sistI(p, [...svar, ...fsk, k].filter(Boolean)) })
  }
  const filer = filerFor(atoms, id, samtaler.map((s) => byId.get(s.id)), følgere)
  const filIder = new Set(filer.map((x) => x.id))
  const saker = f.filter((x) => x.kind !== 'samtale' && x.kind !== 'prompt' && !iTråd.has(x.id) && !filIder.has(x.id))
  const delinger = saker.filter((x) => (x.tags || []).includes('deling'))
  const vanlige = saker.filter((x) => !(x.tags || []).includes('deling'))
  const versjoner = medVersjoner ? (() => { try { return versions(id) } catch { return [] } })() : []
  const utlev = medUtleveringer ? (() => { try { return deliveries(id, 50) } catch { return [] } })() : []
  const tidslinje = [
    ...samtaler.map((s) => ({ ...s, detalj: `samtale ${s.nr}` })),
    ...tråderUt.flatMap((t) => [{ tid: t.tid, type: 'spørsmål', id: t.id, navn: t.navn, kilde: 'Tua', prosjekt: t.prosjekt, detalj: `${t.svar.length} svar` }, ...t.svar.map((s) => ({ tid: s.tid, type: 'svar', id: s.id, navn: byId.get(s.id)?.name || 'Svar', kilde: s.kilde, prosjekt: t.prosjekt, detalj: `på «${t.navn}»` })), ...(t.konklusjon ? [{ tid: t.konklusjon.tid, type: 'konklusjon', id: t.konklusjon.id, navn: byId.get(t.konklusjon.id)?.name || 'Konklusjon', kilde: byId.get(t.konklusjon.id)?.source || '', prosjekt: t.prosjekt, detalj: t.konklusjon.status }] : [])]),
    ...vanlige.map((x) => rad(x, 'sak', x.kind || 'capture')),
    ...delinger.map((x) => rad(x, 'deling')),
    ...filer.map((x) => ({ ...rad(x, 'fil'), href: (x.links || []).find((l) => l.kind === 'file')?.href || '' })),
    ...versjoner.map((v) => ({ tid: v.mtime || 0, type: 'versjon', id, navn: `${a.name} · ${String(v.name || '').replace(/-\d+$/, '')}`, kilde: '', prosjekt: a.project, detalj: 'tidligere versjon' })),
    ...utlev.map((u) => ({ tid: u.at || 0, type: 'utlevert', id, navn: `Utlevert til ${u.mottaker || u.client || '—'}`, kilde: u.modell || u.client || '', prosjekt: a.project, detalj: `nivå ${(u.saker || []).find((s) => s.id === id)?.level || u.level || u.nivå || '—'}${u.saker?.length > 1 ? ` · med ${u.saker.length - 1} ${u.saker.length === 2 ? 'annen sak' : 'andre saker'}` : ''}` })),
  ].sort((x, y) => x.tid - y.tid)                                                            // nyeste nederst
  const sist = Math.max(a.capturedAt || 0, ...tidslinje.map((r) => r.tid))
  return { id, name: a.name, project: a.project, kind: a.kind || 'capture', status: statusOf(a), åpen: a.status !== 'endelig', arbeid: true, capturedAt: a.capturedAt, version: a.version || 1,
    samtaler, tråder: tråderUt, saker: vanlige.map((x) => rad(x, 'sak', x.kind || 'capture')), delinger: delinger.map((x) => rad(x, 'deling')), filer: filer.map((x) => ({ ...rad(x, 'fil'), href: (x.links || []).find((l) => l.kind === 'file')?.href || '' })),
    versjoner: versjoner.map((v) => ({ name: v.name, mtime: v.mtime, size: v.size })), utleveringer: utlev, tidslinje, sist,
    tall: { samtaler: samtaler.length, tråder: tråderUt.length, saker: vanlige.length, delinger: delinger.length, filer: filer.length, versjoner: versjoner.length, utleveringer: utlev.length } }
}
// «Del av: <arbeid> · samtale 7 av 12». slag = samtale | tråd | sak; nr blant samme slag, sortert på tid.
export function delAv(atoms, a, følgere = følgereAv(atoms)) {
  if (!a?.hørerTil) return null
  const arbeid = atoms.find((x) => x.id === a.hørerTil)
  if (!arbeid) return null
  const slag = a.kind === 'samtale' ? 'samtale' : a.kind === 'prompt' ? 'tråd' : 'sak'
  const like = (følgere.get(arbeid.id) || []).filter((x) => (x.kind === 'samtale' ? 'samtale' : x.kind === 'prompt' ? 'tråd' : 'sak') === slag).sort((x, y) => startAv(x) - startAv(y))
  const nr = like.findIndex((x) => x.id === a.id) + 1
  return { id: arbeid.id, name: arbeid.name, project: arbeid.project, status: statusOf(arbeid), slag, nr: nr || like.length + 1, av: Math.max(like.length, nr || 0), tekst: `Del av: ${arbeid.name} · ${slag} ${nr || like.length + 1} av ${Math.max(like.length, nr || 0)}` }
}
// Koblingen skrives i minnet; kalleren lagrer. Aldri en sløyfe (arbeidet kan ikke selv høre til saken), aldri seg selv.
export function settHørerTil(atoms, id, arbeidId) {
  const a = atoms.find((x) => x.id === id), b = atoms.find((x) => x.id === arbeidId)
  if (!a) throw new Error(`fant ikke sak ${id}`)
  if (!b) throw new Error(`fant ikke arbeidet ${arbeidId}`)
  if (a.id === b.id) throw new Error('en sak kan ikke høre til seg selv')
  for (let x = b, i = 0; x && i < 20; x = atoms.find((y) => y.id === x.hørerTil), i++) if (x.id === a.id) throw new Error(`«${b.name}» hører alt til «${a.name}» — det ville blitt en sløyfe`)
  const før = a.hørerTil || null
  a.hørerTil = b.id
  if (a.hørerTilForslag !== undefined) a.hørerTilForslag = ''   // tom (ikke slettet): lageret beholder et felt som står i fila men mangler i minnet — en tom verdi er et valg
  markDirty(atoms, a.id)
  return { atom: a, arbeid: b, før, endret: før !== b.id }
}
export function løsne(atoms, id) {
  const a = atoms.find((x) => x.id === id)
  if (!a) throw new Error(`fant ikke sak ${id}`)
  const før = a.hørerTil || null
  a.hørerTil = ''                                                 // tom, ikke slettet (se settHørerTil) — fila mister nøkkelen ved neste skriving
  markDirty(atoms, a.id)
  return { atom: a, før, endret: !!før }
}
export const FORSLAG_NEI = 'nei'   // brukeren sa Nei til forslaget — husket i fila så hooken ikke foreslår det samme igjen
export function avvisForslag(atoms, id) {
  const a = atoms.find((x) => x.id === id)
  if (!a) throw new Error(`fant ikke sak ${id}`)
  const før = a.hørerTilForslag || null
  a.hørerTilForslag = FORSLAG_NEI
  markDirty(atoms, a.id)
  return { atom: a, før }
}
export const harForslag = (a) => !!a?.hørerTilForslag && a.hørerTilForslag !== FORSLAG_NEI && !a.hørerTil
// «Gjør til arbeid»: flagget settes (og status utkast når ingen er satt — et arbeid er åpent til det låses); av: flagget bort (koblingene fra andre saker står)
export function gjørTilArbeid(atoms, id, { av = false } = {}) {
  const a = atoms.find((x) => x.id === id)
  if (!a) throw new Error(`fant ikke sak ${id}`)
  if (av) a.arbeid = false                                        // false, ikke slettet (se settHørerTil) — skrives ikke til fila
  else { a.arbeid = true; if (!a.status) setStatus(a, 'utkast') }
  markDirty(atoms, a.id)
  return { atom: a, arbeid: !av }
}

// ── Regelen for kobling (4a) og forslag (4b) ────────────────────────────────────────────────────────────────────────────────────
// Automatisk når (i rekkefølge): FORELDER — Code-økta er startet fra en annen økt (barnet har forelderens local_-id fra notatmappa i første melding;
// forelderens samtale-sak har `vert` = samme id) → forelderens arbeid, eller forelderen selv; GREN — grenen/worktree-navnet deler stamme
// («claude/friksjon-20-arbeid-6bc509» → «claude/friksjon-20-arbeid») med en annen samtale-sak i prosjektet; TITTEL — tittelen er lik (eller inneholder/inngår i,
// ≥ 12 tegn) navnet på et arbeid i prosjektet. Ellers FORSLAG: det nyeste åpne arbeidet i prosjektet (rørt siste 14 dager) — brukeren svarer Ja/Annet/Nei.
export const GREN_UTEN = new Set(['', 'main', 'master', 'head', 'develop', 'dev', 'trunk'])
export const grenStamme = (g) => String(g || '').trim().replace(/-[0-9a-f]{6,8}$/i, '').replace(/-\d+$/, '')
export function arbeidForslag(atoms, { prosjekt = '', tittel = '', gren = '', forelder = '', sid = '', nå = Date.now() } = {}) {
  const følgere = følgereAv(atoms)
  const iProsjekt = (a) => !prosjekt || same(a.project, prosjekt)
  const egenNøkkel = sid ? `okt:${sid}` : null
  const ikkeEgen = (a) => !egenNøkkel || (a.key !== egenNøkkel && a.key !== `samtale:${sid}` && a.key !== `codex:${sid}`)
  const finnes = (id) => atoms.some((x) => x.id === id)
  if (forelder) {
    const f = atoms.find((a) => a.vert === forelder && a.kind === 'samtale' && ikkeEgen(a))
    if (f) { const id = arbeidAv(f); if (finnes(id)) return { hørerTil: id, grunn: 'forelder', via: f.id, forslag: null } }
  }
  const stamme = grenStamme(gren)
  if (stamme && !GREN_UTEN.has(stamme.toLowerCase()) && !GREN_UTEN.has(String(gren).toLowerCase())) {
    const kandidater = atoms.filter((a) => a.kind === 'samtale' && a.gren && iProsjekt(a) && ikkeEgen(a) && grenStamme(a.gren) === stamme).sort((x, y) => (x.capturedAt || 0) - (y.capturedAt || 0))
    const f = kandidater.find((a) => a.hørerTil) || kandidater[0]
    if (f) { const id = arbeidAv(f); if (finnes(id)) return { hørerTil: id, grunn: 'gren', via: f.id, forslag: null } }
  }
  const t = norm(tittel)
  if (t.length >= 12) {
    const treff = atoms.filter((a) => erArbeid(a, følgere) && iProsjekt(a) && ikkeEgen(a) && a.status !== 'endelig').map((a) => ({ a, n: norm(a.name) })).filter(({ n }) => n.length >= 12 && (n === t || n.includes(t) || t.includes(n))).sort((x, y) => (x.n === t ? -1 : 0) - (y.n === t ? -1 : 0) || (y.a.capturedAt || 0) - (x.a.capturedAt || 0))
    if (treff[0]) return { hørerTil: treff[0].a.id, grunn: 'tittel', via: treff[0].a.id, forslag: null }
  }
  const åpne = åpneArbeider(atoms, { prosjekt, nå }).filter((r) => !egenNøkkel || atoms.find((x) => x.id === r.id)?.key !== egenNøkkel)
  return { hørerTil: null, grunn: null, via: null, forslag: åpne[0]?.id || null, åpne: åpne.slice(0, 5).map((r) => ({ id: r.id, name: r.name, samtaler: r.samtaler, sist: r.sist })) }
}

// ── «Vurder dette arbeidet» (6) ─────────────────────────────────────────────────────────────────────────────────────────────────
export const VURDERING_STANDARD = 'Vurder dette arbeidet kort og kritisk: Hva mangler? Hva er feil eller usikkert? Hva bør sjekkes før dette brukes? Svar punktvis, med det viktigste først.'
export const vurderingsprompt = () => { const c = readConfig().spor; return c && typeof c === 'object' && typeof c.vurderingsprompt === 'string' && c.vurderingsprompt.trim() ? c.vurderingsprompt.trim() : VURDERING_STANDARD }
export function settVurderingsprompt(tekst) {
  const t = String(tekst || '').replace(/\s+$/g, '').trim()
  if (t.length > 2000) throw new Error('vurderingsprompten er for lang (maks 2 000 tegn)')
  const c = readConfig()
  writeConfig({ spor: { ...(c.spor && typeof c.spor === 'object' ? c.spor : {}), vurderingsprompt: t && t !== VURDERING_STANDARD ? t : undefined } })
  return vurderingsprompt()
}
// Pakken: arbeidet selv (L), den siste samtalen i løpet (siste svar og filene står i dens L) og filene som ble skrevet — innhold fra arkivet, som kilder til Spør.
// Kalles på et arbeid ELLER på en samtale-sak (da er pakken samtalen + filene, og svarene henger på samtalens arbeid når det finnes, ellers på samtalen).
export function vurderPakke(atoms, id) {
  const byId = new Map(atoms.map((a) => [a.id, a]))
  const a = byId.get(id)
  if (!a) throw new Error(`fant ikke sak ${id}`)
  const følgere = følgereAv(atoms)
  const kilder = []
  const legg = (x, hvorfor) => { if (x && !kilder.some((k) => k.id === x.id)) kilder.push({ id: x.id, name: x.name, project: x.project, kind: x.kind || 'capture', hvorfor }) }
  if (a.kind === 'samtale' && !erArbeid(a, følgere)) {
    // en samtale-sak: samtalen (siste svar og filene står i L) + filene den skrev; svarene henger på samtalens arbeid når det finnes, ellers på samtalen selv
    const arbeidet = (a.hørerTil && byId.get(a.hørerTil)) || a
    const filer = filerFor(atoms, arbeidet.id, [a], følgere).filter((f) => f.hørerTil === arbeidet.id ? (f.convo || '').toLowerCase() === (a.convo || a.name || '').toLowerCase() || true : true)
    legg(a, 'samtalen (siste svar og filene står i L)')
    for (const f of filer.slice(-12)) legg(f, 'fil skrevet i samtalen')
    return { arbeid: { id: arbeidet.id, name: arbeidet.name, project: arbeidet.project, status: statusOf(arbeidet) }, hørerTil: arbeidet.id, siste: { id: a.id, name: a.name, source: a.source }, kilder, prompt: vurderingsprompt(), standard: vurderingsprompt() === VURDERING_STANDARD, filer: filer.length }
  }
  const samtaler = (følgere.get(a.id) || []).filter((x) => x.kind === 'samtale').sort((x, y) => startAv(x) - startAv(y))
  const siste = samtaler.at(-1) || null
  const filer = filerFor(atoms, a.id, siste ? [siste] : [], følgere)
  legg(a, a.kind === 'samtale' ? 'arbeidet (samtalen som samler)' : 'arbeidet')
  if (siste) legg(siste, `siste samtale (${siste.source || 'Claude'}) — siste svar og filene står i L`)
  for (const f of filer.slice(-12)) legg(f, 'fil skrevet i løpet')
  return { arbeid: { id: a.id, name: a.name, project: a.project, status: statusOf(a) }, hørerTil: a.id, siste: siste ? { id: siste.id, name: siste.name, source: siste.source } : null,
    kilder, prompt: vurderingsprompt(), standard: vurderingsprompt() === VURDERING_STANDARD, filer: filer.length }
}
export const basenavn = (p) => path.basename(String(p || ''))
