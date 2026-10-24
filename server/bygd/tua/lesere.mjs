// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import path__default from 'node:path';
import zlib from 'node:zlib';

// lesere.js — leserne (M16, skive 7 i arbeidsstykke 31): fil → tekst, lokalt. Første trinn i motoren («lese → skjerme → minimere → sende»).
//
//   les(fil, {navn?, data?})  → { tekst, meta: { format, label, sider, verktøy, tegn, ord, navn, tittel? } }
//
// Ett grensesnitt, én leser per format. Alt leses på denne maskinen; ingenting sendes noe sted — det er innlesing.js (sak med S/M/L)
// og motoren som bestemmer hva som eventuelt går ut, og da bare skjermet og på valgt nivå (V21, pitch v3 pkt. 4: «filer sendes aldri rått»).
//
//   PDF        tekstlaget, med pdfjs-dist (Mozillas PDF-motor, den samme som i Firefox; Apache 2.0; ren JavaScript, ingen systemkrav —
//              rendering trenger canvas, tekstuttrekk gjør det ikke). Valgt framfor pdf-parse (drar inn @napi-rs/canvas, som er native)
//              og unpdf (bare en innpakning av samme pdfjs). Lastes LAZILY ved første PDF: pakka er 1,2 MB i én fil, og pluginbygget
//              (bygg.mjs) holder den utenfor bundelen (external) så ingen fil går over katalogens 256 KiB-grense. Finnes ikke pakka
//              der koden kjører (katalog-kopien uten node_modules), gir PDF en tydelig feil — alt annet leses som før.
//              En PDF uten tekstlag (skannet) gir feilen «ingen tekst i fila» — OCR er ikke med i denne skiva.
//   tekst      .txt .text .log — UTF-8, med fall tilbake til Latin-1 når fila ikke er UTF-8 (eldre norske filer)
//   markdown   .md .markdown — som tekst; tittelen er første overskrift
//   HTML       .html .htm — script/style ut, overskrifter → #, avsnitt/lister/tabeller → linjer, entiteter dekodet
//   CSV/TSV    .csv .tsv — teksten som den er (L er fila), radtallet i meta
//   docx       .docx — Word-dokumentet er en zip med word/document.xml; zip-en leses her (node:zlib, ingen pakke), avsnitt og
//              overskrifter (Heading-stiler → #) hentes ut. Ingen bilder, ingen fotnoter.
//
// Det som IKKE leses ennå: .doc (gammelt Word), .pptx, .xlsx, .rtf, e-post (.eml), bilder (OCR). De gir «ukjent format» med lista over det som støttes.


class LeseFeil extends Error { constructor(msg, kode = 'feil', detaljer = {}) { super(msg); this.name = 'LeseFeil'; this.kode = kode; Object.assign(this, detaljer); } }

const FORMATER = {
  pdf: { endelser: ['.pdf'], label: 'PDF' },
  tekst: { endelser: ['.txt', '.text', '.log'], label: 'tekst' },
  markdown: { endelser: ['.md', '.markdown'], label: 'Markdown' },
  html: { endelser: ['.html', '.htm'], label: 'HTML' },
  csv: { endelser: ['.csv'], label: 'CSV' },
  tsv: { endelser: ['.tsv'], label: 'TSV' },
  docx: { endelser: ['.docx'], label: 'Word (docx)' },
};
const ENDELSER = Object.values(FORMATER).flatMap((f) => f.endelser);
const formatAv = (navn) => { const e = path__default.extname(String(navn || '')).toLowerCase(); return Object.keys(FORMATER).find((k) => FORMATER[k].endelser.includes(e)) || null };
const kanLese = (navn) => !!formatAv(navn);
const ord = (t) => (String(t || '').match(/\S+/g) || []).length;
const MAKS_BYTES = 50 * 1024 * 1024;          // 50 MB — større filer leses ikke (minne); si det i stedet for å henge

