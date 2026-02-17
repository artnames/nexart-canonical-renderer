const SUPABASE_URL = process.env.SUPABASE_URL;
const CER_INGEST_SECRET = process.env.CER_INGEST_SECRET;

console.log(`[cer-ingest] env hasSupabaseUrl=${!!SUPABASE_URL} hasCerIngestSecret=${!!CER_INGEST_SECRET}`);

export async function ingestCerBundle({ usageEventId, bundle, attestation }) {
  if (!SUPABASE_URL || !CER_INGEST_SECRET) {
    console.warn("[cer-ingest] disabled (missing env)");
    return;
  }

  const url = `${SUPABASE_URL}/functions/v1/store-cer-bundle`;
  const payload = {
    usageEventId,
    bundle,
    attestation
  };

  try {
    const response = await fetch(url, {
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
