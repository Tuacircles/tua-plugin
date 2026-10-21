// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import { parseAnyDef } from './any.mjs';

function parseNeverDef(refs) {
    return refs.target === "openAi"
        ? undefined
        : {
            not: parseAnyDef({
                ...refs,
                currentPath: [...refs.currentPath, "not"],
            }),
        };
}

export { parseNeverDef };
