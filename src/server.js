  import express from "express";
  import { createCanvas } from "canvas";
  import crypto from "crypto";

  const app = express();
  const PORT = process.env.PORT || 3000;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

app.post("/render", (req, res) => {
  const snapshot = req.body;

  // 1️⃣ Validate snapshot FIRST
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.engine_version !== "string" ||
    !Array.isArray(snapshot.vars) ||
    snapshot.vars.length !== 10
  ) {
    return res.status(400).json({
      error: "INVALID_SNAPSHOT",
      message: "Snapshot does not match MintSnapshotV1 shape"
    });
  }

  // 2️⃣ Clamp VARs safely (AFTER validation)
  const v0 = Math.min(1, Math.max(0, snapshot.vars[0] ?? 0));
  const v1 = Math.min(1, Math.max(0, snapshot.vars[1] ?? 0));

  // 3️⃣ Convert seed string → deterministic number
  const seedString = String(snapshot.seed ?? "0");
  let seed = 0;
  for (let i = 0; i < seedString.length; i++) {
    seed = (seed * 31 + seedString.charCodeAt(i)) >>> 0;
  }

  // 4️⃣ Create deterministic RNG
  const rand = mulberry32(seed);

  console.log("Valid snapshot received:", snapshot);

  // 5️⃣ Canvas
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext("2d");

  // 6️⃣ Background driven by seed
  const bg = Math.floor(20 + rand() * 40);
  ctx.fillStyle = `rgb(${bg}, ${bg}, ${bg})`;
  ctx.fillRect(0, 0, 256, 256);

  // 7️⃣ VAR-driven square
  const size = 40 + v0 * 160;
  const x = rand() * (256 - size);
  const y = rand() * (256 - size);

  // 8️⃣ Seeded color
  const r = Math.floor(100 + rand() * 155);
  const g = Math.floor(100 + rand() * 155);
  const b = Math.floor(100 + rand() * 155);

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(x, y, size, size);

  // 9️⃣ Export PNG
  const pngBuffer = canvas.toBuffer("image/png");
  const pngHash = crypto
  .createHash("sha256")
  .update(pngBuffer)
  .digest("hex");

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", pngBuffer.length);
  res.setHeader("X-Image-Hash", pngHash);
  res.send(pngBuffer);
});

  // 🚨 IMPORTANT: listen is OUTSIDE routes
  app.listen(PORT, () => {
    console.log(`Renderer running on port ${PORT}`);
  });