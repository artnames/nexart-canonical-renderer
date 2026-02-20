import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:5000';

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(v => canonicalize(v)).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map(k => {
      if (value[k] === undefined) return null;
      return JSON.stringify(k) + ":" + canonicalize(value[k]);
    }).filter(e => e !== null);
    return "{" + entries.join(",") + "}";
  }
  throw new Error(`Unsupported type: ${typeof value}`);
}

function sha256hex(data) {
  return crypto.createHash("sha256").update(data, "utf-8").digest("hex");
}

function sha256(data) {
  return `sha256:${sha256hex(data)}`;
}

function makeValidCodeModeBundle(suffix = '') {
  const snapshot = {
    code: `function setup() { background(${100 + suffix.length}); }`,
    seed: `proof-test-seed-${suffix || Date.now()}`,
    vars: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  const bundleType = "cer.codemode.v1";
  const version = suffix ? `1.0.0-${suffix}` : "1.0.0";
  const createdAt = "2025-01-01T00:00:00.000Z";

  const inputHash = sha256(canonicalize({ code: snapshot.code, seed: snapshot.seed, vars: snapshot.vars }));
  const certificateHash = sha256(canonicalize({ bundleType, createdAt, snapshot, version }));

  return { bundleType, version, createdAt, snapshot, inputHash, certificateHash };
}

async function createTestApiKey(userSuffix) {
  const apiKey = `test-${userSuffix}-key-${Date.now()}`;
  const keyHash = sha256hex(apiKey);

  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });

  const userId = `test-${userSuffix}-user`;

  await pool.query(`
    INSERT INTO accounts (user_id, monthly_limit)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET monthly_limit = $2
  `, [userId, 1000]);

  await pool.query(`
    INSERT INTO api_keys (key_hash, label, plan, status, monthly_limit, user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [keyHash, `test-${userSuffix}`, 'free', 'active', 1000, userId]);

  await pool.end();
  return apiKey;
}

async function getProofFromDb(certificateHash) {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  const result = await pool.query(
    `SELECT * FROM cer_proofs WHERE certificate_hash = $1`,
    [certificateHash]
  );
  await pool.end();
  return result.rows[0] || null;
}

async function countProofsForHash(certificateHash) {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  const result = await pool.query(
    `SELECT COUNT(*)::int as count FROM cer_proofs WHERE certificate_hash = $1`,
    [certificateHash]
  );
  await pool.end();
  return result.rows[0].count;
}

describe('Proof Ledger - /api/attest inserts', () => {
  let apiKey;

  beforeAll(async () => {
    apiKey = await createTestApiKey('proof-ledger');
  });

  it('should create exactly 1 cer_proofs row on successful Code Mode attest', async () => {
    const bundle = makeValidCodeModeBundle('codemode-proof');

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
    expect(data.attestationId).toBeTruthy();
    expect(data.nodeRuntimeHash).toBeTruthy();
    expect(data.protocolVersion).toBeTruthy();
    expect(response.headers.get('X-Certificate-Hash')).toBe(bundle.certificateHash);

    await new Promise(r => setTimeout(r, 500));

    const proof = await getProofFromDb(bundle.certificateHash);
    expect(proof).not.toBeNull();
    expect(proof.bundle_type).toBe(bundle.bundleType);
    expect(proof.certificate_hash).toBe(bundle.certificateHash);
    expect(proof.status).toBe('ATTESTED');
    expect(proof.attestation_id).toBeTruthy();
    expect(proof.node_runtime_hash).toBeTruthy();
    expect(proof.protocol_version).toBeTruthy();
  });

  it('should create 0 cer_proofs rows for a negotiation probe', async () => {
    const bundle = makeValidCodeModeBundle('probe-test');

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Nexart-Negotiation': '1'
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(200);

    await new Promise(r => setTimeout(r, 500));

    const proof = await getProofFromDb(bundle.certificateHash);
    expect(proof).toBeNull();
  });

  it('should create 0 cer_proofs rows for a 400 hash-mismatch', async () => {
    const bundle = makeValidCodeModeBundle('mismatch-test');
    bundle.certificateHash = 'sha256:' + 'a'.repeat(64);

    const response = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });

    expect(response.status).toBe(400);

    await new Promise(r => setTimeout(r, 500));

    const proof = await getProofFromDb('sha256:' + 'a'.repeat(64));
    expect(proof).toBeNull();
  });

  it('should NOT create duplicate rows on repeated successful attest', async () => {
    const bundle = makeValidCodeModeBundle('dedup-test');

    const res1 = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });
    expect(res1.status).toBe(200);

    await new Promise(r => setTimeout(r, 500));

    const res2 = await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bundle)
    });
    expect(res2.status).toBe(200);

    await new Promise(r => setTimeout(r, 500));

    const count = await countProofsForHash(bundle.certificateHash);
    expect(count).toBe(1);
  });
});

describe('Proof Ledger - GET /api/proofs', () => {
  let apiKey;
  let testBundle;

  beforeAll(async () => {
    apiKey = await createTestApiKey('proof-read');
    testBundle = makeValidCodeModeBundle('read-test');

    await fetch(`${BASE_URL}/api/attest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(testBundle)
    });

    await new Promise(r => setTimeout(r, 500));
  });

  it('GET /api/proofs/:certificateHash returns the proof', async () => {
    const response = await fetch(`${BASE_URL}/api/proofs/${testBundle.certificateHash}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.certificate_hash).toBe(testBundle.certificateHash);
    expect(data.status).toBe('ATTESTED');
  });

  it('GET /api/proofs/:certificateHash returns 404 for unknown hash', async () => {
    const response = await fetch(`${BASE_URL}/api/proofs/${'f'.repeat(64)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    expect(response.status).toBe(404);
  });

  it('GET /api/proofs returns a list', async () => {
    const response = await fetch(`${BASE_URL}/api/proofs?limit=10`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.proofs)).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });
});
