#!/usr/bin/env node
// test-arbeid.mjs — friksjon 20 + økt-sakene (25.10.2026): arbeidet som samler. ALDRI mot ~/Dropbox/Tua, ALDRI Eriks ekte ~/.claude/projects (et falskt tre i scratch),
// ALDRI et ekte modellkall (test-mottakerne ekkoer; TUA_VURDERER=test; TUA_SKRIVER=regel).
//
//   TUA_FILES_ROOT=/tmp/tua-test-arbeid/arkiv TUA_DATA_DIR=/tmp/tua-test-arbeid/data TUA_HOME=/tmp/tua-test-arbeid/hjem node server/test-arbeid.mjs
//
// Sjekker: (A) stripReminders — harness-tekst ut (bakgrunn fra startøkta, <cross-session-message>, <task-notification>, [Image: …], påminnelser), menneskeprompter inn, rekkefølge;
// parseCodeSession gir forelder (local_-id fra notatmappa), gren (gitBranch) og teller systemmeldinger. Hooken: økt-saken er en samtale-sak (kind samtale, kilde Claude Code,
// tittel uten «Økt: »), Oppgaver med klokkeslett og bare menneskeprompter, HELE siste svar og HELE fillista i L, S = siste vending, M etter regel (M_av regel), gren og vert i fila.
// (B) kobling: barneøkt → forelderens samtale er arbeidet (hører_til, grunn forelder) alt ved første prompt; en import med felles grenstamme kobles (gren); en tittel som matcher et
// arbeid kobles (tittel); ellers forslag (hører_til_forslag = nyeste åpne arbeid); Nei huskes. Filer skrevet henger på arbeidet. løpFor: samtaler, filer, tråder, tidslinje nyeste nederst;
// delAv («Del av: … · samtale 2 av 3»); «Vurder dette arbeidet» gjennom motoren med test-mottakere: prompt-, svar-, Forskjeller- og konklusjon-sakene får hører_til;
// vurderPakke (arbeidet + siste samtale + filene, fast prompt; prompten kan endres); review --samtaler på gammelt format (dry-run viser, ekte skriver); broen: /api/atoms-feltene,
// /api/arbeid, /api/hoerer-til, /api/arbeid/merk, /api/arbeid/vurder, /api/siden-sist (Arbeid i gang + forslag), /api/settings spor, /api/samtaler/gjennomgang (SSE, dry-run), /api/spor med hørerTil.
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
for (const d of [ROOT, DATA, HJEM, CODE_HOME, COWORK, FINDER_TOM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODE_HOME = CODE_HOME
process.env.TUA_COWORK_ROOT = COWORK
fs.mkdirSync(path.join(HJEM, '.tua'), { recursive: true }); fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [FINDER_TOM] } }) + '\n')

const store = await import('./store.js')
const { load, save, upsert, statusOf } = store
const imp = await import('./import.js')
const { stripReminders, parseCodeSession, importCode, forelderAv, erBarneØkt, samtaleM, samtaleFraSak, promptKey } = imp
const arb = await import('./arbeid.js')
const { spor } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const les = (id) => load().find((a) => a.id === id)

// ── det falske ~/.claude/projects-treet: Energima-prosjektet ────────────────
const CWD = '/Users/test/Energima'
const PROSJEKTDIR = path.join(CODE_HOME, '.claude', 'projects', '-Users-test-Energima')
fs.mkdirSync(PROSJEKTDIR, { recursive: true })
const T0 = Date.parse('2026-10-24T09:00:00+02:00')
const PARENT_LOCAL = 'local_aaaaaaaa-1111-2222-3333-444444444444', CHILD_LOCAL = 'local_bbbbbbbb-1111-2222-3333-444444444444'
const START = { 'pppppppp-0000-0000-0000-000000000001': 0, 'cccccccc-0000-0000-0000-000000000002': 10, 'dddddddd-0000-0000-0000-000000000003': 30, 'ffffffff-0000-0000-0000-000000000004': 60 }   // minutter etter T0 — hver samtale begynner på sitt tidspunkt
const linje = (type, content, i, extra = {}) => JSON.stringify({ type, message: { role: type, content: Array.isArray(content) ? content : [{ type: 'text', text: content }] }, cwd: CWD, sessionId: extra.sessionId || 'x', timestamp: new Date(T0 + ((START[extra.sessionId] || 0) + i) * 60000).toISOString(), gitBranch: 'main', ...extra })
const tittelLinje = (sid, t) => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: sid })
const LANGT_SVAR = 'Her er utkastet til anken. ' + 'Punkt om saksbehandlingsfeil, frister og dokumentasjon som må legges ved. '.repeat(60) + 'Avslutningsvis: anken sendes innen fristen.'
// forelderøkta (styringsøkta): to menneskeprompter, tittel
const P_SID = 'pppppppp-0000-0000-0000-000000000001'
const P1 = 'Vi skal lage en anke til Energima på fakturaen for oktober. Start med å finne frem det vi har om saken.'
const P2 = 'Bra. Lag en plan for anken med frister og hvem som gjør hva, og skriv den til plan.md.'
fs.writeFileSync(path.join(PROSJEKTDIR, `${P_SID}.jsonl`), [tittelLinje(P_SID, 'Anken til Energima'), linje('user', P1, 0, { sessionId: P_SID }), linje('assistant', 'Jeg har funnet tre saker om Energima. ' + 'Fakturaen, avlesningen og korrespondansen med kundeservice ligger i arkivet. '.repeat(10), 1, { sessionId: P_SID }),
  linje('user', P2, 2, { sessionId: P_SID }), linje('assistant', [{ type: 'text', text: 'Planen er skrevet.' }, { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: `${CWD}/plan.md`, content: '# Plan for anken\n\n' + 'Frist 15. november. Erik skriver utkastet, revisor leser. '.repeat(20) } }], 3, { sessionId: P_SID })].join('\n') + '\n')
