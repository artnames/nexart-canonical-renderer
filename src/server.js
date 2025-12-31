import express from "express";
import crypto from "crypto";
import { createCanvas } from "canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sdkPath = join(__dirname, "../node_modules/@nexart/codemode-sdk/dist");
const { createP5Runtime, injectTimeVariables } = await import(
  join(sdkPath, "p5-runtime.js")
);
const { DEFAULT_CONFIG } = await import(join(sdkPath, "types.js"));

const app = express();
const PORT = process.env.PORT || 5000;

const SDK_VERSION = "1.1.0";
const PROTOCOL_VERSION = "1.0.0";
const NODE_VERSION = "1.0.0";

function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeSnapshotHash(snapshot) {
  const normalizedVars = new Array(10).fill(0);
  if (Array.isArray(snapshot.vars)) {
    for (let i = 0; i < Math.min(snapshot.vars.length, 10); i++) {
      normalizedVars[i] = snapshot.vars[i] ?? 0;
    }
  }

  const normalized = JSON.stringify({
    code: snapshot.code,
    seed: String(snapshot.seed ?? "0"),
    vars: normalizedVars,
    width: snapshot.width ?? DEFAULT_CONFIG.width,
    height: snapshot.height ?? DEFAULT_CONFIG.height,
    engine_version: snapshot.engine_version ?? SDK_VERSION,
    protocol_version: snapshot.protocol_version ?? PROTOCOL_VERSION,
  });

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function executeSnapshot(snapshot) {
  const {
    code,
    seed,
    vars = [],
    width = DEFAULT_CONFIG.width,
    height = DEFAULT_CONFIG.height,
    mode = "static",
  } = snapshot;

  const canvas = createCanvas(width, height);
  const p = createP5Runtime(canvas, width, height);

  injectTimeVariables(p, {
    frameCount: 0,
    t: 0,
    time: 0,
    tGlobal: 0,
  });

  const setupMatch = code.match(
    /function\s+setup\s*\(\s*\)\s*\{([\s\S]*?)\}(?=\s*function|\s*$)/
  );
  const setupCode = setupMatch ? setupMatch[1].trim() : code;

  const wrappedSetup = new Function(
    "p",
    "frameCount",
    "t",
    "time",
    "tGlobal",
    `with(p) { ${setupCode} }`
  );

  wrappedSetup(p, 0, 0, 0, 0);

  const pngBuffer = canvas.toBuffer("image/png");

  return {
    type: "image",
    buffer: pngBuffer,
  };
}

app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    node: "nexart-canonical",
    version: NODE_VERSION,
    sdk_version: SDK_VERSION,
    protocol_version: PROTOCOL_VERSION,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1/info", (req, res) => {
  res.json({
    node: "nexart-canonical",
    version: NODE_VERSION,
    sdk_version: SDK_VERSION,
    protocol_version: PROTOCOL_VERSION,
    capabilities: ["static"],
    defaults: {
      width: DEFAULT_CONFIG.width,
      height: DEFAULT_CONFIG.height,
    },
  });
});

