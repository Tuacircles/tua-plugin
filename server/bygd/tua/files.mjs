// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
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
// Runde 2d (arb. 32 del 3, 03-avisen §2–§4, 24.10.2026): `fanget` (2c), `drift` og `beholdt` er de tre flaggene klassen regnes av
// (store.klasseAv): arbeid · spor (fanget eller samtale) · drift (Tua om seg selv) · tråd (prompt/svar/konklusjon som ikke er beholdt eller låst).
// M10: `kind: "leveranse"` = bygget av andre atomer. `bygget_av` = [{id, version, level}]
// (hvilken versjon av hvert kildeatom, lest på hvilket nivå), `gjengivelser` = [{format, path, sha256, at}]
// (html/pdf/artifact rendret fra denne markdown-kilden — fila er en gjengivelse, atomet er sannheten).
//
// Runde 3c (24.10.2026, én skriver): frontmatter-nøkler denne koden IKKE kjenner, leses inn i `ekstra` og skrives tilbake uendret — en eldre prosess
// (gammel plugin-cache, hook fra forrige versjon) kan ikke lenger stryke et felt den ikke har hørt om (hendelsen 24.10: 1 035 filer uten drift/fanget).
// `S_dato`/`M_dato` (ISO) sier når nivået ble skrevet — Ny gjennomgang (AI3) merker med modell og dato.
//
// Friksjon 20 (25.10.2026, «arbeidet som samler», V21 «arbeidsløp som status på sak»): ingen ny saktype. En sak er et ARBEID når andre saker peker på den —
// `hører_til: <sak-id>` på samtale-saker, Spør-tråder (prompt-saker) og saker laget i løpet; `hører_til_forslag: <sak-id>` når Tua foreslår en kobling
// (hooken ved øktstart) som brukeren ikke har svart på; `arbeid: true` når brukeren sa «Gjør til arbeid» før noe henger på saken. `gren` (git-grenen
// Code-samtalen gikk på) og `vert` (Code-øktas verts-id i Desktop-appen, local_…) er sporene hooken bruker til å koble en samtale til forelderens arbeid.
//
// Quick Look viser toppen (= S). Parse og serialize er inverse av hverandre.


