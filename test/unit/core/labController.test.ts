import { test } from "node:test";
import assert from "node:assert/strict";
import { LabController, SupersededError } from "../../../src/core/labController";
import { extractPayload } from "../../../src/core/sdpCodec";
import { LEGACY_TEACHER_KEY } from "../../../src/schemas/legacy";
import { TEACHER_KEY } from "../../../src/schemas/storage";
import { wsKey } from "../../../src/schemas/ws";
import { FakeClock } from "../helpers/fakeClock";
import { MemoryKv } from "../helpers/memoryKv";
import { CHROME_OFFER, FakeRtcFactory, SAFARI_MEDIA_ANSWER, flush } from "../helpers/fakeRtc";
import { FakeMediaPort } from "../helpers/fakeMedia";

const offer = (ws: string) => extractPayload(CHROME_OFFER, "offer", ws);

function make(kv = new MemoryKv()) {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const lab = new LabController({ rtc, clock, kv, appVersion: "v1", ua: "mac" });
  return { rtc, clock, kv, lab };
}

async function pair(ctx: ReturnType<typeof make>, ws: string) {
  const p = ctx.lab.acceptOffer(offer(ws));
  await flush();
  ctx.rtc.last().completeGathering();
  const answer = await p;
  const dc = ctx.rtc.last().incomingChannel();
  dc.open();
  return { answer, dc };
}

/** The tile for `ws`, whatever its current spelling. */
function tile(ctx: ReturnType<typeof make>, ws: string) {
  const t = ctx.lab.snapshot().find((v) => v.key === wsKey(ws));
  assert.ok(t, `no tile for ${ws}`);
  return t;
}

function saved(ctx: ReturnType<typeof make>) {
  return JSON.parse(ctx.kv.get(TEACHER_KEY)!) as {
    roster: Record<
      string,
      {
        ws: string;
        pairCount: number;
        lastSeenUa?: string;
        lastFingerprint?: string;
        lastSeenAt?: number;
        label?: string;
      }
    >;
    settings: { heartbeatMs: number; media: { cameras: boolean } };
  };
}

test("fresh lab: no tiles, empty repair queue, all counts zero", () => {
  const { lab } = make();
  assert.deepEqual(lab.snapshot(), []);
  assert.deepEqual(lab.repairQueue(), []);
  assert.deepEqual(lab.counts(), { connected: 0, degraded: 0, failed: 0, never: 0 });
});

test("acceptOffer creates the tile and resolves with an answer for the same ws", async () => {
  const ctx = make();
  const { answer } = await pair(ctx, "Row 7");
  assert.equal(answer.role, "answer");
  assert.equal(answer.ws, "Row 7");
  const t = tile(ctx, "row 7");
  assert.equal(t.ws, "Row 7");
  assert.equal(t.key, "row 7");
  assert.equal(t.state, "connected");
  assert.deepEqual(ctx.lab.repairQueue(), []);
});

test("snapshot and repairQueue are in natural, case-insensitive order", async () => {
  const ctx = make();
  for (const ws of ["Row 10", "2", "row 2", "10", "1"]) await pair(ctx, ws);
  assert.deepEqual(
    ctx.lab.snapshot().map((t) => t.ws),
    ["1", "2", "10", "row 2", "Row 10"],
  );
  ctx.rtc.pcs[1]!.channels.at(-1)!.close(); // "2" fails
  assert.deepEqual(ctx.lab.repairQueue(), ["2"]);
});

test("change event fires on state transitions and roster is persisted under wsKey", async () => {
  const ctx = make();
  let changes = 0;
  ctx.lab.on("change", () => changes++);
  const { dc } = await pair(ctx, "Row 3");
  assert.ok(changes >= 2);
  dc.receive(
    JSON.stringify({
      t: "hello",
      role: "student",
      ws: "Row 3",
      appVersion: "v1",
      ua: "iPad Safari",
    }),
  );
  const e = saved(ctx).roster["row 3"]!;
  assert.equal(e.ws, "Row 3");
  assert.equal(e.pairCount, 1);
  assert.equal(e.lastSeenUa, "iPad Safari");
});

