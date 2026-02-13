import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:5000';

function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function makeValidBundle() {
  const snapshot = {
    code: "function setup() { background(100); }",
    seed: "test-seed-123",
    vars: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  const bundleType = "cer.ai.execution.v1";
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

async function createTestApiKey() {
  const apiKey = `test-attest-key-${Date.now()}`;
  const keyHash = sha256(apiKey);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: dbUrl });

  await pool.query(`
    INSERT INTO accounts (user_id, monthly_limit)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET monthly_limit = $2
  `, ['test-attest-user', 100]);

  await pool.query(`
    INSERT INTO api_keys (key_hash, label, plan, status, monthly_limit, user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [keyHash, 'test-attest', 'free', 'active', 100, 'test-attest-user']);

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

describe('POST /api/attest', () => {
  let apiKey;

  beforeAll(async () => {
    apiKey = await createTestApiKey();
  });

  it('should return attestation for a valid bundle', async () => {
    const bundle = makeValidBundle();

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
    expect(data.attestationHash).toBeTruthy();
    expect(data.attestationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.nodeRuntimeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.protocolVersion).toBeTruthy();
    expect(data.attestedAt).toBeTruthy();
    expect(data.requestId).toBeTruthy();

    expect(response.headers.get('X-Quota-Limit')).toBeTruthy();
    expect(response.headers.get('X-Quota-Used')).toBeTruthy();
    expect(response.headers.get('X-Quota-Remaining')).toBeTruthy();
  });

  it('should return 400 for tampered certificateHash', async () => {
    const bundle = makeValidBundle();
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
    const bundle = makeValidBundle();
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
    const bundle = makeValidBundle();
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
      body: JSON.stringify({ bundleType: "cer.ai.execution.v1" })
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('INVALID_BUNDLE');
  });

  it('should return 401 without auth', async () => {
    const bundle = makeValidBundle();

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(401);
  });

  it('should return 429 when quota exceeded', async () => {
    const exhaustedKey = await createQuotaExhaustedApiKey();
    const bundle = makeValidBundle();

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
