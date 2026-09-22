import { test } from "node:test";
import assert from "node:assert/strict";
import { PeerSession, type SessionState } from "../../../src/core/peerSession";
import { extractPayload } from "../../../src/core/sdpCodec";
import { FakeClock } from "../helpers/fakeClock";
import { FakeRtcFactory, CHROME_OFFER, SAFARI_ANSWER, flush } from "../helpers/fakeRtc";

const TIMERS = {
  heartbeatMs: 5000,
  degradedMs: 15000,
  failedMs: 60000,
  connectMs: 20000,
  gatherMs: 3000,
};
const offerPayload = extractPayload(CHROME_OFFER, "offer", "7");
const answerPayload = extractPayload(SAFARI_ANSWER, "answer", "7");

function student() {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const s = new PeerSession({
    role: "student",
    ws: "7",
    rtc,
    clock,
    timers: TIMERS,
    appVersion: "t1",
    ua: "test",
  });
  const states: SessionState[] = [];
  s.on("state", (st) => states.push(st));
  return { rtc, clock, s, states };
}

async function connectedStudent() {
  const ctx = student();
  const p = ctx.s.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  await ctx.s.applyRemote(answerPayload);
  const dc = ctx.rtc.last().channels[0]!;
  dc.open();
  return { ...ctx, dc };
}

test("student: start → gathering → localPayload → awaiting-remote", async () => {
  const { rtc, s, states } = student();
  let local: unknown;
  s.on("localPayload", (p) => (local = p));
  const p = s.start();
  await flush();
  assert.equal(s.state, "gathering");
  rtc.last().completeGathering();
  await p;
  assert.deepEqual(states, ["gathering", "awaiting-remote"]);
  assert.equal((local as { role: string }).role, "offer");
  assert.equal(rtc.last().channels[0]?.label, "lab");
});

test("student: gathering proceeds after gatherMs even if never 'complete'", async () => {
  const { clock, s } = student();
  const p = s.start();
  await flush();
  clock.advance(3000);
  await p;
  assert.equal(s.state, "awaiting-remote");
});

test("student: applyRemote → connecting; dc open → connected; hello sent", async () => {
  const { s, dc, states } = await connectedStudent();
  assert.deepEqual(states, ["gathering", "awaiting-remote", "connecting", "connected"]);
  const first = dc.sentJson()[0] as { t: string; role: string; ws: string };
  assert.equal(first.t, "hello");
  assert.equal(first.role, "student");
  assert.equal(first.ws, "7");
  assert.equal((s as PeerSession).state, "connected");
});

test("student: rejects applyRemote with an offer or from wrong state", async () => {
  const { rtc, s } = student();
  await assert.rejects(s.applyRemote(answerPayload));
  const p = s.start();
  await flush();
  rtc.last().completeGathering();
  await p;
  await assert.rejects(s.applyRemote(offerPayload));
});

test("connect timeout → failed + needsRepair; pc closed", async () => {
  const { rtc, clock, s } = student();
  const p = s.start();
  await flush();
  rtc.last().completeGathering();
  await p;
  await s.applyRemote(answerPayload);
  const reasons: string[] = [];
  s.on("needsRepair", (r) => reasons.push(r));
  clock.advance(20000);
  assert.equal(s.state, "failed");
  assert.equal(reasons.length, 1);
  assert.equal(rtc.last().closed, true);
});

test("heartbeat: sends hb; silence → degraded; more silence → failed", async () => {
  const { clock, dc, s, states } = await connectedStudent();
  clock.advance(5000);
  assert.equal((dc.sentJson()[1] as { t: string }).t, "hb");
  clock.advance(15000);
  assert.equal(s.state, "degraded");
  clock.advance(60000);
  assert.equal(s.state, "failed");
  assert.deepEqual(states.slice(-2), ["degraded", "failed"]);
});

test("degraded recovers on inbound hb-ack and reports rtt", async () => {
  const { clock, dc, s } = await connectedStudent();
  const rtts: number[] = [];
  s.on("rtt", (ms) => rtts.push(ms));
  clock.advance(20000);
  assert.equal(s.state, "degraded");
  dc.receive(JSON.stringify({ t: "hb-ack", seq: 0, ts: clock.now() - 12 }));
  assert.equal(s.state, "connected");
  assert.deepEqual(rtts, [12]);
  assert.equal(s.lastRtt, 12);
  clock.advance(60000);
  assert.notEqual(s.state, "failed", "degraded timer must be cleared on recovery");
});

