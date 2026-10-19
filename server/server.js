#!/usr/bin/env node
// server.js — Tua som MCP-server (stdio).
//
//   tua_save    — lagre AI-output som atom (+ S/M som flate felt), proveniens automatisk, ingen mappe
//   tua_search  — søk på tvers av alle prosjekter; svarer med S (ingress), ikke utdrag
//   tua_get     — hent ett atom på nivå S, M eller L (+ relaterte, versjoner, adresse)
//   tua_list    — oversikt (+ hva som mangler S/M)
//   tua_link    — gjør synlig i annet prosjekt (referanse), valgfritt nivå S/M/L
//   tua_unlink  — fjern referansen
//   tua_compose — M10: bygg en leveranse av flere atomer (lest på S/M/L) → nytt atom med bygget_av
//
// M10/V15: hver utlevering (tua_get, tua_compose) logges i .tua/utlevering.jsonl (bare metadata);
// Vault-merkede atomer (tag «vault») utleveres aldri utover S; fil endret utenfor Tua = ny versjon.
// NB: stdout er MCP-protokollen. All logging må gå til stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { registerApps } from './apps.js'            // M13: Tua-kortet som MCP App (Desktop/web); tekst i Code
import {
  load, save, upsert, search, visibleIn, fmtTime, FILE, FILES_ROOT, filesMode, versions, readVersion, related,
  levelOf, maxLevel, clampLevel, setShare, isStale, needsLevel, S_MAX, M_MAX, SHORT_L, LONG_L,
  linksFor, LINK_KINDS, KINDS, fileOf,
  compose, sources, staleSources, renderStatus, isVault, vaultClamp, logDelivery, deliveries, hasExternalEdits,
  ensureArchive, onboardingActive, finishOnboarding, welcomeAtom, rootLabel, INBOX_DIR, WELCOME_KEY,
  archiveOptions, chooseArchive, importState,
} from './store.js'
import {
  watchInbox, importCode, processInbox, processInboxShares, inboxPending, pendingCodeSessions, CODE_PROJECTS, DEFAULT_MIN,
  importDesktop, importFinder, importShare, importAll, watchDesktop, historyCounts, historyLine,                           // M17: historikk-fangst uten eksport
} from './import.js'   // M14: «ta med historikken» + Innboks
import { watchFinder } from './finder.js'
// M17: vaktene — Innboks (eksporter og delte lenker), Desktop-cachen (hvert 10. min), Finder-mappene. Ingenting før arkivet er valgt.
const startWatchers = () => { const log = (m) => console.error(`[tua] ${m}`); watchInbox({ log }); watchDesktop({ log }); watchFinder({ log }) }
const CLIENT = process.env.TUA_CLIENT || (process.env.CLAUDECODE ? 'Claude Code' : 'Claude Desktop')
const ARKIV = () => (filesMode() ? FILES_ROOT : FILE)
const APP = process.env.TUA_APP_URL || 'http://127.0.0.1:5274/'          // M12: kartet som egen app (broen serverer det)
const addr = (id) => `${APP}#atom/${id}`           // atomets adresse i kartet (egen side) — samme id som her

// M14: første kjøring. Finnes et arkiv (eller et valg i ~/.tua/config.json), brukes det. Finnes ingenting, GJETTER vi ikke:
// det første verktøykallet spør brukeren hvor arkivet skal ligge (elicitation i klienter som støtter det, ellers via
// verktøysvaret + tua_setup). Først da lages mappa med velkomstatomet.
const firstRun = ensureArchive()
if (firstRun.needsChoice) console.error(`[tua] ingen Tua-mappe funnet — spør brukeren hvor arkivet skal ligge ved første verktøykall (${archiveOptions().filter((o) => o.available).map((o) => o.label).join(', ')})`)

// M14: serverinstruksjoner — «arkiv først». Leses av klienten ved oppstart (og av tool search i Code).
const INSTRUCTIONS =
  'Tua er brukerens ene arkiv for AI-arbeid, på tvers av alle prosjekter og klienter. Mappa på disk er sannheten; hvert atom er en markdown-fil. ' +
  'Regler: ' +
  '(1) ARKIV FØRST — før du svarer fra hukommelsen på noe som kan finnes fra før («hva har jeg om», «har vi noe om», «hva ble bestemt», tidligere arbeid, et navn eller tall du ikke er sikker på), kall tua_search. Treffene svarer med ingressen (S) — ofte nok. Hent M med tua_get(level=M) før L. ' +
  '(2) Svar kort: S og adresse. L bare når svaret krever det; hver utlevering logges. ' +
  '(3) TILBY, IKKE SKRIV — når du har levert noe verdt å finne igjen, spør én gang «Vil du at jeg lagrer dette til Tua?». Kall tua_save bare når brukeren sier ja eller selv ber om lagring. Spør aldri hvilken mappe; prosjektet er mappa. ' +
  '(4) Ved lagring: content = hele innholdet, short = ingress (alltid, ≤ 300 tegn), medium når over ~3 000 tegn, project = brukerens prosjektnavn, convo = 3–8 ord om samtalen. ' +
  '(5) Står det en linje som begynner med «oppsett:» eller «onboarding:» i et verktøysvar, følg den etter at du har svart på det brukeren ba om — det er brukerens første økt med Tua. Arkivstedet velger brukeren selv (tua_setup); gjett aldri. ' +
  '(6) «Ta med historikken»: alt som finnes lokalt fanges uten eksport — tua_import(kilde=alt) tar Code-økter (~/.claude/projects), Cowork-økter, Desktop-samtaler (fra Claude Desktops egen cache: alt som har vært åpnet i Desktop, med prosjekt) og dokumenter med AI-opphav i Nedlastinger/Dokumenter/Skrivebord (ved referanse). Kjør med dryRun=true først og vis tallene. Desktop-cachen leses også av seg selv hvert 10. minutt. ' +
  'Samtaler bare på claude.ai web/mobil: be brukeren åpne dem i Claude Desktop (så fanges de), eller lage en delt lenke («Del» → claude.ai/share/…) og lime den inn — tua_import(kilde=lenke, lenke=…) — eller legge eksporten i Innboks. Tua kaller aldri claude.ai sitt interne API og bruker aldri cookies. Les aldri eksporter inn i samtalen.'

