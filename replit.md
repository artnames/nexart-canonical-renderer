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

The node implements the SDK's exact algorithms:
- Mulberry32 seeded PRNG for `random()`
- Seeded Perlin noise for `noise()`

## Protocol Invariants

- Canvas: **1950×2400** (hard-locked, non-configurable)
- Determinism: Same input = Same output (SHA-256 verified)
- VAR: 10 elements, range 0-100
- Execution: `setup()` only (static mode)

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node status with version info |
| `/render` | POST | Execute snapshot, return canonical result |
| `/verify` | POST | Verify execution against expected hash |

## Render Endpoint

**Request:**
```json
POST /render
Content-Type: application/json

{
  "code": "function setup() { background(100); ellipse(width/2, height/2, 200); }",
  "seed": "unique-seed-string",
  "vars": [50, 75, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

**Response (canonical result envelope):**
```json
{
  "mime": "image/png",
  "imageHash": "<sha256>",
  "imageBase64": "<png-bytes>",
  "metadata": {
    "sdk_version": "1.1.1",
    "protocol_version": "1.0.0",
    "node_version": "1.0.0",
    "canvas": { "width": 1950, "height": 2400 },
    "execution_time_ms": 123,
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
}
```

## Verify Endpoint

**Request:**
```json
POST /verify
Content-Type: application/json

{
  "snapshot": {
    "code": "...",
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
  "computedHash": "<sha256>",
  "expectedHash": "<sha256>",
  "protocolCompliant": true
}
```

## Version Info

- SDK Version: 1.1.1
- Protocol Version: 1.0.0
- Node Version: 1.0.0

## Deployment

The node is configured for Railway deployment via Dockerfile.

```bash
npm run dev    # Development (Replit)
npm start      # Production (Railway)
```

## Important Constraints

- Do NOT redesign the protocol
- Do NOT introduce alternative execution paths
- Do NOT attempt to "fix" user code (fail hard instead)
- Do NOT diverge from SDK semantics
