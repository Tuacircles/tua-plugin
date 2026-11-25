// Tua-plugin 0.5.20 — bygd av bygg.mjs 2026-11-25. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import path__default from 'node:path';
import { spawn } from 'node:child_process';
import { ensureArchive, filesMode, writeConfig, readConfig, FILES_ROOT, load, upsert, save, archiveOptions, S_MAX } from './store.mjs';
import { importAlt } from './import.mjs';
import { insideTmp } from './platform.mjs';
import { lesNedlastinger, NEDLASTINGER } from './eksporter.mjs';

// historikk.js — «les først, vis etterpå» (arbeidsstykke 36 del 2, grep 1, 2 og 5 · 0.5.17, 25.11.2026)
//
// Før: Tua spurte «vil du ta med historikken?» og ventet på et ja som aldri kom (60 Code-økter ventet i 35 dager på Eriks egen maskin).
// Nå:  det som ligger på maskinen — Code-økter, Cowork-økter, Codex-samtaler, Desktop-cachen og dokumenter med AI-opphav — leses av seg
//      selv når arkivet er valgt, og holdes ved like omtrent en gang i timen. Ja-et er flyttet til oppsettet (ett spørsmål: sted + start).
//
//   autoHistorikk()        er bryteren på? (~/.tua/config.json historikk.auto, standard på · TUA_HISTORIKK_AUTO=0/1 overstyrer)
//   settAutoHistorikk(b)   bryteren — tua_setup(historikk=false) slår av
//   forslagArkiv()         stedet Tua foreslår i det ene spørsmålet: første skytjeneste som finnes på maskinen, ellers lokalt
//   funnetLinje(c)         «412 samtaler og 30 dokumenter» av historyCounts()
//   lesHistorikk()         selve lesingen (samme importfunksjoner som tua_import — ingen logikk dupliseres), med lås og struping
//   startLesing()          kjører lesHistorikk i en EGEN prosess (server-inngangen med --les-historikk), så verktøykall ikke står og venter
//   watchHistorikk()       ved start og hver time
//   skrivDetteFantJeg()    grep 5: saken «Dette fant jeg» (S/M/L) — prosjektene, samtaler per kilde, de fem siste trådene, tre spørsmål
//   kortLinje()            linja som ber Claude vise kortet — én gang (delt mellom serveren og SessionStart-hooken via .tua/historikk.json)
//
// Leser bare filer som alt er brukerens egne og ligger på samme maskin. Ingenting sendes noe sted; S og M skrives av regel, ikke av en modell.
// Økter som er rørt siste halvtime er i bruk (hooken har dem) og tas neste runde. Et arkiv i en midlertidig mappe (tester) leses aldri av seg selv.


const AKTIV_MS = 30 * 60 * 1000;          // økter rørt siste halvtime er i bruk
const MELLOM_MS = 50 * 60 * 1000;         // minst så lenge mellom to runder, uansett hvor mange Tua-prosesser som kjører
const LÅS_MS = 20 * 60 * 1000;            // en lås eldre enn dette er etterlatt
const KORT_KEY = 'tua:dette-fant-jeg';

const TILSTAND = () => path__default.join(FILES_ROOT, '.tua', 'historikk.json');
const historikkTilstand = () => { try { return JSON.parse(fs__default.readFileSync(TILSTAND(), 'utf8')) } catch { return {} } };
const skriv = (patch) => {
  const neste = { ...historikkTilstand(), ...patch };
  fs__default.mkdirSync(path__default.dirname(TILSTAND()), { recursive: true });
  fs__default.writeFileSync(TILSTAND(), JSON.stringify(neste, null, 2) + '\n');
  return neste
};
const lever = (pid) => { try { process.kill(pid, 0); return true } catch { return false } };

// ── bryteren ────────────────────────────────────────────────────────────────
function autoHistorikk() {
  const e = String(process.env.TUA_HISTORIKK_AUTO || '');
  if (e === '0') return false
  if (readConfig().historikk?.auto === false) return false
  if (e !== '1' && FILES_ROOT && insideTmp(FILES_ROOT)) return false          // testarkiv: aldri av seg selv
  return true
}
function settAutoHistorikk(på) {
  writeConfig({ historikk: { ...(readConfig().historikk || {}), auto: !!på, endret: new Date().toISOString() } });
  return !!på
}

