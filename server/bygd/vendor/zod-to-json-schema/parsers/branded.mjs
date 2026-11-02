// Tua-plugin 0.5.10 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

function parseBrandedDef(_def, refs) {
    return parseDef(_def.type._def, refs);
}

export { parseBrandedDef };
