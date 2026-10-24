#!/usr/bin/env node
// test-klasser.mjs — klassene arbeid/spor/drift/tråd, vekt og merking, serverdelen (runde 2d i arbeidsstykke 32 del 3, 03-avisen §2–§5 og §7 A–E, Erik 24.10.2026: ja).
// «Avisen viser det som er laget med vilje og er ferdig nok til å leses; alt annet finnes, men venter på å bli spurt etter.»
// ALDRI mot ~/Dropbox/Tua, ALDRI Eriks ekte ~/.claude/projects (falskt tre i scratch, TUA_CODE_HOME), ALDRI et ekte modellkall (test-mottakeren).
//
//   TUA_FILES_ROOT=/tmp/tua-test-klasser/arkiv TUA_DATA_DIR=/tmp/tua-test-klasser/data TUA_HOME=/tmp/tua-test-klasser/hjem node server/test-klasser.mjs
//
// Sjekker: files.js skriver/leser drift og beholdt · makeAtom/upsert: drift settes på nye, aldri på menneskeskrevet, aldri igjen etter drift: false; beholdt tas bare bort eksplisitt ·
// klasseAv for alle slag · sync-tua.js setter drift på commit-logg/manifest/status/lenker/beslutningslogg, ikke på dokumentene · import (Code) setter drift på importrapporten og på
// byggeøkter i Tua-repoet, ikke på økter i andre repoer · helsesjekk --dry-run rører ikke arkivet; ekte kjøring gir drift på rapport og minne · søket holder drift utenfor (uten/med/bare) ·
// vekt: arbeid med versjoner og utlevering slår nyeste tomme sak; drift/spor/tråd = 0; 30 dager urørt synker; bruk-hendelser teller · trådSamlet: åpen til konklusjon låses eller svar beholdes ·
// behold setter beholdt og løfter inn · claudeØkter: én linje per økt, filer via samtalenavn, tekstlinje per dag · broen: /api/atoms (klasse, vekt, sist_rørt, tråden, klasser), /api/search
// ?drift, /api/behold, /api/bruk (400/404), /api/siden-sist · review.js --drift/--fanget dry-run skriver ingenting, ekte merker de rette, menneskeskrevet aldri.
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
const TUA_REPO = path.join(SCRATCH, 'falskt-tua-repo'), ANNET_REPO = path.join(SCRATCH, 'Prosjekt')
for (const d of [ROOT, DATA, HJEM, CODE_HOME, COWORK, FINDER_TOM, TUA_REPO, ANNET_REPO]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODE_HOME = CODE_HOME
process.env.TUA_COWORK_ROOT = COWORK
fs.mkdirSync(path.join(HJEM, '.tua'), { recursive: true }); fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [FINDER_TOM] } }) + '\n')
fs.mkdirSync(path.join(ROOT, 'Innboks'), { recursive: true })
// et falskt Tua-repo: det som gjør det til Tua-repoet er tua-plugin/server/store.js (store.erTuaRepo)
fs.mkdirSync(path.join(TUA_REPO, 'tua-plugin', 'server'), { recursive: true }); fs.writeFileSync(path.join(TUA_REPO, 'tua-plugin', 'server', 'store.js'), '// falsk\n')

const files = await import('./files.js')
const store = await import('./store.js')
const { load, save, upsert, search, klasseAv, vekt, sistRørt, trådSamlet, behold, logBruk, brukInfo, claudeØkter, erDriftEtterRegel, erMenneskeskrevet, registerProject, fileOf, setStatus, logDelivery, deliveryInfo, tellKlasser, øktIdAv } = store
const imp = await import('./import.js')
const { importCode, promptKey } = imp
const { spor } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const les = (a) => fs.readFileSync(fileOf(a), 'utf8')
const DAG = 86400e3, NÅ = Date.now()
const lang = (s, n = 120) => (s + ' ').repeat(n).trim()

