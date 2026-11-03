#!/usr/bin/env node
// test-skjerming.mjs — arbeidsstykke 35 skive 3: se over det skjermede før første sending til en skymodell, valgene i arbeidet, forslag fra lokal modell.
// Mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall: mottakeren er test (ekko), den lokale er testlokal eller en falsk Ollama her i testen.
//
//   TUA_FILES_ROOT=/tmp/tua-test-skjerm/arkiv TUA_DATA_DIR=/tmp/tua-test-skjerm/data TUA_HOME=/tmp/tua-test-skjerm/hjem node server/test-skjerming.mjs
//
// Det viktigste her: testene ser på det mottakeren faktisk fikk (ekkoet), ikke på det som vises.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '3'
process.env.TUA_SKRIVER = 'regel'
process.env.TUA_VURDERER = 'test'
process.env.TUA_OLLAMA_VENT = '0'
process.env.TUA_UTEN_MINNE = '1'

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODEX_HOME = path.join(path.dirname(ROOT), 'codex-tom')

// en falsk Ollama: /api/tags gir én modell, /api/chat svarer med faste forslag og noterer hva den fikk
const FALSK_PORT = 5294
let falskFikk = []
const falsk = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d }); req.on('end', () => {
    if (req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'gemma3:4b', size: 1 }] })) }
    if (req.url === '/api/chat') {
      const j = JSON.parse(b); falskFikk.push(j)
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      return res.end(JSON.stringify({ message: { content: JSON.stringify({ navn: ['Yngvild Sørbråten', 'Ingen Slik Person', 'Person A'], firma: ['Bølgeberg Rørhandel'] }) }, done: true }) + '\n')
    }
    res.writeHead(404); res.end('{}')
  })
})
await new Promise((r) => falsk.listen(FALSK_PORT, '127.0.0.1', r))
process.env.TUA_OLLAMA_URL = `http://127.0.0.1:${FALSK_PORT}`

