import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/render", (req, res) => {
  console.log("Render request received:");
  console.log(req.body);

  res.json({
    message: "Canonical renderer stub",
    received: true
  });
});

app.listen(PORT, () => {
  console.log(`Renderer running on port ${PORT}`);
});