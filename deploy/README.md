# Deploying Scent on a single VPS

A production stack — server, async-ingest worker, Postgres, Redis, and Caddy
(automatic HTTPS) — on one box, using the prebuilt `tindalabs/scent-server` image.
Sized for something like a Hetzner CX22 (2 vCPU / 4 GB, ~€4/mo).

## Prerequisites

- A VPS with a public IP (Hetzner, Fly, DigitalOcean, …).
- A domain with an **A/AAAA record pointing at the VPS IP** (Caddy needs this
  reachable on :80 before first start to issue the TLS cert).
- Docker Engine + the Compose plugin installed:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## First deploy

```bash
# 1. Get these deploy files onto the box (clone the repo, or scp the deploy/ dir).
git clone https://github.com/tindalabs/scent && cd scent/deploy

# 2. Configure.
cp .env.example .env
# edit .env: set SCENT_DOMAIN, ACME_EMAIL, and a strong POSTGRES_PASSWORD
#   (POSTGRES_PASSWORD=$(openssl rand -hex 24))

# 3. Pull images and start.
docker compose pull
docker compose up -d

# 4. Watch it come up (server runs DB migrations on boot).
docker compose ps
docker compose logs -f scent-server
```

Once healthy, `https://<SCENT_DOMAIN>/health` returns `{"status":"ok"}`.

## Mint an API key

A fresh database has no projects (no demo key in production). API keys are stored
only as a SHA-256 hash, so create one with the helper script — it generates the key,
stores its hash, and prints the plaintext **once** (it cannot be recovered later):

```bash
docker compose exec scent-server node dist/scripts/create-project.js "Production"
# Created project "Production" (id: ...)
# API key (store it now - it is not recoverable):
# 9f2c...   <- the key, on stdout
```

Use that key as the SDK's `apiKey`, pointing it at `https://<SCENT_DOMAIN>/v1`.

Or manage keys from the Observatory: create an admin login, then use the **API Keys**
page (create / rotate / revoke). Bootstrap the first admin with:
```bash
docker compose exec scent-server node dist/scripts/create-admin.js admin@example.com '<password>'
```

The Observatory has no baked-in API key. After logging in, the project switcher in the
sidebar scopes every data page to the selected project — your admin session authorizes
the read, so one login can view all projects.

Verify end to end:
```bash
curl -X POST https://<SCENT_DOMAIN>/v1/resolve \
  -H "X-Api-Key: <your key>" -H "Content-Type: application/json" \
  -d '{"signals":{"canvas.2d":"abc","screen.width":2560}}'
# → identity + confidence + risk JSON
```

## Operations

**Update to the latest image:**
```bash
docker compose pull && docker compose up -d
```
(Pin `SCENT_IMAGE_TAG` in `.env` to a commit SHA for reproducible, rollback-able deploys.)

**Scale the worker** under load (the web tier and worker scale independently):
```bash
docker compose up -d --scale scent-worker=3
```

**Back up Postgres** (cron this, ship off-box):
```bash
docker compose exec -T postgres pg_dump -U scent scent | gzip > scent-$(date +%F).sql.gz
```

**Durability note:** queued-but-unprocessed ingest jobs live in Redis (AOF
persistence is enabled here). Combined with the `event_id` dedupe in the worker,
that gives at-least-once processing across restarts. For stronger guarantees a
Postgres outbox would be the next step.

## Optional: GeoIP (impossible-travel detection)

The `impossible_transition` risk flag — IP geolocation moving faster than a flight
between two observations — needs a City-level GeoIP database. It's off by default.

To enable it: obtain a `.mmdb` with coordinates (MaxMind GeoLite2-City, free with an
account; or DB-IP City Lite), mount it into **both** `scent-server` and `scent-worker`
(the worker runs resolution/risk), and set `GEOIP_DB_PATH` to its in-container path —
e.g. add to each service in `docker-compose.yml`:

```yaml
    volumes:
      - ./GeoLite2-City.mmdb:/data/GeoLite2-City.mmdb:ro
    environment:
      GEOIP_DB_PATH: /data/GeoLite2-City.mmdb
```

Without it, lookups return null and the signal is simply not emitted (no errors).

The related **anonymizer / datacenter** signal (`anonymizer_ip`) works the same way:
mount an Anonymous-IP `.mmdb` and set `GEOIP_ANONYMOUS_DB_PATH` (authoritative —
hosting/VPN/Tor/proxy; a paid MaxMind GeoIP2-Anonymous-IP or equivalent), and
optionally `GEOIP_ASN_DB_PATH` (free GeoLite2-ASN) to name the network operator in
the reason. Both optional; unset = signal off.

## What's intentionally not here

- **Observatory UI** — omitted to keep the box lean; add it behind Caddy later if
  you want the dashboard.
- **OpenTelemetry export** — disabled (`OTEL_SDK_DISABLED=true`). Point
  `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector and flip it off to enable tracing.