const server = new McpServer({ name: 'tua', version: '0.4.0' }, { instructions: INSTRUCTIONS })

// M14: er arkivet ikke valgt, stoppes hvert verktøykall med et spørsmål om sted — via elicitation når klienten støtter det
// (Code gjør det), ellers som en «oppsett:»-linje modellen skal stille brukeren. Pakket rundt registerTool, så det gjelder
// alle verktøy (også kortets), uten unntak for tua_setup selv.
const optionLines = () => archiveOptions().map((o) => `${o.id} = ${o.label}${o.available ? ` (${o.path})` : ' — ikke funnet på denne maskinen'}`).join(' · ')
async function ensureReady(tool) {
  if (!ensureArchive().needsChoice || tool === 'tua_setup') return null
  const avail = archiveOptions().filter((o) => o.available)
  if (server.server.getClientCapabilities()?.elicitation) {
    try {
      const r = await server.server.elicitInput({
        message: 'Tua trenger en mappe for arkivet ditt — hvert atom blir en markdown-fil der. Hvor skal den ligge? (Kan endres senere i innstillingene.)',
        requestedSchema: { type: 'object', properties: { sted: { type: 'string', title: 'Arkivsted', description: 'Mappa «Tua» lages her', enum: avail.map((o) => o.id), enumNames: avail.map((o) => `${o.label} — ${o.path}`) } }, required: ['sted'] },
      })
      if (r.action === 'accept' && r.content?.sted) {
        const done = chooseArchive(r.content.sted)
        console.error(`[tua] arkivet valgt via elicitation: ${done.root} (${done.label})`)
        startWatchers()
        return null                                                   // fortsett med det opprinnelige kallet
      }
    } catch (e) { console.error(`[tua] elicitation feilet: ${e.message}`) }
  }
  return text(
    `oppsett: Tua har ikke noe arkiv på denne maskinen ennå, og gjetter ikke hvor det skal ligge. Spør brukeren — én gang, kort — hvor arkivet skal ligge: ` +
    `${avail.map((o) => `${o.label} (${o.path})`).join(', ')}${avail.length < archiveOptions().length ? ` [ikke funnet: ${archiveOptions().filter((o) => !o.available).map((o) => o.label).join(', ')}]` : ''}. ` +
    `Forklar i én setning: mappa synkes av tjenesten brukeren velger, og alt er vanlige markdown-filer. Når brukeren har valgt, kall tua_setup(sted=<id>) — id-er: ${avail.map((o) => o.id).join(', ')} — eller tua_setup(sti=<absolutt sti>) for en annen mappe. Deretter gjentar du det brukeren egentlig ba om (${tool}).`,
  )
}
const _register = server.registerTool.bind(server)
server.registerTool = (name, cfg, handler) => _register(name, cfg, async (a, extra) => (await ensureReady(name)) || handler(a, extra))

const text = (s) => ({ content: [{ type: 'text', text: s }] })
const LevelArg = z.enum(['S', 'M', 'L'])
// Verktøy-annotasjoner (MCP): readOnlyHint = endrer ikke arkivet; destructiveHint = kan ødelegge noe. Ingen Tua-verktøy sletter.
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true }

// M14: onboarding-linja — bare mens .tua/onboarding.json er «aktiv» (nyopprettet arkiv), slås av ved første lagring.
const onboardLine = (atoms) => {
  if (!onboardingActive()) return ''
  const w = welcomeAtom(atoms)
  const file = w ? fileOf(w) : ''
  return (
    `\n\nonboarding: Dette er brukerens første økt med Tua. Arkivet ble nettopp opprettet i ${FILES_ROOT} (${rootLabel()}). ` +
    'Etter at du har svart på det brukeren faktisk ba om, gjør dette i rekkefølge, kort: ' +
    `(1) Vis arkivet: si at mappa ligger i ${FILES_ROOT} og at velkomstatomet «Velkommen til Tua» ligger der${file ? ` (${file})` : ''}` +
    (CLIENT === 'Claude Code' ? '; brukeren kan åpne mappa i Finder. ' : `; tilby å vise det som kort (tua_card id=${w?.id || '…'}), som har «Vis i Finder». `) +
    '(2) Velg ÉN konkret ting fra denne samtalen som brukeren vil ha glede av å finne igjen senere, og spør én gang: «Vil du at jeg lagrer dette til Tua?» Kall ikke tua_save før brukeren tydelig sier ja. ' +
    '(3) Når det er lagret: si at det nå kan finnes igjen fra et hvilket som helst annet prosjekt eller verktøy med «hva har jeg om …», og at fila ligger i mappa. ' +
    historyStep() +
    'Ikke foreslå mapper, tagger eller oppsett — struktur kommer etter bruk. Denne linja forsvinner etter første lagring.'
  )
}
// M17: «Jeg fant N Code-økter, N Cowork-økter, N Desktop-samtaler, N dokumenter — vil du ta dem med?» Ett ja → tua_import(kilde=alt).
const historyStep = () => {
  let line = ''
  try { line = historyLine(historyCounts()) } catch {}
  return line ? `(4) Si, i én setning: «${line}» Forklar kort at alt leses lokalt (ingen eksport, ingen innlogging) og blir søkbare atomer med peker tilbake. Sier brukeren ja: kall tua_import(kilde=alt, dryRun=true) og vis tallene, så tua_import(kilde=alt). Ikke kjør noe uten ja. ` : ''
}

