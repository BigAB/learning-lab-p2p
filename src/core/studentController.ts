import type { CmdMessage } from "../schemas/protocol";
import type { StudentState } from "../schemas/storage";
import { STUDENT_KEY, StudentStateSchema } from "../schemas/storage";
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import { PeerSession, type SessionTimers } from "./peerSession";
import type { DevicePort, KeyValueStore, RtcFactory, WakeLockPort } from "./ports";
import { loadState, saveState } from "./store";

export interface StudentEnv {
  rtc: RtcFactory;
  clock: Clock;
  kv: KeyValueStore;
  wakeLock: WakeLockPort;
  device: DevicePort;
  reload(): void;
  appVersion: string;
  ua: string;
  certificates?: RTCCertificate[];
  timers?: Partial<SessionTimers>;
  restartDelayMs?: number;
  log?(msg: string): void;
}

export type StudentEvents = {
  session: [PeerSession];
  cmd: [CmdMessage["cmd"]];
  state: [StudentState];
  /** A spawn attempt died before it could show a QR (message is user-facing). */
  error: [string];
};

/** Ceiling for the exponential respawn backoff: a wedged iPad still retries every 30 s. */
export const MAX_RESTART_DELAY_MS = 30_000;

/** Owns the one student PeerSession: spawns, persists, auto-restarts on failure, reports status. */
export class StudentController extends Emitter<StudentEvents> {
  readonly ws: number;
  session: PeerSession | null = null;
  state: StudentState;
  wakeLockHeld = false;
  private stopped = false;
  private offVisibility: (() => void) | undefined;
  /** Consecutive spawn attempts since the last `connected`; drives the respawn backoff. */
  private attempt = 0;
  private respawnTimer: TimerHandle | undefined;

  static persistedWs(kv: KeyValueStore): number | undefined {
    const raw = kv.get(STUDENT_KEY);
    if (raw === null) return undefined;
    try {
      const r = StudentStateSchema.safeParse(JSON.parse(raw));
      return r.success ? r.data.ws : undefined;
    } catch {
      return undefined;
    }
  }

  constructor(
    private readonly env: StudentEnv,
    ws: number,
  ) {
    super();
    this.ws = ws;
    const log = env.log ?? (() => {});
    const loaded = loadState(
      env.kv,
      STUDENT_KEY,
      StudentStateSchema,
      StudentStateSchema.parse({ ws }),
      log,
    );
    this.state = { ...loaded, ws };
    this.persist();
  }

  start(): void {
    if (this.session) return;
    this.stopped = false;
    // A fresh start is a fresh run: the backoff belongs to the run that failed, not to the class.
    this.attempt = 0;
    this.offVisibility = this.env.device.onVisibility((v) => {
      if (v === "visible") void this.acquireWakeLock();
      void this.pushStatus();
    });
    void this.acquireWakeLock();
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    this.offVisibility?.();
    this.offVisibility = undefined;
    this.cancelRespawn();
    this.attempt = 0;
    this.session?.close();
    this.session = null;
  }

  async pushStatus(): Promise<void> {
    const s = this.session;
    if (!s || (s.state !== "connected" && s.state !== "degraded")) return;
    const b = await this.env.device.battery();
    s.send({
      t: "status",
      ...(b ? { battery: b.level, charging: b.charging } : {}),
      visibility: this.env.device.visibility(),
      wakeLock: this.wakeLockHeld,
    });
  }

  private spawn(): void {
    if (this.stopped) return;
    const s = new PeerSession({
      role: "student",
      ws: this.ws,
      rtc: this.env.rtc,
      clock: this.env.clock,
      appVersion: this.env.appVersion,
      ua: this.env.ua,
      ...(this.env.timers ? { timers: this.env.timers } : {}),
      ...(this.env.certificates ? { certificates: this.env.certificates } : {}),
    });
    s.on("state", (st, prev) => {
      if (st === "connected") {
        // A session that got all the way up clears the backoff: the next failure restarts at
        // restartDelayMs rather than inheriting the delay of a previous bad run.
        this.attempt = 0;
        // Only a fresh handshake (connecting → connected) counts as a pairing; recovering from
        // degraded is the same pairing continuing, not a new one.
        if (prev === "connecting") {
          this.state.lastConnectedAt = this.env.clock.now();
          this.state.pairCount += 1;
          this.persist();
        }
        void this.pushStatus();
      }
    });
    s.on("hello", (h) => {
      this.state.teacherAppVersion = h.appVersion;
      this.persist();
    });
    s.on("message", (m) => {
      if (m.t === "cmd") this.onCmd(m.cmd);
    });
    s.on("needsRepair", (reason) => {
      this.env.log?.(`session failed: ${reason}`);
      this.scheduleRespawn(s);
    });
    this.session = s;
    this.emit("session", s);
    // A rejected start() (no usable ICE candidate, codec refusal, PC blew up) leaves the kiosk on
    // "Starting…" forever unless we tear the dead session down and try again — with a backoff, so
    // a permanently broken device does not spin.
    s.start().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.env.log?.(`start failed: ${msg}`);
      s.close();
      if (this.session === s) {
        this.session = null;
        this.scheduleRespawn(null);
      }
      this.emit("error", msg);
    });
  }

  /** Respawn after `restartDelayMs * 2^attempt` (capped), but only if `expect` is still current. */
  private scheduleRespawn(expect: PeerSession | null): void {
    if (this.stopped) return;
    const base = this.env.restartDelayMs ?? 500;
    const delay = Math.min(base * 2 ** this.attempt, MAX_RESTART_DELAY_MS);
    this.attempt += 1;
    this.cancelRespawn();
    this.respawnTimer = this.env.clock.setTimeout(() => {
      this.respawnTimer = undefined;
      if (this.session === expect) this.spawn();
    }, delay);
  }

  private cancelRespawn(): void {
    if (this.respawnTimer !== undefined) this.env.clock.clearTimeout(this.respawnTimer);
    this.respawnTimer = undefined;
  }

  private onCmd(cmd: CmdMessage["cmd"]): void {
    this.emit("cmd", cmd);
    if (cmd === "ping") void this.pushStatus();
    if (cmd === "reload") this.env.reload();
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLockHeld = await this.env.wakeLock.request();
    } catch {
      this.wakeLockHeld = false;
    }
  }

  private persist(): void {
    try {
      saveState(this.env.kv, STUDENT_KEY, StudentStateSchema, this.state);
    } catch (e) {
      this.env.log?.(`persist failed: ${(e as Error).message}`);
    }
    this.emit("state", this.state);
  }
}
