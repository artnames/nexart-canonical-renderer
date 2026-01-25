import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const packageJson = require("../package.json");
const sdkPath = path.resolve(__dirname, "../node_modules/@nexart/codemode-sdk/dist/p5-runtime.js");

let protocolVersion = "1.0.0";
try {
  const sdk = require(sdkPath);
  if (sdk.CODE_MODE_PROTOCOL_VERSION) {
    protocolVersion = sdk.CODE_MODE_PROTOCOL_VERSION;
  }
} catch (e) {
  console.warn("Could not read protocol version from SDK, using default");
}

const sdkDependency = packageJson.dependencies["@nexart/codemode-sdk"];
const sdkVersion = sdkDependency.replace(/[\^~>=<]/g, "");

export const versionInfo = {
  service: "nexart-node",
  serviceVersion: packageJson.version || "1.0.0",
  sdkVersion,
  sdkDependency,
  protocolVersion,
  serviceBuild: process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "dev",
  nodeVersion: process.version,
};

export function getVersionInfo() {
  return { ...versionInfo };
}
