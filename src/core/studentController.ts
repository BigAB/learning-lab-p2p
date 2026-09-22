import type { CmdMessage } from "../schemas/protocol";
import { LEGACY_STUDENT_KEY } from "../schemas/legacy";
import type { CamState, MediaSource, Profile } from "../schemas/media";
import { MEDIA_CAP } from "../schemas/media";
import type { StudentState } from "../schemas/storage";
import { STUDENT_KEY, StudentStateSchema } from "../schemas/storage";
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import type { MediaLink, MediaState, MediaTimers } from "./mediaLink";
import { migrateStudentV1 } from "./migrations";
import { PeerSession, type SessionTimers } from "./peerSession";
import type { DevicePort, KeyValueStore, MediaPort, RtcFactory, WakeLockPort } from "./ports";
import { loadState, saveState } from "./store";

export interface StudentEnv {
  rtc: RtcFactory;
  clock: Clock;
  kv: KeyValueStore;
  wakeLock: WakeLockPort;
  device: DevicePort;
  media: MediaPort;
  reload(): void;
  appVersion: string;
  ua: string;
  certificates?: RTCCertificate[];
  timers?: Partial<SessionTimers>;
  mediaTimers?: Partial<MediaTimers>;
  restartDelayMs?: number;
  log?(msg: string): void;
}

export interface StudentMediaView {
  state: MediaState;
  cam: CamState;
  send: Profile | null;
  /** The teacher's video, once negotiated. Shown only while broadcast.on. */
  teacherTrack?: MediaStreamTrack;
  broadcast: { on: boolean; source?: MediaSource };
}

export type StudentEvents = {
  session: [PeerSession];
  cmd: [CmdMessage["cmd"]];
  state: [StudentState];
  /** A spawn attempt died before it could show a QR (message is user-facing). */
  error: [string];
  media: [StudentMediaView];
};

/** Ceiling for the exponential respawn backoff: a wedged iPad still retries every 30 s. */
export const MAX_RESTART_DELAY_MS = 30_000;

/** Owns the one student PeerSession: spawns, persists, auto-restarts on failure, reports status. */
export class StudentController extends Emitter<StudentEvents> {
  readonly ws: string;
  session: PeerSession | null = null;
  state: StudentState;
  wakeLockHeld = false;
  private stopped = false;
  private offVisibility: (() => void) | undefined;
  /** Consecutive spawn attempts since the last `connected`; drives the respawn backoff. */
  private attempt = 0;
  private respawnTimer: TimerHandle | undefined;

  /** The saved station, v2 first, else what a v1 blob would migrate to. Removes nothing. */
  static persistedWs(kv: KeyValueStore): string | undefined {
    const raw = kv.get(STUDENT_KEY);
    if (raw !== null) {
      try {
        const r = StudentStateSchema.safeParse(JSON.parse(raw));
        return r.success ? r.data.ws : undefined;
      } catch {
        return undefined;
      }
    }
    return migrateStudentV1(kv, () => {})?.ws;
  }

  constructor(
    private readonly env: StudentEnv,
    ws: string,
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
      () => migrateStudentV1(env.kv, log),
    );
    // v1 never outlives a v2 boot, whether it was migrated or shadowed by an existing v2 blob.
    env.kv.remove(LEGACY_STUDENT_KEY);
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

  mediaView(): StudentMediaView {
    const link = this.session?.media;
    // A failed session's link is closed; report it as gone rather than frozen at its last state.
    const live = link && this.session?.state !== "failed" ? link : undefined;
    const b = live?.lastBroadcast;
    const v: StudentMediaView = {
      state: live?.state ?? "none",
      cam: live?.cam ?? "off",
      send: live?.sending ?? null,
      broadcast: { on: b?.on ?? false, ...(b?.source ? { source: b.source } : {}) },
    };
    if (live?.remoteTrack) v.teacherTrack = live.remoteTrack;
    return v;
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
      caps: [MEDIA_CAP],
      ...(this.env.timers ? { timers: this.env.timers } : {}),
      ...(this.env.mediaTimers ? { mediaTimers: this.env.mediaTimers } : {}),
      ...(this.env.certificates ? { certificates: this.env.certificates } : {}),
    });
    s.on("state", (st, prev) => {
      if (st === "failed") this.emitMedia(s);
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
    s.on("media", (link: MediaLink) => {
      link.on("request", (send) => {
        void link.applyRequest(send, this.env.media).then(() => this.emitMedia(s));
      });
      link.on("state", () => this.emitMedia(s));
      link.on("remoteTrack", () => this.emitMedia(s));
      link.on("broadcast", () => this.emitMedia(s));
      link.on("capture", () => this.emitMedia(s));
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

  private emitMedia(s: PeerSession): void {
    if (this.session !== s) return;
    this.emit("media", this.mediaView());
  }
}
