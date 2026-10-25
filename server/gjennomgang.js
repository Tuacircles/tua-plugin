// gjennomgang.js — «Ny gjennomgang» (AI3, «levende arkiv»: arkivet kompunderer når en bedre modell kommer). Runde 3c, 24.10.2026.
//
// Handling på saken («Skriv M på nytt med <modell>») og på prosjektet («Ny gjennomgang av prosjektet»): S (ingress) og M (sammendrag) som er skrevet
// av en regel eller en modell, skrives på nytt med den valgte skriveren — standard er den lokale modellen (Ollama, standardmodellen fra Innstillinger);
// Claude bare når det er valgt eksplisitt (skriver: 'claude' → gjennom motoren med Utlevert-linje). Menneskeskrevet S/M røres ALDRI (V10).
// Nivået merkes med hvem som skrev det (`S_av`/`M_av`: «Ollama · gemma3:4b») og når (`S_dato`/`M_dato`). Versjonen på saken beholdes (bare nivåene
// byttes — forrige fil bevares i .tua/versions/ av save()). Fremdrift strømmes som hendelser (på): start · sak · skrevet · hoppet · slutt.
// Samme funksjon brukes av POST /api/gjennomgang i broen; kortet i Claude (3a) kan kalle den samme ruta senere.
//
// Alt går gjennom motorens skrivNivåer (skjerming, fail closed for eksterne skrivere, regler som fallback) — ingen vei utenom.

import { load, save, needsLevel, mkLevel, SHORT_L, LONG_L, erMenneskeskrevet, markDirty, sisteSave, klasseAv } from './store.js'
import { skrivNivåer, skriver as velgSkriver } from './motor.js'

