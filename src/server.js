import express from "express";
import cors from "cors";
import { createCanvas } from "canvas";
import crypto from "crypto";
import { renderLoop } from "./render-loop.js";
import { extendP5Runtime } from "./p5-extensions.js";
import { getVersionInfo } from "./version.js";
import { runMigrations, logUsageEvent, getUsageToday, getUsageMonth, getAccountQuota, getQuotaResetDate, pingDatabase, closePool } from "./db.js";
import { verifyBundle, computeAttestationHash, sha256, canonicalJson } from "./attest.js";
import { verifyCer } from "@nexart/ai-execution";
import { createAuthMiddleware, requireAdmin, createUsageLogger } from "./auth.js";
import {
  createP5Runtime,
  injectTimeVariables,
  injectProtocolVariables,
  CODE_MODE_PROTOCOL_VERSION,
  SDK_VERSION as SDK_VERSION_FROM_SDK
} from "@nexart/codemode-sdk/node";
import { createRequire } from "module";

const requireJson = createRequire(import.meta.url);
const packageJson = requireJson("../package.json");

const app = express();

// CORS configuration - allow all origins for demo
// For production, replace with specific origins:
// const allowedOrigins = ['https://your-app.lovable.app', 'https://another.domain.com'];
// app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests for all routes
app.options('*', cors());
const PORT = process.env.PORT || 5000;

const CANVAS_WIDTH = 1950;
const CANVAS_HEIGHT = 2400;
const NODE_VERSION = packageJson.version || "0.2.0";
const SDK_VERSION = SDK_VERSION_FROM_SDK || "1.8.4";
const INSTANCE_ID = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "unknown";

// Single source of truth for default protocol version
// Can be overridden via env var, falls back to SDK constant or hardcoded default
const DEFAULT_PROTOCOL_VERSION = process.env.PROTOCOL_VERSION ?? CODE_MODE_PROTOCOL_VERSION ?? "1.2.0";

// Supported protocol versions (for validation when provided)
const SUPPORTED_PROTOCOL_VERSIONS = ["1.0.0", "1.1.0", "1.2.0"];

const apiKeyAuth = createAuthMiddleware();
const logUsage = createUsageLogger(SDK_VERSION, DEFAULT_PROTOCOL_VERSION, CANVAS_WIDTH, CANVAS_HEIGHT);

let serverReady = false;
let inFlightRequests = 0;
let isShuttingDown = false;

const REQUIRED_ENV_VARS = ["DATABASE_URL"];

function checkRequiredEnvVars() {
  const missing = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
  return { ok: missing.length === 0, missing };
}

function requestCounterMiddleware(req, res, next) {
  if (isShuttingDown) {
    return res.status(503).json({ error: "SERVICE_UNAVAILABLE", message: "Server is shutting down" });
  }
  
  inFlightRequests++;
  
  const cleanup = () => {
    inFlightRequests--;
  };
  
  res.on("finish", cleanup);
  res.on("close", cleanup);
  
  next();
}

function requestLoggingMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path.startsWith("/api/")) {
      console.log(`[REQ] instance=${INSTANCE_ID} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  
  next();
}

function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function executeSnapshot(snapshot) {
  const { code, seed, vars = [] } = snapshot;

  const numericSeed =
    typeof seed === "string"
      ? seed.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0)
      : (seed ?? 0) >>> 0;

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  
  const p = createP5Runtime(canvas, CANVAS_WIDTH, CANVAS_HEIGHT, { seed: numericSeed });
  extendP5Runtime(p, canvas);

  const normalizedVars = new Array(10).fill(0);
  if (Array.isArray(vars)) {
    for (let i = 0; i < Math.min(vars.length, 10); i++) {
      const v = vars[i];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) {
        normalizedVars[i] = v;
      }
    }
  }
  
  injectProtocolVariables(p, normalizedVars);
  
  // Inject time variables for setup() with frameCount: 0
  injectTimeVariables(p, {
    frameCount: 0,
    t: 0,
    time: 0,
    tGlobal: 0,
  });

  // Extract setup() body
  const setupMatch = code.match(
    /function\s+setup\s*\(\s*\)\s*\{([\s\S]*?)\}(?=\s*function|\s*$)/
  );
  const setupCode = setupMatch ? setupMatch[1].trim() : code;

  const wrappedSetup = new Function(
    "p",
    "VAR",
    "frameCount",
    "t",
    "time",
    "tGlobal",
    `with(p) { ${setupCode} }`
  );

  // Run setup() once
  wrappedSetup(p, p.VAR, 0, 0, 0, 0);

  // Extract draw() body and run once if it exists
  const drawMatch = code.match(
    /function\s+draw\s*\(\s*\)\s*\{([\s\S]*?)\}(?=\s*function|\s*$)/
  );
  
  if (drawMatch) {
    const drawCode = drawMatch[1].trim();
    
    // Inject time variables for draw() with frameCount: 1
    injectTimeVariables(p, {
      frameCount: 1,
      t: 0,
      time: 0,
      tGlobal: 0,
    });
    
    const wrappedDraw = new Function(
      "p",
      "VAR",
      "frameCount",
      "t",
      "time",
      "tGlobal",
      `with(p) { ${drawCode} }`
    );
    
    // Run draw() once for static mode
    wrappedDraw(p, p.VAR, 1, 0, 0, 0);
  }

  return { canvas, numericSeed, normalizedVars, codeLength: code.length };
}

app.use(express.json({ limit: "10mb" }));
app.use(requestCounterMiddleware);
app.use(requestLoggingMiddleware);

app.get("/ready", async (req, res) => {
  const identity = {
    node: "nexart-canonical",
    version: NODE_VERSION,
    sdk_version: SDK_VERSION,
    protocol_version: DEFAULT_PROTOCOL_VERSION,
    instance_id: INSTANCE_ID
  };

  const envCheck = checkRequiredEnvVars();
  if (!envCheck.ok) {
    return res.status(503).json({
      status: "not_ready",
      reason: "missing_database_url",
      db: "fail",
      ...identity
    });
  }

  if (!serverReady) {
    return res.status(503).json({
      status: "not_ready",
      reason: "server_not_initialized",
      db: "fail",
      ...identity
    });
  }

  const dbPing = await pingDatabase(1500);
  if (!dbPing.ok) {
    return res.status(503).json({
      status: "not_ready",
      reason: "db_ping_failed",
      db: "fail",
      ...identity
    });
  }

  res.json({
    status: "ready",
    db: "ok",
    db_latency_ms: dbPing.latencyMs,
    ...identity
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    node: "nexart-canonical",
    version: NODE_VERSION,
    sdk_version: SDK_VERSION,
    protocol_version: DEFAULT_PROTOCOL_VERSION,
    instance_id: INSTANCE_ID,
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    timestamp: new Date().toISOString(),
  });
});

app.get("/version", (req, res) => {
  const versionInfo = getVersionInfo();
  res.json({
    service: versionInfo.service,
    serviceVersion: versionInfo.serviceVersion,
    sdkVersion: versionInfo.sdkVersion,
    sdkDependency: versionInfo.sdkDependency,
    // Use server's default protocol version as the authoritative source
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    serviceBuild: versionInfo.serviceBuild,
    nodeVersion: versionInfo.nodeVersion,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/render", apiKeyAuth, async (req, res) => {
  const startTime = req.startTime || Date.now();
  let runtimeHash = null;

  try {
    const { code, seed, VAR, width, height, protocolVersion: requestedProtocolVersion } = req.body;

    // ========== Protocol Version Normalization ==========
    // Lenient defaulting: if protocolVersion missing, use server default
    const resolvedProtocolVersion = requestedProtocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    const protocolVersionWasDefaulted = !requestedProtocolVersion;

    // ========== Account-Level Quota Enforcement ==========
    const userId = req.apiKey?.userId;
    const quota = await getAccountQuota(userId);

    // Set enforcement status header
    if (quota.enforced === false) {
      res.set("X-Quota-Enforced", "false");
    }

    if (quota.exceeded) {
      const resetAt = await getQuotaResetDate();
      res.set("X-Quota-Limit", String(quota.limit));
      res.set("X-Quota-Used", String(quota.used));
      res.set("X-Quota-Remaining", "0");
      res.set("X-Protocol-Version", resolvedProtocolVersion);
      if (protocolVersionWasDefaulted) {
        res.set("X-Protocol-Defaulted", "true");
      }

      logUsage(req, res.status(429), null, "QUOTA_EXCEEDED", resolvedProtocolVersion, protocolVersionWasDefaulted);
      return res.json({
        error: "QUOTA_EXCEEDED",
        message: "Monthly certified run quota exceeded",
        limit: quota.limit,
        used: quota.used,
        resetAt
      });
    }
    // ====================================================

    // Validate protocol version if explicitly provided
    if (requestedProtocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(requestedProtocolVersion)) {
      logUsage(req, res.status(400), null, "unsupported_protocol_version", resolvedProtocolVersion, protocolVersionWasDefaulted);
      return res.json({
        error: "PROTOCOL_VIOLATION",
        message: `Unsupported protocol version: ${requestedProtocolVersion}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      });
    }
    // ====================================================

    if (!code || typeof code !== "string") {
      logUsage(req, res.status(400), null, "code_required", resolvedProtocolVersion, protocolVersionWasDefaulted);
      return res.json({
        error: "INVALID_REQUEST",
        message: "code is required and must be a string",
      });
    }

    if (width && width !== CANVAS_WIDTH) {
      logUsage(req, res.status(400), null, "invalid_width", resolvedProtocolVersion, protocolVersionWasDefaulted);
      return res.json({
        error: "PROTOCOL_VIOLATION",
        message: `Canvas width must be ${CANVAS_WIDTH}, got ${width}`,
      });
    }

    if (height && height !== CANVAS_HEIGHT) {
      logUsage(req, res.status(400), null, "invalid_height", resolvedProtocolVersion, protocolVersionWasDefaulted);
      return res.json({
        error: "PROTOCOL_VIOLATION",
        message: `Canvas height must be ${CANVAS_HEIGHT}, got ${height}`,
      });
    }

    const vars = Array.isArray(VAR) ? VAR : new Array(10).fill(0);

    const snapshot = { code, seed: seed || "default", vars };
    const { canvas } = executeSnapshot(snapshot);

    const pngBuffer = canvas.toBuffer("image/png");
    runtimeHash = computeHash(pngBuffer);

    // ========== Response Headers ==========
    if (req.meteringSkipped) {
      res.set("X-NexArt-Metering", "skipped");
    }
    // Always set resolved protocol version
    res.set("X-Protocol-Version", resolvedProtocolVersion);
    // Set defaulted flag header when protocol version was not provided
    if (protocolVersionWasDefaulted) {
      res.set("X-Protocol-Defaulted", "true");
    }
    // Quota headers (used + 1 since this render will be logged as success)
    res.set("X-Quota-Limit", String(quota.limit));
    res.set("X-Quota-Used", String(quota.used + 1));
    res.set("X-Quota-Remaining", String(Math.max(0, quota.remaining - 1)));
    // ======================================

    const acceptHeader = req.get("Accept") || "";
    if (acceptHeader.includes("application/json")) {
      res.json({
        pngBase64: pngBuffer.toString("base64"),
        runtimeHash,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        sdkVersion: SDK_VERSION,
        protocolVersion: resolvedProtocolVersion,
        protocolVersionSource: protocolVersionWasDefaulted ? "defaulted" : "request",
        executionTimeMs: Date.now() - startTime,
      });
    } else {
      res.set("Content-Type", "image/png");
      res.set("X-Runtime-Hash", runtimeHash);
      res.set("X-SDK-Version", SDK_VERSION);
      res.send(pngBuffer);
    }
    
    if (!req.meteringSkipped) {
      logUsage(req, res, runtimeHash, null, resolvedProtocolVersion, protocolVersionWasDefaulted);
    }
  } catch (error) {
    // For error cases, use default protocol version since we may not have parsed request
    const errorProtocolVersion = DEFAULT_PROTOCOL_VERSION;
    
    if (error.message && error.message.startsWith("PROTOCOL_VIOLATION:")) {
      if (!req.meteringSkipped) {
        logUsage(req, res.status(400), null, error.message, errorProtocolVersion, true);
      }
      res.set("X-Protocol-Version", errorProtocolVersion);
      return res.json({
        error: "PROTOCOL_VIOLATION",
        message: error.message.replace("PROTOCOL_VIOLATION: ", ""),
      });
    }
    
    if (!req.meteringSkipped) {
      logUsage(req, res.status(500), null, error.message, errorProtocolVersion, true);
    }
    res.set("X-Protocol-Version", errorProtocolVersion);
    res.json({
      error: "RENDER_ERROR",
      message: error.message,
    });
  }
});

