# NexArt Canonical Renderer

Reference implementation of NexArt Protocol rendering. This server-side node provides deterministic execution of Code Mode artworks for minting, verification, and on-chain attestation.

## Protocol Compliance Status

| Status | Description |
|--------|-------------|
| **This Repository** | Canonical Reference Implementation |
| **Forks** | Not compliant by default |

Forks that modify deterministic behavior or deviate from SDK semantics produce invalid outputs for NexArt on-chain records.

## What This Node Is

- Reference implementation of NexArt Protocol rendering
- Attestation service producing cryptographically verifiable outputs
- Ground truth for minted artwork appearance
- Verification endpoint for hash comparison

## What This Node Is NOT

- A frontend application
- A real-time preview renderer
- A development environment for artists
- A general-purpose p5.js runtime

## Authority Chain

```
NexArt Protocol Specification
        ↓
@nexart/codemode-sdk
        ↓
Canonical Renderer (this repository)
        ↓
Applications (NexArt, ByX, third parties)
```

The SDK is the single source of truth for deterministic primitives. All compliant renderers must use it.

## Preview vs. Canonical Rendering

| Aspect | Preview | Canonical |
|--------|---------|-----------|
| Environment | Browser | Server (this node) |
| Purpose | Artist feedback | Minting, attestation |
| Output | Visual display | Image/video + SHA-256 |
| Determinism | Best effort | Protocol-enforced |
| Authority | None | Binding for on-chain records |

Only canonical outputs are recorded on-chain.

## Protocol Invariants

- **Canvas**: 1950 x 2400 pixels (immutable)
- **Determinism**: Identical inputs produce identical outputs
- **VAR Array**: 10 elements, range 0-100
- **Hashing**: SHA-256 of raw output bytes
- **SDK**: All random/noise operations via `@nexart/codemode-sdk`

## Execution Modes

**Static**: Executes `setup()` once, returns PNG.

**Loop**: Executes `setup()` + `draw()` for N frames, returns MP4. Fails if `draw()` is absent.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node status |
| `/render` | POST | Execute snapshot, return output + hash |
| `/verify` | POST | Re-execute, compare against expected hash |

## Who Should Use This

- Platform operators running NexArt-compatible minting infrastructure
- Protocol developers building verification or indexing services
- Third-party integrators requiring canonical execution

Artists and collectors use applications that call this service on their behalf.

## What Makes an Implementation Compliant

A renderer is **NexArt Protocol Compliant** if:

1. Uses `@nexart/codemode-sdk` as the sole source of deterministic primitives
2. Enforces all protocol invariants without exception
3. Produces byte-identical outputs for identical inputs
4. Does not introduce alternative execution paths or fallbacks

Implementations that fail any condition are non-compliant.

## Forking Policy

Forks are permitted under the license terms.

Forks are **not** NexArt Protocol Compliant by default. Compliance requires adherence to all conditions above. Modified forks that relax constraints or diverge from SDK semantics cannot produce valid on-chain attestations.

## Public Availability

This repository is public to enable:

- Transparency in protocol execution
- Independent verification of canonical outputs
- Third-party platform integration
- Community review of the reference implementation

Public availability does not imply that forks inherit compliance status.

## Version Information

| Component | Version |
|-----------|---------|
| Node | 1.0.0 |
| SDK | 1.1.1 |
| Protocol | 1.0.0 |

## Deployment

```bash
# Development
npm run dev

# Production
docker build -t nexart-canonical .
docker run -p 5000:5000 nexart-canonical
```

## License

See LICENSE file.

---

This is a protocol implementation. For user-facing applications, see [NexArt](https://nexart.app) or [ByX](https://byx.art).
