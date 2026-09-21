import { test } from "node:test";
import assert from "node:assert/strict";
import { StudentController } from "../../../src/core/studentController";
import { extractPayload } from "../../../src/core/sdpCodec";
import { STUDENT_KEY } from "../../../src/schemas/storage";
import { FakeClock } from "../helpers/fakeClock";
import { FakeDevice, FakeWakeLock } from "../helpers/fakeDevice";
import { MemoryKv } from "../helpers/memoryKv";
import { FakeRtcFactory, LINK_LOCAL_ONLY_OFFER, SAFARI_ANSWER, flush } from "../helpers/fakeRtc";

const answer = extractPayload(SAFARI_ANSWER, "answer", 7);

function make(ws = 7, offerSdp?: string) {
  const rtc = new FakeRtcFactory(offerSdp);
  const clock = new FakeClock();
  const kv = new MemoryKv();
  const device = new FakeDevice();
  const wakeLock = new FakeWakeLock();
  let reloads = 0;
  const c = new StudentController(
    {
      rtc,
      clock,
      kv,
      device,
      wakeLock,
      reload: () => reloads++,
      appVersion: "v1",
      ua: "ipad",
      restartDelayMs: 500,
    },
    ws,
  );
  return { rtc, clock, kv, device, wakeLock, c, reloads: () => reloads };
}

async function bringUp(ctx: ReturnType<typeof make>) {
  ctx.c.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await flush();
  await ctx.c.session!.applyRemote(answer);
  const dc = ctx.rtc.last().channels[0]!;
  dc.open();
  await flush();
  return dc;
}

test("persists ws and exposes it for conflict prompts", () => {
  const { kv } = make(7);
  assert.equal(StudentController.persistedWs(kv), 7);
  assert.equal(StudentController.persistedWs(new MemoryKv()), undefined);
});

test("start spawns a session, requests wake lock, emits session", async () => {
  const ctx = make();
  const sessions: unknown[] = [];
  ctx.c.on("session", (s) => sessions.push(s));
  ctx.c.start();
  await flush();
  assert.equal(sessions.length, 1);
  assert.equal(ctx.wakeLock.requests, 1);
  assert.equal(ctx.c.session?.state, "gathering");
});

test("connected → pairCount++, lastConnectedAt saved, status sent", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  const saved = JSON.parse(ctx.kv.get(STUDENT_KEY)!) as {
    pairCount: number;
    lastConnectedAt?: number;
  };
  assert.equal(saved.pairCount, 1);
  assert.equal(typeof saved.lastConnectedAt, "number");
  const status = dc.sentJson().find((m) => (m as { t: string }).t === "status") as Record<
    string,
    unknown
  >;
  assert.deepEqual(status, {
    t: "status",
    battery: 0.8,
    charging: true,
    visibility: "visible",
    wakeLock: true,
  });
});

test("hello from teacher records teacherAppVersion", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  dc.receive(JSON.stringify({ t: "hello", role: "teacher", ws: 7, appVersion: "v2", ua: "mac" }));
  assert.equal(ctx.c.state.teacherAppVersion, "v2");
});

test("failed session → new session after restartDelayMs with a fresh pc", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  const first = ctx.c.session;
  dc.close();
  assert.equal(first?.state, "failed");
  assert.equal(ctx.rtc.pcs.length, 1);
  ctx.clock.advance(500);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 2);
  assert.notEqual(ctx.c.session, first);
  assert.equal(ctx.c.session?.state, "gathering");
});

test("cmd reload → env.reload; cmd ping → status resent; cmd show-id → emitted", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  const cmds: string[] = [];
  ctx.c.on("cmd", (c) => cmds.push(c));
  const before = dc.sent.length;
  dc.receive(JSON.stringify({ t: "cmd", cmd: "ping" }));
  await flush();
  assert.equal(dc.sent.length, before + 1);
  dc.receive(JSON.stringify({ t: "cmd", cmd: "show-id" }));
  dc.receive(JSON.stringify({ t: "cmd", cmd: "reload" }));
  assert.equal(ctx.reloads(), 1);
  assert.deepEqual(cmds, ["ping", "show-id", "reload"]);
});

