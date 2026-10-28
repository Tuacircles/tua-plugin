// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-28. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import 'node:os';
import path__default from 'node:path';
import crypto__default from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse, serialize, fileNameFor, safeName } from './files.mjs';
import { HOME, cloudBases, IS_MAC } from './platform.mjs';

// store.js — Tua-arkivet. Alternativ A: MAPPA ER SANNHETEN.
//
// Hvert atom er en markdown-fil under FILES_ROOT/<prosjekt>/ (standard
// ~/Dropbox/Tua). Finder, Spotlight og Quick Look leser dem native; MCP-serveren,
// broen og sync går gjennom load()/save() her. atoms.json er bare en avledet
// indeks (cache) — finnes ikke mappa (annen maskin), brukes cachen alene.
//
// Lokal-først: ingen server, ingen innlogging, ingenting forlater enheten
// utover din egen sky-synk. «Tua har aldri master-key».


const HERE = path__default.dirname(fileURLToPath(new URL("../../store.js", import.meta.url).href));
// 0.5.1: en plugin-vert som ikke erstatter «${…}» i .mcp.json (Cowork uten CLAUDE_PLUGIN_DATA) sender variabelen rå —
// en sti som fortsatt inneholder «${» er ikke en sti, og ignoreres som om den var tom.
const envPath = (name) => { const v = process.env[name]; return v && !v.includes('${') ? v : '' };
const DATA_DIR = envPath('TUA_DATA_DIR') || path__default.join(HERE, 'data');
const FILE = path__default.join(DATA_DIR, 'atoms.json');            // avledet indeks

// M14: hvor arkivet bor. TUA_FILES_ROOT vinner alltid. Ellers valget brukeren har tatt (~/.tua/config.json),
// ellers en Tua-mappe som allerede finnes (Dropbox, iCloud Drive, ~/Tua — eksisterende brukere spørres ikke).
// Finnes ingenting, er roten null: Tua GJETTER IKKE, men spør brukeren (tua_setup / elicitation i server.js)
// hvor arkivet skal ligge — iCloud Drive, Dropbox, OneDrive, Google Drive eller lokalt. Valget kan endres
// senere på innstillinger-siden (M15). TUA_HOME overstyrer hjemmemappa (bare for tester).
const CONFIG = path__default.join(HOME, '.tua', 'config.json');                      // { root, sted, valgt }
// Skytjenestene slik de ligger på macOS, Windows og Linux (platform.js). `base` er mappa tjenesten synker; arkivet blir
// <base>/Tua. «Lokalt» (~/Tua) finnes alltid — det er fallbacken når ingen sky er installert.
function archiveOptions() {
  const c = cloudBases();
  const opts = [
    { id: 'icloud', label: 'iCloud Drive', base: c.icloud },
    { id: 'dropbox', label: 'Dropbox', base: c.dropbox },
    { id: 'onedrive', label: 'OneDrive', base: c.onedrive },
    { id: 'googledrive', label: 'Google Drive', base: c.googledrive },
    { id: 'lokalt', label: 'Lokalt (bare denne maskinen)', base: HOME },
  ];
  return opts.map((o) => ({ ...o, path: o.base ? path__default.join(o.base, 'Tua') : '', available: !!o.base && fs__default.existsSync(o.base), exists: !!o.base && fs__default.existsSync(path__default.join(o.base, 'Tua')) }))
}
const readConfig = () => { try { return JSON.parse(fs__default.readFileSync(CONFIG, 'utf8')) } catch { return {} } };
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs__default.mkdirSync(path__default.dirname(CONFIG), { recursive: true });
  fs__default.writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next
}
function chooseRoot() {
  if (envPath('TUA_FILES_ROOT')) return envPath('TUA_FILES_ROOT')
  const c = readConfig();
  if (c.root && fs__default.existsSync(c.root)) return c.root
  const existing = archiveOptions().find((o) => o.exists);
  return existing ? existing.path : null
}
let FILES_ROOT = chooseRoot();
let INBOX_DIR = FILES_ROOT ? path__default.join(FILES_ROOT, 'Innboks') : null;   // M14: eksporter legges her, flyttes til Innboks/Ferdig
const rootLabel = () => archiveOptions().find((o) => FILES_ROOT && o.base && (FILES_ROOT === o.path || FILES_ROOT.startsWith(o.base + path__default.sep)))?.label || 'egen mappe';
// Brukerens valg (M14): id fra archiveOptions() eller en absolutt sti. Lagres i ~/.tua/config.json og arkivet lages.
// Flytter aldri filer (V9: mappa er sannheten — flytting er en Finder-jobb). Andre felt i config (finder) beholdes.
function chooseArchive(idOrPath) {
  const opt = archiveOptions().find((o) => o.id === idOrPath);
  const root = opt ? opt.path : path__default.resolve(String(idOrPath || '').replace(/^~(?=$|\/)/, HOME));
  if (!opt && !path__default.isAbsolute(root)) throw new Error(`«${idOrPath}» er verken et kjent sted (${archiveOptions().map((o) => o.id).join(', ')}) eller en absolutt sti`)
  if (opt && !opt.available) throw new Error(`${opt.label} finnes ikke på denne maskinen (${opt.base})`)
  FILES_ROOT = root;
  INBOX_DIR = path__default.join(root, 'Innboks');
  writeConfig({ root, sted: opt ? opt.label : 'egen mappe', valgt: new Date().toISOString() });
  return { ...ensureArchive(), label: rootLabel() }
}
const tuaFile = (name) => path__default.join(FILES_ROOT, '.tua', name);
const INDEX = () => tuaFile('index.json');          // id → relativ sti
const PROJECTS = () => tuaFile('projects.json');    // prosjektnavn → { repo, claudeProject }
const WRITTEN = () => tuaFile('written.json');      // id → { sha, version } slik Tua sist skrev fila (M10/V15: oppdager redigering utenfra)
const DELIVERY = () => (filesMode() ? tuaFile('utlevering.jsonl') : path__default.join(DATA_DIR, 'utlevering.jsonl'));
const filesMode = () => !!FILES_ROOT && fs__default.existsSync(FILES_ROOT);

const uid = () =>
  'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

// ── cache (atoms.json) ──────────────────────────────────────────────────────
function loadCache() {
  try { return JSON.parse(fs__default.readFileSync(FILE, 'utf8')) } catch { return [] }
}
function writeCache(atoms) {
  try {
    fs__default.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs__default.writeFileSync(tmp, JSON.stringify(atoms, null, 2));
    fs__default.renameSync(tmp, FILE);
  } catch (e) { console.error(`[tua] kunne ikke skrive indeks-cachen (${FILE}): ${e.message} — mappa er uansett sannheten`); }   // M14: cachen er avledet; en skrivebeskyttet plugin-mappe skal ikke stoppe lagring
}

// ── mappa ───────────────────────────────────────────────────────────────────
const readIndex = () => { try { return JSON.parse(fs__default.readFileSync(INDEX(), 'utf8')) } catch { return {} } };
const writeIndex = (ix) => { fs__default.mkdirSync(path__default.dirname(INDEX()), { recursive: true }); fs__default.writeFileSync(INDEX(), JSON.stringify(ix, null, 2) + '\n'); };

