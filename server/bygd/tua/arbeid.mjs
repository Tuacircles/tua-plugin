// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-28. IKKE REDIGER: kilden er server/*.js og node_modules.
import 'node:path';
import { statusOf, markDirty } from './store.mjs';

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


const DØGN = 86400e3;
const DAGER_ÅPENT = 14;
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
const norm = (t) => String(t || '').toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();

function følgereAv(atoms) {
  const m = new Map();
  for (const a of atoms || []) { if (!a?.hørerTil) continue; const l = m.get(a.hørerTil) || []; l.push(a); m.set(a.hørerTil, l); }
  return m
}
const erArbeid = (a, følgere = null) => !!a && (a.arbeid === true || !!(følgere && (følgere.get(a.id) || []).length));
const arbeidAv = (a) => (a ? a.hørerTil || a.id : null);             // samtalen peker på et arbeid → det; ellers er samtalen selv arbeidet (forelderøkta)

const sistI = (a, medlemmer = []) => Math.max(a?.capturedAt || 0, ...medlemmer.map((x) => x.capturedAt || 0));
const startAv = (x) => x?.createdAt || x?.capturedAt || 0;                 // en samtale ordnes etter når den begynte (hooken setter createdAt = første melding), ikke når fila sist ble skrevet
const erFilSak = (a) => /^fil:/.test(String(a?.key || '')) || ((a?.tags || []).includes('dokument') && (a?.links || []).some((l) => l.kind === 'file'));
// filene en samtale skrev: fil:-saker som peker på arbeidet, eller som deler samtalenavn med en samtale i løpet — eller med arbeidet selv når det er en samtale (samme regel som claudeØkter)
const filerFor = (atoms, arbeidId, samtaler, følgere) => {
  const arbeidet = atoms.find((a) => a.id === arbeidId);
  const nøkler = new Set([...samtaler, ...(arbeidet?.kind === 'samtale' ? [arbeidet] : [])].filter(Boolean).map((s) => `${(s.project || '').toLowerCase()}\n${(s.convo || s.name || '').toLowerCase()}`));
  const egne = (følgere.get(arbeidId) || []).filter(erFilSak);
  const viaSamtale = atoms.filter((a) => erFilSak(a) && a.hørerTil !== arbeidId && a.convo && nøkler.has(`${(a.project || '').toLowerCase()}\n${a.convo.toLowerCase()}`));
  return [...egne, ...viaSamtale].sort((x, y) => (x.capturedAt || 0) - (y.capturedAt || 0))
};
function arbeider(atoms, { prosjekt = '' } = {}) {
  const følgere = følgereAv(atoms);
  const ut = [];
  for (const a of atoms) {
    if (!erArbeid(a, følgere)) continue
    if (prosjekt && !same(a.project, prosjekt)) continue
    const f = følgere.get(a.id) || [];
    const samtaler = f.filter((x) => x.kind === 'samtale'), tråder_ = f.filter((x) => x.kind === 'prompt');
    const filer = filerFor(atoms, a.id, samtaler, følgere);
    ut.push({ id: a.id, name: a.name, project: a.project, kind: a.kind || 'capture', status: statusOf(a), åpen: a.status !== 'endelig', samtaler: samtaler.length, tråder: tråder_.length, filer: filer.length, saker: f.length, sist: sistI(a, [...f, ...filer]), capturedAt: a.capturedAt });
  }
  return ut.sort((x, y) => y.sist - x.sist)
}
const åpneArbeider = (atoms, { prosjekt = '', nå = Date.now(), dager = DAGER_ÅPENT } = {}) => arbeider(atoms, { prosjekt }).filter((r) => r.åpen && r.sist >= nå - dager * DØGN);
// «Del av: <arbeid> · samtale 7 av 12». slag = samtale | tråd | sak; nr blant samme slag, sortert på tid.
function delAv(atoms, a, følgere = følgereAv(atoms)) {
  if (!a?.hørerTil) return null
  const arbeid = atoms.find((x) => x.id === a.hørerTil);
  if (!arbeid) return null
  const slag = a.kind === 'samtale' ? 'samtale' : a.kind === 'prompt' ? 'tråd' : 'sak';
  const like = (følgere.get(arbeid.id) || []).filter((x) => (x.kind === 'samtale' ? 'samtale' : x.kind === 'prompt' ? 'tråd' : 'sak') === slag).sort((x, y) => startAv(x) - startAv(y));
  const nr = like.findIndex((x) => x.id === a.id) + 1;
  return { id: arbeid.id, name: arbeid.name, project: arbeid.project, status: statusOf(arbeid), slag, nr: nr || like.length + 1, av: Math.max(like.length, nr || 0), tekst: `Del av: ${arbeid.name} · ${slag} ${nr || like.length + 1} av ${Math.max(like.length, nr || 0)}` }
}
// Koblingen skrives i minnet; kalleren lagrer. Aldri en sløyfe (arbeidet kan ikke selv høre til saken), aldri seg selv.
function settHørerTil(atoms, id, arbeidId) {
  const a = atoms.find((x) => x.id === id), b = atoms.find((x) => x.id === arbeidId);
  if (!a) throw new Error(`fant ikke sak ${id}`)
  if (!b) throw new Error(`fant ikke arbeidet ${arbeidId}`)
  if (a.id === b.id) throw new Error('en sak kan ikke høre til seg selv')
  for (let x = b, i = 0; x && i < 20; x = atoms.find((y) => y.id === x.hørerTil), i++) if (x.id === a.id) throw new Error(`«${b.name}» hører alt til «${a.name}» — det ville blitt en sløyfe`)
  const før = a.hørerTil || null;
  a.hørerTil = b.id;
  if (a.hørerTilForslag !== undefined) a.hørerTilForslag = '';   // tom (ikke slettet): lageret beholder et felt som står i fila men mangler i minnet — en tom verdi er et valg
  markDirty(atoms, a.id);
  return { atom: a, arbeid: b, før, endret: før !== b.id }
}
function løsne(atoms, id) {
  const a = atoms.find((x) => x.id === id);
  if (!a) throw new Error(`fant ikke sak ${id}`)
  const før = a.hørerTil || null;
  a.hørerTil = '';                                                 // tom, ikke slettet (se settHørerTil) — fila mister nøkkelen ved neste skriving
  markDirty(atoms, a.id);
  return { atom: a, før, endret: !!før }
}

