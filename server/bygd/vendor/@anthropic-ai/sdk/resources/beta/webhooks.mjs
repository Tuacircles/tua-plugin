// Tua-plugin 0.5.15 — bygd av bygg.mjs 2026-11-11. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../core/resource.mjs';
import { distExports } from '../../../../standardwebhooks/index.mjs';

class Webhooks extends APIResource {
    /**
     * Parses a webhook payload into an event without verifying its signature. Prefer
     * `unwrap()` unless you have already verified the signature yourself.
     */
    parseUnverified(body) {
        return JSON.parse(body);
    }
    /**
     * Verifies the webhook signature from the `webhook-id`, `webhook-timestamp` and
     * `webhook-signature` headers using your webhook signing key, then parses the
     * payload into an event. Fails if the signature is missing or invalid.
     */
    unwrap(body, options) {
        const headers = options?.headers;
        if (headers == null)
            throw new Error('Webhook headers are required in order to verify the signature');
        const keyStr = options.key === undefined ? this._client.webhookKey : options.key;
        if (!keyStr)
            throw new Error('Webhook key must not be null or empty in order to unwrap');
        const wh = new distExports.Webhook(keyStr);
        wh.verify(body, headers);
        return JSON.parse(body);
    }
}

export { Webhooks };
