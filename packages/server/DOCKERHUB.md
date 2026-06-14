# Scent Server

**Probabilistic identity continuity & fraud-signal server.** Scent tracks whether a returning visitor is "likely the same entity" even after cookie deletion, VPN changes, browser updates, or anti-fingerprinting tools — using a drift-tolerant confidence-scoring engine, not deterministic hashes.

This image is the Scent **server**: the ingestion API, probabilistic matching engine (SimHash + weighted Jaccard), drift detection, and risk scoring. Pair it with the [`@tindalabs/scent-sdk`](https://www.npmjs.com/package/@tindalabs/scent-sdk) browser SDK.

- **Source & docs:** https://github.com/tindalabs/scent
- **License:** Business Source License 1.1 (converts to MIT on 2031-06-12). Free for non-commercial self-hosting; commercial hosting-as-a-service is restricted until the change date.

## Tags

- `latest` — most recent build from `main`
- `<sha>` — immutable, pinned to a specific commit

Also published to GitHub Container Registry: `ghcr.io/tindalabs/scent-server`.

## Quick start

The server needs PostgreSQL 14+ (for `bit_count`, used by the SimHash blocking index) and Redis.

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://scent:password@postgres:5432/scent \
  -e REDIS_URL=redis://redis:6379 \
  tindalabs/scent-server:latest
```

Database migrations run automatically on startup. Health check: `GET /health`.

### Async ingest worker

The same image also runs the background worker that drains the ingest queue — override the command:

```bash
docker run \
  -e DATABASE_URL=... -e REDIS_URL=... \
  tindalabs/scent-server:latest \
  node --import ./dist/tracing.js dist/worker.js
```

Run at least one server (web) and one worker against the same Postgres + Redis.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (PG 14+) |
| `REDIS_URL` | yes | Redis connection string (queue + cache + rate limiter) |
| `PORT` | no | HTTP port (default `3000`) |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated production origins allowed by CORS |
| `SCENT_SECRET_KEY` | no | App key (`openssl rand -hex 32`) that encrypts admin TOTP/2FA secrets at rest. Unset = 2FA enrollment disabled (server still runs) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | OTLP collector endpoint for traces |
| `OTEL_SDK_DISABLED` | no | Set `true` to disable OpenTelemetry export |
| `GEOIP_DB_PATH` | no | Path to a City-level GeoIP `.mmdb` (with lat/lon) to enable impossible-travel detection; unset = signal disabled |
| `GEOIP_ANONYMOUS_DB_PATH` | no | Path to an Anonymous-IP `.mmdb` (hosting/VPN/Tor/proxy) to enable the anonymizer/datacenter signal; unset = disabled |
| `GEOIP_ASN_DB_PATH` | no | Path to an ASN `.mmdb` (e.g. GeoLite2-ASN); enriches the anonymizer reason with the network operator |

For a full local stack (Postgres, Redis, Observatory UI, Grafana Tempo), use the `docker-compose.yml` in the repository.
