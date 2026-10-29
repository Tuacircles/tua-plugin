// Tua-plugin 0.5.9 — bygd av bygg.mjs 2026-10-29. IKKE REDIGER: kilden er server/*.js og node_modules.
import { stringify } from '../qs/stringify.mjs';

function stringifyQuery(query) {
    return stringify(query, { arrayFormat: 'brackets' });
}

export { stringifyQuery };
