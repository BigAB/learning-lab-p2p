import { readFileSync } from "node:fs";
import type { RtcFactory } from "../../../src/core/ports";

export const CHROME_OFFER = readFileSync(
  new URL("../../fixtures/sdp/chrome-offer.sdp", import.meta.url),
  "utf8",
);
export const SAFARI_ANSWER = readFileSync(
  new URL("../../fixtures/sdp/safari-answer.sdp", import.meta.url),
  "utf8",
);
export const CHROME_MEDIA_OFFER = readFileSync(
  new URL("../../fixtures/sdp/chrome-media-offer.sdp", import.meta.url),
  "utf8",
);
export const SAFARI_MEDIA_ANSWER = readFileSync(
  new URL("../../fixtures/sdp/safari-media-answer.sdp", import.meta.url),
  "utf8",
);

/**
 * A gathering result with nothing usable in it: the only host candidate is 169.254 link-local,
 * so extractPayload() refuses it and PeerSession.start() rejects.
 */
export const LINK_LOCAL_ONLY_OFFER = CHROME_OFFER.split("\n")
  .filter((l) => !l.startsWith("a=candidate:") || l.includes("169.254."))
  .join("\n");

export class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public readonly label: string) {}
  send(d: string): void {
    if (this.readyState !== "open") throw new Error("send on non-open channel");
    this.sent.push(d);
  }
  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  }
  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }
  receive(s: string): void {
    this.onmessage?.({ data: s });
  }
  /** Parsed JSON of everything sent. */
  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown);
  }
}

let trackSeq = 0;

export class FakeMediaStreamTrack {
  readonly kind = "video";
  readonly id = `track-${++trackSeq}`;
  readyState: MediaStreamTrackState = "live";
  stopped = false;
  contentHint = "";
  settings: MediaTrackSettings = { width: 1280, height: 720, frameRate: 15 };
  constraintsApplied: MediaTrackConstraints[] = [];
  onended: (() => void) | null = null;
  getSettings(): MediaTrackSettings {
    return { ...this.settings };
  }
  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }
  async applyConstraints(c: MediaTrackConstraints): Promise<void> {
    this.constraintsApplied.push(c);
  }
  /** Simulate the device going away (unplugged camera, screen share ended from the browser bar). */
  end(): void {
    this.readyState = "ended";
    this.onended?.();
  }
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

export class FakeRtpSender {
  track: MediaStreamTrack | null = null;
  replaceTrackCalls: (MediaStreamTrack | null)[] = [];
  setParametersCalls: RTCRtpSendParameters[] = [];
  rejectSetParameters: Error | undefined;
  params: RTCRtpSendParameters = {
    encodings: [{}],
    transactionId: "fake",
    codecs: [],
    headerExtensions: [],
    rtcp: {},
  };
  getParameters(): RTCRtpSendParameters {
    return { ...this.params, encodings: this.params.encodings.map((e) => ({ ...e })) };
  }
  async setParameters(p: RTCRtpSendParameters): Promise<void> {
    if (this.rejectSetParameters) throw this.rejectSetParameters;
    this.params = p;
    this.setParametersCalls.push(p);
  }
  async replaceTrack(t: MediaStreamTrack | null): Promise<void> {
    this.track = t;
    this.replaceTrackCalls.push(t);
  }
  /** encodings[0] as last set, for assertions. */
  encoding(): RTCRtpEncodingParameters {
    return this.params.encodings[0] ?? {};
  }
}

export class FakeTransceiver {
  readonly kind = "video";
  currentDirection: RTCRtpTransceiverDirection | null = null;
  readonly sender = new FakeRtpSender();
  readonly receiver: { track: FakeMediaStreamTrack } = { track: new FakeMediaStreamTrack() };
  codecPrefs: RTCRtpCodec[] | undefined;
  constructor(
    public mid: string | null,
    public direction: RTCRtpTransceiverDirection,
  ) {}
  setCodecPreferences(c: RTCRtpCodec[]): void {
    this.codecPrefs = c;
  }
}

