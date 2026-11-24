// Tua-plugin 0.5.16 — bygd av bygg.mjs 2026-11-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

const parseReadonlyDef = (def, refs) => {
    return parseDef(def.innerType._def, refs);
};

export { parseReadonlyDef };