function* walk(dir, rel = '') {
  let entries = [];
  try { entries = fs__default.readdirSync(dir, { withFileTypes: true }); } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue                      // .tua, .DS_Store, Dropbox-sidecars
    const abs = path__default.join(dir, e.name), r = rel ? path__default.join(rel, e.name) : e.name;
    if (!rel && e.name === 'Innboks') {                       // M14: Innboks er postkasse, ikke prosjekt — M16 (skive 7): unntatt Tuas egne saker som ble lest inn dit
      if (!e.isDirectory()) continue                          // (prosjekt «Innboks» til Erik flytter fila i Finder, V9). Bare .md med Tua-frontmatter, bare øverst (ikke Ferdig/.behandles).
      let inne = [];
      try { inne = fs__default.readdirSync(abs, { withFileTypes: true }); } catch { continue }
      for (const f of inne) if (f.isFile() && f.name.toLowerCase().endsWith('.md') && !f.name.startsWith('.') && erTuaSak(path__default.join(abs, f.name))) yield { abs: path__default.join(abs, f.name), rel: path__default.join(r, f.name) };
      continue
    }
    if (e.isDirectory()) yield* walk(abs, r);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) yield { abs, rel: r };
  }
}
// Er fila en sak Tua har skrevet (frontmatter med tua_id)? Leser bare de første 600 tegnene. Brukes av Innboks-skillet over og av innlesingen
// (et løst .md-dokument i Innboks er noe som skal leses inn; en sak i Innboks er alt lest inn).
function erTuaSak(p) {
  try { const fd = fs__default.openSync(p, 'r'); const b = Buffer.alloc(600); const n = fs__default.readSync(fd, b, 0, 600, 0); fs__default.closeSync(fd); const h = b.subarray(0, n).toString('utf8'); return h.startsWith('---\n') && /\ntua_id:/.test(h) } catch { return false }
}
const stableId = (rel) => 'f_' + crypto__default.createHash('sha1').update(rel).digest('hex').slice(0, 12);
// Kort innholdshash (FNV-1a, 8 hex) for nøkler som svar:<økt>:<sha8> og prompt:<økt>:<sha8>. ÉN funksjon for import, hooks og motor (M19).
const sha8 = (s) => { let h = 0x811c9dc5; const t = String(s || ''); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0') };
const hashOf = (s) => sha8(String(s || '').replace(/\s+/g, ' ').trim());   // whitespace flatet: samme prompt med annen linjedeling er samme prompt
const sha256 = (s) => crypto__default.createHash('sha256').update(s).digest('hex');
const sha256File = (p) => { try { return sha256(fs__default.readFileSync(p)) } catch { return null } };
const readWritten = () => { try { return JSON.parse(fs__default.readFileSync(WRITTEN(), 'utf8')) } catch { return {} } };

function load() {
  if (!filesMode()) return loadCache()
  const atoms = [];
  const spor = nyttSpor(atoms);                                  // runde 3c: hva denne lista leste — save() skriver bare det som er endret siden
  const written = readWritten();
  const index = readIndex();
  const seenIds = new Map();                                     // id → rel; to filer med samme tua_id (kopi i Finder, gammel feil) → den indeksen peker på vinner
  for (const { abs, rel } of walk(FILES_ROOT)) {
    try {
      const text = fs__default.readFileSync(abs, 'utf8');
      const a = parse(text, { fallbackId: stableId(rel) });
      const løs = !(text.startsWith('---\n') && /(^|\n)tua_id:/.test(text.slice(4, 2200)));   // en vanlig .md sluppet i mappa (Finder) — ennå ikke Tuas: adopteres ved neste save() (frontmatter skrives inn)
      if (løs) { try { const mt = fs__default.statSync(abs).mtimeMs; a.capturedAt = a.createdAt = mt; } catch {} }   // runde 3c: datoen er filas, ikke «nå» — ellers ble saken ny ved hver lesing
      const dup = seenIds.get(a.id);
      if (dup !== undefined) {
        if (index[a.id] !== rel) continue                        // denne er kopien — hopp over, slett aldri
        const i = atoms.findIndex((x) => x.id === a.id); if (i >= 0) atoms.splice(i, 1);   // den første var kopien
      }
      seenIds.set(a.id, rel);
      const dir = path__default.dirname(rel);
      if (dir && dir !== '.') a.project = dir;                 // mappa vinner: flytt fila = flytt atomet
      if (!a.name || a.name === 'Uten tittel') a.name = path__default.basename(rel, '.md');
      // V15 regel 1: fila er endret av noen andre enn Tua siden sist skriving → NY versjon, aldri merge.
      // Versjonen telles opp her (i minnet); neste save() fester den og bevarer den redigerte teksten i .tua/versions.
      const w = written[a.id];
      const sha = sha256(text);
      if (w && w.sha !== sha) { a.version = Math.max(a.version || 1, w.version || 1) + 1; a.editedOutside = true; }
      atoms.push(a);
      spor.lest.set(a.id, { sha, md: serialize(a), rel });        // grunnlaget: fila slik den lå, og saken slik vi leste den
      if (a.editedOutside || løs) spor.dirty.add(a.id);            // V15 regel 1: den nye versjonen skal festes ved neste save(); en løs fil adopteres (som før)
    } catch { /* ulesbar fil — hopp over, slett aldri */ }
  }
  // Mappa er sannheten — også for sletting (V9/V12: «rydding skjer i Finder»). Det gamle sikkerhetsnettet som la inn igjen
  // atomer fra indeks-cachen (atoms.json) når fila manglet, gjenopprettet filer brukeren nettopp hadde slettet i Finder.
  // Fjernet (funnet 14.10.2026 i M14-økta, kom først til main i 0.5.2). Cachen brukes nå bare når mappa ikke finnes (annen maskin).
  return atoms
}

// ── M9: lenker — atomet bærer sine egne pekere ──────────────────────────────
// Eksplisitte lenker bor på atomet (`links`, fil-feltet `lenker`). Avledede
// lenker regnes ut ved lesing: atomets egen .md-fil (fra indeksen), og repo +
// Desktop-prosjekt fra prosjektregisteret (.tua/projects.json, skrevet av sync).
const LINK_KINDS = ['file', 'url', 'repo', 'claude-project', 'claude-chat', 'utdrag'];   // utdrag (skive 3, arb. 33): et utdrag av en annen sak — {id, versjon, fra, til} sier hvor i saken
const claudeProjectHref = (uuid) => `claude://claude.ai/project/${uuid}`;
function normalizeLinks(list) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    if (!l || typeof l !== 'object') continue
    const kind = LINK_KINDS.includes(l.kind) ? l.kind : (/^claude:\/\/claude\.ai\/project\//.test(l.href) ? 'claude-project' : /^claude:\/\/claude\.ai\/chat\//.test(l.href) ? 'claude-chat' : /^https?:\/\//.test(l.href) ? 'url' : 'file');
    const href = String(l.href || '').trim();
    if (!href || out.some((o) => o.kind === kind && o.href === href)) continue
    const utdrag = kind === 'utdrag' && l.id ? { id: String(l.id), ...(l.versjon != null ? { versjon: Number(l.versjon) || 1 } : {}), ...(Number.isFinite(Number(l.fra)) && l.fra !== null ? { fra: Number(l.fra) } : {}), ...(Number.isFinite(Number(l.til)) && l.til !== null ? { til: Number(l.til) } : {}) } : {};
    out.push({ kind, href, ...(l.label ? { label: String(l.label).trim() } : {}), ...utdrag });
  }
  return out
}
const projects = () => { try { return JSON.parse(fs__default.readFileSync(PROJECTS(), 'utf8')) } catch { return {} } };
// Prosjektnavn som skal slås sammen (Erik 15.10.2026): .tua/project-aliases.json = { "navn slik kilden sier det": "mappa i Tua" }.
// Brukes av upsert for alle kilder (lagring, import, hooks), så én mappe per prosjekt uansett hvor atomet kom fra.
const ALIASES = () => path__default.join(FILES_ROOT, '.tua', 'project-aliases.json');
const projectAlias = (name) => {
  const n = String(name || '').trim();
  try {
    const m = JSON.parse(fs__default.readFileSync(ALIASES(), 'utf8'));
    const k = Object.keys(m).find((x) => x !== '_' && x.toLowerCase() === n.toLowerCase());
    return k ? m[k] : n
  } catch { return n }
};
function registerProject(name, { repo, claudeProject } = {}) {
  if (!filesMode() || !name) return false
  const all = projects();
  const key = Object.keys(all).find((k) => k.toLowerCase() === String(name).toLowerCase()) || name;
  const cur = all[key] || {};
  const next = { ...cur, ...(repo ? { repo } : {}), ...(claudeProject ? { claudeProject } : {}) };
  if (JSON.stringify(cur) === JSON.stringify(next)) return false
  all[key] = next;
  fs__default.mkdirSync(path__default.dirname(PROJECTS()), { recursive: true });
  fs__default.writeFileSync(PROJECTS(), JSON.stringify(all, null, 2) + '\n');
  return true
}
const projectOf = (name) => { const all = projects(); const k = Object.keys(all).find((x) => x.toLowerCase() === String(name || '').toLowerCase()); return k ? all[k] : {} };
const fileOf = (a) => { const rel = filesMode() ? readIndex()[a.id] : null; return rel ? path__default.join(FILES_ROOT, rel) : '' };
// Alle lenker for et atom: egne først, så avledede (egen fil, repo, Desktop-prosjekt). Aldri duplikater.
function linksFor(a) {
  const own = fileOf(a);
  const p = projectOf(a.project);
  return normalizeLinks([
    ...(a.links || []),
    ...(own ? [{ kind: 'file', href: own, label: 'Atomet (markdown)' }] : []),
    ...(p.repo ? [{ kind: 'repo', href: p.repo, label: `Repo — ${a.project}` }] : []),
    ...(p.claudeProject ? [{ kind: 'claude-project', href: claudeProjectHref(p.claudeProject), label: `Claude-prosjekt — ${a.project}` }] : []),
  ])
}