// ── M14: oppsett og «ta med historikken» ────────────────────────────────────
server.registerTool(
  'tua_setup',
  {
    title: 'Velg hvor Tua-arkivet skal ligge',
    annotations: WRITE_IDEMPOTENT,
    description:
      'Første kjøring: velg mappa arkivet skal ligge i — iCloud Drive, Dropbox, OneDrive, Google Drive eller lokalt — eller en egen sti. ' +
      'Kall dette BARE etter at brukeren selv har valgt (svar på en «oppsett:»-linje); gjett aldri. Uten argumenter: viser stedene som finnes på maskinen og hva som er valgt. ' +
      'Valget lagres i ~/.tua/config.json og kan endres senere (innstillinger, M15). Mappa «Tua» lages med et velkomstatom og Innboks.',
    inputSchema: {
      sted: z.enum(['icloud', 'dropbox', 'onedrive', 'googledrive', 'lokalt']).optional().describe('Skytjeneste eller lokalt (~/Tua).'),
      sti: z.string().optional().describe('Alternativt: absolutt sti til en mappe som skal være arkivet.'),
    },
  },
  async ({ sted, sti }) => {
    if (!sted && !sti) {
      return text(
        `Arkiv: ${filesMode() ? `${FILES_ROOT} (${rootLabel()})` : 'ikke valgt ennå'}\nSteder på denne maskinen: ${optionLines()}\n` +
        (filesMode() ? 'Vil brukeren flytte arkivet: det er en Finder-jobb (flytt mappa) + tua_setup(sti=ny sti); Tua kopierer ikke filer selv.' : 'Spør brukeren hvor arkivet skal ligge, og kall tua_setup(sted=…).'),
      )
    }
    const before = filesMode() ? FILES_ROOT : null
    let r
    try { r = chooseArchive(sti || sted) } catch (e) { return text(`Kunne ikke velge «${sti || sted}»: ${e.message}\nSteder: ${optionLines()}`) }
    startWatchers()
    const atoms = load()
    console.error(`[tua] arkivet ${r.created ? 'opprettet' : 'valgt'}: ${r.root} (${r.label})`)
    return text(
      `${r.created ? 'Arkivet er opprettet' : before && before !== r.root ? `Arkivet er byttet fra ${before} til` : 'Arkivet er valgt'}: ${r.root} (${r.label}). ` +
        `${atoms.length} atom${atoms.length === 1 ? '' : 'er'}${r.created ? ' — velkomstatomet «Velkommen til Tua» ligger i mappa «Tua»' : ''}. Innboks: ${INBOX_DIR}. Valget er lagret og kan endres senere.` +
        onboardLine(atoms),
    )
  },
)

server.registerTool(
  'tua_import',
  {
    title: 'Ta med historikken',
    annotations: WRITE,
    description:
      'Importer tidligere samtaler og dokumenter som søkbare atomer — alt leses lokalt, uten eksport og uten innlogging. ' +
      'kilde=alt (anbefalt ved «ta med historikken»): alle kildene under + Innboks. kilde=code: Claude Code-øktene (~/.claude/projects; én atom per økt + substansielle svar og dokumenter). ' +
      'kilde=cowork: Claude Desktops Cowork-økter (audit.jsonl; prosjekt = mappa valgt i Cowork). kilde=desktop: Desktop-samtalene fra Claude Desktops egen cache — alt som har vært åpnet i Desktop, med prosjekt, verktøykall og filer Claude skrev; leses også av seg selv hvert 10. minutt. ' +
      'kilde=finder: dokumenter med AI-opphav i Nedlastinger/Dokumenter/Skrivebord, ved referanse (aldri kopi). kilde=lenke: en delt Claude-lenke (claude.ai/share/…) brukeren limer inn — gi den i `lenke`. kilde=innboks: eksport-zip og lenkefiler som ligger i Innboks nå. ' +
      'Bruk når brukeren sier «ta med historikken», «importer samtalene mine», «hent inn gamle økter», «lagre denne delte lenken». Kjør med dryRun=true først og vis tallene. ' +
      'Idempotent — kan kjøres igjen; bare endrede økter får ny versjon. Samtaler som bare finnes på claude.ai web/mobil: be brukeren åpne dem i Desktop eller lage en delt lenke; Tua kaller aldri det interne API-et.',
    inputSchema: {
      kilde: z.enum(['alt', 'code', 'cowork', 'desktop', 'finder', 'lenke', 'innboks']).optional().describe('alt, code (standard), cowork, desktop, finder, lenke eller innboks.'),
      lenke: z.string().optional().describe('For kilde=lenke: én eller flere delte lenker (https://claude.ai/share/<id>), eller teksten de står i.'),
      project: z.string().optional().describe('Bare økter fra dette prosjektet (repo-/prosjektnavn).'),
      etter: z.string().optional().describe('Bare økter endret etter dato, ÅÅÅÅ-MM-DD.'),
      minTegn: z.number().int().min(0).optional().describe(`Minste lengde på økta i tegn (standard ${DEFAULT_MIN}).`),
      dryRun: z.boolean().optional().describe('Vis hva som ville blitt importert, uten å skrive.'),
    },
  },
  async ({ kilde = 'code', lenke, project, etter, minTegn, dryRun }, extra) => {
    const log = (m) => console.error(`[tua] ${m}`)
    const opts = { project, after: etter, minChars: minTegn ?? DEFAULT_MIN, dryRun: !!dryRun, log, skipSession: extra?.sessionId || '' }
    const tail = (key) => (dryRun ? '\n\nKjør igjen uten dryRun for å skrive.' : key ? `\n\nAdresse til rapporten: ${addr(load().find((a) => a.key === key)?.id || '')}` : '')
    if (kilde === 'innboks') {
      const done = [...processInbox(opts), ...(await processInboxShares(opts))]
      if (!done.length) return text(`Ingenting å importere i ${INBOX_DIR}${inboxPending().length ? '' : ' — legg en eksport-zip (claude.ai › Settings › Privacy › Export data, eller ChatGPT › Settings › Data controls › Export) eller en delt lenke (.url/.webloc/.txt) der, så blir den atomer av seg selv.'}`)
      return text(done.map((d) => d.report).join('\n\n---\n\n'))
    }
    if (kilde === 'lenke') {
      if (!lenke) return text('Gi den delte lenken i `lenke` (https://claude.ai/share/<id>).')
      return text((await importShare(lenke, { ...opts, via: `chat (${CLIENT})` })).report + tail('import:lenker'))
    }
    if (kilde === 'desktop') return text(importDesktop(opts).report + tail('import:desktop'))
    if (kilde === 'finder') return text(importFinder(opts).report + tail('import:finder'))
    if (kilde === 'alt') {
      const r = await importAll(opts)
      const c = historyCounts({ fresh: true })
      return text(r.report + (dryRun ? '\n\nDette er omfanget. Kjør igjen uten dryRun for å skrive — alt er lokalt, idempotent og kan slettes igjen i Finder.' : `\n\nAlt er tatt med. Rapportene ligger som atomer i prosjekt «Tua». Igjen utenfor Tua: ${[c.code && `${c.code} Code-økter`, c.cowork && `${c.cowork} Cowork-økter`, c.desktopNew && `${c.desktopNew} Desktop-samtaler`].filter(Boolean).join(', ') || 'ingenting'}.`))
    }
    const r = importCode({ ...opts, source: kilde })
    return text(r.report + tail(`import:${kilde}-økter`))
  },
)

