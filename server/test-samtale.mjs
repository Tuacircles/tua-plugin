#!/usr/bin/env node
// test-samtale.mjs — skive 1 «Tråden» i arbeidsstykke 33 (V22 «Samtalen først», Erik 27.10.2026). ALDRI mot ~/Dropbox/Tua, ALDRI Eriks ekte Cowork-mappe
// (et falskt tre i scratch, TUA_COWORK_ROOT), ALDRI et ekte modellkall (test-mottakerne ekkoer; TUA_VURDERER=test; TUA_SKRIVER=regel).
//
//   TUA_FILES_ROOT=/tmp/tua-test-samtale/arkiv TUA_DATA_DIR=/tmp/tua-test-samtale/data TUA_HOME=/tmp/tua-test-samtale/hjem node server/test-samtale.mjs
//
// Sjekker (planens §9 rad 1, briefens (a)–(i)):
//   byggMeldinger: vendingene vekselvis user/assistant, like roller slås sammen, kildene i første brukermelding, modellsvar først → en brukermelding settes foran, uten vendinger = én melding
//   (e) spor() uten samtale lager en samtale-sak med kilde Tua (nøkkel samtale:tua:, tagger samtale · tua, tittel = første setning, start), transkript «**Du · tid:**» / «**Test · M:**»,
//       S = siste vending, M etter regelen; prompt og svar peker på samtalen (bygget_av) og har samtalen som convo; samtaleFraSak leser transkriptet tilbake; én versjon per vending
//   (a) et oppfølgingsspørsmål med vendinger → `messages` i riktig rekkefølge og rolle, hele lista til mottakeren (ekkoet viser [Du]/[Modellen]) · (b) annen avkryssing → annen sending
//   (c) samme person → samme plassholder i vending, kilde og melding · (d) Utlevert-linja har vendinger [{id, rolle}] og samtale · Vault-merket vending stoppes hos ekstern, går lokalt
//   (h) standardVendinger: alt etter siste låste konklusjon, kuttet BAKFRA mot budsjettet, `utenfor` sier hvorfor; budsjett per mottaker i mottakere()
//   (f) review --traader: gamle Tua-tråder (prompt:spor: uten samtale) får samtale-sak — dry-run skriver ingenting, --skriv gjør det, tråder() gir samme svar før og etter
//   (g) en importert Cowork-samtale (seed) kan fortsettes: GET /api/samtale gir vendingene fra prompt-/capture-sakene, spor({vendinger, samtale}) sender dem og peker på samtalen uten å skrive den om
//   (i) forhåndsvis med vendinger viser hele `messages` og budsjettet uten å lagre eller logge
//   broen: POST /api/samtale/ny → reservert id, GET /api/samtale 404 {ny} før første spørsmål, POST /api/spor med samtale: t_… lagrer, GET /api/samtale på samtale/sak i den,
//          standard per mottaker, /api/spor/forhandsvis med vendinger, /api/utlevert?id med vendinger og samtale, /api/atoms og /api/siden-sist virker
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '3'
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
const CODE_HOME = path.join(SCRATCH, 'code-home'), COWORK = path.join(SCRATCH, 'cowork'), FINDER_TOM = path.join(SCRATCH, 'finder-tom')
for (const d of [ROOT, DATA, HJEM, CODE_HOME, COWORK, FINDER_TOM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODE_HOME = CODE_HOME
process.env.TUA_COWORK_ROOT = COWORK
fs.mkdirSync(path.join(HJEM, '.tua'), { recursive: true }); fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [FINDER_TOM] } }) + '\n')