// ── M10: output — leveranser, gjengivelser, utlevering, Vault ──────────────
// En leveranse er et atom (kind 'leveranse') bygget av andre atomer: derivedFrom fryser
// hvilken versjon av hvert kildeatom som ble lest, på hvilket nivå. Filene (html/pdf/artifact)
// er gjengivelser (renders) av markdown-kilden — atomet er sannheten, fila kan være utdatert.
const KINDS_GAMLE = new Set(['capture', 'leveranse', 'samtale', 'minne']);
const KINDS = ['capture', 'leveranse', 'samtale', 'minne', 'prompt', 'svar', 'konklusjon'];   // samtale (M14): importert samtale/økt · minne (M14): Claudes eget minne om brukeren, fra eksporten
// prompt (M20a/V16): spørsmålet brukeren stilte, eget atom, gjenbrukbart på tvers av modeller · svar (M20a): det en mottaker (modell) svarte,
// bygget_av peker til prompten og kildene som ble sendt. Ikke «leveranse»: en leveranse settes sammen av arkivet selv (compose), et svar kommer
// utenfra, fra én mottaker, og skal kunne stilles ved siden av andre svar (Forskjeller, M20b) før en konklusjon låses.
// konklusjon (M20b, skive 6, V21): det brukeren til slutt står for når flere har svart — skrevet som utkast av standardmodellen (lokal først),
// rettet og låst av brukeren; bygget_av peker til spørsmålet og alle svar-sakene. Prompt-saken får `ga` = [{id, version}] med alle svarene den ga (V16).
const normalizeDerived = (list) => (Array.isArray(list) ? list : [])
  .filter((d) => d && d.id).map((d) => ({ id: String(d.id), version: Number(d.version) || 1, level: LEVELS.includes(d.level) ? d.level : 'L' }));
const normalizeRenders = (list) => (Array.isArray(list) ? list : [])
  .filter((r) => r && (r.path || r.url)).map((r) => {
    const out = { format: String(r.format || (r.url ? 'artifact' : path__default.extname(r.path).slice(1) || 'file')) };
    if (r.path) { out.path = String(r.path); out.sha256 = r.sha256 || sha256File(r.path) || undefined; }
    if (r.url) out.url = String(r.url);
    out.at = Number(r.at) || Date.now();
    return out
  });
// Vault (V15 regel 2): et atom tagget «vault» utleveres aldri utover S til noen modell — uansett nivå.
const isVault = (a) => (a.tags || []).some((t) => String(t).toLowerCase() === 'vault');
const vaultClamp = (a, level) => (isVault(a) && level !== 'S' ? 'S' : level);
// Kildene til en leveranse, med utdatert-merke når kildeatomet har gått videre (v2 → v4).
function sources(atoms, a) {
  return (a.derivedFrom || []).map((d) => {
    const src = atoms.find((x) => x.id === d.id);
    return { ...d, name: src?.name || '(slettet)', project: src?.project || '', now: src?.version || null, stale: !!src && (src.version || 1) > d.version, missing: !src }
  })
}
const staleSources = (atoms, a) => sources(atoms, a).filter((s) => s.stale);
// Gjengivelsenes tilstand: finnes fila, og er den uendret siden den ble rendret (sha256)?
const renderStatus = (a) => (a.renders || []).map((r) => {
  if (!r.path) return { ...r, exists: true, changed: false }
  const now = sha256File(r.path);
  return { ...r, exists: now !== null, changed: now !== null && !!r.sha256 && now !== r.sha256 }
});
// M11: gjengivelser eksporteres inn i arkivet — kopien ligger ved siden av atomets .md i samme
// mappe (Dropbox/Tua/<prosjekt>/<navn>.pdf), så Finder/Dropbox/iCloud ser dokumentet, ikke bare kilden.
// walk() leser bare .md, så kopien blir aldri et eget atom. TUA_RENDERS_DIR overstyrer målmappa
// (f.eks. en iCloud Drive-mappe); standard er atomets egen prosjektmappe.
const RENDERS_DIR = process.env.TUA_RENDERS_DIR || '';
const isInside = (p, dir) => { const r = path__default.relative(dir, p); return !!r && !r.startsWith('..') && !path__default.isAbsolute(r) };
function exportRenders(a) {
  let n = 0;
  for (const r of a.renders || []) {
    if (!r.path || !fs__default.existsSync(r.path) || (!RENDERS_DIR && isInside(r.path, FILES_ROOT))) continue
    const dir = RENDERS_DIR || path__default.join(FILES_ROOT, a.project || 'Uten prosjekt');
    const dest = path__default.join(dir, safeName(a.name, 80) + path__default.extname(r.path).toLowerCase());
    const srcSha = sha256File(r.path);
    if (fs__default.existsSync(dest) && sha256File(dest) === srcSha) { r.copy = dest; continue }
    try { fs__default.mkdirSync(dir, { recursive: true }); fs__default.copyFileSync(r.path, dest); r.copy = dest; r.sha256 = srcSha; n++; } catch { /* la kilden stå */ }
  }
  return n
}

