// Tua-plugin 0.5.13 — bygd av bygg.mjs 2026-11-03. IKKE REDIGER: kilden er server/*.js og node_modules.
import { APIResource } from '../../core/resource.mjs';
import { PageCursor } from '../../core/pagination.mjs';
import { startApiCallSpan } from '../../internal/tracing.mjs';

class RateLimits extends APIResource {
    /**
     * List Messages API rate limits for your organization.
     *
     * Each entry corresponds to one rate-limit group (either a model family or an
     * API-surface category such as the Message Batches API or the web search tool) and
     * contains the set of limiter values that apply to it.
     *
     * When `limit` is omitted, every matching entry is returned in a single page; when
     * `limit` truncates the result, follow `next_page` to fetch the remaining entries.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const organizationRateLimit of client.organization.rateLimits.list()) {
     *   // ...
     * }
     * ```
     */
    list(query = {}, options) {
        return this._client.getAPIList('/v1/organizations/rate_limits', (PageCursor), {
            query,
            ...options,
            __span: startApiCallSpan(this._client, 'anthropic.organization.rate_limits.list', options, {
                route: '/v1/organizations/rate_limits',
                queryParams: ['group_type', 'limit', 'model', 'page'],
            }),
        });
    }
}

export { RateLimits };
