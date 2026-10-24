#!/usr/bin/env node
// bridge.js — Tua som egen lokal app (M12, M22): én prosess som både serverer
// appen (ferdigbygd fra tua2-sandbox/dist) og er broen til det EKTE arkivet
// (mappa ~/Dropbox/Tua, samme som MCP-serveren bruker).
//
//   GET  /  /spor  /kart  /oppslag  /innstillinger → appen (dist/index.html, skive 3: én app med klient-ruting; /forside = /)
//   GET  /sandkasse            → demoene (dist/sandkasse.html)
//   GET  /assets/*  /fonter/*  → bygde filer og de lokale fontene
//   GET  /api/atoms?offset&limit → { atoms, total, file }   (hvert atom har `links` ferdig utregnet + `file`,
//                                 og siden skive 3 ord: {S,M,L}, tegn: {S,M,L}, max, vault — det forsiden gir Spør om en sak)
//   GET  /api/search?q&context&project&limit&offset → { hits, total }  rangert: tittel/S > M > L (M12)
//                                 hvert treff har også ord: {S, M, L} (ordantall per nivå fra lageret), max, vault og kind — til Spør-skjermens kildeliste (skive 2)
//   Spør-skjermen (M20a front, skive 2) er ruta /spor i appen: ett felt, kilder med S/M/L, mottakere med Trust Score, personvernlinja, svaret strømmet
//   POST /api/link   {id, project, level?}   → gjør atomet synlig i prosjektet (referanse), valgfritt nivå S/M/L;
//                                        kall igjen med level for å endre nivået på en eksisterende referanse
//   POST /api/unlink {id, project}   → fjerner referansen
//   M23 (skive 4) — sak-panelet i Oppslag (/oppslag): alt om én sak skjer ved siden av saken (V21 §4). Tre små dører til lageret:
//   GET  /api/utlevert?limit&offset&mottaker&dager → { utlevert, total, limit, offset }  hele Utlevert-loggen (skive 5, Innstillinger): alle
//        sendinger nyeste først, hver med saker[{id, version, level, name, project}] slått opp fra lageret (navn, aldri innhold); filter på mottaker og «siste N dager»
//   GET  /api/utlevert.csv?mottaker&dager → text/csv (semikolon, BOM, for norsk Excel) med samme kolonner — aldri innhold
//   GET  /api/utlevert?id=<sak>&limit → { id, utlevert: [...] }  hver sending som har tatt med saken (deliveries i store.js): til hvem, modell,
//                                 nivå for DENNE saken, antall skjermet per type, ord, tokens, når, svar/prompt-id — aldri innhold, aldri originaler
//   GET  /api/versions?id=<sak>  → { id, versions: [{name, size, mtime}] }  tidligere versjoner av fila (.tua/versions/<id>/), lageret som før
//   POST /api/status {id, status: utkast|endelig} → status på saken (frontmatter `status`; standard: svar = utkast, alt annet = endelig)
//   /api/atoms og /api/search gir `status` per sak (statusOf).
//   Passord (valgfritt): `node bridge.js --sett-passord` setter et passord (scrypt-hash i <arkiv>/.tua/passord.json).
//   Da krever alt — appen og /api/* — innlogging på /logg-inn (HttpOnly-cookie, 30 dager). `--fjern-passord` fjerner det.
//   /api/* svarer da 401 { error, login: '/logg-inn' } og appen sender brukeren til /logg-inn?next=… (skive 3); sider omdirigeres dit direkte.
//   Uten passord er alt åpent som før, men bare for programmer på denne maskinen (127.0.0.1).
//   POST /api/save   {content, name?, source?, project?, convo?, summary?, short?, medium?, tags?, key?}
//                    → M11: lagrer et atom i mappa (Demo 7 «fang» over det ekte arkivet). S/M merkes menneskeskrevet.
//   POST /api/open   {id, target, href?}      → M9/V13: åpner LOKALT, bare fra en fast liste:
//        target = 'finder' → `open -R <fil>`  (fila må være atomets egen .md eller en av atomets file-lenker)
//        target = 'code'   → `open claude-cli://open?cwd=<repo>&q=…`  (repo må være en repo-lenke på atomet / i prosjektregisteret)
//        Ingen andre programmer, ingen shell, ingen frie stier. `claude://`-lenker (Desktop-prosjekt) åpnes
//        rett fra nettleseren og går aldri via broen.
//   Innstillinger (M15) er ruta /innstillinger i appen: arkivsted, sky-connectors, AI-connectors (BYOK), Finder-mapper
//   GET  /api/settings           → { arkiv, steder, sky, ai, finder, trust } — aldri nøkkelverdier, bare «satt / ikke satt»
//   POST /api/settings {arkiv: {sted|sti}} | {finder: {folders}}  → velger arkivsted (flytter ingenting, V9) / Finder-mapper. Samme ~/.tua/config.json som tua_setup.
//   POST /api/keychain {provider, key}   → nøkkelen inn i macOS Keychain (security, uten shell, via stdin — aldri fil, aldri logg)
//   DELETE /api/keychain {provider}      → nøkkelen ut av Keychain
//   Trust Score per connector leses fra trust-scores.json (anslag — rettes der, uten kode).
//   M20a (skive 1): motoren — lese → skjerme → minimere → sende → logge (motor.js). Ingen kodevei utenom.
//   GET  /api/mottakere          → { mottakere: [{id, label, endpoint, modell, trust, nøkkel: satt/ikke satt, aktiv, local, test}] } — aldri nøkkelverdier
//   POST /api/spor  {melding, saker: [{id, nivå}], mottaker, prosjekt?, samtale?}  → SSE (text/event-stream):
//        event: skjermet  {antall per type, treff, ord, tokens: {ca}, tekst = «se hva som sendes», saker, notater}
//        event: del       {tekst}            tekstbiter mens svaret strømmer (med plassholdere)
//        event: ferdig    {svar, prompt, tokens: {ca, inn, ut}, tekst}   sak-id for svaret og prompten, eksakt usage, svaret med originalene satt inn igjen
//        event: blokkert  {feil, detaljer}   fail closed: nivå over det Trust Score / Vault tillater — sier hva som må endres
//        event: feil      {feil}             alt annet (mottaker ikke klar, nettverk, avslag)
//        mottaker «test» ekkoer uten å sende noe ut av maskinen. TUA_BRIDGE_VAKTER=0 slår av Innboks/Desktop/Finder-vaktene (tester).
//   M20b (skive 6): flere mottakere samtidig, Forskjeller og konklusjon — alt i motoren (motor.js), broen bærer bare hendelsene.
//   POST /api/spor  {…, mottakere: [id, id]}  (i tillegg til mottaker) → samme SSE, men per mottaker:
//        event: skjermet  {…, mottakere, tokens: {ca, per: {id: ca}}}  én gang — samme skjermede melding går til alle
//        event: del       {mottaker, tekst} · event: ferdig {mottaker, svar, prompt, tokens, tekst}  én per mottaker, i den rekkefølgen de svarer
//        event: blokkert  {feil, detaljer, mottaker}  er ÉN mottaker blokkert, sendes ingenting til noen (V21 fail closed) — linja sier hvilken
//        event: feil      {mottaker, feil}   én mottaker sviktet underveis; de andre fortsetter (uten mottaker: hele sendingen feilet)
//        event: vurderer  {steg: forskjeller|konklusjon, mottaker, modell}  standardmodellen lokalt tar over (Ollama → Claude)
//        event: forskjeller {tilgjengelig, enig, uenig, unikt, sak, vurdert_av, modell, tokens | grunn}   bare når mer enn én svarte; sak = Forskjeller-saken (kind svar, tagg forskjeller)
//        event: konklusjon-del {tekst} · event: konklusjon {tilgjengelig, id, tekst, status: utkast, mottaker, modell, tokens | grunn}
//        event: slutt     {prompt, svar: [ids], mottakere}
//   POST /api/konklusjon {id, tekst}            → brukerens rettelse av utkastet: ny versjon av samme sak, ingenting sendes → { konklusjon }
//   POST /api/konklusjon {prompt, svar?: [ids]} → «kjør igjen»: forskjeller og nytt utkast fra svar-sakene prompten ga (gjennom motoren) → { forskjeller, konklusjon }
//        «Gi M og kjør igjen» er ikke en egen dør: Spør sender hele spørsmålet på nytt til POST /api/spor med kilden på M — hele motoren, nye svar-saker.
//        Låsing (utkast → endelig) er POST /api/status som før.
//   M16 (skive 7): lesere og Innboks — filer leses lokalt og blir saker med S/M/L FØR de kan sendes (V21, pitch v3 pkt. 4: aldri rått). lesere.js + innlesing.js.
//   POST /api/les            fila som rå kropp (Content-Type: application/octet-stream, ?navn=<filnavn>&prosjekt=&samtale=) — slik nettleseren sender en fil som
//                            ble dratt inn — ELLER JSON {sti, prosjekt?, samtale?} for en fil som alt ligger på maskinen. Stien må ligge i brukerens hjemmemappe
//                            (realpath), aldri i arkivets .tua; broen lytter uansett bare på 127.0.0.1. → SSE:
//        event: leser     {navn, format}                 event: lest {navn, format, sider, ord, tegn, verktøy, tittel}
//        event: skriver   {mottaker, modell, lokalt}     standardmodellen lokalt skriver S (og M når teksten er lang); uten modell: regler, ingen hendelse
//        event: ferdig    {id, name, project, S, S_av, M_av, ord: {S,M,L}, tegn, max, vault, format, sider, skriver: {av, modell, tokens, utlevert}}  — saken, klar som kilde i Spør
//        event: feil      {feil, kode}  ukjent-format · ingen-tekst (PDF uten tekstlag — OCR kommer) · passord · for-stor · leser-mangler · feil
//   GET  /api/innboks        { sti, dokumenter: [{navn, format, label, bytes}], eksporter, lenker, antall, ferdig, prosjekter, standard }  hva som venter i <arkiv>/Innboks
//   POST /api/innboks/kjør   {prosjekt?, dryRun?} → { filer, tall: {filer, lest, feilet}, report }   leser dokumentene inn som saker (standard prosjekt «Innboks»), flytter til Innboks/Ferdig
//   GET  /api/prosjekter     { prosjekter: [navn] }   prosjektene i arkivet (til prosjektvelgeren i Spør)
//   POST /api/flytt          {id, prosjekt} → { atom }   flytter saken til et annet prosjekt (fila flyttes av lageret — det samme som å dra den i Finder, V9)
//   M19 + M14 (skive 8): prompter som førsteklasses saker, datasettet og onboardingen i appen.
//   GET  /api/search?kind=prompt   bare saker av én type; prompt-treff har også `tekst` (hele prompten), `ga` og `modeller` — til forslagene i Spør og Prompter-visningen
//   POST /api/spor  {…, prompt: <id>}   «Kjør igjen»: svaret kobles til DENNE prompt-saken (ga vokser; ny versjon bare når teksten er endret). Uten prompt: nøkkel på teksten.
//   GET  /api/datasett.jsonl[?laast=1]  én linje per konklusjon (V21 nivå 2): {prompt_id, prompt, kilder:[{id, nivå}], svar:[{mottaker, tekst_id}], forskjeller_id, konklusjon_id,
//        konklusjon, laast, versjon, dato} — id-er, prompt- og konklusjonsteksten; aldri svartekster, aldri koblingen plassholder → original. Lokal fil, logges ikke som Utlevert.
//   GET  /api/onboarding[?tall=1]  tilstand (vis/trenger/steg/ferdig), arkiv + kandidater (archiveOptions), Ollama-status, mottakere; med tall=1 også tallene til steg 3
//        (historyCounts + prompter). Tilstanden bor i ~/.tua/config.json under `onboarding` — den må finnes før arkivet er valgt.
//   POST /api/onboarding {steg: modell|arkiv|historikk, sted?|sti?, verdi?} → steget fullført (arkiv: chooseArchive, ingenting flyttes, V9); alle tre → ferdig
//   POST /api/import {kilde: alt|code|cowork|desktop|finder|innboks, dryRun?} → SSE: start {kilde,label} · del {kilde,label,stats,report|feil} · ferdig {report, tall} · feil {feil}
//        — importAlt i import.js (samme funksjoner som tua_import), stegvis så fremdriften vises mens neste kilde leses
//
// Lytter kun på 127.0.0.1, og slipper bare kartets origin inn (CORS).
// Kjør: npm run bridge   (i tua-plugin/). Ingen avhengigheter.
// TUA_OPEN_DRYRUN=1 → /api/open svarer med hva den ville kjørt, uten å kjøre det (test).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { openSpawn, FILE_MANAGER } from './platform.js'   // M18: «Åpne i …» på macOS, Windows og Linux
import os from 'node:os'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { load, save, setShare, upsert, search, levelOf, LEVELS, isVault, FILE, FILES_ROOT, DATA_DIR, filesMode, linksFor, fileOf, ensureArchive, archiveOptions, archiveInfo, chooseArchive, finderFolders, FINDER_DEFAULTS, setFinderFolders, CONFIG_FILE, deliveries, versions, statusOf, setStatus, STATUSER, readConfig, writeConfig, onboardingActive, finishOnboarding } from './store.js'
import { watchInbox, watchDesktop, importAlt, IMPORT_STEG, historyCounts, countPrompts } from './import.js'      // M14: Innboks — eksporter som legges i mappa blir atomer · M17: Desktop-cachen · skive 8: import med fremdrift
import { watchFinder } from './finder.js'                   // M17: dokumenter med AI-opphav, ved referanse
import { PROVIDERS, isProvider, keyStatus, setKey, deleteKey, ollamaStatus } from './keychain.js'   // M15: BYOK — nøkler i Keychain, aldri her
import { spor, mottakere, trustScores, Blokkert, ord, forskjeller, konklusjon, rettKonklusjon, svarFor } from './motor.js'   // M20a/M20b: motoren — eneste vei ut til en modell
import { lesInn, lesInnInnboks, innboksDokumenter, ferdigAntall, FORMATER, STANDARD_PROSJEKT } from './innlesing.js'   // M16 (skive 7): fil → sak med S/M/L, Innboks
import { inboxPending, inboxShareFiles } from './import.js'
import { projects as prosjektRegister, INBOX_DIR } from './store.js'
ensureArchive()                                             // M14: første kjøring — lag arkivet om det ikke finnes
const ARKIV = () => (filesMode() ? FILES_ROOT : FILE)
// M15: Trust Score per connector — én JSON-fil (trust-scores.json), leses ved hvert kall så rettelser virker uten omstart; nå i motor.js.
const countMd = (dir, depth = 2) => {   // hvor mange atomer (.md) ligger i en mappe — for «hva ville skjedd» ved bytte av arkivsted
  let n = 0
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'Innboks') continue; if (e.isFile() && e.name.endsWith('.md')) n++; else if (e.isDirectory() && depth > 0) n += countMd(path.join(dir, e.name), depth - 1) } } catch {}
  return n
}
async function settingsView() {
  const ts = trustScores()
  const info = archiveInfo()
  const steder = archiveOptions().map((o) => ({ id: o.id, label: o.label, path: o.path, base: o.base, available: o.available, exists: o.exists, current: !!info.root && info.root === o.path, atomer: o.exists ? countMd(o.path) : 0 }))
  const sky = ['icloud', 'dropbox', 'onedrive', 'googledrive'].map((id) => { const s = steder.find((x) => x.id === id); return { id, label: s.label, available: s.available, isArchive: s.current, trust: ts.sky?.[id] || null } })
  const keys = keyStatus(), ollama = await ollamaStatus()
  const ai = PROVIDERS.map((p) => ({ id: p.id, label: p.label, hint: p.hint, local: !!p.local, satt: p.local ? ollama.running : !!keys[p.id], ...(p.local ? { ollama } : {}), trust: ts.ai?.[p.id] || null }))
  return {
    arkiv: { ...info, atomer: info.exists ? countMd(info.root) : 0, config: CONFIG_FILE },
    steder, sky, ai,
    finder: { folders: finderFolders(), standard: FINDER_DEFAULTS(), home: os.homedir() },
    trust: { merk: ts._merk || '', om: ts._om || '' },
    platform: process.platform,
  }
}
// ── Skive 5: Utlevert-loggen samlet ─────────────────────────────────────────
// Alle linjer i .tua/utlevering.jsonl (deliveries uten id), nyeste først, med saknavn fra lageret. Aldri innhold: linjene har bare id/versjon/nivå,
// og her legges bare `name` og `project` til. Eldre MCP-linjer (tool get/compose: `id`, `level`) normaliseres til saker[] så tabellen og CSV-en er like.
function utlevertSamlet(mottaker = '', dager = 0) {
  const navn = new Map(load().map((a) => [a.id, { name: a.name, project: a.project }]))
  const siden = dager > 0 ? Date.now() - dager * 86400e3 : 0
  return deliveries(null, Number.MAX_SAFE_INTEGER)
    .filter((e) => (!mottaker || (e.mottaker || e.tool) === mottaker) && (!siden || (e.at || 0) >= siden))
    .map((e) => {
      const rå = Array.isArray(e.saker) ? e.saker : e.id ? [{ id: e.id, version: e.version, level: e.level }] : []
      const saker = rå.filter((s) => s && s.id).map((s) => ({ id: s.id, version: s.version ?? null, level: s.level || null, ...(navn.get(s.id) || { name: null, project: null }) }))
      return { ...e, saker, mottaker: e.mottaker || e.tool || null }
    })
    .sort((a, b) => (b.at || 0) - (a.at || 0))      // nyeste først etter tidsstempel, ikke filrekkefølge (MCP- og motor-linjer kan komme om hverandre)
}
const TYPE_NAVN = { navn: 'navn', epost: 'e-post', telefon: 'telefon', fødselsnummer: 'fødselsnummer', orgnr: 'org.nr', adresse: 'adresse', beløp: 'beløp' }
// CSV for norsk Excel: semikolon, CRLF, BOM (settes av kalleren), felt med ; " eller linjeskift i anførselstegn. Én rad per sending; sakene som «navn (nivå)» adskilt med « | ».
export const UTLEVERT_KOLONNER = ['når', 'mottaker', 'endepunkt', 'modell', 'klient', 'saker', 'nivåer', 'skjermet', 'ord', 'tokens_ca', 'tokens_inn', 'tokens_ut', 'prosjekt', 'spørsmål_id', 'svar_id']
export function utlevertCsv(linjer) {
  const felt = (v) => { const t = v == null ? '' : String(v); return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  const når = (ts) => (ts ? new Date(ts).toLocaleString('sv-SE', { hour12: false }).replace('T', ' ') : '')     // sv-SE gir ISO-liknende «2026-10-23 23:41:05» som Excel leser rett
  const rad = (e) => [når(e.at), e.mottaker || '', e.endpoint || '', e.modell || '', e.client || '', (e.saker || []).map((s) => `${s.name || s.id}${s.level ? ` (${s.level})` : ''}`).join(' | '),
    [...new Set((e.saker || []).map((s) => s.level).filter(Boolean))].join('/'), Object.entries(e.skjermet || {}).filter(([, n]) => n > 0).map(([k, n]) => `${TYPE_NAVN[k] || k} ${n}`).join(' | '),
    e.ord ?? '', e.tokens?.ca ?? '', e.tokens?.inn ?? '', e.tokens?.ut ?? '', e.context || '', e.prompt || '', e.svar || '']
  return [UTLEVERT_KOLONNER, ...linjer.map(rad)].map((r) => r.map(felt).join(';')).join('\r\n') + '\r\n'
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
// npm run build:kart. Kartet bygges fra tua2-sandbox i Tua-repoet (ved siden av tua-plugin/); utenfor repoet: sett TUA_KART_DIST.
const DIST = process.env.TUA_KART_DIST || [path.join(HERE, '..', '..', 'tua2-sandbox', 'dist'), path.join(HERE, '..', 'tua2-sandbox', 'dist')].find((p) => fs.existsSync(p)) || path.join(HERE, '..', '..', 'tua2-sandbox', 'dist')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.map': 'application/json', '.ico': 'image/x-icon' }

const PORT = Number(process.env.TUA_BRIDGE_PORT || 5274)
const ORIGIN = process.env.TUA_BRIDGE_ORIGIN || 'http://localhost:5273'
const DRYRUN = process.env.TUA_OPEN_DRYRUN === '1'
const same = (x, y) => String(x).toLowerCase() === String(y).toLowerCase()

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

// ── Passord og innlogging ───────────────────────────────────────────────────
// Passordet lagres bare som scrypt-hash (salt + hash) — aldri i klartekst. Sesjoner er
// tilfeldige tokens; serveren husker sha256 av dem i .tua/sesjoner.json (overlever omstart).
const TUA_DIR = filesMode() ? path.join(FILES_ROOT, '.tua') : DATA_DIR
const AUTH_FILE = path.join(TUA_DIR, 'passord.json')
const SESS_FILE = path.join(TUA_DIR, 'sesjoner.json')
const SESS_DAYS = 30
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }) }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const hashPw = (pw, salt) => crypto.scryptSync(String(pw).normalize('NFKC'), salt, 32).toString('hex')
export const passwordSet = () => fs.existsSync(AUTH_FILE)
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  writeJson(AUTH_FILE, { salt, hash: hashPw(pw, salt), satt: new Date().toISOString() })
  writeJson(SESS_FILE, {})                                     // alle gamle sesjoner ut
}
function checkPassword(pw) {
  const a = readJson(AUTH_FILE, null)
  if (!a) return true
  const h = Buffer.from(hashPw(pw, a.salt), 'hex'), e = Buffer.from(a.hash, 'hex')
  return h.length === e.length && crypto.timingSafeEqual(h, e)
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]))
function isAuthed(req) {
  if (!passwordSet()) return true
  const tok = cookies(req).tua_sesjon
  if (!tok) return false
  const s = readJson(SESS_FILE, {})[sha(tok)]
  return !!s && Date.now() - s.at < SESS_DAYS * 864e5
}
function newSession() {
  const tok = crypto.randomBytes(32).toString('base64url')
  const all = readJson(SESS_FILE, {})
  for (const k of Object.keys(all)) if (Date.now() - all[k].at > SESS_DAYS * 864e5) delete all[k]
  all[sha(tok)] = { at: Date.now() }
  writeJson(SESS_FILE, all)
  return tok
}
function endSession(req) {
  const tok = cookies(req).tua_sesjon
  if (!tok) return
  const all = readJson(SESS_FILE, {}); delete all[sha(tok)]; writeJson(SESS_FILE, all)
}
const SESSION_COOKIE = (tok) => `tua_sesjon=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESS_DAYS * 86400}`
const CLEAR_COOKIE = 'tua_sesjon=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
let failedAttempts = 0                                          // bremser gjetting: 400 ms × antall feil (nullstilles ved riktig)
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')
const loginPage = (msg = '', next = '/') => `<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tua — logg inn</title>
<body style="margin:0;background:#F5F3EE;font-family:Georgia,serif;color:#1A1A1A"><form method="post" action="/api/login" style="max-width:380px;margin:12vh auto;background:#fff;border:1px solid #BFBFBF;border-radius:12px;padding:28px 30px">
<div style="font:700 10px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#C04A38">Tua · kartet</div>
<h1 style="font-size:22px;color:#1F3864;margin:10px 0 6px">Logg inn</h1><p style="margin:0 0 16px;font-size:13.5px;color:#595959">Arkivet ditt er låst med passord. Det forlater aldri denne maskinen.</p>
${msg ? `<p style="margin:0 0 12px;font-size:13px;color:#C04A38">${msg}</p>` : ''}
<input type="hidden" name="next" value="${next.replace(/"/g, '&quot;')}"><input name="passord" type="password" autocomplete="current-password" autofocus required style="width:100%;box-sizing:border-box;font:15px Georgia,serif;padding:10px 12px;border:1px solid #BFBFBF;border-radius:8px">
<button style="margin-top:12px;width:100%;font:700 13px ui-monospace,monospace;color:#fff;background:#1F3864;border:0;border-radius:8px;padding:11px;cursor:pointer">Logg inn</button>
<p style="margin:16px 0 0;font-size:11.5px;color:#8C8C8C">Glemt? Sett nytt i terminalen: <code>node tua-plugin/server/bridge.js --sett-passord</code></p></form></body></html>`
const html = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(body) }
const redirect = (res, to, extra = {}) => { res.writeHead(303, { Location: to, ...extra }); res.end() }
const readForm = async (req) => {
  const raw = await new Promise((resolve, reject) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy() }); req.on('end', () => resolve(d)); req.on('error', reject) })
  if ((req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(raw || '{}') } catch { return {} } }
  return Object.fromEntries(new URLSearchParams(raw))
}