test("visibility change re-requests wake lock and pushes status", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  const before = dc.sent.length;
  ctx.device.setVisibility("hidden");
  await flush();
  ctx.device.setVisibility("visible");
  await flush();
  assert.equal(ctx.wakeLock.requests, 2);
  assert.ok(dc.sent.length >= before + 2);
  const last = dc.sentJson().at(-1) as { visibility: string };
  assert.equal(last.visibility, "visible");
});

test("stop closes the session and does not respawn", async () => {
  const ctx = make();
  await bringUp(ctx);
  ctx.c.stop();
  assert.equal(ctx.c.session, null);
  ctx.clock.advance(5000);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 1);
});

test("start() is idempotent while a session is live", async () => {
  const ctx = make();
  const sessions: unknown[] = [];
  ctx.c.on("session", (s) => sessions.push(s));
  ctx.c.start();
  ctx.c.start();
  await flush();
  assert.equal(sessions.length, 1);
  assert.equal(ctx.wakeLock.requests, 1);
  assert.equal(ctx.rtc.pcs.length, 1);
});

test("pairCount counts pairings, not ICE recoveries", async () => {
  const ctx = make();
  await bringUp(ctx);
  const pc = ctx.rtc.last();
  pc.setIce("disconnected");
  pc.setIce("connected");
  assert.equal(ctx.c.session?.state, "connected");
  const saved = JSON.parse(ctx.kv.get(STUDENT_KEY)!) as { pairCount: number };
  assert.equal(saved.pairCount, 1);
});

test("persist never throws even if the KeyValueStore.set throws", async () => {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const device = new FakeDevice();
  const wakeLock = new FakeWakeLock();
  const c = new StudentController(
    {
      rtc,
      clock,
      device,
      wakeLock,
      reload: () => {},
      appVersion: "v1",
      ua: "ipad",
      kv: {
        get: () => null,
        set: () => {
          throw new Error("quota exceeded");
        },
        remove: () => {},
      },
    },
    7,
  );
  assert.doesNotThrow(() => {
    c.start();
  });
  await flush();
  assert.equal(c.session?.state, "gathering");
});

/** Drive one spawn attempt whose offer has no usable candidate, to its rejection. */
async function failOneSpawn(ctx: ReturnType<typeof make>) {
  ctx.rtc.last().completeGathering();
  await flush();
}

test("start() rejection: session dropped, error emitted, respawn backs off exponentially", async () => {
  const ctx = make(7, LINK_LOCAL_ONLY_OFFER);
  const errors: string[] = [];
  ctx.c.on("error", (m) => errors.push(m));
  ctx.c.start();
  await flush();
  await failOneSpawn(ctx);

  assert.equal(ctx.c.session, null, "the dead session must not stay current");
  assert.equal(ctx.rtc.pcs.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /sdp/i);

  ctx.clock.advance(499);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 1, "no respawn before restartDelayMs");
  ctx.clock.advance(1);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 2, "respawned after restartDelayMs");

  await failOneSpawn(ctx);
  assert.equal(errors.length, 2);
  ctx.clock.advance(999);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 2, "second failure waits twice as long");
  ctx.clock.advance(1);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 3);
});

test("stop() cancels a respawn pending after a failed start()", async () => {
  const ctx = make(7, LINK_LOCAL_ONLY_OFFER);
  ctx.c.start();
  await flush();
  await failOneSpawn(ctx);
  assert.equal(ctx.rtc.pcs.length, 1);
  ctx.c.stop();
  ctx.clock.advance(60_000);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 1);
});

test("a session that connects resets the respawn backoff", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  dc.close();
  ctx.clock.advance(500);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 2, "backoff starts again at restartDelayMs after a pairing");
});

test("stop() then start() restarts the respawn backoff from restartDelayMs", async () => {
  const ctx = make(7, LINK_LOCAL_ONLY_OFFER);
  ctx.c.start();
  await flush();
  await failOneSpawn(ctx); // attempt 1: a respawn is now pending at 500 ms
  ctx.c.stop();
  ctx.c.start(); // a fresh start is a fresh run, not a continuation of the failed one
  await flush();
  assert.equal(ctx.rtc.pcs.length, 2, "start() spawns immediately");
  await failOneSpawn(ctx);
  ctx.clock.advance(500);
  await flush();
  assert.equal(ctx.rtc.pcs.length, 3, "first failure after a restart waits restartDelayMs, not 2×");
});
