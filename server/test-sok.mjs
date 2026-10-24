#!/usr/bin/env node
// test-sok.mjs — runde 2d (app): avisen med riktig utvalg, søk på prosjekt, dato sist først (03-avisen §2–§6, friksjon 14, 24.10.2026).
// Mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall.
//
//   TUA_FILES_ROOT=/tmp/tua-test-sok/arkiv TUA_DATA_DIR=/tmp/tua-test-sok/data TUA_HOME=/tmp/tua-test-sok/hjem node server/test-sok.mjs
//
// Sjekker: reglene i tua2-sandbox/src/regler.js — klasseAv (samme svar som broen), utvalg (avisen viser bare arbeid; fangede og drift bare med «ta med»;
// tråder aldri som rad, i treff slått sammen), sorterDato (siste først, alltid), hovedsakVekt (vekten velger, ikke datoen), typeOrd (vanlige ord),
// utenfor/utenforTekst («N fangede · N drift holdt utenfor»), prosjektTreff (navn, alias, samtale; rekkefølge; inntil 3), spørsmålTekst, øktTekst, størrelse,
// sakFiler (gjengivelser relativt til prosjektmappa). Broen: GET /api/mappe (prosjektene med alias og antall filer), GET /api/mappe?prosjekt (filene som ikke er saker —
// nyeste først, aldri .md, aldri skjulte, aldri utenfor arkivroten, gjengivelse → sak), POST /api/mappe/aapne (bare filer i mappa; dryrun), /api/search med drift=,
// /api/siden-sist med et åpent spørsmål. Testarkivet: saker i tre prosjekter, en åpen Spør-tråd, en låst konklusjon, et beholdt svar, fangede, drift, filer i mappa, alias.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM, path.join(ROOT, 'Innboks')]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const { load, save, upsert, setStatus, FILES_ROOT, projectAliases, klasseAv: klasseStore } = await import('./store.js')
const regler = await import(pathToFileURL(path.join(HERE, '..', '..', 'tua2-sandbox', 'src', 'regler.js')).href)

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const NÅ = Date.now(), DAG = 86400e3, T = (h) => NÅ - h * 36e5
const lang = (s) => `${s}\n\n` + 'Tekst som gjør saken lang nok til at den har sammendrag og vekt. '.repeat(30)

