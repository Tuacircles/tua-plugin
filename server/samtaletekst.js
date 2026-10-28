// samtaletekst.js — S og M for SAMTALER etter regel, og lesing av et lagret transkript. Skilt ut fra import.js i skive 1 av arbeidsstykke 33
// (27.10.2026, V22) så motoren (motor.js → samtale.js) kan bruke samme regel for Tua-samtaler uten å dra inn import.js (som går om innlesing.js → motor.js).
// import.js eksporterer alt herfra videre, så hooken og testene er uendret. Ingen lagring, ingen modell — bare tekst.
//
//   nyttPar(prompt, at)            ett par: én brukermelding og svarene som kom etter den
//   samtaleS({pairs, turns, …})    S = siste vending: «Sist: <prompt> → <første setning av svaret> · N vendinger · periode» (friksjon 9)
//   samtaleM({prompts, …})         M = første spørsmål + filene + siste svar (friksjon 20)
//   samtaleFraSak(content)         samme regel lest ut av en lagret samtale-sak (importens «**Bruker:**»/«**Claude:**», hookens «## Oppgaver»,
//                                  og fra skive 1 Tua-samtalenes «**Du · tid:**» / «**<modell> · nivå:**» med konklusjoner som streker)

import path from 'node:path'
import { S_MAX } from './store.js'

export const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim()
export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
// Skive 3 (arb. 33, 28.10.2026) — midnattsfeilen: hodelinja i et transkript skrives med LOKAL dato (ikke toISOString, som er UTC og ligger et døgn bak
// mellom midnatt og 01/02), og en dato «YYYY-MM-DD» lest tilbake fra hodet tolkes som lokal midnatt — så samtaleS gir samme periode skrevet som lest.
const to2 = (n) => String(n).padStart(2, '0')
export const isoLokal = (t) => { const d = new Date(t); return `${d.getFullYear()}-${to2(d.getMonth() + 1)}-${to2(d.getDate())}` }
export const lokalDato = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : (Date.parse(s) || null) }
// Tittelen på en samtale, kortet etter én regel (planen §7, skive 3): første setning når den er høyst 60 tegn, ellers de første 60 tegnene (som Code-samtalene).
// Brukes på Cowork-titler ved import (meta.title kan være hele prompten) og i foldingen av gjentatte kjøringer (regler.js har samme regel).
export const kortTittel = (t) => { const s = flat(t); if (!s) return ''; if (s.length <= 60) return s; const m = s.match(/^[\s\S]*?[.!?](?=\s|$)/); return clip(m && m[0].length <= 60 ? m[0] : s, 60) }

