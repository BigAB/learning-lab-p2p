import { getOrCreateCertificate } from "../../core/certStore";
import { idbKv } from "./idbKv";
export async function loadCertificate(): Promise<RTCCertificate[] | undefined> {
  if (typeof RTCPeerConnection === "undefined" || !RTCPeerConnection.generateCertificate)
    return undefined;
  try {
    const cert = await getOrCreateCertificate(idbKv, () =>
      RTCPeerConnection.generateCertificate({
        name: "ECDSA",
        namedCurve: "P-256",
      } as EcKeyGenParams),
    );
    return [cert];
  } catch {
    return undefined;
  }
}
