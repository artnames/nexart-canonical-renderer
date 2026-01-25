# NexArt Architecture: Core vs Edges

This document explains the relationship between the NexArt SDK/CLI (core) and the Node hosted service (edge).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CORE (Free, Open Source)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   @nexart/codemode-sdk                    nexart-cli                        │
│   ├── Deterministic PRNG (Mulberry32)     ├── Local rendering               │
│   ├── Seeded Perlin noise                 ├── Snapshot creation             │
│   ├── Protocol constants                  ├── Offline verification          │
│   └── Runtime primitives                  └── Artist tooling                │
│                                                                             │
│   Usage: npm install @nexart/codemode-sdk                                   │
│   Anyone can run deterministic renders locally without network access.      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EDGE (Optional Hosted Service)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   nexart-canonical-node (this repository)                                   │
│   ├── Hosted verification API                                               │
│   ├── Third-party attestation                                               │
│   ├── Enterprise SLAs (when NexArt-operated)                                │
│   └── Account/quota management (future)                                     │
│                                                                             │
│   Self-hosted: Anyone can deploy this node                                  │
│   NexArt-hosted: "NexArt Attested" = signed by NexArt infrastructure       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Execution Flows

### Local Flow (SDK/CLI)

```
Artist Code + Snapshot
        │
        ▼
┌───────────────────┐
│  @nexart/codemode │
│       -sdk        │
├───────────────────┤
│ • Seeded random() │
│ • Seeded noise()  │
│ • Protocol vars   │
└───────────────────┘
        │
        ▼
   Local Render
   (PNG/MP4 + Hash)
```

**No network required.** Artists can verify their work locally using the CLI.

### Hosted Flow (Node Service)

```
Snapshot (code, seed, vars)
        │
        ▼
┌───────────────────────────┐
│   nexart-canonical-node   │
│   (this repository)       │
├───────────────────────────┤
│ • POST /render            │
│ • POST /verify            │
│ • GET /version            │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│      Response             │
├───────────────────────────┤
│ • Output (PNG/MP4)        │
│ • SHA-256 hash            │
│ • Version metadata        │
│ • Attestation info        │
└───────────────────────────┘
```

## What Gets Signed/Verified

| Element | Description | Binding |
|---------|-------------|---------|
| **Snapshot** | Code + seed + vars + execution params | Input to render |
| **Output Hash** | SHA-256 of raw PNG/MP4 bytes | Canonical identifier |
| **Version Info** | SDK + Protocol + Service versions | Reproducibility |

## Attestation Types

### NexArt Attested
- Rendered/verified by NexArt-operated infrastructure
- Includes NexArt service signature (future)
- Subject to NexArt SLAs and uptime guarantees
- Recognized for official on-chain records

### Self Attested
- Rendered by self-hosted node or local CLI
- Cryptographically identical output (if compliant)
- No NexArt signature
- Valid for personal verification, may not be accepted for official minting

## Version Pinning Strategy

This node uses **exact version pinning** for the SDK:

```json
"@nexart/codemode-sdk": "1.6.0"
```

This ensures:
1. Reproducible builds across deployments
2. Auditable dependency chain
3. No surprise behavior changes from minor SDK updates

When upgrading:
1. Test thoroughly in staging
2. Update version explicitly
3. Document the change

## API Version Response

Every verification/attestation response includes:

```json
{
  "sdkVersion": "1.6.0",
  "protocolVersion": "1.2.0",
  "serviceVersion": "1.0.0",
  "serviceBuild": "<git-sha>"
}
```

This enables consumers to:
- Verify which SDK produced a result
- Reproduce results locally with matching versions
- Audit the exact code that ran
