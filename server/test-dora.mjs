#!/usr/bin/env node
// test-dora.mjs — Claude-døra gjennom motoren (runde 3a i arbeidsstykke 32, §5.7 og 03-avisen §5) mot et testarkiv i scratch, over ekte MCP (stdio)
// slik Claude kaller. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall, ALDRI en ekte nøkkel (Keychain-prefikset byttes ut).
//
//   TUA_FILES_ROOT=/tmp/tua-test-dora/arkiv TUA_DATA_DIR=/tmp/tua-test-dora/data TUA_HOME=/tmp/tua-test-dora/hjem node server/test-dora.mjs
//
// Sjekker: tua_get på Vault-sak gir S med én linje om hvorfor · tua_get på vanlig sak gir skjermet tekst (plassholdere, ingen originaler) og én
// Utlevert-linje med antall skjermet og tokens, uten originaler · tua_get med Trust under terskelen (TUA_TRUST_FILE) gir S + linje · tua_compose går gjennom
// motoren (skjermet tekst tilbake, originalene i leveransen, én Utlevert-linje med alle kildene) · tua_share lager delingssak med riktig nivå, Vault → S,
// forhåndsvis uten lagring/logg, Utlevert-linje · tua_search legger Spør-tråder øverst, holder fanget/drift utenfor, skjermer treffene, Siden sist ved første
// kall · kortet får sidenSist, instruksen og klippet-linja · SessionStart-hooken skriver Siden sist · dora.sidenSist/trådFørst holder drift utenfor.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const { load, save, upsert, deliveries, setStatus, registerProject } = await import('./store.js')
const dora = await import('./dora.js')
const motor = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${String(info).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`); if (!cond) feil++ }

// ── testarkiv ──────────────────────────────────────────────────────────────
const PERSON = 'Xenia Fjeldstad', EPOST = 'xenia.fjeldstad@example.no', ADRESSE = 'Industriveien 4'
const P = 'Testprosjekt'
const atoms = []
const vanlig = upsert(atoms, { content: `# Møtenotat\n\n${PERSON} (${EPOST}) foreslo å flytte lageret til ${ADRESSE}, 2000 Lillestrøm. Budsjett 45 000 kr.\n\n` + 'Lang tekst om lagerdrift. '.repeat(200), name: 'Møtenotat lager', project: P, convo: `Møte med ${PERSON}`, short: `Flytte lageret; ${PERSON} foreslo det.`, medium: `Sammendrag: ${PERSON} foreslo ${ADRESSE}; budsjett 45 000 kr.`, by: 'menneske', tags: ['lager'] }).atom
const vault = upsert(atoms, { content: 'Hemmelig avtale: betingelsene i Vault-saken, 1 200 000 kr til ' + PERSON + '.', name: 'Vault-sak', project: P, short: 'En Vault-merket sak om en avtale.', by: 'menneske', tags: ['vault'] }).atom
const kort = upsert(atoms, { content: 'Kort sak uten personopplysninger om lagerdrift.', name: 'Kort sak lager', project: P, by: 'menneske' }).atom
// Spør-tråd fra appen: prompt:spor: + svar + konklusjon (utkast)
const prompt = upsert(atoms, { key: 'prompt:spor:abc12345', kind: 'prompt', content: 'Hva bør vi gjøre med lageret?', name: 'Hva bør vi gjøre med lageret?', project: P, convo: 'Hva bør vi gjøre med lageret?', source: 'Tua', by: 'regel', tags: ['prompt'], short: 'Hva bør vi gjøre med lageret?' }).atom
const svar = upsert(atoms, { kind: 'svar', content: 'Svar: flytt lageret.', name: 'Svar fra Test: lageret', project: P, convo: prompt.convo, source: 'Test (ekko — sender ingenting)', by: 'regel', tags: ['svar', 'test'], derivedFrom: [{ id: prompt.id, version: 1, level: 'L' }, { id: vanlig.id, version: 1, level: 'S' }], short: 'Svar fra Test på «lageret».' }).atom
prompt.ga = [{ id: svar.id, version: 1 }]
const konk = upsert(atoms, { key: `konklusjon:${prompt.id}`, kind: 'konklusjon', content: 'Konklusjon: lageret flyttes.', name: 'Konklusjon: lageret', project: P, convo: prompt.convo, source: 'Test', by: 'regel', tags: ['konklusjon'], derivedFrom: [{ id: prompt.id, version: 1, level: 'L' }, { id: svar.id, version: 1, level: 'L' }], short: 'Utkast til konklusjon om lageret.' }).atom
setStatus(konk, 'utkast')
// fanget (hook) og innlest fil (Innboks)
const fanget = upsert(atoms, { key: 'svar:00000000:deadbeef', content: 'Fanget svar om lageret fra en Code-økt.', name: 'Svar om lageret (fanget)', project: P, source: 'Claude', by: 'regel', tags: ['svar', 'auto'], short: 'Fanget svar om lageret.', fanget: true }).atom
const innlest = upsert(atoms, { key: 'fil:sha:abc', content: 'Innlest dokument om lageret.', name: 'Lagerrapport 2026', project: P, source: 'pdf', by: 'regel', tags: ['fil', 'pdf'], short: 'Lagerrapport lest inn fra Innboks.' }).atom
// en sak i et annet prosjekt, synlig på S for Testprosjekt
const annen = upsert(atoms, { content: `Sak i Annet-prosjektet om lageret, nevner ${PERSON}. ` + 'Mer tekst. '.repeat(80), name: 'Annen sak lager', project: 'Annet', short: 'Ingressen til annen sak om lageret.', by: 'menneske' }).atom
annen.refs = [P]; annen.share = { [P]: 'S' }
save(atoms)
registerProject(P, { claudeProject: '11111111-2222-3333-4444-555555555555' })
ok('testarkiv skrevet', fs.existsSync(path.join(ROOT, P)) && atoms.length === 9, `${atoms.length} saker`)

const utlevert = () => deliveries(null, 1000)
const loggTekst = () => { try { return fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8') } catch { return '' } }
const ingenOriginaler = (t) => !t.includes(PERSON) && !t.includes(EPOST) && !t.includes(ADRESSE) && !t.includes('Fjeldstad')

// ── dora.js lokalt: Siden sist og tråd først holder fanget og drift utenfor ─
{
  const alle = load()
  const s = dora.sidenSist(alle, { prosjekt: P })
  ok('sidenSist: tråden fra Spør er med, én linje', s.tråder.length === 1 && /Spurt «Hva bør vi gjøre/.test(s.tråder[0].tekst) && /1 svar \(Test\)/.test(s.tråder[0].tekst) && /konklusjon utkast/.test(s.tråder[0].tekst), s.tråder[0]?.tekst)
  ok('sidenSist: innlest fil er med, fanget er ikke', s.innlest.length === 1 && !s.tekst.includes(fanget.id) && s.tekst.includes(innlest.id), s.tekst)
  ok('sidenSist: saker lagret med vilje telles (vanlig, vault, kort + annen som er synlig i prosjektet)', s.lagret === 4, `lagret=${s.lagret}`)
  const medDrift = alle.map((a) => (a.id === innlest.id ? { ...a, drift: true } : a))
  const s2 = dora.sidenSist(medDrift, { prosjekt: P })
  ok('sidenSist: drift: true holdes utenfor', s2.innlest.length === 0 && !s2.tekst.includes(innlest.id))
  ok('sidenSist: tomt prosjekt → ingenting nytt', !dora.sidenSist(alle, { prosjekt: 'Finnes ikke' }).noe)
  const { search } = await import('./store.js')
  const hits = dora.trådFørst(medDrift, search(medDrift, 'lageret', { limit: 25, fanget: 'med' }))
  ok('trådFørst: tråden først, som én linje, med medlemmene som traff', hits[0]?.tråd && hits[0].tråd.prompt === prompt.id && hits[0].tråd.traff.length >= 2 && hits.tråder === 1, hits[0]?.tråd?.traff.join(','))
  ok('trådFørst: drift: true er ute av treffene', !hits.some((h) => h.atom.id === innlest.id))
  ok('skalVise: første gang ja, så nei, nytt prosjekt ja', dora.skalVise('x') && !dora.skalVise('x') && dora.skalVise('y'))
  ok('instruksFor: prosjektet med Desktop-uuid gir teksten', /tua_search\(project="Testprosjekt"\)/.test(dora.instruksFor(P)?.tekst || '') && !dora.instruksFor('Annet'))
  // motor.lever direkte: Trust under terskelen → S med linje (fail closed, uten feil)
  const lv = motor.lever(alle, vanlig, { nivå: 'L', mottaker: { id: 'lav', label: 'Lav', endpoint: 'x', trust: { score: 2 } }, logg: false })
  ok('lever: Trust 2 og L → S med linje om hvorfor', lv.nivå === 'S' && /Trust Score 2\/5/.test(lv.linje) && /krever minst 4/.test(lv.linje), lv.linje)
  ok('lever: Trust 2 og M → S med linje (ikke M)', motor.lever(alle, vanlig, { nivå: 'M', mottaker: { id: 'lav', label: 'Lav', endpoint: 'x', trust: { score: 2 } }, logg: false }).nivå === 'S')
}

// ── MCP over stdio, som Claude ─────────────────────────────────────────────
const env = { ...process.env, TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test-dora' }
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, 'server.js')], cwd: HERE, env, stderr: 'pipe' })
const client = new Client({ name: 'tua-dora-test', version: '0.0.1' })
await client.connect(transport)
const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { r, text: (r.content || []).map((c) => c.text || '').join('\n') } }

