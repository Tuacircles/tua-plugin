// Tua-plugin 0.5.9 — bygd av bygg.mjs 2026-10-29. IKKE REDIGER: kilden er server/*.js og node_modules.
function parseEnumDef(def) {
    return {
        type: "string",
        enum: Array.from(def.values),
    };
}

export { parseEnumDef };
