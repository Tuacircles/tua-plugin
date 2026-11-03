#!/usr/bin/env node
// test-lesere.mjs — lesere og Innboks (M16, skive 7) mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall:
// S og M skrives etter regler (TUA_SKRIVER=regel) og av test-mottakeren (TUA_SKRIVER=test), som sender ingenting.
//
//   TUA_FILES_ROOT=/tmp/tua-test-lesere/arkiv TUA_DATA_DIR=/tmp/tua-test-lesere/data node server/test-lesere.mjs
//
// Testfilene lages her: en PDF med tekstlag (to sider, Helvetica/WinAnsi, æøå), en PDF uten tekstlag, .md, .txt (Latin-1), .html, .csv og .docx
// (zip med word/document.xml, lagret ukomprimert med CRC32). Sjekker: leseren per format, feilene (ukjent format, tom, ingen tekstlag → «OCR kommer»),
// regelbasert S/M, lesInn → sak med L = teksten og S/M merket med hvem (regel og test), samme fil igjen = samme sak, opplasting uten sti = ingen lenke,
// Innboks: løse dokumenter → saker i «Innboks» (dry-run først, Ferdig etterpå, feilet-merking, saker i Innboks lastes, løse .md gjør det ikke),
// aldri Utlevert for lokal skriver; og broen: POST /api/les som rå kropp og som sti (SSE-rekkefølgen, fil utenfor hjemmemappa avvist), GET /api/innboks,
// POST /api/innboks/kjør, GET /api/prosjekter, POST /api/flytt.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_SKRIVER = 'regel'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR
if (!ROOT || !DATA || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true })
const FILER = path.join(DATA, 'testfiler'); fs.mkdirSync(FILER, { recursive: true })