// ── tekst ───────────────────────────────────────────────────────────────────
// UTF-8 først; har fila ugyldige sekvenser (U+FFFD) og ingen BOM, er den trolig Latin-1/Windows-1252 (eldre norske filer med æøå).
function dekod(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  const utf = buf.toString('utf8');
  return utf.includes('�') ? buf.toString('latin1') : utf
}
const normaliser = (t) => String(t || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const førsteOverskrift = (md) => (String(md || '').match(/^#{1,3}\s+(.+?)\s*#*\s*$/m) || [])[1]?.trim() || null;

function lesTekst(buf) { const tekst = normaliser(dekod(buf)); return { tekst, meta: { verktøy: 'tekst', linjer: tekst ? tekst.split('\n').length : 0 } } }
function lesMarkdown(buf) { const r = lesTekst(buf); r.meta.verktøy = 'markdown'; const t = førsteOverskrift(r.tekst); if (t) r.meta.tittel = t; return r }

// ── CSV / TSV ───────────────────────────────────────────────────────────────
// L er fila som den er (tabellen er innholdet); meta får radtall og kolonner fra første rad. Anførselstegn i CSV respekteres i tellingen.
function tellRader(tekst, skille) {
  let rader = 0, iAnf = false, start = true;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (c === '"') iAnf = !iAnf;
    else if (c === '\n' && !iAnf) { if (!start) rader++; start = true; continue }
    if (c !== '\n') start = false;
  }
  if (!start) rader++;
  const første = tekst.split('\n')[0] || '';
  const kolonner = skille === ',' && /;/.test(første) && !/,/.test(første) ? første.split(';').length : første.split(skille).length;   // norsk Excel skriver CSV med semikolon
  return { rader, kolonner }
}
function lesCsv(buf, skille) { const { tekst } = lesTekst(buf); return { tekst, meta: { verktøy: 'csv', ...tellRader(tekst, skille) } } }

// ── HTML ────────────────────────────────────────────────────────────────────
const ENTITETER = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ', eacute: 'é', ndash: '–', mdash: '—', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
const dekodEntiteter = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m }
  return ENTITETER[e] ?? m
});
function htmlTilTekst(html) {
  let h = String(html || '').replace(/\r\n?/g, '\n');
  const tittel = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}\n\n`);
  h = h.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/(p|div|section|article|header|footer|blockquote|pre|ul|ol|table|h[1-6])\b[^>]*>/gi, '\n\n');
  h = h.replace(/<\/(tr)\b[^>]*>/gi, '\n').replace(/<\/(td|th)\b[^>]*>/gi, ' | ').replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<[^>]+>/g, '');
  const tekst = normaliser(dekodEntiteter(h).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n'));
  return { tekst, tittel: tittel ? dekodEntiteter(tittel).replace(/\s+/g, ' ').trim() : null }
}
function lesHtml(buf) { const { tekst, tittel } = htmlTilTekst(dekod(buf)); return { tekst, meta: { verktøy: 'html', ...(tittel ? { tittel } : {}) } } }

// ── zip (til docx) ──────────────────────────────────────────────────────────
// En liten zip-leser uten pakke og uten shell: sentralkatalogen bakfra, så hver fil. Metode 0 (lagret) og 8 (deflate). Ingen zip64 — et
// Word-dokument er aldri så stort. (unzip.js bruker unzip/tar for eksport-zip-ene — det er greit der, men her trengs én bestemt fil i minnet.)
function zipFiler(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new LeseFeil('fila er ikke en zip (ingen sentralkatalog)', 'format')
  const antall = buf.readUInt16LE(eocd + 10), start = buf.readUInt32LE(eocd + 16);
  const filer = new Map();
  let p = start;
  for (let i = 0; i < antall && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const metode = buf.readUInt16LE(p + 10), komp = buf.readUInt32LE(p + 20), ukomp = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), kl = buf.readUInt16LE(p + 32), lokal = buf.readUInt32LE(p + 42);
    const navn = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    filer.set(navn, { metode, komp, ukomp, lokal });
    p += 46 + nl + el + kl;
  }
  const les = (navn) => {
    const f = filer.get(navn);
    if (!f) return null
    if (buf.readUInt32LE(f.lokal) !== 0x04034b50) throw new LeseFeil(`zip: ødelagt oppføring for ${navn}`, 'format')
    const nl = buf.readUInt16LE(f.lokal + 26), el = buf.readUInt16LE(f.lokal + 28);
    const data = buf.subarray(f.lokal + 30 + nl + el, f.lokal + 30 + nl + el + f.komp);
    if (f.metode === 0) return data
    if (f.metode === 8) return zlib.inflateRawSync(data)
    throw new LeseFeil(`zip: komprimering ${f.metode} støttes ikke (bare lagret og deflate)`, 'format')
  };
  return { navn: [...filer.keys()], les }
}

// ── docx ────────────────────────────────────────────────────────────────────
// word/document.xml: hvert <w:p> er et avsnitt; <w:t> er tekst, <w:tab/> og <w:br/> er tab og linjeskift; <w:pStyle w:val="Heading2"/> → «## ».
// Tabellceller blir egne linjer (hver celle har sitt <w:p>). Bilder, fotnoter og kommentarer tas ikke med.
function docxTilTekst(buf) {
  const zip = zipFiler(buf);
  const xmlBuf = zip.les('word/document.xml');
  if (!xmlBuf) throw new LeseFeil('fila er en zip, men ikke et Word-dokument (word/document.xml mangler)', 'format')
  const xml = xmlBuf.toString('utf8');
  const avsnitt = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const inner = m[1];
    const stil = (inner.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/) || [])[1] || '';
    const nivå = (stil.match(/^(?:Heading|Overskrift)\s?(\d)$/i) || [])[1];
    let t = '';
    for (const x of inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g)) t += x[1] !== undefined ? x[1] : x[0].startsWith('<w:tab') ? '\t' : '\n';
    t = dekodEntiteter(t).replace(/[ \t]+/g, ' ').trim();
    if (!t) { avsnitt.push(''); continue }
    avsnitt.push(nivå ? `${'#'.repeat(Number(nivå))} ${t}` : stil === 'Title' || stil === 'Tittel' ? `# ${t}` : t);
  }
  const tekst = normaliser(avsnitt.join('\n\n'));
  const tittel = førsteOverskrift(tekst);
  return { tekst, tittel, avsnitt: avsnitt.filter(Boolean).length }
}
function lesDocx(buf) { const { tekst, tittel, avsnitt } = docxTilTekst(buf); return { tekst, meta: { verktøy: 'docx (zip + document.xml)', avsnitt, ...(tittel ? { tittel } : {}) } } }

