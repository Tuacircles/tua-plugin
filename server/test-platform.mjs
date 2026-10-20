#!/usr/bin/env node
// test-platform.mjs — kjører fallback-grenene (M18) på en Mac ved å simulere Windows/Linux og en maskin uten skytjenester.
//
//   node server/test-platform.mjs
//
// Hver del kjøres i en egen node-prosess med egne miljøvariabler (platform.js leser dem ved import), mot et tomt
// scratch-arkiv i os.tmpdir(). Ingenting rører det ekte arkivet eller ~/.tua. Avslutter med kode 1 ved første feil.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2]

// ── driver ──────────────────────────────────────────────────────────────────
if (!mode) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-platform-'))
  const cases = [
    ['platform-win32', { TUA_PLATFORM: 'win32', TUA_HOME: path.join(scratch, 'winhome'), APPDATA: path.join(scratch, 'winhome', 'AppData', 'Roaming') }],
    ['platform-linux', { TUA_PLATFORM: 'linux', TUA_HOME: path.join(scratch, 'linuxhome') }],
    ['platform-darwin', { TUA_HOME: path.join(scratch, 'machome') }],
    ['no-cloud', { TUA_PLATFORM: 'win32', TUA_HOME: path.join(scratch, 'nocloud'), TUA_DATA_DIR: path.join(scratch, 'nocloud-data') }],
    ['unzip-tar', { TUA_NO_UNZIP: '1', TUA_HOME: path.join(scratch, 'ziphome'), TUA_FILES_ROOT: path.join(scratch, 'ziparkiv'), TUA_DATA_DIR: path.join(scratch, 'zip-data') }],
    // TUA_HOOK_ALLOW_TMP: testdokumentet ligger i os.tmpdir(), som hooken ellers (riktig) hopper over
    ['hook-winpath', { TUA_PLATFORM: 'win32', TUA_HOME: path.join(scratch, 'hookhome'), TUA_FILES_ROOT: path.join(scratch, 'hookarkiv'), TUA_DATA_DIR: path.join(scratch, 'hook-data'), CLAUDE_PLUGIN_OPTION_AUTO_LAGRING: 'true', TUA_HOOK_ALLOW_TMP: '1' }],
    // 0.4.1: plugin-innstillingen «Automatisk fangst» av (Claude Code eksporterer userConfig til hooks som CLAUDE_PLUGIN_OPTION_<NAVN>)
    ['hook-av', { TUA_HOME: path.join(scratch, 'avhome'), TUA_FILES_ROOT: path.join(scratch, 'avarkiv'), TUA_DATA_DIR: path.join(scratch, 'av-data'), CLAUDE_PLUGIN_OPTION_AUTO_LAGRING: 'false', TUA_HOOK_ALLOW_TMP: '1' }],
    // 0.5.1: innstillingen «arkivmappe» når bare hooken; start-modus skriver den til ~/.tua/config.json så serveren finner arkivet uten TUA_FILES_ROOT
    ['hook-konfig', { TUA_HOME: path.join(scratch, 'konfighome'), TUA_DATA_DIR: path.join(scratch, 'konfig-data'), CLAUDE_PLUGIN_OPTION_ARKIVMAPPE: path.join(scratch, 'konfigarkiv'), CLAUDE_PLUGIN_OPTION_AUTO_LAGRING: 'true' }],
    // 0.5.2: fil slettet i Finder kommer ikke tilbake fra indeks-cachen; data-dumper (mest tall) blir ikke atomer i hooken
    ['finder-slett', { TUA_HOME: path.join(scratch, 'sletthome'), TUA_FILES_ROOT: path.join(scratch, 'slettarkiv'), TUA_DATA_DIR: path.join(scratch, 'slett-data'), CLAUDE_PLUGIN_OPTION_AUTO_LAGRING: 'true', TUA_HOOK_ALLOW_TMP: '1' }],
  ]
  let failed = 0
  for (const [name, env] of cases) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', env: { ...process.env, TUA_FILES_ROOT: '', TUA_DATA_DIR: '', ...env } })
    const ok = r.status === 0
    if (!ok) failed++
    console.log(`${ok ? '✔' : '✘'} ${name}${r.stdout.trim() ? `\n    ${r.stdout.trim().split('\n').join('\n    ')}` : ''}${!ok ? `\n    ${(r.stderr || '').trim().split('\n').slice(-8).join('\n    ')}` : ''}`)
  }
  fs.rmSync(scratch, { recursive: true, force: true })
  console.log(failed ? `${failed} feilet` : 'alle fallback-grener kjørte')
  process.exit(failed ? 1 : 0)
}

