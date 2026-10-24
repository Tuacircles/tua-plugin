// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-24. IKKE REDIGER: kilden er server/*.js og node_modules.
import { AnthropicError } from '../../core/error.mjs';

/**
 * The memory sync cadence, split out of `memories.ts` so runtime-agnostic
 * callers (the environment worker) can validate an interval up front without
 * reaching into the Node-only toolset module.
 */
/**
 * How often (milliseconds) the worker syncs the session's memory stores back
 * while the session runs. Checked after each dispatched tool call.
 */
const DEFAULT_MEMORY_SYNC_INTERVAL_MS = 15000;
/**
 * The shortest sync interval accepted. Each sync lists every attached store,
 * so anything tighter mostly spends requests rediscovering that nothing
 * changed.
 */
const MIN_MEMORY_SYNC_INTERVAL_MS = 5000;
/** Throw unless `ms` is a usable sync interval. `option` names it in the message. */
function checkMemorySyncInterval(ms, option) {
    if (!(ms >= MIN_MEMORY_SYNC_INTERVAL_MS)) {
        throw new AnthropicError(`${option} must be at least ${MIN_MEMORY_SYNC_INTERVAL_MS}ms (got ${ms}); ` +
            'to run without memory sync, pass `memorySyncIntervalMs: null` to the worker instead');
    }
}

export { DEFAULT_MEMORY_SYNC_INTERVAL_MS, MIN_MEMORY_SYNC_INTERVAL_MS, checkMemorySyncInterval };
