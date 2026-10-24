#!/usr/bin/env node
// test-skriver.mjs — én skriver i lageret (runde 3c, V8-svakheten, 24.10.2026). ALDRI mot ~/Dropbox/Tua.
//
//   TUA_FILES_ROOT=/tmp/tua-test-skriver/arkiv TUA_DATA_DIR=/tmp/tua-test-skriver/data TUA_HOME=/tmp/tua-test-skriver/hjem node server/test-skriver.mjs
//
// Sjekker: dirty-sporing (en prosess som laster, endrer én sak og lagrer, skriver ÉN fil — de andre filene er urørt) · upsert/markDirty · saveAll · written.json
// oppdateres bare for det som ble skrevet, så en annen prosess' fil aldri regnes som «redigert utenfra» · to parallelle node-prosesser mot samme arkiv:
// ulike saker, OG samme sak med ulike felter → begge feltene står i fila (treveis fletting) · ekte konflikt (begge endret teksten) → disk vinner, vår tekst
// ligger i .tua/versions/<id>/ som «konflikt» · ukjente frontmatter-nøkler overlever load/save · Finder-flytt (fil flyttet utenfor Tua) virker som før · låsen.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
fs.mkdirSync(path.join(ROOT, '.tua'), { recursive: true })

const store = await import('./store.js')
const files = await import('./files.js')
const { load, save, saveAll, upsert, markDirty, erDirty, dirtyIds, fileOf, versions } = store
let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const les = (a) => fs.readFileSync(fileOf(a), 'utf8')
const mtimes = () => Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'index.json'), 'utf8'))).map(([id, rel]) => [id, fs.statSync(path.join(ROOT, rel)).mtimeMs]))
const written = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'written.json'), 'utf8'))
const vent = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1) grunnlag: 12 saker ───────────────────────────────────────────────────
{
  const atoms = []
  for (let i = 1; i <= 12; i++) upsert(atoms, { key: `sak:${i}`, name: `Sak ${i}`, content: `Innhold i sak ${i}. `.repeat(40), project: i <= 6 ? 'Alfa' : 'Beta', short: `Ingress ${i}.`, by: 'regel' })
  const n = save(atoms)
  ok('første save av en liste uten spor (ikke fra load): alle 12 skrives', n === 12 && store.sisteSave.skrevet === 12)
}
// ── 2) dirty-sporing ────────────────────────────────────────────────────────
{
  const atoms = load()
  ok('load gir en liste med spor, ingenting dirty', store.harSpor(atoms) && dirtyIds(atoms).length === 0)
  const før = mtimes()
  await vent(20)
  const a = atoms.find((x) => x.key === 'sak:3')
  a.tags = ['merket']
  ok('en endret sak er dirty, de andre ikke', erDirty(atoms, a) && dirtyIds(atoms).length === 1)
  const n = save(atoms)
  const etter = mtimes()
  ok('save skriver ÉN fil, hopper over 11', n === 1 && store.sisteSave.skrevet === 1 && store.sisteSave.hoppet === 11, JSON.stringify(store.sisteSave))
  ok('de 11 andre filene er urørt (mtime lik)', Object.entries(før).filter(([id]) => id !== a.id).every(([id, t]) => etter[id] === t))
  ok('etter save er ingenting dirty', dirtyIds(atoms).length === 0)
  const u = upsert(atoms, { key: 'sak:13', name: 'Sak 13', content: 'Ny sak. '.repeat(40), project: 'Alfa', by: 'regel' })
  ok('upsert ny → dirty', u.status === 'ny' && dirtyIds(atoms).length === 1)
  const u2 = upsert(atoms, { key: 'sak:4', name: 'Sak 4', content: `Innhold i sak 4. `.repeat(40), project: 'Alfa', short: 'Ingress 4.', by: 'regel' })
  ok('upsert uendret → ikke dirty', u2.status === 'uendret' && dirtyIds(atoms).length === 1)
  ok('save skriver bare den nye', save(atoms) === 1)
  markDirty(atoms, a.id)
  ok('markDirty uten endring: fila leses, men er lik → ingenting skrevet, hoppet-tallet ellers', save(atoms) === 0 && dirtyIds(atoms).length === 0)
  ok('saveAll tar alle som kandidater, men skriver ingenting når alt er likt disk', saveAll(atoms) === 0 && store.sisteSave.hoppet === 0)
}
// ── 3) en prosess med gammelt minne skriver ikke andres arbeid tilbake ──────
{
  const gammel = load()                                           // «broen» lastet for en time siden
  const ny = load()                                               // «terminal-review» laster og merker
  const x = ny.find((a) => a.key === 'sak:5'); x.drift = true
  ok('review-prosessen skriver én fil', save(ny) === 1)
  const y = gammel.find((a) => a.key === 'sak:6'); y.tags = ['annet']   // broen endrer en ANNEN sak og lagrer med gammelt minne
  const n = save(gammel)
  ok('den gamle prosessen skriver bare sin egen sak — drift-flagget på sak 5 står', n === 1 && /\ndrift: true\n/.test(les(x)), JSON.stringify(store.sisteSave))
  const w = written()
  ok('written.json for sak 5 er sha-en review skrev (ikke den gamle prosessens)', w[x.id].sha === store.sha256Tekst(les(x)))
  const igjen = load()
  ok('en ny load ser ingen «redigert utenfra» (ingen falsk versjon)', !igjen.some((a) => a.editedOutside) && igjen.find((a) => a.key === 'sak:5').version === 1)
}
// ── 4) samme sak, ulike felter, fra to lister → treveis fletting ───────────
{
  const A = load(), B = load()
  const a = A.find((s) => s.key === 'sak:7'), b = B.find((s) => s.key === 'sak:7')
  a.fanget = true; save(A)
  b.status = 'endelig'; b.tags = ['viktig']
  const n = save(B)
  ok('B skrev sak 7 flettet: fanget (fra A) OG status/tagger (fra B) står i fila', n === 1 && /\nfanget: true\n/.test(les(b)) && /\nstatus: "endelig"\n/.test(les(b)) && /"viktig"/.test(les(b)) && store.sisteSave.flettet.includes(b.id) && !store.sisteSave.konflikter.length, les(b).split('\n').slice(0, 14).join(' | '))
  ok('B sitt minne er oppdatert med A sitt felt (samme objekt)', b.fanget === true && b.status === 'endelig')
  ok('ingen konflikt-versjon ble laget', !versions(b.id).some((v) => /konflikt/.test(v.name)))
}
// ── 5) ekte konflikt: begge endret teksten → disk vinner, vår tekst til versions ──
{
  const A = load(), B = load()
  const a = A.find((s) => s.key === 'sak:8'), b = B.find((s) => s.key === 'sak:8')
  upsert(A, { key: 'sak:8', name: 'Sak 8', content: 'Tekst fra A. '.repeat(40), project: 'Beta', by: 'regel' }); save(A)
  upsert(B, { key: 'sak:8', name: 'Sak 8', content: 'Tekst fra B. '.repeat(40), project: 'Beta', by: 'regel', tags: ['fra-b'] })
  const n = save(B)
  const b2 = B.find((s) => s.key === 'sak:8')
  ok('konflikt: disk (A) vinner teksten; B sitt minne er byttet til disk', n === 1 && store.sisteSave.konflikter.includes(b.id) && /Tekst fra A/.test(les(b2)) && /Tekst fra A/.test(b2.content), JSON.stringify(store.sisteSave))
  ok('B sitt felt (tagger) som A ikke rørte, ble likevel med', /"fra-b"/.test(les(b2)))
  const vs = versions(b.id)
  ok('B sin tekst ligger i .tua/versions som «konflikt»', vs.some((v) => /konflikt/.test(v.name)) && fs.readFileSync(path.join(ROOT, '.tua', 'versions', b.id, vs.find((v) => /konflikt/.test(v.name)).name + '.md'), 'utf8').includes('Tekst fra B'), vs.map((v) => v.name).join(', '))
  ok('versjonen på disk er A sin (2), ikke 3', b2.version === 2)
}
// ── 6) ukjente frontmatter-nøkler overlever ──────────────────────────────────
{
  const atoms = load()
  const a = atoms.find((s) => s.key === 'sak:9')
  const md = les(a).replace('---\n# Sak 9', 'framtidsfelt: {"x":1}\nvault_nivaa: "lukket"\n---\n# Sak 9')
  fs.writeFileSync(fileOf(a), md)
  const A2 = load()
  const a2 = A2.find((s) => s.key === 'sak:9')
  ok('load leser ukjente nøkler inn i ekstra (og regner fila som redigert utenfra → ny versjon)', a2.ekstra?.framtidsfelt?.x === 1 && a2.ekstra.vault_nivaa === 'lukket' && a2.editedOutside && a2.version === 2)
  a2.tags = ['rørt']; save(A2)
  ok('save skriver nøklene tilbake uendret', /\nframtidsfelt: {"x":1}\n/.test(les(a2)) && /\nvault_nivaa: "lukket"\n/.test(les(a2)) && /\nversjon: 2\n/.test(les(a2)))
  const B2 = load(); const b2 = B2.find((s) => s.key === 'sak:9'); b2.status = 'utkast'; save(B2)
  ok('en annen liste som endrer saken, beholder også nøklene', /framtidsfelt/.test(les(b2)) && /\nstatus: "utkast"\n/.test(les(b2)))
}
// ── 7) Finder-flytt virker som før ───────────────────────────────────────────
{
  const atoms = load()
  const a = atoms.find((s) => s.key === 'sak:10')
  fs.mkdirSync(path.join(ROOT, 'Gamma'), { recursive: true })
  fs.renameSync(fileOf(a), path.join(ROOT, 'Gamma', path.basename(fileOf(a))))
  const A2 = load()
  const a2 = A2.find((s) => s.key === 'sak:10')
  ok('load: mappa vinner — saken er i Gamma, ikke dirty', a2.project === 'Gamma' && !erDirty(A2, a2))
  save(A2)
  const ix = JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'index.json'), 'utf8'))
  ok('save (ingenting dirty) oppdaterer indeksen til den nye stien uten å skrive fila', store.sisteSave.skrevet === 0 && ix[a2.id].startsWith('Gamma/') && store.sisteSave.indeksert >= 1)
}
// ── 8) to parallelle node-prosesser mot samme arkiv ─────────────────────────
{
  const skript = path.join(DATA, 'skriver.mjs')
  fs.writeFileSync(skript, `
    import { load, save, upsert } from ${JSON.stringify(path.join(HERE, 'store.js'))}
    const [navn, antall] = process.argv.slice(2)
    const atoms = load()
    await new Promise((r) => setTimeout(r, 30))                       // begge har lastet før noen skriver
    for (let i = 0; i < Number(antall); i++) upsert(atoms, { key: 'p:' + navn + ':' + i, name: navn + ' ' + i, content: ('Fra ' + navn + '. ').repeat(30), project: 'Parallell', by: 'regel' })
    const felles = atoms.find((a) => a.key === 'sak:11')
    if (navn === 'A') felles.drift = true; else felles.beholdt = true  // samme sak, ulike felter
    const felles2 = atoms.find((a) => a.key === 'sak:12')
    upsert(atoms, { key: 'sak:12', name: 'Sak 12', content: ('Tekst fra ' + navn + '. ').repeat(30), project: 'Beta', by: 'regel' })   // samme sak, begge endrer teksten
    const n = save(atoms)
    const { sisteSave } = await import(${JSON.stringify(path.join(HERE, 'store.js'))})
    console.log(JSON.stringify({ navn, n, ...sisteSave }))
  `)
  const kjør = (navn, antall) => new Promise((r) => { const p = spawn(process.execPath, [skript, navn, String(antall)], { env: process.env }); let ut = '', err = ''; p.stdout.on('data', (d) => (ut += d)); p.stderr.on('data', (d) => (err += d)); p.on('close', () => r({ ut, err })) })
  const [ra, rb] = await Promise.all([kjør('A', 8), kjør('B', 8)])
  const ja = (() => { try { return JSON.parse(ra.ut.trim().split('\n').at(-1)) } catch { return null } })(), jb = (() => { try { return JSON.parse(rb.ut.trim().split('\n').at(-1)) } catch { return null } })()
  ok('begge prosessene kjørte uten feil', ja && jb && !ra.err && !rb.err, (ra.err || rb.err).slice(0, 200))
  const alle = load()
  ok('alle 16 nye saker finnes (ingen tapt)', alle.filter((a) => String(a.key).startsWith('p:')).length === 16)
  const f = alle.find((a) => a.key === 'sak:11')
  ok('sak 11 har BEGGE feltene (drift fra A, beholdt fra B) — ingen slettet den andres', f.drift === true && f.beholdt === true, JSON.stringify([ja?.flettet?.length, jb?.flettet?.length, ja?.konflikter, jb?.konflikter]))
  const g = alle.find((a) => a.key === 'sak:12')
  const vs = versions(g.id)
  ok('sak 12 (begge endret teksten): én vant, den andres tekst ligger som konflikt-versjon', /Tekst fra [AB]/.test(g.content) && vs.some((v) => /konflikt/.test(v.name)), vs.map((v) => v.name).join(', '))
  ok('ingen falske «redigert utenfra» etter parallell skriving', !alle.some((a) => a.editedOutside))
  ok('låsen er sluppet', !fs.existsSync(path.join(ROOT, '.tua', '.lock')))
}
console.log(`\n${feil ? `${feil} FEIL` : 'alt grønt'}`)
process.exit(feil ? 1 : 0)
