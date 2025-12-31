import { createCanvas } from "canvas";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { runP5 } from "./runtime-p5.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const WIDTH = 1950;
const HEIGHT = 2400;

export async function renderLoop({
  source,
  seed,
  vars,
  fps,
  totalFrames
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexart-loop-"));
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Render frames
  for (let frame = 0; frame < totalFrames; frame++) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    runP5({
      ctx,
      width: WIDTH,
      height: HEIGHT,
      source,
      seed,
      vars,
      frame,
      totalFrames
    });

    const framePath = path.join(
      tmpDir,
      `frame_${String(frame).padStart(5, "0")}.png`
    );

    fs.writeFileSync(framePath, canvas.toBuffer("image/png"));
  }

  // Encode MP4
  const outputPath = path.join(tmpDir, "output.mp4");

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(tmpDir, "frame_%05d.png"))
      .inputFPS(fps)
      .outputOptions([
        "-pix_fmt yuv420p",
        "-movflags faststart",
        "-profile:v high",
        "-level 4.2"
      ])
      .videoCodec("libx264")
      .outputFPS(fps)
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });

  const buffer = fs.readFileSync(outputPath);
  const animationHash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

  return {
    buffer,
    mime: "video/mp4",
    imageHash: "none",
    animationHash
  };
}
