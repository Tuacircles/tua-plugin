#!/usr/bin/env node
// test-rydding.mjs — rydding på saken, papirkurv, Tua foreslår, klasse-regelen strammet, Ny gjennomgang (runde 3c, 24.10.2026). ALDRI mot ~/Dropbox/Tua, aldri et ekte modellkall.
//
//   TUA_FILES_ROOT=/tmp/tua-test-rydding/arkiv TUA_DATA_DIR=/tmp/tua-test-rydding/data TUA_HOME=/tmp/tua-test-rydding/hjem node server/test-rydding.mjs
//
// Sjekker lageret: flytt (fila flyttes, indeks/written følger) · giNyttNavn (tittel = filnavn; kollisjon → id-suffiks, V9) · kast/angre (papirkurven) · slåSammen (ny versjon av målet
// med kildepeker, kilden i papirkurven) · tømPapirkurv (filene bort, men hver ligger i .tua/versions som «papirkurv») · ryddeforslag (identisk innhold, samme ingress, samme tittel —
// konservativt; «---»-titler; tomme saker; drift utenfor) · klasse-regelen: dok: i Tuas prosjekt = drift, dok: ellers = arbeid, «Økt: …» uten nøkkel = drift i Tua / fangst ellers,
// menneskeskrevet aldri · planFor/gjennomgang med test-skriveren (S/M skrives, M_av + M_dato, versjon beholdt, menneskeskrevet hoppes over, drift og prompter utenfor).
// Broen: /api/rydd/* (flytt, navn, kast, angre, slaa-sammen, forslag), /api/papirkurv/tall + toem, /api/gjennomgang/plan og POST /api/gjennomgang som SSE (dry-run og ekte).
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_SKRIVER = 'regel'
process.env.TUA_OLLAMA_URL = 'http://127.0.0.1:9'   // ingen Ollama i testen — «auto» faller til regler

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
const SCRATCH = path.dirname(ROOT)
const TUA_REPO = path.join(SCRATCH, 'falskt-tua-repo')
for (const d of [ROOT, DATA, HJEM, TUA_REPO]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
fs.mkdirSync(path.join(TUA_REPO, 'tua-plugin', 'server'), { recursive: true }); fs.writeFileSync(path.join(TUA_REPO, 'tua-plugin', 'server', 'store.js'), '// falskt')
fs.mkdirSync(path.join(ROOT, '.tua'), { recursive: true })

const store = await import('./store.js')
const { load, save, upsert, flytt, giNyttNavn, kast, angre, papirkurv, tømPapirkurv, ryddeforslag, slåSammen, fileOf, versions, erDriftEtterRegel, erFangetEtterRegel, driftKandidater, fangetKandidater, driftSlag, slagAvNøkkel, klasseAv, registerProject, erStrekTittel, erTomSak } = store
const { planFor, gjennomgang, sakerFor } = await import('./gjennomgang.js')
let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const les = (a) => fs.readFileSync(fileOf(a), 'utf8')
const lang = (t) => (t + ' ').repeat(400).trim()      // > LONG_L → trenger M
const kort = (t) => (t + ' ').repeat(40).trim()       // > SHORT_L, < LONG_L → bare S
const ix = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'index.json'), 'utf8'))
const wr = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'written.json'), 'utf8'))

