// Tua-plugin 0.5.9 — bygd av bygg.mjs 2026-10-29. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

const parseCatchDef = (def, refs) => {
    return parseDef(def.innerType._def, refs);
};

export { parseCatchDef };
