# NexArt Canonical Node

## Overview

The NexArt Canonical Node is a server-side, authoritative, and deterministic execution environment for the NexArt protocol's Code Mode. Its primary purpose is to serve as an attestation service and the ground truth for minting and verification of digital art generated via NexArt Code Mode. It provides protocol-compliant execution only, focusing on reliability and determinism rather than acting as a frontend application or preview renderer.

Key capabilities include:
- Generating static images (PNG) from `setup()` function execution.
- Generating animated videos (MP4) from `setup()` and `draw()` function execution.
- Verifying the integrity and determinism of generated art against expected hashes.
- Attesting to the integrity of Code Mode and AI Execution CER (Canonical Event Record) bundles.

The project's vision is to ensure every piece of digital art created through NexArt Code Mode is verifiable, immutable, and consistently rendered across all authorized nodes, establishing a high standard of trust and authenticity in the digital art ecosystem.

## User Preferences

- Do NOT redesign the protocol.
- Do NOT introduce alternative execution paths.
- Do NOT attempt to "fix" user code (fail hard instead).
- Do NOT diverge from SDK semantics.
- Loop mode MUST fail if `draw()` is missing (no fallback to static).

## System Architecture

The NexArt Canonical Node is built around the `@nexart/codemode-sdk`, which is the single source of truth for Code Mode semantics. It uses `createP5Runtime()` from the SDK to provide core deterministic primitives like seeded PRNG for `random()`, seeded Perlin noise for `noise()`, color parsing, and drawing primitives.

**Core Components:**
- **SDK (`createP5Runtime`):** Provides deterministic primitives.
- **`p5-extensions.js`:** Implements missing `p5.js` methods (e.g., `strokeCap`, `rectMode`).
- **`server.js` / `render-loop.js`:** Handles request processing, execution orchestration, and video encoding.

**Key Design Decisions:**
- **Deterministic Execution:** Ensures the same input always yields the same output, verified via SHA-256 hashes.
- **Fixed Canvas Size:** All renders are hard-locked to **1950x2400** pixels.
- **VAR (Variables):** Supports 10 elements with a range of 0-100 for user-defined variables.
- **Execution Modes:**
    - **Static Mode:** Executes only the `setup()` function, returning a PNG image.
    - **Loop Mode:** Executes `setup()` once and `draw()` N times, returning an MP4 video. Requires `totalFrames >= 2`.
- **API Endpoints:**
    - `/health`: Node status.
    - `/ready`: Readiness check.
    - `/version`: Detailed version information.
    - `/render`: Primary endpoint for static image and animation generation.
    - `/api/render`: CLI contract for static renders.
    - `/api/attest`: For attesting Code Mode and AI Execution CER bundles.
    - `/verify`: For verifying execution against expected hashes.
- **UI/UX (Implicit):** While not a frontend application, the node's output (PNGs, MP4s) indirectly supports UI/UX in client applications that consume these outputs. The fixed canvas size and deterministic rendering contribute to a predictable visual outcome.

## External Dependencies

- **`@nexart/codemode-sdk`:** The core library for Code Mode semantics and execution.
- **`p5.js`:** A JavaScript library for creative coding, extended by `p5-extensions.js`.
- **PostgreSQL:** Used for database operations, including API key storage, usage logging, and account-level quota management.
- **Supabase:** Optionally used for CER (Canonical Event Record) bundle persistence. This involves sending CER bundles to a Supabase edge function (`store-cer-bundle`) for storage.
- **`@nexart/ai-execution` NPM package:** Used for canonical verification of AI Execution CER bundles.