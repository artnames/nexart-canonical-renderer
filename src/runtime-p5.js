import vm from "vm";

export async function runSketch({
  ctx,
  width,
  height,
  source,
  vars,
  seed
}) {
  // Deterministic RNG
  let s = seed >>> 0;
  function random() {
    s += 0x6D2B79F5;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  const sandbox = {
    // Canvas
    width,
    height,
    ctx,

    // VAR protocol
    VAR: vars,

    // Frame state
    frameCount: 0,

    // Math
    sin: Math.sin,
    cos: Math.cos,
    sqrt: Math.sqrt,
    pow: Math.pow,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    floor: Math.floor,
    TWO_PI: Math.PI * 2,

    map: (v, a1, a2, b1, b2) =>
      b1 + (b2 - b1) * ((v - a1) / (a2 - a1)),

    constrain: (v, a, b) => Math.max(a, Math.min(b, v)),

    // Drawing API
    background(r, g, b) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, width, height);
    },

    fill(r, g, b) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
    },

    noFill() {
      ctx.fillStyle = "transparent";
    },

    stroke(r, g, b) {
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
    },

    noStroke() {
      ctx.strokeStyle = "transparent";
    },

    rect(x, y, w, h) {
      ctx.fillRect(x, y, w, h);
    },

    // RNG
    random,

    // Control
    noLoop() {}
  };

  const wrapped = `
    let __frame = 0;
    ${source}

    if (typeof setup === "function") setup();

    function __drawFrame() {
      frameCount = __frame;
      if (typeof draw === "function") draw();
      __frame++;
    }
  `;

  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { timeout: 2000 });

  return () => {
    sandbox.__drawFrame();
  };
}