// ── 1) files.js og lageret ──────────────────────────────────────────────────
{
  const a = store.makeAtom({ content: lang('Drift innhold.'), name: 'Drift prøve', project: 'P', source: 'Tua', drift: true })
  const md = files.serialize(a)
  ok('serialize: `drift: true` i frontmatter når satt; parse leser det tilbake', /\ndrift: true\n/.test(md) && files.parse(md).drift === true)
  const b = store.makeAtom({ content: lang('Beholdt svar.'), name: 'Beholdt', project: 'P', kind: 'svar', beholdt: true })
  ok('serialize: `beholdt: true` når satt; parse leser det; ingen drift-linje', /\nbeholdt: true\n/.test(files.serialize(b)) && files.parse(files.serialize(b)).beholdt === true && !/\ndrift:/.test(files.serialize(b)))
  ok('parse: drift: false i fila = brukeren sa «arbeid»; tull i feltet = ingen flagg', files.parse(files.serialize(b).replace('---\n# Beholdt', 'drift: false\n---\n# Beholdt')).drift === false && files.parse(files.serialize(b).replace('---\n# Beholdt', 'drift: "tull"\n---\n# Beholdt')).drift === undefined)
  const m = store.makeAtom({ content: lang('Skrevet av Erik.'), name: 'Eriks notat', project: 'P', source: 'Erik', drift: true })
  ok('makeAtom: drift settes aldri på en sak med menneske som kilde', m.drift === undefined && erMenneskeskrevet(m))
  const m2 = store.makeAtom({ content: lang('Skrevet av Claude, S av menneske.'), name: 'Rettet', project: 'P', short: 'Min egen ingress.', by: 'menneske', drift: true })
  ok('makeAtom: drift settes aldri når S er menneskeskrevet', m2.drift === undefined && erMenneskeskrevet(m2))
  ok('erMenneskeskrevet: maskinkilder er ikke menneske', !erMenneskeskrevet({ source: 'Claude' }) && !erMenneskeskrevet({ source: 'Claude Code · sync' }) && !erMenneskeskrevet({ source: 'Tua' }) && !erMenneskeskrevet({ source: 'Ollama (lokal)' }) && !erMenneskeskrevet({ source: 'ChatGPT' }) && erMenneskeskrevet({ source: 'Erik' }))

  const atoms = []
  const r1 = upsert(atoms, { key: 'commit-logg', content: lang('Commit.'), name: 'Commit-logg', project: 'P', source: 'Claude Code · sync', drift: true })
  ok('upsert ny med drift: true → drift', r1.status === 'ny' && r1.atom.drift === true && klasseAv(r1.atom) === 'drift')
  const r2 = upsert(atoms, { key: 'commit-logg', content: lang('Commit.'), name: 'Commit-logg', project: 'P', source: 'Claude Code · sync', drift: true })
  ok('upsert igjen, likt → uendret', r2.status === 'uendret')
  const r3 = upsert(atoms, { key: 'commit-logg', content: lang('Commit.'), name: 'Commit-logg', project: 'P', source: 'Claude Code · sync', drift: false })
  ok('upsert med drift: false → brukeren sa «arbeid» (status nivåer, samme versjon)', r3.status === 'nivåer' && r3.atom.drift === false && klasseAv(r3.atom) === 'arbeid')
  const r4 = upsert(atoms, { key: 'commit-logg', content: lang('Commit.') + ' ny', name: 'Commit-logg', project: 'P', source: 'Claude Code · sync', drift: true })
  ok('upsert med drift: true etter drift: false → settes IKKE igjen (brukerens valg vinner), ny versjon av innholdet', r4.status === 'oppdatert' && r4.atom.drift === false && r4.atom.version === 2)
  const r5 = upsert(atoms, { key: 'svar:x', kind: 'svar', content: lang('Svar.'), name: 'Et svar', project: 'P', beholdt: true })
  const r6 = upsert(atoms, { key: 'svar:x', kind: 'svar', content: lang('Svar.'), name: 'Et svar', project: 'P' })
  ok('beholdt følger saken gjennom en upsert uten feltet; bare beholdt: false tar det bort', r5.atom.beholdt === true && r6.status === 'uendret' && r6.atom.beholdt === true && upsert(atoms, { key: 'svar:x', kind: 'svar', content: lang('Svar.'), name: 'Et svar', project: 'P', beholdt: false }).atom.beholdt === undefined)
  const r7 = upsert(atoms, { key: 'manifest', content: lang('Manifest.'), name: 'Manifest', project: 'P', source: 'Claude Code · sync', short: 'Eriks ingress', by: 'menneske' })
  const r8 = upsert(atoms, { key: 'manifest', content: lang('Manifest.'), name: 'Manifest', project: 'P', source: 'Claude Code · sync', drift: true })
  ok('upsert: drift settes aldri på en eksisterende sak med menneskeskrevet S', r7.atom.levels.S.by === 'menneske' && r8.atom.drift === undefined)
  save(atoms)
  const igjen = load()
  ok('load fra mappa: drift false og beholdt følger filene', igjen.find((a) => a.key === 'commit-logg').drift === false && igjen.find((a) => a.key === 'manifest').drift === undefined)
}

// ── 2) klasseAv — alle slag ─────────────────────────────────────────────────
{
  const k = (o) => klasseAv({ project: 'P', source: 'Claude', ...o })
  ok('klasse: capture uten flagg = arbeid · fanget = spor · samtale = spor · samtale beholdt = arbeid', k({ kind: 'capture' }) === 'arbeid' && k({ kind: 'capture', fanget: true }) === 'spor' && k({ kind: 'samtale' }) === 'spor' && k({ kind: 'samtale', beholdt: true }) === 'arbeid')
  ok('klasse: drift vinner over alt · fanget: false (løftet inn) = arbeid', k({ kind: 'capture', drift: true, fanget: true }) === 'drift' && k({ kind: 'capture', fanget: false }) === 'arbeid')
  ok('klasse: prompt = tråd alltid · svar = tråd · svar beholdt = arbeid · svar låst (endelig) = arbeid', k({ kind: 'prompt' }) === 'tråd' && k({ kind: 'svar' }) === 'tråd' && k({ kind: 'svar', beholdt: true }) === 'arbeid' && k({ kind: 'svar', status: 'endelig' }) === 'arbeid')
  ok('klasse: Forskjeller (svar med tagg) = tråd, også låst; beholdt = arbeid', k({ kind: 'svar', tags: ['forskjeller'] }) === 'tråd' && k({ kind: 'svar', tags: ['forskjeller'], status: 'endelig' }) === 'tråd' && k({ kind: 'svar', tags: ['forskjeller'], beholdt: true }) === 'arbeid')
  ok('klasse: konklusjon utkast = tråd · konklusjon endelig = arbeid · leveranse/minne = arbeid', k({ kind: 'konklusjon' }) === 'tråd' && k({ kind: 'konklusjon', status: 'endelig' }) === 'arbeid' && k({ kind: 'leveranse' }) === 'arbeid' && k({ kind: 'minne' }) === 'arbeid')
}

