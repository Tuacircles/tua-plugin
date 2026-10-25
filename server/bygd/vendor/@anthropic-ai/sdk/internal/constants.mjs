// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-25. IKKE REDIGER: kilden er server/*.js og node_modules.
// File containing shared constants
/**
 * Model-specific timeout constraints for non-streaming requests
 */
const MODEL_NONSTREAMING_TOKENS = {
    'claude-opus-4@20250514': 8192,
    'anthropic.claude-opus-4-1-20250805-v1:0': 8192,
    'claude-opus-4-1@20250805': 8192,
};

export { MODEL_NONSTREAMING_TOKENS };
