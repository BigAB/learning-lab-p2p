import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaLink, type MediaState } from "../../../src/core/mediaLink";
import type { MediaMessage } from "../../../src/schemas/media";
import { FakeClock } from "../helpers/fakeClock";
import { FakeMediaPort } from "../helpers/fakeMedia";
import {
  CHROME_MEDIA_OFFER,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  FakeRtcFactory,
  SAFARI_MEDIA_ANSWER,
  flush,
} from "../helpers/fakeRtc";

const thumb = { height: 180, fps: 10, kbps: 150 } as const;

export function makeLink(role: "teacher" | "student", timers = { mediaOfferMs: 10_000 }) {
  const pc = new FakeRTCPeerConnection({});
  const clock = new FakeClock();
  const sent: MediaMessage[] = [];
  const link = new MediaLink({
    role,
    pc: pc as unknown as RTCPeerConnection,
    send: (m) => sent.push(m),
    clock,
    codecs: new FakeRtcFactory().videoCodecs(),
    timers,
  });
  const states: MediaState[] = [];
  const ignored: string[] = [];
  link.on("state", (s) => states.push(s));
  link.on("ignored", (r) => ignored.push(r));
  return { pc, clock, sent, link, states, ignored };
}

test("teacher offer: two transceivers, H264 first, media.offer seq 1, negotiating", async () => {
  const { pc, sent, link, states } = makeLink("teacher");
  await link.offer("h264");
  assert.deepEqual(
    pc.getTransceivers().map((t) => t.direction),
    ["sendonly", "recvonly"],
  );
  assert.equal(pc.getTransceivers()[0]?.codecPrefs?.[0]?.mimeType, "video/H264");
  assert.equal(
    pc.getTransceivers()[0]?.codecPrefs?.[0]?.sdpFmtpLine?.includes("packetization-mode=1"),
    true,
  );
  assert.deepEqual(sent[0], { t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  assert.deepEqual(states, ["negotiating"]);
  assert.equal(pc.signalingState, "have-local-offer");
});

test("teacher: codec 'auto' sets no preferences", async () => {
  const { pc, link } = makeLink("teacher");
  await link.offer("auto");
  assert.equal(pc.getTransceivers()[0]?.codecPrefs, undefined);
});

test("teacher answer → ready, remoteTrack from the recvonly transceiver", async () => {
  const { pc, link, states } = makeLink("teacher");
  let track: unknown;
  link.on("remoteTrack", (t) => (track = t));
  await link.offer("h264");
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.deepEqual(states, ["negotiating", "ready"]);
  assert.equal(pc.signalingState, "stable");
  assert.equal(track, pc.getTransceivers()[1]?.receiver.track);
  assert.equal(link.remoteTrack, track);
});

test("teacher: stale or unexpected answers are ignored", async () => {
  const { link, ignored } = makeLink("teacher");
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  assert.equal(ignored.length, 1);
  await link.offer("h264");
  link.handle({ t: "media.answer", seq: 7, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(ignored.length, 2);
  assert.equal(link.state, "negotiating");
});

test("teacher: no answer within mediaOfferMs → failed with reason; retry re-offers with seq 2", async () => {
  const { clock, sent, link, states } = makeLink("teacher", { mediaOfferMs: 3000 });
  await link.offer("h264");
  clock.advance(3000);
  assert.equal(link.state, "failed");
  assert.match(link.reason ?? "", /no answer within 3000ms/);
  await link.offer("h264");
  assert.equal((sent[1] as { seq: number }).seq, 2);
  assert.deepEqual(states, ["negotiating", "failed", "negotiating"]);
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER }); // stale
  await flush();
  assert.equal(link.state, "negotiating");
  link.handle({ t: "media.answer", seq: 2, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "ready");
});

test("teacher: setRemoteDescription rejection → failed; offer() refused while ready", async () => {
  const { pc, link } = makeLink("teacher");
  await link.offer("h264");
  pc.rejectSetRemote = new Error("Failed to set remote answer sdp");
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "failed");
  assert.match(link.reason ?? "", /Failed to set remote answer sdp/);
  pc.rejectSetRemote = undefined;
  await link.offer("h264");
  link.handle({ t: "media.answer", seq: 2, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "ready");
  await assert.rejects(link.offer("h264"), /offer in state ready/);
});

test("teacher: createOffer rejection → failed without sending", async () => {
  const { pc, sent, link } = makeLink("teacher");
  pc.rejectCreateOffer = new Error("boom");
  await link.offer("h264");
  assert.equal(link.state, "failed");
  assert.equal(sent.length, 0);
});

test("markUnsupported only from none", async () => {
  const a = makeLink("teacher");
  a.link.markUnsupported();
  assert.equal(a.link.state, "unsupported");
  assert.equal(a.link.reason, "older build");
  const b = makeLink("teacher");
  await b.link.offer("h264");
  b.link.markUnsupported();
  assert.equal(b.link.state, "negotiating");
});

test("student: offer → answer sent with same seq, tx/rx chosen by offered direction, ready", async () => {
  const { pc, sent, link, states } = makeLink("student");
  let track: unknown;
  link.on("remoteTrack", (t) => (track = t));
  link.handle({ t: "media.offer", seq: 3, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.deepEqual(sent[0], { t: "media.answer", seq: 3, sdp: SAFARI_MEDIA_ANSWER });
  // mid 1 was offered sendonly (teacher sends) → we stay recvonly; mid 2 offered recvonly → we send.
  assert.deepEqual(
    pc.getTransceivers().map((t) => [t.mid, t.direction]),
    [
      ["1", "recvonly"],
      ["2", "sendonly"],
    ],
  );
  assert.deepEqual(states, ["negotiating", "ready"]);
  assert.equal(track, pc.getTransceivers()[0]?.receiver.track);
  assert.equal(pc.signalingState, "stable");
});

test("student: offer while not stable is ignored; offer at teacher / answer at student ignored", async () => {
  const s = makeLink("student");
  s.pc.signalingState = "have-local-offer";
  s.link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.equal(s.ignored.length, 1);
  assert.equal(s.link.state, "none");
  s.link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  assert.equal(s.ignored.length, 2);
  const t = makeLink("teacher");
  t.link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  assert.equal(t.ignored.length, 1);
});

test("student: setRemoteDescription rejection → failed, nothing sent", async () => {
  const { pc, sent, link } = makeLink("student");
  pc.rejectSetRemote = new Error("bad sdp");
  link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.equal(link.state, "failed");
  assert.match(link.reason ?? "", /bad sdp/);
  assert.equal(sent.length, 0);
});

test("routing: request → student event; status → teacher event; broadcast → student event", async () => {
  const s = makeLink("student");
  const reqs: unknown[] = [];
  const bcs: unknown[] = [];
  s.link.on("request", (r) => reqs.push(r));
  s.link.on("broadcast", (b) => bcs.push(b));
  s.link.handle({ t: "media.request", send: thumb });
  s.link.handle({ t: "media.request", send: null });
  s.link.handle({ t: "media.broadcast", on: true, source: "screen" });
  assert.deepEqual(reqs, [thumb, null]);
  assert.deepEqual(bcs, [{ t: "media.broadcast", on: true, source: "screen" }]);
  assert.deepEqual(s.link.lastBroadcast, { t: "media.broadcast", on: true, source: "screen" });
  s.link.handle({ t: "media.status", cam: "on", send: thumb });
  assert.equal(s.ignored.length, 1);
  const t = makeLink("teacher");
  const statuses: unknown[] = [];
  t.link.on("status", (m) => statuses.push(m));
  t.link.handle({ t: "media.status", cam: "on", send: thumb });
  assert.deepEqual(statuses, [{ t: "media.status", cam: "on", send: thumb }]);
  assert.equal(t.link.lastStatus?.cam, "on");
  t.link.handle({ t: "media.request", send: null });
  assert.equal(t.ignored.length, 1);
});

async function readyTeacher() {
  const ctx = makeLink("teacher");
  await ctx.link.offer("h264");
  ctx.link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  return ctx;
}

test("teacher setOutbound: replaceTrack + scaled encoding + degradation; null clears", async () => {
  const { pc, link } = await readyTeacher();
  const track = new FakeMediaStreamTrack();
  await link.setOutbound(track.asTrack(), { height: 360, fps: 15, kbps: 600 }, "balanced");
  const sender = pc.getTransceivers()[0]!.sender;
  assert.equal(sender.track, track.asTrack());
  assert.deepEqual(sender.encoding(), {
    scaleResolutionDownBy: 2,
    maxFramerate: 15,
    maxBitrate: 600_000,
  });
  assert.equal(
    (sender.params as { degradationPreference?: string }).degradationPreference,
    "balanced",
  );
  await link.setOutbound(null, null);
  assert.equal(sender.track, null);
  assert.equal(sender.setParametersCalls.length, 1);
});

test("teacher setOutbound / request / broadcast are no-ops before ready", async () => {
  const { pc, sent, link } = makeLink("teacher");
  await link.offer("h264");
  await link.setOutbound(new FakeMediaStreamTrack().asTrack(), thumb);
  link.request(thumb);
  link.broadcast(true, "camera");
  assert.equal(pc.getTransceivers()[0]?.sender.replaceTrackCalls.length, 0);
  assert.equal(sent.length, 1); // only the offer
});

test("teacher request / broadcast send the messages once ready", async () => {
  const { sent, link } = await readyTeacher();
  link.request(thumb);
  link.request(null);
  link.broadcast(true, "screen");
  link.broadcast(false);
  assert.deepEqual(sent.slice(1), [
    { t: "media.request", send: thumb },
    { t: "media.request", send: null },
    { t: "media.broadcast", on: true, source: "screen" },
    { t: "media.broadcast", on: false },
  ]);
});

test("stats picks the video outbound/inbound rtp entries", async () => {
  const { pc, link } = await readyTeacher();
  pc.statsReport.set("o1", {
    type: "outbound-rtp",
    kind: "video",
    encoderImplementation: "VideoToolbox",
    qualityLimitationReason: "cpu",
    framesPerSecond: 14,
    frameHeight: 360,
  });
  pc.statsReport.set("i1", {
    type: "inbound-rtp",
    kind: "video",
    framesPerSecond: 9,
    frameHeight: 180,
    framesDecoded: 120,
    framesDropped: 2,
  });
  pc.statsReport.set("x", { type: "candidate-pair" });
  assert.deepEqual(await link.stats(), {
    cpuLimited: true,
    encoder: "VideoToolbox",
    outFps: 14,
    outHeight: 360,
    inFps: 9,
    inHeight: 180,
    framesDecoded: 120,
    framesDropped: 2,
  });
  pc.statsReport.clear();
  assert.deepEqual(await link.stats(), { cpuLimited: false });
});

test("close cancels the offer timer and refuses further work", async () => {
  const { clock, link, states } = makeLink("teacher", { mediaOfferMs: 1000 });
  await link.offer("h264");
  link.close();
  clock.advance(5000);
  assert.deepEqual(states, ["negotiating"]);
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "negotiating");
});

async function readyStudent() {
  const ctx = makeLink("student");
  ctx.link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  const port = new FakeMediaPort();
  const sender = ctx.pc.getTransceivers()[1]!.sender; // mid 2: offered recvonly → we send
  return { ...ctx, port, sender };
}

test("student thumb request: capture 720p15 once, replaceTrack, scale 4, status on", async () => {
  const { link, port, sender, sent } = await readyStudent();
  const caps: string[] = [];
  link.on("capture", (c) => caps.push(c));
  await link.applyRequest(thumb, port);
  assert.deepEqual(port.cameraCalls, [{ width: 1280, height: 720, frameRate: 15 }]);
  assert.equal(sender.track, port.last().asTrack());
  assert.deepEqual(sender.encoding(), {
    scaleResolutionDownBy: 4,
    maxFramerate: 10,
    maxBitrate: 150_000,
  });
  assert.deepEqual(sent.at(-1), { t: "media.status", cam: "on", send: thumb });
  assert.equal(link.cam, "on");
  assert.deepEqual(link.sending, thumb);
  assert.equal(link.captureActive(), true);
  assert.deepEqual(caps, ["on"]);
  // Focus: same track, new parameters, no second capture.
  await link.applyRequest({ height: 720, fps: 15, kbps: 1200 }, port);
  assert.equal(port.cameraCalls.length, 1);
  assert.deepEqual(sender.encoding(), {
    scaleResolutionDownBy: 1,
    maxFramerate: 15,
    maxBitrate: 1_200_000,
  });
});

test("student null request: track stopped, replaceTrack(null), status off", async () => {
  const { link, port, sender, sent } = await readyStudent();
  await link.applyRequest(thumb, port);
  await link.applyRequest(null, port);
  assert.equal(port.last().stopped, true);
  assert.equal(sender.replaceTrackCalls.at(-1), null);
  assert.deepEqual(sent.at(-1), { t: "media.status", cam: "off", send: null });
  assert.equal(link.captureActive(), false);
  // A later request captures afresh.
  await link.applyRequest(thumb, port);
  assert.equal(port.cameraCalls.length, 2);
});

test("student: setParameters rejection falls back to applyConstraints", async () => {
  const { link, port, sender } = await readyStudent();
  sender.rejectSetParameters = new Error("InvalidModificationError");
  await link.applyRequest({ height: 360, fps: 15, kbps: 1200 }, port);
  assert.deepEqual(port.last().constraintsApplied, [{ height: 360, frameRate: 15 }]);
  assert.equal(link.cam, "on");
});

test("student: camera rejection → status error with reason, no track", async () => {
  const { link, port, sender, sent } = await readyStudent();
  port.rejectCamera = new Error("NotAllowedError: permission denied");
  await link.applyRequest(thumb, port);
  assert.deepEqual(sent.at(-1), {
    t: "media.status",
    cam: "error",
    reason: "NotAllowedError: permission denied",
    send: null,
  });
  assert.equal(sender.replaceTrackCalls.length, 0);
  assert.equal(link.captureActive(), false);
});

test("student: camera rejection reason is bounded to 200 chars on the wire", async () => {
  const { link, port, sent } = await readyStudent();
  port.rejectCamera = new Error("x".repeat(500));
  await link.applyRequest(thumb, port);
  const last = sent.at(-1) as { t: string; cam: string; reason?: string };
  assert.equal(last.t, "media.status");
  assert.equal(last.cam, "error");
  assert.equal(last.reason?.length, 200);
  assert.equal(link.cam, "error");
});

test("student: a send() that throws on media.status does not escape applyRequest", async () => {
  const pc = new FakeRTCPeerConnection({});
  const clock = new FakeClock();
  const link = new MediaLink({
    role: "student",
    pc: pc as unknown as RTCPeerConnection,
    send: (m) => {
      if (m.t === "media.status") throw new Error("channel closed");
    },
    clock,
    codecs: new FakeRtcFactory().videoCodecs(),
  });
  link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  const port = new FakeMediaPort();
  port.rejectCamera = new Error("NotAllowedError");
  await link.applyRequest(thumb, port);
  assert.equal(link.state, "ready");
  assert.equal(link.cam, "error");
});

test("student: capture track ended → status error 'camera ended'", async () => {
  const { link, port, sent } = await readyStudent();
  await link.applyRequest(thumb, port);
  port.last().end();
  assert.deepEqual(sent.at(-1), {
    t: "media.status",
    cam: "error",
    reason: "camera ended",
    send: null,
  });
  assert.equal(link.captureActive(), false);
});

test("student: requests are serialised; the last one wins", async () => {
  const { link, port, sender } = await readyStudent();
  const a = link.applyRequest(thumb, port);
  const b = link.applyRequest(null, port);
  await Promise.all([a, b]);
  assert.equal(link.cam, "off");
  assert.equal(sender.replaceTrackCalls.at(-1), null);
  assert.equal(port.last().stopped, true);
});

test("student: a repeated null request while already off sends no second media.status", async () => {
  const { link, port, sent } = await readyStudent();
  await link.applyRequest(null, port);
  const after = sent.length;
  await link.applyRequest(null, port);
  assert.equal(sent.length, after, "identical off → off must not resend media.status");
  // A real change still reports.
  await link.applyRequest(thumb, port);
  assert.deepEqual(sent.at(-1), { t: "media.status", cam: "on", send: thumb });
});

test("student: an unexpected throw inside applyRequest resolves, and is reported as ignored", async () => {
  const { link, port, ignored } = await readyStudent();
  await link.applyRequest(thumb, port);
  // stopCapture() runs outside every try: a track whose stop() blows up is an unexpected throw.
  port.last().stop = () => {
    throw new Error("stop exploded");
  };
  await link.applyRequest(null, port);
  assert.equal(ignored.length, 1);
  assert.match(ignored[0]!, /applyRequest: stop exploded/);
  // The queue is not wedged: the next request still runs.
  port.last().stop = () => {};
  await link.applyRequest(thumb, port);
  assert.equal(link.cam, "on");
});

test("student: request before ready is ignored; close stops the capture", async () => {
  const early = makeLink("student");
  const port = new FakeMediaPort();
  await early.link.applyRequest(thumb, port);
  assert.equal(port.cameraCalls.length, 0);
  const { link, port: p2 } = await readyStudent();
  await link.applyRequest(thumb, p2);
  link.close();
  assert.equal(p2.last().stopped, true);
  assert.equal(link.captureActive(), false);
});
