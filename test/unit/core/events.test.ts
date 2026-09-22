import { test } from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../../../src/core/events";

type Ev = { ping: [number]; multi: [string, boolean] };
class T extends Emitter<Ev> {
  /** Keep the default console.error out of the test output; the reporting test overrides again. */
  protected override onListenerError(_name: string, _err: unknown): void {}
  fire(n: number) {
    this.emit("ping", n);
  }
  fireMulti() {
    this.emit("multi", "a", true);
  }
}

test("on receives emitted args", () => {
  const t = new T();
  const got: number[] = [];
  t.on("ping", (n) => got.push(n));
  t.fire(1);
  t.fire(2);
  assert.deepEqual(got, [1, 2]);
});

test("unsubscribe stops delivery", () => {
  const t = new T();
  const got: number[] = [];
  const off = t.on("ping", (n) => got.push(n));
  t.fire(1);
  off();
  t.fire(2);
  assert.deepEqual(got, [1]);
});

test("multiple args and listeners", () => {
  const t = new T();
  const got: unknown[] = [];
  t.on("multi", (s, b) => got.push(s, b));
  t.on("multi", () => got.push("second"));
  t.fireMulti();
  assert.deepEqual(got, ["a", true, "second"]);
});

test("listener removed during emit does not break iteration", () => {
  const t = new T();
  let calls = 0;
  const off = t.on("ping", () => {
    calls++;
    off();
  });
  t.on("ping", () => calls++);
  t.fire(1);
  assert.equal(calls, 2);
});

test("a throwing listener is isolated: remaining listeners run, emit() does not throw", () => {
  const t = new T();
  const boom = new Error("boom");
  let secondRan = false;
  t.on("ping", () => {
    throw boom;
  });
  t.on("ping", () => {
    secondRan = true;
  });
  assert.doesNotThrow(() => t.fire(1));
  assert.equal(secondRan, true);
});

test("a listener error is reported through onListenerError with the event name", () => {
  const seen: [string, unknown][] = [];
  class R extends T {
    protected override onListenerError(name: string, err: unknown): void {
      seen.push([name, err]);
    }
  }
  const r = new R();
  const boom = new Error("boom");
  r.on("ping", () => {
    throw boom;
  });
  r.on("ping", () => {
    throw new Error("second");
  });
  r.fire(1);
  assert.equal(seen.length, 2, "every throwing listener is reported, not just the first");
  assert.deepEqual(seen[0], ["ping", boom]);
});