const { load, save, upsert, fileOf, INBOX_DIR, erTuaSak } = await import('./store.js')
const { les, formatAv, kanLese, LeseFeil, zipFiler, htmlTilTekst, dekod } = await import('./lesere.js')
const { regelNivåer, skrivNivåer } = await import('./motor.js')
const { lesInn, lesInnInnboks, innboksDokumenter, STANDARD_PROSJEKT } = await import('./innlesing.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const UTLEVERT = () => { try { return fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

// ── testfiler ──────────────────────────────────────────────────────────────
// Minimal PDF: Helvetica med WinAnsi (æøå som Latin-1-bytes), én tekstlinje per Tj. Uten tekst: en side uten innholdsstrøm-tekst.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
function lagPdf(sider) {
  const objs = []
  const add = (s) => { objs.push(s); return objs.length }
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const pagesId = objs.length + 1 + sider.length * 2
  const pageIds = []
  for (const linjer of sider) {
    const inner = linjer.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 16} Td (${esc(l)}) Tj ET`).join('\n')
    const c = add(`<< /Length ${Buffer.byteLength(inner, 'latin1')} >>\nstream\n${inner}\nendstream`)
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`))
  }
  const pages = add(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  const cat = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`)
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
// Minimal zip (lagret, med CRC32) — nok til en .docx
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 } })()
function lagZip(filer, deflate = false) {
  const lokale = [], sentral = []
  let off = 0
  for (const [navn, innhold] of Object.entries(filer)) {
    const data = Buffer.from(innhold, 'utf8'), n = Buffer.from(navn, 'utf8'), komp = deflate ? zlib.deflateRawSync(data) : data
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(CRC(data), 14); h.writeUInt32LE(komp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(CRC(data), 16); c.writeUInt32LE(komp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42)
    lokale.push(h, n, komp); sentral.push(c, n); off += 30 + n.length + komp.length
  }
  const cd = Buffer.concat(sentral)
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(sentral.length / 2, 8); e.writeUInt16LE(sentral.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...lokale, cd, e])
}
const PERSON = 'Kari Nordmann'
const LANG = Array.from({ length: 12 }, (_, i) => `## Del ${i + 1}\n\nDette er avsnitt ${i + 1} i et langt notat om lagerdrift. Det handler om kapasitet, kostnader og hvem som gjør hva. ` + 'Flere setninger følger her for å gjøre teksten lang nok til at et sammendrag trengs. '.repeat(4)).join('\n\n')
const skriv = (navn, buf) => { const p = path.join(FILER, navn); fs.writeFileSync(p, buf); return p }
const F = {
  pdf: skriv('Møtenotat lager.pdf', lagPdf([['Møtenotat om lageret', `${PERSON} foreslo å flytte lageret til Industriveien 4.`, 'Budsjett 45 000 kr.'], ['Side to: konklusjonen står her.']])),
  utenTekst: skriv('skannet.pdf', lagPdf([[]])),
  md: skriv('Plan for lageret.md', Buffer.from(`# Plan for lageret\n\nPlanen er å flytte lageret til Lillestrøm i løpet av våren. ${PERSON} leder arbeidet.\n\n${LANG}\n`, 'utf8')),
  txt: skriv('kort notat.txt', Buffer.from('Et kort notat med æøå og ÆØÅ, lagret som Latin-1 fra en eldre maskin.\nAndre linje.', 'latin1')),
  html: skriv('side.html', Buffer.from('<!doctype html><html><head><title>Referat &amp; vedtak</title><style>p{color:red}</style><script>alert(1)</script></head><body><h1>Referat</h1><p>F&oslash;rste avsnitt med <b>fet</b> tekst.</p><ul><li>Punkt &eacute;n</li><li>Punkt to</li></ul><table><tr><td>a</td><td>b</td></tr></table></body></html>', 'utf8')),
  csv: skriv('tabell.csv', Buffer.from('navn;beløp;dato\nLager;45000;2026-10-01\n"Hylle, stor";1200;2026-10-02\n', 'utf8')),
  docx: skriv('brev.docx', lagZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Brev om lageret</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Hei, </w:t></w:r><w:r><w:t>dette er brevet.</w:t></w:r></w:p><w:p><w:r><w:t>Beløp &amp; frist: 45 000 kr innen 1. mai.</w:t></w:r></w:p></w:body></w:document>' })),
  docxDeflate: skriv('brev2.docx', lagZip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Komprimert brev.</w:t></w:r></w:p></w:body></w:document>' }, true)),
  ukjent: skriv('bilde.xyz', Buffer.from('x')),
  tom: skriv('tom.txt', Buffer.alloc(0)),
}

// ── 1) format og leser per format ─────────────────────────────────────────
{
  ok('formatAv: pdf/md/txt/html/csv/tsv/docx kjennes, .xyz ikke', formatAv('a.PDF') === 'pdf' && formatAv('a.md') === 'markdown' && formatAv('a.txt') === 'tekst' && formatAv('a.htm') === 'html' && formatAv('a.csv') === 'csv' && formatAv('a.tsv') === 'tsv' && formatAv('a.docx') === 'docx' && !kanLese('a.xyz') && !kanLese('a.doc'))
  const pdf = await les(F.pdf)
  ok('PDF: tekstlaget på to sider, æøå riktig, meta med sider og verktøy', pdf.meta.format === 'pdf' && pdf.meta.sider === 2 && pdf.tekst.includes(`${PERSON} foreslo å flytte lageret til Industriveien 4.`) && pdf.tekst.includes('Side to') && /pdfjs-dist \d/.test(pdf.meta.verktøy) && pdf.meta.ord > 10, JSON.stringify(pdf.meta))
  const md = await les(F.md)
  ok('Markdown: teksten som den er, tittelen fra første overskrift', md.meta.format === 'markdown' && md.meta.tittel === 'Plan for lageret' && md.tekst.startsWith('# Plan for lageret') && md.tekst.includes('## Del 12'))
  const txt = await les(F.txt)
  ok('Tekst i Latin-1: dekodet riktig (æøå)', txt.tekst.includes('æøå og ÆØÅ') && txt.meta.linjer === 2, txt.tekst.slice(0, 40))
  ok('dekod: UTF-8 med BOM og UTF-16LE', dekod(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('blå', 'utf8')])) === 'blå' && dekod(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('blå', 'utf16le')])) === 'blå')
  const html = await les(F.html)
  ok('HTML: script/style ut, overskrift → #, liste → -, tabellrad → a | b, entiteter dekodet, tittel', html.tekst.startsWith('# Referat') && html.tekst.includes('Første avsnitt med fet tekst.') && html.tekst.includes('- Punkt én') && html.tekst.includes('a | b') && !html.tekst.includes('alert') && !html.tekst.includes('color') && html.meta.tittel === 'Referat & vedtak', JSON.stringify(html.tekst))
  const csv = await les(F.csv)
  ok('CSV: teksten som den er, rader og kolonner talt (semikolon, anførselstegn)', csv.tekst.startsWith('navn;beløp;dato') && csv.meta.rader === 3 && csv.meta.kolonner === 3, JSON.stringify(csv.meta))
  const docx = await les(F.docx)
  ok('docx: Heading1 → #, runs satt sammen, &amp; dekodet, tittel', docx.tekst.startsWith('# Brev om lageret') && docx.tekst.includes('Hei, dette er brevet.') && docx.tekst.includes('Beløp & frist: 45 000 kr innen 1. mai.') && docx.meta.tittel === 'Brev om lageret' && docx.meta.avsnitt === 3, JSON.stringify(docx))
  const d2 = await les(F.docxDeflate)
  ok('docx med deflate-komprimert zip leses også', d2.tekst === 'Komprimert brev.')
  ok('zipFiler: lister filene', zipFiler(fs.readFileSync(F.docx)).navn.includes('word/document.xml'))
}

// ── 2) feil ────────────────────────────────────────────────────────────────
{
  const e = async (p, o) => { try { await les(p, o); return null } catch (x) { return x } }
  const u = await e(F.ukjent)
  ok('ukjent format → LeseFeil ukjent-format med lista over det som leses', u instanceof LeseFeil && u.kode === 'ukjent-format' && /PDF/.test(u.message) && /docx/.test(u.message), u?.message)
  const t = await e(F.tom)
  ok('tom fil → LeseFeil tom', t?.kode === 'tom')
  const s = await e(F.utenTekst)
  ok('PDF uten tekstlag → LeseFeil ingen-tekst, «OCR kommer», antall sider', s?.kode === 'ingen-tekst' && /ikke tekstlag/.test(s.message) && /OCR/.test(s.message) && s.sider === 1, s?.message)
  const z = await e(F.ukjent, { navn: 'x.docx' })
  ok('docx som ikke er zip → LeseFeil format', z?.kode === 'format', z?.message)
  const m = await e(path.join(FILER, 'finnes-ikke.md'))
  ok('fil som ikke finnes → LeseFeil', m instanceof LeseFeil)
}

