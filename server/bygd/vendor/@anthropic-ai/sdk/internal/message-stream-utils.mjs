// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-25. IKKE REDIGER: kilden er server/*.js og node_modules.
import { partialParse } from '../_vendor/partial-json-parser/parser.mjs';

const JSON_BUF_PROPERTY = '__json_buf';
/**
 * Copies a tool-use block with an updated `__json_buf`, installing `.input` as
 * a memoized getter so the partial-JSON parse happens on first read instead of
 * on every delta.
 */
function withLazyInput(prev, jsonBuf) {
    const next = {};
    for (const key of Object.keys(prev)) {
        if (key !== 'input')
            next[key] = prev[key];
    }
    Object.defineProperty(next, JSON_BUF_PROPERTY, { value: jsonBuf, enumerable: false, writable: true });
    let input;
    let parsed = false;
    Object.defineProperty(next, 'input', {
        enumerable: true,
        configurable: true,
        get() {
            if (!parsed) {
                input = jsonBuf ? partialParse(jsonBuf) : {};
                parsed = true;
            }
            return input;
        },
    });
    return next;
}

export { JSON_BUF_PROPERTY, withLazyInput };
