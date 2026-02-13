import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:5000';

function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function makeValidCodeModeBundle() {
  const snapshot = {
    code: "function setup() { background(100); }",
    seed: "test-seed-123",
    vars: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  const bundleType = "cer.codemode.v1";
  const version = "1.0.0";
  const createdAt = "2025-01-01T00:00:00.000Z";

  const inputHash = sha256(canonicalJson({ code: snapshot.code, seed: snapshot.seed, vars: snapshot.vars }));
  const certificateHash = sha256(canonicalJson({ bundleType, createdAt, snapshot, version }));

  return {
    bundleType,
    version,
    createdAt,
    snapshot,
    inputHash,
    certificateHash
  };
}

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

async function createTestApiKey(userSuffix = 'attest') {
  const apiKey = `test-${userSuffix}-key-${Date.now()}`;
  const keyHash = sha256(apiKey);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: dbUrl });

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

async function createQuotaExhaustedApiKey() {
  const apiKey = `test-quota-attest-${Date.now()}`;
  const keyHash = sha256(apiKey);

  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    INSERT INTO accounts (user_id, monthly_limit)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET monthly_limit = $2
  `, ['test-quota-attest-user', 1]);

  const result = await pool.query(`
    INSERT INTO api_keys (key_hash, label, plan, status, monthly_limit, user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [keyHash, 'test-quota-attest', 'free', 'active', 1, 'test-quota-attest-user']);

  const keyId = result.rows[0].id;

  await pool.query(`
    INSERT INTO usage_events (api_key_id, endpoint, status_code, duration_ms)
    VALUES ($1, $2, $3, $4)
  `, [keyId, '/api/attest', 200, 10]);

  await pool.end();
  return apiKey;
}

