import { test } from "node:test";
import assert from "node:assert/strict";
import { LabMessageSchema, MAX_FRAME_BYTES } from "../../../src/schemas/protocol";

test("accepts every phase-1 message", () => {
  const ok = [
    { t: "hello", role: "student", ws: 7, appVersion: "abc1234", ua: "Safari" },
    { t: "hb", seq: 1, ts: 1700000000000 },
    { t: "hb-ack", seq: 1, ts: 1700000000000 },
    { t: "status", visibility: "visible", wakeLock: true },
    { t: "status", battery: 0.5, charging: false, visibility: "hidden", wakeLock: false },
    { t: "cmd", cmd: "reload" },
    { t: "chunk", id: "abc", i: 0, n: 2, data: "xx" },
  ];
  for (const m of ok) assert.equal(LabMessageSchema.safeParse(m).success, true, JSON.stringify(m));
});

test("rejects unknown t, bad ws, bad cmd, out-of-range battery", () => {
  const bad = [
    { t: "nope" },
    { t: "hello", role: "student", ws: 31, appVersion: "x", ua: "y" },
    { t: "cmd", cmd: "format-disk" },
    { t: "status", battery: 1.5, visibility: "visible", wakeLock: true },
    { t: "chunk", id: "abc", i: -1, n: 2, data: "xx" },
    "not an object",
  ];
  for (const m of bad)
    assert.equal(LabMessageSchema.safeParse(m).success, false, JSON.stringify(m));
});

test("frame limit is Safari's 16 KiB", () => {
  assert.equal(MAX_FRAME_BYTES, 16384);
});
