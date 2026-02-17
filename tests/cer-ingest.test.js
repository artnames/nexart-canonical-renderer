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

  it('sends Authorization Bearer header and correct payload', async () => {
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
  });

  it('logs boot-time env diagnostic', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    vi.resetModules();
    await import('../src/cer-ingest.js');

    const bootLines = logSpy.mock.calls.filter(c => c[0].includes('[cer-ingest] env'));
    expect(bootLines).toHaveLength(1);
    expect(bootLines[0][0]).toContain('hasSupabaseUrl=true');
    expect(bootLines[0][0]).toContain('hasCerIngestSecret=true');
  });

  it('boot diagnostic shows false when env vars missing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    delete process.env.SUPABASE_URL;
    delete process.env.CER_INGEST_SECRET;

    vi.resetModules();
    await import('../src/cer-ingest.js');

    const bootLines = logSpy.mock.calls.filter(c => c[0].includes('[cer-ingest] env'));
    expect(bootLines).toHaveLength(1);
    expect(bootLines[0][0]).toContain('hasSupabaseUrl=false');
    expect(bootLines[0][0]).toContain('hasCerIngestSecret=false');
  });

  it('logs disabled and skips fetch when env vars missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    delete process.env.SUPABASE_URL;
    delete process.env.CER_INGEST_SECRET;

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({ usageEventId: 1, bundle: AI_CER_FIXTURE, attestation: {} });

    expect(mockFetch).not.toHaveBeenCalled();
    const disabled = warnSpy.mock.calls.filter(c => c[0].includes('disabled'));
    expect(disabled.length).toBeGreaterThanOrEqual(1);
  });

  it('logs unified diagnostic on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }));

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({ usageEventId: 42, bundle: AI_CER_FIXTURE, attestation: { verified: true } });

    const lines = logSpy.mock.calls.filter(c => c[0].includes('status=200'));
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toContain('usageEventId=42');
  });

  it('logs failure diagnostic on non-2xx', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, text: async () => 'Forbidden' }));

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await ingestCerBundle({ usageEventId: 99, bundle: AI_CER_FIXTURE, attestation: {} });

    const lines = logSpy.mock.calls.filter(c => c[0].includes('status=403'));
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toContain('usageEventId=99');
  });

  it('does not throw on network failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => { throw new Error('Connection refused'); });

    vi.resetModules();
    const { ingestCerBundle } = await import('../src/cer-ingest.js');

    await expect(
      ingestCerBundle({ usageEventId: 77, bundle: AI_CER_FIXTURE, attestation: {} })
    ).resolves.toBeUndefined();

    const errCalls = warnSpy.mock.calls.filter(c => c[0].includes('error=Connection refused'));
    expect(errCalls).toHaveLength(1);
    expect(errCalls[0][0]).toContain('usageEventId=77');
  });
});

describe('usageEventId coercion in /api/attest', () => {
  function coerceUsageEventId(raw) {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
    if (raw && typeof raw === "object" && raw.id != null) {
      const inner = raw.id;
      if (typeof inner === "number") return inner;
      if (typeof inner === "string" && /^\d+$/.test(inner)) return Number(inner);
    }
    return null;
  }

  it('accepts a number', () => {
    expect(coerceUsageEventId(42)).toBe(42);
  });

  it('accepts a numeric string', () => {
    expect(coerceUsageEventId("123")).toBe(123);
  });

  it('accepts an object with numeric id', () => {
    expect(coerceUsageEventId({ id: 99 })).toBe(99);
  });

  it('accepts an object with string id', () => {
    expect(coerceUsageEventId({ id: "456" })).toBe(456);
  });

  it('returns null for boolean true', () => {
    expect(coerceUsageEventId(true)).toBeNull();
  });

  it('returns null for false', () => {
    expect(coerceUsageEventId(false)).toBeNull();
  });

  it('returns null for null', () => {
    expect(coerceUsageEventId(null)).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(coerceUsageEventId("abc")).toBeNull();
  });
});
