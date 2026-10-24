#!/usr/bin/env node
// test-fanget.mjs — Fanget-bøtta, serverdelen (runde 2c i arbeidsstykke 32, §5 spørsmål 1, Erik 24.10.2026: enig).
// «Fang alt, men i en Fanget-bøtte utenfor forsiden og søket til du løfter saken inn. Avisen viser det som er laget med vilje.»
// ALDRI mot ~/Dropbox/Tua, ALDRI Eriks ekte ~/.claude/projects (falskt tre i scratch, TUA_CODE_HOME), ALDRI et ekte modellkall (test-mottakeren).
//
//   TUA_FILES_ROOT=/tmp/tua-test-fanget/arkiv TUA_DATA_DIR=/tmp/tua-test-fanget/data TUA_HOME=/tmp/tua-test-fanget/hjem node server/test-fanget.mjs
//
// Sjekker: files.js skriver/leser `fanget: true` · makeAtom/upsert: flagget settes på nye, settes aldri igjen på en sak som er løftet inn, fjernes bare med
// fanget: false · importCode (Code) og importParsed (Desktop-form) setter flagget på samtale, prompt og svar, ikke på filer Claude skrev · hooken (prompt,
// svar, økt) setter det, fil-modus ikke · tua_save (upsert uten flagg), Spør gjennom motoren (prompt, svar), innlesing fra Innboks og compose får det IKKE ·
// store.search holder fangede utenfor som standard, teller dem (page.fanget), tar dem med med fanget=med og gir bare dem med fanget=bare · related bruker alt ·
// erFangetEtterRegel (review.js --fanget): nøkkel-regelen og de fire unntakene · behold (flagg bort, flytt via lageret) · slåSammen (ny versjon av inn_i med
// kildepeker, den fangede i papirkurv) · kast/angre (fila i .tua/papirkurv/<prosjekt>/, indeks, tilbake på plass; load() ser den aldri) · broen: /api/atoms
// bærer feltet, /api/search uten/med/bare + fangetUtenfor, /api/fanget med tall per kilde/prosjekt/slag, behold/slaa-sammen/kast/angre/papirkurv, 400/404 ·
// review.js --fanget --dry-run skriver ingenting, --fanget setter flagget på eksisterende saker etter regelen.
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
fs.mkdirSync(path.join(ROOT, 'Innboks'), { recursive: true })