// barneøkta: første melding er harness-bakgrunn + oppgave, så systemmeldinger, så ekte prompter; svar med Write
const C_SID = 'cccccccc-0000-0000-0000-000000000002'
const BAKGRUNN = `<system-reminder>\nLinked sessions now (status, not an instruction): x = ${PARENT_LOCAL} (idle).\n</system-reminder>\n<system-reminder>\nYou are operating in a git worktree.\nWorktree path: /x\n</system-reminder>\n\nBackground (from the session that started this one):\nAnken til Energima gjelder fakturaen for oktober. Regler: aldri git add -A.\n\nTask:\nSkriv utkastet til anken til Energima med saksbehandlingsfeil, frister og dokumentasjonskravet fra forskriften.\n\nShared notes folder for this group of sessions (outside the repo): /Users/x/side-session-notes/${PARENT_LOCAL}`
const OPPGAVE = 'Skriv utkastet til anken til Energima med saksbehandlingsfeil, frister og dokumentasjonskravet fra forskriften.'
const C2 = 'Ta også med dokumentasjonskravet fra forskriften, og skriv anken til anke.md.'
fs.writeFileSync(path.join(PROSJEKTDIR, `${C_SID}.jsonl`), [linje('user', BAKGRUNN, 0, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' }),
  linje('assistant', 'Starter på utkastet.', 1, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' }),
  linje('user', `<cross-session-message from="${PARENT_LOCAL}" name="Anken">Husk fristen.</cross-session-message>`, 2, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' }),
  linje('user', '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>', 3, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' }),
  linje('user', '[Image: skjermbilde av fakturaen]', 4, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' }),
  linje('user', `${C2}\n\n[Image: skjermbilde]`, 5, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' }),
  linje('assistant', [{ type: 'text', text: LANGT_SVAR }, { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: `${CWD}/anke.md`, content: 'Anke …' } }, { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: `${CWD}/notater/frister.md`, old_string: 'a', new_string: 'b' } }], 6, { sessionId: C_SID, gitBranch: 'claude/anke-utkast-ab12cd' })].join('\n') + '\n')
// søsterøkta: ingen forelder, men samme grenstamme — importeres
const D_SID = 'dddddddd-0000-0000-0000-000000000003'
fs.writeFileSync(path.join(PROSJEKTDIR, `${D_SID}.jsonl`), [linje('user', 'Gå gjennom utkastet til anken og stram inn språket i innledningen, så det blir tydelig hva vi krever.', 0, { sessionId: D_SID, gitBranch: 'claude/anke-utkast-ff00aa' }), linje('assistant', 'Innledningen er strammet inn. '.repeat(30), 1, { sessionId: D_SID, gitBranch: 'claude/anke-utkast-ff00aa' })].join('\n') + '\n')
// tittel-økta: tittelen er arbeidets navn, egen gren
const F_SID = 'ffffffff-0000-0000-0000-000000000004'
fs.writeFileSync(path.join(PROSJEKTDIR, `${F_SID}.jsonl`), [tittelLinje(F_SID, 'Anken til Energima — vedlegg'), linje('user', 'Lag lista over vedleggene til anken: faktura, korrespondanse og måleravlesninger.', 0, { sessionId: F_SID, gitBranch: 'claude/vedlegg-123456' }), linje('assistant', 'Lista over vedlegg er laget. '.repeat(30), 1, { sessionId: F_SID, gitBranch: 'claude/vedlegg-123456' })].join('\n') + '\n')

const hook = (mode, input, env = {}) => spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), mode], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } })

// ── A1) filtreringen ─────────────────────────────────────────────────────────
{
  const t = stripReminders(BAKGRUNN)
  ok('stripReminders: bakgrunnen fra startøkta, påminnelsene og notatmappe-linja er ute — oppgaven står', t === OPPGAVE, JSON.stringify(t))
  ok('stripReminders: <cross-session-message …>, <task-notification> og [Image: …] blir tomt (ikke et menneskes melding)', stripReminders(`<cross-session-message from="x" name="y">hei</cross-session-message>`) === '' && stripReminders('<task-notification>\n<task-id>a</task-id>\n</task-notification>') === '' && stripReminders('[Image: bilde]') === '' && imp.erHarnessTekst('[Image: bilde]'))
  ok('stripReminders: menneskets tekst rundt en systemblokk beholdes, rekkefølgen med', stripReminders(`Først dette.\n<side-sessions-event>x</side-sessions-event>\nSå dette.`) === 'Først dette.\n\nSå dette.' && stripReminders(`${C2}\n\n[Image: skjermbilde]`) === C2)
  ok('stripReminders: «The user hasn\'t heard from you …» og <~cross-session-message> (escapet form) går også ut', stripReminders("The user hasn't heard from you in a while — say in a few words what you're doing, then continue.") === '' && stripReminders('<~task-notification>x</~task-notification>\nJa, gjør det slik.') === 'Ja, gjør det slik.')
  ok('forelderAv / erBarneØkt: forelderens local_-id fra notatmappa; barneøkt gjenkjennes', forelderAv(BAKGRUNN) === PARENT_LOCAL && erBarneØkt(BAKGRUNN) && !erBarneØkt(P1))
  const s = parseCodeSession(path.join(PROSJEKTDIR, `${C_SID}.jsonl`))
  ok('parseCodeSession (barneøkta): 2 menneskeprompter (oppgaven og C2), 3 systemmeldinger talt, forelder, gren, barn, siste svar helt, to filer', s.prompts.length === 2 && s.prompts[0] === OPPGAVE && s.prompts[1] === C2 && s.harness === 3 && s.forelder === PARENT_LOCAL && s.gren === 'claude/anke-utkast-ab12cd' && s.barn && s.lastAssistant === LANGT_SVAR && s.files.has(`${CWD}/anke.md`) && s.edited.has(`${CWD}/notater/frister.md`), JSON.stringify([s.prompts.map((p) => p.slice(0, 30)), s.harness, s.forelder, s.gren]))
  const m = samtaleM({ ...s, filer: [...s.files.keys(), ...s.edited], kilde: 'Claude Code' })
  ok('samtaleM: første spørsmål + filene + siste svar (kortet) + hale med kilde og vendinger, ≤ 2 500 tegn', m.startsWith('**Første spørsmål:** Skriv utkastet') && m.includes('**Filer skrevet (2):** anke.md · frister.md') && m.includes('**Siste svar:** Her er utkastet til anken.') && /_Claude Code · 2 vendinger · 24\.10\.2026_$/.test(m) && m.length <= 2500, m.slice(-80))
}

