import type { HelloMessage, LabMessage } from "../schemas/protocol";
import { LabMessageSchema, MAX_FRAME_BYTES } from "../schemas/protocol";
import type { SdpPayload } from "../schemas/sdpPayload";
import { chunkMessage, Reassembler } from "./chunker";
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import { Heartbeat } from "./heartbeat";
import type { RtcFactory } from "./ports";
import { buildSdp, extractPayload } from "./sdpCodec";

export type SessionState =
  "idle" | "gathering" | "awaiting-remote" | "connecting" | "connected" | "degraded" | "failed";

export interface SessionTimers {
  heartbeatMs: number;
  degradedMs: number;
  failedMs: number;
  connectMs: number;
  gatherMs: number;
}

export const DEFAULT_TIMERS: SessionTimers = {
  heartbeatMs: 5000,
  degradedMs: 15000,
  failedMs: 60000,
  connectMs: 20000,
  gatherMs: 3000,
};

export interface PeerSessionOpts {
  role: "student" | "teacher";
  ws: number;
  rtc: RtcFactory;
  clock: Clock;
  timers?: Partial<SessionTimers>;
  certificates?: RTCCertificate[];
  appVersion: string;
  ua: string;
}

export type PeerSessionEvents = {
  state: [SessionState, SessionState];
  localPayload: [SdpPayload];
  message: [LabMessage];
  hello: [HelloMessage];
  rtt: [number];
  /** A frame from the peer passed the schema: proof of life, whatever it said. */
  inbound: [];
  needsRepair: [string];
  ignored: [string];
};

/**
 * One RTCPeerConnection + one "lab" DataChannel. Student offers, teacher answers.
 * Transient trouble → degraded (do nothing, trust ICE). Hard failure → failed → needsRepair.
 */
export class PeerSession extends Emitter<PeerSessionEvents> {
  readonly role: "student" | "teacher";
  readonly ws: number;
  state: SessionState = "idle";
  ignoredCount = 0;
  lastRtt: number | undefined;
  remoteHello: HelloMessage | undefined;

  private readonly timers: SessionTimers;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private hb: Heartbeat | null = null;
  private readonly reasm = new Reassembler();
  private connectTimer: TimerHandle | undefined;
  private degradedTimer: TimerHandle | undefined;
  private gatherTimer: TimerHandle | undefined;
  private gatherResolve: (() => void) | undefined;
  private done = false;

  constructor(private readonly opts: PeerSessionOpts) {
    super();
    this.role = opts.role;
    this.ws = opts.ws;
    this.timers = { ...DEFAULT_TIMERS, ...opts.timers };
  }

  /** Student only: create the offer and publish it. */
  async start(): Promise<void> {
    if (this.role !== "student") throw new Error("only the student side offers");
    if (this.state !== "idle") throw new Error(`start() called in state ${this.state}`);
    const pc = this.createPc();
    this.attachChannel(pc.createDataChannel("lab", { ordered: true }));
    this.setState("gathering");
    await pc.setLocalDescription(await pc.createOffer());
    await this.waitGathering(pc);
    if (this.done) return;
    this.emit("localPayload", extractPayload(pc.localDescription?.sdp ?? "", "offer", this.ws));
    this.setState("awaiting-remote");
  }

  /** Student: apply the teacher's answer. Teacher: accept the student's offer and publish an answer. */
  async applyRemote(remote: SdpPayload): Promise<void> {
    if (this.role === "student") {
      if (this.state !== "awaiting-remote") throw new Error(`applyRemote in state ${this.state}`);
      if (remote.role !== "answer") throw new Error("student expects an answer");
      // The courier walks several answers around the room; scanning the wrong one must be a
      // plain refusal, not a half-applied remote description on a PC that can never connect.
      if (remote.ws !== this.ws)
        throw new Error(`This code is for workstation ${remote.ws}, not ${this.ws}`);
      if (!this.pc) throw new Error("no peer connection");
      await this.pc.setRemoteDescription({ type: "answer", sdp: buildSdp(remote) });
      if (this.done) return;
      this.setState("connecting");
      this.armConnectTimer();
      return;
    }
    if (this.state !== "idle") throw new Error(`applyRemote in state ${this.state}`);
    if (remote.role !== "offer") throw new Error("teacher expects an offer");
    const pc = this.createPc();
    pc.ondatachannel = (ev) => this.attachChannel(ev.channel);
    this.setState("gathering");
    await pc.setRemoteDescription({ type: "offer", sdp: buildSdp(remote) });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.waitGathering(pc);
    if (this.done) return;
    this.emit("localPayload", extractPayload(pc.localDescription?.sdp ?? "", "answer", this.ws));
    this.setState("connecting");
    this.armConnectTimer();
  }

  /** Outbound boundary: validate, chunk if needed, drop silently if channel not open. */
  send(m: LabMessage): void {
    const parsed = LabMessageSchema.parse(m);
    if (!this.dc || this.dc.readyState !== "open") return;
    for (const frame of chunkMessage(JSON.stringify(parsed), MAX_FRAME_BYTES)) this.dc.send(frame);
  }

