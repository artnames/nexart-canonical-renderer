# NexArt Canonical Node

## Overview

A server-side canonical node for NexArt Code Mode execution. This node provides authoritative, protocol-compliant rendering and verification of NexArt Code Mode artworks using deterministic execution with cryptographic hashing.

## Purpose

While `@nexart/codemode-sdk` defines the official Code Mode semantics and can be used by any platform to render artworks, client-side or third-party execution alone cannot guarantee protocol compliance or deterministic minting. This canonical node runs the same SDK semantics in a controlled, server-side environment and produces authoritative outputs (images or loops) together with cryptographic hashes.

## Architecture

- **Runtime**: Node.js with Express server
- **Canvas**: Uses `node-canvas` for server-side rendering
- **Randomness**: Deterministic Mulberry32 PRNG seeded by snapshot seed
- **Noise**: Seeded Perlin noise implementation
- **Hashing**: SHA-256 for cryptographic verification

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node health check with version info |
| `/api/v1/info` | GET | Node capabilities and defaults |
| `/api/v1/render` | POST | Execute Code Mode and render artwork |
| `/api/v1/hash` | POST | Generate cryptographic hashes |
| `/api/v1/verify` | POST | Verify execution against expected hash |
| `/render` | POST | Legacy render endpoint (backwards compatible) |

## Render Endpoint

```bash
POST /api/v1/render
Content-Type: application/json

{
  "code": "function setup() { background(100); ellipse(width/2, height/2, 200); }",
  "seed": "unique-seed-string",
  "vars": [50, 75, 0, 0, 0, 0, 0, 0, 0, 0],
  "width": 1950,
  "height": 2400
}
```

Query parameter `?format=json` returns JSON with base64 image data and hashes.

## Verification

The node generates two types of hashes:
- **Image Hash**: SHA-256 of the rendered PNG buffer
- **Snapshot Hash**: SHA-256 of normalized snapshot metadata (code, seed, vars, dimensions, engine_version)

## Protocol Compliance

- SDK Version: 1.1.0
- Protocol Version: 1.0.0
- Node Version: 1.0.0

## Security

- Code validation with forbidden pattern detection
- Blocked: eval, Function(), process, global, require, import, constructor, prototype access
- Sandboxed execution with limited global scope

## Determinism Guarantee

Same code + seed + vars = identical output (verified by SHA-256 hash matching)

## Running

```bash
npm run dev    # Development
npm start      # Production
```

Server binds to port 5000 (configurable via PORT env variable).
