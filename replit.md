# NexArt Canonical Node

## Overview

A server-side canonical execution node for the NexArt protocol. This node is the authoritative, deterministic execution environment for NexArt Code Mode.

**This node is NOT:**
- A frontend app
- A preview renderer
- A convenience wrapper

**This node IS:**
- An attestation service
- The ground truth for minting and verification
- Protocol-compliant execution only

## Authority

`@nexart/codemode-sdk` is the single source of truth for Code Mode semantics.

The node uses the SDK directly via `createP5Runtime()`:
- Mulberry32 seeded PRNG for `random()`
- Seeded Perlin noise for `noise()`
- Color parsing, HSB/RGB conversion
- Core drawing primitives

## Architecture

```
SDK (createP5Runtime)     →  Core deterministic primitives
       ↓
p5-extensions.js          →  Missing p5.js methods (strokeCap, rectMode, etc.)
       ↓
server.js / render-loop.js  →  Request handling, video encoding
```

The SDK is imported via `createRequire()` workaround due to ESM compatibility issues with the package's restrictive exports.

## Protocol Invariants

- Canvas: **1950×2400** (hard-locked, non-configurable)
- Determinism: Same input = Same output (SHA-256 verified)
- VAR: 10 elements, range 0-100

## Execution Modes

### Static Mode
- Executes `setup()` only
- Returns PNG image
- Response: `{ type: "static", mime: "image/png", imageHash, imageBase64 }`

### Loop Mode
- Executes `setup()` once, then `draw()` N times
- Returns MP4 video
- Requires: `execution.mode === "loop"` AND `execution.totalFrames >= 2`
- Response: `{ type: "animation", mime: "video/mp4", animationHash, animationBase64, posterHash, posterBase64, frames, width, height }`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node status with version info |
| `/ready` | GET | Readiness check for Railway (DB ping + env validation) |
| `/version` | GET | Full version info (SDK, protocol, build) |
| `/render` | POST | Execute snapshot (static or loop) |
| `/api/render` | POST | CLI contract - static render (code, seed, VAR) |
| `/api/attest` | POST | AI CER attestation (API key required) |
| `/verify` | POST | Verify execution against expected hash |

## Render Endpoint

### Static Mode Request
```json
POST /render
Content-Type: application/json

{
  "code": "function setup() { background(100); ellipse(width/2, height/2, 200); }",
  "seed": "unique-seed-string",
  "vars": [50, 75, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

### Static Mode Response
```json
{
  "type": "static",
  "mime": "image/png",
  "imageHash": "<sha256>",
  "imageBase64": "<png-bytes>",
  "metadata": {
    "sdk_version": "1.8.4",
    "protocol_version": "1.0.0",
    "node_version": "1.0.0",
    "canvas": { "width": 1950, "height": 2400 },
    "execution_time_ms": 123,
    "timestamp": "2025-01-01T00:00:00.000Z",
    "isLoopMode": false
  }
}
```

### Loop Mode Request
```json
POST /render
Content-Type: application/json

