// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
const COMPLETABLE_SYMBOL = Symbol.for('mcp.completable');
/**
 * Checks if a schema is completable (has completion metadata).
 */
function isCompletable(schema) {
    return !!schema && typeof schema === 'object' && COMPLETABLE_SYMBOL in schema;
}
/**
 * Gets the completer callback from a completable schema, if it exists.
 */
function getCompleter(schema) {
    const meta = schema[COMPLETABLE_SYMBOL];
    return meta?.complete;
}
// Legacy exports for backward compatibility
// These types are deprecated but kept for existing code
var McpZodTypeKind;
(function (McpZodTypeKind) {
    McpZodTypeKind["Completable"] = "McpCompletable";
})(McpZodTypeKind || (McpZodTypeKind = {}));

export { getCompleter, isCompletable };