// ── 1) testarkivet ──────────────────────────────────────────────────────────
const atoms = load()
const put = (spec, at) => { const { atom } = upsert(atoms, spec); if (at) { atom.createdAt = at; atom.capturedAt = at } return atom }
const notat = put({ key: 'notat:styre', name: 'Notat fra styremøtet', project: 'Fjellstua Eiendom', convo: 'Styremøte oktober', source: 'Erik', by: 'menneske', short: 'Styret godkjente budsjettprosessen og ba om tre alternativer for Storgata 12.', content: lang('# Notat fra styremøtet') }, T(30))
const dok = put({ key: 'dok:strategi', name: 'Forhandlingsstrategi leieavtale Storgata 12', project: 'Fjellstua Eiendom', convo: 'Leieforhandling Storgata 12', source: 'Claude Desktop', tags: ['dokument'], short: 'Strategi for fornyelse av leieavtalen: motbud 1 480 000 kr.', medium: 'Sammendraget.', content: lang('# Forhandlingsstrategi') }, T(5))
put({ key: 'dok:strategi', name: 'Forhandlingsstrategi leieavtale Storgata 12', project: 'Fjellstua Eiendom', convo: 'Leieforhandling Storgata 12', source: 'Claude Desktop', tags: ['dokument'], content: lang('# Forhandlingsstrategi') + ' v2' }, T(4))
const nyest = put({ key: 'notat:kort', name: 'Kort huskelapp', project: 'Fjellstua Eiendom', source: 'Erik', by: 'menneske', content: 'Ring takstmannen.' }, T(1))
const gammel = put({ key: 'notat:gammel', name: 'Gammelt notat om taket', project: 'Fjellstua Eiendom', source: 'Erik', by: 'menneske', short: 'Taket må utbedres innen to år.', content: lang('# Taket') }, NÅ - 40 * DAG)
put({ key: 'dok:portefolje', name: 'Porteføljegjennomgang Q3', project: 'Aas Kapital', convo: 'Porteføljegjennomgang Q3', source: 'Claude Desktop', tags: ['dokument'], short: 'Porteføljen steg 4,1 % i Q3.', content: lang('# Portefølje') }, T(50))
put({ key: 'notat:energima', name: 'Møte om anken', project: 'Aas Kapital', convo: 'Energima anke — neste steg', source: 'Erik', by: 'menneske', short: 'Anken sendes innen fristen.', content: lang('# Anken') }, T(10))
put({ key: 'notat:tinden', name: 'Reiseregningsrutine', project: 'Tinden Regnskap', source: 'Claude Desktop', short: 'Ny rutine for reiseregninger.', content: lang('# Reiseregninger') }, T(80))
// fanget (spor) og en samtale
put({ key: 'okt:aaaa1111', kind: 'samtale', name: 'Økt: leieavtalen', project: 'Fjellstua Eiendom', convo: 'Økt: leieavtalen', source: 'Claude Code', fanget: true, tags: ['samtale', 'økt'], by: 'regel', short: 'Sist: x → y · 3 vendinger', content: lang('# Økt') }, T(2))
put({ key: 'svar:aaaa1111:deadbeef', kind: 'svar', name: 'Svar: tre alternativer', project: 'Fjellstua Eiendom', convo: 'Økt: leieavtalen', source: 'Claude Code', fanget: true, tags: ['svar'], by: 'regel', short: 'Tre alternativer for Storgata 12.', content: lang('# Tre alternativer') }, T(2))
put({ key: 'samtale:desk-1', kind: 'samtale', name: 'Hva skjer med renta?', project: 'Aas Kapital', convo: 'Hva skjer med renta?', source: 'Claude Desktop', fanget: true, tags: ['samtale'], by: 'regel', short: 'Sist: … · 2 vendinger', content: lang('# Renta') }, T(3))
// drift
put({ key: 'commit-logg', name: 'Commit-logg — tua', project: 'Tua_tua', source: 'Claude Code · sync', drift: true, short: 'a9662f3 Bygg pluginen.', content: lang('# Commit-logg') }, T(0.5))
put({ key: 'import:desktop', name: 'Import: Claude Desktop (cache)', project: 'Tua', source: 'Tua', drift: true, short: '14 samtaler lest.', content: lang('# Import') }, T(0.2))
put({ key: 'okt:bbbb2222', kind: 'samtale', name: 'Økt: tua — runde 2d', project: 'Tua_tua', convo: 'Økt: tua — runde 2d', source: 'Claude Code', drift: true, tags: ['samtale', 'økt'], by: 'regel', short: 'Sist: bygg → bygget', content: lang('# Byggeøkt') }, T(0.3))
// en åpen Spør-tråd (prompt + svar + konklusjon i utkast), en låst konklusjon, et beholdt svar
const pr = put({ key: 'prompt:spor:1', kind: 'prompt', name: 'Sammenlign porteføljen med budsjettet', project: 'Aas Kapital', convo: 'Sammenlign porteføljen med budsjettet', by: 'regel', short: 'Sammenlign …', content: 'Sammenlign porteføljen med budsjettet og si hva som bør prioriteres.' }, T(4))
const s1 = put({ key: 'svar:spor:1', kind: 'svar', name: 'Svar fra Ollama', project: 'Aas Kapital', convo: 'Sammenlign porteføljen med budsjettet', source: 'Ollama (lokal)', by: 'regel', tags: ['svar'], derivedFrom: [{ id: pr.id, version: 1, level: 'L' }], short: 'Teknologi ned til 18 prosent.', content: lang('# Svar') }, T(3.9))
const s2 = put({ key: 'svar:spor:2', kind: 'svar', name: 'Svar fra Test', project: 'Aas Kapital', convo: 'Sammenlign porteføljen med budsjettet', source: 'Test', by: 'regel', tags: ['svar'], derivedFrom: [{ id: pr.id, version: 1, level: 'L' }], short: 'Renter opp til 15 prosent.', content: lang('# Svar 2') }, T(3.8))
const ku = put({ key: 'konklusjon:spor:1', kind: 'konklusjon', name: 'Konklusjon: Sammenlign porteføljen', project: 'Aas Kapital', convo: 'Sammenlign porteføljen med budsjettet', by: 'regel', derivedFrom: [{ id: pr.id, version: 1, level: 'L' }, { id: s1.id, version: 1, level: 'L' }], short: 'Reduser teknologi, øk renter.', content: lang('# Konklusjon') }, T(3.7))
pr.ga = [{ id: s1.id, version: 1 }, { id: s2.id, version: 1 }]
const pr2 = put({ key: 'prompt:spor:2', kind: 'prompt', name: 'Hva er fristen for å si opp leieavtalen?', project: 'Fjellstua Eiendom', convo: 'Hva er fristen for å si opp leieavtalen?', by: 'regel', short: 'Hva er fristen?', content: 'Hva er fristen for å si opp leieavtalen?' }, T(26))
const s3 = put({ key: 'svar:spor:3', kind: 'svar', name: 'Svar fra Ollama', project: 'Fjellstua Eiendom', convo: 'Hva er fristen for å si opp leieavtalen?', source: 'Ollama (lokal)', by: 'regel', tags: ['svar'], derivedFrom: [{ id: pr2.id, version: 1, level: 'L' }], short: 'Seks måneder.', content: lang('# Svar') }, T(25.9))
const kl = put({ key: 'konklusjon:spor:2', kind: 'konklusjon', name: 'Konklusjon: fristen er seks måneder', project: 'Fjellstua Eiendom', convo: 'Hva er fristen for å si opp leieavtalen?', by: 'menneske', derivedFrom: [{ id: pr2.id, version: 1, level: 'L' }, { id: s3.id, version: 1, level: 'L' }], short: 'Oppsigelsesfristen er seks måneder før utløp.', content: lang('# Konklusjon: fristen') }, T(25.8))
pr2.ga = [{ id: s3.id, version: 1 }]
setStatus(kl, 'endelig')
const pr3 = put({ key: 'prompt:spor:3', kind: 'prompt', name: 'Rentekutt?', project: 'Aas Kapital', convo: 'Rentekutt?', by: 'regel', short: 'Rentekutt?', content: 'Hva skjer med finanskostnaden ved rentekutt?' }, T(48))
const beholdt = put({ key: 'svar:spor:4', kind: 'svar', name: 'Svar fra Ollama', project: 'Aas Kapital', convo: 'Rentekutt?', source: 'Ollama (lokal)', by: 'regel', tags: ['svar'], beholdt: true, derivedFrom: [{ id: pr3.id, version: 1, level: 'L' }], short: 'Et kutt gir 0,2 MNOK lavere kostnad.', content: lang('# Svar om rentekutt') }, T(47.9))
pr3.ga = [{ id: beholdt.id, version: 1 }]
save(atoms)
// filer i prosjektmappa, en gjengivelse på en sak, alias
const FE = path.join(FILES_ROOT, 'Fjellstua Eiendom')
fs.mkdirSync(path.join(FE, 'Vedlegg'), { recursive: true })
fs.writeFileSync(path.join(FE, 'Forhandlingsstrategi leieavtale Storgata 12.pdf'), '%PDF-1.4 ' + 'x'.repeat(40000))
fs.writeFileSync(path.join(FE, 'Forhandlingsstrategi leieavtale Storgata 12.html'), '<html><body>Strategi</body></html>')
fs.writeFileSync(path.join(FE, 'Vedlegg', 'Takst Fjellveien 3.pdf'), '%PDF-1.4 ' + 'y'.repeat(120000))
fs.writeFileSync(path.join(FE, 'Plantegning.png'), Buffer.alloc(3000))
fs.writeFileSync(path.join(FE, 'Leieavtale-signert.docx'), Buffer.alloc(22000))
fs.writeFileSync(path.join(FE, '.DS_Store'), 'x')
fs.writeFileSync(path.join(FE, 'løst-notat.md'), '# Et løst notat\n\nUten frontmatter.'); fs.utimesSync(path.join(FE, 'løst-notat.md'), new Date(NÅ - 20 * DAG), new Date(NÅ - 20 * DAG))   // et løst .md i mappa er en sak for lageret (dato = fila)
fs.utimesSync(path.join(FE, 'Leieavtale-signert.docx'), new Date(NÅ - 10 * DAG), new Date(NÅ - 10 * DAG))
fs.utimesSync(path.join(FE, 'Plantegning.png'), new Date(NÅ + 60000), new Date(NÅ + 60000))
const utenforRot = path.join(path.dirname(ROOT), 'utenfor.pdf'); fs.writeFileSync(utenforRot, '%PDF')
try { fs.symlinkSync(utenforRot, path.join(FE, 'lenke-ut.pdf')) } catch {}
fs.writeFileSync(path.join(FILES_ROOT, '.tua', 'project-aliases.json'), JSON.stringify({ Fjellstua: 'Fjellstua Eiendom', Energima: 'Aas Kapital', _: 'kommentar' }))
{
  const at = load(); const d = at.find((a) => a.key === 'dok:strategi')
  d.renders = [{ format: 'pdf', path: path.join(FE, 'Forhandlingsstrategi leieavtale Storgata 12.pdf'), at: NÅ }, { format: 'html', path: path.join(FE, 'Forhandlingsstrategi leieavtale Storgata 12.html'), at: NÅ }]
  save(at)
}
ok('projectAliases: aliasene uten «_»', JSON.stringify(projectAliases()) === JSON.stringify({ Fjellstua: 'Fjellstua Eiendom', Energima: 'Aas Kapital' }))

