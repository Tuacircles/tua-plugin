#!/usr/bin/env node
// test-rom.mjs — arbeidsstykke 35 skive 1 «Ett klikk åpner saken» (Erik 03.11.2026) mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall.
//
//   TUA_FILES_ROOT=/tmp/tua-test-rom/arkiv TUA_DATA_DIR=/tmp/tua-test-rom/data TUA_HOME=/tmp/tua-test-rom/hjem node server/test-rom.mjs
//
// Sjekker: reglene i regler.js (romSlag, romResultat, testValg, romDokumenter) · samtale.romKoblinger og GET /api/rom (dokumentene på samme kobling som raden i avisen, kildene,
// samtalen et dokument kom fra, atom uten samtale, ukjent id) · at /api/rom er lett (mye mindre enn /api/atoms) · at det å åpne rommet og forhåndsvise en test ikke sender eller logger noe.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_OLLAMA_URL = 'http://127.0.0.1:1'
process.env.TUA_TESTMOTTAKERE = '3'
process.env.TUA_UTEN_MINNE = '1'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODEX_HOME = path.join(path.dirname(ROOT), 'codex-tom')

const { load, save, upsert } = await import('./store.js')
const { romKoblinger } = await import('./samtale.js')
const regler = await import(pathToFileURL(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'regler.js')).href)

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${String(info).replace(/\s+/g, ' ').slice(0, 200)}` : ''}`); if (!cond) feil++ }

// ── 1) reglene ─────────────────────────────────────────────────────────────
ok('romSlag: samtale, tråd og en del av en samtale → samtalen', regler.romSlag({ kind: 'samtale' }) === 'samtale' && regler.romSlag({ kind: 'capture', tråd: { prompt: { id: 'p' } } }) === 'samtale' && regler.romSlag({ kind: 'svar', convo: 'X' }) === 'samtale' && regler.romSlag({ kind: 'prompt', tråd: 'p1' }) === 'samtale')
ok('romSlag: et arbeid → arbeidets siste samtale; et dokument, også med samtalenavn → dokumentet i midten', regler.romSlag({ kind: 'capture', arbeid: true }) === 'arbeid' && regler.romSlag({ kind: 'leveranse', convo: 'X' }) === 'les' && regler.romSlag({ kind: 'capture' }) === 'les' && regler.romSlag({ kind: 'svar' }) === 'les' && regler.romSlag(null) === 'les')
const langt = 'Funn. '.repeat(120)
const v = [{ id: 'b1', rolle: 'bruker', L: 'Hva nå?' }, { id: 'm1', rolle: 'modell', L: langt }, { id: 'b2', rolle: 'bruker', L: 'Og så?' }, { id: 'm2', rolle: 'modell', L: 'Nå ser jeg på det.' }]
ok('romResultat: det siste svaret med innhold, ikke siste vending; arbeidssteget foldes i en fanget samtale', regler.romResultat(v).resultat.id === 'm1' && regler.romResultat(v).antallSteg === 1 && regler.romResultat(v).erKonklusjon === false)
ok('romResultat: en samtale ført i Tua har ingen arbeidssteg å folde', regler.romResultat(v, { tua: true }).antallSteg === 0)
const k = { id: 'k1', rolle: 'konklusjon', L: 'Vi gjør det.', låst: true }
ok('romResultat: endte samtalen med en konklusjon, er den resultatet', regler.romResultat([...v, k]).resultat.id === 'k1' && regler.romResultat([...v, k]).erKonklusjon === true)
ok('romResultat: et modellsvar etter konklusjonen tar over', regler.romResultat([k, ...v]).resultat.id === 'm1' && regler.romResultat([k, ...v]).erKonklusjon === false)
ok('romResultat: bare en konklusjon, eller ingenting', regler.romResultat([k]).resultat.id === 'k1' && regler.romResultat([]).resultat === null && regler.romResultat([{ id: 'b', rolle: 'bruker', L: 'x' }]).resultat === null)
const M = [{ id: 'claude', label: 'Claude (Anthropic)', modell: 'claude-x', aktiv: true }, { id: 'ollama', label: 'Ollama (lokal)', modell: 'gemma3:4b', aktiv: true, local: true }, { id: 'openai', label: 'OpenAI (GPT)', modell: 'gpt-5.5', aktiv: false, hvorfor: 'mangler nøkkel' }, { id: 'mistral', label: 'Mistral', modell: 'm', aktiv: false }]
const tv = regler.testValg(M, { forfatter: 'Claude Desktop' })
ok('testValg: klare modeller først, en annen familie enn forfatteren er forslaget', tv[0].id === 'ollama' && tv[0].forslag === true && tv[0].navn === 'gemma3:4b' && tv.find((x) => x.id === 'claude').samme === true)
ok('testValg: ChatGPT står med «ikke klar» og hvorfor; en annen mottaker uten nøkkel står ikke', tv.find((x) => x.id === 'openai')?.klar === false && tv.find((x) => x.id === 'openai').navn === 'ChatGPT' && /nøkkel/.test(tv.find((x) => x.id === 'openai').hvorfor) && !tv.some((x) => x.id === 'mistral'))
const tvV = regler.testValg(M, { forfatter: 'Claude', vault: true })
ok('testValg: Vault-merket gir bare lokale modeller, heller ikke «legg til» for skymodeller', tvV.length === 1 && tvV[0].id === 'ollama')
ok('testValg: Ollama som ikke har svart ennå venter; uten mottakere er lista tom', regler.testValg([{ id: 'ollama', label: 'Ollama (lokal)', aktiv: false, usikker: true, local: true }])[0].venter === true && regler.testValg(null).length === 0)
const rd = regler.romDokumenter([{ id: 'a1', name: 'Strategi for leie v1', project: 'P', capturedAt: 1 }, { id: 'a2', name: 'Strategi for leie v2', project: 'P', capturedAt: 2 }, { id: 'a3', name: 'Strategi for leie v2', project: 'P', capturedAt: 2, key: 'fil:/x/s.pdf' }, { id: 'n', name: 'Notat om noe annet', project: 'P', capturedAt: 5, vault: true }])
ok('romDokumenter: versjoner og formater av ett dokument blir én rad, nyeste rad først', rd.length === 2 && rd[0].id === 'n' && rd[0].vault === true && rd[1].id === 'a2' && rd[1].versjoner === 2 && rd[1].formater.includes('PDF'))
ok('romDokumenter: tomt gir tomt', regler.romDokumenter(null).length === 0)

