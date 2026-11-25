#!/usr/bin/env node
// test-historikk.mjs — «les først, vis etterpå» (arbeidsstykke 36 del 2, grep 1, 2 og 5 · 0.5.17).
// ALDRI mot det ekte arkivet, ALDRI Eriks ekte ~/.claude/projects, ~/.codex eller Nedlastinger: alt pekes til en egen midlertidig mappe.
//
//   node server/test-historikk.mjs                                              kildefilene
//   TUA_TEST_INNGANG=server/tua-server.mjs node server/test-historikk.mjs     den bygde utgaven (det brukerne kjører)
//
// Sjekker, over ekte MCP (stdio) slik Claude gjør:
//   grep 2  uten arkiv svarer første kall med ETT spørsmål: foreslått sted, hva som ble funnet, «Start?» — og tua_setup(sted) er svaret
//   grep 1  tua_setup leser det som ligger på maskinen uten et eget ja (egen prosess), økter rørt siste halvtime venter, annen runde er strupet,
//           en ny økt tas i neste runde (bare endrede filer), bryteren (tua_setup historikk=false) stopper lesingen
//   grep 5  saken «Dette fant jeg» finnes med S/M/L (kilder, prosjekter, siste tråder, tre spørsmål), linja som ber om kortet kommer én gang
//   reglene et arkiv i en midlertidig mappe leses aldri av seg selv uten TUA_HISTORIKK_AUTO=1 (testene til de andre svitene er trygge)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'tua-historikk-'))
const HJEM = path.join(S, 'home'), CODE_HOME = path.join(S, 'code-home'), ROOT = path.join(HJEM, 'Tua')
for (const d of [HJEM, CODE_HOME, path.join(S, 'cowork-tom'), path.join(S, 'codex-tom'), path.join(S, 'finder-tom'), path.join(S, 'data')]) fs.mkdirSync(d, { recursive: true })
fs.mkdirSync(path.join(HJEM, '.tua'), { recursive: true })
fs.writeFileSync(path.join(HJEM, '.tua', 'config.json'), JSON.stringify({ finder: { folders: [path.join(S, 'finder-tom')] } }) + '\n')
const grunnEnv = { ...process.env, TUA_DATA_DIR: path.join(S, 'data'), TUA_HOME: HJEM, TUA_CODE_HOME: CODE_HOME, TUA_COWORK_ROOT: path.join(S, 'cowork-tom'), TUA_CODEX_HOME: path.join(S, 'codex-tom'), TUA_OPEN_DRYRUN: '1', TUA_CLIENT: 'test' }
delete grunnEnv.TUA_FILES_ROOT; delete grunnEnv.TUA_HISTORIKK_AUTO

let feil = 0
const ok = (navn, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${navn}${info ? ` — ${info}` : ''}`); if (!cond) feil++ }
const tekst = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
const tilstand = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.tua', 'historikk.json'), 'utf8')) } catch { return {} } }

// ── falske Code-økter: to gamle (to prosjekter) og én som er «i bruk» (rørt nå) ──
const lang = (om) => (`# Notat om ${om}\n\n` + `Dette er et substansielt svar om ${om}, med tiltak, ansvar og frister for neste kvartal. `.repeat(40)).trim()
function økt(sid, cwd, emne, { gammel = true } = {}) {
  const t0 = Date.parse('2026-11-01T10:00:00+01:00')
  const l = (type, text, i) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] }, cwd, sessionId: sid, timestamp: new Date(t0 + i * 60000).toISOString() })
  const dir = path.join(CODE_HOME, '.claude', 'projects', cwd.replace(/\//g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const fil = path.join(dir, `${sid}.jsonl`)
  fs.writeFileSync(fil, [l('user', `Kan du skrive et grundig notat om ${emne}, med tre tiltak og hvem som har ansvaret for hvert av dem i neste kvartal?`, 0), l('assistant', lang(emne), 1)].join('\n') + '\n')
  if (gammel) { const da = new Date(Date.now() - 3 * 3600 * 1000); fs.utimesSync(fil, da, da) }
  return fil
}
økt('aaaa1111-0000-0000-0000-000000000001', '/Users/test/Lagerflytting', 'lagerflyttingen')
økt('aaaa1111-0000-0000-0000-000000000002', '/Users/test/Hyttebok', 'hytteboka')
const aktiv = økt('aaaa1111-0000-0000-0000-000000000003', '/Users/test/Lagerflytting', 'budsjettet', { gammel: false })

async function medServer(env, fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.TUA_TEST_INNGANG ? path.resolve(process.env.TUA_TEST_INNGANG) : path.join(HERE, 'server.js')], cwd: HERE, env, stderr: 'pipe' })
  const client = new Client({ name: 'tua-historikk-test', version: '0.0.1' })
  await client.connect(transport)
  try { return await fn(client) } finally { await client.close() }
}
const kall = (c, name, args = {}) => c.callTool({ name, arguments: args })

