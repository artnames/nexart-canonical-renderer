import { createCanvas } from "canvas";
import crypto from "crypto";
import { runSketch } from "./runtime-p5.js";

const WIDTH = 1950;
const HEIGHT = 2400;

export async function renderStatic({
  source,
  vars,
  seed
}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  await runSketch({
    ctx,
    width: WIDTH,
    height: HEIGHT,
    source,
    vars,
    seed
  });

  const buffer = canvas.toBuffer("image/png");
  if (buffer.length < 10_000) {
    throw new Error(`Invalid PNG size: ${buffer.length}`);
  }

  const imageHash = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");

  return {
    buffer,
    mime: "image/png",
    imageHash
  };
}
