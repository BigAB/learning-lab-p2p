import { test } from "node:test";
import assert from "node:assert/strict";
import { WsSchema, compareWs, wsKey } from "../../../src/schemas/ws";

test("WsSchema tidies legal IDs into their display form", () => {
  assert.equal(WsSchema.parse("  Row   2 "), "Row 2");
  assert.equal(WsSchema.parse("Seat_3-B"), "Seat_3-B");
  assert.equal(WsSchema.parse("7"), "7");
  assert.equal(WsSchema.parse("x".repeat(24)), "x".repeat(24));
});

test("WsSchema rejects empty, whitespace-only, over-long and off-charset IDs", () => {
  for (const bad of ["", "   ", "x".repeat(25), "Row#2", "Röw 2", "row.2", "a\u0000b"]) {
    assert.equal(WsSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.equal(WsSchema.safeParse(42).success, false, "numbers are not IDs any more");
});

test("WsSchema issue messages are user-facing", () => {
  const r = WsSchema.safeParse("Row#2");
  assert.equal(r.success, false);
  if (!r.success) assert.match(r.error.issues[0]!.message, /Letters, digits/);
});

test("wsKey folds case and nothing else", () => {
  assert.equal(wsKey("Row 2"), wsKey("ROW 2"));
  assert.notEqual(wsKey("Row 2"), wsKey("Row2"));
});

test("compareWs sorts naturally and case-insensitively", () => {
  const sorted = ["Row 10", "row 2", "10", "2", "1", "b", "A"].sort(compareWs);
  assert.deepEqual(sorted, ["1", "2", "10", "A", "b", "row 2", "Row 10"]);
});
