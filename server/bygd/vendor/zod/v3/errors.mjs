// Tua-plugin 0.5.9 — bygd av bygg.mjs 2026-10-29. IKKE REDIGER: kilden er server/*.js og node_modules.
import { errorMap } from './locales/en.mjs';

let overrideErrorMap = errorMap;
function getErrorMap() {
    return overrideErrorMap;
}

export { getErrorMap };