// «(sammendrag fra v3, innhold er v5)» når nivået er utdatert
const staleNote = (a, L) => (isStale(a, L) ? ` (${L === 'S' ? 'ingress' : 'sammendrag'} fra v${a.levels[L].of}, innhold er v${a.version || 1})` : '')
// Én linje per nivå: finnes det, hvem skrev det, er det utdatert
const levelStatus = (a) => {
  const one = (L) => {
    const lv = a.levels?.[L]
    if (!lv?.text) return `${L}: –`
    return `${L}: ${lv.text.length} tegn (${lv.by || '?'})${isStale(a, L) ? ' ⚠ utdatert' : ''}`
  }
  return `${one('S')} · ${one('M')} · L: ${(a.content || '').length} tegn`
}
const shareLine = (a) => (a.refs?.length ? a.refs.map((r) => `${r}${a.share?.[r] ? ` (${a.share[r]})` : ''}`).join(', ') : '')
// M9/V13: «Åpne i …» — Desktop-prosjektet som claude://-lenke, fila og repoet som stier. Lenkene bor på atomet
// (`links`) eller avledes fra prosjektregisteret; kartet og Claude viser de samme.
// M10: leveranse-linjer — hva den er bygget av (med utdatert-merke), gjengivelser (med endret/mangler), utleveringer
const outputLines = (atoms, a) => {
  const out = []
  if (a.editedOutside) out.push(`⚠ Fila er redigert utenfor Tua siden sist — dette er nå v${a.version} (V15: ny versjon, aldri merge)`)
  if (isVault(a)) out.push('Vault-merket (tag «vault»): utleveres aldri utover S til noen modell (V15)')
  const src = sources(atoms, a)
  if (src.length) out.push(`Bygget av (${a.kind === 'leveranse' ? 'leveranse' : 'kilder'}): ${src.map((s) => `[${s.id}] ${s.name} (v${s.version}, ${s.level})${s.missing ? ' ⚠ slettet' : s.stale ? ` ⚠ nå v${s.now}` : ''}`).join(' · ')}`)
  const st = staleSources(atoms, a)
  if (st.length) out.push(`⚠ Leveransen bygger på utdaterte kilder: ${st.map((s) => s.name).join(', ')} — kjør tua_compose på nytt med samme key for en ny versjon`)
  const rs = renderStatus(a)
  if (rs.length) out.push(`Gjengivelser: ${rs.map((r) => `${r.format} ${r.url || r.path}${!r.exists ? ' ⚠ mangler' : r.changed ? ' ⚠ endret utenfor Tua' : ''}`).join(' · ')}`)
  const dl = deliveries(a.id, 3)
  if (dl.length) out.push(`Utlevert: ${dl.map((d) => `${fmtTime(d.at)} ${d.level} → ${d.client}${d.tool === 'tua_compose' ? ' (compose)' : ''}`).join(' · ')}`)
  return out.length ? '\n' + out.join('\n') : ''
}
const openLines = (a) => {
  const ls = linksFor(a)
  const first = (k) => ls.find((l) => l.kind === k)
  const out = []
  const cp = first('claude-project'); if (cp) out.push(`Åpne i Claude: ${cp.href}`)
  const files = ls.filter((l) => l.kind === 'file'); if (files.length) out.push(`Fil: ${files.map((l) => l.href).join(' · ')}`)
  const repo = first('repo'); if (repo) out.push(`Repo (Code): ${repo.href}`)
  const urls = ls.filter((l) => l.kind === 'url' || l.kind === 'claude-chat'); if (urls.length) out.push(`Lenker: ${urls.map((l) => (l.label ? `${l.label} → ${l.href}` : l.href)).join(' · ')}`)
  return out.length ? '\n' + out.join('\n') : ''
}

