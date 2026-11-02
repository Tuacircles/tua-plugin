// Tua-plugin 0.5.11 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

function parsePromiseDef(def, refs) {
    return parseDef(def.type._def, refs);
}

export { parsePromiseDef };
