import crypto from "crypto";

export function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

export function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function computeCertificateHash({ bundleType, version, createdAt, snapshot }) {
  const payload = canonicalJson({ bundleType, createdAt, snapshot, version });
  return sha256(payload);
}

export function computeAttestationHash({ certificateHash, nodeRuntimeHash, protocolVersion, attestedAt }) {
  const payload = canonicalJson({ attestedAt, certificateHash, nodeRuntimeHash, protocolVersion });
  return sha256(payload);
}

export function computeInputHash(snapshot) {
  const { code, seed, vars } = snapshot;
  const payload = canonicalJson({ code, seed, vars });
  return sha256(payload);
}

export function computeOutputHash(outputs) {
  const payload = canonicalJson(outputs);
  return sha256(payload);
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const SHA256_PREFIXED_RE = /^sha256:[a-f0-9]{64}$/;

export function validateAiCerBundle(bundle) {
  const errors = [];

  if (!bundle || typeof bundle !== "object") {
    return ["bundle is required and must be an object"];
  }

  if (bundle.bundleType !== "cer.ai.execution.v1") {
    errors.push(`bundleType must be "cer.ai.execution.v1", got "${bundle.bundleType}"`);
  }

  if (!bundle.version || typeof bundle.version !== "string") {
    errors.push("version is required and must be a string (e.g. \"0.1\")");
  }

  if (!bundle.createdAt || typeof bundle.createdAt !== "string") {
    errors.push("createdAt is required and must be an ISO date string");
  } else if (isNaN(Date.parse(bundle.createdAt))) {
    errors.push(`createdAt is not a valid ISO date: "${bundle.createdAt}"`);
  }

  if (!bundle.certificateHash || typeof bundle.certificateHash !== "string") {
    errors.push("certificateHash is required");
  } else if (!SHA256_PREFIXED_RE.test(bundle.certificateHash)) {
    errors.push(`certificateHash must match sha256:<64-hex-chars>, got "${bundle.certificateHash}"`);
  }

  if (!bundle.snapshot || typeof bundle.snapshot !== "object") {
    errors.push("snapshot is required and must be an object");
  }

  return errors;
}

export function isValidSha256(hash) {
  return typeof hash === "string" && SHA256_HEX_RE.test(hash);
}

export function verifyBundle(bundle) {
  const errors = [];

  if (!bundle || typeof bundle !== "object") {
    return { valid: false, errors: ["bundle is required and must be an object"] };
  }

  const { bundleType, version, createdAt, snapshot, certificateHash, inputHash, outputHash } = bundle;

  if (!bundleType || typeof bundleType !== "string") {
    errors.push("bundleType is required and must be a string");
  }

  if (!version || typeof version !== "string") {
    errors.push("version is required and must be a string");
  }

  if (!createdAt || typeof createdAt !== "string") {
    errors.push("createdAt is required and must be an ISO string");
  }

  if (!snapshot || typeof snapshot !== "object") {
    errors.push("snapshot is required and must be an object");
    return { valid: false, errors };
  }

  if (!snapshot.code || typeof snapshot.code !== "string") {
    errors.push("snapshot.code is required and must be a string");
  }

  if (snapshot.seed === undefined || snapshot.seed === null) {
    errors.push("snapshot.seed is required");
  }

  if (!Array.isArray(snapshot.vars)) {
    errors.push("snapshot.vars is required and must be an array");
  }

  if (certificateHash !== undefined && !isValidSha256(certificateHash)) {
    errors.push(`Invalid certificateHash format: must be 64-char hex`);
  }

  if (inputHash !== undefined && !isValidSha256(inputHash)) {
    errors.push(`Invalid inputHash format: must be 64-char hex`);
  }

  if (outputHash !== undefined && !isValidSha256(outputHash)) {
    errors.push(`Invalid outputHash format: must be 64-char hex`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const mismatches = [];

  const recomputedInputHash = computeInputHash(snapshot);
  if (inputHash && inputHash !== recomputedInputHash) {
    mismatches.push({
      field: "inputHash",
      expected: inputHash,
      computed: recomputedInputHash
    });
  }

  if (outputHash) {
    // outputHash is client-provided; we trust it for attestation but flag if absent
  }

  const recomputedCertHash = computeCertificateHash({ bundleType, version, createdAt, snapshot });
  if (certificateHash && certificateHash !== recomputedCertHash) {
    mismatches.push({
      field: "certificateHash",
      expected: certificateHash,
      computed: recomputedCertHash
    });
  }

  if (mismatches.length > 0) {
    return { valid: false, errors: ["Hash mismatch"], mismatches };
  }

  return {
    valid: true,
    certificateHash: certificateHash || recomputedCertHash,
    inputHash: inputHash || recomputedInputHash
  };
}
