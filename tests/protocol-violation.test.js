import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = 'http://localhost:5000';

describe('Protocol Violation: createCanvas()', () => {
  it('should return 400 PROTOCOL_VIOLATION when code uses createCanvas()', async () => {
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `function setup() { createCanvas(800, 600); background(100); }`,
        seed: 'test-seed',
        vars: [50]
      })
    });

    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toBe('PROTOCOL_VIOLATION');
    expect(data.message).toContain('createCanvas() is not allowed');
    expect(data.message).toContain('1950x2400');
  });

  it('should return 400 PROTOCOL_VIOLATION on /verify when code uses createCanvas()', async () => {
    const response = await fetch(`${BASE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot: {
          code: `function setup() { createCanvas(400, 400); ellipse(200, 200, 100); }`,
          seed: 'test-seed',
          vars: [50]
        },
        expectedHash: 'somehash'
      })
    });

    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toBe('PROTOCOL_VIOLATION');
    expect(data.message).toContain('createCanvas() is not allowed');
    expect(data.verified).toBe(false);
  });

  it('should succeed when code does NOT use createCanvas()', async () => {
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `function setup() { background(100); ellipse(width/2, height/2, 200); }`,
        seed: 'test-seed',
        vars: [50]
      })
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.type).toBe('static');
    expect(data.imageHash).toBeDefined();
  });
});
