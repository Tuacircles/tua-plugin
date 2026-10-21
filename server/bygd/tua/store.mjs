// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs from 'node:fs';
import 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse, fileNameFor, safeName, serialize } from './files.mjs';
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


const HERE = path.dirname(fileURLToPath(new URL("../../store.js", import.meta.url).href));
// 0.5.1: en plugin-vert som ikke erstatter «${…}» i .mcp.json (Cowork uten CLAUDE_PLUGIN_DATA) sender variabelen rå —
// en sti som fortsatt inneholder «${» er ikke en sti, og ignoreres som om den var tom.
const envPath = (name) => { const v = process.env[name]; return v && !v.includes('${') ? v : '' };
const DATA_DIR = envPath('TUA_DATA_DIR') || path.join(HERE, 'data');
const FILE = path.join(DATA_DIR, 'atoms.json');            // avledet indeks

// M14: hvor arkivet bor. TUA_FILES_ROOT vinner alltid. Ellers valget brukeren har tatt (~/.tua/config.json),
// ellers en Tua-mappe som allerede finnes (Dropbox, iCloud Drive, ~/Tua — eksisterende brukere spørres ikke).
// Finnes ingenting, er roten null: Tua GJETTER IKKE, men spør brukeren (tua_setup / elicitation i server.js)
// hvor arkivet skal ligge — iCloud Drive, Dropbox, OneDrive, Google Drive eller lokalt. Valget kan endres
// senere på innstillinger-siden (M15). TUA_HOME overstyrer hjemmemappa (bare for tester).
const CONFIG = path.join(HOME, '.tua', 'config.json');                      // { root, sted, valgt }
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
  return opts.map((o) => ({ ...o, path: o.base ? path.join(o.base, 'Tua') : '', available: !!o.base && fs.existsSync(o.base), exists: !!o.base && fs.existsSync(path.join(o.base, 'Tua')) }))
}
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { return {} } };
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next
}
function chooseRoot() {
  if (envPath('TUA_FILES_ROOT')) return envPath('TUA_FILES_ROOT')
  const c = readConfig();
  if (c.root && fs.existsSync(c.root)) return c.root
  const existing = archiveOptions().find((o) => o.exists);
  return existing ? existing.path : null
}
let FILES_ROOT = chooseRoot();
let INBOX_DIR = FILES_ROOT ? path.join(FILES_ROOT, 'Innboks') : null;   // M14: eksporter legges her, flyttes til Innboks/Ferdig
const rootLabel = () => archiveOptions().find((o) => FILES_ROOT && o.base && (FILES_ROOT === o.path || FILES_ROOT.startsWith(o.base + path.sep)))?.label || 'egen mappe';
// Brukerens valg (M14): id fra archiveOptions() eller en absolutt sti. Lagres i ~/.tua/config.json og arkivet lages.
// Flytter aldri filer (V9: mappa er sannheten — flytting er en Finder-jobb). Andre felt i config (finder) beholdes.
function chooseArchive(idOrPath) {
  const opt = archiveOptions().find((o) => o.id === idOrPath);
  const root = opt ? opt.path : path.resolve(String(idOrPath || '').replace(/^~(?=$|\/)/, HOME));
  if (!opt && !path.isAbsolute(root)) throw new Error(`«${idOrPath}» er verken et kjent sted (${archiveOptions().map((o) => o.id).join(', ')}) eller en absolutt sti`)
  if (opt && !opt.available) throw new Error(`${opt.label} finnes ikke på denne maskinen (${opt.base})`)
  FILES_ROOT = root;
  INBOX_DIR = path.join(root, 'Innboks');
  writeConfig({ root, sted: opt ? opt.label : 'egen mappe', valgt: new Date().toISOString() });
  return { ...ensureArchive(), label: rootLabel() }
}
const tuaFile = (name) => path.join(FILES_ROOT, '.tua', name);
const INDEX = () => tuaFile('index.json');          // id → relativ sti
const PROJECTS = () => tuaFile('projects.json');    // prosjektnavn → { repo, claudeProject }
const WRITTEN = () => tuaFile('written.json');      // id → { sha, version } slik Tua sist skrev fila (M10/V15: oppdager redigering utenfra)
const DELIVERY = () => (filesMode() ? tuaFile('utlevering.jsonl') : path.join(DATA_DIR, 'utlevering.jsonl'));
const filesMode = () => !!FILES_ROOT && fs.existsSync(FILES_ROOT);

const uid = () =>
  'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

