const SUPABASE_URL = process.env.SUPABASE_URL;
const CER_INGEST_SECRET = process.env.CER_INGEST_SECRET;

console.log(`[cer-ingest] env hasSupabaseUrl=${!!SUPABASE_URL} hasCerIngestSecret=${!!CER_INGEST_SECRET}`);

export function coerceUsageEventId(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  if (raw && typeof raw === "object" && raw.id != null) {
    const inner = raw.id;
    if (typeof inner === "number") return inner;
    if (typeof inner === "string" && /^\d+$/.test(inner)) return Number(inner);
  }
  return null;
}

export async function ingestCerBundle({ usageEventId, endpoint, bundle, attestation, storeSensitive, artifactBase64, artifactMime }) {
  if (!SUPABASE_URL || !CER_INGEST_SECRET) {
    console.warn("[cer-ingest] disabled (missing env)");
    return;
  }

  const payload = {
    usageEventId,
    endpoint: endpoint || null,
    bundle,
    attestation,
    storeSensitive: storeSensitive ?? false
  };

  if (artifactBase64) {
    payload.artifactBase64 = artifactBase64;
    payload.artifactMime = artifactMime || null;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/store-cer-bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CER_INGEST_SECRET}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const text = await response.text().catch(() => "");
    console.log(`[cer-ingest] bundleType=${bundle?.bundleType || "unknown"} usageEventId=${usageEventId} status=${response.status} body=${text.slice(0, 200)}`);
  } catch (error) {
    console.warn(`[cer-ingest] bundleType=${bundle?.bundleType || "unknown"} usageEventId=${usageEventId} error=${error.message}`);
  }
}