test("ice disconnected → degraded; ice connected → connected; ice failed → failed", async () => {
  const { rtc, s } = await connectedStudent();
  rtc.last().setIce("disconnected");
  assert.equal(s.state, "degraded");
  rtc.last().setIce("connected");
  assert.equal(s.state, "connected");
  rtc.last().setIce("failed");
  assert.equal(s.state, "failed");
});

test("inbound hb gets hb-ack; hello recorded; other messages emitted", async () => {
  const { dc, s } = await connectedStudent();
  const got: unknown[] = [];
  s.on("message", (m) => got.push(m));
  dc.receive(JSON.stringify({ t: "hb", seq: 3, ts: 99 }));
  assert.deepEqual(dc.sentJson().at(-1), { t: "hb-ack", seq: 3, ts: 99 });
  dc.receive(JSON.stringify({ t: "hello", role: "teacher", ws: "7", appVersion: "t1", ua: "mac" }));
  assert.equal(s.remoteHello?.role, "teacher");
  dc.receive(JSON.stringify({ t: "cmd", cmd: "ping" }));
  assert.deepEqual(got, [{ t: "cmd", cmd: "ping" }]);
});

test("garbage and unknown t are ignored and counted, never thrown", async () => {
  const { dc, s } = await connectedStudent();
  dc.receive("not json");
  dc.receive(JSON.stringify({ t: "evil" }));
  dc.receive(JSON.stringify({ t: "cmd", cmd: "rm-rf" }));
  assert.equal(s.ignoredCount, 3);
  assert.equal(s.state, "connected");
});

test("chunked inbound frames reassemble into one message", async () => {
  const { dc, s } = await connectedStudent();
  const got: unknown[] = [];
  s.on("message", (m) => got.push(m));
  const whole = JSON.stringify({ t: "cmd", cmd: "show-id" });
  dc.receive(JSON.stringify({ t: "chunk", id: "x", i: 0, n: 2, data: whole.slice(0, 5) }));
  dc.receive(JSON.stringify({ t: "chunk", id: "x", i: 1, n: 2, data: whole.slice(5) }));
  assert.deepEqual(got, [{ t: "cmd", cmd: "show-id" }]);
});

test("send validates outbound and is a no-op when channel not open", async () => {
  const { s } = student();
  s.send({ t: "cmd", cmd: "ping" }); // idle, no channel: no throw
  const c = await connectedStudent();
  assert.throws(() => c.s.send({ t: "cmd", cmd: "nope" } as never));
  c.s.send({ t: "status", visibility: "visible", wakeLock: true });
  assert.deepEqual(c.dc.sentJson().at(-1), { t: "status", visibility: "visible", wakeLock: true });
});

test("dc close → failed", async () => {
  const { dc, s } = await connectedStudent();
  dc.close();
  assert.equal(s.state, "failed");
});

test("close() tears down silently: state failed, no needsRepair", async () => {
  const { s, rtc } = await connectedStudent();
  let repairs = 0;
  s.on("needsRepair", () => repairs++);
  s.close();
  assert.equal(s.state, "failed");
  assert.equal(repairs, 0);
  assert.equal(rtc.last().closed, true);
});

test("teacher: applyRemote(offer) from idle → gathering → localPayload(answer) → connecting → connected", async () => {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const t = new PeerSession({
    role: "teacher",
    ws: "7",
    rtc,
    clock,
    timers: TIMERS,
    appVersion: "t1",
    ua: "mac",
  });
  const states: SessionState[] = [];
  t.on("state", (st) => states.push(st));
  let local: { role: string } | undefined;
  t.on("localPayload", (p) => (local = p));
  const p = t.applyRemote(offerPayload);
  await flush();
  assert.equal(t.state, "gathering");
  assert.ok(rtc.last().remoteDescription?.sdp?.includes("a=ice-ufrag:kJ3q"));
  rtc.last().completeGathering();
  await p;
  assert.equal(local?.role, "answer");
  assert.deepEqual(states, ["gathering", "connecting"]);
  const dc = rtc.last().incomingChannel();
  dc.open();
  assert.equal(t.state, "connected");
  assert.equal((dc.sentJson()[0] as { role: string }).role, "teacher");
});

