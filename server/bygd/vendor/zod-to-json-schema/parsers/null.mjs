// Tua-plugin 0.5.16 — bygd av bygg.mjs 2026-11-24. IKKE REDIGER: kilden er server/*.js og node_modules.
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
