// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
/**
 * Tracks which fallback a sequence of requests is pinned to.
 *
 * Create one (`new BetaFallbackState()`) and pass it via the `fallbackState`
 * request option on every request that should share the pin — the turns of one
 * conversation, or any wider scope the stickiness should apply to;
 * `betaRefusalFallbackMiddleware` mutates it in place when a model refuses.
 */
const FallbackEncoder = ({ headers, body }) => {
    return {
        bodyHeaders: {
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    };
};

export { FallbackEncoder };
