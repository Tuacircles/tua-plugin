#!/usr/bin/env node
// bridge.js — Tua som egen lokal app (M12, M22): én prosess som både serverer
// appen (ferdigbygd fra tua2-sandbox/dist) og er broen til det EKTE arkivet
// (mappa ~/Dropbox/Tua, samme som MCP-serveren bruker).
//
//   GET  /  /spor  /oppslag  /innboks  /innstillinger → appen (dist/index.html, skive 3: én app med klient-ruting; siden runde 2 (arb. 32) sender appen /spor, /oppslag, /forside og /innboks til / — ett sted)
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
//   Runde 2d (03-avisen §2–§5): /api/atoms gir `klasse` (arbeid · spor · drift · tråd), `vekt`, `sist_rørt`, `beholdt`, `drift` per sak og `tråden` samlet på prompt-saker,
//   pluss `klasser` (tall per klasse for hele arkivet); /api/search har ?drift=uten|med|bare og svarer med `driftUtenfor` og `klasse` per treff.
//   Nye ruter nederst: POST /api/behold {id} · POST /api/bruk {id, hendelse} · GET /api/siden-sist?dager.
//   Friksjon 16: /api/atoms og /api/siden-sist gir `ulest` per sak (fra bruk.jsonl og siste «sett alt»); POST /api/bruk {hendelse: 'sett'} · POST /api/sett-alt (nederst).
//   POST /api/bruk {hendelse: 'fjernet'} tar linja ut av /api/siden-sist (spørsmål, svar, konklusjon, Claude-økt) til noe nytt skjer i den.
//   Passord (valgfritt): `node bridge.js --sett-passord` setter et passord (scrypt-hash i <arkiv>/.tua/passord.json).
//   Da krever alt — appen og /api/* — innlogging på /logg-inn (HttpOnly-cookie, 30 dager). `--fjern-passord` fjerner det.
//   /api/* svarer da 401 { error, login: '/logg-inn' } og appen sender brukeren til /logg-inn?next=… (skive 3); sider omdirigeres dit direkte.
//   Uten passord er alt åpent som før, men bare for programmer på denne maskinen (127.0.0.1).
//   POST /api/save   {content, name?, source?, project?, convo?, summary?, short?, medium?, tags?, key?}
//                    → M11: lagrer et atom i mappa (Demo 7 «fang» over det ekte arkivet). S/M merkes menneskeskrevet.
//   POST /api/open   {id, target, href?}      → M9/V13: åpner LOKALT, bare fra en fast liste:
//        target = 'finder' → `open -R <fil>`  (fila må være atomets egen .md, en av atomets file-lenker, eller — friksjon 13 — en sti som står
//                            ordrett i sakens tekst, i hjemmemappa; uten id finner broen saken som nevner stien)
//        target = 'code'   → `open claude-cli://open?cwd=<repo>&q=…`  (repo må være en repo-lenke på atomet / i prosjektregisteret)
//        Ingen andre programmer, ingen shell, ingen frie stier. `claude://`-lenker (Desktop-prosjekt) åpnes
//        rett fra nettleseren og går aldri via broen.
//   Innstillinger (M15) er ruta /innstillinger i appen: arkivsted, sky-connectors, AI-connectors (BYOK), Finder-mapper
//   GET  /api/settings           → { arkiv, steder, sky, ai, finder, trust } — aldri nøkkelverdier, bare «satt / ikke satt»
//   POST /api/settings {arkiv: {sted|sti}} | {finder: {folders}}  → velger arkivsted (flytter ingenting, V9) / Finder-mapper. Samme ~/.tua/config.json som tua_setup.
//   POST /api/keychain {provider, key}   → nøkkelen inn i macOS Keychain (security, uten shell, via stdin — aldri fil, aldri logg)
//   DELETE /api/keychain {provider}      → nøkkelen ut av Keychain
//   Trust Score per connector leses fra trust-scores.json (anslag — rettes der, uten kode).
//   Friksjon 12 (24.10.2026, bruksdag 1): Ollama-modeller fra Innstillinger — bare Ollama-serverens HTTP-API (ollama.js), aldri appens GUI.
//   GET  /api/ollama/modeller    → { kjører, vert, maskin: {minneGB, chip, ledigGB}, lokale: [{navn, størrelseGB, parametre, standard}], standard: {modell, kilde},
//        anbefalte: [{navn, størrelseGB, krevMinneGB, norsk, passerTil, hvorfor, passer: ja|trangt|nei, hvorforIkke, lokal, anbefalt}], start }
//   POST /api/ollama/hent {navn} → SSE: fremdrift {status, prosent, mb, mbTotal} … ferdig {navn, modeller} | feil {feil}. Nedlasting fra ollama.com via Ollama (/api/pull).
//   POST /api/ollama/standard {navn} → { ok, modell, mottakere }   valgt modell i ~/.tua/config.json (ollama.modell) — motoren bruker den straks
//   DELETE /api/ollama/modeller/<navn> → { ok, navn, varStandard, modeller }   Ollama /api/delete; var den standard, faller Tua tilbake til den første
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
//   GET  /api/innboks/antall { antall, dokumenter: [navn] }   bare tellingen — app-hodet (Innboks N) og forsidens linje «N filer i Innboks» (friksjonsrunde 1); /innboks er app-rute
//   POST /api/flytt          {id, prosjekt} → { atom }   flytter saken til et annet prosjekt (fila flyttes av lageret — det samme som å dra den i Finder, V9)
//   M19 + M14 (skive 8): prompter som førsteklasses saker, datasettet og onboardingen i appen.
//   GET  /api/search?kind=prompt   bare saker av én type; prompt-treff har også `tekst` (hele prompten), `ga` og `modeller` — til forslagene i Spør og Prompter-visningen
//   POST /api/spor  {…, prompt: <id>}   «Kjør igjen»: svaret kobles til DENNE prompt-saken (ga vokser; ny versjon bare når teksten er endret). Uten prompt: nøkkel på teksten.
//   Friksjonsrunde 1 — Spør (24.10, bruksdag 1):
//   POST /api/spor  {…, prosjekt}  prosjekt KREVES (400 uten) — det er brukerens synlige valg i Spør; prompt-, svar-, forskjeller- og konklusjon-sakene lander der
//   POST /api/spor  {…, kjøring: <id>} + POST /api/spor/stopp {kjøring} → avbryter kallet mot mottakeren(e); det som kom, lagres som svar merket avbrutt
//        (tagg `avbrutt`), event: ferdig {…, avbrutt: true}; kom ingenting: event: feil {avbrutt: true}. SSE-rekkefølgen ellers uendret.
//   POST /api/prosjekter {navn} → { prosjekt, ny, prosjekter }   nytt prosjekt = ny mappe i arkivet (V9); GET /api/prosjekter tar også med tomme mapper
//   GET  /api/sak?id=<sak>  → { id, name, project, kind, …, ord, tegn, nivåer: {S,M,L: {tekst, fallback, av}} }   én sak med teksten per nivå (kilde-raden i Spør som åpnes)
//   GET  /api/datasett.jsonl[?laast=1]  én linje per konklusjon (V21 nivå 2): {prompt_id, prompt, kilder:[{id, nivå}], svar:[{mottaker, tekst_id}], forskjeller_id, konklusjon_id,
//        konklusjon, laast, versjon, dato} — id-er, prompt- og konklusjonsteksten; aldri svartekster, aldri koblingen plassholder → original. Lokal fil, logges ikke som Utlevert.
//   GET  /api/onboarding[?tall=1]  tilstand (vis/trenger/steg/ferdig), arkiv + kandidater (archiveOptions), Ollama-status, mottakere; med tall=1 også tallene til steg 3
//        (historyCounts + prompter). Tilstanden bor i ~/.tua/config.json under `onboarding` — den må finnes før arkivet er valgt.
//   POST /api/onboarding {steg: modell|arkiv|historikk, sted?|sti?, verdi?} → steget fullført (arkiv: chooseArchive, ingenting flyttes, V9); alle tre → ferdig
//   POST /api/import {kilde: alt|code|cowork|desktop|finder|innboks, dryRun?} → SSE: start {kilde,label} · del {kilde,label,stats,report|feil} · ferdig {report, tall} · feil {feil}
//        — importAlt i import.js (samme funksjoner som tua_import), stegvis så fremdriften vises mens neste kilde leses
//   Runde 2c (arbeidsstykke 32 §5 spørsmål 1, Erik 24.10.2026: enig) — Fanget-bøtta, serverdelen. Det hooks og import fanger av seg selv (økt, prompt, svar,
//   samtale) har `fanget: true` i frontmatter og står utenfor avisen og søket til brukeren løfter det inn. /api/atoms gir feltet `fanget` (true når satt — appen
//   holder dem utenfor avisen); /api/search holder dem utenfor som standard (?fanget=med tar dem med, ?fanget=bare gir bare dem; `fangetUtenfor` = hvor mange traff).
//   GET  /api/fanget?limit&offset&prosjekt → { saker, total, alle, offset, limit, perKilde, perProsjekt, perSlag }  nyeste først, lette rader (S, aldri L)
//   POST /api/fanget/behold {id, prosjekt?} → { atom, før, flyttet }        flagget bort; med prosjekt flyttes saken dit (lageret flytter fila, som /api/flytt)
//   POST /api/fanget/slaa-sammen {id, inn_i} → { atom, kastet }             innholdet legges nederst i inn_i som NY versjon med kildepeker (bygget_av); den fangede → papirkurv
//   POST /api/fanget/kast {id} → { kastet }                                 fila til <arkiv>/.tua/papirkurv/<prosjekt>/ med indeks — aldri slett
//   POST /api/fanget/angre {id} → { atom }                                  fila tilbake fra papirkurven dit den lå
//   GET  /api/papirkurv → { saker: [{id, name, project, kind, source, at, grunn, innI?}], antall }
//   POST /api/fanget/merk {dryRun} → SSE start · tall · skriver · slutt     engangs-merkingen fra Innstillinger › Arkiv (runde 2c app) — samme regel som review.js --fanget
//   POST /api/arkiv/merk {hva: drift|fanget|begge, dryRun} → SSE start · tall {hva: drift} · tall {hva: fanget} · skriver · slutt {drift, fanget, klasser}   friksjon 15: «Merk arkivet
//        (drift, så fanget)» — review --drift og så --fanget i én strøm (drift først, så byggeøkter ikke havner i Fanget-bøtta); /api/fanget/merk er det samme med hva: fanget.
//   GET  /api/niva?mottaker=a,b&id=<sak>  → { per: {a: 'L', b: 'M'}, felles: 'M', vault }   friksjon 15: standardnivået en sak får som kilde — regelen i motoren (standardNivå)
//   POST /api/spor/forhandsvis {melding?, saker, mottakere|mottaker, prosjekt?} → det `skjermet` ville sagt (tekst, tokens, skjermet, saker med nivå) + `blokkert` — ingenting sendes/logges
//   POST /api/konklusjon {…, strøm: true} → SSE (vurderer, vurderer-del, forskjeller, konklusjon-del, konklusjon, slutt) — fremdrift for «Også til …» (runde 2c app)
//   Engangs-merking av det som alt ligger i arkivet: node server/review.js --fanget --dry-run (viser), --fanget (setter). Alt via lageret (store.js), ingen rå filflytting.
//
// Lytter kun på 127.0.0.1, og slipper bare kartets origin inn (CORS).
// Kjør: npm run bridge   (i tua-plugin/). Ingen avhengigheter.
// TUA_OPEN_DRYRUN=1 → /api/open svarer med hva den ville kjørt, uten å kjøre det (test).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { openSpawn, FILE_MANAGER, HOME } from './platform.js'   // M18: «Åpne i …» på macOS, Windows og Linux · HOME: hjemmemappa (TUA_HOME i tester)
import os from 'node:os'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { load, save, setShare, upsert, search, levelOf, LEVELS, isVault, FILE, FILES_ROOT, DATA_DIR, filesMode, linksFor, fileOf, ensureArchive, archiveOptions, archiveInfo, chooseArchive, finderFolders, FINDER_DEFAULTS, setFinderFolders, CONFIG_FILE, deliveries, versions, statusOf, setStatus, STATUSER, readConfig, writeConfig, onboardingActive, finishOnboarding } from './store.js'
import { watchInbox, watchDesktop, importAlt, IMPORT_STEG, historyCounts, countPrompts } from './import.js'      // M14: Innboks — eksporter som legges i mappa blir atomer · M17: Desktop-cachen · skive 8: import med fremdrift
import { watchFinder } from './finder.js'                   // M17: dokumenter med AI-opphav, ved referanse
import { PROVIDERS, isProvider, keyStatus, setKey, deleteKey, ollamaStatus } from './keychain.js'   // M15: BYOK — nøkler i Keychain, aldri her
import { modeller as ollamaModeller, hent as ollamaHent, fjern as ollamaFjern, settStandard as ollamaStandard, lokale as ollamaLokale } from './ollama.js'   // friksjon 12: modellene i Ollama
import { spor, mottakere, trustScores, Blokkert, MotorFeil, ord, forskjeller, konklusjon, rettKonklusjon, svarFor, forhåndsvis, standardNivåer } from './motor.js'   // M20a/M20b: motoren — eneste vei ut til en modell
import { lesInn, lesInnInnboks, innboksDokumenter, ferdigAntall, FORMATER, STANDARD_PROSJEKT } from './innlesing.js'   // M16 (skive 7): fil → sak med S/M/L, Innboks
import { inboxPending, inboxShareFiles } from './import.js'
import { projects as prosjektRegister, INBOX_DIR, deliveryCounts, tråder } from './store.js'   // runde 1 (arb. 32 §6): utlevert-teller og Spørs tråder til appen
import { behold as fangetBehold, slåSammen as fangetSlåSammen, kast as fangetKast, angre as fangetAngre, papirkurv as fangetPapirkurv, fangetKandidater, slagAvNøkkel, driftKandidater, driftSlag } from './store.js'   // runde 2c: Fanget-bøtta (+ app: engangs-merkingen)
import { klasseAv, tellKlasser, vekt, sistRørt, trådSamlet, brukInfo, deliveryInfo, logBruk, BRUK_HENDELSER, claudeØkter } from './store.js'   // runde 2d (03-avisen §2–§5): klasser, vekt, tråden samlet, bruk-loggen, Claude-øktene
import { ulestAv, ulestFra, logSettAlt, settAltSist, fjernetAv } from './store.js'   // friksjon 16: ulest fra bruk-loggen og siste «sett alt»; fjernet (× i Siden sist)
import { projectAliases } from './store.js'   // runde 2d (app), friksjon 14: filer i prosjektmappa som ikke er saker, og aliasene til prosjekt-treffet i søket
import { flytt as ryddFlytt, giNyttNavn, tømPapirkurv, ryddeforslag, sisteSave } from './store.js'   // runde 3c: rydding på saken, papirkurv, Tua foreslår — én skriver i lageret
import { gjennomgang, planFor, NIVÅER_GJENNOMGANG } from './gjennomgang.js'   // runde 3c: Ny gjennomgang (AI3) — S/M på nytt med valgt modell, aldri menneskeskrevet
ensureArchive()                                             // M14: første kjøring — lag arkivet om det ikke finnes
const ARKIV = () => (filesMode() ? FILES_ROOT : FILE)
const sakSvar = (a) => ({ ...a, links: linksFor(a), file: fileOf(a), status: statusOf(a), klasse: klasseAv(a) })   // runde 3c: én form på saken tilbake fra rydde-rutene
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
// Friksjonsrunde 1 (friksjon 6): også tomme prosjektmapper i arkivet telles som prosjekter (et nytt prosjekt fra Spør er en mappe før det har saker, V9).
const prosjektMapper = () => { if (!filesMode()) return []; try { return fs.readdirSync(FILES_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'Innboks').map((e) => e.name) } catch { return [] } }
const alleProsjekter = () => [...new Set([...load().map((a) => a.project), ...Object.keys(prosjektRegister()), ...prosjektMapper(), STANDARD_PROSJEKT])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'no'))
// Nytt prosjekt = ny mappe i arkivet (V9: mappa er sannheten). Navnet må være et mappenavn: ingen skråstrek, ikke punktum først, ≤ 80 tegn.
export function nyttProsjekt(navn) {
  const n = String(navn || '').replace(/\s+/g, ' ').trim()
  if (!n || n.length > 80 || /[\/\\:\0]/.test(n) || n.startsWith('.') || n === '..') throw new Error('prosjektnavn må være et mappenavn: 1–80 tegn, uten skråstrek eller kolon, ikke punktum først')
  const finnes = alleProsjekter().find((p) => p.toLowerCase() === n.toLowerCase())
  if (finnes) return { prosjekt: finnes, ny: false }
  if (filesMode()) fs.mkdirSync(path.join(FILES_ROOT, n), { recursive: true })
  return { prosjekt: n, ny: true }
}
// Kjøringer som kan stoppes (friksjon 8, «Stopp»): klienten sender `kjøring: <id>` med POST /api/spor og kaller POST /api/spor/stopp {kjøring}.
const kjøringer = new Map()

