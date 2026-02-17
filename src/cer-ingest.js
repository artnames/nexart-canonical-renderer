const SUPABASE_URL = process.env.SUPABASE_URL;
const CER_INGEST_SECRET = process.env.CER_INGEST_SECRET;

export async function ingestCerBundle({ usageEventId, bundle, attestation }) {
  if (!SUPABASE_URL || !CER_INGEST_SECRET) {
    return;
  }

  const payload = {
    usageEventId,
    bundle,
    attestation
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/store-cer-bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CER-INGEST-SECRET": CER_INGEST_SECRET
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`[CER-INGEST] Failed (${response.status}): ${text.slice(0, 200)}`);
    }
  } catch (error) {
    console.warn(`[CER-INGEST] Error: ${error.message}`);
  }
}
