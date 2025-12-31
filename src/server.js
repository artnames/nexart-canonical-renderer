import express from "express";
import { renderStatic } from "./render-static.js";
import { renderLoop } from "./render-loop.js";
import { validateRequest } from "./validation.js";
const app = express();
app.use(express.json());

app.get("/health", (_, res) => {
  res.json({ status: "ok", renderer: "nexart-canonical" });
});

app.post("/render", async (req, res) => {
  try {
    const validated = validateRequest(req.body, 240);

    const result =
      validated.mode === "loop"
        ? await renderLoop(validated)
        : await renderStatic(validated);

    res.setHeader("Content-Type", result.mime);
    res.setHeader("X-Image-Hash", result.imageHash);
    res.send(result.buffer);

  } catch (err) {
    console.error("[RENDER ERROR]", err);
    res.status(400).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("[CANONICAL RENDERER] running");
});
