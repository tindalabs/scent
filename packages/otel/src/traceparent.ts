import { trace } from '@opentelemetry/api';

const INVALID_TRACE_ID = '00000000000000000000000000000000';
const INVALID_SPAN_ID = '0000000000000000';

// Read the W3C traceparent header value from the currently active OTel span.
// Returns null if no active span exists or the trace context is invalid/non-recording.
// Zero-config — works whenever @opentelemetry/api is initialized by the hosting SDK.
export function readTraceparent(): string | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const ctx = span.spanContext();
  if (ctx.traceId === INVALID_TRACE_ID || ctx.spanId === INVALID_SPAN_ID) return null;

  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}
