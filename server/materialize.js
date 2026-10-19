#!/usr/bin/env node
// materialize.js — engangs-bootstrap: skriv atoms.json (cachen) ut som filer i
// FILES_ROOT (~/Dropbox/Tua). Etter dette er mappa sannheten; store.js leser og
// skriver filene direkte. Idempotent, sletter aldri.
//
//   node materialize.js                      → ~/Dropbox/Tua
//   TUA_FILES_ROOT=/sti node materialize.js  → egen rot

import { loadCache, save, FILES_ROOT, filesMode } from './store.js'
import fs from 'node:fs'

if (!filesMode()) fs.mkdirSync(FILES_ROOT, { recursive: true })
const atoms = loadCache()
const written = save(atoms)
const projects = [...new Set(atoms.map((a) => a.project))]
console.log(`${FILES_ROOT}`)
console.log(`${atoms.length} atomer i cachen → ${written} filer skrevet/oppdatert (resten uendret)`)
console.log(`prosjekt-mapper: ${projects.join(' · ')}`)
