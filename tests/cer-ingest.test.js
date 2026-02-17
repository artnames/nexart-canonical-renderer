import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:5000';

const AI_CER_FIXTURE = {
  bundleType: "cer.ai.execution.v1",
  certificateHash: "sha256:1dc840c0b72bf39ebb0f9ed63cfdab76b581c3cdaf55f5b8276ded49b364e52d",
  createdAt: "2026-02-13T13:13:33.112Z",
  version: "0.1",
  snapshot: {
    type: "ai.execution.v1",
    protocolVersion: "1.2.0",
    executionSurface: "ai",
    executionId: "exec_c7093dd242d4b87c",
    timestamp: "2026-02-13T13:13:33.111Z",
    provider: "openai",
    model: "gpt-4o",
    modelVersion: null,
    prompt: "You are a helpful assistant.",
    input: "Summarize the key risks in Q4 earnings.",
    inputHash: "sha256:92404e9f72809c9b7f81aaa976825e71d17e70da2633a7258d72e54ba46bd60e",
    parameters: { temperature: 0, maxTokens: 1024, topP: null, seed: null },
    output: "Key risks identified: (1) Revenue contraction of 12% YoY, (2) Margin pressure from increased operating costs, (3) Regulatory uncertainty in EU markets.",
    outputHash: "sha256:fb45b106fcf36c557672c39eecffd44e77e55176a92756429d341ac571211293",
    sdkVersion: "0.1.0",
    appId: "nexart.io-demo"
  },
  meta: { source: "nexart.io", tags: ["demo"] }
};

describe('CER Ingestion Module', () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('ingestCerBundle sends correct payload to Supabase edge function', async () => {
    const calls = [];
    const mockFetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200 };
    });

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    vi.resetModules();
    globalThis.fetch = mockFetch;

    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    const attestation = {
      attestedAt: "2026-02-13T13:13:33.112Z",
      attestationId: "test-id",
      bundleType: "cer.ai.execution.v1",
      certificateHash: "sha256:abc123",
      verified: true
    };

    await ingestCerBundle({
      usageEventId: 42,
      bundle: AI_CER_FIXTURE,
      attestation
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const call = calls[0];
    expect(call.url).toBe('https://test.supabase.co/functions/v1/store-cer-bundle');
    expect(call.opts.method).toBe('POST');
    expect(call.opts.headers['Content-Type']).toBe('application/json');
    expect(call.opts.headers['X-CER-INGEST-SECRET']).toBe('test-secret');

    const body = JSON.parse(call.opts.body);
    expect(body.usageEventId).toBe(42);
    expect(body.bundle.bundleType).toBe('cer.ai.execution.v1');
    expect(body.attestation.verified).toBe(true);
  });

  it('ingestCerBundle silently skips when env vars are missing', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    delete process.env.SUPABASE_URL;
    delete process.env.CER_INGEST_SECRET;

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({
      usageEventId: 42,
      bundle: AI_CER_FIXTURE,
      attestation: { verified: true }
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ingestCerBundle does not throw on fetch failure', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    const mockFetch = vi.fn(async () => {
      throw new Error('Network error');
    });
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await expect(
      ingestCerBundle({
        usageEventId: 42,
        bundle: AI_CER_FIXTURE,
        attestation: { verified: true }
      })
    ).resolves.toBeUndefined();
  });

  it('ingestCerBundle does not throw on non-ok response', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    }));
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await expect(
      ingestCerBundle({
        usageEventId: 42,
        bundle: AI_CER_FIXTURE,
        attestation: { verified: true }
      })
    ).resolves.toBeUndefined();
  });
});
