// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
//#region src/trace/invalid-span-constants.ts
/**
* @since 1.0.0
*/
const INVALID_SPANID = "0000000000000000";
/**
* @since 1.0.0
*/
const INVALID_TRACEID = "00000000000000000000000000000000";
/**
* @since 1.0.0
*/
const INVALID_SPAN_CONTEXT = {
	traceId: INVALID_TRACEID,
	spanId: INVALID_SPANID,
	traceFlags: 0
};

export { INVALID_SPAN_CONTEXT };
