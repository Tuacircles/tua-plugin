// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
import { propagation } from '../../../@opentelemetry/api/propagation-api.mjs';
import { defaultLogger } from './utils/log.mjs';

/**
 * The names, in lower case, of the headers that carry a trace context: those of W3C Trace Context
 * and Baggage, and any other that the propagator the application registered writes. An HTTP
 * instrumentation may add to them or replace them after a request is signed, so a signature must not
 * cover them. A propagator that fails to list its fields adds none.
 */
function traceHeaderNames() {
    const names = new Set(['traceparent', 'tracestate', 'baggage']);
    try {
        for (const name of propagation.fields()) {
            names.add(name.toLowerCase());
        }
    }
    catch (problem) {
        // A signer calls this with no client at hand.
        defaultLogger().debug('could not record telemetry', problem);
    }
    return names;
}

export { traceHeaderNames };
