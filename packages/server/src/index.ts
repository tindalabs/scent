// Phase 2 will implement the identity engine, event ingestion API, and REST endpoints.
// This stub starts the HTTP server so the Docker Compose dev stack is immediately runnable.

import express from 'express';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', phase: 0 });
});

app.post('/v1/events', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 2' });
});

app.post('/v1/resolve', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 2' });
});

const port = process.env['PORT'] ?? 3000;
app.listen(port, () => {
  console.log(`scent-server listening on :${port}`);
});