server.registerTool(
  'tua_save',
  {
    title: 'Lagre til Tua',
    annotations: WRITE,
    description:
      'Lagre et stykke AI-output (eller annet innhold) som et atom i Tua-arkivet. ' +
      'Proveniens (kilde, prosjekt, samtale, tid) festes automatisk. Det finnes ingen mappe å velge — ' +
      'det er hele poenget. Send HELE innholdet i content, og ALLTID en ingress i short (S). ' +
      'Er innholdet over ~3 000 tegn, send også medium (M).',
    inputSchema: {
      content: z.string().min(1).describe('Hele innholdet som skal lagres (markdown/tekst). Dette er L.'),
      short: z.string().optional().describe('S — ingressen, 1–3 setninger, maks 300 tegn. Svarer på «hva er dette?»: konklusjonen, tallene som bærer den (beløp, datoer, prosent), status (gjeldende/historisk). Send ALLTID.'),
      medium: z.string().optional().describe('M — sammendrag, 150–400 ord (maks 2 500 tegn), når innholdet er over ~3 000 tegn: beslutninger, tall, korreksjoner, åpne punkter, struktur. Ikke transkript. Nivå er mengde, ikke redaksjon — ikke utelat navn/tall som står i L.'),
      name: z.string().optional().describe('Tittel. Utelat for å ta første linje automatisk.'),
      project: z.string().optional().describe('Prosjektet dette hører til (f.eks. «Tua Business»). Bruk brukerens prosjektnavn, ellers repo/mappe-navn.'),
      convo: z.string().optional().describe('Kort tittel på samtalen/oppgaven dette kom fra — pekeren tilbake til konteksten.'),
      summary: z.string().optional().describe('Én linje: HVORFOR ser det slik ut / hva ble bestemt. Lever ved siden av S, ikke i stedet for.'),
      tags: z.array(z.string()).optional().describe('1–4 korte tagger.'),
      source: z.string().optional().describe('Kilde-AI. Standard: Claude.'),
      key: z.string().optional().describe('Stabil nøkkel for ting som oppdateres over tid (f.eks. «manifest», «commit-logg», «status»). Finnes et atom med samme key i samme prosjekt, ERSTATTES innholdet — id og synlighet beholdes, versjonen telles opp. Utelat for engangs-innhold.'),
      links: z.array(z.object({ kind: z.enum(LINK_KINDS).optional(), href: z.string().min(1), label: z.string().optional() })).optional()
        .describe('Atomets egne pekere: fila det ble skrevet til (kind=file, absolutt sti), en nettadresse (url), repoet (repo), eller Desktop-prosjekt/-samtale (claude-project/claude-chat som claude://-lenke). Repo og Desktop-prosjekt for prosjektet legges til automatisk fra prosjektregisteret — send bare det som er spesifikt for dette atomet.'),
      kind: z.enum(KINDS).optional().describe('capture (standard) eller leveranse (bygget av andre atomer — settes automatisk når derivedFrom sendes).'),
      derivedFrom: z.array(z.object({ id: z.string(), version: z.number().optional(), level: LevelArg.optional() })).optional()
        .describe('Kildeatomene en leveranse er bygget av: id, versjonen du leste, nivået du leste på. tua_compose fyller dette selv; send det når du bygde leveransen av tua_get-resultater for hånd.'),
      renders: z.array(z.object({ format: z.string().optional(), path: z.string().optional(), url: z.string().optional(), sha256: z.string().optional() })).optional()
        .describe('Gjengivelser av dette atomet: html/pdf som absolutt sti (sha256 regnes ut), eller artifact som url. Fila er en gjengivelse — atomet (markdown) er sannheten. Send med samme key når du har rendret.'),
    },
  },
  async (args) => {
    const atoms = load()
    const { atom, status } = upsert(atoms, { ...args, by: args.source || 'Claude' })
    if (status !== 'uendret') save(atoms)
    // M14: første ekte lagring avslutter onboardingen — og ber modellen lukke sløyfa («finn den igjen fra et annet prosjekt»)
    const firstSave = status !== 'uendret' && atom.key !== WELCOME_KEY && finishOnboarding('tua_save')
    console.error(`[tua] ${status} «${atom.name}» ← ${atom.source} · ${atom.project}${firstSave ? ' · første lagring — onboarding ferdig' : ''}`)
    const head =
      status === 'ny' ? `Lagret som atom ${atom.id} — ingen mappe.` :
      status === 'oppdatert' ? `Oppdatert atom ${atom.id} (versjon ${atom.version}) — erstattet forrige versjon, synlighet beholdt.` :
      status === 'nivåer' ? `Oppdaterte S/M på atom ${atom.id} — innholdet er uendret (fortsatt v${atom.version || 1}).` :
      `Uendret — atom ${atom.id} hadde allerede dette innholdet.`
    const tips = []
    if (!args.short && atom.content.length > SHORT_L) tips.push('S mangler — send short neste gang (ingress ≤ 300 tegn).')
    if (args.short && args.short.length > S_MAX) tips.push(`S er ${args.short.length} tegn — bør være ≤ ${S_MAX}.`)
    if (args.medium && args.medium.length > M_MAX) tips.push(`M er ${args.medium.length} tegn — bør være ≤ ${M_MAX}.`)
    if (!args.medium && atom.content.length > LONG_L) tips.push(`Innholdet er ${atom.content.length} tegn — send medium (M, 150–400 ord) neste gang.`)
    return text(
      `${head}\n` +
        `Tittel: ${atom.name}\nProsjekt: ${atom.project}\nSamtale: ${atom.convo || '—'}\n` +
        `Kilde: ${atom.source} · ${fmtTime(atom.capturedAt)} · ${atom.size} bytes` +
        (atom.tags.length ? `\nTagger: ${atom.tags.join(', ')}` : '') +
        `\nNivåer: ${levelStatus(atom)}` +
        (tips.length ? `\nTips: ${tips.join(' ')}` : '') +
        `\nAdresse: ${addr(atom.id)}` +
        openLines(atom) +
        outputLines(atoms, atom) +
        `\nArkivet har nå ${atoms.length} atomer (${ARKIV()}).` +
        (firstSave
          ? `\n\nonboarding: Dette var brukerens første lagring i Tua. Si at atomet nå kan finnes igjen fra et hvilket som helst annet prosjekt eller verktøy med «hva har jeg om …», og at fila ligger i ${fileOf(atom) || FILES_ROOT}. Onboardingen er ferdig — ingen flere slike linjer.`
          : onboardLine(atoms)),
    )
  },
)

