#!/usr/bin/env node
// tua-hook.mjs — Claude Code-hooks for Tua-pluginen (M14). Ett skript, fire moduser:
//
//   start  SessionStart  → påminnelse (som kontekst) når Innboks har filer eller Code-økter ikke er importert på en stund;
//                          M24: peker på /tua_start første gang, og tilbyr /tua_auto når repoet mangler .tua-sync.json
//   svar   Stop          → lagre siste substansielle svar (≥ 1 500 tegn) som atom
//   fil    PostToolUse   → Write|Edit på et tekstdokument (.md/.txt/…) → atom med file-lenke; samme fil = ny versjon
//   okt    PreCompact/SessionEnd → økt-sammendrag (oppgaver, filer, siste svar) som atom, key per økt; S = siste vending (samtaleS, friksjon 9)
//   prompt UserPromptSubmit → M19 (skive 8, V16): prompten som egen sak idet den sendes (≥ 80 tegn, ikke kommando/bekreftelse), nøkkel
//                          prompt:<økt8>:<sha8> — samme som importen, så importen etterpå gir «uendret». STUM: stdout blir kontekst for modellen.
//          svar-modusen lagrer også prompten (siste brukermelding i transkriptet) FØR lengdesjekken, og kobler: svaret får prompten i
//          bygget_av, prompten får svaret i ga. Samme svar-hash som importen (sha8), så hook og import aldri lager to atomer av ett svar.
//   Runde 3a (arb. 32, 03-avisen §5): start-modus skriver også «Siden sist i Tua» for prosjektet (dora.js sidenSist) — Tua → Claude i Code.
//   Runde 2c (arb. 32 §5 sp. 1, 24.10.2026): økt-, prompt- og svar-sakene får `fanget: true` — Fanget-bøtta, utenfor avisen og søket til brukeren løfter dem inn
//          (Behold / Slå sammen / Kast). fil-modus får det IKKE: et dokument Claude skrev ligger på disk og er laget med vilje (Forsidens «Dokumenter», runde 1).
//   Friksjon 20 + økt-sakene (25.10.2026): økt-saken er en SAMTALE-sak (kind samtale, kilde «Claude Code», tittel uten «Økt: »). «Oppgaver» har bare det et menneske
//          skrev (import.stripReminders: systemblokker, [Image: …], bakgrunnstekst fra startøkta og harness-linjer ut), med klokkeslett; L har HELE siste svar og hele
//          lista over filer som ble skrevet; S = siste vending (samtaleS), M = første spørsmål + siste svar + filene (samtaleM, M_av regel). Og ARBEIDET: ved første
//          prompt (og ved start når det er noe å si) lages samtale-saken med `gren` og `vert`, og kobles til et arbeid etter regelen i arbeid.js — forelder (startet fra
//          en annen økt), gren (felles stamme) eller tittel; ellers `hører_til_forslag` = nyeste åpne arbeid i prosjektet (Erik: Tua foreslår med én gang). Siden sist
//          i appen spør «hører den til …? Ja / Annet / Nei»; i Claude: tua_link(id=<samtale-sak>, arbeid=<arbeid>). Filer skrevet (fil-modus) henger på samme arbeid.
//
// Leser hook-input som JSON på stdin. Skriver gjennom samme store.js (og fil-lås) som serveren — ikke via MCP,
// fordi en hook må kunne filtrere (lengde, filtype) før den eventuelt lagrer, og `mcp_tool`-typen kan ikke det.
// Aldri blokkerende: avslutter alltid med 0. Logger til <arkiv>/.tua/hooks.jsonl. Gjør ingenting før arkivet er valgt.
// Slås av med plugin-innstillingen «Automatisk fangst» (CLAUDE_PLUGIN_OPTION_AUTO_LAGRING=false) — påminnelsen (start) går uansett.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const mod = (f) => pathToFileURL(path.join(HERE, '..', 'server', f)).href     // M18: dynamisk import må være en file://-URL på Windows
const mode = process.argv[2]
const auto = String(process.env.CLAUDE_PLUGIN_OPTION_AUTO_LAGRING).toLowerCase() !== 'false'
if (!auto && mode !== 'start') process.exit(0)
// Samme arkiv som serveren: innstillingen «arkivmappe» → TUA_FILES_ROOT; cache i plugin-data, ikke i plugin-mappa.
// Innstillingen kommer bare hit (CLAUDE_PLUGIN_OPTION_<NAVN>); MCP-serveren får den ikke, og .mcp.json kan ikke referere
// ${user_config.…} uten at Cowork lar serveren stå (0.5.1). Derfor fører start-modus den inn i ~/.tua/config.json under.
const arkivmappe = String(process.env.CLAUDE_PLUGIN_OPTION_ARKIVMAPPE || '').trim()
if (!process.env.TUA_FILES_ROOT && arkivmappe) process.env.TUA_FILES_ROOT = path.resolve(arkivmappe.replace(/^~(?=$|\/)/, process.env.TUA_HOME || os.homedir()))
if (!process.env.TUA_DATA_DIR && process.env.CLAUDE_PLUGIN_DATA) process.env.TUA_DATA_DIR = path.join(process.env.CLAUDE_PLUGIN_DATA, 'data')
const store = await import(mod('store.js'))
const imp = await import(mod('import.js'))
const desk = await import(mod('desktop.js'))
const dora = await import(mod('dora.js'))                                     // runde 3a: «Siden sist i Tua» som én linje ved øktstart (Tua → Claude)
const { posix, insideTmp } = await import(mod('platform.js'))
const { load, save, upsert, filesMode, S_MAX, SHORT_L, importState, mergeGa } = store
const arb = await import(mod('arbeid.js'))                                   // friksjon 20: arbeidet som samler — kobling og forslag
const { parseCodeSession, projectOfCwd, repoRootOf, titleOf, firstPara, isDataDump, MIN_SVAR, inboxPending, pendingCodeSessions, pendingCoworkSessions, pendingCodexSessions, historyCounts, sha8, promptKey, worthKeeping, promptTitle, promptL, firstSentence, samtaleS, samtaleM, forelderAv, isTuaCommand } = imp

