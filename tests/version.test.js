import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const BASE_URL = 'http://localhost:5000';

describe('GET /version', () => {
  it('serviceVersion should match package.json version', async () => {
    const response = await fetch(`${BASE_URL}/version`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.serviceVersion).toBe(packageJson.version);
    expect(data.service).toBe('nexart-node');
    expect(data.sdkVersion).toBeTruthy();
    expect(data.sdkDependency).toBeTruthy();
    expect(data.protocolVersion).toBeTruthy();
    expect(data.serviceBuild).toBeTruthy();
    expect(data.nodeVersion).toBeTruthy();
    expect(data.timestamp).toBeTruthy();
  });
});

describe('GET /health', () => {
  it('version should match package.json version', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.version).toBe(packageJson.version);
    expect(data.status).toBe('ok');
    expect(data.node).toBe('nexart-canonical');
    expect(data.sdk_version).toBeTruthy();
    expect(data.protocol_version).toBeTruthy();
    expect(data.instance_id).toBeTruthy();
    expect(data.canvas).toBeDefined();
    expect(data.timestamp).toBeTruthy();
  });
});
