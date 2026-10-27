// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
import { øktIdAv as _ktIdAv, statusOf, isVault, levelOf } from './store.mjs';
import 'node:path';

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


const KILDE_TUA = 'Tua';
const erTuaSamtale = (a) => a?.kind === 'samtale' && String(a.source || '').trim() === KILDE_TUA;
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
const navnAv = (s) => s.convo || s.name || '';
// rekkefølge: tid (dato i fila har sekundoppløsning), så tidsstempelet i id-en (uid() = a_<ms i base36>_…) — to spørsmål i samme sekund står riktig
const idTid = (a) => { const m = /^a_([0-9a-z]+)_/.exec(String(a?.id || '')); return m ? parseInt(m[1], 36) : 0 };
const påTid = (x, y) => ((x.capturedAt || 0) - (y.capturedAt || 0)) || (idTid(x) - idTid(y));

// ── vendingene ───────────────────────────────────────────────────────────────
const erForskjeller = (a) => a?.kind === 'svar' && (a.tags || []).some((t) => String(t).toLowerCase() === 'forskjeller');
const erSvarSak = (a) => !!a && !erForskjeller(a) && (a.kind === 'svar' || (a.kind === 'capture' && (a.tags || []).includes('svar')));
const modellAv = (a) => String(a?.source || '').split(' (')[0].trim() || 'modell';
const nivåAv = (a, utenom) => [...new Set((a.derivedFrom || []).filter((d) => !utenom.has(d.id)).map((d) => d.level).filter(Boolean))].join('/') || null;
function vendingerFor(atoms, samtale) {
  if (!samtale) return []
  const peker = (a) => (a.derivedFrom || []).some((d) => d.id === samtale.id);
  const sid8 = _ktIdAv(samtale.key);
  const tua = erTuaSamtale(samtale);
  const sammeNavn = (a) => same(a.project, samtale.project) && (a.convo || '') === navnAv(samtale);
  const prompter = atoms.filter((a) => a.kind === 'prompt' && a.id !== samtale.id && (peker(a) || (sid8 && String(a.key || '').startsWith(`prompt:${sid8}:`)) || (tua && /^prompt:spor:/.test(String(a.key || '')) && sammeNavn(a)))).sort(påTid);
  const rad = (a, rolle, ekstra = {}) => ({ id: a.id, rolle, kind: a.kind || 'capture', tid: a.capturedAt || 0, modell: rolle === 'bruker' ? null : modellAv(a), kilde: a.source || '', nivå: null, S: levelOf(a, 'S').text, L: a.content || '', tegn: (a.content || '').length, versjon: a.version || 1,
    beholdt: a.beholdt === true || a.fanget === false, status: statusOf(a), vault: isVault(a), låst: false, ...ekstra });
  const ut = [];
  for (const p of prompter) {
    const svarIder = new Set((p.ga || []).map((g) => g.id));
    const svar = atoms.filter((a) => a.id !== p.id && erSvarSak(a) && (svarIder.has(a.id) || (a.derivedFrom || []).some((d) => d.id === p.id))).sort(påTid);
    const fsk = atoms.filter((a) => erForskjeller(a) && (a.derivedFrom || []).some((d) => svar.some((s) => s.id === d.id))).map((a) => a.id);
    const konk = atoms.filter((a) => a.kind === 'konklusjon' && (a.derivedFrom || []).some((d) => d.id === p.id)).sort(påTid);
    ut.push(rad(p, 'bruker', { prompt: p.id, forskjeller: fsk }));
    for (const s of svar) ut.push(rad(s, 'modell', { prompt: p.id, nivå: nivåAv(s, new Set([p.id, samtale.id])) }));
    for (const k of konk) ut.push(rad(k, 'konklusjon', { prompt: p.id, låst: statusOf(k) === 'endelig' }));
  }
  return ut
}
const antallVendinger = (vend) => vend.filter((v) => v.rolle === 'bruker').length;
const sistI = (samtale, vend) => Math.max(samtale?.capturedAt || 0, ...vend.map((v) => v.tid || 0));

export { antallVendinger, erTuaSamtale, sistI, vendingerFor };