export const NIVÅER_GJENNOMGANG = ['S', 'M', 'begge']
const isoNå = () => new Date().toISOString()
// Hvilke saker en gjennomgang omfatter: én sak (id), et prosjekt, eller en liste med id-er. Drift og prompter holdes utenfor (en prompt er brukerens egen tekst; drift er logg).
export function sakerFor(atoms, { id = null, ids = null, prosjekt = null } = {}) {
  if (id) return atoms.filter((a) => a.id === id)
  if (Array.isArray(ids) && ids.length) { const set = new Set(ids.map(String)); return atoms.filter((a) => set.has(a.id)) }
  if (prosjekt) return atoms.filter((a) => a.project.toLowerCase() === String(prosjekt).toLowerCase() && a.drift !== true && a.kind !== 'prompt')
  return []
}
// Hva ville skje — uten modell: per sak hvilke nivåer som skrives, og hvorfor de som hoppes over, hoppes over. `tvang`: skriv også nivåer som finnes og er gjeldende.
export function planFor(atoms, { nivå = 'M', tvang = true, ...utvalg } = {}) {
  const saker = sakerFor(atoms, utvalg)
  const vil = nivå === 'begge' ? ['S', 'M'] : [NIVÅER_GJENNOMGANG.includes(nivå) ? nivå : 'M']
  const plan = []
  for (const a of saker) {
    const L = (a.content || '').length
    const nivåer = [], hoppet = []
    for (const n of vil) {
      const lv = a.levels?.[n]
      if (lv?.by === 'menneske') { hoppet.push(`${n}: menneskeskrevet (V10)`); continue }
      if (n === 'S' && L <= SHORT_L) { hoppet.push('S: kort sak — L er S'); continue }
      if (n === 'M' && L <= LONG_L) { hoppet.push('M: kort sak — trenger ikke M'); continue }
      if (!tvang && lv?.text && !needsLevel(a, n)) { hoppet.push(`${n}: finnes og er gjeldende`); continue }
      nivåer.push(n)
    }
    plan.push({ id: a.id, name: a.name, project: a.project, kind: a.kind || 'capture', klasse: klasseAv(a), version: a.version || 1, tegn: L, nivåer, hoppet, S_av: a.levels?.S?.by || null, M_av: a.levels?.M?.by || null })
  }
  const tall = { saker: saker.length, skrives: plan.filter((p) => p.nivåer.length).length, S: plan.filter((p) => p.nivåer.includes('S')).length, M: plan.filter((p) => p.nivåer.includes('M')).length, menneske: plan.filter((p) => p.hoppet.some((h) => /menneskeskrevet/.test(h))).length, korte: plan.filter((p) => !p.nivåer.length && p.hoppet.every((h) => /kort sak/.test(h))).length }
  return { plan, tall, nivå: vil.join('+') }
}
// Kjør. skriver: auto (Ollama → regel) | ollama | test | regel | claude (bare når brukeren valgte det). Lagrer underveis (hver 10. sak) og til slutt — dirty-sporing i lageret
// gjør at bare de sakene som fikk nye nivåer skrives. Returnerer { skrevet, hoppet, feilet, filer, modell, av, saker: [{id, nivåer}] }.
export async function gjennomgang({ atoms = null, nivå = 'M', tvang = true, skriver = 'auto', klient = 'app', dryRun = false, signal, på = () => {}, ...utvalg } = {}) {
  const liste = atoms || load()
  const { plan, tall } = planFor(liste, { nivå, tvang, ...utvalg })
  const v = await velgSkriver(skriver === 'auto' ? undefined : skriver)
  const modell = v.m ? (v.modell || v.m.modell || v.m.id) : null
  const av = v.m ? (v.m.test ? 'test' : `${v.m.label.split(' (')[0]} · ${modell}`) : 'regel'
  på('start', { ...tall, modell, av, skriver: v.m ? v.m.id : 'regel', lokalt: !v.m || !!v.m.local || !!v.m.test, dryRun, ...(v.grunn ? { grunn: v.grunn } : {}) })
  const ut = { skrevet: 0, hoppet: 0, feilet: 0, filer: 0, modell, av, saker: [], dryRun }
  if (dryRun) { ut.plan = plan; på('slutt', ut); return ut }
  if (skriver === 'claude' && v.m?.id !== 'claude') throw new Error('Claude er ikke klar som skriver (ingen nøkkel) — ingenting er skrevet')
  let i = 0, sidenLagring = 0
  for (const p of plan) {
    i++
    if (signal?.aborted) break
    const a = liste.find((x) => x.id === p.id)
    if (!a || !p.nivåer.length) { ut.hoppet++; på('hoppet', { i, antall: plan.length, id: p.id, name: p.name, grunn: p.hoppet.join(' · ') || 'ingenting å skrive' }); continue }
    på('sak', { i, antall: plan.length, id: a.id, name: a.name, project: a.project, nivåer: p.nivåer })
    let sm
    try { sm = await skrivNivåer(a.content || '', { tittel: a.name, sak: { id: a.id, name: a.name, version: a.version || 1 }, prosjekt: a.project, klient, skriver: v.m ? v.m.id : 'regel', signal, på: () => {} }) }
    catch (e) { ut.feilet++; på('feil', { i, id: a.id, name: a.name, feil: e.message }); continue }
    if (skriver !== 'auto' && skriver !== 'regel' && sm.av === 'regel') { ut.feilet++; på('feil', { i, id: a.id, name: a.name, feil: sm.grunn || 'modellen svarte ikke — ingenting skrevet (regler ville ha erstattet modellens tekst)' }); continue }
    const nå = isoNå(), ver = a.version || 1
    const nivåer = []
    a.levels = { ...(a.levels || {}) }
    if (p.nivåer.includes('S') && sm.S) { a.levels.S = { ...mkLevel(sm.S, sm.av, ver), at: nå }; nivåer.push('S') }
    if (p.nivåer.includes('M') && sm.M) { a.levels.M = { ...mkLevel(sm.M, sm.M_av || sm.av, ver), at: nå }; nivåer.push('M') }
    if (!nivåer.length) { ut.hoppet++; på('hoppet', { i, antall: plan.length, id: a.id, name: a.name, grunn: sm.grunn || 'modellen ga ingen tekst' }); continue }
    markDirty(liste, a.id)
    ut.skrevet++; ut.saker.push({ id: a.id, name: a.name, nivåer, av: sm.av, modell: sm.modell || modell, tokens: sm.tokens || null, utlevert: !!sm.utlevert })
    på('skrevet', { i, antall: plan.length, id: a.id, name: a.name, nivåer, av: sm.av, modell: sm.modell || modell, S: a.levels.S?.text || '', M_tegn: a.levels.M?.text?.length || 0, utlevert: !!sm.utlevert })
    if (++sidenLagring >= 10) { ut.filer += save(liste); sidenLagring = 0 }
  }
  if (sidenLagring) ut.filer += save(liste)
  ut.konflikter = sisteSave.konflikter?.length || 0
  på('slutt', ut)
  return ut
}