const files = await import('./files.js')
const store = await import('./store.js')
const { load, save, upsert, search, related, compose, erFangetEtterRegel, behold, slåSammen, kast, angre, papirkurv, fileOf, versions, sha8 } = store
const imp = await import('./import.js')
const { importCode, importParsed, promptKey } = imp
const { spor } = await import('./motor.js')
const { lesInn } = await import('./innlesing.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const les = (a) => fs.readFileSync(fileOf(a), 'utf8')

// ── 1) files.js og lageret ──────────────────────────────────────────────────
{
  const a = store.makeAtom({ content: 'Innhold '.repeat(50), name: 'Fanget prøve', project: 'P', fanget: true })
  const md = files.serialize(a)
  ok('serialize: `fanget: true` i frontmatter når satt; parse leser det tilbake', /\nfanget: true\n/.test(md) && files.parse(md).fanget === true)
  const b = store.makeAtom({ content: 'Med vilje '.repeat(50), name: 'Vilje', project: 'P' })
  ok('serialize: ingen fanget-linje når flagget ikke er satt; parse gir undefined', !/fanget/.test(files.serialize(b)) && files.parse(files.serialize(b)).fanget === undefined)
  ok('parse: fanget: false i fila = løftet inn (eksplisitt false); tull i feltet = med vilje (undefined)', files.parse(files.serialize(b).replace('---\n# Vilje', 'fanget: false\n---\n# Vilje')).fanget === false && files.parse(files.serialize(b).replace('---\n# Vilje', 'fanget: "tull"\n---\n# Vilje')).fanget === undefined)

  const atoms = []
  const r1 = upsert(atoms, { key: 'svar:abc:1', content: 'Svar '.repeat(200), name: 'Svar én', project: 'P', fanget: true })
  ok('upsert ny med fanget: true → saken er fanget', r1.status === 'ny' && r1.atom.fanget === true)
  const r2 = upsert(atoms, { key: 'svar:abc:1', content: 'Svar '.repeat(200), name: 'Svar én', project: 'P', fanget: true })
  ok('upsert igjen, samme innhold og flagg → uendret', r2.status === 'uendret' && r2.atom.fanget === true)
  const r3 = upsert(atoms, { key: 'svar:abc:1', content: 'Svar '.repeat(200), name: 'Svar én', project: 'P', fanget: false })
  ok('upsert med fanget: false → løftet inn (eksplisitt false, status nivåer, samme versjon)', r3.status === 'nivåer' && r3.atom.fanget === false && (r3.atom.version || 1) === 1)
  const r4 = upsert(atoms, { key: 'svar:abc:1', content: 'Svar '.repeat(200) + 'mer', name: 'Svar én', project: 'P', fanget: true })
  ok('upsert med fanget: true på en sak som er løftet inn → setter det IKKE igjen (brukerens valg vinner), ny versjon av innholdet', r4.status === 'oppdatert' && r4.atom.fanget === false && r4.atom.version === 2)
  const r5 = upsert(atoms, { key: 'svar:abc:2', content: 'To '.repeat(200), name: 'Svar to', project: 'P', fanget: true })
  const r6 = upsert(atoms, { key: 'svar:abc:2', content: 'To '.repeat(200), name: 'Svar to', project: 'P' })
  ok('upsert uten fanget-felt på en fanget sak → står som fanget (bare eksplisitt false tar det bort)', r5.atom.fanget === true && r6.status === 'uendret' && r6.atom.fanget === true)
  save(atoms)
  const igjen = load()
  ok('load fra mappa: flagget følger fila', igjen.find((a) => a.key === 'svar:abc:2').fanget === true && igjen.find((a) => a.key === 'svar:abc:1').fanget === false)
}

// ── 2) et falskt ~/.claude/projects-tre → importCode ────────────────────────
const P1 = 'Kan du skrive et sammendrag av møtenotatet om lagerflytting og foreslå tre tiltak for neste kvartal? Ta med budsjettet.'
const A1 = ('# Sammendrag av møtenotatet\n\n' + 'Lageret flyttes til Industriveien 4 i løpet av neste kvartal, og budsjettet er 45 000 kroner. '.repeat(40)).trim()
const SID = 'sess-1111-2222-3333-4444'
const T0 = Date.parse('2026-10-20T10:00:00+02:00')
const DOKFIL = path.join(SCRATCH, 'Prosjekt', 'notat.md')
fs.mkdirSync(path.dirname(DOKFIL), { recursive: true })
const DOK = '# Notat om lageret\n\n' + 'Dette notatet skrev Claude Code som fil i prosjektet, og det ligger på disk. '.repeat(20)
fs.writeFileSync(DOKFIL, DOK)
const linje = (type, content, i, extra = {}) => JSON.stringify({ type, message: { role: type, content }, cwd: '/Users/test/Prosjekt', sessionId: SID, timestamp: new Date(T0 + i * 60000).toISOString(), ...extra })
const transkript = [
  linje('user', [{ type: 'text', text: P1 }], 0),
  linje('assistant', [{ type: 'text', text: A1 }], 1),
  linje('user', [{ type: 'text', text: 'Skriv notatet til fil også, som markdown i prosjektmappa, så jeg finner det igjen senere i Finder.' }], 2),
  linje('assistant', [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: DOKFIL, content: DOK } }], 3),
  linje('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], 4),
  linje('assistant', [{ type: 'text', text: 'Notatet er skrevet.' }], 5),
].join('\n') + '\n'
const PROSJEKTDIR = path.join(CODE_HOME, '.claude', 'projects', '-Users-test-Prosjekt')
fs.mkdirSync(PROSJEKTDIR, { recursive: true })
fs.writeFileSync(path.join(PROSJEKTDIR, `${SID}.jsonl`), transkript)
{
  const r = importCode({ log: () => {} })
  const atoms = load()
  const samtale = atoms.find((a) => a.key === `samtale:${SID}`), prompt = atoms.find((a) => a.key === promptKey(SID, P1)), svar = atoms.find((a) => a.key === `svar:${SID.slice(0, 8)}:${sha8(A1)}`)
  const fil = atoms.find((a) => a.key === `fil:${DOKFIL}`)
  ok('importCode: samtale, prompt og svar har fanget: true', samtale?.fanget === true && prompt?.fanget === true && svar?.fanget === true, JSON.stringify([r.stats.nye, r.stats.prompter, r.stats.svar]))
  ok('importCode: fila Claude skrev (fil:) er et dokument med vilje — ikke fanget', fil && fil.fanget === undefined, JSON.stringify(fil && [fil.name, fil.tags]))
  ok('fila på disk har fanget: true i frontmatter for svaret, ingen fanget-linje for dokumentet', /\nfanget: true\n/.test(les(svar)) && !/\nfanget: /.test(les(fil)))
  // løft inn, så import igjen: flagget kommer ikke tilbake
  behold(atoms, svar.id); save(atoms)
  importCode({ log: () => {} })
  ok('import igjen etter behold: svaret står løftet inn (flagget kommer ikke tilbake), prompten er fortsatt fanget', load().find((a) => a.id === svar.id).fanget === false && load().find((a) => a.id === prompt.id).fanget === true)
}

