#!/usr/bin/env node
// test-motor.mjs — motoren (M20a, skive 1) mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte kall til en modell.
//
//   TUA_FILES_ROOT=/tmp/tua-test/arkiv TUA_DATA_DIR=/tmp/tua-test/data node server/test-motor.mjs
//
// Sjekker: skjerming (fødselsnummer gyldig/ugyldig, e-post, telefon, org.nr bare i formatet, adresse, beløp, navn fra arkivlista,
// stoppliste), fail closed (Vault-tagg, Trust under terskel), Utlevert-linje uten originaler, prompt- og svar-sak med bygget_av,
// og SSE-rekkefølgen i broen (skjermet → del… → ferdig, og blokkert) med mottaker «test» som ekkoer.
// Skive 3: broen serverer app-fila (index.html) for rutene / /spor /oppslag /innstillinger (/kart er borte siden runde 1 av arb. 32), /api/atoms har ord/tegn/max/vault,
// og med passord satt svarer /api/* 401 med login: '/logg-inn' mens sidene omdirigeres til /logg-inn?next=… (innlogging ende til ende).
// Keychain-prefikset settes til et navn som ikke finnes, så Claude-mottakeren er aldri «klar» her — uansett hva som ligger i Keychain.
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR
if (!ROOT || !DATA || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true })

const { load, save, upsert, deliveries, fileOf } = await import('./store.js')
const { skjerm, lagSkjermer, avskjerm, gyldigFødselsnummer, kjentePersoner, minimer, sjekkTillatt, spor, mottakere, Blokkert, MotorFeil, anslåTokens, standardNivå, standardNivåer, forhåndsvis } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }

// ── testarkiv: fire saker ──────────────────────────────────────────────────
const atoms = []
const PERSON = 'Xenia Fjeldstad'                       // fornavn som IKKE står i fornavn-lista → må komme fra arkivets kjent-liste
const EPOST = 'xenia.fjeldstad@example.no'
const a1 = upsert(atoms, { content: `# Møtenotat\n\n${PERSON} (${EPOST}) foreslo å flytte lageret til Industriveien 4, 2000 Lillestrøm. Budsjett 45 000 kr. ` + 'Lang tekst. '.repeat(300), name: 'Møtenotat lager', project: 'Testprosjekt', convo: `Møte med ${PERSON}`, short: `Flytte lageret til ny adresse; ${PERSON} foreslo det.`, by: 'menneske', tags: ['lager'] }).atom
const a2 = upsert(atoms, { content: 'Hemmelig avtale: betingelsene i Vault-saken.', name: 'Vault-sak', project: 'Testprosjekt', short: 'En Vault-merket sak.', by: 'menneske', tags: ['vault'] }).atom
const a3 = upsert(atoms, { content: 'Kort sak uten personopplysninger om lagerdrift.', name: 'Kort sak', project: 'Testprosjekt', by: 'menneske' }).atom
const a4 = upsert(atoms, { content: 'Sak i et annet prosjekt, synlig på S for Testprosjekt.', name: 'Annen sak', project: 'Annet', short: 'Ingressen til annen sak.', by: 'menneske' }).atom
a4.refs = ['Testprosjekt']; a4.share = { Testprosjekt: 'S' }
save(atoms)
ok('testarkiv skrevet', fs.existsSync(path.join(ROOT, 'Testprosjekt')), ROOT)