describe('POST /api/attest - Code Mode bundles', () => {
  let apiKey;

  beforeAll(async () => {
    apiKey = await createTestApiKey('codemode-attest');
  });

  it('should return attestation for a valid Code Mode bundle', async () => {
    const bundle = makeValidCodeModeBundle();

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.certificateHash).toBe(bundle.certificateHash);
    expect(data.attestation).toBeDefined();
    expect(data.attestation.attestedAt).toBeTruthy();
    expect(data.attestation.attestationId).toBeTruthy();
    expect(data.attestation.attestationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.attestation.nodeRuntimeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.attestation.protocolVersion).toBeTruthy();
    expect(data.attestation.requestId).toBeTruthy();
    expect(data.attestation.verified).toBe(true);

    expect(response.headers.get('X-Quota-Limit')).toBeTruthy();
    expect(response.headers.get('X-Quota-Used')).toBeTruthy();
    expect(response.headers.get('X-Quota-Remaining')).toBeTruthy();
  });

  it('should return 400 for tampered certificateHash', async () => {
    const bundle = makeValidCodeModeBundle();
    bundle.certificateHash = 'a'.repeat(64);

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.mismatches).toBeDefined();
    expect(data.mismatches.length).toBeGreaterThan(0);
    expect(data.mismatches[0].field).toBe('certificateHash');
  });

  it('should return 400 for tampered inputHash', async () => {
    const bundle = makeValidCodeModeBundle();
    bundle.inputHash = 'b'.repeat(64);

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.mismatches).toBeDefined();
    expect(data.mismatches[0].field).toBe('inputHash');
  });

  it('should return 400 for invalid hash format', async () => {
    const bundle = makeValidCodeModeBundle();
    bundle.certificateHash = 'not-a-valid-hash';

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details).toBeDefined();
    expect(data.details.some(d => d.includes('certificateHash'))).toBe(true);
  });

  it('should return 400 for missing required fields', async () => {
    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ bundleType: "cer.codemode.v1" })
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
  });

  it('should return 401 without auth', async () => {
    const bundle = makeValidCodeModeBundle();

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(401);
  });

  it('should return 429 when quota exceeded', async () => {
    const exhaustedKey = await createQuotaExhaustedApiKey();
    const bundle = makeValidCodeModeBundle();

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${exhaustedKey}`
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(429);

    const data = await response.json();
    expect(data.error).toBe('QUOTA_EXCEEDED');
    expect(response.headers.get('X-Quota-Limit')).toBeTruthy();
    expect(response.headers.get('X-Quota-Used')).toBeTruthy();
    expect(response.headers.get('X-Quota-Remaining')).toBe('0');
  });
});

describe('POST /api/attest - AI CER bundles', () => {
  let apiKey;

  beforeAll(async () => {
    apiKey = await createTestApiKey('ai-cer-attest');
  });

  it('should return 200 for a valid AI CER bundle', async () => {
    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(AI_CER_FIXTURE)
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.bundleType).toBe('cer.ai.execution.v1');
    expect(data.certificateHash).toBe(AI_CER_FIXTURE.certificateHash);

    expect(data.attestation).toBeDefined();
    expect(data.attestation.attestedAt).toBeTruthy();
    expect(data.attestation.attestationId).toBeTruthy();
    expect(data.attestation.bundleType).toBe('cer.ai.execution.v1');
    expect(data.attestation.certificateHash).toBe(AI_CER_FIXTURE.certificateHash);
    expect(data.attestation.nodeRuntimeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.attestation.protocolVersion).toBeTruthy();
    expect(data.attestation.requestId).toBeTruthy();
    expect(data.attestation.verified).toBe(true);
    expect(data.attestation.checks).toContain('snapshot_hashes');
    expect(data.attestation.checks).toContain('certificate_hash');

    expect(response.headers.get('X-Quota-Limit')).toBeTruthy();
    expect(response.headers.get('X-Quota-Used')).toBeTruthy();
    expect(response.headers.get('X-Quota-Remaining')).toBeTruthy();
  });

  it('should return 400 for tampered AI CER output', async () => {
    const tampered = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    tampered.snapshot.output = "TAMPERED OUTPUT";

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(tampered)
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details).toBeDefined();
    expect(Array.isArray(data.details)).toBe(true);
    expect(data.details.length).toBeGreaterThan(0);
  });

  it('should return 400 for invalid AI CER certificateHash format', async () => {
    const bad = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    bad.certificateHash = "not-a-valid-hash";

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bad)
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details).toBeDefined();
    expect(data.details.some(d => d.includes('certificateHash'))).toBe(true);
  });

  it('should return 400 for tampered AI CER certificateHash', async () => {
    const tampered = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    tampered.certificateHash = "sha256:" + "a".repeat(64);

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(tampered)
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details).toBeDefined();
    expect(data.details.some(d => d.includes('certificateHash'))).toBe(true);
  });

  it('should return 400 (not 500) for missing version', async () => {
    const bad = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    delete bad.version;

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bad)
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details.some(d => d.includes('version'))).toBe(true);
  });

  it('should return 400 (not 500) for missing createdAt', async () => {
    const bad = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    delete bad.createdAt;

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bad)
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details.some(d => d.includes('createdAt'))).toBe(true);
  });

  it('should return 400 (not 500) for missing snapshot', async () => {
    const bad = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    delete bad.snapshot;

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bad)
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details.some(d => d.includes('snapshot'))).toBe(true);
  });

  it('should return 400 (not 500) for bad certificateHash format', async () => {
    const bad = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    bad.certificateHash = "badhash";

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bad)
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
    expect(data.details.some(d => d.includes('certificateHash'))).toBe(true);
  });

  it('should attest OK when meta field is absent', async () => {
    const noMeta = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    delete noMeta.meta;

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(noMeta)
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.bundleType).toBe('cer.ai.execution.v1');
  });

  it('should handle null optional fields without crashing', async () => {
    const withNulls = JSON.parse(JSON.stringify(AI_CER_FIXTURE));
    withNulls.meta = null;

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(withNulls)
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });
});
