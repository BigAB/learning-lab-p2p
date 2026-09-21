import type { CmdMessage } from "../schemas/protocol";
import type { StudentState } from "../schemas/storage";
import { STUDENT_KEY, StudentStateSchema } from "../schemas/storage";
import type { Clock } from "./clock";
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
};

/** Owns the one student PeerSession: spawns, persists, auto-restarts on failure, reports status. */
export class StudentController extends Emitter<StudentEvents> {
  readonly ws: number;
  session: PeerSession | null = null;
  state: StudentState;
  wakeLockHeld = false;
  private stopped = false;
  private offVisibility: (() => void) | undefined;

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
    this.stopped = false;
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
    s.on("state", (st) => {
      if (st === "connected") {
        this.state.lastConnectedAt = this.env.clock.now();
        this.state.pairCount += 1;
        this.persist();
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
      this.env.clock.setTimeout(() => {
        if (this.session === s) this.spawn();
      }, this.env.restartDelayMs ?? 500);
    });
    this.session = s;
    this.emit("session", s);
    s.start().catch((e: unknown) => this.env.log?.(`start failed: ${String(e)}`));
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
    saveState(this.env.kv, STUDENT_KEY, StudentStateSchema, this.state);
    this.emit("state", this.state);
  }
}