const store = await import('./store.js')
const { load, save, upsert, deliveries, fileOf, versions, tråder, setStatus } = store
const motor = await import('./motor.js')
const { spor, forhåndsvis, byggMeldinger, mottakere, standardFor, Blokkert, BUDSJETT } = motor
const sam = await import('./samtale.js')
const { finnSamtale, samtaleFor, vendingerFor, standardVendinger, erTuaSamtale, samtaleTittel, gamleTråder, erSyntetiskId } = sam
const { samtaleFraSak } = await import('./samtaletekst.js')
const { importCode } = await import('./import.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const les = (id) => load().find((a) => a.id === id)
const UTLEVERT = path.join(ROOT, '.tua', 'utlevering.jsonl')
const loggLinjer = () => (fs.existsSync(UTLEVERT) ? fs.readFileSync(UTLEVERT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

// ── testarkiv ───────────────────────────────────────────────────────────────
const PERSON = 'Xenia Fjeldstad', EPOST = 'xenia.fjeldstad@example.no'
{
  const atoms = []
  upsert(atoms, { key: 'notat:lager', content: `# Møtenotat\n\n${PERSON} (${EPOST}) foreslo å flytte lageret til Industriveien 4, 2000 Lillestrøm. Budsjett 45 000 kr. ` + 'Lang tekst om lagerdrift. '.repeat(200), name: 'Møtenotat lager', project: 'Testprosjekt', convo: `Møte med ${PERSON}`, short: `Flytte lageret til ny adresse; ${PERSON} foreslo det.`, by: 'menneske', tags: ['lager'] })
  upsert(atoms, { key: 'notat:kort', content: 'Kort sak uten personopplysninger om lagerdrift.', name: 'Kort sak', project: 'Testprosjekt', by: 'menneske' })
  save(atoms)
}
const a1 = load().find((a) => a.key === 'notat:lager')

// ── 1) byggMeldinger ────────────────────────────────────────────────────────
{
  const v = [{ rolle: 'bruker', tekst: 'Spørsmål 1' }, { rolle: 'modell', tekst: 'Svar 1' }, { rolle: 'modell', tekst: 'Svar 1b (fra en annen modell)' }, { rolle: 'bruker', tekst: 'Spørsmål 2' }, { rolle: 'modell', tekst: 'Svar 2' }]
  const m = byggMeldinger({ vendinger: v, melding: 'Spørsmål 3', kontekst: '## Kilde\n\ntekst' })
  ok('byggMeldinger: vekselvis user/assistant, to modellsvar etter hverandre slått sammen, meldingen sist', m.map((x) => x.role).join(' ') === 'user assistant user assistant user' && m[1].content === 'Svar 1\n\nSvar 1b (fra en annen modell)' && m.at(-1).content === 'Spørsmål 3', m.map((x) => x.role).join(' '))
  ok('byggMeldinger: kildene ligger i den FØRSTE brukermeldingen (som byggMelding), ikke i den siste', m[0].content.startsWith('Spørsmål 1\n\n---\n\nKontekst\n\n## Kilde') && !m.at(-1).content.includes('Kontekst'))
  const m2 = byggMeldinger({ vendinger: [{ rolle: 'modell', tekst: 'Bare et svar' }], melding: 'Hva mener du?', kontekst: '## K\n\nx' })
  ok('byggMeldinger: begynner lista med et modellsvar, settes en brukermelding med kildene foran (Claude krever user først)', m2.length === 3 && m2[0].role === 'user' && m2[0].content.includes('Kontekst') && m2[1].role === 'assistant' && m2[2].content === 'Hva mener du?', JSON.stringify(m2.map((x) => x.role)))
  const m3 = byggMeldinger({ melding: 'Hei', kontekst: '## K\n\nx' })
  ok('byggMeldinger uten vendinger: nøyaktig én melding = dagens oppførsel', m3.length === 1 && m3[0].role === 'user' && m3[0].content === 'Hei\n\n---\n\nKontekst\n\n## K\n\nx')
  ok('byggMeldinger: to brukermeldinger etter hverandre (siste vending var brukerens) slås sammen med den nye', byggMeldinger({ vendinger: [{ rolle: 'bruker', tekst: 'A' }], melding: 'B' }).length === 1)
  ok('samtaleTittel: første setning når den er kort, ellers 60 tegn', samtaleTittel('Hva er fristen?\nAndre linje.') === 'Hva er fristen?' && samtaleTittel('x'.repeat(100)).length === 60 && samtaleTittel('Lang første setning som går langt over seksti tegn før den slutter her. Neste.').length >= 55)
}

// ── 2) (e) første spørsmål lager samtale-saken · (a)(b)(c)(d) oppfølging med vendinger ─────────────────────────────────────
const Q1 = `Hva foreslo ${PERSON} om lageret?`
const r1 = await spor({ melding: Q1, saker: [{ id: a1.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Testprosjekt' })
let S1 = les(r1.samtale)
{
  const p = les(r1.prompt), s = les(r1.svar)
  ok('(e) spor uten samtale: en samtale-sak med kilde Tua, nøkkel samtale:tua:<id>, tagger samtale · tua, i prosjektet, tittel = spørsmålet', S1?.kind === 'samtale' && S1.source === 'Tua' && /^samtale:tua:t_/.test(S1.key) && S1.tags.join() === 'samtale,tua' && S1.project === 'Testprosjekt' && S1.name === Q1 && erTuaSamtale(S1), JSON.stringify(S1 && [S1.key, S1.name, S1.tags]))
  ok('(e) prompt og svar peker på samtalen (bygget_av) og har samtalen som convo; svaret har prompten FØRST og samtalen SIST', p.derivedFrom.some((d) => d.id === S1.id) && s.derivedFrom[0].id === p.id && s.derivedFrom.at(-1).id === S1.id && s.derivedFrom.some((d) => d.id === a1.id && d.level === 'M') && p.convo === S1.name && s.convo === S1.name, JSON.stringify(s.derivedFrom))
  const fil = fs.readFileSync(fileOf(S1), 'utf8')
  ok('(e) samtale-saken på disk: kilde Tua, transkriptet med «**Du · tid:**» og «**Test · M:**», spørsmålet og svaret i L', fil.includes('kilde: "Tua"') && /\*\*Du · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\*\* Hva foreslo/.test(fil) && fil.includes('**Test · M:** Ekko fra test-mottakeren') && fil.includes(`_Tua · 1 vending · ${(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()} · Testprosjekt_`), fil.split('\n').slice(0, 30).join(' | ').slice(0, 300))   // skive 3: lokal dato (midnattsfeilen)
  ok('(e) S = siste vending (samtaleS), M etter regelen (samtaleM, by regel), versjon 1 etter første vending', S1.levels?.S?.text.startsWith(`Sist: ${Q1} → Ekko fra test-mottakeren`) && S1.levels.S.text.includes('1 vending') && S1.levels.S.by === 'regel' && S1.levels.M?.text.includes('**Første spørsmål:**') && S1.levels.M.text.includes('Tua · 1 vending') && (S1.version || 1) === 1, JSON.stringify([S1.levels?.S?.text, S1.version]))
  const lest = samtaleFraSak(S1.content, { first: S1.createdAt, last: S1.capturedAt })
  ok('(e) samtaleFraSak leser transkriptet tilbake (review --samtaler virker på Tua-samtaler): 1 par, prompten og svaret', lest?.pairs.length === 1 && lest.pairs[0].prompt === Q1 && lest.pairs[0].svar.startsWith('Ekko fra test-mottakeren') && lest.S === S1.levels.S.text, JSON.stringify(lest && [lest.pairs.length, lest.S.slice(0, 60)]))
  const v = vendingerFor(load(), S1)
  ok('vendingerFor: to vendinger — brukeren (prompten) og modellen (svaret, nivå M, modell Test), i rekkefølge', v.length === 2 && v[0].rolle === 'bruker' && v[0].id === p.id && v[1].rolle === 'modell' && v[1].id === s.id && v[1].nivå === 'M' && v[1].modell === 'Test' && v[0].prompt === p.id, JSON.stringify(v.map((x) => [x.rolle, x.modell, x.nivå])))
  ok('finnSamtale: på samtalens id, på nøkkelen (reservert id) og på en sak i samtalen (svaret) → samme samtale', finnSamtale(load(), S1.id)?.id === S1.id && finnSamtale(load(), S1.key.replace(/^samtale:tua:/, ''))?.id === S1.id && finnSamtale(load(), s.id)?.id === S1.id && samtaleFor(load(), p)?.id === S1.id)
  ok('tråder(): prompt, svar i samme tråd som før (samtalen i bygget_av forstyrrer ikke)', tråder(load()).av.get(s.id) === p.id && tråder(load()).per.get(p.id).svar.includes(s.id))
}
const Q2 = 'Og hva koster det?'
const h2 = []
const r2 = await spor({ melding: Q2, saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: S1.id, vendinger: [{ id: r1.prompt, rolle: 'bruker' }, { id: r1.svar, rolle: 'modell' }], på: (ev, d) => h2.push([ev, d]) })
{
  const sk = h2.find((h) => h[0] === 'skjermet')[1]
  ok('(a) oppfølging med vendinger: `messages` = [user: spørsmål 1, assistant: svar 1, user: spørsmål 2] — riktig rekkefølge og rolle', sk.meldinger.length === 3 && sk.meldinger.map((m) => m.role).join(' ') === 'user assistant user' && sk.meldinger[0].content.startsWith('Hva foreslo [Person A] om lageret?') && sk.meldinger[1].content.startsWith('Ekko fra test-mottakeren') && sk.meldinger[2].content === Q2, JSON.stringify(sk.meldinger.map((m) => [m.role, m.content.slice(0, 40)])))
  ok('(a) skjermet-hendelsen har vendingene som gikk, samtalen og budsjettet per mottaker (test: 1 500 tokens, ikke over)', sk.vendinger.length === 2 && sk.vendinger[0].rolle === 'bruker' && sk.vendinger[1].id === r1.svar && sk.samtale === S1.id && sk.budsjett.test.budsjett === 1500 && sk.budsjett.test.over === false && typeof sk.budsjett.test.tokens === 'number', JSON.stringify(sk.budsjett))
  ok('(a) mottakeren fikk hele lista — ekkoet er merket per rolle ([Du] / [Modellen]) og har alle tre meldingene', r2.tekst.includes('[Du]\nHva foreslo') && r2.tekst.includes('[Modellen]\nEkko fra test-mottakeren') && r2.tekst.includes(`[Du]\n${Q2}`), r2.tekst.slice(0, 200))
  ok('(a) «se hva som sendes» (tekst) er det samme som messages flatet, uten originaler', sk.tekst.includes('[Du]\n') && !sk.tekst.includes(PERSON) && !sk.tekst.includes(EPOST))
  const p2 = les(r2.prompt), s2 = les(r2.svar), S1b = les(S1.id)
  ok('(e) andre vending: prompt og svar i samme samtale (convo, bygget_av), samtale-saken skrevet på nytt med 2 vendinger, ny versjon, forrige i .tua/versions', p2.convo === S1.name && s2.derivedFrom.at(-1).id === S1.id && S1b.levels.S.text.startsWith(`Sist: ${Q2}`) && S1b.levels.S.text.includes('2 vendinger') && S1b.content.includes(`**Du · `) && S1b.content.split('**Du · ').length === 3 && (S1b.version || 1) > (S1.version || 1) && versions(S1.id).length >= 1, JSON.stringify([S1b.version, versions(S1.id).map((v) => v.name)]))
  ok('(e) svaret sier at vendinger var med', s2.levels.S.text.includes('med 2 vendinger fra samtalen'))
  const u = loggLinjer().at(-1)
  ok('(d) Utlevert-linja har vendinger [{id, rolle}] i rekkefølge og samtale — aldri innhold', u.tool === 'spor' && u.samtale === S1.id && u.vendinger.length === 2 && u.vendinger[0].id === r1.prompt && u.vendinger[0].rolle === 'bruker' && u.vendinger[1].rolle === 'modell' && !JSON.stringify(u).includes('Ekko') && !JSON.stringify(u).includes(PERSON), JSON.stringify(u.vendinger))
  S1 = S1b
}
// (b) annen avkryssing → annen sending; (c) samme plassholder i vending, kilde og melding
{
  const h = []
  const Q3 = `Skriv et brev til ${PERSON} om flyttingen.`
  const r3 = await spor({ melding: Q3, saker: [{ id: a1.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: S1.id, vendinger: [{ id: r1.svar, rolle: 'modell' }], på: (ev, d) => h.push([ev, d]) })
  const sk = h.find((x) => x[0] === 'skjermet')[1]
  ok('(b) bare svaret avkrysset: `messages` begynner med en brukermelding som bærer kildene, så svaret, så spørsmålet — en annen sending enn (a)', sk.meldinger.length === 3 && sk.meldinger[0].content.startsWith('(Fortsettelse av en samtale') && sk.meldinger[0].content.includes('## Møtenotat lager') && sk.meldinger[1].role === 'assistant' && sk.meldinger[2].content.includes('Skriv et brev til [Person A]') && JSON.stringify(sk.meldinger) !== JSON.stringify(h2.find((x) => x[0] === 'skjermet')[1].meldinger), JSON.stringify(sk.meldinger.map((m) => [m.role, m.content.slice(0, 40)])))
  const alle = JSON.stringify(sk.meldinger)
  ok('(c) skjermingen: samme person er [Person A] i vendingen (svar 1 nevner henne), i kilden (notatet) og i meldingen — aldri navnet, aldri [Person B] for samme navn', !alle.includes(PERSON) && !alle.includes(EPOST) && sk.meldinger[0].content.includes('[Person A]') && sk.meldinger[1].content.includes('[Person A]') && sk.meldinger[2].content.includes('[Person A]') && !alle.includes('[Person B]') && sk.antall.navn >= 3, JSON.stringify(sk.antall))
  ok('(c) svaret har originalen satt inn igjen (avskjerm som før)', r3.tekst.includes(PERSON) && !r3.tekst.includes('[Person A]'))
  ok('(e) samtalen har nå 3 vendinger og S peker på det siste spørsmålet', les(S1.id).levels.S.text.includes('3 vendinger') && les(S1.id).levels.S.text.startsWith('Sist: Skriv et brev til'))
  // Vault-merket vending (et svar bygget på en Vault-sak arver merket) går aldri til en ekstern mottaker — til en lokal går det
  const atoms = load(); const vaultSvar = upsert(atoms, { key: 'svar:vault', kind: 'svar', content: 'Svar som bygger på Vault-saken.', name: 'Svar fra Test: vault', project: 'Testprosjekt', convo: S1.name, source: 'Test', tags: ['svar', 'test', 'vault'], by: 'regel', derivedFrom: [{ id: r1.prompt, version: 1, level: 'L' }] }).atom; save(atoms)
  let e = null; try { await spor({ melding: 'Hei', saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: S1.id, vendinger: [{ id: vaultSvar.id, rolle: 'modell' }] }) } catch (x) { e = x }
  ok('Vault-merket vending til ekstern mottaker → Blokkert (fail closed) før noe sendes', e instanceof Blokkert && /Vault-merket/.test(e.message) && /vending/.test(e.message), e?.message)
  const lok = await spor({ melding: 'Hei lokalt', saker: [], mottaker: 'testlokal', prosjekt: 'Testprosjekt', samtale: S1.id, vendinger: [{ id: vaultSvar.id, rolle: 'modell' }] })
  ok('Vault-merket vending til lokal modell er lov', /Svar som bygger på Vault-saken/.test(lok.tekst))
  e = null; try { await spor({ melding: 'Hei', saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', vendinger: [{ id: 'a_finnes_ikke' }] }) } catch (x) { e = x }
  ok('ukjent vending-id → MotorFeil (ingen stille utelatelse)', e instanceof motor.MotorFeil && /fant ikke vendingen/.test(e.message))
}

// ── 3) (h) standardvalg og budsjett ─────────────────────────────────────────
{
  const v = (id, rolle, tegn, ekstra = {}) => ({ id, rolle, L: 'x'.repeat(tegn), tid: 0, låst: false, ...ekstra })
  const liste = [v('p1', 'bruker', 100), v('s1', 'modell', 100), v('k1', 'konklusjon', 50, { låst: true }), v('p2', 'bruker', 100), v('s2', 'modell', 400), v('p3', 'bruker', 300), v('s3', 'modell', 300)]
  const r = standardVendinger(liste, { id: 'm', label: 'Modellen (x)', budsjett: 1000 }, { anslå: (t) => t.length })
  ok('(h) standard: alt etter siste låste konklusjon (p2 s2 p3 s3 = 1 100 tegn) kuttes BAKFRA mot budsjettet 1 000 → p2 faller, s2 p3 s3 er med', r.vendinger.join(' ') === 's2 p3 s3' && r.tokens === 1000 && r.budsjett === 1000, JSON.stringify(r.vendinger))
  ok('(h) utenfor sier hvorfor, i rekkefølge: p1/s1 før konklusjonen, k1 er strek, p2 utenfor budsjettet (med tall og navnet på mottakeren)', r.utenfor.map((u) => u.id).join(' ') === 'p1 s1 k1 p2' && /før siste låste konklusjon/.test(r.utenfor[0].hvorfor) && /strek/.test(r.utenfor[2].hvorfor) && /utenfor budsjettet til Modellen \(ca\. 100 tokens; 1\s000 er grensen/.test(r.utenfor[3].hvorfor), JSON.stringify(r.utenfor))
  const r2 = standardVendinger(liste.filter((x) => x.rolle !== 'konklusjon'), { id: 'm', budsjett: 0 }, { anslå: (t) => t.length })
  ok('(h) uten låst konklusjon og uten budsjett: alt er med, ingenting utenfor', r2.vendinger.length === 6 && r2.utenfor.length === 0)
  const r3 = standardVendinger(liste, { id: 'm', budsjett: 650 }, { anslå: (t) => t.length })
  ok('(h) mindre budsjett: de to nyeste er med (600), og faller én utenfor (s2), faller alle eldre også (ingenting kuttes stille midt i)', r3.vendinger.join(' ') === 'p3 s3' && r3.utenfor.filter((u) => /budsjettet/.test(u.hvorfor)).map((u) => u.id).join(' ') === 'p2 s2', JSON.stringify(r3.vendinger))
  ok('(h) får ikke den nyeste plass alene, er ingenting valgt — og utenfor sier det for alle', standardVendinger(liste, { id: 'm', budsjett: 250 }, { anslå: (t) => t.length }).vendinger.length === 0)
  const ms = await mottakere()
  ok('mottakere(): budsjett per rad — test 1 500, Claude 150 000, Ollama etter kontekstvinduet (standard 4 096 · 0,75 = 3 072)', ms.find((m) => m.id === 'test').budsjett === 1500 && ms.find((m) => m.id === 'claude').budsjett === 150000 && ms.find((m) => m.id === 'ollama').budsjett === 3072 && BUDSJETT.mistral === 100000, JSON.stringify(ms.map((m) => [m.id, m.budsjett])))
  // mot ekte vendinger i samtalen: tre lange runder til test-mottakeren → standardFor kutter bakfra
  const lang = 'Lang vending om lageret. '.repeat(140)   // 3 500 tegn ≈ 1 000 tokens hos test
  for (let i = 0; i < 2; i++) await spor({ melding: `${lang} (${i})`, saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: S1.id })
  const vend = vendingerFor(load(), les(S1.id))
  const std = standardFor(vend, 'test')
  ok('(h) standardFor mot samtalen: budsjettet (1 500) holder bare den nyeste lange vendingen; de eldre står i utenfor med «utenfor budsjettet»', std.vendinger.length >= 1 && std.vendinger.length < vend.length && std.utenfor.length >= 3 && std.utenfor.every((u) => /utenfor budsjettet til Test/.test(u.hvorfor)) && std.vendinger.at(-1) === vend.at(-1).id, JSON.stringify([vend.length, std.vendinger.length, std.utenfor.length, std.tokens]))
  const h = []
  const uten = vend.filter((v) => !v.vault)   // Vault-svaret fra forrige blokk kan ikke gå til test (ekstern)
  await spor({ melding: 'Kort oppfølging', saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: S1.id, vendinger: uten.map(({ id, rolle }) => ({ id, rolle })), på: (ev, d) => h.push([ev, d]) })
  const sk = h.find((x) => x[0] === 'skjermet')[1]
  ok('(h) sender brukeren likevel alt: ingenting kuttes, men skjermet-hendelsen sier over: true for mottakeren (Sendes-linja kan si fra)', sk.vendinger.length === uten.length && sk.budsjett.test.over === true && sk.budsjett.test.tokens > 1500, JSON.stringify(sk.budsjett))
}

// ── 4) (i) forhåndsvis med vendinger: hele messages, ingenting lagret eller logget ──────────────────────────────────────────
{
  const før = load().length, loggFør = loggLinjer().length
  const f = forhåndsvis({ melding: `Oppsummer for ${PERSON}`, saker: [{ id: a1.id, nivå: 'S' }], mottakere: ['test', 'testlokal'], prosjekt: 'Testprosjekt', samtale: S1.id, vendinger: [{ id: r1.prompt, rolle: 'bruker' }, { id: r1.svar, rolle: 'modell' }] })
  ok('(i) forhåndsvis: `meldinger` er hele messages (3), skjermet, kildene i første brukermelding; vendinger og samtale i svaret; budsjett per mottaker', f.meldinger.length === 3 && f.meldinger[0].content.includes('## Møtenotat lager') && !JSON.stringify(f.meldinger).includes(PERSON) && f.vendinger.length === 2 && f.samtale === S1.id && f.budsjett.test.budsjett === 1500 && f.budsjett.testlokal.budsjett === 1500 && typeof f.tokens.per.testlokal === 'number' && !f.blokkert, JSON.stringify([f.meldinger.map((m) => m.role), f.budsjett]))
  ok('(i) forhåndsvis: ingenting lagret, ingenting logget', load().length === før && loggLinjer().length === loggFør)
}

// ── 5) (f) review --traader: gamle Tua-tråder får samtale-sak ───────────────────────────────────────────────────────────
const kjør = (...a) => spawnSync(process.execPath, [path.join(HERE, 'review.js'), ...a], { encoding: 'utf8', env: process.env })
{
  const atoms = load()
  const gp = upsert(atoms, { key: 'prompt:spor:gammel1', kind: 'prompt', content: 'Gammelt spørsmål fra Spør før skive 1: hva er fristen for anke?', name: 'Hva er fristen for anke?', project: 'Testprosjekt', convo: 'Hva er fristen for anke?', source: 'Tua', by: 'regel', short: 'Gammelt spørsmål.' }).atom
  const gs = upsert(atoms, { key: 'svar:spor:gammel1', kind: 'svar', content: 'Fristen er tre uker fra vedtaket ble mottatt.', name: 'Svar fra Test: Hva er fristen for anke?', project: 'Testprosjekt', convo: 'Hva er fristen for anke?', source: 'Test (ekko — sender ingenting)', tags: ['svar', 'test'], by: 'regel', derivedFrom: [{ id: gp.id, version: 1, level: 'L' }] }).atom
  gp.ga = [{ id: gs.id, version: 1 }]
  const gk = upsert(atoms, { key: `konklusjon:${gp.id}`, kind: 'konklusjon', content: 'Konklusjon: tre uker.', name: 'Konklusjon: Hva er fristen for anke?', project: 'Testprosjekt', convo: 'Hva er fristen for anke?', source: 'Test', tags: ['konklusjon'], by: 'regel', derivedFrom: [{ id: gp.id, version: 1, level: 'L' }, { id: gs.id, version: 1, level: 'L' }] }).atom
  setStatus(gk, 'endelig')
  save(atoms)
  const trådFør = tråder(load())
  ok('gamleTråder: finner den gamle tråden (prompt:spor: uten samtale), ikke dem som alt har samtale', gamleTråder(load()).length === 1 && gamleTråder(load())[0].saker.length === 3 && gamleTråder(load())[0].convo === 'Hva er fristen for anke?')
  const antallFør = load().length
  const dry = kjør('--traader')
  ok('(f) review --traader (dry-run som standard): teller og viser, skriver ingenting', dry.status === 0 && /1 gamle Tua-tråder uten samtale-sak/.test(dry.stdout) && /DRY-RUN/.test(dry.stdout) && /Testprosjekt \/ «Hva er fristen for anke\?»  1 spørsmål · 3 saker/.test(dry.stdout) && load().length === antallFør, dry.stdout.split('\n')[0] + (dry.stderr ? ' | ' + dry.stderr.slice(0, 200) : ''))
  const ekte = kjør('--traader', '--skriv')
  const S2 = load().find((a) => erTuaSamtale(a) && a.name === 'Hva er fristen for anke?')
  ok('(f) review --traader --skriv: samtale-sak med kilde Tua og nøkkel samtale:tua:<hash>, versjon 1, start = spørsmålets tid', ekte.status === 0 && /1 samtale-saker laget/.test(ekte.stdout) && !!S2 && /^samtale:tua:[0-9a-f]{8}$/.test(S2.key) && (S2.version || 1) === 1 && load().length === antallFør + 1, ekte.stdout.split('\n').at(-2))
  ok('(f) prompt, svar og konklusjon peker nå på samtalen; transkriptet har spørsmålet, svaret og konklusjonen som strek (låst)', [gp.id, gs.id, gk.id].every((id) => les(id).derivedFrom.some((d) => d.id === S2.id)) && S2.content.includes('**Du · ') && S2.content.includes('**Test:** Fristen er tre uker') && S2.content.includes('---\n\n**Konklusjon · låst · ') && S2.levels.S.text.includes('1 vending'), S2.content.slice(0, 400))
  ok('(f) tråder() gir samme svar før og etter (svar og konklusjon i prompt-tråden)', trådFør.av.get(gs.id) === gp.id && tråder(load()).av.get(gs.id) === gp.id && tråder(load()).per.get(gp.id).konklusjon === gk.id)
  const vend = vendingerFor(load(), S2)
  ok('(f) vendingene i den omgjorte tråden: bruker, modell, konklusjon (låst) — standardvalget sier konklusjonen er strek og det før er oppsummert', vend.map((v) => v.rolle).join(' ') === 'bruker modell konklusjon' && vend[2].låst && standardFor(vend, 'test').vendinger.length === 0 && standardFor(vend, 'test').utenfor.length === 3, JSON.stringify(standardFor(vend, 'test').utenfor.map((u) => u.hvorfor.slice(0, 30))))
  ok('(f) review --traader igjen: ingenting å gjøre', /0 gamle Tua-tråder/.test(kjør('--traader').stdout))
  ok('(f) samtaleFraSak leser transkriptet med konklusjonsstrek: 1 par, svaret uten konklusjonen', samtaleFraSak(S2.content)?.pairs.length === 1 && samtaleFraSak(S2.content).pairs[0].svar === 'Fristen er tre uker fra vedtaket ble mottatt.', JSON.stringify(samtaleFraSak(S2.content)?.pairs))
}

// ── 6) (g) en importert Cowork-samtale kan fortsettes ───────────────────────────────────────────────────────────────
const CW_ID = 'cafe0001-2222-3333-4444-555566667777'
{
  const sess = path.join(COWORK, 'konto', 'rom', `local_${CW_ID}`)
  fs.mkdirSync(sess, { recursive: true })
  const mappe = path.join(SCRATCH, 'Oppgjør'); fs.mkdirSync(mappe, { recursive: true })
  fs.writeFileSync(sess + '.json', JSON.stringify({ title: 'Oppgjøret med Skado', userSelectedFolders: [mappe], createdAt: '2026-10-20T09:00:00Z', lastActivityAt: '2026-10-20T10:00:00Z' }))
  const P1 = 'Kan du gå gjennom oppgjørsforslaget fra Skado og si hva som er uklart i kravet på 120 000 kroner og motkravet?'
  const A1 = 'Oppgjørsforslaget har tre uklare punkter. '.repeat(90)   // > MIN_SVAR (3 000) → svar-sak
  const P2 = 'Takk. Hvilke av de tre punktene bør vi ta opp med dem først, og hvordan bør vi formulere oss?'
  const A2 = 'Ta først punktet om renter, så fristen. '.repeat(90)
  const P3 = 'Og renter?'                                                   // skive 3: under 80 tegn → ingen prompt-sak, men en vending i transkriptet
  const A3 = 'Rentekravet er ikke dokumentert. Be om renteberegningen før dere svarer.'   // under 3 000 tegn → ingen svar-sak, men en vending
  const linje = (o) => JSON.stringify(o) + '\n'
  fs.writeFileSync(path.join(sess, 'audit.jsonl'), [
    linje({ type: 'system', subtype: 'init', session_id: CW_ID, cwd: mappe, _audit_timestamp: '2026-10-20T09:00:00Z' }),
    linje({ type: 'user', session_id: CW_ID, message: { role: 'user', content: [{ type: 'text', text: P1 }] }, _audit_timestamp: '2026-10-20T09:01:00Z' }),
    linje({ type: 'assistant', session_id: CW_ID, message: { role: 'assistant', content: [{ type: 'text', text: A1 }] }, _audit_timestamp: '2026-10-20T09:03:00Z' }),
    linje({ type: 'user', session_id: CW_ID, message: { role: 'user', content: [{ type: 'text', text: P2 }] }, _audit_timestamp: '2026-10-20T09:10:00Z' }),
    linje({ type: 'assistant', session_id: CW_ID, message: { role: 'assistant', content: [{ type: 'text', text: A2 }] }, _audit_timestamp: '2026-10-20T09:12:00Z' }),
    linje({ type: 'user', session_id: CW_ID, message: { role: 'user', content: [{ type: 'text', text: P3 }] }, _audit_timestamp: '2026-10-20T09:14:00Z' }),
    linje({ type: 'assistant', session_id: CW_ID, message: { role: 'assistant', content: [{ type: 'text', text: A3 }] }, _audit_timestamp: '2026-10-20T09:15:00Z' }),
  ].join(''))
  const imp = importCode({ source: 'cowork' })
  const CW = load().find((a) => a.key === `samtale:${CW_ID}`)
  ok('(g) Cowork-seed importert: samtale-sak med kilde Claude Cowork, 2 prompter, 2 svar-saker (den korte tredje vendingen gir ingen saker)', imp.stats.nye >= 1 && CW?.kind === 'samtale' && CW.source === 'Claude Cowork' && load().filter((a) => a.kind === 'prompt' && String(a.key || '').startsWith(`prompt:${CW_ID.slice(0, 8)}:`)).length === 2 && load().filter((a) => String(a.key || '').startsWith(`svar:${CW_ID.slice(0, 8)}:`)).length === 2, JSON.stringify(imp.stats))
  const vend = vendingerFor(load(), CW)
  ok('(g) vendingene i en importert samtale er ALLE vendingene fra transkriptet (skive 3): bruker, modell × 3 — de fire første peker på importens saker (modell = Claude)', vend.map((v) => v.rolle).join(' ') === 'bruker modell bruker modell bruker modell' && vend[0].L === P1 && vend[1].L === A1.trim() && vend[1].modell === 'Claude' && vend[3].L === A2.trim() && /^a_/.test(vend[0].id) && /^a_/.test(vend[3].id) && !vend[0].syntetisk, JSON.stringify(vend.map((v) => [v.rolle, v.modell, v.tegn, v.id.slice(0, 4)])))
  ok('(g) skive 3: den korte vendingen uten saker har en stabil syntetisk id v_<samtale8>_<n>, teksten fra transkriptet, rollen og modellen', vend[4].syntetisk === true && erSyntetiskId(vend[4].id) && vend[4].L === P3 && vend[4].rolle === 'bruker' && vend[5].syntetisk === true && vend[5].L === A3 && vend[5].modell === 'Claude' && vend[5].prompt === vend[4].id && vendingerFor(load(), CW)[4].id === vend[4].id && vend[4].id !== vend[5].id, JSON.stringify([vend[4].id, vend[5].id]))
  ok('(g) finnSamtale på økt-id og på en svar-sak gir den importerte samtalen', finnSamtale(load(), CW_ID)?.id === CW.id && finnSamtale(load(), vend[3].id)?.id === CW.id)
  const versjonFør = CW.version || 1, innholdFør = CW.content
  const h = []
  const std = standardFor(vend, 'test')
  ok('(g) standardFor på den importerte samtalen: de to lange Claude-svarene (≈ 1 000 tokens hver) får ikke begge plass i test-budsjettet — de fire nyeste vendingene (inkl. de syntetiske) er med, de to eldste utenfor', std.vendinger.length === 4 && std.vendinger.at(-1) === vend[5].id && std.utenfor.length === 2 && std.utenfor.every((u) => /budsjettet/.test(u.hvorfor)), JSON.stringify([std.vendinger.length, std.utenfor.map((u) => u.id)]))
  const r = await spor({ melding: 'Og hva med motkravet på 30 000?', saker: [], mottaker: 'test', prosjekt: CW.project, samtale: CW.id, vendinger: vend.map(({ id }) => ({ id })), på: (ev, d) => h.push([ev, d]) })
  const sk = h.find((x) => x[0] === 'skjermet')[1]
  ok('(g) spor({vendinger, samtale}) på den importerte samtalen med alle seks (to syntetiske): rollene leses av sakene og transkriptet, messages = user/assistant × 3 + user, samtale = den importerte, budsjettet sier over', sk.meldinger.map((m) => m.role).join(' ') === 'user assistant user assistant user assistant user' && sk.meldinger[4].content === P3 && sk.samtale === CW.id && r.samtale === CW.id && sk.budsjett.test.over === true && r.tekst.includes(`[Du]\n${P3}`) && r.tekst.includes(`[Modellen]\n${A3}`), JSON.stringify(sk.meldinger.map((m) => m.role)))
  const p = les(r.prompt), s = les(r.svar), CWb = les(CW.id)
  ok('(g) den nye vendingen peker på den importerte samtalen (bygget_av) og har samtalens navn — samtale-saken selv er UENDRET (importen eier den); ingen sak laget for de syntetiske vendingene', p.derivedFrom.some((d) => d.id === CW.id) && s.derivedFrom.at(-1).id === CW.id && p.convo === CW.name && (CWb.version || 1) === versjonFør && CWb.content === innholdFør && !load().some((a) => a.content === P3), JSON.stringify([p.convo, CWb.version]))
  ok('(g) vendingerFor etterpå: 8 vendinger — de seks fra transkriptet og de to nye (bruker, Test), de syntetiske med samme id som før', vendingerFor(load(), CWb).length === 8 && vendingerFor(load(), CWb).at(-1).modell === 'Test' && vendingerFor(load(), CWb)[4].id === vend[4].id)
  const u = loggLinjer().at(-1)
  ok('(g) loggen: alle seks vendingene (også de syntetiske id-ene — aldri innhold) og samtalen', u.vendinger.length === 6 && u.vendinger[4].id === vend[4].id && u.samtale === CW.id && !JSON.stringify(u).includes(P3))
  ok('(g) importen igjen: idempotent — ingen ny versjon av prompter eller samtale etter fortsettelsen (importen sier «uendret»)', (() => { const r2 = importCode({ source: 'cowork' }); const CWc = les(CW.id); return r2.stats.nye === 0 && r2.stats.oppdatert === 0 && (CWc.version || 1) === versjonFør })())
  let e = null; try { await spor({ melding: 'Hei', saker: [], mottaker: 'test', prosjekt: CW.project, vendinger: [{ id: vend[4].id }] }) } catch (x) { e = x }
  ok('(g) en syntetisk vending uten samtale i kallet → MotorFeil som sier at samtalen må med', e instanceof motor.MotorFeil && /send samtalen/.test(e.message), e?.message)
}

// ── 6b) skive 3 «Fortsett og tekst inn» (28.10.2026): en Desktop-samtale uten saker, hookens form, gjentatte kjøringer, lim inn, utdrag, finnSak, midnatt ──
const { vendingerAvTranskript, erSyntetiskId: erSynt } = sam
const { isoLokal, lokalDato, kortTittel } = await import('./samtaletekst.js')
const { lagreTekst, lagUtdrag, LIM_INN_GRENSE } = await import('./innlesing.js')
const { erGjentatt, gjentatteKandidater } = await import('./import.js')
let DESK
{
  // en Desktop-samtale slik importen lagrer den — ingen prompt-/svar-saker (alle vendingene er korte): vendingene leses ut av transkriptet
  const atoms = load()
  const D1 = 'Hva er fristen for å klage på et vedtak fra kommunen?', D2 = 'Og om jeg mistet brevet?'
  const linjer = [`# Klagefrist kommune`, '', `_Claude Desktop · 4 meldinger · 2026-10-25 · prosjekt Testprosjekt_`, '', `**Bruker:** ${D1}`, '', `**Claude:** Fristen er tre uker fra du fikk vedtaket.`, '', `**Bruker:** ${D2}`, '', `**Claude:** Da regnes fristen fra du burde ha fått det. Be om kopi.`].join('\n')
  DESK = upsert(atoms, { key: 'samtale:desk0001-aaaa-bbbb-cccc-ddddeeeeffff', kind: 'samtale', name: 'Klagefrist kommune', content: linjer, project: 'Testprosjekt', convo: 'Klagefrist kommune', source: 'Claude Desktop', by: 'regel', tags: ['samtale', 'desktop'], fanget: true, short: 'Sist: Og om jeg mistet brevet? → Da regnes fristen fra du burde ha fått det. · 2 vendinger · 25.10.2026', links: [{ kind: 'claude-chat', href: 'claude://claude.ai/chat/desk0001-aaaa-bbbb-cccc-ddddeeeeffff', label: 'Samtalen i Claude Desktop' }] }).atom
  // hookens form (## Oppgaver … ## Siste svar) — også lesbar
  const HOOK = upsert(atoms, { key: 'okt:h00k0001-1111-2222-3333-444455556666', kind: 'samtale', name: 'Rydde i testarkivet', content: ['# Rydde i testarkivet', '', '_Claude Code · 2 oppgaver · 26.10.2026, 10:00 · Testprosjekt_', '', '## Oppgaver', '- 10:00 — Rydd i testarkivet og si hva som er dobbelt.', '- 10:20 — Slå sammen de to notatene om lageret.', '', '## Siste svar', 'De to notatene er slått sammen; ett er lagt i papirkurven.'].join('\n'), project: 'Testprosjekt', convo: 'Rydde i testarkivet', source: 'Claude Code', by: 'regel', tags: ['samtale', 'code'], fanget: true, short: 'Sist: … · 2 vendinger' }).atom
  save(atoms)
  const vd = vendingerFor(load(), les(DESK.id))
  ok('skive 3: en Desktop-samtale uten saker — alle fire vendingene fra transkriptet, syntetiske id-er, Claude som modell, kilden Claude Desktop', vd.length === 4 && vd.every((v) => v.syntetisk && erSynt(v.id)) && vd.map((v) => v.rolle).join(' ') === 'bruker modell bruker modell' && vd[0].L === D1 && vd[2].L === D2 && vd[1].modell === 'Claude' && vd[1].kilde === 'Claude Desktop' && vd[3].L === 'Da regnes fristen fra du burde ha fått det. Be om kopi.', JSON.stringify(vd.map((v) => [v.id, v.rolle])))
  const vh = vendingerFor(load(), les(HOOK.id))
  ok('skive 3: hookens samtale-sak (## Oppgaver, ## Siste svar) — to brukervendinger og siste svar på den siste', vh.length === 3 && vh[0].rolle === 'bruker' && vh[0].L === 'Rydd i testarkivet og si hva som er dobbelt.' && vh[1].rolle === 'bruker' && vh[2].rolle === 'modell' && vh[2].prompt === vh[1].id && vh[2].L.startsWith('De to notatene'), JSON.stringify(vh.map((v) => [v.rolle, v.L.slice(0, 20)])))
  ok('skive 3: en Tua-samtale leser ikke transkriptet (sakene er vendingene) — vendingerAvTranskript gir null', vendingerAvTranskript(load(), les(S1.id)) === null)
  const versjonFør = les(DESK.id).version || 1
  const h = []
  const r = await spor({ melding: 'Kan jeg klage muntlig?', saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: DESK.id, vendinger: vd.map(({ id }) => ({ id })), på: (ev, d) => h.push([ev, d]) })
  const sk = h.find((x) => x[0] === 'skjermet')[1]
  ok('skive 3: «Fortsett her» på Desktop-samtalen — de fire syntetiske vendingene går som user/assistant, spørsmålet sist; mottakeren ekkoer dem', sk.meldinger.map((m) => m.role).join(' ') === 'user assistant user assistant user' && sk.meldinger[0].content === D1 && r.tekst.includes(`[Du]\n${D2}`) && r.samtale === DESK.id, JSON.stringify(sk.meldinger.map((m) => [m.role, m.content.slice(0, 20)])))
  const DESKb = les(DESK.id)
  ok('skive 3: bare det nye er lagret — prompt- og svar-sak som peker på samtalen; samtale-saken er uendret (samme versjon, samme innhold); vendingerFor gir 6 (4 fra transkriptet + 2 nye), flettet etter transkriptet', les(r.prompt).derivedFrom.some((d) => d.id === DESK.id) && les(r.svar).derivedFrom.at(-1).id === DESK.id && (DESKb.version || 1) === versjonFør && DESKb.content === DESK.content && vendingerFor(load(), DESKb).length === 6 && vendingerFor(load(), DESKb)[4].id === r.prompt && vendingerFor(load(), DESKb)[5].id === r.svar, JSON.stringify(vendingerFor(load(), DESKb).map((v) => v.id.slice(0, 2))))
  ok('skive 3: standardFor med syntetiske vendinger regner tokens av teksten (alle seks innenfor test-budsjettet)', standardFor(vendingerFor(load(), DESKb), 'test').vendinger.length === 6)
  // Desktop lagrer lange samtaler som utsnitt (de siste meldingene): en prompt-sak fra en fullere import som transkriptet ikke lenger har, er eldre historikk og står FØRST
  { const a7 = load(); upsert(a7, { key: 'prompt:desk0001:eldre001', kind: 'prompt', name: 'Et eldre spørsmål', content: 'Et eldre spørsmål fra før utsnittet i Desktop-lageret, som ikke står i transkriptet lenger.', project: 'Testprosjekt', convo: 'Klagefrist kommune', source: 'Claude Desktop', by: 'regel', tags: ['prompt'], fanget: true, short: 'Et eldre spørsmål.' }); save(a7) }
  const v7 = vendingerFor(load(), les(DESK.id))
  ok('skive 3: en importprompt transkriptet ikke finner igjen (utsnitt) står FØRST som eldre historikk, så transkriptets fire, så Tua-vendingene — 7 i alt, ingenting forsvinner', v7.length === 7 && v7[0].rolle === 'bruker' && !v7[0].syntetisk && /^Et eldre spørsmål/.test(v7[0].L) && v7.slice(1, 5).every((v) => v.syntetisk) && v7[5].id === r.prompt && v7[6].id === r.svar, JSON.stringify(v7.map((v) => [v.rolle, v.syntetisk ? 's' : v.id.slice(0, 4)])))
  // midnattsfeilen: hodelinja skrives med lokal dato, og leses som lokal — samme S uansett klokkeslett
  const kl0030 = new Date(2026, 9, 28, 0, 30).getTime()
  ok('midnatt: isoLokal gir den lokale datoen også rett etter midnatt (toISOString ville gitt dagen før i UTC+1/+2), og lokalDato leser den tilbake som lokal midnatt', isoLokal(kl0030) === '2026-10-28' && lokalDato('2026-10-28') === new Date(2026, 9, 28).getTime() && new Date(lokalDato('2026-10-28')).getDate() === 28)
  const lest = samtaleFraSak(les(S1.id).content)
  ok('midnatt: samtaleFraSak på Tua-samtalen gir samme periode i S som samtaleS skrev (lokal dato begge veier)', lest.S === les(S1.id).levels.S.text && lest.pairs[0].at > 0, JSON.stringify([lest.S.slice(-30), les(S1.id).levels.S.text.slice(-30)]))
  ok('kortTittel: kort tittel urørt; lang → første setning når den er ≤ 60, ellers 60 tegn', kortTittel('Oppgjøret med Skado') === 'Oppgjøret med Skado' && kortTittel('Gå gjennom innboksen. Lag en liste over alt som venter på svar, sortert etter hvem som sendte det.') === 'Gå gjennom innboksen.' && kortTittel('x'.repeat(100)).length === 60)
}
// gjentatte kjøringer (§7): tre Cowork-økter med samme lange tittel i samme mappe → kortet tittel, de to siste `gjentatt: true`
const DAGLIG = 'Gå gjennom innboksen og lag en liste over alt som venter på svar, sortert etter hvem som sendte det og hvor gammelt det er'
{
  const mappe = path.join(SCRATCH, 'Innboksrutine'); fs.mkdirSync(mappe, { recursive: true })
  const linje = (o) => JSON.stringify(o) + '\n'
  for (const [i, dag] of ['21', '22', '23'].entries()) {
    const id = `daaa000${i + 1}-1111-2222-3333-444455556666`
    const sess = path.join(COWORK, 'konto', 'rom', `local_${id}`); fs.mkdirSync(sess, { recursive: true })
    fs.writeFileSync(sess + '.json', JSON.stringify({ title: DAGLIG, userSelectedFolders: [mappe], createdAt: `2026-10-${dag}T07:00:00Z`, lastActivityAt: `2026-10-${dag}T07:10:00Z` }))
    fs.writeFileSync(path.join(sess, 'audit.jsonl'), [
      linje({ type: 'system', subtype: 'init', session_id: id, cwd: mappe, _audit_timestamp: `2026-10-${dag}T07:00:00Z` }),
      linje({ type: 'user', session_id: id, message: { role: 'user', content: [{ type: 'text', text: DAGLIG }] }, _audit_timestamp: `2026-10-${dag}T07:01:00Z` }),
      linje({ type: 'assistant', session_id: id, message: { role: 'assistant', content: [{ type: 'text', text: `Her er lista for ${dag}. oktober. `.repeat(60) }] }, _audit_timestamp: `2026-10-${dag}T07:05:00Z` }),
    ].join(''))
  }
  const imp = importCode({ source: 'cowork' })
  const kjøringer = load().filter((a) => a.kind === 'samtale' && /^samtale:daaa000/.test(a.key)).sort((x, y) => x.createdAt - y.createdAt)
  ok('(§7) tre Cowork-økter med samme lange tittel: tittelen er kortet etter regelen (60 tegn), alle tre er egne samtale-saker (økt-id er nøkkel)', imp.stats.nye === 3 && kjøringer.length === 3 && kjøringer.every((a) => a.name === kortTittel(DAGLIG) && a.name.length <= 60 && a.convo === a.name), JSON.stringify(kjøringer.map((a) => [a.name, a.gjentatt])))
  ok('(§7) den første er ikke gjentatt, de to neste har gjentatt: true — i fila og lest tilbake; importrapporten teller dem', kjøringer[0].gjentatt !== true && kjøringer[1].gjentatt === true && kjøringer[2].gjentatt === true && fs.readFileSync(fileOf(kjøringer[2]), 'utf8').includes('gjentatt: true') && imp.stats.gjentatt === 2, JSON.stringify(imp.stats))
  ok('(§7) erGjentatt: samme tittel, prosjekt og kilde → ja; annen kilde eller annet prosjekt → nei', erGjentatt(load(), { tittel: DAGLIG, prosjekt: 'Innboksrutine', kilde: 'Claude Cowork' }) && !erGjentatt(load(), { tittel: DAGLIG, prosjekt: 'Innboksrutine', kilde: 'Claude Code' }) && !erGjentatt(load(), { tittel: DAGLIG, prosjekt: 'Annet', kilde: 'Claude Cowork' }))
  ok('(§7) importen igjen: uendret, flagget står', (() => { const r2 = importCode({ source: 'cowork' }); return r2.stats.nye === 0 && r2.stats.oppdatert === 0 && les(kjøringer[2].id).gjentatt === true })())
  // review --gjentatt på eksisterende dubletter: to Code-samtaler lagt inn uten flagg
  const atoms = load()
  for (const n of [1, 2]) { const a = upsert(atoms, { key: `samtale:c0de000${n}-aaaa-bbbb-cccc-ddddeeeeffff`, kind: 'samtale', name: 'Ukentlig status for styret', content: `# Ukentlig status for styret\n\n_Claude Code · 1 oppgaver · 2026-10-1${n} · Testprosjekt_\n\n**Bruker:** Skriv ukentlig status for styret.\n\n**Claude:** Status uke ${n}.`, project: 'Testprosjekt', convo: 'Ukentlig status for styret', source: 'Claude Code', by: 'regel', tags: ['samtale', 'code'], fanget: true, short: `Sist: … · uke ${n}` }).atom; a.createdAt = a.capturedAt = Date.parse(`2026-10-1${n}T09:00:00`) }
  save(atoms)
  const k = gjentatteKandidater(load())
  ok('(§7) gjentatteKandidater: to grupper (Cowork-rutinen med 3, Code-statusen med 2); 1 ny å merke (Code), 2 alt merket (Cowork)', k.grupper.length === 2 && k.nye.length === 1 && k.alt.length === 2 && k.grupper[0].antall === 3, JSON.stringify(k.grupper.map((g) => [g.tittel, g.antall])))
  const dry = kjør('--gjentatt')
  ok('(§7) review --gjentatt (dry-run som standard): teller og viser, skriver ingenting', dry.status === 0 && /2 grupper med samme tittel/.test(dry.stdout) && /1 ville fått gjentatt: true \(2 alt merket\)/.test(dry.stdout) && /DRY-RUN/.test(dry.stdout) && load().filter((a) => a.gjentatt === true).length === 2, dry.stdout.split('\n')[0] + (dry.stderr ? ' | ' + dry.stderr.slice(0, 200) : ''))
  const ekte = kjør('--gjentatt', '--skriv')
  ok('(§7) review --gjentatt --skriv: den nyeste Code-statusen merkes, den første ikke; igjen = ingenting å gjøre', ekte.status === 0 && /1 samtaler merket gjentatt/.test(ekte.stdout) && load().filter((a) => a.gjentatt === true).length === 3 && load().find((a) => a.key === 'samtale:c0de0002-aaaa-bbbb-cccc-ddddeeeeffff').gjentatt === true && !load().find((a) => a.key === 'samtale:c0de0001-aaaa-bbbb-cccc-ddddeeeeffff').gjentatt && /0 ville fått/.test(kjør('--gjentatt').stdout), ekte.stdout.split('\n').at(-2))
}
// lim inn → kilde (§6) og utdrag («Bruk i samtalen»)
let LIMT, UTDRAG
{
  const lang = 'Dette er et langt avsnitt som ble limt inn i feltet. '.repeat(20)   // > 800 tegn
  const før = load().length
  LIMT = await lagreTekst({ tekst: lang, prosjekt: 'Testprosjekt', samtale: S1.name, hørerTil: a1.id })
  const l = les(LIMT.id)
  ok('(§6) lagreTekst: en sak i prosjektet — tittel «Limt inn dd.mm hh:mm — <første ord>», kilde «limt inn», kind capture, S etter regel, hører_til arbeidet, samtalen som convo', LIM_INN_GRENSE === 800 && load().length === før + 1 && /^Limt inn \d\d\.\d\d \d\d:\d\d — Dette er et langt avsnitt som/.test(l.name) && l.source === 'limt inn' && l.kind === 'capture' && l.levels?.S?.by === 'regel' && l.hørerTil === a1.id && l.convo === S1.name && l.content === lang.trim() && /^tekst:/.test(l.key), JSON.stringify([l.name, l.key]))
  const igjen = await lagreTekst({ tekst: lang, prosjekt: 'Testprosjekt' })
  ok('(§6) samme tekst limt inn igjen i samme prosjekt = samme sak (nøkkelen er tekstens sha256), ingen kopi', igjen.id === LIMT.id && load().length === før + 1)
  let e = null; try { await lagreTekst({ tekst: '   ', prosjekt: 'Testprosjekt' }) } catch (x) { e = x }
  ok('(§6) tom tekst → feil', /tekst kreves/.test(e?.message))
  const bit = 'Budsjett 45 000 kr.'
  UTDRAG = lagUtdrag({ id: a1.id, tekst: bit, samtale: S1.name })
  const ut = les(UTDRAG.id), fra = a1.content.indexOf(bit)
  ok('(§6) lagUtdrag: «Utdrag av <tittel>», kilde «utdrag», innholdet er den merkede teksten, bygget_av → saken på L med versjon, lenke {kind: utdrag, id, versjon, fra, til} som peker på avsnittet', ut.name === 'Utdrag av Møtenotat lager' && ut.source === 'utdrag' && ut.content === bit && ut.derivedFrom[0].id === a1.id && ut.derivedFrom[0].level === 'L' && ut.links[0].kind === 'utdrag' && ut.links[0].id === a1.id && ut.links[0].versjon === (a1.version || 1) && ut.links[0].fra === fra && ut.links[0].til === fra + bit.length && UTDRAG.av.fra === fra, JSON.stringify(ut.links))
  ok('(§6) lenka med fra/til står i fila og leses tilbake (normalizeLinks bevarer feltene for kind utdrag)', fs.readFileSync(fileOf(ut), 'utf8').includes(`"fra":${fra}`) && load().find((a) => a.id === ut.id).links[0].til === fra + bit.length)
  const ut2 = lagUtdrag({ id: a1.id, tekst: 'tekst som ikke står i saken', fra: 5, til: 9 })
  ok('(§6) et utdrag som ikke finnes ordrett i saken: fra/til tas fra kallet; uten begge → ingen fra/til', les(ut2.id).links[0].fra === 5 && les(ut2.id).links[0].til === 9 && !('fra' in lagUtdrag({ id: a1.id, tekst: 'finnes heller ikke' }).links[0]))
  e = null; try { lagUtdrag({ id: 'a_finnes_ikke', tekst: 'x' }) } catch (x) { e = x }
  ok('(§6) utdrag av en sak som ikke finnes → feil', /fant ikke sak/.test(e?.message))
}
// lenker som ikke finnes (§8): store.finnSak
const { finnSak, kast, slåSammen, angre } = store
{
  const atoms = load()
  ok('(§8) finnSak: en sak som finnes → funnet', finnSak(atoms, a1.id).funnet === true && finnSak(atoms, a1.id).erstattet_av.id === a1.id)
  const n = finnSak(atoms, CW_ID)
  ok('(§8) finnSak på en økt-id (nøkkelen samtale:<id>) → hvorfor «nøkkel», erstattet_av = samtale-saken', !n.funnet && n.hvorfor === 'nøkkel' && n.erstattet_av.id === les(load().find((a) => a.key === `samtale:${CW_ID}`).id).id && /Lenka pekte på nøkkelen/.test(n.tekst), JSON.stringify(n))
  ok('(§8) finnSak på S1 via den reserverte id-en (samtale:tua:<t_…>) → nøkkel', finnSak(atoms, S1.key.replace(/^samtale:tua:/, '')).hvorfor === 'nøkkel')
  const kastet = upsert(atoms, { key: 'notat:kastes', content: 'Et notat som skal i papirkurven. '.repeat(5), name: 'Notat som kastes', project: 'Testprosjekt', by: 'menneske' }).atom
  const inn = upsert(atoms, { key: 'notat:inn', content: 'Notatet alt slås sammen inn i. '.repeat(5), name: 'Samlenotat', project: 'Testprosjekt', by: 'menneske' }).atom
  const sam = upsert(atoms, { key: 'notat:sammen', content: 'Notatet som slås sammen. '.repeat(5), name: 'Notat som slås sammen', project: 'Testprosjekt', by: 'menneske' }).atom
  save(atoms)
  const a2 = load()
  kast(a2, kastet.id, { grunn: 'kastet i testen' }); save(a2)
  const k = finnSak(load(), kastet.id)
  ok('(§8) en kastet sak → hvorfor «papirkurv» med kurv-posten (Gjenopprett i appen)', !k.funnet && k.hvorfor === 'papirkurv' && k.papirkurv?.id === kastet.id && /ligger i papirkurven/.test(k.tekst), JSON.stringify(k))
  const a3 = load()
  slåSammen(a3, sam.id, inn.id); save(a3)
  const s = finnSak(load(), sam.id)
  ok('(§8) en sak slått sammen inn i en annen → hvorfor «slått sammen», erstattet_av = den andre (Åpne i appen)', !s.funnet && s.hvorfor === 'slått sammen' && s.erstattet_av.id === inn.id && s.erstattet_av.name === 'Samlenotat' && /slått sammen med «Samlenotat»/.test(s.tekst), JSON.stringify(s))
  angre(kastet.id)
  ok('(§8) etter angre finnes saken igjen', finnSak(load(), kastet.id).funnet === true)
  // bare versjoner igjen (fila slettet i Finder), og «flyttet»: saken lever videre under en annen id med samme nøkkel i et annet prosjekt
  const a4 = load()
  const v = upsert(a4, { key: 'notat:versjonert', content: 'Første versjon. '.repeat(10), name: 'Versjonert notat', project: 'Testprosjekt', by: 'menneske' }).atom
  save(a4)
  const a5 = load(); upsert(a5, { key: 'notat:versjonert', content: 'Andre versjon. '.repeat(10), name: 'Versjonert notat', project: 'Testprosjekt', by: 'menneske' }); save(a5)
  ok('(§8) oppsett: saken har en eldre versjon i .tua/versions', versions(v.id).length >= 1)
  fs.rmSync(fileOf(les(v.id)))   // slettet i Finder: mappa er sannheten
  const b = finnSak(load(), v.id)
  ok('(§8) fila slettet i Finder, bare eldre versjoner igjen → hvorfor «versjoner» med tallet', !load().some((a) => a.id === v.id) && !b.funnet && b.hvorfor === 'versjoner' && b.versjoner >= 1 && /eldre versjon/.test(b.tekst), JSON.stringify(b))
  const a6 = load(); const ny = upsert(a6, { key: 'notat:versjonert', content: 'Tredje versjon, nytt prosjekt. '.repeat(10), name: 'Versjonert notat', project: 'Skigaarden', by: 'menneske' }).atom; save(a6)
  const f = finnSak(load(), v.id)
  ok('(§8) … og når en sak med samme nøkkel lever i et annet prosjekt → hvorfor «flyttet», erstattet_av = den', !f.funnet && f.hvorfor === 'flyttet' && f.erstattet_av.id === ny.id && f.erstattet_av.project === 'Skigaarden' && /flyttet til Skigaarden/.test(f.tekst), JSON.stringify(f))
  ok('(§8) en id ingen har sett → funnet false, hvorfor null, «Fant ikke»', finnSak(load(), 'a_finnes_ikke').hvorfor === null && /Fant ikke saken/.test(finnSak(load(), 'a_finnes_ikke').tekst))
}

// ── 7) broen ────────────────────────────────────────────────────────────────
const PORT = 5298
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] kartet'); i++) await vent(100)
const get = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, json: await r.json().catch(() => null) } }
const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) } }
async function sse(body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/spor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const ut = { status: res.status, hendelser: [] }
  for (const blokk of (await res.text()).split('\n\n')) { const ev = blokk.match(/^event: (.+)$/m)?.[1], data = blokk.match(/^data: (.+)$/m)?.[1]; if (ev && data) ut.hendelser.push([ev, JSON.parse(data)]) }
  return ut
}
try {
  ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
  const ny = await post('/api/samtale/ny', { prosjekt: 'Testprosjekt' })
  ok('POST /api/samtale/ny: reservert id (t_…) og nøkkel; ingenting lagret ennå', ny.status === 200 && /^t_/.test(ny.json.id) && ny.json.key === `samtale:tua:${ny.json.id}` && !load().some((a) => a.key === ny.json.key), JSON.stringify(ny.json))
  ok('POST /api/samtale/ny uten prosjekt → 400; med ukjent arbeid → 404', (await post('/api/samtale/ny', {})).status === 400 && (await post('/api/samtale/ny', { prosjekt: 'Testprosjekt', hørerTil: 'a_finnes_ikke' })).status === 404)
  const tom = await get(`/api/samtale?id=${ny.json.id}`)
  ok('GET /api/samtale på reservert id før første spørsmål → 404 med ny: true', tom.status === 404 && tom.json.ny === true, JSON.stringify(tom.json))
  const r = await sse({ melding: `Hva mener ${PERSON} om budsjettet?`, saker: [{ id: a1.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: ny.json.id })
  const navn = r.hendelser.map((h) => h[0]), sk = r.hendelser[0][1], ferdig = r.hendelser.at(-1)[1]
  ok('POST /api/spor med samtale: t_… → SSE som før (skjermet → del… → ferdig); skjermet og ferdig har samtale (sakens a_-id), skjermet har meldinger og budsjett', navn[0] === 'skjermet' && navn.at(-1) === 'ferdig' && /^a_/.test(sk.samtale) && ferdig.samtale === sk.samtale && sk.meldinger.length === 1 && sk.budsjett.test.budsjett === 1500, `${navn.slice(0, 2).join(' ')}…${navn.at(-1)} · ${sk.samtale}`)
  const s = await get(`/api/samtale?id=${ny.json.id}`)
  ok('GET /api/samtale på reservert id etterpå → samtalen: tittel, prosjekt, kilde Tua, 2 vendinger (bruker, modell med S og L), start/sist, standard for test og testlokal', s.status === 200 && s.json.id === sk.samtale && s.json.kilde === 'Tua' && s.json.tua === true && s.json.tittel === `Hva mener ${PERSON} om budsjettet?` && s.json.prosjekt === 'Testprosjekt' && s.json.vendinger.length === 2 && s.json.vendinger[0].rolle === 'bruker' && s.json.vendinger[1].rolle === 'modell' && s.json.vendinger[1].nivå === 'M' && typeof s.json.vendinger[1].S === 'string' && s.json.vendinger[1].L.startsWith('Ekko') && s.json.start <= s.json.sist && s.json.antall === 1 && s.json.standard.test.vendinger.length === 2 && s.json.standard.test.utenfor.length === 0 && s.json.standard.testlokal && s.json.mottakere.some((m) => m.id === 'test' && m.budsjett === 1500), JSON.stringify(s.json && [s.json.tittel, s.json.vendinger.map((v) => v.rolle), Object.keys(s.json.standard)]))
  ok('GET /api/samtale på svar-saken i samtalen → samme samtale; på ukjent id → 404', (await get(`/api/samtale?id=${ferdig.svar}`)).json?.id === sk.samtale && (await get('/api/samtale?id=a_finnes_ikke')).status === 404 && (await get('/api/samtale')).status === 400)
  const f = await post('/api/spor/forhandsvis', { melding: 'Og hva koster det?', saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: sk.samtale, vendinger: s.json.standard.test.vendinger.map((id) => ({ id })) })
  ok('POST /api/spor/forhandsvis med vendinger: meldinger (3), vendinger, samtale, budsjett per mottaker — og ingen ny Utlevert-linje', f.status === 200 && f.json.meldinger.length === 3 && f.json.meldinger.map((m) => m.role).join(' ') === 'user assistant user' && f.json.vendinger.length === 2 && f.json.samtale === sk.samtale && f.json.budsjett.test.over === false, JSON.stringify(f.json && f.json.meldinger.map((m) => m.role)))
  const loggFør = loggLinjer().length
  const r2 = await sse({ melding: 'Og hva koster det?', saker: [], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: sk.samtale, vendinger: s.json.standard.test.vendinger.map((id) => ({ id })) })
  const sk2 = r2.hendelser[0][1]
  ok('POST /api/spor med vendinger: messages user/assistant/user, vendingene i skjermet; én Utlevert-linje med vendinger og samtale', sk2.meldinger.map((m) => m.role).join(' ') === 'user assistant user' && sk2.vendinger.length === 2 && loggLinjer().length === loggFør + 1 && loggLinjer().at(-1).vendinger.length === 2 && loggLinjer().at(-1).samtale === sk.samtale)
  const u = await get(`/api/utlevert?id=${r2.hendelser.at(-1)[1].prompt}`)
  ok('GET /api/utlevert?id=<prompt>: linja har vendinger og samtale (feltene går videre; deliveries finner sendingen også på prompten)', u.status === 200 && u.json.utlevert.some((e) => Array.isArray(e.vendinger) && e.vendinger.length === 2 && e.samtale === sk.samtale), JSON.stringify(u.json?.utlevert?.[0]?.vendinger))
  ok('GET /api/utlevert?id=<samtale>: sendingene i samtalen', (await get(`/api/utlevert?id=${sk.samtale}`)).json.utlevert.length === 2)
  ok('samme spørsmål («Og hva koster det?») i to samtaler = to prompt-saker — en prompt peker på én samtale, og den første samtalen mister ikke sin', load().filter((a) => a.kind === 'prompt' && a.content === 'Og hva koster det?').length === 2 && vendingerFor(load(), les(S1.id)).some((v) => v.id === r2.prompt) === false && vendingerFor(load(), les(S1.id)).some((v) => v.L === 'Og hva koster det?'), JSON.stringify(load().filter((a) => a.kind === 'prompt' && a.content === 'Og hva koster det?').map((a) => a.key)))
  const alle = await get('/api/utlevert?limit=5')
  ok('GET /api/utlevert (hele loggen): samme felter', alle.json.utlevert.some((e) => e.samtale === sk.samtale && e.vendinger?.length === 2))
  const s2 = await get(`/api/samtale?id=${sk.samtale}`)
  ok('GET /api/samtale etter oppfølgingen: 4 vendinger, antall 2, S sier «2 vendinger», versjonen gikk opp', s2.json.vendinger.length === 4 && s2.json.antall === 2 && /2 vendinger/.test(s2.json.S) && s2.json.versjon >= 2, JSON.stringify([s2.json.versjon, s2.json.S]))
  const at = await get('/api/atoms')
  const sakRad = at.json.atoms.find((a) => a.id === sk.samtale)
  ok('GET /api/atoms virker og har samtale-saken (kind samtale, kilde Tua) med klasse; tråd-feltet på prompten står som før', at.status === 200 && sakRad?.kind === 'samtale' && sakRad.source === 'Tua' && typeof sakRad.klasse === 'string' && at.json.atoms.find((a) => a.id === ferdig.prompt)?.tråd === ferdig.prompt, JSON.stringify(sakRad && [sakRad.kind, sakRad.klasse]))
  const ss = await get('/api/siden-sist')
  ok('GET /api/siden-sist virker; Tua-samtaler telles ikke som Claude-økter (nøkkelen samtale:tua: er ikke en økt)', ss.status === 200 && Array.isArray(ss.json.spørsmål) && !ss.json.økter.some((ø) => ø.sak === sk.samtale), JSON.stringify(ss.json.økter?.map((ø) => ø.name)))
  const cw = await get(`/api/samtale?id=${CW_ID}`)
  ok('GET /api/samtale på en importert Cowork-samtale (økt-id): kilde Claude Cowork, tua false, 8 vendinger (6 fra transkriptet — 2 syntetiske — og 2 fra Tua), standard regnet', cw.status === 200 && cw.json.kilde === 'Claude Cowork' && cw.json.tua === false && cw.json.vendinger.length === 8 && cw.json.vendinger.filter((v) => v.syntetisk).length === 2 && cw.json.antall === 4 && Array.isArray(cw.json.standard.test.vendinger) && cw.json.standard.test.utenfor.length >= 1, JSON.stringify(cw.json && [cw.json.kilde, cw.json.vendinger.length]))
  // skive 3: sending av syntetiske vendinger gjennom broen, lim inn, utdrag og finn
  const synt = cw.json.vendinger.filter((v) => v.syntetisk).map(({ id, rolle }) => ({ id, rolle }))
  const fv = await post('/api/spor/forhandsvis', { melding: 'Og motkravet?', saker: [], mottaker: 'test', prosjekt: cw.json.prosjekt, samtale: CW_ID, vendinger: synt })
  ok('POST /api/spor/forhandsvis med syntetiske vendinger og samtale: meldingene har transkriptets tekst', fv.status === 200 && fv.json.meldinger.length === 3 && fv.json.meldinger[0].content === 'Og renter?' && fv.json.vendinger.length === 2, JSON.stringify(fv.json?.meldinger?.map((m) => m.content.slice(0, 20))))
  const rs = await sse({ melding: 'Og motkravet?', saker: [], mottaker: 'test', prosjekt: cw.json.prosjekt, samtale: CW_ID, vendinger: synt })
  ok('POST /api/spor med syntetiske vendinger: sendt (ferdig), loggen har de syntetiske id-ene', rs.hendelser.at(-1)[0] === 'ferdig' && loggLinjer().at(-1).vendinger.length === 2 && loggLinjer().at(-1).vendinger.every((v) => /^v_/.test(v.id)), JSON.stringify(rs.hendelser.map((h) => h[0])))
  const lang = 'Tekst limt inn gjennom broen. '.repeat(40)
  const lim = await post('/api/tekst', { tekst: lang, prosjekt: 'Testprosjekt', samtale: 'Oppgjøret med Skado', hørerTil: a1.id })
  ok('POST /api/tekst: saken kommer tilbake slik /api/les gir den (id, name, project, ord, tegn, max L), grensen 800 med', lim.status === 200 && /^Limt inn /.test(lim.json.name) && lim.json.project === 'Testprosjekt' && lim.json.max === 'L' && typeof lim.json.tegn.L === 'number' && lim.json.grense === 800 && les(lim.json.id).hørerTil === a1.id, JSON.stringify(lim.json && [lim.json.name, lim.json.status]))
  ok('POST /api/tekst uten tekst → 400; med ugyldig prosjekt → 400', (await post('/api/tekst', { tekst: '', prosjekt: 'Testprosjekt' })).status === 400 && (await post('/api/tekst', { tekst: 'x', prosjekt: '.skjult' })).status === 400)
  const angreKast = await post('/api/rydd/kast', { id: lim.json.id })
  ok('angre på en innliming = papirkurven (POST /api/rydd/kast): saken er borte fra arkivet og ligger i kurven', angreKast.status === 200 && !load().some((a) => a.id === lim.json.id) && (await get(`/api/finn?id=${lim.json.id}`)).json.hvorfor === 'papirkurv')
  const ud = await post('/api/utdrag', { id: a1.id, tekst: 'Industriveien 4, 2000 Lillestrøm', samtale: S1.name })
  ok('POST /api/utdrag: «Utdrag av Møtenotat lager» med av {id, fra, til}, lenke utdrag', ud.status === 200 && ud.json.name === 'Utdrag av Møtenotat lager' && ud.json.av.id === a1.id && ud.json.av.fra === a1.content.indexOf('Industriveien 4') && ud.json.links[0].kind === 'utdrag', JSON.stringify(ud.json && [ud.json.name, ud.json.av]))
  ok('POST /api/utdrag på ukjent sak → 404; uten tekst → 400', (await post('/api/utdrag', { id: 'a_finnes_ikke', tekst: 'x' })).status === 404 && (await post('/api/utdrag', { id: a1.id, tekst: '' })).status === 400)
  const fn = await get(`/api/finn?id=${CW_ID}`)
  ok('GET /api/finn?id=<økt-id>: funnet false, hvorfor nøkkel, erstattet_av samtale-saken; på en sak som finnes: funnet; uten id → 400', fn.status === 200 && fn.json.funnet === false && fn.json.hvorfor === 'nøkkel' && fn.json.erstattet_av.id === cw.json.id && (await get(`/api/finn?id=${a1.id}`)).json.funnet === true && (await get('/api/finn')).status === 400, JSON.stringify(fn.json))
  ok('GET /api/finn på en ukjent id: funnet false, hvorfor null, «Fant ikke»', (await get('/api/finn?id=a_finnes_ikke')).json.hvorfor === null && /Fant ikke/.test((await get('/api/finn?id=a_finnes_ikke')).json.tekst))
  const sok = await get('/api/search?q=budsjettet&kind=samtale')
  ok('GET /api/search?kind=samtale finner Tua-samtalen på tittelen (klassen holder den ikke utenfor søket — den er ikke fanget)', sok.json.hits.some((h) => h.id === sk.samtale), JSON.stringify(sok.json.hits.map((h) => [h.id, h.kind, h.klasse])))
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
