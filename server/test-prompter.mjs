#!/usr/bin/env node
// test-prompter.mjs — prompter som førsteklasses saker (M19, V16) og onboardingen i appen (M14) — skive 8 i arbeidsstykke 31.
// ALDRI mot ~/Dropbox/Tua, ALDRI Eriks ekte ~/.claude/projects (et lite falskt tre lages i scratch og TUA_CODE_HOME pekes dit), ALDRI et ekte modellkall
// (test-mottakerne ekkoer; TUA_VURDERER=test; TUA_SKRIVER=regel).
//
//   TUA_FILES_ROOT=/tmp/tua-test-prompter/arkiv TUA_DATA_DIR=/tmp/tua-test-prompter/data TUA_HOME=/tmp/tua-test-prompter/home node server/test-prompter.mjs
//
// Sjekker: worthKeeping/firstSentence/promptKey · importCode dry-run teller prompter uten å skrive · ekte import gir prompt-saker med riktig nøkkel, S,
// prosjekt, tagg, ingen synlig_i, ga ↔ bygget_av begge veier, tidsstempel fra meldingen · korte prompter og kommandoer hoppes over · idempotent (igjen = uendret,
// ingen ny versjon) · importParsed (Desktop/eksport-form) gir prompt + svar fra pairs · hooken: prompt-modus (stum), svar-modus lagrer prompten også når svaret
// er kort, kobler svar ↔ prompt, og importen etterpå sier «uendret» (én hash) · «Kjør igjen» gjennom motoren: samme prompt-sak, ga vokser, versjon bare når
// teksten endres; samme spørsmål to ganger fra Spør = én sak; eldre prompt uten nøkkel får nøkkel · datasettet (én linje per konklusjon, bare id-er og
// prompt/konklusjon-tekst) · broen: /api/search?kind=prompt med tekst/ga/modeller, /api/spor med prompt, /api/datasett.jsonl, /api/onboarding GET/POST
// (også uten arkiv: needsChoice → velg «lokalt» → arkivet lages), /api/import som SSE (dry-run og ekte).
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '2'
process.env.TUA_VURDERER = 'test'
process.env.TUA_SKRIVER = 'regel'

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
const SCRATCH = path.dirname(ROOT)
const CODE_HOME = path.join(SCRATCH, 'code-home'), COWORK = path.join(SCRATCH, 'cowork-tom'), FINDER_TOM = path.join(SCRATCH, 'finder-tom')
for (const d of [ROOT, DATA, HJEM, CODE_HOME, COWORK, FINDER_TOM, path.join(SCRATCH, 'onb-home'), path.join(SCRATCH, 'onb-data')]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODE_HOME = CODE_HOME
process.env.TUA_COWORK_ROOT = COWORK
// Finder-connectoren skal aldri lese Eriks ekte Nedlastinger i en test: pek den på en tom mappe via samme config som appen bruker
fs.mkdirSync(path.join(HJEM, '.tua'), { recursive: true }); fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [FINDER_TOM] } }) + '\n')

const store = await import('./store.js')
const { load, save, upsert, statusOf, hashOf, sha8 } = store
const imp = await import('./import.js')
const { importCode, importParsed, worthKeeping, firstSentence, promptKey, promptTitle, parseCodeSession, countPrompts, PROMPT_MIN, MIN_SVAR } = imp
const { spor } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))

