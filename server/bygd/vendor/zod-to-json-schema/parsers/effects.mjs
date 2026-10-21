// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';
import { parseAnyDef } from './any.mjs';

function parseEffectsDef(_def, refs) {
    return refs.effectStrategy === "input"
        ? parseDef(_def.schema._def, refs)
        : parseAnyDef(refs);
}

export { parseEffectsDef };
