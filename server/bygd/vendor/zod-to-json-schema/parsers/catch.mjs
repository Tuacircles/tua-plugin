// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseDef } from '../parseDef.mjs';

const parseCatchDef = (def, refs) => {
    return parseDef(def.innerType._def, refs);
};

export { parseCatchDef };