test("teacher: start() is rejected", async () => {
  const t = new PeerSession({
    role: "teacher",
    ws: "1",
    rtc: new FakeRtcFactory(),
    clock: new FakeClock(),
    appVersion: "t",
    ua: "u",
  });
  await assert.rejects(t.start());
});

test("passes certificates into the pc config", async () => {
  const rtc = new FakeRtcFactory();
  const cert = { expires: 1 } as unknown as RTCCertificate;
  const s = new PeerSession({
    role: "student",
    ws: "1",
    rtc,
    clock: new FakeClock(),
    certificates: [cert],
    appVersion: "t",
    ua: "u",
  });
  const p = s.start();
  await flush();
  assert.deepEqual(rtc.last().config.certificates, [cert]);
  rtc.last().completeGathering();
  await p;
});

test("heartbeat-caused degrade recovered by ICE re-arms the watchdog", async () => {
  const { clock, rtc, s } = await connectedStudent();
  clock.advance(20000);
  assert.equal(s.state, "degraded");
  rtc.last().setIce("connected");
  assert.equal(s.state, "connected");
  clock.advance(20000);
  assert.equal(s.state, "degraded");
});

test("ICE-caused degrade is cleared by inbound heartbeat", async () => {
  const { clock, rtc, dc, s } = await connectedStudent();
  rtc.last().setIce("disconnected");
  assert.equal(s.state, "degraded");
  dc.receive(JSON.stringify({ t: "hb-ack", seq: 0, ts: clock.now() }));
  assert.equal(s.state, "connected");
  for (let i = 0; i < 12; i++) {
    clock.advance(5000);
    dc.receive(JSON.stringify({ t: "hb-ack", seq: i + 1, ts: clock.now() }));
  }
  assert.notEqual(s.state, "failed");
});

test("close() during gathering emits no needsRepair and ends failed", async () => {
  const { rtc, s } = student();
  let repairs = 0;
  s.on("needsRepair", () => repairs++);
  void s.start();
  await flush();
  assert.equal(s.state, "gathering");
  s.close();
  assert.equal(s.state, "failed");
  assert.equal(repairs, 0);
  assert.equal(rtc.last().closed, true);
});

test("close() during connecting emits no needsRepair and ends failed", async () => {
  const { rtc, s } = student();
  let repairs = 0;
  s.on("needsRepair", () => repairs++);
  const p = s.start();
  await flush();
  rtc.last().completeGathering();
  await p;
  await s.applyRemote(answerPayload);
  assert.equal(s.state, "connecting");
  s.close();
  assert.equal(s.state, "failed");
  assert.equal(repairs, 0);
  assert.equal(rtc.last().closed, true);
});

test("stale pc/dc events after close() are inert", async () => {
  const { rtc, dc, s } = await connectedStudent();
  const ignoredBefore = s.ignoredCount;
  s.close();
  assert.equal(s.state, "failed");
  // Only listen from here: anything the stale pc/dc fire below must produce nothing.
  const states: SessionState[] = [];
  s.on("state", (st) => states.push(st));
  let repairs = 0;
  s.on("needsRepair", () => repairs++);
  rtc.last().setIce("failed");
  dc.receive("not json");
  dc.open();
  assert.equal(s.state, "failed");
  assert.equal(repairs, 0);
  assert.equal(states.length, 0);
  assert.equal(s.ignoredCount, ignoredBefore);
});

test("close() mid-gathering settles the pending start() promise", async () => {
  const { s } = student();
  let repairs = 0;
  s.on("needsRepair", () => repairs++);
  const p = s.start();
  await flush();
  assert.equal(s.state, "gathering");
  s.close();
  await p;
  assert.equal(s.state, "failed");
  assert.equal(repairs, 0);
});

test("close() during gathering clears the gather fallback timer", async () => {
  const { clock, s } = student();
  const states: SessionState[] = [];
  s.on("state", (st) => states.push(st));
  void s.start();
  await flush();
  s.close();
  const statesAfterClose = [...states];
  clock.advance(3000);
  assert.deepEqual(states, statesAfterClose);
});