// 0.5.1: innstillingen «arkivmappe» → ~/.tua/config.json, samme fil og samme skrivemåte som tua_setup (store.chooseArchive),
// så serveren finner arkivet uten TUA_FILES_ROOT — også i Cowork, der innstillingen aldri når serveren. Bare når innstillingen
// er satt og peker et annet sted enn config alt gjør; en tom innstilling rører aldri et valg brukeren har tatt med tua_setup.
let konfigurert = null
if (mode === 'start' && arkivmappe) {
  const want = process.env.TUA_FILES_ROOT, before = store.readConfig().root || null
  if (before !== want) {
    try { const known = store.archiveOptions().find((o) => o.path === want); store.chooseArchive(known ? known.id : want); konfigurert = { root: want, before } } catch {}
  }
}
const { FILES_ROOT } = store

if (!filesMode()) process.exit(0)                                   // arkivet er ikke valgt ennå — serveren spør ved første verktøykall

const input = await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => (d += c)); process.stdin.on('end', () => { try { r(JSON.parse(d || '{}')) } catch { r({}) } }) })
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const log = (entry) => { try { fs.mkdirSync(path.join(FILES_ROOT, '.tua'), { recursive: true }); fs.appendFileSync(path.join(FILES_ROOT, '.tua', 'hooks.jsonl'), JSON.stringify({ at: Date.now(), mode, ...entry }) + '\n') } catch {} }
const insideArchive = (p) => { const r = path.relative(FILES_ROOT, p); return r && !r.startsWith('..') && !path.isAbsolute(r) }
const DAYS = 864e5
// M24: git-rota for cwd (worktree → hovedrepoet), eller '' utenfor et repo. .git kan være mappe (repo) eller fil (worktree).
const gitRootOf = (c) => { let d = repoRootOf(c); for (let i = 0; i < 8 && d; i++) { if (fs.existsSync(path.join(d, '.git'))) return d; const up = path.dirname(d); if (up === d) break; d = up } return '' }
// M24: tilbudet om /tua_auto gis én gang per repo per 30 dager — ellers maser hooken i hver økt
const offerOnce = (root) => { const f = path.join(FILES_ROOT, '.tua', 'auto-tilbudt.json'); let s = {}; try { s = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}; if (s[root] && Date.now() - s[root] < 30 * DAYS) return false; s[root] = Date.now(); try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n') } catch {}; return true }

try {
  const cwd = input.cwd || process.cwd()
  const project = projectOfCwd(cwd)
  const sid = input.session_id || ''
  const tr = input.transcript_path ? parseCodeSession(input.transcript_path) : null
  // samtalenavnet: tittelen, ellers første prompt — i prompt-modus er transkriptet ennå uten denne meldingen, så den første prompten er input.prompt
  const convo = tr?.title || (tr?.prompts[0] ? clip(flat(tr.prompts[0]), 60) : input.prompt && imp.stripReminders(input.prompt) ? clip(flat(imp.stripReminders(input.prompt)), 60) : `Samtale i ${project} ${new Date().toLocaleDateString('no-NO')}`)   // friksjon 20: aldri «Økt» i tittelen
  const repo = [{ kind: 'repo', href: repoRootOf(cwd), label: `Repo — ${project}` }]   // samme lenke (med etikett) som import.js, så import etter hook gir «uendret»
  // M19: prompt-saken for én brukermelding — samme nøkkel, navn, S og tagger som import.js, så importen etterpå sier «uendret»
  const promptSak = (atoms, p) => upsert(atoms, { key: promptKey(sid, p), kind: 'prompt', name: promptTitle(p), content: promptL(p), project, convo, source: 'Claude Code', by: 'regel', tags: ['prompt', 'code'], links: repo, short: firstSentence(p), summary: `Spørsmål stilt i Claude Code-økta «${convo}».`, fanget: true })   // samme tekst som import.js (ellers bumper importen versjonen)
  // ── Friksjon 20: samtale-saken (okt:<sid>) og koblingen til et arbeid ──
  const KILDE = 'Claude Code'
  const erTuaRepoHer = fs.existsSync(path.join(repoRootOf(cwd), 'tua-plugin', 'server', 'store.js'))   // runde 2d (03-avisen §5 E): en økt i Tua-repoet er en byggeøkt — drift (Tua om seg selv), ikke spor
  // grenen: fra transkriptet (gitBranch), ellers .git/HEAD i cwd (en worktree har .git som fil med «gitdir: …»)
  const grenAv = (c) => { try { let g = path.join(c, '.git'); if (fs.statSync(g).isFile()) { const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/); if (!m) return ''; g = path.resolve(c, m[1].trim()) } const h = fs.readFileSync(path.join(g, 'HEAD'), 'utf8').trim(); const m = h.match(/^ref: refs\/heads\/(.+)$/); return m ? m[1] : '' } catch { return '' } }
  const gren = tr?.gren || grenAv(cwd) || ''
  const vert = String(process.env.CLAUDE_CODE_HOST_SESSION_ID || '').trim()                       // denne øktas verts-id i Desktop-appen (local_…) — barneøkter finner forelderen på den
  const forelder = tr?.forelder || forelderAv(input.prompt) || ''                                   // startet fra en annen økt: forelderens local_-id står i stien til notatmappa
  const kobling = (atoms) => arb.arbeidForslag(atoms, { prosjekt: project, tittel: convo, gren, forelder, sid })
  const klokke = (t) => (t ? new Date(t).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }) : '')
  const når = (t) => (t ? new Date(t).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' }) : '')
  const oppgave = (p) => clip(flat(p), 1000)
  // samtale-saken: kind samtale, kilde vist, tittel uten «Økt: », gren og vert som spor, kobling eller forslag — innholdet gis av kalleren (stubb ved start/første prompt, hele ved okt)
  const samtaleSak = (atoms, { content, short, medium, summary, k = kobling(atoms) }) => {
    const r = upsert(atoms, {
      key: `okt:${sid}`, kind: 'samtale', name: convo, content, project, convo, source: KILDE, by: 'regel', tags: ['samtale', 'code'], links: repo, short, ...(medium ? { medium } : {}), summary, fanget: true,
      ...(erTuaRepoHer ? { drift: true } : {}), ...(gren ? { gren } : {}), ...(vert ? { vert } : {}),
      ...(k.hørerTil ? { hørerTil: k.hørerTil } : k.forslag ? { hørerTilForslag: k.forslag } : {}),
    })
    return { ...r, kobling: k }
  }
  const stubbInnhold = (p) => [`# ${convo}`, '', `_${KILDE} · samtalen er i gang · ${når(Date.now())}${gren ? ` · gren ${gren}` : ''}_`, '', '## Oppgaver', `- ${klokke(Date.now())} — ${oppgave(p)}`, ''].join('\n')

  if (mode === 'start') {
    // Påminnelse — standard i pluginen. Stdout fra SessionStart blir kontekst for Claude.
    const st = importState()
    const lastCode = st.code?.at || 0, lastCowork = st.cowork?.at || 0, lastCodex = st.codex?.at || 0
    const pending = pendingCodeSessions(lastCode), pendingCw = pendingCoworkSessions(lastCowork), pendingCx = pendingCodexSessions(lastCodex)
    const inbox = inboxPending()
    const days = lastCode ? Math.floor((Date.now() - lastCode) / DAYS) : null
    const daysCw = lastCowork ? Math.floor((Date.now() - lastCowork) / DAYS) : null
    const daysCx = lastCodex ? Math.floor((Date.now() - lastCodex) / DAYS) : null
    const parts = []
    if (inbox.length) parts.push(`${inbox.length} fil${inbox.length === 1 ? '' : 'er'} venter i Innboks (${inbox.join(', ')}) — de importeres av serveren når den starter, eller med tua_import(kilde=innboks)`)
    if (pending && (days === null || days >= 7)) parts.push(`${pending} Code-økt${pending === 1 ? '' : 'er'} er ikke tatt med i Tua${days === null ? ' (aldri importert)' : ` (siste import for ${days} dager siden)`} — tilby «ta med historikken» (tua_import kilde=code) én gang hvis det passer`)
    if (pendingCw && (daysCw === null || daysCw >= 7)) parts.push(`${pendingCw} Cowork-økt${pendingCw === 1 ? '' : 'er'} er ikke tatt med${daysCw === null ? ' (aldri importert)' : ` (siste import for ${daysCw} dager siden)`} — tua_import(kilde=cowork)`)
    // 28.10.2026: Codex (CLI og ChatGPT-appen) har ingen hooks — importen er eneste fangst
    if (pendingCx && (daysCx === null || daysCx >= 7)) parts.push(`${pendingCx} Codex-samtale${pendingCx === 1 ? '' : 'r'} (Codex CLI / ChatGPT-appen) er ikke tatt med${daysCx === null ? ' (aldri importert)' : ` (siste import for ${daysCx} dager siden)`} — tua_import(kilde=codex)`)
    // M17: Desktop-samtaler i cachen og dokumenter med AI-opphav — raske tall (forrige skanning / bare opphav), hooken har 10 s
    let hc = null
    try { hc = historyCounts({ quick: true, fresh: true }) } catch {}
    const lastDesk = st.desktop?.at || 0, daysDesk = lastDesk ? Math.floor((Date.now() - lastDesk) / DAYS) : null
    if (hc?.desktopNew && (daysDesk === null || daysDesk >= 7)) parts.push(`${hc.desktopNew} Desktop-samtale${hc.desktopNew === 1 ? '' : 'r'} i Claude Desktops cache er ikke tatt med — tua_import(kilde=desktop); leses ellers av seg selv når serveren kjører`)
    if (hc?.dokumenter && !st.finder) parts.push(`${hc.dokumenter} dokument${hc.dokumenter === 1 ? '' : 'er'} med AI-opphav i Nedlastinger/Dokumenter/Skrivebord er ikke i Tua — tua_import(kilde=finder)`)
    // 21.10: helsesjekkens varsel (docs/rutine-helsesjekk.md steg 7) — rødt i natt → si det i første økt, så slettes fila
    try { const vf = path.join(FILES_ROOT, '.tua', 'helsesjekk-varsel.txt'); const v = fs.readFileSync(vf, 'utf8').trim(); if (v) parts.push(`VARSEL fra Tua-helsesjekken i natt: ${v} — rapporten ligger som atom «Helsesjekk <dato>» i prosjekt Tua. Si det til brukeren først`); fs.unlinkSync(vf) } catch {}
    // 21.10 (Erik): resultatet presenteres som Tua-kort når det er klart — første økt etter kjøringen viser rapporten én gang
    try {
      const sf = path.join(FILES_ROOT, '.tua', 'helsesjekk-siste.json'); const s = JSON.parse(fs.readFileSync(sf, 'utf8'))
      if (s && s.id && !s.shown) { parts.push(`Helsesjekken ${s.date} er klar (${s.S}) — vis den som kort med en gang: tua_card(id="${s.id}")`); fs.writeFileSync(sf, JSON.stringify({ ...s, shown: true, shownAt: Date.now() }, null, 2) + '\n') }
      // 30.10: stillhetsvakt for helsesjekken selv — natt til 30.10 døde launchd-jobben (EX_CONFIG, loggfila hadde fått TCC-merke) uten
      // et ord i noen logg. Siste rapport eldre enn 36 timer etter kl. 04 → si fra, så det ikke går dager før noen merker det.
      if (s && s.at && Date.now() - s.at > 36 * 3600 * 1000 && new Date().getHours() >= 4) parts.push(`VARSEL: Tua-helsesjekken har ikke kjørt siden ${s.date} — launchd-jobben kan ha stoppet (se: launchctl print gui/$(id -u)/com.tuacircles.helsesjekk | grep "last exit"). Kjør den nå: cd tua-plugin && node server/helsesjekk.js. Si det til brukeren først`)
    } catch {}
    // 20.10: stillhetsvakt — leseren var blind fra 15.09 til 20.10 uten at noen merket det. Desktop i bruk, men ingen ny samtale sett på 14 dager → si fra.
    try { const ds = desk.desktopStaleness(); if (ds.stale) parts.push(`VARSEL: Desktop-leseren har ikke sett noen ny samtale på ${ds.days} dager selv om Claude Desktop er i bruk — Desktop kan ha flyttet samtalene igjen (som 15.09.2026, se STATUS.md «Desktop-leseren»). Si det til brukeren`) } catch {}
    // M24: aldri importert → pek på /tua_start (alt inn + automatikken på). Et git-repo uten .tua-sync.json → tilby /tua_auto,
    // én gang per repo per 30 dager (husket i <arkiv>/.tua/auto-tilbudt.json). Begge er tilbud; ingenting kjøres uten ja.
    const extra = []
    if (!st.last) extra.push('ingen historikk er tatt med ennå — /tua_start tar med alt og slår på automatikken; nevn det én gang hvis det passer')
    const root = gitRootOf(cwd)
    if (root && !fs.existsSync(path.join(root, '.tua-sync.json')) && !insideArchive(root) && offerOnce(root)) extra.push(`repoet «${path.basename(root)}» speiles ikke til Tua ennå (ingen .tua-sync.json) — tilby /tua_auto én gang hvis det passer: node "${path.join(HERE, '..', 'server', 'sync-tua.js')}" --project "${path.basename(root)}" --install-hook`)
    // Runde 3a (03-avisen §5): det som er gjort i Tua-appen for prosjektet de siste 7 dagene (Spør-tråder, konklusjoner, delinger, filer lest inn) — én linje,
    // så Claude og brukeren ser det uten å spørre. Fanget og drift holdes utenfor. Aldri innhold — titler og tall.
    let siden = '', arbeidLinje = ''
    try {
      const atoms = load()
      const s = dora.sidenSist(atoms, { prosjekt: project })
      // skive 4 (arb. 33): linja skjermes som alt annet Claude får (titlene på Spør-tråder og Tua-samtaler kan bære navn); «Samtaler i Tua: N, siste «…»» er med
      if (s.noe) { const { skjermerFor } = await import(mod('motor.js')); const sk = skjermerFor(atoms); siden = sk.skjerm(`Siden sist i Tua (7 dager, ${project}): ${[...s.linjer.map((l) => l.tekst), ...(s.samtaler ? [s.samtaler.tekst] : [])].join(' · ')}${s.lagret ? ` · ${s.lagret} ${s.lagret === 1 ? 'sak' : 'saker'} lagret med vilje` : ''} — nevn det i én setning hvis det passer; tua_search(project="${project}") finner sakene`) }
      // Friksjon 20 (Erik: Tua foreslår med én gang): hører samtalen til et arbeid — automatisk (forelder, gren, tittel) eller som forslag — lages samtale-saken nå, så appen og Claude har noe å peke på
      if (sid && !atoms.some((a) => a.key === `okt:${sid}`)) {
        const k = kobling(atoms)
        if (k.hørerTil || k.forslag) {
          const { atom, status } = samtaleSak(atoms, { content: stubbInnhold(input.prompt || convo), short: `Samtale i ${project} (${KILDE}) — i gang.`, summary: `Samtale i ${KILDE}, lagret automatisk ved start.`, k })
          if (status !== 'uendret') save(atoms)
          const w = atoms.find((a) => a.id === (k.hørerTil || k.forslag))
          arbeidLinje = k.hørerTil ? `Denne samtalen hører til arbeidet «${w?.name || k.hørerTil}» i Tua (koblet via ${k.grunn}); samtale-saken er ${atom.id}`
            : `Tua foreslår at denne samtalen hører til arbeidet «${w?.name || k.forslag}» (${k.åpne?.[0]?.samtaler ?? 0} samtaler fra før) — sier brukeren ja, eller «hører til …», kall tua_link(id="${atom.id}", arbeid="${k.forslag}"); ellers spør ikke`
          log({ samtaleSak: atom.id, status, kobling: k.grunn || 'forslag', arbeid: k.hørerTil || k.forslag })
        } else if (k.åpne?.length) arbeidLinje = `Arbeid i gang i ${project}: ${k.åpne.slice(0, 3).map((r) => `«${r.name}» (${r.samtaler} ${r.samtaler === 1 ? 'samtale' : 'samtaler'})`).join(', ')} — hører denne samtalen til ett av dem, sier brukeren det («hører til …»)`
      }
    } catch (e) { log({ error: `start: ${e?.message || e}` }) }
    if (parts.length || extra.length || siden || arbeidLinje) process.stdout.write(`Tua: ${[...parts, ...extra, siden, arbeidLinje].filter(Boolean).join('. ')}. ${parts.length ? 'Ett ja fra brukeren → tua_import(kilde=alt, dryRun=true) viser omfanget først. ' : ''}Ikke kjør noe uten at brukeren sier ja.\n`)
    log({ pending, pendingCw, desktop: hc?.desktopNew, dokumenter: hc?.dokumenter, inbox: inbox.length, days, daysCw, first: !st.last, repoOffer: extra.length > (st.last ? 0 : 1) })
    if (konfigurert) log({ arkivmappe: konfigurert.root, before: konfigurert.before, note: 'innstillingen «arkivmappe» skrevet til ~/.tua/config.json' })
  } else if (mode === 'prompt') {
    // M19: UserPromptSubmit. Skriver ALDRI til stdout (det ville blitt kontekst i prompten). Svaret kobles på i svar-modus.
    const p = imp.stripReminders(String(input.prompt || ''))                                       // friksjon 20: systemtekst (bakgrunn fra startøkta, blokker, markører) er ikke brukerens prompt — samme hash som importen
    const atoms = load()
    // friksjon 20: første ekte melding i en samtale → samtale-saken finnes fra nå (stubb; okt-modus fyller den), med gren, vert og kobling/forslag til et arbeid —
    // uavhengig av om meldingen er lang nok til å bli en prompt-sak (≥ 20 tegn, ikke en /tua-kommando, ikke en melding som bare var systemtekst)
    let stubb = null
    if (sid && !(tr?.prompts?.length) && p.length >= 20 && !isTuaCommand(p) && !atoms.some((a) => a.key === `okt:${sid}`)) {
      const r = samtaleSak(atoms, { content: stubbInnhold(p), short: `Samtale i ${project} (${KILDE}) — i gang: «${clip(flat(p), 120)}»`, summary: `Samtale i ${KILDE}, lagret automatisk ved første melding.` })
      stubb = { id: r.atom.id, status: r.status, kobling: r.kobling.grunn || (r.kobling.forslag ? 'forslag' : null) }
    }
    if (!worthKeeping(p)) { if (stubb && stubb.status !== 'uendret') save(atoms); log({ skipped: 'kort/kommando', len: p.length, ...(stubb ? { samtaleSak: stubb.id, kobling: stubb.kobling } : {}) }); process.exit(0) }
    const { atom, status } = promptSak(atoms, p)
    if (status !== 'uendret' || (stubb && stubb.status !== 'uendret')) save(atoms)
    log({ status, id: atom.id, project, len: p.length, ...(stubb ? { samtaleSak: stubb.id, kobling: stubb.kobling } : {}) })
  } else if (mode === 'svar') {
    const msg = String(input.last_assistant_message || '').trim()
    const atoms = load()
    // M19: prompten som ga svaret (siste brukermelding i transkriptet) lagres FØR lengdesjekken — den er brukerens investering også når svaret er kort (V16)
    const par = tr?.pairs?.length ? tr.pairs.at(-1) : null
    let pa = null, endret = false
    if (par && worthKeeping(par.prompt)) { const r = promptSak(atoms, par.prompt); pa = r.atom; endret = r.status !== 'uendret' }
    const stopp = (why) => { if (endret) save(atoms); log({ skipped: why, len: msg.length, prompt: pa?.id }); process.exit(0) }
    if (msg.length < MIN_SVAR) stopp('kort')
    if (isDataDump(msg)) stopp('data-dump')
    if (imp.isTuaEcho(msg)) stopp('tua-ekko')   // 20.10: et svar som bare gjengir et Tua-søk/-kort er ikke nytt innhold
    const { atom, status } = upsert(atoms, {
      key: `svar:${sid.slice(0, 8)}:${sha8(msg)}`, kind: 'capture', name: titleOf(msg, `Svar i ${convo}`), content: msg, project, convo, source: 'Claude', by: 'regel',
      tags: ['svar', 'auto'], links: repo, ...(pa ? { derivedFrom: [{ id: pa.id, version: pa.version || 1, level: 'L' }] } : {}),
      short: clip(firstPara(msg), S_MAX), summary: `Substansielt svar i Code-økta «${convo}».`, fanget: true,   // samme tekst som import.js — ellers gir importen etterpå en falsk ny versjon
    })
    if (pa) { const før = JSON.stringify(pa.ga || []); pa.ga = mergeGa(pa.ga, [{ id: atom.id, version: atom.version || 1 }]); endret = endret || JSON.stringify(pa.ga) !== før }
    if (status !== 'uendret' || endret) save(atoms)
    log({ status, id: atom.id, project, len: msg.length, prompt: pa?.id })
  } else if (mode === 'fil') {
    const fp = input.tool_input?.file_path
    // bare tekstdokumenter; ikke kode, ikke avhengigheter, ikke Claude-oppsett (men worktree-mapper under .claude/worktrees/ er ekte arbeid), ikke temp, ikke arkivet selv
    const fq = posix(fp)                                            // M18: Windows-stier testes i posix-form
    if (!fp || !/\.(md|markdown|txt|rst)$/i.test(fq) || /\/(node_modules|\.tua|\.git)\//.test(fq) || /\/\.claude\/(?!worktrees\/)/.test(fq) || (!process.env.TUA_HOOK_ALLOW_TMP && insideTmp(fp)) || /\/CLAUDE\.md$/.test(fq) || insideArchive(fp)) { log({ skipped: 'filtype/sti', file: fp }); process.exit(0) }
    let content = ''
    try { content = fs.readFileSync(fp, 'utf8') } catch { process.exit(0) }
    if (content.trim().length < SHORT_L) { log({ skipped: 'kort', file: fp }); process.exit(0) }
    if (isDataDump(content)) { log({ skipped: 'data-dump', file: fp }); process.exit(0) }
    const atoms = load()
    const old = atoms.find((a) => a.key === `fil:${fp}`)
    const samtalen = atoms.find((a) => a.key === `okt:${sid}`)                                      // friksjon 20: fila henger på samtalens arbeid
    const { atom, status } = upsert(atoms, {
      key: `fil:${fp}`, name: titleOf(content, path.basename(fp, path.extname(fp))), content, project, convo: old && old.content === content.trim() ? old.convo : convo, source: 'Claude', by: 'regel',   // uendret innhold i ny økt = ikke ny versjon
      tags: ['dokument', 'auto'], links: [{ kind: 'file', href: fp }, ...repo], short: clip(firstPara(content), S_MAX),
      summary: `Skrevet i Claude Code (${input.tool_name}), lagret automatisk med lenke til fila.`, ...(samtalen?.hørerTil ? { hørerTil: samtalen.hørerTil } : {}),
    })
    if (status !== 'uendret') save(atoms)
    log({ status, id: atom.id, project, file: fp })
  } else if (mode === 'okt') {
    // friksjon 20 (økt-sakene): «Oppgaver» = det et menneske skrev, med klokkeslett og i rekkefølge (parseCodeSession har alt filtrert systemtekst); L har HELE siste svar og HELE fillista
    if (!tr || tr.prompts.length < 1) { log({ skipped: 'ingen menneskeprompt', prompts: tr?.prompts.length || 0, harness: tr?.harness || 0 }); process.exit(0) }
    const files = [...new Set([...tr.files.keys(), ...tr.edited])].filter((f) => !/\/(node_modules|\.tua)\//.test(f))
    const content = [
      `# ${convo}`, '',
      `_${KILDE} · ${tr.turns} oppgaver · ${når(tr.first)}${tr.last && når(tr.last) !== når(tr.first) ? ` – ${når(tr.last)}` : ''} · ${project}${gren ? ` · gren ${gren}` : ''} · ${input.hook_event_name}${input.reason ? ` (${input.reason})` : input.trigger ? ` (${input.trigger})` : ''}_`, '',
      '## Oppgaver', ...tr.pairs.map((p) => `- ${klokke(p.at)} — ${oppgave(p.prompt)}`), '',
      files.length ? '## Filer skrevet' : null, ...files.map((f) => `- ${f}`), files.length ? '' : null,
      tr.lastAssistant ? '## Siste svar' : null, tr.lastAssistant ? tr.lastAssistant.trim() : null,
    ].filter((l) => l !== null).join('\n')
    const atoms = load()
    const { atom, status, kobling: k } = samtaleSak(atoms, {
      content, short: samtaleS(tr),   // friksjon 9 (24.10.2026): S = siste vending («Sist: … → …», antall og periode), samme regel som importen — ikke første prompt
      medium: samtaleM({ ...tr, filer: files, kilde: KILDE }),   // friksjon 20: M = første spørsmål + siste svar + filene (regel; gemma kan skrive den på nytt fra Innstillinger)
      summary: `Samtale i ${KILDE}, lagret automatisk ved ${input.hook_event_name}.`,
    })
    if (tr.first && atom.createdAt !== tr.first) { atom.createdAt = tr.first; store.markDirty(atoms, atom.id) }   // samtalen begynte da første melding kom — løpet ordner samtalene etter det
    // filene denne samtalen skrev henger på samme arbeid (de som finnes som saker nå — fil-modus tar de neste)
    if (atom.hørerTil) for (const f of files) { const fa = atoms.find((a) => a.key === `fil:${f}`); if (fa && !fa.hørerTil) { fa.hørerTil = atom.hørerTil; store.markDirty(atoms, fa.id) } }
    if (status !== 'uendret' || store.dirtyIds(atoms).length) save(atoms)
    log({ status, id: atom.id, project, turns: tr.turns, filer: files.length, harness: tr.harness, kobling: k.grunn || (k.forslag ? 'forslag' : null) })
  }
} catch (e) {
  log({ error: String(e?.message || e) })
}
process.exit(0)
