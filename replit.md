# NexArt Canonical Node

## Overview

The NexArt Canonical Node is a server-side, authoritative, and deterministic execution environment for the NexArt protocol's Code Mode. Its primary purpose is to serve as an attestation service and the ground truth for minting and verification of digital art generated via NexArt Code Mode. It provides protocol-compliant execution only, focusing on reliability and determinism rather than acting as a frontend application or preview renderer.

Key capabilities include:
- Generating static images (PNG) from `setup()` function execution.
- Generating animated videos (MP4) from `setup()` and `draw()` function execution.
- Verifying the integrity and determinism of generated art against expected hashes.
- Attesting to the integrity of Code Mode and AI Execution CER (Canonical Event Record) bundles.

## User Preferences

- Do NOT redesign the protocol.
- Do NOT introduce alternative execution paths.
- Do NOT attempt to "fix" user code (fail hard instead).
- Do NOT diverge from SDK semantics.
- Loop mode MUST fail if `draw()` is missing (no fallback to static).

## System Architecture

The NexArt Canonical Node is built around the `@nexart/codemode-sdk`, which is the single source of truth for Code Mode semantics.

**Core Components:**
- **SDK (`createP5Runtime`):** Provides deterministic primitives.
- **`p5-extensions.js`:** Implements missing `p5.js` methods (e.g., `strokeCap`, `rectMode`).
- **`server.js` / `render-loop.js`:** Handles request processing, execution orchestration, and video encoding.
- **`cer-ingest.js`:** Fire-and-forget CER bundle persistence to Supabase.
- **`auth.js`:** API key authentication, admin middleware, usage logging.
- **`db.js`:** Database migrations, usage events, quota management.
- **`sanitize.js`:** Deep undefined removal for CER bundles.
- **`attest.js`:** Bundle verification, attestation hashing.

## Version Info

- Service Version: 0.4.2
- SDK Version: 1.8.4
- Protocol Version: 1.2.0

## API Endpoints

- `GET /health` - Always 200 when process is up
- `GET /ready` - Readiness check with DB ping (≤2s guard)
- `GET /version` - Full version info
- `POST /render` - Execute snapshot (public, disabled in production)
- `POST /api/render` - CLI contract (API key required)
- `POST /api/attest` - Attest CER bundles (API key required)
- `POST /verify` - Verify execution against expected hashes
- `GET /admin/usage/today` - Today's usage (ADMIN_SECRET required via X-Admin-Secret header)
- `GET /admin/usage/month` - Monthly usage (ADMIN_SECRET required)
- `GET /admin/debug/runtime` - Runtime diagnostics (ADMIN_SECRET required)

## Hardening (v0.4.2)

- **Body limit:** 50mb (supports large AI CER bundles)
- **Process handlers:** uncaughtException and unhandledRejection logged without crash
- **Error middleware:** Handles entity.too.large (413) and request aborted (400) cleanly
- **Server timeouts:** keepAliveTimeout=65s, headersTimeout=70s, requestTimeout=30s
- **Timing diagnostics:** /api/attest logs structured `[ATTEST]` line with ms_total, ms_validate, ms_verify, ms_db, ms_ingest_enqueue
- **Ready guard:** /ready never takes >2s (Promise.race with timeout)

## CER Bundle Persistence

- After a successful `/api/attest` (AI CER) or `/api/render`, the node persists the certified record to Supabase
- Fire-and-forget: ingestion failure does NOT affect endpoint responses
- Requires `SUPABASE_URL` and `CER_INGEST_SECRET` env vars; silently skips if either is missing
- Edge function: `POST ${SUPABASE_URL}/functions/v1/store-cer-bundle`
- Auth: `Authorization: Bearer ${CER_INGEST_SECRET}` header
- Module: `src/cer-ingest.js`

### AI CER (`/api/attest`)
- Payload: `{ usageEventId, endpoint, bundle, attestation, storeSensitive }`
- `storeSensitive`: derived from `STORE_SENSITIVE_AI` env var (default false)

### Render Records (`/api/render`)
- Bundle type: `cer.codemode.render.v1`
- Payload: `{ usageEventId, endpoint, bundle, attestation, artifactBase64, artifactMime }`
- `artifactBase64`: PNG image as base64 string (edge function handles storage upload)
- `artifactMime`: `"image/png"`

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `SUPABASE_URL` - Supabase project URL (required for CER persistence)
- `CER_INGEST_SECRET` - Shared secret for Supabase edge function auth
- `STORE_SENSITIVE_AI` - If `"true"`, tells edge function to store full AI CER bundle
- `ADMIN_SECRET` - Required for /admin/* endpoints (via X-Admin-Secret header)
- `SESSION_SECRET` - Session management
- `ENFORCE_QUOTA` - If `"false"`, disables quota enforcement

## External Dependencies

- **`@nexart/codemode-sdk`:** The core library for Code Mode semantics and execution.
- **`p5.js`:** A JavaScript library for creative coding, extended by `p5-extensions.js`.
- **PostgreSQL:** Used for database operations, including API key storage, usage logging, and account-level quota management.
- **Supabase:** Used for CER bundle persistence via edge function.
- **`@nexart/ai-execution` NPM package:** Used for canonical verification of AI Execution CER bundles.

## Deployment

The node is configured for Railway deployment via Dockerfile.

```bash
npm run dev    # Development (Replit)
npm start      # Production (Railway)
```