server.registerTool(
  'tua_search',
  {
    title: 'Søk i Tua',
    annotations: READ,
    description:
      'Søk i Tua-arkivet på tvers av ALLE prosjekter og samtaler. Bruk dette først når brukeren spør ' +
      '«hva har jeg om X», «finn det jeg lagde om X», eller når tidligere arbeid kan være relevant. ' +
      'Hvert treff svarer med S (ingressen) og hvorfor-linjen — ofte nok til å svare. Hent M med tua_get(level=M) ' +
      'før du henter L.',
    inputSchema: {
      query: z.string().min(1).describe('Søkeord (alle ord må treffe).'),
      project: z.string().optional().describe('Begrens til atomer som OPPSTO i dette prosjektet.'),
      context: z.string().optional().describe('Søk som dette prosjektet ser det: egne atomer + det som er referert inn via tua_link, aldri mer enn nivået prosjektet har fått. Utelat for å søke i ALT (standard — brukeren eier hele arkivet).'),
      limit: z.number().int().min(1).max(25).optional().describe('Maks treff (standard 8).'),
    },
  },
  async ({ query, project, context, limit }) => {
    const atoms = load()
    const hits = search(atoms, query, { project, context, limit })
    if (!hits.length) {
      return text(`Ingen treff på «${query}»${project ? ` i ${project}` : ''}${context ? ` (synlig for ${context})` : ''}. Arkivet har ${atoms.length} atomer.` + onboardLine(atoms))
    }
    const projects = new Set(hits.map((h) => h.atom.project)).size
    const refMark = (a, max) => (context && a.project.toLowerCase() !== context.toLowerCase() ? ` (referert inn${max !== 'L' ? `, nivå ${max}` : ''})` : '')
    const sLabel = (S) => (S.level === 'S' ? 'S' : S.level === 'L' ? 'S (kort atom — alt)' : S.level === 'hvorfor' ? 'S mangler · hvorfor' : 'S mangler · utdrag')
    const lines = hits.map(({ atom: a, S, max, snippet: s }, i) =>
      `${i + 1}. [${a.id}] ${a.name}\n   ${a.project}${refMark(a, max)} · ${a.convo || '—'} · ${a.source} · ${fmtTime(a.capturedAt)} · v${a.version || 1}` +
      `\n   ${sLabel(S)}: ${S.text}${staleNote(a, 'S')}` +
      (a.summary && a.summary !== S.text ? `\n   Hvorfor: ${a.summary}` : '') +
      (s ? `\n   Treff: ${s}` : '') +
      `\n   ↗ ${addr(a.id)}`,
    )
    return text(`${hits.length} treff på «${query}» i ${projects} prosjekt${projects === 1 ? '' : 'er'}:\n\n${lines.join('\n\n')}` + onboardLine(atoms))
  },
)

server.registerTool(
  'tua_get',
  {
    title: 'Hent atom fra Tua',
    annotations: READ,
    description:
      'Hent ett atom (id fra tua_search/tua_list) på nivå S, M eller L, pluss proveniens, relaterte atomer ' +
      '(samme samtale, synlig i, felles tagger), adressen i kartet, «Åpne i …»-lenker (Desktop-prosjekt som claude://, fil, repo) og tidligere versjoner. ' +
      'Hent M først; L (alt) bare når svaret krever det. Med `version` hentes en tidligere versjon.',
    inputSchema: {
      id: z.string().describe('Atom-id, f.eks. a_m2k…'),
      level: LevelArg.optional().describe('S = ingress, M = sammendrag, L = alt (standard). Finnes ikke M, får du starten av L.'),
      context: z.string().optional().describe('Hent som dette prosjektet ser det — aldri mer enn nivået prosjektet har fått.'),
      version: z.string().optional().describe('Tidligere versjon å hente, f.eks. «v1» (navn fra versjonslista). Utelat for gjeldende.'),
    },
  },
  async ({ id, level = 'L', context, version }) => {
    const atoms = load()
    const cur = atoms.find((x) => x.id === id)
    if (!cur) return text(`Fant ikke atom ${id}.`)
    if (context && !visibleIn(cur, context)) return text(`Atom ${id} er ikke synlig for ${context}.`)
    const a = version ? readVersion(id, version) : cur
    if (!a) return text(`Fant ikke versjon «${version}» av ${id}. Finnes: ${versions(id).map((v) => v.name).join(', ') || 'ingen'}.`)
    const max = vaultClamp(cur, maxLevel(cur, context))               // V15: Vault → aldri over S
    const eff = clampLevel(level, max)
    const got = levelOf(a, eff)
    logDelivery({ tool: 'tua_get', id, version: a.version || 1, level: eff, client: CLIENT, ...(context ? { context } : {}) })
    const edited = hasExternalEdits(atoms)
    if (edited) save(atoms)                                            // V15 regel 1: fest den nye versjonen, bevar den redigerte teksten
    const S = levelOf(a, 'S')
    const rel = related(atoms, cur)
    const relLine = (label, list) => (list.length ? `\n${label}: ${list.map((x) => `[${x.id}] ${x.name}`).join(' · ')}` : '')
    const vers = versions(id)
    const nivå =
      eff === 'L' ? `L (alt, ${got.text.length} tegn)` :
      got.level === eff ? `${eff} (av ${got.by || '?'}, fra v${got.of ?? '?'})${staleNote(a, eff)}` :
      got.level === 'L' ? `${eff} — innholdet er kort nok til at L er M` :
      `${eff} mangler — viser starten av L (${got.text.length} av ${(a.content || '').length} tegn)`
    return text(
      `# ${a.name}${version ? ` (tidligere versjon ${version})` : ''}\n` +
        `Prosjekt: ${a.project} · Samtale: ${a.convo || '—'} · Kilde: ${a.source} · ${fmtTime(a.capturedAt)} · v${a.version || 1}` +
        `\nNivå: ${nivå}` +
        (eff !== level ? ` — ${context} ser dette bare på nivå ${max}` : '') +
        (eff !== 'S' && S.level === 'S' ? `\nS: ${S.text}${staleNote(a, 'S')}` : '') +
        (a.summary && a.summary !== S.text ? `\nHvorfor: ${a.summary}` : '') +
        (a.tags?.length ? `\nTagger: ${a.tags.join(', ')}` : '') +
        (cur.refs?.length ? `\nSynlig også i: ${shareLine(cur)}` : '') +
        `\nAdresse: ${addr(id)}` +
        openLines(cur) +
        outputLines(atoms, { ...cur, editedOutside: edited && cur.editedOutside }) +
        (vers.length ? `\nTidligere versjoner: ${vers.map((v) => v.name).join(', ')} (hent med version=«navn»)` : '') +
        relLine('Relaterte · samme samtale', rel.sameConvo) +
        relLine('Relaterte · synlig i samme prosjekt', rel.viaRefs) +
        relLine('Relaterte · felles tagger', rel.sameTags) +
        (eff !== 'L' && max !== eff ? `\nHele innholdet: tua_get(id, level=L)` : '') +
        `\n\n---\n\n${got.text}` + onboardLine(atoms),
    )
  },
)