const { tools } = await client.listTools()
ok('tua_share finnes i verktøylista (skriver, sletter ikke)', tools.some((t) => t.name === 'tua_share' && t.annotations?.readOnlyHint === false && t.annotations?.destructiveHint === false))
const instr = (await client.getServerVersion(), client.getInstructions?.() || '')
ok('ARKIV FØRST-instruksen sier skjermet og logget, Siden sist og del med', /SKJERMET og LOGGET/.test(instr) && /SIDEN SIST/.test(instr) && /DEL MED/.test(instr))

// 1) tua_get på Vault-sak: S + én linje
{
  const n0 = utlevert().length
  const { text } = await call('tua_get', { id: vault.id, level: 'L' })
  ok('tua_get Vault L → S', /Nivå: S/.test(text) && !/Hemmelig avtale/.test(text), text.match(/Nivå:.*/)?.[0])
  ok('tua_get Vault: én linje om hvorfor', /Vault-merket.*får bare S.*fail closed/.test(text))
  const d = utlevert().at(-1)
  ok('tua_get Vault: Utlevert-linja sier S og klippet L→S', utlevert().length === n0 + 1 && d.tool === 'tua_get' && d.level === 'S' && d.klippet === 'L→S' && d.mottaker === 'claude', JSON.stringify(d))
}
// 2) tua_get på vanlig sak: skjermet, ingen originaler, én Utlevert-linje uten originaler
{
  const n0 = utlevert().length
  const { text } = await call('tua_get', { id: vanlig.id, level: 'L' })
  ok('tua_get L: plassholdere i tekst, tittel-felt og S', /\[Person A\]/.test(text) && /\[E-post 1\]/.test(text) && /\[Adresse 1\]/.test(text) && /\[Beløp 1\]/.test(text), text.slice(0, 300))
  ok('tua_get L: ingen originaler i det Claude får', ingenOriginaler(text))
  ok('tua_get L: Utlevert-linja i svaret med antall skjermet og tokens', /Utlevert: L til Claude \(Anthropic\) · \d+ skjermet \(.*navn.*\) · ca\. \d+ tokens — logget/.test(text), text.match(/Utlevert: .*/)?.[0])
  const d = utlevert().at(-1)
  ok('tua_get L: én Utlevert-linje med mottaker, nivå, skjermet per type, ord og tokens', utlevert().length === n0 + 1 && d.tool === 'tua_get' && d.mottaker === 'claude' && d.endpoint === 'api.anthropic.com' && d.level === 'L' && d.skjermet?.navn >= 1 && d.skjermet?.epost === 1 && d.ord > 0 && d.tokens?.ca > 0 && d.saker?.[0]?.id === vanlig.id, JSON.stringify(d))
  ok('Utlevert-loggen inneholder ingen originaler', ingenOriginaler(loggTekst()))
  const m = await call('tua_get', { id: vanlig.id, level: 'M' })
  ok('tua_get M: sammendraget skjermet', /Nivå: M/.test(m.text) && /\[Person A\]/.test(m.text) && ingenOriginaler(m.text))
  const c = await call('tua_get', { id: annen.id, level: 'L', context: P })
  ok('tua_get med context: referansens nivå (S) klippes først som før', /Nivå: S/.test(c.text) && /ser dette bare på nivå S/.test(c.text) && ingenOriginaler(c.text), c.text.match(/Nivå:.*/)?.[0])
}
// 3) tua_compose gjennom motoren
{
  const n0 = utlevert().length
  const { text } = await call('tua_compose', { ids: [vanlig.id, vault.id, kort.id], name: 'Notat — test', level: 'M', key: 'lev:dora' })
  ok('tua_compose: bygget, Vault bare som S, teksten tilbake er skjermet', /bygget av 3 atomer på nivå M/.test(text) && /Vault-merket — tatt med bare som S/.test(text) && /\[Person A\]/.test(text) && ingenOriginaler(text.split('---')[1] || ''), text.slice(0, 200))
  ok('tua_compose: Utlevert-linja i svaret', /Utlevert: 3 kilder på M til Claude \(Anthropic\) · \d+ skjermet · ca\. \d+ tokens — logget/.test(text))
  const d = utlevert().at(-1)
  ok('tua_compose: ÉN Utlevert-linje med alle kildene, skjermet og tokens', utlevert().length === n0 + 1 && d.tool === 'tua_compose' && d.saker?.length === 3 && d.saker.find((s) => s.id === vault.id)?.level === 'S' && d.skjermet?.navn >= 1 && d.tokens?.ca > 0, JSON.stringify(d))
  const lev = load().find((a) => a.key === 'lev:dora')
  ok('tua_compose: leveransen i arkivet har originalene (lokal), bygget_av med nivåene', lev && lev.content.includes(PERSON) && lev.derivedFrom?.length === 3)
}
// 4) tua_share: delingssak gjennom motoren
{
  const n0 = utlevert().length, nAtoms = load().length
  const fv = await call('tua_share', { ids: [vanlig.id, vault.id], til: 'Revisor', level: 'M', forhåndsvis: true })
  ok('tua_share forhåndsvis: setningen, Vault → S-linja, ingenting lagret eller logget', /Forhåndsvisning/.test(fv.text) && /Revisor får M\/S av 2 saker, \d+ opplysninger skjermet/.test(fv.text) && /Vault-merket og deles bare som S/.test(fv.text) && /— ok\?/.test(fv.text) && utlevert().length === n0 && load().length === nAtoms, fv.text.slice(0, 200))
  const { text } = await call('tua_share', { ids: [vanlig.id, vault.id], til: 'Revisor', level: 'M' })
  const id = (text.match(/atom (a_[a-z0-9_]+)/) || [])[1]
  ok('tua_share: delingssak lagret med lenke og kopierbar tekst', id && /Delingssak lagret/.test(text) && text.includes(`tua://sak/${id}`) && /Kopierbar tekst til Revisor/.test(text), text.slice(0, 160))
  ok('tua_share: den kopierbare teksten er skjermet, uten originaler', ingenOriginaler(text) && /\[Person A\]/.test(text))
  const a = load().find((x) => x.id === id)
  ok('tua_share: delingssaken er leveranse med tag deling, bygget_av med riktig nivå (M for vanlig, S for Vault), skjermet innhold, lenke på saken', a && a.kind === 'leveranse' && a.tags.includes('deling') && a.derivedFrom.find((d) => d.id === vanlig.id)?.level === 'M' && a.derivedFrom.find((d) => d.id === vault.id)?.level === 'S' && ingenOriginaler(a.content) && a.content.includes('Delt med: Revisor') && (a.links || []).some((l) => l.href === `tua://sak/${id}`), a && JSON.stringify({ kind: a.kind, tags: a.tags, links: a.links }))
  const d = utlevert().at(-1)
  ok('tua_share: Utlevert-linje med mottakeren som tekst, sakene, skjermet, tokens og delingssaken', utlevert().length === n0 + 1 && d.tool === 'tua_share' && d.mottaker === 'Revisor' && d.saker?.length === 2 && d.deling === id && d.skjermet?.navn >= 1 && d.tokens?.ca > 0, JSON.stringify(d))
  const s = await call('tua_share', { ids: [kort.id], til: 'anna@firma.no' })
  const id2 = (s.text.match(/atom (a_[a-z0-9_]+)/) || [])[1]
  ok('tua_share: S som standard (V11), e-post som mottaker', id2 && /anna@firma.no får S av 1 sak/.test(s.text) && load().find((x) => x.id === id2)?.derivedFrom[0].level === 'S', s.text.slice(0, 120))
  const igjen = await call('tua_share', { ids: [kort.id], til: 'anna@firma.no' })
  ok('tua_share: samme deling igjen → samme sak (uendret), ny Utlevert-linje', (igjen.text.match(/atom (a_[a-z0-9_]+)/) || [])[1] === id2 && /uendret/.test(igjen.text))
  const f = await call('tua_share', { ids: ['a_finnes_ikke'], til: 'Revisor' })
  ok('tua_share: ukjent sak → tydelig feil, ingenting lagret', /ikke laget/.test(f.text))
}
// 5) kortet (treffliste) først i «samtalen»: Siden sist, instruksen, skjermet
let n0kort
{
  const l = await call('tua_card', { query: 'lager', project: P })
  const sc = l.r.structuredContent
  ok('tua_card(query): sidenSist i structuredContent og teksten ved første kall', sc?.sidenSist?.linjer?.some((x) => x.slag === 'tråd') && sc.sidenSist.linjer.some((x) => x.slag === 'innlest') && sc.sidenSist.linjer.some((x) => x.slag === 'deling') && /Siden sist i Tua/.test(l.text), JSON.stringify(sc?.sidenSist || {}).slice(0, 160))
  ok('tua_card(query): instruksen følger med når prosjektet har Desktop-uuid', sc?.instruks && /tua_search\(project="Testprosjekt"\)/.test(sc.instruks) && sc.instruksProsjekt === P)
  ok('tua_card(query): treffene skjermet, tråden merket, ingen originaler', sc?.items?.some((i) => i.thread) && ingenOriginaler(JSON.stringify(sc)) && ingenOriginaler(l.text))
  n0kort = utlevert().length
  ok('tua_card(query): søk logger ikke', true)
}
// 6) tua_search: tråder øverst, fanget/drift utenfor, skjermet, Siden sist ved første kall per prosjekt
{
  const { text } = await call('tua_search', { query: 'lageret', project: P, limit: 25 })
  ok('tua_search: ikke Siden sist igjen (kortet viste den alt i denne samtalen)', !/Siden sist i Tua/.test(text) && utlevert().length === n0kort)
  const first = text.split('\n\n').find((b) => /^1\. /.test(b)) || ''
  ok('tua_search: tråden fra Spør øverst som én linje', /1 tråd fra Spør øverst/.test(text) && /Tråd fra Spør i Tua: «Hva bør vi gjøre/.test(first) && /konklusjon utkast/.test(first), first)
  ok('tua_search: tråden står bare én gang (svar/konklusjon er ikke egne rader)', (text.match(/Tråd fra Spør i Tua/g) || []).length === 1 && !new RegExp(`^\\d+\\. \\[${konk.id}\\]`, 'm').test(text))
  ok('tua_search: fanget holdt utenfor, med tellelinje', !text.includes(fanget.id) && /1 fanget sak holdt utenfor/.test(text))
  ok('tua_search: treffene er skjermet (tittel, samtale, S), ingen originaler', ingenOriginaler(text) && /Skjermet: \d+ opplysning/.test(text), text.match(/Skjermet:.*/)?.[0])
  const alle = await call('tua_search', { query: 'lageret' })
  ok('tua_search uten prosjekt: «Siden sist i Tua» for alle prosjekter ved første kall, med tråd, deling og innlest fil', /Siden sist i Tua \(7 dager, alle prosjekter\):/.test(alle.text) && /Spurt «Hva bør vi gjøre/.test(alle.text) && /Delt med Revisor/.test(alle.text) && /Lest inn «Lagerrapport 2026»/.test(alle.text), alle.text.match(/Siden sist[^]*$/)?.[0])
  ok('tua_search: søk logger ikke (S er fri)', utlevert().length === n0kort)
  const tom = await call('tua_search', { query: 'finnesikkeord', project: 'Annet' })
  ok('tua_search uten treff: Siden sist likevel (nytt prosjekt, bare én sak lagret)', /Ingen treff/.test(tom.text) && /Siden sist i Tua \(7 dager, Annet\):\n- 1 sak lagret med vilje/.test(tom.text), tom.text)
  const tom2 = await call('tua_search', { query: 'finnesikkeord', project: 'Finnes ikke' })
  ok('tua_search uten treff i tomt prosjekt: «ingenting nytt»', /Siden sist i Tua \(7 dager, Finnes ikke\): ingenting nytt/.test(tom2.text), tom2.text)
}
// 7) kortet for én sak: klippet-linja, skjermet
{
  const n0 = utlevert().length
  const v = await call('tua_card', { id: vault.id, level: 'L' })
  const a = v.r.structuredContent?.atom
  ok('tua_card(Vault, L): S, klippet-linja, logget', a?.level === 'S' && /Vault-merket/.test(a.clipped) && utlevert().length === n0 + 1 && utlevert().at(-1).tool === 'tua_card', a?.clipped)
  const s = await call('tua_card', { id: vanlig.id })
  const b = s.r.structuredContent?.atom
  ok('tua_card(S): skjermet navn og S, instruksen på kortet, S logges ikke', b && b.name === 'Møtenotat lager' && /\[Person A\]/.test(b.S) && /\[Person A\]/.test(b.convo) && b.instruks && utlevert().length === n0 + 1, JSON.stringify({ S: b?.S, convo: b?.convo }))
}
// 8) tua_setup uten argumenter tilbyr instruksen
{
  const { text } = await call('tua_setup', {})
  ok('tua_setup: «kopier instruksen» med Desktop-uuid og teksten', /kopier instruksen: prosjektet «Testprosjekt»/.test(text) && /Spør Tua først/.test(text), text.match(/kopier instruksen[^\n]*/)?.[0])
}
await client.close()

