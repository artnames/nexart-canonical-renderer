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
"@nexart/codemode-sdk": "1.6.0"
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
    "sdk_version": "1.6.0",
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

## Execution Modes

**Static**: Executes `setup()` + `draw()` once, returns PNG.

**Loop**: Executes `setup()` + `draw()` for N frames, returns MP4. Fails if `draw()` is absent.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node status |
| `/version` | GET | Full version info (SDK, protocol, build) |
| `/render` | POST | Execute snapshot, return output + hash |
| `/verify` | POST | Re-execute, compare against expected hash |

### GET /version

Returns complete version information for auditing:

```bash
curl http://localhost:5000/version
```

```json
{
  "service": "nexart-node",
  "serviceVersion": "0.1.0",
  "sdkVersion": "1.6.0",
  "sdkDependency": "1.6.0",
  "protocolVersion": "1.2.0",
  "serviceBuild": "abc1234",
  "nodeVersion": "v20.x.x",
  "timestamp": "2025-01-25T..."
}
```

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
| SDK | 1.6.0 (exact pin) |
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
