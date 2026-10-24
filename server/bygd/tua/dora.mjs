// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import { projectOf, projects, tråder as tr_der, statusOf } from './store.mjs';

// dora.js — Tua → Claude (runde 3a i arbeidsstykke 32, 03-avisen §5 «det foruroligende»): det Claude ikke så av seg selv.
//
// Desktop har ingen hooks, så ingenting fra Tua dyttes inn i en Desktop-samtale av seg selv; Claude ser Tua bare når Claude spør Tua.
// Tre grep, i rekkefølge (Erik 24.10.2026, ja til A–F):
//   sidenSist(atoms, …)   «Siden sist i Tua»: det som er gjort i appen for prosjektet de siste 7 dagene — Spør-tråder (prompt:spor:) med svar og
//                         konklusjon, delinger (tua_share), filer lest inn fra Innboks, og det som er lagret med vilje. Fanget (fanget: true) og
//                         drift (drift: true, feltet kommer fra 2d-økta — leses når det finnes) holdes utenfor. Vises av kortet og tua_search ved
//                         første kall (skalVise) og som én linje i SessionStart-hooken i Code.
//   trådFørst(atoms, hits) tua_search svarer med Spør-tråder og konklusjoner for prosjektet ØVERST når de finnes — én linje per tråd — så arbeid fra
//                         appen kommer til syne i Desktop; resten av treffene som før.
//   INSTRUKS(prosjekt)    prosjekt-instruksen Erik limer inn i Desktop-prosjektets «project instructions» (docs/desktop-prosjekt-instruks.md), tilbudt
//                         av tua_setup og kortet når prosjektet har en claudeProject-uuid — til Desktop får hooks.
// Bare lageret importeres (ingen keychain, ingen modell) så hooken kan bruke fila på under et sekund.


const DAG = 864e5;
const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
const utenfor = (a) => a.fanget === true || a.drift === true;                       // Fanget-bøtta (2c) og drift (2d): aldri i Siden sist, aldri øverst
const erSpørTråd = (p) => p && p.kind === 'prompt' && /^prompt:spor:/.test(p.key || '');   // Spør i appen (motor.spor) — ikke hookens/importens prompter
const kort = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t };

// Siden sist: { prosjekt, dager, tråder: [...], delinger: [...], innlest: [...], lagret: N, linjer: [...], noe, tekst }
function sidenSist(atoms, { prosjekt = '', dager = 7, nå = Date.now(), maks = 8 } = {}) {
  const siden = nå - dager * DAG;
  const inne = (a) => !utenfor(a) && (!prosjekt || same(a.project, prosjekt) || (a.refs || []).some((r) => same(r, prosjekt)));
  const ny = (a) => (a.capturedAt || 0) >= siden;
  const { per } = tr_der(atoms);
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const tr = [];
  for (const t of per.values()) {
    const p = byId.get(t.prompt);
    if (!erSpørTråd(p) || !inne(p)) continue
    const medlemmer = [p, ...t.svar.map((id) => byId.get(id)), ...t.forskjeller.map((id) => byId.get(id)), t.konklusjon && byId.get(t.konklusjon)].filter(Boolean);
    const sist = Math.max(...medlemmer.map((a) => a.capturedAt || 0));
    if (sist < siden) continue
    const svar = t.svar.map((id) => byId.get(id)).filter(Boolean);
    const k = t.konklusjon ? byId.get(t.konklusjon) : null;
    tr.push({ id: p.id, navn: p.name, prosjekt: p.project, svar: svar.map((s) => s.source), konklusjon: k ? { id: k.id, status: statusOf(k) } : null, forskjeller: t.forskjeller.length, sist,
      tekst: `Spurt «${kort(p.name)}» → ${svar.length} svar${svar.length ? ` (${[...new Set(svar.map((s) => String(s.source || '').split(' (')[0]))].join(', ')})` : ''}${k ? ` · konklusjon ${statusOf(k)}` : ''}` });
  }
  tr.sort((x, y) => y.sist - x.sist);
  const delinger = atoms.filter((a) => inne(a) && ny(a) && (a.tags || []).includes('deling')).sort((x, y) => y.capturedAt - x.capturedAt)
    .map((a) => ({ id: a.id, navn: a.name, sist: a.capturedAt, tekst: a.levels?.S?.text ? kort(a.levels.S.text, 110) : kort(a.name) }));
  const innlest = atoms.filter((a) => inne(a) && ny(a) && (a.tags || []).includes('fil') && a.kind === 'capture').sort((x, y) => y.capturedAt - x.capturedAt)
    .map((a) => ({ id: a.id, navn: a.name, sist: a.capturedAt, tekst: `Lest inn «${kort(a.name)}»${a.tags.find((t) => t !== 'fil') ? ` (${a.tags.find((t) => t !== 'fil')})` : ''}` }));
  const ider = new Set([...tr.map((t) => t.id), ...delinger.map((d) => d.id), ...innlest.map((i) => i.id)]);
  const lagret = atoms.filter((a) => inne(a) && ny(a) && !ider.has(a.id) && (a.kind === 'capture' || a.kind === 'leveranse') && !/^(fil|okt|svar|samtale|prompt|import|forskjeller|konklusjon|deling):/.test(a.key || '') && !(a.tags || []).includes('auto'));
  const linjer = [
    ...tr.map((t) => ({ slag: 'tråd', id: t.id, tekst: t.tekst, sist: t.sist })),
    ...delinger.map((d) => ({ slag: 'deling', id: d.id, tekst: d.tekst, sist: d.sist })),
    ...innlest.map((i) => ({ slag: 'innlest', id: i.id, tekst: i.tekst, sist: i.sist })),
  ].sort((x, y) => y.sist - x.sist).slice(0, maks);
  const noe = linjer.length + lagret.length > 0;
  const hode = `Siden sist i Tua (${dager} dager${prosjekt ? `, ${prosjekt}` : ', alle prosjekter'})`;
  const rader = [...linjer.map((l) => `- ${l.tekst} [${l.id}]`), ...(lagret.length ? [`- ${lagret.length} ${lagret.length === 1 ? 'sak' : 'saker'} lagret med vilje (${lagret.slice(0, 3).map((a) => `«${kort(a.name, 40)}»`).join(', ')}${lagret.length > 3 ? ', …' : ''})`] : [])];
  const tekst = !noe ? `${hode}: ingenting nytt i appen.` : `${hode}:\n${rader.join('\n')}`;
  return { prosjekt, dager, tråder: tr, delinger, innlest, lagret: lagret.length, linjer, noe, tekst }
}