// ── et lite falskt ~/.claude/projects-tre ───────────────────────────────────
const P1 = 'Kan du skrive et sammendrag av møtenotatet om lagerflytting og foreslå tre tiltak for neste kvartal? Ta med budsjettet.'
const P2 = 'Lag en liste over alle leverandørene som ble nevnt i notatet, med hva hver av dem leverer og hvem som er kontaktperson hos oss.'
const P3 = 'Skriv et utkast til e-post til styret om flyttingen av lageret: hva som er bestemt, hva det koster og når det skjer.'
const A1 = ('# Sammendrag av møtenotatet\n\n' + 'Lageret flyttes til Industriveien 4 i løpet av neste kvartal, og budsjettet er 45 000 kroner. '.repeat(40)).trim()
const SID = 'sess-1111-2222-3333-4444'
const T0 = Date.parse('2026-10-20T10:00:00+02:00')
const linje = (type, content, i, extra = {}) => JSON.stringify({ type, message: { role: type, content }, cwd: '/Users/test/Prosjekt', sessionId: SID, timestamp: new Date(T0 + i * 60000).toISOString(), ...extra })
const transkript = [
  linje('user', [{ type: 'text', text: P1 }], 0),
  linje('assistant', [{ type: 'text', text: A1 }], 1),
  linje('user', [{ type: 'text', text: 'ja' }], 2),                                                        // bekreftelse — hoppes over
  linje('assistant', [{ type: 'text', text: 'Greit, gjort.' }], 3),
  linje('user', [{ type: 'tool_result', tool_use_id: 'x', content: 'verktøyresultat' }], 4),                // ikke en prompt
  linje('user', [{ type: 'text', text: '/tua_card brygge og noe mer tekst som gjør linja lang nok til å passere lengdekravet' }], 5),   // kommando — hoppes over
  linje('user', [{ type: 'text', text: `<system-reminder>noe systemet la til</system-reminder>\n${P2}` }], 6),   // påminnelsen strippes
  linje('assistant', [{ type: 'text', text: 'Her er en kort liste.' }], 7),                                 // kort svar → ingen svar-sak, prompten står uten ga
].join('\n') + '\n'
const PROSJEKTDIR = path.join(CODE_HOME, '.claude', 'projects', '-Users-test-Prosjekt')
fs.mkdirSync(PROSJEKTDIR, { recursive: true })
fs.writeFileSync(path.join(PROSJEKTDIR, `${SID}.jsonl`), transkript)

// ── 1) reglene ──────────────────────────────────────────────────────────────
{
  ok('worthKeeping: «ja», «fortsett!», «commit og push» og en slash-kommando hoppes over', !worthKeeping('ja') && !worthKeeping('fortsett!') && !worthKeeping('commit og push') && !worthKeeping('/tua_card brygge ' + 'x'.repeat(100)))
  const setning = (n) => ('Skriv et notat om lageret og budsjettet for neste kvartal, med tiltak og ansvar. ').repeat(3).slice(0, n)
  ok(`worthKeeping: ${PROMPT_MIN - 1} tegn nei, ${PROMPT_MIN} tegn ja; bare en lenke nei`, !worthKeeping(setning(PROMPT_MIN - 1)) && worthKeeping(setning(PROMPT_MIN)) && !worthKeeping('https://example.com/' + 'x'.repeat(90)))
  ok('worthKeeping: <system-reminder> teller ikke med', !worthKeeping('<system-reminder>' + 'x'.repeat(200) + '</system-reminder> ja'))
  const lang = 'Dette er første setning som er ganske lang og forklarer mye. Så kommer en andre setning som ikke skal med i ingressen.'
  ok('firstSentence: første setning når teksten er over 300 tegn; hele når den er kort', firstSentence(lang + ' ' + 'x'.repeat(300)) === 'Dette er første setning som er ganske lang og forklarer mye.' && firstSentence(P1) === P1)
  ok('firstSentence: uten setningsslutt → klippes til ≤ 300 med …', firstSentence('ord '.repeat(200)).length <= 300 && firstSentence('ord '.repeat(200)).endsWith('…'))
  ok('promptKey: prompt:<økt8>:<sha8>, og linjedeling gir samme nøkkel (hashOf flater whitespace)', promptKey(SID, P1) === `prompt:sess-111:${hashOf(P1)}` && hashOf('a  b\nc') === hashOf('a b c') && sha8('x') === hashOf('x ') && sha8('x') !== sha8('x '))
  ok('promptTitle: ≤ 80 tegn, fra første setning', promptTitle(P1).length <= 80 && promptTitle(P1).startsWith('Kan du skrive'))
  const s = parseCodeSession(path.join(PROSJEKTDIR, `${SID}.jsonl`))
  ok('parseCodeSession: pairs — fire brukermeldinger med tekst, svar ≥ MIN_SVAR hører til første', s.pairs.length === 4 && s.pairs[0].answers.length === 1 && s.pairs[0].answers[0] === A1 && s.pairs[3].answers.length === 0 && s.pairs[0].at === T0, JSON.stringify(s.pairs.map((p) => [p.prompt.slice(0, 20), p.answers.length])))
}