// ── Regelen for kobling (4a) og forslag (4b) ────────────────────────────────────────────────────────────────────────────────────
// Automatisk når (i rekkefølge): FORELDER — Code-økta er startet fra en annen økt (barnet har forelderens local_-id fra notatmappa i første melding;
// forelderens samtale-sak har `vert` = samme id) → forelderens arbeid, eller forelderen selv; GREN — grenen/worktree-navnet deler stamme
// («claude/friksjon-20-arbeid-6bc509» → «claude/friksjon-20-arbeid») med en annen samtale-sak i prosjektet; TITTEL — tittelen er lik (eller inneholder/inngår i,
// ≥ 12 tegn) navnet på et arbeid i prosjektet. Ellers FORSLAG: det nyeste åpne arbeidet i prosjektet (rørt siste 14 dager) — brukeren svarer Ja/Annet/Nei.
const GREN_UTEN = new Set(['', 'main', 'master', 'head', 'develop', 'dev', 'trunk']);
const grenStamme = (g) => String(g || '').trim().replace(/-[0-9a-f]{6,8}$/i, '').replace(/-\d+$/, '');
function arbeidForslag(atoms, { prosjekt = '', tittel = '', gren = '', forelder = '', sid = '', nå = Date.now() } = {}) {
  const følgere = følgereAv(atoms);
  const iProsjekt = (a) => !prosjekt || same(a.project, prosjekt);
  const egenNøkkel = sid ? `okt:${sid}` : null;
  const ikkeEgen = (a) => !egenNøkkel || (a.key !== egenNøkkel && a.key !== `samtale:${sid}`);
  const finnes = (id) => atoms.some((x) => x.id === id);
  if (forelder) {
    const f = atoms.find((a) => a.vert === forelder && a.kind === 'samtale' && ikkeEgen(a));
    if (f) { const id = arbeidAv(f); if (finnes(id)) return { hørerTil: id, grunn: 'forelder', via: f.id, forslag: null } }
  }
  const stamme = grenStamme(gren);
  if (stamme && !GREN_UTEN.has(stamme.toLowerCase()) && !GREN_UTEN.has(String(gren).toLowerCase())) {
    const kandidater = atoms.filter((a) => a.kind === 'samtale' && a.gren && iProsjekt(a) && ikkeEgen(a) && grenStamme(a.gren) === stamme).sort((x, y) => (x.capturedAt || 0) - (y.capturedAt || 0));
    const f = kandidater.find((a) => a.hørerTil) || kandidater[0];
    if (f) { const id = arbeidAv(f); if (finnes(id)) return { hørerTil: id, grunn: 'gren', via: f.id, forslag: null } }
  }
  const t = norm(tittel);
  if (t.length >= 12) {
    const treff = atoms.filter((a) => erArbeid(a, følgere) && iProsjekt(a) && ikkeEgen(a) && a.status !== 'endelig').map((a) => ({ a, n: norm(a.name) })).filter(({ n }) => n.length >= 12 && (n === t || n.includes(t) || t.includes(n))).sort((x, y) => (x.n === t ? -1 : 0) - (y.n === t ? -1 : 0) || (y.a.capturedAt || 0) - (x.a.capturedAt || 0));
    if (treff[0]) return { hørerTil: treff[0].a.id, grunn: 'tittel', via: treff[0].a.id, forslag: null }
  }
  const åpne = åpneArbeider(atoms, { prosjekt, nå }).filter((r) => !egenNøkkel || atoms.find((x) => x.id === r.id)?.key !== egenNøkkel);
  return { hørerTil: null, grunn: null, via: null, forslag: åpne[0]?.id || null, åpne: åpne.slice(0, 5).map((r) => ({ id: r.id, name: r.name, samtaler: r.samtaler, sist: r.sist })) }
}

export { arbeidForslag, delAv, erArbeid, følgereAv, løsne, settHørerTil };
