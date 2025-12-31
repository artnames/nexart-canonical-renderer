import { createCanvas } from "canvas";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import ffmpeg from "fluent-ffmpeg";
import { runSketch } from "./runtime-p5.js";

const WIDTH = 1950;
const HEIGHT = 2400;

export async function renderLoop({
  source,
  vars,
  seed,
  totalFrames,
  fps = 30
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexart-"));

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const drawFrame = await runSketch({
    ctx,
    width: WIDTH,
    height: HEIGHT,
    source,
    vars,
    seed
  });

  // Render frames
  for (let i = 0; i < totalFrames; i++) {
    drawFrame();
    const framePath = path.join(tmpDir, `f_${i}.png`);
    fs.writeFileSync(framePath, canvas.toBuffer("image/png"));
  }

  const outPath = path.join(tmpDir, "out.mp4");

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(tmpDir, "f_%d.png"))
      .inputFPS(fps)
      .outputOptions([
        "-pix_fmt yuv420p",
        "-movflags +faststart"
      ])
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  const buffer = fs.readFileSync(outPath);
  const imageHash = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    mime: "video/mp4",
    imageHash
  };
}
