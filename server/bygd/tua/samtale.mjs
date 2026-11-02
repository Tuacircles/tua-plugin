// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { øktIdAv as _ktIdAv, hashOf, sha8, statusOf, isVault, levelOf } from './store.mjs';
import { samtaleFraSak, clip, flat } from './samtaletekst.mjs';

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
const samtaleNøkkel = (id) => `samtale:tua:${id}`;
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
const navnAv = (s) => s.convo || s.name || '';
// rekkefølge: tid (dato i fila har sekundoppløsning), så tidsstempelet i id-en (uid() = a_<ms i base36>_…) — to spørsmål i samme sekund står riktig
const idTid = (a) => { const m = /^a_([0-9a-z]+)_/.exec(String(a?.id || '')); return m ? parseInt(m[1], 36) : 0 };
const påTid = (x, y) => ((x.capturedAt || 0) - (y.capturedAt || 0)) || (idTid(x) - idTid(y));

function finnSamtale(atoms, id) {
  if (!id) return null
  const s = String(id).trim();
  const direkte = atoms.find((a) => a.kind === 'samtale' && (a.id === s || a.key === samtaleNøkkel(s) || a.key === `samtale:${s}` || a.key === `okt:${s}` || a.key === `codex:${s}`));   // codex: Codex-samtaler (28.10.2026)
  if (direkte) return direkte
  const sak = atoms.find((a) => a.id === s);
  return sak ? samtaleFor(atoms, sak) : null
}
function samtaleFor(atoms, sak, dybde = 0) {
  if (!sak || dybde > 3) return null
  if (sak.kind === 'samtale') return sak
  const viaRef = (sak.derivedFrom || []).map((d) => atoms.find((a) => a.id === d.id && a.kind === 'samtale')).find(Boolean);
  if (viaRef) return viaRef
  if (sak.kind !== 'prompt') {
    const prompt = (sak.derivedFrom || []).map((d) => atoms.find((a) => a.id === d.id && a.kind === 'prompt')).find(Boolean);
    if (prompt) { const r = samtaleFor(atoms, prompt, dybde + 1); if (r) return r }
  }
  const sid8 = _ktIdAv(sak.key);
  if (sid8) { const s = atoms.find((a) => a.kind === 'samtale' && _ktIdAv(a.key) === sid8); if (s) return s }
  return atoms.find((a) => erTuaSamtale(a) && same(a.project, sak.project) && navnAv(a) === (sak.convo || '')) || null   // gammel Tua-tråd: samtalenavnet
}