server.registerTool(
  'tua_list',
  {
    title: 'Oversikt over Tua-arkivet',
    annotations: READ,
    description:
      'Oversikt: alle prosjekter og alle tagger (med antall), pluss de nyeste atomene. ' +
      'Bruk når brukeren vil se hva som finnes («hva har jeg i Tua», «list alt», «hvilke tagger finnes», ' +
      '«vis alle filer/atomer»). Kan filtreres per prosjekt og/eller tag. `needs` lister atomer som mangler ' +
      'eller har utdatert S/M — grunnlaget for en «Ny gjennomgang».',
    inputSchema: {
      project: z.string().optional().describe('Vis bare atomer fra dette prosjektet.'),
      tag: z.string().optional().describe('Vis bare atomer med denne taggen.'),
      needs: z.enum(['S', 'M']).optional().describe('Vis bare atomer som mangler eller har utdatert S (ingress) eller M (sammendrag; bare for innhold over ~3 000 tegn).'),
      limit: z.number().int().min(1).max(50).optional().describe('Maks atomer i lista (standard 20).'),
    },
  },
  async ({ project, tag, needs, limit = 20 }) => {
    const atoms = load()
    const byProject = {}
    const byTag = {}
    for (const a of atoms) {
      byProject[a.project] = (byProject[a.project] || 0) + 1
      for (const t of a.tags || []) byTag[t] = (byTag[t] || 0) + 1
    }
    const sortedCounts = (m) => Object.entries(m).sort((x, y) => y[1] - x[1])
    const projLine = sortedCounts(byProject).map(([p, n]) => `${p} (${n})`).join(', ') || 'ingen'
    const tagLine = sortedCounts(byTag).map(([t, n]) => `${t} (${n})`).join(', ') || 'ingen'
    const needS = atoms.filter((a) => needsLevel(a, 'S')).length
    const needM = atoms.filter((a) => needsLevel(a, 'M')).length

    // project-filter = «slik dette prosjektet ser det»: egne atomer + referert inn
    const wanted = atoms
      .filter((a) => visibleIn(a, project))
      .filter((a) => !tag || (a.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase()))
      .filter((a) => !needs || needsLevel(a, needs))
      .sort((x, y) => y.capturedAt - x.capturedAt)
    const lvMark = (a) => {
      const m = []
      if (needsLevel(a, 'S')) m.push(a.levels?.S ? 'S utdatert' : 'S mangler')
      if (needsLevel(a, 'M')) m.push(a.levels?.M ? 'M utdatert' : 'M mangler')
      return m.length ? ` · ⚠ ${m.join(', ')}` : ''
    }
    const rows = wanted
      .slice(0, limit)
      .map((a) =>
        `- [${a.id}] ${a.name} — ${a.project}` +
        (project && a.project.toLowerCase() !== project.toLowerCase() ? ` (referert inn${a.share?.[project] ? `, nivå ${a.share[project]}` : ''})` : '') +
        ` · ${a.convo || '—'} · ${fmtTime(a.capturedAt)} · v${a.version || 1} · ${(a.content || '').length} tegn` +
        (a.tags?.length ? ` · #${a.tags.join(' #')}` : '') +
        (a.refs?.length ? ` · synlig også i: ${shareLine(a)}` : '') +
        lvMark(a),
      )
    const filt = [project && `prosjekt=${project}`, tag && `tag=${tag}`, needs && `mangler ${needs}`].filter(Boolean).join(', ')
    const head =
      `${atoms.length} atomer i arkivet\n` +
      `Prosjekter: ${projLine}\n` +
      `Tagger: ${tagLine}\n` +
      `Nivåer: ${needS ? `${needS} mangler/utdatert S` : 'alle har S'} · ${needM ? `${needM} mangler/utdatert M` : 'alle lange har M'}\n\n` +
      (filt ? `Viser ${wanted.length} atomer (${filt})` : `Nyeste ${Math.min(limit, wanted.length)} av ${wanted.length}`) +
      (wanted.length > limit ? ` — øk limit for flere` : '') + ':\n'
    return text(head + (rows.join('\n') || '(tomt)') + onboardLine(atoms))
  },
)

// ── M10: leveranse — «lag et styrenotat av disse atomene» ──────────────────
server.registerTool(
  'tua_compose',
  {
    title: 'Bygg en leveranse av atomer',
    annotations: WRITE,
    description:
      'Sett sammen flere atomer til én leveranse (markdown) og lagre den som et nytt atom med proveniens tilbake ' +
      'til kildene (hvilken versjon, hvilket nivå). Bruk når brukeren sier «lag et notat/dokument/sammendrag av disse», ' +
      '«sett sammen X, Y og Z». Standard nivå er M (sammendragene) — L bare når brukeren ber om hele innholdet. ' +
      'Vault-merkede atomer tas med bare som S. Du får markdown-kilden tilbake: skriv den om i husstilen om nødvendig ' +
      'og lagre resultatet med tua_save(key=samme key), og fest html/pdf som renders etterpå.',
    inputSchema: {
      ids: z.array(z.string()).min(1).describe('Atom-id-ene som skal inn, i den rekkefølgen de skal stå.'),
      name: z.string().min(1).describe('Tittel på leveransen, f.eks. «Styrenotat Riulf — oktober 2026».'),
      level: LevelArg.optional().describe('Nivået kildene leses på: S, M (standard) eller L.'),
      intro: z.string().optional().describe('Valgfri ingress/innledning øverst i leveransen.'),
      project: z.string().optional().describe('Prosjektet leveransen hører til. Standard: det første kildeatomets prosjekt.'),
      key: z.string().optional().describe('Stabil nøkkel (f.eks. «lev:riulf-styrenotat») så en ny kjøring erstatter forrige versjon.'),
      convo: z.string().optional().describe('Samtalen/oppgaven dette lages i.'),
      tags: z.array(z.string()).optional(),
      context: z.string().optional().describe('Bygg som dette prosjektet ser kildene (aldri mer enn nivået det har fått).'),
    },
  },
  async ({ ids, name, level = 'M', intro, project, key, convo, tags, context }) => {
    const atoms = load()
    const { content, derivedFrom, notes } = compose(atoms, { ids, level, name, intro, context })
    if (!derivedFrom.length) return text(`Ingen av atomene kunne brukes: ${notes.join('; ')}`)
    for (const d of derivedFrom) logDelivery({ tool: 'tua_compose', id: d.id, version: d.version, level: d.level, client: CLIENT, ...(context ? { context } : {}) })
    const proj = project || atoms.find((x) => x.id === derivedFrom[0].id)?.project
    const names = derivedFrom.map((d) => atoms.find((x) => x.id === d.id)?.name).filter(Boolean)
    const { atom, status } = upsert(atoms, {
      key, kind: 'leveranse', name, content, project: proj, convo, tags: tags || ['leveranse'], by: 'regel', source: 'Claude',
      derivedFrom,
      short: `Leveranse bygget av ${derivedFrom.length} atom${derivedFrom.length === 1 ? '' : 'er'} på nivå ${level}: ${names.join(', ')}.`.slice(0, 300),
      summary: `Satt sammen med tua_compose (${fmtTime(Date.now())}).`,
    })
    save(atoms)
    console.error(`[tua] compose «${name}» ← ${derivedFrom.length} atomer (${level}) · ${status}`)
    return text(
      `Leveranse «${name}» ${status === 'ny' ? 'lagret' : status} som atom ${atom.id}${atom.version > 1 ? ` (v${atom.version})` : ''} i ${atom.project} — bygget av ${derivedFrom.length} atomer på nivå ${level}.` +
        (notes.length ? `\nMerk: ${notes.join('; ')}` : '') +
        `\nAdresse: ${addr(atom.id)}` +
        outputLines(atoms, atom) +
        `\nNeste: skriv om i husstilen om nødvendig og lagre med tua_save(key=«${atom.key || '…'}», content=…); rendre html/pdf og fest dem med renders=[{path}].` +
        `\n\n---\n\n${content}`,
    )
  },
)

