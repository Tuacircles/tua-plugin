// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
var errorUtil;
(function (errorUtil) {
    errorUtil.errToObj = (message) => typeof message === "string" ? { message } : message || {};
    // biome-ignore lint:
    errorUtil.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

export { errorUtil };
