// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
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
//   xlsx       .xlsx — (arbeidsstykke 35 skive 3) en zip: hvert ark blir «## Ark: navn» med radene som «a | b | c». Delte strenger, tall og datoer, også skjulte ark
//              (de merkes: det som ligger skjult, skal skjermes og synes). Formler gir verdien Excel lagret. Kommentarer og bilder tas ikke med.
//   pptx       .pptx — en zip: hvert lysbilde i presentasjonens rekkefølge, «## Lysbilde 3: tittel», så tekstene, så talernotatene («Notat:»). Skjulte lysbilder merkes.
//   e-post     .eml — hodet (Emne, Fra, Til, Kopi, Dato) og teksten. MIME leses her: multipart, base64, quoted-printable, tegnsett, =?utf-8?Q?…?=. Ren tekst foretrekkes, ellers HTML.
//              Vedlegg leses IKKE, de nevnes med navn og står i meta.merknad; en videresendt e-post (message/rfc822) tas med.
//
// Det som IKKE leses ennå: .doc, .xls, .ppt (gamle Office), .rtf, bilder og skannet PDF (OCR). De gir «ukjent format» med lista over det som støttes.


class LeseFeil extends Error { constructor(msg, kode = 'feil', detaljer = {}) { super(msg); this.name = 'LeseFeil'; this.kode = kode; Object.assign(this, detaljer); } }

const FORMATER = {
  pdf: { endelser: ['.pdf'], label: 'PDF' },
  tekst: { endelser: ['.txt', '.text', '.log'], label: 'tekst' },
  markdown: { endelser: ['.md', '.markdown'], label: 'Markdown' },
  html: { endelser: ['.html', '.htm'], label: 'HTML' },
  csv: { endelser: ['.csv'], label: 'CSV' },
  tsv: { endelser: ['.tsv'], label: 'TSV' },
  docx: { endelser: ['.docx'], label: 'Word (docx)' },
  xlsx: { endelser: ['.xlsx'], label: 'Excel (xlsx)' },
  pptx: { endelser: ['.pptx'], label: 'PowerPoint (pptx)' },
  eml: { endelser: ['.eml'], label: 'E-post (eml)' },
};
const ENDELSER = Object.values(FORMATER).flatMap((f) => f.endelser);
const formatAv = (navn) => { const e = path__default.extname(String(navn || '')).toLowerCase(); return Object.keys(FORMATER).find((k) => FORMATER[k].endelser.includes(e)) || null };
const kanLese = (navn) => !!formatAv(navn);
const ord = (t) => (String(t || '').match(/\S+/g) || []).length;
const MAKS_BYTES = 50 * 1024 * 1024;          // 50 MB — større filer leses ikke (minne); si det i stedet for å henge
const MAKS_UTPAKKET = 300 * 1024 * 1024;             // en liten zip kan pakke seg ut til gigabyte: stopp der i stedet for å gå tom for minne