test("status messages populate the tile; version mismatch flagged", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "5");
  dc.receive(
    JSON.stringify({
      t: "status",
      battery: 0.4,
      charging: false,
      visibility: "hidden",
      wakeLock: false,
    }),
  );
  dc.receive(JSON.stringify({ t: "hello", role: "student", ws: "5", appVersion: "v0", ua: "x" }));
  const t = tile(ctx, "5");
  assert.equal(t.battery, 0.4);
  assert.equal(t.visibility, "hidden");
  assert.equal(t.versionMismatch, true);
  assert.equal(t.remoteAppVersion, "v0");
});

test("re-accepting an offer for a connected ws replaces the session silently and flags the tile", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "2");
  const first = ctx.lab.sessions.get("2")!;
  let repairs = 0;
  first.on("needsRepair", () => repairs++);
  await pair(ctx, "2");
  assert.notEqual(ctx.lab.sessions.get("2"), first);
  assert.equal(first.state, "failed");
  assert.equal(repairs, 0, "replacement is silent");
  assert.equal(dc.readyState, "closed");
  assert.equal(ctx.lab.snapshot().length, 1, "one tile, not two");
  assert.equal(tile(ctx, "2").replaced, true, "the old session was live: teacher should notice");
});

test("takeover under a different spelling keeps one tile and shows the latest spelling", async () => {
  const ctx = make();
  await pair(ctx, "Row2");
  ctx.lab.setLabel("Row2", "window seat");
  await pair(ctx, "ROW2");
  assert.equal(ctx.lab.snapshot().length, 1);
  const t = tile(ctx, "row2");
  assert.equal(t.ws, "ROW2");
  assert.equal(t.label, "window seat", "roster metadata carries over: same station");
  assert.equal(saved(ctx).roster["row2"]?.ws, "ROW2");
  assert.equal(saved(ctx).roster["row2"]?.pairCount, 2);
});

test("replaced is not set when the old session had already failed or never existed", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "9");
  assert.equal(tile(ctx, "9").replaced, false);
  dc.close();
  assert.equal(tile(ctx, "9").state, "failed");
  await pair(ctx, "9");
  assert.equal(tile(ctx, "9").replaced, false, "re-pairing a dead station is the normal path");
});

test("acknowledgeReplaced clears the flag and emits change once", async () => {
  const ctx = make();
  await pair(ctx, "4");
  await pair(ctx, "4");
  assert.equal(tile(ctx, "4").replaced, true);
  let changes = 0;
  ctx.lab.on("change", () => changes++);
  ctx.lab.acknowledgeReplaced("4");
  ctx.lab.acknowledgeReplaced("4");
  assert.equal(tile(ctx, "4").replaced, false);
  assert.equal(changes, 1);
});

test("remove closes the session, drops the tile and the roster entry; unknown → false", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "Seat 4");
  ctx.lab.setLabel("Seat 4", "by the door");
  assert.equal(ctx.lab.remove("seat 4"), true);
  assert.equal(dc.readyState, "closed");
  assert.deepEqual(ctx.lab.snapshot(), []);
  assert.deepEqual(ctx.lab.repairQueue(), []);
  assert.equal(saved(ctx).roster["seat 4"], undefined);
  assert.equal(ctx.lab.remove("seat 4"), false);
  assert.equal(ctx.lab.remove("nobody"), false);
  await pair(ctx, "Seat 4");
  const t = tile(ctx, "Seat 4");
  assert.equal(t.label, undefined, "a removed station comes back fresh");
  assert.equal(saved(ctx).roster["seat 4"]?.pairCount, 1);
});

test("failed session lands in repairQueue with history", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "9");
  dc.close();
  assert.deepEqual(ctx.lab.repairQueue(), ["9"]);
  const t = tile(ctx, "9");
  assert.equal(t.state, "failed");
  assert.deepEqual(t.history.map((h) => h.state).slice(-2), ["connected", "failed"]);
});

