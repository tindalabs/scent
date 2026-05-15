# Scent Server — REST API Reference

Base URL: `http://localhost:3000/v1` (dev default). Configure via the `BASE_URL` environment variable in production.

---

## Authentication

All `/v1/*` routes require an `X-Api-Key` header:

```http
X-Api-Key: <your-api-key>
```

To obtain an API key:
- **Observatory**: Project Settings → API Keys → Create Key
- **Dev stack**: use `demo-api-key-dev` (pre-seeded, all permissions)

Requests missing a valid key return `401`.

---

## Rate Limits

100 requests per minute per API key, enforced via a Redis token bucket. Applies to all `/v1/*` routes. The `GET /health` endpoint is exempt.

Responses include the following headers on every `/v1/*` request:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1746300420
```

When the limit is exceeded the server responds with `429` before the request reaches the handler.

---

## Error Responses

All errors follow a consistent shape.

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "Invalid payload", "details": [...] }` | Zod validation failure — `details` lists each failing field |
| 401 | `{ "error": "Unknown API key" }` | Missing or unrecognized `X-Api-Key` |
| 429 | `{ "error": "Rate limit exceeded" }` | Token bucket exhausted for this key |

---

## Ingestion

### POST /v1/events

Ingest a batch of snapshots from the SDK. The engine resolves each snapshot against stored identity candidates, updates persistence layers, and returns a confidence result per snapshot.

**Idempotency**: re-submitting a snapshot with the same `identityId` + `timestamp` is a no-op. The server returns the stored result without re-running the matching pipeline.

**Request body**

```json
{
  "snapshots": [
    {
      "identityId": "550e8400-e29b-41d4-a716-446655440000",
      "signals": {
        "canvas.hash": "a3f9c1...",
        "webgl.renderer": "ANGLE (Intel, ...)",
        "screen.resolution": "1920x1080"
      },
      "persistencePolicy": "balanced",
      "timestamp": "2026-01-01T00:00:00Z",
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    }
  ]
}
```

`traceparent` is optional (W3C Trace Context format). When present it is stored and propagated to drift timeline events, enabling correlation with frontend OTel spans.

Valid `persistencePolicy` values: `conservative`, `balanced`, `aggressive`, `forensic`.

**Response**

```json
{
  "results": [
    {
      "identityId": "550e8400-e29b-41d4-a716-446655440000",
      "confidence": 0.87,
      "isNew": false,
      "continuity": "confirmed",
      "risk": {
        "score": 0.12,
        "band": "low",
        "flags": []
      },
      "ambiguous": false
    }
  ]
}
```

`ambiguous` is `true` when two candidates both scored above `0.60`. The caller should treat this as an uncertain match and avoid merging clusters automatically.

`continuity` values: `confirmed`, `probable`, `uncertain`, `new`.

---

### POST /v1/resolve

Evaluate a single snapshot and return identity and confidence without writing to the store. Intended for login-time risk checks where a permanent record would be premature or undesirable.

The request body is a single snapshot object (not an array):

```json
{
  "identityId": "550e8400-e29b-41d4-a716-446655440000",
  "signals": {
    "canvas.hash": "a3f9c1...",
    "webgl.renderer": "ANGLE (Intel, ...)"
  },
  "persistencePolicy": "balanced",
  "timestamp": "2026-01-01T00:00:00Z"
}
```

**Response** — same shape as a single item in `/v1/events` results:

```json
{
  "identityId": "550e8400-e29b-41d4-a716-446655440000",
  "confidence": 0.91,
  "isNew": false,
  "continuity": "confirmed",
  "risk": {
    "score": 0.08,
    "band": "low",
    "flags": []
  },
  "ambiguous": false
}
```

---

## Identity

### GET /v1/identity/:id

Full record for a single identity.

**Response**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "firstSeen": "2026-01-01T00:00:00Z",
  "lastSeen": "2026-05-15T09:42:11Z",
  "confidenceBand": "confirmed",
  "riskBand": "low",
  "snapshotCount": 42,
  "clusterId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "riskScore": 0.12,
  "riskFlags": []
}
```

`confidenceBand` values: `confirmed`, `probable`, `uncertain`, `unknown`.

`riskBand` values: `low`, `medium`, `high`, `critical`.

`clusterId` is `null` when the identity has not been merged into any cluster.

---

### GET /v1/identity/:id/timeline

Ordered drift history for an identity, newest first.

**Response**

```json
{
  "events": [
    {
      "id": "b1e2c3d4-...",
      "timestamp": "2026-05-15T09:42:11Z",
      "classification": "minor",
      "entropy": 0.04,
      "changedSignals": ["screen.resolution"],
      "addedSignals": [],
      "removedSignals": [],
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    }
  ]
}
```

`classification` values: `minor`, `moderate`, `significant`, `suspicious`.

`traceparent` is `null` when the originating snapshot did not include a W3C trace context.

---

### GET /v1/identity/:id/signals

Current signal profile with stability and weight metadata.

**Response**

```json
{
  "signals": {
    "canvas.hash": {
      "value": "a3f9c1...",
      "stability": "highly_stable",
      "weight": 0.9,
      "lastChanged": "2026-01-01T00:00:00Z"
    },
    "screen.resolution": {
      "value": "1920x1080",
      "stability": "moderately_stable",
      "weight": 0.55,
      "lastChanged": "2026-05-14T08:11:00Z"
    }
  }
}
```

`stability` values: `highly_stable`, `moderately_stable`, `volatile`. Weights decay between observations; values shown reflect the current effective weight at query time.

---

## Discovery

### GET /v1/identities

Paginated list of all identities.

**Query parameters**

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `page` | integer | `1` | |
| `limit` | integer | `20` | Max `100` |
| `sort` | string | `last_seen` | `last_seen`, `first_seen`, `snapshot_count` |
| `search` | string | — | Filters by identity ID prefix |

**Response**

```json
{
  "identities": [
    {
      "id": "550e8400-...",
      "firstSeen": "2026-01-01T00:00:00Z",
      "lastSeen": "2026-05-15T09:42:11Z",
      "confidenceBand": "confirmed",
      "riskBand": "low",
      "snapshotCount": 42
    }
  ],
  "total": 1840,
  "page": 1,
  "pages": 92
}
```

---

### GET /v1/clusters/:id

Detail for a single identity cluster with all member identities.

**Response**

```json
{
  "cluster": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "createdAt": "2026-03-10T14:22:00Z",
    "reason": "high_overlap_signals"
  },
  "members": [
    {
      "identityId": "550e8400-...",
      "mergeConfidence": 0.94,
      "addedAt": "2026-03-10T14:22:00Z"
    }
  ]
}
```

---

## System

### GET /v1/dashboard

Summary metrics for the Observatory UI. Intended for internal dashboards; subject to caching (TTL 60 s in production).

**Response**

```json
{
  "totalIdentities": 1840,
  "newToday": 34,
  "highRiskCount": 7,
  "avgConfidenceBand": "confirmed",
  "riskDistribution": [
    { "band": "low", "count": 1790 },
    { "band": "medium", "count": 43 },
    { "band": "high", "count": 6 },
    { "band": "critical", "count": 1 }
  ],
  "driftRateTrend": [
    { "date": "2026-05-14", "count": 112 },
    { "date": "2026-05-15", "count": 98 }
  ]
}
```

---

### GET /health

Health check. No authentication required.

**Response**

```json
{
  "status": "ok",
  "phase": 6
}
```

`phase` reflects the current implementation phase from the project roadmap.
