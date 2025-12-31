export function extendP5Runtime(p, canvas) {
  const ctx = canvas.getContext("2d");
  let rectModeValue = "corner";
  let ellipseModeValue = "center";
  
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
  
  return p;
}
