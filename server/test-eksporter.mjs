#!/usr/bin/env node
// test-eksporter.mjs — eksporter leses der de lander, og leserne for Gemini og Copilot (arbeidsstykke 36 del 2, grep 3 og 4 · 0.5.19).
// ALDRI mot det ekte arkivet og ALDRI Eriks ekte Nedlastinger: alt pekes til en egen midlertidig mappe (TUA_NEDLASTINGER).
// Eksportfilene her er laget etter beskrivelsene av formatene — ingen av dem er en ekte eksport.
//
//   node server/test-eksporter.mjs
//
// Sjekker: grep 4  Gemini «Min aktivitet»-JSON (rader → samtaler på tid, HTML-svar → tekst, rader som ikke er spørsmål hoppes over), Gemini i
//                  «conversations»-form, Copilot-CSV (anførselstegn, linjeskift i felt, semikolon, norsk og amerikansk dato), en vanlig CSV er IKKE Copilot
//          grep 3  gjenkjenning i Nedlastinger (Takeout-zip, Takeout som HTML, ChatGPT-zip, Copilot-csv, utpakket mappe; andre filer røres ikke),
//                  dry-run skriver ingenting, lesing gir saker med riktig kilde og prosjekt, filene ligger urørt, andre runde leser ingenting,
//                  en endret fil leses på nytt, Innboks tar Copilot-csv som samtaler (ikke som dokument), veiviseren og tua_import(kilde=eksport) over MCP

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-eksporter-'))
const HJEM = path.join(S, 'home'), ROOT = path.join(S, 'arkiv'), NED = path.join(S, 'Nedlastinger'), LAG = path.join(S, 'lag')
for (const d of [HJEM, ROOT, NED, LAG, path.join(S, 'data'), path.join(S, 'tom'), path.join(HJEM, '.tua')]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [path.join(S, 'tom')] } }) + '\n')
Object.assign(process.env, { TUA_FILES_ROOT: ROOT, TUA_DATA_DIR: path.join(S, 'data'), TUA_HOME: HJEM, TUA_NEDLASTINGER: NED, TUA_CODE_HOME: path.join(S, 'tom'), TUA_COWORK_ROOT: path.join(S, 'tom'), TUA_CODEX_HOME: path.join(S, 'tom'), TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test' })
delete process.env.TUA_HISTORIKK_AUTO

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const gammel = (p, min = 5) => { const d = new Date(Date.now() - min * 60000); fs.utimesSync(p, d, d); return p }
const zip = (navn, filer) => {                                              // filer: { 'sti/i/zip': innhold }
  const rot = fs.mkdtempSync(path.join(LAG, 'z-'))
  for (const [rel, innhold] of Object.entries(filer)) { fs.mkdirSync(path.dirname(path.join(rot, rel)), { recursive: true }); fs.writeFileSync(path.join(rot, rel), innhold) }
  const ut = path.join(NED, navn)
  const r = spawnSync('zip', ['-q', '-r', ut, '.'], { cwd: rot, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`zip feilet: ${r.stderr || r.error?.message}`)
  return gammel(ut)
}
const lang = (om) => `Her er en grundig gjennomgang av ${om}. ` + `Det viktigste med ${om} er rekkefølgen, ansvaret og fristene, og hvem som følger opp neste kvartal. `.repeat(18)

const { htmlTilTekst, parseGemini, erGeminiJson, lesCsv, erCopilotCsv, parseCopilotCsv } = await import('./lesere-ai.js')
const store = await import('./store.js')
const eks = await import('./eksporter.js')
const imp = await import('./import.js')

// ── grep 4: leserne ─────────────────────────────────────────────────────────
const AKTIVITET = [
  { header: 'Gemini Apps', title: 'Prompted Hvordan legger jeg opp en vedlikeholdsplan for hytta, med budsjett og ansvar for hvert tiltak?', time: '2026-11-03T09:00:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: `<p>${lang('vedlikeholdsplanen')}</p><ul><li>Beise terrassen</li><li>Male vindskier &amp; gerikter</li></ul>` }] },
  { header: 'Gemini Apps', title: 'Prompted Kan du sette opp et budsjett for tiltakene, fordelt på vår og sommer, i en enkel liste?', time: '2026-11-03T09:04:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: `<p>${lang('budsjettet')}</p>` }] },
  { header: 'Gemini Apps', title: 'Used Gemini Apps', time: '2026-11-03T09:05:00.000Z', products: ['Gemini Apps'] },
  { header: 'Gemini Apps', title: 'Prompted Skriv et utkast til invitasjon til dugnaden i borettslaget, med dato, oppmøtested og hva folk bør ta med.', time: '2026-11-03T13:30:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: `<p>${lang('dugnaden')}</p>` }] },
  { header: 'Søk', title: 'Søkte etter hyttemaling', time: '2026-11-03T10:00:00.000Z', products: ['Search'] },
]
{
  ok('htmlTilTekst: avsnitt, lister og entiteter', htmlTilTekst('<p>Hei &amp; hå</p><ul><li>En</li><li>To</li></ul>') === 'Hei & hå\n\n- En\n- To')
  const f = path.join(LAG, 'MyActivity.json'); fs.writeFileSync(f, JSON.stringify(AKTIVITET))
  const g = parseGemini(f)
  ok('Gemini «Min aktivitet»: 3 spørsmål → 2 samtaler på tid; «Used Gemini Apps» og Søk hoppes over', erGeminiJson(f) && g.convs.length === 2 && g.convs[0].pairs.length === 2 && g.convs[1].pairs.length === 1, g.convs.map((c) => `${c.title} (${c.messages})`).join(' | '))
  ok('Gemini: «Prompted» er strippet, svaret er tekst (ikke HTML), kilde og tid stemmer', g.convs[0].firstUser.startsWith('Hvordan legger jeg') && /- Beise terrassen/.test(g.convs[0].transcript) && !/<p>/.test(g.convs[0].transcript) && g.convs[0].source === 'Gemini' && g.convs[0].created === Date.parse('2026-11-03T09:00:00.000Z'))
  ok('Gemini: samme fil gir samme id-er (idempotent)', parseGemini(f).convs.map((c) => c.id).join() === g.convs.map((c) => c.id).join() && /^gemini:[0-9a-f]{8}$/.test(g.convs[0].id))
  const f2 = path.join(LAG, 'gemini-samtaler.json'); fs.writeFileSync(f2, JSON.stringify({ conversations: [{ id: 'c1', title: 'Reiseplan', createdTime: '2026-10-01T08:00:00Z', lastModifiedTime: '2026-10-01T08:10:00Z', messages: [{ role: 'user', text: 'Lag en reiseplan for tre dager i Bergen.' }, { role: 'model', text: lang('reiseplanen') }] }] }))
  const g2 = parseGemini(f2)
  ok('Gemini i «conversations»-form leses også', erGeminiJson(f2) && g2.convs.length === 1 && g2.convs[0].id === 'gemini:c1' && g2.convs[0].title === 'Reiseplan' && g2.convs[0].pairs[0].answers.length === 1)
  ok('en vanlig json-fil er ikke Gemini', (() => { const p = path.join(LAG, 'annet.json'); fs.writeFileSync(p, JSON.stringify({ header: 'x', a: [1, 2] })); return !erGeminiJson(p) })())

  ok('lesCsv: anførselstegn, doble anførselstegn og linjeskift i felt', JSON.stringify(lesCsv('a,b\n"en, to","sa ""hei""\nny linje"\n')) === JSON.stringify([['a', 'b'], ['en, to', 'sa "hei"\nny linje']]))
  const c1 = path.join(LAG, 'copilot-activity-history.csv')
  fs.writeFileSync(c1, '﻿Date,Time,Type,Content,Source\n' + [
    ['11/3/2026', '2:05 PM', 'Response', `"${lang('lagerflyttingen')}"`, 'Copilot'],
    ['11/3/2026', '2:05 PM', 'Prompt', '"Hva bør vi tenke på før lagerflyttingen, og hvem bør ha ansvaret for hva?"', 'Copilot'],
    ['11/2/2026', '9:00 AM', 'Prompt', '"Skriv en kort e-post til styret om budsjettet,\nmed tre punkter."', 'Copilot'],
    ['11/2/2026', '9:01 AM', 'Response', `"${lang('budsjettet til styret')}"`, 'Copilot'],
  ].map((r) => r.join(',')).join('\n') + '\n')
  const c = parseCopilotCsv(c1)
  ok('Copilot-CSV: 4 rader → 2 samtaler i tidsrekkefølge, spørsmål før svar på samme minutt', erCopilotCsv(c1) && c.convs.length === 2 && c.convs[0].firstUser.startsWith('Skriv en kort e-post') && c.convs[1].firstUser.startsWith('Hva bør vi tenke på') && c.convs[1].pairs[0].answers.length === 1, c.convs.map((x) => x.title).join(' | '))
  ok('Copilot: amerikansk dato med PM leses riktig, linjeskift i spørsmålet er med', new Date(c.convs[1].created).getHours() === 14 && new Date(c.convs[1].created).getMonth() === 10 && new Date(c.convs[1].created).getDate() === 3 && /budsjettet,\nmed tre punkter/.test(c.convs[0].firstUser))
  const c2 = path.join(LAG, 'copilot-norsk.csv')
  fs.writeFileSync(c2, 'Dato;Tid;Type;Innhold\n03.11.2026;14:05;Prompt;"Hva er status; og hva gjenstår i prosjektet?"\n03.11.2026;14:06;Response;"Status er god."\n')
  const cn = parseCopilotCsv(c2)
  ok('Copilot: semikolon, norske kolonnenavn og norsk dato', erCopilotCsv(c2) && cn.convs.length === 1 && new Date(cn.convs[0].created).getDate() === 3 && new Date(cn.convs[0].created).getMonth() === 10 && cn.convs[0].firstUser.includes('status; og hva'))
  const vanlig = path.join(LAG, 'regnskap.csv'); fs.writeFileSync(vanlig, 'Dato,Type,Beløp,Tekst\n2026-11-01,Faktura,1200,Maling\n2026-11-02,Kvittering,300,Pensler\n')
  ok('en vanlig CSV (regnskap) er ikke en Copilot-eksport', !erCopilotCsv(vanlig))
}

// ── grep 3: Nedlastinger ────────────────────────────────────────────────────
const CHATGPT = [{ id: 'cg-1', title: 'Styrepapirer', create_time: 1793000000, update_time: 1793000600, current_node: 'b', mapping: {
  a: { id: 'a', parent: null, children: ['b'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Kan du lage en disposisjon for styrepapirene til møtet i desember, med saksliste og vedlegg?'] }, create_time: 1793000000 } },
  b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [lang('styrepapirene')] }, create_time: 1793000600 } },
} }]
const takeout = zip('takeout-20261120T101010Z-001.zip', { 'Takeout/My Activity/Gemini Apps/MyActivity.json': JSON.stringify(AKTIVITET), 'Takeout/archive_browser.html': '<html></html>' })
const takeoutHtml = zip('takeout-20261121T101010Z-001.zip', { 'Takeout/My Activity/Gemini Apps/MyActivity.html': '<html>…</html>' })
const chatgpt = zip('3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c-2026-11-20-10-15-00.zip', { 'conversations.json': JSON.stringify(CHATGPT), 'user.json': '{"id":"u"}', 'chat.html': '<html></html>', 'message_feedback.json': '[]' })
const annenZip = zip('feriebilder.zip', { 'bilder/liste.json': '["a.jpg"]', 'les-meg.txt': 'bilder' })
const copilot = path.join(NED, 'copilot-activity-history.csv'); fs.copyFileSync(path.join(LAG, 'copilot-activity-history.csv'), copilot); gammel(copilot)
const regnskap = path.join(NED, 'regnskap.csv'); fs.copyFileSync(path.join(LAG, 'regnskap.csv'), regnskap); gammel(regnskap)
fs.writeFileSync(path.join(NED, 'halvferdig.zip.crdownload'), 'x'); gammel(path.join(NED, 'halvferdig.zip.crdownload'))
const mappe = path.join(NED, 'chatgpt-utpakket'); fs.mkdirSync(mappe); fs.writeFileSync(path.join(mappe, 'conversations.json'), JSON.stringify([{ ...CHATGPT[0], id: 'cg-2', title: 'Utpakket av Safari' }])); gammel(mappe)
const før = Object.fromEntries(fs.readdirSync(NED).map((n) => [n, fs.statSync(path.join(NED, n)).size]))
{
  ok('kjennIgjen: Takeout-zip med Gemini som JSON', eks.kjennIgjen(takeout)?.slag === 'gemini' && !eks.kjennIgjen(takeout).uleselig)
  ok('kjennIgjen: Takeout som HTML kjennes igjen, men kan ikke leses — med beskjed om å velge JSON', eks.kjennIgjen(takeoutHtml)?.slag === 'gemini' && /JSON/.test(eks.kjennIgjen(takeoutHtml).uleselig || ''))
  ok('kjennIgjen: ChatGPT-zip på innholdslista (navnet er bare en hash)', eks.kjennIgjen(chatgpt)?.slag === 'chatgpt')
  ok('kjennIgjen: Copilot-csv, og en mappe Safari har pakket ut', eks.kjennIgjen(copilot)?.slag === 'copilot' && eks.kjennIgjen(mappe)?.slag === 'chatgpt')
  ok('kjennIgjen: andre filer er ikke eksporter (feriebilder.zip, regnskap.csv, en nedlasting som ikke er ferdig)', !eks.kjennIgjen(annenZip) && !eks.kjennIgjen(regnskap) && !eks.kjennIgjen(path.join(NED, 'halvferdig.zip.crdownload')))
  ok('kjennIgjen: Claudes kategori-zip på filnavnet', eks.kjennIgjen(zip('conversations-000.zip', { 'conversations.json': '[]' }))?.slag === 'claude')
  fs.rmSync(path.join(NED, 'conversations-000.zip'))

  const funnet = eks.finnEksporter()
  ok('finnEksporter: fem eksporter, ingen lest ennå', funnet.length === 5 && funnet.every((e) => !e.lest), funnet.map((e) => `${e.navn} → ${e.slag}`).join(' · '))
  const tørr = eks.lesNedlastinger({ dryRun: true })
  ok('dry-run: sier hva som ligger der og skriver ingenting', tørr.lest.length === 4 && /dry-run/.test(tørr.report) && store.load().filter((a) => a.kind === 'samtale').length === 0 && eks.finnEksporter().every((e) => !e.lest), tørr.report.split('\n').filter((l) => l.startsWith('- ')).join(' '))

  const r = eks.lesNedlastinger({})
  const atoms = store.load()
  const sam = (kilde) => atoms.filter((a) => a.kind === 'samtale' && a.source === kilde)
  ok('lesing: Gemini 2, Copilot 2 og ChatGPT 2 samtaler (zip + utpakket mappe), HTML-Takeout står som uleselig', sam('Gemini').length === 2 && sam('Copilot').length === 2 && sam('ChatGPT').length === 2 && /✗ takeout-20261121/.test(r.report), `${sam('Gemini').length}/${sam('Copilot').length}/${sam('ChatGPT').length} · ${r.nye} nye`)
  ok('prosjektene: «Gemini-samtaler», «Copilot-samtaler», «ChatGPT-samtaler»; spørsmålene er egne saker; samtalene er «fanget»', sam('Gemini').every((a) => a.project === 'Gemini-samtaler' && a.fanget) && sam('Copilot').every((a) => a.project === 'Copilot-samtaler') && sam('ChatGPT').every((a) => a.project === 'ChatGPT-samtaler') && atoms.filter((a) => a.kind === 'prompt' && a.source === 'Gemini').length === 3)
  ok('rapporten sier forbeholdene (gruppert på tid; Microsoft avkorter)', atoms.some((a) => /Import: takeout-/.test(a.name) && /gruppert på tid/.test(a.content)) && atoms.some((a) => /Import: copilot-activity/.test(a.name) && /avkorter/.test(a.content)))
  const etter = Object.fromEntries(fs.readdirSync(NED).map((n) => [n, fs.statSync(path.join(NED, n)).size]))
  ok('filene ligger urørt i Nedlastinger — ingenting flyttet, slettet eller endret', JSON.stringify(før) === JSON.stringify(etter))
  const r2 = eks.lesNedlastinger({})
  ok('andre runde leser ingenting (hver fil leses én gang)', r2.lest.length === 0 && eks.ulesteEksporter().length === 0 && /Lest før/.test(r2.report))
  fs.writeFileSync(copilot, fs.readFileSync(copilot, 'utf8') + `11/4/2026,8:00 AM,Prompt,"Lag en sjekkliste for vinterstenging av hytta, med vann, strøm og forsikring i riktig rekkefølge."\n11/4/2026,8:01 AM,Response,"${lang('vinterstengingen')}"\n`); gammel(copilot, 2)
  const r3 = eks.lesNedlastinger({})
  ok('en eksport som er lastet ned på nytt (endret fil) leses igjen — bare det nye blir nytt', r3.lest.length === 1 && r3.lest[0].stats.nye === 1 && store.load().filter((a) => a.kind === 'samtale' && a.source === 'Copilot').length === 3, JSON.stringify(r3.lest.map((e) => [e.navn, e.stats.nye])))
  ok('veiviseren har lenke til de fire bestillingssidene og sier at fila bare skal lastes ned', ['claude.ai/settings', 'chatgpt.com', 'takeout.google.com', 'account.microsoft.com/privacy'].every((u) => eks.eksportVeiviser().includes(u)) && /JSON/.test(eks.eksportVeiviser()) && eks.eksportVeiviser().includes(NED))
}

// ── Innboks: en Copilot-csv er samtaler, ikke et dokument ───────────────────
{
  const { innboksDokumenter } = await import('./innlesing.js')
  const inn = path.join(ROOT, 'Innboks'); fs.mkdirSync(inn, { recursive: true })
  fs.writeFileSync(path.join(inn, 'copilot-fra-jobb.csv'), 'Date,Time,Type,Content,Source\n11/10/2026,10:00 AM,Prompt,"Oppsummer møtet med leverandøren og foreslå tre oppfølgingspunkter til neste uke."\n11/10/2026,10:01 AM,Response,"' + lang('leverandørmøtet') + '"\n')
  fs.copyFileSync(path.join(LAG, 'regnskap.csv'), path.join(inn, 'regnskap.csv'))
  for (const n of fs.readdirSync(inn)) if (!n.startsWith('.') && n !== 'Ferdig') gammel(path.join(inn, n))
  const dok = innboksDokumenter().map((d) => d.navn)
  ok('Innboks: Copilot-csv er ikke et dokument, regnskapet er det', !dok.includes('copilot-fra-jobb.csv') && dok.includes('regnskap.csv'), dok.join(', '))
  const d = imp.processInbox({})
  ok('Innboks: Copilot-csv blir samtaler og flyttes til Ferdig (som andre eksporter)', d.length === 1 && d[0].kind === 'copilot' && d[0].stats.nye === 1 && fs.existsSync(path.join(inn, 'Ferdig', 'copilot-fra-jobb.csv')) && fs.existsSync(path.join(inn, 'regnskap.csv')), JSON.stringify(d.map((x) => [x.name, x.kind, x.stats?.nye])))
}

// ── over MCP: tua_import(kilde=eksport) ─────────────────────────────────────
{
  const tom = path.join(S, 'Nedlastinger-tom'); fs.mkdirSync(tom)
  const kjør = async (ned, fn) => {
    const env = { ...process.env, TUA_NEDLASTINGER: ned }
    const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.TUA_TEST_INNGANG ? path.resolve(process.env.TUA_TEST_INNGANG) : path.join(HERE, 'server.js')], cwd: HERE, env, stderr: 'pipe' })
    const c = new Client({ name: 'tua-eksporter-test', version: '0.0.1' }); await c.connect(transport)
    try { return await fn((args) => c.callTool({ name: 'tua_import', arguments: args }).then((r) => r.content[0].text)) } finally { await c.close() }
  }
  await kjør(tom, async (imp2) => {
    const v = await imp2({ kilde: 'eksport' })
    ok('tua_import(kilde=eksport) uten filer: veiviseren med lenkene', /Fant ingen eksport/.test(v) && /takeout\.google\.com/.test(v) && /chatgpt\.com/.test(v))
  })
  await kjør(NED, async (imp2) => {
    const v = await imp2({ kilde: 'eksport', dryRun: true })
    ok('tua_import(kilde=eksport) med filer: rapporten, og det som er lest før står som lest', /Eksporter i Nedlastinger/.test(v) && /Lest før/.test(v) && /5 eksporter kjent igjen/.test(v), v.split('\n')[2])
  })
}

fs.rmSync(S, { recursive: true, force: true })
console.log(feil ? `\n${feil} feil` : '\nAlt grønt')
process.exit(feil ? 1 : 0)
