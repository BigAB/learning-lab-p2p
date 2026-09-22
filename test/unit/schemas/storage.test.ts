import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StudentStateSchema,
  TeacherStateSchema,
  STUDENT_KEY,
  TEACHER_KEY,
} from "../../../src/schemas/storage";

test("student state defaults pairCount", () => {
  const s = StudentStateSchema.parse({ ws: "3" });
  assert.equal(s.pairCount, 0);
});

test("teacher state fills roster and settings defaults", () => {
  const t = TeacherStateSchema.parse({});
  assert.deepEqual(t.roster, {});
  assert.equal(t.settings.heartbeatMs, 5000);
  assert.equal(t.settings.degradedMs, 15000);
  assert.equal(t.settings.failedMs, 60000);
});

test("keys are versioned", () => {
  assert.equal(STUDENT_KEY, "lab.student.v2");
  assert.equal(TEACHER_KEY, "lab.teacher.v2");
});

test("rejects an illegal ws", () => {
  assert.equal(StudentStateSchema.safeParse({ ws: "" }).success, false);
  assert.equal(StudentStateSchema.safeParse({ ws: 7 }).success, false);
  assert.equal(StudentStateSchema.parse({ ws: " Row 2 " }).ws, "Row 2");
});

test("roster entry accepts lastSeenAt and leaves it undefined for old blobs", () => {
  const t = TeacherStateSchema.parse({
    roster: { "1": { ws: "1", pairCount: 1, lastSeenAt: 42 } },
  });
  assert.equal(t.roster["1"]?.lastSeenAt, 42);
  const old = TeacherStateSchema.parse({ roster: { "2": { ws: "2", pairCount: 1 } } });
  assert.equal(old.roster["2"]?.lastSeenAt, undefined);
});

test("roster entries carry a display ws and must sit under their own wsKey", () => {
  const ok = TeacherStateSchema.safeParse({ roster: { "row 2": { ws: "Row 2", pairCount: 1 } } });
  assert.equal(ok.success, true);
  const mismatch = TeacherStateSchema.safeParse({ roster: { "7": { ws: "Row 2", pairCount: 1 } } });
  assert.equal(mismatch.success, false, "key must equal wsKey(entry.ws)");
  const missing = TeacherStateSchema.safeParse({ roster: { "7": { pairCount: 1 } } });
  assert.equal(missing.success, false, "ws is required on every entry");
});