// ========== /api/attest - CER Bundle Attestation ==========
// Supports two bundle types:
//   1. Code Mode bundles (existing behavior, raw hex hashes)
//   2. AI Execution CER bundles (bundleType === "cer.ai.execution.v1", sha256:… hashes)
app.post("/api/attest", apiKeyAuth, async (req, res) => {
  const startTime = req.startTime || Date.now();
  const requestId = crypto.randomUUID();

  try {
    // ========== Quota enforcement (same as /api/render) ==========
    const userId = req.apiKey?.userId;
    const quota = await getAccountQuota(userId);

    if (quota.enforced === false) {
      res.set("X-Quota-Enforced", "false");
    }

    if (quota.exceeded) {
      const resetAt = await getQuotaResetDate();
      res.set("X-Quota-Limit", String(quota.limit));
      res.set("X-Quota-Used", String(quota.used));
      res.set("X-Quota-Remaining", "0");

      logUsageEvent({
        apiKeyId: req.apiKey?.id || null,
        endpoint: "/api/attest",
        statusCode: 429,
        durationMs: Date.now() - startTime,
        error: "QUOTA_EXCEEDED"
      });

      return res.status(429).json({
        error: "QUOTA_EXCEEDED",
        message: "Monthly certified run quota exceeded",
        limit: quota.limit,
        used: quota.used,
        resetAt
      });
    }

    // ========== Bundle validation ==========
    const bundle = req.body;

    if (!bundle || typeof bundle !== "object") {
      logUsageEvent({
        apiKeyId: req.apiKey?.id || null,
        endpoint: "/api/attest",
        statusCode: 400,
        durationMs: Date.now() - startTime,
        error: "INVALID_REQUEST"
      });

      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Request body must be a CER bundle object"
      });
    }

    const isAiCer = bundle.bundleType === "cer.ai.execution.v1";

    // ========== Node runtime hash (shared by both paths) ==========
    const nodeRuntimeHash = sha256(canonicalJson({
      node: "nexart-canonical",
      version: NODE_VERSION,
      sdk_version: SDK_VERSION,
      instance_id: INSTANCE_ID
    }));

    const attestedAt = new Date().toISOString();

    if (isAiCer) {
      // ========== AI Execution CER path ==========
      const result = verifyCer(bundle);

      if (!result.ok) {
        res.set("X-Quota-Limit", String(quota.limit));
        res.set("X-Quota-Used", String(quota.used));
        res.set("X-Quota-Remaining", String(Math.max(0, quota.remaining)));

        logUsageEvent({
          apiKeyId: req.apiKey?.id || null,
          endpoint: "/api/attest",
          statusCode: 400,
          durationMs: Date.now() - startTime,
          error: "INVALID_BUNDLE"
        });

        return res.status(400).json({
          error: "INVALID_BUNDLE",
          details: result.errors
        });
      }

      const attestationHash = computeAttestationHash({
        certificateHash: bundle.certificateHash,
        nodeRuntimeHash,
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        attestedAt
      });

      res.set("X-Quota-Limit", String(quota.limit));
      res.set("X-Quota-Used", String(quota.used + 1));
      res.set("X-Quota-Remaining", String(Math.max(0, quota.remaining - 1)));

      logUsageEvent({
        apiKeyId: req.apiKey?.id || null,
        endpoint: "/api/attest",
        statusCode: 200,
        durationMs: Date.now() - startTime,
        error: null
      });

      return res.json({
        ok: true,
        bundleType: bundle.bundleType,
        certificateHash: bundle.certificateHash,
        attestation: {
          attestedAt,
          attestationId: requestId,
          bundleType: bundle.bundleType,
          certificateHash: bundle.certificateHash,
          nodeRuntimeHash,
          protocolVersion: DEFAULT_PROTOCOL_VERSION,
          requestId,
          verified: true,
          checks: ["snapshot_hashes", "certificate_hash"]
        }
      });
    }

    // ========== Code Mode bundle path (existing behavior) ==========
    const verification = verifyBundle(bundle);

    if (!verification.valid) {
      res.set("X-Quota-Limit", String(quota.limit));
      res.set("X-Quota-Used", String(quota.used));
      res.set("X-Quota-Remaining", String(Math.max(0, quota.remaining)));

      logUsageEvent({
        apiKeyId: req.apiKey?.id || null,
        endpoint: "/api/attest",
        statusCode: 400,
        durationMs: Date.now() - startTime,
        error: "INVALID_BUNDLE"
      });

      return res.status(400).json({
        error: "INVALID_BUNDLE",
        details: verification.errors,
        mismatches: verification.mismatches || undefined
      });
    }

    const attestationHash = computeAttestationHash({
      certificateHash: verification.certificateHash,
      nodeRuntimeHash,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      attestedAt
    });

    res.set("X-Quota-Limit", String(quota.limit));
    res.set("X-Quota-Used", String(quota.used + 1));
    res.set("X-Quota-Remaining", String(Math.max(0, quota.remaining - 1)));

    logUsageEvent({
      apiKeyId: req.apiKey?.id || null,
      endpoint: "/api/attest",
      statusCode: 200,
      durationMs: Date.now() - startTime,
      error: null
    });

    return res.json({
      ok: true,
      bundleType: bundle.bundleType || "codemode",
      certificateHash: verification.certificateHash,
      attestation: {
        attestedAt,
        attestationId: requestId,
        bundleType: bundle.bundleType || "codemode",
        certificateHash: verification.certificateHash,
        attestationHash,
        nodeRuntimeHash,
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        requestId,
        verified: true,
        checks: ["input_hash", "certificate_hash"]
      }
    });
  } catch (error) {
    console.error("[ATTEST] Error:", error.message);

    logUsageEvent({
      apiKeyId: req.apiKey?.id || null,
      endpoint: "/api/attest",
      statusCode: 500,
      durationMs: Date.now() - startTime,
      error: error.message
    });

    return res.status(500).json({
      error: "ATTESTATION_ERROR",
      message: error.message
    });
  }
});

