import { validateApiKey, logUsageEvent } from "./db.js";

function isMeteringRequired() {
  const env = process.env.METERING_REQUIRED;
  if (env === undefined || env === null || env === "") {
    return process.env.NODE_ENV === "production";
  }
  return env.toLowerCase() !== "false" && env !== "0";
}

export function createAuthMiddleware() {
  return async (req, res, next) => {
    const startTime = Date.now();
    
    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing or invalid Authorization header. Use: Authorization: Bearer <api_key>"
      });
      
      logUsageEvent({
        apiKeyId: null,
        endpoint: req.path,
        statusCode: 401,
        durationMs: Date.now() - startTime,
        error: "missing_auth_header"
      });
      return;
    }

    const apiKey = authHeader.slice(7);
    const validation = await validateApiKey(apiKey);

    if (!validation.valid) {
      if (validation.reason === "database_unavailable" || validation.reason === "database_error") {
        if (isMeteringRequired()) {
          res.status(503).json({
            error: "SERVICE_UNAVAILABLE",
            message: "Database not available. Please try again later."
          });
          return;
        }
        
        req.meteringSkipped = true;
        req.startTime = startTime;
        return next();
      }

      res.status(401).json({
        error: "UNAUTHORIZED",
        message: validation.reason === "key_inactive" 
          ? "API key is inactive" 
          : "Invalid API key"
      });

      logUsageEvent({
        apiKeyId: validation.keyId || null,
        endpoint: req.path,
        statusCode: 401,
        durationMs: Date.now() - startTime,
        error: validation.reason
      });
      return;
    }

    req.apiKey = {
      id: validation.keyId,
      label: validation.label,
      plan: validation.plan,
      monthlyLimit: validation.monthlyLimit,
      userId: validation.userId
    };
    req.startTime = startTime;

    next();
  };
}

export function createAdminAuthMiddleware() {
  return (req, res, next) => {
    const adminSecret = process.env.ADMIN_SECRET;
    
    if (!adminSecret) {
      return res.status(503).json({
        error: "ADMIN_NOT_CONFIGURED",
        message: "ADMIN_SECRET environment variable not set"
      });
    }

    const providedSecret = req.get("X-Admin-Secret");
    if (!providedSecret) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing X-Admin-Secret header"
      });
    }

    if (providedSecret !== adminSecret) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Invalid admin secret"
      });
    }

    next();
  };
}

export function requireAdmin(req, res, next) {
  const adminSecret = process.env.ADMIN_SECRET;
  
  if (!adminSecret) {
    return res.status(503).json({
      error: "ADMIN_NOT_CONFIGURED",
      message: "ADMIN_SECRET environment variable not set"
    });
  }

  const providedSecret = req.get("X-Admin-Secret");
  if (!providedSecret || providedSecret !== adminSecret) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Missing or invalid X-Admin-Secret header"
    });
  }

  next();
}

export function createUsageLogger(sdkVersion, defaultProtocolVersion, canvasWidth, canvasHeight) {
  // Signature: logUsage(req, res, runtimeHash, error, resolvedProtocolVersion?, protocolDefaulted?)
  return (req, res, runtimeHash, error, resolvedProtocolVersion, protocolDefaulted) => {
    const durationMs = Date.now() - (req.startTime || Date.now());
    
    logUsageEvent({
      apiKeyId: req.apiKey?.id || null,
      endpoint: req.path,
      statusCode: res.statusCode,
      durationMs,
      width: canvasWidth,
      height: canvasHeight,
      sdkVersion,
      // Use resolved version if provided, otherwise fall back to default
      protocolVersion: resolvedProtocolVersion ?? defaultProtocolVersion,
      protocolDefaulted: protocolDefaulted ?? false,
      runtimeHash: runtimeHash || null,
      outputHashPrefix: runtimeHash ? runtimeHash.slice(0, 16) : null,
      error: error || null
    });
  };
}