// ── A2 + B) hooken: forelderøkta, så barneøkta ───────────────────────────────
let P_ID = null, C_ID = null
{
  const r0 = hook('start', { session_id: P_SID, transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke.jsonl'), cwd: CWD, hook_event_name: 'SessionStart' }, { CLAUDE_CODE_HOST_SESSION_ID: PARENT_LOCAL })
  ok('hook start (ingen arbeid ennå): ingen samtale-sak lages, ingen arbeid-linje', r0.status === 0 && !load().some((a) => a.key === `okt:${P_SID}`) && !/arbeidet|foreslår/.test(r0.stdout), r0.stdout.slice(0, 200))
  const r1 = hook('prompt', { session_id: P_SID, transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke-enda.jsonl'), cwd: CWD, prompt: P1, hook_event_name: 'UserPromptSubmit' }, { CLAUDE_CODE_HOST_SESSION_ID: PARENT_LOCAL })
  const stubb = load().find((a) => a.key === `okt:${P_SID}`)
  ok('hook prompt (første melding): samtale-saken lages som stubb — kind samtale, kilde Claude Code, vert satt, Oppgaver med klokkeslett, fanget, stum', r1.status === 0 && r1.stdout === '' && stubb && stubb.kind === 'samtale' && stubb.source === 'Claude Code' && stubb.vert === PARENT_LOCAL && /## Oppgaver\n- \d{2}:\d{2} — Vi skal lage en anke/.test(stubb.content) && stubb.fanget === true && !stubb.hørerTil && !stubb.hørerTilForslag, JSON.stringify([r1.status, r1.stdout, stubb?.kind, stubb?.vert]))
  const r2 = hook('okt', { session_id: P_SID, transcript_path: path.join(PROSJEKTDIR, `${P_SID}.jsonl`), cwd: CWD, hook_event_name: 'SessionEnd' }, { CLAUDE_CODE_HOST_SESSION_ID: PARENT_LOCAL })
  const p = load().find((a) => a.key === `okt:${P_SID}`)
  P_ID = p?.id
  ok('hook okt (forelderøkta): tittelen er samtalens tittel uten «Økt: », kind samtale, tagger samtale+code, gren main, S = siste vending, M etter regel (M_av regel)', r2.status === 0 && p && p.name === 'Anken til Energima' && p.kind === 'samtale' && p.tags.includes('samtale') && !p.tags.includes('økt') && p.gren === 'main' && p.levels?.S?.text.startsWith('Sist: Bra. Lag en plan') && p.levels?.M?.text.startsWith('**Første spørsmål:** Vi skal lage en anke') && p.levels.M.by === 'regel', JSON.stringify([p?.name, p?.kind, p?.tags, p?.gren, p?.levels?.S?.text?.slice(0, 40), p?.levels?.M?.by]))
  ok('hook okt: L har begge oppgavene med klokkeslett, fillista (plan.md) og «Siste svar» helt; createdAt = første melding', /## Oppgaver\n- \d{2}:\d{2} — Vi skal lage en anke[^\n]*\n- \d{2}:\d{2} — Bra\. Lag en plan/.test(p.content) && p.content.includes(`## Filer skrevet\n- ${CWD}/plan.md`) && p.content.endsWith('## Siste svar\nPlanen er skrevet.') && p.createdAt === T0, p.content.slice(0, 300))
  const fil = fs.readFileSync(store.fileOf(p), 'utf8')
  ok('fila: kind samtale, kilde «Claude Code», gren og vert i frontmatter, M_av regel', /kind: "samtale"/.test(fil) && /kilde: "Claude Code"/.test(fil) && /gren: "main"/.test(fil) && new RegExp(`vert: "${PARENT_LOCAL}"`).test(fil) && /M_av: "regel"/.test(fil))

  // barneøkta: ved start finnes ikke noe arbeid (forelderen har ingen følgere) → ingen stubb; ved første prompt (bakgrunnen) → forelderen funnet → hører_til forelderen
  const c0 = hook('start', { session_id: C_SID, transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke.jsonl'), cwd: CWD, hook_event_name: 'SessionStart' }, { CLAUDE_CODE_HOST_SESSION_ID: CHILD_LOCAL, CLAUDE_CODE_CHILD_SESSION: '1' })
  ok('hook start (barneøkta, forelderen er ikke arbeid ennå): ingen stubb', c0.status === 0 && !load().some((a) => a.key === `okt:${C_SID}`))
  const c1 = hook('prompt', { session_id: C_SID, transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke-enda.jsonl'), cwd: CWD, prompt: BAKGRUNN, hook_event_name: 'UserPromptSubmit' }, { CLAUDE_CODE_HOST_SESSION_ID: CHILD_LOCAL, CLAUDE_CODE_CHILD_SESSION: '1' })
  const cs = load().find((a) => a.key === `okt:${C_SID}`)
  C_ID = cs?.id
  ok('hook prompt (barneøkta, første melding = bakgrunn): samtale-saken hører til forelderens samtale (grunn forelder), Oppgaver har bare oppgaven', c1.status === 0 && cs && cs.hørerTil === P_ID && !cs.hørerTilForslag && /- \d{2}:\d{2} — Skriv utkastet til anken/.test(cs.content) && !cs.content.includes('Background'), JSON.stringify([cs?.hørerTil, P_ID, cs?.content?.slice(0, 200)]))
  const pr = load().find((a) => a.key === promptKey(C_SID, OPPGAVE))
  ok('hook prompt: prompt-saken har bare den rensede teksten (samme nøkkel som importen), ikke bakgrunnen', pr && pr.content === OPPGAVE && !load().some((a) => a.kind === 'prompt' && a.content.includes('Background (from')))
  // fil-modus: dokumentet henger på arbeidet
  const fp = path.join(SCRATCH, 'repo', 'anke.md'); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, '# Anke til Energima\n\n' + 'Vi anker fakturaen for oktober fordi avlesningen er feil. '.repeat(20))
  const c2 = hook('fil', { session_id: C_SID, transcript_path: path.join(PROSJEKTDIR, `${C_SID}.jsonl`), cwd: CWD, tool_name: 'Write', tool_input: { file_path: fp } }, { CLAUDE_CODE_HOST_SESSION_ID: CHILD_LOCAL, TUA_HOOK_ALLOW_TMP: '1' })
  const fa = load().find((a) => a.key === `fil:${fp}`)
  ok('hook fil: fil-saken hører til samme arbeid som samtalen', c2.status === 0 && fa && fa.hørerTil === P_ID, JSON.stringify([c2.stderr.slice(0, 100), fa?.hørerTil]))
  const c3 = hook('okt', { session_id: C_SID, transcript_path: path.join(PROSJEKTDIR, `${C_SID}.jsonl`), cwd: CWD, hook_event_name: 'PreCompact', trigger: 'auto' }, { CLAUDE_CODE_HOST_SESSION_ID: CHILD_LOCAL })
  const c = load().find((a) => a.key === `okt:${C_SID}`)
  ok('hook okt (barneøkta): Oppgaver har de to menneskepromptene og ingen systemtekst, L har hele det lange svaret og begge filene, koblingen står, gren fra transkriptet', c3.status === 0 && c.hørerTil === P_ID && c.content.includes(`## Oppgaver\n`) && (c.content.match(/^- \d{2}:\d{2} — /gm) || []).length === 2 && !/cross-session|task-notification|Image:|Background/.test(c.content) && c.content.endsWith(LANGT_SVAR) && c.content.includes(`- ${CWD}/anke.md\n- ${CWD}/notater/frister.md`) && c.gren === 'claude/anke-utkast-ab12cd' && c.name === OPPGAVE.slice(0, 59) + '…', JSON.stringify([c3.status, c3.stderr.slice(0, 120), (c.content.match(/^- \d{2}:\d{2} — /gm) || []).length, c.gren, c.name]))
  ok('hook okt: M er regel-sammendraget med første spørsmål, filene og siste svar; samtalen igjen med samme transkript = uendret', c.levels?.M?.text.includes('**Filer skrevet (2):** anke.md · frister.md') && c.levels.M.text.includes('**Siste svar:** Her er utkastet') && (() => { const før = c.version; hook('okt', { session_id: C_SID, transcript_path: path.join(PROSJEKTDIR, `${C_SID}.jsonl`), cwd: CWD, hook_event_name: 'PreCompact', trigger: 'auto' }, { CLAUDE_CODE_HOST_SESSION_ID: CHILD_LOCAL }); return les(c.id).version === før })())
}

// ── B) regelen: gren og tittel via importen; forslag ellers ────────────────────
{
  const r = importCode({ log: () => {} })
  const atoms = load()
  const d = atoms.find((a) => a.key === `samtale:${D_SID}`), f = atoms.find((a) => a.key === `samtale:${F_SID}`)
  ok('import: søsterøkta med felles grenstamme (claude/anke-utkast-…) hører til forelderens arbeid (gren); rapporten teller koblingene', d && d.hørerTil === P_ID && d.gren === 'claude/anke-utkast-ff00aa' && (r.stats.koblet || 0) >= 2 && /Arbeid \(friksjon 20\)/.test(r.report), JSON.stringify([d?.hørerTil, P_ID, r.stats.koblet]))
  ok('import: økta med tittelen «Anken til Energima — vedlegg» kobles til arbeidet «Anken til Energima» (tittel)', f && f.hørerTil === P_ID, JSON.stringify([f?.hørerTil, f?.name]))
  ok('import: M etter regel på importerte samtaler; hookens samtale-saker (okt:) er de samme sakene — ingen dublett for forelder og barn, rapporten sier det', d.levels?.M?.by === 'regel' && d.levels.M.text.startsWith('**Første spørsmål:** Gå gjennom utkastet') && atoms.filter((a) => a.kind === 'samtale' && a.project === 'Energima').length === 4 && !atoms.some((a) => a.key === `samtale:${P_SID}` || a.key === `samtale:${C_SID}`) && r.stats.hook === 2 && /2 alt lagret av hooken/.test(r.report), JSON.stringify(atoms.filter((a) => a.kind === 'samtale').map((a) => [a.key, a.name])))
  const planFil = atoms.find((a) => a.key === `fil:${CWD}/plan.md`)
  ok('import: plan.md skrevet i forelderøkta ble en fil-sak med samtalenavnet (henger på arbeidet via samtalen)', planFil && planFil.convo === 'Anken til Energima', JSON.stringify(planFil && [planFil.convo, planFil.hørerTil]))
  const regel = arb.arbeidForslag(atoms, { prosjekt: 'Energima', tittel: 'Noe helt annet om strømprisene', gren: 'main', sid: 'ny' })
  ok('arbeidForslag uten treff: ingen kobling, forslag = det åpne arbeidet (Anken), med åpne-lista', regel.hørerTil === null && regel.forslag === P_ID && regel.åpne[0].id === P_ID && regel.åpne[0].samtaler >= 3, JSON.stringify(regel))
  ok('arbeidForslag: grener uten stamme (main, HEAD) kobler aldri; en gren som deler stamme med forelderens egen gren «main» heller ikke', arb.arbeidForslag(atoms, { prosjekt: 'Energima', tittel: 'x', gren: 'HEAD', sid: 'ny' }).hørerTil === null && arb.grenStamme('claude/anke-utkast-ab12cd') === 'claude/anke-utkast' && arb.grenStamme('main') === 'main')
  ok('arbeidForslag i et annet prosjekt: ingen forslag', arb.arbeidForslag(atoms, { prosjekt: 'Hytta', tittel: 'Anken til Energima', gren: 'claude/anke-utkast-000000', sid: 'ny' }).forslag === null)
  // en ny økt uten treff → hooken setter forslaget; Nei huskes; Ja kobler
  const E_SID = 'eeeeeeee-0000-0000-0000-000000000005'
  const e1 = hook('prompt', { session_id: E_SID, transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke-e.jsonl'), cwd: CWD, prompt: 'Sjekk strømprisene for november og lag en oversikt over hva vi betalte mot spot.', hook_event_name: 'UserPromptSubmit' }, { CLAUDE_CODE_HOST_SESSION_ID: 'local_eeee' })
  let e = load().find((a) => a.key === `okt:${E_SID}`)
  ok('hook prompt (ny økt uten treff): samtale-saken får hører_til_forslag = arbeidet, ingen hører_til', e1.status === 0 && e && e.hørerTilForslag === P_ID && !e.hørerTil && arb.harForslag(e), JSON.stringify([e?.hørerTilForslag, e?.hørerTil]))
  const e0 = hook('start', { session_id: 'ffffffff-1111-0000-0000-000000000006', transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke-f.jsonl'), cwd: CWD, hook_event_name: 'SessionStart' }, { CLAUDE_CODE_HOST_SESSION_ID: 'local_ffff' })
  const st = load().find((a) => a.key === 'okt:ffffffff-1111-0000-0000-000000000006')
  ok('hook start (ny økt, et åpent arbeid finnes): stubb med forslag lages, og Claude får linja «Tua foreslår … tua_link(id=…, arbeid=…)»', e0.status === 0 && st && st.hørerTilForslag === P_ID && /Tua foreslår at denne samtalen hører til arbeidet «Anken til Energima»/.test(e0.stdout) && e0.stdout.includes(`tua_link(id="${st.id}", arbeid="${P_ID}")`), e0.stdout.slice(0, 300))
  let atoms2 = load()
  arb.avvisForslag(atoms2, e.id); save(atoms2)
  e = les(e.id)
  ok('avvisForslag: Nei huskes i fila (hører_til_forslag: nei) — harForslag false, og hooken foreslår ikke igjen', e.hørerTilForslag === 'nei' && !arb.harForslag(e) && (() => { hook('okt', { session_id: E_SID, transcript_path: path.join(PROSJEKTDIR, 'finnes-ikke-e.jsonl'), cwd: CWD, hook_event_name: 'SessionEnd' }); return les(e.id).hørerTilForslag === 'nei' })())
  atoms2 = load()
  const r2 = arb.settHørerTil(atoms2, e.id, P_ID); save(atoms2)
  ok('settHørerTil: koblet, forslaget borte; sløyfe og seg selv avvises', r2.endret && les(e.id).hørerTil === P_ID && !les(e.id).hørerTilForslag && (() => { try { arb.settHørerTil(load(), P_ID, e.id); return false } catch (x) { return /sløyfe/.test(x.message) } })() && (() => { try { arb.settHørerTil(load(), P_ID, P_ID); return false } catch (x) { return /seg selv/.test(x.message) } })())
  atoms2 = load()
  const r3 = arb.løsne(atoms2, e.id); save(atoms2)
  ok('løsne: koblingen borte', r3.endret && !les(e.id).hørerTil)
  atoms2 = load(); arb.settHørerTil(atoms2, e.id, P_ID); save(atoms2)
}

// ── B) løpet, Del av, arbeidene ─────────────────────────────────────────────
{
  const atoms = load()
  const liste = arb.arbeider(atoms, { prosjekt: 'Energima' })
  ok('arbeider: ett arbeid i Energima — Anken — med 4 samtaler (barn, søster, vedlegg, strømpris), filer og sist', liste.length === 1 && liste[0].id === P_ID && liste[0].samtaler === 4 && liste[0].filer >= 2 && liste[0].åpen && liste[0].sist > 0, JSON.stringify(liste))
  const l = arb.løpFor(atoms, P_ID)
  ok('løpFor: samtalene nummerert i tidsrekkefølge, filene (anke.md fra fil-modus + via samtalenavn), tidslinja stiger (nyeste nederst), tallene', l.arbeid && l.samtaler.length === 4 && l.samtaler[0].nr === 1 && l.filer.length >= 2 && l.tidslinje.every((r, i, arr) => i === 0 || r.tid >= arr[i - 1].tid) && l.tall.samtaler === 4 && l.tidslinje.some((r) => r.type === 'fil' && r.href) && l.tidslinje.some((r) => r.type === 'samtale' && r.kilde === 'Claude Code'), JSON.stringify([l.tall, l.tidslinje.map((r) => r.type)]))
  const d = arb.delAv(atoms, les(C_ID))
  ok('delAv (barneøkta): «Del av: Anken til Energima · samtale 1 av 4»', d && d.id === P_ID && d.slag === 'samtale' && d.nr === 1 && d.av === 4 && d.tekst === 'Del av: Anken til Energima · samtale 1 av 4', JSON.stringify(d))
  ok('delAv på arbeidet selv og på en sak uten kobling: null', arb.delAv(atoms, les(P_ID)) === null)
  ok('erArbeid: forelderen er arbeid via følgere (uten flagg); gjørTilArbeid setter flagg og status utkast på en ny sak', arb.erArbeid(les(P_ID), arb.følgereAv(atoms)) && !les(P_ID).arbeid && (() => { const a2 = load(); const ny = upsert(a2, { key: 'sak:plan', name: 'Plan for anken', content: 'Planen. '.repeat(50), project: 'Energima', by: 'regel', short: 'Planen.' }).atom; arb.gjørTilArbeid(a2, ny.id); save(a2); const x = les(ny.id); return x.arbeid === true && statusOf(x) === 'utkast' && arb.erArbeid(x) })())
}

// ── B6) «Vurder dette arbeidet» gjennom motoren ─────────────────────────────
let vurderPrompt = null
{
  const atoms = load()
  const pk = arb.vurderPakke(atoms, P_ID)
  ok('vurderPakke (arbeidet): arbeidet først, så siste samtale, så filene; fast prompt (standard); hørerTil = arbeidet', pk.kilder[0].id === P_ID && pk.siste && pk.kilder.some((k) => k.id === pk.siste.id) && pk.kilder.some((k) => k.hvorfor === 'fil skrevet i løpet') && pk.prompt === arb.VURDERING_STANDARD && pk.standard && pk.hørerTil === P_ID, JSON.stringify(pk.kilder.map((k) => k.hvorfor)))
  const pk2 = arb.vurderPakke(atoms, C_ID)
  ok('vurderPakke (en samtale-sak): samtalen først + filene den skrev, og svarene henger på samtalens arbeid', pk2.kilder[0].id === C_ID && pk2.hørerTil === P_ID && pk2.kilder.some((k) => k.hvorfor === 'fil skrevet i samtalen'), JSON.stringify([pk2.hørerTil, pk2.kilder.map((k) => k.hvorfor)]))
  const r = await spor({ melding: pk.prompt, saker: pk.kilder.map((k) => ({ id: k.id, nivå: 'M' })), mottakere: ['test', 'test2'], prosjekt: 'Energima', hørerTil: pk.hørerTil })
  vurderPrompt = r.prompt
  const etter = load()
  const pr = etter.find((a) => a.id === r.prompt), sv = r.svar.map((id) => etter.find((a) => a.id === id)), fsk = etter.find((a) => a.id === r.forskjeller?.sak), k = etter.find((a) => a.id === r.konklusjon?.id)
  ok('spor med hørerTil: prompt-, svar-, Forskjeller- og konklusjon-sakene har hører_til = arbeidet', pr?.hørerTil === P_ID && sv.length === 2 && sv.every((s) => s?.hørerTil === P_ID) && fsk?.hørerTil === P_ID && k?.hørerTil === P_ID, JSON.stringify([pr?.hørerTil, sv.map((s) => s?.hørerTil), fsk?.hørerTil, k?.hørerTil]))
  const l = arb.løpFor(etter, P_ID)
  ok('løpFor etterpå: tråden med 2 svar og konklusjon (utkast) i løpet, rader for spørsmål/svar/konklusjon i tidslinja, utlevert-rader (test-mottakerne logges)', l.tråder.length === 1 && l.tråder[0].svar.length === 2 && l.tråder[0].konklusjon?.status === 'utkast' && l.tidslinje.some((x) => x.type === 'konklusjon') && l.tidslinje.filter((x) => x.type === 'svar').length === 2 && l.tall.tråder === 1, JSON.stringify(l.tall))
  ok('delAv på prompten: «Del av: Anken til Energima · tråd 1 av 1»', arb.delAv(etter, pr)?.tekst === 'Del av: Anken til Energima · tråd 1 av 1')
  // kjør igjen uten hørerTil: arver fra prompten
  const r2 = await spor({ melding: pk.prompt, saker: [], mottakere: ['test'], prosjekt: 'Energima', prompt: r.prompt })
  ok('kjør igjen uten hørerTil: svaret arver koblingen fra prompt-saken', les(r2.svar)?.hørerTil === P_ID)
  // prompten kan endres
  const egen = 'Vurder arbeidet som en revisor: tall, frister og hjemler.'
  ok('settVurderingsprompt: egen prompt lagres i ~/.tua/config.json og brukes i pakken; tom = standard igjen', arb.settVurderingsprompt(egen) === egen && arb.vurderPakke(load(), P_ID).prompt === egen && !arb.vurderPakke(load(), P_ID).standard && JSON.parse(fs.readFileSync(path.join(HJEM, '.tua', 'config.json'), 'utf8')).spor.vurderingsprompt === egen && arb.settVurderingsprompt('') === arb.VURDERING_STANDARD)
}

// ── A1) review --samtaler på gammelt format ─────────────────────────────────
{
  const atoms = load()
  const gammelL = `# Økt: Faktura-sjekk\n\n_Energima · 3 oppgaver · 20.10.2026, 10:00 – 20.10.2026, 11:00 · SessionEnd_\n\n## Oppgaver\n- Sjekk fakturaen for september mot måleravlesningen\n- <system-reminder>noe</system-reminder>\n- Lag en tabell\n\n## Filer skrevet\n- /Users/test/Energima/faktura.md\n\n## Siste svar\nTabellen er laget og fakturaen avviker med 12 prosent fra avlesningen. Dette bør tas opp…`
  const g = upsert(atoms, { key: 'okt:gammel-0000', name: 'Økt: Faktura-sjekk', content: gammelL, project: 'Energima', convo: 'Faktura-sjekk', source: 'Claude', by: 'regel', tags: ['økt', 'auto'], short: 'Økt-sammendrag laget automatisk.', fanget: true }).atom
  const menneske = upsert(atoms, { key: 'samtale:menneske', kind: 'samtale', name: 'Møtet med Energima', content: `# Møtet\n\n_Claude Desktop · 2 meldinger · 2026-10-01_\n\n**Bruker:** Hva sa de?\n\n**Claude:** De lovte å se på saken.`, project: 'Energima', source: 'Claude Desktop', by: 'menneske', short: 'Eriks egen ingress om møtet.', medium: 'Eriks eget sammendrag.' }).atom
  save(atoms)
  const r = samtaleFraSak(gammelL)
  ok('samtaleFraSak (hookens gamle form): to oppgaver (systemblokken er ikke en prompt-linje den tar med som tekst), fila, siste svar, S og M', r && r.prompts.length === 3 && r.filer[0] === '/Users/test/Energima/faktura.md' && r.lastAssistant.startsWith('Tabellen er laget') && r.S.startsWith('Sist: Lag en tabell → Tabellen er laget') && r.M.includes('**Filer skrevet (1):** faktura.md'), JSON.stringify(r && [r.prompts, r.S]))
  const env = { ...process.env }
  const kjør = (...args) => spawnSync(process.execPath, [path.join(HERE, 'review.js'), ...args], { env, encoding: 'utf8' })
  const dry = kjør('--samtaler', '--dry-run')
  ok('review --samtaler --dry-run: teller, viser hva den gamle økt-saken får (S, M, tittel, kind), menneskeskrevet røres ikke, skriver ingenting', dry.status === 0 && /får ny S\/M/.test(dry.stdout) && /1 menneskeskrevet/.test(dry.stdout) && /DRY-RUN/.test(dry.stdout) && /Faktura-sjekk\s+\[S, M, tittel, kind\]/.test(dry.stdout) && les(g.id).name === 'Økt: Faktura-sjekk' && les(g.id).kind === 'capture', dry.stdout.split('\n').slice(0, 3).join(' | ') + (dry.stderr ? ' | ' + dry.stderr.slice(0, 200) : ''))
  const ekte = kjør('--samtaler')
  const g2 = les(g.id), m2 = les(menneske.id)
  ok('review --samtaler: tittelen uten «Økt: », kind samtale, tagg samtale, S = siste vending, M etter regel (M_av regel); menneskeskrevet S/M står', ekte.status === 0 && g2.name === 'Faktura-sjekk' && g2.kind === 'samtale' && g2.tags.includes('samtale') && g2.levels.S.text.startsWith('Sist: Lag en tabell') && g2.levels.M?.by === 'regel' && m2.levels.S.text === 'Eriks egen ingress om møtet.' && m2.levels.M.text === 'Eriks eget sammendrag.' && m2.name === 'Møtet med Energima', JSON.stringify([g2.name, g2.kind, g2.levels?.M?.by, ekte.stdout.split('\n')[0]]))
  ok('review --samtaler igjen: uendret', /· 0 får ny S\/M/.test(kjør('--samtaler', '--dry-run').stdout))
}

// ── broen ───────────────────────────────────────────────────────────────────
{
  const DIST = path.join(HERE, '..', '..', 'tua2-sandbox', 'dist')
  const PORT = 5321
  const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
  let logg = ''; bro.stderr.on('data', (d) => { logg += d })
  for (let i = 0; i < 60 && !logg.includes('[tua-bro] appen'); i++) await vent(100)
  const B = `http://127.0.0.1:${PORT}`
  const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, json: await r.json().catch(() => ({})) } }
  const post = async (p, body) => { const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
  const sse = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const text = await r.text(); return { status: r.status, events: text.split('\n\n').filter(Boolean).map((b) => ({ ev: b.match(/^event: (.+)$/m)?.[1], d: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || 'null') })) } }
  try {
    const a = await get('/api/atoms')
    const P = a.json.atoms.find((x) => x.id === P_ID), C = a.json.atoms.find((x) => x.id === C_ID)
    ok('GET /api/atoms: arbeidet har arbeid: true med arbeid_tall; barneøkta har hører_til og del_av; en sak uten kobling har hører_til null', P?.arbeid === true && P.arbeid_tall?.samtaler === 4 && P.arbeid_tall.tråder === 1 && C?.hører_til === P_ID && C.del_av?.tekst === 'Del av: Anken til Energima · samtale 1 av 4' && a.json.atoms.some((x) => x.hører_til === null && !x.arbeid), JSON.stringify([P?.arbeid_tall, C?.del_av]))
    const l = await get(`/api/arbeid?id=${P_ID}`)
    ok('GET /api/arbeid?id: løpet med samtaler, tråder, filer, tidslinje og tall', l.status === 200 && l.json.samtaler.length === 4 && l.json.tråder.length === 1 && l.json.filer.length >= 2 && l.json.tidslinje.length > 6 && l.json.tall.samtaler === 4, JSON.stringify(l.json.tall))
    ok('GET /api/arbeid (liste): arbeidene i prosjektet', (await get('/api/arbeid?prosjekt=Energima')).json.arbeider.some((r) => r.id === P_ID))
    ok('GET /api/arbeid?id=finnes-ikke → 404', (await get('/api/arbeid?id=a_finnes_ikke')).status === 404)
    const s = await get(`/api/sak?id=${C_ID}`)
    ok('GET /api/sak: hører_til, del_av og arbeid med', s.json.hører_til === P_ID && s.json.del_av?.nr === 1 && s.json.arbeid === false)
    // hoerer-til: løsne, koble, forslag nei
    const u = await post('/api/hoerer-til', { id: C_ID, arbeid: null })
    ok('POST /api/hoerer-til {arbeid: null}: løsner, svarer med saken og før', u.status === 200 && u.json.atom.hører_til === null && u.json.før === P_ID)
    const k = await post('/api/hoerer-til', { id: C_ID, arbeid: P_ID })
    ok('POST /api/hoerer-til {arbeid}: kobler, del_av tilbake', k.status === 200 && k.json.atom.hører_til === P_ID && k.json.arbeid?.id === P_ID && k.json.atom.del_av?.id === P_ID)
    ok('POST /api/hoerer-til sløyfe → 400; ukjent sak → 404', (await post('/api/hoerer-til', { id: P_ID, arbeid: C_ID })).status === 400 && (await post('/api/hoerer-til', { id: 'a_finnes_ikke', arbeid: P_ID })).status === 404)
    const a1 = load(); const nySak = upsert(a1, { key: 'sak:ny', name: 'Et notat om strømprisene som ikke hører til noe ennå', content: 'Notat. '.repeat(100), project: 'Energima', by: 'regel', short: 'Notat.' }).atom; save(a1)
    { const a2 = load(); const n = upsert(a2, { key: 'sak:ny2', name: 'Strømprisnotat', content: 'Notat. '.repeat(100), project: 'Energima', by: 'regel', short: 'Notat.', hørerTilForslag: P_ID }).atom; save(a2)
      const f = await post('/api/hoerer-til', { id: n.id, forslag: 'nei' })
      ok('POST /api/hoerer-til {forslag: nei}: husket, hører_til_forslag er borte fra /api/atoms', f.status === 200 && les(n.id).hørerTilForslag === 'nei' && !(await get('/api/atoms')).json.atoms.find((x) => x.id === n.id).hører_til_forslag) }
    const m = await post('/api/arbeid/merk', { id: nySak.id })
    ok('POST /api/arbeid/merk: «Gjør til arbeid» — arbeid true, status utkast; av: true tar flagget bort', m.status === 200 && m.json.atom.arbeid === true && m.json.atom.status === 'utkast' && (await post('/api/arbeid/merk', { id: nySak.id, av: true })).json.atom.arbeid === false)
    // Siden sist
    const ss = await get('/api/siden-sist?dager=7')
    const ai = ss.json.arbeider.find((r) => r.id === P_ID)
    ok('GET /api/siden-sist: «Arbeid i gang: Anken til Energima — 4 samtaler, 1 tråd, N filer, sist i dag»; forslagslinja for stubben fra start', ai && /^Arbeid i gang: Anken til Energima — 4 samtaler, 1 tråd, \d+ filer, sist i dag$/.test(ai.tekst) && ss.json.arbeidForslag.some((f) => f.arbeid.id === P_ID && /hører den til «Anken til Energima»\?$/.test(f.tekst)), JSON.stringify([ai?.tekst, ss.json.arbeidForslag.map((f) => f.tekst)]))
    // vurder
    const v = await post('/api/arbeid/vurder', { id: P_ID })
    ok('POST /api/arbeid/vurder: pakken med kilder (ord/tegn/max/vault), prompt, hørerTil og mottakere (standard)', v.status === 200 && v.json.kilder.length >= 3 && v.json.kilder.every((x) => x.ord && x.tegn && x.max === 'L') && v.json.prompt === arb.VURDERING_STANDARD && v.json.hørerTil === P_ID && Array.isArray(v.json.mottakere), JSON.stringify([v.json.kilder.length, v.json.mottakere, v.json.standardMottaker]))
    const sp = await sse(`${B}/api/spor`, { melding: v.json.prompt, saker: v.json.kilder.map((x) => ({ id: x.id, nivå: 'S' })), mottaker: 'test', prosjekt: 'Energima', hørerTil: P_ID })
    const ferdig = sp.events.find((e) => e.ev === 'ferdig')
    ok('POST /api/spor med hørerTil: svaret og prompten henger på arbeidet', ferdig && les(ferdig.d.svar)?.hørerTil === P_ID && les(ferdig.d.prompt)?.hørerTil === P_ID, JSON.stringify(sp.events.map((e) => e.ev)))
    // settings
    const st = await get('/api/settings')
    ok('GET /api/settings: spor.vurderingsprompt (standard) med', st.json.spor?.vurderingsprompt === arb.VURDERING_STANDARD && st.json.spor.erStandard === true)
    const st2 = await post('/api/settings', { spor: { vurderingsprompt: 'Egen prompt for vurderingen.' } })
    ok('POST /api/settings {spor}: prompten endres og leses tilbake; tom gir standard', st2.json.spor?.vurderingsprompt === 'Egen prompt for vurderingen.' && (await get('/api/settings')).json.spor.erStandard === false && (await post('/api/settings', { spor: { vurderingsprompt: '' } })).json.spor.erStandard === true)
    // samtaler på nytt (SSE, dry-run)
    const a3 = load(); upsert(a3, { key: 'okt:gammel-0001', name: 'Økt: Enda en gammel', content: `# Økt: Enda en gammel\n\n_Energima · 1 oppgaver · 20.10.2026_\n\n## Oppgaver\n- Gjør noe\n\n## Siste svar\nGjort.`, project: 'Energima', source: 'Claude', by: 'regel', tags: ['økt', 'auto'], short: 'x', fanget: true }); save(a3)
    const g = await sse(`${B}/api/samtaler/gjennomgang`, { dryRun: true })
    const slutt = g.events.at(-1)
    ok('POST /api/samtaler/gjennomgang {dryRun}: SSE start → sak → slutt med tall og eksempler, ingenting skrevet', g.events[0]?.ev === 'start' && slutt?.ev === 'slutt' && slutt.d.dryRun && slutt.d.saker >= 1 && slutt.d.vis.some((x) => x.name === 'Økt: Enda en gammel') && load().some((x) => x.name === 'Økt: Enda en gammel'), JSON.stringify(slutt?.d && { saker: slutt.d.saker, S: slutt.d.S, M: slutt.d.M, tittel: slutt.d.tittel }))
    const g2 = await sse(`${B}/api/samtaler/gjennomgang`, { dryRun: false, skriver: 'regel' })
    ok('POST /api/samtaler/gjennomgang ekte: skrevet — tittelen uten «Økt: », kind samtale', g2.events.at(-1)?.d.filer >= 1 && load().some((x) => x.name === 'Enda en gammel' && x.kind === 'samtale'))
  } finally { bro.kill() }
}

console.log(feil ? `\n${feil} FEIL · testarkiv: ${ROOT}` : `\nAlt grønt · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