function detectLoopMode(code, execution) {
  if (execution && execution.mode === "loop") {
    return true;
  }
  const hasDrawFunction = /function\s+draw\s*\(\s*\)\s*\{/.test(code);
  return hasDrawFunction && execution && execution.totalFrames > 1;
}

app.post("/render", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(410).json({
      error: "GONE",
      message: "Use /api/render with API key authentication. This endpoint is disabled in production."
    });
  }

  const startTime = Date.now();

  try {
    const snapshot = req.body;

    if (!snapshot || typeof snapshot !== "object") {
      return res.status(400).json({
        error: "INVALID_SNAPSHOT",
        message: "Request body must be a valid MintSnapshotV1 object",
      });
    }

    if (typeof snapshot.code !== "string" || !snapshot.code.trim()) {
      return res.status(400).json({
        error: "INVALID_CODE",
        message: "Snapshot must include valid code string",
      });
    }

    const { code, seed, vars, execution } = snapshot;
    const isLoopMode = detectLoopMode(code, execution);

    if (isLoopMode) {
      const totalFrames = execution?.totalFrames || 120;
      const fps = execution?.fps || 30;

      if (totalFrames < 2) {
        return res.status(400).json({
          error: "LOOP_MODE_ERROR",
          message: "Loop mode requires totalFrames >= 2",
        });
      }

      console.log(`[LOOP MODE] Rendering ${totalFrames} frames at ${fps}fps`);

      const result = await renderLoop({
        code,
        seed,
        vars,
        totalFrames,
        fps,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      });

      const executionTime = Date.now() - startTime;

      return res.json({
        type: "animation",
        mime: "video/mp4",
        imageHash: result.posterHash,
        imageBase64: result.posterBase64,
        animationBase64: result.animationBase64,
        animationHash: result.animationHash,
        posterBase64: result.posterBase64,
        posterHash: result.posterHash,
        frames: totalFrames,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        fps,
        metadata: {
          sdk_version: SDK_VERSION,
          protocol_version: DEFAULT_PROTOCOL_VERSION,
          node_version: NODE_VERSION,
          canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
          execution_time_ms: executionTime,
          timestamp: new Date().toISOString(),
          isLoopMode: true
        },
      });
    }

    const { canvas, numericSeed, normalizedVars, codeLength } = executeSnapshot(snapshot);
    
    // Debug log to prove inputs differ
    console.log(`[STATIC MODE] seed=${numericSeed}, VAR=[${normalizedVars.slice(0, 3).join(',')}], codeLen=${codeLength}`);
    
    const pngBuffer = canvas.toBuffer("image/png");
    const imageHash = computeHash(pngBuffer);
    const executionTime = Date.now() - startTime;
    const base64Image = pngBuffer.toString("base64");

    res.json({
      type: "static",
      mime: "image/png",
      imageHash,
      imageBase64: base64Image,
      metadata: {
        sdk_version: SDK_VERSION,
        protocol_version: DEFAULT_PROTOCOL_VERSION,
        node_version: NODE_VERSION,
        canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
        isLoopMode: false
      },
    });
  } catch (error) {
    console.error("Execution error:", error);
    
    if (error.message && error.message.startsWith("PROTOCOL_VIOLATION:")) {
      return res.status(400).json({
        error: "PROTOCOL_VIOLATION",
        message: error.message.replace("PROTOCOL_VIOLATION: ", ""),
      });
    }
    
    if (error.message && error.message.startsWith("LOOP_MODE_ERROR:")) {
      return res.status(400).json({
        error: "LOOP_MODE_ERROR",
        message: error.message.replace("LOOP_MODE_ERROR: ", ""),
      });
    }
    
    res.status(500).json({
      error: "EXECUTION_ERROR",
      message: error.message,
    });
  }
});