// ── 3) sync-tua.js i et falskt repo → drift på speilingene, ikke på dokumentet ──
{
  const REPO = path.join(SCRATCH, 'sync-repo'); fs.rmSync(REPO, { recursive: true, force: true }); fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true })
  const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  git('init', '-q'); fs.writeFileSync(path.join(REPO, 'CLAUDE.md'), '# Prosjektet\n\nEt testprosjekt.\n'); fs.writeFileSync(path.join(REPO, 'STATUS.md'), '# Status\n\nHer er vi.\n')
  fs.writeFileSync(path.join(REPO, 'docs', 'notat.html'), '<html><head><title>Testdokument</title></head><body><p class="standfirst">Et dokument med PDF ved siden av.</p><h2>Del 1</h2><p>Tekst.</p></body></html>')
  fs.writeFileSync(path.join(REPO, 'docs', 'notat.pdf'), '%PDF-1.4 falsk')
  fs.writeFileSync(path.join(REPO, '.tua-sync.json'), JSON.stringify({ project: 'Synkprosjekt' }))
  git('add', '-A'); git('commit', '-q', '-m', 'første')
  const r = spawnSync(process.execPath, [path.join(HERE, 'sync-tua.js')], { cwd: REPO, encoding: 'utf8', env: { ...process.env } })
  const atoms = load()
  const sp = atoms.filter((a) => a.project === 'Synkprosjekt')
  const nøkler = Object.fromEntries(sp.map((a) => [a.key, a]))
  ok('sync-tua: commit-logg, manifest, status og lenker har drift: true (klasse drift)', r.status === 0 && ['commit-logg', 'manifest', 'status', 'lenker'].every((k) => nøkler[k]?.drift === true && klasseAv(nøkler[k]) === 'drift'), r.stdout.split('\n').slice(-2).join(' | ') + (r.stderr || ''))
  const dok = sp.find((a) => String(a.key).startsWith('dok:'))
  ok('sync-tua: dokumentet (HTML + PDF) er arbeid — ingen drift-flagg', dok && dok.drift === undefined && klasseAv(dok) === 'arbeid', dok?.key)
  ok('fila på disk har drift: true for commit-loggen, ingen drift-linje for dokumentet', /\ndrift: true\n/.test(les(nøkler['commit-logg'])) && !/\ndrift:/.test(les(dok)))
  ok('registerProject: Synkprosjekt har repo, men repoet er ikke Tua-repoet', store.projectOf('Synkprosjekt').repo === fs.realpathSync(REPO) || store.projectOf('Synkprosjekt').repo === REPO)
}

// ── 4) importCode: byggeøkt i Tua-repoet = drift; økt i et annet repo = spor; rapporten = drift ──
const T0 = Date.parse('2026-10-20T10:00:00+02:00')
const P1 = 'Kan du skrive et sammendrag av møtenotatet om lagerflytting og foreslå tre tiltak for neste kvartal? Ta med budsjettet.'
const A1 = ('# Sammendrag av møtenotatet\n\n' + 'Lageret flyttes til Industriveien 4 i løpet av neste kvartal, og budsjettet er 45 000 kroner. '.repeat(40)).trim()
const P2 = 'Bygg runde 2d i Tua: klassene arbeid, spor og drift, vekt og merking, med tester mot testarkiv i scratch og STATUS-blokk til slutt.'
const A2 = ('# Runde 2d\n\n' + 'Klassen regnes av flaggene fanget, drift og beholdt; vekten av størrelse, versjoner og hvem som har rørt saken. '.repeat(40)).trim()
const SID1 = 'sess-1111-2222-3333-4444', SID2 = 'sess-9999-8888-7777-6666'
const DOKFIL = path.join(ANNET_REPO, 'notat.md'), DOK = '# Notat om lageret\n\n' + 'Dette notatet skrev Claude Code som fil i prosjektet, og det ligger på disk. '.repeat(20)
fs.writeFileSync(DOKFIL, DOK)
const linje = (type, content, i, cwd, sid, extra = {}) => JSON.stringify({ type, message: { role: type, content }, cwd, sessionId: sid, timestamp: new Date(T0 + i * 60000).toISOString(), ...extra })
const tr1 = [
  linje('user', [{ type: 'text', text: P1 }], 0, ANNET_REPO, SID1), linje('assistant', [{ type: 'text', text: A1 }], 1, ANNET_REPO, SID1),
  linje('user', [{ type: 'text', text: 'Skriv notatet til fil også, som markdown i prosjektmappa, så jeg finner det igjen senere i Finder.' }], 2, ANNET_REPO, SID1),
  linje('assistant', [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: DOKFIL, content: DOK } }], 3, ANNET_REPO, SID1),
  linje('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], 4, ANNET_REPO, SID1), linje('assistant', [{ type: 'text', text: 'Notatet er skrevet.' }], 5, ANNET_REPO, SID1),
].join('\n') + '\n'
const tr2 = [linje('user', [{ type: 'text', text: P2 }], 0, TUA_REPO, SID2), linje('assistant', [{ type: 'text', text: A2 }], 1, TUA_REPO, SID2), linje('user', [{ type: 'text', text: 'Fortsett med testene, og kjør alle svitene før du fletter til main.' }], 2, TUA_REPO, SID2), linje('assistant', [{ type: 'text', text: 'Testene kjører.' }], 3, TUA_REPO, SID2)].join('\n') + '\n'
const dir1 = path.join(CODE_HOME, '.claude', 'projects', '-Users-test-Prosjekt'), dir2 = path.join(CODE_HOME, '.claude', 'projects', '-falskt-tua-repo')
fs.mkdirSync(dir1, { recursive: true }); fs.mkdirSync(dir2, { recursive: true })
fs.writeFileSync(path.join(dir1, `${SID1}.jsonl`), tr1); fs.writeFileSync(path.join(dir2, `${SID2}.jsonl`), tr2)
{
  const r = importCode({ log: () => {} })
  const atoms = load()
  const s1 = atoms.find((a) => a.key === `samtale:${SID1}`), p1 = atoms.find((a) => a.key === promptKey(SID1, P1)), fil = atoms.find((a) => a.key === `fil:${DOKFIL}`)
  const s2 = atoms.find((a) => a.key === `samtale:${SID2}`), p2 = atoms.find((a) => a.key === promptKey(SID2, P2)), sv2 = atoms.find((a) => a.key === `svar:${SID2.slice(0, 8)}:${store.sha8(A2)}`)
  ok('importCode: økta i et vanlig repo er spor (fanget, ikke drift)', s1?.fanget === true && s1.drift === undefined && klasseAv(s1) === 'spor' && klasseAv(p1) === 'spor', JSON.stringify([r.stats.nye, r.stats.svar]))
  ok('importCode: økta i Tua-repoet er en byggeøkt — samtale, prompt og svar har drift: true (klasse drift)', s2?.drift === true && p2?.drift === true && sv2?.drift === true && klasseAv(s2) === 'drift' && klasseAv(sv2) === 'drift', JSON.stringify([s2?.project, s2?.drift, p2?.drift, sv2?.drift]))
  ok('importCode: fila Claude skrev er arbeid (ingen flagg)', fil && fil.fanget === undefined && fil.drift === undefined && klasseAv(fil) === 'arbeid')
  const rapport = atoms.find((a) => a.key === 'import:code-økter')
  ok('importrapporten «Import: …» er drift', rapport?.drift === true && klasseAv(rapport) === 'drift' && /\ndrift: true\n/.test(les(rapport)), rapport?.name)
}

