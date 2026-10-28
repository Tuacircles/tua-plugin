// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-28. IKKE REDIGER: kilden er server/*.js og node_modules.
import 'node:os';
import 'node:fs';
import { readConfig } from './store.mjs';

// ollama.js — modellene i Ollama, sett fra Tua (friksjon 12, bruksdag 1, 24.10.2026).
//
// Erik: «Bør kunne gå inn i Ollama og finne best mulig modell (i innstillinger).» Dette er det ene stedet Tua snakker med Ollama om
// MODELLER (ikke om svar — det er motoren): hvilke som ligger på maskinen, hvilke vi anbefaler for akkurat denne maskinen, hente én
// med fremdrift, fjerne én, og hvilken som er STANDARD — den motoren bruker når Ollama er mottaker, vurderer eller skriver av S/M.
//
// Bare Ollama-serverens HTTP-API brukes (/api/tags, /api/pull strømmet, /api/delete). Aldri appens GUI eller innstillinger
// (hendelsen 23.10 kl. 22:08: appens Claude-knapp skrev om Claude Desktop). TUA_OLLAMA_URL peker et annet sted (bare for tester —
// test-ollama.mjs kjører en falsk Ollama på en annen port). Nedlasting skjer fra ollama.com; det sies i linja i appen.
//
// Standardmodellen lagres i ~/.tua/config.json som { ollama: { modell, valgt } } (store.readConfig/writeConfig — samme fil som
// arkivstedet og onboardingen). Rekkefølgen motoren bruker: TUA_OLLAMA_MODELL (bare tester/overstyring) → config, hvis modellen
// fortsatt ligger lokalt → den første i Ollamas liste. Er den valgte fjernet, faller Tua stille tilbake til den første og sier det i appen.


const OLLAMA_URL = (process.env.TUA_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_VERT = OLLAMA_URL.replace(/^https?:\/\//, '');

// Standardmodellen: TUA_OLLAMA_MODELL → config (når den fortsatt ligger lokalt) → første lokale. `valgtFinnes` sier om config-valget ble fulgt.
const lagretStandard = () => { const c = readConfig().ollama; return c && typeof c === 'object' && c.modell ? String(c.modell) : null };
function standardModell(navnListe = []) {
  const env = process.env.TUA_OLLAMA_MODELL || null;
  if (env) return { modell: env, kilde: 'miljøvariabel', valgtFinnes: true }
  const lagret = lagretStandard();
  if (lagret && navnListe.includes(lagret)) return { modell: lagret, kilde: 'valgt', valgtFinnes: true }
  return { modell: navnListe[0] || null, kilde: navnListe[0] ? 'første' : 'ingen', valgtFinnes: !lagret, lagret }
}

export { OLLAMA_URL, OLLAMA_VERT, standardModell };