test("settings update persists and is applied to new sessions", async () => {
  const ctx = make();
  ctx.lab.updateSettings({ heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 });
  assert.equal(saved(ctx).settings.heartbeatMs, 1000);
  const { dc } = await pair(ctx, "1");
  ctx.clock.advance(1000);
  assert.equal((dc.sentJson().at(-1) as { t: string }).t, "hb");
  ctx.clock.advance(2000);
  assert.equal(tile(ctx, "1").state, "degraded");
});

test("sendCmd routes to the right session (any spelling) and sets labels", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "Row 4");
  ctx.lab.sendCmd("ROW 4", "ping");
  assert.deepEqual(dc.sentJson().at(-1), { t: "cmd", cmd: "ping" });
  ctx.lab.setLabel("row 4", "Row 1 seat 4");
  assert.equal(tile(ctx, "Row 4").label, "Row 1 seat 4");
  ctx.lab.sendCmd("29", "ping"); // no session: no throw
});

test("acceptOffer twice back-to-back before gathering completes: first settles, second resolves", async () => {
  const ctx = make();
  const p1 = ctx.lab.acceptOffer(offer("2"));
  const p2 = ctx.lab.acceptOffer(offer("2"));
  const settled = await Promise.race([
    p1.then(
      () => "settled",
      () => "settled",
    ),
    flush().then(() => "timeout"),
  ]);
  assert.equal(settled, "settled");
  await assert.rejects(p1, SupersededError);
  ctx.rtc.last().completeGathering();
  const answer = await p2;
  assert.equal(answer.ws, "2");
  assert.equal(
    tile(ctx, "2").replaced,
    false,
    "superseding a still-gathering scan is not a takeover",
  );
});

test("setLabel rejects an over-long label without mutating the roster", async () => {
  const ctx = make();
  await pair(ctx, "4");
  assert.equal(ctx.lab.setLabel("4", "x".repeat(65)), false);
  assert.equal(tile(ctx, "4").label, undefined);
});

test("setLabel on an unknown station creates no tile", () => {
  const ctx = make();
  assert.equal(ctx.lab.setLabel("ghost", "boo"), false);
  assert.deepEqual(ctx.lab.snapshot(), []);
});

test("updateSettings rejects an invalid patch without mutating settings", () => {
  const ctx = make();
  const before = ctx.lab.settings;
  assert.equal(ctx.lab.updateSettings({ heartbeatMs: 100 }), false);
  assert.deepEqual(ctx.lab.settings, before);
});

test("persist never throws even if the KeyValueStore.set throws", async () => {
  const lab = new LabController({
    rtc: new FakeRtcFactory(),
    clock: new FakeClock(),
    kv: {
      get: () => null,
      set: () => {
        throw new Error("quota exceeded");
      },
      remove: () => {},
    },
    appVersion: "v1",
    ua: "mac",
  });
  const p = lab.acceptOffer(offer("4"));
  await flush();
  assert.equal(lab.snapshot()[0]?.ws, "4");
  void p;
});

test("pairCount counts pairings, not ICE recoveries", async () => {
  const ctx = make();
  await pair(ctx, "1");
  const pc = ctx.rtc.last();
  pc.setIce("disconnected");
  pc.setIce("connected");
  assert.equal(tile(ctx, "1").state, "connected");
  assert.equal(saved(ctx).roster["1"]?.pairCount, 1);
});

test("history is capped at 50 entries; snapshot() returns a fresh copy each time", async () => {
  const ctx = make();
  await pair(ctx, "1");
  const pc = ctx.rtc.last();
  for (let i = 0; i < 30; i++) {
    pc.setIce("disconnected");
    pc.setIce("connected");
  }
  assert.equal(tile(ctx, "1").history.length, 50);
  assert.notEqual(tile(ctx, "1").history, tile(ctx, "1").history);
});

test("counts", async () => {
  const ctx = make();
  await pair(ctx, "1");
  await pair(ctx, "2");
  ctx.rtc.pcs[1]!.channels.at(-1)!.close();
  assert.deepEqual(ctx.lab.counts(), { connected: 1, degraded: 0, failed: 1, never: 0 });
});

