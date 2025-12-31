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
| `/render` | POST | Execute snapshot (static or loop) |
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
    "sdk_version": "1.1.1",
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
  "animationBase64": "<mp4-bytes>",
  "animationHash": "<sha256>",
  "posterBase64": "<png-bytes>",
  "posterHash": "<sha256>",
  "frames": 120,
  "width": 1950,
  "height": 2400,
  "fps": 30,
  "metadata": {
    "sdk_version": "1.1.1",
    "protocol_version": "1.0.0",
    "node_version": "1.0.0",
    "canvas": { "width": 1950, "height": 2400 },
    "execution_time_ms": 5000,
    "timestamp": "2025-01-01T00:00:00.000Z",
    "isLoopMode": true
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
- Loop mode MUST fail if draw() is missing (no fallback to static)
