import type { CmdMessage } from "../schemas/protocol";
import type { SdpPayload } from "../schemas/sdpPayload";
import type { Settings, TeacherState } from "../schemas/storage";
import {
  RosterEntrySchema,
  SettingsSchema,
  TEACHER_KEY,
  TeacherStateSchema,
} from "../schemas/storage";
import { LEGACY_TEACHER_KEY } from "../schemas/legacy";
import { compareWs, wsKey } from "../schemas/ws";
import type { Clock } from "./clock";
import { Emitter } from "./events";
import { migrateTeacherV1 } from "./migrations";
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
  /** wsKey(ws): stable lookup handle, React key, `data-tile` value. */
  key: string;
  /** Display form: the ID as the student most recently typed it. */
  ws: string;
  state: SessionState | "never";
  rtt?: number;
  label?: string;
  /** When this pairing's handshake completed (persisted). */
  lastConnectedAt?: number;
  /** When we last heard *anything* from the station: live while a session exists, else persisted. */
  lastSeenAt?: number;
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
  /** This pairing replaced a session that was still connected/degraded. Cleared by acknowledgeReplaced(). */
  replaced: boolean;
  history: { at: number; state: SessionState }[];
}

interface Live {
  lastSeenAt?: number;
  /** Clock time of the last persisted lastSeenAt; gates the once-a-minute write. */
  seenPersistedAt?: number;
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  fingerprintChanged: boolean;
  replaced: boolean;
  history: { at: number; state: SessionState }[];
}

export type LabEvents = { change: [] };

/** Rejects a superseded acceptOffer(): a same-ws re-scan closed this session before it answered. */
export class SupersededError extends Error {
  override name = "SupersededError";
}

const HISTORY_CAP = 50;
/**
 * A heartbeat lands every 5 s from every station; persisting lastSeenAt on each would be a
 * localStorage write every few hundred ms for nothing. Once a minute per station keeps a
 * teacher-tab reload honest to within a minute, and degraded/failed transitions write
 * immediately because "when did we lose it" is exactly the number the dashboard then needs.
 */
const SEEN_PERSIST_MS = 60_000;

