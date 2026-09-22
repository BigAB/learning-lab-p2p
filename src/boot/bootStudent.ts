import { z } from "zod";
import { realClock } from "../core/clock";
import type { SessionTimers } from "../core/peerSession";
import { decodeWire, encodeWire } from "../core/sdpCodec";
import { StudentController } from "../core/studentController";
import { WsSchema, wsKey } from "../schemas/ws";
import { APP_VERSION } from "../ui/platform/appVersion";
import { browserDevice } from "../ui/platform/browserDevice";
import { browserKv } from "../ui/platform/browserKv";
import { browserMedia } from "../ui/platform/browserMedia";
import { browserRtc } from "../ui/platform/browserRtc";
import { browserWakeLock } from "../ui/platform/browserWakeLock";
import { primeCameraPermission } from "../ui/platform/camera";
import { loadCertificate } from "../ui/platform/cert";
import { registerTestHook } from "./testHook";

export interface ResolvedWs {
  urlWs?: string;
  storedWs?: string;
  /** `?ws=` was present but not a legal workstation ID — the UI must say so, not fall back mutely. */
  urlInvalid: boolean;
}

export function resolveWs(): ResolvedWs {
  const raw = new URLSearchParams(location.search).get("ws");
  const parsed = WsSchema.safeParse(raw);
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
// call bootStudent(ws) twice and spawn two controllers/PeerConnections; cache by wsKey so the
// second call reuses the in-flight/settled promise instead of booting again.
const bootCache = new Map<string, Promise<StudentController>>();

export async function bootStudent(ws: string): Promise<StudentController> {
  const key = wsKey(ws);
  const cached = bootCache.get(key);
  if (cached) return cached;
  const p = bootStudentUncached(ws);
  bootCache.set(key, p);
  return p;
}

/** Stop the controller for `ws` and forget it, so a later bootStudent(ws) starts fresh. */
export async function releaseStudent(ws: string): Promise<void> {
  const key = wsKey(ws);
  const p = bootCache.get(key);
  bootCache.delete(key);
  if (p) (await p).stop();
}

async function bootStudentUncached(ws: string): Promise<StudentController> {
  await primeCameraPermission(); // real-IP candidates; failure is non-fatal
  const certificates = await loadCertificate();
  const timers = urlTimers();
  const c = new StudentController(
    {
      rtc: browserRtc,
      clock: realClock,
      kv: browserKv,
      media: browserMedia,
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
    registerTestHook(
      "student",
      async (wire) => {
        const p = await decodeWire(wire);
        await c.session?.applyRemote(p);
      },
      { activeTracks: () => (c.session?.media?.captureActive() ? 1 : 0) },
    );
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
      wire: z.string().startsWith("LAB2:"),
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
