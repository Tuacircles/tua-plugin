// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-25. IKKE REDIGER: kilden er server/*.js og node_modules.
import { TraceAPI } from './api/trace.mjs';

//#region src/trace-api.ts
/**
* Entrypoint for trace API
*
* @since 1.0.0
*/
const trace = TraceAPI.getInstance();

export { trace };
