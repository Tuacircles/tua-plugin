// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import 'node:path';

// files.js — atom ↔ markdown-fil, begge veier.
//
// Alternativ A: hvert atom ER en fil. Fila har YAML-frontmatter (metadata som
// Spotlight indekserer) og avis-struktur i brødteksten:
//
//   # Tittel
//   Ingress                 ← S  (kort sammendrag; i dag = summary til S finnes)
//   ## Hvorfor              ← summary (hvorfor-linjen), bare når S finnes separat
//   ## Sammendrag (M)       ← M  (plassholder til det er laget)
//   ## Innhold (L)          ← L  (hele innholdet)
//
// M9: frontmatter `lenker` = atomets egne pekere [{kind, href, label}],
// kind ∈ file · url · repo · claude-project · claude-chat.
// M10: `kind: "leveranse"` = bygget av andre atomer. `bygget_av` = [{id, version, level}]
// (hvilken versjon av hvert kildeatom, lest på hvilket nivå), `gjengivelser` = [{format, path, sha256, at}]
// (html/pdf/artifact rendret fra denne markdown-kilden — fila er en gjengivelse, atomet er sannheten).
//
// Quick Look viser toppen (= S). Parse og serialize er inverse av hverandre.


const M_PLACEHOLDER = '_(ikke laget ennå)_';
const H_WHY = '## Hvorfor';
const H_M = '## Sammendrag (M)';
const H_L = '## Innhold (L)';

const isoLocal = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60)), om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`
};

// Finder-vennlig filnavn: beholder mellomrom og norske tegn, fjerner det Finder/sky nekter
function safeName(s, max = 90) {
  return String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '·').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '') || 'uten-tittel'
}
const fileNameFor = (atom) => safeName(atom.name) + '.md';

// ── serialize ───────────────────────────────────────────────────────────────
function serialize(atom) {
  const S = atom.levels?.S?.text || '';
  const ingress = S || atom.summary || '';
  const why = S && atom.summary ? atom.summary : '';
  const M = atom.levels?.M?.text || '';
  const fm = {
    tua_id: atom.id,
    prosjekt: atom.project,
    samtale: atom.convo || '',
    kilde: atom.source || '',
    dato: isoLocal(atom.capturedAt || atom.createdAt || Date.now()),
    versjon: atom.version || 1,
    ...(atom.key ? { key: atom.key } : {}),
    ...(atom.kind ? { kind: atom.kind } : {}),
    tagger: atom.tags || [],
    synlig_i: atom.refs || [],
    ...(atom.links?.length ? { lenker: atom.links } : {}),
    ...(atom.derivedFrom?.length ? { bygget_av: atom.derivedFrom } : {}),
    ...(atom.renders?.length ? { gjengivelser: atom.renders } : {}),
    ...(atom.share && Object.keys(atom.share).length ? { nivaa: atom.share } : {}),
    ...(atom.levels?.S ? { S_av: atom.levels.S.by || '', S_versjon: atom.levels.S.of ?? null } : {}),
    ...(atom.levels?.M ? { M_av: atom.levels.M.by || '', M_versjon: atom.levels.M.of ?? null } : {}),
  };
  const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return [
    '---', ...fmLines, '---',
    `# ${atom.name}`,
    '',
    ingress,
    '',
    ...(why ? [H_WHY, why, ''] : []),
    H_M,
    M || M_PLACEHOLDER,
    '',
    H_L,
    atom.content || '',
    '',
  ].join('\n')
}

// ── parse ───────────────────────────────────────────────────────────────────
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fm: {}, body: text }
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { fm: {}, body: text }
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue
    const k = line.slice(0, i).trim(), raw = line.slice(i + 1).trim();
    try { fm[k] = JSON.parse(raw); } catch { fm[k] = raw; }
  }
  return { fm, body: text.slice(end + 5) }
}

function parse(text, { fallbackId } = {}) {
  const { fm, body } = parseFrontmatter(text.replace(/\r\n/g, '\n'));
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  let name = fm.tittel || '';
  if (lines[i]?.startsWith('# ')) { name = lines[i].slice(2).trim(); i++; }
  const rest = lines.slice(i).join('\n');
  const cut = (txt, h) => { const k = txt.indexOf('\n' + h + '\n'); return k < 0 ? [txt, ''] : [txt.slice(0, k), txt.slice(k + h.length + 2)] };
  // rekkefølge: ingress [## Hvorfor] ## Sammendrag (M) ## Innhold (L)
  let [head, afterM] = cut('\n' + rest, H_M);
  let [ingressPart, whyPart] = cut(head, H_WHY);
  let [mPart, lPart] = afterM ? cut('\n' + afterM, H_L) : ['', ''];
  const trim = (s) => s.replace(/^\n+|\n+$/g, '');
  let ingress = trim(ingressPart), why = trim(whyPart), M = trim(mPart), L = trim(lPart);
  // En vanlig markdown-fil uten Tua-seksjoner (sluppet i mappa fra Finder): alt er innhold (L)
  if (!afterM && !lPart) { L = trim(rest); ingress = ''; }
  const mText = M === M_PLACEHOLDER ? '' : M;
  const atom = {
    id: fm.tua_id || fallbackId,
    kind: fm.kind || 'capture',
    name: name || 'Uten tittel',
    type: 'text/markdown', isText: true,
    content: L,
    size: Buffer.byteLength(L, 'utf8'),
    source: fm.kilde || '',
    project: fm.prosjekt || 'Uten prosjekt',
    convo: fm.samtale || '',
    capturedAt: fm.dato ? Date.parse(fm.dato) || Date.now() : Date.now(),
    createdAt: fm.dato ? Date.parse(fm.dato) || Date.now() : Date.now(),
    tags: Array.isArray(fm.tagger) ? fm.tagger : [],
    refs: Array.isArray(fm.synlig_i) ? fm.synlig_i : [],
    version: Number(fm.versjon) || 1,
    summary: why || (fm.S_av ? '' : ingress),
  };
  if (fm.key) atom.key = fm.key;
  if (fm.nivaa && typeof fm.nivaa === 'object') atom.share = fm.nivaa;
  if (Array.isArray(fm.lenker) && fm.lenker.length) atom.links = fm.lenker.filter((l) => l && l.href);
  if (Array.isArray(fm.bygget_av) && fm.bygget_av.length) atom.derivedFrom = fm.bygget_av.filter((d) => d && d.id);
  if (Array.isArray(fm.gjengivelser) && fm.gjengivelser.length) atom.renders = fm.gjengivelser.filter((r) => r && (r.path || r.url));
  const levels = {};
  if (fm.S_av !== undefined && ingress) levels.S = { text: ingress, by: fm.S_av, of: fm.S_versjon ?? null };
  if (mText) levels.M = { text: mText, by: fm.M_av || '', of: fm.M_versjon ?? null };
  if (Object.keys(levels).length) atom.levels = levels;
  return atom
}

export { fileNameFor, parse, safeName, serialize };