app.post("/verify", async (req, res) => {
  const startTime = Date.now();

  try {
    const { snapshot, expectedHash, expectedAnimationHash, expectedPosterHash } = req.body;

    if (!snapshot || typeof snapshot !== "object") {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Must provide a valid snapshot object",
      });
    }

    const { code, seed, vars, execution } = snapshot;
    const isLoopMode = detectLoopMode(code, execution);

    if (isLoopMode) {
      // Loop mode verification
      if (!expectedAnimationHash && !expectedPosterHash && !expectedHash) {
        return res.status(400).json({
          error: "INVALID_REQUEST",
          message: "Loop mode requires expectedAnimationHash, expectedPosterHash, or expectedHash",
        });
      }

      const totalFrames = execution?.totalFrames || 120;
      const fps = execution?.fps || 30;

      if (totalFrames < 2) {
        return res.status(400).json({
          error: "LOOP_MODE_ERROR",
          message: "Loop mode requires totalFrames >= 2",
        });
      }

      console.log(`[VERIFY LOOP MODE] Re-rendering ${totalFrames} frames at ${fps}fps`);

      const result = await renderLoop({
        code,
        seed,
        vars,
        totalFrames,
        fps,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      });

      const computedAnimationHash = result.animationHash;
      const computedPosterHash = result.posterHash;

      // Determine verification result
      // Only set verified flags if the corresponding expected hash is provided
      let animationVerified = null;
      let posterVerified = null;
      let hashMatchType = null;

      if (expectedAnimationHash) {
        animationVerified = computedAnimationHash === expectedAnimationHash;
      }
      if (expectedPosterHash) {
        posterVerified = computedPosterHash === expectedPosterHash;
      }

      // If only expectedHash provided (backward compat), check against both and report which matched
      if (expectedHash && !expectedAnimationHash && !expectedPosterHash) {
        const posterMatches = computedPosterHash === expectedHash;
        const animationMatches = computedAnimationHash === expectedHash;
        
        if (posterMatches) {
          posterVerified = true;
          hashMatchType = "poster";
        } else {
          posterVerified = false;
        }
        
        if (animationMatches) {
          animationVerified = true;
          hashMatchType = animationMatches && !posterMatches ? "animation" : hashMatchType;
        } else {
          animationVerified = false;
        }
      }

      // Calculate verified: all provided checks must pass
      // If a hash wasn't requested, it doesn't affect verification
      const animOk = animationVerified === null || animationVerified === true;
      const posterOk = posterVerified === null || posterVerified === true;
      const atLeastOneChecked = animationVerified !== null || posterVerified !== null;
      const verified = atLeastOneChecked && animOk && posterOk;
      const executionTime = Date.now() - startTime;

      const response = {
        verified,
        mode: "loop",
        computedAnimationHash,
        computedPosterHash,
        protocolCompliant: verified,
        metadata: {
          sdk_version: SDK_VERSION,
          protocol_version: DEFAULT_PROTOCOL_VERSION,
          node_version: NODE_VERSION,
          execution_time_ms: executionTime,
          timestamp: new Date().toISOString(),
          frames: totalFrames,
          fps,
        },
      };

      // Include expected hashes and verification results in response
      if (expectedAnimationHash) {
        response.expectedAnimationHash = expectedAnimationHash;
        response.animationVerified = animationVerified;
      }
      if (expectedPosterHash) {
        response.expectedPosterHash = expectedPosterHash;
        response.posterVerified = posterVerified;
      }
      if (expectedHash && !expectedAnimationHash && !expectedPosterHash) {
        response.expectedHash = expectedHash;
        response.animationVerified = animationVerified;
        response.posterVerified = posterVerified;
        if (hashMatchType) {
          response.hashMatchType = hashMatchType;
        }
      }

      return res.json(response);
    }

    // Static mode verification (original behavior)
    if (!expectedHash || typeof expectedHash !== "string") {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Static mode requires expectedHash string",
      });
    }

    const { canvas } = executeSnapshot(snapshot);
    const pngBuffer = canvas.toBuffer("image/png");
    const computedHash = computeHash(pngBuffer);
    const verified = computedHash === expectedHash;
    const executionTime = Date.now() - startTime;

    res.json({
      verified,
      mode: "static",
      computedHash,
      expectedHash,
      protocolCompliant: verified,
      metadata: {
        sdk_version: SDK_VERSION,
        protocol_version: DEFAULT_PROTOCOL_VERSION,
        node_version: NODE_VERSION,
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Verification error:", error);
    
    if (error.message && error.message.startsWith("PROTOCOL_VIOLATION:")) {
      return res.status(400).json({
        error: "PROTOCOL_VIOLATION",
        message: error.message.replace("PROTOCOL_VIOLATION: ", ""),
        verified: false,
      });
    }
    
    if (error.message && error.message.startsWith("LOOP_MODE_ERROR:")) {
      return res.status(400).json({
        error: "LOOP_MODE_ERROR",
        message: error.message.replace("LOOP_MODE_ERROR: ", ""),
        verified: false,
      });
    }
    
    res.status(500).json({
      error: "VERIFICATION_ERROR",
      message: error.message,
      verified: false,
    });
  }
});