test("fingerprint continuity: same cert → unchanged, different cert → flagged", async () => {
  const ctx = make();
  await pair(ctx, "3");
  const first = tile(ctx, "3");
  assert.equal(first.fingerprintChanged, false, "no previous pairing to differ from");
  assert.match(first.fingerprint!, /^7B:8B:F0:65(:[0-9A-F]{2})+$/);
  assert.equal(saved(ctx).roster["3"]?.lastFingerprint, first.fingerprint);

  await pair(ctx, "3");
  assert.equal(tile(ctx, "3").fingerprintChanged, false);

  const swapped = { ...offer("3"), fp: new Uint8Array(32).fill(0xab) };
  const p = ctx.lab.acceptOffer(swapped);
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  const t = tile(ctx, "3");
  assert.equal(t.fingerprintChanged, true);
  assert.equal(t.fingerprint, new Array(32).fill("AB").join(":"));
});

test("lastFingerprint is persisted only once acceptOffer's answer resolves", async () => {
  const ctx = make();
  await pair(ctx, "3");
  const first = saved(ctx).roster["3"]?.lastFingerprint;
  assert.match(first!, /^7B:8B:F0:65/);
  const swapped = { ...offer("3"), fp: new Uint8Array(32).fill(0xab) };
  const p = ctx.lab.acceptOffer(swapped);
  await flush();
  assert.equal(
    saved(ctx).roster["3"]?.lastFingerprint,
    first,
    "still the previous pairing while gathering",
  );
  ctx.rtc.last().completeGathering();
  await p;
  assert.equal(saved(ctx).roster["3"]?.lastFingerprint, new Array(32).fill("AB").join(":"));
});

test("a superseded acceptOffer never writes its fingerprint", async () => {
  const ctx = make();
  await pair(ctx, "2");
  const original = saved(ctx).roster["2"]?.lastFingerprint;
  const p1 = ctx.lab.acceptOffer({ ...offer("2"), fp: new Uint8Array(32).fill(0xab) });
  const p2 = ctx.lab.acceptOffer(offer("2"));
  await assert.rejects(p1, SupersededError);
  await flush();
  ctx.rtc.last().completeGathering();
  await p2;
  assert.equal(saved(ctx).roster["2"]?.lastFingerprint, original);
  assert.equal(tile(ctx, "2").fingerprintChanged, false);
});

test("history survives a re-pair", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "6");
  dc.close();
  const before = tile(ctx, "6").history.map((h) => h.state);
  assert.deepEqual(before.slice(-2), ["connected", "failed"]);
  await pair(ctx, "6");
  const after = tile(ctx, "6").history.map((h) => h.state);
  assert.deepEqual(after.slice(0, before.length), before, "earlier states are kept");
  assert.deepEqual(after.slice(before.length), ["gathering", "connecting", "connected"]);
});

test("lastSeenAt tracks the latest inbound frame; lastConnectedAt stays the pairing time", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "5");
  const paired = tile(ctx, "5");
  assert.equal(paired.lastSeenAt, paired.lastConnectedAt);
  ctx.clock.advance(7000);
  dc.receive(JSON.stringify({ t: "hb-ack", seq: 1, ts: 0 }));
  const t = tile(ctx, "5");
  assert.equal(t.lastSeenAt, 7000);
  assert.equal(t.lastConnectedAt, paired.lastConnectedAt);
  ctx.clock.advance(1000);
  ctx.lab.sendCmd("5", "ping");
  assert.equal(tile(ctx, "5").lastSeenAt, 7000, "outbound traffic is not 'seen'");
});