// ── én del per prosess ──────────────────────────────────────────────────────
const say = (s) => process.stdout.write(s + '\n')
const imp = (f) => import(pathToFileURL(path.join(HERE, f)).href)
const home = process.env.TUA_HOME
fs.mkdirSync(home, { recursive: true })

if (mode === 'platform-win32') {
  const P = await imp('platform.js')
  assert.equal(P.PLATFORM, 'win32'); assert.ok(P.IS_WIN && !P.IS_MAC)
  assert.equal(P.CLAUDE_APP_DIR, path.join(process.env.APPDATA, 'Claude'))
  const c = P.cloudBases()
  assert.equal(c.dropbox, path.join(home, 'Dropbox')); assert.ok(c.onedrive.endsWith('OneDrive')); assert.ok(c.icloud.endsWith('iCloudDrive'))
  assert.deepEqual(P.openCommand('reveal', 'C:\\x\\y.md'), ['explorer.exe', ['/select,C:\\x\\y.md']])
  assert.deepEqual(P.openCommand('url', 'claude://claude.ai/project/1'), ['rundll32.exe', ['url.dll,FileProtocolHandler', 'claude://claude.ai/project/1']])
  assert.equal(P.posix('C:\\Users\\e\\node_modules\\x.md'), 'C:/Users/e/node_modules/x.md')
  assert.ok(P.insideTmp(path.join(os.tmpdir(), 'x.md')))
  assert.deepEqual(P.zoneIdentifierUrls(path.join(home, 'finnes-ikke.pdf')), [])            // ingen ADS på APFS → tom liste, ingen feil
  const r = await P.openSpawn('url', 'https://example.invalid', { dryrun: true }); assert.equal(r.ran[0], 'rundll32.exe')
  assert.equal(P.FILE_MANAGER, 'Utforsker')
  // store.js og desktop.js tar stiene fra platform.js
  const S = await imp('store.js'); const o = S.archiveOptions()
  assert.deepEqual(o.map((x) => x.id), ['icloud', 'dropbox', 'onedrive', 'googledrive', 'lokalt'])
  assert.ok(o.find((x) => x.id === 'lokalt').available && !o.find((x) => x.id === 'dropbox').available)
  const D = await imp('desktop.js'); assert.equal(D.CACHE_DIR, path.join(process.env.APPDATA, 'Claude', 'Cache', 'Cache_Data'))
  const I = await imp('import.js'); assert.equal(I.COWORK_ROOT, path.join(process.env.APPDATA, 'Claude', 'local-agent-mode-sessions'))
  say(`Claude-data ${D.CACHE_DIR} · åpne: explorer.exe + rundll32.exe · skyer: ${o.filter((x) => x.available).map((x) => x.id).join(', ')}`)
}

if (mode === 'platform-linux') {
  const P = await imp('platform.js')
  assert.equal(P.PLATFORM, 'linux')
  assert.equal(P.CLAUDE_APP_DIR, path.join(home, '.config', 'Claude'))
  const c = P.cloudBases(); assert.equal(c.icloud, null); assert.equal(c.dropbox, path.join(home, 'Dropbox'))
  assert.deepEqual(P.openCommand('reveal', '/h/e/Tua/x.md'), ['xdg-open', ['/h/e/Tua']])
  assert.deepEqual(P.openCommand('url', 'https://x'), ['xdg-open', ['https://x']])
  const S = await imp('store.js'); const o = S.archiveOptions()
  assert.equal(o.find((x) => x.id === 'icloud').available, false); assert.equal(o.find((x) => x.id === 'icloud').path, '')
  assert.ok(o.find((x) => x.id === 'lokalt').available)
  const F = await imp('finder.js'); assert.deepEqual(F.originCandidates(home), [])     // ingen opphav-kriterium på Linux, ingen feil
  say(`Claude-data ${P.CLAUDE_APP_DIR} · åpne: xdg-open · iCloud finnes ikke, lokalt finnes`)
}