// ── 1) skjerming ───────────────────────────────────────────────────────────
// Fødselsnummer: kontrollsifrene regnes ut av testen selv fra en base som ikke kan være en dato (99.99.99) — aldri et ekte nummer.
const V1 = [3, 7, 6, 1, 8, 9, 4, 5, 2], V2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
const k = (d, v) => { const s = d.reduce((a, x, i) => a + x * v[i], 0); const r = 11 - (s % 11); return r === 11 ? 0 : r }
let fnr = null
for (let i = 100; i < 999 && !fnr; i++) { const d = ('999999' + i).split('').map(Number); const k1 = k(d, V1); if (k1 === 10) continue; const k2 = k([...d, k1], V2); if (k2 === 10) continue; fnr = d.join('') + k1 + k2 }
const fnrUgyldig = fnr.slice(0, 10) + ((Number(fnr[10]) + 1) % 10)
ok('gyldigFødselsnummer: gyldig', gyldigFødselsnummer(fnr))
ok('gyldigFødselsnummer: ugyldig kontrollsiffer', !gyldigFødselsnummer(fnrUgyldig))
{
  const r = skjerm(`Fnr ${fnr} er gyldig, ${fnrUgyldig} er det ikke.`)
  ok('skjerm: gyldig fødselsnummer → [Fødselsnummer 1]', r.tekst.includes('[Fødselsnummer 1]') && !r.tekst.includes(fnr), r.tekst)
  ok('skjerm: ugyldig fødselsnummer slipper gjennom (ikke en opplysning)', r.tekst.includes(fnrUgyldig))
}
{
  const r = skjerm('Skriv til kari.nordmann@example.no eller ring 912 34 567, +47 22 12 34 56 eller 98765432. Ikke 20261023.')
  ok('skjerm: e-post', r.antall.epost === 1 && !r.tekst.includes('@'), r.tekst)
  ok('skjerm: telefon (tre formater)', r.antall.telefon === 3, JSON.stringify(r.antall))
  ok('skjerm: dato-liknende 8 siffer beholdes', r.tekst.includes('20261023'))
}
{
  const r = skjerm('Org.nr 923 456 789 og NO 987 654 321 MVA er organisasjonsnummer; 123456789 og 555 666 777 er bare tall.')
  ok('skjerm: org.nr bare i formatet (2 av 4 ni-sifrede)', r.antall.orgnr === 2 && r.tekst.includes('123456789') && r.tekst.includes('555 666 777'), r.tekst)
  ok('skjerm: ordet «Org.nr» står igjen, tallet er borte', /Org\.nr \[Org\.nr 1\]/.test(r.tekst) && /NO \[Org\.nr 2\] MVA/.test(r.tekst), r.tekst)
}
{
  const r = skjerm('Bor i Storgata 12, 0184 Oslo og jobber i Karl Johans gate 22. Regningen var kr 12 500,00, pluss 6 000 kr og NOK 300. Året 2024.')
  ok('skjerm: adresser', r.antall.adresse === 2 && !r.tekst.includes('Storgata'), r.tekst)
  ok('skjerm: beløp (tre former)', r.antall.beløp === 3 && r.tekst.includes('2024'), r.tekst)
}
{
  const r = skjerm('Marius Holt og Kari Nordmann møttes hos Tua Circles. Kari sa ja. Claude Code brukes av Erik Teigen.')
  ok('skjerm: navn fra fornavn-regelen, stabil plassholder for «Kari» alene', r.tekst.includes('[Person A]') && r.tekst.includes('[Person B]') && /\[Person B\] sa ja/.test(r.tekst), r.tekst)
  ok('skjerm: stoppliste — «Tua Circles» og «Claude Code» står igjen', r.tekst.includes('Tua Circles') && r.tekst.includes('Claude Code'))
  ok('skjerm: koblingen har originalene, bare hos kalleren', r.kobling['[Person B]'] === 'Kari Nordmann' && Object.keys(r.kobling).length === 3, JSON.stringify(Object.keys(r.kobling)))
  ok('avskjerm setter originalene inn igjen', avskjerm('Svar til [Person B] og [Person A].', r.kobling) === 'Svar til Kari Nordmann og Marius Holt.')
}
{
  const uten = skjerm(`${PERSON} skrev notatet.`)
  ok('skjerm uten liste: ukjent fornavn slipper gjennom', uten.antall.navn == null, uten.tekst)
  const liste = kjentePersoner(load())
  ok('kjentePersoner: bygget av arkivets titler/samtale', liste.includes(PERSON), JSON.stringify(liste))
  ok('kjentePersoner: lagret lokalt i .tua/kjente-personer.json', fs.existsSync(path.join(ROOT, '.tua', 'kjente-personer.json')))
  const med = skjerm(`${PERSON} skrev notatet; Fjeldstad signerte.`, { kjente: liste })
  ok('skjerm med liste: navnet og etternavnet alene → samme [Person A]', med.tekst === '[Person A] skrev notatet; [Person A] signerte.', med.tekst)
  const vokst = kjentePersoner([], { lær: ['Ola Testmann'] })
  ok('kjentePersoner: vokser av bruk', vokst.includes('Ola Testmann') && vokst.includes(PERSON))
}
{
  const sk = lagSkjermer([])
  const a = sk.skjerm('Kari Nordmann skrev dette.'), b = sk.skjerm('Svar til Kari Nordmann og Per Hansen.')
  ok('anslåTokens: faktor per mottaker (Claude deler norsk finere enn gemma)', anslåTokens('x'.repeat(1900), 'claude') === 1000 && anslåTokens('x'.repeat(3500), 'ollama') === 1000 && anslåTokens('x'.repeat(3500)) === 1000)
  ok('lagSkjermer: samme person → samme plassholder på tvers av melding og kontekst', a.includes('[Person A]') && b.includes('[Person A]') && b.includes('[Person B]'), b)
}