// ── 5) helsesjekk: --dry-run rører ikke arkivet; ekte kjøring gir drift på rapport og minne ──
{
  const før = load().length, førFiler = fs.readdirSync(ROOT, { recursive: true }).length
  const d = spawnSync(process.execPath, [path.join(HERE, 'helsesjekk.js'), '--dry-run'], { encoding: 'utf8', env: { ...process.env }, timeout: 120000 })
  ok('helsesjekk --dry-run: skriver ingenting i arkivet', load().length === før && fs.readdirSync(ROOT, { recursive: true }).length === førFiler, (d.stderr || '').split('\n')[0])
  const r = spawnSync(process.execPath, [path.join(HERE, 'helsesjekk.js')], { encoding: 'utf8', env: { ...process.env }, timeout: 120000 })
  const atoms = load()
  const rap = atoms.find((a) => String(a.key).startsWith('helsesjekk:') && a.key !== 'helsesjekk:minne'), minne = atoms.find((a) => a.key === 'helsesjekk:minne')
  ok('helsesjekk: rapporten og minnet har drift: true (klasse drift)', rap?.drift === true && minne?.drift === true && klasseAv(rap) === 'drift', `${rap?.name} · ${(r.stdout || r.stderr || '').split('\n')[0]}`)
}

// ── 6) søket holder drift utenfor ───────────────────────────────────────────
{
  const atoms = load()
  const uten = search(atoms, 'commit', { limit: 100 }), med = search(atoms, 'commit', { limit: 100, drift: 'med' }), bare = search(atoms, 'commit', { limit: 100, drift: 'bare' })
  ok('store.search: drift utenfor som standard og telles (page.drift); med tar dem med; bare gir bare dem', uten.every((h) => h.atom.drift !== true) && uten.drift > 0 && med.drift === 0 && med.total === uten.total + bare.total && bare.every((h) => h.atom.drift === true), JSON.stringify([uten.total, uten.drift, med.total, bare.total]))
  const alle = search(atoms, 'runde 2d', { limit: 100, fanget: 'med' })
  ok('store.search: fanget=med tar ikke med drift (byggeøkta er drift, ikke spor) — begge filtre må åpnes', alle.every((h) => h.atom.drift !== true) && alle.drift >= 1 && search(atoms, 'runde 2d', { limit: 100, fanget: 'med', drift: 'med' }).some((h) => h.atom.drift === true), JSON.stringify([alle.total, alle.drift]))
}

