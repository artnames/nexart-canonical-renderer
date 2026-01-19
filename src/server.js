import express from "express";
import { createCanvas } from "canvas";
import crypto from "crypto";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { renderLoop } from "./render-loop.js";
import { extendP5Runtime } from "./p5-extensions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const sdkPath = path.resolve(__dirname, "../node_modules/@nexart/codemode-sdk/dist/p5-runtime.js");
const { 
  createP5Runtime, 
  injectTimeVariables, 
  injectProtocolVariables,
  CODE_MODE_PROTOCOL_VERSION
} = require(sdkPath);

const app = express();
const PORT = process.env.PORT || 5000;

const CANVAS_WIDTH = 1950;
const CANVAS_HEIGHT = 2400;
const NODE_VERSION = "1.0.0";
const SDK_VERSION = "1.6.0";
const PROTOCOL_VERSION = CODE_MODE_PROTOCOL_VERSION || "1.0.0";

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
    "VAR",
    "frameCount",
    "t",
    "time",
    "tGlobal",
    `with(p) { ${setupCode} }`
  );

  wrappedSetup(p, p.VAR, 0, 0, 0, 0);

  return canvas;
}

app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    node: "nexart-canonical",
    version: NODE_VERSION,
    sdk_version: SDK_VERSION,
    protocol_version: PROTOCOL_VERSION,
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    timestamp: new Date().toISOString(),
  });
});

function detectLoopMode(code, execution) {
  if (execution && execution.mode === "loop") {
    return true;
  }
  const hasDrawFunction = /function\s+draw\s*\(\s*\)\s*\{/.test(code);
  return hasDrawFunction && execution && execution.totalFrames > 1;
}

app.post("/render", async (req, res) => {
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
          protocol_version: PROTOCOL_VERSION,
          node_version: NODE_VERSION,
          canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
          execution_time_ms: executionTime,
          timestamp: new Date().toISOString(),
          isLoopMode: true
        },
      });
    }

    const canvas = executeSnapshot(snapshot);
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
        protocol_version: PROTOCOL_VERSION,
        node_version: NODE_VERSION,
        canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
        isLoopMode: false
      },
    });
  } catch (error) {
    console.error("Execution error:", error);
    
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
      let animationVerified = true;
      let posterVerified = true;

      if (expectedAnimationHash) {
        animationVerified = computedAnimationHash === expectedAnimationHash;
      }
      if (expectedPosterHash) {
        posterVerified = computedPosterHash === expectedPosterHash;
      }

      // If only expectedHash provided, check against both (poster takes precedence for backward compat)
      let hashMatchType = null;
      if (expectedHash && !expectedAnimationHash && !expectedPosterHash) {
        if (computedPosterHash === expectedHash) {
          posterVerified = true;
          hashMatchType = "poster";
        } else if (computedAnimationHash === expectedHash) {
          animationVerified = true;
          hashMatchType = "animation";
        } else {
          animationVerified = false;
          posterVerified = false;
        }
      }

      const verified = animationVerified && posterVerified;
      const executionTime = Date.now() - startTime;

      const response = {
        verified,
        mode: "loop",
        computedAnimationHash,
        computedPosterHash,
        protocolCompliant: verified,
        metadata: {
          sdk_version: SDK_VERSION,
          protocol_version: PROTOCOL_VERSION,
          node_version: NODE_VERSION,
          execution_time_ms: executionTime,
          timestamp: new Date().toISOString(),
          frames: totalFrames,
          fps,
        },
      };

      // Include expected hashes in response
      if (expectedAnimationHash) {
        response.expectedAnimationHash = expectedAnimationHash;
        response.animationVerified = computedAnimationHash === expectedAnimationHash;
      }
      if (expectedPosterHash) {
        response.expectedPosterHash = expectedPosterHash;
        response.posterVerified = computedPosterHash === expectedPosterHash;
      }
      if (expectedHash) {
        response.expectedHash = expectedHash;
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

    const canvas = executeSnapshot(snapshot);
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
        protocol_version: PROTOCOL_VERSION,
        node_version: NODE_VERSION,
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Verification error:", error);
    
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  NexArt Canonical Node v${NODE_VERSION}                                                  ║
║                                                                              ║
║  Authority: @nexart/codemode-sdk (DIRECT IMPORT)                             ║
║  SDK Version: ${SDK_VERSION}                                                         ║
║  Protocol Version: ${PROTOCOL_VERSION}                                                    ║
║  Canvas: ${CANVAS_WIDTH}×${CANVAS_HEIGHT} (hard-locked)                                         ║
║                                                                              ║
║  Modes:                                                                      ║
║    Static: setup() only → PNG                                                ║
║    Loop:   setup() + draw() × N → MP4 video                                  ║
║                                                                              ║
║  Endpoints:                                                                  ║
║    GET  /health  - Node status                                               ║
║    POST /render  - Execute snapshot (static or loop)                         ║
║    POST /verify  - Verify execution against expected hash                    ║
║                                                                              ║
║  Running on port ${PORT}                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
});
