import { z } from "zod";
import { realClock } from "../core/clock";
import type { SessionTimers } from "../core/peerSession";
import { decodeWire, encodeWire } from "../core/sdpCodec";
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

export interface ResolvedWs {
  urlWs?: number;
  storedWs?: number;
  /** `?ws=` was present but not a workstation number — the UI must say so, not fall back mutely. */
  urlInvalid: boolean;
}

export function resolveWs(): ResolvedWs {
  const raw = new URLSearchParams(location.search).get("ws");
  const parsed = WsParamSchema.safeParse(raw);
  const out: ResolvedWs = { urlInvalid: raw !== null && !parsed.success };
  if (raw !== null && parsed.success) out.urlWs = parsed.data;
  const stored = StudentController.persistedWs(browserKv);
  if (stored !== undefined) out.storedWs = stored;
  return out;
}

/**
 * Dev-only `?timers=heartbeatMs,degradedMs,failedMs`. The student's shipped defaults (15 s
 * degraded, 60 s failed) are deliberately patient, which makes "teacher vanished" untestable in
 * an e2e run; this override exists for that test and is ignored in production builds. The schema
 * is built inside the DEV guard so the whole feature — parser included — is dead code a
 * production build drops.
 */
function urlTimers(): Partial<SessionTimers> | undefined {
  if (!import.meta.env.DEV) return undefined;
  const raw = new URLSearchParams(location.search).get("timers");
  if (raw === null) return undefined;
  const schema = z.tuple([
    z.coerce.number().int().min(200),
    z.coerce.number().int().min(500),
    z.coerce.number().int().min(1000),
  ]);
  const parsed = schema.safeParse(raw.split(","));
  if (!parsed.success) return undefined;
  const [heartbeatMs, degradedMs, failedMs] = parsed.data;
  return { heartbeatMs, degradedMs, failedMs };
}

// StrictMode invokes useState lazy initializers twice on mount, so StudentRoute could otherwise
// call bootStudent(ws) twice and spawn two controllers/PeerConnections; cache by ws so the second
// call reuses the in-flight/settled promise instead of booting again.
const bootCache = new Map<number, Promise<StudentController>>();

export async function bootStudent(ws: number): Promise<StudentController> {
  const cached = bootCache.get(ws);
  if (cached) return cached;
  const p = bootStudentUncached(ws);
  bootCache.set(ws, p);
  return p;
}

async function bootStudentUncached(ws: number): Promise<StudentController> {
  await primeCameraPermission(); // real-IP candidates; failure is non-fatal
  const certificates = await loadCertificate();
  const timers = urlTimers();
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
      ...(timers ? { timers } : {}),
      log: (m) => console.warn("[student]", m),
    },
    ws,
  );
  if (import.meta.env.DEV) {
    registerTestHook("student", async (wire) => {
      const p = await decodeWire(wire);
      await c.session?.applyRemote(p);
    });
  }
  // Dev-only /dev/load plumbing: an iframe'd student auto-pairs with the parent LabController.
  // The schema lives inside the guard so a production build drops the whole feature, parser
  // included (same reasoning as urlTimers above).
  if (
    import.meta.env.DEV &&
    window.parent !== window &&
    new URLSearchParams(location.search).get("autopair") === "1"
  ) {
    const AnswerMsg = z.object({
      type: z.literal("lab-answer"),
      wire: z.string().startsWith("LAB1:"),
    });
    c.on("session", (s) => {
      s.on("localPayload", (p) => {
        void encodeWire(p).then((wire) =>
          window.parent.postMessage({ type: "lab-offer", ws, wire }, location.origin),
        );
      });
    });
    window.addEventListener("message", (ev) => {
      if (ev.origin !== location.origin) return;
      const m = AnswerMsg.safeParse(ev.data);
      if (!m.success) return;
      void decodeWire(m.data.wire)
        .then((p) => c.session?.applyRemote(p))
        .catch((e: unknown) => console.warn("[autopair]", e));
    });
  }
  c.start();
  return c;
}
