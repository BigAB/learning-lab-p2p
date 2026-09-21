import type { CmdMessage } from "../schemas/protocol";
import type { SdpPayload } from "../schemas/sdpPayload";
import type { Settings, TeacherState } from "../schemas/storage";
import {
  RosterEntrySchema,
  SettingsSchema,
  TEACHER_KEY,
  TeacherStateSchema,
} from "../schemas/storage";
import { WS_MAX, WS_MIN } from "../schemas/ws";
import type { Clock } from "./clock";
import { Emitter } from "./events";
import { PeerSession, type SessionState } from "./peerSession";
import type { KeyValueStore, RtcFactory, Visibility } from "./ports";
import { loadState, saveState } from "./store";

export interface TeacherEnv {
  rtc: RtcFactory;
  clock: Clock;
  kv: KeyValueStore;
  appVersion: string;
  ua: string;
  certificates?: RTCCertificate[];
  log?(msg: string): void;
}

export interface RosterView {
  ws: number;
  state: SessionState | "never";
  rtt?: number;
  label?: string;
  lastConnectedAt?: number;
  lastSeenUa?: string;
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  versionMismatch: boolean;
  /** DTLS fingerprint of the current pairing, uppercase colon-separated hex (spec §6.3). */
  fingerprint?: string;
  /** True when this ws paired before with a *different* certificate: not the same iPad. */
  fingerprintChanged: boolean;
  history: { at: number; state: SessionState }[];
}

interface Live {
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  fingerprintChanged: boolean;
  history: { at: number; state: SessionState }[];
}

export type LabEvents = { change: [] };

/** Rejects a superseded acceptOffer(): a same-ws re-scan closed this session before it answered. */
export class SupersededError extends Error {
  override name = "SupersededError";
}

const ALL_WS = Array.from({ length: WS_MAX - WS_MIN + 1 }, (_, i) => WS_MIN + i);
const HISTORY_CAP = 50;

