export const WIDTH = 1950;
export const HEIGHT = 2400;

export function validateRequest(body, maxFrames) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const mode = body.execution?.mode || body.mode || "static";
  if (mode !== "static" && mode !== "loop") {
    throw new Error("Invalid render mode");
  }

  if (typeof body.source !== "string" || body.source.trim() === "") {
    throw new Error("Source code required");
  }

  if (!Array.isArray(body.vars) || body.vars.length !== 10) {
    throw new Error("vars must be array of 10 numbers");
  }

  body.vars.forEach((v, i) => {
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      throw new Error(`VAR[${i}] out of range`);
    }
  });

  if (!Number.isFinite(body.seed)) {
    throw new Error("Invalid seed");
  }

  return {
    mode,
    source: body.source,
    vars: body.vars,
    seed: body.seed,
    width: WIDTH,
    height: HEIGHT,
    execution: body.execution ?? { mode: "static", totalFrames: 1 }
  };
}