// ── 3) importParsed (Desktop/eksport-form) ──────────────────────────────────
{
  const P3 = 'Skriv et utkast til e-post til styret om flyttingen av lageret: hva som er bestemt, hva det koster og når det skjer.'
  const A = 'Svar fra Desktop om budsjettet. '.repeat(120)
  const data = { kind: 'claude', convs: [{ id: 'conv-aaaa-bbbb', title: 'Budsjettsamtalen', created: T0, updated: T0 + 5000, project: 'Prosjekt', projectUuid: null, source: 'Claude Desktop', href: 'claude://claude.ai/chat/conv-aaaa-bbbb', summary: '', firstUser: P3,
    transcript: `**Bruker:** ${P3}\n\n**Claude:** ${A}`, messages: 2, artifacts: [{ id: 'art1', title: 'Styrenotat.md', content: 'Et artifact med tekst. '.repeat(60) }], attachments: [], pairs: [{ prompt: P3, at: T0 + 1000, answers: [A] }] }],
    docs: [{ id: 'doc1', title: 'Prosjektkunnskap.md', content: 'Dokument lastet opp i Claude-prosjektet. '.repeat(40), project: 'Prosjekt', projectUuid: null, created: T0 }], projects: [] }
  importParsed(data, { name: 'test', label: 'Test', log: () => {}, reportKey: 'import:test-desktop', reportName: 'Import: test' })
  const atoms = load()
  const s = atoms.find((a) => a.key === 'samtale:conv-aaaa-bbbb'), p = atoms.find((a) => a.key === promptKey('conv-aaaa-bbbb', P3)), sv = atoms.find((a) => a.key === `svar:conv-aaa:${sha8(A)}`)
  const art = atoms.find((a) => a.key === 'artifact:conv-aaaa-bbbb:art1'), doc = atoms.find((a) => a.key === 'claude-doc:doc1'), rapport = atoms.find((a) => a.key === 'import:test-desktop')
  ok('importParsed: samtale, prompt og svar fanget', s?.fanget === true && p?.fanget === true && sv?.fanget === true)
  ok('importParsed: artifact, prosjektdokument og importrapporten er ikke fanget', art && art.fanget === undefined && doc && doc.fanget === undefined && rapport && rapport.fanget === undefined)
}