/** Raw sha-256 fingerprint bytes → the `AA:BB:…` form the browser and the drawer both show. */
function hexFingerprint(fp: Uint8Array): string {
  return Array.from(fp, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** Teacher side: one PeerSession per known station, persisted roster metadata, repair queue. */
export class LabController extends Emitter<LabEvents> {
  state: TeacherState;
  /** Keyed by wsKey(ws). */
  readonly sessions = new Map<string, PeerSession>();
  private readonly live = new Map<string, Live>();

  constructor(private readonly env: TeacherEnv) {
    super();
    const log = env.log ?? (() => {});
    this.state = loadState(
      env.kv,
      TEACHER_KEY,
      TeacherStateSchema,
      TeacherStateSchema.parse({}),
      log,
      () => migrateTeacherV1(env.kv, log),
    );
    // v1 never outlives a v2 boot, whether it was migrated or shadowed by an existing v2 blob.
    env.kv.remove(LEGACY_TEACHER_KEY);
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

  /** Validates the label before applying. Returns false (unchanged) on invalid input or unknown ws. */
  setLabel(ws: string, label: string): boolean {
    const e = this.state.roster[wsKey(ws)];
    if (!e) return false;
    const r = RosterEntrySchema.shape.label.safeParse(label);
    if (!r.success) {
      this.env.log?.(`setLabel: invalid (${r.error.issues[0]?.message ?? "?"})`);
      return false;
    }
    e.label = label;
    this.persist();
    return true;
  }

  /** Accept a student's offer; resolves with our answer payload once ICE gathering completes. */
  acceptOffer(offer: SdpPayload): Promise<SdpPayload> {
    const ws = offer.ws;
    const key = wsKey(ws);
    const old = this.sessions.get(key);
    // Reload-to-fix: a repeat pairing simply replaces the old session. If that session was still
    // alive, the teacher should notice — a typo on another iPad may have kicked a healthy
    // station — so the tile carries a badge until the drawer is opened.
    const replaced = old !== undefined && (old.state === "connected" || old.state === "degraded");
    old?.close();
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
    this.sessions.set(key, s);
    const e = this.entry(ws);
    e.ws = ws; // the latest spelling is the one shown
    // The student's DTLS certificate is persisted per device (spec §6.3), so a fingerprint that
    // matches the previous pairing means the same iPad came back; a different one means the
    // station was swapped (or the iPad was wiped) and the teacher should be told.
    const fp = hexFingerprint(offer.fp);
    const fingerprintChanged = e.lastFingerprint !== undefined && e.lastFingerprint !== fp;
    // History is the station's story across the lab day, not this session's: a re-pair continues
    // it rather than wiping the evidence of why the last one died.
    const previous = this.live.get(key);
    this.live.set(key, { history: previous?.history ?? [], fingerprintChanged, replaced });
    this.wire(s);
    this.persist();

    const answer = new Promise<SdpPayload>((resolve, reject) => {
      const offLocal = s.on("localPayload", (p) => {
        cleanup();
        // Recorded only now: a scan that never produced an answer (superseded, PC blew up) was
        // not a pairing, and must not become the baseline the next continuity check compares to.
        this.entry(ws).lastFingerprint = fp;
        this.persist();
        resolve(p);
      });
      // A same-ws re-scan can close() this session while we're still waiting on the answer:
      // applyRemote() then resolves silently instead of throwing, so without this the promise
      // would hang.
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

  /**
   * Forget a station: close its session, drop its tile, label and history. `false` if unknown.
   * An iPad that is still running simply pairs again later as a fresh station.
   */
  remove(ws: string): boolean {
    const key = wsKey(ws);
    if (!(key in this.state.roster) && !this.sessions.has(key)) return false;
    // Close first: the failed transition's handlers still read live/roster for this key.
    this.sessions.get(key)?.close();
    this.sessions.delete(key);
    this.live.delete(key);
    delete this.state.roster[key];
    this.persist();
    return true;
  }

  /** The teacher has seen the `replaced` badge (drawer opened). */
  acknowledgeReplaced(ws: string): void {
    const l = this.live.get(wsKey(ws));
    if (!l?.replaced) return;
    l.replaced = false;
    this.changed();
  }

  sendCmd(ws: string, cmd: CmdMessage["cmd"]): void {
    this.sessions.get(wsKey(ws))?.send({ t: "cmd", cmd });
  }

  /** Stations that need a walk: known but no session this run, or hard-failed. Natural order. */
  repairQueue(): string[] {
    return this.orderedKeys()
      .filter((k) => {
        const st = this.sessions.get(k)?.state;
        return st === undefined || st === "failed";
      })
      .map((k) => this.state.roster[k]!.ws);
  }

  snapshot(): RosterView[] {
    return this.orderedKeys().map((key) => {
      const e = this.state.roster[key]!;
      const s = this.sessions.get(key);
      const l = this.live.get(key);
      const view: RosterView = {
        key,
        ws: e.ws,
        state: s?.state ?? "never",
        versionMismatch:
          l?.remoteAppVersion !== undefined && l.remoteAppVersion !== this.env.appVersion,
        fingerprintChanged: l?.fingerprintChanged ?? false,
        replaced: l?.replaced ?? false,
        history: l ? [...l.history] : [],
      };
      if (e.lastFingerprint !== undefined) view.fingerprint = e.lastFingerprint;
      if (s?.lastRtt !== undefined) view.rtt = s.lastRtt;
      if (e.label !== undefined) view.label = e.label;
      if (e.lastConnectedAt !== undefined) view.lastConnectedAt = e.lastConnectedAt;
      const seen = l?.lastSeenAt ?? e.lastSeenAt;
      if (seen !== undefined) view.lastSeenAt = seen;
      if (e.lastSeenUa !== undefined) view.lastSeenUa = e.lastSeenUa;
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

  private orderedKeys(): string[] {
    const roster = this.state.roster;
    return Object.keys(roster).sort((a, b) => compareWs(roster[a]!.ws, roster[b]!.ws));
  }

  private wire(s: PeerSession): void {
    const ws = s.ws;
    const key = wsKey(ws);
    s.on("state", (st, prev) => {
      const l = this.live.get(key);
      if (l) {
        l.history.push({ at: this.env.clock.now(), state: st });
        if (l.history.length > HISTORY_CAP) l.history.splice(0, l.history.length - HISTORY_CAP);
      }
      // Only a fresh handshake (connecting → connected) counts as a pairing; recovering from
      // degraded is the same pairing continuing, not a new one.
      if (st === "connected" && prev === "connecting") {
        const e = this.entry(ws);
        const now = this.env.clock.now();
        e.lastConnectedAt = now;
        e.pairCount += 1;
        this.markSeen(ws, now, true);
        this.persist();
      }
      // The last sighting before we lost them is the number the tile needs now; write it.
      if ((st === "degraded" || st === "failed") && l?.lastSeenAt !== undefined) {
        this.markSeen(ws, l.lastSeenAt, true);
        this.persist();
      }
      this.changed();
    });
    s.on("inbound", () => {
      const now = this.env.clock.now();
      const l = this.live.get(key);
      const due = l?.seenPersistedAt === undefined || now - l.seenPersistedAt >= SEEN_PERSIST_MS;
      this.markSeen(ws, now, due);
      if (due) this.persist();
      else this.changed();
    });
    s.on("hello", (h) => {
      const e = this.entry(ws);
      e.lastSeenUa = h.ua;
      const l = this.live.get(key);
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
      const l = this.live.get(key);
      if (!l) return;
      if (m.battery !== undefined) l.battery = m.battery;
      if (m.charging !== undefined) l.charging = m.charging;
      l.visibility = m.visibility;
      l.wakeLock = m.wakeLock;
      this.changed();
    });
    s.on("needsRepair", (reason) => this.env.log?.(`ws ${ws} failed: ${reason}`));
  }

  /** Update the live sighting; `persist` also copies it into the roster entry (caller saves). */
  private markSeen(ws: string, at: number, persist: boolean): void {
    const l = this.live.get(wsKey(ws));
    if (l) l.lastSeenAt = at;
    if (persist) {
      this.entry(ws).lastSeenAt = at;
      if (l) l.seenPersistedAt = at;
    }
  }

  /** The roster entry for `ws`, created on first sight with `ws` as its display form. */
  private entry(ws: string) {
    const key = wsKey(ws);
    return (this.state.roster[key] ??= { ws, pairCount: 0 });
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