// ── 2) reglene (regler.js) ──────────────────────────────────────────────────
{
  const alle = load().filter((a) => a.key)   // det løse .md-notatet uten frontmatter er en sak for lageret (dato = nå), men holdes utenfor reglenes prøve
  const byKey = (k) => alle.find((a) => a.key === k)
  ok('regler.klasseAv: samme svar som lageret for alle sakene (uten klasse-feltet)', alle.every((a) => regler.klasseAv(a) === klasseStore(a)) && regler.klasseAv({ klasse: 'drift' }) === 'drift' && regler.klasseAv(byKey('svar:spor:4')) === 'arbeid' && regler.klasseAv(kl) === 'arbeid' && regler.klasseAv(ku) === 'tråd' && regler.klasseAv(byKey('okt:aaaa1111')) === 'spor')
  const avis = regler.utvalg(alle)
  ok('regler.utvalg: avisen viser bare arbeid — ingen fangede, ingen drift, ingen prompter, ingen ubeholdte svar, ingen konklusjon i utkast, ingen samtaler', avis.every((a) => regler.klasseAv(a) === 'arbeid') && avis.some((a) => a.id === kl.id) && avis.some((a) => a.id === beholdt.id) && !avis.some((a) => a.id === ku.id || a.id === pr.id || a.id === s1.id || a.kind === 'samtale' || a.drift || a.fanget), `${avis.length} av ${alle.length}`)
  const med = regler.utvalg(alle, { med: true })
  ok('regler.utvalg med «ta med»: fangede og drift kommer inn (også byggeøkta), fangede samtaler (spalta) og tråder fortsatt ikke', med.some((a) => a.drift === true) && med.some((a) => a.fanget === true && a.kind === 'svar') && !med.some((a) => a.kind === 'samtale' && !a.beholdt && !a.drift) && !med.some((a) => a.id === ku.id), `${med.length}`)
  const treff = regler.utvalg(alle, { treff: true })
  ok('regler.utvalg i treff: tråder (ubeholdte svar, konklusjon i utkast) får være med — de slås sammen til én rad av slåSammenTråder; prompter ikke', treff.some((a) => a.id === ku.id) && !treff.some((a) => a.kind === 'prompt') && !treff.some((a) => a.drift))
  const sortert = regler.sorterDato(avis)
  ok('regler.sorterDato: dato, siste først, alltid — nyeste lille huskelapp øverst, det gamle notatet nederst', sortert[0].id === nyest.id && sortert.at(-1).id === gammel.id && sortert.every((a, i) => i === 0 || sortert[i - 1].capturedAt >= a.capturedAt))
  const medVekt = sortert.map((a) => ({ ...a, vekt: a.id === dok.id ? 9.5 : a.id === nyest.id ? 0.8 : 2 }))
  ok('regler.hovedsakVekt: vekten velger hovedsaken (dokumentet med versjoner), ikke den nyeste; uten vekt-felt: regelen fra runde 1 (mest arbeid siste døgn — dokumentet med to versjoner)', regler.hovedsakVekt(medVekt)?.id === dok.id && regler.hovedsakVekt(sortert)?.id === dok.id && regler.hovedsakVekt(sortert.filter((a) => a.id !== dok.id))?.id === nyest.id && regler.hovedsakVekt([]) === null)
  ok('regler.typeOrd: vanlige ord — notat · dokument · konklusjon · svar · økt · samtale · spørsmål · drift', regler.typeOrd(notat) === 'notat' && regler.typeOrd(dok) === 'dokument' && regler.typeOrd(kl) === 'konklusjon' && regler.typeOrd(beholdt) === 'svar' && regler.typeOrd(byKey('okt:aaaa1111')) === 'økt' && regler.typeOrd(byKey('samtale:desk-1')) === 'samtale' && regler.typeOrd(pr) === 'spørsmål' && regler.typeOrd(byKey('commit-logg')) === 'drift')
  const u = regler.utenfor(alle)
  ok('regler.utenfor: tallene til linja under lista — 1 fanget (svaret; samtaler teller ikke), 3 drift', u.fanget === 1 && u.drift === 3 && regler.utenforTekst(u) === '1 fanget · 3 drift holdt utenfor' && regler.utenforTekst({ fanget: 12, drift: 0 }) === '12 fangede holdt utenfor' && regler.utenforTekst({}) === '', JSON.stringify(u))
  const prosjekter = [{ navn: 'Fjellstua Eiendom', alias: ['Fjellstua'], saker: 9, filer: 5, sist: T(1) }, { navn: 'Aas Kapital', alias: ['Energima'], saker: 8, filer: 0, sist: T(3) }, { navn: 'Tinden Regnskap', alias: [], saker: 1, filer: 0, sist: T(80) }, { navn: 'Tua_tua', alias: [], saker: 2, filer: 0, sist: T(0.3) }]
  const samtaler = regler.samtalerPerProsjekt(alle)
  ok('regler.prosjektTreff: «fjellstua» → prosjektet på navn; «Fjellstua Eiendom AS» → alle ordene; «eiendom» → navn', regler.prosjektTreff('fjellstua', { prosjekter, samtaler })[0]?.navn === 'Fjellstua Eiendom' && regler.prosjektTreff('fjellstua eiendom', { prosjekter, samtaler })[0]?.via === 'navn' && regler.prosjektTreff('eiendom', { prosjekter, samtaler }).length === 1)
  ok('regler.prosjektTreff: «energima» → Aas Kapital via alias (og via samtalen «Energima anke …»); «tua» → Tua_tua på navn (underscore = mellomrom)', regler.prosjektTreff('energima', { prosjekter, samtaler })[0]?.navn === 'Aas Kapital' && regler.prosjektTreff('energima', { prosjekter, samtaler })[0]?.via === 'alias' && regler.prosjektTreff('tua', { prosjekter, samtaler })[0]?.navn === 'Tua_tua')
  ok('regler.prosjektTreff: «sammenlign porteføljen» og «budsjettet» → Aas Kapital via samtalen; «reiseregning» → ingen; «tua» treffer ikke «Fjellstua» (ordstart); én bokstav → ingen', regler.prosjektTreff('sammenlign porteføljen', { prosjekter, samtaler })[0]?.via === 'samtale' && regler.prosjektTreff('budsjettet', { prosjekter, samtaler })[0]?.navn === 'Aas Kapital' && regler.prosjektTreff('reiseregning', { prosjekter, samtaler }).length === 0 && !regler.prosjektTreff('tua', { prosjekter, samtaler }).some((p) => p.navn === 'Fjellstua Eiendom') && regler.prosjektTreff('f', { prosjekter, samtaler }).length === 0)
  const mange = regler.prosjektTreff('a', { prosjekter, samtaler })
  ok('regler.prosjektTreff: aldri mer enn 3, navn før alias før samtale, så nyeste først', mange.length === 0 && regler.prosjektTreff('tua', { prosjekter: [...prosjekter, { navn: 'Tua', alias: [], sist: T(0.1) }, { navn: 'Tua Business', alias: [], sist: T(9) }, { navn: 'Annet', alias: ['tua gammel'], sist: T(0) }], samtaler }).map((p) => p.navn).join() === 'Tua,Tua_tua,Tua Business')
  ok('regler.spørsmålTekst: «Spørsmål i arbeid: «…» — 2 svar, konklusjon venter» · uten svar: «venter på svar»', regler.spørsmålTekst({ name: 'Sammenlign porteføljen', tråden: { svar: [1, 2] }, konklusjon_venter: true }) === 'Spørsmål i arbeid: «Sammenlign porteføljen» — 2 svar, konklusjon venter' && regler.spørsmålTekst({ name: 'X', tråden: { svar: [] } }) === 'Spørsmål i arbeid: «X» — venter på svar')
  ok('regler.øktTekst: «I Claude i dag: 3 økter, 1 fil skrevet» — nuller utelates', regler.øktTekst({ tekst: 'I Claude i dag: 3 økter, 1 fil skrevet, 0 svar beholdt', antall: 3, filer: 1, beholdt: 0 }) === 'I Claude i dag: 3 økter, 1 fil skrevet' && regler.øktTekst({ tekst: 'I Claude 22.10: 1 økt, 0 filer skrevet, 2 svar beholdt', antall: 1, filer: 0, beholdt: 2 }) === 'I Claude 22.10: 1 økt, 2 svar beholdt')
  ok('regler.størrelse og formatOrd', regler.størrelse(500) === '500 B' && regler.størrelse(40019) === '39 kB' && regler.størrelse(1_300_000) === '1,2 MB' && regler.formatOrd('pdf') === 'PDF' && regler.formatOrd('docx') === 'Word' && regler.formatOrd('bilde') === 'bilde')
  const d2 = { ...byKey('dok:strategi'), file: path.join(FE, 'Forhandlingsstrategi leieavtale Storgata 12.md') }
  const sf = regler.sakFiler(d2)
  ok('regler.sakFiler: gjengivelsene på saken med sti relativt til prosjektmappa (kan åpnes via broen)', sf.length === 2 && sf[0].format === 'PDF' && sf[0].sti === 'Forhandlingsstrategi leieavtale Storgata 12.pdf' && sf[1].format === 'HTML' && regler.sakFiler({ renders: [{ format: 'pdf', path: '/et/annet/sted/x.pdf' }], file: d2.file, project: 'Fjellstua Eiendom' })[0].sti === null)
}