// ── tekst ───────────────────────────────────────────────────────────────────
// UTF-8 først; har fila ugyldige sekvenser (U+FFFD) og ingen BOM, er den trolig Latin-1/Windows-1252 (eldre norske filer med æøå).
function dekod(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  const utf = buf.toString('utf8');
  return utf.includes('�') ? buf.toString('latin1') : utf
}
const normaliser = (t) => String(t || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
// Runde 1 (arbeidsstykke 32 §6): en metadata-tittel brukes bare når den ser ut som en tittel — ikke et filnavn («pdf.html», «rapport_v2.docx»),
// ikke et verktøynavn («Microsoft Word», «Untitled», «Document1»), ikke en sti, ikke bare tall og tegn, ikke kortere enn tre bokstaver.
// Ellers null, så innlesing.tittelFor faller tilbake til filnavnet uten endelse (det er det Erik kjenner igjen).
function brukbarTittel(t) {
  const s = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length < 3) return null
  if (/[\/\\]/.test(s)) return null                                                   // en sti
  if (/\.(pdf|docx?|pptx?|xlsx?|indd|ai|md|txt|html?|rtf|odt|pages|key)$/i.test(s)) return null   // et filnavn
  if (/^[\w.-]+\.[a-z0-9]{2,5}$/i.test(s)) return null                                  // noe.endelse
  if (/^(untitled|unknown|microsoft word|word|document\d*|dokument\d*|presentation\d*|slide ?\d*|title|titel|tittel|pdf|html|new document|untitled document|dokument uten navn|uten navn|layout ?\d*|print|utskrift|scan(ned)?\d*|skann(et)?\d*|img_?\d*|image\d*)$/i.test(s)) return null
  if (!/\p{L}{2}/u.test(s)) return null                                                  // bare tall og tegn
  if ((s.match(/\p{L}/gu) || []).length < 3) return null
  return s
}
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
  return { tekst, tittel: brukbarTittel(tittel ? dekodEntiteter(tittel) : null) }
}
function lesHtml(buf) { const { tekst, tittel } = htmlTilTekst(dekod(buf)); const t = tittel || førsteOverskrift(tekst); return { tekst, meta: { verktøy: 'html', ...(t ? { tittel: t } : {}) } } }   // runde 1: uten brukbar <title> → første overskrift

// ── zip (til docx) ──────────────────────────────────────────────────────────
// En liten zip-leser uten pakke og uten shell: sentralkatalogen bakfra, så hver fil. Metode 0 (lagret) og 8 (deflate). Ingen zip64 — et
// Word-dokument er aldri så stort. (unzip.js bruker unzip/tar for eksport-zip-ene — det er greit der, men her trengs én bestemt fil i minnet.)
function zipFiler(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) {
    if (buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0) throw new LeseFeil('fila er låst med passord (eller lagret i et gammelt Office-format). Åpne den, lagre en kopi uten passord som .docx, .xlsx eller .pptx, og prøv igjen.', 'passord')
    throw new LeseFeil('fila er ødelagt, eller den er ikke et ekte Office-dokument (Tua fant ikke innholdet i den).', 'format')
  }
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
    if (f.metode === 8) { try { return zlib.inflateRawSync(data, { maxOutputLength: MAKS_UTPAKKET }) } catch (e) { throw new LeseFeil(e?.code === 'ERR_BUFFER_TOO_LARGE' ? `zip: ${navn} er større enn ${MAKS_UTPAKKET / 1048576} MB utpakket — Tua leser den ikke.` : `zip: ${navn} er ødelagt (${e.message})`, 'format') } }
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

// ── felles for Office-filene ────────────────────────────────────────────────
const xmlTekst = (b) => (b ? b.toString('utf8') : '');
// _rels-fila: Id → målet, relativt til mappa over _rels (slik zip-en har det: «worksheets/sheet1.xml» under xl/)
function relasjoner(zip, fil) {
  const m = fil.lastIndexOf('/'), dir = fil.slice(0, m), navn = fil.slice(m + 1);
  const ut = {};
  for (const r of xmlTekst(zip.les(`${dir}/_rels/${navn}.rels`)).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (r[0].match(/\bId="([^"]+)"/) || [])[1], mål = (r[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && mål) ut[id] = mål.startsWith('/') ? mål.slice(1) : path__default.posix.normalize(`${dir}/${mål}`);
  }
  return ut
}
const kjerneTittel = (zip) => brukbarTittel(dekodEntiteter((xmlTekst(zip.les('docProps/core.xml')).match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/) || [])[1] || ''));

