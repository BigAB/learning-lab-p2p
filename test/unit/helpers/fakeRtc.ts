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
  constructor(
    public readonly config: RTCConfiguration,
    private readonly offerSdp: string = CHROME_OFFER,
  ) {}
  createDataChannel(label: string): FakeDataChannel {
    const dc = new FakeDataChannel(label);
    this.channels.push(dc);
    return dc;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: this.offerSdp };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: SAFARI_ANSWER };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = d;
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
}

/** Let pending microtasks (awaits inside the session) settle. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
