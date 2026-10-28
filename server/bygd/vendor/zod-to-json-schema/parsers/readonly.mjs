// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-28. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

const parseReadonlyDef = (def, refs) => {
    return parseDef(def.innerType._def, refs);
};

export { parseReadonlyDef };
