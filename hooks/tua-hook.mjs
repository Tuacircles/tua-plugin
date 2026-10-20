#!/usr/bin/env node
// tua-hook.mjs — Claude Code-hooks for Tua-pluginen (M14). Ett skript, fire moduser:
//
//   start  SessionStart  → påminnelse (som kontekst) når Innboks har filer eller Code-økter ikke er importert på en stund;
//                          M24: peker på /tua_start første gang, og tilbyr /tua_auto når repoet mangler .tua-sync.json
//   svar   Stop          → lagre siste substansielle svar (≥ 1 500 tegn) som atom
//   fil    PostToolUse   → Write|Edit på et tekstdokument (.md/.txt/…) → atom med file-lenke; samme fil = ny versjon
//   okt    PreCompact/SessionEnd → økt-sammendrag (oppgaver, filer, siste svar) som atom, key per økt
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
const { posix, insideTmp } = await import(mod('platform.js'))
const { load, save, upsert, filesMode, S_MAX, SHORT_L, importState } = store
const { parseCodeSession, projectOfCwd, repoRootOf, titleOf, firstPara, MIN_SVAR, inboxPending, pendingCodeSessions, pendingCoworkSessions, historyCounts } = imp

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
  const convo = tr?.title || (tr?.prompts[0] ? clip(flat(tr.prompts[0]), 60) : `Code-økt ${sid.slice(0, 8)}`)
  const repo = [{ kind: 'repo', href: repoRootOf(cwd) }]

  if (mode === 'start') {
    // Påminnelse — standard i pluginen. Stdout fra SessionStart blir kontekst for Claude.
    const st = importState()
    const lastCode = st.code?.at || 0, lastCowork = st.cowork?.at || 0
    const pending = pendingCodeSessions(lastCode), pendingCw = pendingCoworkSessions(lastCowork)
    const inbox = inboxPending()
    const days = lastCode ? Math.floor((Date.now() - lastCode) / DAYS) : null
    const daysCw = lastCowork ? Math.floor((Date.now() - lastCowork) / DAYS) : null
    const parts = []
    if (inbox.length) parts.push(`${inbox.length} fil${inbox.length === 1 ? '' : 'er'} venter i Innboks (${inbox.join(', ')}) — de importeres av serveren når den starter, eller med tua_import(kilde=innboks)`)
    if (pending && (days === null || days >= 7)) parts.push(`${pending} Code-økt${pending === 1 ? '' : 'er'} er ikke tatt med i Tua${days === null ? ' (aldri importert)' : ` (siste import for ${days} dager siden)`} — tilby «ta med historikken» (tua_import kilde=code) én gang hvis det passer`)
    if (pendingCw && (daysCw === null || daysCw >= 7)) parts.push(`${pendingCw} Cowork-økt${pendingCw === 1 ? '' : 'er'} er ikke tatt med${daysCw === null ? ' (aldri importert)' : ` (siste import for ${daysCw} dager siden)`} — tua_import(kilde=cowork)`)
    // M17: Desktop-samtaler i cachen og dokumenter med AI-opphav — raske tall (forrige skanning / bare opphav), hooken har 10 s
    let hc = null
    try { hc = historyCounts({ quick: true, fresh: true }) } catch {}
    const lastDesk = st.desktop?.at || 0, daysDesk = lastDesk ? Math.floor((Date.now() - lastDesk) / DAYS) : null
    if (hc?.desktopNew && (daysDesk === null || daysDesk >= 7)) parts.push(`${hc.desktopNew} Desktop-samtale${hc.desktopNew === 1 ? '' : 'r'} i Claude Desktops cache er ikke tatt med — tua_import(kilde=desktop); leses ellers av seg selv når serveren kjører`)
    if (hc?.dokumenter && !st.finder) parts.push(`${hc.dokumenter} dokument${hc.dokumenter === 1 ? '' : 'er'} med AI-opphav i Nedlastinger/Dokumenter/Skrivebord er ikke i Tua — tua_import(kilde=finder)`)
    // M24: aldri importert → pek på /tua_start (alt inn + automatikken på). Et git-repo uten .tua-sync.json → tilby /tua_auto,
    // én gang per repo per 30 dager (husket i <arkiv>/.tua/auto-tilbudt.json). Begge er tilbud; ingenting kjøres uten ja.
    const extra = []
    if (!st.last) extra.push('ingen historikk er tatt med ennå — /tua_start tar med alt og slår på automatikken; nevn det én gang hvis det passer')
    const root = gitRootOf(cwd)
    if (root && !fs.existsSync(path.join(root, '.tua-sync.json')) && !insideArchive(root) && offerOnce(root)) extra.push(`repoet «${path.basename(root)}» speiles ikke til Tua ennå (ingen .tua-sync.json) — tilby /tua_auto én gang hvis det passer: node "${path.join(HERE, '..', 'server', 'sync-tua.js')}" --project "${path.basename(root)}" --install-hook`)
    if (parts.length || extra.length) process.stdout.write(`Tua: ${[...parts, ...extra].join('. ')}. ${parts.length ? 'Ett ja fra brukeren → tua_import(kilde=alt, dryRun=true) viser omfanget først. ' : ''}Ikke kjør noe uten at brukeren sier ja.\n`)
    log({ pending, pendingCw, desktop: hc?.desktopNew, dokumenter: hc?.dokumenter, inbox: inbox.length, days, daysCw, first: !st.last, repoOffer: extra.length > (st.last ? 0 : 1) })
    if (konfigurert) log({ arkivmappe: konfigurert.root, before: konfigurert.before, note: 'innstillingen «arkivmappe» skrevet til ~/.tua/config.json' })
  } else if (mode === 'svar') {
    const msg = String(input.last_assistant_message || '').trim()
    if (msg.length < MIN_SVAR) { log({ skipped: 'kort', len: msg.length }); process.exit(0) }
    const atoms = load()
    const sha = crypto.createHash('sha1').update(msg).digest('hex').slice(0, 8)
    const { atom, status } = upsert(atoms, {
      key: `svar:${sid.slice(0, 8)}:${sha}`, name: titleOf(msg, `Svar i ${convo}`), content: msg, project, convo, source: 'Claude', by: 'regel',
      tags: ['svar', 'auto'], links: repo, short: clip(firstPara(msg), S_MAX), summary: 'Svar fra Claude Code, lagret automatisk (Stop-hook).',
    })
    if (status !== 'uendret') save(atoms)
    log({ status, id: atom.id, project, len: msg.length })
  } else if (mode === 'fil') {
    const fp = input.tool_input?.file_path
    // bare tekstdokumenter; ikke kode, ikke avhengigheter, ikke Claude-oppsett (men worktree-mapper under .claude/worktrees/ er ekte arbeid), ikke temp, ikke arkivet selv
    const fq = posix(fp)                                            // M18: Windows-stier testes i posix-form
    if (!fp || !/\.(md|markdown|txt|rst)$/i.test(fq) || /\/(node_modules|\.tua|\.git)\//.test(fq) || /\/\.claude\/(?!worktrees\/)/.test(fq) || (!process.env.TUA_HOOK_ALLOW_TMP && insideTmp(fp)) || /\/CLAUDE\.md$/.test(fq) || insideArchive(fp)) { log({ skipped: 'filtype/sti', file: fp }); process.exit(0) }
    let content = ''
    try { content = fs.readFileSync(fp, 'utf8') } catch { process.exit(0) }
    if (content.trim().length < SHORT_L) { log({ skipped: 'kort', file: fp }); process.exit(0) }
    const atoms = load()
    const old = atoms.find((a) => a.key === `fil:${fp}`)
    const { atom, status } = upsert(atoms, {
      key: `fil:${fp}`, name: titleOf(content, path.basename(fp, path.extname(fp))), content, project, convo: old && old.content === content.trim() ? old.convo : convo, source: 'Claude', by: 'regel',   // uendret innhold i ny økt = ikke ny versjon
      tags: ['dokument', 'auto'], links: [{ kind: 'file', href: fp }, ...repo], short: clip(firstPara(content), S_MAX),
      summary: `Skrevet i Claude Code (${input.tool_name}), lagret automatisk med lenke til fila.`,
    })
    if (status !== 'uendret') save(atoms)
    log({ status, id: atom.id, project, file: fp })
  } else if (mode === 'okt') {
    if (!tr || tr.prompts.length < 2) { log({ skipped: 'for kort økt', prompts: tr?.prompts.length || 0 }); process.exit(0) }
    const when = (t) => (t ? new Date(t).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' }) : '')
    const files = [...new Set([...tr.files.keys(), ...tr.edited])].filter((f) => !/\/(node_modules|\.tua)\//.test(f))
    const content = [
      `# Økt: ${convo}`, '',
      `_${project} · ${tr.turns} oppgaver · ${when(tr.first)}${tr.last ? ` – ${when(tr.last)}` : ''} · ${input.hook_event_name}${input.reason ? ` (${input.reason})` : input.trigger ? ` (${input.trigger})` : ''}_`, '',
      '## Oppgaver', ...tr.prompts.slice(0, 30).map((p) => `- ${clip(flat(p), 160)}`), tr.prompts.length > 30 ? `- … og ${tr.prompts.length - 30} til` : null, '',
      files.length ? '## Filer skrevet' : null, ...files.slice(0, 40).map((f) => `- ${f}`), files.length ? '' : null,
      tr.lastAssistant ? '## Siste svar' : null, tr.lastAssistant ? clip(tr.lastAssistant.trim(), 1500) : null,
    ].filter((l) => l !== null).join('\n')
    const atoms = load()
    const { atom, status } = upsert(atoms, {
      key: `okt:${sid}`, name: `Økt: ${convo}`, content, project, convo, source: 'Claude', by: 'regel', tags: ['økt', 'auto'], links: repo,
      short: clip(`${tr.turns} oppgaver i ${project}${files.length ? `, ${files.length} filer skrevet` : ''}. Første: ${flat(tr.prompts[0])}`, S_MAX),
      summary: `Økt-sammendrag laget automatisk ved ${input.hook_event_name}.`,
    })
    if (status !== 'uendret') save(atoms)
    log({ status, id: atom.id, project, turns: tr.turns })
  }
} catch (e) {
  log({ error: String(e?.message || e) })
}
process.exit(0)
