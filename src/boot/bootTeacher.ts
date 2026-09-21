import { realClock } from "../core/clock";
import { LabController } from "../core/labController";
import { decodeWire, encodeWire } from "../core/sdpCodec";
import { APP_VERSION } from "../ui/platform/appVersion";
import { browserKv } from "../ui/platform/browserKv";
import { browserRtc } from "../ui/platform/browserRtc";
import { primeCameraPermission } from "../ui/platform/camera";
import { loadCertificate } from "../ui/platform/cert";
import { registerTestHook } from "./testHook";

// /teacher (main.tsx route()) and Task 13's /dev/load can both call this on one page; guard
// against double-booting two LabControllers (and two sets of RTCPeerConnections), the way
// bootStudent caches per ws.
let cached: Promise<LabController> | undefined;

export async function bootTeacher(): Promise<LabController> {
  if (cached) return cached;
  const p = bootTeacherUncached();
  cached = p;
  return p;
}

async function bootTeacherUncached(): Promise<LabController> {
  await primeCameraPermission();
  const certificates = await loadCertificate();
  const lab = new LabController({
    rtc: browserRtc,
    clock: realClock,
    kv: browserKv,
    appVersion: APP_VERSION,
    ua: navigator.userAgent,
    ...(certificates ? { certificates } : {}),
    log: (m) => console.warn("[teacher]", m),
  });
  if (import.meta.env.DEV) {
    registerTestHook("teacher", async (wire) => {
      const p = await decodeWire(wire);
      if (p.role !== "offer") throw new Error("teacher expects an offer");
      return encodeWire(await lab.acceptOffer(p));
    });
  }
  return lab;
}
