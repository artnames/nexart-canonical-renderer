import express from "express";
import { createCanvas } from "canvas";
import crypto from "crypto";
import { renderLoop } from "./render-loop.js";

const app = express();
const PORT = process.env.PORT || 5000;

const CANVAS_WIDTH = 1950;
const CANVAS_HEIGHT = 2400;
const NODE_VERSION = "1.0.0";
const SDK_VERSION = "1.1.1";
const PROTOCOL_VERSION = "1.0.0";

function createSeededRNG(seed = 123456) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededNoise(seed = 0) {
  const permutation = [];
  const rng = createSeededRNG(seed);
  for (let i = 0; i < 256; i++) permutation[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  for (let i = 0; i < 256; i++) permutation[256 + i] = permutation[i];

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function lerp(a, b, t) {
    return a + t * (b - a);
  }
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  return function noise(x, y = 0, z = 0) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = permutation[X] + Y;
    const AA = permutation[A] + Z;
    const AB = permutation[A + 1] + Z;
    const B = permutation[X + 1] + Y;
    const BA = permutation[B] + Z;
    const BB = permutation[B + 1] + Z;

    return (
      lerp(
        lerp(
          lerp(
            grad(permutation[AA], x, y, z),
            grad(permutation[BA], x - 1, y, z),
            u
          ),
          lerp(
            grad(permutation[AB], x, y - 1, z),
            grad(permutation[BB], x - 1, y - 1, z),
            u
          ),
          v
        ),
        lerp(
          lerp(
            grad(permutation[AA + 1], x, y, z - 1),
            grad(permutation[BA + 1], x - 1, y, z - 1),
            u
          ),
          lerp(
            grad(permutation[AB + 1], x, y - 1, z - 1),
            grad(permutation[BB + 1], x - 1, y - 1, z - 1),
            u
          ),
          v
        ),
        w
      ) *
        0.5 +
      0.5
    );
  };
}

