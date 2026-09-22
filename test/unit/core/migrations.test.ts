import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateStudentV1, migrateTeacherV1 } from "../../../src/core/migrations";
import { LEGACY_STUDENT_KEY, LEGACY_TEACHER_KEY } from "../../../src/schemas/legacy";
import { MemoryKv } from "../helpers/memoryKv";

const quiet = () => {};

test("student v1 → v2: ws becomes a string, counters kept, v1 left for the caller to remove", () => {
  const kv = new MemoryKv();
  kv.set(LEGACY_STUDENT_KEY, JSON.stringify({ ws: 7, pairCount: 3, teacherAppVersion: "abc" }));
  assert.deepEqual(migrateStudentV1(kv, quiet), {
    ws: "7",
    pairCount: 3,
    teacherAppVersion: "abc",
  });
  assert.notEqual(kv.get(LEGACY_STUDENT_KEY), null);
});

test("teacher v1 → v2: roster keyed by wsKey with a display ws, labels kept, settings copied", () => {
  const kv = new MemoryKv();
  kv.set(
    LEGACY_TEACHER_KEY,
    JSON.stringify({
      roster: { "7": { label: "Row 1 seat 7", pairCount: 2, lastFingerprint: "AA:BB" } },
      settings: { heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 },
    }),
  );
  const v2 = migrateTeacherV1(kv, quiet)!;
  assert.deepEqual(v2.roster, {
    "7": { ws: "7", label: "Row 1 seat 7", pairCount: 2, lastFingerprint: "AA:BB" },
  });
  assert.equal(v2.settings.heartbeatMs, 1000);
  assert.equal(v2.settings.failedMs, 3000);
});

test("unparseable v1 → undefined plus one log line; absent v1 → undefined, silent", () => {
  const kv = new MemoryKv();
  const logs: string[] = [];
  assert.equal(
    migrateStudentV1(kv, (m) => logs.push(m)),
    undefined,
  );
  assert.equal(logs.length, 0);
  kv.set(LEGACY_STUDENT_KEY, "{nope");
  assert.equal(
    migrateStudentV1(kv, (m) => logs.push(m)),
    undefined,
  );
  kv.set(LEGACY_TEACHER_KEY, JSON.stringify({ roster: { "7": { pairCount: "many" } } }));
  assert.equal(
    migrateTeacherV1(kv, (m) => logs.push(m)),
    undefined,
  );
  assert.equal(logs.length, 2);
});