// Første kall i en samtale: serveren lever på tvers av samtaler i Desktop, så «første» er per prosess og per prosjekt, og igjen etter 30 min stillhet.
const vist = new Map();
const STILLE_MIN = 30;
function skalVise(prosjekt = '', nå = Date.now()) {
  const k = String(prosjekt || '*').toLowerCase();
  const sist = vist.get(k) || 0;
  vist.set(k, nå);
  return nå - sist > STILLE_MIN * 60e3
}

// tua_search: Spør-tråder og konklusjoner øverst, som ÉN linje per tråd (medlemmene som traff listes i linja), så resten i scorerekkefølge. Drift ut.
function trådFørst(atoms, hits) {
  const { av, per } = tr_der(atoms);
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const rest = [], trådHits = new Map();
  for (const h of hits) {
    if (h.atom.drift === true) continue
    const pid = av.get(h.atom.id);
    const p = pid ? byId.get(pid) : null;
    if (p && (erSpørTråd(p) || h.atom.kind === 'konklusjon')) {
      if (!trådHits.has(pid)) trådHits.set(pid, { prompt: p, tråd: per.get(pid), treff: [], first: h });
      trådHits.get(pid).treff.push(h);
    } else rest.push(h);
  }
  const først = [...trådHits.values()].map((t) => {
    const svar = t.tråd.svar.map((id) => byId.get(id)).filter(Boolean), k = t.tråd.konklusjon ? byId.get(t.tråd.konklusjon) : null;
    return { ...t.first, atom: t.first.atom, tråd: { prompt: t.prompt.id, navn: t.prompt.name, svar: svar.map((s) => ({ id: s.id, source: s.source })), konklusjon: k ? { id: k.id, status: statusOf(k) } : null, forskjeller: t.tråd.forskjeller, traff: t.treff.map((h) => h.atom.id) } }
  });
  const ut = [...først, ...rest];
  ut.total = hits.total; ut.fanget = hits.fanget; ut.tråder = først.length;
  return ut
}
const trådLinje = (t) => `Tråd fra Spør i Tua: «${kort(t.navn)}» · ${t.svar.length} svar${t.svar.length ? ` (${[...new Set(t.svar.map((s) => String(s.source || '').split(' (')[0]))].join(', ')})` : ''}${t.forskjeller.length ? ' · Forskjeller' : ''}${t.konklusjon ? ` · konklusjon ${t.konklusjon.status} [${t.konklusjon.id}]` : ''}`;

// Prosjekt-instruksen for Desktop (limes inn av Erik én gang per prosjekt — Desktop har ingen hooks). Samme tekst som docs/desktop-prosjekt-instruks.md.
const INSTRUKS = (prosjekt = '') => `I dette prosjektet${prosjekt ? ` («${prosjekt}»)` : ''} er Tua arkivet:
1. Spør Tua først: kall tua_search${prosjekt ? `(project="${prosjekt}")` : ''} før du svarer fra hukommelsen på noe som kan finnes fra før — tidligere arbeid, beslutninger, navn og tall. Treffene svarer med ingressen (S); hent M før L.
2. Vis «Siden sist i Tua» ved start: første gang du bruker Tua i samtalen, gjengi linjene merket «Siden sist i Tua» (Spør-tråder, konklusjoner, delinger, filer lest inn) i én kort liste, så vi ser hva som er gjort i appen.
3. Lagre leveranser til Tua: når du har levert noe verdt å finne igjen (dokument, analyse, beslutning), spør én gang «Vil du at jeg lagrer dette til Tua?» og kall tua_save${prosjekt ? `(project="${prosjekt}")` : ''} når jeg sier ja. Spør aldri om mappe.
4. Det Tua gir deg er skjermet og logget: plassholdere som [Person A] er opplysninger du ikke har fått — bruk dem uendret, gjett aldri hva de står for. Vault-merkede saker får du bare som S.
5. «Del med <navn>»: bruk tua_share med S som standard; still ett spørsmål først («Revisor får S av 2 saker, 3 opplysninger skjermes — ok?») og gi meg den kopierbare teksten og lenka etterpå.`;
// Har prosjektet en Desktop-uuid? Da tilbys instruksen (tua_setup og kortet). Navnet kan være tomt → første prosjekt med uuid.
function instruksFor(prosjekt = '') {
  if (prosjekt) { const p = projectOf(prosjekt); return p.claudeProject ? { prosjekt, uuid: p.claudeProject, tekst: INSTRUKS(prosjekt) } : null }
  const alle = projects();
  const navn = Object.keys(alle).find((k) => alle[k]?.claudeProject);
  return navn ? { prosjekt: navn, uuid: alle[navn].claudeProject, tekst: INSTRUKS(navn) } : null
}

export { instruksFor, sidenSist, skalVise, trådFørst, trådLinje };