// M23 (skive 4, V21 «arbeidsløp som status på sak»): status utkast | endelig. Standard uten nøkkel i fila: et svar fra en modell
// er utkast til noen låser det («Lås som endelig» i sak-panelet); alt annet er endelig. Nøkkelen `status` skrives bare når den er satt.
const STATUSER = ['utkast', 'endelig'];
const statusOf = (a) => (STATUSER.includes(a?.status) ? a.status : a?.kind === 'svar' || a?.kind === 'konklusjon' ? 'utkast' : 'endelig');
// Utleveringslogg (V15 regel 3): hver gang innhold går UT av arkivet til en modell — hva, hvilken versjon,
// hvilket nivå, til hvem. Bare metadata, aldri innhold. .tua/utlevering.jsonl, én linje per utlevering.
function logDelivery(entry) {
  try {
    const p = DELIVERY();
    fs__default.mkdirSync(path__default.dirname(p), { recursive: true });
    fs__default.appendFileSync(p, JSON.stringify({ at: Date.now(), ...entry }) + '\n');
    return true
  } catch { return false }
}
// M20a: en sending fra motoren (tool: 'spor') er ÉN linje med `saker: [{id, version, level}]` — den treffer på hver av sakene.
function deliveries(id, limit = 10) {
  try {
    return fs__default.readFileSync(DELIVERY(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((e) => e && (!id || e.id === id || (Array.isArray(e.saker) && e.saker.some((s) => s && s.id === id)) || e.prompt === id || e.svar === id || e.samtale === id || (Array.isArray(e.vendinger) && e.vendinger.some((v) => v && v.id === id)))).slice(-limit)   // skive 1 (arb. 33): også sendinger der saken var spørsmålet, svaret, samtalen eller en vending
  } catch { return [] }
}
// Runde 1: Spørs biprodukter som ÉN tråd. Ett spørsmål til to modeller gir fem saker (prompt, to svar, Forskjeller, konklusjon); i avisen, Oppslag,
// søket og «Legg til fra arkivet» skal de stå som én. tråder(atoms) → { av: Map<id, promptId>, per: Map<promptId, {prompt, svar, forskjeller, konklusjon}> }.
//   svar/konklusjon: derivedFrom peker på prompten (eller prompten har dem i ga) · Forskjeller: kind svar med taggen forskjeller, derivedFrom peker på svarene.
// Prompten selv får tråd = egen id. Saker uten prompt får ingen tråd.
function tråder(atoms) {
  const av = new Map(), per = new Map();
  const prompter = atoms.filter((a) => a.kind === 'prompt');
  const erForskjeller = (a) => a.kind === 'svar' && (a.tags || []).some((t) => String(t).toLowerCase() === 'forskjeller');
  for (const p of prompter) { per.set(p.id, { prompt: p.id, svar: [], forskjeller: [], konklusjon: null }); av.set(p.id, p.id); }
  const promptAv = (a) => (a.derivedFrom || []).map((d) => d.id).find((id) => per.has(id)) || prompter.find((p) => (p.ga || []).some((g) => g.id === a.id))?.id || null;
  for (const a of atoms) {
    if (a.kind === 'prompt' || erForskjeller(a)) continue
    if (a.kind !== 'svar' && a.kind !== 'konklusjon') continue
    const pid = promptAv(a); if (!pid) continue
    av.set(a.id, pid); const t = per.get(pid);
    if (a.kind === 'konklusjon') t.konklusjon = a.id; else t.svar.push(a.id);
  }
  for (const a of atoms.filter(erForskjeller)) {
    const pid = (a.derivedFrom || []).map((d) => av.get(d.id)).find(Boolean) || promptAv(a); if (!pid) continue
    av.set(a.id, pid); per.get(pid).forskjeller.push(a.id);
  }
  return { av, per }
}
// Sett sammen en leveranse av atomer lest på ett nivå. Vault-atomer går alltid inn som S.
function compose(atoms, { ids, level = 'M', name, intro, context }) {
  const parts = [], derivedFrom = [], notes = [];
  for (const id of ids) {
    const a = atoms.find((x) => x.id === id);
    if (!a) { notes.push(`fant ikke ${id}`); continue }
    if (context && !visibleIn(a, context)) { notes.push(`${a.name}: ikke synlig for ${context}`); continue }
    let eff = clampLevel(level, maxLevel(a, context));
    if (isVault(a) && eff !== 'S') { eff = 'S'; notes.push(`«${a.name}» er Vault-merket — tatt med bare som S`); }
    const got = levelOf(a, eff);
    derivedFrom.push({ id: a.id, version: a.version || 1, level: eff });
    parts.push(`## ${a.name}\n_${a.project} · ${a.convo || '—'} · v${a.version || 1} · lest på nivå ${eff}${got.fallback ? ` (${got.level})` : ''}_\n\n${got.text.trim()}`);
  }
  const content = [`# ${name}`, intro ? intro.trim() : '', ...parts].filter(Boolean).join('\n\n');
  return { content, derivedFrom, notes }
}

// ── versjonshistorikk: .tua/versions/<id>/v<n>.md ─────────────────────────
// Før en fil overskrives, bevares den gamle som egen fil. Aldri inne i hovedfila
// (Quick Look skal vise toppen = S), aldri slettet. Første fangst av v<n> vinner;
// en annen tilstand med samme versjonsnummer får tidsstempel i navnet.
const VERSIONS_DIR = () => tuaFile('versions');
function keepVersion(id, oldText, { merk = '' } = {}) {
  const n = (oldText.match(/^versjon:\s*(\d+)/m) || [])[1] || '0';
  const dir = path__default.join(VERSIONS_DIR(), id);
  fs__default.mkdirSync(dir, { recursive: true });
  let p = path__default.join(dir, merk ? `v${n}-${merk}-${Date.now()}.md` : `v${n}.md`);   // runde 3c: «konflikt» = vår tekst da disk vant (aldri tap)
  if (fs__default.existsSync(p)) {
    if (fs__default.readFileSync(p, 'utf8') === oldText) return
    p = path__default.join(dir, `v${n}-${merk ? merk + '-' : ''}${Date.now()}.md`);
  }
  fs__default.writeFileSync(p, oldText);
}
function versions(id) {
  if (!filesMode()) return []
  const dir = path__default.join(VERSIONS_DIR(), id);
  let names = [];
  try { names = fs__default.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return [] }
  return names
    .map((f) => { const st = fs__default.statSync(path__default.join(dir, f)); return { name: f.replace(/\.md$/, ''), size: st.size, mtime: st.mtimeMs } })
    .sort((x, y) => x.mtime - y.mtime)
}
function readVersion(id, name) {
  const p = path__default.join(VERSIONS_DIR(), id, name.replace(/[^\w.-]/g, '') + '.md');
  try { return parse(fs__default.readFileSync(p, 'utf8'), { fallbackId: id }) } catch { return null }
}

// Relaterte atomer: samme samtale (sterkest), synlig i samme prosjekter, felles tagger.
function related(atoms, a, limit = 5) {
  const others = atoms.filter((x) => x.id !== a.id);
  const sameConvo = a.convo ? others.filter((x) => x.convo && x.convo.toLowerCase() === a.convo.toLowerCase()) : [];
  const seen = new Set(sameConvo.map((x) => x.id));
  const viaRefs = (a.refs || []).length
    ? others.filter((x) => !seen.has(x.id) && (a.refs || []).some((r) => visibleIn(x, r)))
    : [];
  for (const x of viaRefs) seen.add(x.id);
  const tagSet = new Set((a.tags || []).map((t) => t.toLowerCase()));
  const sameTags = tagSet.size
    ? others.filter((x) => !seen.has(x.id) && (x.tags || []).some((t) => tagSet.has(t.toLowerCase())))
    : [];
  const by = (list) => list.sort((x, y) => y.capturedAt - x.capturedAt).slice(0, limit);
  return { sameConvo: by(sameConvo), viaRefs: by(viaRefs), sameTags: by(sameTags) }
}

// Finder-tagger: com.apple.metadata:_kMDItemUserTags = binær plist. Hex via plistlib,
// skrevet med xattr. spawnSync med argv — ingen shell-strenger. Bare macOS; på Windows/Linux står taggene
// uansett i frontmatter (`tagger`), så ingenting går tapt — de vises bare ikke i filbehandleren.
function setFinderTags(file, tags) {
  if (!IS_MAC || process.platform !== 'darwin' || !tags.length) return false
  const py = spawnSync('python3', ['-c', 'import plistlib,sys;print(plistlib.dumps(sys.argv[1:],fmt=plistlib.FMT_BINARY).hex())', ...tags], { encoding: 'utf8' });
  if (py.status !== 0) return false
  return spawnSync('xattr', ['-wx', 'com.apple.metadata:_kMDItemUserTags', py.stdout.trim(), file], { encoding: 'utf8' }).status === 0
}

// M12: én skriver om gangen. Flere prosesser (Desktop-server, Code-server, bro, sync, hook) kan
// kalle save() samtidig; låsen (.tua/.lock, atomisk mkdir) serialiserer dem og gjelder HELE save (indeks, written.json, filene). Gammel lås
// (> 15 s, en prosess som døde) fjernes. Venter maks 3 s, så skrives det uansett (aldri tap).
const LOCK = () => tuaFile('.lock');
function acquireLock() {
  const t0 = Date.now();
  while (true) {
    try { fs__default.mkdirSync(LOCK(), { recursive: false }); return true } catch {}
    try { if (Date.now() - fs__default.statSync(LOCK()).mtimeMs > 15000) { fs__default.rmSync(LOCK(), { recursive: true, force: true }); continue } } catch { continue }
    if (Date.now() - t0 > 3000) return false
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}
const releaseLock = () => { try { fs__default.rmSync(LOCK(), { recursive: true, force: true }); } catch {} };

// ── Runde 3c (24.10.2026, V8-svakheten): ÉN SKRIVER — dirty-sporing, treveis fletting, delt written.json ──────────────────────────
// Før: save() skrev hver sak hvis serialiseringen avvek fra disk — en prosess med gammelt minne (hook fra forrige plugin-versjon, en bro som lastet
// for en time siden) skrev HELE arkivet tilbake og strøk det andre hadde skrevet (hendelsen 24.10: 1 035 filer uten drift/fanget).
// Nå: load() husker, på selve lista (WeakMap), fila sin sha og saken slik den ble lest. save(atoms) skriver bare det DENNE prosessen har endret —
// serialiseringen avviker fra det som ble lest, saken er ny, eller markDirty(atoms, id) er kalt. saveAll(atoms) tar alle (review/merking; også
// normalisering av filer som avviker fra disk). En liste som ikke kommer fra load() (tester, tom liste) behandles som før (alle).
// Før hver skriving leses fila igjen under låsen. Er den endret av en annen prosess siden vi leste (sha ≠ det vi leste), flettes TREVEIS mot det vi leste:
//   · felter (flagg, status, kind, tagger, synlighet, lenker, …) vi endret og den andre ikke rørte, blir med; samme felt endret av begge → disk vinner
//   · kroppen (tittel, L, S/M, versjon) flettes ALDRI (V15): har bare vi endret den, blir vår med; har begge → disk vinner, og vår serialisering legges
//     i .tua/versions/<id>/v<n>-konflikt-<tid>.md. Ingenting går tapt.
// written.json er delt på id for alle Tua-prosesser: bare id-ene vi faktisk skrev oppdateres (før: alle), så en annen prosess' fil regnes aldri som
// «redigert utenfra» i load() fordi vi overskrev sha-en dens med vår gamle. Resultatet står i sisteSave {skrevet, hoppet, flettet, konflikter}.
const SPOR = new WeakMap();
const sporFor = (atoms) => (Array.isArray(atoms) ? SPOR.get(atoms) || null : null);
function nyttSpor(atoms) { const s = { lest: new Map(), dirty: new Set() }; SPOR.set(atoms, s); return s }
function markDirty(atoms, id) { const s = sporFor(atoms); if (s && id) s.dirty.add(String(id)); return !!s }
function erDirty(atoms, a) { const s = sporFor(atoms); if (!s || !a) return true; const l = s.lest.get(a.id); return s.dirty.has(a.id) || !l || serialize(a) !== l.md }
const FELT_FLETT = ['drift', 'fanget', 'beholdt', 'status', 'kind', 'tags', 'refs', 'share', 'links', 'key', 'renders', 'ga', 'derivedFrom', 'ekstra', 'hørerTil', 'hørerTilForslag', 'arbeid', 'gren', 'vert'];   // friksjon 20: koblingene flettes som felter
const KROPP = ['name', 'content', 'summary', 'convo', 'source', 'levels', 'version', 'capturedAt', 'size'];
const jsonAv = (x) => JSON.stringify(x ?? null);
// Treveis: mem (vårt minne), base (slik vi leste fila), disk (slik fila ligger nå, skrevet av noen andre). Returnerer { atom, konflikt, felter }.
function flettTreveis(mem, base, disk) {
  const ut = { ...disk, id: mem.id, project: mem.project };
  const felter = [];
  for (const f of FELT_FLETT) if (jsonAv(mem[f]) !== jsonAv(base[f]) && jsonAv(disk[f]) === jsonAv(base[f])) { if (mem[f] === undefined) delete ut[f]; else ut[f] = mem[f]; felter.push(f); }
  const memK = KROPP.some((f) => jsonAv(mem[f]) !== jsonAv(base[f])), diskK = KROPP.some((f) => jsonAv(disk[f]) !== jsonAv(base[f]));
  let konflikt = false;
  if (memK && !diskK) { for (const f of KROPP) { if (mem[f] === undefined) delete ut[f]; else ut[f] = mem[f]; } delete ut.editedOutside; }
  else if (memK && diskK) konflikt = true;                   // disk vinner kroppen; vår legges som konflikt-versjon av kalleren
  return { atom: ut, konflikt, felter }
}
const overta = (a, ut) => { for (const k of Object.keys(a)) delete a[k]; Object.assign(a, ut); return a };

// Skriver bare det som er endret (se over). Flytter fila hvis navnet/prosjektet endret seg. Sletter aldri. Returnerer antall skrevne filer.
function save(atoms, { alle = false } = {}) {
  if (!filesMode()) { writeCache(atoms); return 0 }
  fs__default.mkdirSync(path__default.dirname(LOCK()), { recursive: true });
  const locked = acquireLock();
  try { return saveUnlocked(atoms, { alle }) } finally { if (locked) releaseLock(); }
}
function saveUnlocked(atoms, { alle = false } = {}) {
  const index = readIndex();
  const wr = readWritten();
  const spor = sporFor(atoms);
  const full = alle || !spor;
  const used = new Set();
  const stat = { skrevet: 0, hoppet: 0, flettet: [], konflikter: [], indeksert: 0 };
  // 1) sakene som ikke skal skrives holder filnavnet sitt, så ingen ny fil tar det — og en fil sluppet i mappa (Finder) får plass i indeksen uten å skrives
  const kandidater = [];
  for (const a of atoms) {
    if (full || erDirty(atoms, a)) { kandidater.push(a); continue }
    const rel = spor.lest.get(a.id)?.rel || index[a.id] || path__default.join(a.project || 'Uten prosjekt', fileNameFor(a));
    used.add(rel.toLowerCase());
    if (index[a.id] !== rel) { index[a.id] = rel; stat.indeksert++; }
    stat.hoppet++;
  }
  for (const a of kandidater) {
    const dir = a.project || 'Uten prosjekt';
    const plain = path__default.join(dir, fileNameFor(a)), suffixed = path__default.join(dir, safeName(a.name, 80) + ` (${String(a.id).slice(-6)}).md`);
    // M17: stabil ved navnekollisjon — det navnet atomet HADDE (plain eller med id-suffiks) beholdes så lenge det er ledig.
    // Før kunne to atomer med samme tittel bytte filnavn ved hver lagring (rekkefølgen i atoms varierer) → omskriving + falske versjoner.
    const prev = index[a.id];
    let rel = prev && (prev === plain || prev === suffixed) && !used.has(prev.toLowerCase()) ? prev : plain;
    if (used.has(rel.toLowerCase())) rel = suffixed;
    // skal fila flyttes, men målet finnes alt (en annen fil) og vi ikke kan flytte: behold forrige navn — aldri to filer med samme atom
    if (prev && prev !== rel && !used.has(prev.toLowerCase()) && fs__default.existsSync(path__default.join(FILES_ROOT, rel)) && fs__default.existsSync(path__default.join(FILES_ROOT, prev))) rel = prev;
    used.add(rel.toLowerCase());
    const abs = path__default.join(FILES_ROOT, rel);
    fs__default.mkdirSync(path__default.dirname(abs), { recursive: true });
    if (prev && prev !== rel) {
      const prevAbs = path__default.join(FILES_ROOT, prev);
      if (fs__default.existsSync(prevAbs) && !fs__default.existsSync(abs)) fs__default.renameSync(prevAbs, abs);
    }
    let before = null;
    try { before = fs__default.readFileSync(abs, 'utf8'); } catch {}
    const lest = spor?.lest.get(a.id);
    if (before !== null && lest && sha256(before) !== lest.sha) {
      // runde 3c: en annen prosess skrev fila etter at vi leste den → flett treveis mot det vi leste; teksten flettes aldri
      let r = null;
      try { r = flettTreveis(a, parse(lest.md, { fallbackId: a.id }), parse(before, { fallbackId: a.id })); } catch {}
      if (r) {
        if (r.konflikt) { keepVersion(a.id, serialize(a), { merk: 'konflikt' }); stat.konflikter.push(a.id); } else stat.flettet.push(a.id);
        overta(a, r.atom);
      }
    } else if (before !== null) {
      // 24.10.2026 (etter at en eldre plugin-versjon strøk `drift`/`fanget` fra 1 035 filer): flagg og status som står i fila på disk,
      // men mangler i minnet, beholdes. Fila er sannheten (V9); en prosess som ikke kjenner et felt skal ikke kunne slette det.
      try {
        const påDisk = parse(before, { fallbackId: a.id });
        for (const felt of ['drift', 'fanget', 'beholdt', 'status', 'hørerTil', 'hørerTilForslag', 'arbeid', 'gren', 'vert']) if (a[felt] === undefined && påDisk[felt] !== undefined) a[felt] = påDisk[felt];   // friksjon 20: koblingene også
        if ((!a.kind || a.kind === 'capture') && påDisk.kind && påDisk.kind !== 'capture' && !KINDS_GAMLE.has(påDisk.kind)) a.kind = påDisk.kind;
        if (!a.ekstra && påDisk.ekstra) a.ekstra = påDisk.ekstra;                 // runde 3c: nøkler vi ikke kjenner, følger med
      } catch {}
    }
    delete a.editedOutside;                              // festes nå: versjonen er talt opp, teksten under bevares
    if (a.renders?.length) exportRenders(a);              // M11: html/pdf-kopi ved siden av atomet i arkivet
    const md = serialize(a);
    if (before !== md) {
      if (before !== null) keepVersion(a.id, before);   // historikk: forrige versjon bevares som egen fil
      fs__default.writeFileSync(abs, md);
      setFinderTags(abs, [...new Set([...(a.tags || []), a.project])]);
      stat.skrevet++;
    }
    index[a.id] = rel;
    wr[a.id] = { sha: sha256(md), version: a.version || 1 };           // bare det vi skrev — aldri andres id-er
    if (spor) { spor.lest.set(a.id, { sha: sha256(md), md, rel }); spor.dirty.delete(a.id); }
  }
  writeIndex(index);
  fs__default.writeFileSync(WRITTEN(), JSON.stringify(wr, null, 2) + '\n');
  writeCache(atoms);
  return stat.skrevet
}
const hasExternalEdits = (atoms) => atoms.some((a) => a.editedOutside);

const firstLine = (s) =>
  (s.split('\n').find((l) => l.trim()) || 'Uten tittel').replace(/^#+\s*/, '').slice(0, 80).trim();   // trim: et mellomrom på slutten ga ellers en falsk ny versjon ved neste lesing

// ── Nivåer S/M/L (M8) ───────────────────────────────────────────────────────
// S ≤ 300 tegn (ingress), M ≤ 2 500 tegn (sammendrag), L = alt. Tekstene bor på
// atomet (levels), nivået en mottaker får se bor på referansen (share).
// `of` = atom-versjonen nivået beskriver → utdatert er en beregning, ikke et flagg.
const LEVELS = ['S', 'M', 'L'];
const S_MAX = 300, M_MAX = 2500, SHORT_L = 600, LONG_L = 3000;
const RANK = { menneske: 3, Claude: 2, regel: 1 };          // hvem vinner ved konflikt
const rankOf = (by) => RANK[by] ?? 2;                        // annen AI teller som Claude

const mkLevel = (text, by, of) => {
  const t = String(text || '').trim();
  return t ? { text: t, by: by || 'Claude', of: of } : null
};
const isStale = (a, L) => { const lv = a.levels?.[L]; return !!lv && lv.of != null && lv.of !== (a.version || 1) };
// Trenger atomet et nytt nivå? S: mangler/utdatert. M: bare når innholdet er langt.
const needsLevel = (a, L) => {
  if (L === 'S' && (a.content || '').length <= SHORT_L) return false   // kort atom: L er S
  if (L === 'M' && (a.content || '').length <= LONG_L) return false
  return !a.levels?.[L]?.text || isStale(a, L)
};

// Les et nivå med fallkjede. S → hvorfor-linjen → utdrag; M → L hvis kort nok → starten av L.
// Returnerer { text, level (det du faktisk fikk), fallback, stale, by, of }.
function levelOf(a, want = 'L') {
  const content = a.content || '';
  if (want === 'L') return { text: content, level: 'L', fallback: false, stale: false }
  const lv = a.levels?.[want];
  if (lv?.text) return { text: lv.text, level: want, fallback: false, stale: isStale(a, want), by: lv.by, of: lv.of }
  if (want === 'M') {
    if (content.length <= M_MAX) return { text: content, level: 'L', fallback: true, stale: false }
    return { text: content.slice(0, M_MAX).trimEnd() + '…', level: 'utdrag', fallback: true, stale: false }
  }
  if (content.length <= SHORT_L) return { text: content, level: 'L', fallback: true, stale: false }   // kort atom: L er S
  if (a.summary) return { text: a.summary, level: 'hvorfor', fallback: true, stale: false }
  const flat = content.replace(/\s+/g, ' ').trim();
  return { text: flat.slice(0, S_MAX) + (flat.length > S_MAX ? '…' : ''), level: 'utdrag', fallback: true, stale: false }
}

// Nivået et prosjekt (mottaker) får se. Uten kontekst, eller i prosjektet atomet
// oppsto i: alt (V6). Referanse uten eksplisitt nivå: L (V11 — eieren ser alt;
// S blir standard den dagen mottakeren er en annen person).
const shareKey = (a, ctx) => Object.keys(a.share || {}).find((p) => p.toLowerCase() === ctx.toLowerCase());
function maxLevel(a, ctx) {
  if (!ctx || a.project.toLowerCase() === ctx.toLowerCase()) return 'L'
  const k = shareKey(a, ctx);
  return (k && a.share[k]) || 'L'
}
const clampLevel = (want, max) => (LEVELS.indexOf(want) > LEVELS.indexOf(max) ? max : want);
function setShare(a, project, level) {
  const k = shareKey(a, project) || project;
  if (!a.share) a.share = {};
  if (!level || level === 'L') delete a.share[k];
  else a.share[k] = level;
  if (!Object.keys(a.share).length) delete a.share;
}

// Proveniens festes automatisk. Ingen mappe å velge — prosjektet ER mappa.
// short/medium = S/M som flate felt; by = hvem som skrev dem (Claude · regel · menneske).
// M19 (skive 8, V16): `ga` = [{id, version}] — svarene en prompt-sak ga. Normaliseres som derivedFrom; upsert slår lista SAMMEN (union på id), aldri erstatter.
const normalizeGa = (list) => (Array.isArray(list) ? list : []).filter((g) => g && g.id).map((g) => ({ id: String(g.id), version: Number(g.version) || 1 }));
const mergeGa = (gammel = [], ny = []) => { const ut = [...normalizeGa(gammel)]; for (const g of normalizeGa(ny)) { const i = ut.findIndex((x) => x.id === g.id); if (i < 0) ut.push(g); else ut[i] = g; } return ut };
function makeAtom({ content, name, source, project, convo, summary, tags, short, medium, by, levels, links, kind, derivedFrom, renders, ga, fanget, drift, beholdt, hørerTil, hørerTilForslag, arbeid, gren, vert, gjentatt }) {
  const body = String(content || '').replace(/\r\n?/g, '\n').trim();   // M17: fila leses tilbake uten \r (files.js) — lagre likt, ellers blir hver import en «ny versjon»
  const now = Date.now();
  const a = {
    id: uid(),
    kind: KINDS.includes(kind) ? kind : 'capture',
    name: (name || '').trim() || firstLine(body),
    type: 'text/markdown',
    isText: true,
    content: body,
    size: Buffer.byteLength(body, 'utf8'),
    createdAt: now,
    source: (source || 'Claude').trim(),
    project: (project || '').trim() || 'Uten prosjekt',
    convo: (convo || '').trim(),
    capturedAt: now,
    tags: (tags || []).map((t) => String(t).trim()).filter(Boolean),
    summary: (summary || '').trim(),
  };
  const lv = { ...(levels || {}) };
  const S = mkLevel(short, by, 1), M = mkLevel(medium, by, 1);
  if (S) lv.S = S;
  if (M) lv.M = M;
  if (Object.keys(lv).length) a.levels = lv;
  const ln = normalizeLinks(links);
  if (ln.length) a.links = ln;
  const df = normalizeDerived(derivedFrom); if (df.length) { a.derivedFrom = df; if (!kind) a.kind = 'leveranse'; }
  const rd = normalizeRenders(renders); if (rd.length) a.renders = rd;
  const g = normalizeGa(ga); if (g.length) a.ga = g;
  if (fanget === true || fanget === false) a.fanget = fanget;            // runde 2c: true = fanget automatisk, false = løftet inn — se Fanget-bøtta nederst
  if ((drift === true && !erMenneskeskrevet(a)) || drift === false) a.drift = drift;   // runde 2d: Tua om seg selv — aldri på noe et menneske har skrevet
  if (beholdt === true) a.beholdt = true;                                   // runde 2d: beholdt av brukeren
  // friksjon 20: koblingen til arbeidet (hører_til), forslaget, arbeid-flagget og sporene hooken setter (gren, vert)
  if (typeof hørerTil === 'string' && hørerTil) a.hørerTil = hørerTil;
  if (typeof hørerTilForslag === 'string' && hørerTilForslag) a.hørerTilForslag = hørerTilForslag;
  if (arbeid === true) a.arbeid = true;
  if (typeof gren === 'string' && gren) a.gren = gren;
  if (typeof vert === 'string' && vert) a.vert = vert;
  if (gjentatt === true) a.gjentatt = true;                                // skive 3 (arb. 33 §7): gjentatt kjøring ved import
  return a
}

// Slå sammen gamle og nye nivåer. Et nytt nivå erstatter det gamle når det er
// skrevet av noen med minst samme rang, eller når det gamle er utdatert —
// men et menneskeskrevet nivå overskrives aldri automatisk (V10), bare merkes utdatert.
function mergeLevels(oldL = {}, newL = {}, version) {
  const out = {};
  for (const L of ['S', 'M']) {
    const o = oldL[L], n = newL[L];
    const replace = n && (!o || n.by === 'menneske' || (o.by !== 'menneske' && (rankOf(n.by) >= rankOf(o.by) || (o.of != null && o.of !== version))));
    if (replace) out[L] = { ...n, of: version };
    else if (o) out[L] = o;
  }
  return Object.keys(out).length ? out : undefined
}
const sameJson = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

// Upsert på stabil nøkkel: samme key i samme prosjekt → innholdet erstattes,
// id, synlighet (refs/share) og opprinnelse beholdes, versjon telles opp.
// Status: ny · oppdatert (nytt innhold, ny versjon) · nivåer (bare S/M endret,
// samme versjon) · uendret.
function upsert(atoms, { key, ...data }) {
  data.project = projectAlias(data.project);
  const proj = (data.project || '').trim() || 'Uten prosjekt';
  const i = key
    ? atoms.findIndex((a) => a.key === key && a.project.toLowerCase() === proj.toLowerCase())
    : -1;
  if (i < 0) {
    const a = makeAtom(data);
    if (key) { a.key = key; a.version = 1; }
    atoms.push(a);
    markDirty(atoms, a.id);
    return { atom: a, status: 'ny' }
  }
  const old = atoms[i];
  const fresh = makeAtom({ ...data, project: old.project, source: data.source || old.source });
  const sameConvo = !fresh.convo || fresh.convo === old.convo;
  const bodySame = old.content === fresh.content && old.name === fresh.name && old.summary === fresh.summary && sameConvo;
  const version = bodySame ? (old.version || 1) : (old.version || 1) + 1;
  const levels = mergeLevels(old.levels, fresh.levels, version);
  const links = fresh.links?.length ? fresh.links : old.links;          // nye lenker erstatter; ingen sendt = behold
  const derivedFrom = fresh.derivedFrom?.length ? fresh.derivedFrom : old.derivedFrom;
  const renders = fresh.renders?.length ? fresh.renders : old.renders;
  const ga = fresh.ga?.length || old.ga?.length ? mergeGa(old.ga, fresh.ga) : undefined;   // M19: `ga` vokser av bruk — union, aldri erstatning
  const kind = data.kind || (derivedFrom?.length ? 'leveranse' : old.kind);
  // runde 2c: en sak som finnes beholder sin fanget-tilstand. Er den løftet inn (eller lagret med vilje), setter ingen ny import flagget igjen;
  // er den fanget, tar bare en eksplisitt `fanget: false` (Behold) det bort. Brukerens valg vinner over regelen — alltid.
  const fanget = data.fanget === false ? false : old.fanget;
  // runde 2d: drift følger samme logikk — har brukeren sagt «dette er arbeid» (drift: false), setter ingen regel det igjen; menneskeskrevet merkes aldri drift.
  const drift = old.drift === false || data.drift === false ? false : data.drift === true && !erMenneskeskrevet(old) ? true : old.drift;
  const beholdt = data.beholdt === false ? undefined : data.beholdt === true ? true : old.beholdt;   // beholdt tas bare bort eksplisitt
  // friksjon 20: koblingen til et arbeid beholdes til noen løsner den (settHørerTil/løsne i arbeid.js) — en ny import eller hook-kjøring setter den bare når saken ikke har noen;
  // forslaget faller når koblingen er satt; arbeid-flagget tas aldri bort av upsert; gren og vert erstattes når nye er sendt
  const hørerTil = old.hørerTil || (typeof data.hørerTil === 'string' && data.hørerTil ? data.hørerTil : undefined);
  const hørerTilForslag = hørerTil ? undefined : (old.hørerTilForslag || (typeof data.hørerTilForslag === 'string' && data.hørerTilForslag ? data.hørerTilForslag : undefined));
  const arbeid = old.arbeid === true || data.arbeid === true ? true : undefined;
  const gren = (typeof data.gren === 'string' && data.gren) ? data.gren : old.gren, vert = (typeof data.vert === 'string' && data.vert) ? data.vert : old.vert;
  const gjentatt = data.gjentatt === false ? undefined : data.gjentatt === true ? true : old.gjentatt;   // skive 3: settes ved import, tas bare bort eksplisitt
  const attach = (a) => {
    if (levels) a.levels = levels; else delete a.levels;
    if (links) a.links = links; else delete a.links;
    if (derivedFrom) a.derivedFrom = derivedFrom; else delete a.derivedFrom;
    if (renders) a.renders = renders; else delete a.renders;
    if (ga) a.ga = ga; else delete a.ga;
    if (fanget === true || fanget === false) a.fanget = fanget; else delete a.fanget;
    if (drift === true || drift === false) a.drift = drift; else delete a.drift;
    if (beholdt === true) a.beholdt = true; else delete a.beholdt;
    if (hørerTil) a.hørerTil = hørerTil; else delete a.hørerTil;
    if (hørerTilForslag) a.hørerTilForslag = hørerTilForslag; else if (old.hørerTilForslag) a.hørerTilForslag = ''; else delete a.hørerTilForslag;   // tom = tatt bort med vilje (save() beholder ellers det som står i fila)
    if (arbeid) a.arbeid = true; else if (old.arbeid !== undefined) a.arbeid = false; else delete a.arbeid;
    if (gren) a.gren = gren; else delete a.gren;
    if (vert) a.vert = vert; else delete a.vert;
    if (gjentatt) a.gjentatt = true; else delete a.gjentatt;
    a.kind = kind;
    return a
  };
  if (bodySame) {
    if (sameJson(levels, old.levels) && sameJson(links, old.links) && sameJson(derivedFrom, old.derivedFrom) && sameJson(renders, old.renders) && sameJson(ga, old.ga) && kind === old.kind && fanget === old.fanget && drift === old.drift && beholdt === old.beholdt && hørerTil === old.hørerTil && hørerTilForslag === old.hørerTilForslag && arbeid === old.arbeid && gren === old.gren && vert === old.vert && gjentatt === old.gjentatt) return { atom: old, status: 'uendret' }
    atoms[i] = attach({ ...old });
    markDirty(atoms, old.id);
    return { atom: atoms[i], status: 'nivåer' }
  }
  const a = {
    ...old,
    name: fresh.name,
    content: fresh.content,
    size: fresh.size,
    summary: fresh.summary || old.summary,
    tags: fresh.tags.length ? fresh.tags : old.tags,
    convo: fresh.convo || old.convo,
    source: fresh.source,
    capturedAt: Date.now(),
    version,
  };
  atoms[i] = attach(a);
  markDirty(atoms, a.id);
  return { atom: a, status: 'oppdatert' }
}

// Søkbar tekst — aldri mer enn mottakeren (max-nivået) får se.
const hay = (a, max = 'L') => {
  const parts = [a.name, a.project, a.convo, (a.tags || []).join(' '), a.summary, a.levels?.S?.text];
  if (max !== 'S') parts.push(a.levels?.M?.text);
  if (max === 'L') parts.push(a.content);
  return parts.filter(Boolean).join(' ').toLowerCase()
};

function snippet(text, tokens, len = 200) {
  if (!text) return ''
  const low = text.toLowerCase();
  const hit = tokens.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const start = hit == null ? 0 : Math.max(0, hit - 60);
  const s = text.slice(start, start + len).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + s + (start + len < text.length ? '…' : '')
}

// Synlighet: et atom er synlig i prosjektet det OPPSTO i, og i prosjekter det er
// referert inn i (refs). En referanse er en peker — aldri en kopi. Uten kontekst
// er alt synlig: brukeren eier hele arkivet.
const visibleIn = (a, ctx) => {
  if (!ctx) return true
  const c = ctx.toLowerCase();
  return a.project.toLowerCase() === c || (a.refs || []).some((r) => r.toLowerCase() === c)
};

// M12: rangering — tittel og S veier mer enn M, som veier mer enn L. Et ord som står i
// tittelen er et bedre treff enn et ord dypt nede i et langt innhold. Ferskhet avgjør ved likhet.
const FIELD_WEIGHT = [
  ['name', 4], ['S', 3], ['summary', 3], ['tags', 2], ['project', 2], ['convo', 2], ['M', 1.5], ['L', 1],
];
const fieldText = (a, f, max) => {
  if (f === 'name') return a.name
  if (f === 'S') return a.levels?.S?.text
  if (f === 'summary') return a.summary
  if (f === 'tags') return (a.tags || []).join(' ')
  if (f === 'project') return a.project
  if (f === 'convo') return a.convo
  if (f === 'M') return max !== 'S' ? a.levels?.M?.text : ''
  if (f === 'L') return max === 'L' ? a.content : ''
  return ''
};
function score(a, tokens, max = 'L') {
  let s = 0;
  for (const [f, w] of FIELD_WEIGHT) {
    const t = (fieldText(a, f, max) || '').toLowerCase();
    if (!t) continue
    for (const tok of tokens) if (t.includes(tok)) s += w;
  }
  return s
}

// Treff svarer med S (+ utdrag bare når søkeordene ikke står i S). Med context
// søkes og vises aldri mer enn det prosjektet har lov til å se. Rangert (M12), paginert
// med offset/limit; `total` ligger på resultatet.
// `kind` (M19, skive 8): bare saker av én type — prompt-samlingen i appen og forslagene i Spør søker med kind=prompt.
// `fanget` (runde 2c, 24.10.2026): standard `uten` — fangede saker (hook/import, ikke løftet inn) holdes utenfor; `med` tar dem med; `bare` gir bare dem.
// Resultatet bærer `fanget` = hvor mange fangede saker som traff søket men ble holdt utenfor, så døra kan si det («N fangede saker holdt utenfor»).
// `drift` (runde 2d, 03-avisen §2 A): standard `uten` — drift (Tua om seg selv) holdes utenfor søket; `med` tar den med; `bare` gir bare den.
// Resultatet bærer `drift` = hvor mange drift-saker som traff men ble holdt utenfor. Rekkefølgen: fanget-filteret først, så drift-filteret.
function search(atoms, query, { project, context, kind, fanget = 'uten', drift = 'uten', limit = 8, offset = 0 } = {}) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const treff = atoms
    .filter((a) => !project || a.project.toLowerCase() === project.toLowerCase())
    .filter((a) => !kind || (a.kind || 'capture') === kind)
    .filter((a) => visibleIn(a, context))
    .map((a) => ({ a, max: maxLevel(a, context) }))
    .filter(({ a, max }) => tokens.every((t) => hay(a, max).includes(t)));
  const utenfor = fanget === 'med' ? 0 : treff.filter(({ a }) => (fanget === 'bare' ? !a.fanget : !!a.fanget)).length;
  const etterFanget = treff.filter(({ a }) => fanget === 'med' || (fanget === 'bare' ? !!a.fanget : !a.fanget));
  const driftUtenfor = drift === 'med' ? 0 : etterFanget.filter(({ a }) => (drift === 'bare' ? a.drift !== true : a.drift === true)).length;
  const all = etterFanget
    .filter(({ a }) => drift === 'med' || (drift === 'bare' ? a.drift === true : a.drift !== true))
    .map((x) => ({ ...x, score: tokens.length ? score(x.a, tokens, x.max) : 0 }))
    .sort((x, y) => y.score - x.score || y.a.capturedAt - x.a.capturedAt);
  const page = all.slice(offset, offset + limit).map(({ a, max, score: sc }) => {
    const S = levelOf(a, 'S');
    const inS = tokens.every((t) => S.text.toLowerCase().includes(t));
    const body = max === 'M' ? levelOf(a, 'M').text : a.content;
    return { atom: a, S, max, score: sc, snippet: inS || max === 'S' ? '' : snippet(body, tokens) }
  });
  page.total = all.length;
  page.fanget = utenfor;
  page.drift = driftUtenfor;
  return page
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' })
}

// ── M14: første kjøring og onboarding ───────────────────────────────────────
// Finnes ikke arkivmappa, lages den med ett velkomstatom, og .tua/onboarding.json settes
// «aktiv». Så lenge den er aktiv, legger verktøyene en «onboarding:»-linje i svarene sine
// (Basic Memorys «demonstrate-before-ask»: vis mappa, lagre én ting etter å ha spurt én gang,
// finn den igjen fra et annet prosjekt). Første ekte lagring setter den til «ferdig».
// Et arkiv som allerede finnes (uten flagg) regnes som ferdig — eksisterende brukere onboardes ikke.
const ONBOARDING = () => tuaFile('onboarding.json');
const WELCOME_KEY = 'velkommen', WELCOME_PROJECT = 'Tua';
const WELCOME_S = 'Tua er arkivet for det du lager med AI: hvert stykke blir en fil i denne mappa, med prosjekt, samtale og dato festet automatisk, og kan hentes inn igjen fra ethvert prosjekt. Lagre med «lagre dette til Tua», finn igjen med «hva har jeg om …».';
const WELCOME_L = `# Velkommen til Tua

Tua er arkivet for det du lager sammen med AI. Hvert stykke arbeid blir en fil i denne mappa, med proveniens (prosjekt, samtale, dato) festet automatisk — og kan hentes inn igjen i et hvilket som helst annet prosjekt eller verktøy.

## Slik virker det

- **Lagre:** si «lagre dette til Tua» i Claude. Claude skriver ingressen (S) selv. Det finnes ingen mappe å velge — prosjektet du jobber i blir mappa.
- **Finn igjen:** spør «hva har jeg om …» fra et hvilket som helst prosjekt. Treffene svarer med ingressen, og Claude henter mer (sammendrag, alt) bare når du ber om det.
- **Mappa er sannheten:** hver fil her er et atom. Flytt, gi nytt navn eller slett i Finder — Tua følger etter. En vanlig markdown-fil du legger i en prosjektmappe blir også et atom.
- **Innboks:** legg en eksport fra Claude (claude.ai › Settings › Privacy › Export data) eller ChatGPT (Settings › Data controls › Export) i mappa \`Innboks\`. Hver samtale blir et søkbart atom med peker tilbake til samtalen; fila flyttes til \`Innboks/Ferdig\` når den er lest.
- **S / M / L:** ingress, sammendrag, alt. Nivået bestemmer hvor mye et annet prosjekt — eller en annen person — får se.

Ingenting forlater maskinen din utover din egen skysynk. Tua har ingen server og ingen nøkkel til innholdet ditt.`;

const onboardingState = () => { try { return filesMode() ? JSON.parse(fs__default.readFileSync(ONBOARDING(), 'utf8')) : null } catch { return null } };
const onboardingActive = () => onboardingState()?.state === 'aktiv';
function finishOnboarding(how) {
  const s = onboardingState();
  if (!s || s.state !== 'aktiv') return false
  fs__default.writeFileSync(ONBOARDING(), JSON.stringify({ ...s, state: 'ferdig', ferdig: new Date().toISOString(), ved: how || '' }, null, 2) + '\n');
  return true
}
const welcomeAtom = (atoms) => atoms.find((a) => a.key === WELCOME_KEY && a.project.toLowerCase() === WELCOME_PROJECT.toLowerCase());
// Siste import (Innboks eller Code-økter) — SessionStart-hooken bruker dette til påminnelsen «ny import?»
const importState = () => { try { return filesMode() ? JSON.parse(fs__default.readFileSync(tuaFile('import-state.json'), 'utf8')) : {} } catch { return {} } };
function noteImport(kind, info = {}) {
  if (!filesMode()) return
  const s = importState();
  s.last = { at: Date.now(), kind, ...info };
  s[kind] = { at: Date.now(), ...info };
  fs__default.writeFileSync(tuaFile('import-state.json'), JSON.stringify(s, null, 2) + '\n');
}

// Lager arkivet hvis det ikke finnes. Rører aldri et arkiv som finnes. Returnerer { created, root }.
// Er roten ikke valgt ennå (ny bruker, ingen Tua-mappe funnet), gjøres ingenting: { needsChoice: true }.
function ensureArchive() {
  // 0.5.1: var ingen rot valgt ved oppstart, sjekk config igjen — SessionStart-hooken kan ha skrevet «arkivmappe» dit etter at
  // serveren startet (begge starter samtidig i Claude Code). Samme regel som chooseRoot(); ingen gjetting utover den.
  if (!FILES_ROOT) { const r = chooseRoot(); if (r) { FILES_ROOT = r; INBOX_DIR = path__default.join(r, 'Innboks'); } }
  if (!FILES_ROOT) return { created: false, root: null, needsChoice: true }
  if (fs__default.existsSync(FILES_ROOT)) {
    try { fs__default.mkdirSync(INBOX_DIR, { recursive: true }); } catch {}
    return { created: false, root: FILES_ROOT }
  }
  fs__default.mkdirSync(path__default.join(FILES_ROOT, '.tua'), { recursive: true });
  fs__default.mkdirSync(INBOX_DIR, { recursive: true });
  const atoms = load();                                          // tom mappe (+ evt. cache fra en annen maskin, som nå blir filer)
  upsert(atoms, {
    key: WELCOME_KEY, name: 'Velkommen til Tua', content: WELCOME_L, short: WELCOME_S, project: WELCOME_PROJECT,
    convo: 'Første kjøring', source: 'Tua', by: 'regel', tags: ['velkommen'],
    summary: 'Opprettet automatisk første gang Tua startet på denne maskinen.',
  });
  save(atoms);
  fs__default.writeFileSync(ONBOARDING(), JSON.stringify({ state: 'aktiv', opprettet: new Date().toISOString(), sted: rootLabel(), root: FILES_ROOT }, null, 2) + '\n');
  return { created: true, root: FILES_ROOT }
}
// Sikkerhet for merkingen (review --drift / --fanget): det et menneske har skrevet, merkes aldri drift eller fanget — S eller M skrevet av et menneske,
// eller en kilde som ikke er en maskin (kilde «Erik» fra /api/save og innlesing). Maskinkildene kjennes på ordene; alt annet regnes som menneske.
const MASKINKILDE = /claude|chatgpt|gpt|gemini|ollama|^tua\b|tua$|test|perplexity|cowork|desktop|sync|agent|design|copilot|cursor|mistral|llama|regel|^$/i;
const erMenneskeskrevet = (a) => !!a && (a.levels?.S?.by === 'menneske' || a.levels?.M?.by === 'menneske' || !MASKINKILDE.test(String(a.source || '').trim()));
const erTuaRepo = (root) => !!root && fs__default.existsSync(path__default.join(String(root), 'tua-plugin', 'server', 'store.js'));
// Claude-øktene (03-avisen §5, E): én linje per økt. Økt-id leses av nøkkelen — okt:<økt> (hook), samtale:<økt> (import), svar:<økt8>:… og prompt:<økt8>:… — og
// normaliseres til de åtte første tegnene, så hookens og importens saker fra samme økt lander i samme linje. Filene Claude skrev (fil:…) har ingen økt i nøkkelen;
// de knyttes til økta via samtalenavnet (convo) i samme prosjekt. Bare metadata og id-er — enkeltsakene er fanget til brukeren løfter dem inn.
const ØKT_NØKKEL = /^(?:okt|samtale):([^:]+)$|^(?:svar|prompt):(?!spor:)([^:]+):/;
const øktIdAv = (key) => { const m = ØKT_NØKKEL.exec(String(key || '')); const id = m ? (m[1] || m[2]) : null; return id ? id.slice(0, 8) : null };

export { DATA_DIR, FILE, FILES_ROOT, INBOX_DIR, KINDS, LEVELS, LINK_KINDS, LONG_L, M_MAX, SHORT_L, S_MAX, WELCOME_KEY, archiveOptions, chooseArchive, clampLevel, claudeProjectHref, compose, deliveries, ensureArchive, erTuaRepo, erTuaSak, fileOf, filesMode, finishOnboarding, fmtTime, hasExternalEdits, hashOf, importState, isStale, isVault, levelOf, linksFor, load, logDelivery, markDirty, maxLevel, mergeGa, needsLevel, noteImport, onboardingActive, projectOf, projects, readConfig, readVersion, registerProject, related, renderStatus, rootLabel, save, search, setShare, sha8, sources, staleSources, statusOf, tråder, upsert, vaultClamp, versions, visibleIn, welcomeAtom, øktIdAv };
