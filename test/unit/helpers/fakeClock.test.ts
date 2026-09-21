import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "./fakeClock";

test("timeouts fire in order at the right time", () => {
  const c = new FakeClock();
  const log: string[] = [];
  c.setTimeout(() => log.push("b"), 20);
  c.setTimeout(() => log.push("a"), 10);
  c.advance(15);
  assert.deepEqual(log, ["a"]);
  assert.equal(c.now(), 15);
  c.advance(10);
  assert.deepEqual(log, ["a", "b"]);
});

test("intervals repeat and can be cleared", () => {
  const c = new FakeClock();
  let n = 0;
  const h = c.setInterval(() => n++, 10);
  c.advance(35);
  assert.equal(n, 3);
  c.clearInterval(h);
  c.advance(50);
  assert.equal(n, 3);
});

test("timer scheduled from within a callback runs in the same advance", () => {
  const c = new FakeClock();
  const log: number[] = [];
  c.setTimeout(() => {
    log.push(c.now());
    c.setTimeout(() => log.push(c.now()), 5);
  }, 10);
  c.advance(20);
  assert.deepEqual(log, [10, 15]);
});
