// apps.js — Tua som MCP App (kort inne i Claude Desktop/web, Cursor, VS Code).
//
// Ett kort, to former (V12): treffliste med ingresser (S), og ett atom med S først og M/L på
// forespørsel, «Bygget av», «Synlig for», relaterte og «Åpne i …». Nivåklippingen (referansens
// nivå, Vault) skjer her på serveren — kortet kan aldri be om mer enn tua_get ville gitt.
//
//   ui://tua/kort        HTML-ressursen (apps/kort.html + SDK-bundelen inlinet; ingen CDN, ingen CSP)
//   tua_card             modell + app: id → atom-kort · query → treffliste. Returnerer content (tekst) + structuredContent
//   tua_open             bare app: finder | code | claude — samme faste liste som broen (V13), spawn uten shell
//
// Claude Code rendrer ikke MCP Apps: der ser modellen structuredContent som JSON. Derfor er den
// kompakt og selvforklarende. Lokal stdio-server: ingen ui.domain (Claude-dokumentasjonen).
// Runde 3a (arb. 32 §5.7): kortet går gjennom motoren som tua_get (lever(): klippe etter Vault/Trust → S med linje, skjerme, logge) — kortet viser
// plassholdere der appen viser originalene, for innholdet går også til modellen. Tua → Claude: «Siden sist i Tua» ved første kall (sidenSist i
// structuredContent + teksten) og «Kopier instruksen» når prosjektet har Desktop-uuid (instruks).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { openSpawn, FILE_MANAGER } from './platform.js'   // M18: «Åpne i …» på macOS, Windows og Linux
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import {
  load, save, search, visibleIn, fmtTime, related, levelOf, maxLevel, isStale,
  linksFor, fileOf, sources, renderStatus, isVault, vaultClamp, hasExternalEdits,
} from './store.js'
import { lever, skjermerFor } from './motor.js'                                   // runde 3a: kortet gjennom motoren
import { sidenSist, skalVise, trådFørst, instruksFor } from './dora.js'          // runde 3a: Tua → Claude

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KORT_URI = 'ui://tua/kort'
const DRYRUN = !!process.env.TUA_OPEN_DRYRUN

// ── HTML: malen + SDK-bundelen inlinet (export → window.McpApps), lest ved hvert resources/read
let htmlCache = null
export function kortHtml() {
  if (htmlCache && !process.env.TUA_APPS_DEV) return htmlCache
  const tpl = fs.readFileSync(path.join(HERE, 'apps', 'kort.html'), 'utf8')
  // 0.5.5: kortets klientbibliotek ligger ved siden av malen som tekstdeler apps/kort-bibliotek.1.js, .2.js … (lagt dit av
  // bygg.mjs, ubyggd og hver under 256 KiB så katalogens skanning kan lese dem); delene settes sammen i rekkefølge. Da virker kortet
  // også når pluginen kjører uten node_modules (konto-pluginen fra katalogen). Finnes ingen deler, hentes biblioteket fra node_modules (dev).
  const parts = fs.readdirSync(path.join(HERE, 'apps')).filter((f) => /^kort-bibliotek\.\d+\.js$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  let bundle = parts.length ? parts.map((f) => fs.readFileSync(path.join(HERE, 'apps', f), 'utf8')).join('') : fs.readFileSync(fileURLToPath(import.meta.resolve('@modelcontextprotocol/ext-apps/app-with-deps')), 'utf8')
  const m = bundle.match(/export\s*\{([^}]*)\};?\s*$/)
  if (!m) throw new Error('fant ikke export-lista i kortets klientbibliotek')
  const appName = (m[1].match(/(\w+)\s+as\s+App\b/) || [])[1] || 'App'
  bundle = bundle.slice(0, m.index) + `\nwindow.McpApps = { App: ${appName} };\n`
  htmlCache = tpl.replace('/*__BUNDLE__*/', () => bundle)
  return htmlCache
}