const { load, save, upsert } = await import('./store.js')
const motor = await import('./motor.js')
const { lagSkjermer, skjerm, spor, forhåndsvis, gjennomsyn, bekreftGjennomsyn, skjermForslag, GjennomsynKreves, Blokkert, lever, forskjeller, arbeidsNøkler, forhåndsvisUtfordring, utfordre } = motor
const { lesInn } = await import('./innlesing.js')
const { nySamtaleId } = await import('./samtale.js')
const R = await import('../../tua2-sandbox/src/regler.js')
const SL = await import('../../tua2-sandbox/src/slipp.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info && !cond ? ` — ${info}` : ''}`); if (!cond) feil++ }

// ── 1) reglene ──────────────────────────────────────────────────────────────
{
  const æ = skjerm('Møte med Øystein Hansen og Åse Kvam i dag.')
  ok('æøå: navn som begynner med Ø og Å fanges (\\b så dem ikke)', !æ.tekst.includes('Øystein') && !æ.tekst.includes('Åse') && æ.antall.navn === 2, æ.tekst)
  const v0 = skjerm('Kontrakt med Nordlys Konsult AS. Møte med Xenia Fjeldstad.')
  ok('uten «utvidet»: som før, firma og ukjent navn står (Claude-døra for vanlige saker er uendret)', v0.tekst.includes('Nordlys Konsult AS') && v0.tekst.includes('Xenia Fjeldstad'), v0.tekst)
  const sk = lagSkjermer([], { utvidet: true })
  const u = sk.skjerm('Kontrakt med Nordlys Konsult AS. Møte med Xenia Fjeldstad. Fjeldstad kom sent. Fra: Pål-Ove Ytrebø <pol@x.no>. Mvh Bo Ekvik. Tua Circles Holding AS eier saken.')
  ok('utvidet: firma med selskapsform → [Firma 1]', u.includes('[Firma 1]') && !u.includes('Nordlys'), u)
  ok('utvidet: navn etter «møte med», også etternavnet alene', !u.includes('Xenia') && !u.includes('Fjeldstad'), u)
  ok('utvidet: navn foran e-postadresse og etter Mvh', !u.includes('Ytrebø') && !u.includes('Ekvik') && !u.includes('pol@x.no'), u)
  ok('utvidet: Tuas eget selskap skjermes ikke', u.includes('Tua Circles Holding AS'), u)
  const f = sk.funn()
  ok('funn(): plassholder, type, original, antall', f.some((x) => x.plass === '[Firma 1]' && x.type === 'firma' && x.original === 'Nordlys Konsult AS' && x.antall === 1) && f.find((x) => x.original === 'Xenia Fjeldstad').antall === 2, JSON.stringify(f))
  const to = lagSkjermer([], { utvidet: true }).skjerm('Kontrakt med Havbris Maskin. Havbris Maskin svarte, og Havbris kom.')
  ok('et navn regelen fant ett sted, får én plassholder overalt, ikke én per ord', to === 'Kontrakt med [Person A]. [Person A] svarte, og [Person A] kom.', to)
  const lv = lagSkjermer([], { valg: { legg: [{ tekst: 'Bølgeberg Rørhandel', type: 'firma' }, { tekst: 'Zuleika Brekkestø', type: 'navn' }, { tekst: 'Prosjekt Svale', type: 'annet' }] } })
  const lt = lv.skjerm('BØLGEBERG RØRHANDEL og bølgeberg  rørhandel betalte. Zuleika Brekkestø og fru Brekkestø. Prosjekt Svale er hemmelig. Bølgeberg Rørhandelen er noe annet.')
  ok('legg til: uansett store og små bokstaver og mellomrom, samme plassholder', (lt.match(/\[Firma 1\]/g) || []).length === 2 && !/rørhandel betalte/i.test(lt), lt)
  ok('legg til: et lagt til personnavn tar også etternavnet alene', !lt.includes('Brekkestø'), lt)
  ok('legg til: type annet → [Skjermet 1]', lt.includes('[Skjermet 1] er hemmelig'), lt)
  ok('legg til: bare hele ord', lt.includes('Rørhandelen'), lt)
  const fv = lagSkjermer(['Kari Nordmann'], { valg: { fjern: ['Kari Nordmann', 'kr 500', 'kari@x.no', '01019000000', '15076500565'] } })
  const ft = fv.skjerm('Kari Nordmann og Kari fikk kr 500 på kari@x.no. Fødselsnummer 15076500565. Per Olsen er med.')
  ok('fjern: navn (også fornavnet alene), beløp og e-post sendes som det står', ft.includes('Kari Nordmann og Kari fikk kr 500 på kari@x.no') && ft.includes('[Person A]'), ft)
  ok('fjern: et fødselsnummer kan ikke fjernes', !ft.includes('15076500565') && ft.includes('[Fødselsnummer 1]'), ft)
  ok('fjern: fjernet navn læres ikke inn i kjent-lista', ![...fv.nye].includes('Kari Nordmann') && [...fv.nye].includes('Per Olsen'), [...fv.nye].join())
}

// ── testfiler ───────────────────────────────────────────────────────────────
const TEKST = 'Avtale mellom Bølgeberg Rørhandel, og også Nordlys Konsult AS.\n\nKontaktperson: Xenia Fjeldstad. Zuleika Brekkestø følger opp. Kari Nordmann signerer, kari@nordlys.no, kr 45 000.\n\nHemmeligordet er Prosjekt Svale.'
const nyFil = async (navn, tekst, prosjekt = 'Filer') => lesInn(null, { navn, data: Buffer.from(tekst), prosjekt })
const ekko = (r) => r.tekst || r.resultater?.[0]?.tekst
async function sendT({ saker, samtale, mottaker = 'test', melding = 'Hva står her?', vendinger = [], nivå = 'M' }) {
  const hend = []
  const r = await spor({ melding, saker: saker.map((id) => ({ id, nivå })), mottaker, prosjekt: 'Filer', samtale, vendinger, klient: 'test', på: (ev, d) => hend.push([ev, d]) })
  const mottatt = hend.filter(([e]) => e === 'del').map(([, d]) => d.tekst).join('')   // ekkoet før plassholderne byttes tilbake: nøyaktig det mottakeren fikk
  return { r, hend, sendt: mottatt, viste: hend.find(([e]) => e === 'skjermet')?.[1]?.tekst || '' }
}
const utløser = async (fn) => { try { await fn(); return null } catch (e) { return e } }

// ── 2) sperren ──────────────────────────────────────────────────────────────
const sak = await nyFil('avtale.txt', TEKST)
const t1 = nySamtaleId()
{
  ok('lesInn: sier per fil hva reglene fant (firma, navn, e-post, beløp)', sak.funn?.firma >= 1 && sak.funn?.navn >= 1 && sak.funn?.epost === 1 && sak.funn?.beløp === 1, JSON.stringify(sak.funn))
  const før = load().length
  const e = await utløser(() => sendT({ saker: [sak.id], samtale: t1, nivå: 'S' }))
  ok('ny fil til en ikke-lokal mottaker: stoppet, med fila og arbeidet', e instanceof GjennomsynKreves && e instanceof Blokkert && e.kreves[0].id === sak.id && e.nøkler.includes(t1), e?.message)
  ok('stoppet: ingenting lagret (ingen prompt, ingen samtale)', load().length === før, `${load().length} ≠ ${før}`)
  ok('stoppet: ingenting logget som utlevert', !fs.existsSync(path.join(ROOT, '.tua', 'utlevering.jsonl')))
  const fv = forhåndsvis({ melding: 'x', saker: [{ id: sak.id, nivå: 'S' }], mottaker: 'test', samtale: t1 })
  ok('forhåndsvis til sky: sier at fila må ses over, stopper ikke tegningen', fv.gjennomsyn.kreves.length === 1 && fv.gjennomsyn.filer[0].sett === false && !fv.blokkert, JSON.stringify(fv.gjennomsyn))
  const fl = forhåndsvis({ melding: 'x', saker: [{ id: sak.id, nivå: 'L' }], mottaker: 'testlokal', samtale: t1 })
  ok('forhåndsvis til lokal: fila er kjent, men ingenting kreves', fl.gjennomsyn.kreves.length === 0 && fl.gjennomsyn.filer.length === 1)
  const fb = forhåndsvis({ melding: 'x', saker: [{ id: sak.id, nivå: 'S' }], mottakere: ['test', 'testlokal'], samtale: t1 })
  ok('blanding av lokal og sky: kreves', fb.gjennomsyn.kreves.length === 1)
  const lokal = await sendT({ saker: [sak.id], samtale: nySamtaleId(), mottaker: 'testlokal', nivå: 'L' })
  ok('til lokal modell går det uten gjennomsyn, og reglene skjermer likevel', lokal.r.svar && lokal.sendt.includes('[Firma 1]') && !lokal.sendt.includes('Nordlys'), lokal.sendt.slice(0, 200))
  ok('forhåndsvis logger og lagrer ingenting; samme tekst som sendes', fl.tekst.includes('[Firma 1]'))
}

// ── 3) gjennomsynet styrer det som sendes ───────────────────────────────────
{
  const g0 = gjennomsyn({ saker: [sak.id], nøkler: [t1] })
  ok('gjennomsyn: teksten med plassholdere, lista med originaler, ikke sett', g0.filer[0].tekst.includes('[Firma 1]') && !g0.filer[0].tekst.includes('kari@nordlys.no') && g0.funn.some((x) => x.original === 'kari@nordlys.no' && x.type === 'epost') && g0.filer[0].sett === false, JSON.stringify(g0.funn))
  ok('gjennomsyn: det reglene ikke fanger, står åpent og synlig (Erik må kunne se det)', g0.filer[0].tekst.includes('Bølgeberg Rørhandel') && g0.filer[0].tekst.includes('Zuleika Brekkestø'))
  ok('gjennomsyn: et sett testmappe er ikke «synket»; mangler-teksten sier hva reglene ikke tar', g0.arkivSynkes === false && /Uvanlige navn/.test(g0.mangler))
  const utkast = { legg: [{ tekst: 'Bølgeberg Rørhandel', type: 'firma' }, { tekst: 'Zuleika Brekkestø', type: 'navn' }, { tekst: 'Prosjekt Svale', type: 'annet' }], fjern: ['Kari Nordmann'] }
  const g1 = gjennomsyn({ saker: [sak.id], nøkler: [t1], valg: utkast })
  ok('utkast: forhåndsviser valgene uten å lagre', g1.filer[0].tekst.includes('Kari Nordmann') && !g1.filer[0].tekst.includes('Bølgeberg') && g1.filer[0].sett === false && gjennomsyn({ saker: [sak.id], nøkler: [t1] }).valg.legg.length === 0)
  const e1 = await utløser(() => sendT({ saker: [sak.id], samtale: t1, nivå: 'S' }))
  ok('utkast: fortsatt stoppet før bekreftelsen', e1 instanceof GjennomsynKreves)
  const b = bekreftGjennomsyn({ saker: [{ id: sak.id, version: g0.filer[0].version }], nøkler: [t1], valg: utkast })
  ok('bekreft: valgene er lagret og fila merket', b.valg.legg.length === 3 && b.valg.fjern.length === 1)
  const { r, sendt, hend } = await sendT({ saker: [sak.id], samtale: t1, nivå: 'M', melding: 'Hva skylder Zuleika Brekkestø Bølgeberg Rørhandel?' })
  // Teksten er kort: M faller tilbake til L eller S. Ekkoet er fasit.
  const lang = await sendT({ saker: [sak.id], samtale: t1, mottaker: 'testlokal', nivå: 'L', melding: 'Alt.' })
  ok('sendt til sky: lagt til firma og navn er borte, også i spørsmålet', !sendt.includes('Bølgeberg') && !sendt.includes('Zuleika') && sendt.includes('Ekko fra test-mottakeren'), sendt)
  ok('sendt lokalt: valgene gjelder også der, med L', !lang.sendt.includes('Bølgeberg') && !lang.sendt.includes('Zuleika') && !lang.sendt.includes('Prosjekt Svale') && lang.sendt.includes('[Skjermet 1]'), lang.sendt)
  ok('sendt lokalt: det Erik fjernet, står som det står; det andre reglene fant er skjermet', lang.sendt.includes('Kari Nordmann') && !lang.sendt.includes('kari@nordlys.no') && !lang.sendt.includes('Xenia') && !lang.sendt.includes('Nordlys Konsult'), lang.sendt)
  const ekkoSvar = hend.find(([e]) => e === 'ferdig')?.[1]?.tekst || ''
  ok('svaret tilbake: plassholderne er byttet tilbake lokalt', ekkoSvar.includes('Bølgeberg Rørhandel') && !ekkoSvar.includes('[Firma'), ekkoSvar.slice(0, 200))
  ok('samtalen har nå en a_-id; valgene følger med fra den reserverte id-en', arbeidsNøkler(load(), { samtale: r.samtale }).includes(t1) && arbeidsNøkler(load(), { samtale: r.samtale }).includes(r.samtale), JSON.stringify(arbeidsNøkler(load(), { samtale: r.samtale })))
  const videre = await sendT({ saker: [sak.id], samtale: r.samtale, nivå: 'S', melding: 'Og Bølgeberg Rørhandel igjen?' })
  ok('valgene gjelder videre i arbeidet: neste sending med a_-id, uten nytt gjennomsyn', videre.r.svar && !videre.sendt.includes('Bølgeberg'), videre.sendt.slice(0, 200))
  const annet = await utløser(() => sendT({ saker: [sak.id], samtale: nySamtaleId(), nivå: 'S' }))
  ok('et annet arbeid: ses over på nytt (valgene er per arbeid)', annet instanceof GjennomsynKreves)
  // vendingene i samtalen er med: svaret inneholder originalen, og skjermes igjen
  const s2 = load().find((a) => a.id === r.svar)
  const medVending = await sendT({ saker: [], samtale: r.samtale, nivå: 'S', melding: 'Fortsett.', vendinger: [{ id: s2.id, rolle: 'modell' }] })
  ok('et svar med originaler sendt som vending: skjermes med valgene', !medVending.sendt.includes('Bølgeberg') && medVending.sendt.includes('[Firma'), medVending.sendt.slice(0, 300))
  const fsk = await forskjeller([{ id: r.svar, mottaker: 'test', label: 'A', tekst: 'Bølgeberg Rørhandel A' }, { id: videre.r.svar, mottaker: 'test2', label: 'B', tekst: 'Bølgeberg Rørhandel B' }], { melding: 'Spørsmål om Bølgeberg Rørhandel', prosjekt: 'Filer', på: () => {} })
  ok('Forskjeller går videre med samme valg (ingen krasj, tilgjengelig)', fsk.tilgjengelig === true, fsk.grunn)
  // ny versjon av fila
  const før = sak.version
  const atoms = load(); upsert(atoms, { key: load().find((a) => a.id === sak.id).key, kind: 'capture', content: TEKST + '\n\nNy paragraf om Yrjan Vestre.', name: 'avtale', project: 'Filer', source: 'avtale.txt', by: 'regel', tags: ['fil', 'tekst', 'se-over'] }); save(atoms)
  const ny = load().find((a) => a.id === sak.id)
  ok('testen endret fila: ny versjon', ny.version > før, `${ny.version}`)
  const e2 = await utløser(() => sendT({ saker: [sak.id], samtale: r.samtale, nivå: 'S' }))
  ok('ny versjon av fila: ses over på nytt, og gamle valg står', e2 instanceof GjennomsynKreves && gjennomsyn({ saker: [sak.id], nøkler: e2.nøkler }).valg.legg.length === 3, e2?.message)
  const g2 = gjennomsyn({ saker: [sak.id], nøkler: e2.nøkler })
  const utdatert = await utløser(async () => bekreftGjennomsyn({ saker: [{ id: sak.id, version: 1 }], nøkler: e2.nøkler, valg: g2.valg }))
  ok('bekreftelse på en gammel versjon avvises', utdatert && /endret/.test(utdatert.message), utdatert?.message)
  bekreftGjennomsyn({ saker: [{ id: sak.id, version: ny.version }], nøkler: e2.nøkler, valg: g2.valg })
  ok('etter ny bekreftelse går den', (await sendT({ saker: [sak.id], samtale: r.samtale, nivå: 'S' })).r.svar)
}

// ── 4) Vault står urørt ─────────────────────────────────────────────────────
{
  const v = await nyFil('vault.txt', 'Helsedata for Xenia Fjeldstad, lang nok tekst med flere ord.')
  const atoms = load(); const a = atoms.find((x) => x.id === v.id); a.tags = [...a.tags, 'vault']; save(atoms)
  const n = nySamtaleId()
  const e = await utløser(() => sendT({ saker: [v.id], samtale: n, nivå: 'L' }))
  ok('Vault på L til sky: samme stopp som før, ikke gjennomsyn', e instanceof Blokkert && !(e instanceof GjennomsynKreves) && /Vault/.test(e.message), e?.message)
  const e2 = await utløser(() => sendT({ saker: [v.id], samtale: n, nivå: 'S' }))
  ok('Vault på S til sky: gjennomsyn først (S var lov, og er det etter bekreftelsen)', e2 instanceof GjennomsynKreves)
  bekreftGjennomsyn({ saker: [v.id], nøkler: [n], valg: {} })
  const e3 = await utløser(() => sendT({ saker: [v.id], samtale: n, nivå: 'L' }))
  ok('Vault etter gjennomsyn: L til sky er fortsatt stoppet', e3 instanceof Blokkert && /Vault/.test(e3.message))
  ok('Vault på L til lokal: går uten gjennomsyn, som før', (await sendT({ saker: [v.id], samtale: nySamtaleId(), mottaker: 'testlokal', nivå: 'L' })).r.svar)
}

// ── 5) Utfordre og Claude-døra ──────────────────────────────────────────────
{
  const d = await nyFil('dok.txt', 'Dokumentet om Nordlys Konsult AS og Xenia Fjeldstad, med nok ord til å være en sak.')
  const fh = forhåndsvisUtfordring({ sak: d.id, sjekk: 'svakheter', mottaker: 'test' })
  ok('Utfordre: en fil som ikke er sett over, stoppes i forhåndsvisningen med arbeidet', fh.blokkert?.gjennomsyn?.kreves?.[0]?.id === d.id && fh.blokkert.gjennomsyn.nøkler.length > 0, JSON.stringify(fh.blokkert))
  const e = await utløser(() => utfordre({ sak: d.id, sjekk: 'svakheter', mottaker: 'test', klient: 'test' }))
  ok('Utfordre: sendingen stoppes også', e instanceof GjennomsynKreves)
  ok('Utfordre med lokal modell: ingen sperre', !forhåndsvisUtfordring({ sak: d.id, sjekk: 'svakheter', mottaker: 'testlokal' }).blokkert)
  bekreftGjennomsyn({ saker: [d.id], nøkler: fh.blokkert.gjennomsyn.nøkler, valg: { legg: [{ tekst: 'Dokumentet', type: 'annet' }] } })
  const fh2 = forhåndsvisUtfordring({ sak: d.id, sjekk: 'svakheter', mottaker: 'test' })
  ok('Utfordre etter gjennomsyn: valgene styrer teksten', !fh2.blokkert && !fh2.tekst.includes('Dokumentet om') && !fh2.tekst.includes('Nordlys'), fh2.tekst?.slice(-200))
  // døra
  const c = await nyFil('dor.txt', 'Innholdet i fila handler om Nordlys Konsult AS og står i hele teksten her, med nok ord.')
  const atoms = load(); const a = atoms.find((x) => x.id === c.id)
  const l1 = lever(atoms, a, { nivå: 'L', logg: false })
  ok('Claude-døra: ny fil som ikke er sett over gir S med en linje om hvorfor', l1.nivå === 'S' && /ikke er sett over/.test(l1.linje), l1.linje)
  ok('Claude-døra: de utvidede reglene gjelder i filer', !l1.tekst.includes('Nordlys') && l1.tekst.includes('[Firma'), l1.tekst)
  bekreftGjennomsyn({ saker: [c.id], nøkler: [nySamtaleId()], valg: {} })
  const l2 = lever(load(), load().find((x) => x.id === c.id), { nivå: 'L', logg: false })
  ok('Claude-døra: etter gjennomsyn får Claude L, skjermet', l2.nivå === 'L' && !l2.linje && !l2.tekst.includes('Nordlys'), l2.linje)
  const gammel = upsert(load(), { key: 'fil:gammel', kind: 'capture', content: 'Gammel fil lest inn før 03.11, med Xenia Fjeldstad i teksten og nok ord.', name: 'Gammel', project: 'Filer', source: 'x.pdf', by: 'regel', tags: ['fil', 'pdf'] }).atom
  ok('Claude-døra: en fil lest inn før dette (uten se-over) får L som før', lever(load(), gammel, { nivå: 'L', logg: false }).nivå === 'L')
  const lagtTil = lever(load(), gammel, { nivå: 'L', logg: false })
  ok('Claude-døra: det Erik har lagt til i et arbeid, skjermes der også', !lever(load(), { ...gammel, content: 'Her står Bølgeberg Rørhandel.' }, { nivå: 'L', logg: false }).tekst.includes('Bølgeberg'), lagtTil.tekst)
}

// ── 6) forslag fra lokal modell ─────────────────────────────────────────────
{
  const f = await nyFil('forslag.txt', 'Bølgeberg Rørhandel svarte ikke. Yngvild Sørbråten leverte varer. Kari Nordmann så på det.')
  const n = nySamtaleId()
  falskFikk = []
  const h = []
  const r = await skjermForslag({ sak: f.id, nøkler: [n], på: (ev, d) => h.push([ev, d]) })
  ok('falsk Ollama: forslag med modellnavn; det som ikke står i teksten er kastet', r.tilgjengelig && r.navn.join() === 'Yngvild Sørbråten' && r.firma.join() === 'Bølgeberg Rørhandel' && r.modell === 'gemma3:4b', JSON.stringify(r))
  ok('forslag: modellen fikk teksten med reglenes plassholdere, ikke det reglene alt fant', falskFikk.length === 1 && falskFikk[0].format === 'json' && !JSON.stringify(falskFikk[0].messages).includes('Kari Nordmann') && JSON.stringify(falskFikk[0].messages).includes('[Person'), JSON.stringify(falskFikk[0]?.messages)?.slice(0, 300))
  ok('forslag: hele teksten er dekket, og det sies', r.dekket.tegn === r.dekket.av && r.feilet === 0 && h.some(([e, d]) => e === 'forslag-del' && d.av === 1))
  const g = gjennomsyn({ saker: [f.id], nøkler: [n] })
  ok('forslag er IKKE skjermet før de er godkjent: de står åpent i teksten og i ekkoet', g.filer[0].tekst.includes('Yngvild Sørbråten') && g.filer[0].forslag.navn.includes('Yngvild Sørbråten') && !g.funn.some((x) => x.original === 'Yngvild Sørbråten'))
  bekreftGjennomsyn({ saker: [f.id], nøkler: [n], valg: {} })
  const utenGodkjenning = await sendT({ saker: [f.id], samtale: n, nivå: 'S' })
  const atomForslag = load().find((a) => a.id === f.id)
  ok('forslag ikke godkjent: det sendes som det står (fasit i ekkoet), altså må dialogen si det', utenGodkjenning.sendt.includes('Bølgeberg Rørhandel') || !String(atomForslag.levels?.S?.text || '').includes('Bølgeberg'), utenGodkjenning.sendt.slice(0, 300))
  const n2 = nySamtaleId()
  bekreftGjennomsyn({ saker: [f.id], nøkler: [n2], valg: { legg: [{ tekst: 'Bølgeberg Rørhandel', type: 'firma' }], avvist: ['Yngvild Sørbråten'] } })
  const godkjent = await sendT({ saker: [f.id], samtale: n2, nivå: 'L', mottaker: 'testlokal' })
  ok('godkjent forslag er skjermet; avvist forslag er ikke', !godkjent.sendt.includes('Bølgeberg') && godkjent.sendt.includes('Yngvild Sørbråten'), godkjent.sendt)
  const g2 = gjennomsyn({ saker: [f.id], nøkler: [n2] })
  ok('godkjent og avvist forslag foreslås ikke igjen', !g2.filer[0].forslag.firma.length && !g2.filer[0].forslag.navn.length, JSON.stringify(g2.filer[0].forslag))
  falskFikk = []
  const igjen = await skjermForslag({ sak: f.id, nøkler: [n] })
  ok('forslag huskes per versjon: modellen spørres ikke to ganger', igjen.lagret === true && falskFikk.length === 0)
  // lang tekst deles
  const lang = await nyFil('lang.txt', Array.from({ length: 700 }, (_, i) => `Avsnitt ${i} med vanlige ord om arbeid og mer tekst her.`).join('\n') + '\nYngvild Sørbråten til slutt.')
  falskFikk = []
  const rl = await skjermForslag({ sak: lang.id, nøkler: [n] })
  ok('lang tekst leses i deler (ikke bare starten), og navnet helt til slutt finnes', falskFikk.length > 1 && rl.navn.includes('Yngvild Sørbråten') && rl.dekket.tegn === rl.dekket.av, JSON.stringify([falskFikk.length, rl.navn, rl.dekket]))
  const forLang = await nyFil('forlang.txt', Array.from({ length: 1500 }, (_, i) => `Avsnitt ${i} med vanlige ord om arbeid og mer tekst her.`).join('\n'))
  const rfl = await skjermForslag({ sak: forLang.id, nøkler: [n] })
  ok('for lang tekst: det sies at bare deler er lest', rfl.dekket.tegn < rfl.dekket.av && /deler av/.test(R.forslagTekst({ status: 'ferdig', ...rfl })), JSON.stringify(rfl.dekket))
  process.env.TUA_FORSLAG = 'test'
  const ikkeLokal = await skjermForslag({ sak: (await nyFil('sky.txt', 'Tekst som ikke skal til en sky, med nok ord i seg.')).id, nøkler: [n] })
  ok('forslag lages bare av en lokal modell: en annen mottaker nektes', ikkeLokal.tilgjengelig === false && /lokal/.test(ikkeLokal.grunn), JSON.stringify(ikkeLokal))
  process.env.TUA_FORSLAG = 'testlokal'
  const tl = await skjermForslag({ sak: (await nyFil('tl.txt', 'Yrjan Vestre leverte teksten i dag, og det er nok ord.')).id, nøkler: [n] })
  ok('testlokal som forslagsstiller: oppdiktet navn kastes', tl.tilgjengelig && tl.navn.includes('Yrjan Vestre') && !tl.navn.includes('Oppdiktet Navnesen') && !tl.firma.length, JSON.stringify(tl))
  delete process.env.TUA_FORSLAG
  await new Promise((r) => falsk.close(r))
  const av = await skjermForslag({ sak: (await nyFil('av.txt', 'Filen leses uten Ollama, og alt annet skal virke med regler.')).id, nøkler: [n] })
  ok('Ollama av: ingen feil, tilgjengelig false, sier hva som mangler', av.tilgjengelig === false && /kjører ikke/.test(av.grunn) && /Bare reglene/.test(av.mangler), JSON.stringify(av))
  const gAv = gjennomsyn({ saker: [f.id], nøkler: [n] })
  ok('Ollama av: gjennomsynet virker med regler', gAv.funn.length > 0 && gAv.filer.length === 1)
}

// ── 7) rene regler i appen ──────────────────────────────────────────────────
{
  const fp = R.foreslåProsjekt
  ok('prosjektforslag: mappe som heter som et prosjekt', fp({ mappe: 'kontrakter', prosjekter: ['Kontrakter'], filer: [{ navn: 'a.pdf' }], står: 'Annet' }).prosjekt === 'Kontrakter')
  ok('prosjektforslag: ellers prosjektet du står i', fp({ mappe: 'Rot', prosjekter: ['A'], filer: [{ navn: 'a.pdf' }], står: 'A' }).prosjekt === 'A')
  ok('prosjektforslag: filnavn som nevner et prosjekt', fp({ prosjekter: ['Skigaarden', 'Kontrakter'], filer: [{ navn: 'skigaarden-budsjett.xlsx' }, { navn: 'skigaarden_plan.pptx' }, { navn: 'annet.pdf' }] }).prosjekt === 'Skigaarden')
  ok('prosjektforslag: ny mappe blir nytt prosjekt, merket ny, tegn vasket', (() => { const r = fp({ mappe: 'Lønn/2026: del 2', prosjekter: ['A'], filer: [{ navn: 'a.pdf' }] }); return r.ny && !/[\/:]/.test(r.prosjekt) })())
  ok('prosjektforslag: ingenting å gå på → Uten prosjekt; aldri tomt, aldri punktum først', fp({ prosjekter: [], filer: [{ navn: 'a.pdf' }] }).prosjekt === 'Uten prosjekt' && fp({ mappe: '.skjult', prosjekter: [], filer: [] }).prosjekt === 'Uten prosjekt')
  ok('står du i «Uten prosjekt», teller det ikke som et valg', fp({ mappe: 'Ny', prosjekter: [], filer: [], står: 'Uten prosjekt' }).prosjekt === 'Ny')
  ok('funnTekst: «2 navn · 1 firma · 3 e-post», ingenting sagt ærlig', R.funnTekst({ navn: 2, firma: 1, epost: 3, beløp: 0 }) === '2 navn · 1 firma · 3 e-post' && /ingenting/.test(R.funnTekst({})), R.funnTekst({ navn: 2, firma: 1, epost: 3, beløp: 0 }))
  ok('filRadTekst: leser, ferdig med funn og merknad, feil per fil', /leser/.test(R.filRadTekst({ navn: 'a', status: 'leser', tekst: 'leser «a» …' })) && /skjermes ved sending: 1 navn/.test(R.filRadTekst({ status: 'ferdig', funn: { navn: 1 } })) && /2 vedlegg/.test(R.filRadTekst({ status: 'ferdig', funn: {}, merknad: '2 vedlegg er ikke lest' })) && R.filRadTekst({ status: 'feil', feil: 'ødelagt' }).includes('ødelagt'))
  ok('filSum: «3 lest · 1 feilet» mens og etter', R.filSum([{ status: 'ferdig' }, { status: 'ferdig' }, { status: 'ferdig' }, { status: 'feil' }]) === '3 lest · 1 feilet' && R.filSum([{ status: 'leser' }, { status: 'venter' }]) === 'leser 1 av 2', R.filSum([{ status: 'leser' }, { status: 'venter' }]))
  ok('funnPerType: rekkefølgen personer først, typene på norsk', (() => { const r = R.funnPerType([{ type: 'epost', plass: '[E-post 1]' }, { type: 'navn', plass: '[Person A]' }, { type: 'firma', plass: '[Firma 1]' }]); return r[0].navn === 'Personer' && r[1].navn === 'Firma' && r[2].navn === 'E-post' })())
  ok('forslagTekst: uten Ollama står det hva som mangler; med, sier den hva modellen har lest', /Bare reglene/.test(R.forslagTekst({ status: 'mangler', mangler: 'Bare reglene har lest fila.', grunn: 'Ollama kjører ikke' })) && /gemma3:4b/.test(R.forslagTekst({ status: 'ferdig', modell: 'gemma3:4b', dekket: { tegn: 10, av: 10 } })) && /deler av/.test(R.forslagTekst({ status: 'ferdig', modell: 'g', dekket: { tegn: 10, av: 100 } })))
  // mappe-lesing med falske oppføringer
  const filE = (name) => ({ isFile: true, isDirectory: false, name, file: (ok2) => ok2({ name, size: 1 }) })
  const dirE = (name, barn) => { let lest = false; return { isFile: false, isDirectory: true, name, createReader: () => ({ readEntries: (ok2) => { const b = lest ? [] : barn; lest = true; ok2(b) } }) } }
  const dt = { items: [{ webkitGetAsEntry: () => dirE('Saken', [filE('a.pdf'), filE('.DS_Store'), dirE('under', [filE('b.eml')]), dirE('.git', [filE('c')])]) }], files: [] }
  const r = await SL.filerFraSlipp(dt)
  ok('mappe: filene rekursivt med sti, skjulte ute, mappenavnet følger med', r.mappe === 'Saken' && r.filer.map((f) => f.sti).join() === 'Saken/a.pdf,Saken/under/b.eml', JSON.stringify(r))
  const r2 = await SL.filerFraSlipp({ items: [{ webkitGetAsEntry: () => filE('a.txt') }, { webkitGetAsEntry: () => filE('b.txt') }], files: [] })
  ok('flere løse filer: ingen mappe', r2.mappe === '' && r2.filer.length === 2)
  const r3 = await SL.filerFraSlipp({ items: [], files: [{ name: 'x.txt' }] })
  ok('nettleser uten mappestøtte: faller tilbake til fillista', r3.filer.length === 1 && r3.filer[0].fil.name === 'x.txt')
  const r4 = SL.filerFraValg([{ name: 'a.pdf', webkitRelativePath: 'Mappe/a.pdf' }, { name: '.DS_Store', webkitRelativePath: 'Mappe/.DS_Store' }])
  ok('«Velg mappe»: mappenavnet fra den relative stien, skjulte ute', r4.mappe === 'Mappe' && r4.filer.length === 1, JSON.stringify(r4))
  ok('for stor fil stoppes per fil før den sendes', SL.forStor({ size: 60 * 1048576 }) && !SL.forStor({ size: 1024 }))
}

// ── 7b) ordet ───────────────────────────────────────────────────────────────
{
  const src = path.join(HERE, '..', '..', 'tua2-sandbox', 'src')
  const filer = []
  const gå = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { if (n.name === 'demos') continue; const p = path.join(d, n.name); if (n.isDirectory()) gå(p); else if (/\.(jsx?|css)$/.test(n.name)) filer.push(p) } }
  gå(src)
  const linjer = filer.flatMap((p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => /anonymis/i.test(l)).map((l) => [path.basename(p), l]))
  ok('appen sier «skjermet»: «anonymisert» står bare med forbeholdet', linjer.every(([, l]) => /ikke det samme som anonymisert|aldri «anonymisert» uten forbehold/.test(l)), JSON.stringify(linjer.map((x) => x[0])))
}