// ── 1) grep 2 + 1 + 5: ett spørsmål, lesing uten eget ja, kortet ───────────────
let kortId = ''
await medServer({ ...grunnEnv, TUA_HISTORIKK_AUTO: '1' }, async (c) => {
  const spm = tekst(await kall(c, 'tua_search', { query: 'lager' }))
  ok('uten arkiv: første kall svarer med «oppsett:» og ETT spørsmål som ender i «Start?»', /^oppsett:/.test(spm) && /Start\?»/.test(spm) && (spm.match(/\?»/g) || []).length === 1, spm.slice(0, 90))
  ok('spørsmålet foreslår stedet selv og sier hva som ble funnet', spm.includes(ROOT) && /Jeg fant 3 samtaler på denne maskinen/.test(spm), (spm.match(/Jeg fant[^.]*\./) || [''])[0])
  ok('svaret på ja er ett kall (tua_setup sted=lokalt), og nei til historikken er historikk=false', /tua_setup\(sted=lokalt\)/.test(spm) && /historikk=false/.test(spm))
  ok('ingenting er laget før brukeren har svart', !fs.existsSync(ROOT))

  const satt = tekst(await kall(c, 'tua_setup', { sted: 'lokalt' }))
  ok('tua_setup lager arkivet', /Arkivet er opprettet/.test(satt) && fs.existsSync(path.join(ROOT, '.tua')))
  const t = tilstand()
  ok('historikken er lest uten et eget ja, i samme svar (egen prosess, ferdig innen 20 s)', !!t.første && !!t.sist && !t.lås, JSON.stringify(t.tall || {}))
  ok('to økter lest, den som er i bruk venter til neste runde', t.tall?.code?.nye === 2, `code: ${JSON.stringify(t.tall?.code)}`)
  ok('linja som ber om kortet «Dette fant jeg» følger med i svaret', /onboarding: Tua har lest det som lå på denne maskinen/.test(satt) && /tua_card\(id="[^"]+", level="M"\)/.test(satt))
  kortId = (satt.match(/tua_card\(id="([^"]+)"/) || [])[1] || ''
  ok('linja kommer bare én gang', !/onboarding: Tua har lest/.test(tekst(await kall(c, 'tua_list', {}))) && tilstand().kort?.vist === true)

  const M = tekst(await kall(c, 'tua_get', { id: kortId, level: 'M' }))
  ok('kortet (M): samtaler per kilde, prosjekter, siste tråder og tre spørsmål', /Samtaler per kilde/.test(M) && /Claude Code: 2/.test(M) && /Lagerflytting: 1 samtale/.test(M) && /Hyttebok: 1 samtale/.test(M) && /De fem siste trådene/.test(M) && (M.match(/^- «.+»$/gm) || []).length === 3, (M.match(/^- «.+»$/gm) || []).join(' '))
  const kort = await kall(c, 'tua_card', { id: kortId, level: 'M' })
  ok('tua_card viser saken', kort.structuredContent?.mode === 'atom' && kort.structuredContent.atom.name === 'Dette fant jeg')
  const Sn = kort.structuredContent?.atom?.short || kort.structuredContent?.atom?.S || tekst(kort)
  ok('ingressen sier tallene og foreslår et spørsmål', /2 samtaler/.test(tekst(kort) + Sn) && /Spør for eksempel/.test(tekst(kort) + Sn))
  const funn = tekst(await kall(c, 'tua_search', { query: 'lagerflyttingen tiltak' }))
  ok('det som ble lest, er søkbart med en gang', /lagerflyttingen/i.test(funn) && !/^oppsett:/.test(funn))
  const status = tekst(await kall(c, 'tua_setup', {}))
  ok('tua_setup uten argumenter viser bryteren', /Automatisk lesing av det som ligger på maskinen: på/.test(status))
})

// ── 2) struping, neste runde, bryteren ──────────────────────────────────────
const hist = await (async () => { Object.assign(process.env, { TUA_FILES_ROOT: ROOT, TUA_DATA_DIR: grunnEnv.TUA_DATA_DIR, TUA_HOME: HJEM, TUA_CODE_HOME: CODE_HOME, TUA_COWORK_ROOT: grunnEnv.TUA_COWORK_ROOT, TUA_CODEX_HOME: grunnEnv.TUA_CODEX_HOME, TUA_HISTORIKK_AUTO: '1' }); return import('./historikk.js') })()
{
  const r1 = await hist.lesHistorikk()
  ok('en runde rett etter den forrige hoppes over (strupet, uansett hvor mange Tua-prosesser som kjører)', r1.hoppet === 'lest nylig', JSON.stringify(r1))
  const da = new Date(Date.now() - 40 * 60 * 1000); fs.utimesSync(aktiv, da, da)          // økta er ikke lenger i bruk (rørt for 40 minutter siden)
  const r2 = await hist.lesHistorikk({ tving: true })
  ok('neste runde tar økta som ventet, og leser bare endrede filer', r2.tall?.code?.nye === 1 && !r2.første, JSON.stringify(r2.tall))
  ok('kortet vises ikke på nytt etter senere runder', hist.kortLinje({ merk: false }) === '')
  const store = await import('./store.js')
  const k = hist.detteFantJeg(store.load())
  ok('«Dette fant jeg» holdes à jour (3 samtaler, 2 prosjekter)', k.tall.samtaler === 3 && k.tall.prosjekter === 2, JSON.stringify(k.tall))
  ok('en lås fra en levende prosess respekteres', await (async () => { const f = path.join(ROOT, '.tua', 'historikk.json'); const t = JSON.parse(fs.readFileSync(f, 'utf8')); fs.writeFileSync(f, JSON.stringify({ ...t, sist: 0, lås: { pid: process.ppid, at: Date.now() } })); const r = await hist.lesHistorikk(); fs.writeFileSync(f, JSON.stringify({ ...t, lås: null })); return r.hoppet === 'en annen Tua-prosess leser' })())
  process.env.TUA_HISTORIKK_AUTO = ''
  ok('et arkiv i en midlertidig mappe leses aldri av seg selv (de andre testsvitene er trygge)', hist.autoHistorikk() === false)
  process.env.TUA_HISTORIKK_AUTO = '1'
}
await medServer({ ...grunnEnv, TUA_FILES_ROOT: ROOT, TUA_HISTORIKK_AUTO: '1' }, async (c) => {
  const av = tekst(await kall(c, 'tua_setup', { historikk: false }))
  ok('bryteren: tua_setup(historikk=false) slår av', /slått av/.test(av) && JSON.parse(fs.readFileSync(path.join(HJEM, '.tua', 'config.json'), 'utf8')).historikk?.auto === false)
})
{
  økt('aaaa1111-0000-0000-0000-000000000004', '/Users/test/Hyttebok', 'vedlikeholdet')
  const r = await hist.lesHistorikk()
  ok('avslått: ingenting leses', r.hoppet === 'slått av', JSON.stringify(r))
  ok('finder-innstillingen i config er urørt av bryteren', Array.isArray(JSON.parse(fs.readFileSync(path.join(HJEM, '.tua', 'config.json'), 'utf8')).finder?.folders))
}

// ── 3) hooken: ingen mas om import når lesingen går av seg selv ────────────────
{
  const { spawnSync } = await import('node:child_process')
  const kjør = (auto) => spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'tua-hook.mjs'), 'start'], { input: JSON.stringify({ session_id: 'hook-test', cwd: S, hook_event_name: 'SessionStart' }), env: { ...grunnEnv, TUA_FILES_ROOT: ROOT, TUA_HISTORIKK_AUTO: auto }, encoding: 'utf8' })
  const cfg = path.join(HJEM, '.tua', 'config.json'); const c0 = JSON.parse(fs.readFileSync(cfg, 'utf8'))
  fs.writeFileSync(cfg, JSON.stringify({ ...c0, historikk: { auto: true } }) + '\n')
  const fil = path.join(ROOT, '.tua', 'import-state.json'); const st = JSON.parse(fs.readFileSync(fil, 'utf8'))
  fs.writeFileSync(fil, JSON.stringify({ ...st, code: { at: Date.now() - 30 * 86400000 } }))        // «siste import for 30 dager siden» + én ny økt
  const på = kjør('1'), av = kjør('0')
  ok('hooken, lesing på: ingen «ikke tatt med»-påminnelse', på.status === 0 && !/ikke tatt med/.test(på.stdout), på.stdout.trim().slice(0, 120) || '(stille)')
  ok('hooken, lesing av: påminnelsen står som før', /Code-økt(er)? er ikke tatt med/.test(av.stdout) && /Ett ja fra brukeren/.test(av.stdout))
}

fs.rmSync(S, { recursive: true, force: true })
console.log(feil ? `\n${feil} feil` : '\nAlt grønt')
process.exit(feil ? 1 : 0)
