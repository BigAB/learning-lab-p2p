import { test } from "node:test";
import assert from "node:assert/strict";
import { Heartbeat } from "../../../src/core/heartbeat";
import type { HbAckMessage, HbMessage } from "../../../src/schemas/protocol";
import { FakeClock } from "../helpers/fakeClock";

function make() {
  const clock = new FakeClock();
  const sent: (HbMessage | HbAckMessage)[] = [];
  const ev: string[] = [];
  const rtts: number[] = [];
  const hb = new Heartbeat({
    clock,
    intervalMs: 5000,
    missMs: 15000,
    send: (m) => sent.push(m),
    onMiss: () => ev.push("miss"),
    onRecover: () => ev.push("recover"),
    onRtt: (ms) => rtts.push(ms),
  });
  return { clock, sent, ev, rtts, hb };
}

test("sends hb every interval with increasing seq", () => {
  const { clock, sent, hb } = make();
  hb.start();
  clock.advance(15000);
  assert.deepEqual(
    sent.map((m) => m.t),
    ["hb", "hb", "hb"],
  );
  assert.deepEqual(
    sent.map((m) => m.seq),
    [0, 1, 2],
  );
});

test("replies to hb with hb-ack echoing seq/ts", () => {
  const { sent, hb } = make();
  hb.start();
  hb.handle({ t: "hb", seq: 9, ts: 123 });
  assert.deepEqual(sent, [{ t: "hb-ack", seq: 9, ts: 123 }]);
});

test("hb-ack yields rtt", () => {
  const { clock, rtts, hb } = make();
  hb.start();
  clock.advance(5000);
  clock.advance(40);
  hb.handle({ t: "hb-ack", seq: 0, ts: 5000 });
  assert.deepEqual(rtts, [40]);
});

test("silence past missMs → miss once; any inbound → recover", () => {
  const { clock, ev, hb } = make();
  hb.start();
  clock.advance(20000);
  assert.deepEqual(ev, ["miss"]);
  clock.advance(20000);
  assert.deepEqual(ev, ["miss"]);
  hb.handle({ t: "hb", seq: 0, ts: 0 });
  assert.deepEqual(ev, ["miss", "recover"]);
  assert.equal(hb.missed, false);
});

test("stop halts sending", () => {
  const { clock, sent, hb } = make();
  hb.start();
  clock.advance(5000);
  hb.stop();
  clock.advance(50000);
  assert.equal(sent.length, 1);
});