// ── /api/open: fast liste (V13) ────────────────────────────────────────────
// spawn med argv — aldri shell. Returnerer { ok, ran } eller kaster med forklaring.
// M18: macOS open · Windows explorer/rundll32 · Linux xdg-open — se platform.js
const run = (kind, target) => openSpawn(kind, target, { dryrun: DRYRUN })
const realpath = (p) => { try { return fs.realpathSync(p) } catch { return null } }
// Friksjonsrunde 1, friksjon 13 (24.10.2026): en sti som står i sakens egen tekst (en lenkeliste, et notat med «alle under <mappe>/») kan vises i
// Finder. Ingen frie stier (V13): stien må stå ordrett i teksten — hele, eller mappa og filnavnet hver for seg (lenkelister skriver mappa én gang
// og filnavnene under; «X.pdf/.docx» gir stammen + endelsen) — ligge i hjemmemappa, utenfor arkivets .tua, og finnes. Bare «vis i Finder», aldri kjør.
export function stiISak(a, want, href) {
  const tekst = String(a.content || '')
  if (!tekst) return false
  const hjem = realpath(HOME)
  if (!hjem || !(want.startsWith(hjem + path.sep))) return false
  if (want.includes(`${path.sep}.tua${path.sep}`)) return false
  const kandidater = [String(href || ''), want].filter(Boolean)
  for (const k of kandidater) {
    if (tekst.includes(k)) return true
    const dir = path.dirname(k), navn = path.basename(k), stamme = navn.replace(/\.[^.]+$/, ''), ext = path.extname(navn).slice(1)
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const mappa = tekst.includes(dir + '/') || tekst.includes(dir + path.sep) || tekst.includes(dir)
    const dobbel = stamme && ext && new RegExp(`${esc(stamme)}\\.[A-Za-z0-9]+/\\.${esc(ext)}(?![A-Za-z0-9])`).test(tekst)   // «X.pdf/.docx» nevner X.docx
    if (mappa && (tekst.includes(navn) || dobbel)) return true
  }
  return false
}
function openTarget(a, target, href) {
  const links = linksFor(a)
  if (target === 'finder') {
    // Lov: atomets egen fil, en file-lenke som står på atomet, eller (friksjon 13) en sti saken selv nevner i teksten. Må finnes.
    const allowed = [fileOf(a), ...links.filter((l) => l.kind === 'file').map((l) => l.href), ...(a.renders || []).map((r) => r.path)].filter(Boolean).map(realpath).filter(Boolean)
    const want = realpath(href || fileOf(a))
    if (!want || !(allowed.includes(want) || (href && stiISak(a, want, href)))) throw new Error(`${FILE_MANAGER}: stien er verken en av atomets egne filer eller nevnt i sakens tekst${want ? '' : ' (eller fila finnes ikke)'}`)
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
export const APP_RUTER = ['/', '/forside', '/spor', '/oppslag', '/innstillinger', '/start', '/innboks']   // /start: onboardingen (skive 8), kan åpnes igjen fra Innstillinger · /innboks: Innboks som egen side (friksjon 5) · /kart er borte (runde 1, arb. 32 §6) — Demo 8 bare under /sandkasse
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
const mtimeAv = (f) => { try { return Math.round(fs.statSync(f).mtimeMs) } catch { return null } }
const num = (v, d) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d }

// ── Runde 2d (app), friksjon 14 (Erik 24.10.2026): filene i en prosjektmappe som ikke er saker — PDF, HTML, docx, bilder, løse .md uten Tua-frontmatter.
// Bare lesing, bare innenfor arkivroten (realpath), aldri .tua eller skjulte filer, aldri symlenker, inntil 3 nivåer og 500 filer per mappe.
const FORMAT_AV = { pdf: 'pdf', html: 'html', htm: 'html', docx: 'docx', doc: 'docx', xlsx: 'xlsx', xls: 'xlsx', pptx: 'pptx', png: 'bilde', jpg: 'bilde', jpeg: 'bilde', gif: 'bilde', heic: 'bilde', webp: 'bilde', svg: 'bilde', txt: 'tekst', md: 'markdown', csv: 'csv', json: 'json', zip: 'arkiv' }
const formatAv = (navn) => { const e = path.extname(navn).slice(1).toLowerCase(); return FORMAT_AV[e] || e || 'fil' }
const prosjektMappe = (navn) => {   // mappa til et prosjekt, bare innenfor arkivroten — ellers null
  const n = String(navn || '').trim()
  if (!filesMode() || !n || n.startsWith('.') || /[\/\\\0]/.test(n) || n === 'Innboks') return null
  const rot = realpath(FILES_ROOT), dir = realpath(path.join(FILES_ROOT, n))
  try { return rot && dir && dir.startsWith(rot + path.sep) && fs.statSync(dir).isDirectory() ? { rot, dir } : null } catch { return null }
}
function filerIMappe(navn, { maks = 500, dybde = 3 } = {}) {
  const m = prosjektMappe(navn); if (!m) return null
  const ut = []
  const gå = (dir, rel, d) => {
    if (ut.length >= maks || d > dybde) return
    let e = []; try { e = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const x of e) {
      if (ut.length >= maks) return
      if (x.name.startsWith('.') || x.isSymbolicLink()) continue
      const abs = path.join(dir, x.name), r = rel ? path.join(rel, x.name) : x.name
      if (x.isDirectory()) { gå(abs, r, d + 1); continue }
      if (!x.isFile()) continue
      if (x.name.toLowerCase().endsWith('.md')) continue   // alle .md i mappa er saker (lageret leser dem, også uten Tua-frontmatter) — de står i /api/atoms, ikke her
      let st; try { st = fs.statSync(abs) } catch { continue }
      ut.push({ navn: x.name, sti: r, format: formatAv(x.name), bytes: st.size, mtime: Math.round(st.mtimeMs) })
    }
  }
  gå(m.dir, '', 0)
  return { dir: m.dir, filer: ut.sort((a, b) => b.mtime - a.mtime) }
}

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
        // Runde 1 (arb. 32 §6): tråd = prompt-id for Spørs biprodukter (svar, Forskjeller, konklusjon — og prompten selv), så avisen, Oppslag og søket viser dem som én;
        // utlevert = antall sendinger saken har vært med i (forsidens hovedsak = mest arbeidet med siste døgn). Bare tellinger.
        // Runde 2d (03-avisen §2–§4): klasse (arbeid · spor · drift · tråd), vekt og sist_rørt per sak; `tråden` samlet på prompt-saken ({svar, forskjeller, konklusjon, åpen, …}).
        // `tråd` er fortsatt prompt-id (streng) på alle sakene i en tråd — appen (regler.slåSammenTråder) leser den slik; det samlede objektet har eget navn så ingenting brekker.
        const { av: trådAv, per: trådPer } = trådSamlet(all), sendinger = deliveryCounts(), utlev = deliveryInfo(), bruk = brukInfo(), now = Date.now(), fraUlest = ulestFra(now)
        const atoms = all.slice(offset, offset + limit).map((a) => ({ ...a, links: linksFor(a), file: fileOf(a), ord: Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)])), tegn: Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length])), max: 'L', vault: isVault(a), status: statusOf(a), tråd: trådAv.get(a.id) || null, utlevert: sendinger.get(a.id) || 0, mtime: mtimeAv(fileOf(a)),   // mtime (runde 2a): visningen Mapper sorterer som Finder — nyeste fil øverst
          klasse: klasseAv(a), vekt: vekt(a, { utlevering: utlev.get(a.id), bruk: bruk.get(a.id), tråd: a.kind === 'konklusjon' || a.kind === 'svar' ? trådPer.get(trådAv.get(a.id)) || null : null, now }), sist_rørt: sistRørt(a, { utlevering: utlev.get(a.id), bruk: bruk.get(a.id) }), tråden: a.kind === 'prompt' ? trådPer.get(a.id) || null : null,
          ulest: ulestAv(a, { bruk: bruk.get(a.id), fra: fraUlest }) }))   // friksjon 16: nyere enn siste «sett alt» (ellers sju dager) og ikke åpnet/sett/lest siden den ble skrevet
        return json(res, 200, { atoms, total: all.length, offset, file: ARKIV(), klasser: tellKlasser(all), uleste: atoms.filter((a) => a.ulest && a.klasse === 'arbeid').length, sett_alt: settAltSist() || null })
      }
      if (req.method === 'GET' && url.pathname === '/api/search') {
        const q = url.searchParams.get('q') || ''
        const kind = url.searchParams.get('kind') || undefined
        const alleAtomer = load(), byId = new Map(alleAtomer.map((a) => [a.id, a])), trådAv = tråder(alleAtomer).av
        const fangetParam = url.searchParams.get('fanget') || 'uten'   // runde 2c: uten (standard) · med · bare — fangede saker holdes utenfor søket til de løftes inn
        const driftParam = url.searchParams.get('drift') || 'uten'     // runde 2d (03-avisen §2 A): drift holdes utenfor søket til noen ber om den — ?drift=med tar den med, bare gir bare den
        const hits = search(alleAtomer, q, {
          context: url.searchParams.get('context') || undefined, project: url.searchParams.get('project') || undefined, kind, fanget: ['med', 'bare'].includes(fangetParam) ? fangetParam : 'uten',
          drift: ['med', 'bare'].includes(driftParam) ? driftParam : 'uten',
          limit: num(url.searchParams.get('limit'), 50), offset: num(url.searchParams.get('offset'), 0),
        })
        return json(res, 200, {
          q, total: hits.total, offset: num(url.searchParams.get('offset'), 0), ...(kind ? { kind } : {}), fangetUtenfor: hits.fanget, driftUtenfor: hits.drift,
          // ord per nivå kommer fra lageret (levelOf) — Spør-skjermen (skive 2) regner ikke selv, så ordantallet er det samme som motoren sender.
          // Skive 8: prompt-treff bærer hele teksten (tekst), svarene (ga) og modellene de gikk til — forslagene i Spør fyller feltet med ett klikk.
          hits: hits.map(({ atom: a, S, max, score, snippet }) => ({ id: a.id, name: a.name, project: a.project, convo: a.convo, source: a.source, kind: a.kind || 'capture', capturedAt: a.capturedAt, version: a.version || 1, S: S.text, sLevel: S.level, max, vault: isVault(a), status: statusOf(a), ord: Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)])), tegn: Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length])), score, snippet, tråd: trådAv.get(a.id) || null, tags: a.tags || [], fanget: !!a.fanget, drift: a.drift === true, klasse: klasseAv(a),
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
        const { id, target, href, mappe } = await readBody(req)
        if (mappe) {   // runde 1 (arb. 32 §6): stier vises ikke i klartekst — «Vis i Finder» på arkivmappa og Innboks i stedet. Fast liste, aldri en sti fra klienten.
          const sti = mappe === 'arkiv' ? FILES_ROOT : mappe === 'innboks' ? INBOX_DIR : null
          if (!sti || !fs.existsSync(sti)) return json(res, 404, { error: `mappa «${mappe}» finnes ikke` })
          try { const r = await run('reveal', sti); console.error(`[tua-bro] open ${FILE_MANAGER} ${mappe}${DRYRUN ? ' (dryrun)' : ''}`); return json(res, 200, r) } catch (e) { return json(res, 403, { error: e.message }) }
        }
        if (!target || (!id && !href)) return json(res, 400, { error: 'target og id (eller href) kreves' })
        const alle = load()
        // Friksjon 13: uten id (Markdown-leseren vet ikke alltid hvilken sak den står i) finner broen saken som nevner stien — samme regel, ingen frie stier
        const a = id ? alle.find((x) => x.id === id) : (target === 'finder' && href ? alle.find((x) => { const w = realpath(href); return w && stiISak(x, w, href) }) : null)
        if (!a) return json(res, id ? 404 : 403, { error: id ? `fant ikke atom ${id}` : 'ingen sak nevner denne stien' })
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
      if (req.method === 'POST' && url.pathname === '/api/prosjekter') {   // friksjon 6: «nytt prosjekt …» i Spør — mappa opprettes i arkivet
        const b = await readBody(req)
        try { const r = nyttProsjekt(b.navn); console.error(`[tua-bro] prosjekt «${r.prosjekt}» ${r.ny ? 'opprettet som mappe' : 'fantes'}`); return json(res, 200, { ...r, prosjekter: alleProsjekter() }) }
        catch (e) { return json(res, 400, { error: e.message }) }
      }
      if (req.method === 'GET' && url.pathname === '/api/sak') {   // friksjon 4: én sak med teksten på hvert nivå — til kilde-raden i Spør som åpnes (lokalt, logges ikke)
        const id = url.searchParams.get('id') || ''
        const a = load().find((x) => x.id === id)
        if (!a) return json(res, 404, { error: `fant ikke sak ${id}` })
        const niv = Object.fromEntries(LEVELS.map((l) => { const g = levelOf(a, l); return [l, { tekst: g.text, fallback: g.fallback ? g.level : null, av: a.levels?.[l]?.by || null }] }))
        return json(res, 200, { id: a.id, name: a.name, project: a.project, convo: a.convo || '', kind: a.kind || 'capture', tags: a.tags || [], capturedAt: a.capturedAt, version: a.version || 1, status: statusOf(a), vault: isVault(a), max: 'L',
          ord: Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)])), tegn: Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length])), nivåer: niv, file: fileOf(a) })
      }
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
      // Friksjon 15: standardnivået per mottaker for én sak (regelen bor i motoren; /api/mottakere har alt `nivå`/`nivåVault` per rad, så appen trenger sjelden denne)
      if (req.method === 'GET' && url.pathname === '/api/niva') {
        const ids = String(url.searchParams.get('mottaker') || url.searchParams.get('mottakere') || '').split(',').map((s) => s.trim()).filter(Boolean)
        const alle = await mottakere()
        const ms = ids.length ? ids.map((id) => alle.find((m) => m.id === id)).filter(Boolean) : alle.filter((m) => m.standard)
        if (ids.length && ms.length !== ids.length) return json(res, 400, { error: `ukjent mottaker — en av ${alle.map((m) => m.id).join(', ')}` })
        const id = url.searchParams.get('id') || ''
        const sak = id ? load().find((a) => a.id === id) : null
        if (id && !sak) return json(res, 404, { error: `fant ikke sak ${id}` })
        return json(res, 200, { id: id || null, vault: sak ? isVault(sak) : false, ...standardNivåer(ms, sak) })
      }
      // Friksjon 15: «før du sender, ser du hva som sendes» — samme trinn som spor() fram til sendingen, ingenting sendes eller logges
      if (req.method === 'POST' && url.pathname === '/api/spor/forhandsvis') {
        const b = await readBody(req)
        const mottakerIds = [...new Set([...(Array.isArray(b.mottakere) ? b.mottakere : []), ...(b.mottaker ? [b.mottaker] : [])].map((x) => String(x || '').trim()).filter(Boolean))]
        if (!mottakerIds.length) return json(res, 400, { error: 'mottaker kreves (se /api/mottakere)' })
        const saker = Array.isArray(b.saker) ? b.saker.filter((s) => s && s.id) : []
        try { return json(res, 200, forhåndsvis({ melding: String(b.melding || ''), saker, mottakere: mottakerIds, prosjekt: b.prosjekt ? String(b.prosjekt) : undefined })) }
        catch (e) { return json(res, e instanceof MotorFeil ? 400 : 500, { error: e.message }) }
      }
      if (req.method === 'POST' && url.pathname === '/api/spor') {
        const b = await readBody(req)
        if (!b.melding || !String(b.melding).trim()) return json(res, 400, { error: 'melding kreves' })
        const mottakerIds = [...new Set([...(Array.isArray(b.mottakere) ? b.mottakere : []), ...(b.mottaker ? [b.mottaker] : [])].map((x) => String(x || '').trim()).filter(Boolean))]
        if (!mottakerIds.length) return json(res, 400, { error: 'mottaker kreves (se /api/mottakere) — én som `mottaker` eller flere som `mottakere: []`' })
        const prosjekt = String(b.prosjekt || '').replace(/\s+/g, ' ').trim()
        if (!prosjekt) return json(res, 400, { error: 'prosjekt kreves — velg hvor spørsmålet og svaret skal lagres (se /api/prosjekter)' })   // friksjon 6: fail closed, aldri usynlig valg
        const saker = Array.isArray(b.saker) ? b.saker.filter((s) => s && s.id) : []
        const kjøring = b.kjøring ? String(b.kjøring).slice(0, 80) : null
        // SSE: hendelsene skrives etter hvert — broen er ren http, ingenting bufrer (K9). Lukker klienten, avbrytes kallet mot mottakeren.
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, data) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`) }
        const ctl = new AbortController()
        req.on('close', () => ctl.abort())
        if (kjøring) kjøringer.set(kjøring, ctl)
        try {
          const r = await spor({ melding: String(b.melding), saker, mottakere: mottakerIds, prosjekt, samtale: b.samtale || undefined, prompt: b.prompt || undefined, klient: 'app', signal: ctl.signal, på: hendelse })
          if (Array.isArray(r.svar)) console.error(`[tua-bro] spor → ${mottakerIds.join('+')} · ${prosjekt} · ${saker.length} saker · ${r.svar.length} svar${r.feilet?.length ? ` · ${r.feilet.length} feilet` : ''}${ctl.signal.aborted ? ' · STOPPET' : ''} · forskjeller ${r.forskjeller ? (r.forskjeller.tilgjengelig ? `${r.forskjeller.enig.length}/${r.forskjeller.uenig.length}/${r.forskjeller.unikt.length} (${r.forskjeller.vurdert_av})` : 'ikke tilgjengelig') : '—'} · konklusjon ${r.konklusjon?.id || '—'}`)
          else console.error(`[tua-bro] spor → ${mottakerIds[0]} · ${prosjekt} · ${saker.length} saker · svar ${r.svar}${r.avbrutt ? ' (avbrutt)' : ''} · tokens ca. ${r.tokens.ca}${r.tokens.inn != null ? ` (eksakt ${r.tokens.inn}+${r.tokens.ut})` : ''}`)
        } catch (e) {
          const blokkert = e instanceof Blokkert
          const stoppet = !blokkert && ctl.signal.aborted
          console.error(`[tua-bro] spor → ${mottakerIds.join('+')} ${blokkert ? 'BLOKKERT' : stoppet ? 'STOPPET før svar' : 'FEIL'}: ${e.message}`)
          hendelse(blokkert ? 'blokkert' : 'feil', { feil: stoppet ? 'Stoppet før noe svar kom — ingenting er lagret som svar.' : e.message, ...(stoppet ? { avbrutt: true } : {}), ...(blokkert ? { detaljer: e.detaljer, ...(e.mottaker ? { mottaker: e.mottaker } : {}) } : {}) })
        } finally { if (kjøring) kjøringer.delete(kjøring) }
        return res.end()
      }
      if (req.method === 'POST' && url.pathname === '/api/spor/stopp') {   // friksjon 8: «Stopp» — avbryter kallet mot mottakeren; det som kom, lagres som avbrutt svar (motoren)
        const b = await readBody(req)
        const ctl = kjøringer.get(String(b.kjøring || ''))
        if (!ctl) return json(res, 404, { error: 'ingen kjøring med den id-en pågår' })
        ctl.abort(); console.error(`[tua-bro] spor stoppet av brukeren (${b.kjøring})`)
        return json(res, 200, { stoppet: true })
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
        // Runde 2c (§5.5): med {strøm: true} svarer ruta som SSE — vurderer {steg, svar} · vurderer-del {tegn} · forskjeller · konklusjon-del {tekst} · konklusjon · slutt —
        // så «Også til …» og «Kjør igjen» på konklusjonen viser fremdriften i saken, ikke bare en spinner. Uten strøm: JSON som før.
        const strøm = !!b.strøm
        let hendelse = () => {}
        if (strøm) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
          res.flushHeaders?.()
          hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        }
        try {
          const f = svar.length > 1 ? await forskjeller(svar, { melding: p.content, prosjekt: b.prosjekt || p.project, klient: 'app', signal: ctl.signal, på: hendelse }) : { tilgjengelig: false, grunn: 'Forskjeller vises bare når mer enn én har svart.', enig: [], uenig: [], unikt: [] }
          if (strøm) hendelse('forskjeller', f)
          const k = await konklusjon({ prompt: p.id, svar, forskjeller: f.tilgjengelig ? f : null, melding: p.content, prosjekt: b.prosjekt || p.project, samtale: p.convo || undefined, klient: 'app', signal: ctl.signal, på: hendelse })
          console.error(`[tua-bro] konklusjon kjørt igjen for ${p.id} · ${svar.length} svar · ${k.tilgjengelig ? `utkast ${k.id} v${k.version} (${k.mottaker})` : `ikke tilgjengelig: ${k.grunn}`}`)
          if (strøm) { hendelse('konklusjon', k); hendelse('slutt', { forskjeller: f, konklusjon: k }); return res.end() }
          return json(res, 200, { forskjeller: f, konklusjon: k })
        } catch (e) {
          console.error(`[tua-bro] konklusjon FEIL: ${e.message}`)
          if (strøm) { hendelse('feil', { feil: e.message, blokkert: e instanceof Blokkert }); return res.end() }
          return json(res, e instanceof Blokkert ? 403 : 500, { error: e.message })
        }
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
      // ── Friksjon 12: Ollama-modeller (ollama.js) — bare serverens HTTP-API, aldri appens GUI ──
      if (req.method === 'GET' && url.pathname === '/api/ollama/modeller') return json(res, 200, await ollamaModeller())
      if (req.method === 'POST' && url.pathname === '/api/ollama/standard') {
        const b = await readBody(req)
        const { lokale } = await ollamaLokale()
        let modell
        try { modell = ollamaStandard(b.navn, lokale.map((m) => m.navn)) } catch (e) { return json(res, 400, { error: e.message }) }
        console.error(`[tua-bro] ollama: standardmodell ${modell} (config)`)
        return json(res, 200, { ok: true, modell, mottakere: await mottakere() })
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/ollama/modeller/')) {
        let navn; try { navn = decodeURIComponent(url.pathname.slice('/api/ollama/modeller/'.length)) } catch { return json(res, 400, { error: 'ugyldig modellnavn' }) }
        let r
        try { r = await ollamaFjern(navn) } catch (e) { return json(res, /ligger ikke|not found/i.test(e.message) ? 404 : 400, { error: e.message }) }
        console.error(`[tua-bro] ollama: fjernet ${r.navn}${r.varStandard ? ' (var standard — faller tilbake til første)' : ''}`)
        return json(res, 200, { ok: true, ...r, modeller: await ollamaModeller() })
      }
      if (req.method === 'POST' && url.pathname === '/api/ollama/hent') {
        const b = await readBody(req)
        const navn = String(b.navn || '').trim()
        if (!navn) return json(res, 400, { error: 'navn kreves (f.eks. gemma3:12b)' })
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        const ctl = new AbortController(); req.on('close', () => ctl.abort())
        console.error(`[tua-bro] ollama: henter ${navn} fra ollama.com …`)
        try {
          await ollamaHent(navn, { signal: ctl.signal, på: hendelse })
          console.error(`[tua-bro] ollama: ${navn} hentet`)
          hendelse('ferdig', { navn, modeller: await ollamaModeller() })
        } catch (e) { console.error(`[tua-bro] ollama: henting av ${navn} FEIL: ${e.message}`); hendelse('feil', { navn, feil: e.message }) }
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
      // ── Friksjonsrunde 1 (24.10.2026, friksjon 5): Innboks i navigasjonen og på forsiden ──
      // GET /api/innboks/antall → { antall, dokumenter: [navn] }  bare tellingen (readdir), lett nok til å spørres hvert 10.–30. sekund fra app-hodet og forsiden;
      // GET /api/innboks (over) har alt det andre (eksporter, lenkefiler, Ferdig, prosjekter) og brukes av Innboks-sida.
      if (req.method === 'GET' && url.pathname === '/api/innboks/antall') {
        const dok = innboksDokumenter()
        return json(res, 200, { antall: dok.length, dokumenter: dok.map((d) => d.navn) })
      }
      // ── Runde 1 — lette og rydde (arbeidsstykke 32 §6, 24.10.2026) ──
      // GET /api/bro → { passord, arkiv } — appen viser «logg ut» bare når passord er satt. Aldri nøkler, aldri stier til klienten utenom arkivets navn.
      if (req.method === 'GET' && url.pathname === '/api/bro') return json(res, 200, { passord: passwordSet(), arkiv: path.basename(ARKIV() || '') })
      // POST /api/innboks/les {prosjekt} → SSE med fremdrift mens Innboks leses inn: start {antall, prosjekt} · leser/lest/skriver {fil, …} per fil (fra innlesing.js) ·
      // sak {fil, id, name, project, …} når én er ferdig · feil {fil, feil} · slutt {filer, lest, feilet, prosjekt, filer: [...]}. Samme arbeid som /api/innboks/kjør (som står), bare synlig underveis.
      if (req.method === 'POST' && url.pathname === '/api/innboks/les') {
        const b = await readBody(req)
        let prosjekt = STANDARD_PROSJEKT
        try { if (b.prosjekt) prosjekt = prosjektNavn(b.prosjekt) } catch (e) { return json(res, 400, { error: e.message }) }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        const ctl = new AbortController(); req.on('close', () => ctl.abort())
        try {
          const r = await lesInnInnboks({ prosjekt, dryRun: !!b.dryRun, skriver: b.skriver || undefined, klient: 'app', signal: ctl.signal, log: (m) => console.error(`[tua-bro] ${m}`),
            på: (ev, d) => { if (ev === 'ferdig') hendelse('sak', { fil: d.fil, id: d.id, name: d.name, project: d.project, S_av: d.S_av, sider: d.sider, ord: d.ord, status: d.status }); else if (ev !== 'slutt') hendelse(ev, d) } })
          hendelse('slutt', { ...r.tall, prosjekt: r.prosjekt, dryRun: r.dryRun, filer: r.filer.map(({ sti, ...f }) => f) })
        } catch (e) { hendelse('feil', { feil: e.message }) }
        return res.end()
      }
      // ── Runde 2c (arbeidsstykke 32 §5 spørsmål 1, 24.10.2026): Fanget-bøtta — serverdelen. Alt gjennom lageret (store.js: behold, slåSammen, kast, angre, papirkurv). ──
      // slag = hva nøkkelen sier saken er (okt: → økt, samtale:, prompt:, svar:) — appens bøtte sorterer på det; ellers kind.
      if (req.method === 'GET' && url.pathname === '/api/fanget') {
        const alle = load(), trådAv = tråder(alle).av
        const slagAv = slagAvNøkkel
        const fangede = alle.filter((a) => a.fanget).sort((x, y) => y.capturedAt - x.capturedAt)
        const tell = (m, k) => { m[k] = (m[k] || 0) + 1 }
        const perKilde = {}, perProsjekt = {}, perSlag = {}
        for (const a of fangede) { tell(perKilde, a.source || '—'); tell(perProsjekt, a.project); tell(perSlag, slagAv(a)) }
        const prosjekt = url.searchParams.get('prosjekt') || ''
        const liste = prosjekt ? fangede.filter((a) => same(a.project, prosjekt)) : fangede
        const offset = num(url.searchParams.get('offset'), 0), limit = num(url.searchParams.get('limit'), 50)
        const saker = liste.slice(offset, offset + limit).map((a) => ({ id: a.id, name: a.name, project: a.project, convo: a.convo, source: a.source, kind: a.kind || 'capture', slag: slagAv(a), tags: a.tags || [], capturedAt: a.capturedAt, version: a.version || 1,
          S: levelOf(a, 'S').text, ord: Object.fromEntries(LEVELS.map((l) => [l, ord(levelOf(a, l).text)])), tegn: Object.fromEntries(LEVELS.map((l) => [l, levelOf(a, l).text.trim().length])), max: 'L', vault: isVault(a), status: statusOf(a), tråd: trådAv.get(a.id) || null, fanget: true }))
        return json(res, 200, { saker, total: liste.length, alle: fangede.length, offset, limit, ...(prosjekt ? { prosjekt } : {}), perKilde, perProsjekt, perSlag })
      }
      if (req.method === 'POST' && url.pathname === '/api/fanget/behold') {
        const b = await readBody(req)
        if (!b.id) return json(res, 400, { error: 'id kreves' })
        let p = null
        try { if (b.prosjekt) p = prosjektNavn(b.prosjekt) } catch (e) { return json(res, 400, { error: e.message }) }
        const atoms = load()
        if (!atoms.some((x) => x.id === b.id)) return json(res, 404, { error: `fant ikke sak ${b.id}` })
        const r = fangetBehold(atoms, b.id, { prosjekt: p })
        save(atoms)                                              // flagget bort i fila; med nytt prosjekt flytter lageret fila (V9)
        console.error(`[tua-bro] fanget behold «${r.atom.name}»${r.flyttet ? `: ${r.før.project} → ${r.atom.project}` : ''}`)
        return json(res, 200, { atom: { ...r.atom, links: linksFor(r.atom), file: fileOf(r.atom), status: statusOf(r.atom), fanget: false }, før: r.før, flyttet: r.flyttet })
      }
      if (req.method === 'POST' && ['/api/fanget/slaa-sammen', '/api/fanget/slå-sammen', '/api/fanget/sl%C3%A5-sammen'].includes(url.pathname)) {
        const b = await readBody(req)
        if (!b.id || !b.inn_i) return json(res, 400, { error: 'id og inn_i kreves' })
        const atoms = load()
        let r
        try { r = fangetSlåSammen(atoms, b.id, b.inn_i) } catch (e) { return json(res, /fant ikke/.test(e.message) ? 404 : 400, { error: e.message }) }
        save(atoms)                                              // inn_i skrives som ny versjon (forrige bevares i .tua/versions); den fangede er alt i papirkurven
        console.error(`[tua-bro] fanget slå sammen «${r.kastet.name}» → «${r.atom.name}» (v${r.atom.version})`)
        return json(res, 200, { atom: { ...r.atom, links: linksFor(r.atom), file: fileOf(r.atom), status: statusOf(r.atom), fanget: !!r.atom.fanget }, kastet: r.kastet })
      }
      if (req.method === 'POST' && url.pathname === '/api/fanget/kast') {
        const b = await readBody(req)
        if (!b.id) return json(res, 400, { error: 'id kreves' })
        const atoms = load()
        let post
        try { post = fangetKast(atoms, b.id) } catch (e) { return json(res, /fant ikke/.test(e.message) ? 404 : 400, { error: e.message }) }
        console.error(`[tua-bro] fanget kast «${post.name}» → .tua/papirkurv/${post.project}`)
        return json(res, 200, { kastet: post })
      }
      if (req.method === 'POST' && url.pathname === '/api/fanget/angre') {
        const b = await readBody(req)
        if (!b.id) return json(res, 400, { error: 'id kreves' })
        let r
        try { r = fangetAngre(b.id) } catch (e) { return json(res, /ligger ikke/.test(e.message) ? 404 : 400, { error: e.message }) }
        console.error(`[tua-bro] papirkurv angre «${r.atom.name}» → ${r.rel}`)
        return json(res, 200, { atom: { ...r.atom, links: linksFor(r.atom), file: fileOf(r.atom), status: statusOf(r.atom), fanget: !!r.atom.fanget } })
      }
      // POST /api/fanget/merk {dryRun} — engangs-merkingen fra Innstillinger › Arkiv («Merk det som alt er fanget»), samme regel som `node review.js --fanget`.
      // SSE: start {saker} · tall {tall, perSlag, perKilde, perProsjekt, eksempler} · (ikke dryRun:) skriver {antall} · slutt {nye, filer, dryRun}. Det er Erik som trykker; dry-run først.
      // Friksjon 15: POST /api/arkiv/merk {hva: drift|fanget|begge, dryRun} — «Merk arkivet (drift, så fanget)» i Innstillinger › Arkivsted. Drift først (review --drift),
      // så fanget på det som er igjen (review --fanget hopper over drift-saker). SSE: start {saker, hva, dryRun} · tall {hva: 'drift', tall, perSlag, perProsjekt, eksempler} ·
      // tall {hva: 'fanget', tall, perSlag, perKilde, perProsjekt, eksempler} · (ikke dryRun:) skriver {hva, antall} · slutt {drift: {nye, filer}, fanget: {nye, filer}, nye, filer,
      // klasser: {før, etter}, dryRun}. I dry-run regnes fanget-tallene som om drift alt var satt. Det er Erik som trykker; dry-run først. /api/fanget/merk = hva: fanget (runde 2c app).
      if (req.method === 'POST' && (url.pathname === '/api/arkiv/merk' || url.pathname === '/api/fanget/merk')) {
        const b = await readBody(req)
        const dryRun = !!b.dryRun
        const hva = url.pathname === '/api/fanget/merk' ? 'fanget' : ['drift', 'fanget', 'begge'].includes(b.hva) ? b.hva : 'begge'
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        try {
          let atoms = load()
          const før = tellKlasser(atoms)
          hendelse('start', { saker: atoms.length, hva, dryRun })
          const ut = { drift: { nye: 0, filer: 0 }, fanget: { nye: 0, filer: 0 } }
          if (hva === 'drift' || hva === 'begge') {
            const { tall, perSlag, perProsjekt, nye, prosjekter } = driftKandidater(atoms)
            hendelse('tall', { hva: 'drift', tall, perSlag, perProsjekt, prosjekter, eksempler: nye.slice(0, 5).map((a) => ({ id: a.id, name: a.name, project: a.project, slag: driftSlag(a), source: a.source || null })) })
            ut.drift.nye = nye.length
            if (nye.length) {
              if (dryRun) atoms = atoms.map((a) => (nye.includes(a) ? { ...a, drift: true } : a))          // fanget-tallene under regnes som om drift alt var satt
              else { hendelse('skriver', { hva: 'drift', antall: nye.length }); for (const a of nye) a.drift = true; ut.drift.filer = save(atoms); console.error(`[tua-bro] drift merk: ${nye.length} saker merket · ${ut.drift.filer} filer skrevet`) }
            }
          }
          if (hva === 'fanget' || hva === 'begge') {
            const { tall, perSlag, perKilde, perProsjekt, nye } = fangetKandidater(atoms)
            hendelse('tall', { hva: 'fanget', tall, perSlag, perKilde, perProsjekt, eksempler: nye.slice(0, 5).map((a) => ({ id: a.id, name: a.name, project: a.project, slag: slagAvNøkkel(a), source: a.source || null })) })
            ut.fanget.nye = nye.length
            if (nye.length) {
              if (dryRun) atoms = atoms.map((a) => (nye.includes(a) ? { ...a, fanget: true } : a))
              else { hendelse('skriver', { hva: 'fanget', antall: nye.length }); for (const a of nye) a.fanget = true; ut.fanget.filer = save(atoms); console.error(`[tua-bro] fanget merk: ${nye.length} saker merket · ${ut.fanget.filer} filer skrevet`) }
            }
          }
          hendelse('slutt', { ...ut, nye: ut.drift.nye + ut.fanget.nye, filer: ut.drift.filer + ut.fanget.filer, klasser: { før, etter: tellKlasser(atoms) }, hva, dryRun })
        } catch (e) { hendelse('feil', { feil: e.message }) }
        return res.end()
      }
      if (req.method === 'GET' && url.pathname === '/api/papirkurv') {
        const saker = fangetPapirkurv().map(({ kurv, ...e }) => e)   // aldri stien inne i .tua til klienten (runde 1: ingen stier i klartekst)
        return json(res, 200, { saker, antall: saker.length })
      }
      // ── Runde 2d (arbeidsstykke 32 del 3, 03-avisen §3–§5, Erik 24.10.2026: ja til A–E): klasser og vekt — serverdelen. Alt gjennom lageret (store.js). ──
      //   POST /api/behold {id}           → { atom }   «Behold» på et svar (eller en hvilken som helst sak): beholdt: true i fila — et beholdt svar er arbeid, ikke tråd (D);
      //                                    var saken fanget eller drift, løftes den samtidig inn (fanget: false / drift: false). Samme lager-funksjon som Fanget-bøttas Behold.
      //   POST /api/bruk {id, hendelse}   → { ok, at }  lett hendelse til <arkiv>/.tua/bruk.jsonl (lest_M · lest_L · tatt_med · åpnet · redigert · delt) — teller i vekten og sist_rørt. Bare metadata.
      //   GET  /api/siden-sist?dager=7    → det «Siden sist» trenger: spørsmål i arbeid (åpne Spør-tråder), svar som kom tilbake (ubeholdte svar siste N dager), konklusjoner som venter
      //                                    (utkast), filer i Innboks (tall), og Claude-øktene siste N dager — én linje per økt og én tekstlinje per dag («I Claude i dag: 3 økter, 14 filer skrevet,
      //                                    2 svar beholdt») med økt-id → sakene i økta (fanget). Bare id-er, navn, S og tall — aldri innhold.
      if (req.method === 'POST' && url.pathname === '/api/behold') {
        const b = await readBody(req)
        if (!b.id) return json(res, 400, { error: 'id kreves' })
        const atoms = load()
        if (!atoms.some((x) => x.id === b.id)) return json(res, 404, { error: `fant ikke sak ${b.id}` })
        const r = fangetBehold(atoms, b.id)                      // beholdt: true, fanget: false, drift: false (var den drift) — brukerens valg vinner over regelen, alltid
        save(atoms)
        console.error(`[tua-bro] behold «${r.atom.name}» (${klasseAv(r.atom)})`)
        return json(res, 200, { atom: { ...r.atom, links: linksFor(r.atom), file: fileOf(r.atom), status: statusOf(r.atom), klasse: klasseAv(r.atom), beholdt: true, fanget: false }, før: r.før })
      }
      if (req.method === 'POST' && url.pathname === '/api/bruk') {
        const b = await readBody(req)
        if (!b.id || !b.hendelse) return json(res, 400, { error: 'id og hendelse kreves', hendelser: BRUK_HENDELSER })
        if (!BRUK_HENDELSER.includes(b.hendelse)) return json(res, 400, { error: `ukjent hendelse «${b.hendelse}»`, hendelser: BRUK_HENDELSER })
        if (!load().some((x) => x.id === b.id)) return json(res, 404, { error: `fant ikke sak ${b.id}` })
        const e = logBruk(b.id, b.hendelse)
        return json(res, 200, { ok: true, id: e.id, hendelse: e.hendelse, at: e.at })
      }
      if (req.method === 'GET' && url.pathname === '/api/siden-sist') {
        const dager = Math.min(90, Math.max(1, num(url.searchParams.get('dager'), 7)))
        const now = Date.now(), fra = now - dager * 86400e3
        const alle = load(), byId = new Map(alle.map((a) => [a.id, a]))
        const { av, per } = trådSamlet(alle), utlev = deliveryInfo(), bruk = brukInfo(), fraUlest = ulestFra(now)
        const rad = (a, tid = null) => ({ id: a.id, name: a.name, project: a.project, convo: a.convo, source: a.source, kind: a.kind || 'capture', capturedAt: a.capturedAt, version: a.version || 1, S: levelOf(a, 'S').text, status: statusOf(a), klasse: klasseAv(a), tråd: av.get(a.id) || null, vekt: vekt(a, { utlevering: utlev.get(a.id), bruk: bruk.get(a.id), now }), sist_rørt: sistRørt(a, { utlevering: utlev.get(a.id), bruk: bruk.get(a.id) }),
          ulest: ulestAv(a, { bruk: bruk.get(a.id), fra: fraUlest, tid }) })   // friksjon 16: ulest til linja er sett eller saken åpnet; et spørsmål er nytt når noe i tråden er nytt (tid = trådens sist)
        // Spørsmål i arbeid: åpne tråder (ingen konklusjon låst, ingen svar beholdt) rørt siste N dager — prompten med tråden samlet
        const spørsmål = [...per.values()].filter((t) => t.åpen && t.sist >= fra && byId.has(t.prompt) && byId.get(t.prompt).fanget !== true && byId.get(t.prompt).drift !== true && !fjernetAv(bruk.get(t.prompt), t.sist))   // × i Siden sist: borte til noe nytt skjer i tråden
          .sort((x, y) => y.sist - x.sist).map((t) => ({ ...rad(byId.get(t.prompt), t.sist), tråden: t, konklusjon_venter: !!t.konklusjon && t.konklusjon_status !== 'endelig' }))
        // Svar som kom tilbake: svar-saker (fra Spør, ikke fanget) som ikke er beholdt eller låst, siste N dager
        const svarKom = alle.filter((a) => a.kind === 'svar' && a.fanget !== true && a.drift !== true && klasseAv(a) === 'tråd' && (a.capturedAt || 0) >= fra && !(a.tags || []).some((t) => String(t).toLowerCase() === 'forskjeller') && !fjernetAv(bruk.get(a.id), a.capturedAt) && !fjernetAv(bruk.get(av.get(a.id)), a.capturedAt))   // × på spørsmålet tar hele tråden
          .sort((x, y) => y.capturedAt - x.capturedAt).map((a) => ({ ...rad(a), tråd: av.get(a.id) || null }))
        // Konklusjoner som venter på låsing (utkast)
        const konklusjoner = alle.filter((a) => a.kind === 'konklusjon' && statusOf(a) !== 'endelig' && !fjernetAv(bruk.get(a.id), a.capturedAt) && !fjernetAv(bruk.get(av.get(a.id)), a.capturedAt)).sort((x, y) => y.capturedAt - x.capturedAt).map((a) => ({ ...rad(a), tråd: av.get(a.id) || null }))
        const dok = innboksDokumenter()
        const økter = claudeØkter(alle, { dager, now })
        // friksjon 16: en økt er ulest når den er ny og ingen av sakene i den er sett/åpnet; `sak` = økt-saken (okt:/samtale:), ellers første sak — den appen melder «sett» på
        // fjernet (×): en økt hvis økt-sak har «fjernet» etter øktas siste sak er borte; dagene regnes om (tekst-prefikset «I Claude i dag» står, appen bygger resten av tallene)
        const økterUt = økter.økter.map((ø) => { const sak = ø.saker.find((id) => /^(okt|samtale):/.test(String(byId.get(id)?.key || ''))) || ø.saker[0] || null
          return { ...ø, sak, ulest: ø.sist > fraUlest && !ø.saker.some((id) => (bruk.get(id)?.lest || 0) >= ø.sist) } }).filter((ø) => !fjernetAv(bruk.get(ø.sak), ø.sist))
        const igjen = new Set(økterUt.map((ø) => ø.økt))
        const dagerUt = økter.dager.map((d) => { const ø = økterUt.filter((x) => d.økter.includes(x.økt)); return { ...d, økter: d.økter.filter((id) => igjen.has(id)), antall: ø.length, filer: ø.reduce((n, x) => n + (x.filer || 0), 0), beholdt: ø.reduce((n, x) => n + (x.beholdt || 0), 0), uleste: ø.filter((x) => x.ulest).length } }).filter((d) => d.økter.length > 0)
        const uleste = spørsmål.filter((s) => s.ulest).length + svarKom.filter((s) => s.ulest).length + konklusjoner.filter((s) => s.ulest).length + økterUt.filter((ø) => ø.ulest).length
        return json(res, 200, { dager, spørsmål, svarKom, konklusjoner, innboks: { antall: dok.length, dokumenter: dok.map((d) => d.navn) }, økter: økterUt, økterPerDag: dagerUt, antallØkter: økterUt.length, uleste, sett_alt: settAltSist() || null })
      }
      // ── Runde 3c (M25, 03-avisen §2, plan videre §4 3c, 24.10.2026): rydding PÅ SAKEN, papirkurv, Tua foreslår, Ny gjennomgang. Egen blokk; alt gjennom lageret (store.js) og
      //    gjennomgang.js. Lageret har nå ÉN skriver: save() skriver bare det denne prosessen endret, og fletter treveis mot en fil en annen prosess har skrevet siden (aldri tekst).
      //   POST /api/rydd/flytt {id, prosjekt}       → { atom, før, flyttet }      saken til et annet prosjekt — lageret flytter fila (V9, samme som Finder). Gyldig prosjektnavn kreves.
      //   POST /api/rydd/navn {id, navn}            → { atom, før, fil, kollisjon } tittel = filnavn (V9); ved kollisjon i mappa får fila id-suffiks. Lageret omdøper fila.
      //   POST /api/rydd/kast {id}                  → { kastet }                   fila til <arkiv>/.tua/papirkurv/<prosjekt>/ — aldri slett. Angre: POST /api/rydd/angre {id} → { atom }.
      //   POST /api/rydd/slaa-sammen {id, inn_i}    → { atom, kastet }             innholdet legges nederst i inn_i som NY versjon med kildepeker (bygget_av); kilden → papirkurv.
      //   GET  /api/rydd/forslag                    → { forslag: [{slag: duplikat|tittel|tom, grunn, project, saker: [rad], behold, kast}], antall, perSlag, perProsjekt, tekst }
      //                                               Tua FORESLÅR, utfører aldri — Siden sist viser «3 duplikater i Oppgjør Skado — se» med Slå sammen / Kast per forslag.
      //   GET  /api/papirkurv/tall                  → { antall }  ·  POST /api/papirkurv/toem {} → { antall, fjernet, bevart, versjoner }  hver fil legges først i .tua/versions/<id>/ («papirkurv»).
      //   GET  /api/gjennomgang/plan?id=|prosjekt=&niva=S|M|begge → { plan, tall, nivå, modell, av, lokalt }  hva som ville skje (menneskeskrevet hoppes over, korte saker trenger ikke M)
      //   POST /api/gjennomgang {id | ids | prosjekt, niva, skriver?: auto|ollama|test|regel|claude, dryRun?} → SSE start {saker, skrives, S, M, menneske, modell, av, lokalt} ·
      //        sak {i, antall, id, name, nivåer} · skrevet {…, av, modell, S, M_tegn, utlevert} · hoppet {id, grunn} · feil {id, feil} · slutt {skrevet, hoppet, feilet, filer, modell, av}
      //        Standard skriver er lokal (Ollama, standardmodellen fra Innstillinger); Claude bare når skriver: 'claude' er sendt (går gjennom motoren med Utlevert). Kortet (3a) kan kalle den samme ruta.
      if (req.method === 'POST' && url.pathname === '/api/rydd/flytt') {
        const b = await readBody(req)
        if (!b.id || !b.prosjekt) return json(res, 400, { error: 'id og prosjekt kreves' })
        let p
        try { p = prosjektNavn(b.prosjekt) } catch (e) { return json(res, 400, { error: e.message }) }
        const atoms = load()
        if (!atoms.some((x) => x.id === b.id)) return json(res, 404, { error: `fant ikke sak ${b.id}` })
        const r = ryddFlytt(atoms, b.id, p)
        if (r.flyttet) save(atoms)
        console.error(`[tua-bro] rydd flytt «${r.atom.name}»: ${r.før} → ${r.atom.project}`)
        return json(res, 200, { atom: sakSvar(r.atom), før: r.før, flyttet: r.flyttet })
      }
      if (req.method === 'POST' && url.pathname === '/api/rydd/navn') {
        const b = await readBody(req)
        if (!b.id || !String(b.navn || '').trim()) return json(res, 400, { error: 'id og navn kreves' })
        const atoms = load()
        if (!atoms.some((x) => x.id === b.id)) return json(res, 404, { error: `fant ikke sak ${b.id}` })
        let r
        try { r = giNyttNavn(atoms, b.id, b.navn) } catch (e) { return json(res, 400, { error: e.message }) }
        if (r.endret) save(atoms)
        console.error(`[tua-bro] rydd navn «${r.før}» → «${r.atom.name}» (${path.basename(fileOf(r.atom))})`)
        return json(res, 200, { atom: sakSvar(r.atom), før: r.før, fil: path.basename(fileOf(r.atom) || r.fil), kollisjon: !!r.kollisjon })
      }
      if (req.method === 'POST' && url.pathname === '/api/rydd/kast') {
        const b = await readBody(req)
        if (!b.id) return json(res, 400, { error: 'id kreves' })
        const atoms = load()
        let post
        try { post = fangetKast(atoms, b.id, { grunn: 'lagt i papirkurven fra saken' }) } catch (e) { return json(res, /fant ikke/.test(e.message) ? 404 : 400, { error: e.message }) }
        console.error(`[tua-bro] rydd kast «${post.name}» → .tua/papirkurv/${post.project}`)
        return json(res, 200, { kastet: { ...post, kurv: undefined } })
      }
      if (req.method === 'POST' && url.pathname === '/api/rydd/angre') {
        const b = await readBody(req)
        if (!b.id) return json(res, 400, { error: 'id kreves' })
        let r
        try { r = fangetAngre(b.id) } catch (e) { return json(res, /ligger ikke/.test(e.message) ? 404 : 400, { error: e.message }) }
        console.error(`[tua-bro] papirkurv angre «${r.atom.name}» → ${r.rel}`)
        return json(res, 200, { atom: sakSvar(r.atom) })
      }
      if (req.method === 'POST' && ['/api/rydd/slaa-sammen', '/api/rydd/slå-sammen', '/api/rydd/sl%C3%A5-sammen'].includes(url.pathname)) {
        const b = await readBody(req)
        if (!b.id || !b.inn_i) return json(res, 400, { error: 'id og inn_i kreves' })
        const atoms = load()
        let r
        try { r = fangetSlåSammen(atoms, b.id, b.inn_i) } catch (e) { return json(res, /fant ikke/.test(e.message) ? 404 : 400, { error: e.message }) }
        save(atoms)
        console.error(`[tua-bro] rydd slå sammen «${r.kastet.name}» → «${r.atom.name}» (v${r.atom.version})`)
        return json(res, 200, { atom: sakSvar(r.atom), kastet: { ...r.kastet, kurv: undefined } })
      }
      if (req.method === 'GET' && url.pathname === '/api/rydd/forslag') return json(res, 200, ryddeforslag(load()))
      if (req.method === 'GET' && url.pathname === '/api/papirkurv/tall') return json(res, 200, { antall: fangetPapirkurv().length })
      if (req.method === 'POST' && ['/api/papirkurv/toem', '/api/papirkurv/tøm', '/api/papirkurv/t%C3%B8m'].includes(url.pathname)) {
        let r
        try { r = tømPapirkurv() } catch (e) { return json(res, 400, { error: e.message }) }
        console.error(`[tua-bro] papirkurv tømt: ${r.fjernet} filer fjernet, ${r.bevart} lagt i .tua/versions`)
        return json(res, 200, r)
      }
      if (req.method === 'GET' && url.pathname === '/api/gjennomgang/plan') {
        const id = url.searchParams.get('id') || null, prosjekt = url.searchParams.get('prosjekt') || null
        const niva = url.searchParams.get('niva') || url.searchParams.get('nivå') || 'M'
        if (!id && !prosjekt) return json(res, 400, { error: 'id eller prosjekt kreves' })
        if (!NIVÅER_GJENNOMGANG.includes(niva)) return json(res, 400, { error: `niva må være ${NIVÅER_GJENNOMGANG.join(', ')}` })
        const r = planFor(load(), { id, prosjekt, nivå: niva })
        const ms = await mottakere()
        const std = ms.find((m) => m.local && m.aktiv) || null
        return json(res, 200, { ...r, modell: std?.modell || null, av: std ? `${std.label.split(' (')[0]} · ${std.modell}` : 'regel', lokalt: !!std, mottakere: ms.filter((m) => m.aktiv && !m.test).map((m) => ({ id: m.id, label: m.label, modell: m.modell, local: !!m.local })) })
      }
      if (req.method === 'POST' && url.pathname === '/api/gjennomgang') {
        const b = await readBody(req)
        if (!b.id && !b.prosjekt && !(Array.isArray(b.ids) && b.ids.length)) return json(res, 400, { error: 'id, ids eller prosjekt kreves' })
        const niva = b.niva || b.nivå || 'M'
        if (!NIVÅER_GJENNOMGANG.includes(niva)) return json(res, 400, { error: `niva må være ${NIVÅER_GJENNOMGANG.join(', ')}` })
        const skriver = ['auto', 'ollama', 'test', 'regel', 'claude'].includes(b.skriver) ? b.skriver : 'auto'
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors })
        res.flushHeaders?.()
        const hendelse = (ev, d) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) }
        const ctl = new AbortController()
        req.on('close', () => ctl.abort())
        try {
          const r = await gjennomgang({ id: b.id || null, ids: b.ids || null, prosjekt: b.prosjekt || null, nivå: niva, skriver, dryRun: !!b.dryRun, klient: 'app', signal: ctl.signal, på: hendelse })
          console.error(`[tua-bro] gjennomgang (${niva}, ${r.av}): ${r.skrevet} skrevet · ${r.hoppet} hoppet · ${r.feilet} feilet · ${r.filer} filer${b.dryRun ? ' · DRY-RUN' : ''}`)
        } catch (e) { hendelse('feil', { feil: e.message }) }
        return res.end()
      }
      // ── Runde 2d (app) — friksjon 14 (Erik 24.10.2026): søk på prosjekt gir prosjektet og filene som hører til; Mapper viser også filer som ikke er saker. Egen blokk. ──
      //   GET  /api/mappe                 → { prosjekter: [{navn, alias: [navn…], saker, filer, sist}] }  prosjektene som mapper, med aliasene fra .tua/project-aliases.json
      //                                     (prosjekt-treffet i søket: navn, alias eller samtale matcher) og antall filer som ikke er saker. Aldri innhold.
      //   GET  /api/mappe?prosjekt=<navn> → { prosjekt, saker, filer: [{navn, sti, format, bytes, mtime, sak}] }  filene i prosjektmappa som ikke er saker (PDF, HTML, docx, bilder,
      //                                     løse .md …), nyeste først; `sti` er relativ til mappa; `sak` = id når fila er en gjengivelse (renders) registrert på en sak. 404 når mappa ikke finnes.
      //   POST /api/mappe/aapne {prosjekt, sti, hvor: finder|app} → åpner fila lokalt (Vis i Finder / Åpne i programmet) — bare filer som ligger i prosjektmappa (realpath). 400/403/404.
      if (req.method === 'GET' && url.pathname === '/api/mappe') {
        const prosjekt = url.searchParams.get('prosjekt')
        const alle = load()
        if (!prosjekt) {
          const aliaser = projectAliases(), perProsjekt = new Map()
          for (const a of alle) { const p = perProsjekt.get(a.project) || { saker: 0, sist: 0 }; p.saker++; p.sist = Math.max(p.sist, a.capturedAt || 0); perProsjekt.set(a.project, p) }
          const prosjekter = alleProsjekter().map((navn) => ({ navn, alias: Object.entries(aliaser).filter(([k, v]) => same(v, navn) && !same(k, navn)).map(([k]) => k), saker: perProsjekt.get(navn)?.saker || 0, filer: filerIMappe(navn)?.filer.length || 0, sist: perProsjekt.get(navn)?.sist || 0 }))
          return json(res, 200, { prosjekter })
        }
        const m = filerIMappe(prosjekt)
        if (!m) return json(res, 404, { error: `fant ikke mappa «${prosjekt}» i arkivet` })
        const renderAv = new Map()   // gjengivelse (sti) → sak-id, så fila kan lenkes til saken den hører til
        for (const a of alle) for (const r of a.renders || []) for (const p of [r.path, r.copy]) { const rp = p && realpath(p); if (rp) renderAv.set(rp, a.id) }
        const filer = m.filer.map((f) => ({ ...f, sak: renderAv.get(realpath(path.join(m.dir, f.sti))) || null }))
        return json(res, 200, { prosjekt, saker: alle.filter((a) => same(a.project, prosjekt)).length, filer })
      }
      if (req.method === 'POST' && url.pathname === '/api/mappe/aapne') {
        const b = await readBody(req)
        if (!b.prosjekt || !b.sti) return json(res, 400, { error: 'prosjekt og sti kreves' })
        const m = prosjektMappe(b.prosjekt)
        if (!m) return json(res, 404, { error: `fant ikke mappa «${b.prosjekt}» i arkivet` })
        const rå = path.resolve(m.dir, String(b.sti))
        if (!rå.startsWith(m.dir + path.sep)) return json(res, 403, { error: 'fila ligger ikke i prosjektmappa' })
        const abs = realpath(rå)
        if (!abs) return json(res, 404, { error: 'fila finnes ikke' })
        if (!abs.startsWith(m.dir + path.sep)) return json(res, 403, { error: 'fila ligger ikke i prosjektmappa' })
        try { if (!fs.statSync(abs).isFile()) return json(res, 403, { error: 'ikke en fil' } ) } catch { return json(res, 404, { error: 'fila finnes ikke' }) }
        if (abs.includes(`${path.sep}.`)) return json(res, 403, { error: 'skjulte filer åpnes ikke' })
        const r = await run(b.hvor === 'app' ? 'url' : 'reveal', abs)
        return json(res, 200, { ok: true, ran: r.ran, hvor: b.hvor === 'app' ? 'app' : 'finder' })
      }
      // ── Friksjon 16 (Erik 24.10.2026): ulest og «Merk alt som lest». Egen blokk. Tilstanden bor i bruk-loggen (.tua/bruk.jsonl), aldri i fila eller nettleseren. ──
      //   POST /api/sett-alt {}           → { ok, at }  én linje {at, hendelse: 'sett_alt'} uten id: alt som er skrevet før nå regnes som lest; /api/atoms og /api/siden-sist
      //                                    gir `ulest: true/false` per sak ut fra dette og «sett»/«åpnet»/«lest_M»/«lest_L»/«redigert» i loggen (POST /api/bruk {id, hendelse: 'sett'}).
      if (req.method === 'POST' && url.pathname === '/api/sett-alt') {
        const e = logSettAlt()
        return json(res, 200, { ok: true, at: e.at })
      }
      return json(res, 404, { error: 'ukjent rute' })
    } catch (e) {
      return json(res, 500, { error: String(e?.message || e) })
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    const built = fs.existsSync(path.join(DIST, APP_FIL))
    console.error(`[tua-bro] appen: http://127.0.0.1:${PORT}/${built ? '' : ' (ikke bygget — npm run kart)'} (avisen · /innstillinger · /sandkasse — /spor, /oppslag og /innboks sendes til / av appen siden runde 2; POST /api/spor, mottakere: /api/mottakere) · arkiv: ${ARKIV()} · ${passwordSet() ? 'passord: på (logg inn på /logg-inn)' : 'passord: AV — sett med «node bridge.js --sett-passord»'} · dev-origin: ${ORIGIN}${DRYRUN ? ' · DRYRUN' : ''}`)
    const log = (m) => console.error(`[tua-bro] ${m}`)
    if (process.env.TUA_BRIDGE_VAKTER !== '0') { watchInbox({ log }); watchDesktop({ log, delayMs: 8000 }); watchFinder({ log }) }     // M17: samme vakter som MCP-serveren; fil-låsen i save() holder dem fra hverandre
  })