// ── xlsx ────────────────────────────────────────────────────────────────────
// xl/workbook.xml gir arkene i rekkefølge, rels gir fila per ark, sharedStrings.xml tekstene. Celle: t="s" delt streng, inlineStr, str (formel-tekst), b (sann/usann), ellers tall.
// Et tall er en dato når stilen sier det (numFmtId 14–22/45–47, eller en egen format-kode med d, m eller y): datoer skrives som åååå-mm-dd, så de kan leses og sjekkes.
const excelDato = (n) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)); return Number.isNaN(d.getTime()) ? String(n) : (n % 1 ? d.toISOString().slice(0, 16).replace('T', ' ') : d.toISOString().slice(0, 10)) };
function datoStiler(zip) {
  const xml = xmlTekst(zip.les('xl/styles.xml'));
  const egne = new Set();
  for (const m of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) { if (/[dy]|(?:^|[^a-z])m+(?:[^a-z]|$)/i.test(m[2].replace(/"[^"]*"|\[[^\]]*\]/g, ''))) egne.add(Number(m[1])); }
  const del = (xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
  return [...del.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((m) => { const n = Number(m[1]); return (n >= 14 && n <= 22) || (n >= 45 && n <= 47) || egne.has(n) })
}
const kolNr = (r) => { let n = 0; for (const c of String(r).replace(/\d+$/, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1 };
function xlsxTilTekst(buf) {
  const zip = zipFiler(buf);
  const bok = xmlTekst(zip.les('xl/workbook.xml'));
  if (!bok) throw new LeseFeil('fila er en zip, men ikke et Excel-ark (xl/workbook.xml mangler)', 'format')
  const rels = relasjoner(zip, 'xl/workbook.xml');
  const delte = [...xmlTekst(zip.les('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => dekodEntiteter([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const dato = datoStiler(zip);
  const deler = [];
  let rader = 0, ark = 0, skjulte = 0;
  for (const a of bok.matchAll(/<sheet\b[^>]*>/g)) {
    const navn = dekodEntiteter((a[0].match(/\bname="([^"]*)"/) || [])[1] || 'Ark');
    const fil = rels[(a[0].match(/\br:id="([^"]+)"/) || [])[1]];
    const skjult = /\bstate="(hidden|veryHidden)"/.test(a[0]);
    const xml = fil ? xmlTekst(zip.les(fil)) : '';
    const linjer = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const celler = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = c[1], inn = c[2] || '';
        const t = (attr.match(/\bt="([^"]+)"/) || [])[1], ref = (attr.match(/\br="([A-Z]+\d+)"/) || [])[1], st = Number((attr.match(/\bs="(\d+)"/) || [])[1]);
        const v = (inn.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        let verdi = '';
        if (t === 's') verdi = delte[Number(v)] ?? '';
        else if (t === 'inlineStr') verdi = dekodEntiteter([...inn.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (t === 'b') verdi = v === '1' ? 'sann' : 'usann';
        else if (v != null) verdi = !t && dato[st] && Number.isFinite(Number(v)) ? excelDato(Number(v)) : dekodEntiteter(v);
        verdi = verdi.replace(/\s+/g, ' ').trim();
        if (!verdi) continue
        const i = ref ? kolNr(ref) : celler.length;
        while (celler.length < i) celler.push('');
        celler[i] = verdi;
      }
      if (celler.length) { linjer.push(celler.join(' | ')); rader++; }
    }
    if (!linjer.length) continue
    ark++; if (skjult) skjulte++;
    deler.push(`## Ark: ${navn}${skjult ? ' (skjult)' : ''}\n\n${linjer.join('\n')}`);
  }
  return { tekst: normaliser(deler.join('\n\n')), ark, rader, skjulte, tittel: kjerneTittel(zip) }
}
function lesXlsx(buf) { const { tekst, ark, rader, skjulte, tittel } = xlsxTilTekst(buf); return { tekst, meta: { verktøy: 'xlsx (zip + regneark-xml)', ark, rader, ...(skjulte ? { merknad: `${skjulte} skjult${skjulte === 1 ? '' : 'e'} ark er lest og merket` } : {}), ...(tittel ? { tittel } : {}) } } }

// ── pptx ────────────────────────────────────────────────────────────────────
// ppt/presentation.xml gir rekkefølgen (sldIdLst), rels gir lysbildene. Hver <p:sp> er et felt: tittelplassholderen blir overskriften, lysbildenummer og bunntekst hoppes over.
const avsnittAv = (xml) => [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => dekodEntiteter([...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g)].map((x) => x[1] ?? '\n').join('')).replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
function lysbildeFelt(xml) {
  const titler = [], tekst = [];
  for (const sp of xml.matchAll(/<p:(?:sp|graphicFrame)\b[^>]*>([\s\S]*?)<\/p:(?:sp|graphicFrame)>/g)) {
    const ph = (sp[1].match(/<p:ph\b[^>]*?type="([^"]+)"/) || [])[1] || '';
    if (/^(sldNum|dt|ftr|hdr)$/.test(ph)) continue
    const a = avsnittAv(sp[1]);
    if (/^(title|ctrTitle)$/.test(ph)) titler.push(...a); else tekst.push(...a);
  }
  return { tittel: titler.join(' ').replace(/\s+/g, ' ').trim(), tekst }
}
function pptxTilTekst(buf) {
  const zip = zipFiler(buf);
  const pres = xmlTekst(zip.les('ppt/presentation.xml'));
  if (!pres) throw new LeseFeil('fila er en zip, men ikke en PowerPoint-presentasjon (ppt/presentation.xml mangler)', 'format')
  const rels = relasjoner(zip, 'ppt/presentation.xml');
  let filer = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => rels[m[1]]).filter(Boolean);
  if (!filer.length) filer = zip.navn.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
  const deler = [];
  let skjulte = 0, notater = 0, førsteTittel = null;
  filer.forEach((fil, i) => {
    const xml = xmlTekst(zip.les(fil));
    if (!xml) return
    const { tittel, tekst } = lysbildeFelt(xml);
    const skjult = /<p:sld\b[^>]*\bshow="0"/.test(xml);
    if (skjult) skjulte++;
    if (tittel && !førsteTittel) førsteTittel = tittel;
    const notatFil = Object.values(relasjoner(zip, fil)).find((m) => /notesSlides\/notesSlide\d+\.xml$/.test(m));
    const notat = notatFil ? lysbildeFelt(xmlTekst(zip.les(notatFil)).replace(/<p:sp\b(?:(?!<\/p:sp>)[\s\S])*?type="sldImg"[\s\S]*?<\/p:sp>/g, '')).tekst.filter((l) => !/^\d+$/.test(l)) : [];
    if (notat.length) notater++;
    const linjer = [`## Lysbilde ${i + 1}${tittel ? `: ${tittel}` : ''}${skjult ? ' (skjult)' : ''}`, '', ...tekst, ...(notat.length ? ['', `Notat: ${notat.join(' ')}`] : [])];
    if (tittel || tekst.length || notat.length) deler.push(linjer.join('\n'));
  });
  return { tekst: normaliser(deler.join('\n\n')), sider: filer.length, skjulte, notater, tittel: kjerneTittel(zip) || brukbarTittel(førsteTittel) }
}
function lesPptx(buf) { const { tekst, sider, skjulte, notater, tittel } = pptxTilTekst(buf); return { tekst, meta: { verktøy: 'pptx (zip + lysbilde-xml)', sider, notater, ...(skjulte ? { merknad: `${skjulte} skjult${skjulte === 1 ? '' : 'e'} lysbilde${skjulte === 1 ? '' : 'r'} er lest og merket` } : {}), ...(tittel ? { tittel } : {}) } } }

// ── e-post (.eml) ───────────────────────────────────────────────────────────
// RFC 5322-hode (foldede linjer), MIME med grenser, overføringskoding og tegnsett. Alt på bytes (latin1-strenger) til tegnsettet er kjent. Tåler rot: en ødelagt del hoppes over.
const tegnsett = (bytes, cs) => {
  try { return new TextDecoder(String(cs || 'utf-8').trim().toLowerCase()).decode(bytes) } catch { return dekod(Buffer.from(bytes)) }
};
function kodetOrd(s) {   // =?utf-8?Q?Kj=C3=A6re?= og =?iso-8859-1?B?…?= i hodet; mellomrom mellom to kodede ord forsvinner
  return String(s || '').replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([^?\s]+)\?([bqBQ])\?([^?]*)\?=/g, (m, cs, enc, t) => {
    try { return tegnsett(enc.toLowerCase() === 'b' ? Buffer.from(t, 'base64') : qpBytes(t.replace(/_/g, ' ')), cs) } catch { return m }
  })
}
function qpBytes(s) {   // quoted-printable → bytes; «=» sist på linja er myk linjeskift
  const t = String(s).replace(/=\r?\n/g, '');
  const ut = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { ut.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else ut.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(ut)
}
function delOpp(rå) {   // rå: latin1-streng → { hode: {navn: verdi}, kropp }
  const m = rå.match(/\r?\n\r?\n/);
  const hodeTekst = m ? rå.slice(0, m.index) : rå, kropp = m ? rå.slice(m.index + m[0].length) : '';
  const hode = {};
  for (const l of hodeTekst.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in hode)) hode[k] = l.slice(i + 1).trim(); } }
  return { hode, kropp }
}
const parameter = (v, navn) => { const m = String(v || '').match(new RegExp(`(?:^|;)\\s*${navn}\\*?=(?:"([^"]*)"|([^;\\s]*))`, 'i')); return m ? (m[1] ?? m[2] ?? '') : '' };
function vedleggNavn(hode) {
  const d = hode['content-disposition'] || '', t = hode['content-type'] || '';
  const råRfc2231 = (String(d).match(/filename\*=([^;]+)/i) || [])[1];
  if (råRfc2231) { const b = råRfc2231.trim().replace(/^"|"$/g, ''); const i = b.indexOf("''"); try { return decodeURIComponent(i >= 0 ? b.slice(i + 2) : b) } catch { return b } }
  return kodetOrd(parameter(d, 'filename') || parameter(t, 'name'))
}
function delKropp(hode, kropp) {
  const enc = String(hode['content-transfer-encoding'] || '').toLowerCase().trim();
  const bytes = enc === 'base64' ? Buffer.from(kropp.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qpBytes(kropp) : Buffer.from(kropp, 'latin1');
  return tegnsett(bytes, parameter(hode['content-type'], 'charset') || 'utf-8')
}
function gåDeler({ hode, kropp }, ut, dybde = 0) {
  const type = String(hode['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase();
  const disp = String(hode['content-disposition'] || '').toLowerCase();
  const navn = vedleggNavn(hode);
  if (type.startsWith('multipart/') && dybde < 12) {
    const g = parameter(hode['content-type'], 'boundary');
    if (!g) return
    const deler = kropp.split(new RegExp(`(?:^|\\r?\\n)--${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*(?=\\r?\\n|$)`)).slice(1);
    for (const d of deler) { const del = d.replace(/^\r?\n/, ''); if (del.trim()) gåDeler(delOpp(del), ut, dybde + 1); }
    return
  }
  if (type === 'message/rfc822' && dybde < 12) {
    const indre = delOpp(kropp);
    ut.videre.push(hodeLinjer(indre.hode));
    gåDeler(indre, ut, dybde + 1);
    return
  }
  if (disp.startsWith('attachment') || (navn && !/^text\/(plain|html)$/.test(type))) { if (navn || !disp.startsWith('inline')) ut.vedlegg.push(navn || 'uten navn'); return }
  if (type === 'text/plain') ut.tekst.push(delKropp(hode, kropp));
  else if (type === 'text/html') ut.html.push(delKropp(hode, kropp));
}
const hodeLinjer = (h) => [['Fra', h.from], ['Til', h.to], ['Kopi', h.cc], ['Svar til', h['reply-to']], ['Dato', h.date], ['Emne', h.subject]].filter(([, v]) => v).map(([k, v]) => `${k}: ${kodetOrd(v).replace(/\s+/g, ' ').trim()}`).join('\n');
function emlTilTekst(buf) {
  const rå = buf.toString('latin1');
  const øverst = delOpp(rå);
  if (!øverst.hode.from && !øverst.hode.subject && !øverst.hode['content-type'] && !øverst.hode.to) throw new LeseFeil('fila ser ikke ut som en e-post (fant ikke Fra, Til eller Emne i hodet)', 'format')
  const ut = { tekst: [], html: [], vedlegg: [], videre: [] };
  gåDeler(øverst, ut);
  const emne = kodetOrd(øverst.hode.subject || '').replace(/\s+/g, ' ').trim();
  const brød = ut.tekst.length ? ut.tekst.join('\n\n') : ut.html.map((h) => htmlTilTekst(h).tekst).join('\n\n');
  const h = { ...øverst.hode }; delete h.subject;
  const deler = [emne ? `# ${emne}` : '', hodeLinjer(h), brød, ...ut.videre.map((v) => `Videresendt e-post:\n${v}`), ut.vedlegg.length ? `Vedlegg (ikke lest): ${ut.vedlegg.join(', ')}` : ''];
  return { tekst: normaliser(deler.filter(Boolean).join('\n\n')), tittel: brukbarTittel(emne), vedlegg: ut.vedlegg }
}
function lesEml(buf) { const { tekst, tittel, vedlegg } = emlTilTekst(buf); return { tekst, meta: { verktøy: 'eml (MIME)', vedlegg: vedlegg.length, ...(vedlegg.length ? { merknad: `${vedlegg.length} vedlegg er ikke lest: ${vedlegg.join(', ')}` } : {}), ...(tittel ? { tittel } : {}) } } }

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
async function pdfTilTekst(buf, { navn = 'fila', på = () => {} } = {}) {
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
      på('side', { side: i, av: doc.numPages });          // runde 2c (§5.5): «leser … side 2 av 5» i appen
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
    const tittel = brukbarTittel(info.Title);
    return { tekst, sider: doc.numPages, verktøy: `pdfjs-dist ${lib.version}`, ...(tittel ? { tittel } : {}) }
  } finally { try { await oppgave.destroy(); } catch {} }
}
async function lesPdf(buf, navn, på) { const { tekst, sider, verktøy, tittel } = await pdfTilTekst(buf, { navn, på }); return { tekst, meta: { verktøy, sider, ...(tittel ? { tittel } : {}) } } }

// ── grensesnittet ───────────────────────────────────────────────────────────
// fil: sti på disk (data leses derfra) — eller gi `data` (Buffer) og `navn` når fila kom som opplasting. Returnerer alltid tekst + meta;
// kaster LeseFeil med kode: ukjent-format · for-stor · tom · ingen-tekst · passord · format · leser-mangler · feil.
async function les(fil, { navn = null, data = null, på = () => {} } = {}) {   // på: fremdrift side for side (pdf) — runde 2c
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
    case 'pdf': r = await lesPdf(buf, n, på); break
    case 'markdown': r = lesMarkdown(buf); break
    case 'html': r = lesHtml(buf); break
    case 'csv': r = lesCsv(buf, ','); break
    case 'tsv': r = lesCsv(buf, '\t'); break
    case 'docx': r = lesDocx(buf); break
    case 'xlsx': r = lesXlsx(buf); break
    case 'pptx': r = lesPptx(buf); break
    case 'eml': r = lesEml(buf); break
    default: r = lesTekst(buf);
  }
  if (!r.tekst || ord(r.tekst) < 1) throw new LeseFeil(`«${n}» har ingen tekst å lese.`, 'tom')
  return { tekst: r.tekst, meta: { format, label: FORMATER[format].label, navn: n, bytes: buf.length, tegn: r.tekst.length, ord: ord(r.tekst), sider: r.meta.sider ?? null, ...r.meta } }
}

export { FORMATER, formatAv, kanLese, les };