// ── 4) hooken ───────────────────────────────────────────────────────────────
{
  const HSID = 'hook-sess-9999-8888'
  const hookTr = path.join(PROSJEKTDIR, `${HSID}.jsonl`)
  const hook = (mode, input) => spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), mode], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, TUA_HOOK_ALLOW_TMP: '1' } })
  const HP = 'Lag en liste over alle leverandørene som ble nevnt i notatet, med hva hver av dem leverer og hvem som er kontaktperson hos oss.'
  const HA = ('# Leverandørliste\n\n' + 'Leverandøren leverer paller og truckutleie, kontaktperson er lagerlederen. '.repeat(60)).trim()
  fs.writeFileSync(hookTr, [linje('user', [{ type: 'text', text: HP }], 0, { sessionId: HSID }), linje('assistant', [{ type: 'text', text: HA }], 1, { sessionId: HSID }), linje('user', [{ type: 'text', text: 'Og legg den i en fil i prosjektet, takk — gjerne som markdown så den kan leses i Finder.' }], 2, { sessionId: HSID }), linje('assistant', [{ type: 'text', text: 'Gjort.' }], 3, { sessionId: HSID })].join('\n') + '\n')
  const r1 = hook('prompt', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', prompt: HP, hook_event_name: 'UserPromptSubmit' })
  const r2 = hook('svar', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', last_assistant_message: HA })
  const HFIL = path.join(SCRATCH, 'Prosjekt', 'leverandører.md'); fs.writeFileSync(HFIL, '# Leverandører\n\n' + 'Fil skrevet av Claude Code i økta. '.repeat(30))
  const r3 = hook('fil', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', tool_name: 'Write', tool_input: { file_path: HFIL } })
  const r4 = hook('okt', { session_id: HSID, transcript_path: hookTr, cwd: '/Users/test/Prosjekt', hook_event_name: 'SessionEnd' })
  const atoms = load()
  const p = atoms.find((a) => a.key === promptKey(HSID, HP)), sv = atoms.find((a) => a.key === `svar:${HSID.slice(0, 8)}:${sha8(HA)}`), fil = atoms.find((a) => a.key === `fil:${HFIL}`), okt = atoms.find((a) => a.key === `okt:${HSID}`)
  ok('hook: prompt-, svar- og økt-saken er fanget', [r1, r2, r4].every((r) => r.status === 0) && p?.fanget === true && sv?.fanget === true && okt?.fanget === true, JSON.stringify([!!p, !!sv, !!okt, r2.stderr.slice(0, 200)]))
  ok('hook fil-modus: dokumentet er ikke fanget', r3.status === 0 && fil && fil.fanget === undefined, JSON.stringify([r3.status, !!fil]))
}

// ── 5) det som lages med vilje: tua_save, Spør, innlesing, compose ──────────
{
  let atoms = load()
  const { atom: notat } = upsert(atoms, { content: 'Et notat jeg selv ba om å få lagret til Tua. '.repeat(30), name: 'Mitt notat', project: 'Prosjekt', convo: 'Samtalen', short: 'Et notat jeg selv ba om.', by: 'Claude', source: 'Claude' })
  save(atoms)
  ok('tua_save (upsert uten fanget): ikke fanget', load().find((a) => a.id === notat.id).fanget === undefined)
  const r = await spor({ melding: 'Hva står i notatet om leverandørene, og hva bør vi gjøre først?', saker: [{ id: notat.id, nivå: 'S' }], mottakere: ['test', 'test2'], prosjekt: 'Prosjekt' })
  atoms = load()
  const sporSaker = [atoms.find((a) => a.id === r.prompt), ...r.svar.map((id) => atoms.find((a) => a.id === id)), r.konklusjon?.id ? atoms.find((a) => a.id === r.konklusjon.id) : null].filter(Boolean)
  ok('Spør gjennom motoren: prompt, svar (to mottakere), konklusjon — ingen fanget', sporSaker.length >= 3 && sporSaker.every((a) => a.fanget === undefined), JSON.stringify(sporSaker.map((a) => [a.kind, a.fanget])))
  const fil = path.join(ROOT, 'Innboks', 'referat.md'); fs.writeFileSync(fil, '# Referat\n\n' + 'Referat fra møtet om lagerflyttingen, skrevet av oss og lagt i Innboks. '.repeat(30))
  const inn = await lesInn(fil, { prosjekt: 'Prosjekt' })
  ok('innlesing fra Innboks: saken er ikke fanget', load().find((a) => a.id === inn.id)?.fanget === undefined, JSON.stringify(inn.id))
  atoms = load()
  const c = compose(atoms, { ids: [notat.id], level: 'S', name: 'Leveranse' })
  const { atom: lev } = upsert(atoms, { kind: 'leveranse', name: 'Leveranse', content: c.content, project: 'Prosjekt', derivedFrom: c.derivedFrom, by: 'regel' })
  save(atoms)
  ok('compose/leveranse: ikke fanget', load().find((a) => a.id === lev.id).fanget === undefined)
}

// ── 6) søk, related, regelen ────────────────────────────────────────────────
{
  const atoms = load()
  const fangede = atoms.filter((a) => a.fanget)
  ok(`arkivet har nå fangede (${fangede.length}) og ikke-fangede (${atoms.length - fangede.length}) saker`, fangede.length >= 5 && atoms.length - fangede.length >= 5)
  const uten = search(atoms, 'lageret', { limit: 100 }), med = search(atoms, 'lageret', { fanget: 'med', limit: 100 }), bare = search(atoms, 'lageret', { fanget: 'bare', limit: 100 })
  ok('search standard: ingen fangede i treffene, page.fanget teller dem som ble holdt utenfor', uten.every((h) => !h.atom.fanget) && uten.fanget > 0 && uten.fanget === bare.total, JSON.stringify([uten.total, uten.fanget, bare.total]))
  ok('search fanget=med: alle med, fanget=0; med.total = uten.total + bare.total', med.fanget === 0 && med.total === uten.total + bare.total && med.some((h) => h.atom.fanget))
  ok('search fanget=bare: bare fangede, page.fanget = de ikke-fangede som ble holdt utenfor', bare.every((h) => h.atom.fanget) && bare.fanget === uten.total)
  const tom = search(atoms, 'finnesikkeordet', {})
  ok('search uten treff: total 0, fanget 0', tom.total === 0 && tom.fanget === 0)
  const prompt = atoms.find((a) => a.key === promptKey(SID, P1))
  const rel = related(atoms, atoms.find((a) => a.key === `fil:${DOKFIL}`))
  ok('related bruker fortsatt alt: den fangede prompten i samme samtale er med', rel.sameConvo.some((x) => x.id === prompt.id))
  // regelen for engangs-merkingen
  const n = (key, extra = {}) => ({ key, project: 'P', ...extra })
  ok('erFangetEtterRegel: svar:/prompt:<økt>/okt:/samtale: ja; prompt:spor:, fil:, konklusjon:, uten nøkkel nei',
    erFangetEtterRegel(n('svar:ab12cd34:ffffffff')) && erFangetEtterRegel(n('prompt:ab12cd34:ffffffff')) && erFangetEtterRegel(n('okt:sess-1')) && erFangetEtterRegel(n('samtale:conv-1')) &&
    !erFangetEtterRegel(n('prompt:spor:ffffffff')) && !erFangetEtterRegel(n('fil:/x/y.md')) && !erFangetEtterRegel(n('konklusjon:a_1')) && !erFangetEtterRegel({ project: 'P' }))
  ok('erFangetEtterRegel: menneskeskrevet S, synlig i annet prosjekt, status satt eller utlevert → ikke fanget',
    !erFangetEtterRegel(n('svar:ab12cd34:ffffffff', { levels: { S: { text: 'x', by: 'menneske' } } })) && !erFangetEtterRegel(n('svar:ab12cd34:ffffffff', { refs: ['Annet'] })) &&
    !erFangetEtterRegel(n('svar:ab12cd34:ffffffff', { status: 'endelig' })) && !erFangetEtterRegel(n('svar:ab12cd34:ffffffff'), { utlevert: 1 }) && erFangetEtterRegel(n('svar:ab12cd34:ffffffff', { levels: { S: { text: 'x', by: 'regel' } } })))
}

// ── 7) behold, slå sammen, kast, angre — i lageret ──────────────────────────
{
  let atoms = load()
  const prompt = atoms.find((a) => a.key === promptKey(SID, P1))
  const r = behold(atoms, prompt.id, { prosjekt: 'Lager' }); save(atoms)
  const etter = load().find((a) => a.id === prompt.id)
  ok('behold med prosjekt: fanget: false (løftet inn), saken flyttet til «Lager» (fila flyttet av lageret)', r.flyttet && etter.fanget === false && etter.project === 'Lager' && fs.existsSync(path.join(ROOT, 'Lager')) && fileOf(etter).includes(`${path.sep}Lager${path.sep}`), fileOf(etter))
  ok('behold: fila sier fanget: false — løftet inn, regelen rører den aldri igjen', /\nfanget: false\n/.test(les(etter)) && !erFangetEtterRegel(etter))
  atoms = load()
  const notat = atoms.find((a) => a.name === 'Mitt notat'), svarD = atoms.find((a) => a.key?.startsWith('svar:conv-aaa:'))
  const v0 = notat.version || 1, lengde0 = notat.content.length
  const sm = slåSammen(atoms, svarD.id, notat.id); save(atoms)
  atoms = load()
  const n2 = atoms.find((a) => a.id === notat.id)
  ok('slåSammen: inn_i har ny versjon, innholdet nederst med kildelinje, kildepeker i bygget_av', n2.version === v0 + 1 && n2.content.length > lengde0 + 100 && n2.content.includes('Slått sammen fra «') && n2.content.includes(svarD.content.slice(0, 60)) && (n2.derivedFrom || []).some((d) => d.id === svarD.id && d.level === 'L'), JSON.stringify([n2.version, n2.derivedFrom]))
  ok('slåSammen: forrige versjon av inn_i bevart i .tua/versions; kind står (ikke leveranse)', versions(notat.id).some((v) => v.name === `v${v0}`) && n2.kind === 'capture')
  ok('slåSammen: den fangede er borte fra lageret og ligger i papirkurven med grunn', !atoms.some((a) => a.id === svarD.id) && sm.kastet.innI === notat.id && papirkurv().some((e) => e.id === svarD.id && /slått sammen/.test(e.grunn)) && fs.existsSync(path.join(ROOT, sm.kastet.kurv)))
  // kast + angre
  const okt = atoms.find((a) => a.key?.startsWith('okt:'))
  const før = fileOf(okt), rel = path.relative(ROOT, før)
  const post = kast(atoms, okt.id)
  ok('kast: fila flyttet til .tua/papirkurv/<prosjekt>/, borte fra indeksen; load() ser den ikke', !fs.existsSync(før) && post.kurv.startsWith(path.join('.tua', 'papirkurv', okt.project)) && fs.existsSync(path.join(ROOT, post.kurv)) && !load().some((a) => a.id === okt.id) && !JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'index.json'), 'utf8'))[okt.id], post.kurv)
  ok('papirkurv(): to poster, nyeste først, med rel (hvor fila lå)', papirkurv().length === 2 && papirkurv()[0].id === okt.id && papirkurv()[0].rel === rel)
  let e = null; try { kast(load(), 'a_finnes_ikke') } catch (x) { e = x }
  ok('kast på ukjent id kaster «fant ikke»', e && /fant ikke/.test(e.message))
  const an = angre(okt.id)
  ok('angre: fila tilbake der den lå, inn i indeksen, saken i load() igjen med fanget-flagget intakt, ute av papirkurven', an.rel === rel && fs.existsSync(før) && load().find((a) => a.id === okt.id)?.fanget === true && papirkurv().length === 1 && !fs.existsSync(path.join(ROOT, post.kurv)))
  e = null; try { angre(okt.id) } catch (x) { e = x }
  ok('angre igjen: «ligger ikke i papirkurven»', e && /ligger ikke/.test(e.message))
}