const M_PLACEHOLDER = '_(ikke laget ennå)_';
const H_WHY = '## Hvorfor';
const H_M = '## Sammendrag (M)';
const H_L = '## Innhold (L)';
// nøklene parse() forstår; alt annet i frontmatter er `ekstra` (runde 3c)
const KJENTE_NØKLER = new Set(['tua_id', 'prosjekt', 'samtale', 'kilde', 'dato', 'versjon', 'key', 'kind', 'status', 'fanget', 'drift', 'beholdt', 'tagger', 'synlig_i', 'lenker', 'bygget_av', 'ga', 'gjengivelser', 'nivaa', 'S_av', 'S_versjon', 'S_dato', 'M_av', 'M_versjon', 'M_dato', 'tittel', 'hører_til', 'hører_til_forslag', 'arbeid', 'gren', 'vert', 'start']);

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
    ...(atom.status ? { status: atom.status } : {}),           // M23 (skive 4): utkast | endelig — bare når satt; standard regnes av lageret (statusOf)
    ...(atom.fanget === true || atom.fanget === false ? { fanget: atom.fanget } : {}),   // runde 2c (arb. 32 §5 sp. 1, 24.10.2026): true = fanget automatisk (hook/import), ikke løftet inn — utenfor avisen og søket; false = løftet inn med vilje (Behold) — regelen rører den aldri igjen
    ...(atom.drift === true || atom.drift === false ? { drift: atom.drift } : {}),      // runde 2d (03-avisen §2, A): true = Tua om seg selv (sync, importrapport, helsesjekk, byggeøkt) — aldri i avisen, i søket bare på forespørsel; false = brukeren sa «dette er arbeid» (Behold) — regelen rører den aldri igjen
    ...(atom.beholdt === true ? { beholdt: true } : {}),                                  // runde 2d (03-avisen §4, D): brukeren trykket Behold på et svar (eller løftet saken inn) — et beholdt svar er arbeid, ikke tråd
    ...(atom.hørerTil ? { hører_til: atom.hørerTil } : {}),                                 // friksjon 20: saken henger på arbeidet <sak-id> (samtale, tråd, sak laget i løpet)
    ...(atom.hørerTilForslag ? { hører_til_forslag: atom.hørerTilForslag } : {}),           // friksjon 20: Tua foreslår et arbeid — til brukeren sier Ja/Annet/Nei
    ...(atom.arbeid === true ? { arbeid: true } : {}),                                      // friksjon 20: «Gjør til arbeid» — saken er et arbeid også før noe henger på den
    ...(atom.gren ? { gren: atom.gren } : {}),                                              // friksjon 20: git-grenen Code-samtalen gikk på (kobling via felles stamme)
    ...(atom.vert ? { vert: atom.vert } : {}),                                              // friksjon 20: Code-øktas verts-id (CLAUDE_CODE_HOST_SESSION_ID) — barn finner forelderen
    ...(atom.kind === 'samtale' && atom.createdAt && atom.capturedAt && Math.abs(atom.createdAt - atom.capturedAt) > 60e3 ? { start: isoLocal(atom.createdAt) } : {}),   // friksjon 20: når samtalen begynte (dato = sist skrevet) — løpet ordner samtalene etter start
    tagger: atom.tags || [],
    synlig_i: atom.refs || [],
    ...(atom.links?.length ? { lenker: atom.links } : {}),
    ...(atom.derivedFrom?.length ? { bygget_av: atom.derivedFrom } : {}),
    ...(atom.ga?.length ? { ga: atom.ga } : {}),                  // M20b (skive 6, V16): svarene en prompt-sak ga — [{id, version}], én per mottaker
    ...(atom.renders?.length ? { gjengivelser: atom.renders } : {}),
    ...(atom.share && Object.keys(atom.share).length ? { nivaa: atom.share } : {}),
    ...(atom.levels?.S ? { S_av: atom.levels.S.by || '', S_versjon: atom.levels.S.of ?? null, ...(atom.levels.S.at ? { S_dato: atom.levels.S.at } : {}) } : {}),
    ...(atom.levels?.M ? { M_av: atom.levels.M.by || '', M_versjon: atom.levels.M.of ?? null, ...(atom.levels.M.at ? { M_dato: atom.levels.M.at } : {}) } : {}),
  };
  // runde 3c: ukjente nøkler (fra en nyere Tua, eller skrevet av noen andre) følger med uendret — etter de kjente, så Quick Look-toppen er lik
  for (const [k, v] of Object.entries(atom.ekstra || {})) if (!(k in fm) && !KJENTE_NØKLER.has(k)) fm[k] = v;
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
  if (fm.status === 'utkast' || fm.status === 'endelig') atom.status = fm.status;   // M23: status på saken (V21: arbeidsløp som status på sak)
  if (fm.fanget === true || fm.fanget === 'true') atom.fanget = true;                 // runde 2c: Fanget-bøtta — true: fanget, ikke løftet inn
  else if (fm.fanget === false || fm.fanget === 'false') atom.fanget = false;          // false: løftet inn med vilje (Behold); mangler: lagret med vilje fra starten
  if (fm.drift === true || fm.drift === 'true') atom.drift = true;                     // runde 2d: drift — Tua om seg selv
  else if (fm.drift === false || fm.drift === 'false') atom.drift = false;
  if (fm.beholdt === true || fm.beholdt === 'true') atom.beholdt = true;               // runde 2d: beholdt av brukeren
  if (typeof fm.hører_til === 'string' && fm.hører_til) atom.hørerTil = fm.hører_til;                    // friksjon 20
  if (typeof fm.hører_til_forslag === 'string' && fm.hører_til_forslag) atom.hørerTilForslag = fm.hører_til_forslag;
  if (fm.arbeid === true || fm.arbeid === 'true') atom.arbeid = true;
  if (typeof fm.gren === 'string' && fm.gren) atom.gren = fm.gren;
  if (typeof fm.vert === 'string' && fm.vert) atom.vert = fm.vert;
  if (typeof fm.start === 'string' && fm.start && Date.parse(fm.start)) atom.createdAt = Date.parse(fm.start);
  if (fm.nivaa && typeof fm.nivaa === 'object') atom.share = fm.nivaa;
  if (Array.isArray(fm.lenker) && fm.lenker.length) atom.links = fm.lenker.filter((l) => l && l.href);
  if (Array.isArray(fm.bygget_av) && fm.bygget_av.length) atom.derivedFrom = fm.bygget_av.filter((d) => d && d.id);
  if (Array.isArray(fm.ga) && fm.ga.length) atom.ga = fm.ga.filter((d) => d && d.id);
  if (Array.isArray(fm.gjengivelser) && fm.gjengivelser.length) atom.renders = fm.gjengivelser.filter((r) => r && (r.path || r.url));
  const levels = {};
  if (fm.S_av !== undefined && ingress) levels.S = { text: ingress, by: fm.S_av, of: fm.S_versjon ?? null, ...(typeof fm.S_dato === 'string' && fm.S_dato ? { at: fm.S_dato } : {}) };
  if (mText) levels.M = { text: mText, by: fm.M_av || '', of: fm.M_versjon ?? null, ...(typeof fm.M_dato === 'string' && fm.M_dato ? { at: fm.M_dato } : {}) };
  if (Object.keys(levels).length) atom.levels = levels;
  const ekstra = Object.fromEntries(Object.entries(fm).filter(([k]) => !KJENTE_NØKLER.has(k)));   // runde 3c: det vi ikke kjenner, bevares
  if (Object.keys(ekstra).length) atom.ekstra = ekstra;
  return atom
}

export { fileNameFor, parse, safeName, serialize };
