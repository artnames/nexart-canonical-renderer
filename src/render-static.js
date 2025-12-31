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

  const drawFrame = await runSketch({
    ctx,
    width: WIDTH,
    height: HEIGHT,
    source,
    vars,
    seed
  });

  // One render pass
  drawFrame();

  const buffer = canvas.toBuffer("image/png");
  const imageHash = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    mime: "image/png",
    imageHash
  };
}