test("a throwing state listener does not suppress side effects", async () => {
  const { s, dc } = await connectedStudent();
  const reasons: string[] = [];
  s.on("needsRepair", (r) => reasons.push(r));
  s.on("state", () => {
    throw new Error("boom");
  });
  assert.throws(() => dc.close());
  assert.equal(reasons.length, 1);
  assert.equal(s.state, "failed");
});

test("student rejects an answer addressed to another workstation", async () => {
  const { rtc, s } = student();
  const p = s.start();
  await flush();
  rtc.last().completeGathering();
  await p;
  const foreign = extractPayload(SAFARI_ANSWER, "answer", "9");
  await assert.rejects(s.applyRemote(foreign), /workstation 9, not 7/);
  assert.equal(s.state, "awaiting-remote");
  assert.equal(rtc.last().remoteDescription, null, "the pc must not be touched");
});

test("an answer whose ws differs only in case is for us", async () => {
  const ctx = student();
  const p = ctx.s.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  const shouted = extractPayload(SAFARI_ANSWER, "answer", "ROW 7");
  const s2 = new PeerSession({
    role: "student",
    ws: "row 7",
    rtc: ctx.rtc,
    clock: ctx.clock,
    timers: TIMERS,
    appVersion: "t1",
    ua: "test",
  });
  const p2 = s2.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p2;
  await s2.applyRemote(shouted);
  assert.equal(s2.state, "connecting");
  ctx.s.close();
  s2.close();
});

test("a duplicate chunk frame is ignored and counted", async () => {
  const { dc, s } = await connectedStudent();
  const got: unknown[] = [];
  s.on("message", (m) => got.push(m));
  const whole = JSON.stringify({ t: "cmd", cmd: "show-id" });
  const before = s.ignoredCount;
  dc.receive(JSON.stringify({ t: "chunk", id: "y", i: 0, n: 2, data: whole.slice(0, 5) }));
  dc.receive(JSON.stringify({ t: "chunk", id: "y", i: 0, n: 2, data: whole.slice(0, 5) }));
  assert.equal(s.ignoredCount, before + 1);
  dc.receive(JSON.stringify({ t: "chunk", id: "y", i: 1, n: 2, data: whole.slice(5) }));
  assert.deepEqual(got, [{ t: "cmd", cmd: "show-id" }]);
  assert.equal(s.ignoredCount, before + 1, "the completing chunk is not counted");
});

test("teacher: a second incoming datachannel is closed and ignored", async () => {
  const rtc = new FakeRtcFactory();
  const t = new PeerSession({
    role: "teacher",
    ws: "7",
    rtc,
    clock: new FakeClock(),
    timers: TIMERS,
    appVersion: "t1",
    ua: "mac",
  });
  const p = t.applyRemote(offerPayload);
  await flush();
  rtc.last().completeGathering();
  await p;
  const first = rtc.last().incomingChannel();
  first.open();
  assert.equal(t.state, "connected");
  const second = rtc.last().incomingChannel();
  assert.equal(second.readyState, "closed", "the newcomer is closed");
  assert.equal(t.ignoredCount, 1);
  assert.equal(first.readyState, "open", "the live channel is untouched");
  t.send({ t: "cmd", cmd: "ping" });
  assert.deepEqual(first.sentJson().at(-1), { t: "cmd", cmd: "ping" });
});

test("inbound fires for every valid frame from the peer, never for refused ones", async () => {
  const { dc, s } = await connectedStudent();
  let inbound = 0;
  s.on("inbound", () => inbound++);
  dc.receive(JSON.stringify({ t: "hb-ack", seq: 1, ts: 0 }));
  dc.receive(JSON.stringify({ t: "hb", seq: 2, ts: 0 }));
  dc.receive(JSON.stringify({ t: "hello", role: "teacher", ws: "7", appVersion: "t1", ua: "mac" }));
  dc.receive(JSON.stringify({ t: "cmd", cmd: "ping" }));
  assert.equal(inbound, 4, "hb-ack, hb, hello and cmd are all proof of life");
  dc.receive("not json");
  dc.receive(JSON.stringify({ t: "evil" }));
  assert.equal(inbound, 4, "garbage is not proof of anything");
});