// ── 3) broen ────────────────────────────────────────────────────────────────
const PORT = 5304
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
  const m = (await hent('/api/mappe')).json
  const fe = m.prosjekter.find((p) => p.navn === 'Fjellstua Eiendom'), ak = m.prosjekter.find((p) => p.navn === 'Aas Kapital')
  ok('GET /api/mappe: prosjektene med alias, antall saker, antall filer (ikke saker) og sist', fe && fe.alias.join() === 'Fjellstua' && fe.saker === 10 && fe.filer === 5 && fe.sist > 0 && ak.alias.join() === 'Energima' && ak.filer === 0 && m.prosjekter.every((p) => p.saker === undefined || typeof p.saker === 'number'), JSON.stringify(fe))
  const f = (await hent('/api/mappe?prosjekt=' + encodeURIComponent('Fjellstua Eiendom'))).json
  const navnene = f.filer.map((x) => x.sti)
  ok('GET /api/mappe?prosjekt: filene som ikke er saker — PDF, HTML, docx, bilde, også i undermappe; aldri .md (de er saker), aldri .DS_Store, aldri symlenken ut', f.prosjekt === 'Fjellstua Eiendom' && f.saker === 10 && navnene.length === 5 && navnene.includes('Vedlegg/Takst Fjellveien 3.pdf') && !navnene.some((n) => n.endsWith('.md') || n.startsWith('.') || n === 'lenke-ut.pdf'), navnene.join(' · '))
  ok('GET /api/mappe?prosjekt: nyeste først (mtime), format, bytes, mtime på hver', f.filer[0].sti === 'Plantegning.png' && f.filer.at(-1).sti === 'Leieavtale-signert.docx' && f.filer.every((x) => ['pdf', 'html', 'docx', 'bilde'].includes(x.format) && x.bytes > 0 && x.mtime > 0) && f.filer.find((x) => x.sti === 'Vedlegg/Takst Fjellveien 3.pdf').bytes === 120009)
  const strat = load().find((a) => a.key === 'dok:strategi')
  ok('GET /api/mappe?prosjekt: gjengivelsene (PDF, HTML) peker på saken de hører til (sak = id); de andre har sak null', f.filer.find((x) => x.sti.endsWith('.pdf') && !x.sti.includes('/')).sak === strat.id && f.filer.find((x) => x.sti.endsWith('.html')).sak === strat.id && f.filer.find((x) => x.sti === 'Plantegning.png').sak === null)
  ok('GET /api/mappe?prosjekt: ukjent mappe → 404; «..» og «Innboks» → 404 (aldri utenfor arkivroten)', (await hent('/api/mappe?prosjekt=Finnes-ikke')).status === 404 && (await hent('/api/mappe?prosjekt=..')).status === 404 && (await hent('/api/mappe?prosjekt=' + encodeURIComponent('../' + path.basename(path.dirname(ROOT))))).status === 404 && (await hent('/api/mappe?prosjekt=Innboks')).status === 404)
  const aa = await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: 'Vedlegg/Takst Fjellveien 3.pdf', hvor: 'app' })
  ok('POST /api/mappe/aapne (dryrun): åpner fila i programmet (open <sti>) · hvor=finder viser i Finder (open -R)', aa.status === 200 && aa.json.hvor === 'app' && aa.json.ran[0] === 'open' && aa.json.ran.at(-1).endsWith('Takst Fjellveien 3.pdf') && (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: 'Plantegning.png', hvor: 'finder' })).json.ran.includes('-R'), JSON.stringify(aa.json))
  ok('POST /api/mappe/aapne: utenfor mappa (../), symlenke ut, skjult fil, mappe, ukjent fil → 403/404; uten sti → 400', (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: '../Aas Kapital/x.pdf', hvor: 'app' })).status >= 403 && (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: 'lenke-ut.pdf', hvor: 'app' })).status === 403 && (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: '.DS_Store', hvor: 'app' })).status === 403 && (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: 'Vedlegg', hvor: 'app' })).status === 403 && (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom', sti: 'finnes-ikke.pdf', hvor: 'app' })).status === 404 && (await post('/api/mappe/aapne', { prosjekt: 'Fjellstua Eiendom' })).status === 400)
  // avisen via /api/atoms: klassene stemmer med reglene; søket holder drift utenfor
  const at = (await hent('/api/atoms')).json
  const avis = regler.sorterDato(regler.utvalg(at.atoms.filter((a) => a.key)))
  const hoved = regler.hovedsakVekt(avis)
  ok('/api/atoms + regler.utvalg: avisen har bare arbeid, sortert på dato (huskelappen øverst); hovedsaken er den med størst vekt — ikke den nyeste huskelappen', avis.every((a) => a.klasse === 'arbeid') && avis[0].key === 'notat:kort' && hoved.key !== 'notat:kort' && hoved.vekt === Math.max(...avis.map((a) => a.vekt)), `${avis.length} rader · hoved ${hoved?.name} (${hoved?.vekt})`)
  const sø = (await hent('/api/search?q=tua&limit=50')).json, søMed = (await hent('/api/search?q=tua&limit=50&drift=med&fanget=med')).json
  ok('/api/search: drift holdes utenfor (driftUtenfor), «ta med» (drift=med&fanget=med) tar dem inn', sø.driftUtenfor >= 1 && sø.hits.every((h) => !h.drift) && søMed.driftUtenfor === 0 && søMed.hits.some((h) => h.drift), JSON.stringify([sø.total, sø.driftUtenfor, søMed.total]))
  const ss = (await hent('/api/siden-sist?dager=7')).json
  ok('/api/siden-sist: det åpne spørsmålet står i arbeid med 2 svar og konklusjon som venter; den låste tråden og det beholdte svarets tråd gjør det ikke', ss.spørsmål.some((s) => s.id === pr.id && s.tråden.svar.length === 2 && s.konklusjon_venter) && !ss.spørsmål.some((s) => s.id === pr2.id || s.id === pr3.id), ss.spørsmål.map((s) => s.name).join(' · '))
  ok('/api/siden-sist: Claude-øktene — én linje per økt med saker, tekst per dag; byggeøkta er merket drift', ss.økter.some((ø) => ø.økt === 'aaaa1111' && ø.saker.length === 2 && !ø.drift) && ss.økter.some((ø) => ø.økt === 'bbbb2222' && ø.drift) && ss.økterPerDag[0].tekst.startsWith('I Claude '))
  ok('POST /api/bruk {lest_M} fra appen teller', (await post('/api/bruk', { id: strat.id, hendelse: 'lest_M' })).status === 200)
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} feil` : 'alle grønne'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
