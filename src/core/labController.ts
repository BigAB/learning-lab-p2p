import type { CmdMessage } from "../schemas/protocol";
import type { CamState, MediaSource, Profile } from "../schemas/media";
import { MEDIA_CAP } from "../schemas/media";
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
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import { CAPTURE, type Degradation } from "./media";
import type { MediaLink, MediaState, MediaStatsView, MediaTimers } from "./mediaLink";
import { migrateTeacherV1 } from "./migrations";
import { PeerSession, type SessionState } from "./peerSession";
import type { KeyValueStore, MediaPort, RtcFactory, Visibility } from "./ports";
import { loadState, saveState } from "./store";

export interface TeacherEnv {
  rtc: RtcFactory;
  clock: Clock;
  kv: KeyValueStore;
  appVersion: string;
  ua: string;
  certificates?: RTCCertificate[];
  log?(msg: string): void;
  media?: MediaPort;
  mediaTimers?: Partial<MediaTimers>;
  /** Stats poll period while media is active. */
  statsMs?: number;
}

export interface TileMedia {
  state: MediaState;
  reason?: string;
  cam: CamState;
  send: Profile | null;
  /** The student's video, once negotiated. The UI wraps it in a MediaStream. */
  track?: MediaStreamTrack;
  stats?: MediaStatsView;
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
  media: TileMedia;
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
  media: {
    cam: CamState;
    send: Profile | null;
    reason?: string;
    track?: MediaStreamTrack;
    stats?: MediaStatsView;
  };
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
const DEFAULT_STATS_MS = 2000;

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
  readonly broadcast: { source: MediaSource | null; track: MediaStreamTrack | null } = {
    source: null,
    track: null,
  };
  /** wsKey of the focused station, if any. */
  focused: string | undefined;
  private statsTimer: TimerHandle | undefined;
  /** Monotonic per startBroadcast() call; only the latest call may take the air. */
  private broadcastSeq = 0;

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
      caps: [MEDIA_CAP],
      ...(this.env.certificates ? { certificates: this.env.certificates } : {}),
      ...(this.env.mediaTimers ? { mediaTimers: this.env.mediaTimers } : {}),
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
    this.live.set(key, {
      history: previous?.history ?? [],
      fingerprintChanged,
      replaced,
      media: { cam: "off", send: null },
    });
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
    if (this.focused === key) this.focused = undefined;
    this.sessions.delete(key);
    this.live.delete(key);
    delete this.state.roster[key];
    this.syncStats();
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

  /**
   * Start sending the teacher's camera or screen to every ready station. The port is called
   * before the first await so a click handler's user activation still covers getDisplayMedia.
   */
  async startBroadcast(source: MediaSource): Promise<void> {
    const port = this.env.media;
    if (!port) throw new Error("no media port");
    const pending = source === "camera" ? port.camera(CAPTURE) : port.screen();
    // Two picker dialogs can be open at once and settle in either order; the teacher's latest
    // choice is the one that should be on air. A superseded call releases its track and resolves
    // quietly: it was not a failure, just overtaken.
    const seq = ++this.broadcastSeq;
    const track = await pending;
    if (seq !== this.broadcastSeq) {
      track.stop();
      return;
    }
    this.stopBroadcastTrack();
    this.broadcast.source = source;
    this.broadcast.track = track;
    track.onended = () => {
      if (this.broadcast.track === track) this.stopBroadcast();
    };
    for (const s of this.sessions.values()) this.applyBroadcast(s);
    this.syncStats();
    this.changed();
  }

  stopBroadcast(): void {
    if (this.broadcast.source === null && this.broadcast.track === null) return;
    this.stopBroadcastTrack();
    this.broadcast.source = null;
    for (const s of this.sessions.values()) this.applyBroadcast(s);
    this.syncStats();
    this.changed();
  }

  /** Thumbnails from every station (persisted preference). */
  setCameras(on: boolean): void {
    this.state.settings.media.cameras = on;
    for (const [key, s] of this.sessions) this.readyLink(s)?.request(this.desiredSend(key));
    this.syncStats();
    this.persist();
  }

  /** Raise one station to the focus profile; null clears. Unknown ws ⇒ no change. */
  focus(ws: string | null): void {
    const key = ws === null ? undefined : wsKey(ws);
    if (key !== undefined && !this.sessions.has(key)) return;
    const prev = this.focused;
    if (prev === key) return;
    this.focused = key;
    if (prev !== undefined) {
      const s = this.sessions.get(prev);
      if (s) this.readyLink(s)?.request(this.desiredSend(prev));
    }
    if (key !== undefined) {
      const s = this.sessions.get(key);
      if (s) this.readyLink(s)?.request(this.desiredSend(key));
    }
    this.syncStats();
    this.changed();
  }