if (mode === 'platform-darwin') {
  const P = await imp('platform.js')
  assert.equal(P.PLATFORM, process.platform)
  if (process.platform === 'darwin') {
    assert.deepEqual(P.openCommand('reveal', '/a/b.md'), ['open', ['-R', '/a/b.md']])
    assert.equal(P.CLAUDE_APP_DIR, path.join(home, 'Library', 'Application Support', 'Claude'))
    assert.equal(P.cloudBases().icloud, path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'))
  }
  say(`uendret på ${process.platform}: ${P.openCommand('url', 'https://x').join(' ')}`)
}

if (mode === 'no-cloud') {
  // Maskin uten Dropbox/iCloud/OneDrive/Google Drive: første kjøring må tilby «lokalt», og valget må lage arkivet med velkomstatom
  const S = await imp('store.js')
  assert.equal(S.filesMode(), false)
  assert.equal(S.ensureArchive().needsChoice, true, 'uten sky og uten valg skal Tua spørre, ikke gjette')
  const avail = S.archiveOptions().filter((o) => o.available).map((o) => o.id)
  assert.deepEqual(avail, ['lokalt'], `bare lokalt skal være tilgjengelig, fikk ${avail}`)
  assert.throws(() => S.chooseArchive('dropbox'), /finnes ikke på denne maskinen/)
  const r = S.chooseArchive('lokalt')
  assert.ok(r.created && r.root === path.join(home, 'Tua'))
  assert.ok(fs.existsSync(path.join(home, '.tua', 'config.json')))
  const atoms = S.load()
  assert.equal(atoms.length, 1); assert.equal(atoms[0].key, 'velkommen')
  assert.ok(fs.existsSync(path.join(home, 'Tua', 'Tua', 'Velkommen til Tua.md')))
  assert.ok(S.onboardingActive())
  // lagring uten Finder-tagger (IS_MAC = false): fila skrives, ingen xattr, ingen feil
  const { atom, status } = S.upsert(atoms, { content: 'Et notat som er langt nok til å være et atom i testen. '.repeat(3), name: 'Notat', project: 'Test', short: 'Et notat.' })
  assert.equal(status, 'ny'); assert.equal(S.save(atoms), 1)
  const md = fs.readFileSync(path.join(home, 'Tua', 'Test', 'Notat.md'), 'utf8')
  assert.ok(md.includes(atom.id) && md.includes('tagger'), 'fila skal ha frontmatter med id og tagger')
  const tags = spawnSync('xattr', ['-p', 'com.apple.metadata:_kMDItemUserTags', path.join(home, 'Tua', 'Test', 'Notat.md')], { encoding: 'utf8' })
  assert.notEqual(tags.status, 0, 'Finder-tagger skal ikke settes når plattformen ikke er macOS')
  say(`arkiv opprettet i ${r.root} (${r.label}) · velkomstatom + 1 lagret uten Finder-tagger`)
}

if (mode === 'unzip-tar') {
  // Windows har ikke unzip; tar (bsdtar) leser zip. Simulert med TUA_NO_UNZIP=1 på macOS (som også har bsdtar).
  const I = await imp('import.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-zip-'))
  const conv = [{ uuid: '11111111-2222-3333-4444-555555555555', name: 'Testsamtale', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T11:00:00Z', chat_messages: [{ sender: 'human', text: 'Hei, ' + 'kan du forklare dette? '.repeat(40), created_at: '2026-10-01T10:00:00Z' }, { sender: 'assistant', text: 'Ja. '.repeat(200), created_at: '2026-10-01T10:01:00Z' }] }]
  fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify(conv))
  const zip = path.join(dir, 'conversations-000.zip')
  const z = spawnSync('zip', ['-q', '-j', zip, path.join(dir, 'conversations.json')]); assert.equal(z.status, 0, 'zip (testoppsett) feilet')
  const r = I.importExport(zip, { dryRun: true, log: () => {} })
  assert.ok(/1 samtale|samtaler/.test(r.report), 'eksporten skal leses via tar: ' + r.report.slice(0, 200))
  fs.rmSync(dir, { recursive: true, force: true })
  say('eksport-zip lest med tar (uten unzip)')
}

if (mode === 'hook-winpath') {
  // PostToolUse-hooken med en Windows-sti: filtrene (node_modules, .claude, tmp) treffer i posix-form, og en vanlig fil lagres
  const S = await imp('store.js'); S.chooseArchive(process.env.TUA_FILES_ROOT)
  const hook = path.join(HERE, '..', 'hooks', 'tua-hook.mjs')
  const run = (input) => spawnSync(process.execPath, [hook, 'fil'], { input: JSON.stringify(input), encoding: 'utf8', env: process.env })
  const doc = path.join(home, 'Notater', 'plan.md'); fs.mkdirSync(path.dirname(doc), { recursive: true })
  fs.writeFileSync(doc, '# Plan\n\n' + 'Dette er et dokument som hooken skal lagre som atom. '.repeat(20))
  assert.equal(run({ cwd: home, session_id: 'abc12345', tool_name: 'Write', tool_input: { file_path: doc } }).status, 0)
  assert.equal(run({ cwd: home, session_id: 'abc12345', tool_name: 'Write', tool_input: { file_path: 'C:\\Users\\e\\proj\\node_modules\\x\\README.md' } }).status, 0)
  const tmpDoc = path.join(os.tmpdir(), 'tua-hook-tmp-test.md'); fs.writeFileSync(tmpDoc, 'x '.repeat(400))
  const r3 = spawnSync(process.execPath, [hook, 'fil'], { input: JSON.stringify({ cwd: home, session_id: 'abc12345', tool_name: 'Write', tool_input: { file_path: tmpDoc } }), encoding: 'utf8', env: { ...process.env, TUA_HOOK_ALLOW_TMP: '' } })
  assert.equal(r3.status, 0); fs.rmSync(tmpDoc, { force: true })
  const log = fs.readFileSync(path.join(process.env.TUA_FILES_ROOT, '.tua', 'hooks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(log[0].status, 'ny', 'dokumentet skal lagres: ' + JSON.stringify(log[0]))
  assert.equal(log[1].skipped, 'filtype/sti', 'node_modules med omvendt skråstrek skal hoppes over: ' + JSON.stringify(log[1]))
  assert.equal(log[2].skipped, 'filtype/sti', 'filer i temp-mappa skal hoppes over: ' + JSON.stringify(log[2]))
  say('hook: dokument lagret · Windows-sti med node_modules hoppet over · temp-fil hoppet over')
}

if (mode === 'hook-av') {
  // «Automatisk fangst» = false: svar, fil og økt lagrer ingenting og logger ingenting; påminnelsen (start) kjører likevel
  const S = await imp('store.js'); S.chooseArchive(process.env.TUA_FILES_ROOT)
  const hook = path.join(HERE, '..', 'hooks', 'tua-hook.mjs')
  const run = (m, input, env = process.env) => spawnSync(process.execPath, [hook, m], { input: JSON.stringify(input), encoding: 'utf8', env })
  const doc = path.join(home, 'Notater', 'plan.md'); fs.mkdirSync(path.dirname(doc), { recursive: true })
  fs.writeFileSync(doc, '# Plan\n\n' + 'Dette er et dokument som hooken IKKE skal lagre når fangst er av. '.repeat(20))
  const base = { cwd: home, session_id: 'av123456' }
  assert.equal(run('fil', { ...base, tool_name: 'Write', tool_input: { file_path: doc } }).status, 0)
  assert.equal(run('svar', { ...base, last_assistant_message: 'Et langt svar. '.repeat(200) }).status, 0)
  assert.equal(run('okt', { ...base, hook_event_name: 'SessionEnd' }).status, 0)
  const logFile = path.join(process.env.TUA_FILES_ROOT, '.tua', 'hooks.jsonl')
  assert.ok(!fs.existsSync(logFile), 'med fangst av skal hooken avslutte før den logger noe')
  assert.equal(S.load().filter((a) => a.key !== 'velkommen').length, 0, 'ingen atomer skal lagres når fangst er av')
  // samme fil med fangst på → lagres (viser at det var innstillingen, ikke filteret, som stoppet den)
  assert.equal(run('fil', { ...base, tool_name: 'Write', tool_input: { file_path: doc } }, { ...process.env, CLAUDE_PLUGIN_OPTION_AUTO_LAGRING: 'true' }).status, 0)
  assert.equal(S.load().filter((a) => a.key === `fil:${doc}`).length, 1, 'med fangst på skal samme fil lagres')
  // påminnelsen går uansett og logger
  assert.equal(run('start', base).status, 0)
  const log = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(log.map((l) => l.mode), ['fil', 'start'], 'bare fangst-på-lagringen og påminnelsen skal stå i loggen: ' + JSON.stringify(log.map((l) => l.mode)))
  say('fangst av: fil/svar/økt lagret ingenting · samme fil lagret med fangst på · påminnelsen kjørte')
}

if (mode === 'hook-konfig') {
  // SessionStart med «arkivmappe» satt og ingen TUA_FILES_ROOT: hooken skriver innstillingen til ~/.tua/config.json (som tua_setup),
  // og en server startet uten TUA_FILES_ROOT (slik Cowork og pluginens .mcp.json gjør) finner arkivet derfra. En uerstattet
  // «${CLAUDE_PLUGIN_DATA}/data» i TUA_DATA_DIR ignoreres. En tom innstilling rører ikke valget.
  const hook = path.join(HERE, '..', 'hooks', 'tua-hook.mjs')
  const arkiv = process.env.CLAUDE_PLUGIN_OPTION_ARKIVMAPPE
  const configFile = path.join(home, '.tua', 'config.json')
  const run = (env) => spawnSync(process.execPath, [hook, 'start'], { input: JSON.stringify({ cwd: home, session_id: 'konfig01' }), encoding: 'utf8', env })
  assert.ok(!fs.existsSync(configFile), 'ingen config før hooken')
  assert.equal(run(process.env).status, 0)
  const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  assert.equal(cfg.root, arkiv, 'config.root skal være innstillingen')
  assert.equal(cfg.sted, 'egen mappe'); assert.ok(cfg.valgt, 'valgt-tidsstempel som tua_setup')
  assert.ok(fs.existsSync(path.join(arkiv, 'Innboks')), 'arkivet opprettes som ved tua_setup')
  const logFile = path.join(arkiv, '.tua', 'hooks.jsonl')
  const logs = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(logs().filter((l) => l.arkivmappe === arkiv && l.before === null).length, 1, 'skrivingen skal logges én gang')
  // serveren uten TUA_FILES_ROOT og med rå ${…} i TUA_DATA_DIR (Cowork): config vinner, DATA_DIR faller tilbake
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `import * as S from ${JSON.stringify(pathToFileURL(path.join(HERE, 'store.js')).href)}; console.log(JSON.stringify({ root: S.FILES_ROOT, kilde: S.archiveInfo().kilde, data: S.DATA_DIR }))`],
    { encoding: 'utf8', env: { ...process.env, TUA_FILES_ROOT: '', TUA_DATA_DIR: '${CLAUDE_PLUGIN_DATA}/data', CLAUDE_PLUGIN_OPTION_ARKIVMAPPE: '' } })
  assert.equal(probe.status, 0, probe.stderr)
  const got = JSON.parse(probe.stdout.trim())
  assert.equal(got.root, arkiv, 'serveren skal finne arkivet fra config uten TUA_FILES_ROOT')
  assert.equal(got.kilde, 'valgt')
  assert.equal(got.data, path.join(HERE, 'data'), 'uerstattet ${…} i TUA_DATA_DIR skal ignoreres')
  // samme innstilling igjen → ingen ny skriving; tom innstilling → valget står
  assert.equal(run(process.env).status, 0)
  assert.equal(run({ ...process.env, CLAUDE_PLUGIN_OPTION_ARKIVMAPPE: '' }).status, 0)
  assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).root, arkiv, 'tom innstilling skal ikke overskrive valget')
  assert.equal(logs().filter((l) => l.arkivmappe).length, 1, 'uendret innstilling skal ikke skrives igjen')
  say('arkivmappe → config.json · server fant arkivet uten TUA_FILES_ROOT · rå ${…} i TUA_DATA_DIR ignorert · tom innstilling rørte ikke valget')
}

