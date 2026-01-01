# NexArt Canonical Renderer

The reference implementation of the NexArt Protocol rendering specification. This server-side node provides authoritative, deterministic execution of NexArt Code Mode artworks for minting, verification, and attestation.

## Overview

This repository contains the **Canonical Server-Side Renderer** for NexArt Code Mode. It is the ground truth execution environment used to generate cryptographic attestations (SHA-256 hashes) that are stored on-chain during the minting process.

The canonical renderer is not a preview tool. It is a protocol enforcement layer.

## Authority Chain

The NexArt ecosystem follows a strict authority hierarchy:

```
NexArt Protocol Specification
        ↓
@nexart/codemode-sdk (deterministic semantics)
        ↓
Canonical Renderer (this repository)
        ↓
Applications (NexArt, ByX, third-party platforms)
```

- **NexArt Protocol**: Defines the rules for Code Mode execution (canvas dimensions, VAR ranges, determinism requirements).
- **@nexart/codemode-sdk**: The single source of truth for deterministic primitives (seeded PRNG, Perlin noise, color parsing). All compliant renderers must use this SDK.
- **Canonical Renderer**: Executes artwork code using the SDK and produces verifiable outputs (images, videos, hashes).
- **Applications**: Consume canonical outputs for minting, display, and verification.

## What This Is

- A **reference implementation** of NexArt Protocol rendering
- An **attestation service** that produces cryptographically verifiable outputs
- The **ground truth** for what an artwork looks like when minted
- A **verification endpoint** to confirm execution matches expected hashes

## What This Is NOT

- A frontend application
- A real-time preview renderer
- A development environment for artists
- A convenience wrapper or abstraction layer
- A general-purpose p5.js execution environment

## Preview vs. Canonical Rendering

| Aspect | Preview Rendering | Canonical Rendering |
|--------|-------------------|---------------------|
| Environment | Browser (client-side) | Server (this node) |
| Purpose | Artist feedback, iteration | Minting, verification, attestation |
| SDK Usage | Optional / partial | Required / complete |
| Output | Visual display | Image/video + SHA-256 hash |
| Determinism | Best effort | Protocol-enforced |
| Authority | None | Binding for on-chain records |

Preview renderers (running in browsers) may use the SDK for consistency, but only the canonical renderer produces outputs that are recorded on-chain.

## Protocol Invariants

The canonical renderer enforces these non-negotiable constraints:

- **Canvas**: 1950 x 2400 pixels (hard-locked)
- **Determinism**: Identical inputs always produce identical outputs
- **VAR Array**: 10 elements, each in range 0-100
- **Hashing**: SHA-256 of raw output bytes
- **SDK Authority**: All random/noise operations use `@nexart/codemode-sdk`

## Execution Modes

### Static Mode

Executes the `setup()` function once and returns a PNG image.

### Loop Mode

Executes `setup()` once, then `draw()` for N frames, and returns an MP4 video. Requires explicit opt-in via the `execution` parameter.

Loop mode will fail if the code does not contain a `draw()` function. There is no fallback to static mode.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node status and version information |
| `/render` | POST | Execute a snapshot and return output with hash |
| `/verify` | POST | Re-execute and compare against expected hash |

## Who Should Use This

- **Platform operators** running NexArt-compatible minting infrastructure
- **Protocol developers** building verification or indexing services
- **Third-party integrators** requiring canonical execution for their applications

Artists and collectors do not interact with this node directly. They use applications (like NexArt or ByX) that call this service on their behalf.

## Forking Policy

Forks of this repository are permitted under the license terms.

However, **forks are not NexArt Protocol Compliant by default**.

To maintain protocol compliance, a fork must:

1. Use `@nexart/codemode-sdk` as the sole source of deterministic primitives
2. Enforce all protocol invariants (canvas size, VAR constraints, hashing)
3. Produce byte-identical outputs for identical inputs
4. Not introduce alternative execution paths or fallback behaviors

A renderer is **NexArt Protocol Compliant** if and only if:

- It uses the official `@nexart/codemode-sdk`
- It produces outputs that match this canonical renderer for all valid inputs
- It enforces protocol constraints without exception

Forks that modify deterministic behavior, relax constraints, or diverge from SDK semantics are **not compliant** and their outputs are not valid for NexArt on-chain records.

## Version Information

| Component | Version |
|-----------|---------|
| Node | 1.0.0 |
| SDK | 1.1.1 |
| Protocol | 1.0.0 |

## Deployment

The node is containerized for deployment on any Docker-compatible platform.

```bash
# Development
npm run dev

# Production
docker build -t nexart-canonical .
docker run -p 5000:5000 nexart-canonical
```

## License

See LICENSE file for terms.

---

This is a protocol implementation, not a product. For user-facing applications, see [NexArt](https://nexart.io) or [ByX](https://byx.art).
