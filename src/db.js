import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn("[DB] DATABASE_URL not set - database features disabled");
      return null;
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (err) => {
      console.error("[DB] Unexpected pool error:", err.message);
    });
  }
  return pool;
}

export async function runMigrations() {
  const db = getPool();
  if (!db) return false;

  try {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.join(__dirname, "..", "migrations");
    
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`[DB] Running migration: ${file}`);
      await db.query(sql);
    }

    console.log("[DB] Migrations complete");
    return true;
  } catch (error) {
    console.error("[DB] Migration error:", error.message);
    return false;
  }
}

export function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export async function validateApiKey(apiKey) {
  const db = getPool();
  if (!db) return { valid: false, reason: "database_unavailable" };

  try {
    const keyHash = hashApiKey(apiKey);
    const result = await db.query(
      `SELECT id, label, plan, status, monthly_limit, user_id 
       FROM api_keys 
       WHERE key_hash = $1`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return { valid: false, reason: "invalid_key" };
    }

    const key = result.rows[0];
    if (key.status !== "active") {
      return { valid: false, reason: "key_inactive", keyId: key.id };
    }

    return { 
      valid: true, 
      keyId: key.id, 
      label: key.label, 
      plan: key.plan,
      monthlyLimit: key.monthly_limit,
      userId: key.user_id
    };
  } catch (error) {
    console.error("[DB] API key validation error:", error.message);
    return { valid: false, reason: "database_error" };
  }
}

const DEFAULT_MONTHLY_LIMIT = 100;

export async function getAccountQuota(userId) {
  const db = getPool();
  if (!db) return { limit: DEFAULT_MONTHLY_LIMIT, used: 0, available: true };

  try {
    let monthlyLimit = DEFAULT_MONTHLY_LIMIT;

    if (userId) {
      const accountResult = await db.query(
        `SELECT monthly_limit FROM accounts WHERE user_id = $1`,
        [userId]
      );
      if (accountResult.rows.length > 0) {
        monthlyLimit = accountResult.rows[0].monthly_limit;
      }
    }

    const usageResult = await db.query(
      `SELECT COUNT(*) as count
       FROM usage_events ue
       JOIN api_keys ak ON ue.api_key_id = ak.id
       WHERE ak.user_id = $1
         AND ue.endpoint = '/api/render'
         AND ue.status_code >= 200 AND ue.status_code < 300
         AND ue.ts >= DATE_TRUNC('month', NOW())`,
      [userId]
    );

    const used = parseInt(usageResult.rows[0]?.count || 0, 10);

    return {
      limit: monthlyLimit,
      used,
      remaining: Math.max(0, monthlyLimit - used),
      exceeded: used >= monthlyLimit
    };
  } catch (error) {
    console.error("[DB] Quota check error:", error.message);
    return { limit: DEFAULT_MONTHLY_LIMIT, used: 0, remaining: DEFAULT_MONTHLY_LIMIT, exceeded: false };
  }
}

export async function getQuotaResetDate() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

export async function logUsageEvent(event) {
  const db = getPool();
  if (!db) return false;

  try {
    await db.query(
      `INSERT INTO usage_events 
       (api_key_id, endpoint, status_code, duration_ms, width, height, 
        sdk_version, protocol_version, protocol_defaulted, runtime_hash, output_hash_prefix, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        event.apiKeyId || null,
        event.endpoint,
        event.statusCode,
        event.durationMs,
        event.width || null,
        event.height || null,
        event.sdkVersion || null,
        event.protocolVersion || null,
        event.protocolDefaulted ?? null,
        event.runtimeHash || null,
        event.outputHashPrefix || null,
        event.error || null
      ]
    );
    return true;
  } catch (error) {
    console.error("[DB] Usage logging error:", error.message);
    return false;
  }
}

export async function getUsageToday() {
  const db = getPool();
  if (!db) return [];

  try {
    const result = await db.query(`
      SELECT 
        api_key_id,
        endpoint,
        COUNT(*) as count,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        AVG(duration_ms)::INTEGER as avg_duration_ms
      FROM usage_events
      WHERE ts >= CURRENT_DATE
      GROUP BY api_key_id, endpoint
      ORDER BY count DESC
    `);
    return result.rows;
  } catch (error) {
    console.error("[DB] Usage query error:", error.message);
    return [];
  }
}

export async function getUsageMonth() {
  const db = getPool();
  if (!db) return [];

  try {
    const result = await db.query(`
      SELECT 
        api_key_id,
        endpoint,
        COUNT(*) as count,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        AVG(duration_ms)::INTEGER as avg_duration_ms
      FROM usage_events
      WHERE ts >= DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY api_key_id, endpoint
      ORDER BY count DESC
    `);
    return result.rows;
  } catch (error) {
    console.error("[DB] Usage query error:", error.message);
    return [];
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