// ── 8) review.js --fanget ───────────────────────────────────────────────────
{
  // tre eldre saker uten flagg: et hook-svar (skal merkes), en Spør-prompt (skal ikke), et svar med menneskeskrevet S (skal ikke)
  let atoms = load()
  upsert(atoms, { key: 'svar:gammel12:deadbeef', content: 'Et gammelt svar fra før flagget fantes. '.repeat(100), name: 'Gammelt svar', project: 'Prosjekt', tags: ['svar', 'auto'], by: 'regel', short: 'Gammelt.' })
  upsert(atoms, { key: 'samtale:gammel-okt-1', kind: 'samtale', content: 'En gammel økt. '.repeat(100), name: 'Gammel økt', project: 'Prosjekt', tags: ['samtale', 'code'], by: 'regel', short: 'Økt.' })
  upsert(atoms, { key: 'prompt:spor:cafebabe', kind: 'prompt', content: 'Et spørsmål stilt i Spør, med vilje, langt nok til å være en sak. '.repeat(3), name: 'Spør-prompt', project: 'Prosjekt', tags: ['prompt'], by: 'regel' })
  upsert(atoms, { key: 'svar:gammel12:feedface', content: 'Et svar noen har skrevet ingress på selv. '.repeat(100), name: 'Bearbeidet svar', project: 'Prosjekt', tags: ['svar', 'auto'], by: 'menneske', short: 'Min egen ingress.' })
  save(atoms)
  const kjør = (...a) => spawnSync(process.execPath, [path.join(HERE, 'review.js'), ...a], { encoding: 'utf8', env: { ...process.env } })
  const antallFør = load().filter((a) => a.fanget).length
  const d = kjør('--fanget', '--dry-run')
  ok('review --fanget --dry-run: sier 2 ville fått flagget (gammelt svar + gammel økt), skriver ingenting', d.status === 0 && /· 2 ville fått fanget: true · DRY-RUN/.test(d.stdout) && /1 menneskeskrevet S\/M/.test(d.stdout) && load().filter((a) => a.fanget).length === antallFør, d.stdout.split('\n').slice(0, 2).join(' | '))
  const r = kjør('--fanget')
  const etter = load()
  ok('review --fanget: setter flagget på de to, ikke på Spør-prompten eller det bearbeidede svaret', r.status === 0 && /2 saker merket fanget/.test(r.stdout) && etter.find((a) => a.key === 'svar:gammel12:deadbeef').fanget === true && etter.find((a) => a.key === 'samtale:gammel-okt-1').fanget === true && etter.find((a) => a.key === 'prompt:spor:cafebabe').fanget === undefined && etter.find((a) => a.key === 'svar:gammel12:feedface').fanget === undefined, r.stdout.split('\n')[0])
  const d2 = kjør('--fanget', '--dry-run')
  ok('review --fanget igjen: 0 nye (idempotent)', /· 0 ville fått/.test(d2.stdout) && / (\d+) alt merket fanget/.test(d2.stdout))
}

