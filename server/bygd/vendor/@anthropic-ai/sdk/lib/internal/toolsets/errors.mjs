// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { AnthropicError } from '../../../core/error.mjs';

/**
 * Thrown when your code uses a toolset's API incorrectly. Catch it to catch all three kinds below.
 *
 * The only exception the tool runner propagates from a member call: anything else a member throws becomes an
 * `is_error` result the model can react to, and the loop continues.
 */
class ToolsetUsageError extends AnthropicError {
    constructor(message, options) {
        super(message);
        this.name = 'ToolsetUsageError';
        if (options && 'cause' in options)
            this.cause = options.cause;
    }
}
/** Misuse of the SDK's own API detected at call time (a `browserState` that threw, a misrouted `tool_use`). */
class ToolsetContractError extends ToolsetUsageError {
    constructor(message, options) {
        super(message, options);
        this.name = 'ToolsetContractError';
    }
}

export { ToolsetContractError, ToolsetUsageError };
