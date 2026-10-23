#!/usr/bin/env node
// test-forskjeller.mjs — flere mottakere samtidig, Forskjeller og konklusjon (M20b, skive 6) mot et testarkiv i scratch.
// ALDRI mot ~/Dropbox/Tua, ALDRI et ekte kall til en modell: to test-mottakere som ekkoer ulikt (TUA_TESTMOTTAKERE=2), og test-mottakeren
// som vurderer (TUA_VURDERER=test) svarer med faste, tolkbare forskjeller og en fast konklusjon.
//
//   TUA_FILES_ROOT=/tmp/tua-test-forskjeller/arkiv TUA_DATA_DIR=/tmp/tua-test-forskjeller/data node server/test-forskjeller.mjs
//
// Sjekker: to mottakere → to svar-saker med bygget_av til prompten, prompt-saken med `ga` til begge, to Utlevert-linjer uten originaler;
// tolkForskjeller på eksempel-JSON (ren, i kodeblokk, hengende komma, andre nøkler), på overskrifter med kulepunkter, og på rot (aldri kast);
// blokkert hos én mottaker stopper alle (ingen prompt, ingen svar, ingen Utlevert); forskjeller() og konklusjon() gjennom motoren med Utlevert-linjer;
// konklusjonen lagres som utkast med riktig bygget_av, rettes som ny versjon (rettKonklusjon) og låses til endelig; og i broen: SSE-rekkefølgen
// med mottaker-felt (skjermet → del/ferdig per mottaker → vurderer → forskjeller → konklusjon → slutt), blokkert med mottaker, POST /api/konklusjon
// (rettelse og kjør igjen), POST /api/status på konklusjonen.
// Tillegg (samme natt): Forskjeller lagres som egen sak (kind svar, tagg forskjeller, bygget_av → svar-sakene, nøkkel forskjeller:<prompt>,
// Utlevert-linja peker til den, konklusjonen bygger også på den), og Mistral er mottaker (api.mistral.ai, ikke klar uten nøkkel, aldri kalt her).
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '2'
process.env.TUA_VURDERER = 'test'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR
if (!ROOT || !DATA || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en tom testmappe først (aldri det ekte arkivet).'); process.exit(2) }
fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true })

