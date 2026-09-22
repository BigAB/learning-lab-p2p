import type {
  CamState,
  MediaAnswerMessage,
  MediaBroadcastMessage,
  MediaMessage,
  MediaOfferMessage,
  MediaSource,
  MediaStatusMessage,
  Profile,
} from "../schemas/media";
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import {
  CAPTURE,
  applyEncoding,
  encodingFor,
  offeredDirections,
  orderCodecs,
  type CodecPref,
  type Degradation,
} from "./media";
import type { MediaPort } from "./ports";

export type MediaState = "none" | "negotiating" | "ready" | "unsupported" | "failed";

export interface MediaTimers {
  mediaOfferMs: number;
}
export const DEFAULT_MEDIA_TIMERS: MediaTimers = { mediaOfferMs: 10_000 };

export interface MediaStatsView {
  cpuLimited: boolean;
  encoder?: string;
  outFps?: number;
  outHeight?: number;
  inFps?: number;
  inHeight?: number;
  framesDecoded?: number;
  framesDropped?: number;
}

export type MediaLinkEvents = {
  state: [MediaState, string | undefined];
  remoteTrack: [MediaStreamTrack];
  /** Teacher side: the student reported what it is sending. */
  status: [MediaStatusMessage];
  /** Student side: the teacher said whether to show its video. */
  broadcast: [MediaBroadcastMessage];
  /** Student side: the teacher asked for a profile (or null). The controller applies it. */
  request: [Profile | null];
  /** Student side: our own capture state changed. */
  capture: [CamState];
  ignored: [string];
};

export interface MediaLinkOpts {
  role: "student" | "teacher";
  pc: RTCPeerConnection;
  send(m: MediaMessage): void;
  clock: Clock;
  codecs?: RTCRtpCodec[];
  timers?: Partial<MediaTimers>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One session's media: two video transceivers negotiated once by the teacher over the DataChannel,
 * then driven with replaceTrack/setParameters only. Best-effort: nothing here touches the session.
 */
export class MediaLink extends Emitter<MediaLinkEvents> {
  state: MediaState = "none";
  reason: string | undefined;
  remoteTrack: MediaStreamTrack | undefined;
  /** Student side: what our camera is doing. */
  cam: CamState = "off";
  /** Student side: why `cam` is "error", if it is. Undefined once cam is "on"/"off". */
  camReason: string | undefined;
  sending: Profile | null = null;
  lastStatus: MediaStatusMessage | undefined;
  lastBroadcast: MediaBroadcastMessage | undefined;

  private readonly timers: MediaTimers;
  /** The transceiver we send on. */
  private tx: RTCRtpTransceiver | undefined;
  /** The transceiver we receive on. */
  private rx: RTCRtpTransceiver | undefined;
  private seq = 0;
  private offerTimer: TimerHandle | undefined;
  private captureTrack: MediaStreamTrack | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly opts: MediaLinkOpts) {
    super();
    this.timers = { ...DEFAULT_MEDIA_TIMERS, ...opts.timers };
  }

  // ---- teacher ----

  /** Teacher only: add the two transceivers (once) and send a full-SDP offer. Sequential by seq. */
  async offer(codec: CodecPref): Promise<void> {
    if (this.opts.role !== "teacher") throw new Error("only the teacher offers media");
    if (this.state !== "none" && this.state !== "failed")
      throw new Error(`offer in state ${this.state}`);
    if (this.closed) return;
    const pc = this.opts.pc;
    this.tx ??= pc.addTransceiver("video", { direction: "sendonly" });
    this.rx ??= pc.addTransceiver("video", { direction: "recvonly" });
    const codecs = this.opts.codecs ?? [];
    if (codec !== "auto" && codecs.length > 0) {
      for (const t of [this.tx, this.rx]) {
        try {
          t.setCodecPreferences(orderCodecs(codecs, codec));
        } catch {
          /* engine without setCodecPreferences: its defaults are still negotiable */
        }
      }
    }
    this.setState("negotiating");
    try {
      await pc.setLocalDescription(await pc.createOffer());
    } catch (e) {
      return this.fail(`createOffer: ${msg(e)}`);
    }
    if (this.closed) return;
    const sdp = pc.localDescription?.sdp;
    if (!sdp) return this.fail("no local description after createOffer");
    this.seq += 1;
    this.opts.send({ t: "media.offer", seq: this.seq, sdp });
    this.offerTimer = this.opts.clock.setTimeout(
      () => this.fail(`no answer within ${this.timers.mediaOfferMs}ms`),
      this.timers.mediaOfferMs,
    );
  }

