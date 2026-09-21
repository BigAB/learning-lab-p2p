import { test } from "node:test";
import assert from "node:assert/strict";
import { LabController, SupersededError } from "../../../src/core/labController";
import { extractPayload } from "../../../src/core/sdpCodec";
import { TEACHER_KEY } from "../../../src/schemas/storage";
import { FakeClock } from "../helpers/fakeClock";
import { MemoryKv } from "../helpers/memoryKv";
import { CHROME_OFFER, FakeRtcFactory, flush } from "../helpers/fakeRtc";

const offer = (ws: number) => extractPayload(CHROME_OFFER, "offer", ws);

function make() {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const kv = new MemoryKv();
  const lab = new LabController({ rtc, clock, kv, appVersion: "v1", ua: "mac" });
  return { rtc, clock, kv, lab };
}

async function pair(ctx: ReturnType<typeof make>, ws: number) {
  const p = ctx.lab.acceptOffer(offer(ws));
  await flush();
  ctx.rtc.last().completeGathering();
  const answer = await p;
  const dc = ctx.rtc.last().incomingChannel();
  dc.open();
  return { answer, dc };
}

test("fresh lab: 30 tiles never, repair queue is 1..30", () => {
  const { lab } = make();
  const snap = lab.snapshot();
  assert.equal(snap.length, 30);
  assert.ok(snap.every((t) => t.state === "never"));
  assert.deepEqual(
    lab.repairQueue(),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
});

test("acceptOffer resolves with an answer payload for the same ws", async () => {
  const ctx = make();
  const { answer } = await pair(ctx, 7);
  assert.equal(answer.role, "answer");
  assert.equal(answer.ws, 7);
  assert.equal(ctx.lab.snapshot()[6]?.state, "connected");
  assert.ok(!ctx.lab.repairQueue().includes(7));
});

test("change event fires on state transitions and roster is persisted", async () => {
  const ctx = make();
  let changes = 0;
  ctx.lab.on("change", () => changes++);
  const { dc } = await pair(ctx, 3);
  assert.ok(changes >= 2);
  dc.receive(
    JSON.stringify({ t: "hello", role: "student", ws: 3, appVersion: "v1", ua: "iPad Safari" }),
  );
  const saved = JSON.parse(ctx.kv.get(TEACHER_KEY)!) as {
    roster: Record<string, { pairCount: number; lastSeenUa?: string }>;
  };
  assert.equal(saved.roster["3"]?.pairCount, 1);
  assert.equal(saved.roster["3"]?.lastSeenUa, "iPad Safari");
});

test("status messages populate the tile; version mismatch flagged", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 5);
  dc.receive(
    JSON.stringify({
      t: "status",
      battery: 0.4,
      charging: false,
      visibility: "hidden",
      wakeLock: false,
    }),
  );
  dc.receive(JSON.stringify({ t: "hello", role: "student", ws: 5, appVersion: "v0", ua: "x" }));
  const tile = ctx.lab.snapshot()[4]!;
  assert.equal(tile.battery, 0.4);
  assert.equal(tile.visibility, "hidden");
  assert.equal(tile.versionMismatch, true);
  assert.equal(tile.remoteAppVersion, "v0");
});

test("re-accepting an offer for a connected ws replaces the session", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 2);
  const first = ctx.lab.sessions.get(2)!;
  let repairs = 0;
  first.on("needsRepair", () => repairs++);
  await pair(ctx, 2);
  assert.notEqual(ctx.lab.sessions.get(2), first);
  assert.equal(first.state, "failed");
  assert.equal(repairs, 0, "replacement is silent");
  assert.equal(dc.readyState, "closed");
});

test("failed session lands in repairQueue with history", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 9);
  dc.close();
  assert.ok(ctx.lab.repairQueue().includes(9));
  const tile = ctx.lab.snapshot()[8]!;
  assert.equal(tile.state, "failed");
  assert.deepEqual(tile.history.map((h) => h.state).slice(-2), ["connected", "failed"]);
});

test("settings update persists and is applied to new sessions", async () => {
  const ctx = make();
  ctx.lab.updateSettings({ heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 });
  assert.equal(JSON.parse(ctx.kv.get(TEACHER_KEY)!).settings.heartbeatMs, 1000);
  const { dc } = await pair(ctx, 1);
  ctx.clock.advance(1000);
  assert.equal((dc.sentJson().at(-1) as { t: string }).t, "hb");
  ctx.clock.advance(2000);
  assert.equal(ctx.lab.snapshot()[0]?.state, "degraded");
});

test("sendCmd routes to the right session and sets labels", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 4);
  ctx.lab.sendCmd(4, "ping");
  assert.deepEqual(dc.sentJson().at(-1), { t: "cmd", cmd: "ping" });
  ctx.lab.setLabel(4, "Row 1 seat 4");
  assert.equal(ctx.lab.snapshot()[3]?.label, "Row 1 seat 4");
  ctx.lab.sendCmd(29, "ping"); // no session: no throw
});

test("acceptOffer twice back-to-back before gathering completes: first settles, second resolves for ws 2", async () => {
  const ctx = make();
  const p1 = ctx.lab.acceptOffer(offer(2));
  const p2 = ctx.lab.acceptOffer(offer(2));
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
  assert.equal(answer.ws, 2);
});

test("setLabel rejects an over-long label without mutating the roster", () => {
  const ctx = make();
  const ok = ctx.lab.setLabel(4, "x".repeat(65));
  assert.equal(ok, false);
  assert.equal(ctx.lab.snapshot()[3]?.label, undefined);
});

test("updateSettings rejects an invalid patch without mutating settings", () => {
  const ctx = make();
  const before = ctx.lab.settings;
  const ok = ctx.lab.updateSettings({ heartbeatMs: 100 });
  assert.equal(ok, false);
  assert.deepEqual(ctx.lab.settings, before);
});

test("persist never throws even if the KeyValueStore.set throws", () => {
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
  const ok = lab.setLabel(4, "Row 1 seat 4");
  assert.equal(ok, true);
  assert.equal(lab.snapshot()[3]?.label, "Row 1 seat 4");
});

test("pairCount counts pairings, not ICE recoveries", async () => {
  const ctx = make();
  await pair(ctx, 1);
  const pc = ctx.rtc.last();
  pc.setIce("disconnected");
  pc.setIce("connected");
  assert.equal(ctx.lab.snapshot()[0]?.state, "connected");
  const saved = JSON.parse(ctx.kv.get(TEACHER_KEY)!) as {
    roster: Record<string, { pairCount: number }>;
  };
  assert.equal(saved.roster["1"]?.pairCount, 1);
});

test("history is capped at 50 entries; snapshot() returns a fresh copy each time", async () => {
  const ctx = make();
  await pair(ctx, 1);
  const pc = ctx.rtc.last();
  for (let i = 0; i < 30; i++) {
    pc.setIce("disconnected");
    pc.setIce("connected");
  }
  const tile = ctx.lab.snapshot()[0]!;
  assert.equal(tile.history.length, 50);
  const a = ctx.lab.snapshot()[0]!.history;
  const b = ctx.lab.snapshot()[0]!.history;
  assert.notEqual(a, b);
});

test("counts", async () => {
  const ctx = make();
  await pair(ctx, 1);
  const c = ctx.lab.counts();
  assert.deepEqual(c, { connected: 1, degraded: 0, failed: 0, never: 29 });
});