app.get("/admin/usage/today", requireAdmin, async (req, res) => {
  try {
    const usage = await getUsageToday();
    res.json({
      period: "today",
      date: new Date().toISOString().split("T")[0],
      usage,
      total: usage.reduce((sum, row) => sum + parseInt(row.count), 0)
    });
  } catch (error) {
    res.status(500).json({
      error: "ADMIN_ERROR",
      message: error.message
    });
  }
});

app.get("/admin/usage/month", requireAdmin, async (req, res) => {
  try {
    const usage = await getUsageMonth();
    const now = new Date();
    res.json({
      period: "month",
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      usage,
      total: usage.reduce((sum, row) => sum + parseInt(row.count), 0)
    });
  } catch (error) {
    res.status(500).json({
      error: "ADMIN_ERROR",
      message: error.message
    });
  }
});

async function gracefulShutdown(server, signal) {
  console.log(`[shutdown] received ${signal}, draining...`);
  isShuttingDown = true;

  server.close(async () => {
    try {
      await closePool();
      console.log("[shutdown] pool closed");
    } catch (err) {
      console.error("[shutdown] error closing pool:", err.message);
    }
    console.log("[shutdown] closed, exiting");
    process.exit(0);
  });

  const DRAIN_TIMEOUT = 15000;
  const POLL_INTERVAL = 100;
  let elapsed = 0;

  const waitForDrain = setInterval(async () => {
    elapsed += POLL_INTERVAL;
    
    if (inFlightRequests === 0) {
      clearInterval(waitForDrain);
      console.log("[shutdown] all requests drained");
      return;
    }
    
    if (elapsed >= DRAIN_TIMEOUT) {
      clearInterval(waitForDrain);
      console.log(`[shutdown] timeout reached, ${inFlightRequests} requests still in flight, force closing`);
      try {
        await closePool();
        console.log("[shutdown] pool closed");
      } catch (err) {
        console.error("[shutdown] error closing pool:", err.message);
      }
      process.exit(0);
    }
  }, POLL_INTERVAL);
}

