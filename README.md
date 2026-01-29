# NexArt Canonical Renderer

Hosted verification, attestation, and replay services built on the NexArt CodeMode SDK. This server-side node provides deterministic execution of Code Mode artworks for minting, verification, and on-chain attestation.

## What This Server Is

- **Hosted verification API** for third-party trust
- **Attestation service** producing cryptographically verifiable outputs
- **Replay service** for re-executing snapshots with identical results
- **Ground truth** for minted artwork appearance (when NexArt-operated)

## What This Server Is NOT

- **Not required for local execution** - The SDK/CLI handles that
- **Not a replacement for the SDK** - This service uses the SDK internally
- **Not a frontend application** or preview renderer
- **Not a development environment** for artists

## Core vs Edges

| Layer | Component | Cost | Purpose |
|-------|-----------|------|---------|
| **Core** | `@nexart/codemode-sdk` | Free | Deterministic primitives (PRNG, noise) |
| **Core** | `nexart-cli` | Free | Local rendering, snapshot creation |
| **Edge** | This Node (self-hosted) | Free | Self-hosted verification |
| **Edge** | This Node (NexArt-operated) | Paid* | "NexArt Attested" signatures, SLAs |

*Monetization via accounts/quotas/SLAs when operated by NexArt. Self-hosting is always free.

### Attestation Types

- **NexArt Attested**: Rendered/verified by NexArt infrastructure. Recognized for official on-chain records.
- **Self Attested**: Rendered by self-hosted node or local CLI. Cryptographically identical, but no NexArt signature.

## Authority Chain

```
NexArt Protocol Specification
        ↓
@nexart/codemode-sdk (single source of truth)
        ↓
Canonical Renderer (this repository)
        ↓
Applications (NexArt, ByX, third parties)
```

The SDK is the single source of truth for deterministic primitives. All compliant renderers must use it.

## Quickstart (Development)

```bash
# Clone and install
git clone https://github.com/nexart/nexart-canonical-renderer.git
cd nexart-canonical-renderer
npm install

# Set environment (optional)
export GIT_SHA=$(git rev-parse --short HEAD)

# Run locally
npm run dev

# Test endpoints
curl http://localhost:5000/health
curl http://localhost:5000/version
```

## Versioning & Reproducibility

### SDK Pinning

This server pins `@nexart/codemode-sdk` to an **exact version**:

```json
"@nexart/codemode-sdk": "1.8.4"
```

No `^` or `~` ranges. This ensures:
- Reproducible builds across deployments
- Auditable dependency chain
- No surprise behavior changes

### Version Visibility

Every verification/attestation response includes version metadata:

```json
{
  "metadata": {
    "sdk_version": "1.8.4",
    "protocol_version": "1.2.0",
    "node_version": "1.0.0"
  }
}
```

Use `GET /version` for complete version info including build SHA.

### Reproducing Results Locally

If you have a snapshot created by the CLI:
1. Install the same SDK version locally
2. Run the snapshot through the CLI
3. Compare the SHA-256 hash - it must match

The Node server is optional; it provides hosted third-party trust when run by NexArt.

## Protocol Invariants

- **Canvas**: 1950 x 2400 pixels (immutable)
- **Determinism**: Identical inputs produce identical outputs
- **VAR Array**: 10 elements, range 0-100
- **Hashing**: SHA-256 of raw output bytes
- **SDK**: All random/noise operations via `@nexart/codemode-sdk`

## Protocol Version Handling

The renderer supports explicit protocol version pinning with lenient defaulting for integration safety.

**If `protocolVersion` is omitted, the renderer resolves it to the current canonical protocol version and records that resolution as part of the execution proof.**

### Resolution Behavior

| Request `protocolVersion` | Resolution | Headers | Audit |
|---------------------------|------------|---------|-------|
| Omitted | Default (currently `1.2.0`) | `X-Protocol-Version: 1.2.0`, `X-Protocol-Defaulted: true` | Recorded as defaulted |
| `"1.2.0"` (valid) | Use provided | `X-Protocol-Version: 1.2.0` | Recorded as explicit |
| `"9.9.9"` (invalid) | Hard failure | 400 error | Logged as validation error |

### Response Headers

- `X-Protocol-Version`: The resolved protocol version used for execution (always present)
- `X-Protocol-Defaulted: true`: Present only when version was resolved from server default

### JSON Response

When requesting JSON output, the response includes:

```json
{
  "protocolVersion": "1.2.0",
  "protocolVersionSource": "defaulted"
}
```

