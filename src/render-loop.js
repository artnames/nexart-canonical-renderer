import { createCanvas } from "canvas";
import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { extendP5Runtime } from "./p5-extensions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const sdkPath = path.resolve(__dirname, "../node_modules/@nexart/codemode-sdk/dist/p5-runtime.js");
const { 
  createP5Runtime, 
  injectTimeVariables, 
  injectProtocolVariables 
} = require(sdkPath);

function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function renderLoop(options) {
  const {
    code,
    seed,
    vars = [],
    totalFrames = 120,
    fps = 30,
    width = 1950,
    height = 2400,
  } = options;

  const hasDrawFunction = /function\s+draw\s*\(\s*\)\s*\{/.test(code);
  if (!hasDrawFunction) {
    throw new Error("LOOP_MODE_ERROR: draw() function required for loop mode");
  }

  const numericSeed =
    typeof seed === "string"
      ? seed.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0)
      : (seed ?? 0) >>> 0;

  const canvas = createCanvas(width, height);
  
  const p = createP5Runtime(canvas, width, height, { seed: numericSeed });
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

  const setupMatch = code.match(
    /function\s+setup\s*\(\s*\)\s*\{([\s\S]*?)\}(?=\s*function|\s*$)/
  );
  const setupCode = setupMatch ? setupMatch[1].trim() : "";

  const drawMatch = code.match(
    /function\s+draw\s*\(\s*\)\s*\{([\s\S]*?)\}(?=\s*function|\s*$)/
  );
  const drawCode = drawMatch ? drawMatch[1].trim() : "";

  const wrappedSetup = new Function(
    "p",
    "VAR",
    "frameCount",
    "t",
    "time",
    "tGlobal",
    `with(p) { ${setupCode} }`
  );

  const wrappedDraw = new Function(
    "p",
    "VAR",
    "frameCount",
    "t",
    "time",
    "tGlobal",
    `with(p) { ${drawCode} }`
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexart-loop-"));
  const frames = [];

  try {
    injectTimeVariables(p, {
      frameCount: 0,
      t: 0,
      time: 0,
      tGlobal: 0,
    });
    
    wrappedSetup(p, p.VAR, 0, 0, 0, 0);

    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / totalFrames;
      const time = frame / fps;
      const tGlobal = t;

      injectTimeVariables(p, {
        frameCount: frame,
        t,
        time,
        tGlobal,
      });

      wrappedDraw(p, p.VAR, frame, t, time, tGlobal);

      const framePath = path.join(tempDir, `frame_${String(frame).padStart(6, "0")}.png`);
      const pngBuffer = canvas.toBuffer("image/png");
      fs.writeFileSync(framePath, pngBuffer);
      frames.push(framePath);

      if (frame === 0) {
        frames.posterBuffer = pngBuffer;
      }
    }

    const videoPath = path.join(tempDir, "output.mp4");
    await encodeVideo(tempDir, videoPath, fps, width, height);

    const videoBuffer = fs.readFileSync(videoPath);
    const animationHash = computeHash(videoBuffer);
    const animationBase64 = videoBuffer.toString("base64");

    const posterHash = computeHash(frames.posterBuffer);
    const posterBase64 = frames.posterBuffer.toString("base64");

    return {
      animationBase64,
      animationHash,
      posterBase64,
      posterHash,
      frames: totalFrames,
      width,
      height,
      fps,
    };
  } finally {
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    } catch (e) {
      console.error("Cleanup error:", e);
    }
  }
}

function encodeVideo(inputDir, outputPath, fps, width, height) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(inputDir, "frame_%06d.png"),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-vf", `scale=${width}:${height}`,
      "-movflags", "+faststart",
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}
