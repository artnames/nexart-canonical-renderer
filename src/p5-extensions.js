export function extendP5Runtime(p, canvas) {
  const ctx = canvas.getContext("2d");
  let rectModeValue = "corner";
  let ellipseModeValue = "center";
  
  p.createCanvas = () => {
    throw new Error("PROTOCOL_VIOLATION: createCanvas() is not allowed. Canvas is hard-locked to 1950x2400 by NexArt Protocol.");
  };
  
  p.strokeCap = (cap) => {
    const capMap = { round: "round", square: "butt", project: "square" };
    ctx.lineCap = capMap[cap] || cap || "round";
  };
  
  p.strokeJoin = (join) => {
    const joinMap = { round: "round", miter: "miter", bevel: "bevel" };
    ctx.lineJoin = joinMap[join] || join || "miter";
  };
  
  p.rectMode = (mode) => {
    rectModeValue = mode || "corner";
  };
  
  p.ellipseMode = (mode) => {
    ellipseModeValue = mode || "center";
  };
  
  const originalRect = p.rect.bind(p);
  p.rect = (x, y, w, h, ...rest) => {
    let rx = x, ry = y, rw = w, rh = h;
    if (rectModeValue === "center") {
      rx = x - w / 2;
      ry = y - h / 2;
    } else if (rectModeValue === "radius") {
      rx = x - w;
      ry = y - h;
      rw = w * 2;
      rh = h * 2;
    } else if (rectModeValue === "corners") {
      rw = w - x;
      rh = h - y;
    }
    originalRect(rx, ry, rw, rh, ...rest);
  };
  
  const originalEllipse = p.ellipse.bind(p);
  p.ellipse = (x, y, w, h = w) => {
    let ex = x, ey = y, ew = w, eh = h;
    if (ellipseModeValue === "corner") {
      ex = x + w / 2;
      ey = y + h / 2;
    } else if (ellipseModeValue === "corners") {
      ex = x + (w - x) / 2;
      ey = y + (h - y) / 2;
      ew = Math.abs(w - x);
      eh = Math.abs(h - y);
    } else if (ellipseModeValue === "radius") {
      ew = w * 2;
      eh = h * 2;
    }
    originalEllipse(ex, ey, ew, eh);
  };
  
  p.blendMode = (mode) => {
    const modeMap = {
      "blend": "source-over",
      "add": "lighter",
      "multiply": "multiply",
      "screen": "screen",
      "overlay": "overlay",
      "darken": "darken",
      "lighten": "lighten",
      "difference": "difference",
      "exclusion": "exclusion",
      "hard-light": "hard-light",
      "soft-light": "soft-light"
    };
    ctx.globalCompositeOperation = modeMap[mode] || mode || "source-over";
  };
  
  p.textSize = (size) => {
    ctx.font = `${size}px sans-serif`;
  };
  
  p.textAlign = (alignX, alignY) => {
    ctx.textAlign = alignX || "left";
    ctx.textBaseline = alignY || "alphabetic";
  };
  
  p.text = (str, x, y) => {
    ctx.fillText(String(str), x, y);
  };
  
  p.BLEND = "blend";
  p.ADD = "add";
  p.MULTIPLY = "multiply";
  p.SCREEN = "screen";
  p.CENTER = "center";
  p.CORNER = "corner";
  p.CORNERS = "corners";
  p.RADIUS = "radius";
  
  return p;
}