async function startServer() {
  console.log("[STARTUP] Running database migrations...");
  await runMigrations();
  
  const server = app.listen(PORT, "0.0.0.0", () => {
    serverReady = true;
    
    console.log(`[BOOT] NexArt Canonical Node v${NODE_VERSION}`);
    console.log(`[BOOT] SDK: ${SDK_VERSION} | Protocol: ${DEFAULT_PROTOCOL_VERSION} | Port: ${PORT}`);
    console.log(`[BOOT] Canvas: ${CANVAS_WIDTH}×${CANVAS_HEIGHT}`);
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  NexArt Canonical Node v${NODE_VERSION}                                                  ║
║                                                                              ║
║  Authority: @nexart/codemode-sdk (DIRECT IMPORT)                             ║
║  SDK Version: ${SDK_VERSION}                                                         ║
║  Protocol Version: ${DEFAULT_PROTOCOL_VERSION}                                                    ║
║  Canvas: ${CANVAS_WIDTH}×${CANVAS_HEIGHT} (hard-locked)                                         ║
║                                                                              ║
║  Modes:                                                                      ║
║    Static: setup() + draw() once → PNG                                       ║
║    Loop:   setup() + draw() × N → MP4 video                                  ║
║                                                                              ║
║  Endpoints:                                                                  ║
║    GET  /health         - Node status (public)                               ║
║    GET  /ready          - Readiness check (Railway health check)             ║
║    GET  /version        - Full version info (public)                         ║
║    POST /render         - Execute snapshot (public)                          ║
║    POST /api/render     - CLI contract (API key required)                    ║
║    POST /verify         - Verify execution (public)                          ║
║    GET  /admin/usage/*  - Usage stats (ADMIN_SECRET required)                ║
║                                                                              ║
║  Running on port ${PORT}                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `);
  });

  process.on("SIGTERM", () => gracefulShutdown(server, "SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown(server, "SIGINT"));
}

startServer();
