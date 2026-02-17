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

export async function uploadArtifact({ userId, usageEventId, buffer, contentType }) {
  if (!SUPABASE_URL || !CER_INGEST_SECRET) return null;

  const ext = contentType === "video/mp4" ? "mp4" : "png";
  const storagePath = `user/${userId}/usage/${usageEventId}/output.${ext}`;
  const url = `${SUPABASE_URL}/storage/v1/object/certified-artifacts/${storagePath}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CER_INGEST_SECRET}`,
        "Content-Type": contentType,
        "x-upsert": "true"
      },
      body: buffer,
      signal: AbortSignal.timeout(30000)
    });

    if (response.ok) {
      console.log(`[cer-ingest] artifact uploaded path=${storagePath}`);
      return storagePath;
    } else {
      const text = await response.text().catch(() => "");
      console.warn(`[cer-ingest] artifact upload failed status=${response.status} body=${text.slice(0, 200)}`);
      return null;
    }
  } catch (error) {
    console.warn(`[cer-ingest] artifact upload error: ${error.message}`);
    return null;
  }
}

export async function ingestCerBundle({ usageEventId, endpoint, bundle, attestation, storeSensitive, artifactPath, artifactContentType }) {
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

  if (artifactPath) {
    payload.artifact = {
      path: artifactPath,
      contentType: artifactContentType || null
    };
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
    console.log(`[cer-ingest] usageEventId=${usageEventId} url=${SUPABASE_URL} status=${response.status} body=${text.slice(0, 200)}`);
  } catch (error) {
    console.warn(`[cer-ingest] usageEventId=${usageEventId} url=${SUPABASE_URL} error=${error.message}`);
  }
}