test("lastSeenAt is persisted at most once a minute while chatty, and on degraded/failed", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "6");
  const stored = () => saved(ctx).roster["6"]?.lastSeenAt;
  const hb = () => dc.receive(JSON.stringify({ t: "hb-ack", seq: 1, ts: 0 }));
  assert.equal(stored(), 0, "pairing itself records a sighting");
  for (let i = 0; i < 11; i++) {
    ctx.clock.advance(5000);
    hb();
  }
  assert.equal(stored(), 0, "55 s of heartbeats: no write yet");
  assert.equal(tile(ctx, "6").lastSeenAt, 55_000);
  ctx.clock.advance(5000);
  hb();
  assert.equal(stored(), 60_000, "first write once a minute has passed");
  ctx.clock.advance(5000);
  hb();
  assert.equal(stored(), 60_000, "then quiet again");
  // The miss check runs on the 5 s tick and needs > degradedMs, so 20 s → degraded.
  ctx.clock.advance(20_000);
  assert.equal(tile(ctx, "6").state, "degraded");
  assert.equal(stored(), 65_000, "degraded persists the last sighting");
});

test("a never-paired tile reports persisted metadata from an earlier run", () => {
  const kv = new MemoryKv();
  kv.set(
    TEACHER_KEY,
    JSON.stringify({
      roster: { "row 9": { ws: "Row 9", pairCount: 1, lastSeenAt: 1234, lastConnectedAt: 1000 } },
    }),
  );
  const ctx = make(kv);
  const t = tile(ctx, "row 9");
  assert.equal(t.state, "never");
  assert.equal(t.ws, "Row 9");
  assert.equal(t.lastSeenAt, 1234);
  assert.deepEqual(ctx.lab.repairQueue(), ["Row 9"], "known but not live: walk there");
  assert.deepEqual(ctx.lab.counts(), { connected: 0, degraded: 0, failed: 0, never: 1 });
});

test("a v1 teacher blob is migrated on first boot and removed; labels survive", () => {
  const kv = new MemoryKv();
  kv.set(
    LEGACY_TEACHER_KEY,
    JSON.stringify({
      roster: { "7": { label: "Row 1 seat 7", pairCount: 2 } },
      settings: { heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 },
    }),
  );
  const ctx = make(kv);
  assert.equal(tile(ctx, "7").label, "Row 1 seat 7");
  assert.equal(ctx.lab.settings.heartbeatMs, 1000);
  assert.equal(saved(ctx).roster["7"]?.ws, "7");
  assert.equal(kv.get(LEGACY_TEACHER_KEY), null);
});

test("when v2 exists, v1 is ignored and removed", () => {
  const kv = new MemoryKv();
  kv.set(TEACHER_KEY, JSON.stringify({ roster: { a: { ws: "A", pairCount: 1 } } }));
  kv.set(LEGACY_TEACHER_KEY, JSON.stringify({ roster: { "7": { pairCount: 9 } } }));
  const ctx = make(kv);
  assert.deepEqual(
    ctx.lab.snapshot().map((t) => t.ws),
    ["A"],
  );
  assert.equal(kv.get(LEGACY_TEACHER_KEY), null);
});

const thumb = { height: 180, fps: 10, kbps: 150 };
const focusP = { height: 720, fps: 15, kbps: 1200 };

function makeMedia(kv = new MemoryKv()) {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const media = new FakeMediaPort();
  const lab = new LabController({
    rtc,
    clock,
    kv,
    appVersion: "v1",
    ua: "mac",
    media,
    statsMs: 2000,
  });
  return { rtc, clock, kv, lab, media };
}

const hello = (caps?: string[]) =>
  JSON.stringify({
    t: "hello",
    role: "student",
    ws: "x",
    appVersion: "v1",
    ua: "ipad",
    ...(caps ? { caps } : {}),
  });

/** Pair, deliver a hello with media caps, answer the teacher's offer → link ready. */
async function pairMedia(ctx: ReturnType<typeof makeMedia>, ws: string) {
  const { dc } = await pair(ctx, ws);
  const pc = ctx.rtc.last();
  dc.receive(hello(["media"]));
  await flush();
  dc.receive(JSON.stringify({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER }));
  await flush();
  return { dc, pc, sent: () => dc.sentJson() as { t: string; [k: string]: unknown }[] };
}