// ── PDF ─────────────────────────────────────────────────────────────────────
// pdfjs-dist lastes først når en PDF skal leses (lazy), og bare én gang. Legacy-bygget er det som kjører i Node uten DOM; advarslene om
// canvas/DOMMatrix gjelder rendering (som vi ikke gjør) og dempes under lastingen. Mangler pakka → LeseFeil «leser-mangler».
let pdfjsLast = null;
async function pdfjs() {
  if (!pdfjsLast) pdfjsLast = (async () => {
    const warn = console.warn;
    console.warn = (...a) => { if (!/napi-rs\/canvas|polyfill|DOMMatrix|Path2D/.test(String(a[0]))) warn(...a); };
    try { return await import('pdfjs-dist/legacy/build/pdf.mjs') }
    catch (e) {
      pdfjsLast = null;
      if (e?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find (package|module)/.test(e?.message || '')) throw new LeseFeil('PDF-leseren (pdfjs-dist) er ikke installert der dette kjører — kjør «npm install» i tua-plugin, eller les fila inn fra appen (broen). Tekst, Markdown, HTML, CSV og docx leses uansett.', 'leser-mangler')
      throw e
    } finally { console.warn = warn; }
  })();
  return pdfjsLast
}
// Tekstlaget side for side: pdfjs gir biter (items) med hasEOL der linja slutter. Biter på samme linje settes rett sammen (pdfjs tar med mellomrommene
// som egne biter); et hopp i x som er større enn et tegn, uten mellomrom i teksten, får ett mellomrom så ord ikke klistres («lager»+«til» → «lager til»).
async function pdfTilTekst(buf, { navn = 'fila' } = {}) {
  const lib = await pdfjs();
  const oppgave = lib.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0, stopAtErrors: false });
  let doc;
  try { doc = await oppgave.promise; } catch (e) {
    if (e?.name === 'PasswordException') throw new LeseFeil(`«${navn}» er låst med passord — åpne den i Forhåndsvisning, lagre en kopi uten passord, og prøv igjen.`, 'passord')
    if (e?.name === 'InvalidPDFException') throw new LeseFeil(`«${navn}» er ikke en gyldig PDF (${e.message}).`, 'format')
    throw new LeseFeil(`kunne ikke åpne «${navn}»: ${e?.message || e}`, 'feil')
  }
  try {
    const sider = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const side = await doc.getPage(i);
      const tc = await side.getTextContent();
      let s = '', sistX = null, sistBredde = 0, sistY = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue
        const x = it.transform?.[4], y = it.transform?.[5];
        if (sistX != null && it.str && y === sistY && !/\s$/.test(s) && !/^\s/.test(it.str) && x - (sistX + sistBredde) > Math.max(2, it.height * 0.25)) s += ' ';
        s += it.str;
        if (it.hasEOL) s += '\n';
        sistX = x; sistY = y; sistBredde = it.width || 0;
      }
      sider.push(normaliser(s));
      side.cleanup();
    }
    const tekst = sider.join('\n\n').trim();
    if (ord(tekst) < 3) throw new LeseFeil(`Fant ingen tekst i «${navn}» (${doc.numPages} ${doc.numPages === 1 ? 'side' : 'sider'}) — PDF-en har ikke tekstlag, trolig en skanning. OCR kommer i en senere skive; til da: åpne den i Forhåndsvisning og eksporter med tekst, eller legg inn teksten som .txt.`, 'ingen-tekst', { sider: doc.numPages })
    let info = {};
    try { info = (await doc.getMetadata())?.info || {}; } catch {}
    const tittel = typeof info.Title === 'string' && info.Title.trim() && !/\.(pdf|docx?|pptx?|indd|ai|md|txt)$/i.test(info.Title.trim()) && !/^(untitled|microsoft word|document\d*)$/i.test(info.Title.trim()) ? info.Title.trim() : null;
    return { tekst, sider: doc.numPages, verktøy: `pdfjs-dist ${lib.version}`, ...(tittel ? { tittel } : {}) }
  } finally { try { await oppgave.destroy(); } catch {} }
}
async function lesPdf(buf, navn) { const { tekst, sider, verktøy, tittel } = await pdfTilTekst(buf, { navn }); return { tekst, meta: { verktøy, sider, ...(tittel ? { tittel } : {}) } } }

