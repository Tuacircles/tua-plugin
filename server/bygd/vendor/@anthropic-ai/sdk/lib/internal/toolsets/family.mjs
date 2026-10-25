// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-25. IKKE REDIGER: kilden er server/*.js og node_modules.
/** Dated `tools[]` entry `type` → the family stamped on member blocks. */
const TOOLSET_TYPE_TO_FAMILY = {
    browser_toolset_20260801: 'browser',
    computer_toolset_20260801: 'computer',
};
function toolsetFamily(toolset) {
    return TOOLSET_TYPE_TO_FAMILY[toolset.type];
}
/** Whether a `tools` entry is a toolset the runner can execute locally. */
function isRunnableToolset(t) {
    // `in` alone would accept inherited keys such as `toString`
    return 'run' in t && t.type != null && Object.prototype.hasOwnProperty.call(TOOLSET_TYPE_TO_FAMILY, t.type);
}

export { isRunnableToolset, toolsetFamily };
