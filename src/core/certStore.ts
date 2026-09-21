import type { AsyncKv } from "./ports";

export const CERT_KEY = "lab.cert.v1";

function isLiveCert(v: unknown): v is RTCCertificate {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as RTCCertificate).expires === "number" &&
    (v as RTCCertificate).expires > Date.now() + 24 * 3600 * 1000
  );
}

/** Stable DTLS certificate per device. Falls back to a fresh cert if storage misbehaves. */
export async function getOrCreateCertificate(
  kv: AsyncKv,
  generate: () => Promise<RTCCertificate>,
): Promise<RTCCertificate> {
  try {
    const stored = await kv.get(CERT_KEY);
    if (isLiveCert(stored)) return stored;
  } catch {
    // fall through
  }
  const cert = await generate();
  try {
    await kv.set(CERT_KEY, cert);
  } catch {
    // storage unavailable; cert still usable for this session
  }
  return cert;
}