test("hello with media caps → offer sent; without → unsupported", async () => {
  const ctx = makeMedia();
  const a = await pair(ctx, "A");
  a.dc.receive(hello(["media"]));
  await flush();
  assert.equal(
    a.dc.sentJson().some((m) => (m as { t: string }).t === "media.offer"),
    true,
  );
  assert.equal(tile(ctx, "A").media.state, "negotiating");
  const b = await pair(ctx, "B");
  b.dc.receive(hello());
  await flush();
  assert.equal(tile(ctx, "B").media.state, "unsupported");
  assert.equal(tile(ctx, "B").media.reason, "older build");
  assert.equal(
    b.dc.sentJson().some((m) => (m as { t: string }).t === "media.offer"),
    false,
  );
});

test("ready link: broadcast off, request null by default; track exposed on the tile", async () => {
  const ctx = makeMedia();
  const { sent } = await pairMedia(ctx, "A");
  const t = tile(ctx, "A");
  assert.equal(t.media.state, "ready");
  assert.ok(t.media.track);
  const after = sent().filter((m) => m.t.startsWith("media.") && m.t !== "media.offer");
  assert.deepEqual(after, [
    { t: "media.broadcast", on: false },
    { t: "media.request", send: null },
  ]);
});

test("setCameras persists and pushes thumb / null to every ready link", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  const b = await pairMedia(ctx, "B");
  ctx.lab.setCameras(true);
  assert.equal(saved(ctx).settings.media.cameras, true);
  for (const s of [a, b]) assert.deepEqual(s.sent().at(-1), { t: "media.request", send: thumb });
  ctx.lab.setCameras(false);
  for (const s of [a, b]) assert.deepEqual(s.sent().at(-1), { t: "media.request", send: null });
  // A link that becomes ready while cameras are on is asked for thumb immediately.
  ctx.lab.setCameras(true);
  const c = await pairMedia(ctx, "C");
  assert.deepEqual(c.sent().at(-1), { t: "media.request", send: thumb });
});

test("focus swaps profiles between stations and clears when the station fails", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  const b = await pairMedia(ctx, "B");
  ctx.lab.focus("a");
  assert.equal(ctx.lab.focused, "a");
  assert.deepEqual(a.sent().at(-1), { t: "media.request", send: focusP });
  ctx.lab.focus("B");
  assert.deepEqual(a.sent().at(-1), { t: "media.request", send: null });
  assert.deepEqual(b.sent().at(-1), { t: "media.request", send: focusP });
  ctx.lab.focus("nobody");
  assert.equal(ctx.lab.focused, "b");
  b.dc.close();
  assert.equal(ctx.lab.focused, undefined);
  ctx.lab.focus("A");
  ctx.lab.focus(null);
  assert.deepEqual(a.sent().at(-1), { t: "media.request", send: null });
  assert.equal(ctx.lab.focused, undefined);
});

test("media.status updates the tile", async () => {
  const ctx = makeMedia();
  const { dc } = await pairMedia(ctx, "A");
  dc.receive(JSON.stringify({ t: "media.status", cam: "on", send: thumb }));
  assert.equal(tile(ctx, "A").media.cam, "on");
  assert.deepEqual(tile(ctx, "A").media.send, thumb);
  dc.receive(
    JSON.stringify({ t: "media.status", cam: "error", reason: "NotAllowedError", send: null }),
  );
  assert.equal(tile(ctx, "A").media.cam, "error");
  assert.equal(tile(ctx, "A").media.reason, "NotAllowedError");
});

test("startBroadcast(camera) captures, attaches to every ready link, and notifies students", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  await ctx.lab.startBroadcast("camera");
  assert.equal(ctx.lab.broadcast.source, "camera");
  assert.deepEqual(ctx.media.cameraCalls, [{ width: 1280, height: 720, frameRate: 15 }]);
  const sender = a.pc.getTransceivers()[0]!.sender;
  assert.equal(sender.track, ctx.media.last().asTrack());
  assert.deepEqual(sender.encoding(), {
    scaleResolutionDownBy: 2,
    maxFramerate: 15,
    maxBitrate: 600_000,
  });
  assert.equal(
    (sender.params as { degradationPreference?: string }).degradationPreference,
    "balanced",
  );
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: true, source: "camera" });
  // A station that becomes ready later gets the track too.
  const b = await pairMedia(ctx, "B");
  assert.equal(b.pc.getTransceivers()[0]!.sender.track, ctx.media.last().asTrack());
  assert.deepEqual(b.sent().slice(-2)[0], { t: "media.broadcast", on: true, source: "camera" });
});

