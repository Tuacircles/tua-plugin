// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseAnyDef } from './any.mjs';

function parseUndefinedDef(refs) {
    return {
        not: parseAnyDef(refs),
    };
}

export { parseUndefinedDef };