// Et par = én brukermelding og svarene som kom etter den (til neste brukermelding). Leserne leverer pairs = [{prompt, at, answers: [tekst]}].
export const nyttPar = (prompt, at) => ({ prompt: String(prompt || ''), at: at || null, answers: [], svar: '' })   // svar: siste assistent-tekst i paret, uansett lengde (til S)
// S etter regel for SAMTALER (friksjon 9, bruksdag 1, 24.10.2026): avisen skal fortelle hva som er nytt, og for en samtale er det siste vending —
// ikke første prompt. «Sist: <siste prompt, kort> → <første setning av svaret> · N vendinger · <første dato>–<siste dato>». Tittelen beholdes.
// Regelskrevet (by: regel), så ny import erstatter den når samtalen har fått nye vendinger; menneskeskrevet S røres aldri (V10, mergeLevels).
const renTekst = (t) => flat(String(t || '').replace(/^#+\s*/gm, '').replace(/[*_`>]/g, ''))
const datoKort = (t) => (t ? new Date(t).toLocaleDateString('no-NO', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '')
const førsteSetning = (t, max) => { const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/); return m && m[0].length >= 20 && m[0].length <= max ? m[0] : clip(t, max) }   // alltid bare første setning når den finnes
export function samtaleS({ pairs = [], turns, first, last } = {}) {
  const sistePar = [...(pairs || [])].reverse().find((p) => flat(p.prompt))
  const n = turns ?? (pairs || []).length
  const d1 = datoKort(first), d2 = datoKort(last || first)
  const periode = d1 && d2 && d1 !== d2 ? (d1.slice(-4) === d2.slice(-4) ? `${d1.slice(0, -4)}–${d2}` : `${d1}–${d2}`) : d2 || d1
  const hale = [`${n} ${n === 1 ? 'vending' : 'vendinger'}`, periode].filter(Boolean).join(' · ')
  if (!sistePar) return hale
  const svar = renTekst(sistePar.svar || sistePar.answers?.at(-1) || '')
  const plass = S_MAX - hale.length - 3                                     // « · » mellom hode og hale
  let hode = `Sist: ${clip(renTekst(sistePar.prompt), Math.min(140, plass))}`
  if (svar && plass - hode.length - 3 >= 40) hode += ` → ${førsteSetning(svar, plass - hode.length - 3)}`
  return clip(`${hode} · ${hale}`, S_MAX)
}
// Friksjon 20 (økt-sakene, Erik 25.10.2026: «teksten er uryddig og litt meningsløs»): M for en samtale er et ekte sammendrag av hva samtalen gjorde — etter regel:
// første menneskeprompt + siste svar (kortet) + filene som ble skrevet, innenfor M_MAX. En lokal modell (gemma) kan skrive den på nytt (review --samtaler / Innstillinger),
// merket M_av. S er fortsatt samtaleS (siste vending, én linje).
const M_MAKS = 2500
const avsnittKutt = (t, maks) => { const s = String(t || '').replace(/\r\n?/g, '\n').trim(); if (s.length <= maks) return s; const k = s.slice(0, maks); const i = Math.max(k.lastIndexOf('\n\n'), k.lastIndexOf('. ')); return (i > maks * 0.5 ? k.slice(0, i + 1) : k.slice(0, maks - 1)).trimEnd() + ' …' }
export function samtaleM({ prompts = [], lastAssistant = '', filer = [], turns, first, last, kilde = '' } = {}) {
  const første = flat(prompts.find((p) => flat(p)) || '')
  const siste = String(lastAssistant || '').trim()
  const n = turns ?? prompts.length
  const d1 = datoKort(first), d2 = datoKort(last || first)
  const hale = [kilde, `${n} ${n === 1 ? 'vending' : 'vendinger'}`, d1 && d2 && d1 !== d2 ? `${d1}–${d2}` : d2 || d1].filter(Boolean).join(' · ')
  const deler = []
  if (første) deler.push(`**Første spørsmål:** ${clip(første, 400)}`)
  if (filer.length) deler.push(`**Filer skrevet (${filer.length}):** ${filer.slice(0, 10).map((f) => path.basename(String(f))).join(' · ')}${filer.length > 10 ? ` · … og ${filer.length - 10} til` : ''}`)
  const plass = M_MAKS - deler.join('\n\n').length - hale.length - 40
  if (siste && plass > 200) deler.push(`**Siste svar:** ${avsnittKutt(siste, Math.min(1600, plass))}`)
  deler.push(`_${hale}_`)
  return deler.join('\n\n').slice(0, M_MAKS)
}
// Samme regel lest ut av en lagret samtale-sak (L er transkriptet «**Bruker:** …» / «**Claude:** …» med hodelinje) — til review.js --samtaler,
// som skriver S på nytt for samtaler som alt ligger i arkivet uten å trenge øktfila eller Desktop-cachen. null når teksten ikke er et transkript.
// Friksjon 20: leser også hookens form (## Oppgaver med «- HH:MM — prompt», ## Filer skrevet, ## Siste svar) — så S og M kan skrives på nytt for begge.
// «Du · 28.10.2026, 14:02» → ms (lokal), ellers null. Hookens «- HH:MM — …» har bare klokkeslett og får ingen tid.
const tidAvHode = (h) => { const m = /(\d{1,2})\.(\d{1,2})\.(\d{4}),? (\d{1,2}):(\d{2})/.exec(String(h || '')); return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])).getTime() : null }
export function samtaleFraSak(content, { first = null, last = null } = {}) {
  const tekst = String(content || '').replace(/\r\n?/g, '\n').replace(/\n\n---\n\n\*\*Konklusjon[^*\n]{0,40}:\*\* [^\n]*(?:\n(?!\n\*\*)[^\n]*)*/g, '').replace(/\n\n---(?=\n\n|$)/g, '')   // skive 1 (arb. 33): Tua-samtalenes konklusjonsstreker er ikke vendinger
  const hode = tekst.split(/\n\s*\n/)[1] || ''
  const datoer = [...hode.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => lokalDato(m[1])).filter(Boolean)   // skive 3: lokal dato, samme som samtaleS skriver
  const oppgaver = hode.match(/(\d+) oppgaver/)
  const pairs = []
  for (const m of tekst.matchAll(/^\*\*(Bruker|[^*\n]{1,40}):\*\* ([\s\S]*?)(?=\n\n\*\*[^*\n]{1,40}:\*\* |\n\n_\(forkortet|\n\n\[(?:Write|Edit|NotebookEdit): |$)/gm)) {
    if (m[1] === 'Bruker' || /^Du(?: ·|$)/.test(m[1])) pairs.push(nyttPar(m[2].trim(), tidAvHode(m[1])))   // «Du · <tid>» er Tua-samtalenes brukerlinje (skive 1, arb. 33); tida leses med (skive 3)
    else if (pairs.length && m[2].trim()) { pairs.at(-1).answers.push(m[2].trim()); pairs.at(-1).svar = m[2].trim() }
  }
  let filer = [], lastAssistant = pairs.at(-1)?.svar || ''
  if (!pairs.length) {
    const opp = tekst.match(/\n## Oppgaver\n([\s\S]*?)(?=\n## |$)/)
    if (!opp) return null
    for (const l of opp[1].split('\n')) { const m = l.match(/^- (?:\d{1,2}[.:]\d{2} — )?([\s\S]+)$/); if (m && m[1].trim() && !/^… og \d+ til$/.test(m[1].trim())) pairs.push(nyttPar(m[1].trim(), null)) }
    const fil = tekst.match(/\n## Filer skrevet\n([\s\S]*?)(?=\n## |$)/); if (fil) filer = fil[1].split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean)
    const sv = tekst.match(/\n## Siste svar\n([\s\S]*)$/); lastAssistant = sv ? sv[1].trim() : ''
    if (pairs.length && lastAssistant) { pairs.at(-1).svar = lastAssistant; pairs.at(-1).answers.push(lastAssistant) }
    if (!pairs.length) return null
  } else for (const m of tekst.matchAll(/^\[(?:Write|Edit|NotebookEdit): ([^\]\n]+)\]$/gm)) if (!filer.includes(m[1])) filer.push(m[1])
  const turns = oppgaver ? Number(oppgaver[1]) : pairs.length
  const d1 = datoer[0] || first, d2 = datoer[1] || datoer[0] || last
  return { pairs, prompts: pairs.map((p) => p.prompt), lastAssistant, filer, turns, first: d1, last: d2, S: samtaleS({ pairs, turns, first: d1, last: d2 }), M: samtaleM({ prompts: pairs.map((p) => p.prompt), lastAssistant, filer, turns, first: d1, last: d2, kilde: (hode.match(/^_?([^·_]+?) ·/) || [])[1]?.trim() || '' }) }
}
export function samtaleSFraTranskript(content, opts = {}) { const r = samtaleFraSak(content, opts); return r ? r.S : null }