// ── 2) testarkiv ───────────────────────────────────────────────────────────
const T0 = Date.parse('2026-10-20T10:00:00+02:00'), t = (h) => T0 + h * 36e5
const atoms = []
const fyll = 'Lang tekst om saken. '.repeat(400)
const lag = (o) => { const { t: _t, ...felt } = o; const a = upsert(atoms, { by: 'menneske', short: o.short || `Ingress for ${o.name}.`, ...felt }).atom; a.capturedAt = o.t || t(0); return a }
const sam = lag({ key: 'samtale:code-0001-aaaa', kind: 'samtale', content: `# Fristen for anke\n\n_Claude Code · 2 vendinger · 2026-10-20 · Energima_\n\n**Bruker:** Når er fristen?\n\n**Claude:** Fristen er en måned etter forkynnelse, og den løper fra 3. mars.`, name: 'Fristen for anke', project: 'Energima', convo: 'Fristen for anke', source: 'Claude Code', t: t(2) })
const svar = lag({ key: 'svar:code0001:abcd', content: `Svar om fristen. ${fyll}`, name: 'Svar om fristen', project: 'Energima', convo: 'Fristen for anke', source: 'Claude Code', kind: 'svar', t: t(3) })
const samme = lag({ key: 'fil:/x/frist.md', content: `# Notat om fristen\n\n${fyll}`, name: 'Notat om fristen', project: 'Energima', convo: 'Fristen for anke', source: 'Claude Code', t: t(4) })
const viaPeker = lag({ key: 'fil:/x/brev.md', content: '# Brev til motparten\n\nBrevet.', name: 'Brev til motparten', project: 'Energima', source: 'Claude Code', t: t(5) }); viaPeker.derivedFrom = [{ id: svar.id, level: 'L', version: 1 }]
const kilde = lag({ key: 'fil:/x/dom.md', content: '# Dommen\n\nDomsgrunnene.', name: 'Dommen fra tingretten', project: 'Energima', t: t(1) }); svar.derivedFrom = [{ id: kilde.id, level: 'L', version: 1 }]
const annen = lag({ key: 'samtale:code-0002-bbbb', kind: 'samtale', content: '# Noe annet\n\n**Bruker:** Hei\n\n**Claude:** Hei tilbake.', name: 'Noe annet', project: 'Energima', convo: 'Noe annet', source: 'Claude Code', t: t(6) })
const fremmed = lag({ key: 'fil:/x/fremmed.md', content: '# Samme navn, annet prosjekt', name: 'Notat i annet prosjekt', project: 'Skado', convo: 'Fristen for anke', t: t(6) })
const ensom = lag({ key: 'fil:/x/ensom.md', content: '# Ensomt notat\n\nUten samtale.', name: 'Ensomt notat uten samtale', project: 'Energima', t: t(7) })
save(atoms)
const alle = load()
const nav = (l) => l.map((a) => a.name).sort().join(' | ')

