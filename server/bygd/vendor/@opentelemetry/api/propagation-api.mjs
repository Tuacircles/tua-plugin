// Tua-plugin 0.5.9 — bygd av bygg.mjs 2026-10-29. IKKE REDIGER: kilden er server/*.js og node_modules.
import { PropagationAPI } from './api/propagation.mjs';

//#region src/propagation-api.ts
/**
* Entrypoint for propagation API
*
* @since 1.0.0
*/
const propagation = PropagationAPI.getInstance();

export { propagation };