  /** The peer's hello had no "media" capability: nothing to negotiate, say so on the tile. */
  markUnsupported(): void {
    if (this.state !== "none") return;
    this.reason = "older build";
    this.setState("unsupported", "older build");
  }

  /** Teacher: attach (or detach) the broadcast track and cap its encoder. No-op unless ready. */
  async setOutbound(
    track: MediaStreamTrack | null,
    profile: Profile | null,
    degradation?: Degradation,
  ): Promise<void> {
    if (!this.tx || this.state !== "ready") return;
    try {
      await this.tx.sender.replaceTrack(track);
      if (track && profile)
        await applyEncoding(
          this.tx.sender,
          encodingFor(profile, track.getSettings().height),
          degradation,
        );
    } catch (e) {
      this.reason = `outbound: ${msg(e)}`;
    }
  }

  /** Teacher: tell the student what to send. */
  request(send: Profile | null): void {
    if (this.state !== "ready") return;
    this.opts.send({ t: "media.request", send });
  }

  /** Teacher: tell the student whether our video is on, and what it is. */
  broadcast(on: boolean, source?: MediaSource): void {
    if (this.state !== "ready") return;
    this.opts.send({ t: "media.broadcast", on, ...(source ? { source } : {}) });
  }

  async stats(): Promise<MediaStatsView> {
    const v: MediaStatsView = { cpuLimited: false };
    let report: RTCStatsReport;
    try {
      report = await this.opts.pc.getStats();
    } catch {
      return v;
    }
    const num = (s: Record<string, unknown>, k: string) =>
      typeof s[k] === "number" ? (s[k] as number) : undefined;
    report.forEach((s: Record<string, unknown>) => {
      if (s["kind"] !== "video") return;
      if (s["type"] === "outbound-rtp") {
        if (typeof s["encoderImplementation"] === "string") v.encoder = s["encoderImplementation"];
        v.cpuLimited = s["qualityLimitationReason"] === "cpu";
        const fps = num(s, "framesPerSecond");
        const h = num(s, "frameHeight");
        if (fps !== undefined) v.outFps = fps;
        if (h !== undefined) v.outHeight = h;
      } else if (s["type"] === "inbound-rtp") {
        const fps = num(s, "framesPerSecond");
        const h = num(s, "frameHeight");
        const dec = num(s, "framesDecoded");
        const drop = num(s, "framesDropped");
        if (fps !== undefined) v.inFps = fps;
        if (h !== undefined) v.inHeight = h;
        if (dec !== undefined) v.framesDecoded = dec;
        if (drop !== undefined) v.framesDropped = drop;
      }
    });
    return v;
  }

  // ---- student ----

  /**
   * Student: apply the teacher's request. Serialised so an in-flight camera grant cannot race the
   * next request. Resolves after the resulting media.status has been sent. Never rejects.
   */
  applyRequest(send: Profile | null, port: MediaPort): Promise<void> {
    this.queue = this.queue
      .then(() => this.doApply(send, port))
      // doApply handles every expected failure itself; anything reaching here is a bug or an
      // engine surprise. Keep the queue alive, but say so rather than swallowing it.
      .catch((e: unknown) => this.ignore(`applyRequest: ${msg(e)}`));
    return this.queue;
  }

  captureActive(): boolean {
    return this.captureTrack !== null;
  }

  // ---- both ----

  /** Inbound media.* frame, already schema-valid. Wrong role or state ⇒ ignored, never thrown. */
  handle(m: MediaMessage): void {
    if (this.closed) return;
    const student = this.opts.role === "student";
    switch (m.t) {
      case "media.offer":
        if (!student) return this.ignore("media.offer at teacher");
        void this.onOffer(m);
        return;
      case "media.answer":
        if (student) return this.ignore("media.answer at student");
        void this.onAnswer(m);
        return;
      case "media.request":
        if (!student) return this.ignore("media.request at teacher");
        this.emit("request", m.send);
        return;
      case "media.status":
        if (student) return this.ignore("media.status at student");
        this.lastStatus = m;
        this.emit("status", m);
        return;
      case "media.broadcast":
        if (!student) return this.ignore("media.broadcast at teacher");
        this.lastBroadcast = m;
        this.emit("broadcast", m);
        return;
    }
  }