// ── 3) regelbasert S/M ─────────────────────────────────────────────────────
{
  const kort = regelNivåer('# Tittel\n\nFørste avsnitt er ingressen. Den har to setninger.\n\nAndre avsnitt.', { tittel: 'Tittel' })
  ok('regel: S = første brødtekst-avsnitt, M tom når teksten er kort', kort.S === 'Første avsnitt er ingressen. Den har to setninger.' && kort.M === '', JSON.stringify(kort))
  const lang = regelNivåer(fs.readFileSync(F.md, 'utf8'))
  ok('regel: lang tekst → S ≤ 300 og M ≤ 2 500 med overskriftene i fet og første setning per avsnitt', lang.S.startsWith('Planen er å flytte lageret') && lang.S.length <= 300 && lang.M.length > 200 && lang.M.length <= 2500 && lang.M.includes('**Del 1**') && lang.M.includes('– Dette er avsnitt 1'), `${lang.S.length} / ${lang.M.length}`)
  const r = await skrivNivåer('Kort tekst uten modell.', { tittel: 'x' })
  ok('skrivNivåer med TUA_SKRIVER=regel → av regel, ingen Utlevert', r.av === 'regel' && r.S === 'Kort tekst uten modell.' && !r.utlevert && UTLEVERT().length === 0)
}

// ── 4) lesInn → sak ────────────────────────────────────────────────────────
let mdId
{
  const h = []
  const sak = await lesInn(F.md, { prosjekt: 'Testprosjekt', samtale: 'Test', på: (ev, d) => h.push(ev) })
  mdId = sak.id
  ok('lesInn: hendelser leser → lest → ferdig (ingen «skriver» med regler)', h.join(' ') === 'leser lest ferdig', h.join(' '))
  const a = load().find((x) => x.id === sak.id)
  ok('sak: kind capture, L = hele teksten, tittel fra overskriften, prosjekt, tagger fil+markdown, kilde = filnavn (format)', a?.kind === 'capture' && a.content === fs.readFileSync(F.md, 'utf8').replace(/[ \t]+\n/g, '\n').trim() && a.name === 'Plan for lageret' && a.project === 'Testprosjekt' && a.tags.join() === 'fil,markdown,se-over' && a.source === 'Plan for lageret.md (Markdown)' && a.convo === 'Test', JSON.stringify([a?.name, a?.source, a?.tags]))
  ok('sak: S og M merket «regel» (V10), S_versjon 1, nøkkel fil:<sha>', a.levels.S.by === 'regel' && a.levels.M.by === 'regel' && a.levels.S.of === 1 && /^fil:[0-9a-f]{16}$/.test(a.key) && sak.S_av === 'regel' && sak.M_av === 'regel', JSON.stringify(a.levels?.S))
  ok('sak: peker til originalfila (file-lenke), ingen kopi i arkivet', a.links?.[0]?.kind === 'file' && a.links[0].href === F.md && a.links[0].label === 'Plan for lageret.md' && !fs.existsSync(path.join(ROOT, 'Testprosjekt', 'Plan for lageret.md')) === false && fs.readdirSync(path.join(ROOT, 'Testprosjekt')).length === 1, JSON.stringify(a.links))
  ok('sak: fila i arkivet har S_av og M_av i frontmatter og hele teksten under L', (() => { const t = fs.readFileSync(fileOf(a), 'utf8'); return t.includes('S_av: "regel"') && t.includes('M_av: "regel"') && t.includes('## Del 12') })())
  ok('ferdig-hendelsen bærer det Spør trenger: ord/tegn per nivå, max L, vault false, format, skriver', sak.ord.L > 100 && sak.ord.S > 0 && sak.tegn.M > 0 && sak.max === 'L' && sak.vault === false && sak.format === 'markdown' && sak.skriver.av === 'regel' && sak.status === 'ny', JSON.stringify(sak.ord))
  const igjen = await lesInn(F.md, { prosjekt: 'Testprosjekt' })
  ok('samme fil igjen → samme sak, uendret, ikke en kopi', igjen.id === sak.id && igjen.status === 'uendret' && load().filter((x) => x.kind === 'capture').length === 1)
  const pdf = await lesInn(F.pdf, { prosjekt: 'Testprosjekt' })
  const pa = load().find((x) => x.id === pdf.id)
  ok('PDF → sak med sider i kilden, tittel = filnavnet uten endelse (ingen tittel i metadata)', pa.source === 'Møtenotat lager.pdf (PDF, 2 sider)' && pa.name === 'Møtenotat lager' && pdf.sider === 2 && pa.content.includes(PERSON), JSON.stringify([pa.source, pa.name]))
  ok('kort PDF: S etter regel, ingen M (teksten er under grensen)', pa.levels.S.by === 'regel' && !pa.levels.M && pdf.harM === false)
  const opp = await lesInn(null, { navn: 'Opplastet notat.txt', data: Buffer.from('Et notat som kom som opplasting fra nettleseren, uten sti på maskinen.'), prosjekt: 'Testprosjekt' })
  const oa = load().find((x) => x.id === opp.id)
  ok('opplasting (data, ingen sti) → sak uten file-lenke, tittel fra filnavnet', !oa.links?.length && oa.name === 'Opplastet notat' && oa.content.startsWith('Et notat som kom'), JSON.stringify(oa.links))
  ok('ingen Utlevert for noe av dette (lokalt og regler)', UTLEVERT().length === 0)
}