// ── 2) minimering ──────────────────────────────────────────────────────────
{
  const all = load()
  const r = minimer(all, [{ id: a1.id, nivå: 'S' }, { id: a1.id, nivå: 'L' }, { id: a4.id, nivå: 'L' }, { id: 'finnes-ikke', nivå: 'M' }], { prosjekt: 'Testprosjekt' })
  ok('minimer: S gir ingressen, L gir alt', r.kilder[0].level === 'S' && r.kilder[0].tegn < 200 && r.kilder[1].level === 'L' && r.kilder[1].tegn > 3000, JSON.stringify(r.kilder.map((x) => [x.level, x.tegn])))
  ok('minimer: nivået klampes til det prosjektet får se (V11)', r.kilder[2].level === 'S' && r.kilder[2].ønsket === 'L' && r.notater.some((n) => n.includes('ser bare S')), r.notater.join(' | '))
  ok('minimer: ukjent sak noteres, stopper ikke', r.notater.some((n) => n.includes('fant ikke')) && r.kilder.length === 3)
  ok('minimer: konteksten har tittel, versjon og nivå — ikke prosjektnavn', r.kontekst.includes('## Møtenotat lager') && r.kontekst.includes('nivå S') && !r.kontekst.includes('Testprosjekt'))
}

// ── 3) fail closed ─────────────────────────────────────────────────────────
const TEST = (await mottakere()).find((m) => m.id === 'test')
{
  const l = await mottakere()
  const std = l.filter((m) => m.standard)
  ok('mottakere: standard etter V18 — Ollama når den er aktiv, ellers Claude med nøkkel, aldri test', std.length <= 1 && !std.some((m) => m.test) && (l.find((m) => m.id === 'ollama').aktiv ? std[0]?.id === 'ollama' : std.length === 0), JSON.stringify(std.map((m) => m.id)))
}
ok('mottakere: test (trust 3), claude (ikke satt), ollama', TEST && TEST.trust.score === 3 && (await mottakere()).some((m) => m.id === 'claude' && m.nøkkel === 'ikke satt'), JSON.stringify((await mottakere()).map((m) => [m.id, m.aktiv, m.nøkkel])))
{
  const all = load()
  const vault = minimer(all, [{ id: a2.id, nivå: 'M' }]).kilder
  let e = null; try { sjekkTillatt({ ...TEST, label: 'Test' }, vault) } catch (x) { e = x }
  ok('fail closed: Vault-tagg på M → Blokkert med hva som må endres', e instanceof Blokkert && /Vault-merket/.test(e.message) && /Sett nivået til S/.test(e.message), e?.message)
  e = null; try { sjekkTillatt({ ...TEST, label: 'Test', local: true }, vault) } catch (x) { e = x }
  ok('fail closed: Vault på M til lokal modell er lov', e === null)
  const L = minimer(all, [{ id: a3.id, nivå: 'L' }]).kilder
  e = null; try { sjekkTillatt({ ...TEST, label: 'Test' }, L) } catch (x) { e = x }
  ok('fail closed: L til Trust 3 → Blokkert (krever 4)', e instanceof Blokkert && /krever minst 4/.test(e.message) && /Sett «Kort sak» til M/.test(e.message), e?.message)
  e = null; try { await spor({ melding: 'Hva står her?', saker: [{ id: a3.id, nivå: 'L' }], mottaker: 'test', prosjekt: 'Testprosjekt' }) } catch (x) { e = x }
  ok('spor: blokkeres FØR noe sendes eller lagres', e instanceof Blokkert && !load().some((a) => a.kind === 'prompt'), e?.message)
  e = null; try { await spor({ melding: 'Hei', saker: [], mottaker: 'claude' }) } catch (x) { e = x }
  ok('spor: Claude uten nøkkel er ikke klar → MotorFeil, ingen sending', e instanceof MotorFeil && /ikke klar/.test(e.message), e?.message)
}