function createP5Runtime(canvas, width, height, seed) {
  const ctx = canvas.getContext("2d");
  let currentFill = "rgba(255, 255, 255, 1)";
  let currentStroke = "rgba(0, 0, 0, 1)";
  let strokeEnabled = true;
  let fillEnabled = true;
  let currentStrokeWeight = 1;
  let colorModeSettings = {
    mode: "RGB",
    maxR: 255,
    maxG: 255,
    maxB: 255,
    maxA: 255,
  };
  let shapeStarted = false;
  let rectModeValue = "corner";
  let ellipseModeValue = "center";

  let rng = createSeededRNG(seed);
  const noise = createSeededNoise(seed);

  const parseColor = (...args) => {
    if (args.length === 0) return "rgba(0, 0, 0, 1)";
    const { mode, maxR, maxG, maxB, maxA } = colorModeSettings;
    if (args.length === 1) {
      const val = args[0];
      if (typeof val === "string") return val;
      if (mode === "HSB") {
        return `hsla(${val}, 100%, 50%, 1)`;
      }
      const gray = Math.round((val / maxR) * 255);
      return `rgba(${gray}, ${gray}, ${gray}, 1)`;
    }
    if (args.length === 2) {
      const [gray, alpha] = args;
      const g = Math.round((gray / maxR) * 255);
      const a = alpha / maxA;
      return `rgba(${g}, ${g}, ${g}, ${a})`;
    }
    if (args.length === 3) {
      const [r, g, b] = args;
      if (mode === "HSB") {
        return `hsla(${(r / maxR) * 360}, ${(g / maxG) * 100}%, ${(b / maxB) * 100}%, 1)`;
      }
      return `rgba(${Math.round((r / maxR) * 255)}, ${Math.round((g / maxG) * 255)}, ${Math.round((b / maxB) * 255)}, 1)`;
    }
    if (args.length === 4) {
      const [r, g, b, a] = args;
      if (mode === "HSB") {
        return `hsla(${(r / maxR) * 360}, ${(g / maxG) * 100}%, ${(b / maxB) * 100}%, ${a / maxA})`;
      }
      return `rgba(${Math.round((r / maxR) * 255)}, ${Math.round((g / maxG) * 255)}, ${Math.round((b / maxB) * 255)}, ${a / maxA})`;
    }
    return "rgba(0, 0, 0, 1)";
  };

  const p = {
    width,
    height,
    frameCount: 0,
    t: 0,
    time: 0,
    tGlobal: 0,
    VAR: new Array(10).fill(0),
    PI: Math.PI,
    TWO_PI: Math.PI * 2,
    HALF_PI: Math.PI / 2,
    QUARTER_PI: Math.PI / 4,
    CORNER: "corner",
    CENTER: "center",
    CORNERS: "corners",
    RADIUS: "radius",
    ROUND: "round",
    SQUARE: "square",
    PROJECT: "project",
    MITER: "miter",
    BEVEL: "bevel",
    CLOSE: "close",

    background: (...args) => {
      ctx.save();
      ctx.fillStyle = parseColor(...args);
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
    clear: () => {
      ctx.clearRect(0, 0, width, height);
    },
    fill: (...args) => {
      fillEnabled = true;
      currentFill = parseColor(...args);
      ctx.fillStyle = currentFill;
    },
    noFill: () => {
      fillEnabled = false;
    },
    stroke: (...args) => {
      strokeEnabled = true;
      currentStroke = parseColor(...args);
      ctx.strokeStyle = currentStroke;
    },
    noStroke: () => {
      strokeEnabled = false;
    },
    strokeWeight: (weight) => {
      currentStrokeWeight = weight;
      ctx.lineWidth = weight;
    },
    strokeCap: (cap) => {
      const capMap = { round: "round", square: "butt", project: "square" };
      ctx.lineCap = capMap[cap] || cap || "round";
    },
    strokeJoin: (join) => {
      const joinMap = { round: "round", miter: "miter", bevel: "bevel" };
      ctx.lineJoin = joinMap[join] || join || "miter";
    },
    rectMode: (mode) => {
      rectModeValue = mode || "corner";
    },
    ellipseMode: (mode) => {
      ellipseModeValue = mode || "center";
    },
    colorMode: (mode, max1, max2, max3, maxA) => {
      colorModeSettings = {
        mode: mode.toUpperCase(),
        maxR: max1 ?? 255,
        maxG: max2 ?? max1 ?? 255,
        maxB: max3 ?? max1 ?? 255,
        maxA: maxA ?? 255,
      };
    },
    color: (...args) => parseColor(...args),
    lerpColor: (c1, c2, amt) => c1,
    ellipse: (x, y, w, h) => {
      let cx = x, cy = y;
      let rw = w / 2;
      let rh = (h ?? w) / 2;
      if (ellipseModeValue === "corner") {
        cx = x + rw;
        cy = y + rh;
      } else if (ellipseModeValue === "corners") {
        rw = (w - x) / 2;
        rh = ((h ?? w) - y) / 2;
        cx = x + rw;
        cy = y + rh;
      } else if (ellipseModeValue === "radius") {
        rw = w;
        rh = h ?? w;
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(rw), Math.abs(rh), 0, 0, Math.PI * 2);
      if (fillEnabled) ctx.fill();
      if (strokeEnabled) ctx.stroke();
    },
    circle: function (x, y, d) {
      this.ellipse(x, y, d, d);
    },
    rect: (x, y, w, h, r) => {
      const rh = h ?? w;
      ctx.beginPath();
      if (r && r > 0) {
        ctx.roundRect(x, y, w, rh, r);
      } else {
        ctx.rect(x, y, w, rh);
      }
      if (fillEnabled) ctx.fill();
      if (strokeEnabled) ctx.stroke();
    },
    square: function (x, y, s, r) {
      this.rect(x, y, s, s, r);
    },
    line: (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (strokeEnabled) ctx.stroke();
    },
    point: (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, currentStrokeWeight / 2, 0, Math.PI * 2);
      ctx.fillStyle = currentStroke;
      ctx.fill();
    },
    triangle: (x1, y1, x2, y2, x3, y3) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      if (fillEnabled) ctx.fill();
      if (strokeEnabled) ctx.stroke();
    },
    quad: (x1, y1, x2, y2, x3, y3, x4, y4) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      if (fillEnabled) ctx.fill();
      if (strokeEnabled) ctx.stroke();
    },
    arc: (x, y, w, h, start, stop, mode) => {
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, h / 2, 0, start, stop);
      if (mode === "pie" || mode === "PIE") {
        ctx.lineTo(x, y);
        ctx.closePath();
      } else if (mode === "chord" || mode === "CHORD") {
        ctx.closePath();
      }
      if (fillEnabled) ctx.fill();
      if (strokeEnabled) ctx.stroke();
    },
    beginShape: () => {
      ctx.beginPath();
      shapeStarted = false;
    },
    vertex: (x, y) => {
      if (!shapeStarted) {
        ctx.moveTo(x, y);
        shapeStarted = true;
      } else {
        ctx.lineTo(x, y);
      }
    },
    endShape: (mode) => {
      if (mode === "close" || mode === "CLOSE") {
        ctx.closePath();
      }
      if (fillEnabled) ctx.fill();
      if (strokeEnabled) ctx.stroke();
      shapeStarted = false;
    },
    push: () => {
      ctx.save();
    },
    pop: () => {
      ctx.restore();
      ctx.fillStyle = currentFill;
      ctx.strokeStyle = currentStroke;
      ctx.lineWidth = currentStrokeWeight;
    },
    translate: (x, y) => {
      ctx.translate(x, y);
    },
    rotate: (angle) => {
      ctx.rotate(angle);
    },
    scale: (sx, sy) => {
      ctx.scale(sx, sy ?? sx);
    },
    resetMatrix: () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    random: (min, max) => {
      if (Array.isArray(min)) {
        return min[Math.floor(rng() * min.length)];
      }
      if (min === undefined) return rng();
      if (max === undefined) return rng() * min;
      return min + rng() * (max - min);
    },
    randomSeed: (s) => {
      rng = createSeededRNG(s);
    },
    noise,
    noiseSeed: () => {},
    noiseDetail: () => {},
    map: (value, start1, stop1, start2, stop2) => {
      return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
    },
    constrain: (n, low, high) => {
      return Math.max(low, Math.min(high, n));
    },
    lerp: (start, stop, amt) => {
      return start + (stop - start) * amt;
    },
    dist: (x1, y1, x2, y2) => {
      return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    },
    mag: (x, y) => {
      return Math.sqrt(x * x + y * y);
    },
    norm: (value, start, stop) => {
      return (value - start) / (stop - start);
    },
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    radians: (degrees) => degrees * (Math.PI / 180),
    degrees: (radians) => radians * (180 / Math.PI),
    abs: Math.abs,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
    sqrt: Math.sqrt,
    pow: Math.pow,
    exp: Math.exp,
    log: Math.log,
    min: Math.min,
    max: Math.max,
    noLoop: () => {},
    loop: () => {},
    redraw: () => {},
    frameRate: () => {},
  };

  return p;
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
  const p = createP5Runtime(canvas, CANVAS_WIDTH, CANVAS_HEIGHT, numericSeed);

  const normalizedVars = new Array(10).fill(0);
  if (Array.isArray(vars)) {
    for (let i = 0; i < Math.min(vars.length, 10); i++) {
      const v = vars[i];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) {
        normalizedVars[i] = v;
      }
    }
  }
  p.VAR = normalizedVars;

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

  wrappedSetup(p, normalizedVars, 0, 0, 0, 0);

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
        fps
      });

      const executionTime = Date.now() - startTime;

      console.log(`[LOOP MODE] Complete - isLoopMode: true, animationHash: ${result.animationHash}`);

      res.json({
        type: "animation",
        mime: result.mime,
        animationBase64: result.animationBase64,
        animationHash: result.animationHash,
        posterBase64: result.posterBase64,
        posterHash: result.posterHash,
        frames: result.frames,
        width: result.width,
        height: result.height,
        fps: result.fps,
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
      return;
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

app.post("/verify", (req, res) => {
  const startTime = Date.now();

  try {
    const { snapshot, expectedHash } = req.body;

    if (!snapshot || typeof snapshot !== "object") {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Must provide a valid snapshot object",
      });
    }

    if (!expectedHash || typeof expectedHash !== "string") {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "Must provide expectedHash string",
      });
    }

    const canvas = executeSnapshot(snapshot);
    const pngBuffer = canvas.toBuffer("image/png");
    const computedHash = computeHash(pngBuffer);
    const verified = computedHash === expectedHash;
    const executionTime = Date.now() - startTime;

    res.json({
      verified,
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
║  Authority: @nexart/codemode-sdk                                             ║
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