app.post("/render", async (req, res) => {
  const startTime = Date.now();

  try {
    const snapshot = req.body;

    if (!snapshot || typeof snapshot !== "object") {
      return res.status(400).json({
        error: "INVALID_SNAPSHOT",
        message: "Request body must be a valid snapshot object",
      });
    }

    if (typeof snapshot.code !== "string" || !snapshot.code.trim()) {
      return res.status(400).json({
        error: "INVALID_CODE",
        message: "Snapshot must include valid code string",
      });
    }

    const result = await executeSnapshot(snapshot);
    const buffer = result.buffer;

    const imageHash = computeHash(buffer);
    const snapshotHash = computeSnapshotHash(snapshot);
    const executionTime = Date.now() - startTime;

    const format = req.query.format || "image";

    if (format === "json") {
      const base64Image = buffer.toString("base64");
      return res.json({
        success: true,
        result: {
          type: result.type,
          format: "png",
          width: snapshot.width ?? DEFAULT_CONFIG.width,
          height: snapshot.height ?? DEFAULT_CONFIG.height,
          data: `data:image/png;base64,${base64Image}`,
          size: buffer.length,
        },
        hashes: {
          image: imageHash,
          snapshot: snapshotHash,
        },
        metadata: {
          sdk_version: SDK_VERSION,
          protocol_version: PROTOCOL_VERSION,
          node_version: NODE_VERSION,
          execution_time_ms: executionTime,
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("X-NexArt-Image-Hash", imageHash);
    res.setHeader("X-NexArt-Snapshot-Hash", snapshotHash);
    res.setHeader("X-NexArt-SDK-Version", SDK_VERSION);
    res.setHeader("X-NexArt-Protocol-Version", PROTOCOL_VERSION);
    res.setHeader("X-NexArt-Execution-Time", executionTime.toString());
    res.send(buffer);
  } catch (error) {
    console.error("Render error:", error);
    res.status(500).json({
      error: "EXECUTION_ERROR",
      message: error.message,
    });
  }
});

app.post("/api/v1/render", async (req, res) => {
  return app._router.handle(
    Object.assign(req, { url: "/render", originalUrl: "/render" }),
    res,
    () => {}
  );
});

app.post("/api/v1/hash", (req, res) => {
  try {
    const { type, data, snapshot } = req.body;

    if (type === "snapshot" && snapshot) {
      const hash = computeSnapshotHash(snapshot);
      return res.json({
        success: true,
        hash,
        algorithm: "sha256",
        type: "snapshot",
      });
    }

    if (type === "image" && data) {
      const buffer = Buffer.from(data, "base64");
      const hash = computeHash(buffer);
      return res.json({
        success: true,
        hash,
        algorithm: "sha256",
        type: "image",
      });
    }

    return res.status(400).json({
      error: "INVALID_HASH_REQUEST",
      message: "Must provide type (snapshot|image) and corresponding data",
    });
  } catch (error) {
    console.error("Hash error:", error);
    res.status(500).json({
      error: "HASH_ERROR",
      message: error.message,
    });
  }
});

app.post("/api/v1/verify", async (req, res) => {
  const startTime = Date.now();

  try {
    const { snapshot, expected_hash, hash_type = "image" } = req.body;

    if (!snapshot || typeof snapshot !== "object") {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Must provide a valid snapshot object",
      });
    }

    if (!expected_hash || typeof expected_hash !== "string") {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Must provide expected_hash string",
      });
    }

    let computedHash;
    let verified = false;

    if (hash_type === "snapshot") {
      computedHash = computeSnapshotHash(snapshot);
      verified = computedHash === expected_hash;
    } else {
      const result = await executeSnapshot(snapshot);
      computedHash = computeHash(result.buffer);
      verified = computedHash === expected_hash;
    }

    const executionTime = Date.now() - startTime;

    res.json({
      success: true,
      verified,
      computed_hash: computedHash,
      expected_hash,
      hash_type,
      protocol_compliant: verified,
      metadata: {
        sdk_version: SDK_VERSION,
        protocol_version: PROTOCOL_VERSION,
        node_version: NODE_VERSION,
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: "VERIFICATION_ERROR",
      message: error.message,
      verified: false,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  NexArt Canonical Node v${NODE_VERSION}                                                  ║
║                                                                              ║
║  This node embeds @nexart/codemode-sdk unchanged.                            ║
║  SDK = Authority. Node = Witness.                                            ║
║                                                                              ║
║  SDK Version: ${SDK_VERSION}                                                         ║
║  Protocol Version: ${PROTOCOL_VERSION}                                                    ║
║                                                                              ║
║  Core Endpoint:                                                              ║
║    POST /render    - Execute snapshot, return PNG + hashes                   ║
║                                                                              ║
║  Auxiliary:                                                                  ║
║    GET  /health    - Node health                                             ║
║    POST /api/v1/*  - Versioned API                                           ║
║                                                                              ║
║  Running on port ${PORT}                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
});
