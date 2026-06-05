import { pino } from 'pino';

// Structured JSON logger for the server.
//
// Level comes from LOG_LEVEL (default 'info'); tests run 'silent' so suite output
// stays clean. JSON-to-stdout is the right shape for the container / OTel-collector
// setup — pipe through `pino-pretty` locally for human-readable output.
//
// The OpenTelemetry auto-instrumentation (instrumentation-pino) patches pino to
// inject trace_id/span_id into every log line — but only if pino is required AFTER
// the SDK starts. Hence this module is imported only after `./tracing.js`, and
// tracing.ts deliberately does NOT import it (see the comment there).
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'test' ? 'silent' : 'info'),
  base: { service: process.env['OTEL_SERVICE_NAME'] ?? 'scent-server' },
});
