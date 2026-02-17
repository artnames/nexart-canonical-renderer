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

describe('coerceUsageEventId', () => {
  let coerceUsageEventId;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/cer-ingest.js');
    coerceUsageEventId = mod.coerceUsageEventId;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a number', () => { expect(coerceUsageEventId(42)).toBe(42); });
  it('accepts a numeric string', () => { expect(coerceUsageEventId("123")).toBe(123); });
  it('accepts an object with numeric id', () => { expect(coerceUsageEventId({ id: 99 })).toBe(99); });
  it('accepts an object with string id', () => { expect(coerceUsageEventId({ id: "456" })).toBe(456); });
  it('returns null for boolean true', () => { expect(coerceUsageEventId(true)).toBeNull(); });
  it('returns null for false', () => { expect(coerceUsageEventId(false)).toBeNull(); });
  it('returns null for null', () => { expect(coerceUsageEventId(null)).toBeNull(); });
  it('returns null for non-numeric string', () => { expect(coerceUsageEventId("abc")).toBeNull(); });
});

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

  it('sends Authorization Bearer and includes endpoint + storeSensitive in payload', async () => {
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
      endpoint: "/api/attest",
      bundle: AI_CER_FIXTURE,
      attestation: { verified: true },
      storeSensitive: true
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const call = calls[0];
    expect(call.opts.headers['Authorization']).toBe('Bearer test-secret');
    expect(call.opts.headers['X-CER-INGEST-SECRET']).toBeUndefined();

    const body = JSON.parse(call.opts.body);
    expect(body.usageEventId).toBe(42);
    expect(body.endpoint).toBe("/api/attest");
    expect(body.storeSensitive).toBe(true);
    expect(body.bundle.bundleType).toBe('cer.ai.execution.v1');
  });

  it('includes artifact metadata when provided', async () => {
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
      endpoint: "/api/render",
      bundle: { bundleType: "cer.codemode.render.v1", runtimeHash: "abc" },
      attestation: { verified: true },
      artifactPath: "user/u1/usage/42/output.png",
      artifactContentType: "image/png"
    });

    const body = JSON.parse(calls[0].opts.body);
    expect(body.artifact).toEqual({
      path: "user/u1/usage/42/output.png",
      contentType: "image/png"
    });
  });

  it('omits artifact field when no artifactPath', async () => {
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
      endpoint: "/api/attest",
      bundle: AI_CER_FIXTURE,
      attestation: { verified: true }
    });

    const body = JSON.parse(calls[0].opts.body);
    expect(body.artifact).toBeUndefined();
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
  });
});

describe('uploadArtifact', () => {
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

  it('uploads PNG to correct storage path and returns path on success', async () => {
    const calls = [];
    const mockFetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200 };
    });

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    vi.resetModules();
    globalThis.fetch = mockFetch;

    const { uploadArtifact } = await import('../src/cer-ingest.js');

    const result = await uploadArtifact({
      userId: "user-123",
      usageEventId: 42,
      buffer: Buffer.from("fake-png"),
      contentType: "image/png"
    });

    expect(result).toBe("user/user-123/usage/42/output.png");
    expect(calls[0].url).toContain('/storage/v1/object/certified-artifacts/user/user-123/usage/42/output.png');
    expect(calls[0].opts.headers['Authorization']).toBe('Bearer test-secret');
    expect(calls[0].opts.headers['Content-Type']).toBe('image/png');
  });

  it('uploads MP4 with correct extension', async () => {
    const mockFetch = vi.fn(async () => ({ ok: true, status: 200 }));

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    vi.resetModules();
    globalThis.fetch = mockFetch;

    const { uploadArtifact } = await import('../src/cer-ingest.js');

    const result = await uploadArtifact({
      userId: "user-123",
      usageEventId: 42,
      buffer: Buffer.from("fake-mp4"),
      contentType: "video/mp4"
    });

    expect(result).toBe("user/user-123/usage/42/output.mp4");
  });

  it('returns null when env vars missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.CER_INGEST_SECRET;

    vi.resetModules();
    const { uploadArtifact } = await import('../src/cer-ingest.js');

    const result = await uploadArtifact({
      userId: "user-123",
      usageEventId: 42,
      buffer: Buffer.from("fake"),
      contentType: "image/png"
    });

    expect(result).toBeNull();
  });

  it('returns null and warns on upload failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.CER_INGEST_SECRET = 'test-secret';

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal error'
    }));

    vi.resetModules();
    const { uploadArtifact } = await import('../src/cer-ingest.js');

    const result = await uploadArtifact({
      userId: "user-123",
      usageEventId: 42,
      buffer: Buffer.from("fake"),
      contentType: "image/png"
    });

    expect(result).toBeNull();
    const warns = warnSpy.mock.calls.filter(c => c[0].includes('artifact upload failed'));
    expect(warns.length).toBeGreaterThanOrEqual(1);
  });
});
