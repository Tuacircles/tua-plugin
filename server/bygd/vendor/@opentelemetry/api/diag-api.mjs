// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { DiagAPI } from './api/diag.mjs';

//#region src/diag-api.ts
/**
* Entrypoint for Diag API.
* Defines Diagnostic handler used for internal diagnostic logging operations.
* The default provides a Noop DiagLogger implementation which may be changed via the
* diag.setLogger(logger: DiagLogger) function.
*
* @since 1.0.0
*/
DiagAPI.instance();
