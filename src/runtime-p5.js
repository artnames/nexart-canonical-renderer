import vm from "vm";

export async function runSketch({
  ctx,
  width,
  height,
  source,
  vars,
  seed
}) {
  let s = seed >>> 0;
  function random() {
    s += 0x6D2B79F5;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  const sandbox = {
    width,
    height,
    ctx,
    VAR: vars,

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

    background(r, g, b) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, width, height);
    },
    fill(r, g, b) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
    },
    noStroke() {},
    rect(x, y, w, h) {
      ctx.fillRect(x, y, w, h);
    },

    random,
    noLoop() {}
  };

  const wrapped = `
    (function(){
      ${source}
      if (typeof setup === "function") setup();
    })();
  `;

  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { timeout: 2000 });
}
