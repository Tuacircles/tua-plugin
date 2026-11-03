// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
function parseNullDef(refs) {
    return refs.target === "openApi3"
        ? {
            enum: ["null"],
            nullable: true,
        }
        : {
            type: "null",
        };
}

export { parseNullDef };
