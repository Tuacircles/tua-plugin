// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
/**
 * A deferred: a `Promise` together with its `resolve` / `reject` functions.
 * This is `Promise.withResolvers()`, which is not available in all supported
 * runtimes.
 */
function promiseWithResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

export { promiseWithResolvers };
