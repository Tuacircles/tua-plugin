// Tua-plugin 0.5.14 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import path__default from 'node:path';
import { filesMode, FILES_ROOT, DATA_DIR } from './store.mjs';

// skjermvalg.js — det Erik har bestemt om skjermingen i et arbeid (arbeidsstykke 35 skive 3, 03.11.2026).
//
// Reglene i motoren (motor.lagSkjermer) finner det de finner. Her ligger det de ikke kan vite: hva Erik la til, hva han tok bort, hvilke filer han har sett over, og forslagene
// den lokale modellen kom med. Alt ligger i .tua/skjerm-valg.json (mode 600), ved siden av kjente-personer.json. Fila inneholder navn i klartekst og sendes aldri noe sted.
//
//   arbeid[<nøkkel>] = { legg: [{tekst, type}], fjern: [tekst], avvist: [tekst], sett: { <sakId>: {versjon, tid} } }     nøkkelen er arbeidet (hører_til) eller samtalen (reservert id og a_-id)
//   forslag[<sakId>] = { versjon, navn: [], firma: [], modell, tid, dekket: {tegn, av}, feilet }                         forslagene hører til fila, ikke arbeidet: samme fil gir samme forslag
//
// Et arbeid kan ha flere nøkler (en ny samtale har t_-id til første sending, deretter a_-id, og den kan henge på et arbeid): lesing slår dem sammen, skriving bruker den første.


const FIL = () => (filesMode() ? path__default.join(FILES_ROOT, '.tua', 'skjerm-valg.json') : path__default.join(DATA_DIR, 'skjerm-valg.json'));
const les = () => { try { const j = JSON.parse(fs__default.readFileSync(FIL(), 'utf8')); return { arbeid: j.arbeid && typeof j.arbeid === 'object' ? j.arbeid : {}, forslag: j.forslag && typeof j.forslag === 'object' ? j.forslag : {} } } catch { return { arbeid: {}, forslag: {} } } };
const TYPER = ['navn', 'firma', 'annet'];
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const MAKS = 2000;

// Vask det som kommer inn: tomme og for korte ut, like slått sammen, «legg til» vinner over «fjern» for samme tekst.
function renskValg(v = {}) {
  const legg = [], sett = new Set();
  for (const l of Array.isArray(v?.legg) ? v.legg : []) {
    const tekst = String((typeof l === 'string' ? l : l?.tekst) || '').replace(/\s+/g, ' ').trim();
    if (tekst.length < 2 || tekst.length > 200 || sett.has(norm(tekst))) continue
    sett.add(norm(tekst)); legg.push({ tekst, type: TYPER.includes(l?.type) ? l.type : 'annet' });
  }
  const unike = (liste, nei = new Set()) => { const s = new Set(); const ut = []; for (const x of Array.isArray(liste) ? liste : []) { const t = String(x || '').replace(/\s+/g, ' ').trim(); if (t && !s.has(norm(t)) && !nei.has(norm(t))) { s.add(norm(t)); ut.push(t); } } return ut };
  return { legg: legg.slice(0, MAKS), fjern: unike(v?.fjern, sett).slice(0, MAKS), avvist: unike(v?.avvist, sett).slice(0, MAKS) }
}
// Claude-døra vet ikke hvilket arbeid den er i: er fila sett over i ETT arbeid, regnes den som sett over, og alt Erik har lagt til noe sted gjelder der (fjerninger gjør det ikke: skjerm heller for mye).
const erSettNoensteds = (id, versjon) => Object.values(les().arbeid).some((x) => x?.sett?.[id]?.versjon === versjon);
const alleLagtTil = () => renskValg({ legg: Object.values(les().arbeid).flatMap((x) => x?.legg || []) }).legg;

export { alleLagtTil, erSettNoensteds };
