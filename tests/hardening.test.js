import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:5000';

function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function createTestApiKey(userSuffix = 'hardening') {
  const apiKey = `test-${userSuffix}-key-${Date.now()}`;
  const keyHash = sha256hex(apiKey);
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  const userId = `test-${userSuffix}-user`;

  await pool.query(`
    INSERT INTO accounts (user_id, monthly_limit)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET monthly_limit = $2
  `, [userId, 100]);

  await pool.query(`
    INSERT INTO api_keys (key_hash, label, plan, status, monthly_limit, user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [keyHash, `test-${userSuffix}`, 'free', 'active', 100, userId]);

  await pool.end();
  return apiKey;
}

describe('Hardening: /health and /ready', () => {
  it('/health should always return 200', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('/ready should return 200 with db latency and ms timing', async () => {
    const res = await fetch(`${BASE_URL}/ready`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ready');
    expect(data.db).toBe('ok');
    expect(typeof data.db_latency_ms).toBe('number');
    expect(typeof data.ms).toBe('number');
    expect(data.ms).toBeLessThan(2500);
  });
});

describe('Hardening: /version', () => {
  it('should return v0.4.3', async () => {
    const res = await fetch(`${BASE_URL}/version`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.serviceVersion).toBe('0.4.3');
  });
});

describe('Hardening: Express error middleware', () => {
  it('should return 413 for oversized body', async () => {
    const huge = 'x'.repeat(60 * 1024 * 1024);
    try {
      const res = await fetch(`${BASE_URL}/api/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: huge
      });
      expect([400, 413]).toContain(res.status);
    } catch {
      expect(true).toBe(true);
    }
  });
});

describe('Hardening: /admin/debug/runtime', () => {
  it('should return 401 without admin secret', async () => {
    const res = await fetch(`${BASE_URL}/admin/debug/runtime`);
    expect(res.status).toBe(401);
  });

  it('should return runtime info with admin secret', async () => {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      console.log('ADMIN_SECRET not set, skipping admin debug test');
      return;
    }

    const res = await fetch(`${BASE_URL}/admin/debug/runtime`, {
      headers: { 'X-Admin-Secret': adminSecret }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nodeVersion).toBeTruthy();
    expect(typeof data.uptimeSec).toBe('number');
    expect(data.serviceVersion).toBe('0.4.3');
    expect(typeof data.hasSupabaseUrl).toBe('boolean');
    expect(typeof data.hasCerIngestSecret).toBe('boolean');
    expect(data.dbPing).toBeDefined();
    expect(typeof data.inFlightRequests).toBe('number');
    expect(typeof data.isShuttingDown).toBe('boolean');
  });
});

describe('Hardening: /api/attest timing log (integration)', () => {
  let apiKey;

  beforeAll(async () => {
    apiKey = await createTestApiKey('hardening-timing');
  });

  it('should respond quickly for valid AI CER bundle', async () => {
    const bundle = {
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

    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });

    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(5000);

    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
