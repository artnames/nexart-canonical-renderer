import { createCanvas } from "canvas";
import crypto from "crypto";
import { runSketch } from "./runtime-p5.js"; // ✅ correct name

export async function renderStatic(snapshot) {
  const { width, height, source, vars, seed } = snapshot;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  await runSketch({
    ctx,
    width,
    height,
    source,
    vars,
    seed
  });

  const buffer = canvas.toBuffer("image/png");

  if (buffer.length < 10_000) {
    throw new Error(`Rendered image too small (${buffer.length} bytes)`);
  }

  const imageHash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

  console.log(
    `[STATIC RENDER] ${width}×${height} → ${buffer.length} bytes`
  );

  return {
    buffer,
    mime: "image/png",
    imageHash
  };
}