// ── grep 2: ett spørsmål ────────────────────────────────────────────────────
function forslagArkiv() {
  const o = archiveOptions().filter((x) => x.available);
  return o.find((x) => x.id !== 'lokalt') || o.find((x) => x.id === 'lokalt') || null
}
const ant = (n, en, fl) => `${n} ${n === 1 ? en : fl}`;
function funnetLinje(c = {}) {
  const samtaler = (c.code || 0) + (c.cowork || 0) + (c.codex || 0) + Math.max(0, c.desktopNew || 0);
  const deler = [samtaler && ant(samtaler, 'samtale', 'samtaler'), c.dokumenter && ant(c.dokumenter, 'dokument', 'dokumenter')].filter(Boolean);
  return { samtaler, dokumenter: c.dokumenter || 0, tekst: deler.join(' og ') }
}

// ── grep 1: lesingen ────────────────────────────────────────────────────────
// Første gang: alt (også Desktop-cachen og dokumentene, så kortet har hele bildet). Siden: Code, Cowork og Codex — Desktop-cachen og
// Finder-mappene har egne vakter (watchDesktop hvert 10. minutt, watchFinder). Innboks har sin vakt (watchInbox).
let leser = false;
async function lesHistorikk({ log = () => {}, tving = false, bareNedlastinger = false } = {}) {
  if (leser) return { hoppet: 'leser alt' }
  if (ensureArchive().needsChoice || !filesMode()) return { hoppet: 'arkivet er ikke valgt' }
  if (!tving && !autoHistorikk()) return { hoppet: 'slått av' }
  const t = historikkTilstand(), nå = Date.now();
  if (!tving && !bareNedlastinger && t.sist && nå - t.sist < MELLOM_MS) return { hoppet: 'lest nylig' }
  if (t.lås && t.lås.pid !== process.pid && nå - t.lås.at < LÅS_MS && lever(t.lås.pid)) return { hoppet: 'en annen Tua-prosess leser' }
  leser = true;
  skriv({ lås: { pid: process.pid, at: nå } });
  // flere Tua-prosesser starter ofte samtidig (Code, Desktop, appen): vent et øyeblikk og se om låsen fortsatt er vår
  await new Promise((r) => setTimeout(r, 100 + Math.floor(Math.random() * 400)));
  const eier = historikkTilstand().lås;
  if (eier && eier.pid !== process.pid && lever(eier.pid)) { leser = false; return { hoppet: 'en annen Tua-prosess leser' } }
  const første = !t.første;
  const tall = {};
  try {
    // 0.5.19: en eksport som er lastet ned (Claude, ChatGPT, Gemini, Copilot) leses der den ligger — i hver runde, og alene når vakta ser en ny fil
    try { const n = lesNedlastinger({ log }); if (n.lest.length) tall.nedlastinger = { nye: n.nye, oppdatert: n.lest.reduce((s, e) => s + (e.stats?.oppdatert || 0), 0), filer: n.lest.length }; } catch (e) { tall.nedlastinger = { feil: String(e?.message || e) }; }
    if (bareNedlastinger) {
      if (tall.nedlastinger?.nye) skrivDetteFantJeg();
      skriv({ lås: null, nedlastinger: { at: Date.now(), ...(tall.nedlastinger || {}) } });
      if (tall.nedlastinger) log(`Historikken: eksport i Nedlastinger lest — ${tall.nedlastinger.feil || `${tall.nedlastinger.filer} ${tall.nedlastinger.filer === 1 ? 'fil' : 'filer'}, ${tall.nedlastinger.nye} nye samtaler`}`);
      return { tall, nye: tall.nedlastinger?.nye || 0, bareNedlastinger: true }
    }
    await importAlt({
      kilder: første ? ['code', 'cowork', 'codex', 'desktop', 'finder'] : ['code', 'cowork', 'codex'],
      eldreEnn: AKTIV_MS, bareEndret: !første, log: () => {},
      på: (h, d) => { if (h === 'del') tall[d.kilde] = d.feil ? { feil: d.feil } : { nye: d.stats?.nye || 0, oppdatert: d.stats?.oppdatert || 0 }; },
    });
    const nye = Object.values(tall).reduce((n, x) => n + (x.nye || 0), 0);
    let kort = t.kort || null;
    if (første || !kort) { const k = skrivDetteFantJeg(); if (k) kort = { id: k.id, vist: false, skrevet: nå }; }
    else if (nye) skrivDetteFantJeg();                                         // holdes à jour, men vises ikke på nytt
    skriv({ sist: Date.now(), første: t.første || new Date().toISOString(), lås: null, tall, kort });
    const linje = Object.entries(tall).map(([k, x]) => (x.feil ? `${k}: ${x.feil}` : `${k} ${x.nye} nye${x.oppdatert ? ` · ${x.oppdatert} oppdatert` : ''}`)).join(' · ');
    if (første || nye) log(`Historikken lest av seg selv${første ? ' (første gang)' : ''}: ${linje} · ${((Date.now() - nå) / 1000).toFixed(1)} s`);
    return { første, tall, nye, kort }
  } catch (e) {
    skriv({ lås: null, feil: { at: Date.now(), melding: String(e?.message || e) } });
    log(`Historikken: ${e?.message || e}`);
    return { feil: String(e?.message || e) }
  } finally { leser = false; }
}

