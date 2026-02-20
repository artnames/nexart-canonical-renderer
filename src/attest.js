import crypto from "crypto";

export function canonicalize(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number not allowed in canonical JSON: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalize(item));
    return "[" + items.join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map(key => {
      const val = value[key];
      if (val === undefined) {
        return null;
      }
      return JSON.stringify(key) + ":" + canonicalize(val);
    }).filter(e => e !== null);
    return "{" + entries.join(",") + "}";
  }
  throw new Error(`Unsupported type for canonical JSON: ${typeof value}`);
}

export function canonicalJson(obj) {
  return canonicalize(obj);
}

export function sha256hex(data) {
  return crypto.createHash("sha256").update(data, "utf-8").digest("hex");
}

export function sha256(data) {
  return `sha256:${sha256hex(data)}`;
}

export function toNormalizedHash(hash) {
  if (!hash || typeof hash !== "string") return null;
  if (hash.startsWith("sha256:")) return hash;
  if (/^[a-f0-9]{64}$/.test(hash)) return `sha256:${hash}`;
  return null;
}

export function extractHex(hash) {
  if (!hash || typeof hash !== "string") return null;
  if (hash.startsWith("sha256:")) return hash.slice(7);
  if (/^[a-f0-9]{64}$/.test(hash)) return hash;
  return null;
}

const SHA256_NORMALIZED_RE = /^sha256:[a-f0-9]{64}$/;

export function isValidSha256(hash) {
  return typeof hash === "string" && SHA256_NORMALIZED_RE.test(hash);
}

export function computeCertificateHash({ bundleType, version, createdAt, snapshot }) {
  const payload = canonicalize({ bundleType, createdAt, snapshot, version });
  return sha256(payload);
}

export function computeAttestationHash({ certificateHash, nodeRuntimeHash, protocolVersion, attestedAt }) {
  const payload = canonicalize({ attestedAt, certificateHash, nodeRuntimeHash, protocolVersion });
  return sha256(payload);
}

export function computeCodeModeInputHash(snapshot) {
  const { code, seed, vars } = snapshot;
  const payload = canonicalize({ code, seed, vars });
  return sha256(payload);
}

export function computeOutputHash(outputs) {
  const payload = canonicalize(outputs);
  return sha256(payload);
}

export function computeAiInputHash(input) {
  if (typeof input === "string") {
    return `sha256:${sha256hex(input)}`;
  }
  return sha256(canonicalize(input));
}

export function computeAiOutputHash(output) {
  if (typeof output === "string") {
    return `sha256:${sha256hex(output)}`;
  }
  return sha256(canonicalize(output));
}

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
  } else if (!SHA256_NORMALIZED_RE.test(bundle.certificateHash)) {
    errors.push(`certificateHash must match sha256:<64-hex-chars>, got "${bundle.certificateHash}"`);
  }

  if (!bundle.snapshot || typeof bundle.snapshot !== "object") {
    errors.push("snapshot is required and must be an object");
  }

  return errors;
}

export function verifyCodeModeBundle(bundle) {
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
    errors.push(`Invalid certificateHash format: must be sha256:<64-hex-chars>`);
  }

  if (inputHash !== undefined && !isValidSha256(inputHash)) {
    errors.push(`Invalid inputHash format: must be sha256:<64-hex-chars>`);
  }

  if (outputHash !== undefined && !isValidSha256(outputHash)) {
    errors.push(`Invalid outputHash format: must be sha256:<64-hex-chars>`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const mismatches = [];

  const recomputedInputHash = computeCodeModeInputHash(snapshot);
  if (inputHash && inputHash !== recomputedInputHash) {
    mismatches.push({
      field: "inputHash",
      expected: inputHash,
      computed: recomputedInputHash
    });
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

export function verifyAiExecBundle(bundle) {
  const errors = [];

  if (!bundle || typeof bundle !== "object") {
    return { valid: false, errors: ["bundle is required and must be an object"] };
  }

  const validationErrors = validateAiCerBundle(bundle);
  if (validationErrors.length > 0) {
    return { valid: false, errors: validationErrors };
  }

  const { snapshot } = bundle;

  if (snapshot.inputHash) {
    const recomputedInputHash = computeAiInputHash(snapshot.input);
    if (snapshot.inputHash !== recomputedInputHash) {
      errors.push(`inputHash mismatch: expected ${snapshot.inputHash}, got ${recomputedInputHash}`);
    }
  }

  if (snapshot.outputHash) {
    const recomputedOutputHash = computeAiOutputHash(snapshot.output);
    if (snapshot.outputHash !== recomputedOutputHash) {
      errors.push(`outputHash mismatch: expected ${snapshot.outputHash}, got ${recomputedOutputHash}`);
    }
  }

  const recomputedCertHash = computeCertificateHash({
    bundleType: bundle.bundleType,
    version: bundle.version,
    createdAt: bundle.createdAt,
    snapshot: bundle.snapshot
  });

  if (bundle.certificateHash !== recomputedCertHash) {
    errors.push(`certificateHash mismatch: expected ${bundle.certificateHash}, got ${recomputedCertHash}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    certificateHash: bundle.certificateHash,
    inputHash: snapshot.inputHash || null,
    outputHash: snapshot.outputHash || null
  };
}

export const verifyBundle = verifyCodeModeBundle;