// ── cache (atoms.json) ──────────────────────────────────────────────────────
function loadCache() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}
function writeCache(atoms) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(atoms, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error(`[tua] kunne ikke skrive indeks-cachen (${FILE}): ${e.message} — mappa er uansett sannheten`); }   // M14: cachen er avledet; en skrivebeskyttet plugin-mappe skal ikke stoppe lagring
}

// ── mappa ───────────────────────────────────────────────────────────────────
const readIndex = () => { try { return JSON.parse(fs.readFileSync(INDEX(), 'utf8')) } catch { return {} } };
const writeIndex = (ix) => { fs.mkdirSync(path.dirname(INDEX()), { recursive: true }); fs.writeFileSync(INDEX(), JSON.stringify(ix, null, 2) + '\n'); };

function* walk(dir, rel = '') {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue                      // .tua, .DS_Store, Dropbox-sidecars
    if (!rel && e.name === 'Innboks') continue                // M14: Innboks er postkasse, ikke prosjekt
    const abs = path.join(dir, e.name), r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) yield* walk(abs, r);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) yield { abs, rel: r };
  }
}
const stableId = (rel) => 'f_' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 12);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sha256File = (p) => { try { return sha256(fs.readFileSync(p)) } catch { return null } };
const readWritten = () => { try { return JSON.parse(fs.readFileSync(WRITTEN(), 'utf8')) } catch { return {} } };