The `protocolVersionSource` field is:
- `"request"` — version was explicitly provided in the request
- `"defaulted"` — version was resolved from server default

### Examples

```bash
# Without protocolVersion (defaulted)
curl -D - -X POST http://localhost:5000/api/render \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code": "function setup() { background(100); }"}' \
  -o /dev/null 2>&1 | grep -i "x-protocol"
# X-Protocol-Version: 1.2.0
# X-Protocol-Defaulted: true

# With explicit protocolVersion
curl -D - -X POST http://localhost:5000/api/render \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code": "function setup() { background(100); }", "protocolVersion": "1.2.0"}' \
  -o /dev/null 2>&1 | grep -i "x-protocol"
# X-Protocol-Version: 1.2.0
# (no X-Protocol-Defaulted header)

# With invalid protocolVersion (hard failure)
curl -X POST http://localhost:5000/api/render \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code": "function setup() { background(100); }", "protocolVersion": "9.9.9"}'
# {"error":"PROTOCOL_VIOLATION","message":"Unsupported protocol version: 9.9.9. Supported: 1.0.0, 1.1.0, 1.2.0"}
```

### CLI vs API Behavior

The `nexart-cli` always injects an explicit `protocolVersion` into requests. CLI users never rely on defaulting behavior.

Defaulting exists for:
- API integrations that may not track protocol versions
- Backward compatibility with older clients
- Integration safety during SDK upgrades

All defaulted executions are explicitly marked and logged for auditability.

## Execution Modes

**Static**: Executes `setup()` + `draw()` once, returns PNG.

**Loop**: Executes `setup()` + `draw()` for N frames, returns MP4. Fails if `draw()` is absent.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node status |
| `/version` | GET | Full version info (SDK, protocol, build) |
| `/render` | POST | Dev only - disabled in production (410 Gone) |
| `/api/render` | POST | **Metered endpoint** - CLI contract with API key auth |
| `/verify` | POST | Re-execute, compare against expected hash |

> **Note:** `/api/render` is the only metered render endpoint. Use it with `Authorization: Bearer <api_key>`. The legacy `/render` endpoint returns 410 Gone in production.

### GET /version

Returns complete version information for auditing:

```bash
curl http://localhost:5000/version
```

```json
{
  "service": "nexart-node",
  "serviceVersion": "0.1.0",
  "sdkVersion": "1.8.4",
  "sdkDependency": "1.8.4",
  "protocolVersion": "1.2.0",
  "serviceBuild": "abc1234",
  "nodeVersion": "v20.x.x",
  "timestamp": "2025-01-25T..."
}
```

### POST /api/render (CLI Contract)

This endpoint is designed for CLI compatibility (nexart-cli v0.2.1+):

**Request:**
```bash
curl -X POST http://localhost:5000/api/render \
  -H "Content-Type: application/json" \
  -d '{
    "code": "function setup() { background(50); ellipse(width/2, height/2, 200); }",
    "seed": "my-seed",
    "VAR": [50, 25, 0, 0, 0, 0, 0, 0, 0, 0],
    "width": 1950,
    "height": 2400,
    "protocolVersion": "1.2.0"
  }' \
  --output render.png
```

**Response (default):** Binary PNG with headers:
- `Content-Type: image/png`
- `X-Runtime-Hash: <sha256>`
- `X-SDK-Version: 1.8.4`
- `X-Protocol-Version: 1.2.0`

**Response (JSON):** Add `Accept: application/json` header:
```json
{
  "pngBase64": "<base64-encoded-png>",
  "runtimeHash": "<sha256>",
  "width": 1950,
  "height": 2400,
  "sdkVersion": "1.8.4",
  "protocolVersion": "1.2.0",
  "executionTimeMs": 123
}
```

**Notes:**
- `width` and `height` are validated but must match protocol (1950x2400)
- `VAR` is an array of 10 values (0-100 range)
- If `VAR` is omitted, defaults to `[0,0,0,0,0,0,0,0,0,0]`

### Verification

The `/verify` endpoint supports both static and loop mode verification:

- **Static**: Provide `expectedHash` (SHA-256 of PNG bytes)
- **Loop**: Provide both `expectedAnimationHash` AND `expectedPosterHash`

For loop mode, `verified: true` requires all provided hashes to match.

### CORS

The server allows cross-origin requests from any origin (`*`) to support browser clients.

```bash
curl -I -X OPTIONS http://localhost:5000/health \
  -H "Origin: https://example.lovable.app" \
  -H "Access-Control-Request-Method: POST"
```

