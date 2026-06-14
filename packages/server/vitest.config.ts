import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration suites share one Postgres/Redis. Run files sequentially so they don't
    // race on shared state (e.g. the single-row admin_settings) — namespacing by unique
    // emails/ids isn't enough once global singletons are involved.
    fileParallelism: false,
  },
});
