import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

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

  it('sends only Authorization Bearer header (no X-CER-INGEST-SECRET)', async () => {
    const calls = [];
    const mockFetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    });

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    vi.resetModules();
    globalThis.fetch = mockFetch;

    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({
      usageEventId: 42,
      bundle: AI_CER_FIXTURE,
      attestation: { attestationId: "a1", verified: true }
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const call = calls[0];
    expect(call.url).toBe('https://test.supabase.co/functions/v1/store-cer-bundle');
    expect(call.opts.headers['Authorization']).toBe('Bearer test-secret');
    expect(call.opts.headers['X-CER-INGEST-SECRET']).toBeUndefined();

    const body = JSON.parse(call.opts.body);
    expect(body.usageEventId).toBe(42);
    expect(body.bundle.bundleType).toBe('cer.ai.execution.v1');
    expect(body.attestation.verified).toBe(true);
  });

  it('logs disabled message once when env vars are missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    delete process.env.SUPABASE_URL;
    delete process.env.CER_INGEST_SECRET;

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({ usageEventId: 1, bundle: AI_CER_FIXTURE, attestation: {} });
    await ingestCerBundle({ usageEventId: 2, bundle: AI_CER_FIXTURE, attestation: {} });

    expect(mockFetch).not.toHaveBeenCalled();
    const disabledCalls = warnSpy.mock.calls.filter(c => c[0].includes('disabled'));
    expect(disabledCalls).toHaveLength(1);
    expect(disabledCalls[0][0]).toBe('[cer-ingest] disabled (missing env)');
  });

  it('logs unified diagnostic line with url and status on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }));

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({
      usageEventId: 42,
      bundle: AI_CER_FIXTURE,
      attestation: { verified: true }
    });

    const lines = logSpy.mock.calls.filter(c => c[0].includes('[cer-ingest]'));
    expect(lines).toHaveLength(1);
    const line = lines[0][0];
    expect(line).toContain('usageEventId=42');
    expect(line).toContain('url=https://test.supabase.co');
    expect(line).toContain('status=200');
  });

  it('logs unified diagnostic line on non-2xx failure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden'
    }));

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({
      usageEventId: 99,
      bundle: AI_CER_FIXTURE,
      attestation: { verified: true }
    });

    const lines = logSpy.mock.calls.filter(c => c[0].includes('[cer-ingest]'));
    expect(lines).toHaveLength(1);
    const line = lines[0][0];
    expect(line).toContain('usageEventId=99');
    expect(line).toContain('status=403');
    expect(line).toContain('body=Forbidden');
  });

  it('logs error with usageEventId on network failure without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => { throw new Error('Connection refused'); });

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await expect(
      ingestCerBundle({
        usageEventId: 77,
        bundle: AI_CER_FIXTURE,
        attestation: { verified: true }
      })
    ).resolves.toBeUndefined();

    const errCalls = warnSpy.mock.calls.filter(c => c[0].includes('[cer-ingest]'));
    expect(errCalls).toHaveLength(1);
    const line = errCalls[0][0];
    expect(line).toContain('usageEventId=77');
    expect(line).toContain('url=https://test.supabase.co');
    expect(line).toContain('error=Connection refused');
  });
});
