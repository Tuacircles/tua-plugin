// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import path__default from 'node:path';
import crypto__default from 'node:crypto';
import { readConfig, DATA_DIR, filesMode, FILES_ROOT } from './store.mjs';

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


const TUA = () => (filesMode() ? path__default.join(FILES_ROOT, '.tua') : DATA_DIR);
const MOTTAKERE = () => path__default.join(TUA(), 'mottakere.json');
const DELINGER = () => path__default.join(TUA(), 'delinger.json');
const lesJson = (p, d) => { try { return JSON.parse(fs__default.readFileSync(p, 'utf8')) } catch { return d } };
const skrivJson = (p, v) => { fs__default.mkdirSync(path__default.dirname(p), { recursive: true }); fs__default.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); };
const kort = (pre) => pre + crypto__default.randomBytes(4).toString('hex');
const nyttToken = () => crypto__default.randomBytes(16).toString('base64url');
const BASE = () => (process.env.TUA_APP_URL || 'http://127.0.0.1:5274').replace(/\/$/, '');
const MERKER = ['kollega', 'relasjon'];
const SIRKEL_TERSKEL = 3;   // tredje gang samme personer får noe sammen → forslag

// ── Personer og sirkler ─────────────────────────────────────────────────────
const tom = () => ({ personer: [], sirkler: [], mønstre: {}, eier: null });
function lesMottakere() { const m = lesJson(MOTTAKERE(), null) || tom(); return { ...tom(), ...m, personer: Array.isArray(m.personer) ? m.personer : [], sirkler: Array.isArray(m.sirkler) ? m.sirkler : [], mønstre: m.mønstre && typeof m.mønstre === 'object' ? m.mønstre : {} } }
function skrivMottakere(m) { skrivJson(MOTTAKERE(), { ...m, oppdatert: new Date().toISOString() }); }
const norm = (s) => String(s || '').trim().toLowerCase();
const erEpost = (s) => /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(String(s || '').trim());
// «Anna <anna@firma.no>» · «anna@firma.no» · «Anna» → { navn, epost }
function tolkMottaker(tekst) {
  const t = String(tekst || '').trim();
  const m = t.match(/^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/);
  if (m) return { navn: m[1].trim() || m[2].split('@')[0], epost: m[2].trim().toLowerCase() }
  if (erEpost(t)) return { navn: t.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), epost: t.toLowerCase() }
  return { navn: t, epost: null }
}
const finnPerson = (m, tekst) => {
  const { navn, epost } = tolkMottaker(tekst);
  return m.personer.find((p) => (epost && norm(p.epost) === epost) || (p.id === tekst)) || m.personer.find((p) => norm(p.navn) === norm(navn)) || null
};
const finnSirkel = (m, tekst) => m.sirkler.find((s) => s.navn && !s.foreslått && (norm(s.navn) === norm(tekst) || s.id === tekst)) || null;
// Løs «til» (streng eller liste av navn/e-post/sirkelnavn) til personer — nye opprettes (merke kollega som standard, Erik 24.10: kollegaer først).
// Returnerer { personer: [{...person, ny}], sirkler: [navn] , m } — kalleren skriver med skrivMottakere når delingen faktisk lages.
function løsMottakere(til, { merke = 'kollega', opprett = true } = {}) {
  const m = lesMottakere();
  const liste = (Array.isArray(til) ? til : [til]).flatMap((t) => String(t || '').split(/\s*(?:,|;| og )\s*/)).map((t) => t.trim()).filter(Boolean);   // «Anna, Bjarte» og «Anna og Bjarte» er to — også inne i en liste
  const ut = [], sirkler = [], sett = new Set();
  const legg = (p, ny = false) => { if (!sett.has(p.id)) { sett.add(p.id); ut.push({ ...p, ny }); } };
  for (const t of liste) {
    const s = finnSirkel(m, t);
    if (s) { sirkler.push(s.navn); for (const p of s.medlemmer.map((id) => m.personer.find((x) => x.id === id)).filter(Boolean).sort((x, y) => x.navn.localeCompare(y.navn, 'no'))) legg(p); continue }   // medlemmene alfabetisk — stabil rekkefølge i setningen
    let p = finnPerson(m, t);
    if (!p) {
      if (!opprett) { ut.push({ id: null, ...tolkMottaker(t), merke, ny: true }); continue }
      const { navn, epost } = tolkMottaker(t);
      p = { id: kort('p_'), navn, epost, merke: MERKER.includes(merke) ? merke : 'kollega', opprettet: Date.now(), sist: null, delinger: 0 };
      m.personer.push(p); legg(p, true);
    } else { if (!p.epost && erEpost(t)) p.epost = t.toLowerCase(); legg(p); }
  }
  return { personer: ut, sirkler, m }
}
// Etter en deling: tell per person, og mønsteret for personene som fikk noe sammen. Tredje gang → sirkelforslag (om ingen sirkel med samme medlemmer finnes).
function registrerDeling(m, personIder, når = Date.now()) {
  for (const id of personIder) { const p = m.personer.find((x) => x.id === id); if (p) { p.sist = når; p.delinger = (p.delinger || 0) + 1; } }
  let forslag = null;
  if (personIder.length >= 2) {
    const nøkkel = [...personIder].sort().join('+');
    const mø = m.mønstre[nøkkel] || { antall: 0, sist: null };
    mø.antall++; mø.sist = når; m.mønstre[nøkkel] = mø;
    const finnes = m.sirkler.find((s) => [...s.medlemmer].sort().join('+') === nøkkel);
    if (mø.antall >= SIRKEL_TERSKEL && !finnes) {
      const navn = personIder.map((id) => m.personer.find((x) => x.id === id)?.navn || id);
      forslag = { id: kort('c_'), navn: null, forslag: navn.length === 2 ? `${navn[0]} og ${navn[1]}` : `${navn.slice(0, -1).join(', ')} og ${navn.at(-1)}`, medlemmer: [...personIder].sort(), foreslått: true, antall: mø.antall, opprettet: når };
      m.sirkler.push(forslag);
    } else if (finnes?.foreslått) { finnes.antall = mø.antall; forslag = finnes; }
  }
  return forslag
}
// Den som deler: .tua/mottakere.json `eier`, ellers ~/.tua/config.json `eier` (tua_setup kan sette den senere), ellers bare «den som delte».
function eier() { const m = lesMottakere(); const c = readConfig().eier; const e = m.eier || (c && typeof c === 'object' ? c : null); return { navn: String(e?.navn || '').trim(), epost: String(e?.epost || '').trim().toLowerCase() } }

// ── Delinger (token → det som ble delt) ─────────────────────────────────────
function lesDelinger() { const d = lesJson(DELINGER(), {}); return d && typeof d === 'object' ? d : {} }
function skrivDelinger(d) { skrivJson(DELINGER(), d); }
function lagreDeling(deling) { const d = lesDelinger(); d[deling.token] = deling; skrivDelinger(d); return deling }
const delingerFor = (sakId) => Object.values(lesDelinger()).filter((d) => !sakId || d.sak === sakId || (d.rader || []).some((r) => r.id === sakId)).sort((a, b) => (b.opprettet || 0) - (a.opprettet || 0));
const lenkerFor = (token, base) => { const b = String(base || BASE()).replace(/\/$/, ""); return { tua: `tua://del/${token}`, http: `${b}/del/${token}`, html: `${b}/del/${token}.html` } };

export { delingerFor, eier, lagreDeling, lenkerFor, løsMottakere, nyttToken, registrerDeling, skrivMottakere };
