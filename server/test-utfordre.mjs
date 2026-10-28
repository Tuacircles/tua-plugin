#!/usr/bin/env node
// test-utfordre.mjs — skive C «Utfordre» (arbeidsstykke 34 §5 C1–C6, V23) mot et testarkiv i scratch. ALDRI mot ~/Dropbox/Tua, ALDRI et ekte modellkall:
// test-mottakerne ekkoer (TUA_TESTMOTTAKERE=3: test, test2 og testlokal), og «test» svarer på utfordringer med tre faste, tolkbare innvendinger.
//
//   TUA_FILES_ROOT=/tmp/tua-test-utfordre/arkiv TUA_DATA_DIR=/tmp/tua-test-utfordre/data TUA_HOME=/tmp/tua-test-utfordre/hjem node server/test-utfordre.mjs
//
// Sjekker: tolkInnvendinger (nummerert, i én linje, fete etiketter, kulepunkter, «Ingen innvending», rot); grunnlaget (bare resultatet og kildene — aldri
// transkriptet eller arbeidsstegene; kildene fra bygget_av og dokumentene samtalen skrev; nivå etter Trust Score; Vault bare lokalt; budsjettet: kildene ned
// L → M → S, så færre, så kuttes svaret — og det sies); utfordre() gjennom motoren (prompt-sak med `ga`, utfordringen som sak med `utfordrer` og innvendinger,
// Utlevert-linje uten originaler, feltene overlever lagring på disk); godta/avvis, ny versjon (bare med godtatte), lås (konklusjon, endelig) og «Utfordret av …»;
// en fanget samtale (resultatet er en vending fra transkriptet); broen (GET /api/utfordringer, forhandsvis, SSE-rekkefølgen, innvending, ny-versjon, lås,
// `utfordret` i /api/atoms og /api/samtale, `dokumenter` i /api/samtale, blokkert for Vault); og Claude-døra (tua_get og tua_search nevner «Utfordret av …»).
process.env.TUA_KEYCHAIN_PREFIX = 'tua-test-finnes-ikke'
process.env.TUA_BRIDGE_VAKTER = '0'
process.env.TUA_TESTMOTTAKERE = '3'
process.env.TUA_UTEN_MINNE = '1'

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.TUA_FILES_ROOT, DATA = process.env.TUA_DATA_DIR, HJEM = process.env.TUA_HOME
if (!ROOT || !DATA || !HJEM || ROOT.includes('Dropbox') || ROOT.includes('iCloud')) { console.error('Sett TUA_FILES_ROOT, TUA_DATA_DIR og TUA_HOME til tomme testmapper først (aldri det ekte arkivet).'); process.exit(2) }
for (const d of [ROOT, DATA, HJEM]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
process.env.TUA_CODEX_HOME = path.join(path.dirname(ROOT), 'codex-tom')

const { load, save, upsert } = await import('./store.js')
const motor = await import('./motor.js')
const U = await import('./utfordring.js')

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${String(info).replace(/\s+/g, ' ').slice(0, 200)}` : ''}`); if (!cond) feil++ }
const UTLEVERT = () => { try { return fs.readFileSync(path.join(ROOT, '.tua', 'utlevering.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const kaster = async (fn, re) => { try { await fn(); return false } catch (e) { return re.test(e.message) } }

// ── 1) tolkInnvendinger ────────────────────────────────────────────────────
{
  const a = U.tolkInnvendinger('1. Påstanden holder ikke.\n   Hvor: første avsnitt\n   Begrunnelse: Ingen kilde.\n\n2) Tallet er feil.\n   Hvor: «45 000 kr»\n   Begrunnelse: Kilden sier 54 000.')
  ok('tolkInnvendinger: nummerert med Hvor/Begrunnelse på egne linjer', a.length === 2 && a[0].tekst === 'Påstanden holder ikke.' && a[0].hvor === 'første avsnitt' && a[0].begrunnelse === 'Ingen kilde.' && a[1].hvor === '«45 000 kr»' && a.every((x) => x.status === 'åpen'), JSON.stringify(a))
  const b = U.tolkInnvendinger('1. **Svak slutning.** Hvor: avsnitt 2 Begrunnelse: Følger ikke av premissene.\n2. Mangler frist.')
  ok('tolkInnvendinger: alt i én linje, og en linje uten etiketter', b.length === 2 && b[0].tekst === 'Svak slutning.' && b[0].hvor === 'avsnitt 2' && b[0].begrunnelse === 'Følger ikke av premissene.' && b[1].tekst === 'Mangler frist.', JSON.stringify(b))
  const c = U.tolkInnvendinger('- Første\n  **Begrunnelse:** fordi\n- Andre')
  ok('tolkInnvendinger: kulepunkter og fet etikett', c.length === 2 && c[0].begrunnelse === 'fordi', JSON.stringify(c))
  ok('tolkInnvendinger: «Ingen innvending.» → tom liste', U.tolkInnvendinger('Ingen innvending.').length === 0 && U.tolkInnvendinger('**Ingen innvendinger**').length === 0 && U.tolkInnvendinger('').length === 0)
  const d = U.tolkInnvendinger('Svaret er stort sett greit, men fristen er feil.')
  ok('tolkInnvendinger: ustrukturert tekst blir én innvending merket utolket (aldri en feil)', d.length === 1 && d[0].utolket === true)
  ok('SJEKKER: fire valg, hver med instruks som ber om nummererte innvendinger, hvor og begrunnelse, og «Ingen innvending.»', U.SJEKKER.map((s) => s.id).join() === 'svakheter,kilder,motpart,mangler' && U.SJEKKER.every((s) => /Hvor:/.test(U.instruksFor(s.id)) && /Begrunnelse:/.test(U.instruksFor(s.id)) && /Ingen innvending\./.test(U.instruksFor(s.id))))
  ok('utfordretTekst: «Utfordret av ChatGPT 28.10 · 3 innvendinger · 2 tatt inn»', U.utfordretTekst({ av: 'ChatGPT', dato: '2026-10-28T10:00:00', innvendinger: 3, tatt_inn: 2 }) === 'Utfordret av ChatGPT 28.10 · 3 innvendinger · 2 tatt inn' && U.utfordretTekst({ av: 'Claude', dato: '2026-10-28T10:00:00', innvendinger: 0 }) === 'Utfordret av Claude 28.10 · ingen innvendinger')
  ok('kortKontroll: openai → ChatGPT, ollama → modellnavnet', U.kortKontroll({ mottaker: 'openai', label: 'OpenAI (GPT)' }) === 'ChatGPT' && U.kortKontroll({ mottaker: 'ollama', modell: 'gemma3:4b' }) === 'gemma3')
  const vend = [{ id: 'b1', rolle: 'bruker', L: 'Lag ankeutkast' }, { id: 'm1', rolle: 'modell', L: 'Nå setter jeg opp en arbeidsplan og begynner å lese kildedokumentene.' }, { id: 'm2', rolle: 'modell', L: 'Ankeutkastet er klart. ' + 'Begrunnelse og påstand. '.repeat(40) }, { id: 'm3', rolle: 'modell', L: 'Ferdig.' }]
  ok('resultatVending: siste svar som ikke er et arbeidssteg (C6)', U.resultatVending(vend)?.id === 'm2' && U.erArbeidssteg(vend[1]) && U.erArbeidssteg(vend[3]) && !U.erArbeidssteg(vend[2]))
}

// ── testarkiv ──────────────────────────────────────────────────────────────
const PERSON = 'Zelda Haraldstad'
const P = 'Energima anke'
const atoms = []
const dok = upsert(atoms, { content: `# Vedtaket\n\nTingretten la til grunn at ${PERSON} hadde frist 1. mars. ` + 'Vedtaket i saken. '.repeat(60), name: 'Vedtaket fra tingretten', project: P, convo: `Møte med ${PERSON}`, short: 'Tingrettens vedtak.', by: 'menneske' }).atom
const svar = upsert(atoms, { kind: 'svar', content: `Ankefristen er en måned. ${PERSON} bør anke innen 1. april. ` + 'Vurdering. '.repeat(80), name: 'Svar fra Claude: ankefrist', project: P, convo: 'Ankefrist', source: 'Claude (Anthropic)', by: 'regel', tags: ['svar', 'claude'], derivedFrom: [{ id: dok.id, version: 1, level: 'M' }], short: 'Ankefristen er en måned.' }).atom
const vault = upsert(atoms, { content: 'Hemmelig forlik: betingelsene. ' + 'Vault. '.repeat(50), name: 'Forliket (Vault)', project: P, short: 'Vault-sak.', by: 'menneske', tags: ['vault'] }).atom
const store = Array.from({ length: 3 }, (_, i) => upsert(atoms, { content: `Bilag ${i + 1}. ` + 'Langt bilag med mye tekst. '.repeat(600), name: `Bilag ${i + 1}`, project: P, short: `Bilag ${i + 1}.`, medium: `Sammendrag av bilag ${i + 1}. ` + 'Langt sammendrag. '.repeat(120), by: 'menneske' }).atom)
const tungt = upsert(atoms, { kind: 'svar', content: 'Stort svar. ' + 'Mye tekst i svaret. '.repeat(600), name: 'Svar fra Claude: stort', project: P, convo: 'Stort', source: 'Claude (Anthropic)', by: 'regel', tags: ['svar', 'claude'], derivedFrom: store.map((b) => ({ id: b.id, version: 1, level: 'M' })), short: 'Et stort svar.' }).atom
// en fanget Cowork-samtale: arbeidssteg, så resultatet, så et kort «Ferdig» — og et dokument samtalen skrev
const ARBEID = 'Nå setter jeg opp en arbeidsplan og begynner å lese kildedokumentene.'
const RESULTAT = 'Ankeutkastet er klart: anken bygger på at fristen ble feilberegnet. ' + 'Begrunnelsen står i punkt 2 og 3. '.repeat(30)
const PROMPT1 = 'Les dokumentene og lag et utkast til anke for Energima.'
const tx = ['# Skado – energima', '', '_Claude Cowork · 2 meldinger · 2026-10-27_', '', `**Bruker:** ${PROMPT1}`, '', `**Claude:** ${ARBEID}`, '', `**Claude:** ${RESULTAT}`, '', '**Bruker:** Takk, lag zip.', '', '**Claude:** Ferdig.'].join('\n')
const fanget = upsert(atoms, { key: 'samtale:cowk0001-aaaa-bbbb-cccc-ddddeeeeffff', kind: 'samtale', name: 'Skado – energima', content: tx, project: P, convo: 'Skado – energima', source: 'Claude Cowork', by: 'regel', tags: ['samtale', 'cowork'], fanget: true, short: 'Sist: …' }).atom
const ankedok = upsert(atoms, { content: '# Ankeerklæring\n\nUtkast til anke. ' + 'Punkt. '.repeat(40), name: 'Ankeerklæring v5', project: P, convo: 'Skado – energima', source: 'Claude Cowork', by: 'regel', short: 'Utkast til anke.' }).atom
save(atoms)

// ── 2) grunnlaget: bare resultatet og kildene ──────────────────────────────
{
  const alle = load()
  const mål = motor.utfordringsMål(alle, { sak: svar.id })
  ok('utfordringsMål: svaret er resultatet, kilden er det svaret bygger på (bygget_av), forfatteren er kilden', mål.resultat.id === svar.id && mål.kilder.map((k) => k.id).join() === dok.id && /Claude/.test(mål.forfatter))
  const fv = motor.forhåndsvisUtfordring({ sak: svar.id, sjekk: 'kilder', mottaker: 'test' })
  ok('forhåndsvis: test (Trust 3) får svaret på M, kilden på M, navnet skjermet, Sendes-linja som ellers', fv.resultat.nivå === 'M' && fv.kilder[0]?.level === 'M' && fv.treff >= 1 && !fv.tekst.includes(PERSON) && /^Sendes: svaret på M · 1 kilde på M · \d+ skjermet · ca\. [\d  ]+ tokens → Test/.test(fv.linje) && fv.notater.some((n) => /Trust Score 3\/5/.test(n)), fv.linje)
  ok('forhåndsvis: instruksen er «Sjekk mot kildene» og står i det som sendes', fv.sjekk === 'kilder' && fv.tekst.includes('Sjekk SVARET under mot KILDENE'))
  const fl = motor.forhåndsvisUtfordring({ sak: svar.id, sjekk: 'svakheter', mottaker: 'testlokal' })
  ok('forhåndsvis: en lokal modell (Trust 5) får svaret på L og kildene på L', fl.resultat.nivå === 'L' && fl.kilder[0]?.level === 'L' && !fl.notater.some((n) => /Trust Score/.test(n)), fl.linje)
  const fvV = motor.forhåndsvisUtfordring({ sak: vault.id, mottaker: 'test' })
  ok('Vault: en ekstern kontrollmodell stoppes (blokkert, ingenting sendt) — en lokal får utfordre', !!fvV.blokkert && /bare utfordres av en lokal modell/.test(fvV.blokkert.feil) && !motor.forhåndsvisUtfordring({ sak: vault.id, mottaker: 'testlokal' }).blokkert)
  const fs1 = motor.forhåndsvisUtfordring({ sak: fanget.id, mottaker: 'test' })
  ok('fanget samtale: resultatet er siste svar med innhold — ikke spørsmålet, ikke arbeidssteget, ikke «Ferdig.» (C3/C6)', fs1.resultat.syntetisk && fs1.tekst.includes('Ankeutkastet er klart') && !fs1.tekst.includes(ARBEID) && !fs1.tekst.includes(PROMPT1) && !/\bFerdig\.\s*$/m.test(fs1.tekst.split('## Kilde')[0]), fs1.linje)
  ok('fanget samtale: dokumentet samtalen skrev er kilden', fs1.kilder.some((k) => k.id === ankedok.id), JSON.stringify(fs1.kilder))
  const bud = motor.forhåndsvisUtfordring({ sak: tungt.id, mottaker: 'test' })
  ok('budsjett: over 1 500 tokens hos test → kildene ned til S, sagt i en linje — før svaret kuttes', bud.kilder.every((k) => k.level === 'S') && bud.notater.some((n) => /Kildene er kuttet til S/.test(n)), JSON.stringify(bud.notater))
  ok('budsjett: svaret (M) er ikke kuttet når kildene på S gir plass', !bud.resultat.kuttet && !bud.over, `${bud.tokens.ca}`)
  const bud2 = motor.forhåndsvisUtfordring({ sak: tungt.id, mottaker: 'testlokal' })
  ok('budsjett: holder ikke det (svaret på L hos en lokal), tas kildene ut og så kuttes svaret — og det sies; innenfor budsjettet', bud2.notater.some((n) => /kilder er tatt ut/.test(n)) && bud2.notater.some((n) => /Svaret er kuttet til de første/.test(n)) && bud2.resultat.kuttet && !bud2.over && bud2.tokens.ca <= 1500, `${bud2.tokens.ca} · ${bud2.notater.join(' | ')}`)
  ok('ukjent sjekk og ukjent mottaker gir MotorFeil', await kaster(() => motor.forhåndsvisUtfordring({ sak: svar.id, sjekk: 'tull', mottaker: 'test' }), /ukjent sjekk/) && await kaster(() => motor.forhåndsvisUtfordring({ sak: svar.id, mottaker: 'nei' }), /ukjent kontrollmodell/))
}

// ── 3) utfordre() → godta/avvis → ny versjon → lås ─────────────────────────
let uId
{
  const før = UTLEVERT().length
  const hendelser = []
  const r = await motor.utfordre({ sak: svar.id, sjekk: 'svakheter', mottaker: 'test', klient: 'test', på: (ev) => hendelser.push(ev) })
  uId = r.utfordring.id
  ok('utfordre: hendelsene skjermet → del … → ferdig', hendelser[0] === 'skjermet' && hendelser.includes('del') && hendelser.at(-1) === 'ferdig', hendelser.slice(0, 3).join())
  ok('utfordre: tre innvendinger tolket, alle «åpen»', r.utfordring.innvendinger.length === 3 && r.utfordring.innvendinger.every((x) => x.status === 'åpen' && x.hvor && x.begrunnelse), JSON.stringify(r.utfordring.innvendinger[0]))
  const alle = load()
  const u = alle.find((a) => a.id === uId)
  ok('utfordringen er egen sak: kind svar, tagger utfordring + test, utfordrer → svaret, sjekk, kontrollmodell, forfatter, utkast', u.kind === 'svar' && u.tags.includes('utfordring') && u.tags.includes('test') && u.utfordrer?.id === svar.id && u.utfordring.sjekk === 'svakheter' && u.utfordring.mottaker === 'test' && /Claude/.test(u.utfordring.forfatter) && u.status === 'utkast')
  const p = alle.find((a) => a.key === 'prompt:utfordre:svakheter')
  ok('V16: instruksen er prompt-sak i sakens prosjekt (tagg utfordring), `ga` peker på utfordringen; bygget_av har prompten, svaret og kilden', p && p.project === P && p.kind === 'prompt' && p.tags.includes('utfordring') && p.ga.some((g) => g.id === uId) && u.derivedFrom.map((d) => d.id).join() === [p.id, svar.id, dok.id].join())
  const fil = fs.readFileSync(path.join(ROOT, P, fs.readdirSync(path.join(ROOT, P)).find((f) => fs.readFileSync(path.join(ROOT, P, f), 'utf8').includes(`tua_id: "${uId}"`))), 'utf8')
  ok('fila: frontmatter har utfordrer og utfordring med innvendingene', /^utfordrer: \{"id":/m.test(fil) && /^utfordring: \{"sjekk":"svakheter"/m.test(fil) && fil.includes('"status":"åpen"'))
  const linjer = UTLEVERT().slice(før)
  ok('Utlevert: én linje (tool utfordre, mottaker test, prompt, svar, utfordrer), ingen originaler', linjer.length === 1 && linjer[0].tool === 'utfordre' && linjer[0].mottaker === 'test' && linjer[0].svar === uId && linjer[0].utfordrer === svar.id && linjer[0].skjermet?.navn >= 1 && !JSON.stringify(linjer).includes(PERSON), JSON.stringify(linjer[0]))
  ok('ny versjon uten godtatte → MotorFeil', await kaster(() => motor.nyVersjon({ id: uId }), /godta minst én/))
  motor.settInnvending({ id: uId, nr: 1, status: 'godtatt' }); motor.settInnvending({ id: uId, nr: 2, status: 'godtatt' }); const s3 = motor.settInnvending({ id: uId, nr: 3, status: 'avvist' })
  ok('godta/avvis: status lagres på innvendingene (ingen ny versjon av teksten)', s3.innvendinger.map((x) => x.status).join() === 'godtatt,godtatt,avvist' && load().find((a) => a.id === uId).version === 1)
  ok('godta/avvis: ugyldig status og ukjent nr gir MotorFeil', await kaster(() => motor.settInnvending({ id: uId, nr: 1, status: 'kanskje' }), /status må være/) && await kaster(() => motor.settInnvending({ id: uId, nr: 9, status: 'avvist' }), /ingen innvending nr\. 9/))
  const i = U.utfordringInfo(load(), load().find((a) => a.id === svar.id))
  ok('«Utfordret av Test dd.mm · 3 innvendinger · 2 tatt inn» på svaret', i && i.av === 'Test' && /^Utfordret av Test \d\d\.\d\d · 3 innvendinger · 2 tatt inn$/.test(i.tekst) && i.åpne === 0, i?.tekst)
  const før2 = UTLEVERT().length
  const nv = await motor.nyVersjon({ id: uId, mottaker: 'test' })
  const nvA = load().find((a) => a.id === nv.id)
  ok('ny versjon: egen sak (tagg ny-versjon, utkast), bygget på utfordringen, 2 godtatte tatt inn; utfordringen peker på den', nvA.tags.includes('ny-versjon') && nvA.status === 'utkast' && nvA.derivedFrom[0].id === uId && /2 godtatte innvendinger/.test(nvA.content) && load().find((a) => a.id === uId).utfordring.nyVersjon === nv.id, nvA.content.slice(0, 120))
  ok('ny versjon: egen Utlevert-linje (tool ny-versjon), ingen originaler', UTLEVERT().slice(før2).length === 1 && UTLEVERT().at(-1).tool === 'ny-versjon' && !JSON.stringify(UTLEVERT().at(-1)).includes(PERSON))
  const l = motor.låsUtfordring({ id: uId })
  const k = load().find((a) => a.id === l.konklusjon.id)
  ok('lås: konklusjon (endelig) med det som ble tatt inn og avvist, bygget_av → svaret, utfordringen og den nye versjonen', k.kind === 'konklusjon' && k.status === 'endelig' && /## Tatt inn/.test(k.content) && /## Avvist/.test(k.content) && k.derivedFrom.map((d) => d.id).join() === [svar.id, uId, nv.id].join(), k.content.slice(0, 120))
  ok('lås: utfordringen er låst (endelig) og kan ikke vurderes på nytt; konklusjonen regnes som utfordret', l.utfordring.låst && load().find((a) => a.id === uId).status === 'endelig' && await kaster(() => motor.settInnvending({ id: uId, nr: 1, status: 'avvist' }), /låst/) && U.utfordringInfo(load(), k)?.id === uId)
  ok('utfordringerAv: panelet får forfatter, sjekkene og utfordringene nyeste først', (() => { const v = motor.utfordringerAv(svar.id); return /Claude/.test(v.forfatter) && v.sjekker.length === 4 && v.utfordringer[0]?.id === uId && v.utfordringer[0].info.låst })())
}
// fanget samtale: utfordringen peker på samtalen og vendingen
{
  const r = await motor.utfordre({ sak: fanget.id, sjekk: 'mangler', mottaker: 'test', klient: 'test' })
  const u = load().find((a) => a.id === r.utfordring.id)
  ok('fanget samtale: utfordrer → samtalen, med vendingen fra transkriptet; bygget_av har resultatet (samtalen) og dokumentet', u.utfordrer.id === fanget.id && /^v_/.test(u.utfordrer.vending || '') && u.derivedFrom.some((d) => d.id === fanget.id) && u.derivedFrom.some((d) => d.id === ankedok.id), JSON.stringify(u.utfordrer))
  ok('fanget samtale: utfordringen blir ingen vending i samtalen (transkriptet er urørt)', !motor.utfordringsMål(load(), { sak: fanget.id }).vending.id.startsWith('a_') && !(await import('./samtale.js')).vendingerFor(load(), load().find((a) => a.id === fanget.id)).some((v) => v.id === u.id))
  ok('Vault: utfordre() til en ekstern stoppes med Blokkert, ingen sak lagres', await (async () => { const n = load().length; try { await motor.utfordre({ sak: vault.id, mottaker: 'test' }); return false } catch (e) { return e instanceof motor.Blokkert && load().length === n } })())
}

// ── 4) broen ───────────────────────────────────────────────────────────────
const PORT = 5297
const DIST = path.join(path.dirname(ROOT), 'dist'); fs.mkdirSync(DIST, { recursive: true }); fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>Tua</title>')
const bro = spawn(process.execPath, [path.join(HERE, 'bridge.js')], { env: { ...process.env, TUA_BRIDGE_PORT: String(PORT), TUA_KART_DIST: DIST }, stdio: ['ignore', 'ignore', 'pipe'] })
let broLogg = ''; bro.stderr.on('data', (d) => { broLogg += d })
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/bro`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
const get = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, json: await r.json().catch(() => null) } }
const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) } }
const sse = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); return [...t.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)].map((m) => ({ ev: m[1], d: JSON.parse(m[2]) })) }
try {
  const sak2 = upsert(load(), { content: 'Konklusjon: anke. ' + 'Tekst. '.repeat(40), name: 'Konklusjon: skal vi anke', project: P, kind: 'konklusjon', source: 'Claude (Anthropic)', by: 'regel', tags: ['konklusjon'], key: 'konklusjon:bro-test' })
  { const a = load(); a.push(sak2.atom); save(a) }
  const k = sak2.atom.id
  const v = await get(`/api/utfordringer?sak=${encodeURIComponent(k)}`)
  ok('GET /api/utfordringer: forfatter, fire sjekker med instruks, ingen utfordringer ennå', v.status === 200 && /Claude/.test(v.json.forfatter) && v.json.sjekker.length === 4 && v.json.sjekker[0].instruks.includes('Hvor:') && v.json.utfordringer.length === 0, JSON.stringify(v.json).slice(0, 160))
  ok('GET /api/utfordringer uten sak → 400, ukjent sak → 404', (await get('/api/utfordringer')).status === 400 && (await get('/api/utfordringer?sak=finnes-ikke')).status === 404)
  const f = await post('/api/utfordre/forhandsvis', { sak: k, sjekk: 'motpart', mottaker: 'test2' })
  ok('POST /api/utfordre/forhandsvis: Sendes-linja til test2', f.status === 200 && /→ Test 2/.test(f.json.linje) && f.json.sjekk === 'motpart', f.json?.linje)
  const h = await sse('/api/utfordre', { sak: k, sjekk: 'svakheter', mottaker: 'test' })
  const ferdig = h.find((x) => x.ev === 'ferdig')?.d
  ok('POST /api/utfordre: SSE skjermet → del … → ferdig med utfordringen og tre innvendinger', h[0]?.ev === 'skjermet' && h.some((x) => x.ev === 'del') && h.at(-1)?.ev === 'ferdig' && ferdig.utfordring.innvendinger.length === 3, h.map((x) => x.ev).filter((e, i, l) => l[i - 1] !== e).join('→'))
  ok('POST /api/utfordre: Vault til en ekstern → blokkert-hendelse', (await sse('/api/utfordre', { sak: vault.id, mottaker: 'test' })).some((x) => x.ev === 'blokkert'))
  ok('POST /api/utfordre uten mottaker → 400', (await post('/api/utfordre', { sak: k })).status === 400)
  const iv = await post('/api/utfordre/innvending', { id: ferdig.utfordring.id, nr: 2, status: 'godtatt' })
  ok('POST /api/utfordre/innvending: godtatt lagret, info sier 1 tatt inn', iv.status === 200 && iv.json.utfordring.innvendinger[1].status === 'godtatt' && iv.json.utfordring.info.tatt_inn === 1)
  const nv = await sse('/api/utfordre/ny-versjon', { id: ferdig.utfordring.id })
  ok('POST /api/utfordre/ny-versjon: SSE → ferdig med ny sak (forfatteren Claude er ikke klar → kontrollmodellen)', nv.at(-1)?.ev === 'ferdig' && !!nv.at(-1).d.id && nv.at(-1).d.mottaker === 'test', JSON.stringify(nv.at(-1)).slice(0, 160))
  const l = await post('/api/utfordre/las', { id: ferdig.utfordring.id })
  ok('POST /api/utfordre/las: konklusjon og låst utfordring', l.status === 200 && !!l.json.konklusjon.id && l.json.utfordring.låst)
  const at = await get('/api/atoms')
  const sakA = at.json.atoms.find((a) => a.id === k), uA = at.json.atoms.find((a) => a.id === ferdig.utfordring.id), svarA = at.json.atoms.find((a) => a.id === svar.id)
  ok('GET /api/atoms: saken har `utfordret` med tekst («… 1 tatt inn»), utfordringen er merket er_utfordring', /^Utfordret av Test \d\d\.\d\d · 3 innvendinger · 1 tatt inn$/.test(sakA?.utfordret?.tekst || '') && sakA.utfordret.låst && uA?.er_utfordring === true && /2 tatt inn/.test(svarA?.utfordret?.tekst || ''), sakA?.utfordret?.tekst)
  const s = await get(`/api/samtale?id=${encodeURIComponent(fanget.id)}`)
  ok('GET /api/samtale (fanget): `utfordret` og `dokumenter` (filene samtalen skrev)', s.status === 200 && /^Utfordret av Test/.test(s.json.utfordret?.tekst || '') && s.json.dokumenter.some((d) => d.id === ankedok.id), JSON.stringify({ u: s.json.utfordret?.tekst, d: s.json.dokumenter?.map((x) => x.name) }))
} finally { bro.kill() }

// ── 5) Claude-døra ─────────────────────────────────────────────────────────
{
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, 'server.js')], cwd: HERE, env: { ...process.env, TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test-utfordre' }, stderr: 'pipe' })
  const client = new Client({ name: 'tua-utfordre-test', version: '0.0.1' })
  await client.connect(transport)
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { r, text: (r.content || []).map((c) => c.text || '').join('\n') } }
  try {
    const g = await call('tua_get', { id: svar.id, level: 'S' })
    ok('tua_get: «Utfordret av Test dd.mm · 3 innvendinger · 2 tatt inn (finn svakhetene, låst)»', /Utfordret av Test \d\d\.\d\d · 3 innvendinger · 2 tatt inn \(finn svakhetene, låst\)/.test(g.text), g.text.split('\n').find((l) => /Utfordret/.test(l)))
    const sr = await call('tua_search', { query: 'ankefrist' })
    ok('tua_search: treffet nevner «Utfordret av …»', /Utfordret av Test/.test(sr.text), sr.text.split('\n').find((l) => /Utfordret/.test(l)))
    const c = await call('tua_card', { id: svar.id })
    ok('tua_card: kortet har `utfordret` og linja i teksten', c.r.structuredContent?.atom?.utfordret?.tatt_inn === 2 && /Utfordret av Test/.test(c.text), JSON.stringify(c.r.structuredContent?.atom?.utfordret))
  } finally { await client.close() }
}

console.log(`\n${feil ? `${feil} FEIL` : 'Alt grønt'} · testarkiv: ${ROOT}`)
if (feil && broLogg) console.log(broLogg.split('\n').filter((l) => /utfordr|FEIL|Error/i.test(l)).slice(-10).join('\n'))
process.exit(feil ? 1 : 0)