test("startBroadcast(screen) uses the screen profile; switching stops the old track", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  await ctx.lab.startBroadcast("camera");
  const cam = ctx.media.last();
  await ctx.lab.startBroadcast("screen");
  assert.equal(cam.stopped, true);
  assert.equal(ctx.media.screenCalls, 1);
  const sender = a.pc.getTransceivers()[0]!.sender;
  assert.deepEqual(sender.encoding(), {
    scaleResolutionDownBy: 2,
    maxFramerate: 5,
    maxBitrate: 1_000_000,
  });
  assert.equal(
    (sender.params as { degradationPreference?: string }).degradationPreference,
    "maintain-resolution",
  );
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: true, source: "screen" });
});

test("stopBroadcast and track ended both detach and notify", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  await ctx.lab.startBroadcast("camera");
  ctx.lab.stopBroadcast();
  assert.equal(ctx.lab.broadcast.source, null);
  assert.equal(ctx.media.last().stopped, true);
  assert.equal(a.pc.getTransceivers()[0]!.sender.track, null);
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: false });
  await ctx.lab.startBroadcast("screen");
  ctx.media.last().end();
  assert.equal(ctx.lab.broadcast.source, null);
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: false });
});

test("startBroadcast rejects when the port rejects and changes nothing", async () => {
  const ctx = makeMedia();
  await pairMedia(ctx, "A");
  ctx.media.rejectScreen = new Error("NotAllowedError: cancelled");
  await assert.rejects(ctx.lab.startBroadcast("screen"), /cancelled/);
  assert.equal(ctx.lab.broadcast.source, null);
});

test("retryMedia re-offers only from failed", async () => {
  const ctx = makeMedia();
  const { dc } = await pair(ctx, "A");
  dc.receive(hello(["media"]));
  await flush();
  assert.equal(ctx.lab.retryMedia("A"), false);
  ctx.clock.advance(10_000);
  assert.equal(tile(ctx, "A").media.state, "failed");
  assert.equal(ctx.lab.retryMedia("A"), true);
  await flush();
  assert.equal(tile(ctx, "A").media.state, "negotiating");
  const offers = dc.sentJson().filter((m) => (m as { t: string }).t === "media.offer") as {
    seq: number;
  }[];
  assert.deepEqual(
    offers.map((o) => o.seq),
    [1, 2],
  );
  assert.equal(ctx.lab.retryMedia("nobody"), false);
});

test("stats are polled only while media is active, and land on the tile", async () => {
  const ctx = makeMedia();
  const { pc } = await pairMedia(ctx, "A");
  pc.statsReport.set("i", {
    type: "inbound-rtp",
    kind: "video",
    frameHeight: 180,
    framesDecoded: 5,
  });
  ctx.clock.advance(4000);
  await flush();
  assert.equal(tile(ctx, "A").media.stats, undefined);
  ctx.lab.setCameras(true);
  ctx.clock.advance(2000);
  await flush();
  assert.equal(tile(ctx, "A").media.stats?.inHeight, 180);
  ctx.lab.setCameras(false);
  pc.statsReport.set("i", {
    type: "inbound-rtp",
    kind: "video",
    frameHeight: 360,
    framesDecoded: 9,
  });
  ctx.clock.advance(4000);
  await flush();
  assert.equal(tile(ctx, "A").media.stats?.inHeight, 180);
});

test("remove() clears focus and a fresh pairing starts with media none", async () => {
  const ctx = makeMedia();
  await pairMedia(ctx, "A");
  ctx.lab.focus("A");
  ctx.lab.remove("A");
  assert.equal(ctx.lab.focused, undefined);
  await pair(ctx, "A");
  assert.equal(tile(ctx, "A").media.state, "none");
  assert.equal(tile(ctx, "A").media.cam, "off");
});