// ── 4b) xlsx, pptx og eml (arbeidsstykke 35 skive 3) ────────────────────────
{
  const CT = '<Types/>'
  const xlsx = lagZip({ '[Content_Types].xml': CT,
    'docProps/core.xml': '<cp:coreProperties xmlns:dc="d"><dc:title>Budsjett for Nordlys</dc:title></cp:coreProperties>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Lønn &amp; ansatte" sheetId="1" r:id="rId1"/><sheet name="Skjult ark" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Tomt" sheetId="3" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Navn</t></si><si><t>Lønn</t></si><si><r><t>Xenia </t></r><r><t>Fjeldstad</t></r><rPh><t>fonetisk</t></rPh></si><si><t>Født</t></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="170" formatCode="dd\\.mm\\.yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="170"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>1+1</f><v>650000</v></c><c r="C2" s="2"><v>31048</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Inline &amp; tekst</t></is></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>Hemmelig kolonne</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet3.xml': '<worksheet><sheetData/></worksheet>' }, true)
  const rx = await les(null, { navn: 'budsjett.xlsx', data: xlsx })
  ok('xlsx: arkene med navn, delte strenger (rPh ute), formel gir lagret verdi, inline og sann/usann', rx.tekst.includes('## Ark: Lønn & ansatte') && rx.tekst.includes('Xenia Fjeldstad | 650000') && !rx.tekst.includes('fonetisk') && rx.tekst.includes('Inline & tekst |  |  | sann'), rx.tekst)
  ok('xlsx: dato etter stil (åååå-mm-dd), skjult ark lest og merket, tomt ark ute', rx.tekst.includes('1985-01-01') && rx.tekst.includes('## Ark: Skjult ark (skjult)') && rx.tekst.includes('Hemmelig kolonne') && !rx.tekst.includes('Tomt') && /skjult/.test(rx.meta.merknad), rx.meta.merknad)
  ok('xlsx: meta (format, label, ark, rader, tittel fra docProps)', rx.meta.format === 'xlsx' && rx.meta.label === 'Excel (xlsx)' && rx.meta.ark === 2 && rx.meta.rader === 4 && rx.meta.tittel === 'Budsjett for Nordlys', JSON.stringify(rx.meta))
  const pptx = lagZip({ '[Content_Types].xml': CT,
    'ppt/presentation.xml': '<p:presentation xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId3"/><p:sldId id="2" r:id="rId2"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide2.xml': '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Plan for Q1</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Første </a:t></a:r><a:r><a:t>punkt &amp; mer</a:t></a:r></a:p><a:p><a:r><a:t>Andre punkt</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld><a:t>7</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': '<p:notes><p:sp><p:nvPr><p:ph type="body"/></p:nvPr><p:txBody><a:p><a:r><a:t>Husk å nevne Xenia Fjeldstad.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvPr><p:ph type="sldNum"/></p:nvPr><p:txBody><a:p><a:t>1</a:t></a:p></p:txBody></p:sp></p:notes>',
    'ppt/slides/slide1.xml': '<p:sld show="0"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Skjult lysbilde med tall</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>' }, true)
  const rp = await les(null, { navn: 'plan.pptx', data: pptx })
  ok('pptx: rekkefølgen fra presentasjonen, ikke filnavnet, tittel som overskrift', rp.tekst.indexOf('## Lysbilde 1: Plan for Q1') === 0 && rp.tekst.indexOf('## Lysbilde 2') > 0, rp.tekst)
  ok('pptx: tekst samlet per avsnitt, lysbildenummer ute, talernotat med', rp.tekst.includes('Første punkt & mer\nAndre punkt') && !/\n7\n/.test(rp.tekst) && rp.tekst.includes('Notat: Husk å nevne Xenia Fjeldstad.') && rp.meta.notater === 1, rp.tekst)
  ok('pptx: skjult lysbilde lest og merket, sider og tittel i meta', rp.tekst.includes('## Lysbilde 2 (skjult)') && rp.tekst.includes('Skjult lysbilde med tall') && rp.meta.sider === 2 && /skjult/.test(rp.meta.merknad) && rp.meta.tittel === 'Plan for Q1', JSON.stringify(rp.meta))
  const kropp = (t) => Buffer.from(t, 'utf8').toString('base64')
  const eml = Buffer.from([
    'From: =?utf-8?Q?Xenia_Fj=C3=A6ldstad?= <xenia@nordlys.no>', 'To: Bo Ek <bo@firma.no>,', ' Kari Nordmann <kari@firma.no>', 'Cc: ola@firma.no', 'Date: Mon, 2 Nov 2026 10:00:00 +0100',
    'Subject: =?iso-8859-1?Q?M=F8te_om_l=F8nn?=', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="ytre"', '',
    '--ytre', 'Content-Type: multipart/alternative; boundary=indre', '',
    '--indre', 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable', '', 'Hei, l=F8nna er avtalt.=', ' Mvh Xenia', '',
    '--indre', 'Content-Type: text/html; charset=utf-8', '', '<p>HTML-utgaven skal ikke med</p>', '--indre--', '',
    '--ytre', 'Content-Type: application/pdf; name="kontrakt.pdf"', 'Content-Disposition: attachment; filename="kontrakt.pdf"', 'Content-Transfer-Encoding: base64', '', kropp('%PDF-hemmelig-vedlegg'), '',
    '--ytre', 'Content-Type: application/octet-stream', "Content-Disposition: attachment; filename*=UTF-8''l%C3%B8nn.xlsx", '', 'xx', '--ytre--', ''].join('\r\n'), 'latin1')
  const re = await les(null, { navn: 'mote.eml', data: eml })
  ok('eml: emne og hode dekodet (Q, Latin-1, foldet linje), emnet er tittelen', re.meta.tittel === 'Møte om lønn' && re.tekst.startsWith('# Møte om lønn') && re.tekst.includes('Fra: Xenia Fjældstad <xenia@nordlys.no>') && re.tekst.includes('Til: Bo Ek <bo@firma.no>, Kari Nordmann <kari@firma.no>') && re.tekst.includes('Kopi: ola@firma.no'), re.tekst)
  ok('eml: ren tekst foran HTML, quoted-printable med myk linjeskift og Latin-1', re.tekst.includes('Hei, lønna er avtalt. Mvh Xenia') && !re.tekst.includes('HTML-utgaven'), re.tekst)
  ok('eml: vedlegg leses ikke, men står med navn i teksten og som merknad (også RFC 2231-navn)', !re.tekst.includes('hemmelig-vedlegg') && re.tekst.includes('Vedlegg (ikke lest): kontrakt.pdf, lønn.xlsx') && re.meta.vedlegg === 2 && /kontrakt\.pdf/.test(re.meta.merknad), re.meta.merknad)
  const html = await les(null, { navn: 'b.eml', data: Buffer.from('Subject: Bare HTML\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + kropp('<p>Hei <b>på</b> deg</p>')) })
  ok('eml: bare HTML → tekst, base64', html.tekst.includes('Hei på deg') && !html.tekst.includes('<p>'), html.tekst)
  const videre = await les(null, { navn: 'v.eml', data: Buffer.from('Subject: Fwd\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nSe under\r\n--b\r\nContent-Type: message/rfc822\r\n\r\nFrom: A B <a@b.no>\r\nSubject: Indre\r\n\r\nIndre tekst\r\n--b--\r\n') })
  ok('eml: videresendt e-post tas med', videre.tekst.includes('Videresendt e-post:') && videre.tekst.includes('Fra: A B <a@b.no>') && videre.tekst.includes('Indre tekst'), videre.tekst)
  const kode = async (navn, data) => { try { await les(null, { navn, data }); return null } catch (e) { return e } }
  const e1 = await kode('tull.xlsx', Buffer.from('dette er ikke en zip'))
  ok('feil per fil: en ødelagt .xlsx gir LeseFeil, ikke krasj', e1 instanceof LeseFeil && e1.kode === 'format', e1?.message)
  const e2 = await kode('tom.xlsx', lagZip({ 'xl/workbook.xml': '<workbook><sheets/></workbook>' }))
  ok('feil per fil: .xlsx uten tekst sier det', e2 instanceof LeseFeil && e2.kode === 'tom', e2?.message)
  const e3 = await kode('feil.pptx', lagZip({ 'word/document.xml': '<x/>' }))
  ok('feil per fil: en docx med feil endelse sier hva som mangler', e3 instanceof LeseFeil && /PowerPoint/.test(e3.message), e3?.message)
  const låst = Buffer.alloc(600); låst.writeUInt32LE(0xe011cfd0, 0); låst.writeUInt32LE(0xe11ab1a1, 4)
  const e4 = await kode('låst.xlsx', låst)
  ok('feil per fil: passordlåst Office-fil sier det med vanlige ord', e4?.kode === 'passord' && /passord/.test(e4.message), e4?.message)
  const e5 = await kode('tull.eml', Buffer.from('bare noe tekst uten hode'))
  ok('feil per fil: en .eml uten e-posthode sier det', e5?.kode === 'format' && /e-post/.test(e5.message), e5?.message)
  ok('kanLese: de nye endelsene, og formatAv', kanLese('a.XLSX') && kanLese('b.pptx') && kanLese('c.eml') && formatAv('c.eml') === 'eml')
  const sak = await lesInn(null, { navn: 'mote.eml', data: eml, prosjekt: 'Testprosjekt' })
  ok('lesInn(.eml): sak med tittel fra emnet, kilden sier e-post, merknaden følger med ut', sak.name === 'Møte om lønn' && /E-post/.test(sak.source) && /vedlegg/.test(sak.merknad || ''), JSON.stringify([sak.name, sak.source, sak.merknad]))
  const a = load().find((x) => x.id === sak.id)
  ok('lesInn(.eml): taggene fil, eml og se-over (filen skal ses over før første sending til en skymodell)', ['fil', 'eml', 'se-over'].every((t) => a.tags.includes(t)), a.tags.join(','))
  const atoms = load(); for (const id of [sak.id]) { const i = atoms.findIndex((x) => x.id === id); if (i >= 0) atoms.splice(i, 1) } ; save(atoms)
}

// ── 5) test-skriveren (modell uten å sende noe) ────────────────────────────
{
  process.env.TUA_SKRIVER = 'test'
  const h = []
  const sak = await lesInn(F.html, { prosjekt: 'Testprosjekt', på: (ev, d) => h.push([ev, d]) })
  const a = load().find((x) => x.id === sak.id)
  ok('TUA_SKRIVER=test: hendelsen «skriver» med mottaker test og lokalt, så ferdig', h.map((x) => x[0]).join(' ') === 'leser lest skriver ferdig' && h[2][1].mottaker === 'test' && h[2][1].lokalt === true, h.map((x) => x[0]).join(' '))
  ok('S skrevet av test-skriveren og merket «test» (V10), ikke regel', a.levels.S.by === 'test' && a.levels.S.text.startsWith('Test-ingress:') && sak.S_av === 'test' && sak.skriver.av === 'test' && sak.skriver.modell === 'ekko')
  ok('kort tekst: ingen M selv med modell', !a.levels.M)
  const lang = await lesInn(F.md, { prosjekt: 'Annet' })
  const la = load().find((x) => x.id === lang.id)
  ok('lang tekst med test-skriveren: S og M begge av «test», samme fil i annet prosjekt = egen sak', la.levels.S.by === 'test' && la.levels.M.by === 'test' && la.levels.M.text.startsWith('Test-sammendrag') && la.id !== mdId && la.project === 'Annet')
  ok('fortsatt ingen Utlevert: test-skriveren sender ingenting', UTLEVERT().length === 0 && !fs.existsSync(path.join(ROOT, '.tua', 'utlevering.jsonl')))
  process.env.TUA_SKRIVER = 'regel'
  // menneskeskrevet S overskrives aldri (V10) — også når fila leses inn på nytt med modell
  const atoms = load(); const m = atoms.find((x) => x.id === sak.id); m.levels.S = { text: 'Min egen ingress.', by: 'menneske', of: m.version }; save(atoms)
  process.env.TUA_SKRIVER = 'test'
  await lesInn(F.html, { prosjekt: 'Testprosjekt' })
  ok('menneskeskrevet S beholdes når fila leses inn igjen med modell (V10)', load().find((x) => x.id === sak.id).levels.S.text === 'Min egen ingress.')
  process.env.TUA_SKRIVER = 'regel'
}

// ── 6) Innboks ─────────────────────────────────────────────────────────────
{
  fs.mkdirSync(INBOX_DIR, { recursive: true })
  const inn = (navn, buf) => fs.writeFileSync(path.join(INBOX_DIR, navn), buf)
  inn('Rapport.pdf', fs.readFileSync(F.pdf)); inn('notat.txt', fs.readFileSync(F.txt)); inn('plan.md', fs.readFileSync(F.md)); inn('skannet.pdf', fs.readFileSync(F.utenTekst))
  inn('lenke.txt', Buffer.from('Se https://claude.ai/share/12345678-1234-1234-1234-123456789abc')); inn('eksport.zip', Buffer.from('ikke en ekte zip')); inn('.skjult.md', Buffer.from('x'))
  const sakIInnboks = await lesInn(F.csv, { prosjekt: STANDARD_PROSJEKT })      // en sak lest inn til «Innboks» ligger i samme mappe
  ok('en sak i prosjekt «Innboks» skrives til <arkiv>/Innboks/ og er en Tua-sak', fs.existsSync(path.join(INBOX_DIR, 'tabell.md')) && erTuaSak(path.join(INBOX_DIR, 'tabell.md')) && load().some((a) => a.id === sakIInnboks.id && a.project === 'Innboks'))
  ok('et løst .md-dokument i Innboks er IKKE en sak ennå (lastes ikke), lenkefila og zip-en er ikke dokumenter', !load().some((a) => a.name === 'plan') && !erTuaSak(path.join(INBOX_DIR, 'plan.md')))
  const før = innboksDokumenter()
  ok('innboksDokumenter: de fire dokumentene, sortert — ikke saken, ikke lenkefila, ikke zip, ikke skjulte', før.map((f) => f.navn).join(',') === 'notat.txt,plan.md,Rapport.pdf,skannet.pdf', før.map((f) => f.navn).join(','))
  const dry = await lesInnInnboks({ dryRun: true })
  ok('dry-run: tallene, ingenting flyttet eller skrevet', dry.dryRun && dry.tall.filer === 4 && dry.filer.every((f) => f.dryRun) && /dry-run/.test(dry.report) && innboksDokumenter().length === 4 && !fs.existsSync(path.join(INBOX_DIR, 'Ferdig')), JSON.stringify(dry.tall))
  const logg = []
  const r = await lesInnInnboks({ log: (m) => logg.push(m) })
  ok('kjøring: 3 lest inn, 1 feilet (PDF uten tekstlag), rapport med grunn', r.tall.lest === 3 && r.tall.feilet === 1 && r.filer.find((f) => f.navn === 'skannet.pdf')?.kode === 'ingen-tekst' && /OCR/.test(r.report) && /✓ Rapport\.pdf/.test(r.report), JSON.stringify(r.tall))
  ok('ferdige filer er flyttet til Innboks/Ferdig; den feilede har fått «(feilet)» i navnet og prøves ikke igjen', ['Rapport.pdf', 'notat.txt', 'plan.md'].every((n) => fs.existsSync(path.join(INBOX_DIR, 'Ferdig', n)) && !fs.existsSync(path.join(INBOX_DIR, n))) && fs.existsSync(path.join(INBOX_DIR, 'skannet (feilet).pdf')) && innboksDokumenter().length === 0, fs.readdirSync(INBOX_DIR).join(','))
  const alle = load()
  const rap = alle.find((a) => a.name === 'Rapport' && a.project === 'Innboks')
  ok('sakene ligger i prosjekt «Innboks» (V9: flytt fila i Finder), peker på fila i Ferdig, samtale Innboks', rap && rap.links[0].href === path.join(INBOX_DIR, 'Ferdig', 'Rapport.pdf') && rap.convo === 'Innboks' && fs.existsSync(path.join(INBOX_DIR, 'Rapport.md')), JSON.stringify(rap?.links))
  ok('plan.md ble sak med tittel fra overskriften og S/M etter regler', alle.some((a) => a.name === 'Plan for lageret' && a.project === 'Innboks' && a.levels.M?.by === 'regel'))
  ok('lenkefila og zip-en ligger urørt i Innboks (de er import.js sitt bord)', fs.existsSync(path.join(INBOX_DIR, 'lenke.txt')) && fs.existsSync(path.join(INBOX_DIR, 'eksport.zip')))
  ok('ny kjøring: ingenting å gjøre', (await lesInnInnboks({})).tall.filer === 0)
  ok('import-state noterer dokumentene', JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'import-state.json'), 'utf8')).dokumenter?.lest === 3)
  ok('fortsatt ingen Utlevert', UTLEVERT().length === 0)
}

