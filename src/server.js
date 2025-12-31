import express from "express";
import { createCanvas } from "canvas";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 5000;

const SDK_VERSION = "1.1.1";
const PROTOCOL_VERSION = "1.0.0";
const NODE_VERSION = "1.0.0";

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededNoise(seed) {
  const rand = mulberry32(seed);
  const permutation = [];
  for (let i = 0; i < 256; i++) permutation[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  const perm = [...permutation, ...permutation];

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
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;

    return (
      lerp(
        lerp(
          lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
          lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
          v
        ),
        lerp(
          lerp(
            grad(perm[AA + 1], x, y, z - 1),
            grad(perm[BA + 1], x - 1, y, z - 1),
            u
          ),
          lerp(
            grad(perm[AB + 1], x, y - 1, z - 1),
            grad(perm[BB + 1], x - 1, y - 1, z - 1),
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

function createP5Runtime(canvas, width, height, seed, vars) {
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

  const rng = mulberry32(seed);
  const noise = createSeededNoise(seed);

  const VAR = new Array(10).fill(0);
  if (Array.isArray(vars)) {
    for (let i = 0; i < Math.min(vars.length, 10); i++) {
      VAR[i] = Math.max(0, Math.min(100, vars[i] ?? 0));
    }
  }

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
    VAR,
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
      const rw = w / 2;
      const rh = (h ?? w) / 2;
      ctx.beginPath();
      ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
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
      if (min === undefined) return rng();
      if (max === undefined) return rng() * min;
      return min + rng() * (max - min);
    },
    randomSeed: () => {},
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

function executeCodeMode(code, config) {
  const { width = 1950, height = 2400, seed = 0, vars = [] } = config;

  const numericSeed =
    typeof seed === "string"
      ? seed.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0)
      : seed >>> 0;

  const canvas = createCanvas(width, height);
  const p = createP5Runtime(canvas, width, height, numericSeed, vars);

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
    width: snapshot.width ?? 1950,
    height: snapshot.height ?? 2400,
    engine_version: snapshot.engine_version ?? SDK_VERSION,
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
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
    capabilities: ["static", "hash", "verify"],
    defaults: {
      width: 1950,
      height: 2400,
    },
  });
});

app.post("/render", (req, res) => {
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

    const width = snapshot.width ?? 1950;
    const height = snapshot.height ?? 2400;
    const seed = snapshot.seed ?? "0";
    const vars = Array.isArray(snapshot.vars) ? snapshot.vars : [];

    const canvas = executeCodeMode(snapshot.code, {
      width,
      height,
      seed,
      vars,
    });

    const pngBuffer = canvas.toBuffer("image/png");
    const imageHash = computeHash(pngBuffer);
    const snapshotHash = computeSnapshotHash(snapshot);
    const executionTime = Date.now() - startTime;

    const format = req.query.format || "image";

    if (format === "json") {
      const base64Image = pngBuffer.toString("base64");
      return res.json({
        success: true,
        result: {
          type: "image",
          format: "png",
          width,
          height,
          data: `data:image/png;base64,${base64Image}`,
          size: pngBuffer.length,
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
    res.setHeader("Content-Length", pngBuffer.length);
    res.setHeader("X-NexArt-Image-Hash", imageHash);
    res.setHeader("X-NexArt-Snapshot-Hash", snapshotHash);
    res.setHeader("X-NexArt-SDK-Version", SDK_VERSION);
    res.setHeader("X-NexArt-Protocol-Version", PROTOCOL_VERSION);
    res.setHeader("X-NexArt-Execution-Time", executionTime.toString());
    res.send(pngBuffer);
  } catch (error) {
    console.error("Render error:", error);
    res.status(500).json({
      error: "EXECUTION_ERROR",
      message: error.message,
    });
  }
});

app.post("/api/v1/render", (req, res) => {
  req.url = "/render";
  return app._router.handle(req, res, () => {});
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

app.post("/api/v1/verify", (req, res) => {
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

    const width = snapshot.width ?? 1950;
    const height = snapshot.height ?? 2400;
    const seed = snapshot.seed ?? "0";
    const vars = Array.isArray(snapshot.vars) ? snapshot.vars : [];

    let computedHash;
    let verified = false;

    if (hash_type === "snapshot") {
      computedHash = computeSnapshotHash(snapshot);
      verified = computedHash === expected_hash;
    } else {
      const canvas = executeCodeMode(snapshot.code, {
        width,
        height,
        seed,
        vars,
      });
      const pngBuffer = canvas.toBuffer("image/png");
      computedHash = computeHash(pngBuffer);
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
║  Protocol: nexart                                                            ║
║  Engine: codemode                                                            ║
║  SDK Version: ${SDK_VERSION}                                                         ║
║  Protocol Version: ${PROTOCOL_VERSION}                                                    ║
║                                                                              ║
║  Endpoints:                                                                  ║
║    GET  /health           - Node health check                                ║
║    GET  /api/v1/info      - Node capabilities                                ║
║    POST /api/v1/render    - Execute Code Mode and render                     ║
║    POST /api/v1/hash      - Generate cryptographic hashes                    ║
║    POST /api/v1/verify    - Verify execution against hash                    ║
║    POST /render           - Legacy render endpoint                           ║
║                                                                              ║
║  Running on port ${PORT}                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
});