// ── Friksjon 20 (økt-sakene, 25.10.2026): S og M på nytt for SAMTALE-saker etter samtaleregelen ───────────────────────────────────────────────
// Hookens økt-saker («Økt: …», oppgaveliste med systemtekst, klippet svar) og importens samtaler får S = siste vending (samtaleS) og M = ekte sammendrag
// (samtaleM: første spørsmål + siste svar + filene) lest ut av L (samtaleFraSak) — ingen øktfil eller Desktop-cache trengs. Med en lokal modell (skriver auto →
// Ollama) skrives M av modellen (merket M_av «Ollama · gemma3:4b»); uten: regelen (M_av regel). Menneskeskrevet S/M røres aldri (V10). Tittelen «Økt: …» mister
// prefikset. Samme funksjon bak `node review.js --samtaler [--dry-run] [--modell]` og POST /api/samtaler/gjennomgang (Innstillinger › Spør — Erik trykker).
export async function samtalerGjennomgang({ atoms = null, dryRun = false, skriver = 'regel', klient = 'app', signal, på = () => {}, maks = 0 } = {}) {
  const { samtaleFraSak } = await import('./import.js')
  const liste = atoms || load()
  const samtaler = liste.filter((a) => a.kind === 'samtale' || /^okt:/.test(String(a.key || '')) || (/^Økt:\s/.test(String(a.name || '')) && !erMenneskeskrevet(a)))
  const tall = { samtaler: samtaler.length, S: 0, M: 0, tittel: 0, kind: 0, menneske: 0, uendret: 0, uleselig: 0, saker: 0, feil: 0 }
  const v = skriver === 'regel' ? { m: null, regel: true } : await velgSkriver(skriver === 'auto' ? undefined : skriver)
  const av = v.m ? (v.m.test ? 'test' : `${v.m.label.split(' (')[0]} · ${v.modell || v.m.modell}`) : 'regel'
  på('start', { ...tall, av, modell: v.m ? v.modell || v.m.modell : null, lokalt: !v.m || !!v.m.local || !!v.m.test, dryRun })
  const vis = []
  let i = 0, sidenLagring = 0
  for (const a of samtaler) {
    if (signal?.aborted) break
    i++
    const r = samtaleFraSak(a.content, { first: a.createdAt, last: a.capturedAt })
    if (!r) { tall.uleselig++; continue }
    const endringer = []
    const oldS = a.levels?.S, oldM = a.levels?.M
    const nyttNavn = /^Økt:\s+/.test(a.name) ? a.name.replace(/^Økt:\s+/, '') : a.name
    let S = null, M = null, Mav = 'regel'
    if (oldS?.by === 'menneske') tall.menneske++
    else if (oldS?.text !== r.S) { S = r.S; endringer.push('S') }
    if (oldM?.by === 'menneske') { if (oldS?.by !== 'menneske') tall.menneske++ }
    else {
      M = r.M
      if (v.m && !dryRun) {
        try { const n = await skrivNivåer(a.content, { tittel: nyttNavn, sak: a, prosjekt: a.project, klient, skriver: v.m.id, signal }); if (n.M) { M = n.M; Mav = n.M_av || n.av } } catch (e) { tall.feil++ }
      }
      if (oldM?.text !== M) endringer.push('M')
    }
    if (nyttNavn !== a.name) endringer.push('tittel')
    if (a.kind !== 'samtale') endringer.push('kind')
    if (!endringer.length) { tall.uendret++; continue }
    tall.saker++
    for (const e of endringer) tall[e]++
    if (vis.length < 12) vis.push({ id: a.id, project: a.project, name: a.name, endringer, S_før: oldS?.text || '', S: S || oldS?.text || '', M_før: (oldM?.text || '').slice(0, 160), M: (M || '').slice(0, 160) })
    på('sak', { i, antall: samtaler.length, id: a.id, name: a.name, endringer })
    if (dryRun) continue
    const når = isoNå()
    if (S !== null) a.levels = { ...(a.levels || {}), S: { ...mkLevel(S, 'regel', a.version || 1), at: når } }
    if (M !== null && endringer.includes('M')) a.levels = { ...(a.levels || {}), M: { ...mkLevel(M, Mav, a.version || 1), at: når } }
    if (nyttNavn !== a.name) a.name = nyttNavn
    if (a.kind !== 'samtale') { a.kind = 'samtale'; if (!(a.tags || []).includes('samtale')) a.tags = ['samtale', ...(a.tags || []).filter((t) => t !== 'økt' && t !== 'auto')] }
    markDirty(liste, a.id)
    if (++sidenLagring >= 10 && !atoms) { save(liste); sidenLagring = 0 }
    if (maks && tall.saker >= maks) break
  }
  let filer = 0
  if (!dryRun && tall.saker && !atoms) { filer = save(liste) }
  const ut = { ...tall, av, filer, dryRun, vis }
  på('slutt', ut)
  return ut
}
