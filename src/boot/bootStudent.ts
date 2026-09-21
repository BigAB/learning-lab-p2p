import { realClock } from "../core/clock";
import { decodeWire } from "../core/sdpCodec";
import { StudentController } from "../core/studentController";
import { WsParamSchema } from "../schemas/ws";
import { APP_VERSION } from "../ui/platform/appVersion";
import { browserDevice } from "../ui/platform/browserDevice";
import { browserKv } from "../ui/platform/browserKv";
import { browserRtc } from "../ui/platform/browserRtc";
import { browserWakeLock } from "../ui/platform/browserWakeLock";
import { primeCameraPermission } from "../ui/platform/camera";
import { loadCertificate } from "../ui/platform/cert";
import { registerTestHook } from "./testHook";

export function resolveWs(): { urlWs?: number; storedWs?: number } {
  const out: { urlWs?: number; storedWs?: number } = {};
  const raw = new URLSearchParams(location.search).get("ws");
  const parsed = WsParamSchema.safeParse(raw);
  if (raw !== null && parsed.success) out.urlWs = parsed.data;
  const stored = StudentController.persistedWs(browserKv);
  if (stored !== undefined) out.storedWs = stored;
  return out;
}

export async function bootStudent(ws: number): Promise<StudentController> {
  await primeCameraPermission(); // real-IP candidates; failure is non-fatal
  const certificates = await loadCertificate();
  const c = new StudentController(
    {
      rtc: browserRtc,
      clock: realClock,
      kv: browserKv,
      wakeLock: browserWakeLock,
      device: browserDevice,
      reload: () => location.reload(),
      appVersion: APP_VERSION,
      ua: navigator.userAgent,
      ...(certificates ? { certificates } : {}),
      log: (m) => console.warn("[student]", m),
    },
    ws,
  );
  registerTestHook("student", async (wire) => {
    const p = await decodeWire(wire);
    await c.session?.applyRemote(p);
  });
  c.start();
  return c;
}
