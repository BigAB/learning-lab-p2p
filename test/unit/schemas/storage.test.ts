import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StudentStateSchema,
  TeacherStateSchema,
  STUDENT_KEY,
  TEACHER_KEY,
} from "../../../src/schemas/storage";

test("student state defaults pairCount", () => {
  const s = StudentStateSchema.parse({ ws: 3 });
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
  assert.equal(STUDENT_KEY, "lab.student.v1");
  assert.equal(TEACHER_KEY, "lab.teacher.v1");
});

test("rejects ws out of range", () => {
  assert.equal(StudentStateSchema.safeParse({ ws: 0 }).success, false);
});
