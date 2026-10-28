#!/usr/bin/env node
// test-import-codex.mjs — Codex-samtaler inn i Tua (28.10.2026): tua_import(kilde=codex) etter Code-malen i import.js.
// ALDRI mot ~/Dropbox/Tua, ALDRI Eriks ekte ~/.codex (et falskt tre lages i scratch og TUA_CODEX_HOME pekes dit), ALDRI ~/.claude/projects
// (TUA_CODE_HOME/TUA_COWORK_ROOT peker på tomme mapper), ALDRI et ekte modellkall.
//
//   S=/tmp/tua-test-codex; TUA_FILES_ROOT=$S/arkiv TUA_DATA_DIR=$S/data TUA_HOME=$S/hjem node server/test-import-codex.mjs
//
// Sjekker: listCodexSessions finner rollout-filene under sessions/<år>/<mnd>/<dag>/ · parseCodexSession leser session_meta (id, cwd, klient),
// brukerens spørsmål (input_text) og Codex' svar (output_text), og hopper over developer-linjene, <environment_context>/<external_codex_apps_open_page>-
// innpakningen, reasoning, custom_tool_call, function_call, event_msg, token_usage_record, turn_context og world_state · tittel fra session_index.jsonl,
// ellers første spørsmål kortet · prosjekt fra cwd, men ChatGPT-appens ~/Documents/Codex/<dato>/new-chat* er «Uten prosjekt» · dry-run skriver ingenting ·
// ekte import: samtale-sak med nøkkel codex:<id>, kilde «Codex», tagg codex, fanget, tid fra samtalen; prompt-saker (V16) med ga ↔ bygget_av til svar-saken
// (kilde Codex); rapport-sak import:codex-samtaler; import-state codex · idempotent (igjen = uendret, ingen ny versjon, ingen ny fil) · pendingCodexSessions,
// historyCounts/historyLine, importAlt med steget codex · finnSamtale finner codex:<id> · SessionStart-hooken sier fra om Codex-samtaler som ikke er tatt med ·
// kommandolinja --codex --dry-run.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '2'
process.env.TUA_VURDERER = 'test'
process.env.TUA_SKRIVER = 'regel'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
const SCRATCH = path.dirname(ROOT)
const CODE_HOME = path.join(SCRATCH, 'code-tom'), COWORK = path.join(SCRATCH, 'cowork-tom'), CODEX_HOME = path.join(SCRATCH, 'codex-home'), FINDER_TOM = path.join(SCRATCH, 'finder-tom')
for (const d of [ROOT, DATA, HJEM, CODE_HOME, COWORK, CODEX_HOME, FINDER_TOM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODE_HOME = CODE_HOME
process.env.TUA_COWORK_ROOT = COWORK
process.env.TUA_CODEX_HOME = CODEX_HOME
fs.mkdirSync(path.join(HJEM, '.tua'), { recursive: true }); fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [FINDER_TOM] } }) + '\n')
fs.mkdirSync(path.join(ROOT, 'Innboks'), { recursive: true })

const store = await import('./store.js')
const { load, importState, sha8, fileOf } = store
const imp = await import('./import.js')
const { listCodexSessions, parseCodexSession, importCode, importAlt, IMPORT_STEG, pendingCodexSessions, historyCounts, historyLine, promptKey, codexKlient, erCodexMappe, codexProject, codexIndex, kortTittel, CODEX_SESSIONS, MIN_SVAR } = imp
const { finnSamtale } = await import('./samtale.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const sek = (t) => Math.floor((t || 0) / 1000)   // tidene i fila har sekundoppløsning
const S = (a) => a?.levels?.S?.text || '', M = (a) => a?.levels?.M?.text || ''
const mdFiler = (d) => { let n = 0; const gå = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; if (e.isDirectory()) gå(path.join(p, e.name)); else if (e.name.endsWith('.md')) n++ } }; gå(d); return n }