// CLI: --sett-passord (spør to ganger, skjult) · --fjern-passord
async function promptHidden(q) {
  if (process.env.TUA_KART_PASSORD) return process.env.TUA_KART_PASSORD        // for skript/test
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  process.stderr.write(q)
  rl._writeToOutput = () => {}
  return new Promise((resolve) => rl.question('', (v) => { rl.close(); process.stderr.write('\n'); resolve(v) }))
}
if (process.argv.includes('--fjern-passord')) {
  try { fs.unlinkSync(AUTH_FILE) } catch {}
  try { fs.unlinkSync(SESS_FILE) } catch {}
  console.error('Passordet er fjernet — kartet er åpent igjen (bare for denne maskinen).'); process.exit(0)
}
if (process.argv.includes('--sett-passord')) {
  const a = await promptHidden('Nytt passord (minst 8 tegn): ')
  if (a.length < 8) { console.error('For kort — minst 8 tegn.'); process.exit(1) }
  const b = process.env.TUA_KART_PASSORD ? a : await promptHidden('Gjenta: ')
  if (a !== b) { console.error('Passordene er ikke like.'); process.exit(1) }
  setPassword(a)
  console.error(`Passord satt (${AUTH_FILE}). Alle sesjoner er logget ut. Start broen: npm run kart`); process.exit(0)
}
const json = (res, code, body, extra = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
// Rå kropp (en opplastet fil) som Buffer, opp til maks. Over grensen: forbindelsen brytes og kalleren får feil.
const readBytes = (req, maks) =>
  new Promise((resolve, reject) => {
    const deler = []; let n = 0
    req.on('data', (c) => { n += c.length; if (n > maks) { req.destroy(new Error(`fila er større enn ${Math.round(maks / 1048576)} MB`)); return } deler.push(c) })
    req.on('end', () => resolve(Buffer.concat(deler)))
    req.on('error', reject)
  })
// ── Skive 8 (M19): prompt-samlingen og datasettet ───────────────────────────
const MOTTAKER_IDER = ['claude', 'ollama', 'mistral', 'openai', 'gemini', 'test', 'test2']
const mottakerAv = (s) => (s?.tags || []).find((t) => MOTTAKER_IDER.includes(t)) || s?.source || null
// Modellene en prompt gikk til: kilden (og mottaker-taggen) på svar-sakene i `ga`
const modellerFor = (byId, p) => [...new Set((p.ga || []).map((g) => byId.get(g.id)).filter(Boolean).map((s) => s.source || mottakerAv(s)).filter(Boolean))]
// Datasettet (V21 nivå 2): én rad per konklusjon-sak. Bare id-er og tekstene brukeren selv står for (prompten, konklusjonen) — aldri svartekstene,
// aldri koblingen plassholder → original (den finnes ikke på disk). Lokal fil; ingenting går ut, derfor ingen Utlevert-linje.
export function datasett(atoms, { bareLaast = false } = {}) {
  const byId = new Map(atoms.map((a) => [a.id, a]))
  return atoms.filter((a) => a.kind === 'konklusjon').filter((k) => !bareLaast || statusOf(k) === 'endelig').sort((x, y) => x.capturedAt - y.capturedAt).map((k) => {
    const kilderAv = (k.derivedFrom || []).map((d) => ({ d, a: byId.get(d.id) }))
    const p = kilderAv.find((x) => x.a?.kind === 'prompt')?.a || null
    const svar = kilderAv.filter((x) => x.a?.kind === 'svar' && !(x.a.tags || []).includes('forskjeller')).map((x) => x.a)
    const fsk = kilderAv.find((x) => x.a?.kind === 'svar' && (x.a.tags || []).includes('forskjeller'))?.a || null
    const kilder = []
    for (const s of svar) for (const d of s.derivedFrom || []) { if (d.id === p?.id || kilder.some((x) => x.id === d.id)) continue; kilder.push({ id: d.id, nivå: d.level || 'L' }) }
    return { konklusjon_id: k.id, versjon: k.version || 1, dato: new Date(k.capturedAt || Date.now()).toISOString(), prompt_id: p?.id || null, prompt: p?.content || '', kilder,
      svar: svar.map((s) => ({ mottaker: mottakerAv(s), tekst_id: s.id })), forskjeller_id: fsk?.id || null, konklusjon: k.content || '', laast: statusOf(k) === 'endelig' }
  })
}
// ── Skive 8 (M14): onboardingen i appen — tilstanden i ~/.tua/config.json (finnes før arkivet) ──
const onboardingLes = () => { const o = readConfig().onboarding; return o && typeof o === 'object' ? { steg: o.steg || {}, ferdig: o.ferdig || null } : { steg: {}, ferdig: null } }
const ONBOARDING_STEG = ['modell', 'arkiv', 'historikk']
async function onboardingView({ medTall = false } = {}) {
  const ob = onboardingLes()
  const needsChoice = !FILES_ROOT
  const info = archiveInfo()
  const kandidater = archiveOptions().map((o) => ({ id: o.id, label: o.label, path: o.path, available: o.available, exists: o.exists, current: !!info.root && info.root === o.path, atomer: o.exists ? countMd(o.path) : 0 }))
  const trenger = needsChoice || (onboardingActive() && !ob.ferdig)
  const ut = { trenger, steg: ob.steg, ferdig: ob.ferdig, arkiv: { ...info, needsChoice, config: CONFIG_FILE }, kandidater, ollama: await ollamaStatus(), mottakere: (await mottakere()).map(({ id, label, aktiv, standard, local, test, modell, hvorfor }) => ({ id, label, aktiv, standard, local: !!local, test: !!test, modell, hvorfor })), home: os.homedir(), platform: process.platform }
  if (medTall) {
    let tall = null
    try { tall = historyCounts({ quick: true }) } catch (e) { tall = { feil: e.message } }
    try { const p = countPrompts(); tall = { ...tall, prompter: p.prompter, prompterØkter: p.økter } } catch {}
    ut.tall = tall
  }
  return ut
}
const prosjektNavn = (p) => { const n = String(p || '').trim().replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '·').replace(/\s+/g, ' ').slice(0, 90); if (!n || n.startsWith('.') || n === 'Ferdig') throw new Error(`«${p}» er ikke et gyldig prosjektnavn`); return n }
const alleProsjekter = () => [...new Set([...load().map((a) => a.project), ...Object.keys(prosjektRegister()), STANDARD_PROSJEKT])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'no'))