// 9) SessionStart-hooken i Code: én linje «Siden sist i Tua»
{
  const repo = path.join(HJEM, 'repo'); fs.mkdirSync(repo, { recursive: true })
  fs.writeFileSync(path.join(repo, '.tua-sync.json'), JSON.stringify({ project: P }))
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), 'start'], { input: JSON.stringify({ cwd: repo, session_id: 'dora0001', hook_event_name: 'SessionStart' }), env: { ...process.env, TUA_CODE_HOME: path.join(HJEM, 'code-tom'), TUA_COWORK_ROOT: path.join(HJEM, 'cowork-tom') }, encoding: 'utf8' })
  ok('hook start: skriver Siden sist i Tua for prosjektet, én linje', r.status === 0 && /Siden sist i Tua \(7 dager, Testprosjekt\): /.test(r.stdout) && /Spurt «Hva bør vi gjøre/.test(r.stdout) && /Lest inn «Lagerrapport 2026»/.test(r.stdout) && /Delt med Revisor/.test(r.stdout) && r.stdout.trim().split('\n').length === 1 && ingenOriginaler(r.stdout), r.stdout.match(/Siden sist[^]*/)?.[0].slice(0, 200) || r.stderr.slice(0, 200))
}

console.log(feil ? `\n${feil} feil` : '\nalle grønne')
process.exit(feil ? 1 : 0)