// ── kortets datamodell (kompakt; sendes også til modellen i Code)
const date = (ts) => fmtTime(ts).replace(/,.*$/, '')
const first = (ls, k) => ls.find((l) => l.kind === k)
function atomCard(atoms, cur, level, context, { client = 'Claude' } = {}) {
  const max = vaultClamp(cur, maxLevel(cur, context))
  // runde 3a: samme vei som tua_get — klippe (fail closed → S + linje), skjerme, logge (bare når mer enn S gis, som før)
  const lv = lever(atoms, cur, { nivå: level, tool: 'tua_card', klient: client, context, logg: level !== 'S' })
  const eff = lv.nivå
  const got = { text: lv.tekst }
  const rel = related(atoms, cur)
  const ls = linksFor(cur)
  const stale = isStale(cur, eff) ? cur.levels[eff].of : null
  const relItems = [
    ...rel.sameConvo.map((x) => ({ id: x.id, name: x.name, how: 'samme samtale' })),
    ...rel.viaRefs.map((x) => ({ id: x.id, name: x.name, how: 'synlig i samme prosjekt' })),
    ...rel.sameTags.map((x) => ({ id: x.id, name: x.name, how: 'felles tagger' })),
  ].slice(0, 6)
  const instruks = instruksFor(cur.project)
  return {
    id: cur.id, name: lv.felt.navn, project: cur.project, convo: lv.felt.samtale, source: cur.source || '',
    date: date(cur.capturedAt), version: cur.version || 1, kind: cur.kind || 'capture', tags: cur.tags || [],
    level: eff, max, vault: isVault(cur), stale, clipped: lv.linje || '', shielded: lv.treff, logged: lv.logget,
    S: lv.felt.S, why: lv.felt.hvorfor,
    text: got.text, hasM: !!cur.levels?.M?.text, lengthL: (cur.content || '').length,
    instruks: instruks ? instruks.tekst : '',
    share: (cur.refs || []).map((r) => ({ project: r, level: cur.share?.[r] || 'L' })),
    builtBy: sources(atoms, cur).map((s) => ({ id: s.id, name: s.name, version: s.version, level: s.level, stale: s.stale, now: s.now, missing: s.missing })),
    renders: renderStatus(cur).map((r) => ({ format: r.format, path: r.url || r.path, ok: r.exists && !r.changed })),
    related: relItems,
    address: process.env.TUA_APP_URL ? `${process.env.TUA_APP_URL}#atom/${cur.id}` : `http://127.0.0.1:5274/#atom/${cur.id}`,
    claudeProject: first(ls, 'claude-project')?.href || '',
    file: fileOf(cur) || '',
    repo: first(ls, 'repo')?.href || '',
  }
}
const atomText = (a) =>
  `# ${a.name}\n${a.project} · ${a.date} · v${a.version}${a.kind === 'leveranse' ? ' · leveranse' : ''}\n` +
  (a.level !== 'S' && a.S ? `S: ${a.S}\n` : '') +
  `Nivå: ${a.level}${a.max !== 'L' ? ` (maks ${a.max}${a.vault ? ', Vault' : ''})` : ''}${a.stale ? ` ⚠ fra v${a.stale}` : ''}${a.clipped ? ` — ${a.clipped}` : ''}\n` +
  `Skjermet: ${a.shielded} (plassholdere som [Person A] — bruk dem uendret)${a.logged ? ' · utlevering logget' : ''}\n` +
  (a.builtBy.length ? `Bygget av: ${a.builtBy.map((s) => `[${s.id}] ${s.name} v${s.version}/${s.level}${s.stale ? ' ⚠' : ''}`).join(' · ')}\n` : '') +
  `Adresse: ${a.address}\n\n${a.text}`

