const SUPABASE_URL = process.env.SUPABASE_URL;
const CER_INGEST_SECRET = process.env.CER_INGEST_SECRET;

let disabledLogged = false;

export async function ingestCerBundle({ usageEventId, bundle, attestation }) {
  if (!SUPABASE_URL || !CER_INGEST_SECRET) {
    if (!disabledLogged) {
      console.warn("[cer-ingest] disabled (missing env)");
      disabledLogged = true;
    }
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
        "X-CER-INGEST-SECRET": CER_INGEST_SECRET,
        "Authorization": `Bearer ${CER_INGEST_SECRET}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      const cert = bundle?.certificateHash || "unknown";
      console.log(`[cer-ingest] ok usageEventId=${usageEventId} cert=${cert}`);
    } else {
      const text = await response.text().catch(() => "");
      console.warn(`[cer-ingest] fail status=${response.status} usageEventId=${usageEventId} body=${text.slice(0, 300)}`);
    }
  } catch (error) {
    console.warn(`[cer-ingest] error usageEventId=${usageEventId} ${error.message}`);
  }
}