// ── et falskt ~/.codex-tre ───────────────────────────────────────────────────
// A: Codex CLI (`codex exec`) i et prosjekt — 3 brukerspørsmål, 2 svar (ett substansielt), developer- og verktøylinjer som skal ignoreres
const ID_A = '01a1820d-c288-7bd3-90a0-d137adf7e5bc', CWD_A = '/Users/test/Prosjekt'
const P1 = 'Kan du lese møtenotatet om lagerflytting og foreslå tre konkrete tiltak for neste kvartal, med budsjett per tiltak?'
const P2 = 'Lag en liste over leverandørene som er nevnt i notatet, med hva hver leverer og hvem som er kontaktperson hos oss.'
const P3 = 'Skriv et utkast til e-post til styret om flyttingen: hva som er bestemt, hva det koster og når det skjer. Kort og klart.'
const A1 = ('# Tre tiltak for neste kvartal\n\n' + 'Lageret flyttes til Industriveien 4 i løpet av neste kvartal, og budsjettet er 45 000 kroner per tiltak. '.repeat(40)).trim()
const A2 = 'Her er leverandørene fra notatet: Nordisk Transport (frakt, kontakt Kari), Lagerinnredning AS (reoler, kontakt Ola).'
const T0 = Date.parse('2026-10-28T10:28:23.597Z')
const ts = (i) => new Date(T0 + i * 1000).toISOString()
const linje = (i, type, payload) => JSON.stringify({ timestamp: ts(i), type, payload })
const msg = (i, role, type, text) => linje(i, 'response_item', { type: 'message', role, content: [{ type, text }] })
const rolloutA = [
  linje(0, 'session_meta', { id: ID_A, timestamp: ts(0), cwd: CWD_A, originator: 'codex_exec', cli_version: '0.165.0', source: 'exec' }),
  linje(1, 'event_msg', { type: 'task_started', turn_attribution: { turn_id: 'turn-1' } }),
  linje(2, 'response_item', { type: 'additional_tools', id: 'at_1', role: 'developer', tools: [{ name: 'tua_search' }] }),
  msg(3, 'developer', 'input_text', 'You are Codex, an agent based on GPT-6. You and the user share one workspace. SYSTEMTEKST SOM IKKE SKAL MED.'),
  msg(3, 'developer', 'input_text', '<skills_instructions>\n## Skills\nINSTRUKS SOM IKKE SKAL MED\n</skills_instructions>'),
  msg(3, 'user', 'input_text', `<environment_context>\n  <cwd>${CWD_A}</cwd>\n  <shell>bash</shell>\n  <current_date>2026-10-28</current_date>\n</environment_context>`),
  linje(3, 'world_state', { full: true, state: { agents_md: {} } }),
  linje(3, 'turn_context', { turn_id: 'turn-1', cwd: CWD_A, model: 'gpt-6' }),
  msg(3, 'user', 'input_text', '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>'),
  msg(4, 'user', 'input_text', P1),
  linje(5, 'response_item', { type: 'reasoning', id: 'rs_1', summary: [], content: [{ type: 'reasoning_text', text: 'RESONNERING SOM IKKE SKAL MED' }] }),
  linje(6, 'response_item', { type: 'custom_tool_call', id: 'ctc_1', status: 'completed', call_id: 'c1', name: 'tua_search', input: '{"query":"lagerflytting"}' }),
  linje(7, 'token_usage_record', { thread_id: ID_A, turn_id: 'turn-1', tokens: 123 }),
  linje(8, 'response_item', { type: 'custom_tool_call_output', id: 'ctco_1', call_id: 'c1', output: 'VERKTØYSVAR SOM IKKE SKAL MED' }),
  linje(9, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1 } } }),
  msg(10, 'assistant', 'output_text', A1),
  linje(11, 'event_msg', { type: 'task_complete', turn_id: 'turn-1' }),
  linje(12, 'event_msg', { type: 'task_started', turn_attribution: { turn_id: 'turn-2' } }),
  msg(13, 'user', 'input_text', P2),
  linje(14, 'response_item', { type: 'function_call', id: 'fc_1', call_id: 'f1', name: 'shell', arguments: '{"command":["ls"]}' }),
  linje(15, 'response_item', { type: 'function_call_output', call_id: 'f1', output: 'FUNKSJONSSVAR SOM IKKE SKAL MED' }),
  msg(16, 'assistant', 'output_text', A2),
  linje(17, 'event_msg', { type: 'task_complete', turn_id: 'turn-2' }),
  msg(18, 'user', 'input_text', P3),
  linje(19, 'event_msg', { type: 'task_started', turn_attribution: { turn_id: 'turn-3' } }),
].join('\n') + '\n'
// B: ChatGPT-appen (originator «Codex Desktop») i appens egen new-chat-mappe — tittel i session_index.jsonl, ett spørsmål, ett kort svar
const ID_B = '01a18215-638e-77a1-8731-5632426a0838', CWD_B = path.join(os.homedir(), 'Documents', 'Codex', '2026-10-28', 'new-chat')
const PB = 'Sjekk hva selskapet Energima driver med, hvor de holder til og om de har noe med ventilasjon å gjøre. Svar på norsk.'
const AB = ('Energima er et norsk selskap innen ventilasjon og inneklima med hovedkontor på Lysaker. ' + 'De tilbyr også kjøling, service og energirådgivning. '.repeat(8)).trim()
const TB = Date.parse('2026-10-28T14:01:49.610Z')
const tsB = (i) => new Date(TB + i * 1000).toISOString()
const rolloutB = [
  JSON.stringify({ timestamp: tsB(0), type: 'session_meta', payload: { id: ID_B, timestamp: tsB(0), cwd: CWD_B, originator: 'Codex Desktop', cli_version: '0.165.0-alpha.1.2', source: 'vscode' } }),
  JSON.stringify({ timestamp: tsB(1), type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<app-context>\n# Codex desktop context\nIKKE MED\n</app-context>' }] } }),
  JSON.stringify({ timestamp: tsB(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>\n<cwd>${CWD_B}</cwd>\n</environment_context>` }] } }),
  JSON.stringify({ timestamp: tsB(2), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: PB }] } }),
  JSON.stringify({ timestamp: tsB(5), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: AB }] } }),
].join('\n') + '\n'
const DAG = path.join(CODEX_HOME, 'sessions', '2026', '10', '28')
fs.mkdirSync(DAG, { recursive: true })
const FIL_A = path.join(DAG, `rollout-2026-10-28T12-28-23-${ID_A}.jsonl`), FIL_B = path.join(DAG, `rollout-2026-10-28T16-01-49-${ID_B}.jsonl`)
fs.writeFileSync(FIL_A, rolloutA)
fs.writeFileSync(FIL_B, rolloutB)
fs.writeFileSync(path.join(CODEX_HOME, 'session_index.jsonl'), JSON.stringify({ id: ID_B, thread_name: 'Sjekk Energima og TUA', updated_at: tsB(6) }) + '\n')

// ── 1) lista og leseren ─────────────────────────────────────────────────────
{
  const l = listCodexSessions()
  ok('listCodexSessions: finner de to rollout-filene under sessions/2026/10/28', l.length === 2 && l.every((f) => /rollout-.*\.jsonl$/.test(f.file) && f.size > 0 && f.dir === path.join('2026', '10', '28')), `${l.length} filer`)
  ok('CODEX_SESSIONS følger TUA_CODEX_HOME (aldri Eriks ekte ~/.codex i test)', CODEX_SESSIONS === path.join(CODEX_HOME, 'sessions'))
  ok('codexKlient: codex_exec → Codex CLI, Codex Desktop / codex_work_desktop → ChatGPT-appen, ukjent → Codex (navnet)', codexKlient('codex_exec') === 'Codex CLI' && codexKlient('Codex Desktop') === 'ChatGPT-appen' && codexKlient('codex_work_desktop') === 'ChatGPT-appen' && codexKlient('noe_nytt') === 'Codex (noe_nytt)' && codexKlient('') === 'Codex')
  ok('erCodexMappe / codexProject: ~/Documents/Codex/<dato>/new-chat* er «Uten prosjekt», et repo gir repo-navnet', erCodexMappe(CWD_B) && erCodexMappe(CWD_B + '-2') && !erCodexMappe(CWD_A) && codexProject(CWD_B) === 'Uten prosjekt' && codexProject(CWD_A) === 'Prosjekt' && codexProject('') === 'Uten prosjekt')
  ok('codexIndex: tråd-id → thread_name fra session_index.jsonl', codexIndex().get(ID_B) === 'Sjekk Energima og TUA' && !codexIndex().has(ID_A))

  const a = parseCodexSession(FIL_A)
  ok('A: id, cwd, klient og versjon fra session_meta', a.id === ID_A && a.cwd === CWD_A && a.klient === 'Codex CLI' && a.originator === 'codex_exec' && a.cliVersion === '0.165.0')
  ok('A: tre brukerspørsmål i rekkefølge (input_text), vendinger = 3', a.prompts.length === 3 && a.prompts[0] === P1 && a.prompts[1] === P2 && a.prompts[2] === P3 && a.turns === 3, `${a.prompts.length} spørsmål`)
  ok('A: <environment_context> og <external_codex_apps_open_page> er innpakning, ikke spørsmål (harness = 2)', a.harness === 2 && !a.prompts.some((p) => /environment_context|codex_apps/.test(p)))
  ok('A: to svar (output_text); det lange (≥ MIN_SVAR) er substansielt, det korte står som svar på paret', a.answers.length === 1 && a.answers[0] === A1 && A1.length >= MIN_SVAR && a.pairs[0].answers[0] === A1 && a.pairs[0].svar === A1 && a.pairs[1].answers.length === 0 && a.pairs[1].svar === A2 && a.pairs[2].answers.length === 0 && a.lastAssistant === A2)
  ok('A: developer, reasoning, verktøykall, event_msg, token_usage_record, turn_context og world_state er ikke med i transkriptet', !/IKKE SKAL MED|You are Codex|skills_instructions|custom_tool_call|function_call|task_started/.test(a.transcript) && a.hoppet >= 10)
  ok('A: transkriptet er «**Bruker:** …» / «**Codex:** …» (samme form som Code, Codex i stedet for Claude)', a.transcript.startsWith(`**Bruker:** ${P1}\n\n**Codex:** `) && a.transcript.includes(`**Codex:** ${A2}`) && !a.transcript.includes('**Claude:**') && a.lines.length === 5)
  ok('A: uten navn i session_index: tittelen er første spørsmål kortet etter samme regel som Cowork (første setning ≤ 60, ellers 60 tegn)', a.title === '' && a.convo === kortTittel(P1) && a.convo.length <= 60 && a.convo.startsWith('Kan du lese møtenotatet'), a.convo)
  ok('A: prosjekt fra cwd (Prosjekt), repo = cwd, tid fra første og siste melding', a.project === 'Prosjekt' && a.repo === CWD_A && a.first === T0 + 4000 && a.last === T0 + 18000 && a.pairs[0].at === T0 + 4000)
  ok('A: ingen filer skrevet, ingen gren/forelder (Codex har ikke det)', a.files.size === 0 && a.edited.size === 0 && a.gren === '' && a.forelder === '' && a.barn === false)

  const b = parseCodexSession(FIL_B)
  ok('B: ChatGPT-appen (originator «Codex Desktop»), tittel fra session_index.jsonl, cwd i appens egen mappe → «Uten prosjekt», ingen repo-lenke', b.klient === 'ChatGPT-appen' && b.title === 'Sjekk Energima og TUA' && b.convo === 'Sjekk Energima og TUA' && b.project === 'Uten prosjekt' && b.repo === '' && b.prompts.length === 1 && b.prompts[0] === PB && b.harness === 1 && b.lastAssistant === AB)
  ok('B: <app-context> fra developer er ikke med', !/IKKE MED|app-context/.test(b.transcript))
  const tom = parseCodexSession(path.join(DAG, 'finnes-ikke.jsonl'))
  ok('en fil som ikke finnes gir en tom samtale uten å kaste', tom.prompts.length === 0 && tom.turns === 0 && tom.id === '')
}

// ── 2) dry-run skriver ingenting ───────────────────────────────────────────
const før = mdFiler(ROOT)
{
  const r = importCode({ source: 'codex', dryRun: true })
  ok('dry-run: 2 nye samtaler, 4 substansielle prompter, 1 substansielt svar, 0 korte, 0 filer', r.stats.nye === 2 && r.stats.prompterAlle === 4 && r.stats.prompter === 4 && r.stats.svar === 1 && r.stats.korte === 0 && r.stats.filer === 0 && r.count === 2, JSON.stringify(r.stats))
  ok('dry-run: rapporten heter «Import: Codex-samtaler», sier dry-run og rollout-filer, prosjektene Prosjekt og Uten prosjekt', /^# Import: Codex-samtaler\n/.test(r.report) && /dry-run, ingenting skrevet/.test(r.report) && /2 rollout-filer/.test(r.report) && /Prosjekt \(1\)/.test(r.report) && /Uten prosjekt \(1\)/.test(r.report) && /Codex har ingen hooks/.test(r.report))
  ok('dry-run: ingen fil skrevet i arkivet, ingen import-state, ingen rapport-sak', mdFiler(ROOT) === før && !importState().codex && !load().some((a) => a.key === 'import:codex-samtaler'))
}

// ── 3) SessionStart-hooken før import: sier fra om Codex-samtaler som ikke er tatt med ───
{
  const repo = path.join(HJEM, 'repo'); fs.mkdirSync(repo, { recursive: true })
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), 'start'], { input: JSON.stringify({ cwd: repo, session_id: 'codex0001', hook_event_name: 'SessionStart' }), env: { ...process.env }, encoding: 'utf8', timeout: 30000 })
  ok('hook start: «2 Codex-samtaler (Codex CLI / ChatGPT-appen) er ikke tatt med (aldri importert) — tua_import(kilde=codex)»', r.status === 0 && /2 Codex-samtaler \(Codex CLI \/ ChatGPT-appen\) er ikke tatt med \(aldri importert\) — tua_import\(kilde=codex\)/.test(r.stdout), (r.stdout || r.stderr || '').slice(0, 300))
  ok('pendingCodexSessions: 2 før import, 0 når «siden» er etter filene', pendingCodexSessions(0) === 2 && pendingCodexSessions(Date.now() + 60000) === 0)
  const c = historyCounts({ fresh: true })
  ok('historyCounts: codex = 2 (ikke importert), codexAll = 2; historyLine nevner «2 Codex-samtaler»', c.codex === 2 && c.codexAll === 2 && /2 Codex-samtaler/.test(historyLine(c)), historyLine(c))
}

// ── 4) ekte import ─────────────────────────────────────────────────────────
{
  const r = importCode({ source: 'codex' })
  ok('import: 2 nye samtaler, 4 prompter, 1 svar', r.stats.nye === 2 && r.stats.oppdatert === 0 && r.stats.prompter === 4 && r.stats.svar === 1, JSON.stringify(r.stats))
  const atoms = load()
  const sA = atoms.find((a) => a.key === `codex:${ID_A}`), sB = atoms.find((a) => a.key === `codex:${ID_B}`)
  ok('samtale-sak A: nøkkel codex:<id>, kind samtale, kilde «Codex», tagger samtale+codex, prosjekt Prosjekt, fanget, tittel = første spørsmål kortet', !!sA && sA.kind === 'samtale' && sA.source === 'Codex' && sA.tags.includes('samtale') && sA.tags.includes('codex') && sA.project === 'Prosjekt' && sA.fanget === true && sA.name === kortTittel(P1) && sA.convo === sA.name)
  ok('samtale-sak A: hodelinja sier «Codex (Codex CLI) · 3 oppgaver · 2026-10-28 · Prosjekt · <repo> · rollout-fil …», transkriptet under', !!sA && new RegExp(`^# ${sA.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\n\\n_Codex \\(Codex CLI\\) · 3 oppgaver · 2026-10-28 · Prosjekt · ${CWD_A} · rollout-fil rollout-`).test(sA.content) && sA.content.includes(`**Bruker:** ${P1}`) && sA.content.includes('**Codex:** '))
  ok('samtale-sak A: S etter samtaleregelen (siste vending), M etter regel med kilde Codex, tid fra samtalen (ikke importtida), repo-lenke', !!sA && /^Sist: Skriv et utkast til e-post til styret/.test(S(sA)) && /3 vendinger · 28\.10\.2026/.test(S(sA)) && sA.levels.S.by === 'regel' && /\*\*Første spørsmål:\*\* Kan du lese/.test(M(sA)) && /_Codex · 3 vendinger/.test(M(sA)) && sek(sA.capturedAt) === sek(T0 + 18000) && sek(sA.createdAt) === sek(T0 + 18000) && sA.links?.some((l) => l.kind === 'repo' && l.href === CWD_A), S(sA))
  ok('samtale-sak B: tittelen fra session_index, kilde Codex, «Uten prosjekt», ingen repo-lenke, hodelinja sier ChatGPT-appen', !!sB && sB.name === 'Sjekk Energima og TUA' && sB.source === 'Codex' && sB.project === 'Uten prosjekt' && !(sB.links || []).length && /_Codex \(ChatGPT-appen\) · 1 oppgaver/.test(sB.content) && sB.fanget === true)
  ok('filene ligger i prosjektmappene (Prosjekt/, Uten prosjekt/)', !!sA && !!sB && fileOf(sA).startsWith(path.join(ROOT, 'Prosjekt') + path.sep) && fileOf(sB).startsWith(path.join(ROOT, 'Uten prosjekt') + path.sep))
  // prompter (V16) og svaret
  const p1 = atoms.find((a) => a.key === promptKey(ID_A, P1)), p2 = atoms.find((a) => a.key === promptKey(ID_A, P2)), p3 = atoms.find((a) => a.key === promptKey(ID_A, P3)), pB = atoms.find((a) => a.key === promptKey(ID_B, PB))
  const svar = atoms.find((a) => a.key === `svar:${ID_A.slice(0, 8)}:${sha8(A1)}`)
  ok('prompt-saker: fire (P1, P2, P3, PB) med kind prompt, kilde Codex, tagg prompt+codex, prosjekt som samtalen, fanget, ingen synlig_i', [p1, p2, p3, pB].every((p) => p && p.kind === 'prompt' && p.source === 'Codex' && p.tags.includes('prompt') && p.tags.includes('codex') && p.fanget === true && !(p.visibleIn || p.synlig_i || []).length) && p1.project === 'Prosjekt' && pB.project === 'Uten prosjekt')
  ok('prompt P1: S = første setning, L = prompten, tid fra meldingen, summary nevner Codex-samtalen', !!p1 && S(p1) === P1 && p1.content === P1 && sek(p1.capturedAt) === sek(T0 + 4000) && /Codex-samtalen «/.test(p1.summary), p1?.summary)
  ok('svar-saken: kilde Codex (ikke Claude), bygget av prompten først og så samtalen, prompten har svaret i ga', !!svar && svar.kind === 'capture' && svar.source === 'Codex' && svar.content === A1 && svar.derivedFrom?.[0]?.id === p1.id && svar.derivedFrom?.[1]?.id === sA.id && /Codex-samtalen «/.test(svar.summary) && (p1.ga || []).some((g) => g.id === svar.id) && !(p2.ga || []).length)
  const rap = atoms.find((a) => a.key === 'import:codex-samtaler')
  ok('rapport-saken import:codex-samtaler i prosjekt Tua (drift), S sier «Codex-samtaler: 2 nye …»', !!rap && rap.project === 'Tua' && rap.drift === true && /^Codex-samtaler: 2 nye og 0 oppdaterte samtaler, 1 svar/.test(S(rap)), S(rap))
  ok('import-state: codex.at satt, last.kind = codex', importState().codex?.at > 0 && importState().last?.kind === 'codex' && importState().codex.nye === 2)
  ok('finnSamtale finner Codex-samtalen på tråd-id (codex:<id>) — Arbeid/«Fortsett her» kan åpne den', finnSamtale(atoms, ID_A)?.id === sA?.id && finnSamtale(atoms, ID_B)?.id === sB?.id)
  ok('historyCounts etter import: codex = 0 (alt tatt med), codexAll fortsatt 2', historyCounts({ fresh: true }).codex === 0 && historyCounts({ fresh: true }).codexAll === 2)
}

// ── 5) idempotens ──────────────────────────────────────────────────────────
{
  const n1 = mdFiler(ROOT)
  const r = importCode({ source: 'codex' })
  const atoms = load()
  const sA = atoms.find((a) => a.key === `codex:${ID_A}`), p1 = atoms.find((a) => a.key === promptKey(ID_A, P1)), svar = atoms.find((a) => a.key === `svar:${ID_A.slice(0, 8)}:${sha8(A1)}`)
  ok('andre kjøring: 0 nye, 0 oppdatert, 2 uendret, 0 prompter/svar skrevet', r.stats.nye === 0 && r.stats.oppdatert === 0 && r.stats.uendret === 2 && r.stats.prompter === 0 && r.stats.svar === 0, JSON.stringify(r.stats))
  ok('andre kjøring: ingen ny versjon, ingen ny fil (rapporten oppdateres på plass), ga uendret', (sA.version || 1) === 1 && (p1.version || 1) === 1 && (svar.version || 1) === 1 && mdFiler(ROOT) === n1 && (p1.ga || []).length === 1 && atoms.filter((a) => a.kind === 'samtale' && a.source === 'Codex').length === 2)
  // en ny vending i samtalen → oppdatert, versjon 2, ny S
  const A3 = 'Utkastet til styret: lageret flyttes til Industriveien 4 i mars, kostnaden er 135 000 kroner, og alt er klart innen kvartalsslutt.'
  fs.appendFileSync(FIL_A, msg(20, 'assistant', 'output_text', A3) + '\n')
  const r2 = importCode({ source: 'codex' })
  const sA2 = load().find((a) => a.key === `codex:${ID_A}`)
  ok('en ny vending i rollout-fila: samtalen oppdateres (versjon 2), S får det nye svaret, tida flyttes', r2.stats.oppdatert === 1 && r2.stats.uendret === 1 && (sA2.version || 1) === 2 && /→ Utkastet til styret/.test(S(sA2)) && sA2.levels.S.of === 2 && sek(sA2.capturedAt) === sek(T0 + 20000), S(sA2))
}

// ── 6) «alt» tar Codex med; kommandolinja ───────────────────────────────────
{
  ok('IMPORT_STEG har steget codex («Codex-samtaler») etter cowork', IMPORT_STEG.findIndex(([k]) => k === 'codex') === IMPORT_STEG.findIndex(([k]) => k === 'cowork') + 1 && IMPORT_STEG.find(([k]) => k === 'codex')[1] === 'Codex-samtaler')
  const hendelser = []
  const r = await importAlt({ dryRun: true, kilder: ['codex'], på: (ev, d) => hendelser.push([ev, d.kilde, d.label, d.stats?.uendret]) })
  ok('importAlt(kilder=[codex], dry-run): start/del-hendelser for codex, rapporten er Codex-rapporten', hendelser.length === 2 && hendelser[0][0] === 'start' && hendelser[0][1] === 'codex' && hendelser[1][0] === 'del' && hendelser[1][2] === 'Codex-samtaler' && hendelser[1][3] === 2 && /^# Import: Codex-samtaler/.test(r.report))
  const cli = spawnSync(process.execPath, [path.join(HERE, 'import.js'), '--codex', '--dry-run'], { env: { ...process.env }, encoding: 'utf8', timeout: 30000 })
  ok('node import.js --codex --dry-run: rapporten på stdout, ingenting skrevet', cli.status === 0 && /^# Import: Codex-samtaler/.test(cli.stdout) && /dry-run/.test(cli.stdout) && /2 uendret/.test(cli.stdout), (cli.stderr || '').slice(0, 200))
  // Tua-prat (samme regel som Code): en samtale som starter med /tua… er en test av Tua
  const ID_C = '01a19999-0000-7000-8000-000000000003'
  fs.writeFileSync(path.join(DAG, `rollout-2026-10-28T17-00-00-${ID_C}.jsonl`), [
    JSON.stringify({ timestamp: tsB(0), type: 'session_meta', payload: { id: ID_C, timestamp: tsB(0), cwd: CWD_B, originator: 'codex_work_desktop', cli_version: '0.165.0' } }),
    JSON.stringify({ timestamp: tsB(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '/tua_find energima' }] } }),
    JSON.stringify({ timestamp: tsB(2), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Jeg søker i Tua. '.repeat(50) }] } }),
  ].join('\n') + '\n')
  const r3 = importCode({ source: 'codex', dryRun: true })
  ok('en Codex-samtale som starter med /tua… er Tua-prat og hoppes over (samme regel som Code)', r3.stats.tuaprat === 1 && r3.count === 3 && r3.stats.uendret === 2, JSON.stringify(r3.stats))
}

console.log(feil ? `\n${feil} feil` : '\nalle grønne')
process.exit(feil ? 1 : 0)