{
  "code": "function setup() { background(50); } function draw() { fill(random(255)); ellipse(random(width), random(height), 100); }",
  "seed": "unique-seed-string",
  "vars": [50, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "execution": {
    "mode": "loop",
    "totalFrames": 120,
    "fps": 30
  }
}
```

### Loop Mode Response
```json
{
  "type": "animation",
  "mime": "video/mp4",
  "imageHash": "<sha256>",
  "imageBase64": "<png-bytes>",
  "animationBase64": "<mp4-bytes>",
  "animationHash": "<sha256>",
  "posterBase64": "<png-bytes>",
  "posterHash": "<sha256>",
  "frames": 120,
  "width": 1950,
  "height": 2400,
  "fps": 30,
  "metadata": {
    "sdk_version": "1.8.4",
    "protocol_version": "1.0.0",
    "node_version": "1.0.0",
    "canvas": { "width": 1950, "height": 2400 },
    "execution_time_ms": 5000,
    "timestamp": "2025-01-01T00:00:00.000Z",
    "isLoopMode": true
  }
}
```

## Attest Endpoint

Provides integrity attestation for CER bundles. Supports two bundle types:

1. **Code Mode bundles** — Existing behavior. Verification uses the node's own canonical JSON hashing logic. Hash format is raw hex (`<64-char-hex>`).
2. **AI Execution CER bundles** (`bundleType === "cer.ai.execution.v1"`) — Verification is canonical to the `@nexart/ai-execution` NPM package (calls `verifyCer(bundle)`). Hash format is `sha256:<hex>`.

### Code Mode Bundle Request
```json
POST /api/attest
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "bundleType": "cer.codemode.v1",
  "version": "1.0.0",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "snapshot": {
    "code": "function setup() { background(100); }",
    "seed": "unique-seed",
    "vars": [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  "inputHash": "<64-char-hex>",
  "certificateHash": "<64-char-hex>"
}
```

### AI CER Bundle Request
```json
POST /api/attest
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "bundleType": "cer.ai.execution.v1",
  "version": "0.1",
  "createdAt": "2026-02-13T13:13:33.112Z",
  "snapshot": {
    "type": "ai.execution.v1",
    "protocolVersion": "1.2.0",
    "executionSurface": "ai",
    "executionId": "exec_c7093dd242d4b87c",
    "timestamp": "2026-02-13T13:13:33.111Z",
    "provider": "openai",
    "model": "gpt-4o",
    "modelVersion": null,
    "prompt": "You are a helpful assistant.",
    "input": "Summarize the key risks in Q4 earnings.",
    "inputHash": "sha256:<hex>",
    "parameters": { "temperature": 0, "maxTokens": 1024, "topP": null, "seed": null },
    "output": "Key risks identified: ...",
    "outputHash": "sha256:<hex>",
    "sdkVersion": "0.1.0",
    "appId": "nexart.io-demo"
  },
  "certificateHash": "sha256:<hex>",
  "meta": { "source": "nexart.io", "tags": ["demo"] }
}
```

### Success Response (200)
```json
{
  "ok": true,
  "bundleType": "cer.ai.execution.v1",
  "certificateHash": "sha256:<hex>",
  "attestation": {
    "attestedAt": "2025-01-01T00:00:00.000Z",
    "attestationId": "<uuid>",
    "bundleType": "cer.ai.execution.v1",
    "certificateHash": "sha256:<hex>",
    "nodeRuntimeHash": "<64-char-hex>",
    "protocolVersion": "1.2.0",
    "requestId": "<uuid>",
    "verified": true,
    "checks": ["snapshot_hashes", "certificate_hash"]
  }
}
```

### AI CER Required Fields

The following fields are validated before `verifyCer()` is called. Missing or malformed fields return `400 INVALID_BUNDLE` with a `details` array:

| Field | Requirement |
|-------|-------------|
| `bundleType` | Must equal `"cer.ai.execution.v1"` |
| `version` | Required, string (e.g. `"0.1"`) |
| `createdAt` | Required, valid ISO date string |
| `certificateHash` | Required, format `sha256:<64-hex-chars>` |
| `snapshot` | Required, must be an object |

### Error Responses
- **400** `INVALID_BUNDLE` — Bundle validation failed (mismatched hashes, missing fields, invalid format). Returns `details` array with readable error messages.
- **401** `UNAUTHORIZED` — Missing or invalid API key
- **429** `QUOTA_EXCEEDED` — Monthly quota exceeded (attestations share quota with renders)

Example 400 response (missing fields):
```json
{
  "error": "INVALID_BUNDLE",
  "details": [
    "version is required and must be a string (e.g. \"0.1\")",
    "createdAt is required and must be an ISO date string"
  ]
}
```

### Quota
Successful attestations count toward the same monthly quota as `/api/render`. Response includes `X-Quota-Limit`, `X-Quota-Used`, `X-Quota-Remaining` headers.

## Verify Endpoint

### Static Mode Verification
```json
POST /verify
Content-Type: application/json

{
  "snapshot": {
    "code": "function setup() { background(100); }",
    "seed": "...",
    "vars": [...]
  },
  "expectedHash": "<sha256>"
}
```

**Response:**
```json
{
  "verified": true,
  "mode": "static",
  "computedHash": "<sha256>",
  "expectedHash": "<sha256>",
  "protocolCompliant": true,
  "metadata": { ... }
}
```

### Loop Mode Verification
```json
POST /verify
Content-Type: application/json

{
  "snapshot": {
    "code": "function setup() { background(50); } function draw() { ellipse(random(width), random(height), 100); }",
    "seed": "...",
    "vars": [...],
    "execution": { "mode": "loop", "totalFrames": 60, "fps": 30 }
  },
  "expectedAnimationHash": "<sha256-of-mp4>",
  "expectedPosterHash": "<sha256-of-first-frame-png>"
}
```

**Response:**
```json
{
  "verified": true,
  "mode": "loop",
  "computedAnimationHash": "<sha256>",
  "computedPosterHash": "<sha256>",
  "expectedAnimationHash": "<sha256>",
  "expectedPosterHash": "<sha256>",
  "animationVerified": true,
  "posterVerified": true,
  "protocolCompliant": true,
  "metadata": { "frames": 60, "fps": 30, ... }
}
```

**Backward Compatibility:** If only `expectedHash` is provided for loop mode, it checks against both posterHash and animationHash. Response includes `animationVerified`, `posterVerified`, and `hashMatchType` to indicate which matched. Note: `verified` will only be `true` if BOTH hashes match the provided `expectedHash` (extremely rare). For proper loop verification, always provide both `expectedAnimationHash` AND `expectedPosterHash`.

## Version Info

- Service Version: from `package.json` (currently 0.2.1)
- SDK Version: 1.8.4
- Protocol Version: 1.2.0
- Service Build: git SHA (from `GIT_SHA` or `RAILWAY_GIT_COMMIT_SHA` env, otherwise "unknown")

## Authentication & Metering

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (auto-configured in Replit)
- `ADMIN_SECRET`: Secret for admin endpoints
- `METERING_REQUIRED`: If `false`, allows renders when DB unavailable
- `ENFORCE_QUOTA`: If `false`, disables quota enforcement (kill switch). Default: `true` in production, `false` in development

### API Key Auth
- `/api/render` requires `Authorization: Bearer <api_key>`
- Keys are SHA-256 hashed and stored in `api_keys` table
- Usage is logged to `usage_events` table

### Account-Level Quota Enforcement
- Quota is enforced per account (`user_id`), not per API key
- All API keys for same user share the monthly quota
- `accounts.monthly_limit` controls quota (default: 100)
- Successful renders (2xx on `/api/render`) count toward quota
- When exceeded: 429 response with `X-Quota-*` headers

### Response Headers
- `X-Quota-Limit`: Account's monthly limit
- `X-Quota-Used`: Renders used this month
- `X-Quota-Remaining`: Renders remaining

### Admin Endpoints
- `GET /admin/usage/today` - Today's usage (requires ADMIN_SECRET)
- `GET /admin/usage/month` - This month's usage (requires ADMIN_SECRET)

## Deployment

The node is configured for Railway deployment via Dockerfile.

```bash
npm run dev    # Development (Replit)
npm start      # Production (Railway)
```

### Railway Configuration
- **Health check path**: `/ready`
- **Replicas**: Can safely scale to N+1 replicas
- **Graceful shutdown**: 15s drain timeout on SIGTERM/SIGINT

### Scaling Guardrail (pool.max)
- `pool.max` is set to 10 connections per replica
- 2 replicas can open up to ~20 DB connections
- 3–5 replicas may hit Railway Postgres connection limits (default 97)
- **Recommendation**: Lower `pool.max` to 3–5 per replica when scaling beyond 2 replicas

## Release Process

Before deploying, follow this checklist:

1. **Bump version** in `package.json`:
   - MINOR bump (`x.(y+1).0`) for new endpoints or behavior changes
   - PATCH bump (`x.y.(z+1)`) for bugfixes
2. **Run tests**: `npx vitest run`
3. **Deploy** to Railway
4. **Verify** version and health after deploy:

```bash
curl https://your-node-url/version | jq .
curl https://your-node-url/health | jq .
```

Expected `/version` output:
```json
{
  "service": "nexart-node",
  "serviceVersion": "0.2.1",
  "sdkVersion": "1.8.4",
  "sdkDependency": "1.8.4",
  "protocolVersion": "1.2.0",
  "serviceBuild": "<git-sha>",
  "nodeVersion": "v22.x.x",
  "timestamp": "2026-02-13T..."
}
```

Expected `/health` output:
```json
{
  "status": "ok",
  "node": "nexart-canonical",
  "version": "0.2.1",
  "sdk_version": "1.8.4",
  "protocol_version": "1.2.0",
  "instance_id": "<hostname>",
  "canvas": { "width": 1950, "height": 2400 },
  "timestamp": "2026-02-13T..."
}
```

## Important Constraints

- Do NOT redesign the protocol
- Do NOT introduce alternative execution paths
- Do NOT attempt to "fix" user code (fail hard instead)
- Do NOT diverge from SDK semantics
- Loop mode MUST fail if draw() is missing (no fallback to static)