// ── «Åpne i …» fra kortet: samme faste liste som broen (V13). Aldri shell. macOS: open · Windows: explorer/rundll32 · Linux: xdg-open (platform.js)
const run = (kind, target) => openSpawn(kind, target, { dryrun: DRYRUN })
const realpath = (p) => { try { return fs.realpathSync(p) } catch { return null } }
async function openTarget(a, target) {
  const ls = linksFor(a)
  if (target === 'finder') {
    const want = realpath(fileOf(a))
    if (!want) throw new Error(`${FILE_MANAGER}: atomet har ingen fil`)
    return run('reveal', want)
  }
  if (target === 'code') {
    const repo = ls.filter((l) => l.kind === 'repo').map((l) => realpath(l.href)).find((p) => p && fs.statSync(p).isDirectory())
    if (!repo) throw new Error('Code: ingen repo-lenke på atomet')
    const q = `Hent atom ${a.id} («${a.name}») fra Tua med tua_get(level=M) og fortsett derfra.`
    return run('url', `claude-cli://open?cwd=${encodeURIComponent(repo)}&q=${encodeURIComponent(q)}`)
  }
  if (target === 'claude') {
    const cp = first(ls, 'claude-project')
    if (!cp) throw new Error('Claude: Desktop-prosjektet er ikke satt for dette prosjektet')
    return run('url', cp.href)
  }
  if (target === 'kart') {
    // Kartet serveres av broen (npm run kart). Svarer den ikke, si det i stedet for å åpne en tom side.
    const base = process.env.TUA_APP_URL || 'http://127.0.0.1:5274/'
    if (!DRYRUN) {
      try { await fetch(base, { method: 'HEAD', signal: AbortSignal.timeout(1500) }) } catch { throw new Error('Kartet kjører ikke — start det med «cd tua-plugin && npm run kart», så prøv igjen') }
    }
    return run('url', `${base}#atom/${a.id}`)
  }
  throw new Error(`ukjent target «${target}» — kortet åpner bare finder, code, claude og kart`)
}

