#!/usr/bin/env node
// sync-tua.js — speiler ET PROSJEKT (det repoet du står i) inn i Tua:
//   commit-logg · prosjektmanifest (CLAUDE.md) · beslutningslogg · lenker ·
//   dokumenter (HTML som har en PDF ved siden av seg)
//
// Generisk: virker i ethvert git-repo. Tua-prosjektets navn = Claude-prosjektets
// navn (repo-mappen) som standard, eller det som står i .tua-sync.json.
// Idempotent: stabil key per ting → nye versjoner ERSTATTER gamle (id og
// synlighet beholdes, versjon telles opp).
//
//   node sync-tua.js                    speil repoet du står i
//   node sync-tua.js --project Navn     bruk/lagre dette prosjektnavnet (.tua-sync.json)
//   node sync-tua.js --claude-project <uuid>   lagre Desktop-prosjektets uuid (.tua-sync.json → claudeProject, M9/V13)
//   node sync-tua.js --install-hook     installer .git/hooks/post-commit som kjører sync
//
// Arkivet er mappa ~/Dropbox/Tua (samme som MCP-serveren); S/M lages regelbasert (V10).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { load, save, upsert, registerProject, claudeProjectHref } from './store.js'

const SCRIPT = fileURLToPath(import.meta.url)
const args = process.argv.slice(2)
const argValue = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

// Repoet = der kommandoen kjøres fra (git-rot), ikke der skriptet ligger
const ROOT = (() => {
  try { return execSync('git rev-parse --show-toplevel', { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return process.cwd() }
})()
const CFG_PATH = path.join(ROOT, '.tua-sync.json')
const cfg = fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) : {}

// --project: lagre valget i repoet
if (argValue('--project')) {
  cfg.project = argValue('--project')
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`prosjektnavn lagret i .tua-sync.json: ${cfg.project}`)
}
// --claude-project: Desktop-prosjektets uuid (fra claude.ai/project/<uuid>) — limes inn én gang per repo
if (argValue('--claude-project')) {
  const u = argValue('--claude-project').trim().replace(/^.*\/project\//, '').replace(/[?#].*$/, '')
  if (!/^[0-9a-f-]{20,}$/i.test(u)) { console.error(`Ugyldig uuid: «${u}»`); process.exit(1) }
  cfg.claudeProject = u
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`claudeProject lagret i .tua-sync.json: ${u}`)
}
const PROJECT = process.env.TUA_SYNC_PROJECT || cfg.project || path.basename(ROOT)
const CLAUDE_PROJECT = (cfg.claudeProject || '').trim()
const SOURCE = 'Claude Code · sync'

// --install-hook: post-commit som kjører dette skriptet
if (args.includes('--install-hook')) {
  const hooksDir = path.join(ROOT, '.git', 'hooks')
  if (!fs.existsSync(hooksDir)) { console.error('Ikke et git-repo (fant ikke .git/hooks) — hook ikke installert.'); }
  else {
    const hook = `#!/bin/sh
# Tua: etter hver commit — speil commit-logg, manifest, beslutningslogg, lenker
# og dokumenter inn i Tua. Nye versjoner erstatter gamle. (installert av sync-tua.js)
cd "$(git rev-parse --show-toplevel)" || exit 0
if command -v node >/dev/null 2>&1; then
  node "${SCRIPT}" 2>/dev/null | tail -1 | sed 's/^/[tua-sync] /'
else
  echo "[tua-sync] node ikke funnet — kjør manuelt: node ${SCRIPT}" >&2
fi
`
    const p = path.join(hooksDir, 'post-commit')
    fs.writeFileSync(p, hook); fs.chmodSync(p, 0o755)
    console.log(`post-commit-hook installert: ${p}`)
  }
}