// ── 3) koblingene ──────────────────────────────────────────────────────────
const r1 = romKoblinger(alle, sam.id)
ok('samtalen: dokumentene på samme kobling som raden — samme prosjekt og samtalenavn, eller bygget av en del av samtalen', nav(r1.dokumenter) === 'Brev til motparten | Notat om fristen', nav(r1.dokumenter))
ok('samtalen: svaret og den andre samtalen er ikke dokumenter; samme samtalenavn i et annet prosjekt teller ikke', !r1.dokumenter.some((a) => [svar.id, annen.id, fremmed.id].includes(a.id)))
ok('samtalen: kilden er det delene ble bygget av', nav(r1.kilder) === 'Dommen fra tingretten', nav(r1.kilder))
ok('samtalen: slag samtale og sak = samtalen', r1.slag === 'samtale' && r1.sak.id === sam.id && r1.samtale.id === sam.id)
const r2 = romKoblinger(alle, svar.id)
ok('en del av samtalen gir samme rom', r2.slag === 'samtale' && r2.samtale.id === sam.id && nav(r2.dokumenter) === 'Brev til motparten | Notat om fristen')
const r3 = romKoblinger(alle, samme.id)
ok('dokument med samtalenavn: samtalen det kom fra, og de andre dokumentene derfra, ikke seg selv', r3.slag === 'sak' && r3.samtale?.id === sam.id && nav(r3.dokumenter) === 'Brev til motparten', nav(r3.dokumenter))
const r4 = romKoblinger(alle, viaPeker.id)
ok('dokument bygget av en del av samtalen: samtalen via pekeren', r4.slag === 'sak' && r4.samtale?.id === sam.id && r4.kilder.some((a) => a.id === svar.id) === false)
const r5 = romKoblinger(alle, ensom.id)
ok('atom uten samtale: ingen samtale, ingen dokumenter, ingen kilder', r5.slag === 'sak' && r5.samtale === null && r5.fra === null && !r5.dokumenter.length && !r5.kilder.length)
ok('ukjent id: null', romKoblinger(alle, 'finnes-ikke') === null)

