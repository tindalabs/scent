import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Initialise once, before any Express/postgres/redis code runs.
// Service name and version are read from OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION
// environment variables (set them in docker-compose or your shell).
// No-ops when OTEL_SDK_DISABLED=true; the server still starts normally.
export function startTracing(): void {
  if (process.env['OTEL_SDK_DISABLED'] === 'true') return;

  // Ensure a predictable service name in local dev — env var still wins when set (e.g. docker-compose).
  process.env['OTEL_SERVICE_NAME'] ??= 'scent-server';

  const endpoint =
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Avoid noisy file-system spans from ts-node / module resolution.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: unknown) => {
      console.error('[tracing] shutdown error:', err);
    });
  });
}