  /** Re-offer media to a station whose negotiation failed. */
  retryMedia(ws: string): boolean {
    const link = this.sessions.get(wsKey(ws))?.media;
    if (!link || link.state !== "failed") return false;
    void link.offer(this.state.settings.media.codec);
    return true;
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
      // A failed session has torn its media down (spec §4.5): MediaLink.close() never flips
      // `.state` off "ready", so a dead session's link would otherwise be reported as live.
      const failed = s?.state === "failed";
      const link = failed ? undefined : s?.media;
      const media: TileMedia = failed
        ? { state: "none", cam: "off", send: null }
        : {
            state: link?.state ?? "none",
            cam: l?.media.cam ?? "off",
            send: l?.media.send ?? null,
          };
      if (!failed) {
        const reason = link?.reason ?? l?.media.reason;
        if (reason !== undefined) media.reason = reason;
        if (l?.media.track) media.track = l.media.track;
        if (l?.media.stats) media.stats = l.media.stats;
      }
      const view: RosterView = {
        key,
        ws: e.ws,
        state: s?.state ?? "never",
        versionMismatch:
          l?.remoteAppVersion !== undefined && l.remoteAppVersion !== this.env.appVersion,
        fingerprintChanged: l?.fingerprintChanged ?? false,
        replaced: l?.replaced ?? false,
        media,
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
    // Runs on every change, including the 2 s stats tick: read session state directly rather
    // than building a full RosterView per station just to look at one field.
    const c = { connected: 0, degraded: 0, failed: 0, never: 0 };
    for (const key of Object.keys(this.state.roster)) {
      const st = this.sessions.get(key)?.state;
      if (st === undefined) c.never++;
      else if (st === "connected") c.connected++;
      else if (st === "degraded") c.degraded++;
      else if (st === "failed") c.failed++;
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
      if (st === "failed" && this.focused === key) this.focused = undefined;
      if (st === "failed") this.syncStats();
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
      const link = s.media;
      if (link) {
        if (h.caps?.includes(MEDIA_CAP)) {
          if (link.state === "none")
            link
              .offer(this.state.settings.media.codec)
              .catch((e: unknown) =>
                this.env.log?.(`media offer failed: ${e instanceof Error ? e.message : String(e)}`),
              );
        } else link.markUnsupported();
      }
    });
    s.on("media", (link) => this.wireMedia(key, s, link));
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

  private wireMedia(key: string, s: PeerSession, link: MediaLink): void {
    link.on("state", (st) => {
      if (st === "ready") {
        this.applyBroadcast(s);
        link.request(this.desiredSend(key));
      }
      if (st === "failed" && this.focused === key) this.focused = undefined;
      this.syncStats();
      this.changed();
    });
    link.on("status", (m) => {
      const l = this.live.get(key);
      if (l) {
        l.media.cam = m.cam;
        l.media.send = m.send;
        if (m.reason !== undefined) l.media.reason = m.reason;
        else delete l.media.reason;
      }
      this.changed();
    });
    link.on("remoteTrack", (track) => {
      const l = this.live.get(key);
      if (l) l.media.track = track;
      this.changed();
    });
  }

  private desiredSend(key: string): Profile | null {
    const m = this.state.settings.media;
    if (this.focused === key) return m.focus;
    return m.cameras ? m.thumb : null;
  }

  /** Push the current broadcast (or its absence) to one ready link. */
  private applyBroadcast(s: PeerSession): void {
    const link = this.readyLink(s);
    if (!link) return;
    const { source, track } = this.broadcast;
    const m = this.state.settings.media;
    const profile =
      source === "camera" ? m.broadcastCamera : source === "screen" ? m.broadcastScreen : null;
    const degradation: Degradation = source === "screen" ? "maintain-resolution" : "balanced";
    void link.setOutbound(track, profile, degradation);
    if (source) link.broadcast(true, source);
    else link.broadcast(false);
  }

  private stopBroadcastTrack(): void {
    const t = this.broadcast.track;
    if (t) {
      t.onended = null;
      t.stop();
    }
    this.broadcast.track = null;
  }

  private mediaActive(): boolean {
    return (
      this.broadcast.source !== null ||
      this.state.settings.media.cameras ||
      this.focused !== undefined
    );
  }

  /**
   * The station's media link, but only when the session itself is still alive. MediaLink.close()
   * never changes `.state` off "ready", so a failed session's link would otherwise still look
   * ready forever: callers that need to actually push/pull media, or decide whether one is
   * doing so, must go through here rather than reading `s.media` directly.
   */
  private readyLink(s: PeerSession): MediaLink | undefined {
    const link = s.media;
    if (!link || link.state !== "ready") return undefined;
    return s.state === "connected" || s.state === "degraded" ? link : undefined;
  }

  /** Poll getStats only while something is streaming and someone is ready to report. */
  private syncStats(): void {
    const anyReady = [...this.sessions.values()].some((s) => this.readyLink(s) !== undefined);
    const want = this.mediaActive() && anyReady;
    if (want && this.statsTimer === undefined) {
      this.statsTimer = this.env.clock.setInterval(
        () => void this.pollStats(),
        this.env.statsMs ?? DEFAULT_STATS_MS,
      );
    } else if (!want && this.statsTimer !== undefined) {
      this.env.clock.clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private async pollStats(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [key, s] of this.sessions) {
      const link = this.readyLink(s);
      if (!link) continue;
      jobs.push(
        link.stats().then((v) => {
          const l = this.live.get(key);
          if (l) l.media.stats = v;
        }),
      );
    }
    if (jobs.length === 0) return;
    await Promise.all(jobs);
    this.changed();
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