// ── 4) broen ───────────────────────────────────────────────────────────────
const PORT = 5395
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'ignore'] })
const B = `http://127.0.0.1:${PORT}`
try {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${B}/api/bro`); if (r.ok) break } catch {} await new Promise((r) => setTimeout(r, 150)) }
  const hent = async (u) => { const r = await fetch(B + u); return { status: r.status, j: await r.json().catch(() => null) } }
  const u1 = await hent(`/api/rom?id=${encodeURIComponent(sam.id)}`)
  ok('GET /api/rom: samtalen med dokumenter, kilder og saken i appens form', u1.status === 200 && u1.j.slag === 'samtale' && u1.j.dokumenter.length === 2 && u1.j.kilder.length === 1 && !!u1.j.sak.ord && u1.j.sak.klasse != null)
  ok('GET /api/rom: radene har det som trengs for å bli kilde, og ikke innholdet', u1.j.dokumenter.every((d) => d.name && d.project && d.ord && d.tegn && d.max === 'L' && d.content === undefined))
  const u2 = await hent(`/api/rom?id=${encodeURIComponent(samme.id)}`)
  ok('GET /api/rom: et dokument gir saken med innhold og samtalen det kom fra', u2.j.slag === 'sak' && u2.j.sak.content.includes('Notat om fristen') && u2.j.samtale?.id === sam.id && u2.j.samtale.antall > 0 && u2.j.atoms.some((a) => a.id === samme.id))
  const u3 = await hent(`/api/rom?id=${encodeURIComponent(ensom.id)}`)
  ok('GET /api/rom: atom uten samtale', u3.j.samtale === null && !u3.j.dokumenter.length)
  ok('GET /api/rom: 400 uten id, 404 på ukjent', (await hent('/api/rom')).status === 400 && (await hent('/api/rom?id=x')).status === 404)
  const lett = (await fetch(`${B}/api/rom?id=${encodeURIComponent(ensom.id)}`).then((r) => r.text())).length, tung = (await fetch(`${B}/api/atoms`).then((r) => r.text())).length
  ok('GET /api/rom er lettere enn /api/atoms', lett * 5 < tung, `${lett} mot ${tung} tegn`)
  ok('/api/atoms har samme form som før (lagAtomUt deler den med /api/rom)', (await hent('/api/atoms')).j.atoms.find((a) => a.id === sam.id)?.ord?.L > 0)
  // å åpne rommet og å forhåndsvise en test sender ingenting og logger ingenting
  const logg = () => { try { return fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').length } catch { return 0 } }
  const før = logg()
  await hent(`/api/samtale?id=${encodeURIComponent(sam.id)}`); await hent(`/api/rom?id=${encodeURIComponent(sam.id)}`); await hent(`/api/utfordringer?sak=${encodeURIComponent(samme.id)}`)
  const fh = await fetch(`${B}/api/utfordre/forhandsvis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sak: samme.id, sjekk: 'svakheter', mottaker: 'test' }) }).then((r) => r.json())
  ok('forhåndsvisningen viser Sendes-linja', !!fh.linje, fh.error || '')
  ok('å åpne rommet og velge modell sender og logger ingenting', logg() === før)
} finally { bro.kill() }

// ── 5) koden: klikket går rett inn i rommet ────────────────────────────────
const kode = (f) => fs.readFileSync(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', f), 'utf8')
const fo = kode('pages/Forside.jsx'), sm = kode('pages/Samtale.jsx'), sk = kode('pages/Sak.jsx'), ab = kode('pages/Arbeid.jsx')
ok('avisen: utfoldingen er borte, klikket åpner rommet', !/setUtfoldet|radKnapper/.test(fo) && /const klikkRad = åpneRad/.test(fo) && /romSlag\(a\)/.test(fo))
ok('avisen: rulleposisjon og tilstand huskes til du er tilbake', fo.includes('husketRull()') && fo.includes('Object.assign(MINNE') && kode('arbeid-start.js').includes('window.scrollY'))
ok('rommet: følger bunnen bare etter sending, ellers åpner det på resultatet', /const følgerBunnen = erNy \|\| sendtHer \|\| !res\.resultat/.test(sm) && /if \(!følgerBunnen\) return/.test(sm) && sm.includes('{samtaleÅpen && rader.map'))
ok('rommet: «Vil du teste dette?» åpner bare panelet; ingen POST /api/utfordre i rommets egen kode', sm.includes('<VilDuTeste') && sk.includes('<VilDuTeste') && !kode('components/VilDuTeste.jsx').includes('/api/') && !sm.includes("'/api/utfordre'"))
ok('rommet: Arbeid henter fra /api/rom, ikke /api/atoms', ab.includes('/api/rom?id=') && !ab.includes("api('/api/atoms')"))
ok('saksdetaljer: S/M/L, Del, Om saken og Rydd bor i menyen på begge romtyper', sk.includes("rom === 'detaljer'") && sk.includes("rom === 'dokument'") && /\{merkeblokk\}\{beskjed\}\{innholdet\}\{løpBlokk\}\{omOgRydd\}/.test(sk) && sk.includes('{delKnapp}{!erTrådVisning && zoomVelger}'))

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