if (mode === 'finder-slett') {
  // (1) Et atom lagres → fila finnes og indeks-cachen (atoms.json) kjenner den. Brukeren sletter fila i Finder → load() tar den
  // ikke med igjen fra cachen, og neste save() skriver den ikke tilbake. (2) Stop- og Write-hooken hopper over data-dumper.
  const S = await imp('store.js'); S.chooseArchive(process.env.TUA_FILES_ROOT)
  let atoms = S.load()
  const { atom } = S.upsert(atoms, { key: 'slett:test', name: 'Skal slettes i Finder', content: 'Et notat som brukeren etterpå sletter i Finder. '.repeat(10), project: 'Test', convo: 'test', source: 'Tua', by: 'regel', short: 'Slettes' })
  S.save(atoms)
  const fil = S.fileOf ? S.fileOf(atom) : null
  const found = fil || (() => { const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === '.tua' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]); return walk(process.env.TUA_FILES_ROOT).find((f) => f.endsWith('.md') && fs.readFileSync(f, 'utf8').includes('Skal slettes i Finder')) })()
  assert.ok(found && fs.existsSync(found), 'atomet skal ligge som fil')
  assert.ok(S.loadCache().some((a) => a.id === atom.id), 'indeks-cachen skal kjenne atomet')
  fs.unlinkSync(found)                                                     // «slett i Finder»
  atoms = S.load()
  assert.ok(!atoms.some((a) => a.id === atom.id), 'slettet fil skal ikke komme tilbake fra cachen i load()')
  S.save(atoms)
  assert.ok(!fs.existsSync(found), 'save() skal ikke skrive den slettede fila tilbake')
  // data-dump i hooken
  const hook = path.join(HERE, '..', 'hooks', 'tua-hook.mjs')
  const run = (m, input) => spawnSync(process.execPath, [hook, m], { input: JSON.stringify(input), encoding: 'utf8', env: process.env })
  const dump = Array.from({ length: 150 }, (_, i) => `1002${7245 + i}·${450000 - i * 1000} 1005${9885 + i}·${140000 + i * 10}`).join('\n')
  assert.ok(dump.length >= 4000, 'dumpen må være lengre enn MIN_SVAR, ellers testes «kort», ikke «data-dump»')
  assert.equal(run('svar', { cwd: home, session_id: 'dump0001', last_assistant_message: dump }).status, 0)
  const doc = path.join(home, 'tall.md'); fs.writeFileSync(doc, dump)
  assert.equal(run('fil', { cwd: home, session_id: 'dump0001', tool_name: 'Write', tool_input: { file_path: doc } }).status, 0)
  const log = fs.readFileSync(path.join(process.env.TUA_FILES_ROOT, '.tua', 'hooks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(log.map((l) => l.skipped), ['data-dump', 'data-dump'], 'begge hookene skal hoppe over data-dumpen: ' + JSON.stringify(log))
  assert.equal(S.load().filter((a) => a.key !== 'velkommen').length, 0, 'ingen atomer av data-dumpene')
  say('fil slettet i Finder kom ikke tilbake · data-dump hoppet over i svar- og fil-hooken')
}
