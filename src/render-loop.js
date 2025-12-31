import { createCanvas } from "canvas";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { runSketch } from "./runtime-p5.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const WIDTH = 1950;
const HEIGHT = 2400;

export async function renderLoop({
  source,
  vars,
  seed,
  totalFrames,
  fps
}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexart-"));
  const frames = [];

  for (let i = 0; i < totalFrames; i++) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    await runSketch({
      ctx,
      width: WIDTH,
      height: HEIGHT,
      source,
      vars,
      seed: seed + i
    });

    const framePath = path.join(tmp, `f_${i}.png`);
    fs.writeFileSync(framePath, canvas.toBuffer("image/png"));
    frames.push(framePath);
  }

  const out = path.join(tmp, "out.mp4");

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(tmp, "f_%d.png"))
      .inputFPS(fps)
      .outputOptions([
        "-pix_fmt yuv420p",
        "-movflags +faststart"
      ])
      .save(out)
      .on("end", resolve)
      .on("error", reject);
  });

  const buffer = fs.readFileSync(out);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    mime: "video/mp4",
    imageHash: hash
  };
}
