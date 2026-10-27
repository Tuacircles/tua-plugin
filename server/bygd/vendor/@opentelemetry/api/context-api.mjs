// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
import { ContextAPI } from './api/context.mjs';

//#region src/context-api.ts
/**
* Entrypoint for context API
* @since 1.0.0
*/
const context = ContextAPI.getInstance();

export { context };