// ── /api/open: fast liste (V13) ────────────────────────────────────────────
// spawn med argv — aldri shell. Returnerer { ok, ran } eller kaster med forklaring.
// M18: macOS open · Windows explorer/rundll32 · Linux xdg-open — se platform.js
const run = (kind, target) => openSpawn(kind, target, { dryrun: DRYRUN })
const realpath = (p) => { try { return fs.realpathSync(p) } catch { return null } }
function openTarget(a, target, href) {
  const links = linksFor(a)
  if (target === 'finder') {
    // Lov: atomets egen fil, eller en file-lenke som står på atomet. Må finnes.
    const allowed = [fileOf(a), ...links.filter((l) => l.kind === 'file').map((l) => l.href), ...(a.renders || []).map((r) => r.path)].filter(Boolean).map(realpath).filter(Boolean)
    const want = realpath(href || fileOf(a))
    if (!want || !allowed.includes(want)) throw new Error(`${FILE_MANAGER}: stien er ikke en av atomets egne filer`)
    return run('reveal', want)
  }
  if (target === 'code') {
    // Lov: en repo-lenke på atomet (eller fra prosjektregisteret). Må være en mappe.
    const repos = links.filter((l) => l.kind === 'repo').map((l) => realpath(l.href)).filter((p) => p && fs.statSync(p).isDirectory())
    const cwd = href ? realpath(href) : repos[0]
    if (!cwd || !repos.includes(cwd)) throw new Error('Code: mappa er ikke en repo-lenke på atomet')
    const q = `Hent atom ${a.id} («${a.name}») fra Tua med tua_get(level=M) og fortsett derfra.`
    return run('url', `claude-cli://open?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`)
  }
  throw new Error(`ukjent target «${target}» — broen åpner bare finder og code (V13)`)
}