// Egen prosess: server-inngangen (kildefila eller den bygde) med --les-historikk. Returnerer et løfte som løses når barnet er ferdig.
let barn = null;
function startLesing({ log = () => {}, tving = false, bareNedlastinger = false, inngang = process.argv[1] } = {}) {
  if (barn) return barn
  if (ensureArchive().needsChoice || !filesMode() || (!tving && !autoHistorikk())) return Promise.resolve({ hoppet: true })
  const t = historikkTilstand();
  if (!tving && !bareNedlastinger && t.sist && Date.now() - t.sist < MELLOM_MS) return Promise.resolve({ hoppet: true })
  barn = new Promise((resolve) => {
    try {
      const p = spawn(process.execPath, [inngang, '--les-historikk', ...(tving ? ['--tving'] : []), ...(bareNedlastinger ? ['--bare-nedlastinger'] : [])], { env: { ...process.env, TUA_FILES_ROOT: FILES_ROOT }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; const l = String(d).split('\n').filter((x) => /Historikken/.test(x)); for (const x of l) log(x.replace(/^\[tua\]\s*/, '')); });
      p.on('error', (e) => { log(`Historikken: ${e.message}`); barn = null; resolve({ feil: e.message }); });
      p.on('exit', (kode) => { barn = null; if (kode) log(`Historikken: leseprosessen stoppet med kode ${kode}${err ? ` — ${err.trim().split('\n').pop()}` : ''}`); resolve({ kode }); });
      p.unref?.();
    } catch (e) { barn = null; resolve({ feil: e.message }); }
  });
  return barn
}
let vakt = null;
function watchHistorikk({ log = () => {}, everyMs = 60 * 60 * 1000, delayMs = 3000 } = {}) {
  if (vakt || ensureArchive().needsChoice) return () => {}
  const run = () => { startLesing({ log }); };
  const first = setTimeout(run, delayMs);
  const timer = setInterval(run, everyMs);
  timer.unref?.(); first.unref?.();
  vakt = () => { clearTimeout(first); clearInterval(timer); vakt = null; };
  return vakt
}

