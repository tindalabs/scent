import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let _started = false;

// Service name and version come from OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION env vars.
// No-ops when OTEL_SDK_DISABLED=true or already called (guards against double-init).
// Also executed at module level so `node --import ./dist/tracing.js` works with ESM:
// the SDK registers its hooks before index.js loads Express and other instrumented packages.
export function startTracing(): void {
  if (_started) return;
  _started = true;

  if (process.env['OTEL_SDK_DISABLED'] === 'true') return;

  process.env['OTEL_SERVICE_NAME'] ??= 'scent-server';

  const endpoint =
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: unknown) => {
      // Intentionally console, not the pino logger: this module loads before the
      // SDK starts (so instrumentation can patch other modules), and importing the
      // logger here would load pino too early to be instrumented. This is the one
      // sanctioned console.* in the server — a shutdown-path error on stderr.
      console.error('[tracing] shutdown error:', err);
    });
  });
}

startTracing();
