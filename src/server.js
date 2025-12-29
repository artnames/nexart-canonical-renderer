  import express from "express";
  import { createCanvas } from "canvas";

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/render", (req, res) => {
    const snapshot = req.body;

    // Basic MintSnapshotV1 validation
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

    console.log("Valid snapshot received:");
    console.log(snapshot);

    // Create canvas
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, 256, 256);

    // Green square
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(32, 32, 192, 192);

    // Export PNG
    const pngBuffer = canvas.toBuffer("image/png");

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", pngBuffer.length);
    res.send(pngBuffer);
  });

  // 🚨 IMPORTANT: listen is OUTSIDE routes
  app.listen(PORT, () => {
    console.log(`Renderer running on port ${PORT}`);
  });