// ── 7) vekt og sist_rørt ─────────────────────────────────────────────────────
{
  const atoms = load()
  const tom = upsert(atoms, { key: 'tom', content: 'Kort notat.', name: 'Nyeste tomme sak', project: 'Arbeid' }).atom
  const stor = upsert(atoms, { key: 'stor', content: lang('Et ordentlig stykke arbeid med mange ord i.', 60), name: 'Stort arbeid', project: 'Arbeid', medium: 'Sammendraget.' }).atom
  upsert(atoms, { key: 'stor', content: lang('Et ordentlig stykke arbeid med mange ord i.', 60) + ' v2', name: 'Stort arbeid', project: 'Arbeid' })
  upsert(atoms, { key: 'stor', content: lang('Et ordentlig stykke arbeid med mange ord i.', 60) + ' v3', name: 'Stort arbeid', project: 'Arbeid' })
  stor.capturedAt = NÅ - 10 * DAG
  save(atoms)
  logDelivery({ tool: 'spor', mottaker: 'test', saker: [{ id: stor.id, version: 3, level: 'L' }] })
  logDelivery({ tool: 'spor', mottaker: 'test', saker: [{ id: stor.id, version: 3, level: 'M' }] })
  const ut = deliveryInfo()
  const vTom = vekt(tom, { now: NÅ }), vStor = vekt(stor, { utlevering: ut.get(stor.id), now: NÅ })
  ok('vekt: arbeid med versjoner og utleveringer slår nyeste tomme sak', vStor > vTom * 3 && vTom > 0, JSON.stringify([vStor, vTom]))
  ok('vekt: drift, spor og tråd = 0 (grunnvilkår arbeid)', vekt(atoms.find((a) => a.key === 'import:code-økter')) === 0 && vekt(atoms.find((a) => a.key === `samtale:${SID1}`)) === 0 && vekt({ kind: 'prompt', content: lang('x') }) === 0)
  const gammel = { ...stor, capturedAt: NÅ - 40 * DAG }, fersk = { ...stor, capturedAt: NÅ - 2 * 3600e3 }
  ok('vekt: 30 dager urørt synker; rørt siste døgn teller mer', vekt(gammel, { now: NÅ }) < vekt(stor, { now: NÅ }) && vekt(fersk, { now: NÅ }) > vekt(stor, { now: NÅ }), JSON.stringify([vekt(gammel, { now: NÅ }), vekt(stor, { now: NÅ }), vekt(fersk, { now: NÅ })]))
  const førBruk = vekt(stor, { utlevering: ut.get(stor.id), now: NÅ })
  logBruk(stor.id, 'lest_M'); logBruk(stor.id, 'tatt_med')
  const b = brukInfo().get(stor.id)
  ok('bruk.jsonl: hendelsene telles per sak og gir vekt og sist_rørt', b.antall === 2 && b.per.lest_M === 1 && b.per.tatt_med === 1 && vekt(stor, { utlevering: ut.get(stor.id), bruk: b, now: NÅ }) > førBruk && sistRørt(stor, { bruk: b }) === b.sist && fs.existsSync(path.join(ROOT, '.tua', 'bruk.jsonl')))
  let kast = false; try { logBruk(stor.id, 'tull') } catch { kast = true }
  ok('logBruk: ukjent hendelse avvises', kast)
  ok('sist_rørt: utleveringen teller når den er nyere enn saken', sistRørt(stor, { utlevering: ut.get(stor.id) }) >= ut.get(stor.id).sist && ut.get(stor.id).antall === 2)
}

// ── 8) Spør gjennom motoren → tråden samlet, åpen, behold, konklusjon ──────
let promptId, svarIder = []
{
  const atoms = load()
  const kilde = atoms.find((a) => a.key === 'stor')
  const ev = []
  await spor({ melding: 'Sammenlign budsjettet med forslaget og si hva som bør prioriteres i neste kvartal.', saker: [{ id: kilde.id, nivå: 'S' }], mottakere: ['test', 'test2'], prosjekt: 'Arbeid', klient: 'test', på: (e, d) => ev.push([e, d]) })
  const alle = load()
  const ferdig = ev.filter(([e]) => e === 'ferdig')
  promptId = ferdig[0]?.[1]?.prompt; svarIder = ferdig.map(([, d]) => d.svar).filter(Boolean)
  const { per } = trådSamlet(alle)
  const t = per.get(promptId)
  ok('trådSamlet: prompten har tråden med to svar, Forskjeller og konklusjon i utkast (motoren, M20b) — fortsatt åpen', t && t.svar.length === 2 && t.forskjeller.length === 1 && t.konklusjon && t.konklusjon_status === 'utkast' && t.åpen === true && t.runder === 2 && t.beholdt.length === 0, JSON.stringify(t))
  ok('klasse: Spørs prompt og ubeholdte svar er tråd', klasseAv(alle.find((a) => a.id === promptId)) === 'tråd' && svarIder.every((id) => klasseAv(alle.find((a) => a.id === id)) === 'tråd'))
  const r = behold(alle, svarIder[0]); save(alle)
  const igjen = load(), t2 = trådSamlet(igjen).per.get(promptId)
  ok('behold på et svar: beholdt: true i fila, klasse arbeid, tråden ikke lenger åpen', r.atom.beholdt === true && /\nbeholdt: true\n/.test(les(igjen.find((a) => a.id === svarIder[0]))) && klasseAv(igjen.find((a) => a.id === svarIder[0])) === 'arbeid' && t2.åpen === false && t2.beholdt[0] === svarIder[0])
  ok('vekt: det beholdte svaret får vekt > 0 og runder i tråden teller', vekt(igjen.find((a) => a.id === svarIder[0]), { tråd: t2 }) > 0)
  // konklusjon: utkast = tråd; låst = arbeid
  const k = igjen.find((a) => a.id === t2.konklusjon), fk = igjen.find((a) => a.id === t2.forskjeller[0])
  ok('konklusjon i utkast: klasse tråd; Forskjeller: klasse tråd', k && klasseAv(k) === 'tråd' && fk && klasseAv(fk) === 'tråd' && t2.konklusjon_status === 'utkast')
  setStatus(k, 'endelig'); save(igjen)
  ok('konklusjon låst (endelig): klasse arbeid, vekt > 0 med rundene i tråden', klasseAv(k) === 'arbeid' && trådSamlet(load()).per.get(promptId).konklusjon_status === 'endelig' && vekt(k, { tråd: t2 }) > vekt({ ...k, kind: 'capture' }))
  // en tråd lukkes også av en låst konklusjon alene (uten beholdt svar)
  const alene = [{ id: 'p9', kind: 'prompt', project: 'P', content: 'x', capturedAt: NÅ }, { id: 's9', kind: 'svar', project: 'P', content: 'y', capturedAt: NÅ, derivedFrom: [{ id: 'p9', version: 1, level: 'L' }] }, { id: 'k9', kind: 'konklusjon', project: 'P', content: 'z', capturedAt: NÅ, status: 'endelig', derivedFrom: [{ id: 'p9', version: 1, level: 'L' }] }]
  ok('trådSamlet: låst konklusjon alene lukker tråden; uten den er den åpen', trådSamlet(alene).per.get('p9').åpen === false && trådSamlet(alene.slice(0, 2)).per.get('p9').åpen === true)
}

