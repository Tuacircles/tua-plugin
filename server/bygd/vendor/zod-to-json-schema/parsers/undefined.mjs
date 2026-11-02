// Tua-plugin 0.5.10 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseAnyDef } from './any.mjs';

function parseUndefinedDef(refs) {
    return {
        not: parseAnyDef(refs),
    };
}

export { parseUndefinedDef };