// ── Synlighet på tvers av prosjekter: referanser, aldri kopier ─────────────
const sameName = (x, y) => x.toLowerCase() === y.toLowerCase()

server.registerTool(
  'tua_link',
  {
    title: 'Gjør synlig i et annet prosjekt',
    annotations: WRITE_IDEMPOTENT,
    description:
      'Gjør et atom synlig i et annet prosjekt — som REFERANSE, aldri kopi. Atomet finnes fortsatt én gang, ' +
      'i prosjektet det oppsto i. Bruk når brukeren sier «gjør dette synlig i X», «del dette med prosjekt X», ' +
      '«prosjekt X trenger dette». Valgfritt nivå: S (bare ingress), M (sammendrag) eller L (alt, standard for ' +
      'eierens egne prosjekter). Kall igjen med nytt nivå for å løfte/senke en eksisterende referanse.',
    inputSchema: {
      id: z.string().describe('Atom-id (fra tua_search/tua_list).'),
      project: z.string().min(1).describe('Prosjektet som skal se atomet.'),
      level: LevelArg.optional().describe('Hvor mye prosjektet får se: S, M eller L (standard L — V11).'),
    },
  },
  async ({ id, project, level }) => {
    const atoms = load()
    const a = atoms.find((x) => x.id === id)
    if (!a) return text(`Fant ikke atom ${id}.`)
    const p = project.trim()
    if (sameName(a.project, p)) return text(`«${a.name}» oppsto i ${a.project} — det er allerede synlig der, på alle nivåer.`)
    a.refs = a.refs || []
    const had = a.refs.some((r) => sameName(r, p))
    const before = maxLevel(a, p)
    if (had && (!level || level === before)) return text(`«${a.name}» er allerede synlig i ${p} (nivå ${before}).`)
    if (!had) a.refs.push(p)
    if (level) setShare(a, p, level)
    const now = maxLevel(a, p)
    save(atoms)
    console.error(`[tua] link «${a.name}» → ${p} (${now})`)
    const what = had ? `Nivået for ${p} er endret: ${before} → ${now}.` : `«${a.name}» er nå synlig i ${p} — som referanse, på nivå ${now}${now === 'S' ? ' (bare ingressen)' : now === 'M' ? ' (sammendraget)' : ' (alt)'}.`
    return text(`${what}\n1 atom · synlig i: ${a.project}, ${shareLine(a)} · 0 kopier.`)
  },
)

server.registerTool(
  'tua_unlink',
  {
    title: 'Fjern synlighet fra et prosjekt',
    annotations: WRITE_IDEMPOTENT,
    description: 'Fjern referansen så et atom ikke lenger er synlig i et prosjekt. Selve atomet slettes ikke — det ligger fortsatt der det oppsto.',
    inputSchema: {
      id: z.string().describe('Atom-id.'),
      project: z.string().min(1).describe('Prosjektet som ikke lenger skal se atomet.'),
    },
  },
  async ({ id, project }) => {
    const atoms = load()
    const a = atoms.find((x) => x.id === id)
    if (!a) return text(`Fant ikke atom ${id}.`)
    const p = project.trim()
    if (sameName(a.project, p)) return text(`«${a.name}» oppsto i ${a.project} — den synligheten kan ikke fjernes (slett atomet i stedet, om det er meningen).`)
    const before = (a.refs || []).length
    a.refs = (a.refs || []).filter((r) => !sameName(r, p))
    if (a.refs.length === before) return text(`«${a.name}» var ikke synlig i ${p}.`)
    setShare(a, p, 'L')
    save(atoms)
    console.error(`[tua] unlink «${a.name}» ⤫ ${p}`)
    return text(`«${a.name}» er ikke lenger synlig i ${p}. Atomet ligger fortsatt i ${a.project}${a.refs.length ? ` og er synlig i: ${shareLine(a)}` : ''}.`)
  },
)

registerApps(server, { client: CLIENT })            // ui://tua/kort + tua_card + tua_open

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[tua] MCP-server klar · arkiv: ${filesMode() ? `${FILES_ROOT} (mappa er sannheten)` : firstRun.needsChoice ? 'IKKE VALGT — spør ved første kall' : `${FILE} (cache — mappa finnes ikke)`}${onboardingActive() ? ' · onboarding aktiv' : ''}`)
startWatchers()      // M14: Innboks · M17: Desktop-cachen (ved start + hvert 10. min) og Finder-mappene (ingenting hvis arkivet ikke er valgt)
