// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-25. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

function parsePromiseDef(def, refs) {
    return parseDef(def.type._def, refs);
}

export { parsePromiseDef };