// ── 1) grunnlag ─────────────────────────────────────────────────────────────
{
  const atoms = []
  upsert(atoms, { key: 'n:1', name: 'Budsjett 2027', content: lang('Budsjettet for 2027 er på 4,2 millioner.'), project: 'Skigaarden', short: 'Budsjett 2027 for Skigaarden.', by: 'regel' })
  upsert(atoms, { key: 'n:2', name: 'Møtenotat mars', content: kort('Møtet handlet om lagerflytting.'), project: 'Skigaarden', short: 'Møtenotat fra mars om lagerflytting.', by: 'regel' })
  upsert(atoms, { key: 'n:3', name: 'Leiekontrakt utkast', content: lang('Leiekontrakten gjelder Storgata 12.'), project: 'Oppgjør Skado', short: 'Utkast til leiekontrakt for Storgata 12 med alle vilkår samlet i ett dokument.', by: 'regel' })
  upsert(atoms, { key: 'n:4', name: 'Leiekontrakt utkast', content: lang('Leiekontrakten gjelder Storgata 12.'), project: 'Oppgjør Skado', short: 'Utkast til leiekontrakt for Storgata 12 med alle vilkår samlet i ett dokument.', by: 'regel' })   // identisk innhold OG samme tittel
  upsert(atoms, { key: 'n:5', name: 'Leiekontrakt (kopi)', content: lang('Leiekontrakten gjelder Storgata 12, med endringer.'), project: 'Oppgjør Skado', short: 'Utkast til leiekontrakt for Storgata 12 med alle vilkår samlet i ett dokument.', by: 'regel' })   // samme ingress
  upsert(atoms, { key: 'n:6', name: 'Eriks notat', content: kort('Eriks eget notat om oppgjøret.'), project: 'Oppgjør Skado', source: 'Erik', short: 'Eriks ingress.', by: 'menneske' })
  upsert(atoms, { key: 'n:7', name: '---', content: kort('En sak med strek-tittel.'), project: 'Oppgjør Skado', by: 'regel' })
  upsert(atoms, { key: 'n:8', name: 'Tom sak', content: '', project: 'Oppgjør Skado', by: 'regel' })
  upsert(atoms, { key: 'n:9', name: 'vedlegg', content: kort('Vedlegg A.'), project: 'Claude-samtaler', kind: 'samtale', by: 'regel' })
  upsert(atoms, { key: 'n:10', name: 'vedlegg', content: kort('Vedlegg B.'), project: 'Claude-samtaler', kind: 'samtale', by: 'regel' })
  upsert(atoms, { key: 'commit-logg', name: 'Commit-logg', content: kort('Commit-logg.'), project: 'Tua_test', source: 'Claude Code · sync', drift: true, by: 'regel' })
  upsert(atoms, { key: 'commit-logg', name: 'Commit-logg', content: kort('Commit-logg.'), project: 'Tua_test', source: 'Claude Code · sync', drift: true, by: 'regel' })
  save(atoms)
  ok('grunnlag: 11 saker skrevet', load().length === 11)
}
// ── 2) flytt ────────────────────────────────────────────────────────────────
{
  const atoms = load()
  const a = atoms.find((x) => x.key === 'n:1')
  const gammelFil = fileOf(a)
  const r = flytt(atoms, a.id, 'Skigaarden CRM')
  ok('flytt: prosjektet endret i minnet, saken dirty', r.flyttet && r.før === 'Skigaarden' && a.project === 'Skigaarden CRM' && store.erDirty(atoms, a))
  const n = save(atoms)
  ok('save flytter fila (én fil skrevet), indeks og written følger', n === 1 && !fs.existsSync(gammelFil) && fileOf(a).includes('/Skigaarden CRM/') && ix()[a.id].startsWith('Skigaarden CRM/') && wr()[a.id])
  ok('load etterpå: saken ligger i det nye prosjektet', load().find((x) => x.id === a.id).project === 'Skigaarden CRM')
  ok('flytt til samme prosjekt → flyttet: false, ingenting dirty', !flytt(atoms, a.id, 'skigaarden crm').flyttet && store.dirtyIds(atoms).length === 0)
  let e = null; try { flytt(atoms, a.id, '.skjult') } catch (x) { e = x }
  ok('flytt til ugyldig prosjektnavn kaster', !!e)
  let e2 = null; try { flytt(atoms, 'a_x', 'Y') } catch (x) { e2 = x }
  ok('flytt på ukjent id kaster «fant ikke»', /fant ikke/.test(e2?.message))
}
// ── 3) gi nytt navn ─────────────────────────────────────────────────────────
{
  const atoms = load()
  const a = atoms.find((x) => x.key === 'n:2')
  const før = fileOf(a)
  const r = giNyttNavn(atoms, a.id, '  Møtenotat   mars 2026 ')
  ok('giNyttNavn: navnet normalisert, dirty, fila sagt på forhånd', r.endret && a.name === 'Møtenotat mars 2026' && r.fil === 'Møtenotat mars 2026.md' && !r.kollisjon)
  save(atoms)
  ok('save omdøper fila (V9: tittel = filnavn); gammel fil borte; indeks følger', !fs.existsSync(før) && path.basename(fileOf(a)) === 'Møtenotat mars 2026.md' && ix()[a.id].endsWith('Møtenotat mars 2026.md'))
  ok('versjonen er den samme (navnebytte er ikke ny versjon), forrige fil bevart i versions', a.version === 1 && versions(a.id).length === 1)
  // kollisjon: gi n:5 samme navn som n:3 i samme prosjekt
  const b = atoms.find((x) => x.key === 'n:5'), c = atoms.find((x) => x.key === 'n:3')
  const r2 = giNyttNavn(atoms, b.id, c.name)
  save(atoms)
  ok('kollisjon i mappa: fila får id-suffiks, begge filene finnes', r2.kollisjon && fs.existsSync(fileOf(b)) && fs.existsSync(fileOf(c)) && fileOf(b) !== fileOf(c) && /\(\w{6}\)\.md$/.test(fileOf(b)), path.basename(fileOf(b)))
  giNyttNavn(atoms, b.id, 'Leiekontrakt (kopi)'); save(atoms)
  ok('tilbake til et ledig navn: fila heter navnet igjen', path.basename(fileOf(b)) === 'Leiekontrakt (kopi).md')
  let e = null; try { giNyttNavn(atoms, b.id, '   ') } catch (x) { e = x }
  ok('tomt navn kaster', !!e)
}
// ── 4) papirkurv: kast, angre, tøm ──────────────────────────────────────────
{
  const atoms = load()
  const a = atoms.find((x) => x.key === 'n:7')
  const fil = fileOf(a)
  const post = kast(atoms, a.id, { grunn: 'lagt i papirkurven fra saken' })
  ok('kast: fila i .tua/papirkurv/<prosjekt>/, ute av indeksen og lista, posten husker stien', !fs.existsSync(fil) && fs.existsSync(path.join(ROOT, post.kurv)) && post.kurv.startsWith('.tua/papirkurv/Oppgjør Skado/') && !ix()[a.id] && !atoms.some((x) => x.id === a.id) && post.grunn === 'lagt i papirkurven fra saken')
  ok('load ser ikke papirkurven', load().length === 10)
  const an = angre(a.id)
  ok('angre: fila tilbake der den lå, i indeksen igjen, papirkurven tom', fs.existsSync(fil) && ix()[a.id] && papirkurv().length === 0 && an.atom.id === a.id)
  // tøm: to saker i kurven → filene bort, men bevart i versions
  const A = load()
  const x = A.find((s) => s.key === 'n:8'), y = A.find((s) => s.key === 'n:7')
  kast(A, x.id); kast(A, y.id)
  ok('to i papirkurven', papirkurv().length === 2)
  const t = tømPapirkurv()
  ok('tømPapirkurv: begge filene fjernet, begge bevart som «papirkurv»-versjon i .tua/versions', t.antall === 2 && t.fjernet === 2 && t.bevart === 2 && papirkurv().length === 0 && versions(x.id).some((v) => /papirkurv/.test(v.name)) && versions(y.id).some((v) => /papirkurv/.test(v.name)), JSON.stringify(t))
  ok('papirkurv-mappa for prosjektet er ryddet bort', !fs.existsSync(path.join(ROOT, '.tua', 'papirkurv', 'Oppgjør Skado')))
  ok('load: 9 saker igjen', load().length === 9)
}
// ── 5) slå sammen fra saken ────────────────────────────────────────────────
{
  const atoms = load()
  const fra = atoms.find((x) => x.key === 'n:4'), inn = atoms.find((x) => x.key === 'n:3')
  const v = inn.version
  const r = slåSammen(atoms, fra.id, inn.id)
  save(atoms)
  ok('slåSammen: målet ny versjon med kildepeker, kilden i papirkurven, fila skrevet', r.atom.version === v + 1 && r.atom.derivedFrom.some((d) => d.id === fra.id) && papirkurv().some((p) => p.id === fra.id && p.innI === inn.id) && /Slått sammen fra/.test(les(inn)))
  ok('forrige versjon av målet ligger i versions', versions(inn.id).some((x) => x.name === `v${v}`))
  angre(fra.id)
  ok('angre på den sammenslåtte: tilbake (målet beholder den nye versjonen)', load().some((a) => a.id === fra.id) && load().find((a) => a.id === inn.id).version === v + 1)
}
// ── 6) ryddeforslag ─────────────────────────────────────────────────────────
{
  const atoms = load()
  upsert(atoms, { key: 'n:8b', name: 'Tom sak igjen', content: '', project: 'Oppgjør Skado', by: 'regel' })
  upsert(atoms, { key: 'n:7b', name: '--- ', content: kort('Strek.'), project: 'Oppgjør Skado', by: 'regel' })
  upsert(atoms, { key: 'commit-logg-2', name: 'Commit-logg', content: kort('Commit-logg.'), project: 'Tua_test', source: 'Claude Code · sync', drift: true, by: 'regel' })   // identisk med commit-logg — men drift, holdes utenfor
  upsert(atoms, { key: 'n:11a', name: 'Referat styremøte', content: lang('Referat fra styremøtet i juni.'), project: 'Hytta', short: 'Referat juni.', by: 'regel' })
  upsert(atoms, { key: 'n:11b', name: 'Referat styremøte (kopi 2)', content: lang('Referat fra styremøtet i juni.'), project: 'Hytta', short: 'Referatet fra juni, kopi.', by: 'regel' })   // identisk innhold, ulik tittel og ingress
  save(atoms)
  const r = ryddeforslag(load())
  const dup = r.forslag.filter((f) => f.slag === 'duplikat')
  ok('ryddeforslag: identisk innhold (n:11a/n:11b) er ETT forslag med grunn «identisk innhold»', dup.filter((f) => f.saker.some((s) => s.name === 'Referat styremøte')).length === 1 && dup.find((f) => f.saker.some((s) => s.name === 'Referat styremøte')).grunn === 'identisk innhold' && dup.find((f) => f.saker.some((s) => s.name === 'Referat styremøte')).saker.length === 2, JSON.stringify(dup.map((f) => [f.grunn, f.saker.map((s) => s.name)])))
  ok('samme ingress: n:3 (slått sammen, ny tekst), n:4 og n:5 har samme S → ÉN gruppe på tre, ikke også som samme tittel', dup.filter((f) => f.saker.some((s) => /^Leiekontrakt/.test(s.name))).length === 1 && dup.find((f) => f.saker.some((s) => /^Leiekontrakt/.test(s.name))).grunn === 'samme ingress' && dup.find((f) => f.saker.some((s) => /^Leiekontrakt/.test(s.name))).saker.length === 3)
  ok('«vedlegg» × 2 (samtaler, generisk tittel) er IKKE et forslag', !dup.some((f) => f.saker.some((s) => s.name === 'vedlegg')))
  ok('drift (commit-logg × 2, identisk) holdes utenfor', !dup.some((f) => f.saker.some((s) => s.name === 'Commit-logg')))
  ok('«---»-titler: n:7b (n:7 ble tømt fra papirkurven i 4); regelen tar «---», «--- hei», ikke «Budsjett» eller «- punkt»', r.forslag.filter((f) => f.slag === 'tittel').length === 1 && erStrekTittel({ name: '---' }) && erStrekTittel({ name: '--- hei' }) && !erStrekTittel({ name: 'Budsjett' }) && !erStrekTittel({ name: '- punkt' }))
  ok('tomme saker: én (n:8b), med kast = id', r.forslag.filter((f) => f.slag === 'tom').length === 1 && r.forslag.find((f) => f.slag === 'tom').kast.length === 1 && erTomSak({ content: ' ', levels: {} }))
  ok('behold = nyeste/største, kast = resten; perSlag/perProsjekt/tekst', dup.every((f) => f.behold && f.kast.length === f.saker.length - 1 && !f.kast.includes(f.behold)) && r.perProsjekt['Oppgjør Skado'] >= 3 && /duplikat/.test(r.tekst) && /strek/.test(r.tekst) && /tom/.test(r.tekst), r.tekst)
  ok('radene er lette: id, name, project, klasse, S (kort), tegn — ikke content', r.forslag.every((f) => f.saker.every((s) => s.id && s.name && s.klasse && s.S !== undefined && s.content === undefined)))
}
// ── 7) klasse-regelen strammet: dok: og «Økt: …» uten nøkkel ────────────────
{
  registerProject('Tua_test', { repo: TUA_REPO })
  const atoms = load()
  upsert(atoms, { key: 'dok:concepts/31/samlet.html', name: 'Tua 2.0 ende til ende', content: lang('Overleveringsnotat for byggeøkta.'), project: 'Tua_test', source: 'Claude Code · sync', by: 'regel' })
  upsert(atoms, { key: 'dok:docs/plan.html', name: 'Plan for lokal LLM', content: lang('Et dokument speilet fra et annet repo.'), project: 'Skigaarden', source: 'Claude Code · sync', by: 'regel' })
  upsert(atoms, { key: 'dok:concepts/99/menneske.html', name: 'Eriks dokument om Tua', content: lang('Eriks eget.'), project: 'Tua_test', source: 'Claude Code · sync', short: 'Eriks ingress.', by: 'menneske' })
  upsert(atoms, { key: 'kopi:1', name: 'Økt: bygg skive 9', content: lang('En økt-rapport som kom inn uten hook-nøkkel.'), project: 'Tua_test', source: 'Claude', by: 'regel' })
  upsert(atoms, { key: 'kopi:2', name: 'Økt: Opptre som advokat', content: lang('En økt-rapport i et vanlig prosjekt.'), project: 'Skado', source: 'Claude', by: 'regel' })
  upsert(atoms, { key: 'kopi:3', name: 'Økt: notat Erik skrev', content: lang('Erik skrev dette selv.'), project: 'Tua_test', source: 'Erik', by: 'regel' })
  save(atoms)
  const A = load()
  const f = (k) => A.find((a) => a.key === k)
  ok('dok: i Tuas eget prosjekt er drift etter regelen (slag «dokument»)', erDriftEtterRegel(f('dok:concepts/31/samlet.html')) && driftSlag(f('dok:concepts/31/samlet.html')) === 'dokument')
  ok('dok: i et annet prosjekt er arbeid (ikke drift, ikke fangst)', !erDriftEtterRegel(f('dok:docs/plan.html')) && !erFangetEtterRegel(f('dok:docs/plan.html')))
  ok('dok: menneskeskrevet (S av menneske) merkes aldri', !erDriftEtterRegel(f('dok:concepts/99/menneske.html')))
  ok('«Økt: …» uten okt:-nøkkel i Tuas prosjekt er drift (slag «økt-tittel»)', erDriftEtterRegel(f('kopi:1')) && driftSlag(f('kopi:1')) === 'økt-tittel')
  ok('«Økt: …» uten nøkkel i et vanlig prosjekt er fangst (slag «økt»), ikke drift', !erDriftEtterRegel(f('kopi:2')) && erFangetEtterRegel(f('kopi:2')) && slagAvNøkkel(f('kopi:2')) === 'økt')
  ok('«Økt: …» med menneskelig kilde røres ikke', !erDriftEtterRegel(f('kopi:3')) && !erFangetEtterRegel(f('kopi:3')))
  const dk = driftKandidater(A)
  ok('driftKandidater: de to nye (dokument + økt-tittel) er med; menneske holdt utenfor', dk.nye.some((a) => a.key === 'dok:concepts/31/samlet.html') && dk.nye.some((a) => a.key === 'kopi:1') && !dk.nye.some((a) => a.key === 'kopi:3') && dk.perSlag.dokument === 1 && dk.perSlag['økt-tittel'] === 1, JSON.stringify(dk.perSlag))
  const fk = fangetKandidater(A)
  ok('fangetKandidater: «Økt: …» i Skado er med, dok: er ikke', fk.nye.some((a) => a.key === 'kopi:2') && !fk.nye.some((a) => String(a.key).startsWith('dok:')))
  // review --drift --dry-run viser dem og skriver ingenting
  const { spawnSync } = await import('node:child_process')
  const r1 = spawnSync(process.execPath, [path.join(HERE, 'review.js'), '--drift', '--dry-run'], { env: process.env, encoding: 'utf8' })
  ok('review --drift --dry-run: viser dokument og økt-tittel i «Per slag», skriver ingenting', r1.status === 0 && /dokument \(1\)/.test(r1.stdout) && /økt-tittel \(1\)/.test(r1.stdout) && /DRY-RUN/.test(r1.stdout) && load().find((a) => a.key === 'kopi:1').drift === undefined, (r1.stdout.split('\n').find((l) => /Per slag/.test(l)) || r1.stderr).slice(0, 160))
  const r2 = spawnSync(process.execPath, [path.join(HERE, 'review.js'), '--drift'], { env: process.env, encoding: 'utf8' })
  ok('review --drift: setter drift på dem (gjennom saveAll), menneske urørt', r2.status === 0 && load().find((a) => a.key === 'kopi:1').drift === true && load().find((a) => a.key === 'dok:concepts/31/samlet.html').drift === true && load().find((a) => a.key === 'kopi:3').drift === undefined && load().find((a) => a.key === 'dok:docs/plan.html').drift === undefined, r2.stderr.slice(0, 200))
  const r3 = spawnSync(process.execPath, [path.join(HERE, 'review.js'), '--rydd'], { env: process.env, encoding: 'utf8' })
  ok('review --rydd: lister forslagene, skriver ingenting', r3.status === 0 && /ryddeforslag/.test(r3.stdout) && /Ingenting skrevet/.test(r3.stdout))
}
// ── 8) Ny gjennomgang (lageret) ─────────────────────────────────────────────
{
  const atoms = load()
  const pl = planFor(atoms, { prosjekt: 'Oppgjør Skado', nivå: 'begge' })
  const navn = (id) => atoms.find((a) => a.id === id)?.name
  ok('planFor(prosjekt, begge): lange saker får S+M, korte bare S, menneskeskrevet S hoppes over, tomme/strek-saker uten tekst hoppes', pl.tall.saker >= 5 && pl.plan.find((p) => p.name === 'Leiekontrakt utkast')?.nivåer.join('') === 'SM' && pl.plan.find((p) => p.name === 'Eriks notat')?.hoppet.some((h) => /menneskeskrevet/.test(h)) && pl.plan.find((p) => p.name === 'Tom sak igjen')?.nivåer.length === 0, JSON.stringify(pl.tall))
  const dr = sakerFor(atoms, { prosjekt: 'Tua_test' })
  ok('sakerFor(prosjekt): drift og prompter holdes utenfor', !dr.some((a) => a.drift === true))
  const sak = atoms.find((a) => a.key === 'n:3')
  const hendelser = []
  const r = await gjennomgang({ atoms, id: sak.id, nivå: 'M', skriver: 'test', på: (ev, d) => hendelser.push([ev, d]) })
  ok('gjennomgang(id, M, test): én skrevet, M_av «test», M_dato satt, versjon beholdt, fila skrevet', r.skrevet === 1 && r.filer === 1 && sak.levels.M.by === 'test' && /^\d{4}-\d{2}-\d{2}T/.test(sak.levels.M.at) && sak.version === 2 && /\nM_av: "test"\n/.test(les(sak)) && /\nM_dato: "/.test(les(sak)) && /Test-sammendrag/.test(sak.levels.M.text), JSON.stringify(r.saker))
  ok('hendelser: start → sak → skrevet → slutt', hendelser.map((h) => h[0]).join(' ') === 'start sak skrevet slutt' && hendelser[0][1].modell === 'ekko' && hendelser[0][1].lokalt === true)
  ok('S ble ikke rørt (bare M bedt om)', sak.levels.S.by === 'regel')
  const B = load()
  const m = B.find((a) => a.id === sak.id)
  ok('load etterpå: M står med av og dato; forrige versjon av fila bevart', m.levels.M.by === 'test' && m.levels.M.at && versions(sak.id).length >= 2)
  const r2 = await gjennomgang({ atoms: B, id: B.find((a) => a.key === 'n:6').id, nivå: 'begge', skriver: 'test', på: () => {} })
  ok('menneskeskrevet S hoppes over; saken er kort → M trengs ikke → ingenting skrevet', r2.skrevet === 0 && r2.hoppet === 1 && B.find((a) => a.key === 'n:6').levels.S.by === 'menneske')
  const r3 = await gjennomgang({ atoms: B, prosjekt: 'Oppgjør Skado', nivå: 'S', skriver: 'test', dryRun: true, på: () => {} })
  ok('dryRun: plan tilbake, ingenting skrevet', r3.dryRun && r3.plan.length >= 5 && r3.skrevet === 0 && r3.filer === 0)
  const r4 = await gjennomgang({ atoms: B, prosjekt: 'Oppgjør Skado', nivå: 'S', skriver: 'regel', på: () => {} })
  ok('skriver «regel»: S skrevet etter regler på de som ikke er menneskeskrevet', r4.skrevet >= 2 && r4.av === 'regel' && B.find((a) => a.key === 'n:3').levels.S.by === 'regel' && B.find((a) => a.key === 'n:6').levels.S.by === 'menneske')
  let e = null; try { await gjennomgang({ atoms: B, prosjekt: 'Oppgjør Skado', nivå: 'S', skriver: 'claude', på: () => {} }) } catch (x) { e = x }
  ok('skriver «claude» uten nøkkel: kaster før noe skrives (aldri Claude i det stille)', /Claude er ikke klar/.test(e?.message))
}
// ── 9) broen ────────────────────────────────────────────────────────────────
const PORT = 5304
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST, TUA_OPEN_DRYRUN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, init); return { status: r.status, json: await r.json().catch(() => null) } }
const post = (p, body) => hent(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const sseAv = (rå) => rå.split('\n\n').filter(Boolean).map((b) => [b.match(/^event: (.+)$/m)?.[1], JSON.parse(b.match(/^data: (.+)$/m)?.[1] || '{}')])
const sse = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, h: sseAv(await r.text()) } }
try {
  const at = (await hent('/api/atoms')).json.atoms
  const sak = at.find((a) => a.name === 'Budsjett 2027')
  const fl = await post('/api/rydd/flytt', { id: sak.id, prosjekt: 'Hytta' })
  ok('POST /api/rydd/flytt: 200, atom med klasse, før, flyttet; mappe laget', fl.status === 200 && fl.json.atom.project === 'Hytta' && fl.json.før === 'Skigaarden CRM' && fl.json.flyttet && fl.json.atom.klasse === 'arbeid' && fs.existsSync(path.join(ROOT, 'Hytta', 'Budsjett 2027.md')))
  ok('flytt: 400 uten prosjekt, 404 ukjent id, 400 ugyldig navn', (await post('/api/rydd/flytt', { id: sak.id })).status === 400 && (await post('/api/rydd/flytt', { id: 'a_x', prosjekt: 'Y' })).status === 404 && (await post('/api/rydd/flytt', { id: sak.id, prosjekt: '.x' })).status === 400)
  const nv = await post('/api/rydd/navn', { id: sak.id, navn: 'Budsjett 2027 — vedtatt' })
  ok('POST /api/rydd/navn: 200, fil = nytt navn, før', nv.status === 200 && nv.json.atom.name === 'Budsjett 2027 — vedtatt' && nv.json.fil === 'Budsjett 2027 — vedtatt.md' && nv.json.før === 'Budsjett 2027' && fs.existsSync(path.join(ROOT, 'Hytta', 'Budsjett 2027 — vedtatt.md')))
  ok('navn: 400 uten navn, 404 ukjent', (await post('/api/rydd/navn', { id: sak.id, navn: ' ' })).status === 400 && (await post('/api/rydd/navn', { id: 'a_x', navn: 'X' })).status === 404)
  const k = await post('/api/rydd/kast', { id: sak.id })
  ok('POST /api/rydd/kast: 200, posten uten sti inne i .tua, grunn «fra saken»; ute av /api/atoms; /api/papirkurv/tall = 1', k.status === 200 && k.json.kastet.id === sak.id && k.json.kastet.kurv === undefined && /fra saken/.test(k.json.kastet.grunn) && !(await hent('/api/atoms')).json.atoms.some((a) => a.id === sak.id) && (await hent('/api/papirkurv/tall')).json.antall === 1)
  const an = await post('/api/rydd/angre', { id: sak.id })
  ok('POST /api/rydd/angre: 200, tilbake i Hytta', an.status === 200 && an.json.atom.project === 'Hytta' && (await hent('/api/atoms')).json.atoms.some((a) => a.id === sak.id))
  ok('kast/angre: 404 på ukjent', (await post('/api/rydd/kast', { id: 'a_x' })).status === 404 && (await post('/api/rydd/angre', { id: sak.id })).status === 404)
  const fo = (await hent('/api/rydd/forslag')).json
  ok('GET /api/rydd/forslag: forslag med slag/grunn/saker/behold/kast, tall og tekst', fo.antall >= 3 && fo.forslag.every((f) => f.slag && f.grunn && f.saker.length && Array.isArray(f.kast)) && fo.tekst, fo.tekst)
  const d = fo.forslag.find((f) => f.slag === 'duplikat' && f.kast.length)
  const sm = await post('/api/rydd/slaa-sammen', { id: d.kast[0], inn_i: d.behold })
  ok('POST /api/rydd/slaa-sammen fra et forslag: 200, målet ny versjon med kildepeker, kilden kastet', sm.status === 200 && sm.json.atom.id === d.behold && sm.json.atom.derivedFrom.some((x) => x.id === d.kast[0]) && sm.json.kastet.id === d.kast[0] && sm.json.kastet.kurv === undefined)
  ok('forslaget er borte etterpå', !(await hent('/api/rydd/forslag')).json.forslag.some((f) => f.saker.some((s) => s.id === d.kast[0])))
  ok('slå sammen: 400/404', (await post('/api/rydd/slaa-sammen', { id: sak.id })).status === 400 && (await post('/api/rydd/slaa-sammen', { id: sak.id, inn_i: 'a_x' })).status === 404 && (await post('/api/rydd/sl%C3%A5-sammen', {})).status === 400)
  const tom = fo.forslag.find((f) => f.slag === 'tom')
  await post('/api/rydd/kast', { id: tom.kast[0] })
  const før = (await hent('/api/papirkurv/tall')).json.antall
  const tø = await post('/api/papirkurv/toem', {})
  ok('POST /api/papirkurv/toem: 200, antall/fjernet/bevart, tallet 0 etterpå', tø.status === 200 && tø.json.antall === før && tø.json.fjernet === før && tø.json.bevart === før && (await hent('/api/papirkurv/tall')).json.antall === 0, JSON.stringify(tø.json))
  // Ny gjennomgang via broen
  const pl = (await hent(`/api/gjennomgang/plan?prosjekt=${encodeURIComponent('Oppgjør Skado')}&niva=begge`)).json
  ok('GET /api/gjennomgang/plan: plan, tall, modell/av/lokalt (ingen Ollama her → regel), mottakere', pl.plan.length >= 3 && pl.tall.saker >= 3 && pl.av === 'regel' && pl.lokalt === false && Array.isArray(pl.mottakere), JSON.stringify(pl.tall))
  ok('plan: 400 uten id/prosjekt, 400 ugyldig nivå', (await hent('/api/gjennomgang/plan')).status === 400 && (await hent('/api/gjennomgang/plan?prosjekt=X&niva=Q')).status === 400)
  const leie = (await hent('/api/atoms')).json.atoms.find((a) => a.name === 'Leiekontrakt utkast')
  const g1 = await sse('/api/gjennomgang', { id: leie.id, niva: 'M', skriver: 'test', dryRun: true })
  ok('POST /api/gjennomgang {dryRun}: SSE start → slutt, ingenting skrevet', g1.status === 200 && g1.h[0][0] === 'start' && g1.h.at(-1)[0] === 'slutt' && g1.h.at(-1)[1].skrevet === 0 && g1.h.at(-1)[1].dryRun === true, g1.h.map((h) => h[0]).join(' '))
  const vFør = leie.version
  const g2 = await sse('/api/gjennomgang', { id: leie.id, niva: 'M', skriver: 'test' })
  const slutt = g2.h.at(-1)[1]
  ok('POST /api/gjennomgang (ekte, test-skriver): start · sak · skrevet · slutt {skrevet: 1, filer: 1, av: test}', g2.h.map((h) => h[0]).join(' ') === 'start sak skrevet slutt' && slutt.skrevet === 1 && slutt.filer === 1 && slutt.av === 'test', g2.h.map((h) => h[0]).join(' '))
  const etter = (await hent('/api/atoms')).json.atoms.find((a) => a.id === leie.id)
  ok('saken har M av «test» med dato, samme versjon', etter.levels.M.by === 'test' && etter.levels.M.at && etter.version === vFør)
  const g3 = await sse('/api/gjennomgang', { prosjekt: 'Oppgjør Skado', niva: 'S', skriver: 'claude' })
  ok('skriver «claude» uten nøkkel via broen: event feil, ingenting skrevet', g3.h.some((h) => h[0] === 'feil' && /Claude er ikke klar/.test(h[1].feil)) && !g3.h.some((h) => h[0] === 'skrevet'))
  ok('gjennomgang: 400 uten utvalg, 400 ugyldig nivå', (await post('/api/gjennomgang', {})).status === 400 && (await post('/api/gjennomgang', { id: leie.id, niva: 'X' })).status === 400)
  // én skriver gjennom broen: en terminal-prosess merker én sak mens broen lever — broen skriver den ikke tilbake uten flagget
  const term = load(); const t = term.find((a) => a.name === 'Leiekontrakt (kopi)'); t.drift = false; t.beholdt = true; save(term)
  await post('/api/rydd/navn', { id: leie.id, navn: 'Leiekontrakt utkast v2' })
  const igjen = load().find((a) => a.id === t.id)
  ok('én skriver: det terminalen skrev på én sak, står etter at broen skrev en annen', igjen.beholdt === true && igjen.drift === false)
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'alt grønt'}`)
process.exit(feil ? 1 : 0)
