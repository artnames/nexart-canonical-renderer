# NexArt Canonical Node

## Overview

A server-side canonical node for NexArt Code Mode execution. This node provides authoritative, protocol-compliant rendering and verification of NexArt Code Mode artworks using deterministic execution with cryptographic hashing.

## Purpose

While `@nexart/codemode-sdk` defines the official Code Mode semantics and can be used by any platform to render artworks, client-side or third-party execution alone cannot guarantee protocol compliance or deterministic minting. This canonical node runs the same SDK semantics in a controlled, server-side environment and produces authoritative outputs (images or loops) together with cryptographic hashes.

**Key distinction:**
- Apps are not compliant - mints are compliant
- The node is about verifiability, not control
- Only executions routed through the canonical node can claim full NexArt protocol compliance

## Architecture

- **Runtime**: Node.js with Express server
- **Canvas**: Uses `node-canvas` for server-side rendering
- **Randomness**: Deterministic Mulberry32 PRNG seeded by snapshot seed
- **Noise**: Seeded Perlin noise implementation
- **Hashing**: SHA-256 for cryptographic verification

## Core Endpoint

The primary endpoint is:

```bash
POST /render
Content-Type: application/json

{
  "code": "function setup() { background(100); ellipse(width/2, height/2, 200); }",
  "seed": "unique-seed-string",
  "vars": [50, 75],
  "width": 1950,
  "height": 2400
}
```

Returns: PNG image with headers containing hashes and metadata.

Query parameter `?format=json` returns JSON with base64 image data and hashes.

## All Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/render` | POST | Core: Execute snapshot, return PNG + hashes |
| `/health` | GET | Node health check with version info |
| `/api/v1/info` | GET | Node capabilities and defaults |
| `/api/v1/render` | POST | Alias for /render |
| `/api/v1/hash` | POST | Generate cryptographic hashes |
| `/api/v1/verify` | POST | Verify execution against expected hash |

## Response Headers (Image Format)

```
X-NexArt-Image-Hash: <sha256 of PNG>
X-NexArt-Snapshot-Hash: <sha256 of normalized snapshot>
X-NexArt-SDK-Version: 1.1.0
X-NexArt-Protocol-Version: 1.0.0
X-NexArt-Execution-Time: <ms>
```

## Protocol Compliance

- SDK Version: 1.1.0
- Protocol Version: 1.0.0
- Node Version: 1.0.0

## Determinism Guarantee

Same code + seed + vars = identical output (verified by SHA-256 hash matching)

The node uses:
- Mulberry32 PRNG for `random()` - seeded from snapshot seed
- Seeded Perlin noise for `noise()` - consistent across executions

## Running

```bash
npm run dev    # Development
npm start      # Production
```

Server binds to port 5000 (configurable via PORT env variable).