  /** Stop the offer timer and any capture we started. Idempotent; the PC is the session's to close. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearOfferTimer();
    this.stopCapture();
  }

  // ---- internals ----

  private async onOffer(m: MediaOfferMessage): Promise<void> {
    const pc = this.opts.pc;
    if (pc.signalingState !== "stable")
      return this.ignore(`media.offer in signaling state ${pc.signalingState}`);
    this.seq = m.seq;
    this.setState("negotiating");
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
      if (this.closed) return;
      const dirs = offeredDirections(m.sdp);
      for (const t of pc.getTransceivers()) {
        if (t.mid === null) continue;
        const d = dirs.get(t.mid);
        if (d === "recvonly") {
          // The teacher wants to receive here: this is where our camera goes.
          t.direction = "sendonly";
          this.tx = t;
        } else if (d === "sendonly") {
          this.rx = t;
        }
      }
      await pc.setLocalDescription(await pc.createAnswer());
      if (this.closed) return;
      const sdp = pc.localDescription?.sdp;
      if (!sdp) return this.fail("no local description after createAnswer");
      this.opts.send({ t: "media.answer", seq: m.seq, sdp });
      this.ready();
    } catch (e) {
      this.fail(`answer: ${msg(e)}`);
    }
  }

  private async onAnswer(m: MediaAnswerMessage): Promise<void> {
    if (this.state !== "negotiating") return this.ignore("media.answer while not negotiating");
    if (m.seq !== this.seq) return this.ignore(`media.answer seq ${m.seq}, expected ${this.seq}`);
    try {
      await this.opts.pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
      if (this.closed) return;
      this.ready();
    } catch (e) {
      this.fail(`answer: ${msg(e)}`);
    }
  }

  private async doApply(send: Profile | null, port: MediaPort): Promise<void> {
    if (this.closed || this.opts.role !== "student" || this.state !== "ready" || !this.tx) return;
    const sender = this.tx.sender;
    if (send === null) {
      // Already off with nothing to stop: the teacher re-sent its standing null (a Cameras-off
      // toggle, a focus swap). Resending an identical status would be wire noise.
      if (this.cam === "off" && this.sending === null && !this.captureTrack) return;
      this.stopCapture();
      try {
        await sender.replaceTrack(null);
      } catch {
        /* a closed PC has nothing to detach */
      }
      this.cam = "off";
      this.sending = null;
      return this.report();
    }
    if (!this.captureTrack) {
      let track: MediaStreamTrack;
      try {
        track = await port.camera(CAPTURE);
      } catch (e) {
        this.cam = "error";
        this.sending = null;
        return this.report(msg(e));
      }
      if (this.closed) {
        track.stop();
        return;
      }
      this.captureTrack = track;
      track.onended = () => {
        if (this.captureTrack !== track) return;
        this.captureTrack = null;
        this.cam = "error";
        this.sending = null;
        this.report("camera ended");
      };
      try {
        await sender.replaceTrack(track);
      } catch (e) {
        this.stopCapture();
        this.cam = "error";
        this.sending = null;
        return this.report(`replaceTrack: ${msg(e)}`);
      }
    }
    const track = this.captureTrack;
    if (!track) return;
    try {
      await applyEncoding(sender, encodingFor(send, track.getSettings().height));
    } catch {
      // Older WebKit: no per-encoding scaling. Change the capture itself instead.
      try {
        await track.applyConstraints({ height: send.height, frameRate: send.fps });
      } catch {
        /* best effort: the thumbnail is then just larger than asked */
      }
    }
    this.cam = "on";
    this.sending = send;
    this.report();
  }

  private report(reason?: string): void {
    if (this.closed) return;
    const bounded = reason ? reason.slice(0, 200) : undefined;
    this.camReason = this.cam === "error" ? bounded : undefined;
    try {
      this.opts.send({
        t: "media.status",
        cam: this.cam,
        send: this.sending,
        ...(bounded ? { reason: bounded } : {}),
      });
    } catch {
      /* a status we cannot send is not worth a crash */
    }
    this.emit("capture", this.cam);
  }

  private ready(): void {
    this.clearOfferTimer();
    this.reason = undefined;
    this.setState("ready");
    if (this.rx) {
      this.remoteTrack = this.rx.receiver.track;
      this.emit("remoteTrack", this.remoteTrack);
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.clearOfferTimer();
    this.reason = reason;
    this.setState("failed", reason);
  }

  private clearOfferTimer(): void {
    if (this.offerTimer !== undefined) this.opts.clock.clearTimeout(this.offerTimer);
    this.offerTimer = undefined;
  }

  private stopCapture(): void {
    const t = this.captureTrack;
    if (!t) return;
    t.onended = null;
    t.stop();
    this.captureTrack = null;
  }

  private ignore(why: string): void {
    this.emit("ignored", why);
  }

  private setState(s: MediaState, reason?: string): void {
    if (this.state === s) return;
    this.state = s;
    this.emit("state", s, reason);
  }
}