// ── grensesnittet ───────────────────────────────────────────────────────────
// fil: sti på disk (data leses derfra) — eller gi `data` (Buffer) og `navn` når fila kom som opplasting. Returnerer alltid tekst + meta;
// kaster LeseFeil med kode: ukjent-format · for-stor · tom · ingen-tekst · passord · format · leser-mangler · feil.
async function les(fil, { navn = null, data = null } = {}) {
  const n = navn || path__default.basename(String(fil || ''));
  const format = formatAv(n);
  if (!format) throw new LeseFeil(`«${n}» har et format Tua ikke leser ennå. Det som leses: ${Object.values(FORMATER).map((f) => f.label).join(', ')} (${ENDELSER.join(' ')}).`, 'ukjent-format')
  let buf = data;
  if (!buf) {
    let st;
    try { st = fs__default.statSync(fil); } catch { throw new LeseFeil(`fant ikke fila ${fil}`, 'feil') }
    if (!st.isFile()) throw new LeseFeil(`${fil} er ikke en fil`, 'feil')
    if (st.size > MAKS_BYTES) throw new LeseFeil(`«${n}» er ${Math.round(st.size / 1048576)} MB — Tua leser filer opp til ${MAKS_BYTES / 1048576} MB.`, 'for-stor')
    buf = fs__default.readFileSync(fil);
  } else if (buf.length > MAKS_BYTES) throw new LeseFeil(`«${n}» er ${Math.round(buf.length / 1048576)} MB — Tua leser filer opp til ${MAKS_BYTES / 1048576} MB.`, 'for-stor')
  if (!buf.length) throw new LeseFeil(`«${n}» er tom.`, 'tom')
  let r;
  switch (format) {
    case 'pdf': r = await lesPdf(buf, n); break
    case 'markdown': r = lesMarkdown(buf); break
    case 'html': r = lesHtml(buf); break
    case 'csv': r = lesCsv(buf, ','); break
    case 'tsv': r = lesCsv(buf, '\t'); break
    case 'docx': r = lesDocx(buf); break
    default: r = lesTekst(buf);
  }
  if (!r.tekst || ord(r.tekst) < 1) throw new LeseFeil(`«${n}» har ingen tekst å lese.`, 'tom')
  return { tekst: r.tekst, meta: { format, label: FORMATER[format].label, navn: n, bytes: buf.length, tegn: r.tekst.length, ord: ord(r.tekst), sider: r.meta.sider ?? null, ...r.meta } }
}

export { FORMATER, formatAv, kanLese, les };
