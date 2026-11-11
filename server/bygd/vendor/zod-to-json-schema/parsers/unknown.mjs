// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseAnyDef } from './any.mjs';

function parseUnknownDef(refs) {
    return parseAnyDef(refs);
}

export { parseUnknownDef };