export function registerApps(server, { client = 'Claude' } = {}) {
  registerAppResource(server, 'Tua-kort', KORT_URI, { description: 'Kortet som viser et atom eller en treffliste fra Tua inne i samtalen' }, async () => ({
    contents: [{ uri: KORT_URI, mimeType: RESOURCE_MIME_TYPE, text: kortHtml(), _meta: { ui: { prefersBorder: true } } }],
  }))

  registerAppTool(
    server,
    'tua_card',
    {
      title: 'Vis Tua-kort',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        'Vis et kort fra Tua inne i samtalen (MCP App). Med `id`: ett atom med ingressen (S) først, knapper for M og L, ' +
        '«Bygget av», «Synlig for», relaterte og «Åpne i …» (Claude, Finder, Code, kartet). Med `query`: en treffliste ' +
        'med ingresser, nyeste først, der brukeren kan lese M direkte. Bruk dette når brukeren vil *se* et atom eller treff; ' +
        'bruk tua_search/tua_get når du selv trenger teksten. I klienter uten kort-visning får du det samme som tekst.',
      inputSchema: {
        id: z.string().optional().describe('Atom-id → kort for ett atom'),
        query: z.string().optional().describe('Søkeord → treffliste (S per treff)'),
        level: z.enum(['S', 'M', 'L']).optional().describe('Nivå for atom-kortet. Standard S (V12). Klippes av referansens nivå og Vault.'),
        project: z.string().optional().describe('Avgrens trefflista til ett prosjekt'),
        context: z.string().optional().describe('Vis som dette prosjektet ser det — aldri mer enn nivået prosjektet har fått'),
        limit: z.number().int().min(1).max(10).optional().describe('Antall treff (standard 5)'),
        quiet: z.boolean().optional().describe('Internt: kortet henter M/L for visning; logges, men svarer uten preik'),
      },
      _meta: { ui: { resourceUri: KORT_URI } },
    },
    async ({ id, query, level = 'S', project, context, limit = 5, quiet }) => {
      const atoms = load()
      if (id) {
        const cur = atoms.find((x) => x.id === id)
        if (!cur) return { content: [{ type: 'text', text: `Fant ikke atom ${id}.` }], structuredContent: { mode: 'error', error: `Fant ikke atom ${id}.` } }
        if (context && !visibleIn(cur, context)) return { content: [{ type: 'text', text: `Atom ${id} er ikke synlig for ${context}.` }], structuredContent: { mode: 'error', error: `Ikke synlig for ${context}.` } }
        if (hasExternalEdits(atoms)) save(atoms)                      // V15: fest ny versjon ved ekstern redigering
        const a = atomCard(atoms, cur, level, context, { client })
        return { content: [{ type: 'text', text: quiet ? `${a.level} av ${a.id} vist i kortet.` : atomText(a) }], structuredContent: { mode: 'atom', atom: a } }
      }
      // runde 3a: tråder fra Spør øverst, treffene skjermet (S er fri, ingen Utlevert-linje), «Siden sist i Tua» ved første kall, instruksen når prosjektet har Desktop-uuid
      const hits = trådFørst(atoms, search(atoms, query || '', { project, context, limit }))
      const sk = skjermerFor(atoms)
      const items = hits.map(({ atom: a, S, max, snippet, tråd }) => ({
        id: a.id, name: sk.skjerm(a.name), project: a.project, date: date(a.capturedAt), version: a.version || 1, kind: a.kind || 'capture',
        S: S.level === 'S' ? sk.skjerm(S.text) : '', snippet: sk.skjerm(snippet || ''), max, tags: (a.tags || []).slice(0, 4),
        ...(tråd ? { thread: { svar: tråd.svar.length, konklusjon: tråd.konklusjon ? tråd.konklusjon.status : '' } } : {}),
      }))
      const prosjekt = project || context || ''
      const siden = skalVise(prosjekt) ? sidenSist(atoms, { prosjekt }) : null
      const sidenSc = siden ? { prosjekt: siden.prosjekt, dager: siden.dager, lagret: siden.lagret, linjer: siden.linjer.map((l) => ({ slag: l.slag, id: l.id, tekst: sk.skjerm(l.tekst) })) } : null
      const instruks = instruksFor(prosjekt)
      const sc = { mode: 'list', query: query || '', project: project || '', total: hits.total, items, ...(sidenSc ? { sidenSist: sidenSc } : {}), ...(instruks ? { instruks: instruks.tekst, instruksProsjekt: instruks.prosjekt } : {}) }
      const txt = (items.length
        ? `${hits.total} treff${query ? ` på «${query}»` : ''}${project ? ` i ${project}` : ''} (viser ${items.length}${hits.tråder ? `, ${hits.tråder} tråder fra Spør øverst` : ''}):\n` +
          items.map((i) => `- [${i.id}] ${i.name} — ${i.project} · ${i.date}${i.thread ? ` · tråd: ${i.thread.svar} svar${i.thread.konklusjon ? `, konklusjon ${i.thread.konklusjon}` : ''}` : ''}${i.S ? `\n  ${i.S}` : ''}`).join('\n')
        : `Ingen treff${query ? ` på «${query}»` : ''}.`) +
        (sk.treff ? `\nSkjermet: ${sk.treff} (plassholdere — bruk dem uendret).` : '') +
        (siden ? `\n\n${sk.skjerm(siden.tekst)}` : '')
      sk.lær()
      return { content: [{ type: 'text', text: txt }], structuredContent: sc }
    },
  )

  registerAppTool(
    server,
    'tua_open',
    {
      title: 'Åpne atom i Finder, Code, Claude eller kartet (fra kortet)',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: 'Brukes av Tua-kortet. Åpner atomets fil i Finder, repoet i Claude Code, Desktop-prosjektet i Claude, eller atomet i kartet (krever at broen kjører). Fast liste, ingen andre mål (V13).',
      inputSchema: {
        id: z.string().describe('Atom-id'),
        target: z.enum(['finder', 'code', 'claude', 'kart']).describe('Hva som skal åpnes'),
      },
      _meta: { ui: { resourceUri: KORT_URI, visibility: ['app'] } },
    },
    async ({ id, target }) => {
      const a = load().find((x) => x.id === id)
      if (!a) return { content: [{ type: 'text', text: `Fant ikke atom ${id}.` }], isError: true }
      try {
        const r = await openTarget(a, target)
        return { content: [{ type: 'text', text: `Åpnet ${target} for ${a.name}${r.dryrun ? ' (dryrun)' : ''}.` }], structuredContent: { ok: true, target, ran: r.ran } }
      } catch (e) {
        return { content: [{ type: 'text', text: `Kunne ikke åpne ${target}: ${e.message}` }], isError: true }
      }
    },
  )
}