// ── 9) claudeØkter ───────────────────────────────────────────────────────────
{
  const atoms = load()
  ok('øktIdAv: okt:, samtale:, svar:<8>: og prompt:<8>: gir samme økt-id; prompt:spor: og fil: gir ingen', øktIdAv(`okt:${SID1}`) === SID1.slice(0, 8) && øktIdAv(`samtale:${SID1}`) === SID1.slice(0, 8) && øktIdAv(`svar:${SID1.slice(0, 8)}:abc`) === SID1.slice(0, 8) && øktIdAv(`prompt:${SID1.slice(0, 8)}:abc`) === SID1.slice(0, 8) && øktIdAv('prompt:spor:abc') === null && øktIdAv('fil:/x') === null)
  const ø = claudeØkter(atoms, { dager: 365, now: NÅ })
  const ø1 = ø.økter.find((x) => x.økt === SID1.slice(0, 8)), ø2 = ø.økter.find((x) => x.økt === SID2.slice(0, 8))
  ok('claudeØkter: én linje per økt — den vanlige økta har samtale, 2 prompter, 1 svar og fila Claude skrev (via samtalenavnet)', ø1 && ø1.prompter === 2 && ø1.svar === 1 && ø1.filer === 1 && ø1.saker.length === 5 && ø1.project === 'Prosjekt' && !ø1.drift, JSON.stringify(ø1))
  ok('claudeØkter: byggeøkta er merket drift', ø2 && ø2.drift === true && ø2.prompter === 1 && ø2.svar === 1)
  ok('claudeØkter: tekstlinje per dag med tall («I Claude …: N økter, M filer skrevet, K svar beholdt»)', ø.dager.length >= 1 && /^I Claude .+: \d+ økter?, \d+ fil(er)? skrevet, \d+ svar beholdt$/.test(ø.dager[0].tekst) && ø.dager.reduce((n, d) => n + d.antall, 0) === ø.antall, ø.dager.map((d) => d.tekst).join(' | '))
  ok('claudeØkter: utenfor vinduet (7 dager) er øktene fra 20.10 borte når nå er langt senere', claudeØkter(atoms, { dager: 7, now: T0 + 30 * DAG }).antall === 0 && claudeØkter(atoms, { dager: 7, now: T0 + 2 * DAG }).antall === 2)
}

// ── 10) review.js --drift og --fanget ────────────────────────────────────────
{
  const atoms = load()
  // registrer et prosjekt hvis repo er Tua-repoet → byggeøkt-saker der er drift etter regelen
  registerProject('Tua_test', { repo: TUA_REPO })
  upsert(atoms, { key: `okt:${SID2}`, content: lang('Økt i Tua.'), name: 'Økt: bygg', project: 'Tua_test', source: 'Claude', fanget: true })
  upsert(atoms, { key: 'svar:gammel12:deadbeef', content: lang('Gammelt svar i Tua.'), name: 'Gammelt svar', project: 'Tua_test', source: 'Claude' })
  upsert(atoms, { key: 'svar:gammel12:feedface', content: lang('Svar Erik har rettet.'), name: 'Rettet svar', project: 'Tua_test', source: 'Claude', short: 'Eriks ingress.', by: 'menneske' })
  upsert(atoms, { key: 'lenker', content: lang('Lenker.'), name: 'Lenker — gammelt', project: 'Gammelt', source: 'Claude Code · sync' })
  upsert(atoms, { key: 'import:gammel', content: lang('Import.'), name: 'Import: gammel', project: 'Tua', source: 'Tua' })
  upsert(atoms, { key: 'notat', content: lang('Eriks eget notat.'), name: 'Eriks notat', project: 'Tua', source: 'Erik' })
  upsert(atoms, { key: 'svar:annet123:cafe0001', content: lang('Svar i et annet prosjekt.'), name: 'Annet svar', project: 'Annet', source: 'Claude' })
  save(atoms)
  const alle = load()
  ok('erDriftEtterRegel: sync-nøkler og import: er drift uansett prosjekt; byggeøkt-nøkler bare i Tuas prosjekter; menneskeskrevet aldri', erDriftEtterRegel(alle.find((a) => a.key === 'lenker' && a.project === 'Gammelt')) && erDriftEtterRegel(alle.find((a) => a.key === 'import:gammel')) && erDriftEtterRegel(alle.find((a) => a.key === 'svar:gammel12:deadbeef')) && !erDriftEtterRegel(alle.find((a) => a.key === 'svar:annet123:cafe0001')) && !erDriftEtterRegel(alle.find((a) => a.key === 'svar:gammel12:feedface')) && !erDriftEtterRegel(alle.find((a) => a.key === 'notat')))
  ok('erDriftEtterRegel: drift: false (Behold) røres aldri', !erDriftEtterRegel({ ...alle.find((a) => a.key === 'import:gammel'), drift: false }))
  const kjør = (...a) => spawnSync(process.execPath, [path.join(HERE, 'review.js'), ...a], { encoding: 'utf8', env: { ...process.env } })
  const driftFør = load().filter((a) => a.drift === true).length
  const d = kjør('--drift', '--dry-run')
  ok('review --drift --dry-run: 4 ville fått drift (økt, gammelt svar, lenker, import), 2 menneskeskrevet og 1 Behold holdt utenfor, tall per klasse før/etter, skriver ingenting', d.status === 0 && /· 4 ville fått drift: true · DRY-RUN/.test(d.stdout) && /2 menneskeskrevet · 1 brukeren sa/.test(d.stdout) && /Klasser før: arbeid \d+ · spor \d+ · drift \d+ · tråd \d+/.test(d.stdout) && /Klasser etter:/.test(d.stdout) && /Tua_test/.test(d.stdout) && load().filter((a) => a.drift === true).length === driftFør, d.stdout.split('\n').slice(0, 3).join(' | ') + d.stderr)
  const r = kjør('--drift')
  const etter = load()
  ok('review --drift: merker de fire, aldri Eriks notat, det rettede svaret eller svaret i et annet prosjekt', r.status === 0 && /4 saker merket drift/.test(r.stdout) && etter.find((a) => a.key === `okt:${SID2}`).drift === true && etter.find((a) => a.key === 'svar:gammel12:deadbeef').drift === true && etter.find((a) => a.key === 'lenker' && a.project === 'Gammelt').drift === true && etter.find((a) => a.key === 'import:gammel').drift === true && etter.find((a) => a.key === 'notat').drift === undefined && etter.find((a) => a.key === 'svar:gammel12:feedface').drift === undefined && etter.find((a) => a.key === 'svar:annet123:cafe0001').drift === undefined, r.stdout.split('\n')[0] + r.stderr)
  ok('review --drift igjen: 0 nye (idempotent)', /· 0 ville fått/.test(kjør('--drift', '--dry-run').stdout))
  // --fanget: drift-saker hoppes over; det menneskeskrevne svaret og Eriks notat merkes aldri
  const f = kjør('--fanget', '--dry-run')
  ok('review --fanget --dry-run: viser tall per klasse og per prosjekt; drift-saker er ikke kandidater; skriver ingenting', f.status === 0 && /Klasser før:/.test(f.stdout) && /Per prosjekt etter:/.test(f.stdout) && /DRY-RUN/.test(f.stdout) && load().filter((a) => a.fanget).length === etter.filter((a) => a.fanget).length, f.stdout.split('\n')[0])
  const f2 = kjør('--fanget')
  const etter2 = load()
  ok('review --fanget: svaret i det andre prosjektet blir fanget; det rettede svaret (menneske) og Eriks notat aldri; drift-saker får ikke fanget i tillegg', f2.status === 0 && etter2.find((a) => a.key === 'svar:annet123:cafe0001').fanget === true && etter2.find((a) => a.key === 'svar:gammel12:feedface').fanget === undefined && etter2.find((a) => a.key === 'notat').fanget === undefined && etter2.find((a) => a.key === 'svar:gammel12:deadbeef').fanget === undefined, f2.stdout.split('\n')[0])
  const t = tellKlasser(etter2)
  ok('tellKlasser: alle fire klasser finnes i testarkivet nå', t.arbeid > 0 && t.spor > 0 && t.drift > 0 && t.tråd > 0, JSON.stringify(t))
}