// ── grep 5: «Dette fant jeg» ────────────────────────────────────────────────
const dato = (ms) => { const d = new Date(ms || Date.now()); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` };
function detteFantJeg(atoms) {
  const egne = atoms.filter((a) => a.key !== KORT_KEY && !(a.tags || []).includes('import') && !(a.tags || []).includes('velkommen'));
  const samtaler = egne.filter((a) => a.kind === 'samtale' && !a.gjentatt);
  const dokumenter = egne.filter((a) => a.kind !== 'samtale' && a.kind !== 'prompt' && (a.tags || []).includes('dokument'));
  const prompter = egne.filter((a) => a.kind === 'prompt');
  const tell = (liste, felt) => { const m = new Map(); for (const a of liste) { const k = String(felt(a) || '').trim() || '—'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((x, y) => y[1] - x[1]) };
  const kilder = tell(samtaler, (a) => a.source);
  const perProsjekt = new Map();
  for (const a of samtaler) { const p = a.project || 'Uten prosjekt'; const r = perProsjekt.get(p) || { s: 0, d: 0 }; r.s++; perProsjekt.set(p, r); }
  for (const a of dokumenter) { const p = a.project || 'Uten prosjekt'; const r = perProsjekt.get(p) || { s: 0, d: 0 }; r.d++; perProsjekt.set(p, r); }
  const generisk = (p) => /^(uten prosjekt|cowork|tua|innboks)$/i.test(p);
  const prosjekter = [...perProsjekt.entries()].sort((x, y) => (y[1].s + y[1].d) - (x[1].s + x[1].d));
  const navngitte = prosjekter.filter(([p]) => !generisk(p));
  const siste = [...samtaler].sort((x, y) => (y.capturedAt || y.createdAt || 0) - (x.capturedAt || x.createdAt || 0)).slice(0, 5);
  const størst = (navngitte[0] || prosjekter[0] || [''])[0];
  const spørsmål = [
    størst && `Hva har jeg om ${størst}?`,
    siste[0] && `Finn det jeg jobbet med i «${siste[0].name}»`,
    navngitte[1] ? `Hva er det siste i ${navngitte[1][0]}?` : 'Hva har jeg i Tua?',
  ].filter(Boolean);
  const tom = !samtaler.length && !dokumenter.length;
  const short = tom
    ? 'Tua fant ingen samtaler eller dokumenter med AI-opphav på denne maskinen ennå. Det du gjør fra nå, fanges av seg selv.'
    : `Tua har lest ${ant(samtaler.length, 'samtale', 'samtaler')}${dokumenter.length ? ` og ${ant(dokumenter.length, 'dokument', 'dokumenter')}` : ''} fra ${ant(prosjekter.length, 'prosjekt', 'prosjekter')} på denne maskinen${størst ? `. Størst: ${navngitte.slice(0, 2).map(([p]) => p).join(' og ') || størst}` : ''}. Spør for eksempel: «${spørsmål[0] || 'Hva har jeg i Tua?'}»`;
  const hoved = tom ? [] : [
    '## Samtaler per kilde', ...kilder.map(([k, n]) => `- ${k}: ${n}`), ...(prompter.length ? [`- Spørsmålene dine som egne saker: ${prompter.length}`] : []), '',
    '## Prosjekter', ...prosjekter.slice(0, 8).map(([p, r]) => `- ${p}: ${[r.s && ant(r.s, 'samtale', 'samtaler'), r.d && ant(r.d, 'dokument', 'dokumenter')].filter(Boolean).join(', ')}`),
    ...(prosjekter.length > 8 ? [`- … og ${prosjekter.length - 8} til`] : []), '',
    '## De fem siste trådene', ...siste.map((a) => `- ${dato(a.capturedAt || a.createdAt)} · «${a.name}» · ${a.project}`), '',
    '## Tre ting du kan spørre om nå', ...spørsmål.map((q) => `- «${q}»`), '',
  ];
  const medium = ['# Dette fant jeg', '', short.split('. Spør for eksempel')[0] + '.', '', ...hoved].join('\n').trim();
  const content = [
    medium, '',
    '## Det som ikke er med',
    `Samtaler som bare finnes i nettleser eller på mobil (claude.ai, ChatGPT, Gemini, Copilot) ligger ikke på maskinen. Bestill en eksport hos leverandøren og last den ned: Tua kjenner den igjen i ${NEDLASTINGER()} og leser den der. Si «hvordan tar jeg med samtalene fra nettleseren?» for lenkene. Claude-samtaler fanges også når du åpner dem i Claude Desktop.`, '',
    '## Hvordan det skjer',
    `Alt er lest lokalt og ligger som vanlige markdown-filer i ${FILES_ROOT}. Ingenting er sendt noe sted. Tua ser etter nye samtaler på maskinen omtrent en gang i timen. Si «slå av automatisk lesing» for å stoppe det (tua_setup historikk=false).`,
  ].join('\n');
  return { short: short.slice(0, S_MAX), medium, content, tall: { samtaler: samtaler.length, dokumenter: dokumenter.length, prosjekter: prosjekter.length, prompter: prompter.length }, spørsmål }
}
function skrivDetteFantJeg() {
  if (!filesMode()) return null
  const atoms = load();
  const k = detteFantJeg(atoms);
  const { atom } = upsert(atoms, {
    key: KORT_KEY, name: 'Dette fant jeg', content: k.content, short: k.short, medium: k.medium, project: 'Tua', convo: 'Oppstart', source: 'Tua', by: 'regel',
    tags: ['oppstart'], drift: true, summary: `Hva Tua fant på maskinen ved lesing ${new Date().toLocaleDateString('no-NO')}.`,
  });
  save(atoms);
  return { id: atom.id, ...k }
}
// Linja som ber Claude vise kortet. Returnerer '' når det ikke er noe å vise; merker kortet som vist når `merk` (én gang, uansett hvem som spør først).
function kortLinje({ merk = true } = {}) {
  if (!filesMode()) return ''
  const t = historikkTilstand();
  if (!t.kort?.id || t.kort.vist) return ''
  const a = load().find((x) => x.id === t.kort.id);
  if (!a) return ''
  if (merk) skriv({ kort: { ...t.kort, vist: true, vistAt: Date.now() } });
  return `Tua har lest det som lå på denne maskinen: ${a.levels?.S?.text || a.short || ''} Vis kortet «Dette fant jeg» nå: tua_card(id="${a.id}", level="M"). Si i én setning at Tua leser nye samtaler av seg selv fra nå, og at det kan slås av (tua_setup historikk=false).`
}

export { autoHistorikk, forslagArkiv, funnetLinje, historikkTilstand, kortLinje, lesHistorikk, settAutoHistorikk, startLesing, watchHistorikk };
