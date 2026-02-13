import { createRequire } from "module";
import {
  CODE_MODE_PROTOCOL_VERSION,
  SDK_VERSION as SDK_VERSION_FROM_SDK
} from "@nexart/codemode-sdk/node";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const protocolVersion = CODE_MODE_PROTOCOL_VERSION || "1.0.0";
const sdkDependency = packageJson.dependencies["@nexart/codemode-sdk"];
const sdkVersion = SDK_VERSION_FROM_SDK || sdkDependency.replace(/[\^~>=<]/g, "");

export const versionInfo = {
  service: "nexart-node",
  serviceVersion: packageJson.version || "1.0.0",
  sdkVersion,
  sdkDependency,
  protocolVersion,
  serviceBuild: process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
  nodeVersion: process.version,
};

export function getVersionInfo() {
  return { ...versionInfo };
}