// Statisk: appen og sandkassen fra dist/. Ingen stier utenfor dist (realpath-sjekk).
// Skive 3: appen er én fil (index.html) med klient-ruting — alle app-rutene får samme fil, og appen leser stien selv (router.jsx).
export const APP_RUTER = ['/', '/forside', '/spor', '/kart', '/oppslag', '/innstillinger', '/start']   // /start: onboardingen (skive 8), kan åpnes igjen fra Innstillinger
const APP_FIL = 'index.html'
function serveStatic(res, pathname) {
  const rel = APP_RUTER.includes(pathname) ? '/' + APP_FIL : pathname === '/sandkasse' ? '/sandkasse.html' : pathname
  const abs = path.normalize(path.join(DIST, rel))
  if (!abs.startsWith(DIST + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    if (!fs.existsSync(path.join(DIST, APP_FIL))) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><meta charset="utf-8"><title>Tua</title><body style="font-family:Georgia;padding:40px;color:#1A1A1A"><h1 style="color:#1F3864">Appen er ikke bygget ennå</h1><p>Kjør <code>cd tua-plugin && npm run kart</code> (bygger appen og starter broen), så last siden på nytt.</p><p>Broen svarer uansett på <code>/api/*</code>.</p></body>')
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ikke funnet')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache' })
  fs.createReadStream(abs).pipe(res)
}
const num = (v, d) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d }

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    try {
      // ── innlogging ──
      if (url.pathname === '/logg-inn') return passwordSet() ? html(res, 200, loginPage('', safeNext(url.searchParams.get('next')))) : redirect(res, '/')
      if (url.pathname === '/logg-ut') { endSession(req); return redirect(res, passwordSet() ? '/logg-inn' : '/', { 'Set-Cookie': CLEAR_COOKIE }) }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const b = await readForm(req)
        if (failedAttempts) await new Promise((r) => setTimeout(r, Math.min(5000, 400 * failedAttempts)))
        if (!checkPassword(b.passord || '')) {
          failedAttempts++
          console.error(`[tua-bro] feil passord (${failedAttempts})`)
          return (req.headers.accept || '').includes('text/html') ? html(res, 401, loginPage('Feil passord.', safeNext(b.next))) : json(res, 401, { error: 'feil passord' })
        }
        failedAttempts = 0
        const tok = newSession()
        console.error('[tua-bro] innlogget')
        return (req.headers.accept || '').includes('text/html') ? redirect(res, safeNext(b.next), { 'Set-Cookie': SESSION_COOKIE(tok) }) : json(res, 200, { ok: true }, { 'Set-Cookie': SESSION_COOKIE(tok) })
      }
      if (!isAuthed(req)) {
        if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'ikke logget inn', login: '/logg-inn' })
        if (url.pathname.startsWith('/assets/')) return serveStatic(res, url.pathname)       // css/js er ikke hemmelig; siden uten data
        return redirect(res, `/logg-inn?next=${encodeURIComponent(url.pathname + url.search)}`)
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname)
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        const all = load().sort((x, y) => y.capturedAt - x.capturedAt)
        const offset = num(url.searchParams.get('offset'), 0), limit = num(url.searchParams.get('limit'), all.length)
        // lenker regnes ut ved lesing, lagres ikke her. ord/tegn per nivå, max og vault (skive 3): det forsiden sender med til Spør om en sak —
        // samme tall som /api/search gir, fra lageret (levelOf), så anslaget i Spør er det samme uansett hvor saken ble valgt. max er L: eget arkiv (V11).
        const atoms = all.slice(offset, offset + limit).map((a) => ({ ...a, links: linksFor(a), file: fileOf(a), ord: Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)])), tegn: Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length])), max: 'L', vault: isVault(a), status: statusOf(a) }))
        return json(res, 200, { atoms, total: all.length, offset, file: ARKIV() })
      }
      if (req.method === 'GET' && url.pathname === '/api/search') {
        const q = url.searchParams.get('q') || ''
        const kind = url.searchParams.get('kind') || undefined
        const alleAtomer = load(), byId = new Map(alleAtomer.map((a) => [a.id, a]))
        const hits = search(alleAtomer, q, {
          context: url.searchParams.get('context') || undefined, project: url.searchParams.get('project') || undefined, kind,
          limit: num(url.searchParams.get('limit'), 50), offset: num(url.searchParams.get('offset'), 0),
        })
        return json(res, 200, {
          q, total: hits.total, offset: num(url.searchParams.get('offset'), 0), ...(kind ? { kind } : {}),
          // ord per nivå kommer fra lageret (levelOf) — Spør-skjermen (skive 2) regner ikke selv, så ordantallet er det samme som motoren sender.
          // Skive 8: prompt-treff bærer hele teksten (tekst), svarene (ga) og modellene de gikk til — forslagene i Spør fyller feltet med ett klikk.
          hits: hits.map(({ atom: a, S, max, score, snippet }) => ({ id: a.id, name: a.name, project: a.project, convo: a.convo, source: a.source, kind: a.kind || 'capture', capturedAt: a.capturedAt, version: a.version || 1, S: S.text, sLevel: S.level, max, vault: isVault(a), status: statusOf(a), ord: Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)])), tegn: Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length])), score, snippet,
            ...(a.kind === 'prompt' ? { tekst: a.content, ga: a.ga || [], modeller: modellerFor(byId, a) } : {}) })),
        })
      }
      if (req.method === 'POST' && url.pathname === '/api/save') {
        const b = await readBody(req)
        if (!b.content || !String(b.content).trim()) return json(res, 400, { error: 'content kreves' })
        const atoms = load()
        const { atom, status } = upsert(atoms, {
          content: String(b.content), name: b.name, source: b.source || 'Claude', project: b.project, convo: b.convo,
          summary: b.summary, short: b.short, medium: b.medium, tags: Array.isArray(b.tags) ? b.tags : [], key: b.key || undefined, by: 'menneske',
        })
        if (status !== 'uendret') save(atoms)
        console.error(`[tua-bro] save ${status} «${atom.name}» ← ${atom.source} · ${atom.project}`)
        return json(res, 200, { atom: { ...atom, links: linksFor(atom), file: fileOf(atom) }, status })
      }
      if (req.method === 'POST' && url.pathname === '/api/open') {
        const { id, target, href } = await readBody(req)
        if (!id || !target) return json(res, 400, { error: 'id og target kreves' })
        const a = load().find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${id}` })
        try {
          const r = await openTarget(a, target, href)
          console.error(`[tua-bro] open ${target} «${a.name}»${DRYRUN ? ' (dryrun)' : ''}: ${r.ran.join(' ')}`)
          return json(res, 200, r)
        } catch (e) {
          console.error(`[tua-bro] open ${target} «${a.name}» AVVIST: ${e.message}`)
          return json(res, 403, { error: e.message })
        }
      }
      // ── M23 (skive 4): sak-panelet — Utlevert, versjoner og status på én sak. Bare metadata fra lageret; motoren røres ikke. ──
      if (req.method === 'GET' && (url.pathname === '/api/utlevert.csv' || (url.pathname === '/api/utlevert' && !url.searchParams.get('id')))) {
        // Skive 5: hele loggen samlet (Innstillinger › Utlevert). Nyeste først, filter på mottaker og dager, limit/offset. Saknavn slås opp i lageret
        // per linje så lista kan vise «saknavn · nivå» — aldri innhold, aldri originaler (V15 regel 3). Linjer fra MCP-døra (id/level) får saker[] av det.
        const alle = utlevertSamlet(url.searchParams.get('mottaker') || '', num(url.searchParams.get('dager'), 0))
        if (url.pathname === '/api/utlevert.csv') {
          const csv = utlevertCsv(alle)
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tua-utlevert-${new Date().toISOString().slice(0, 10)}.csv"`, ...cors })
          return res.end('\ufeff' + csv)
        }
        const limit = num(url.searchParams.get('limit'), 50), offset = num(url.searchParams.get('offset'), 0)
        return json(res, 200, { utlevert: alle.slice(offset, offset + limit), total: alle.length, limit, offset })
      }
      if (req.method === 'GET' && url.pathname === '/api/utlevert') {
        const id = url.searchParams.get('id') || ''
        if (!id) return json(res, 400, { error: 'id kreves' })
        // Hver linje i .tua/utlevering.jsonl som har tatt med saken: motorens sendinger (saker[]) og MCP-døras (id). Nivået som gjelder DENNE saken
        // plukkes ut, så panelet slipper å lete. Linjene har aldri innhold eller originaler (V15 regel 3) — de sendes som de er.
        const utlevert = deliveries(id, num(url.searchParams.get('limit'), 50)).map((e) => ({ ...e, nivå: (Array.isArray(e.saker) && e.saker.find((s) => s && s.id === id)?.level) || e.level || null })).reverse()
        return json(res, 200, { id, utlevert })
      }
      if (req.method === 'GET' && url.pathname === '/api/versions') {
        const id = url.searchParams.get('id') || ''
        if (!id) return json(res, 400, { error: 'id kreves' })
        const a = load().find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${id}` })
        return json(res, 200, { id, version: a.version || 1, versions: versions(id) })
      }
      if (req.method === 'POST' && url.pathname === '/api/status') {
        const { id, status } = await readBody(req)
        if (!id || !status) return json(res, 400, { error: 'id og status kreves' })
        if (!STATUSER.includes(status)) return json(res, 400, { error: `status må være ${STATUSER.join(' eller ')}` })
        const atoms = load()
        const a = atoms.find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${id}` })
        const før = statusOf(a)
        setStatus(a, status)
        save(atoms)                                              // versjonen som før: fila skrives om, forrige tilstand bevares i .tua/versions
        console.error(`[tua-bro] status «${a.name}»: ${før} → ${status}`)
        return json(res, 200, { atom: { ...a, links: linksFor(a), file: fileOf(a), status: statusOf(a) }, før })
      }
      // ── M16 (skive 7): lesere og Innboks ──
      if (req.method === 'GET' && url.pathname === '/api/prosjekter') return json(res, 200, { prosjekter: alleProsjekter() })
      if (req.method === 'GET' && url.pathname === '/api/innboks') {
        const dok = innboksDokumenter().map(({ sti, ...r }) => r)
        return json(res, 200, { sti: INBOX_DIR, dokumenter: dok, eksporter: inboxPending(), lenker: inboxShareFiles().map((p) => path.basename(p)), antall: dok.length, ferdig: ferdigAntall(), formater: Object.values(FORMATER).map((f) => f.label), standard: STANDARD_PROSJEKT, prosjekter: alleProsjekter() })
      }
      if (req.method === 'POST' && ['/api/innboks/kjør', '/api/innboks/kj%C3%B8r', '/api/innboks/kjor'].includes(url.pathname)) {   // ø kommer prosent-kodet fra nettleseren
        const b = await readBody(req)
        let prosjekt = STANDARD_PROSJEKT
        try { if (b.prosjekt) prosjekt = prosjektNavn(b.prosjekt) } catch (e) { return json(res, 400, { error: e.message }) }
        const ctl = new AbortController(); req.on('close', () => ctl.abort())
        const r = await lesInnInnboks({ prosjekt, dryRun: !!b.dryRun, skriver: b.skriver || undefined, klient: 'app', signal: ctl.signal, log: (m) => console.error(`[tua-bro] ${m}`) })
        return json(res, 200, { ...r, filer: r.filer.map(({ sti, ...f }) => f) })
      }
      if (req.method === 'POST' && url.pathname === '/api/les') {
        // Fila kommer som rå kropp (nettleseren: dratt inn i Spør) eller som sti (JSON). Lesing og S/M skjer lokalt; SSE med fremdriften.
        const erJson = (req.headers['content-type'] || '').includes('application/json')
        const b = erJson ? await readBody(req) : {}
        const navn = String(erJson ? b.navn || (b.sti ? path.basename(b.sti) : '') : url.searchParams.get('navn') || '').trim()
        let prosjekt = STANDARD_PROSJEKT
        try { const p = erJson ? b.prosjekt : url.searchParams.get('prosjekt'); if (p) prosjekt = prosjektNavn(p) } catch (e) { return json(res, 400, { error: e.message }) }
        const samtale = String((erJson ? b.samtale : url.searchParams.get('samtale')) || '').trim()
        const skriver = (erJson ? b.skriver : url.searchParams.get('skriver')) || undefined
        let sti = null, data = null
        if (erJson) {
          if (!b.sti) return json(res, 400, { error: 'send {sti} (en fil i hjemmemappa di) som JSON, eller fila som rå kropp med ?navn=' })
          const hjem = fs.realpathSync(os.homedir())
          let abs
          try { abs = fs.realpathSync(path.resolve(String(b.sti).replace(/^~(?=$|\/)/, os.homedir()))) } catch { return json(res, 404, { error: `fant ikke fila ${b.sti}` }) }
          if (!abs.startsWith(hjem + path.sep)) { console.error(`[tua-bro] les AVVIST (utenfor hjemmemappa): ${b.sti}`); return json(res, 403, { error: 'broen leser bare filer i hjemmemappa di' }) }
          if (filesMode() && abs.startsWith(path.join(fs.realpathSync(FILES_ROOT), '.tua') + path.sep)) return json(res, 403, { error: 'arkivets .tua-mappe leses ikke inn' })
          if (!fs.statSync(abs).isFile()) return json(res, 400, { error: `${b.sti} er ikke en fil` })
          sti = abs
        } else {
          if (!navn) return json(res, 400, { error: 'navn kreves (?navn=<filnavn>) når fila sendes som kropp' })
          try { data = await readBytes(req, 50 * 1024 * 1024) } catch (e) { return json(res, 413, { error: e.message }) }
          if (!data.length) return json(res, 400, { error: 'tom kropp — send fila som rå bytes' })
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        const ctl = new AbortController(); req.on('close', () => ctl.abort())
        try {
          const sak = await lesInn(sti, { navn: navn || undefined, data, prosjekt, samtale: samtale || 'Spør', skriver, klient: 'app', signal: ctl.signal, på: hendelse })
          console.error(`[tua-bro] les ${navn || path.basename(sti)} → «${sak.name}» (${sak.id}, ${sak.status}) · ${sak.project} · ${sak.label}${sak.sider ? ` ${sak.sider} sider` : ''} · ${sak.ord.L} ord · S av ${sak.S_av}${sak.skriver?.utlevert ? ' · UTLEVERT' : ''}`)
        } catch (e) {
          console.error(`[tua-bro] les ${navn || sti} FEIL (${e.kode || 'feil'}): ${e.message}`)
          hendelse('feil', { feil: e.message, kode: e.kode || 'feil', ...(e.sider ? { sider: e.sider } : {}) })
        }
        return res.end()
      }
      if (req.method === 'POST' && url.pathname === '/api/flytt') {
        const b = await readBody(req)
        if (!b.id || !b.prosjekt) return json(res, 400, { error: 'id og prosjekt kreves' })
        let p
        try { p = prosjektNavn(b.prosjekt) } catch (e) { return json(res, 400, { error: e.message }) }
        const atoms = load()
        const a = atoms.find((x) => x.id === b.id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${b.id}` })
        const før = a.project
        if (same(før, p)) return json(res, 200, { atom: { ...a, links: linksFor(a), file: fileOf(a), status: statusOf(a) }, før })
        a.project = p
        save(atoms)                                              // lageret flytter fila (index.json husker den gamle stien) — samme som å dra den i Finder
        console.error(`[tua-bro] flytt «${a.name}»: ${før} → ${p}`)
        return json(res, 200, { atom: { ...a, links: linksFor(a), file: fileOf(a), status: statusOf(a) }, før })
      }
      // ── M20a: motoren ──
      if (req.method === 'GET' && url.pathname === '/api/mottakere') return json(res, 200, { mottakere: await mottakere(), trust: { merk: trustScores()._merk || '' } })
      if (req.method === 'POST' && url.pathname === '/api/spor') {
        const b = await readBody(req)
        if (!b.melding || !String(b.melding).trim()) return json(res, 400, { error: 'melding kreves' })
        const mottakerIds = [...new Set([...(Array.isArray(b.mottakere) ? b.mottakere : []), ...(b.mottaker ? [b.mottaker] : [])].map((x) => String(x || '').trim()).filter(Boolean))]
        if (!mottakerIds.length) return json(res, 400, { error: 'mottaker kreves (se /api/mottakere) — én som `mottaker` eller flere som `mottakere: []`' })
        const saker = Array.isArray(b.saker) ? b.saker.filter((s) => s && s.id) : []
        // SSE: hendelsene skrives etter hvert — broen er ren http, ingenting bufrer (K9). Lukker klienten, avbrytes kallet mot mottakeren.
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, data) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`) }
        const ctl = new AbortController()
        req.on('close', () => ctl.abort())
        try {
          const r = await spor({ melding: String(b.melding), saker, mottakere: mottakerIds, prosjekt: b.prosjekt || undefined, samtale: b.samtale || undefined, prompt: b.prompt || undefined, klient: 'app', signal: ctl.signal, på: hendelse })
          if (Array.isArray(r.svar)) console.error(`[tua-bro] spor → ${mottakerIds.join('+')} · ${saker.length} saker · ${r.svar.length} svar${r.feilet?.length ? ` · ${r.feilet.length} feilet` : ''} · forskjeller ${r.forskjeller ? (r.forskjeller.tilgjengelig ? `${r.forskjeller.enig.length}/${r.forskjeller.uenig.length}/${r.forskjeller.unikt.length} (${r.forskjeller.vurdert_av})` : 'ikke tilgjengelig') : '—'} · konklusjon ${r.konklusjon?.id || '—'}`)
          else console.error(`[tua-bro] spor → ${mottakerIds[0]} · ${saker.length} saker · svar ${r.svar} · tokens ca. ${r.tokens.ca}${r.tokens.inn != null ? ` (eksakt ${r.tokens.inn}+${r.tokens.ut})` : ''}`)
        } catch (e) {
          const blokkert = e instanceof Blokkert
          console.error(`[tua-bro] spor → ${mottakerIds.join('+')} ${blokkert ? 'BLOKKERT' : 'FEIL'}: ${e.message}`)
          hendelse(blokkert ? 'blokkert' : 'feil', { feil: e.message, ...(blokkert ? { detaljer: e.detaljer, ...(e.mottaker ? { mottaker: e.mottaker } : {}) } : {}) })
        }
        return res.end()
      }
      // ── M20b (skive 6): konklusjonen — rettelse eller «kjør igjen». Alt gjennom motoren; låsing er /api/status. ──
      if (req.method === 'POST' && url.pathname === '/api/konklusjon') {
        const b = await readBody(req)
        if (b.id && b.tekst != null) {
          try { const k = rettKonklusjon({ id: String(b.id), tekst: String(b.tekst) }); console.error(`[tua-bro] konklusjon ${k.id} rettet (${k.endret}, v${k.version})`); return json(res, 200, { konklusjon: k }) }
          catch (e) { return json(res, e.message.startsWith('fant ikke') ? 404 : 400, { error: e.message }) }
        }
        if (!b.prompt) return json(res, 400, { error: 'send {id, tekst} for å rette utkastet, eller {prompt, svar?: [ids]} for å kjøre vurderingen igjen' })
        const atoms = load()
        const p = atoms.find((a) => a.id === b.prompt)
        if (!p) return json(res, 404, { error: `fant ikke sak ${b.prompt}` })
        const svar = svarFor(atoms, p.id, Array.isArray(b.svar) ? b.svar : null)
        if (!svar.length) return json(res, 400, { error: 'prompten har ingen svar-saker å konkludere ut fra' })
        const ctl = new AbortController(); req.on('close', () => ctl.abort())
        try {
          const f = svar.length > 1 ? await forskjeller(svar, { melding: p.content, prosjekt: b.prosjekt || p.project, klient: 'app', signal: ctl.signal }) : { tilgjengelig: false, grunn: 'Forskjeller vises bare når mer enn én har svart.', enig: [], uenig: [], unikt: [] }
          const k = await konklusjon({ prompt: p.id, svar, forskjeller: f.tilgjengelig ? f : null, melding: p.content, prosjekt: b.prosjekt || p.project, samtale: p.convo || undefined, klient: 'app', signal: ctl.signal })
          console.error(`[tua-bro] konklusjon kjørt igjen for ${p.id} · ${svar.length} svar · ${k.tilgjengelig ? `utkast ${k.id} v${k.version} (${k.mottaker})` : `ikke tilgjengelig: ${k.grunn}`}`)
          return json(res, 200, { forskjeller: f, konklusjon: k })
        } catch (e) { console.error(`[tua-bro] konklusjon FEIL: ${e.message}`); return json(res, e instanceof Blokkert ? 403 : 500, { error: e.message }) }
      }
      // ── Skive 8 (M19): datasettet — én JSONL-linje per konklusjon. Lokal fil, ingen Utlevert-linje (ingenting går ut). ──
      if (req.method === 'GET' && url.pathname === '/api/datasett.jsonl') {
        const rader = datasett(load(), { bareLaast: ['1', 'true'].includes(url.searchParams.get('laast') || '') })
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="tua-datasett-${new Date().toISOString().slice(0, 10)}.jsonl"`, 'X-Tua-Rader': String(rader.length), ...cors })
        console.error(`[tua-bro] datasett: ${rader.length} konklusjoner → jsonl (lokal fil, ikke utlevering)`)
        return res.end(rader.map((r) => JSON.stringify(r)).join('\n') + (rader.length ? '\n' : ''))
      }
      // ── Skive 8 (M14): onboardingen i appen — tre steg, tilstanden i ~/.tua/config.json ──
      if (req.method === 'GET' && url.pathname === '/api/onboarding') return json(res, 200, await onboardingView({ medTall: ['1', 'true'].includes(url.searchParams.get('tall') || '') }))
      if (req.method === 'POST' && url.pathname === '/api/onboarding') {
        const b = await readBody(req)
        if (!ONBOARDING_STEG.includes(b.steg)) return json(res, 400, { error: `steg må være ${ONBOARDING_STEG.join(', ')}` })
        const ob = onboardingLes()
        let arkivSvar = null
        if (b.steg === 'arkiv') {
          if (b.sted || b.sti) {
            // samme som Innstillinger › Arkivsted: valget lagres, mappa lages om den mangler (velkomstsak + Innboks), INGENTING flyttes (V9)
            const before = archiveInfo().root
            let r
            try { r = chooseArchive(b.sti || b.sted) } catch (e) { return json(res, 400, { error: e.message }) }
            arkivSvar = { ok: true, arkiv: archiveInfo(), created: r.created, before, restart: !!before && before !== r.root }
            console.error(`[tua-bro] onboarding: arkivsted ${r.created ? 'opprettet' : 'valgt'}: ${r.root} (${r.label})${before && before !== r.root ? ` — før: ${before}; ingenting flyttet` : ''}`)
          } else if (!FILES_ROOT) return json(res, 400, { error: 'velg et sted (sted eller sti) — arkivet er ikke valgt ennå' })
        }
        ob.steg = { ...ob.steg, [b.steg]: { at: new Date().toISOString(), ...(b.verdi ? { verdi: String(b.verdi) } : {}) } }
        if (ONBOARDING_STEG.every((s) => ob.steg[s]) && !ob.ferdig) { ob.ferdig = new Date().toISOString(); finishOnboarding('app') }
        writeConfig({ onboarding: ob })
        console.error(`[tua-bro] onboarding: steg ${b.steg} fullført${b.verdi ? ` (${b.verdi})` : ''}${ob.ferdig ? ' · alle tre steg ferdig' : ''}`)
        return json(res, 200, { ...(await onboardingView()), ...(arkivSvar ? { arkivSvar } : {}) })
      }
      // ── Skive 8 (M14): import med fremdrift — SSE rundt importAlt (import.js). Samme funksjoner som tua_import; ingen logikk her. ──
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const b = await readBody(req)
        const kilde = String(b.kilde || 'alt')
        if (kilde !== 'alt' && !IMPORT_STEG.some(([k]) => k === kilde)) return json(res, 400, { error: `kilde må være alt eller en av ${IMPORT_STEG.map(([k]) => k).join(', ')}` })
        if (!filesMode()) return json(res, 400, { error: 'arkivet er ikke valgt ennå — velg arkivsted først (steg 2)' })
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        const dryRun = !!b.dryRun
        const tall = { nye: 0, oppdatert: 0, svar: 0, prompter: 0, dokumenter: 0, samtaler: 0, feil: 0 }
        try {
          const r = await importAlt({ dryRun, kilder: kilde === 'alt' ? null : [kilde], log: (m) => { console.error(`[tua-bro] import: ${m}`); hendelse('logg', { tekst: String(m) }) },
            på: (ev, d) => { if (ev === 'del' && d.stats) { for (const k of Object.keys(tall)) if (typeof d.stats[k] === 'number') tall[k] += d.stats[k]; if (typeof d.stats.økter === 'number') tall.samtaler += d.stats.økter; if (typeof d.stats.samtaler === 'number') tall.samtaler += d.stats.samtaler } hendelse(ev, d) } })
          console.error(`[tua-bro] import ${kilde}${dryRun ? ' (dry-run)' : ''}: ${tall.nye} nye · ${tall.oppdatert} oppdatert · ${tall.prompter} prompter · ${tall.svar} svar`)
          hendelse('ferdig', { kilde, dryRun, tall, report: r.report })
        } catch (e) { console.error(`[tua-bro] import FEIL: ${e.message}`); hendelse('feil', { feil: e.message }) }
        return res.end()
      }
      // ── M15: innstillinger ──
      if (req.method === 'GET' && url.pathname === '/api/settings') return json(res, 200, await settingsView())
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const b = await readBody(req)
        if (b.arkiv && (b.arkiv.sted || b.arkiv.sti)) {
          // Bytte av arkivsted: valget lagres og mappa lages om den ikke finnes. INGEN filer flyttes (V9) — det gjør brukeren i Finder.
          const before = archiveInfo().root
          let r
          try { r = chooseArchive(b.arkiv.sti || b.arkiv.sted) } catch (e) { return json(res, 400, { error: e.message }) }
          console.error(`[tua-bro] arkivsted ${r.created ? 'opprettet' : 'valgt'}: ${r.root} (${r.label})${before && before !== r.root ? ` — før: ${before}; ingenting flyttet` : ''}`)
          return json(res, 200, { ok: true, arkiv: archiveInfo(), created: r.created, before, restart: before !== r.root })
        }
        if (b.finder && Array.isArray(b.finder.folders)) {
          try { const list = setFinderFolders(b.finder.folders); console.error(`[tua-bro] Finder-mapper: ${list.join(' · ')}`); return json(res, 200, { ok: true, folders: list, restart: true }) } catch (e) { return json(res, 400, { error: e.message }) }
        }
        return json(res, 400, { error: 'send {arkiv: {sted|sti}} eller {finder: {folders: [...]}}' })
      }
      if (url.pathname === '/api/keychain' && (req.method === 'POST' || req.method === 'DELETE')) {
        const { provider, key } = await readBody(req)
        if (!isProvider(provider)) return json(res, 400, { error: `ukjent leverandør — en av ${PROVIDERS.filter((p) => !p.local).map((p) => p.id).join(', ')}` })
        if (req.method === 'DELETE') { const ok = deleteKey(provider); console.error(`[tua-bro] keychain ${provider}: ${ok ? 'fjernet' : 'fantes ikke'}`); return json(res, 200, { ok, provider, satt: false }) }
        try { await setKey(provider, key) } catch (e) { return json(res, 400, { error: e.message }) }   // nøkkelen logges aldri — bare leverandøren
        console.error(`[tua-bro] keychain ${provider}: satt`)
        return json(res, 200, { ok: true, provider, satt: true })
      }
      const isLink = url.pathname === '/api/link'
      if (req.method === 'POST' && (isLink || url.pathname === '/api/unlink')) {
        const { id, project, level } = await readBody(req)
        if (!id || !project) return json(res, 400, { error: 'id og project kreves' })
        if (level && !['S', 'M', 'L'].includes(level)) return json(res, 400, { error: 'level må være S, M eller L' })
        const atoms = load()
        const a = atoms.find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke atom ${id}` })
        const p = String(project).trim()
        a.refs = a.refs || []
        if (isLink) {
          if (same(a.project, p)) return json(res, 200, { atom: a })      // oppsto her — ser alt
          if (!a.refs.some((r) => same(r, p))) a.refs.push(p)
          if (level) setShare(a, p, level)                                 // nivå bor på referansen (V11)
        } else {
          a.refs = a.refs.filter((r) => !same(r, p))
          setShare(a, p, 'L')
        }
        save(atoms)
        console.error(`[tua-bro] ${isLink ? 'link' : 'unlink'} «${a.name}» ${isLink ? '→' : '⤫'} ${p}${level ? ` (${level})` : ''}`)
        return json(res, 200, { atom: { ...a, status: statusOf(a) } })
      }
      return json(res, 404, { error: 'ukjent rute' })
    } catch (e) {
      return json(res, 500, { error: String(e?.message || e) })
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    const built = fs.existsSync(path.join(DIST, APP_FIL))
    console.error(`[tua-bro] appen: http://127.0.0.1:${PORT}/${built ? '' : ' (ikke bygget — npm run kart)'} (forsiden · /spor · /oppslag · /kart · /innstillinger · /sandkasse; POST /api/spor, mottakere: /api/mottakere) · arkiv: ${ARKIV()} · ${passwordSet() ? 'passord: på (logg inn på /logg-inn)' : 'passord: AV — sett med «node bridge.js --sett-passord»'} · dev-origin: ${ORIGIN}${DRYRUN ? ' · DRYRUN' : ''}`)
    const log = (m) => console.error(`[tua-bro] ${m}`)
    if (process.env.TUA_BRIDGE_VAKTER !== '0') { watchInbox({ log }); watchDesktop({ log, delayMs: 8000 }); watchFinder({ log }) }     // M17: samme vakter som MCP-serveren; fil-låsen i save() holder dem fra hverandre
  })