// ── 9) broen ────────────────────────────────────────────────────────────────
const PORT = 5302
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
  const fangedeAt = at.atoms.filter((a) => a.fanget === true), ikke = at.atoms.filter((a) => !a.fanget)
  ok('/api/atoms: alle saker med, feltet fanget: true på de fangede, fraværende/false på resten', fangedeAt.length >= 5 && ikke.length >= 5 && at.total === at.atoms.length, JSON.stringify([fangedeAt.length, ikke.length]))
  const sUten = (await hent('/api/search?q=lageret&limit=100')).json, sMed = (await hent('/api/search?q=lageret&limit=100&fanget=med')).json, sBare = (await hent('/api/search?q=lageret&limit=100&fanget=bare')).json
  ok('/api/search: standard uten fangede + fangetUtenfor; fanget=med alle; fanget=bare bare dem; hvert treff har feltet fanget', sUten.hits.every((h) => h.fanget === false) && sUten.fangetUtenfor > 0 && sMed.total === sUten.total + sBare.total && sMed.fangetUtenfor === 0 && sBare.hits.every((h) => h.fanget === true), JSON.stringify([sUten.total, sUten.fangetUtenfor, sMed.total, sBare.total]))
  const f = (await hent('/api/fanget')).json
  ok('/api/fanget: nyeste først, lette rader (S, ingen content), tall per kilde/prosjekt/slag, alle = total uten filter', f.saker.length === f.total && f.total === f.alle && f.alle === fangedeAt.length && f.saker.every((s) => s.fanget && s.S !== undefined && s.content === undefined && s.slag) && f.saker.every((s, i, l) => !i || l[i - 1].capturedAt >= s.capturedAt) && Object.values(f.perSlag).reduce((a, b) => a + b, 0) === f.alle && Object.keys(f.perKilde).length >= 2 && f.perProsjekt.Prosjekt >= 1, JSON.stringify([f.perSlag, f.perKilde, f.perProsjekt]))
  ok('/api/fanget: slag fra nøkkelen (svar, prompt, samtale, økt)', ['svar', 'prompt', 'samtale', 'økt'].every((s) => f.perSlag[s] >= 1), JSON.stringify(f.perSlag))
  const fp = (await hent('/api/fanget?prosjekt=Prosjekt&limit=2')).json
  ok('/api/fanget?prosjekt&limit: filtrert og paginert, alle = hele bøtta', fp.saker.length === 2 && fp.total === f.perProsjekt.Prosjekt && fp.alle === f.alle && fp.prosjekt === 'Prosjekt')
  // behold
  const svarRad = f.saker.find((s) => s.slag === 'svar')
  const b = await post('/api/fanget/behold', { id: svarRad.id, prosjekt: 'Nytt prosjekt' })
  ok('POST /api/fanget/behold {id, prosjekt}: 200, fanget false, flyttet til nytt prosjekt (mappe laget), fila flyttet', b.status === 200 && b.json.atom.fanget === false && b.json.flyttet && b.json.atom.project === 'Nytt prosjekt' && b.json.før.fanget === true && fs.existsSync(path.join(ROOT, 'Nytt prosjekt')) && load().find((a) => a.id === svarRad.id).project === 'Nytt prosjekt', JSON.stringify(b.json?.før))
  ok('/api/fanget etterpå: én færre', (await hent('/api/fanget')).json.alle === f.alle - 1)
  ok('behold uten id → 400; ukjent id → 404', (await post('/api/fanget/behold', {})).status === 400 && (await post('/api/fanget/behold', { id: 'a_x' })).status === 404)
  ok('behold med ugyldig prosjektnavn → 400', (await post('/api/fanget/behold', { id: f.saker[0].id, prosjekt: '.skjult' })).status === 400)
  // slå sammen
  const f2 = (await hent('/api/fanget')).json
  const promptRad = f2.saker.find((s) => s.slag === 'prompt')
  const mål = load().find((a) => a.name === 'Mitt notat')
  const vFør = (await hent('/api/atoms')).json.atoms.find((a) => a.id === mål.id).version
  const sm = await post('/api/fanget/slaa-sammen', { id: promptRad.id, inn_i: mål.id })
  ok('POST /api/fanget/slaa-sammen: 200, inn_i ny versjon med kildepeker, kastet-posten med innI', sm.status === 200 && sm.json.atom.version === vFør + 1 && sm.json.atom.derivedFrom.some((d) => d.id === promptRad.id) && sm.json.kastet.id === promptRad.id && sm.json.kastet.innI === mål.id, JSON.stringify(sm.json?.error || sm.json?.kastet?.grunn))
  ok('slå sammen: den fangede er ute av /api/atoms og i /api/papirkurv (uten sti inne i .tua)', !(await hent('/api/atoms')).json.atoms.some((a) => a.id === promptRad.id) && (await hent('/api/papirkurv')).json.saker.some((s) => s.id === promptRad.id && s.kurv === undefined && s.rel))
  ok('slå sammen uten inn_i → 400; ukjent inn_i → 404; med seg selv → 400', (await post('/api/fanget/slaa-sammen', { id: f2.saker[0].id })).status === 400 && (await post('/api/fanget/slaa-sammen', { id: f2.saker[0].id, inn_i: 'a_x' })).status === 404 && (await post('/api/fanget/slaa-sammen', { id: f2.saker[0].id, inn_i: f2.saker[0].id })).status === 400)
  ok('ruta godtar også «slå-sammen» med ø', (await post('/api/fanget/sl%C3%A5-sammen', {})).status === 400)
  // kast + angre
  const f3 = (await hent('/api/fanget')).json
  const samtaleRad = f3.saker.find((s) => s.slag === 'samtale')
  const k = await post('/api/fanget/kast', { id: samtaleRad.id })
  ok('POST /api/fanget/kast: 200, posten sier hvor fila lå; saken ute av /api/atoms og /api/fanget', k.status === 200 && k.json.kastet.id === samtaleRad.id && k.json.kastet.rel && !(await hent('/api/atoms')).json.atoms.some((a) => a.id === samtaleRad.id) && (await hent('/api/fanget')).json.alle === f3.alle - 1)
  const pk = (await hent('/api/papirkurv')).json
  ok('GET /api/papirkurv: tre poster (slått sammen-svaret fra lageret, prompten, samtalen), nyeste først, antall', pk.antall === 3 && pk.saker[0].id === samtaleRad.id && pk.saker.every((s) => s.id && s.name && s.project && s.at && s.grunn))
  const an = await post('/api/fanget/angre', { id: samtaleRad.id })
  ok('POST /api/fanget/angre: 200, saken tilbake i /api/atoms som fanget, papirkurven to poster', an.status === 200 && an.json.atom.id === samtaleRad.id && an.json.atom.fanget === true && (await hent('/api/atoms')).json.atoms.some((a) => a.id === samtaleRad.id && a.fanget === true) && (await hent('/api/papirkurv')).json.antall === 2)
  ok('kast ukjent → 404; angre på noe som ikke ligger der → 404; uten id → 400', (await post('/api/fanget/kast', { id: 'a_x' })).status === 404 && (await post('/api/fanget/angre', { id: samtaleRad.id })).status === 404 && (await post('/api/fanget/kast', {})).status === 400)
  // tua_get-adferd gjennom /api/sak: en fanget sak kan hentes som før
  const sak = (await hent(`/api/sak?id=${samtaleRad.id}`)).json
  ok('/api/sak på en fanget sak virker som før (nivåene er der)', sak && sak.id === samtaleRad.id && sak.nivåer?.L?.tekst?.length > 100)
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} feil` : 'alle grønne'}`)
process.exit(feil ? 1 : 0)
