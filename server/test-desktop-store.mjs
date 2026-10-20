// test-desktop-store.mjs — tørrkjøring av Desktop-leseren (cache + samtalelager) mot et scratch-arkiv. Skriver aldri atomer.
//   TUA_FILES_ROOT=<scratch> TUA_DATA_DIR=<scratch>/data node server/test-desktop-store.mjs
// Nekter å kjøre mot det ekte arkivet: begge miljøvariablene må peke på en mappe under os.tmpdir() eller /private/tmp.
import os from 'node:os'
import { collectDesktop } from './desktop.js'
import { importDesktop, desktopData } from './import.js'

const ok = (p) => p && (p.startsWith(os.tmpdir()) || p.startsWith('/private/tmp') || p.startsWith('/tmp'))
if (!ok(process.env.TUA_FILES_ROOT) || !ok(process.env.TUA_DATA_DIR)) { console.error('Sett TUA_FILES_ROOT og TUA_DATA_DIR til en scratch-mappe (under tmp). Avbryter.'); process.exit(2) }

const log = (m) => console.log('  · ' + m)
const t0 = Date.now()
const d = collectDesktop({ log, since: null })
const cutoff = Date.parse('2026-09-15')
const fromStore = d.convs.filter((c) => c.store)
const newer = d.convs.filter((c) => (c.updated || 0) > cutoff)
console.log(`\ncollectDesktop: ${d.convs.length} samtaler totalt · ${fromStore.length} fra samtalelageret · ${newer.length} oppdatert etter 15.09.2026 · ${Date.now() - t0} ms`)
console.log('stats:', JSON.stringify(d.stats))
const fmt = (ms) => (ms ? new Date(ms).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?')
console.log('\nNyeste 12 (oppdatert · meldinger · kilde · prosjekt · tittel):')
for (const c of [...d.convs].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 12)) {
  const src = c.store ? (c.store.cowork ? 'lager/Cowork' : 'lager/chat') + (c.store.windowed ? ' (utsnitt)' : '') : 'cache'
  console.log(`  ${fmt(c.updated).padEnd(15)} ${String(c.messages).padStart(3)}  ${src.padEnd(22)} ${(c.projectName || '—').padEnd(22)} ${c.title.slice(0, 60)}`)
}
const skado = d.convs.find((c) => c.id === '286c6c65-5607-846b-baa4-8de61fc42f3d')
console.log(`\nSkado-samtalen (286c6c65…): ${skado ? `funnet · ${skado.messages} meldinger · ${skado.transcript.length} tegn · «Takhattene» ${skado.transcript.includes('Takhattene') ? 'ja' : 'nei'} · tittel «${skado.title}» · prosjekt «${skado.projectName || '—'}»` : 'IKKE funnet'}`)
if (skado) console.log('  utdrag av L:\n  ' + skado.transcript.slice(0, 700).replace(/\n/g, '\n  '))

console.log('\nMed prosjekt fra Desktops mappetilganger (desktopData):')
const dd = desktopData({ all: true })
for (const c of dd.convs.filter((x) => x.tags.includes('desktop')).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 14)) console.log(`  ${fmt(c.updated).padEnd(15)} ${(c.project || '—').padEnd(34)} ${c.source.padEnd(14)} ${c.title.slice(0, 50)}`)
const sk = dd.convs.find((c) => c.id === '286c6c65-5607-846b-baa4-8de61fc42f3d')
console.log(`  Skado → prosjekt «${sk?.project || '—'}», kilde «${sk?.source}», tagger ${JSON.stringify(sk?.tags)}, meta «${sk?.meta}»`)

console.log('\n── importDesktop dryRun ──')
const r = importDesktop({ dryRun: true, log })
console.log(r.report.split('\n').slice(0, 30).join('\n'))
