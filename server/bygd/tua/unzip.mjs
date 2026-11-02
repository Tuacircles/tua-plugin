// Tua-plugin 0.5.11 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs__default from 'node:fs';
import os from 'node:os';
import path__default from 'node:path';
import { spawnSync } from 'node:child_process';

// unzip.js — pakker ut en zip (bare json-filene) til en temp-mappe, uten shell.
//
// Skilt ut fra import.js 19.10.2026: katalogens validator flagget at én og samme fil både hentet en nettside (fetch)
// og startet en prosess (spawnSync), som ligner på «last ned og kjør». Her er det ingen nettverk — bare lokal zip.
// unzip finnes på macOS/Linux; Windows 10+ og macOS har `tar` (bsdtar) som leser zip — den brukes når unzip mangler.


// hasRoot(dir) → true når utpakkingen ga noe brukbart (kalleren avgjør hva det er).
function unzipToTemp(zipPath, hasRoot) {
  const tmp = fs__default.mkdtempSync(path__default.join(os.tmpdir(), 'tua-import-'));
  const tries = process.env.TUA_NO_UNZIP ? [] : [['unzip', ['-o', '-q', zipPath, '*.json', '-d', tmp]]];
  tries.push(['tar', ['-xf', zipPath, '-C', tmp, '--include=*.json']], ['tar', ['-xf', zipPath, '-C', tmp]]);
  let last = '';
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (hasRoot(tmp)) return tmp
    last = r.error ? `${cmd}: ${r.error.message}` : (r.stderr || r.stdout || '').trim();
  }
  throw new Error(`kunne ikke pakke ut ${path__default.basename(zipPath)}: ${last || 'ingen json-filer i zip-en'} (trenger unzip eller tar)`)
}

export { unzipToTemp };