const MID_LINE = /^a=mid:(\S+)/m;

export class FakeRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  onicegatheringstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null = null;
  channels: FakeDataChannel[] = [];
  closed = false;
  signalingState: RTCSignalingState = "stable";
  transceivers: FakeTransceiver[] = [];
  statsReport = new Map<string, Record<string, unknown>>();
  rejectSetRemote: Error | undefined;
  rejectCreateOffer: Error | undefined;
  constructor(
    public readonly config: RTCConfiguration,
    private readonly offerSdp: string = CHROME_OFFER,
  ) {}
  createDataChannel(label: string): FakeDataChannel {
    const dc = new FakeDataChannel(label);
    this.channels.push(dc);
    return dc;
  }
  addTransceiver(kind: string, init?: RTCRtpTransceiverInit): FakeTransceiver {
    if (kind !== "video") throw new Error("fake supports video only");
    const t = new FakeTransceiver(
      String(this.transceivers.length + 1),
      init?.direction ?? "sendrecv",
    );
    this.transceivers.push(t);
    return t;
  }
  getTransceivers(): FakeTransceiver[] {
    return [...this.transceivers];
  }
  async getStats(): Promise<RTCStatsReport> {
    return this.statsReport as unknown as RTCStatsReport;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (this.rejectCreateOffer) throw this.rejectCreateOffer;
    return { type: "offer", sdp: this.transceivers.length ? CHROME_MEDIA_OFFER : this.offerSdp };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: this.transceivers.length ? SAFARI_MEDIA_ANSWER : SAFARI_ANSWER };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    if (d.type === "answer") for (const t of this.transceivers) t.currentDirection = t.direction;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    if (this.rejectSetRemote) throw this.rejectSetRemote;
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
    if (d.type === "offer" && d.sdp) {
      // Like a real PC: each unseen m=video section gets a recvonly transceiver.
      for (const sec of d.sdp.split(/\r?\n(?=m=video)/).slice(1)) {
        const mid = MID_LINE.exec(sec)?.[1];
        if (mid && !this.transceivers.some((t) => t.mid === mid))
          this.transceivers.push(new FakeTransceiver(mid, "recvonly"));
      }
    }
    if (d.type === "answer") for (const t of this.transceivers) t.currentDirection = t.direction;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.iceConnectionState = "closed";
    this.oniceconnectionstatechange?.();
    for (const ch of this.channels) ch.close();
  }
  completeGathering(): void {
    this.iceGatheringState = "complete";
    this.onicegatheringstatechange?.();
  }
  setIce(s: RTCIceConnectionState): void {
    this.iceConnectionState = s;
    this.oniceconnectionstatechange?.();
  }
  incomingChannel(): FakeDataChannel {
    const dc = new FakeDataChannel("lab");
    this.channels.push(dc);
    this.ondatachannel?.({ channel: dc });
    return dc;
  }
}

export class FakeRtcFactory implements RtcFactory {
  pcs: FakeRTCPeerConnection[] = [];
  constructor(private readonly offerSdp: string = CHROME_OFFER) {}
  create(config: RTCConfiguration): RTCPeerConnection {
    const pc = new FakeRTCPeerConnection(config, this.offerSdp);
    this.pcs.push(pc);
    return pc as unknown as RTCPeerConnection;
  }
  last(): FakeRTCPeerConnection {
    const pc = this.pcs[this.pcs.length - 1];
    if (!pc) throw new Error("no pc created");
    return pc;
  }
  videoCodecs(): RTCRtpCodec[] {
    return [
      { mimeType: "video/VP8", clockRate: 90000 },
      { mimeType: "video/rtx", clockRate: 90000, sdpFmtpLine: "apt=96" },
      {
        mimeType: "video/H264",
        clockRate: 90000,
        sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
      },
      {
        mimeType: "video/H264",
        clockRate: 90000,
        sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
      },
      { mimeType: "video/VP9", clockRate: 90000 },
    ];
  }
}

/** Let pending microtasks (awaits inside the session) settle. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
