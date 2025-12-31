import express from "express";
import { executeCodeMode } from "@nexart/codemode-sdk";
import crypto from "crypto";

const app = express();
app.use(express.json());

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    protocol: "nexart",
    engine: "codemode",
    sdk: "authority"
  });
});

app.post("/render", async (req, res) => {
  try {
    const snapshot = req.body;

    // 1️⃣ Minimal protocol validation
    if (
      snapshot.version !== "1" ||
      snapshot.engine_version !== "1.0" ||
      !Array.isArray(snapshot.vars)
    ) {
      throw new Error("INVALID_SNAPSHOT");
    }

    // 2️⃣ Delegate execution to SDK (single source of truth)
    const result = await executeCodeMode({
      source: snapshot.source,
      vars: snapshot.vars,
      seed: snapshot.seed,
      mode: snapshot.execution.mode, // static | loop
      totalFrames: snapshot.execution.totalFrames,
      width: 1950,
      height: 2400
    });

    // result MUST come from SDK
    // result.buffer (PNG | MP4)
    // result.mime
    // result.frames? (optional)

    // 3️⃣ Hash
    const hash = crypto
      .createHash("sha256")
      .update(result.buffer)
      .digest("hex");

    res.setHeader("Content-Type", result.mime);
    res.setHeader("X-Image-Hash", hash);
    res.send(result.buffer);

  } catch (err) {
    console.error("[CANONICAL RENDER ERROR]", err);
    res.status(400).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("[CANONICAL NODE] running with codemode SDK");
});