/** Raw sha-256 fingerprint bytes → the `AA:BB:…` form the browser and the drawer both show. */
function hexFingerprint(fp: Uint8Array): string {
  return Array.from(fp, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** Teacher side: up to 30 PeerSessions, persisted roster metadata, repair queue. */
export class LabController extends Emitter<LabEvents> {
  state: TeacherState;
  readonly sessions = new Map<number, PeerSession>();
  private readonly live = new Map<number, Live>();

  constructor(private readonly env: TeacherEnv) {
    super();
    this.state = loadState(
      env.kv,
      TEACHER_KEY,
      TeacherStateSchema,
      TeacherStateSchema.parse({}),
      env.log,
    );
  }

  get settings(): Settings {
    return this.state.settings;
  }

  /** Validates the merged settings before applying. Returns false (unchanged) on invalid input. */
  updateSettings(patch: Partial<Settings>): boolean {
    const merged = { ...this.state.settings, ...patch };
    const r = SettingsSchema.safeParse(merged);
    if (!r.success) {
      this.env.log?.(`updateSettings: invalid (${r.error.issues[0]?.message ?? "?"})`);
      return false;
    }
    this.state.settings = r.data;
    this.persist();
    return true;
  }

  /** Validates the label before applying. Returns false (unchanged) on invalid input. */
  setLabel(ws: number, label: string): boolean {
    const r = RosterEntrySchema.shape.label.safeParse(label);
    if (!r.success) {
      this.env.log?.(`setLabel: invalid (${r.error.issues[0]?.message ?? "?"})`);
      return false;
    }
    this.entry(ws).label = label;
    this.persist();
    return true;
  }

  /** Accept a student's offer; resolves with our answer payload once ICE gathering completes. */
  acceptOffer(offer: SdpPayload): Promise<SdpPayload> {
    const ws = offer.ws;
    this.sessions.get(ws)?.close();
    const { heartbeatMs, degradedMs, failedMs } = this.state.settings;
    const s = new PeerSession({
      role: "teacher",
      ws,
      rtc: this.env.rtc,
      clock: this.env.clock,
      timers: { heartbeatMs, degradedMs, failedMs },
      appVersion: this.env.appVersion,
      ua: this.env.ua,
      ...(this.env.certificates ? { certificates: this.env.certificates } : {}),
    });
    this.sessions.set(ws, s);
    // The student's DTLS certificate is persisted per device (spec §6.3), so a fingerprint that
    // matches the previous pairing means the same iPad came back; a different one means the
    // station was swapped (or the iPad was wiped) and the teacher should be told.
    const e = this.entry(ws);
    const fp = hexFingerprint(offer.fp);
    const fingerprintChanged = e.lastFingerprint !== undefined && e.lastFingerprint !== fp;
    e.lastFingerprint = fp;
    // History is the station's story across the lab day, not this session's: a re-pair continues
    // it rather than wiping the evidence of why the last one died.
    const previous = this.live.get(ws);
    this.live.set(ws, { history: previous?.history ?? [], fingerprintChanged });
    this.wire(s);
    this.persist();

    const answer = new Promise<SdpPayload>((resolve, reject) => {
      const offLocal = s.on("localPayload", (p) => {
        cleanup();
        resolve(p);
      });
      // A same-ws re-scan can close() this session (see acceptOffer above) while we're still
      // waiting on the answer: applyRemote() then resolves silently instead of throwing (the
      // peerSession fix for the gather-wait deadlock), so without this the promise would hang.
      const offState = s.on("state", (st) => {
        if (st === "failed") {
          cleanup();
          reject(new SupersededError("session closed before an answer was produced"));
        }
      });
      function cleanup(): void {
        offLocal();
        offState();
      }
      s.applyRemote(offer).catch((e: unknown) => {
        cleanup();
        reject(e as Error);
      });
    });
    this.changed();
    return answer;
  }

  sendCmd(ws: number, cmd: CmdMessage["cmd"]): void {
    this.sessions.get(ws)?.send({ t: "cmd", cmd });
  }

  /** Stations that need a walk: never paired this run, or hard-failed. Ordered by ws. */
  repairQueue(): number[] {
    return ALL_WS.filter((ws) => {
      const st = this.sessions.get(ws)?.state;
      return st === undefined || st === "failed";
    });
  }

  snapshot(): RosterView[] {
    return ALL_WS.map((ws) => {
      const s = this.sessions.get(ws);
      const e = this.state.roster[String(ws)];
      const l = this.live.get(ws);
      const view: RosterView = {
        ws,
        state: s?.state ?? "never",
        versionMismatch:
          l?.remoteAppVersion !== undefined && l.remoteAppVersion !== this.env.appVersion,
        fingerprintChanged: l?.fingerprintChanged ?? false,
        history: l ? [...l.history] : [],
      };
      if (e?.lastFingerprint !== undefined) view.fingerprint = e.lastFingerprint;
      if (s?.lastRtt !== undefined) view.rtt = s.lastRtt;
      if (e?.label !== undefined) view.label = e.label;
      if (e?.lastConnectedAt !== undefined) view.lastConnectedAt = e.lastConnectedAt;
      if (e?.lastSeenUa !== undefined) view.lastSeenUa = e.lastSeenUa;
      if (l?.battery !== undefined) view.battery = l.battery;
      if (l?.charging !== undefined) view.charging = l.charging;
      if (l?.visibility !== undefined) view.visibility = l.visibility;
      if (l?.wakeLock !== undefined) view.wakeLock = l.wakeLock;
      if (l?.remoteAppVersion !== undefined) view.remoteAppVersion = l.remoteAppVersion;
      return view;
    });
  }

  counts(): { connected: number; degraded: number; failed: number; never: number } {
    const c = { connected: 0, degraded: 0, failed: 0, never: 0 };
    for (const t of this.snapshot()) {
      if (t.state === "connected") c.connected++;
      else if (t.state === "degraded") c.degraded++;
      else if (t.state === "never") c.never++;
      else if (t.state === "failed") c.failed++;
    }
    return c;
  }

  // ---- internals ----

  private wire(s: PeerSession): void {
    const ws = s.ws;
    s.on("state", (st, prev) => {
      const l = this.live.get(ws);
      if (l) {
        l.history.push({ at: this.env.clock.now(), state: st });
        if (l.history.length > HISTORY_CAP) l.history.splice(0, l.history.length - HISTORY_CAP);
      }
      // Only a fresh handshake (connecting → connected) counts as a pairing; recovering from
      // degraded is the same pairing continuing, not a new one.
      if (st === "connected" && prev === "connecting") {
        const e = this.entry(ws);
        e.lastConnectedAt = this.env.clock.now();
        e.pairCount += 1;
        this.persist();
      }
      this.changed();
    });
    s.on("hello", (h) => {
      const e = this.entry(ws);
      e.lastSeenUa = h.ua;
      const l = this.live.get(ws);
      if (l) l.remoteAppVersion = h.appVersion;
      this.persist();
    });
    s.on("rtt", (ms) => {
      const e = this.entry(ws);
      e.lastRtt = ms;
      this.changed();
    });
    s.on("message", (m) => {
      if (m.t !== "status") return;
      const l = this.live.get(ws);
      if (!l) return;
      if (m.battery !== undefined) l.battery = m.battery;
      if (m.charging !== undefined) l.charging = m.charging;
      l.visibility = m.visibility;
      l.wakeLock = m.wakeLock;
      this.changed();
    });
    s.on("needsRepair", (reason) => this.env.log?.(`ws ${ws} failed: ${reason}`));
  }

  private entry(ws: number) {
    const key = String(ws);
    return (this.state.roster[key] ??= { pairCount: 0 });
  }

  private persist(): void {
    try {
      saveState(this.env.kv, TEACHER_KEY, TeacherStateSchema, this.state);
    } catch (e) {
      this.env.log?.(`persist failed: ${(e as Error).message}`);
    }
    this.changed();
  }

  private changed(): void {
    this.emit("change");
  }
}