  /** Tear down without signalling a repair (used when replacing a session deliberately). */
  close(): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.setState("failed");
  }

  // ---- internals ----

  private createPc(): RTCPeerConnection {
    const config: RTCConfiguration = { iceServers: [] };
    if (this.opts.certificates) config.certificates = this.opts.certificates;
    const pc = this.opts.rtc.create(config);
    pc.oniceconnectionstatechange = () => this.onIce(pc.iceConnectionState);
    this.pc = pc;
    return pc;
  }

  private waitGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      this.gatherResolve = resolve;
      this.gatherTimer = this.opts.clock.setTimeout(() => {
        this.gatherTimer = undefined;
        pc.onicegatheringstatechange = null;
        this.gatherResolve = undefined;
        resolve();
      }, this.timers.gatherMs);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          if (this.gatherTimer !== undefined) {
            this.opts.clock.clearTimeout(this.gatherTimer);
            this.gatherTimer = undefined;
          }
          pc.onicegatheringstatechange = null;
          this.gatherResolve = undefined;
          resolve();
        }
      };
    });
  }

  private attachChannel(dc: RTCDataChannel): void {
    // One session owns exactly one "lab" channel. A second ondatachannel (a peer that opened two,
    // or a renegotiation glare) must not silently replace the live one and orphan its handlers.
    if (this.dc && this.dc !== dc) {
      try {
        dc.close();
      } catch {
        /* already closed */
      }
      return this.ignore("duplicate datachannel");
    }
    this.dc = dc;
    dc.onopen = () => this.onOpen();
    dc.onclose = () => this.fail("datachannel closed");
    dc.onmessage = (ev) => this.onFrame(String(ev.data));
  }

  private onOpen(): void {
    if (this.done) return;
    this.clearConnectTimer();
    this.hb = new Heartbeat({
      clock: this.opts.clock,
      intervalMs: this.timers.heartbeatMs,
      missMs: this.timers.degradedMs,
      send: (m) => this.send(m),
      onMiss: () => this.degrade("heartbeat silence"),
      onRecover: () => this.recover(),
      onRtt: (ms) => {
        this.lastRtt = ms;
        this.emit("rtt", ms);
      },
    });
    this.hb.start();
    this.send({
      t: "hello",
      role: this.role,
      ws: this.ws,
      appVersion: this.opts.appVersion,
      ua: this.opts.ua,
    });
    this.setState("connected");
  }

  /** Inbound boundary: JSON → Zod → route. Never throws. */
  private onFrame(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.ignore("not json");
    }
    const r = LabMessageSchema.safeParse(json);
    if (!r.success) return this.ignore("schema");
    const m = r.data;
    this.emit("inbound");
    switch (m.t) {
      case "chunk": {
        const dropped = this.reasm.dropped;
        const whole = this.reasm.push(m);
        if (whole !== undefined) this.onFrame(whole);
        // A duplicate or out-of-range index is a frame we refused, not a frame we consumed:
        // count it like any other ignored wire input.
        else if (this.reasm.dropped !== dropped) this.ignore("duplicate chunk");
        return;
      }
      case "hb":
      case "hb-ack":
        this.hb?.handle(m);
        this.recover();
        return;
      case "hello":
        this.remoteHello = m;
        this.emit("hello", m);
        return;
      default:
        this.emit("message", m);
    }
  }

  private ignore(why: string): void {
    this.ignoredCount++;
    this.emit("ignored", why);
  }

  private onIce(s: RTCIceConnectionState): void {
    if (this.done) return;
    if (s === "failed") return this.fail("ice failed");
    if (s === "disconnected") this.degrade("ice disconnected");
    if (s === "connected" || s === "completed") this.recover();
  }

  private degrade(reason: string): void {
    if (this.state !== "connected") return;
    this.degradedTimer = this.opts.clock.setTimeout(
      () => this.fail(`degraded for ${this.timers.failedMs}ms (${reason})`),
      this.timers.failedMs,
    );
    this.setState("degraded");
  }

  private recover(): void {
    if (this.state !== "degraded") return;
    if (this.degradedTimer !== undefined) this.opts.clock.clearTimeout(this.degradedTimer);
    this.degradedTimer = undefined;
    // Re-arm the heartbeat silence watchdog: whichever signal (ICE or heartbeat) caused the
    // degrade, both must be considered cleared, or the watchdog can never fire again.
    if (this.hb) this.hb.missed = false;
    this.setState("connected");
  }

  private armConnectTimer(): void {
    this.connectTimer = this.opts.clock.setTimeout(
      () => this.fail("connect timeout"),
      this.timers.connectMs,
    );
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined) this.opts.clock.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private fail(reason: string): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.emit("needsRepair", reason);
    this.setState("failed");
  }

  private teardown(): void {
    this.clearConnectTimer();
    if (this.degradedTimer !== undefined) this.opts.clock.clearTimeout(this.degradedTimer);
    this.degradedTimer = undefined;
    if (this.gatherTimer !== undefined) this.opts.clock.clearTimeout(this.gatherTimer);
    this.gatherTimer = undefined;
    if (this.gatherResolve) {
      this.gatherResolve();
      this.gatherResolve = undefined;
    }
    this.hb?.stop();
    this.hb = null;
    if (this.dc) {
      this.dc.onclose = null;
      this.dc.onmessage = null;
      this.dc.onopen = null;
      try {
        this.dc.close();
      } catch {
        /* already closed */
      }
    }
    if (this.pc) {
      this.pc.oniceconnectionstatechange = null;
      this.pc.onicegatheringstatechange = null;
      this.pc.ondatachannel = null;
      try {
        this.pc.close();
      } catch {
        /* already closed */
      }
    }
  }

  private setState(s: SessionState): void {
    const prev = this.state;
    if (prev === s) return;
    this.state = s;
    this.emit("state", s, prev);
  }
}