// ── 11) broen ────────────────────────────────────────────────────────────────
const PORT = 5303
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1', TUA_SKRIVER: 'regel' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, init); return { status: r.status, json: await r.json().catch(() => null) } }
const post = (p, body) => hent(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
try {
  const at = (await hent('/api/atoms')).json
  const kl = new Set(at.atoms.map((a) => a.klasse))
  ok('/api/atoms: hver sak har klasse, vekt (tall), sist_rørt; `klasser` teller hele arkivet', at.atoms.every((a) => ['arbeid', 'spor', 'drift', 'tråd'].includes(a.klasse) && typeof a.vekt === 'number' && a.sist_rørt > 0) && kl.size === 4 && Object.values(at.klasser).reduce((x, y) => x + y, 0) === at.total, JSON.stringify(at.klasser))
  ok('/api/atoms: vekt 0 for alt som ikke er arbeid; > 0 for arbeid', at.atoms.filter((a) => a.klasse !== 'arbeid').every((a) => a.vekt === 0) && at.atoms.filter((a) => a.klasse === 'arbeid').every((a) => a.vekt > 0))
  const stor = at.atoms.find((a) => a.key === 'stor'), tom = at.atoms.find((a) => a.key === 'tom')
  ok('/api/atoms: det bearbeidede arbeidet veier mer enn den nyeste tomme saken; sist_rørt tar med bruk og utlevering', stor.vekt > tom.vekt && stor.sist_rørt > stor.capturedAt, JSON.stringify([stor.vekt, tom.vekt]))
  const pr = at.atoms.find((a) => a.id === promptId)
  ok('/api/atoms: prompt-saken har `tråden` samlet (svar, forskjeller, konklusjon, åpen, runder) og `tråd` er fortsatt prompt-id på alle i tråden', pr && pr.tråden && pr.tråden.svar.length === 2 && pr.tråden.konklusjon && pr.tråden.konklusjon_status === 'endelig' && pr.tråden.forskjeller.length === 1 && pr.tråden.åpen === false && pr.tråd === promptId && at.atoms.filter((a) => a.tråd === promptId).length >= 4 && at.atoms.filter((a) => a.kind !== 'prompt').every((a) => a.tråden === null) && at.atoms.filter((a) => a.kind === 'prompt').every((a) => a.tråden && Array.isArray(a.tråden.svar)), JSON.stringify(pr?.tråden))
  ok('/api/atoms: drift og beholdt bæres som felt', at.atoms.some((a) => a.drift === true) && at.atoms.some((a) => a.beholdt === true))
  const sUten = (await hent('/api/search?q=commit&limit=100')).json, sMed = (await hent('/api/search?q=commit&limit=100&drift=med')).json, sBare = (await hent('/api/search?q=commit&limit=100&drift=bare')).json
  ok('/api/search: drift utenfor som standard + driftUtenfor; drift=med alle; drift=bare bare dem; hvert treff har klasse og drift', sUten.hits.every((h) => h.drift === false) && sUten.driftUtenfor > 0 && sMed.total === sUten.total + sBare.total && sBare.hits.every((h) => h.drift === true && h.klasse === 'drift'), JSON.stringify([sUten.total, sUten.driftUtenfor, sMed.total, sBare.total]))
  // behold
  const svar2 = svarIder[1]
  const b = await post('/api/behold', { id: svar2 })
  ok('POST /api/behold {id}: 200, beholdt: true, klasse arbeid; fila har beholdt', b.status === 200 && b.json.atom.beholdt === true && b.json.atom.klasse === 'arbeid' && /\nbeholdt: true\n/.test(fs.readFileSync(b.json.atom.file, 'utf8')), JSON.stringify(b.json?.error))
  const driftSak = at.atoms.find((a) => a.key === 'import:gammel')
  const b2 = await post('/api/behold', { id: driftSak.id })
  ok('POST /api/behold på en drift-sak: løftes inn (drift: false, klasse arbeid) — regelen rører den aldri igjen', b2.status === 200 && b2.json.atom.drift === false && b2.json.atom.klasse === 'arbeid' && b2.json.før.drift === true && !erDriftEtterRegel(load().find((a) => a.id === driftSak.id)))
  ok('behold uten id → 400; ukjent id → 404', (await post('/api/behold', {})).status === 400 && (await post('/api/behold', { id: 'a_x' })).status === 404)
  // bruk
  const u = await post('/api/bruk', { id: stor.id, hendelse: 'lest_L' })
  ok('POST /api/bruk {id, hendelse}: 200 og hendelsen står i bruk.jsonl; vekten øker', u.status === 200 && u.json.ok && fs.readFileSync(path.join(ROOT, '.tua', 'bruk.jsonl'), 'utf8').includes('"lest_L"') && (await hent('/api/atoms')).json.atoms.find((a) => a.id === stor.id).vekt > stor.vekt)
  ok('bruk: ukjent hendelse → 400 med lista; uten id → 400; ukjent id → 404', (await post('/api/bruk', { id: stor.id, hendelse: 'tull' })).status === 400 && (await post('/api/bruk', { id: stor.id, hendelse: 'tull' })).json.hendelser.includes('lest_M') && (await post('/api/bruk', { hendelse: 'lest_M' })).status === 400 && (await post('/api/bruk', { id: 'a_x', hendelse: 'lest_M' })).status === 404)
  // siden-sist
  const ss = (await hent('/api/siden-sist?dager=90')).json
  ok('GET /api/siden-sist: formen — spørsmål, svarKom, konklusjoner, innboks, økter, økterPerDag', ss && Array.isArray(ss.spørsmål) && Array.isArray(ss.svarKom) && Array.isArray(ss.konklusjoner) && typeof ss.innboks.antall === 'number' && Array.isArray(ss.økter) && Array.isArray(ss.økterPerDag) && ss.dager === 90)
  ok('siden-sist: tråden er lukket (konklusjon låst, svar beholdt) → ikke blant spørsmål i arbeid; ingen konklusjon venter', !ss.spørsmål.some((s) => s.id === promptId) && ss.konklusjoner.length === 0)
  ok('siden-sist: øktene er med (begge Code-øktene, pluss de gamle svar-nøklene fra review-testen), én linje per økt med saker (id-er, aldri innhold) og tekst per dag', ss.antallØkter >= 2 && [SID1, SID2].every((sid) => ss.økter.some((ø) => ø.økt === sid.slice(0, 8))) && ss.økter.every((ø) => ø.økt && ø.name && Array.isArray(ø.saker) && ø.content === undefined) && ss.økterPerDag[0].tekst.startsWith('I Claude '), ss.økterPerDag.map((d) => d.tekst).join(' | '))
  // et nytt åpent spørsmål fra Spør → står i siden-sist
  const atoms2 = load(); const kilde = atoms2.find((a) => a.key === 'stor')
  const ev = []; await spor({ melding: 'Hva er de tre viktigste punktene i dette, og hva mangler før det kan sendes til styret?', saker: [{ id: kilde.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Arbeid', klient: 'test', på: (e, d) => ev.push([e, d]) })
  const p2 = ev.find(([e]) => e === 'ferdig')?.[1]?.prompt
  const ss2 = (await hent('/api/siden-sist')).json
  const sp = ss2.spørsmål.find((s) => s.id === p2)
  ok('siden-sist: det nye spørsmålet står som «spørsmål i arbeid» med tråden (1 svar, åpen) og svaret i svarKom', sp && sp.tråden.åpen === true && sp.tråden.svar.length === 1 && sp.klasse === 'tråd' && ss2.svarKom.some((s) => s.id === sp.tråden.svar[0] && s.tråd === p2), JSON.stringify(sp?.tråden))
  ok('siden-sist: dager begrenses til 1–90', (await hent('/api/siden-sist?dager=1000')).json.dager === 90 && (await hent('/api/siden-sist?dager=0')).json.dager === 1)
  ok('/api/fanget/behold (2c) setter nå også beholdt', (await post('/api/fanget/behold', { id: at.atoms.find((a) => a.key === 'svar:annet123:cafe0001').id })).json.atom.beholdt === true)
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} feil` : 'alle grønne'}`)
process.exit(feil ? 1 : 0)
