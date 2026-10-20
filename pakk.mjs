#!/usr/bin/env node
// pakk.mjs — bygger distribuerbare pakker av Tua-pluginen. Ingenting publiseres.
//
//   node pakk.mjs            → dist/tua-plugin/      (ren kopi uten node_modules, data, dist, tester)
//                            → dist/tua-plugin.zip   (claude.ai › Customize › Plugins › Upload, eller `claude --plugin-dir`)
//                            → dist/tua.mcpb         (Claude Desktop: dobbeltklikk / dra inn — manifest_version 0.3)
//   node pakk.mjs --sjekk    → bare `claude plugin validate` på den bygde kopien
//
// Fra M18 er denne mappa selv pluginen (ingen symlenker): server/, skills/, hooks/ er ekte filer, og avhengighetene
// installeres fra package-lock.json i rota (Claude Code gjør det selv ved installasjon). Katalogen (claude.ai/directory)
// leser rett fra GitHub-repoet — pakkene her er for manuell deling og Desktop.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, 'dist')
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '.claude-plugin', 'plugin.json'), 'utf8'))
const skip = (src) => /[\\/](node_modules|dist|\.git|server[\\/]data)$|[\\/](test-client\.js|test-apps\.mjs|test-platform\.mjs|pakk\.mjs|\.DS_Store|Thumbs\.db)$/.test(src)
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true, filter: (src) => !skip(src) })
const rel = (p) => path.relative(HERE, p)
const size = (d) => { try { return execFileSync('du', ['-sh', d], { encoding: 'utf8' }).split('\t')[0] } catch { return '?' } }
const zip = (dir, out) => execFileSync('zip', ['-q', '-r', '-X', out, '.'], { cwd: dir })

if (process.argv.includes('--sjekk')) { execFileSync('claude', ['plugin', 'validate', path.join(DIST, 'tua-plugin')], { stdio: 'inherit' }); process.exit(0) }

fs.rmSync(DIST, { recursive: true, force: true })
// 1) plugin-mappa, ren kopi
const P = path.join(DIST, 'tua-plugin')
copy(HERE, P)
console.log(`${rel(P)}/ (${size(P)})`)
execFileSync('claude', ['plugin', 'validate', P], { stdio: 'inherit' })
zip(P, path.join(DIST, 'tua-plugin.zip'))
console.log(`${rel(path.join(DIST, 'tua-plugin.zip'))} (${size(path.join(DIST, 'tua-plugin.zip'))})`)

// 2) .mcpb for Claude Desktop — samme server, manifest etter MCPB-spec 0.3, med personvernerklæring (kreves for lokale servere)
const B = path.join(DIST, 'tua-mcpb')
copy(path.join(HERE, 'server'), path.join(B, 'server'))
for (const f of ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'PRIVACY.md']) copy(path.join(HERE, f), path.join(B, f))
fs.writeFileSync(path.join(B, 'manifest.json'), JSON.stringify({
  manifest_version: '0.3',
  name: 'tua',
  display_name: 'Tua',
  version: manifest.version,
  description: manifest.description,
  long_description: 'Every atom is a markdown file in your own folder (iCloud Drive, Dropbox, OneDrive, Google Drive or a local folder). Save with «lagre dette til Tua», find it again with «hva har jeg om …» from any project. Bring in your history from Claude Code, Cowork and Claude Desktop without exports. Nothing leaves your machine.',
  author: manifest.author,
  homepage: manifest.homepage,
  repository: manifest.repository,
  license: manifest.license,
  keywords: manifest.keywords,
  privacy_policies: ['https://github.com/tuacircles/tua-plugin/blob/main/PRIVACY.md', 'https://tuacircles.com/privacy-policy'],
  server: {
    type: 'node',
    entry_point: 'server/tua-server.bundle.mjs',
    mcp_config: { command: 'node', args: ['${__dirname}/server/tua-server.bundle.mjs'], env: { TUA_FILES_ROOT: '${user_config.arkivmappe}', TUA_DATA_DIR: '${HOME}/.tua/cache' } },
  },
  user_config: {
    arkivmappe: { type: 'directory', title: manifest.userConfig.arkivmappe.title, description: manifest.userConfig.arkivmappe.description, required: false },
  },
  compatibility: { claude_desktop: '>=0.10.0', platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=22.15.0' } },
}, null, 2) + '\n')
zip(B, path.join(DIST, 'tua.mcpb'))
console.log(`${rel(path.join(DIST, 'tua.mcpb'))} (${size(path.join(DIST, 'tua.mcpb'))})`)