// ── 7) broen ───────────────────────────────────────────────────────────────
const PORT = 5299
const DIST = path.join(DATA, 'dist'); fs.mkdirSync(DIST, { recursive: true }); fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''; bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const get = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, json: await r.json().catch(() => ({})) } }
const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})), ct: r.headers.get('content-type') || '' } }
const sse = (res) => res.text().then((t) => t.split('\n\n').map((b) => [b.match(/^event: (.+)$/m)?.[1], b.match(/^data: (.+)$/m)?.[1]]).filter(([e, d]) => e && d).map(([e, d]) => [e, JSON.parse(d)]))
const HJEM_TEST = path.join(os.homedir(), 'Library', 'Caches', 'tua-test-lesere')   // en fil INNE i hjemmemappa, til sti-testen; fjernes etterpå
try {
  const pr = await get('/api/prosjekter')
  ok('GET /api/prosjekter: Innboks, Testprosjekt og Annet', pr.status === 200 && ['Innboks', 'Testprosjekt', 'Annet'].every((p) => pr.json.prosjekter.includes(p)), JSON.stringify(pr.json))
  const ib = await get('/api/innboks')
  ok('GET /api/innboks: sti, 0 dokumenter, ferdig-tall, lenkefila, formater, prosjekter — aldri absolutte stier per fil', ib.status === 200 && ib.json.sti === INBOX_DIR && ib.json.antall === 0 && ib.json.ferdig === 3 && ib.json.lenker.includes('lenke.txt') && ib.json.formater.includes('PDF') && ib.json.standard === 'Innboks' && !JSON.stringify(ib.json.dokumenter).includes(ROOT), JSON.stringify(ib.json))
  // opplasting som rå kropp
  const r1 = await fetch(`http://127.0.0.1:${PORT}/api/les?navn=${encodeURIComponent('Møtenotat lager.pdf')}&prosjekt=Testprosjekt&samtale=Sp%C3%B8r`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(F.pdf) })
  const h1 = await sse(r1)
  const lest1 = h1.find((x) => x[0] === 'lest')?.[1], ferdig1 = h1.find((x) => x[0] === 'ferdig')?.[1]
  ok('POST /api/les (rå kropp): SSE leser → side per side (runde 2c) → lest → ferdig, saken i Testprosjekt med ord/tegn per nivå', r1.status === 200 && r1.headers.get('content-type').includes('text/event-stream') && h1.map((x) => x[0]).filter((x) => x !== 'side').join(' ') === 'leser lest ferdig' && h1.filter((x) => x[0] === 'side').map((x) => `${x[1].side}/${x[1].av}`).join(' ') === '1/2 2/2' && lest1.sider === 2 && ferdig1.project === 'Testprosjekt' && ferdig1.ord.L > 10 && ferdig1.S_av === 'regel' && ferdig1.convo === 'Innlest fra fil', h1.map((x) => x[0]).join(' '))   // samtalen beholdes: fila var alt lest inn til Testprosjekt
  ok('samme PDF som alt var lest inn til Testprosjekt → samme sak (uendret), ikke kopi', ferdig1.status === 'uendret' && load().filter((a) => a.name === 'Møtenotat lager' && a.project === 'Testprosjekt').length === 1)
  const r2 = await fetch(`http://127.0.0.1:${PORT}/api/les?navn=bilde.xyz`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x') })
  const h2 = await sse(r2)
  ok('POST /api/les med ukjent format → event feil med kode ukjent-format', h2.length === 2 && h2[1][0] === 'feil' && h2[1][1].kode === 'ukjent-format', JSON.stringify(h2.map((x) => x[0])))
  const r3 = await fetch(`http://127.0.0.1:${PORT}/api/les?navn=skannet.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(F.utenTekst) })
  const h3 = await sse(r3)
  ok('POST /api/les med PDF uten tekstlag → event feil ingen-tekst («OCR kommer»)', h3.at(-1)[0] === 'feil' && h3.at(-1)[1].kode === 'ingen-tekst' && /OCR/.test(h3.at(-1)[1].feil))
  ok('POST /api/les uten navn → 400; tom kropp → 400', (await fetch(`http://127.0.0.1:${PORT}/api/les`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x') })).status === 400 && (await fetch(`http://127.0.0.1:${PORT}/api/les?navn=a.txt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } })).status === 400)
  // sti på maskinen
  const ute = await post('/api/les', { sti: '/etc/hosts' })
  ok('POST /api/les {sti} utenfor hjemmemappa → 403, ingenting lest', ute.status === 403 && /hjemmemappa/.test(ute.json.error), JSON.stringify(ute.json))
  ok('POST /api/les {sti} i scratch (utenfor hjemmemappa) → 403; fil som ikke finnes → 404', (await post('/api/les', { sti: F.txt })).status === (F.txt.startsWith(os.homedir() + path.sep) ? 200 : 403) && (await post('/api/les', { sti: path.join(os.homedir(), 'finnes-ikke-' + Date.now() + '.txt') })).status === 404)
  ok('POST /api/les {} → 400', (await post('/api/les', {})).status === 400)
  fs.mkdirSync(HJEM_TEST, { recursive: true })
  const hjemFil = path.join(HJEM_TEST, 'notat i hjemmemappa.txt'); fs.writeFileSync(hjemFil, 'Et notat som ligger i hjemmemappa og leses inn via sti. Det blir en sak som peker hit.')
  const r4 = await fetch(`http://127.0.0.1:${PORT}/api/les`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sti: hjemFil, prosjekt: 'Testprosjekt' }) })
  const h4 = await sse(r4)
  const s4 = h4.at(-1)[1]
  ok('POST /api/les {sti} i hjemmemappa → SSE ferdig, saken peker på fila (ingen kopi)', r4.status === 200 && h4.at(-1)[0] === 'ferdig' && s4.links?.[0]?.href === fs.realpathSync(hjemFil) && s4.project === 'Testprosjekt', JSON.stringify(h4.map((x) => x[0])))
  ok('POST /api/les {sti} i arkivets .tua → 403', (await post('/api/les', { sti: path.join(ROOT, '.tua', 'index.json') })).status === (ROOT.startsWith(os.homedir() + path.sep) ? 403 : 403))
  // flytt
  const fl = await post('/api/flytt', { id: s4.id, prosjekt: 'Annet' })
  ok('POST /api/flytt: saken til et annet prosjekt, fila flyttet av lageret', fl.status === 200 && fl.json.atom.project === 'Annet' && fl.json.før === 'Testprosjekt' && fl.json.atom.file.includes(`${path.sep}Annet${path.sep}`) && fs.existsSync(fl.json.atom.file) && !fs.existsSync(path.join(ROOT, 'Testprosjekt', 'notat i hjemmemappa.md')), JSON.stringify(fl.json))
  ok('POST /api/flytt: ugyldig prosjekt → 400, ukjent sak → 404', (await post('/api/flytt', { id: s4.id, prosjekt: '.skjult' })).status === 400 && (await post('/api/flytt', { id: 'a_finnes_ikke', prosjekt: 'X' })).status === 404)
  // innboks-kjøring gjennom broen
  fs.writeFileSync(path.join(INBOX_DIR, 'brev.docx'), fs.readFileSync(F.docx))
  const ib2 = await get('/api/innboks')
  ok('GET /api/innboks ser det nye dokumentet', ib2.json.antall === 1 && ib2.json.dokumenter[0].navn === 'brev.docx' && ib2.json.dokumenter[0].label === 'Word (docx)')
  const d = await post('/api/innboks/kjør', { dryRun: true })
  ok('POST /api/innboks/kjør dryRun → tallene, ingenting flyttet', d.status === 200 && d.json.dryRun && d.json.tall.filer === 1 && fs.existsSync(path.join(INBOX_DIR, 'brev.docx')))
  const k = await post('/api/innboks/kjør', { prosjekt: 'Testprosjekt' })
  ok('POST /api/innboks/kjør → lest inn i valgt prosjekt, flyttet til Ferdig, uten absolutte stier i svaret', k.status === 200 && k.json.tall.lest === 1 && k.json.filer[0].project === 'Testprosjekt' && k.json.filer[0].name === 'Brev om lageret' && !k.json.filer[0].sti && fs.existsSync(path.join(INBOX_DIR, 'Ferdig', 'brev.docx')), JSON.stringify(k.json.tall))
  ok('POST /api/innboks/kjør med ugyldig prosjekt → 400', (await post('/api/innboks/kjør', { prosjekt: 'Ferdig' })).status === 400)
  const at = await get('/api/atoms')
  ok('GET /api/atoms: sakene i «Innboks» er med, med status og ord', at.json.atoms.some((a) => a.project === 'Innboks' && a.name === 'Rapport' && a.ord?.L > 0 && a.status === 'endelig'))
  const ut = await get('/api/utlevert')
  ok('GET /api/utlevert: tom — ingen innlesing var en utlevering', ut.json.total === 0)
} finally { bro.kill(); fs.rmSync(HJEM_TEST, { recursive: true, force: true }) }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
