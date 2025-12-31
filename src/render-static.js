import { createCanvas } from "canvas";
import crypto from "crypto";
import { runP5Sketch } from "./runtime-p5.js"; // small sandbox runner

// NexArt protocol constants
const WIDTH = 1950;
const HEIGHT = 2400;

export async function renderStatic(validated) {
  const {
    source,
    seed,
    vars
  } = validated;

  // 1️⃣ Create protocol-locked canvas
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // 2️⃣ Hard fail if dimensions are wrong
  if (canvas.width !== WIDTH || canvas.height !== HEIGHT) {
    throw new Error(
      `Protocol violation: canvas must be ${WIDTH}×${HEIGHT}`
    );
  }

  // 3️⃣ Run p5-style sketch inside controlled runtime
  runP5Sketch({
    canvas,
    ctx,
    source,
    seed,
    vars
  });

  // 4️⃣ Export PNG
  const buffer = canvas.toBuffer("image/png");

  // 5️⃣ Validate output size (protect against empty renders)
  if (!buffer || buffer.length < 10_000) {
    throw new Error(
      `Invalid render output: PNG too small (${buffer.length} bytes)`
    );
  }

  // 6️⃣ Hash image deterministically
  const imageHash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

  console.log(
    `[STATIC RENDER] ${WIDTH}×${HEIGHT} → ${buffer.length} bytes`
  );

  return {
    buffer,
    mime: "image/png",
    imageHash
  };
}