## Authentication & Metering (Phase 1)

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `ADMIN_SECRET` | Yes | - | Secret for admin endpoints |
| `METERING_REQUIRED` | No | `true` in production | If `false`, allows renders when DB unavailable (skips logging) |
| `PROTOCOL_VERSION` | No | `1.2.0` | Default protocol version for requests without explicit version |

**METERING_REQUIRED behavior:**
- `true` (default in production): If DB is unavailable, `/api/render` returns 503
- `false`: If DB is unavailable, renders proceed but usage is not logged. Response includes header `X-NexArt-Metering: skipped`

### API Key Authentication

The `/api/render` endpoint requires an API key. Pass it via the `Authorization` header:

```bash
curl -X POST http://localhost:5000/api/render \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code": "function setup() { background(100); }", "seed": "test"}'
```

**Without a valid API key, you get a 401 response:**
```json
{
  "error": "UNAUTHORIZED",
  "message": "Missing or invalid Authorization header. Use: Authorization: Bearer <api_key>"
}
```

### Creating an API Key

1. Generate a random API key:
```bash
API_KEY=$(openssl rand -hex 32)
echo "API Key: $API_KEY"
```

2. Hash it with SHA-256:
```bash
KEY_HASH=$(echo -n "$API_KEY" | shasum -a 256 | cut -d' ' -f1)
echo "Key Hash: $KEY_HASH"
```

3. Insert into the database:
```sql
INSERT INTO api_keys (key_hash, label, plan, status, monthly_limit)
VALUES ('YOUR_KEY_HASH', 'My App', 'free', 'active', 1000);
```

### Usage Logging

Every `/api/render` request is logged to `usage_events`:
- `api_key_id`: Which key made the request
- `endpoint`, `status_code`, `duration_ms`
- `width`, `height`, `sdk_version`, `protocol_version`
- `protocol_defaulted`: Boolean indicating if version was defaulted
- `runtime_hash`, `output_hash_prefix`
- `error`: Error message if any

### Admin Endpoints

Admin endpoints require the `X-Admin-Secret` header:

**GET /admin/usage/today** - Today's usage grouped by API key and endpoint:
```bash
curl http://localhost:5000/admin/usage/today \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET"
```

**GET /admin/usage/month** - This month's usage:
```bash
curl http://localhost:5000/admin/usage/month \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET"
```

**Response format:**
```json
{
  "period": "today",
  "date": "2026-01-25",
  "usage": [
    {
      "api_key_id": 1,
      "endpoint": "/api/render",
      "count": "42",
      "success_count": "40",
      "error_count": "2",
      "avg_duration_ms": 150
    }
  ],
  "total": 42
}
```

### Database Schema

**api_keys:**
```sql
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    plan VARCHAR(50) NOT NULL DEFAULT 'free',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    monthly_limit INTEGER DEFAULT 1000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**usage_events:**
```sql
CREATE TABLE usage_events (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    api_key_id INTEGER REFERENCES api_keys(id),
    endpoint VARCHAR(100) NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    sdk_version VARCHAR(20),
    protocol_version VARCHAR(20),
    runtime_hash VARCHAR(64),
    output_hash_prefix VARCHAR(16),
    error TEXT
);
```

## Who Should Use This

- Platform operators running NexArt-compatible minting infrastructure
- Protocol developers building verification or indexing services
- Third-party integrators requiring canonical execution

Artists and collectors use applications that call this service on their behalf.

## Protocol Compliance

A renderer is **NexArt Protocol Compliant** if:

1. Uses `@nexart/codemode-sdk` as the sole source of deterministic primitives
2. Enforces all protocol invariants without exception
3. Produces byte-identical outputs for identical inputs
4. Does not introduce alternative execution paths or fallbacks

Forks are **not** compliant by default.

## Version Information

| Component | Version |
|-----------|---------|
| Service | 0.1.0 |
| SDK | 1.8.4 (exact pin) |
| Protocol | 1.2.0 |

## Deployment

```bash
# Development
npm run dev

# Production (Docker)
docker build -t nexart-canonical .
docker run -p 5000:5000 -e GIT_SHA=$(git rev-parse --short HEAD) nexart-canonical

# Production (Railway)
# GIT_SHA is auto-set via RAILWAY_GIT_COMMIT_SHA
```

## Documentation

- [Architecture: Core vs Edges](docs/architecture.md)

## License

See LICENSE file.

---

This is a protocol implementation. For user-facing applications, see [NexArt](https://nexart.app) or [ByX](https://byx.art).