// ── 3b) friksjon 15: standardnivået en sak får som kilde — det høyeste mottakeren får ─────────────────────────────────
{
  const all = load()
  const lokal = { id: 'ollama', label: 'Ollama', local: true, trust: { score: 5 } }, claude = { id: 'claude', label: 'Claude', trust: { score: 4 } }, lav = { id: 'x', trust: { score: 2 } }
  ok('standardNivå: lokal modell (Trust 5) → L', standardNivå(lokal, all.find((a) => a.id === a1.id)) === 'L')
  ok('standardNivå: Claude (Trust 4) → M, ikke L (V15: S+M som standard, L bare på forespørsel)', standardNivå(claude, all.find((a) => a.id === a1.id)) === 'M')
  ok('standardNivå: test (Trust 3) → M; Trust 2 → S; uten mottaker → S', standardNivå(TEST, all.find((a) => a.id === a1.id)) === 'M' && standardNivå(lav) === 'S' && standardNivå(null) === 'S')
  ok('standardNivå: Vault-merket sak → S uansett mottaker (også lokal)', standardNivå(lokal, all.find((a) => a.id === a2.id)) === 'S' && standardNivå(claude, all.find((a) => a.id === a2.id)) === 'S' && standardNivå(lokal, { vault: true }) === 'S')
  ok('standardNivå: klampes til sak.max (V11)', standardNivå(lokal, { vault: false, max: 'M' }) === 'M' && standardNivå(lokal, { vault: false, max: 'S' }) === 'S')
  const n = standardNivåer([lokal, claude], all.find((a) => a.id === a1.id))
  ok('standardNivåer: per mottaker (L/M) og laveste felles M', n.per.ollama === 'L' && n.per.claude === 'M' && n.felles === 'M', JSON.stringify(n))
  ok('mottakere(): nivå og nivåVault per rad (ollama L/S, claude M/S, test M/S)', (await mottakere()).every((m) => ['S', 'M', 'L'].includes(m.nivå) && m.nivåVault === 'S') && (await mottakere()).find((m) => m.id === 'ollama').nivå === 'L' && (await mottakere()).find((m) => m.id === 'claude').nivå === 'M' && TEST.nivå === 'M', JSON.stringify((await mottakere()).map((m) => [m.id, m.nivå, m.nivåVault])))
  // forhåndsvis: det samme som spor() ville sendt — uten å sende, lagre eller logge
  const utlevertFør = fs.existsSync(path.join(ROOT, '.tua', 'utlevering.jsonl')) ? fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8') : ''
  const antallFør = load().length
  const f = forhåndsvis({ melding: `Hva foreslo ${PERSON}?`, saker: [{ id: a1.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Testprosjekt' })
  ok('forhåndsvis: tekst skjermet (plassholdere, aldri navnet/e-posten), saker med nivå, tokens, ord, ingen blokkering', !f.blokkert && f.saker[0].level === 'M' && f.saker[0].id === a1.id && !f.tekst.includes(PERSON) && !f.tekst.includes(EPOST) && /\[Person A\]/.test(f.tekst) && f.treff > 0 && typeof f.tokens.ca === 'number' && f.tokens.per.test === f.tokens.ca && f.ord > 10 && f.mottaker === 'test', JSON.stringify({ treff: f.treff, tokens: f.tokens, saker: f.saker }))
  ok('forhåndsvis: ingenting sendt, lagret eller logget (ingen prompt-sak, Utlevert uendret)', load().length === antallFør && (fs.existsSync(path.join(ROOT, '.tua', 'utlevering.jsonl')) ? fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8') : '') === utlevertFør)
  const b = forhåndsvis({ melding: 'Hei', saker: [{ id: a3.id, nivå: 'L' }], mottaker: 'test' })
  ok('forhåndsvis: L til Trust 3 → blokkert {feil, detaljer, mottaker} i svaret (ikke kastet), teksten likevel med', b.blokkert && /krever minst 4/.test(b.blokkert.feil) && b.blokkert.mottaker === 'test' && b.blokkert.detaljer.length === 1 && b.tekst.includes('Kort sak'), b.blokkert?.feil)
  const b2 = forhåndsvis({ melding: 'Hei', saker: [{ id: a2.id, nivå: 'M' }], mottakere: ['test', 'ollama'] })
  ok('forhåndsvis med to mottakere: Vault på M stoppes hos test, meldingen sier at ingenting sendes til noen', b2.blokkert?.mottaker === 'test' && /ingenting sendes til noen/.test(b2.blokkert.feil) && b2.mottakere.length === 2 && b2.tokens.per.ollama != null)
  let e = null; try { forhåndsvis({ melding: 'Hei', saker: [], mottaker: 'finnes-ikke' }) } catch (x) { e = x }
  ok('forhåndsvis: ukjent mottaker → MotorFeil; uten mottaker → MotorFeil', e instanceof MotorFeil && (() => { try { forhåndsvis({ melding: 'x' }); return false } catch (y) { return y instanceof MotorFeil } })())
}

// ── 4) hele løpet med test-mottakeren ──────────────────────────────────────
{
  const hendelser = []
  const melding = `Oppsummer hva ${PERSON} foreslo, og hva det koster.`
  const r = await spor({ melding, saker: [{ id: a1.id, nivå: 'M' }, { id: a3.id, nivå: 'S' }], mottaker: 'test', prosjekt: 'Testprosjekt', samtale: 'Test av motoren', på: (ev, d) => hendelser.push([ev, d]) })
  const navn = hendelser.map((h) => h[0])
  ok('spor: rekkefølge skjermet → del… → ferdig', navn[0] === 'skjermet' && navn.at(-1) === 'ferdig' && navn.filter((n) => n === 'del').length >= 3, navn.join(' '))
  const sk = hendelser[0][1]
  ok('skjermet: navn, e-post, adresse og beløp er skjermet i det som sendes', sk.antall.navn >= 2 && sk.antall.epost === 1 && sk.antall.adresse === 1 && sk.antall.beløp === 1 && !sk.tekst.includes(PERSON) && !sk.tekst.includes(EPOST), JSON.stringify(sk.antall))
  ok('skjermet: tokens er et anslag («ca.»), ord telles, nivå per sak', typeof sk.tokens.ca === 'number' && sk.ord > 20 && sk.saker[0].level === 'M' && sk.saker[1].level === 'S', JSON.stringify(sk.tokens))
  const delTekst = hendelser.filter((h) => h[0] === 'del').map((h) => h[1].tekst).join('')
  ok('del: bitene er svaret med plassholdere', delTekst.includes('[Person A]') && !delTekst.includes(PERSON))
  ok('ferdig: svaret har originalene satt inn igjen, eksakt usage fra mottakeren', r.tekst.includes(PERSON) && r.tekst.includes(EPOST) && typeof r.tokens.inn === 'number' && typeof r.tokens.ut === 'number', JSON.stringify(r.tokens))
  const all = load()
  const prompt = all.find((a) => a.id === r.prompt), svar = all.find((a) => a.id === r.svar)
  ok('prompt-sak (kind: prompt, V16) lagret med originalteksten', prompt?.kind === 'prompt' && prompt.content === melding && prompt.project === 'Testprosjekt')
  ok('svar-sak (kind: svar) med bygget_av → prompten og kildene på riktig nivå', svar?.kind === 'svar' && svar.derivedFrom?.[0]?.id === prompt.id && svar.derivedFrom.some((d) => d.id === a1.id && d.level === 'M') && svar.derivedFrom.some((d) => d.id === a3.id && d.level === 'S'), JSON.stringify(svar?.derivedFrom))
  ok('svar-sak ligger som fil med kind i frontmatter', fs.readFileSync(fileOf(svar), 'utf8').includes('kind: "svar"'))
  const linjer = fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').trim().split('\n')
  const u = JSON.parse(linjer.at(-1))
  ok('Utlevert: én linje per sending — mottaker, nivå per sak, antall skjermet per type, ord, tokens', u.tool === 'spor' && u.mottaker === 'test' && u.saker.length === 2 && u.saker[0].level === 'M' && u.skjermet.navn >= 2 && typeof u.ord === 'number' && typeof u.tokens.ca === 'number' && typeof u.tokens.inn === 'number' && u.svar === svar.id && u.prompt === prompt.id, linjer.at(-1))
  ok('Utlevert: ingen originaler, ingen innhold', !linjer.at(-1).includes(PERSON) && !linjer.at(-1).includes(EPOST) && !linjer.at(-1).includes('Industriveien') && !linjer.at(-1).includes('[Person'))
  ok('deliveries(id) finner sendingen på hver av sakene', deliveries(a1.id).some((e) => e.svar === svar.id) && deliveries(a3.id).some((e) => e.svar === svar.id))
  ok('kjent-lista vokste av bruk (ingen navn i loggen)', kjentePersoner([]).includes(PERSON))
}

// ── 5) broen: SSE fra POST /api/spor, app-fila for rutene (skive 3) og søkefeltene Spør-skjermen trenger (skive 2) ─────────────────
const PORT = 5299
// Et lite «dist» i scratch står for den bygde appen: broen skal svare med index.html for alle app-rutene og sandkasse.html for /sandkasse.
const DIST = path.join(DATA, 'dist')
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title><div id="root"></div>')
fs.writeFileSync(path.join(DIST, 'sandkasse.html'), '<!doctype html><title>sandkasse-test</title>')
fs.writeFileSync(path.join(DIST, 'assets', 'app.js'), '// js-test')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''
bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] kartet'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
async function sse(body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/spor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const ut = { status: res.status, type: res.headers.get('content-type'), hendelser: [] }
  const tekst = await res.text()
  for (const blokk of tekst.split('\n\n')) { const ev = blokk.match(/^event: (.+)$/m)?.[1], data = blokk.match(/^data: (.+)$/m)?.[1]; if (ev && data) ut.hendelser.push([ev, JSON.parse(data)]) }
  return ut
}
try {
  const m = await (await fetch(`http://127.0.0.1:${PORT}/api/mottakere`)).json()
  ok('GET /api/mottakere: liste med Trust Score, nøkkel satt/ikke satt, Ollama aktiv/ikke', m.mottakere.some((x) => x.id === 'claude' && x.nøkkel === 'ikke satt' && x.trust?.score === 4) && m.mottakere.some((x) => x.id === 'ollama' && typeof x.aktiv === 'boolean' && x.local) && m.mottakere.some((x) => x.id === 'test'), JSON.stringify(m.mottakere.map((x) => [x.id, x.aktiv, x.nøkkel])))
  ok('GET /api/mottakere: aldri en nøkkelverdi', !JSON.stringify(m).includes('sk-ant'))
  ok('GET /api/mottakere: tegnPerToken per rad (Spør-skjermens anslag før sending følger motoren)', m.mottakere.every((x) => typeof x.tegnPerToken === 'number') && m.mottakere.find((x) => x.id === 'claude').tegnPerToken === 1.9, JSON.stringify(m.mottakere.map((x) => [x.id, x.tegnPerToken])))
  const r = await sse({ melding: `Hva foreslo ${PERSON}?`, saker: [{ id: a1.id, nivå: 'M' }], mottaker: 'test', prosjekt: 'Testprosjekt' })
  const navn = r.hendelser.map((h) => h[0])
  ok('POST /api/spor: text/event-stream, rekkefølge skjermet → del… → ferdig', r.status === 200 && /text\/event-stream/.test(r.type) && navn[0] === 'skjermet' && navn.at(-1) === 'ferdig' && navn.includes('del'), `${r.status} ${r.type} ${navn.slice(0, 3).join(' ')}…${navn.at(-1)}`)
  ok('SSE skjermet: antall per type, tokens ca., «se hva som sendes» uten originaler', r.hendelser[0][1].antall.navn >= 1 && typeof r.hendelser[0][1].tokens.ca === 'number' && !r.hendelser[0][1].tekst.includes(PERSON))
  ok('SSE ferdig: sak-id for svaret og eksakt usage', /^a_/.test(r.hendelser.at(-1)[1].svar) && typeof r.hendelser.at(-1)[1].tokens.inn === 'number', JSON.stringify(r.hendelser.at(-1)[1].tokens))
  const b = await sse({ melding: 'Alt om Vault-saken', saker: [{ id: a2.id, nivå: 'L' }], mottaker: 'test', prosjekt: 'Testprosjekt' })
  ok('POST /api/spor: Vault på L → event blokkert, ingen del/ferdig', b.hendelser.length === 1 && b.hendelser[0][0] === 'blokkert' && /Vault-merket/.test(b.hendelser[0][1].feil), JSON.stringify(b.hendelser.map((h) => h[0])))
  const c = await sse({ melding: 'Hei', saker: [], mottaker: 'claude', prosjekt: 'Testprosjekt' })
  ok('POST /api/spor: Claude uten nøkkel → event feil (ikke klar), ingen sending', c.hendelser.length === 1 && c.hendelser[0][0] === 'feil' && /ikke klar/.test(c.hendelser[0][1].feil), JSON.stringify(c.hendelser))
  const d = await (await fetch(`http://127.0.0.1:${PORT}/api/spor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ melding: 'x', prosjekt: 'Testprosjekt' }) })).json()
  ok('POST /api/spor uten mottaker → 400', d.error?.includes('mottaker'))
  // Skive 3: én app med ruter — broen gir index.html for hver app-rute (appen leser stien selv), sandkasse.html for /sandkasse, 404 ellers.
  const hent = async (p, init) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { redirect: 'manual', ...init }); return { status: r.status, type: r.headers.get('content-type') || '', location: r.headers.get('location'), cookie: r.headers.get('set-cookie'), tekst: await r.text() } }
  for (const rute of ['/', '/forside', '/spor', '/oppslag', '/innstillinger', '/innboks']) {
    const r = await hent(rute)
    ok(`GET ${rute} → app-fila (index.html, text/html)`, r.status === 200 && /text\/html/.test(r.type) && r.tekst.includes('app-test'), `${r.status} ${r.type}`)
  }
  ok('GET /sandkasse → sandkasse.html (demoene, egen side)', (await hent('/sandkasse')).tekst.includes('sandkasse-test'))
  ok('GET /kart → 404 (ruta er borte siden runde 1 av arbeidsstykke 32; Demo 8 bare under /sandkasse)', (await hent('/kart')).status === 404)
  ok('GET /assets/app.js → bygd fil, ikke app-fila', (await hent('/assets/app.js')).tekst.includes('js-test'))
  ok('GET /finnes-ikke → 404 (ingen stille fallback til appen for ukjente stier)', (await hent('/finnes-ikke')).status === 404)
  ok('GET /../bridge.js → ikke utenfor dist', (await hent('/%2e%2e/bridge.js')).status === 404)
  const at = await (await fetch(`http://127.0.0.1:${PORT}/api/atoms`)).json()
  const a1at = at.atoms.find((x) => x.id === a1.id), a2at = at.atoms.find((x) => x.id === a2.id)
  ok('GET /api/atoms: ord og tegn per nivå, max og vault på hver sak (det forsiden gir Spør med ⌘↵)', a1at && a1at.ord.S < a1at.ord.M && a1at.ord.M < a1at.ord.L && a1at.tegn.L > 3000 && a1at.max === 'L' && a1at.vault === false && a2at?.vault === true, JSON.stringify(a1at && { ord: a1at.ord, max: a1at.max, vault: a1at.vault }))
  // Innlogging ende til ende (skive 3): passord satt i testarkivet → /api/* gir 401 med login, sider omdirigeres med next, /api/login gir cookie.
  const PW = 'test-passord-1234', salt = crypto.randomBytes(16).toString('hex')
  const AUTH = path.join(ROOT, '.tua', 'passord.json')
  fs.writeFileSync(AUTH, JSON.stringify({ salt, hash: crypto.scryptSync(PW.normalize('NFKC'), salt, 32).toString('hex'), satt: new Date().toISOString() }))
  try {
    const u = await hent('/api/atoms')
    ok('passord satt: GET /api/atoms → 401 { error, login: "/logg-inn" } (appen sender til innlogging, feiler ikke stille)', u.status === 401 && JSON.parse(u.tekst).login === '/logg-inn', u.tekst)
    const side = await hent('/spor')
    ok('passord satt: GET /spor → 303 til /logg-inn?next=/spor', side.status === 303 && side.location === '/logg-inn?next=%2Fspor', `${side.status} ${side.location}`)
    ok('passord satt: /assets/* serveres uten innlogging (css/js er ikke hemmelig), /logg-inn viser skjemaet', (await hent('/assets/app.js')).status === 200 && (await hent('/logg-inn?next=%2Fspor')).tekst.includes('name="next" value="/spor"'))
    const inn = await hent('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passord: PW }) })
    ok('POST /api/login med riktig passord → 200 og HttpOnly-cookie', inn.status === 200 && /tua_sesjon=.*HttpOnly/.test(inn.cookie || ''), `${inn.status} ${inn.cookie}`)
    const cookie = (inn.cookie || '').split(';')[0]
    const med = await hent('/api/atoms', { headers: { Cookie: cookie } })
    ok('med cookie: GET /api/atoms → 200, GET /spor → app-fila', med.status === 200 && (await hent('/spor', { headers: { Cookie: cookie } })).tekst.includes('app-test'))
    const feilPw = await hent('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passord: 'feil' }) })
    ok('POST /api/login med feil passord → 401 uten login-felt (ingen omdirigeringssløyfe)', feilPw.status === 401 && !JSON.parse(feilPw.tekst).login, feilPw.tekst)
  } finally { fs.rmSync(AUTH, { force: true }) }
  ok('passord fjernet: GET /api/atoms → 200 igjen', (await hent('/api/atoms')).status === 200)
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/search?q=lager`)).json()
  const h = s.hits.find((x) => x.id === a1.id), hv = (await (await fetch(`http://127.0.0.1:${PORT}/api/search?q=vault`)).json()).hits.find((x) => x.id === a2.id)
  ok('GET /api/search: ord og tegn per nivå (S < M < L for den lange saken), max og kind', h && h.ord.S < h.ord.M && h.ord.M < h.ord.L && h.tegn.L > 3000 && h.max === 'L' && h.kind === 'capture', JSON.stringify(h && { ord: h.ord, tegn: h.tegn, max: h.max, kind: h.kind }))
  ok('GET /api/search: vault-flagget følger taggen (Spør-skjermen merker raden)', hv?.vault === true && h.vault === false)
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT} · tokens-anslag for denne fila: ca. ${anslåTokens(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'))}`)
process.exit(feil ? 1 : 0)
