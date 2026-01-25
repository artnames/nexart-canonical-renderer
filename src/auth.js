import { validateApiKey, logUsageEvent } from "./db.js";

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
        res.status(503).json({
          error: "SERVICE_UNAVAILABLE",
          message: "Database not available. Please try again later."
        });

        logUsageEvent({
          apiKeyId: null,
          endpoint: req.path,
          statusCode: 503,
          durationMs: Date.now() - startTime,
          error: validation.reason
        });
        return;
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
      monthlyLimit: validation.monthlyLimit
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

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing or invalid Authorization header"
      });
    }

    const providedSecret = authHeader.slice(7);
    if (providedSecret !== adminSecret) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Invalid admin secret"
      });
    }

    next();
  };
}

export function createUsageLogger(sdkVersion, protocolVersion, canvasWidth, canvasHeight) {
  return (req, res, runtimeHash, error) => {
    const durationMs = Date.now() - (req.startTime || Date.now());
    
    logUsageEvent({
      apiKeyId: req.apiKey?.id || null,
      endpoint: req.path,
      statusCode: res.statusCode,
      durationMs,
      width: canvasWidth,
      height: canvasHeight,
      sdkVersion,
      protocolVersion,
      runtimeHash: runtimeHash || null,
      outputHashPrefix: runtimeHash ? runtimeHash.slice(0, 16) : null,
      error: error || null
    });
  };
}