function load() {
  if (!filesMode()) return loadCache()
  const atoms = [];
  const written = readWritten();
  const index = readIndex();
  const seenIds = new Map();                                     // id → rel; to filer med samme tua_id (kopi i Finder, gammel feil) → den indeksen peker på vinner
  for (const { abs, rel } of walk(FILES_ROOT)) {
    try {
      const text = fs.readFileSync(abs, 'utf8');
      const a = parse(text, { fallbackId: stableId(rel) });
      const dup = seenIds.get(a.id);
      if (dup !== undefined) {
        if (index[a.id] !== rel) continue                        // denne er kopien — hopp over, slett aldri
        const i = atoms.findIndex((x) => x.id === a.id); if (i >= 0) atoms.splice(i, 1);   // den første var kopien
      }
      seenIds.set(a.id, rel);
      const dir = path.dirname(rel);
      if (dir && dir !== '.') a.project = dir;                 // mappa vinner: flytt fila = flytt atomet
      if (!a.name || a.name === 'Uten tittel') a.name = path.basename(rel, '.md');
      // V15 regel 1: fila er endret av noen andre enn Tua siden sist skriving → NY versjon, aldri merge.
      // Versjonen telles opp her (i minnet); neste save() fester den og bevarer den redigerte teksten i .tua/versions.
      const w = written[a.id];
      if (w && w.sha !== sha256(text)) { a.version = Math.max(a.version || 1, w.version || 1) + 1; a.editedOutside = true; }
      atoms.push(a);
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
const LINK_KINDS = ['file', 'url', 'repo', 'claude-project', 'claude-chat'];
const claudeProjectHref = (uuid) => `claude://claude.ai/project/${uuid}`;
function normalizeLinks(list) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    if (!l || typeof l !== 'object') continue
    const kind = LINK_KINDS.includes(l.kind) ? l.kind : (/^claude:\/\/claude\.ai\/project\//.test(l.href) ? 'claude-project' : /^claude:\/\/claude\.ai\/chat\//.test(l.href) ? 'claude-chat' : /^https?:\/\//.test(l.href) ? 'url' : 'file');
    const href = String(l.href || '').trim();
    if (!href || out.some((o) => o.kind === kind && o.href === href)) continue
    out.push({ kind, href, ...(l.label ? { label: String(l.label).trim() } : {}) });
  }
  return out
}
const projects = () => { try { return JSON.parse(fs.readFileSync(PROJECTS(), 'utf8')) } catch { return {} } };
// Prosjektnavn som skal slås sammen (Erik 15.10.2026): .tua/project-aliases.json = { "navn slik kilden sier det": "mappa i Tua" }.
// Brukes av upsert for alle kilder (lagring, import, hooks), så én mappe per prosjekt uansett hvor atomet kom fra.
const ALIASES = () => path.join(FILES_ROOT, '.tua', 'project-aliases.json');
const projectAlias = (name) => {
  const n = String(name || '').trim();
  try {
    const m = JSON.parse(fs.readFileSync(ALIASES(), 'utf8'));
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
  fs.mkdirSync(path.dirname(PROJECTS()), { recursive: true });
  fs.writeFileSync(PROJECTS(), JSON.stringify(all, null, 2) + '\n');
  return true
}
const projectOf = (name) => { const all = projects(); const k = Object.keys(all).find((x) => x.toLowerCase() === String(name || '').toLowerCase()); return k ? all[k] : {} };
const fileOf = (a) => { const rel = filesMode() ? readIndex()[a.id] : null; return rel ? path.join(FILES_ROOT, rel) : '' };
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
const KINDS = ['capture', 'leveranse', 'samtale', 'minne'];   // samtale (M14): importert samtale/økt · minne (M14): Claudes eget minne om brukeren, fra eksporten
const normalizeDerived = (list) => (Array.isArray(list) ? list : [])
  .filter((d) => d && d.id).map((d) => ({ id: String(d.id), version: Number(d.version) || 1, level: LEVELS.includes(d.level) ? d.level : 'L' }));
const normalizeRenders = (list) => (Array.isArray(list) ? list : [])
  .filter((r) => r && (r.path || r.url)).map((r) => {
    const out = { format: String(r.format || (r.url ? 'artifact' : path.extname(r.path).slice(1) || 'file')) };
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
const isInside = (p, dir) => { const r = path.relative(dir, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r) };
function exportRenders(a) {
  let n = 0;
  for (const r of a.renders || []) {
    if (!r.path || !fs.existsSync(r.path) || (!RENDERS_DIR && isInside(r.path, FILES_ROOT))) continue
    const dir = RENDERS_DIR || path.join(FILES_ROOT, a.project || 'Uten prosjekt');
    const dest = path.join(dir, safeName(a.name, 80) + path.extname(r.path).toLowerCase());
    const srcSha = sha256File(r.path);
    if (fs.existsSync(dest) && sha256File(dest) === srcSha) { r.copy = dest; continue }
    try { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(r.path, dest); r.copy = dest; r.sha256 = srcSha; n++; } catch { /* la kilden stå */ }
  }
  return n
}

// Utleveringslogg (V15 regel 3): hver gang innhold går UT av arkivet til en modell — hva, hvilken versjon,
// hvilket nivå, til hvem. Bare metadata, aldri innhold. .tua/utlevering.jsonl, én linje per utlevering.
function logDelivery(entry) {
  try {
    const p = DELIVERY();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify({ at: Date.now(), ...entry }) + '\n');
    return true
  } catch { return false }
}
function deliveries(id, limit = 10) {
  try {
    return fs.readFileSync(DELIVERY(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((e) => e && (!id || e.id === id)).slice(-limit)
  } catch { return [] }
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
function keepVersion(id, oldText) {
  const n = (oldText.match(/^versjon:\s*(\d+)/m) || [])[1] || '0';
  const dir = path.join(VERSIONS_DIR(), id);
  fs.mkdirSync(dir, { recursive: true });
  let p = path.join(dir, `v${n}.md`);
  if (fs.existsSync(p)) {
    if (fs.readFileSync(p, 'utf8') === oldText) return
    p = path.join(dir, `v${n}-${Date.now()}.md`);
  }
  fs.writeFileSync(p, oldText);
}
function versions(id) {
  if (!filesMode()) return []
  const dir = path.join(VERSIONS_DIR(), id);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return [] }
  return names
    .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f.replace(/\.md$/, ''), size: st.size, mtime: st.mtimeMs } })
    .sort((x, y) => x.mtime - y.mtime)
}
function readVersion(id, name) {
  const p = path.join(VERSIONS_DIR(), id, name.replace(/[^\w.-]/g, '') + '.md');
  try { return parse(fs.readFileSync(p, 'utf8'), { fallbackId: id }) } catch { return null }
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

// M12: én skriver om gangen. Flere prosesser (Desktop-server, Code-server, bro, sync) kan
// kalle save() samtidig; låsen (.tua/.lock, atomisk mkdir) serialiserer dem. Gammel lås
// (> 15 s, en prosess som døde) fjernes. Venter maks 3 s, så skrives det uansett (aldri tap).
const LOCK = () => tuaFile('.lock');
function acquireLock() {
  const t0 = Date.now();
  while (true) {
    try { fs.mkdirSync(LOCK(), { recursive: false }); return true } catch {}
    try { if (Date.now() - fs.statSync(LOCK()).mtimeMs > 15000) { fs.rmSync(LOCK(), { recursive: true, force: true }); continue } } catch { continue }
    if (Date.now() - t0 > 3000) return false
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}
const releaseLock = () => { try { fs.rmSync(LOCK(), { recursive: true, force: true }); } catch {} };

// Skriver bare det som endret seg. Flytter fila hvis navnet/prosjektet endret seg.
// Sletter aldri. Returnerer antall skrevne filer.
function save(atoms) {
  if (!filesMode()) { writeCache(atoms); return 0 }
  fs.mkdirSync(path.dirname(LOCK()), { recursive: true });
  const locked = acquireLock();
  try { return saveUnlocked(atoms) } finally { if (locked) releaseLock(); }
}
function saveUnlocked(atoms) {
  const index = readIndex();
  const wr = readWritten();
  const used = new Set();
  let written = 0;
  for (const a of atoms) {
    const dir = a.project || 'Uten prosjekt';
    const plain = path.join(dir, fileNameFor(a)), suffixed = path.join(dir, safeName(a.name, 80) + ` (${String(a.id).slice(-6)}).md`);
    // M17: stabil ved navnekollisjon — det navnet atomet HADDE (plain eller med id-suffiks) beholdes så lenge det er ledig.
    // Før kunne to atomer med samme tittel bytte filnavn ved hver lagring (rekkefølgen i atoms varierer) → omskriving + falske versjoner.
    const prev = index[a.id];
    let rel = prev && (prev === plain || prev === suffixed) && !used.has(prev.toLowerCase()) ? prev : plain;
    if (used.has(rel.toLowerCase())) rel = suffixed;
    // skal fila flyttes, men målet finnes alt (en annen fil) og vi ikke kan flytte: behold forrige navn — aldri to filer med samme atom
    if (prev && prev !== rel && !used.has(prev.toLowerCase()) && fs.existsSync(path.join(FILES_ROOT, rel)) && fs.existsSync(path.join(FILES_ROOT, prev))) rel = prev;
    used.add(rel.toLowerCase());
    const abs = path.join(FILES_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (prev && prev !== rel) {
      const prevAbs = path.join(FILES_ROOT, prev);
      if (fs.existsSync(prevAbs) && !fs.existsSync(abs)) fs.renameSync(prevAbs, abs);
    }
    delete a.editedOutside;                              // festes nå: versjonen er talt opp, teksten under bevares
    if (a.renders?.length) exportRenders(a);              // M11: html/pdf-kopi ved siden av atomet i arkivet
    const md = serialize(a);
    let before = null;
    try { before = fs.readFileSync(abs, 'utf8'); } catch {}
    if (before !== md) {
      if (before !== null) keepVersion(a.id, before);   // historikk: forrige versjon bevares som egen fil
      fs.writeFileSync(abs, md);
      setFinderTags(abs, [...new Set([...(a.tags || []), a.project])]);
      written++;
    }
    index[a.id] = rel;
    wr[a.id] = { sha: sha256(md), version: a.version || 1 };
  }
  writeIndex(index);
  fs.writeFileSync(WRITTEN(), JSON.stringify(wr, null, 2) + '\n');
  writeCache(atoms);
  return written
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
function makeAtom({ content, name, source, project, convo, summary, tags, short, medium, by, levels, links, kind, derivedFrom, renders }) {
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
  const kind = data.kind || (derivedFrom?.length ? 'leveranse' : old.kind);
  const attach = (a) => {
    if (levels) a.levels = levels; else delete a.levels;
    if (links) a.links = links; else delete a.links;
    if (derivedFrom) a.derivedFrom = derivedFrom; else delete a.derivedFrom;
    if (renders) a.renders = renders; else delete a.renders;
    a.kind = kind;
    return a
  };
  if (bodySame) {
    if (sameJson(levels, old.levels) && sameJson(links, old.links) && sameJson(derivedFrom, old.derivedFrom) && sameJson(renders, old.renders) && kind === old.kind) return { atom: old, status: 'uendret' }
    atoms[i] = attach({ ...old });
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
function search(atoms, query, { project, context, limit = 8, offset = 0 } = {}) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const all = atoms
    .filter((a) => !project || a.project.toLowerCase() === project.toLowerCase())
    .filter((a) => visibleIn(a, context))
    .map((a) => ({ a, max: maxLevel(a, context) }))
    .filter(({ a, max }) => tokens.every((t) => hay(a, max).includes(t)))
    .map((x) => ({ ...x, score: tokens.length ? score(x.a, tokens, x.max) : 0 }))
    .sort((x, y) => y.score - x.score || y.a.capturedAt - x.a.capturedAt);
  const page = all.slice(offset, offset + limit).map(({ a, max, score: sc }) => {
    const S = levelOf(a, 'S');
    const inS = tokens.every((t) => S.text.toLowerCase().includes(t));
    const body = max === 'M' ? levelOf(a, 'M').text : a.content;
    return { atom: a, S, max, score: sc, snippet: inS || max === 'S' ? '' : snippet(body, tokens) }
  });
  page.total = all.length;
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

const onboardingState = () => { try { return filesMode() ? JSON.parse(fs.readFileSync(ONBOARDING(), 'utf8')) : null } catch { return null } };
const onboardingActive = () => onboardingState()?.state === 'aktiv';
function finishOnboarding(how) {
  const s = onboardingState();
  if (!s || s.state !== 'aktiv') return false
  fs.writeFileSync(ONBOARDING(), JSON.stringify({ ...s, state: 'ferdig', ferdig: new Date().toISOString(), ved: how || '' }, null, 2) + '\n');
  return true
}
const welcomeAtom = (atoms) => atoms.find((a) => a.key === WELCOME_KEY && a.project.toLowerCase() === WELCOME_PROJECT.toLowerCase());
// Siste import (Innboks eller Code-økter) — SessionStart-hooken bruker dette til påminnelsen «ny import?»
const importState = () => { try { return filesMode() ? JSON.parse(fs.readFileSync(tuaFile('import-state.json'), 'utf8')) : {} } catch { return {} } };
function noteImport(kind, info = {}) {
  if (!filesMode()) return
  const s = importState();
  s.last = { at: Date.now(), kind, ...info };
  s[kind] = { at: Date.now(), ...info };
  fs.writeFileSync(tuaFile('import-state.json'), JSON.stringify(s, null, 2) + '\n');
}

// Lager arkivet hvis det ikke finnes. Rører aldri et arkiv som finnes. Returnerer { created, root }.
// Er roten ikke valgt ennå (ny bruker, ingen Tua-mappe funnet), gjøres ingenting: { needsChoice: true }.
function ensureArchive() {
  // 0.5.1: var ingen rot valgt ved oppstart, sjekk config igjen — SessionStart-hooken kan ha skrevet «arkivmappe» dit etter at
  // serveren startet (begge starter samtidig i Claude Code). Samme regel som chooseRoot(); ingen gjetting utover den.
  if (!FILES_ROOT) { const r = chooseRoot(); if (r) { FILES_ROOT = r; INBOX_DIR = path.join(r, 'Innboks'); } }
  if (!FILES_ROOT) return { created: false, root: null, needsChoice: true }
  if (fs.existsSync(FILES_ROOT)) {
    try { fs.mkdirSync(INBOX_DIR, { recursive: true }); } catch {}
    return { created: false, root: FILES_ROOT }
  }
  fs.mkdirSync(path.join(FILES_ROOT, '.tua'), { recursive: true });
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const atoms = load();                                          // tom mappe (+ evt. cache fra en annen maskin, som nå blir filer)
  upsert(atoms, {
    key: WELCOME_KEY, name: 'Velkommen til Tua', content: WELCOME_L, short: WELCOME_S, project: WELCOME_PROJECT,
    convo: 'Første kjøring', source: 'Tua', by: 'regel', tags: ['velkommen'],
    summary: 'Opprettet automatisk første gang Tua startet på denne maskinen.',
  });
  save(atoms);
  fs.writeFileSync(ONBOARDING(), JSON.stringify({ state: 'aktiv', opprettet: new Date().toISOString(), sted: rootLabel(), root: FILES_ROOT }, null, 2) + '\n');
  return { created: true, root: FILES_ROOT }
}

export { DATA_DIR, FILE, FILES_ROOT, INBOX_DIR, KINDS, LINK_KINDS, LONG_L, M_MAX, SHORT_L, S_MAX, WELCOME_KEY, archiveOptions, chooseArchive, clampLevel, claudeProjectHref, compose, deliveries, ensureArchive, fileOf, filesMode, finishOnboarding, fmtTime, hasExternalEdits, importState, isStale, isVault, levelOf, linksFor, load, logDelivery, maxLevel, needsLevel, noteImport, onboardingActive, projectOf, readVersion, registerProject, related, renderStatus, rootLabel, save, search, setShare, sources, staleSources, upsert, vaultClamp, versions, visibleIn, welcomeAtom };