const { load, save, upsert, deliveries, fileOf, statusOf, setStatus } = await import('./store.js')
const { spor, mottakere, forskjeller, konklusjon, rettKonklusjon, tolkForskjeller, svarFor, vurderer, Blokkert, MotorFeil } = await import('./motor.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const UTLEVERT = () => fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

// ── testarkiv ──────────────────────────────────────────────────────────────
const PERSON = 'Zelda Haraldstad', EPOST = 'zelda@example.no'
const atoms = []
const a1 = upsert(atoms, { content: `# Møtenotat\n\n${PERSON} (${EPOST}) foreslo å flytte lageret til Industriveien 4, 2000 Lillestrøm. Budsjett 45 000 kr. ` + 'Mer tekst. '.repeat(200), name: 'Møtenotat lager', project: 'Testprosjekt', convo: `Møte med ${PERSON}`, short: `Flytte lageret; ${PERSON} foreslo det.`, by: 'menneske', tags: ['lager'] }).atom
const a2 = upsert(atoms, { content: 'Hemmelig avtale: betingelsene i Vault-saken.', name: 'Vault-sak', project: 'Testprosjekt', short: 'En Vault-merket sak.', by: 'menneske', tags: ['vault'] }).atom
const a3 = upsert(atoms, { content: 'Kort sak uten personopplysninger om lagerdrift.', name: 'Kort sak', project: 'Testprosjekt', by: 'menneske' }).atom
save(atoms)
ok('testarkiv skrevet', fs.existsSync(path.join(ROOT, 'Testprosjekt')), ROOT)

// ── 1) mottakere og vurderer ───────────────────────────────────────────────
{
  const l = await mottakere()
  ok('mottakere: test og test2 finnes (TUA_TESTMOTTAKERE=2), begge aktive, ingen av dem standard', l.some((m) => m.id === 'test' && m.aktiv) && l.some((m) => m.id === 'test2' && m.aktiv && m.test) && !l.some((m) => m.test && m.standard), JSON.stringify(l.map((m) => [m.id, m.aktiv, m.standard])))
  ok('mottakere: Mistral er mottaker (api.mistral.ai, EU, egen nøkkel) — ikke klar under testprefikset, aldri standard', (() => { const m = l.find((x) => x.id === 'mistral'); return m && m.endpoint === 'api.mistral.ai' && m.nøkkel === 'ikke satt' && m.aktiv === false && !m.standard && m.trust?.region === 'EU' && typeof m.tegnPerToken === 'number' })(), JSON.stringify(l.find((x) => x.id === 'mistral')?.hvorfor))
  const v = await vurderer()
  ok('vurderer: TUA_VURDERER=test gir test-mottakeren som vurderer', v.m?.id === 'test', v.grunn)
}

// ── 2) tolkForskjeller ─────────────────────────────────────────────────────
{
  const svar = [{ bokstav: 'A', id: 'a_1', mottaker: 'ollama', label: 'Ollama (lokal)', modell: 'gemma3:4b' }, { bokstav: 'B', id: 'a_2', mottaker: 'claude', label: 'Claude (Anthropic)', modell: 'claude-opus-5-5' }]
  const ren = tolkForskjeller('{"enig":[{"punkt":"Begge sier lageret bør flyttes.","svar":["A","B"]}],"uenig":[{"punkt":"A sier 45 000, B sier mer.","svar":["A","B"]}],"unikt":[{"punkt":"Bare B nevner leie.","svar":["B"]}]}', svar)
  ok('tolk: ren JSON → tre lister, bokstaver → mottaker-id og svar-sak', ren.tolket === 'json' && ren.enig.length === 1 && ren.enig[0].mottakere.join() === 'ollama,claude' && ren.enig[0].saker.join() === 'a_1,a_2' && ren.unikt[0].mottakere.join() === 'claude', JSON.stringify(ren))
  const blokk = tolkForskjeller('Her er vurderingen:\n```json\n{\n "enig": [{"punkt": "Lageret flyttes", "svar": ["A", "B"]},],\n "uenig": [],\n "unikt": [{"punkt": "Leie", "svar": ["Svar B"]}],\n}\n```\nHåper det hjelper.', svar)
  ok('tolk: JSON i kodeblokk med hengende komma og «Svar B» → tolket', blokk.tolket === 'json' && blokk.enig.length === 1 && blokk.uenig.length === 0 && blokk.unikt[0].mottakere.join() === 'claude', JSON.stringify(blokk))
  const andre = tolkForskjeller('{"agree":["Begge vil flytte"],"disagree":[{"text":"Beløpet","sources":"Ollama, Claude"}],"unique":[{"point":"Leie","models":["gemma3:4b"]}]}', svar)
  ok('tolk: andre nøkkelnavn (agree/disagree/unique, text/point, sources som streng, modellnavn) → tolket', andre.tolket === 'json' && andre.enig[0].tekst === 'Begge vil flytte' && andre.uenig[0].mottakere.join() === 'ollama,claude' && andre.unikt[0].mottakere.join() === 'ollama', JSON.stringify(andre))
  const tekst = tolkForskjeller('## Enig\n- Lageret bør flyttes (A, B)\n- Budsjettet er stramt\n\n## Uenig\n1. Beløpet — svar A\n\n**Unikt**\n* Leie av lokale (B)', svar)
  ok('tolk: overskrifter med kulepunkter → tolket som tekst, «(A, B)» og «— svar A» peker ut svarene', tekst.tolket === 'tekst' && tekst.enig.length === 2 && tekst.enig[0].mottakere.join() === 'ollama,claude' && tekst.enig[1].mottakere.length === 0 && tekst.uenig[0].mottakere.join() === 'ollama' && tekst.unikt[0].tekst === 'Leie av lokale', JSON.stringify(tekst))
  const rot = tolkForskjeller('Jeg klarer ikke å sammenlikne dette. {ikke json', svar)
  ok('tolk: rot → tre tomme lister, tolket: ingen, råteksten med — aldri kast', rot.tolket === 'ingen' && rot.enig.length === 0 && rot.rå.includes('klarer ikke') && rot.merk, JSON.stringify(rot))
  ok('tolk: tomt og null → tomme lister', tolkForskjeller('', svar).tolket === 'ingen' && tolkForskjeller(null).enig.length === 0)
}

// ── 3) blokkert hos én mottaker stopper alle ───────────────────────────────
{
  let e = null
  try { await spor({ melding: 'Alt om Vault-saken', saker: [{ id: a2.id, nivå: 'M' }], mottakere: ['test', 'test2'], prosjekt: 'Testprosjekt' }) } catch (x) { e = x }
  ok('to mottakere, Vault på M: Blokkert med hvilken mottaker og «ingenting er sendt til noen»', e instanceof Blokkert && /Stoppet hos Test/.test(e.message) && /ingenting er sendt til noen/.test(e.message) && e.mottaker === 'test', e?.message)
  ok('blokkert: ingen prompt-sak, ingen svar-sak, ingen Utlevert', !load().some((a) => a.kind === 'prompt' || a.kind === 'svar') && !fs.existsSync(path.join(ROOT, '.tua', 'utlevering.jsonl')))
  e = null
  try { await spor({ melding: 'Hei', saker: [], mottakere: ['test', 'claude'] }) } catch (x) { e = x }
  ok('to mottakere, én ikke klar (Claude uten nøkkel): MotorFeil før noe sendes', e instanceof MotorFeil && /ikke klar/.test(e.message) && !load().some((a) => a.kind === 'prompt'), e?.message)
  e = null
  try { await spor({ melding: 'Hei', saker: [], mottakere: [] }) } catch (x) { e = x }
  ok('ingen mottakere → MotorFeil', e instanceof MotorFeil && /mottaker kreves/.test(e.message))
}

// ── 4) hele løpet med to mottakere ────────────────────────────────────────
let promptId, svarIds, konkId
{
  const h = []
  const melding = `Oppsummer hva ${PERSON} foreslo, og hva det koster.`
  const r = await spor({ melding, saker: [{ id: a1.id, nivå: 'M' }, { id: a3.id, nivå: 'S' }], mottakere: ['test', 'test2'], prosjekt: 'Testprosjekt', samtale: 'Test av to mottakere', på: (ev, d) => h.push([ev, d]) })
  const navn = h.map((x) => x[0])
  ok('spor: hendelser skjermet → del/ferdig per mottaker → vurderer → forskjeller → vurderer → konklusjon → slutt', navn[0] === 'skjermet' && navn.indexOf('forskjeller') > navn.lastIndexOf('ferdig') && navn.indexOf('konklusjon') > navn.indexOf('forskjeller') && navn.at(-1) === 'slutt' && navn.filter((n) => n === 'vurderer').length === 2, [...new Set(navn)].join(' '))
  const sk = h[0][1]
  ok('skjermet: én gang, med begge mottakerne og tokens per mottaker, uten originaler', sk.mottakere.join() === 'test,test2' && typeof sk.tokens.per.test === 'number' && typeof sk.tokens.per.test2 === 'number' && !sk.tekst.includes(PERSON) && sk.antall.navn >= 1, JSON.stringify({ m: sk.mottakere, t: sk.tokens }))
  const deler = h.filter((x) => x[0] === 'del')
  ok('del: hver bit har mottaker, og begge mottakerne strømmet', deler.every((x) => x[1].mottaker) && new Set(deler.map((x) => x[1].mottaker)).size === 2, `${deler.length} biter`)
  const ferdige = h.filter((x) => x[0] === 'ferdig').map((x) => x[1])
  ok('ferdig: én per mottaker, med svar-id, prompt-id og teksten med originalene', ferdige.length === 2 && new Set(ferdige.map((f) => f.mottaker)).size === 2 && ferdige.every((f) => /^a_/.test(f.svar) && f.prompt && f.tekst.includes(PERSON)), JSON.stringify(ferdige.map((f) => [f.mottaker, f.svar])))
  ok('to svar er faktisk ulike (test ekkoer, test2 svarer fra en annen vinkel)', ferdige[0].tekst !== ferdige[1].tekst && ferdige.some((f) => f.tekst.includes('EKKO B')))
  ok('retur: prompt, svar[2], mottakere[2], forskjeller, konklusjon', r.prompt && r.svar.length === 2 && r.mottakere.length === 2 && r.forskjeller && r.konklusjon, JSON.stringify(Object.keys(r)))
  promptId = r.prompt; svarIds = r.svar
  const all = load()
  const p = all.find((a) => a.id === r.prompt)
  ok('prompt-sak: kind prompt, originalteksten, `ga` med begge svarene', p?.kind === 'prompt' && p.content === melding && (p.ga || []).map((g) => g.id).sort().join() === [...r.svar].sort().join(), JSON.stringify(p?.ga))
  ok('prompt-sak: `ga` står i fila', fs.readFileSync(fileOf(p), 'utf8').includes('\nga: [') )
  const svar = r.svar.map((id) => all.find((a) => a.id === id))
  ok('to svar-saker: kind svar, bygget_av → prompten og kildene, utkast, ulik mottaker-tagg', svar.every((s) => s.kind === 'svar' && s.derivedFrom[0].id === p.id && s.derivedFrom.some((d) => d.id === a1.id && d.level === 'M') && statusOf(s) === 'utkast') && svar[0].tags[1] !== svar[1].tags[1], JSON.stringify(svar.map((s) => s.tags)))
  const u = UTLEVERT()
  const sporLinjer = u.filter((x) => x.tool === 'spor')
  ok('Utlevert: én spor-linje per mottaker, samme prompt, ulikt svar, nivå per sak', sporLinjer.length === 2 && new Set(sporLinjer.map((x) => x.mottaker)).size === 2 && sporLinjer.every((x) => x.prompt === p.id && x.saker.length === 2 && x.saker[0].level === 'M') && sporLinjer[0].svar !== sporLinjer[1].svar, JSON.stringify(sporLinjer.map((x) => [x.mottaker, x.svar])))
  ok('Utlevert: forskjeller- og konklusjon-linje med vurdereren som mottaker, svar-sakene på nivået vurdererens Trust Score tillater (test 3 → M; Ollama og Claude → L)', u.some((x) => x.tool === 'forskjeller' && x.mottaker === 'test' && x.saker.length === 2 && x.saker.every((s) => s.level === 'M')) && u.some((x) => x.tool === 'konklusjon' && x.mottaker === 'test' && x.konklusjon && x.prompt === p.id), JSON.stringify(u.map((x) => x.tool)))
  const rå = fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8')
  ok('Utlevert: aldri originaler eller innhold', !rå.includes(PERSON) && !rå.includes(EPOST) && !rå.includes('Industriveien') && !rå.includes('EKKO'))
  // forskjeller
  const f = h.find((x) => x[0] === 'forskjeller')[1]
  ok('forskjeller: tilgjengelig, tre lister, punktene peker på mottakere og svar-saker, vurdert av test', f.tilgjengelig && f.enig.length === 1 && f.uenig.length === 1 && f.unikt.length === 1 && f.enig[0].mottakere.join() === 'test,test2' && f.unikt[0].mottakere.join() === 'test2' && f.unikt[0].saker[0] === r.svar[1] && f.vurdert_av === 'test', JSON.stringify(f))
  ok('forskjeller: svar-lista med bokstav per mottaker (til kolonnene i Spør)', f.svar?.length === 2 && f.svar[0].bokstav === 'A' && f.svar[1].bokstav === 'B' && f.svar[1].mottaker === 'test2')
  // Forskjeller som egen sak (tillegg)
  const fa = all.find((a) => a.id === f.sak)
  ok('forskjeller: lagret som sak — kind svar, tagg forskjeller og vurdereren, bygget_av → begge svar-sakene på M, nøkkel forskjeller:<prompt>', fa && fa.kind === 'svar' && fa.tags.includes('forskjeller') && fa.tags.includes('test') && fa.derivedFrom.length === 2 && r.svar.every((id) => fa.derivedFrom.some((d) => d.id === id && d.level === 'M')) && fa.key === `forskjeller:${p.id}` && fa.name.startsWith('Forskjeller:'), JSON.stringify([fa?.name, fa?.tags, fa?.key]))
  ok('forskjeller-saken: lesbar markdown med Enig/Uenig/Unikt og mottakernavn, i spørsmålets prosjekt og samtale, utkast', /## Enig\n/.test(fa.content) && /## Uenig\n/.test(fa.content) && /## Unikt\n/.test(fa.content) && /\(Test 2/.test(fa.content) && fa.project === p.project && fa.convo === p.convo && statusOf(fa) === 'utkast', fa.content.slice(0, 120))
  ok('Utlevert: forskjeller-linja peker til Forskjeller-saken', u.some((x) => x.tool === 'forskjeller' && x.forskjeller === fa.id))
  // konklusjon
  const k = h.find((x) => x[0] === 'konklusjon')[1]
  konkId = k.id
  const ka = all.find((a) => a.id === k.id)
  ok('konklusjon: tilgjengelig, sak kind konklusjon med status utkast i fila', k.tilgjengelig && k.status === 'utkast' && ka?.kind === 'konklusjon' && ka.status === 'utkast' && fs.readFileSync(fileOf(ka), 'utf8').includes('status: "utkast"') && fs.readFileSync(fileOf(ka), 'utf8').includes('kind: "konklusjon"'), JSON.stringify(k))
  ok('konklusjon: bygget_av → prompten, begge svar-sakene og Forskjeller-saken (nivå M hos test-vurdereren)', ka.derivedFrom.length === 4 && ka.derivedFrom[0].id === p.id && r.svar.every((id) => ka.derivedFrom.some((d) => d.id === id && d.level === 'M')) && ka.derivedFrom.some((d) => d.id === f.sak) && k.nivå === 'M', JSON.stringify(ka.derivedFrom))
  ok('konklusjon: nøkkel konklusjon:<prompt> så «kjør igjen» gir ny versjon av samme sak', ka.key === `konklusjon:${p.id}` && ka.version === 1)
  ok('konklusjon-del strømmet teksten', h.some((x) => x[0] === 'konklusjon-del') && h.filter((x) => x[0] === 'konklusjon-del').map((x) => x[1].tekst).join('') === k.tekst)
  const slutt = h.at(-1)[1]
  ok('slutt: prompt, svar, mottakere, konklusjon-id', slutt.prompt === p.id && slutt.svar.length === 2 && slutt.konklusjon === k.id && slutt.forskjeller === true)
}

// ── 5) rett, kjør igjen, lås ───────────────────────────────────────────────
{
  const før = UTLEVERT().length
  const r1 = rettKonklusjon({ id: konkId, tekst: 'Min egen konklusjon: lageret flyttes, beløpet må sjekkes.' })
  const a = load().find((x) => x.id === konkId)
  ok('rettKonklusjon: samme sak, ny versjon, teksten byttet, status fortsatt utkast, ingen Utlevert', r1.id === konkId && r1.version === 2 && a.content.startsWith('Min egen konklusjon') && statusOf(a) === 'utkast' && UTLEVERT().length === før, JSON.stringify(r1))
  ok('rettKonklusjon: forrige versjon bevart i .tua/versions', fs.existsSync(path.join(ROOT, '.tua', 'versions', konkId)))
  let e = null; try { rettKonklusjon({ id: promptId, tekst: 'x' }) } catch (x) { e = x }
  ok('rettKonklusjon: ikke en konklusjon → MotorFeil', e instanceof MotorFeil && /ikke en konklusjon/.test(e.message))
  const svar = svarFor(load(), promptId)
  ok('svarFor: finner svar-sakene fra prompt-sakens `ga` med mottaker fra taggen', svar.length === 2 && svar.map((s) => s.mottaker).sort().join() === 'test,test2' && svar.every((s) => s.tekst), JSON.stringify(svar.map((s) => [s.id, s.mottaker])))
  const f = await forskjeller(svar, { melding: 'Hva ble foreslått?', prosjekt: 'Testprosjekt' })
  const k = await konklusjon({ prompt: promptId, svar, forskjeller: f })
  const a2k = load().find((x) => x.id === konkId)
  ok('kjør igjen: Forskjeller-saken er samme sak i ny versjon (nøkkelen), event har sak', f.sak && load().find((x) => x.id === f.sak)?.version === 2 && load().filter((x) => (x.tags || []).includes('forskjeller')).length === 1, JSON.stringify([f.sak, load().find((x) => x.id === f.sak)?.version]))
  ok('kjør igjen: forskjeller() og konklusjon() direkte → samme konklusjon-sak, versjon 3, utkast igjen, to nye Utlevert-linjer', f.tilgjengelig && k.id === konkId && k.version === 3 && a2k.version === 3 && statusOf(a2k) === 'utkast' && UTLEVERT().length === før + 2, JSON.stringify([k.id, k.version]))
  const én = await forskjeller([svar[0]])
  ok('forskjeller med ett svar → ikke tilgjengelig med grunn (V21: bare når mer enn én har svart)', !én.tilgjengelig && /mer enn én/.test(én.grunn))
  // vurderer ikke tilgjengelig
  process.env.TUA_VURDERER = 'finnes-ikke'
  const ingen = await forskjeller(svar)
  ok('ingen vurderer → ikke tilgjengelig med grunn, svarene står', !ingen.tilgjengelig && /Ingen modell kan vurdere/.test(ingen.grunn), ingen.grunn)
  process.env.TUA_VURDERER = 'test'
  // Vault-arv: et svar bygget på en Vault-sak er selv Vault-merket; en ekstern vurderer (claude, trust 4, ikke lokal) stoppes på L — fail closed
  const r = await spor({ melding: 'Hva står i Vault-saken?', saker: [{ id: a2.id, nivå: 'S' }], mottakere: ['test', 'test2'], prosjekt: 'Testprosjekt' })
  const vs = load().filter((x) => r.svar.includes(x.id))
  ok('Vault-arv: svar bygget på en Vault-sak får vault-taggen', vs.length === 2 && vs.every((x) => x.tags.includes('vault')), JSON.stringify(vs.map((x) => x.tags)))
  ok('Vault-arv: ekstern vurderer (test, ikke lokal) stoppes — forskjeller ikke tilgjengelig med grunn, ingen sending', r.forskjeller && !r.forskjeller.tilgjengelig && /Vault-merket/.test(r.forskjeller.grunn) && !r.konklusjon.tilgjengelig, r.forskjeller?.grunn)
  // lås
  const atoms = load(); const ka = atoms.find((x) => x.id === konkId); setStatus(ka, 'endelig'); save(atoms)
  const låst = load().find((x) => x.id === konkId)
  ok('lås: status endelig i fila, bygget_av urørt', låst.status === 'endelig' && fs.readFileSync(fileOf(låst), 'utf8').includes('status: "endelig"') && låst.derivedFrom.length === 4)
}

// ── 6) broen ───────────────────────────────────────────────────────────────
const PORT = 5298
const DIST = path.join(DATA, 'dist'); fs.mkdirSync(DIST, { recursive: true }); fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>app-test</title>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''; bro.stderr.on('data', (d) => { broLogg += d })
const vent = async (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 50 && !broLogg.includes('[tua-bro] appen'); i++) await vent(100)
ok('broen startet mot testarkivet', broLogg.includes(ROOT), broLogg.split('\n')[0])
const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
async function sse(body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/spor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const ut = { status: res.status, hendelser: [] }
  for (const blokk of (await res.text()).split('\n\n')) { const ev = blokk.match(/^event: (.+)$/m)?.[1], data = blokk.match(/^data: (.+)$/m)?.[1]; if (ev && data) ut.hendelser.push([ev, JSON.parse(data)]) }
  return ut
}
try {
  const m = await (await fetch(`http://127.0.0.1:${PORT}/api/mottakere`)).json()
  ok('GET /api/mottakere: mistral med, ikke klar, aldri en nøkkelverdi', m.mottakere.some((x) => x.id === 'mistral' && x.aktiv === false && x.nøkkel === 'ikke satt') && !/Bearer|sk-/.test(JSON.stringify(m)))
  ok('GET /api/mottakere: test2 med i lista når TUA_TESTMOTTAKERE=2', m.mottakere.some((x) => x.id === 'test2' && x.aktiv))
  const r = await sse({ melding: `Hva foreslo ${PERSON}?`, saker: [{ id: a1.id, nivå: 'M' }], mottakere: ['test', 'test2'], prosjekt: 'Testprosjekt' })
  const navn = r.hendelser.map((h) => h[0])
  ok('POST /api/spor med mottakere[]: skjermet → del/ferdig med mottaker → vurderer → forskjeller → konklusjon → slutt', r.status === 200 && navn[0] === 'skjermet' && navn.includes('forskjeller') && navn.includes('konklusjon') && navn.at(-1) === 'slutt', [...new Set(navn)].join(' '))
  const ferdige = r.hendelser.filter((h) => h[0] === 'ferdig').map((h) => h[1])
  ok('SSE ferdig: to, med mottaker-felt og hver sin svar-id', ferdige.length === 2 && ferdige.map((f) => f.mottaker).sort().join() === 'test,test2' && ferdige[0].svar !== ferdige[1].svar)
  ok('SSE del: alle med mottaker-felt', r.hendelser.filter((h) => h[0] === 'del').every((h) => h[1].mottaker))
  const f = r.hendelser.find((h) => h[0] === 'forskjeller')[1], k = r.hendelser.find((h) => h[0] === 'konklusjon')[1]
  ok('SSE forskjeller: sak-id til Forskjeller-saken (lenken i Spør)', /^a_/.test(f.sak))
  ok('SSE forskjeller: tre lister; konklusjon: id og utkast', f.tilgjengelig && f.enig.length && f.uenig.length && f.unikt.length && k.tilgjengelig && /^a_/.test(k.id) && k.status === 'utkast', JSON.stringify([f.enig.length, k.id]))
  const enkel = await sse({ melding: 'Hei', saker: [], mottaker: 'test' })
  const en = enkel.hendelser.map((h) => h[0])
  ok('POST /api/spor med én mottaker (som før): ingen forskjeller/konklusjon, ferdig har mottaker', en.at(-1) === 'ferdig' && !en.includes('forskjeller') && enkel.hendelser.at(-1)[1].mottaker === 'test', en.join(' '))
  const b = await sse({ melding: 'Alt om Vault-saken', saker: [{ id: a2.id, nivå: 'L' }], mottakere: ['test2', 'test'] })
  ok('POST /api/spor: Vault på L til to → ett event blokkert med mottaker, ingen del/ferdig', b.hendelser.length === 1 && b.hendelser[0][0] === 'blokkert' && b.hendelser[0][1].mottaker === 'test2' && /Stoppet hos Test 2/.test(b.hendelser[0][1].feil), JSON.stringify(b.hendelser.map((h) => [h[0], h[1].mottaker])))
  const d = await post('/api/spor', { melding: 'x', mottakere: [] })
  ok('POST /api/spor uten mottakere → 400', d.status === 400 && /mottaker/.test(d.json.error))
  // konklusjon-døra
  const rett = await post('/api/konklusjon', { id: k.id, tekst: 'Rettet i broen.' })
  ok('POST /api/konklusjon {id, tekst}: ny versjon, status utkast', rett.status === 200 && rett.json.konklusjon.version === 2 && rett.json.konklusjon.tekst === 'Rettet i broen.' && rett.json.konklusjon.status === 'utkast', JSON.stringify(rett.json))
  const igjen = await post('/api/konklusjon', { prompt: ferdige[0].prompt })
  ok('POST /api/konklusjon {prompt}: kjør igjen → forskjeller + nytt utkast, samme sak, versjon 3', igjen.status === 200 && igjen.json.forskjeller.tilgjengelig && igjen.json.konklusjon.id === k.id && igjen.json.konklusjon.version === 3, JSON.stringify([igjen.status, igjen.json.konklusjon?.version, igjen.json.error]))
  ok('POST /api/konklusjon uten noe → 400, ukjent prompt → 404', (await post('/api/konklusjon', {})).status === 400 && (await post('/api/konklusjon', { prompt: 'a_finnes_ikke' })).status === 404)
  const lås = await post('/api/status', { id: k.id, status: 'endelig' })
  ok('POST /api/status på konklusjonen: utkast → endelig, bygget_av med prompt, begge svar og Forskjeller-saken', lås.status === 200 && lås.json.atom.status === 'endelig' && lås.json.før === 'utkast' && lås.json.atom.derivedFrom.length === 4 && lås.json.atom.kind === 'konklusjon', JSON.stringify(lås.json.atom?.derivedFrom))
  const at = await (await fetch(`http://127.0.0.1:${PORT}/api/atoms`)).json()
  const pa = at.atoms.find((x) => x.id === ferdige[0].prompt)
  ok('GET /api/atoms: prompt-saken har `ga` med begge svarene, konklusjonen har status', pa?.ga?.length === 2 && at.atoms.find((x) => x.id === k.id)?.status === 'endelig', JSON.stringify(pa?.ga))
  const ut = await (await fetch(`http://127.0.0.1:${PORT}/api/utlevert`)).json()
  ok('GET /api/utlevert: forskjeller- og konklusjon-linjer med saknavn, aldri innhold (saknavn kan bære navnet fra spørsmålet — det er tittelen, ikke innholdet)', ut.utlevert.some((x) => x.tool === 'forskjeller' && x.saker.every((s) => s.name)) && ut.utlevert.some((x) => x.tool === 'konklusjon') && !JSON.stringify(ut).includes(EPOST) && !JSON.stringify(ut).includes('Industriveien') && !JSON.stringify(ut).includes('EKKO'), JSON.stringify(ut.utlevert.map((x) => x.tool)))
} finally { bro.kill() }

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
process.exit(feil ? 1 : 0)
