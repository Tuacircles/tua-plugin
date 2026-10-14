#!/usr/bin/env node
// pakk.mjs — bygger distribuerbare pakker av Tua-pluginen (M14). Ingenting publiseres.
//
//   node tua-plugin/pakk.mjs            → build/output/tua-plugin/tua-plugin/ (selvstendig kopi: server + node_modules, skills, hooks)
//                                        → build/output/tua-plugin/tua-plugin.zip  (claude.ai › Customize › Plugins › Upload, eller --plugin-dir)
//                                        → build/output/tua-plugin/tua.mcpb        (Claude Desktop: dobbeltklikk / dra inn — manifest_version 0.3)
//   node tua-plugin/pakk.mjs --sjekk    → bare `claude plugin validate` på den bygde kopien
//
// I repoet peker `server/` og `skills/tua` på tua-mcp/ og .claude/skills/tua som symlenker (én kilde til sannhet);
// her følges lenkene så pakkene blir ekte kopier. tua-mcp/data (indeks-cache) og testfiler tas ikke med.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, '..', 'build', 'output', 'tua-plugin')      // utenfor plugin-mappa (kan ikke kopieres inn i seg selv); build/output/ er gitignorert
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '.claude-plugin', 'plugin.json'), 'utf8'))
const skip = (src) => /\/(data|\.git|\.claude-plugin\/marketplace\.json)$|\/(test-client\.js|test-apps\.mjs|pakk\.mjs|\.DS_Store)$/.test(src)
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true, filter: (src) => !skip(src) })
const rel = (p) => path.relative(path.join(HERE, '..'), p)
const size = (d) => execFileSync('du', ['-sh', d], { encoding: 'utf8' }).split('\t')[0]

if (process.argv.includes('--sjekk')) { execFileSync('claude', ['plugin', 'validate', path.join(DIST, 'tua-plugin')], { stdio: 'inherit' }); process.exit(0) }

fs.rmSync(DIST, { recursive: true, force: true })
// 1) plugin-mappa, selvstendig (uten marketplace.json — den hører til mappa i repoet)
const P = path.join(DIST, 'tua-plugin')
copy(HERE, P)
console.log(`${rel(P)}/ (${size(P)})`)
execFileSync('claude', ['plugin', 'validate', P], { stdio: 'inherit' })
execFileSync('zip', ['-q', '-r', '-X', path.join(DIST, 'tua-plugin.zip'), '.'], { cwd: P })
console.log(`${rel(path.join(DIST, 'tua-plugin.zip'))} (${size(path.join(DIST, 'tua-plugin.zip'))})`)

// 2) .mcpb for Claude Desktop — samme server, manifest etter MCPB-spec 0.3
const B = path.join(DIST, 'tua-mcpb')
copy(path.join(HERE, 'server'), path.join(B, 'server'))
fs.writeFileSync(path.join(B, 'manifest.json'), JSON.stringify({
  manifest_version: '0.3',
  name: 'tua',
  display_name: 'Tua',
  version: manifest.version,
  description: manifest.description,
  long_description: 'Hvert atom er en markdown-fil i din egen mappe (iCloud Drive, Dropbox eller ~/Tua). Lagre med «lagre dette til Tua», finn igjen med «hva har jeg om …» fra ethvert prosjekt. Legg en Claude- eller ChatGPT-eksport i Innboks, så blir samtalene søkbare.',
  author: manifest.author,
  keywords: manifest.keywords,
  server: {
    type: 'node',
    entry_point: 'server/server.js',
    mcp_config: { command: 'node', args: ['${__dirname}/server/server.js'], env: { TUA_FILES_ROOT: '${user_config.arkivmappe}', TUA_DATA_DIR: '${HOME}/.tua/cache' } },
  },
  user_config: {
    arkivmappe: { type: 'directory', title: manifest.userConfig.arkivmappe.title, description: manifest.userConfig.arkivmappe.description, required: false },
  },
  compatibility: { claude_desktop: '>=0.10.0', platforms: ['darwin', 'win32'], runtimes: { node: '>=18.0.0' } },
}, null, 2) + '\n')
execFileSync('zip', ['-q', '-r', '-X', path.join(DIST, 'tua.mcpb'), '.'], { cwd: B })
console.log(`${rel(path.join(DIST, 'tua.mcpb'))} (${size(path.join(DIST, 'tua.mcpb'))})`)