// ── vendingene ───────────────────────────────────────────────────────────────
const erForskjeller = (a) => a?.kind === 'svar' && (a.tags || []).some((t) => String(t).toLowerCase() === 'forskjeller');
const erSvarSak = (a) => !!a && !erForskjeller(a) && (a.kind === 'svar' || (a.kind === 'capture' && (a.tags || []).includes('svar')));
const modellAv = (a) => String(a?.source || '').split(' (')[0].trim() || 'modell';
const nivåAv = (a, utenom) => [...new Set((a.derivedFrom || []).filter((d) => !utenom.has(d.id)).map((d) => d.level).filter(Boolean))].join('/') || null;
// Skive 3 (arb. 33, 28.10.2026): for en IMPORTERT samtale (Code/Cowork/Desktop, hookens okt:-saker) er vendingene ALLE vendingene lest ut av transkriptet
// (samtaleFraSak), ikke bare sakene importen laget (prompt ≥ 80 tegn, svar ≥ 3 000). Der en vending alt har en sak, peker vendingen på den (id = sakens id);
// ellers får den en stabil syntetisk id v_<sha8 av samtalens id>_<n> (n = plassen i transkriptet — nye vendinger legges bakerst ved ny import, så gamle id-er står).
// Tua-vendinger som peker på samtalen (en fortsettelse ført i Tua) kommer etter transkriptets, i tidsrekkefølge. Lar transkriptet seg ikke lese, som før.
const erSyntetiskId = (id) => /^v_[0-9a-f]{8}_\d+$/.test(String(id || ''));
const syntetiskId = (samtale, n) => `v_${sha8(samtale.id)}_${n}`;
const kortModell = (s) => { const k = String(s || '').trim(); return /^Claude\b/.test(k) ? 'Claude' : k.split(' (')[0] || 'modell' };
function vendingerAvTranskript(atoms, samtale) {
  if (!samtale || erTuaSamtale(samtale)) return null
  const lest = samtaleFraSak(samtale.content);
  if (!lest?.pairs?.length) return null
  const sid8 = _ktIdAv(samtale.key);
  const peker = (a) => (a.derivedFrom || []).some((d) => d.id === samtale.id);
  const iSamtalen = (a) => (sid8 && String(a.key || '').startsWith(`${a.kind === 'prompt' ? 'prompt' : 'svar'}:${sid8}:`)) || peker(a);
  const prompter = new Map(), svar = new Map();   // flatet tekst → saken (importens prompter er promptL — kortet ved 20 000 tegn — så vi matcher også på nøkkelen)
  for (const a of atoms) {
    if (a.id === samtale.id || !iSamtalen(a)) continue
    if (a.kind === 'prompt' && String(a.source || '') !== KILDE_TUA) { prompter.set(a.key, a); prompter.set(hashOf(a.content), a); }
    else if (erSvarSak(a) && a.kind !== 'svar') { svar.set(a.key, a); svar.set(hashOf(a.content), a); }
  }
  const rad = (a, rolle, ekstra = {}) => ({ id: a.id, rolle, kind: a.kind || 'capture', tid: a.capturedAt || 0, modell: rolle === 'bruker' ? null : modellAv(a), kilde: a.source || '', nivå: null, S: levelOf(a, 'S').text, L: a.content || '', tegn: (a.content || '').length, versjon: a.version || 1,
    beholdt: a.beholdt === true || a.fanget === false, status: statusOf(a), vault: isVault(a), låst: false, ...ekstra });
  const syntetisk = (n, rolle, tekst, ekstra = {}) => ({ id: syntetiskId(samtale, n), rolle, kind: 'vending', tid: ekstra.tid ?? null, modell: rolle === 'bruker' ? null : kortModell(samtale.source), kilde: samtale.source || '', nivå: null, S: clip(flat(tekst), 300), L: tekst, tegn: tekst.length, versjon: samtale.version || 1,
    beholdt: false, status: 'endelig', vault: isVault(samtale), låst: false, syntetisk: true, samtale: samtale.id, ...ekstra });
  const ut = [];
  let n = 0, forrige = null;
  for (const p of lest.pairs) {
    n++;
    // skive A (§6, 28.10.2026): samme spørsmål to ganger på rad i transkriptet (Cowork skriver meldingen på nytt når en kjøring startes igjen) er ÉN vending —
    // svarene henges på den første. n telles likevel, så de syntetiske id-ene står som før.
    if (forrige && !forrige.svar && flat(p.prompt) === flat(forrige.tekst)) { forrige.svar = (p.answers?.length || 0) + (p.svar ? 1 : 0); for (const a of p.answers?.length ? p.answers : p.svar ? [p.svar] : []) { n++; const ss = svar.get(sid8 ? `svar:${sid8}:${sha8(a)}` : '') || svar.get(hashOf(a)) || null; ut.push(ss ? rad(ss, 'modell', { prompt: forrige.v.id, nivå: null }) : syntetisk(n, 'modell', a, { prompt: forrige.v.id })); } continue }
    const ps = prompter.get(sid8 ? `prompt:${sid8}:${hashOf(p.prompt)}` : '') || prompter.get(hashOf(p.prompt)) || null;
    const bruker = ps ? rad(ps, 'bruker', { prompt: ps.id, forskjeller: [] }) : syntetisk(n, 'bruker', p.prompt, { tid: p.at || null });
    bruker.prompt = bruker.id;
    ut.push(bruker);
    forrige = { v: bruker, tekst: p.prompt, svar: (p.answers?.length || 0) + (p.svar && !p.answers?.length ? 1 : 0) };
    for (const a of p.answers?.length ? p.answers : p.svar ? [p.svar] : []) {
      n++;
      const ss = svar.get(sid8 ? `svar:${sid8}:${sha8(a)}` : '') || svar.get(hashOf(a)) || null;
      ut.push(ss ? rad(ss, 'modell', { prompt: bruker.id, nivå: null }) : syntetisk(n, 'modell', a, { prompt: bruker.id }));
    }
  }
  return ut
}
function vendingerFor(atoms, samtale) {
  if (!samtale) return []
  const peker = (a) => (a.derivedFrom || []).some((d) => d.id === samtale.id);
  const sid8 = _ktIdAv(samtale.key);
  const tua = erTuaSamtale(samtale);
  const sammeNavn = (a) => same(a.project, samtale.project) && (a.convo || '') === navnAv(samtale);
  const fraTranskript = vendingerAvTranskript(atoms, samtale);   // skive 3: importerte samtaler — hele transkriptet først
  const alt = new Set((fraTranskript || []).map((v) => v.id));
  const importPrompt = (a) => !!sid8 && String(a.key || '').startsWith(`prompt:${sid8}:`);
  // etter transkriptet: Tua-vendingene som peker på samtalen (fortsettelsen), og importprompter transkriptet ikke fant igjen (forkortet transkript) — ingenting forsvinner
  const prompter = atoms.filter((a) => a.kind === 'prompt' && a.id !== samtale.id && !alt.has(a.id) && (peker(a) || importPrompt(a) || (tua && /^prompt:spor:/.test(String(a.key || '')) && sammeNavn(a)))).sort(påTid);
  const rad = (a, rolle, ekstra = {}) => ({ id: a.id, rolle, kind: a.kind || 'capture', tid: a.capturedAt || 0, modell: rolle === 'bruker' ? null : modellAv(a), kilde: a.source || '', nivå: null, S: levelOf(a, 'S').text, L: a.content || '', tegn: (a.content || '').length, versjon: a.version || 1,
    beholdt: a.beholdt === true || a.fanget === false, status: statusOf(a), vault: isVault(a), låst: false, ...ekstra });
  // rekkefølgen med transkript: importprompter transkriptet ikke fant igjen FØRST (de er eldre historikk — Desktop lagrer lange samtaler som utsnitt av de siste meldingene,
  // og sakene fra en fullere import står igjen), så transkriptets vendinger, så Tua-vendingene (fortsettelsen) etter tid
  const ut = [];
  const eldre = fraTranskript ? prompter.filter(importPrompt) : [], etter = fraTranskript ? prompter.filter((a) => !importPrompt(a)) : prompter;
  const leggTråd = (p) => {
    const svarIder = new Set((p.ga || []).map((g) => g.id));
    const svar = atoms.filter((a) => a.id !== p.id && erSvarSak(a) && !alt.has(a.id) && (svarIder.has(a.id) || (a.derivedFrom || []).some((d) => d.id === p.id))).sort(påTid);
    const fsk = atoms.filter((a) => erForskjeller(a) && (a.derivedFrom || []).some((d) => svar.some((s) => s.id === d.id))).map((a) => a.id);
    const konk = atoms.filter((a) => a.kind === 'konklusjon' && (a.derivedFrom || []).some((d) => d.id === p.id)).sort(påTid);
    ut.push(rad(p, 'bruker', { prompt: p.id, forskjeller: fsk }));
    for (const s of svar) ut.push(rad(s, 'modell', { prompt: p.id, nivå: nivåAv(s, new Set([p.id, samtale.id])) }));
    for (const k of konk) ut.push(rad(k, 'konklusjon', { prompt: p.id, låst: statusOf(k) === 'endelig' }));
  };
  for (const p of eldre) leggTråd(p);
  if (fraTranskript) ut.push(...fraTranskript);
  for (const p of etter) leggTråd(p);
  return ut
}
const antallVendinger = (vend) => vend.filter((v) => v.rolle === 'bruker').length;
const sistI = (samtale, vend) => Math.max(samtale?.capturedAt || 0, ...vend.map((v) => v.tid || 0));
// Skive 4 (arb. 33, 28.10.2026) — Claude-døra viser samtaler fullt ut: det kortet, tua_search, tua_get og Siden sist sier om en samtale-sak, regnet ÉN gang her.
//   { id, tittel, prosjekt, kilde ('Tua' | 'Claude Code' | …), tua, vendinger (antall spørsmål), siste (ms), modeller: ['gemma3', 'Claude'], konklusjon: 'låst' | 'utkast' | null,
//     syntetiske (vendinger lest ut av transkriptet uten egen sak), adresse: '#samtale/<id>' }
function samtaleInfo(atoms, samtale, { base = '' } = {}) {
  const v = vendingerFor(atoms, samtale);
  const konk = v.filter((x) => x.rolle === 'konklusjon');
  return { id: samtale.id, tittel: samtale.name || navnAv(samtale) || 'Samtale', prosjekt: samtale.project, kilde: erTuaSamtale(samtale) ? KILDE_TUA : String(samtale.source || 'Claude'), tua: erTuaSamtale(samtale),
    vendinger: antallVendinger(v), siste: sistI(samtale, v), modeller: [...new Set(v.filter((x) => x.rolle === 'modell').map((x) => kortModell(x.modell)).filter(Boolean))],
    konklusjon: konk.some((k) => k.låst) ? 'låst' : konk.length ? 'utkast' : null, syntetiske: v.filter((x) => x.syntetisk).length, adresse: `${base}#samtale/${encodeURIComponent(samtale.id)}` }
}
// Én linje om samtalen, lik i tua_search, tua_get og kortet: «Samtale i Tua: 4 vendinger · siste 27.10.2026 · gemma3, Claude · konklusjon låst · fortsett: http://…#samtale/<id>»
function samtaleLinje(info) {
  const dato = info.siste ? new Date(info.siste).toLocaleDateString('no-NO', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—';
  return `Samtale ${info.tua ? 'i Tua' : `fra ${info.kilde}`}: ${info.vendinger} ${info.vendinger === 1 ? 'vending' : 'vendinger'} · siste ${dato}${info.modeller.length ? ` · ${info.modeller.join(', ')}` : ''}${info.konklusjon ? ` · konklusjon ${info.konklusjon}` : ''} · fortsett i Tua: ${info.adresse}`
}

// Standardvalget regnes HER, ikke i appen (plan §5): alt etter siste låste konklusjon, ellers alt; så bakfra til budsjettet er brukt. anslå(tekst) → tokens for mottakeren.
function standardVendinger(vend, mottaker = {}, { anslå = (t) => Math.round(String(t || '').length / 3.5), reservert = 0 } = {}) {
  const label = mottaker.label ? String(mottaker.label).split(' (')[0] : mottaker.id || 'mottakeren';
  const budsjett = Number(mottaker.budsjett) || 0;
  const sisteLåst = vend.reduce((s, v, i) => (v.rolle === 'konklusjon' && v.låst ? i : s), -1);
  const utenfor = new Map();
  vend.forEach((v, i) => {
    if (i < sisteLåst) utenfor.set(v.id, { id: v.id, hvorfor: 'før siste låste konklusjon — konklusjonen oppsummerer det' });
    else if (i === sisteLåst) utenfor.set(v.id, { id: v.id, hvorfor: 'den låste konklusjonen står som strek i samtalen; kryss av om den skal med' });
    else if (v.rolle === 'konklusjon') utenfor.set(v.id, { id: v.id, hvorfor: 'konklusjon (utkast) — kryss av om den skal med' });
  });
  const kandidater = vend.filter((v) => !utenfor.has(v.id));
  const valgt = [];
  let brukt = reservert, stoppet = false;
  for (const v of [...kandidater].reverse()) {
    const t = anslå(v.L);
    if (!stoppet && (!budsjett || brukt + t <= budsjett)) { brukt += t; valgt.unshift(v.id); continue }
    stoppet = true;   // bakfra: faller én utenfor, faller alle eldre også — nyeste beholdes
    utenfor.set(v.id, { id: v.id, hvorfor: `utenfor budsjettet til ${label} (ca. ${t.toLocaleString('no-NO')} tokens; ${budsjett.toLocaleString('no-NO')} er grensen, ${brukt.toLocaleString('no-NO')} er alt brukt av nyere vendinger)`, tokens: t });
  }
  const rekkefølge = new Map(vend.map((v, i) => [v.id, i]));
  return { vendinger: valgt, utenfor: [...utenfor.values()].sort((x, y) => rekkefølge.get(x.id) - rekkefølge.get(y.id)), tokens: brukt, budsjett: budsjett || null, mottaker: mottaker.id || null }
}

export { erSyntetiskId, erTuaSamtale, finnSamtale, samtaleInfo, samtaleLinje, standardVendinger, vendingerFor };