// ── 8) broen ────────────────────────────────────────────────────────────────
{
  const PORT = 5337
  const env = { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_OPEN_DRYRUN: '1', TUA_OLLAMA_URL: 'http://127.0.0.1:1' }
  const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let logg = ''; bro.stderr.on('data', (d) => { logg += d })
  const B = `http://127.0.0.1:${PORT}`
  try {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(`${B}/api/mottakere`); if (r.ok) break } catch {} await new Promise((r) => setTimeout(r, 200)) }
    const post = async (s, b) => { const r = await fetch(B + s, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => ({})) } }
    const sse = async (s, b, raw = false) => { const r = await fetch(B + s, { method: 'POST', ...(raw ? { headers: { 'Content-Type': 'application/octet-stream' }, body: b } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) }); const t = await r.text(); return [...t.matchAll(/event: (\S+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]) }
    const les = await sse(`/api/les?navn=${encodeURIComponent('bro.txt')}&prosjekt=Filer&samtale=x`, Buffer.from('Avtale med Nordlys Konsult AS og Yrjan Vestre, med nok ord i teksten.'), true)
    const ferdig = les.find(([e]) => e === 'ferdig')?.[1]
    ok('POST /api/les: ferdig-hendelsen sier hva som er funnet', ferdig?.funn?.firma === 1, JSON.stringify(ferdig?.funn))
    const feilet = await sse(`/api/les?navn=${encodeURIComponent('film.mov')}&prosjekt=Filer`, Buffer.from('x'), true)
    ok('POST /api/les: ukjent format er en feil for den fila, ikke mer', feilet.some(([e, d]) => e === 'feil' && d.kode === 'ukjent-format'), JSON.stringify(feilet))
    const t = nySamtaleId()
    const stopp = await sse('/api/spor', { melding: 'Hei', saker: [{ id: ferdig.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Filer', samtale: t })
    const bl = stopp.find(([e]) => e === 'blokkert')?.[1]
    ok('POST /api/spor: blokkert med gjennomsyn (filene og arbeidet), intet annet', bl?.gjennomsyn?.kreves?.[0]?.id === ferdig.id && bl.gjennomsyn.nøkler.includes(t) && !stopp.some(([e]) => e === 'skjermet' || e === 'del'), JSON.stringify(stopp))
    const fh = await post('/api/spor/forhandsvis', { melding: 'Hei', saker: [{ id: ferdig.id, nivå: 'S' }], mottaker: 'test', samtale: t, prosjekt: 'Filer' })
    ok('POST /api/spor/forhandsvis: gjennomsyn i svaret', fh.j.gjennomsyn?.kreves?.length === 1, JSON.stringify(fh.j.gjennomsyn))
    const g = await post('/api/skjerming/gjennomsyn', { saker: [ferdig.id], nøkler: bl.gjennomsyn.nøkler })
    ok('POST /api/skjerming/gjennomsyn: fil og funn', g.status === 200 && g.j.filer[0].tekst.includes('[Firma 1]') && g.j.funn.length >= 2, JSON.stringify(g.j).slice(0, 300))
    ok('POST /api/skjerming/gjennomsyn uten saker → 400', (await post('/api/skjerming/gjennomsyn', {})).status === 400)
    const fo = await sse('/api/skjerming/forslag', { sak: ferdig.id, nøkler: bl.gjennomsyn.nøkler })
    ok('POST /api/skjerming/forslag uten Ollama: ferdig med tilgjengelig false og hva som mangler', fo.at(-1)?.[0] === 'ferdig' && fo.at(-1)[1].tilgjengelig === false && /Bare reglene/.test(fo.at(-1)[1].mangler), JSON.stringify(fo))
    const b = await post('/api/skjerming/bekreft', { saker: [{ id: ferdig.id, version: g.j.filer[0].version }], nøkler: bl.gjennomsyn.nøkler, valg: { legg: [{ tekst: 'Avtale', type: 'annet' }], fjern: ['Yrjan Vestre'] } })
    ok('POST /api/skjerming/bekreft: valgene tilbake', b.status === 200 && b.j.valg.legg.length === 1)
    const send = await sse('/api/spor', { melding: 'Hei', saker: [{ id: ferdig.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Filer', samtale: t })
    const sendt = send.find(([e]) => e === 'skjermet')?.[1]?.tekst || ''
    const svar = send.find(([e]) => e === 'ferdig')?.[1]
    ok('POST /api/spor etter bekreftelsen: det som gikk til ekkoet følger valgene', svar?.svar && !sendt.includes('Nordlys') && sendt.includes('[Skjermet 1] med') && sendt.includes('Yrjan Vestre'), sendt.slice(-200))
    const svarSak = load().find((a) => a.id === svar?.svar)
    ok('POST /api/spor: svaret i arkivet har originalene satt inn igjen', svarSak?.content.includes('Avtale med'), svarSak?.content?.slice(0, 200))
    const utl = fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8')
    ok('Utlevert-linjene har tellinger, aldri originaler', utl.includes('"firma"') && !utl.includes('Nordlys Konsult') && !utl.includes('Yrjan'))
    ok('valgfila er ikke lesbar for andre', (fs.statSync(path.join(ROOT, '.tua', 'skjerm-valg.json')).mode & 0o077) === 0)
    const fu = await post('/api/utfordre/forhandsvis', { sak: ferdig.id, sjekk: 'svakheter', mottaker: 'test' })
    ok('POST /api/utfordre/forhandsvis: gjennomsyn i blokkert', !!fu.j.blokkert?.gjennomsyn?.kreves?.length || !fu.j.blokkert, JSON.stringify(fu.j.blokkert))
  } finally { bro.kill() }
}

console.log(feil ? `\n${feil} sjekk(er) feilet` : '\nalt grønt')
process.exit(feil ? 1 : 0)