const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' } }
const exists = (p) => fs.existsSync(path.join(ROOT, p))
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
const htmlToText = (html) =>
  decode(html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/t[dh]>/gi, ' · ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|pre|table|ol|ul)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/ ·\s*\n/g, '\n').replace(/\n\s*\n+/g, '\n\n').trim()
const pick = (html, re) => { const m = (html.match(re) || [])[1]; return m && decode(m.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() }

// Dokumenter = HTML med PDF ved siden av (utenfor node_modules), maks 4 nivåer
const pdfs = sh(`find . -maxdepth 4 -name '*.pdf' -not -path '*/node_modules/*' -not -path './.git/*' | sed 's#^\\./##' | sort`)
  .split('\n').filter(Boolean)
  .filter((p) => exists(p.replace(/\.pdf$/, '.html')))


// ── Regelbasert S/M (V10): sync kjører uten LLM, men kan avlede nivåene deterministisk ──
// S ≤ 300 tegn, M ≤ 2 500 tegn. Merkes by: 'regel' — et Claude- eller menneskeskrevet
// nivå på samme atom vinner over dette (store.js mergeLevels).
const clip = (str, n) => (str.length > n ? str.slice(0, n - 1).trimEnd() + '…' : str)
const flat = (str) => str.replace(/\s+/g, ' ').trim()
const mdHeadings = (md) => md.split('\n').filter((l) => /^#{1,3}\s/.test(l)).map((l) => flat(l.replace(/^#+\s*/, '')))
// Første ekte avsnitt: ikke overskrift, sitat, tabell, linjal eller kode
const firstPara = (md) => {
  const b = md.split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^(#|>|\||---|```|!\[|\*[^*])/.test(x))
  return flat(b || '')
}
const lastUpdated = (md) => (md.match(/sist oppdatert:?\s*\**\s*([^\n*|·]+)/i) || [])[1]?.trim()
// Manifest, beslutningslogg, status: S = første avsnitt + sist oppdatert;
// M = overskriftene + beslutningslinjene (**V1 — …**, **AI3 — …**) + fete tabellrader (| **M1** | …)
function levelsForMarkdown(md) {
  const upd = lastUpdated(md)
  const short = clip([firstPara(md), upd && `Sist oppdatert ${upd}.`].filter(Boolean).join(' '), 300)
  const heads = mdHeadings(md).slice(1)
  const lines = md.split('\n')
  const decisions = lines.filter((l) => /^\*\*[A-ZÆØÅ]{1,3}\d*\s*[—–-]/.test(l)).map((l) => clip(flat(l.replace(/\*\*/g, '')), 160))
  const rows = lines.filter((l) => /^\|\s*\*\*/.test(l)).map((l) => clip(l.split('|').map((c) => flat(c.replace(/\*\*/g, ''))).filter(Boolean).slice(0, 3).join(' · '), 160))
  const medium = clip([
    heads.length ? `Struktur: ${heads.join(' · ')}` : '',
    rows.length ? `\nRader:\n${rows.map((r) => `- ${r}`).join('\n')}` : '',
    decisions.length ? `\nBeslutninger:\n${decisions.map((d) => `- ${d}`).join('\n')}` : '',
  ].filter(Boolean).join('\n'), 2500)
  return { short, medium: md.length > 3000 ? medium : '' }
}
// Dokument (HTML): S = standfirst; M = overskrifter + første avsnitt under hver
function levelsForHtml(html, stand, htmlPath, pdf) {
  const out = []
  let waiting = false
  const re = /<(h[23]|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(html))) {
    if (/class="[^"]*(standfirst|eyebrow)/.test(m[2])) continue        // S står alt øverst
    const t = flat(decode(m[3].replace(/<[^>]+>/g, ' ')))
    if (!t) continue
    if (m[1].toLowerCase() !== 'p') { out.push(`\n${t}`); waiting = true }
    else if (waiting) { out.push(clip(t, 220)); waiting = false }
    if (out.join('\n').length > 2600) break
  }
  const medium = clip(`${stand}\n${out.join('\n')}\n\nFil: ${htmlPath} · PDF: ${pdf}`.trim(), 2500)
  return { short: clip(stand, 300), medium }
}

// ── M9: lenker — hvert speilet atom bærer sine egne pekere (V13) ──
// repo (alltid), Desktop-prosjektet (når claudeProject er satt), fil(er) for dokumenter.
// Registeret .tua/projects.json gir samme repo/prosjekt-lenke til ALLE atomer i prosjektet,
// også dem Claude lagrer selv med tua_save.
const baseLinks = () => [
  { kind: 'repo', href: ROOT, label: `Repo — ${PROJECT}` },
  ...(CLAUDE_PROJECT ? [{ kind: 'claude-project', href: claudeProjectHref(CLAUDE_PROJECT), label: `Claude-prosjekt — ${PROJECT}` }] : []),
]
const fileLinks = (...rels) => rels.filter(Boolean).map((r) => ({ kind: 'file', href: path.join(ROOT, r), label: path.basename(r) }))
registerProject(PROJECT, { repo: ROOT, claudeProject: CLAUDE_PROJECT || undefined })

const items = []

// 1 · Commit-logg
const gitlog = sh(`git log --date=format:'%Y-%m-%d %H:%M' --format='%h · %ad · %s%n%b' -n 200`)
if (gitlog) items.push({
  key: 'commit-logg', name: `Commit-logg — ${path.basename(ROOT)}`, convo: 'Git-historikk',
  summary: 'Alle commits i repoet, nyeste først. Oppdateres automatisk ved hver commit.',
  tags: ['commit', 'git', 'logg'], content: `# Commit-logg — ${path.basename(ROOT)}\n\n${gitlog}`,
  links: baseLinks(),
  ...(() => {
    const subj = gitlog.split('\n').filter((l) => /^[0-9a-f]{7,} · /.test(l))
    return {
      short: clip(`${subj.length} commits i ${path.basename(ROOT)}. Nyeste: ${subj[0] || '—'}`, 300),
      medium: subj.length > 3 ? clip(`De ${Math.min(20, subj.length)} siste:\n${subj.slice(0, 20).map((l) => `- ${l}`).join('\n')}`, 2500) : '',
    }
  })(),
})

// 2 · Prosjektmanifest
for (const m of ['CLAUDE.md', 'MANIFEST.md', 'README.md']) {
  if (!exists(m)) continue
  items.push({
    key: 'manifest', name: `Prosjektmanifest — ${PROJECT} (${m})`, convo: m,
    summary: 'Prosjektkontekst: hva det er, prinsipper og konvensjoner.',
    tags: ['manifest', m.toLowerCase().replace('.md', '')], content: read(m), ...levelsForMarkdown(read(m)),
    links: [...fileLinks(m), ...baseLinks()],
  })
  break
}

// 2b · Status/veikart (ett levende dokument: milepæler, faser, avklaringer)
for (const s of ['STATUS.md', 'docs/STATUS.md']) {
  if (!exists(s)) continue
  items.push({
    key: 'status', name: `Status og veikart — ${PROJECT}`, convo: s,
    summary: 'Hvor vi er: milepæler (M), faser, åpne avklaringer og hvor ting ligger. Oppdateres ved hver milepæl.',
    tags: ['status', 'veikart', 'milepæler'], content: read(s), ...levelsForMarkdown(read(s)),
    links: [...fileLinks(s), ...baseLinks()],
  })
  break
}

// 3 · Beslutningslogg
for (const b of ['concepts/00-beslutninger.md', 'BESLUTNINGER.md', 'docs/beslutninger.md', 'beslutninger.md']) {
  if (!exists(b)) continue
  items.push({
    key: 'beslutningslogg', name: `Beslutningslogg — ${PROJECT}`, convo: b,
    summary: 'Beslutninger med begrunnelser. Vedlikeholdes løpende.',
    tags: ['beslutningslogg', 'manifest'], content: read(b), ...levelsForMarkdown(read(b)),
    links: [...fileLinks(b), ...baseLinks()],
  })
  break
}

// 4 · Lenker (generelle + repoets egne fra .tua-sync.json "links")
items.push({
  key: 'lenker', name: `Lenker — ${PROJECT}`, convo: 'Hvor ting ligger',
  summary: 'Repo, nøkkelfiler, dokumenter og prosjektets egne lenker/start-kommandoer.',
  tags: ['lenker'],
  links: [...fileLinks('.tua-sync.json'), ...baseLinks()],
  short: clip(`${cfg.links?.length || 0} lenker, ${pdfs.length} dokumenter (HTML + PDF) og nøkkelfilene for ${PROJECT}. Repo: ${ROOT}`, 300),
  content: [
    `# Lenker — ${PROJECT}`, '',
    `## Repo`, `- ${ROOT}`, '',
    ...(cfg.links?.length ? ['## Prosjektets lenker', ...cfg.links.map((l) => `- ${l}`), ''] : []),
    '## Dokumenter (HTML + PDF)',
    ...(pdfs.length ? pdfs.map((p) => `- ${p.replace(/\.pdf$/, '.html')} · ${p}`) : ['- (ingen ennå — dokumenter fanges opp når de har en PDF ved siden av seg)']),
    '', '## Nøkkelfiler',
    ...['CLAUDE.md', 'README.md', 'concepts/00-beslutninger.md', 'BESLUTNINGER.md', '.tua-sync.json'].filter(exists).map((f) => `- ${f}`),
  ].join('\n'),
})

// 5 · Dokumenter
for (const pdf of pdfs) {
  const htmlPath = pdf.replace(/\.pdf$/, '.html')
  const html = read(htmlPath)
  const title = (pick(html, /<title>([\s\S]*?)<\/title>/i) || htmlPath).replace(/^Tua — /, '')
  const eyebrow = pick(html, /class="eyebrow">([\s\S]*?)<\/span>/i) || ''
  const stand = pick(html, /class="standfirst">([\s\S]*?)<\/p>/i) || ''
  const nn = (htmlPath.match(/(?:^|\/)(\d+)[-_]/) || [])[1]
  items.push({
    key: `dok:${htmlPath}`, name: title, convo: eyebrow || path.dirname(htmlPath),
    summary: `Ferdig dokument${nn ? ` (arbeidsstykke ${nn})` : ''} i repoet — ${htmlPath}, PDF ved siden av. Speiles automatisk ved commit.`,
    tags: ['dokument', nn ? `arbeidsstykke-${nn}` : 'arbeidsstykke'],
    content: `${htmlToText(html)}\n\n---\nFil: ${htmlPath} · PDF: ${pdf}`,
    ...levelsForHtml(html, stand, htmlPath, pdf),
    links: [...fileLinks(htmlPath, pdf), ...baseLinks()],
    renders: [{ format: 'html', path: path.join(ROOT, htmlPath) }, { format: 'pdf', path: path.join(ROOT, pdf) }],   // M11: eksporteres til arkivmappa
  })
}

// Skriv — bare hvis noe faktisk endret seg
const atoms = load()
const counts = { ny: 0, oppdatert: 0, nivåer: 0, uendret: 0 }
for (const it of items) {
  const { atom, status } = upsert(atoms, { ...it, project: PROJECT, source: SOURCE, by: 'regel' })
  counts[status]++
  console.log(`${status.padEnd(9)} ${it.key}${status === 'oppdatert' ? ` (v${atom.version})` : ''}`)
}
if (counts.ny || counts.oppdatert || counts.nivåer) save(atoms)
const inProject = atoms.filter((a) => a.project.toLowerCase() === PROJECT.toLowerCase()).length
console.log(`\n${PROJECT}: ${counts.ny} nye · ${counts.oppdatert} oppdatert · ${counts.nivåer} fikk S/M · ${counts.uendret} uendret · ${inProject} atomer i prosjektet`)
