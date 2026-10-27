// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-27. IKKE REDIGER: kilden er server/*.js og node_modules.
import { SpanKind } from '../../../../../@opentelemetry/api/trace/span_kind.mjs';
import { SpanStatusCode } from '../../../../../@opentelemetry/api/trace/status.mjs';
import { context } from '../../../../../@opentelemetry/api/context-api.mjs';
import { trace } from '../../../../../@opentelemetry/api/trace-api.mjs';
import { ATTR_GEN_AI_PROVIDER_NAME, setErrorStatus, guardTracing } from '../../../internal/tracing.mjs';

/**
 * Starts the span of `work`, a Work item that the work poller just claimed, under `parentContext`:
 * the context of whoever asked the poller for the item.
 */
function startEnvironmentWorkSpan(client, work, parentContext) {
    return client._tracer?.startSpan('anthropic.environment.work', {
        kind: SpanKind.INTERNAL,
        attributes: {
            [ATTR_GEN_AI_PROVIDER_NAME]: client._genAIProviderName,
            'anthropic.environment.id': work.environment_id,
            'anthropic.environment.work.id': work.id,
            'anthropic.session.id': work.data.id,
        },
    }, parentContext);
}
/**
 * Ends the span of a Work item that is finished with as `OK`. The status stays unset when `signal`,
 * the work poller's, was aborted first: the item was then neither finished with nor failed.
 */
function endEnvironmentWorkSpan(span, signal) {
    if (!span?.isRecording()) {
        return;
    }
    if (!signal.aborted) {
        span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
}
/**
 * Ends the span of a Work item whose handling failed with `error`. The status stays unset when
 * `signal`, the work poller's, was aborted first, or `error` is such an abort.
 */
function failEnvironmentWorkSpan(span, signal, error) {
    if (!span?.isRecording()) {
        return;
    }
    if (!signal.aborted) {
        setErrorStatus(span, error);
    }
    span.end();
}
/**
 * Runs `handle`, the environment worker's handling of a Work item, with the item's span current,
 * and ends the span with how that went.
 */
async function withEnvironmentWorkSpan(client, span, signal, handle) {
    if (!span) {
        return handle();
    }
    try {
        await context.with(trace.setSpan(context.active(), span), handle);
    }
    catch (error) {
        guardTracing(client, () => failEnvironmentWorkSpan(span, signal, error));
        throw error;
    }
    guardTracing(client, () => endEnvironmentWorkSpan(span, signal));
}

export { endEnvironmentWorkSpan, failEnvironmentWorkSpan, startEnvironmentWorkSpan, withEnvironmentWorkSpan };
