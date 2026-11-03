// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { ContextAPI } from './api/context.mjs';

//#region src/context-api.ts
/**
* Entrypoint for context API
* @since 1.0.0
*/
const context = ContextAPI.getInstance();

export { context };
