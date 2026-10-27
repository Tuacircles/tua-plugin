// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
import path__default from 'node:path';
import { S_MAX } from './store.mjs';

// samtaletekst.js — S og M for SAMTALER etter regel, og lesing av et lagret transkript. Skilt ut fra import.js i skive 1 av arbeidsstykke 33
// (27.10.2026, V22) så motoren (motor.js → samtale.js) kan bruke samme regel for Tua-samtaler uten å dra inn import.js (som går om innlesing.js → motor.js).
// import.js eksporterer alt herfra videre, så hooken og testene er uendret. Ingen lagring, ingen modell — bare tekst.
//
//   nyttPar(prompt, at)            ett par: én brukermelding og svarene som kom etter den
//   samtaleS({pairs, turns, …})    S = siste vending: «Sist: <prompt> → <første setning av svaret> · N vendinger · periode» (friksjon 9)
//   samtaleM({prompts, …})         M = første spørsmål + filene + siste svar (friksjon 20)
//   samtaleFraSak(content)         samme regel lest ut av en lagret samtale-sak (importens «**Bruker:**»/«**Claude:**», hookens «## Oppgaver»,
//                                  og fra skive 1 Tua-samtalenes «**Du · tid:**» / «**<modell> · nivå:**» med konklusjoner som streker)


const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Et par = én brukermelding og svarene som kom etter den (til neste brukermelding). Leserne leverer pairs = [{prompt, at, answers: [tekst]}].
const nyttPar = (prompt, at) => ({ prompt: String(prompt || ''), at: at || null, answers: [], svar: '' });   // svar: siste assistent-tekst i paret, uansett lengde (til S)
// S etter regel for SAMTALER (friksjon 9, bruksdag 1, 24.10.2026): avisen skal fortelle hva som er nytt, og for en samtale er det siste vending —
// ikke første prompt. «Sist: <siste prompt, kort> → <første setning av svaret> · N vendinger · <første dato>–<siste dato>». Tittelen beholdes.
// Regelskrevet (by: regel), så ny import erstatter den når samtalen har fått nye vendinger; menneskeskrevet S røres aldri (V10, mergeLevels).
const renTekst = (t) => flat(String(t || '').replace(/^#+\s*/gm, '').replace(/[*_`>]/g, ''));
const datoKort = (t) => (t ? new Date(t).toLocaleDateString('no-NO', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
const førsteSetning = (t, max) => { const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/); return m && m[0].length >= 20 && m[0].length <= max ? m[0] : clip(t, max) };   // alltid bare første setning når den finnes
function samtaleS({ pairs = [], turns, first, last } = {}) {
  const sistePar = [...(pairs || [])].reverse().find((p) => flat(p.prompt));
  const n = turns ?? (pairs || []).length;
  const d1 = datoKort(first), d2 = datoKort(last || first);
  const periode = d1 && d2 && d1 !== d2 ? (d1.slice(-4) === d2.slice(-4) ? `${d1.slice(0, -4)}–${d2}` : `${d1}–${d2}`) : d2 || d1;
  const hale = [`${n} ${n === 1 ? 'vending' : 'vendinger'}`, periode].filter(Boolean).join(' · ');
  if (!sistePar) return hale
  const svar = renTekst(sistePar.svar || sistePar.answers?.at(-1) || '');
  const plass = S_MAX - hale.length - 3;                                     // « · » mellom hode og hale
  let hode = `Sist: ${clip(renTekst(sistePar.prompt), Math.min(140, plass))}`;
  if (svar && plass - hode.length - 3 >= 40) hode += ` → ${førsteSetning(svar, plass - hode.length - 3)}`;
  return clip(`${hode} · ${hale}`, S_MAX)
}
// Friksjon 20 (økt-sakene, Erik 25.10.2026: «teksten er uryddig og litt meningsløs»): M for en samtale er et ekte sammendrag av hva samtalen gjorde — etter regel:
// første menneskeprompt + siste svar (kortet) + filene som ble skrevet, innenfor M_MAX. En lokal modell (gemma) kan skrive den på nytt (review --samtaler / Innstillinger),
// merket M_av. S er fortsatt samtaleS (siste vending, én linje).
const M_MAKS = 2500;
const avsnittKutt = (t, maks) => { const s = String(t || '').replace(/\r\n?/g, '\n').trim(); if (s.length <= maks) return s; const k = s.slice(0, maks); const i = Math.max(k.lastIndexOf('\n\n'), k.lastIndexOf('. ')); return (i > maks * 0.5 ? k.slice(0, i + 1) : k.slice(0, maks - 1)).trimEnd() + ' …' };
function samtaleM({ prompts = [], lastAssistant = '', filer = [], turns, first, last, kilde = '' } = {}) {
  const første = flat(prompts.find((p) => flat(p)) || '');
  const siste = String(lastAssistant || '').trim();
  const n = turns ?? prompts.length;
  const d1 = datoKort(first), d2 = datoKort(last || first);
  const hale = [kilde, `${n} ${n === 1 ? 'vending' : 'vendinger'}`, d1 && d2 && d1 !== d2 ? `${d1}–${d2}` : d2 || d1].filter(Boolean).join(' · ');
  const deler = [];
  if (første) deler.push(`**Første spørsmål:** ${clip(første, 400)}`);
  if (filer.length) deler.push(`**Filer skrevet (${filer.length}):** ${filer.slice(0, 10).map((f) => path__default.basename(String(f))).join(' · ')}${filer.length > 10 ? ` · … og ${filer.length - 10} til` : ''}`);
  const plass = M_MAKS - deler.join('\n\n').length - hale.length - 40;
  if (siste && plass > 200) deler.push(`**Siste svar:** ${avsnittKutt(siste, Math.min(1600, plass))}`);
  deler.push(`_${hale}_`);
  return deler.join('\n\n').slice(0, M_MAKS)
}

export { nyttPar, samtaleM, samtaleS };
