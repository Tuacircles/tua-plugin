// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-25. IKKE REDIGER: kilden er server/*.js og node_modules.
import { traceHeaderNames } from '../../../internal/trace-headers.mjs';

/**
 * Removes the trace-context headers ({@link traceHeaderNames}) from `headers` and returns them.
 */
function takeTraceHeaders(headers) {
    // By the names that `headers` has: a propagator can list a field that `Headers` rejects as a name.
    const names = traceHeaderNames();
    const taken = Array.from(headers.entries()).filter(([name]) => names.has(name));
    for (const [name] of taken) {
        headers.delete(name);
    }
    return taken;
}
/**
 * Returns a middleware that runs `middleware`, which may sign the request, without the trace-context
 * headers, and sets them again on what `middleware` passes on.
 */
function withoutTraceHeaders(middleware) {
    return (request, next, ctx) => {
        const headers = new Headers(request.headers);
        const traceHeaders = takeTraceHeaders(headers);
        return middleware({ ...request, headers }, (inner) => {
            const restored = new Headers(inner.headers);
            for (const [name, value] of traceHeaders)
                restored.set(name, value);
            return next({ ...inner, headers: restored });
        }, ctx);
    };
}

export { takeTraceHeaders, withoutTraceHeaders };