// ── 2) importen: dry-run, ekte, idempotent ──────────────────────────────────
{
  const før = load().length
  const d = importCode({ dryRun: true, log: () => {} })
  ok('dry-run: teller 2 prompter (P1, P2) og 2 korte/kommandoer, skriver ingenting', d.stats.prompter === 2 && d.stats.prompterAlle === 2 && d.stats.korteprompter === 2 && load().length === før && !fs.existsSync(path.join(ROOT, 'Prosjekt')), JSON.stringify(d.stats))
  ok('dry-run: rapporten har Prompter-linja', /\*\*Prompter \(V16\):\*\* 2 nye/.test(d.report))
  const r = importCode({ log: () => {} })
  const atoms = load()
  const p1 = atoms.find((a) => a.key === promptKey(SID, P1)), p2 = atoms.find((a) => a.key === promptKey(SID, P2))
  const svar = atoms.find((a) => a.key === `svar:${SID.slice(0, 8)}:${sha8(A1)}`), samtale = atoms.find((a) => a.key === `samtale:${SID}`)
  ok('import: to prompt-saker med kind prompt, tagg prompt+code, i prosjektets mappe, uten synlig_i', p1 && p2 && p1.kind === 'prompt' && p1.tags.includes('prompt') && p1.tags.includes('code') && p1.project === 'Prosjekt' && !(p1.refs || []).length && fs.existsSync(path.join(ROOT, 'Prosjekt')), JSON.stringify(p1 && [p1.kind, p1.tags, p1.project]))
  ok('import: S er første setning etter regel (≤ 300), tittel ≤ 80, L = prompten, versjon 1, kilde Claude Code, samtale = første prompt', p1 && p1.levels?.S?.text === firstSentence(P1) && p1.levels.S.by === 'regel' && p1.name.length <= 80 && p1.content === P1 && (p1.version || 1) === 1 && p1.source === 'Claude Code' && p1.convo === samtale.convo, JSON.stringify(p1 && [p1.levels?.S?.text, p1.name, p1.convo]))
  ok('import: P2 kom gjennom <system-reminder>-strippingen og har ingen ga (svaret var kort)', p2 && p2.content === P2 && !(p2.ga || []).length)
  ok('import: ga ↔ bygget_av begge veier — prompten peker på svaret, svaret har prompten FØRST og samtalen etter', p1 && svar && p1.ga?.length === 1 && p1.ga[0].id === svar.id && svar.derivedFrom?.[0]?.id === p1.id && svar.derivedFrom[1]?.id === samtale.id, JSON.stringify([p1?.ga, svar?.derivedFrom]))
  ok('import: tidsstempel fra meldingen (capturedAt = når prompten ble skrevet)', p1 && p1.capturedAt === T0, String(p1?.capturedAt))
  ok('import: kortprompt «ja» og kommandoen ble ikke saker; tool_result ble ikke prompt', !atoms.some((a) => a.kind === 'prompt' && (a.content === 'ja' || /tua_card/.test(a.content))) && atoms.filter((a) => a.kind === 'prompt').length === 2)
  ok('import: fila har ga i frontmatter', /\nga: \[\{"id":"a_/.test(fs.readFileSync(path.join(ROOT, 'Prosjekt', `${store.FILES_ROOT ? '' : ''}`.length ? '' : path.basename(store.fileOf(p1))), 'utf8')))
  const n = load().length
  const r2 = importCode({ log: () => {} })
  const p1b = load().find((a) => a.key === promptKey(SID, P1))
  ok('import igjen: idempotent — 0 nye prompter, uendret økt, like mange saker, prompt og svar fortsatt versjon 1', r2.stats.prompter === 0 && r2.stats.uendret === 1 && load().length === n && (p1b.version || 1) === 1 && p1b.ga.length === 1, JSON.stringify(r2.stats))
  ok('countPrompts: 2 prompter i 1 økt', (() => { const c = countPrompts({ fresh: true }); return c.prompter === 2 && c.økter === 1 })())
}

// ── 3) importParsed (Desktop/eksport-form) med pairs ────────────────────────
{
  const A = 'Svar fra Desktop om budsjettet. '.repeat(120)
  const data = { kind: 'claude', convs: [{ id: 'conv-aaaa-bbbb', title: 'Budsjettsamtalen', created: T0, updated: T0 + 5000, project: 'Prosjekt', projectUuid: null, source: 'Claude Desktop', href: 'claude://claude.ai/chat/conv-aaaa-bbbb', summary: '', firstUser: P3,
    transcript: `**Bruker:** ${P3}\n\n**Claude:** ${A}`, messages: 2, artifacts: [], attachments: [], pairs: [{ prompt: P3, at: T0 + 1000, answers: [A] }, { prompt: 'ok', at: T0 + 2000, answers: ['kort'] }] }], docs: [], projects: [] }
  const r = importParsed(data, { name: 'test', label: 'Test', dryRun: false, log: () => {}, reportKey: 'import:test-desktop', reportName: 'Import: test' })
  const atoms = load()
  const p = atoms.find((a) => a.key === promptKey('conv-aaaa-bbbb', P3)), s = atoms.find((a) => a.key === `svar:conv-aaa:${sha8(A)}`)
  ok('importParsed: prompt-sak og svar-sak fra pairs, koblet begge veier, kilde Claude Desktop; «ok» hoppet over', r.stats.prompter === 1 && r.stats.svar === 1 && r.stats.korteprompter === 1 && p && s && p.source === 'Claude Desktop' && p.ga?.[0]?.id === s.id && s.derivedFrom?.[0]?.id === p.id && s.derivedFrom[1]?.id === atoms.find((a) => a.key === 'samtale:conv-aaaa-bbbb')?.id, JSON.stringify(r.stats))
  ok('importParsed: rapporten har Prompter-linja', /\*\*Prompter \(V16\):\*\* 1 nye/.test(r.report))
}

// ── 4) hooken: prompt-modus og svar-modus ───────────────────────────────────
{
  const HSID = 'hook-sess-9999-8888'
  const hookTr = path.join(PROSJEKTDIR, `${HSID}.jsonl`)
  const hook = (mode, input) => spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), mode], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env } })
  // prompt-modus: transkriptet finnes ikke ennå (første melding i økta)
  const r1 = hook('prompt', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', prompt: P3, hook_event_name: 'UserPromptSubmit' })
  const p = load().find((a) => a.key === promptKey(HSID, P3))
  ok('hook prompt: prompt-sak lagret, STUM (ingenting på stdout), avslutter 0', r1.status === 0 && r1.stdout === '' && p && p.kind === 'prompt' && p.project === 'Prosjekt' && p.convo === P3.slice(0, 59) + '…', JSON.stringify([r1.status, r1.stdout, p?.convo]))
  const r0 = hook('prompt', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', prompt: 'ja' })
  ok('hook prompt: «ja» gir ingen sak', r0.status === 0 && load().filter((a) => a.kind === 'prompt').length === 4)
  // svar-modus med kort svar: prompten lagres likevel (idempotent — den finnes alt), ingen svar-sak
  fs.writeFileSync(hookTr, [linje('user', [{ type: 'text', text: P3 }], 0, { sessionId: HSID }), linje('assistant', [{ type: 'text', text: 'Kort.' }], 1, { sessionId: HSID })].join('\n') + '\n')
  const r2 = hook('svar', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', last_assistant_message: 'Kort.' })
  ok('hook svar (kort svar): ingen svar-sak, prompten står som før', r2.status === 0 && !load().some((a) => a.key?.startsWith(`svar:${HSID.slice(0, 8)}`)) && load().find((a) => a.key === promptKey(HSID, P3)).version === 1)
  // svar-modus med langt svar: svar-sak med prompten i bygget_av, prompten får ga
  const A3 = 'Utkast til e-post til styret. '.repeat(130).trim()
  fs.writeFileSync(hookTr, [linje('user', [{ type: 'text', text: P3 }], 0, { sessionId: HSID }), linje('assistant', [{ type: 'text', text: A3 }], 1, { sessionId: HSID })].join('\n') + '\n')
  const r3 = hook('svar', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', last_assistant_message: A3 })
  const atoms = load()
  const sv = atoms.find((a) => a.key === `svar:${HSID.slice(0, 8)}:${sha8(A3)}`), p3 = atoms.find((a) => a.key === promptKey(HSID, P3))
  ok('hook svar (langt svar): svar-sak med sha8-nøkkel (samme som importen), bygget_av → prompten, prompten har ga → svaret', r3.status === 0 && sv && sv.derivedFrom?.[0]?.id === p3.id && p3.ga?.[0]?.id === sv.id, JSON.stringify([sv?.key, sv?.derivedFrom, p3?.ga]))
  // importen etter hooken: alt «uendret» — én hash og samme form på prompt og svar
  const before = load().length
  const r4 = importCode({ log: () => {} })
  const p3b = load().find((a) => a.key === promptKey(HSID, P3)), svb = load().find((a) => a.key === sv.key)
  // importen legger bare til samtale-saken for hook-økta og samtalen i svarets bygget_av («nivåer», ikke ny versjon) — prompten og svaret er de samme sakene
  ok('import etter hook: ingen nye prompter, svaret og prompten er de samme sakene på versjon 1 (bare samtale-saken er ny) — hook og import lager aldri to av samme', r4.stats.prompter === 0 && r4.stats.nye === 1 && load().length === before + 1 && (p3b.version || 1) === 1 && (svb.version || 1) === 1 && svb.derivedFrom[0].id === p3b.id && svb.derivedFrom.length === 2, JSON.stringify(r4.stats))
}

// ── 5) «Kjør igjen» gjennom motoren ─────────────────────────────────────────
{
  let atoms = load()
  const p1 = atoms.find((a) => a.key === promptKey(SID, P1))
  const r = await spor({ melding: P1, saker: [], mottakere: ['test'], prompt: p1.id })
  atoms = load()
  const p1b = atoms.find((a) => a.id === p1.id)
  ok('kjør igjen: svaret kobles til SAMME prompt-sak — ga vokser til 2, versjon fortsatt 1, nøkkelen beholdt', r.prompt === p1.id && p1b.ga.length === 2 && p1b.ga.some((g) => g.id === r.svar) && (p1b.version || 1) === 1 && p1b.key === p1.key, JSON.stringify([r.prompt, p1b.ga, p1b.version]))
  const svar = atoms.find((a) => a.id === r.svar)
  ok('kjør igjen: svar-saken (kind svar) har prompten først i bygget_av og samme samtale som prompten', svar && svar.kind === 'svar' && svar.derivedFrom[0].id === p1.id && svar.convo === p1b.convo)
  const r2 = await spor({ melding: P1 + ' Og nevn risikoene.', saker: [], mottakere: ['test'], prompt: p1.id })
  const p1c = load().find((a) => a.id === p1.id)
  ok('kjør igjen med endret tekst: ny versjon av samme prompt-sak (v2), ga 3', r2.prompt === p1.id && p1c.version === 2 && p1c.ga.length === 3 && p1c.content.endsWith('risikoene.'), JSON.stringify([p1c.version, p1c.ga.length]))
  let e = null
  try { await spor({ melding: 'x', mottakere: ['test'], prompt: 'a_finnes_ikke' }) } catch (x) { e = x }
  ok('kjør igjen med ukjent prompt-id → MotorFeil', e && /fant ingen prompt-sak/.test(e.message))
  // samme spørsmål to ganger fra Spør (uten prompt-id) = én prompt-sak med to svar
  const Q = 'Hva ble bestemt om flyttingen av lageret, og hvem har ansvaret for neste steg i prosessen?'
  const a1 = await spor({ melding: Q, saker: [], mottakere: ['test'], prosjekt: 'Prosjekt' })
  const a2 = await spor({ melding: Q, saker: [], mottakere: ['test'], prosjekt: 'Prosjekt' })
  const q = load().find((a) => a.id === a1.prompt)
  ok('Spør to ganger med samme tekst: samme prompt-sak (nøkkel prompt:spor:<sha8>), ga 2, versjon 1', a1.prompt === a2.prompt && q.key === `prompt:spor:${hashOf(Q)}` && q.ga.length === 2 && (q.version || 1) === 1 && q.levels?.S?.text === firstSentence(Q), JSON.stringify([q.key, q.ga.length]))
  // eldre prompt-sak fra Spør uten nøkkel (skive 1–7): «kjør igjen» gir den nøkkel og ga
  atoms = load()
  const gammel = upsert(atoms, { kind: 'prompt', content: 'Et gammelt spørsmål fra før skive 8 uten nøkkel, om noe helt annet enn lageret.', name: 'Gammelt spørsmål', project: 'Prosjekt', tags: ['prompt'], source: 'Tua', by: 'regel', short: 'Gammelt.' }).atom
  save(atoms)
  const r3 = await spor({ melding: gammel.content, saker: [], mottakere: ['test'], prompt: gammel.id })
  const g = load().find((a) => a.id === gammel.id)
  ok('eldre prompt uten nøkkel: får nøkkel prompt:spor:<sha8>, ga 1, versjon 1', r3.prompt === gammel.id && g.key === `prompt:spor:${hashOf(gammel.content)}` && g.ga.length === 1 && (g.version || 1) === 1, JSON.stringify([g.key, g.ga]))
}

// ── 6) datasettet: en konklusjon fra to mottakere ──────────────────────────
let konkId = null, datasetPrompt = null
{
  const Q = 'Sammenlikn de to forslagene til lagerflytting og si hvilket som er billigst på to års sikt.'
  const r = await spor({ melding: Q, saker: [], mottakere: ['test', 'test2'], prosjekt: 'Prosjekt' })
  konkId = r.konklusjon?.id; datasetPrompt = r.prompt
  ok('to mottakere → konklusjon (utkast) med Forskjeller-sak', r.konklusjon?.tilgjengelig && konkId && r.forskjeller?.sak, JSON.stringify([konkId, r.forskjeller?.sak]))
}

// ── 7) broen ────────────────────────────────────────────────────────────────
const DIST = path.join(HERE, '..', '..', 'tua2-sandbox', 'dist')
const PORT = 5298
const startBro = async (port, env) => {
  const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, ...env, TUA_BRIDGE_PORT: String(port), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
  let logg = ''; bro.stderr.on('data', (d) => { logg += d })
  for (let i = 0; i < 60 && !logg.includes('[tua-bro] appen'); i++) await vent(100)
  return { bro, logg: () => logg }
}
const sse = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.headers.get('content-type')?.includes('event-stream')) return { status: r.status, json: await r.json().catch(() => ({})), events: [] }
  const text = await r.text()
  return { status: r.status, events: text.split('\n\n').filter(Boolean).map((b) => ({ ev: b.match(/^event: (.+)$/m)?.[1], d: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || 'null') })) }
}
{
  const { bro } = await startBro(PORT, {})
  const get = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, json: await r.json().catch(() => ({})), r } }
  try {
    const s1 = await get('/api/search?q=lageret&kind=prompt&limit=3')
    ok('GET /api/search?kind=prompt: bare prompter, høyst 3, hvert treff med tekst, ga og modeller', s1.status === 200 && s1.json.kind === 'prompt' && s1.json.hits.length > 0 && s1.json.hits.length <= 3 && s1.json.hits.every((h) => h.kind === 'prompt' && typeof h.tekst === 'string' && Array.isArray(h.ga) && Array.isArray(h.modeller)), JSON.stringify(s1.json.hits.map((h) => [h.name, h.ga.length, h.modeller])))
    ok('GET /api/search?kind=prompt: modellene er kilden på svar-sakene (Test …)', s1.json.hits.some((h) => h.modeller.some((m) => /Test/.test(m))))
    const s2 = await get('/api/search?q=lageret&limit=50')
    ok('GET /api/search uten kind: alle typer som før', s2.status === 200 && s2.json.hits.some((h) => h.kind !== 'prompt'))
    // kjør igjen via broen
    const p1 = load().find((a) => a.key === promptKey(SID, P1))
    const r = await sse(`http://127.0.0.1:${PORT}/api/spor`, { melding: p1.content, saker: [], mottaker: 'test', prompt: p1.id, prosjekt: p1.project })
    const ferdig = r.events.find((e) => e.ev === 'ferdig')
    ok('POST /api/spor med prompt: ferdig.prompt er samme prompt-sak, ga vokser', ferdig?.d?.prompt === p1.id && load().find((a) => a.id === p1.id).ga.length === 4, JSON.stringify(r.events.map((e) => e.ev)))
    const r2 = await sse(`http://127.0.0.1:${PORT}/api/spor`, { melding: 'x', saker: [], mottaker: 'test', prompt: 'a_finnes_ikke', prosjekt: p1.project })
    ok('POST /api/spor med ukjent prompt: event feil', r2.events.some((e) => e.ev === 'feil' && /fant ingen prompt-sak/.test(e.d.feil)))
    // datasettet
    const txt = await (await fetch(`http://127.0.0.1:${PORT}/api/datasett.jsonl`)).text()
    const rader = txt.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    ok('GET /api/datasett.jsonl: én linje per konklusjon, med prompt_id/prompt/kilder/svar/forskjeller_id/konklusjon/laast', rader.length === 1 && rader[0].konklusjon_id === konkId && rader[0].prompt_id === datasetPrompt && rader[0].prompt.startsWith('Sammenlikn') && Array.isArray(rader[0].kilder) && rader[0].svar.length === 2 && rader[0].svar.every((s) => s.tekst_id && s.mottaker) && rader[0].forskjeller_id && rader[0].konklusjon.length > 10 && rader[0].laast === false, JSON.stringify(rader[0] && Object.keys(rader[0])))
    ok('datasett: svarene bare som id og mottaker (test/test2) — aldri svarteksten, ingen kobling', rader[0] && rader[0].svar.map((s) => s.mottaker).sort().join() === 'test,test2' && !/Ekko fra test-mottakeren/.test(txt) && !/kobling/.test(txt))
    const d0 = await (await fetch(`http://127.0.0.1:${PORT}/api/datasett.jsonl?laast=1`)).text()
    ok('datasett?laast=1: ingen linjer før konklusjonen er låst', d0.trim() === '')
    await fetch(`http://127.0.0.1:${PORT}/api/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: konkId, status: 'endelig' }) })
    const d1 = (await (await fetch(`http://127.0.0.1:${PORT}/api/datasett.jsonl?laast=1`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    ok('datasett?laast=1 etter låsing: én linje med laast true', d1.length === 1 && d1[0].laast === true)
    ok('datasett logges ikke som utlevering', !fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').includes('datasett'))
    // onboarding med arkiv som finnes: trenger = false
    const o = await get('/api/onboarding')
    ok('GET /api/onboarding (arkiv finnes, ingen aktiv onboarding): trenger false, kandidater og Ollama-status med', o.status === 200 && o.json.trenger === false && Array.isArray(o.json.kandidater) && o.json.kandidater.some((k) => k.id === 'lokalt') && 'running' in (o.json.ollama || {}) && Array.isArray(o.json.mottakere))
    ok('GET /api/onboarding?tall=1: tallene med prompter', (await get('/api/onboarding?tall=1')).json.tall?.prompter >= 2)
    ok('GET /start er en app-rute (serverer appen)', (await fetch(`http://127.0.0.1:${PORT}/start`)).status === 200)
    ok('POST /api/onboarding med ukjent steg → 400', (await fetch(`http://127.0.0.1:${PORT}/api/onboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steg: 'x' }) })).status === 400)
    // import-SSE (dry-run) mot arkivet som finnes
    const im = await sse(`http://127.0.0.1:${PORT}/api/import`, { kilde: 'code', dryRun: true })
    ok('POST /api/import {kilde: code, dryRun}: SSE start → del → ferdig med tall', im.events[0]?.ev === 'start' && im.events[0].d.kilde === 'code' && im.events.some((e) => e.ev === 'del' && e.d.kilde === 'code' && e.d.stats) && im.events.at(-1)?.ev === 'ferdig' && im.events.at(-1).d.dryRun === true, JSON.stringify(im.events.map((e) => e.ev)))
    ok('POST /api/import med ukjent kilde → 400', (await sse(`http://127.0.0.1:${PORT}/api/import`, { kilde: 'x' })).status === 400)
  } finally { bro.kill() }
}

// ── 8) onboardingen uten arkiv: needsChoice → velg lokalt → import ──────────
{
  const ONB_HOME = path.join(SCRATCH, 'onb-home'), ONB_DATA = path.join(SCRATCH, 'onb-data')
  fs.mkdirSync(path.join(ONB_HOME, '.tua'), { recursive: true }); fs.writeFileSync(path.join(ONB_HOME, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [FINDER_TOM] } }) + '\n')
  const env = { ...process.env, TUA_HOME: ONB_HOME, TUA_DATA_DIR: ONB_DATA }; delete env.TUA_FILES_ROOT
  const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...env, TUA_BRIDGE_PORT: String(PORT + 1), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
  let logg = ''; bro.stderr.on('data', (d) => { logg += d })
  for (let i = 0; i < 60 && !logg.includes('[tua-bro] appen'); i++) await vent(100)
  const B = `http://127.0.0.1:${PORT + 1}`
  const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, json: await r.json().catch(() => ({})) } }
  const post = async (p, body) => { const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
  try {
    const o = await get('/api/onboarding')
    ok('uten arkiv: GET /api/onboarding → trenger true, needsChoice, «lokalt» tilgjengelig, ingen steg', o.json.trenger === true && o.json.arkiv.needsChoice === true && o.json.kandidater.find((k) => k.id === 'lokalt')?.available && Object.keys(o.json.steg).length === 0, JSON.stringify([o.json.trenger, o.json.arkiv]))
    ok('uten arkiv: POST /api/import → 400 (velg arkivsted først)', (await post('/api/import', { kilde: 'alt', dryRun: true })).status === 400)
    ok('uten arkiv: steg arkiv uten sted → 400', (await post('/api/onboarding', { steg: 'arkiv' })).status === 400)
    const s1 = await post('/api/onboarding', { steg: 'modell', verdi: 'ingen' })
    ok('steg 1 fullført: steg.modell satt, ikke ferdig', s1.status === 200 && s1.json.steg.modell && !s1.json.ferdig)
    const s2 = await post('/api/onboarding', { steg: 'arkiv', sted: 'lokalt' })
    const nyRot = path.join(ONB_HOME, 'Tua')
    ok('steg 2: arkivet lages der brukeren valgte (TUA_HOME/Tua), velkomstsak og Innboks, ingenting flyttet; config.json har root', s2.status === 200 && s2.json.arkivSvar?.created === true && s2.json.arkiv.root === nyRot && fs.existsSync(path.join(nyRot, 'Innboks')) && fs.existsSync(path.join(nyRot, 'Tua', 'Velkommen til Tua.md')) && JSON.parse(fs.readFileSync(path.join(ONB_HOME, '.tua', 'config.json'), 'utf8')).root === nyRot && !s2.json.arkiv.needsChoice, JSON.stringify(s2.json.arkiv))
    const t = await get('/api/onboarding?tall=1')
    ok('steg 3: tallene — 2 Code-økter i det falske treet, 4 prompter (2 + hook-økta 1 … minst 3)', t.json.tall && t.json.tall.codeAll === 2 && t.json.tall.prompter >= 3, JSON.stringify(t.json.tall))
    const dry = await sse(`${B}/api/import`, { kilde: 'alt', dryRun: true })
    const kilder = dry.events.filter((e) => e.ev === 'start').map((e) => e.d.kilde)
    ok('import dry-run som SSE: start for hver kilde (code, cowork, desktop, finder, innboks), ferdig med tall.prompter ≥ 3, ingenting skrevet', kilder.join() === 'code,cowork,desktop,finder,innboks' && dry.events.at(-1).ev === 'ferdig' && dry.events.at(-1).d.tall.prompter >= 3 && !fs.existsSync(path.join(nyRot, 'Prosjekt')), JSON.stringify([kilder, dry.events.at(-1)?.d?.tall]))
    const ekte = await sse(`${B}/api/import`, { kilde: 'alt' })
    const f = ekte.events.at(-1)
    ok('import ekte som SSE: ferdig, prompter skrevet i det nye arkivet, del-hendelsene har stats', f?.ev === 'ferdig' && f.d.tall.prompter >= 3 && fs.existsSync(path.join(nyRot, 'Prosjekt')) && fs.readdirSync(path.join(nyRot, 'Prosjekt')).some((n) => n.endsWith('.md')) && ekte.events.filter((e) => e.ev === 'del').every((e) => e.d.stats || e.d.feil), JSON.stringify(f?.d?.tall))
    const s3 = await post('/api/onboarding', { steg: 'historikk', verdi: 'kjørt' })
    ok('steg 3 fullført: alle tre steg → ferdig, trenger false, .tua/onboarding.json ferdig ved «app»', s3.json.ferdig && s3.json.trenger === false && JSON.parse(fs.readFileSync(path.join(nyRot, '.tua', 'onboarding.json'), 'utf8')).state === 'ferdig' && ['app', 'import'].includes(JSON.parse(fs.readFileSync(path.join(nyRot, '.tua', 'onboarding.json'), 'utf8')).ved), JSON.stringify(s3.json.steg))   // importen i steg 3 avsluttet alt MCP-onboardingen (ved: import); uten import gjør appen det (ved: app)
    ok('etterpå: GET /api/onboarding trenger false (kan likevel åpnes igjen fra /start)', (await get('/api/onboarding')).json.trenger === false)
  } finally { bro.kill() }
}

console.log(feil ? `\n${feil} FEIL · testarkiv: ${ROOT}` : `\nAlt grønt · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
