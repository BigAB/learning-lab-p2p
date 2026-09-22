# Variable Workstation IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `ws ∈ 1..30` workstation number with a student-typed string ID, make the teacher's roster dynamic (grows on pairing, shrinks on remove), and make a repeated ID take over the earlier session.

**Architecture:** `ws` keeps its name everywhere but becomes a string validated by `WsSchema`; `wsKey()` (lowercase) is the identity used for every map key and equality check, while the parsed string is the display form. The QR wire bumps to `LAB2:` / `v: 2`; both storage blobs bump to `.v2` with a one-shot migration from `.v1`. `LabController` drops its 30-slot roster for a roster keyed by `wsKey`, gains `remove()` / `acknowledgeReplaced()` and a `replaced` flag; the student page gains a typed ID entry that also serves as a "change my ID" screen.

**Tech Stack:** Vite · React 19 · TypeScript strict · Zod 3 · `node:test` + `tsx` · Playwright (Chromium + WebKit).

**Spec:** `docs/superpowers/specs/2026-09-21-variable-workstation-ids-design.md` (amends `docs/superpowers/specs/2026-09-20-p2p-core-design.md`).

## Global Constraints

- ID: 1–24 chars after trim + whitespace-collapse, charset `/^[A-Za-z0-9 _-]+$/`; identity is `ws.toLowerCase()`.
- Wire prefix `LAB2:`, compact `v: 2`; a `LAB1:` code fails with `this is a LAB1 code — the other device is running an older version`; other prefixes fail with `not a LAB2 payload`.
- Storage keys `lab.student.v2`, `lab.teacher.v2`; v1 migrated then removed; v2 present ⇒ v1 ignored and removed.
- `src/core/**` and `src/schemas/**` stay framework-free (ESLint enforces). Legacy v1 schemas live in `src/schemas/legacy.ts` and are imported only by `src/core/migrations.ts` (schemas) and the two controllers (key constants).
- Every `src/core/**` change ships with a unit test in the same commit. Conventional Commits. Run `pnpm exec prettier --write <files>` before every commit.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Typecheck window:** `pnpm typecheck` and the full `pnpm test` are expected RED from Task 1 until Task 6 finishes (the `number → string` ripple), and `pnpm typecheck` stays red until Task 8. Each task in that window runs only its own test files and states so. From Task 8 on, `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` must all be green before committing.
- Work on branch `feat/variable-workstation-ids` from `main`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/schemas/ws.ts` (rewrite) | `WsSchema` (string, tidy transform), `wsKey`, `compareWs`, `WS_MAX_LEN` |
| `src/schemas/sdpPayload.ts` (modify) | `v: 2`, `ws`/`w` as `WsSchema` |
| `src/schemas/protocol.ts` (unchanged code) | already imports `WsSchema`; `hello.ws` becomes string by inference |
| `src/schemas/storage.ts` (modify) | `.v2` keys; roster entry gains `ws`; roster `superRefine` key ↔ `ws` |
| `src/schemas/legacy.ts` (new) | v1 keys + v1 schemas, used only by migration |
| `src/core/store.ts` (modify) | `loadState` gains optional `migrate` hook |
| `src/core/migrations.ts` (new) | `migrateStudentV1`, `migrateTeacherV1` |
| `src/core/sdpCodec.ts` (modify) | `LAB2:` prefix, legacy rejection, `v: 2`, string `ws` |
| `src/core/peerSession.ts` (modify) | string `ws`; answer mismatch compares `wsKey` |
| `src/core/studentController.ts` (modify) | string `ws`; migration on boot; `persistedWs` reads v2 then v1 |
| `src/core/labController.ts` (rewrite) | roster keyed by `wsKey`; `replaced`; `remove`; `acknowledgeReplaced`; sorted `snapshot`/`repairQueue` |
| `src/boot/bootStudent.ts` (modify) | `resolveWs` via `WsSchema`; cache by `wsKey`; `releaseStudent`; `LAB2:` |
| `src/main.tsx` (modify) | `StudentRoute` with string ws, `WsEntry`, change-ID flow |
| `src/ui/student/WsEntry.tsx` (new, replaces `WsPicker.tsx`) | typed ID entry with inline validation |
| `src/ui/student/WsConflict.tsx` (modify) | string props |
| `src/ui/student/StudentApp.tsx` (modify) | "change" button in bar → `WsEntry` |
| `src/ui/shared/QrView.tsx` (modify) | `ws: string` |
| `src/ui/teacher/{Tile,TileDrawer,TeacherApp,RepairQueue,ScanModal}.tsx` (modify) | key-based tiles, `↺ replaced` badge, Remove button, empty hint |
| `src/ui/dev/LoadPage.tsx` (modify) | string IDs, `LAB2:` |
| `src/ui/shared/styles.css` (modify) | auto-fill grid, `.ws-entry`, `.badge`, `.bar .change` |
| `test/unit/schemas/ws.test.ts` (new), `test/unit/core/migrations.test.ts` (new) | new unit suites |
| `test/e2e/roster.spec.ts` (new) | takeover, remove, migration |
| `test/e2e/helpers.ts`, all other specs (modify) | string IDs, `LAB2:`, key-based `data-tile` |
| `AGENTS.md`, `README.md`, `docs/lab-checklist.md` (modify) | wording for string IDs and dynamic roster |

---

### Task 0: Branch

- [ ] **Step 1: Branch from main**

```bash
cd /Users/adambarrett/Projects/a-dec && git checkout main && git pull && git checkout -b feat/variable-workstation-ids
```

---

### Task 1: `WsSchema` becomes a string; payload/protocol schemas follow

**Files:**
- Rewrite: `src/schemas/ws.ts`
- Modify: `src/schemas/sdpPayload.ts`
- Create: `test/unit/schemas/ws.test.ts`
- Modify: `test/unit/schemas/sdpPayload.test.ts`, `test/unit/schemas/protocol.test.ts`

**Interfaces:**
- Produces: `WsSchema: ZodPipeline<string → string>` (output is the tidied display form), `type Ws = string`, `wsKey(ws: string): string`, `compareWs(a: string, b: string): number`, `WS_MAX_LEN = 24`. `WS_MIN`, `WS_MAX`, `WsParamSchema` are **deleted**.
- Produces: `SdpPayload.v === 2`, `SdpPayload.ws: string`, `CompactPayload.v === 2`, `CompactPayload.w: string`. `HelloMessage.ws: string` (by inference).

- [ ] **Step 1: Write the failing ws tests**

Create `test/unit/schemas/ws.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test test/unit/schemas/ws.test.ts`
Expected: FAIL — `wsKey`/`compareWs` are not exported; `WsSchema.parse("  Row   2 ")` throws (number schema).

- [ ] **Step 3: Rewrite `src/schemas/ws.ts`**

```ts
import { z } from "zod";

export const WS_MAX_LEN = 24;
/** Letters, digits, space, dash, underscore: typed on an iPad, read across a room, put in a QR. */
export const WS_CHARS = /^[A-Za-z0-9 _-]+$/;

/**
 * Workstation ID as typed on the iPad, tidied: trimmed, inner whitespace collapsed to one space.
 * The parsed value is the *display form*. Use wsKey() for equality and for map keys.
 */
export const WsSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Enter a workstation ID")
      .max(WS_MAX_LEN, `At most ${WS_MAX_LEN} characters`)
      .regex(WS_CHARS, "Letters, digits, spaces, - and _ only"),
  );
export type Ws = z.infer<typeof WsSchema>;

/** Two IDs name the same station iff their keys are equal: Row2 === row2 === ROW2. */
export function wsKey(ws: string): string {
  return ws.toLowerCase();
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** Natural, case-insensitive order for any list of stations: 1, 2, 10, Row 2, Row 10. */
export function compareWs(a: string, b: string): number {
  return collator.compare(a, b);
}
```

- [ ] **Step 4: Run the ws tests**

Run: `node --import tsx --test test/unit/schemas/ws.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Update `src/schemas/sdpPayload.ts`**

Change exactly these lines:

```ts
// SdpPayloadSchema
  v: z.literal(2),
  ...
  ws: WsSchema,
// CompactPayloadSchema
  v: z.literal(2),
  ...
  w: WsSchema,
```
(`ws`/`w` already reference `WsSchema`; only the two `v` literals change from `1` to `2`.)

- [ ] **Step 6: Port `test/unit/schemas/sdpPayload.test.ts`**

In `base`: `v: 2` and `ws: "7"`. In both compact objects: `v: 2`, `w: "7"`. Append:

```ts
test("v2 payload: ws is a tidied string; numbers and off-charset IDs are rejected", () => {
  assert.equal(SdpPayloadSchema.parse({ ...base, ws: " Row  2 " }).ws, "Row 2");
  assert.equal(SdpPayloadSchema.safeParse({ ...base, ws: 7 }).success, false);
  assert.equal(SdpPayloadSchema.safeParse({ ...base, ws: "Row#2" }).success, false);
  assert.equal(SdpPayloadSchema.safeParse({ ...base, v: 1 }).success, false, "v1 is gone");
});
```

- [ ] **Step 7: Port `test/unit/schemas/protocol.test.ts`**

In the `ok` list: `ws: "7"`. In the `bad` list replace the `ws: 31` entry with `{ t: "hello", role: "student", ws: "", appVersion: "x", ua: "y" }` and add `{ t: "hello", role: "student", ws: 7, appVersion: "x", ua: "y" }`.

- [ ] **Step 8: Run the three schema suites**

Run: `node --import tsx --test test/unit/schemas/ws.test.ts test/unit/schemas/sdpPayload.test.ts test/unit/schemas/protocol.test.ts`
Expected: all pass. (Full `pnpm test` is red now: codec/controller tests still use numbers. Expected until Task 6.)

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write src/schemas test/unit/schemas
git add src/schemas test/unit/schemas
git commit -m "feat(schemas): workstation ID is a tidied string; payload v2

WsSchema trims and collapses whitespace, caps at 24 chars, letters/digits/space/-/_.
wsKey() lowercases for identity; compareWs() gives natural order. SdpPayload and
compact payload move to v: 2. Full unit suite and typecheck are red until the
controllers are ported (plan Tasks 2-6).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Codec → `LAB2:` with a helpful LAB1 rejection

**Files:**
- Modify: `src/core/sdpCodec.ts`
- Modify: `test/unit/core/sdpCodec.test.ts`

**Interfaces:**
- Consumes: `WsSchema` string output (Task 1).
- Produces: `WIRE_PREFIX = "LAB2:"`, `LEGACY_WIRE_PREFIX = "LAB1:"`, `extractPayload(sdp: string, role: "offer" | "answer", ws: string): SdpPayload`. `encodeWire`/`decodeWire` signatures unchanged.

- [ ] **Step 1: Port existing codec tests and add the new ones**

In `test/unit/core/sdpCodec.test.ts` replace every `"offer", 7)` with `"offer", "7")` and every `"answer", 7)` with `"answer", "7")`; in the test `extracts ice/dtls...` change `assert.equal(p.ws, 7)` to `assert.equal(p.ws, "7")`; in `decodeWire rejects a non-base64url compact fingerprint...` change `v: 1` → `v: 2` and `w: 7` → `w: "7"`. Append:

```ts
test("a LAB1 code is refused with a version message, not a schema error", async () => {
  await assert.rejects(decodeWire("LAB1:abcd00"), {
    name: "CodecError",
    message: /this is a LAB1 code — the other device is running an older version/,
  });
  await assert.rejects(decodeWire("NOPE:abcd00"), { name: "CodecError", message: /not a LAB2 payload/ });
});

test("a 24-character ID survives the roundtrip and stays inside the QR budget", async () => {
  const id = "Back Row Left Seat 12345"; // exactly 24 characters
  assert.equal(id.length, 24);
  const wire = await encodeWire(extractPayload(chromeOffer, "offer", id));
  assert.ok(wire.startsWith("LAB2:"));
  assert.ok(wire.length < 300, `wire too long: ${wire.length}`);
  assert.equal((await decodeWire(wire)).ws, id);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/unit/core/sdpCodec.test.ts`
Expected: FAIL — `extractPayload(..., "7")` produces `v: 1` which the v2 schema rejects (`CodecError: sdp: Invalid literal value, expected 2`); LAB1 test gets `not a LAB1 payload`.

- [ ] **Step 3: Update `src/core/sdpCodec.ts`**

```ts
export const WIRE_PREFIX = "LAB2:";
/** Phase 1 wire prefix, recognised only so a mixed-version pair gets a useful error. */
export const LEGACY_WIRE_PREFIX = "LAB1:";
```
`extractPayload` signature: `ws: string`. Its `safeParse({ v: 1, ...})` → `{ v: 2, ...}`. In `toCompact` and `fromCompact`: `v: 2`. In `decodeWire` replace the first check with:

```ts
  if (wire.startsWith(LEGACY_WIRE_PREFIX)) {
    throw new CodecError("this is a LAB1 code — the other device is running an older version");
  }
  if (!wire.startsWith(WIRE_PREFIX)) throw new CodecError("not a LAB2 payload");
```

- [ ] **Step 4: Run the codec tests**

Run: `node --import tsx --test test/unit/core/sdpCodec.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/sdpCodec.ts test/unit/core/sdpCodec.test.ts
git add src/core/sdpCodec.ts test/unit/core/sdpCodec.test.ts
git commit -m "feat(codec): LAB2 wire with string workstation IDs; LAB1 codes get a version error

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Storage v2, legacy schemas, `loadState` migrate hook, migrations

**Files:**
- Modify: `src/schemas/storage.ts`
- Create: `src/schemas/legacy.ts`
- Modify: `src/core/store.ts`
- Create: `src/core/migrations.ts`
- Modify: `test/unit/schemas/storage.test.ts`, `test/unit/core/store.test.ts`
- Create: `test/unit/core/migrations.test.ts`

**Interfaces:**
- Produces: `STUDENT_KEY = "lab.student.v2"`, `TEACHER_KEY = "lab.teacher.v2"`; `RosterEntry` gains `ws: string`; `TeacherState.roster: Record<string, RosterEntry>` keyed by `wsKey`.
- Produces: `LEGACY_STUDENT_KEY = "lab.student.v1"`, `LEGACY_TEACHER_KEY = "lab.teacher.v1"`, `LegacyStudentStateSchema`, `LegacyTeacherStateSchema`.
- Produces: `loadState(kv, key, schema, fallback, log?, migrate?: () => z.infer<S> | undefined)`.
- Produces: `migrateStudentV1(kv: KeyValueStore, log: (m: string) => void): StudentState | undefined`, `migrateTeacherV1(kv, log): TeacherState | undefined`. Neither removes the v1 key; callers do.

- [ ] **Step 1: Write failing storage schema tests**

In `test/unit/schemas/storage.test.ts` change the `keys are versioned` test to expect `"lab.student.v2"` / `"lab.teacher.v2"`, change `rejects ws out of range` to:

```ts
test("rejects an illegal ws", () => {
  assert.equal(StudentStateSchema.safeParse({ ws: "" }).success, false);
  assert.equal(StudentStateSchema.safeParse({ ws: 7 }).success, false);
  assert.equal(StudentStateSchema.parse({ ws: " Row 2 " }).ws, "Row 2");
});
```
and append:

```ts
test("roster entries carry a display ws and must sit under their own wsKey", () => {
  const ok = TeacherStateSchema.safeParse({ roster: { "row 2": { ws: "Row 2", pairCount: 1 } } });
  assert.equal(ok.success, true);
  const mismatch = TeacherStateSchema.safeParse({ roster: { "7": { ws: "Row 2", pairCount: 1 } } });
  assert.equal(mismatch.success, false, "key must equal wsKey(entry.ws)");
  const missing = TeacherStateSchema.safeParse({ roster: { "7": { pairCount: 1 } } });
  assert.equal(missing.success, false, "ws is required on every entry");
});
```
The existing `roster entry accepts lastSeenAt...` test must add `ws: "1"` / `ws: "2"` to its entries.

- [ ] **Step 2: Write failing store tests**

Append to `test/unit/core/store.test.ts`:

```ts
test("migrate hook runs only when the key is missing; its result is validated and saved", () => {
  const kv = new MemoryKv();
  assert.deepEqual(
    loadState(kv, "k", S, fallback, undefined, () => ({ n: 9 })),
    { n: 9 },
  );
  assert.equal(kv.get("k"), JSON.stringify({ n: 9 }));
  let called = 0;
  loadState(kv, "k", S, fallback, undefined, () => {
    called++;
    return { n: 1 };
  });
  assert.equal(called, 0, "present key: no migration");
});

test("a migrate hook returning undefined or an invalid value falls back without writing", () => {
  const kv = new MemoryKv();
  assert.deepEqual(
    loadState(kv, "k", S, fallback, undefined, () => undefined),
    { n: 1 },
  );
  assert.equal(kv.get("k"), null);
  const logs: string[] = [];
  assert.deepEqual(
    loadState(
      kv,
      "k",
      S,
      fallback,
      (m) => logs.push(m),
      () => ({ n: "bad" }) as unknown as z.infer<typeof S>,
    ),
    { n: 1 },
  );
  assert.equal(kv.get("k"), null);
  assert.equal(logs.length, 1);
});
```

- [ ] **Step 3: Write failing migration tests**

Create `test/unit/core/migrations.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateStudentV1, migrateTeacherV1 } from "../../../src/core/migrations";
import { LEGACY_STUDENT_KEY, LEGACY_TEACHER_KEY } from "../../../src/schemas/legacy";
import { MemoryKv } from "../helpers/memoryKv";

const quiet = () => {};

test("student v1 → v2: ws becomes a string, counters kept, v1 left for the caller to remove", () => {
  const kv = new MemoryKv();
  kv.set(LEGACY_STUDENT_KEY, JSON.stringify({ ws: 7, pairCount: 3, teacherAppVersion: "abc" }));
  assert.deepEqual(migrateStudentV1(kv, quiet), { ws: "7", pairCount: 3, teacherAppVersion: "abc" });
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
  assert.equal(migrateStudentV1(kv, (m) => logs.push(m)), undefined);
  assert.equal(logs.length, 0);
  kv.set(LEGACY_STUDENT_KEY, "{nope");
  assert.equal(migrateStudentV1(kv, (m) => logs.push(m)), undefined);
  kv.set(LEGACY_TEACHER_KEY, JSON.stringify({ roster: { "7": { pairCount: "many" } } }));
  assert.equal(migrateTeacherV1(kv, (m) => logs.push(m)), undefined);
  assert.equal(logs.length, 2);
});
```

- [ ] **Step 4: Run all three to verify failure**

Run: `node --import tsx --test test/unit/schemas/storage.test.ts test/unit/core/store.test.ts test/unit/core/migrations.test.ts`
Expected: FAIL — `legacy`/`migrations` modules missing; keys still v1; roster entry accepts missing `ws`.

- [ ] **Step 5: Update `src/schemas/storage.ts`**

```ts
import { z } from "zod";
import { WsSchema, wsKey } from "./ws";

export const STUDENT_KEY = "lab.student.v2";
export const TEACHER_KEY = "lab.teacher.v2";

export const StudentStateSchema = z.object({
  ws: WsSchema,
  teacherAppVersion: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  pairCount: z.number().int().nonnegative().default(0),
});
export type StudentState = z.infer<typeof StudentStateSchema>;

export const RosterEntrySchema = z.object({
  /** Display form: the ID as the student most recently typed it. The record key is wsKey(ws). */
  ws: WsSchema,
  label: z.string().max(64).optional(),
  lastConnectedAt: z.number().optional(),
  /** Last inbound frame from this station (heartbeat or otherwise); coarse, see LabController. */
  lastSeenAt: z.number().optional(),
  lastRtt: z.number().optional(),
  lastSeenUa: z.string().max(512).optional(),
  lastFingerprint: z.string().max(128).optional(),
  pairCount: z.number().int().nonnegative().default(0),
});
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

export const SettingsSchema = z.object({
  heartbeatMs: z.number().int().min(200).default(5000),
  degradedMs: z.number().int().min(500).default(15000),
  failedMs: z.number().int().min(1000).default(60000),
  cameraDeviceId: z.string().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A roster whose key ≠ wsKey(entry.ws) is corrupt: the read path resets it like any bad blob. */
const RosterSchema = z.record(z.string(), RosterEntrySchema).superRefine((roster, ctx) => {
  for (const [key, entry] of Object.entries(roster)) {
    if (key !== wsKey(entry.ws)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `roster key "${key}" does not match ws "${entry.ws}"`,
        path: [key],
      });
    }
  }
});

export const TeacherStateSchema = z.object({
  roster: RosterSchema.default({}),
  settings: SettingsSchema.default({}),
});
export type TeacherState = z.infer<typeof TeacherStateSchema>;
```

- [ ] **Step 6: Create `src/schemas/legacy.ts`**

```ts
import { z } from "zod";
import { SettingsSchema } from "./storage";

/**
 * Phase 1 (v1) persisted shapes, kept only so a v2 boot can migrate them once. Nothing but
 * src/core/migrations.ts may import the schemas; controllers import the keys to remove them.
 */
export const LEGACY_STUDENT_KEY = "lab.student.v1";
export const LEGACY_TEACHER_KEY = "lab.teacher.v1";

export const LegacyStudentStateSchema = z.object({
  ws: z.number().int().min(1).max(30),
  teacherAppVersion: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  pairCount: z.number().int().nonnegative().default(0),
});

export const LegacyRosterEntrySchema = z.object({
  label: z.string().max(64).optional(),
  lastConnectedAt: z.number().optional(),
  lastSeenAt: z.number().optional(),
  lastRtt: z.number().optional(),
  lastSeenUa: z.string().max(512).optional(),
  lastFingerprint: z.string().max(128).optional(),
  pairCount: z.number().int().nonnegative().default(0),
});

export const LegacyTeacherStateSchema = z.object({
  roster: z.record(z.string(), LegacyRosterEntrySchema).default({}),
  settings: SettingsSchema.default({}),
});
```

- [ ] **Step 7: Update `src/core/store.ts`**

```ts
import type { z } from "zod";
import type { KeyValueStore } from "./ports";

/**
 * Read a persisted blob with defaults. `migrate` runs only when `key` is absent: it may produce a
 * value from an older key; that value is validated and saved under `key` like any other write.
 */
export function loadState<S extends z.ZodTypeAny>(
  kv: KeyValueStore,
  key: string,
  schema: S,
  fallback: z.infer<S>,
  log: (msg: string) => void = () => {},
  migrate?: () => z.infer<S> | undefined,
): z.infer<S> {
  const raw = kv.get(key);
  if (raw === null) {
    const migrated = migrate?.();
    if (migrated === undefined) return fallback;
    const r = schema.safeParse(migrated);
    if (r.success) {
      kv.set(key, JSON.stringify(r.data));
      return r.data as z.infer<S>;
    }
    log(`${key}: migrated value invalid, using defaults (${r.error.issues[0]?.message ?? "?"})`);
    return fallback;
  }
  try {
    const r = schema.safeParse(JSON.parse(raw));
    if (r.success) return r.data as z.infer<S>;
    log(`${key}: schema invalid, resetting (${r.error.issues[0]?.message ?? "?"})`);
  } catch (e) {
    log(`${key}: corrupt JSON, resetting (${(e as Error).message})`);
  }
  kv.set(key, JSON.stringify(fallback));
  return fallback;
}

export function saveState<S extends z.ZodTypeAny>(
  kv: KeyValueStore,
  key: string,
  schema: S,
  value: z.infer<S>,
): void {
  kv.set(key, JSON.stringify(schema.parse(value)));
}
```

- [ ] **Step 8: Create `src/core/migrations.ts`**

```ts
import {
  LEGACY_STUDENT_KEY,
  LEGACY_TEACHER_KEY,
  LegacyStudentStateSchema,
  LegacyTeacherStateSchema,
} from "../schemas/legacy";
import type { StudentState, TeacherState } from "../schemas/storage";
import { wsKey } from "../schemas/ws";
import type { KeyValueStore } from "./ports";

type Log = (msg: string) => void;

function readLegacy<T>(
  kv: KeyValueStore,
  key: string,
  parse: (json: unknown) => { success: true; data: T } | { success: false },
  log: Log,
): T | undefined {
  const raw = kv.get(key);
  if (raw === null) return undefined;
  try {
    const r = parse(JSON.parse(raw));
    if (r.success) return r.data;
    log(`${key}: v1 blob does not match the v1 schema, not migrating`);
  } catch {
    log(`${key}: v1 blob is not JSON, not migrating`);
  }
  return undefined;
}

/** v1 `{ ws: 7 }` → v2 `{ ws: "7" }`. Does not remove the v1 key; the caller does, always. */
export function migrateStudentV1(kv: KeyValueStore, log: Log): StudentState | undefined {
  const v1 = readLegacy(kv, LEGACY_STUDENT_KEY, (j) => LegacyStudentStateSchema.safeParse(j), log);
  if (!v1) return undefined;
  const { ws, ...rest } = v1;
  return { ...rest, ws: String(ws) };
}

/** v1 `roster["7"] = {…}` → v2 `roster["7"] = { ws: "7", … }`; settings copied. */
export function migrateTeacherV1(kv: KeyValueStore, log: Log): TeacherState | undefined {
  const v1 = readLegacy(kv, LEGACY_TEACHER_KEY, (j) => LegacyTeacherStateSchema.safeParse(j), log);
  if (!v1) return undefined;
  const roster: TeacherState["roster"] = {};
  for (const [k, entry] of Object.entries(v1.roster)) roster[wsKey(k)] = { ...entry, ws: k };
  return { roster, settings: v1.settings };
}
```

- [ ] **Step 9: Run the three suites**

Run: `node --import tsx --test test/unit/schemas/storage.test.ts test/unit/core/store.test.ts test/unit/core/migrations.test.ts`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write src/schemas src/core/store.ts src/core/migrations.ts test/unit/schemas/storage.test.ts test/unit/core/store.test.ts test/unit/core/migrations.test.ts
git add src/schemas src/core/store.ts src/core/migrations.ts test/unit/schemas/storage.test.ts test/unit/core/store.test.ts test/unit/core/migrations.test.ts
git commit -m "feat(storage): v2 keys with string ws, roster keyed by wsKey, one-shot v1 migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `PeerSession` with a string `ws`

**Files:**
- Modify: `src/core/peerSession.ts:32,59,104-105`
- Modify: `test/unit/core/peerSession.test.ts`

**Interfaces:**
- Produces: `PeerSessionOpts.ws: string`, `PeerSession.ws: string`. Answer for another station is rejected by `wsKey` comparison.

- [ ] **Step 1: Port the tests and add the case-insensitive one**

In `test/unit/core/peerSession.test.ts`: lines 15–16 `"offer", 7)` → `"offer", "7")`, `"answer", 7)` → `"answer", "7")`; every `ws: 7,` in `new PeerSession({…})` and in `hello` JSON → `ws: "7",`; `ws: 1,` (two places) → `ws: "1",`; line 73 `ws: number` → `ws: string`; line 76 `assert.equal(first.ws, 7)` → `"7"`; line 371 `"answer", 9)` → `"answer", "9")`. Append:

```ts
test("an answer whose ws differs only in case is for us", async () => {
  const ctx = student();
  const p = ctx.s.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  const shouted = extractPayload(SAFARI_ANSWER, "answer", "ROW 7");
  const s2 = new PeerSession({
    role: "student",
    ws: "row 7",
    rtc: ctx.rtc,
    clock: ctx.clock,
    timers: TIMERS,
    appVersion: "t1",
    ua: "test",
  });
  const p2 = s2.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p2;
  await s2.applyRemote(shouted);
  assert.equal(s2.state, "connecting");
  ctx.s.close();
  s2.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/unit/core/peerSession.test.ts`
Expected: FAIL — `extractPayload(..., "7")` is fine now, but the new test fails: `This code is for workstation ROW 7, not row 7`.

- [ ] **Step 3: Update `src/core/peerSession.ts`**

Add `import { wsKey } from "../schemas/ws";`. `PeerSessionOpts.ws: string;` and `readonly ws: string;`. Replace the mismatch check:

```ts
      if (wsKey(remote.ws) !== wsKey(this.ws))
        throw new Error(`This code is for workstation ${remote.ws}, not ${this.ws}`);
```

- [ ] **Step 4: Run**

Run: `node --import tsx --test test/unit/core/peerSession.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/peerSession.ts test/unit/core/peerSession.test.ts
git add src/core/peerSession.ts test/unit/core/peerSession.test.ts
git commit -m "feat(core): PeerSession carries a string ws; answer check is case-insensitive

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `StudentController` with a string `ws` and v1 migration

**Files:**
- Modify: `src/core/studentController.ts`
- Modify: `test/unit/core/studentController.test.ts`

**Interfaces:**
- Consumes: `migrateStudentV1`, `LEGACY_STUDENT_KEY`, `STUDENT_KEY`, `StudentStateSchema` (Task 3).
- Produces: `new StudentController(env, ws: string)`, `StudentController.ws: string`, `static persistedWs(kv): string | undefined` (reads v2, else derives from v1 without removing it).

- [ ] **Step 1: Port tests and add migration tests**

In `test/unit/core/studentController.test.ts`: `"answer", 7)` → `"answer", "7")`; `function make(ws = 7, …)` → `function make(ws = "7", …)`; `make(7)` / `make(7, …)` → `make("7")` / `make("7", …)`; `persistedWs(kv), 7)` → `persistedWs(kv), "7")`; hello JSON `ws: 7` → `ws: "7"`. Add `import { LEGACY_STUDENT_KEY } from "../../../src/schemas/legacy";` and append:

```ts
test("a v1 blob is migrated on first boot and removed; pairCount survives", () => {
  const kv = new MemoryKv();
  kv.set(LEGACY_STUDENT_KEY, JSON.stringify({ ws: 7, pairCount: 3 }));
  assert.equal(StudentController.persistedWs(kv), "7", "resolveWs sees the old station before boot");
  const ctx = make("7");
  void ctx;
  const c = new StudentController(
    {
      rtc: new FakeRtcFactory(),
      clock: new FakeClock(),
      kv,
      device: new FakeDevice(),
      wakeLock: new FakeWakeLock(),
      reload: () => {},
      appVersion: "v1",
      ua: "ipad",
    },
    "7",
  );
  assert.equal(c.state.pairCount, 3);
  assert.equal(JSON.parse(kv.get(STUDENT_KEY)!).ws, "7");
  assert.equal(kv.get(LEGACY_STUDENT_KEY), null);
});

test("when v2 exists, v1 is ignored and removed", () => {
  const kv = new MemoryKv();
  kv.set(STUDENT_KEY, JSON.stringify({ ws: "Row 2", pairCount: 1 }));
  kv.set(LEGACY_STUDENT_KEY, JSON.stringify({ ws: 7, pairCount: 9 }));
  assert.equal(StudentController.persistedWs(kv), "Row 2");
  const c = new StudentController(
    {
      rtc: new FakeRtcFactory(),
      clock: new FakeClock(),
      kv,
      device: new FakeDevice(),
      wakeLock: new FakeWakeLock(),
      reload: () => {},
      appVersion: "v1",
      ua: "ipad",
    },
    "Row 2",
  );
  assert.equal(c.state.pairCount, 1);
  assert.equal(kv.get(LEGACY_STUDENT_KEY), null);
});
```
(Remove the two stray lines `const ctx = make("7"); void ctx;` from the first new test — they are not needed. The `make()` helper must accept `ws: string`.)

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/unit/core/studentController.test.ts`
Expected: FAIL — `persistedWs` returns `undefined` for the v1 blob; v1 not removed; TS shape mismatches are not checked by tsx, so failures are behavioural.

- [ ] **Step 3: Update `src/core/studentController.ts`**

Imports: add `import { LEGACY_STUDENT_KEY } from "../schemas/legacy";` and `import { migrateStudentV1 } from "./migrations";`. Then:

```ts
  readonly ws: string;
  ...
  /** The saved station, v2 first, else what a v1 blob would migrate to. Removes nothing. */
  static persistedWs(kv: KeyValueStore): string | undefined {
    const raw = kv.get(STUDENT_KEY);
    if (raw !== null) {
      try {
        const r = StudentStateSchema.safeParse(JSON.parse(raw));
        return r.success ? r.data.ws : undefined;
      } catch {
        return undefined;
      }
    }
    return migrateStudentV1(kv, () => {})?.ws;
  }

  constructor(
    private readonly env: StudentEnv,
    ws: string,
  ) {
    super();
    this.ws = ws;
    const log = env.log ?? (() => {});
    const loaded = loadState(
      env.kv,
      STUDENT_KEY,
      StudentStateSchema,
      StudentStateSchema.parse({ ws }),
      log,
      () => migrateStudentV1(env.kv, log),
    );
    // v1 never outlives a v2 boot, whether it was migrated or shadowed by an existing v2 blob.
    env.kv.remove(LEGACY_STUDENT_KEY);
    this.state = { ...loaded, ws };
    this.persist();
  }
```

- [ ] **Step 4: Run**

Run: `node --import tsx --test test/unit/core/studentController.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/studentController.ts test/unit/core/studentController.test.ts
git add src/core/studentController.ts test/unit/core/studentController.test.ts
git commit -m "feat(student): string workstation ID; migrate lab.student.v1 on first boot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `LabController` — dynamic roster, takeover flag, remove

**Files:**
- Rewrite: `src/core/labController.ts`
- Rewrite: `test/unit/core/labController.test.ts`

**Interfaces:**
- Consumes: `compareWs`, `wsKey` (Task 1); `TEACHER_KEY`, `TeacherStateSchema`, `RosterEntrySchema` (Task 3); `migrateTeacherV1`, `LEGACY_TEACHER_KEY` (Task 3); `PeerSession` with string ws (Task 4).
- Produces:
  - `RosterView { key: string; ws: string; state: SessionState | "never"; replaced: boolean; … existing fields }`
  - `LabController.sessions: Map<string /*wsKey*/, PeerSession>`
  - `acceptOffer(offer: SdpPayload): Promise<SdpPayload>` (unchanged signature)
  - `remove(ws: string): boolean`
  - `acknowledgeReplaced(ws: string): void`
  - `setLabel(ws: string, label: string): boolean`, `sendCmd(ws: string, cmd)`
  - `snapshot(): RosterView[]` (roster entries only, natural order), `repairQueue(): string[]` (display forms), `counts()` unchanged.

- [ ] **Step 1: Rewrite the test file**

Replace `test/unit/core/labController.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LabController, SupersededError } from "../../../src/core/labController";
import { extractPayload } from "../../../src/core/sdpCodec";
import { LEGACY_TEACHER_KEY } from "../../../src/schemas/legacy";
import { TEACHER_KEY } from "../../../src/schemas/storage";
import { wsKey } from "../../../src/schemas/ws";
import { FakeClock } from "../helpers/fakeClock";
import { MemoryKv } from "../helpers/memoryKv";
import { CHROME_OFFER, FakeRtcFactory, flush } from "../helpers/fakeRtc";

const offer = (ws: string) => extractPayload(CHROME_OFFER, "offer", ws);

function make(kv = new MemoryKv()) {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const lab = new LabController({ rtc, clock, kv, appVersion: "v1", ua: "mac" });
  return { rtc, clock, kv, lab };
}

async function pair(ctx: ReturnType<typeof make>, ws: string) {
  const p = ctx.lab.acceptOffer(offer(ws));
  await flush();
  ctx.rtc.last().completeGathering();
  const answer = await p;
  const dc = ctx.rtc.last().incomingChannel();
  dc.open();
  return { answer, dc };
}

/** The tile for `ws`, whatever its current spelling. */
function tile(ctx: ReturnType<typeof make>, ws: string) {
  const t = ctx.lab.snapshot().find((v) => v.key === wsKey(ws));
  assert.ok(t, `no tile for ${ws}`);
  return t;
}

function saved(ctx: ReturnType<typeof make>) {
  return JSON.parse(ctx.kv.get(TEACHER_KEY)!) as {
    roster: Record<
      string,
      {
        ws: string;
        pairCount: number;
        lastSeenUa?: string;
        lastFingerprint?: string;
        lastSeenAt?: number;
        label?: string;
      }
    >;
    settings: { heartbeatMs: number };
  };
}

test("fresh lab: no tiles, empty repair queue, all counts zero", () => {
  const { lab } = make();
  assert.deepEqual(lab.snapshot(), []);
  assert.deepEqual(lab.repairQueue(), []);
  assert.deepEqual(lab.counts(), { connected: 0, degraded: 0, failed: 0, never: 0 });
});

test("acceptOffer creates the tile and resolves with an answer for the same ws", async () => {
  const ctx = make();
  const { answer } = await pair(ctx, "Row 7");
  assert.equal(answer.role, "answer");
  assert.equal(answer.ws, "Row 7");
  const t = tile(ctx, "row 7");
  assert.equal(t.ws, "Row 7");
  assert.equal(t.key, "row 7");
  assert.equal(t.state, "connected");
  assert.deepEqual(ctx.lab.repairQueue(), []);
});

test("snapshot and repairQueue are in natural, case-insensitive order", async () => {
  const ctx = make();
  for (const ws of ["Row 10", "2", "row 2", "10", "1"]) await pair(ctx, ws);
  assert.deepEqual(
    ctx.lab.snapshot().map((t) => t.ws),
    ["1", "2", "10", "row 2", "Row 10"],
  );
  ctx.rtc.pcs[1]!.channels.at(-1)!.close(); // "2" fails
  assert.deepEqual(ctx.lab.repairQueue(), ["2"]);
});

test("change event fires on state transitions and roster is persisted under wsKey", async () => {
  const ctx = make();
  let changes = 0;
  ctx.lab.on("change", () => changes++);
  const { dc } = await pair(ctx, "Row 3");
  assert.ok(changes >= 2);
  dc.receive(
    JSON.stringify({ t: "hello", role: "student", ws: "Row 3", appVersion: "v1", ua: "iPad Safari" }),
  );
  const e = saved(ctx).roster["row 3"]!;
  assert.equal(e.ws, "Row 3");
  assert.equal(e.pairCount, 1);
  assert.equal(e.lastSeenUa, "iPad Safari");
});

test("status messages populate the tile; version mismatch flagged", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "5");
  dc.receive(
    JSON.stringify({ t: "status", battery: 0.4, charging: false, visibility: "hidden", wakeLock: false }),
  );
  dc.receive(JSON.stringify({ t: "hello", role: "student", ws: "5", appVersion: "v0", ua: "x" }));
  const t = tile(ctx, "5");
  assert.equal(t.battery, 0.4);
  assert.equal(t.visibility, "hidden");
  assert.equal(t.versionMismatch, true);
  assert.equal(t.remoteAppVersion, "v0");
});

test("re-accepting an offer for a connected ws replaces the session silently and flags the tile", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "2");
  const first = ctx.lab.sessions.get("2")!;
  let repairs = 0;
  first.on("needsRepair", () => repairs++);
  await pair(ctx, "2");
  assert.notEqual(ctx.lab.sessions.get("2"), first);
  assert.equal(first.state, "failed");
  assert.equal(repairs, 0, "replacement is silent");
  assert.equal(dc.readyState, "closed");
  assert.equal(ctx.lab.snapshot().length, 1, "one tile, not two");
  assert.equal(tile(ctx, "2").replaced, true, "the old session was live: teacher should notice");
});

test("takeover under a different spelling keeps one tile and shows the latest spelling", async () => {
  const ctx = make();
  await pair(ctx, "Row2");
  ctx.lab.setLabel("Row2", "window seat");
  await pair(ctx, "ROW2");
  assert.equal(ctx.lab.snapshot().length, 1);
  const t = tile(ctx, "row2");
  assert.equal(t.ws, "ROW2");
  assert.equal(t.label, "window seat", "roster metadata carries over: same station");
  assert.equal(saved(ctx).roster["row2"]?.ws, "ROW2");
  assert.equal(saved(ctx).roster["row2"]?.pairCount, 2);
});

test("replaced is not set when the old session had already failed or never existed", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "9");
  assert.equal(tile(ctx, "9").replaced, false);
  dc.close();
  assert.equal(tile(ctx, "9").state, "failed");
  await pair(ctx, "9");
  assert.equal(tile(ctx, "9").replaced, false, "re-pairing a dead station is the normal path");
});

test("acknowledgeReplaced clears the flag and emits change once", async () => {
  const ctx = make();
  await pair(ctx, "4");
  await pair(ctx, "4");
  assert.equal(tile(ctx, "4").replaced, true);
  let changes = 0;
  ctx.lab.on("change", () => changes++);
  ctx.lab.acknowledgeReplaced("4");
  ctx.lab.acknowledgeReplaced("4");
  assert.equal(tile(ctx, "4").replaced, false);
  assert.equal(changes, 1);
});

test("remove closes the session, drops the tile and the roster entry; unknown → false", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "Seat 4");
  ctx.lab.setLabel("Seat 4", "by the door");
  assert.equal(ctx.lab.remove("seat 4"), true);
  assert.equal(dc.readyState, "closed");
  assert.deepEqual(ctx.lab.snapshot(), []);
  assert.deepEqual(ctx.lab.repairQueue(), []);
  assert.equal(saved(ctx).roster["seat 4"], undefined);
  assert.equal(ctx.lab.remove("seat 4"), false);
  assert.equal(ctx.lab.remove("nobody"), false);
  await pair(ctx, "Seat 4");
  const t = tile(ctx, "Seat 4");
  assert.equal(t.label, undefined, "a removed station comes back fresh");
  assert.equal(saved(ctx).roster["seat 4"]?.pairCount, 1);
});

test("failed session lands in repairQueue with history", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "9");
  dc.close();
  assert.deepEqual(ctx.lab.repairQueue(), ["9"]);
  const t = tile(ctx, "9");
  assert.equal(t.state, "failed");
  assert.deepEqual(t.history.map((h) => h.state).slice(-2), ["connected", "failed"]);
});

test("settings update persists and is applied to new sessions", async () => {
  const ctx = make();
  ctx.lab.updateSettings({ heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 });
  assert.equal(saved(ctx).settings.heartbeatMs, 1000);
  const { dc } = await pair(ctx, "1");
  ctx.clock.advance(1000);
  assert.equal((dc.sentJson().at(-1) as { t: string }).t, "hb");
  ctx.clock.advance(2000);
  assert.equal(tile(ctx, "1").state, "degraded");
});

test("sendCmd routes to the right session (any spelling) and sets labels", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "Row 4");
  ctx.lab.sendCmd("ROW 4", "ping");
  assert.deepEqual(dc.sentJson().at(-1), { t: "cmd", cmd: "ping" });
  ctx.lab.setLabel("row 4", "Row 1 seat 4");
  assert.equal(tile(ctx, "Row 4").label, "Row 1 seat 4");
  ctx.lab.sendCmd("29", "ping"); // no session: no throw
});

test("acceptOffer twice back-to-back before gathering completes: first settles, second resolves", async () => {
  const ctx = make();
  const p1 = ctx.lab.acceptOffer(offer("2"));
  const p2 = ctx.lab.acceptOffer(offer("2"));
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
  assert.equal(answer.ws, "2");
  assert.equal(tile(ctx, "2").replaced, false, "superseding a still-gathering scan is not a takeover");
});

test("setLabel rejects an over-long label without mutating the roster", async () => {
  const ctx = make();
  await pair(ctx, "4");
  assert.equal(ctx.lab.setLabel("4", "x".repeat(65)), false);
  assert.equal(tile(ctx, "4").label, undefined);
});

test("setLabel on an unknown station creates no tile", () => {
  const ctx = make();
  assert.equal(ctx.lab.setLabel("ghost", "boo"), false);
  assert.deepEqual(ctx.lab.snapshot(), []);
});

test("updateSettings rejects an invalid patch without mutating settings", () => {
  const ctx = make();
  const before = ctx.lab.settings;
  assert.equal(ctx.lab.updateSettings({ heartbeatMs: 100 }), false);
  assert.deepEqual(ctx.lab.settings, before);
});

test("persist never throws even if the KeyValueStore.set throws", async () => {
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
  const p = lab.acceptOffer(offer("4"));
  await flush();
  assert.equal(lab.snapshot()[0]?.ws, "4");
  void p;
});

test("pairCount counts pairings, not ICE recoveries", async () => {
  const ctx = make();
  await pair(ctx, "1");
  const pc = ctx.rtc.last();
  pc.setIce("disconnected");
  pc.setIce("connected");
  assert.equal(tile(ctx, "1").state, "connected");
  assert.equal(saved(ctx).roster["1"]?.pairCount, 1);
});

test("history is capped at 50 entries; snapshot() returns a fresh copy each time", async () => {
  const ctx = make();
  await pair(ctx, "1");
  const pc = ctx.rtc.last();
  for (let i = 0; i < 30; i++) {
    pc.setIce("disconnected");
    pc.setIce("connected");
  }
  assert.equal(tile(ctx, "1").history.length, 50);
  assert.notEqual(tile(ctx, "1").history, tile(ctx, "1").history);
});

test("counts", async () => {
  const ctx = make();
  await pair(ctx, "1");
  await pair(ctx, "2");
  ctx.rtc.pcs[1]!.channels.at(-1)!.close();
  assert.deepEqual(ctx.lab.counts(), { connected: 1, degraded: 0, failed: 1, never: 0 });
});

test("fingerprint continuity: same cert → unchanged, different cert → flagged", async () => {
  const ctx = make();
  await pair(ctx, "3");
  const first = tile(ctx, "3");
  assert.equal(first.fingerprintChanged, false, "no previous pairing to differ from");
  assert.match(first.fingerprint!, /^7B:8B:F0:65(:[0-9A-F]{2})+$/);
  assert.equal(saved(ctx).roster["3"]?.lastFingerprint, first.fingerprint);

  await pair(ctx, "3");
  assert.equal(tile(ctx, "3").fingerprintChanged, false);

  const swapped = { ...offer("3"), fp: new Uint8Array(32).fill(0xab) };
  const p = ctx.lab.acceptOffer(swapped);
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  const t = tile(ctx, "3");
  assert.equal(t.fingerprintChanged, true);
  assert.equal(t.fingerprint, new Array(32).fill("AB").join(":"));
});

test("lastFingerprint is persisted only once acceptOffer's answer resolves", async () => {
  const ctx = make();
  await pair(ctx, "3");
  const first = saved(ctx).roster["3"]?.lastFingerprint;
  assert.match(first!, /^7B:8B:F0:65/);
  const swapped = { ...offer("3"), fp: new Uint8Array(32).fill(0xab) };
  const p = ctx.lab.acceptOffer(swapped);
  await flush();
  assert.equal(saved(ctx).roster["3"]?.lastFingerprint, first, "still the previous pairing while gathering");
  ctx.rtc.last().completeGathering();
  await p;
  assert.equal(saved(ctx).roster["3"]?.lastFingerprint, new Array(32).fill("AB").join(":"));
});

test("a superseded acceptOffer never writes its fingerprint", async () => {
  const ctx = make();
  await pair(ctx, "2");
  const original = saved(ctx).roster["2"]?.lastFingerprint;
  const p1 = ctx.lab.acceptOffer({ ...offer("2"), fp: new Uint8Array(32).fill(0xab) });
  const p2 = ctx.lab.acceptOffer(offer("2"));
  await assert.rejects(p1, SupersededError);
  await flush();
  ctx.rtc.last().completeGathering();
  await p2;
  assert.equal(saved(ctx).roster["2"]?.lastFingerprint, original);
  assert.equal(tile(ctx, "2").fingerprintChanged, false);
});

test("history survives a re-pair", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "6");
  dc.close();
  const before = tile(ctx, "6").history.map((h) => h.state);
  assert.deepEqual(before.slice(-2), ["connected", "failed"]);
  await pair(ctx, "6");
  const after = tile(ctx, "6").history.map((h) => h.state);
  assert.deepEqual(after.slice(0, before.length), before, "earlier states are kept");
  assert.deepEqual(after.slice(before.length), ["gathering", "connecting", "connected"]);
});

test("lastSeenAt tracks the latest inbound frame; lastConnectedAt stays the pairing time", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "5");
  const paired = tile(ctx, "5");
  assert.equal(paired.lastSeenAt, paired.lastConnectedAt);
  ctx.clock.advance(7000);
  dc.receive(JSON.stringify({ t: "hb-ack", seq: 1, ts: 0 }));
  const t = tile(ctx, "5");
  assert.equal(t.lastSeenAt, 7000);
  assert.equal(t.lastConnectedAt, paired.lastConnectedAt);
  ctx.clock.advance(1000);
  ctx.lab.sendCmd("5", "ping");
  assert.equal(tile(ctx, "5").lastSeenAt, 7000, "outbound traffic is not 'seen'");
});

test("lastSeenAt is persisted at most once a minute while chatty, and on degraded/failed", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, "6");
  const stored = () => saved(ctx).roster["6"]?.lastSeenAt;
  const hb = () => dc.receive(JSON.stringify({ t: "hb-ack", seq: 1, ts: 0 }));
  assert.equal(stored(), 0, "pairing itself records a sighting");
  for (let i = 0; i < 11; i++) {
    ctx.clock.advance(5000);
    hb();
  }
  assert.equal(stored(), 0, "55 s of heartbeats: no write yet");
  assert.equal(tile(ctx, "6").lastSeenAt, 55_000);
  ctx.clock.advance(5000);
  hb();
  assert.equal(stored(), 60_000, "first write once a minute has passed");
  ctx.clock.advance(5000);
  hb();
  assert.equal(stored(), 60_000, "then quiet again");
  // The miss check runs on the 5 s tick and needs > degradedMs, so 20 s → degraded.
  ctx.clock.advance(20_000);
  assert.equal(tile(ctx, "6").state, "degraded");
  assert.equal(stored(), 65_000, "degraded persists the last sighting");
});

test("a never-paired tile reports persisted metadata from an earlier run", () => {
  const kv = new MemoryKv();
  kv.set(
    TEACHER_KEY,
    JSON.stringify({
      roster: { "row 9": { ws: "Row 9", pairCount: 1, lastSeenAt: 1234, lastConnectedAt: 1000 } },
    }),
  );
  const ctx = make(kv);
  const t = tile(ctx, "row 9");
  assert.equal(t.state, "never");
  assert.equal(t.ws, "Row 9");
  assert.equal(t.lastSeenAt, 1234);
  assert.deepEqual(ctx.lab.repairQueue(), ["Row 9"], "known but not live: walk there");
  assert.deepEqual(ctx.lab.counts(), { connected: 0, degraded: 0, failed: 0, never: 1 });
});

test("a v1 teacher blob is migrated on first boot and removed; labels survive", () => {
  const kv = new MemoryKv();
  kv.set(
    LEGACY_TEACHER_KEY,
    JSON.stringify({
      roster: { "7": { label: "Row 1 seat 7", pairCount: 2 } },
      settings: { heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 },
    }),
  );
  const ctx = make(kv);
  assert.equal(tile(ctx, "7").label, "Row 1 seat 7");
  assert.equal(ctx.lab.settings.heartbeatMs, 1000);
  assert.equal(saved(ctx).roster["7"]?.ws, "7");
  assert.equal(kv.get(LEGACY_TEACHER_KEY), null);
});

test("when v2 exists, v1 is ignored and removed", () => {
  const kv = new MemoryKv();
  kv.set(TEACHER_KEY, JSON.stringify({ roster: { "a": { ws: "A", pairCount: 1 } } }));
  kv.set(LEGACY_TEACHER_KEY, JSON.stringify({ roster: { "7": { pairCount: 9 } } }));
  const ctx = make(kv);
  assert.deepEqual(
    ctx.lab.snapshot().map((t) => t.ws),
    ["A"],
  );
  assert.equal(kv.get(LEGACY_TEACHER_KEY), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/unit/core/labController.test.ts`
Expected: FAIL broadly (snapshot returns 30 entries, `remove`/`acknowledgeReplaced` missing, keys numeric).

- [ ] **Step 3: Rewrite `src/core/labController.ts`**

```ts
import type { CmdMessage } from "../schemas/protocol";
import type { SdpPayload } from "../schemas/sdpPayload";
import type { Settings, TeacherState } from "../schemas/storage";
import {
  RosterEntrySchema,
  SettingsSchema,
  TEACHER_KEY,
  TeacherStateSchema,
} from "../schemas/storage";
import { LEGACY_TEACHER_KEY } from "../schemas/legacy";
import { compareWs, wsKey } from "../schemas/ws";
import type { Clock } from "./clock";
import { Emitter } from "./events";
import { migrateTeacherV1 } from "./migrations";
import { PeerSession, type SessionState } from "./peerSession";
import type { KeyValueStore, RtcFactory, Visibility } from "./ports";
import { loadState, saveState } from "./store";

export interface TeacherEnv {
  rtc: RtcFactory;
  clock: Clock;
  kv: KeyValueStore;
  appVersion: string;
  ua: string;
  certificates?: RTCCertificate[];
  log?(msg: string): void;
}

export interface RosterView {
  /** wsKey(ws): stable lookup handle, React key, `data-tile` value. */
  key: string;
  /** Display form: the ID as the student most recently typed it. */
  ws: string;
  state: SessionState | "never";
  rtt?: number;
  label?: string;
  /** When this pairing's handshake completed (persisted). */
  lastConnectedAt?: number;
  /** When we last heard *anything* from the station: live while a session exists, else persisted. */
  lastSeenAt?: number;
  lastSeenUa?: string;
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  versionMismatch: boolean;
  /** DTLS fingerprint of the current pairing, uppercase colon-separated hex (spec §6.3). */
  fingerprint?: string;
  /** True when this ws paired before with a *different* certificate: not the same iPad. */
  fingerprintChanged: boolean;
  /** This pairing replaced a session that was still connected/degraded. Cleared by acknowledgeReplaced(). */
  replaced: boolean;
  history: { at: number; state: SessionState }[];
}

interface Live {
  lastSeenAt?: number;
  /** Clock time of the last persisted lastSeenAt; gates the once-a-minute write. */
  seenPersistedAt?: number;
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  fingerprintChanged: boolean;
  replaced: boolean;
  history: { at: number; state: SessionState }[];
}

export type LabEvents = { change: [] };

/** Rejects a superseded acceptOffer(): a same-ws re-scan closed this session before it answered. */
export class SupersededError extends Error {
  override name = "SupersededError";
}

const HISTORY_CAP = 50;
/**
 * A heartbeat lands every 5 s from every station; persisting lastSeenAt on each would be a
 * localStorage write every few hundred ms for nothing. Once a minute per station keeps a
 * teacher-tab reload honest to within a minute, and degraded/failed transitions write
 * immediately because "when did we lose it" is exactly the number the dashboard then needs.
 */
const SEEN_PERSIST_MS = 60_000;

/** Raw sha-256 fingerprint bytes → the `AA:BB:…` form the browser and the drawer both show. */
function hexFingerprint(fp: Uint8Array): string {
  return Array.from(fp, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** Teacher side: one PeerSession per known station, persisted roster metadata, repair queue. */
export class LabController extends Emitter<LabEvents> {
  state: TeacherState;
  /** Keyed by wsKey(ws). */
  readonly sessions = new Map<string, PeerSession>();
  private readonly live = new Map<string, Live>();

  constructor(private readonly env: TeacherEnv) {
    super();
    const log = env.log ?? (() => {});
    this.state = loadState(
      env.kv,
      TEACHER_KEY,
      TeacherStateSchema,
      TeacherStateSchema.parse({}),
      log,
      () => migrateTeacherV1(env.kv, log),
    );
    // v1 never outlives a v2 boot, whether it was migrated or shadowed by an existing v2 blob.
    env.kv.remove(LEGACY_TEACHER_KEY);
  }

  get settings(): Settings {
    return this.state.settings;
  }

  /** Validates the merged settings before applying. Returns false (unchanged) on invalid input. */
  updateSettings(patch: Partial<Settings>): boolean {
    const merged = { ...this.state.settings, ...patch };
    const r = SettingsSchema.safeParse(merged);
    if (!r.success) {
      this.env.log?.(`updateSettings: invalid (${r.error.issues[0]?.message ?? "?"})`);
      return false;
    }
    this.state.settings = r.data;
    this.persist();
    return true;
  }

  /** Validates the label before applying. Returns false (unchanged) on invalid input or unknown ws. */
  setLabel(ws: string, label: string): boolean {
    const e = this.state.roster[wsKey(ws)];
    if (!e) return false;
    const r = RosterEntrySchema.shape.label.safeParse(label);
    if (!r.success) {
      this.env.log?.(`setLabel: invalid (${r.error.issues[0]?.message ?? "?"})`);
      return false;
    }
    e.label = label;
    this.persist();
    return true;
  }

  /** Accept a student's offer; resolves with our answer payload once ICE gathering completes. */
  acceptOffer(offer: SdpPayload): Promise<SdpPayload> {
    const ws = offer.ws;
    const key = wsKey(ws);
    const old = this.sessions.get(key);
    // Reload-to-fix: a repeat pairing simply replaces the old session. If that session was still
    // alive, the teacher should notice — a typo on another iPad may have kicked a healthy
    // station — so the tile carries a badge until the drawer is opened.
    const replaced = old !== undefined && (old.state === "connected" || old.state === "degraded");
    old?.close();
    const { heartbeatMs, degradedMs, failedMs } = this.state.settings;
    const s = new PeerSession({
      role: "teacher",
      ws,
      rtc: this.env.rtc,
      clock: this.env.clock,
      timers: { heartbeatMs, degradedMs, failedMs },
      appVersion: this.env.appVersion,
      ua: this.env.ua,
      ...(this.env.certificates ? { certificates: this.env.certificates } : {}),
    });
    this.sessions.set(key, s);
    const e = this.entry(ws);
    e.ws = ws; // the latest spelling is the one shown
    // The student's DTLS certificate is persisted per device (spec §6.3), so a fingerprint that
    // matches the previous pairing means the same iPad came back; a different one means the
    // station was swapped (or the iPad was wiped) and the teacher should be told.
    const fp = hexFingerprint(offer.fp);
    const fingerprintChanged = e.lastFingerprint !== undefined && e.lastFingerprint !== fp;
    // History is the station's story across the lab day, not this session's: a re-pair continues
    // it rather than wiping the evidence of why the last one died.
    const previous = this.live.get(key);
    this.live.set(key, { history: previous?.history ?? [], fingerprintChanged, replaced });
    this.wire(s);
    this.persist();

    const answer = new Promise<SdpPayload>((resolve, reject) => {
      const offLocal = s.on("localPayload", (p) => {
        cleanup();
        // Recorded only now: a scan that never produced an answer (superseded, PC blew up) was
        // not a pairing, and must not become the baseline the next continuity check compares to.
        this.entry(ws).lastFingerprint = fp;
        this.persist();
        resolve(p);
      });
      // A same-ws re-scan can close() this session while we're still waiting on the answer:
      // applyRemote() then resolves silently instead of throwing, so without this the promise
      // would hang.
      const offState = s.on("state", (st) => {
        if (st === "failed") {
          cleanup();
          reject(new SupersededError("session closed before an answer was produced"));
        }
      });
      function cleanup(): void {
        offLocal();
        offState();
      }
      s.applyRemote(offer).catch((e: unknown) => {
        cleanup();
        reject(e as Error);
      });
    });
    this.changed();
    return answer;
  }

  /**
   * Forget a station: close its session, drop its tile, label and history. `false` if unknown.
   * An iPad that is still running simply pairs again later as a fresh station.
   */
  remove(ws: string): boolean {
    const key = wsKey(ws);
    if (!(key in this.state.roster) && !this.sessions.has(key)) return false;
    // Close first: the failed transition's handlers still read live/roster for this key.
    this.sessions.get(key)?.close();
    this.sessions.delete(key);
    this.live.delete(key);
    delete this.state.roster[key];
    this.persist();
    return true;
  }

  /** The teacher has seen the `replaced` badge (drawer opened). */
  acknowledgeReplaced(ws: string): void {
    const l = this.live.get(wsKey(ws));
    if (!l?.replaced) return;
    l.replaced = false;
    this.changed();
  }

  sendCmd(ws: string, cmd: CmdMessage["cmd"]): void {
    this.sessions.get(wsKey(ws))?.send({ t: "cmd", cmd });
  }

  /** Stations that need a walk: known but no session this run, or hard-failed. Natural order. */
  repairQueue(): string[] {
    return this.orderedKeys()
      .filter((k) => {
        const st = this.sessions.get(k)?.state;
        return st === undefined || st === "failed";
      })
      .map((k) => this.state.roster[k]!.ws);
  }

  snapshot(): RosterView[] {
    return this.orderedKeys().map((key) => {
      const e = this.state.roster[key]!;
      const s = this.sessions.get(key);
      const l = this.live.get(key);
      const view: RosterView = {
        key,
        ws: e.ws,
        state: s?.state ?? "never",
        versionMismatch:
          l?.remoteAppVersion !== undefined && l.remoteAppVersion !== this.env.appVersion,
        fingerprintChanged: l?.fingerprintChanged ?? false,
        replaced: l?.replaced ?? false,
        history: l ? [...l.history] : [],
      };
      if (e.lastFingerprint !== undefined) view.fingerprint = e.lastFingerprint;
      if (s?.lastRtt !== undefined) view.rtt = s.lastRtt;
      if (e.label !== undefined) view.label = e.label;
      if (e.lastConnectedAt !== undefined) view.lastConnectedAt = e.lastConnectedAt;
      const seen = l?.lastSeenAt ?? e.lastSeenAt;
      if (seen !== undefined) view.lastSeenAt = seen;
      if (e.lastSeenUa !== undefined) view.lastSeenUa = e.lastSeenUa;
      if (l?.battery !== undefined) view.battery = l.battery;
      if (l?.charging !== undefined) view.charging = l.charging;
      if (l?.visibility !== undefined) view.visibility = l.visibility;
      if (l?.wakeLock !== undefined) view.wakeLock = l.wakeLock;
      if (l?.remoteAppVersion !== undefined) view.remoteAppVersion = l.remoteAppVersion;
      return view;
    });
  }

  counts(): { connected: number; degraded: number; failed: number; never: number } {
    const c = { connected: 0, degraded: 0, failed: 0, never: 0 };
    for (const t of this.snapshot()) {
      if (t.state === "connected") c.connected++;
      else if (t.state === "degraded") c.degraded++;
      else if (t.state === "never") c.never++;
      else if (t.state === "failed") c.failed++;
    }
    return c;
  }

  // ---- internals ----

  private orderedKeys(): string[] {
    const roster = this.state.roster;
    return Object.keys(roster).sort((a, b) => compareWs(roster[a]!.ws, roster[b]!.ws));
  }

  private wire(s: PeerSession): void {
    const ws = s.ws;
    const key = wsKey(ws);
    s.on("state", (st, prev) => {
      const l = this.live.get(key);
      if (l) {
        l.history.push({ at: this.env.clock.now(), state: st });
        if (l.history.length > HISTORY_CAP) l.history.splice(0, l.history.length - HISTORY_CAP);
      }
      // Only a fresh handshake (connecting → connected) counts as a pairing; recovering from
      // degraded is the same pairing continuing, not a new one.
      if (st === "connected" && prev === "connecting") {
        const e = this.entry(ws);
        const now = this.env.clock.now();
        e.lastConnectedAt = now;
        e.pairCount += 1;
        this.markSeen(ws, now, true);
        this.persist();
      }
      // The last sighting before we lost them is the number the tile needs now; write it.
      if ((st === "degraded" || st === "failed") && l?.lastSeenAt !== undefined) {
        this.markSeen(ws, l.lastSeenAt, true);
        this.persist();
      }
      this.changed();
    });
    s.on("inbound", () => {
      const now = this.env.clock.now();
      const l = this.live.get(key);
      const due = l?.seenPersistedAt === undefined || now - l.seenPersistedAt >= SEEN_PERSIST_MS;
      this.markSeen(ws, now, due);
      if (due) this.persist();
      else this.changed();
    });
    s.on("hello", (h) => {
      const e = this.entry(ws);
      e.lastSeenUa = h.ua;
      const l = this.live.get(key);
      if (l) l.remoteAppVersion = h.appVersion;
      this.persist();
    });
    s.on("rtt", (ms) => {
      const e = this.entry(ws);
      e.lastRtt = ms;
      this.changed();
    });
    s.on("message", (m) => {
      if (m.t !== "status") return;
      const l = this.live.get(key);
      if (!l) return;
      if (m.battery !== undefined) l.battery = m.battery;
      if (m.charging !== undefined) l.charging = m.charging;
      l.visibility = m.visibility;
      l.wakeLock = m.wakeLock;
      this.changed();
    });
    s.on("needsRepair", (reason) => this.env.log?.(`ws ${ws} failed: ${reason}`));
  }

  /** Update the live sighting; `persist` also copies it into the roster entry (caller saves). */
  private markSeen(ws: string, at: number, persist: boolean): void {
    const l = this.live.get(wsKey(ws));
    if (l) l.lastSeenAt = at;
    if (persist) {
      this.entry(ws).lastSeenAt = at;
      if (l) l.seenPersistedAt = at;
    }
  }

  /** The roster entry for `ws`, created on first sight with `ws` as its display form. */
  private entry(ws: string) {
    const key = wsKey(ws);
    return (this.state.roster[key] ??= { ws, pairCount: 0 });
  }

  private persist(): void {
    try {
      saveState(this.env.kv, TEACHER_KEY, TeacherStateSchema, this.state);
    } catch (e) {
      this.env.log?.(`persist failed: ${(e as Error).message}`);
    }
    this.changed();
  }

  private changed(): void {
    this.emit("change");
  }
}
```

Note the behaviour change in `setLabel`: it now returns `false` for an unknown station instead of creating a roster entry (creating tiles from the drawer made sense with a fixed grid, not with a dynamic one).

- [ ] **Step 4: Run the whole unit suite**

Run: `pnpm test`
Expected: all pass (this is the first task where the full suite is green again). If `chunker`/`heartbeat`/`bytes`/`events`/`certStore`/`fakeClock` suites fail, that is a regression from a previous task — fix before continuing.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/labController.ts test/unit/core/labController.test.ts
git add src/core/labController.ts test/unit/core/labController.test.ts
git commit -m "feat(teacher): dynamic roster keyed by wsKey; takeover flag; remove()

Roster grows as stations pair and is sorted naturally. A repeat pairing over a
live session sets a replaced flag the drawer clears. remove() forgets a station.
lab.teacher.v1 is migrated on first boot. Full unit suite green again.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Student boot + UI — typed ID entry, change-ID flow

**Files:**
- Modify: `src/boot/bootStudent.ts`
- Modify: `src/main.tsx`
- Create: `src/ui/student/WsEntry.tsx`; Delete: `src/ui/student/WsPicker.tsx`
- Modify: `src/ui/student/WsConflict.tsx`, `src/ui/student/StudentApp.tsx`, `src/ui/shared/QrView.tsx`, `src/ui/shared/styles.css`
- Modify: `test/e2e/homescreen.spec.ts`

**Interfaces:**
- Consumes: `WsSchema`, `wsKey` (Task 1); `StudentController` string ws (Task 5).
- Produces: `resolveWs(): { urlWs?: string; storedWs?: string; urlInvalid: boolean }`, `bootStudent(ws: string)`, `releaseStudent(ws: string): Promise<void>`; `WsEntry({ initial?, urlInvalid?, onConfirm, onCancel? })`; `StudentApp({ boot, onChangeWs })`; `QrView.ws: string`. Test hooks: `[data-ws-input]`, `[data-ws-confirm]`, `[data-ws-issue]`, `[data-ws-change]`, `[data-ws-cancel]`, `[data-ws-notice]`.

- [ ] **Step 1: Rewrite the homescreen e2e spec (failing)**

Replace `test/e2e/homescreen.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { expectState } from "./helpers";

/**
 * An iPad Home Screen web app launches without the `?ws=` it was added from, and its storage is
 * isolated from Safari's, so on first launch the student page knows nothing. It must offer a
 * one-time typed entry instead of a dead end, remember the answer, and let a typo be fixed.
 */
test("student without ?ws and no saved workstation types an ID that persists", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student");
  const input = page.locator("[data-ws-input]");
  await expect(input).toBeVisible();
  await expect(page.locator("[data-ws-confirm]")).toBeDisabled();
  await input.fill("Row#2");
  await expect(page.locator("[data-ws-issue]")).toContainText("Letters, digits");
  await expect(page.locator("[data-ws-confirm]")).toBeDisabled();
  await input.fill("  Row   2 ");
  await page.locator("[data-ws-confirm]").click();
  await expect(page.locator(".bar .ws")).toHaveText("Row 2");
  await expectState(page, "#student", "awaiting-remote");

  await page.goto("/student"); // next launch, still no query string
  await expect(page.locator("[data-ws-input]")).toHaveCount(0);
  await expect(page.locator(".bar .ws")).toHaveText("Row 2");
  await ctx.close();
});

test("tapping the ID in the status bar lets the student fix a typo; the new ID gets a new offer", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student?ws=Rwo2");
  await expect(page.locator(".bar .ws")).toHaveText("Rwo2");
  const firstOffer = page.locator("canvas[data-payload][data-role='offer'][data-ws='Rwo2']");
  await expect(firstOffer).toHaveAttribute("data-payload", /^LAB2:/);

  await page.locator("[data-ws-change]").click();
  const input = page.locator("[data-ws-input]");
  await expect(input).toHaveValue("Rwo2");
  await page.locator("[data-ws-cancel]").click();
  await expect(page.locator(".bar .ws")).toHaveText("Rwo2", "cancel changes nothing");

  await page.locator("[data-ws-change]").click();
  await input.fill("Row2");
  await page.locator("[data-ws-confirm]").click();
  await expect(page.locator(".bar .ws")).toHaveText("Row2");
  await expect(
    page.locator("canvas[data-payload][data-role='offer'][data-ws='Row2']"),
  ).toHaveAttribute("data-payload", /^LAB2:/);
  await expectState(page, "#student", "awaiting-remote");

  await page.goto("/student");
  await expect(page.locator(".bar .ws")).toHaveText("Row2", "the fix is remembered");
  await ctx.close();
});

test("an invalid ?ws with nothing saved shows the entry with a notice", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student?ws=Row%232");
  await expect(page.locator("[data-ws-notice]")).toBeVisible();
  await expect(page.locator("[data-ws-input]")).toBeVisible();
  await ctx.close();
});

test("manifest has no start_url, so iOS keeps the URL the app was added from", async ({
  request,
}) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as Record<string, unknown>;
  expect(manifest.start_url).toBeUndefined();
  expect(manifest.display).toBe("standalone");
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm exec playwright test homescreen.spec.ts --project=chromium`
Expected: first three tests FAIL (no `[data-ws-input]`; the page still renders the 30-button picker or crashes on the string ws).

- [ ] **Step 3: Update `src/ui/shared/QrView.tsx`**

Prop type `ws: number` → `ws: string`.

- [ ] **Step 4: Update `src/boot/bootStudent.ts`**

Replace the `WsParamSchema` import with `import { WsSchema, wsKey } from "../schemas/ws";`. Then:

```ts
export interface ResolvedWs {
  urlWs?: string;
  storedWs?: string;
  /** `?ws=` was present but not a legal workstation ID — the UI must say so, not fall back mutely. */
  urlInvalid: boolean;
}

export function resolveWs(): ResolvedWs {
  const raw = new URLSearchParams(location.search).get("ws");
  const parsed = WsSchema.safeParse(raw);
  const out: ResolvedWs = { urlInvalid: raw !== null && !parsed.success };
  if (raw !== null && parsed.success) out.urlWs = parsed.data;
  const stored = StudentController.persistedWs(browserKv);
  if (stored !== undefined) out.storedWs = stored;
  return out;
}
```
Cache by key, and add release:

```ts
// StrictMode invokes useState lazy initializers twice on mount, so StudentRoute could otherwise
// call bootStudent(ws) twice and spawn two controllers/PeerConnections; cache by wsKey so the
// second call reuses the in-flight/settled promise instead of booting again.
const bootCache = new Map<string, Promise<StudentController>>();

export async function bootStudent(ws: string): Promise<StudentController> {
  const key = wsKey(ws);
  const cached = bootCache.get(key);
  if (cached) return cached;
  const p = bootStudentUncached(ws);
  bootCache.set(key, p);
  return p;
}

/** Stop the controller for `ws` and forget it, so a later bootStudent(ws) starts fresh. */
export async function releaseStudent(ws: string): Promise<void> {
  const key = wsKey(ws);
  const p = bootCache.get(key);
  bootCache.delete(key);
  if (p) (await p).stop();
}

async function bootStudentUncached(ws: string): Promise<StudentController> {
```
In the autopair block: `wire: z.string().startsWith("LAB2:")`.

- [ ] **Step 5: Create `src/ui/student/WsEntry.tsx` and delete `WsPicker.tsx`**

```bash
git rm -q src/ui/student/WsPicker.tsx
```

```tsx
import { useState } from "react";
import { WS_MAX_LEN, WsSchema } from "../../schemas/ws";

/**
 * Typed workstation ID. Shown on first launch with nothing to go on (a Home Screen web app on
 * iPadOS lands here whenever it was added without `?ws=`: its storage is isolated from Safari's),
 * and again when the student taps the ID in the status bar to fix a typo. The teacher keeps IDs
 * unique in the room; a repeated ID simply takes over the earlier pairing.
 */
export function WsEntry({
  initial = "",
  urlInvalid = false,
  onConfirm,
  onCancel,
}: {
  initial?: string;
  urlInvalid?: boolean;
  onConfirm: (ws: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const parsed = WsSchema.safeParse(value);
  const issue =
    !parsed.success && value.trim() !== "" ? parsed.error.issues[0]?.message : undefined;
  return (
    <div className="center">
      <h1>Which workstation is this iPad?</h1>
      {urlInvalid && (
        <p className="meta" data-ws-notice>
          The ?ws value in this URL is not a valid workstation ID.
        </p>
      )}
      <form
        className="ws-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) onConfirm(parsed.data);
        }}
      >
        <input
          data-ws-input
          aria-label="Workstation ID"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={WS_MAX_LEN}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="e.g. Row 2"
        />
        <button type="submit" data-ws-confirm disabled={!parsed.success}>
          Connect
        </button>
        {onCancel && (
          <button type="button" className="secondary" data-ws-cancel onClick={onCancel}>
            Cancel
          </button>
        )}
      </form>
      {issue && (
        <p className="meta" data-ws-issue>
          {issue}
        </p>
      )}
      <p className="meta">Letters, digits, spaces, - and _. Pick once; this iPad remembers it.</p>
    </div>
  );
}
```

- [ ] **Step 6: Update `src/ui/student/WsConflict.tsx`**

Prop types: `urlWs: string; storedWs: string; onPick: (ws: string) => void;`. No other change.

- [ ] **Step 7: Update `src/main.tsx` `StudentRoute`**

Imports: replace `WsPicker` import with `import { WsEntry } from "./ui/student/WsEntry";`, add `import { wsKey } from "./schemas/ws";`, and change the boot import to `import { bootStudent, releaseStudent, resolveWs } from "./boot/bootStudent";`. Replace the whole `StudentRoute` function:

```tsx
function StudentRoute() {
  const { urlWs, storedWs, urlInvalid } = resolveWs();
  const conflict =
    urlWs !== undefined && storedWs !== undefined && wsKey(urlWs) !== wsKey(storedWs);
  const [ws, setWs] = useState<string | undefined>(conflict ? undefined : (urlWs ?? storedWs));
  const [boot, setBoot] = useState<Promise<StudentController> | undefined>(() =>
    ws !== undefined ? bootStudent(ws) : undefined,
  );
  const pick = (w: string) => {
    setWs(w);
    setBoot(bootStudent(w));
  };
  // Changing ID mid-run: stop the old controller (its PC and offer die with it) and boot afresh.
  const change = (w: string) => {
    if (ws !== undefined) void releaseStudent(ws);
    pick(w);
  };
  if (ws === undefined && urlWs !== undefined && storedWs !== undefined) {
    return <WsConflict urlWs={urlWs} storedWs={storedWs} onPick={pick} />;
  }
  if (boot === undefined) return <WsEntry urlInvalid={urlInvalid} onConfirm={pick} />;
  // A typo'd web-clip URL silently booting the saved workstation is how two iPads end up
  // fighting over one ID; say which one is actually in use.
  return (
    <>
      {urlInvalid && ws !== undefined && (
        <p className="meta" data-ws-notice>
          Invalid ?ws in URL — using saved workstation {ws}
        </p>
      )}
      <StudentApp boot={boot} onChangeWs={change} />
    </>
  );
}
```

- [ ] **Step 8: Update `src/ui/student/StudentApp.tsx`**

Add imports `import { wsKey } from "../../schemas/ws";` and `import { WsEntry } from "./WsEntry";`. Thread the prop:

```tsx
export function StudentApp({
  boot,
  onChangeWs,
}: {
  boot: Promise<StudentController>;
  onChangeWs: (ws: string) => void;
}) {
  ...
  return <StudentView c={c} onChangeWs={onChangeWs} />;
}

function StudentView({ c, onChangeWs }: { c: StudentController; onChangeWs: (ws: string) => void }) {
  ...
  const [editing, setEditing] = useState(false);
```
In the header, after `<span className="ws">{c.ws}</span>` add:

```tsx
        <button
          className="secondary change"
          data-ws-change
          title="Change workstation ID"
          onClick={() => setEditing(true)}
        >
          change
        </button>
```
Wrap the existing `<main className="center">…</main>` so that when `editing` is true it renders the entry instead:

```tsx
      {editing ? (
        <WsEntry
          initial={c.ws}
          onConfirm={(w) => {
            setEditing(false);
            if (wsKey(w) !== wsKey(c.ws)) onChangeWs(w);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <main className="center">
          {/* existing children unchanged */}
        </main>
      )}
```

- [ ] **Step 9: Update `src/ui/shared/styles.css`**

Delete the `.ws-picker` and `.ws-picker button` rules. Add:

```css
.bar .change {
  font-size: 0.8rem;
  padding: 0.3em 0.7em;
}
.ws-entry {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
}
.ws-entry input {
  font: inherit;
  font-size: 2rem;
  font-weight: 800;
  padding: 0.3em 0.6em;
  width: 14ch;
  max-width: 80vw;
  border-radius: 8px;
  border: 2px solid #333;
  background: #1c1c1c;
  color: var(--fg);
  text-align: center;
}
.ws-entry input:focus {
  outline: none;
  border-color: var(--blue);
}
```

- [ ] **Step 10: Run the homescreen spec**

Run: `pnpm exec playwright test homescreen.spec.ts --project=chromium`
Expected: 4 pass. (`pnpm typecheck` still red: teacher UI is ported in Task 8.)

- [ ] **Step 11: Commit**

```bash
pnpm exec prettier --write src/boot src/main.tsx src/ui/student src/ui/shared test/e2e/homescreen.spec.ts
git add -A src/boot src/main.tsx src/ui/student src/ui/shared test/e2e/homescreen.spec.ts
git commit -m "feat(student): typed workstation ID entry; change ID from the status bar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Teacher UI, dev/load, e2e port + roster spec

**Files:**
- Modify: `src/ui/teacher/Tile.tsx`, `TileDrawer.tsx`, `TeacherApp.tsx`, `RepairQueue.tsx`, `ScanModal.tsx`, `src/ui/dev/LoadPage.tsx`, `src/ui/shared/styles.css`
- Modify: `test/e2e/helpers.ts`, `pairing.spec.ts`, `drawer.spec.ts`, `scanner.spec.ts`, `load.spec.ts`
- Create: `test/e2e/roster.spec.ts`

**Interfaces:**
- Consumes: `RosterView.key/ws/replaced`, `lab.remove`, `lab.acknowledgeReplaced`, `repairQueue(): string[]` (Task 6).
- Produces: `data-tile="<wsKey>"`, `[data-replaced]` badge inside a tile, `[data-action='remove']` in the drawer, `[data-empty]` hint, `data-queue-ws="<wsKey>"`. Helpers: `tile(ws)`, `openTeacher(browser, settings?, roster?)` where roster entries must include `ws`.

- [ ] **Step 1: Port `test/e2e/helpers.ts`**

```ts
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const SHORT_TIMERS = { heartbeatMs: 300, degradedMs: 1200, failedMs: 2500 };

/** Selector for a station's tile: `data-tile` carries wsKey(ws). */
export const tile = (ws: string) => `[data-tile='${ws.toLowerCase()}']`;

/**
 * `roster` seeds persisted per-station metadata as if from an earlier lab day. Keys are wsKey;
 * every entry needs its display `ws`.
 */
export async function openTeacher(
  browser: Browser,
  settings = SHORT_TIMERS,
  roster: Record<string, { ws: string; pairCount: number; [k: string]: unknown }> = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  await ctx.addInitScript(
    ({ settings, roster }) => {
      localStorage.setItem("lab.teacher.v2", JSON.stringify({ roster, settings }));
    },
    { settings, roster },
  );
  const page = await ctx.newPage();
  await page.goto("/teacher");
  await expect(page.locator("[data-action='scan']")).toBeVisible();
  return { ctx, page };
}

/** `query` appends dev-only params (e.g. `timers=300,1200,2500`) to the student URL. */
export async function openStudent(
  browser: Browser,
  ws: string,
  query = "",
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto(`/student?ws=${encodeURIComponent(ws)}${query ? `&${query}` : ""}`);
  return { ctx, page };
}

export async function readPayload(
  page: Page,
  role: "offer" | "answer",
  ws: string,
): Promise<string> {
  const loc = page.locator(`canvas[data-payload][data-role='${role}'][data-ws='${ws}']`);
  await expect(loc).toHaveAttribute("data-payload", /^LAB2:/);
  return (await loc.getAttribute("data-payload"))!;
}

/** Simulates the courier: student offer → teacher, teacher answer → student. */
export async function pair(teacher: Page, student: Page, ws: string): Promise<void> {
  const offer = await readPayload(student, "offer", ws);
  const answer = await teacher.evaluate((w) => window.__lab!.inject(w), offer);
  expect(typeof answer).toBe("string");
  await student.evaluate((w) => window.__lab!.inject(w), answer as string);
}

export async function expectState(page: Page, selector: string, state: string, timeout = 15_000) {
  await expect(page.locator(selector)).toHaveAttribute("data-state", state, { timeout });
}
```

- [ ] **Step 2: Port the existing specs**

`test/e2e/pairing.spec.ts`: import `tile` from helpers; every `openStudent(browser, N)` → `openStudent(browser, "Row N")` (keep the same digits); every `"[data-tile='N']"` → `tile("Row N")`; `.bar .ws` expectation `toHaveText("Row 7")`; `canvas[...][data-ws='7']` → `[data-ws='Row 7']`; `[data-queue-ws='7']` → `[data-queue-ws='row 7']`; `pair(t.page, s.page, N)` → `pair(t.page, s.page, "Row N")`; the garbage test injects `"LAB2:garbage00"` and matches `/CodecError|crc mismatch|not a LAB2|bad base64url|payload/`. Add one assertion to the garbage test before closing:

```ts
  await expect(s.page.evaluate(() => window.__lab!.inject("LAB1:abcd00"))).rejects.toThrow(
    /LAB1 code|older version/,
  );
```

`test/e2e/drawer.spec.ts`: roster seed becomes `{ "seat 4": { ws: "Seat 4", pairCount: 1, lastFingerprint: STORED_FP } }`; `openStudent(browser, "Seat 4")`, `pair(..., "Seat 4")`, selectors via `tile("Seat 4")`.

`test/e2e/scanner.spec.ts`: `openStudent(browser, "11")`, `readPayload(s.page, "offer", "11")`, `readPayload(t.page, "answer", "11")`, `tile("11")`. Note the clip is written from the student's wire, so it is already `LAB2:`.

`test/e2e/load.spec.ts`: comment says `lab.student.v2`; no other change.

- [ ] **Step 3: Write the failing roster spec**

Create `test/e2e/roster.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair, tile } from "./helpers";

test("dashboard starts empty and grows one tile per paired station, in natural order", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  await expect(t.page.locator("[data-empty]")).toBeVisible();
  await expect(t.page.locator("[data-tile]")).toHaveCount(0);
  const b = await openStudent(browser, "Row 10");
  const a = await openStudent(browser, "Row 2");
  await pair(t.page, b.page, "Row 10");
  await pair(t.page, a.page, "Row 2");
  await expect(t.page.locator("[data-empty]")).toHaveCount(0);
  await expect(t.page.locator("[data-tile] .num")).toHaveText(["Row 2", "Row 10"]);
  await Promise.all([a.ctx.close(), b.ctx.close(), t.ctx.close()]);
});

test("a second iPad pairing under the same ID (any case) takes over; the tile flags it until the drawer opens", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  const a = await openStudent(browser, "Row2");
  await pair(t.page, a.page, "Row2");
  await expectState(t.page, tile("Row2"), "connected");

  const b = await openStudent(browser, "row2");
  await pair(t.page, b.page, "row2");
  await expect(t.page.locator("[data-tile]")).toHaveCount(1);
  await expectState(t.page, tile("row2"), "connected");
  await expect(t.page.locator(`${tile("row2")} .num`)).toHaveText("row2", "latest spelling wins");
  await expect(t.page.locator(`${tile("row2")} [data-replaced]`)).toBeVisible();
  // The kicked iPad loses its session and offers a fresh code on its own.
  await expect(a.page.locator("#student")).toHaveAttribute("data-state", /failed|awaiting-remote/);
  await expectState(a.page, "#student", "awaiting-remote");

  await t.page.locator(tile("row2")).click();
  await t.page.getByRole("button", { name: "Close" }).click();
  await expect(t.page.locator(`${tile("row2")} [data-replaced]`)).toHaveCount(0);
  await Promise.all([a.ctx.close(), b.ctx.close(), t.ctx.close()]);
});

test("remove deletes the tile; the same iPad can pair again as a new station", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, "Seat 4");
  await pair(t.page, s.page, "Seat 4");
  await expectState(t.page, tile("Seat 4"), "connected");

  t.page.once("dialog", (d) => d.accept());
  await t.page.locator(tile("Seat 4")).click();
  await t.page.locator("[data-action='remove']").click();
  await expect(t.page.locator("[data-tile]")).toHaveCount(0);
  await expect(t.page.locator("[data-empty]")).toBeVisible();
  await expect(t.page.locator("[data-count='connected']")).toHaveText(/0/);

  // Teacher closed our PC: the student fails over to a new offer, which pairs as a fresh station.
  await expectState(s.page, "#student", "awaiting-remote");
  await pair(t.page, s.page, "Seat 4");
  await expectState(t.page, tile("Seat 4"), "connected");
  await Promise.all([s.ctx.close(), t.ctx.close()]);
});

test("v1 blobs are migrated on the first v2 boot and then removed", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      "lab.teacher.v1",
      JSON.stringify({
        roster: { "7": { label: "Row 1 seat 7", pairCount: 3 } },
        settings: { heartbeatMs: 300, degradedMs: 1200, failedMs: 2500 },
      }),
    );
    localStorage.setItem("lab.student.v1", JSON.stringify({ ws: 7, pairCount: 2 }));
  });
  const teacher = await ctx.newPage();
  await teacher.goto("/teacher");
  await expect(teacher.locator(`${tile("7")} .meta`).first()).toHaveText("Row 1 seat 7");
  await expect(teacher.locator("[data-queue-ws='7']")).toBeVisible();
  const teacherKeys = await teacher.evaluate(() => ({
    v2: localStorage.getItem("lab.teacher.v2"),
    v1: localStorage.getItem("lab.teacher.v1"),
  }));
  expect(teacherKeys.v1).toBeNull();
  expect(JSON.parse(teacherKeys.v2!).roster["7"].ws).toBe("7");

  const student = await ctx.newPage();
  await student.goto("/student"); // no query: the migrated ws must be found
  await expect(student.locator(".bar .ws")).toHaveText("7");
  const studentKeys = await student.evaluate(() => ({
    v2: localStorage.getItem("lab.student.v2"),
    v1: localStorage.getItem("lab.student.v1"),
  }));
  expect(studentKeys.v1).toBeNull();
  expect(JSON.parse(studentKeys.v2!).pairCount).toBe(2);
  await ctx.close();
});
```

- [ ] **Step 4: Run the new spec to verify failure**

Run: `pnpm exec playwright test roster.spec.ts --project=chromium`
Expected: FAIL (teacher UI still renders numeric tiles / crashes on `t.key`).

- [ ] **Step 5: Update `src/ui/teacher/Tile.tsx`**

```tsx
    <div
      className="tile"
      data-tile={t.key}
      data-state={t.state}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="num">{t.ws}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t.replaced && (
            <span className="badge" data-replaced title="A new pairing replaced a live session">
              ↺ replaced
            </span>
          )}
          <StatusPill state={t.state} />
        </span>
      </div>
```
The rest of the file is unchanged.

- [ ] **Step 6: Update `src/ui/teacher/TileDrawer.tsx`**

Import `useEffect` alongside `useState`. Inside the component, before `return`:

```tsx
  // Opening the drawer is how the teacher acknowledges the "replaced" badge.
  useEffect(() => {
    lab.acknowledgeReplaced(t.ws);
  }, [lab, t.ws]);
```
Change the label input's `onBlur` to `onBlur={() => lab.setLabel(t.ws, label)}` (already so; type now string). In the button row, after the Reload button, add:

```tsx
          <button
            className="secondary"
            data-action="remove"
            onClick={() => {
              if (
                confirm(
                  `Remove ${t.ws}? Its tile and label are deleted; the iPad can pair again as a new station.`,
                )
              ) {
                lab.remove(t.ws);
                onClose();
              }
            }}
          >
            Remove workstation
          </button>
```

- [ ] **Step 7: Update `src/ui/teacher/TeacherApp.tsx`**

```tsx
  const [open, setOpen] = useState<string | undefined>();
  const openTile = open !== undefined ? tiles.find((t) => t.key === open) : undefined;
  ...
        <main className="grid">
          {tiles.length === 0 && (
            <p className="meta" data-empty style={{ gridColumn: "1 / -1", textAlign: "center" }}>
              No workstations yet — tap Scan and point the camera at a student's code.
            </p>
          )}
          {tiles.map((t) => (
            <Tile key={t.key} t={t} onClick={() => setOpen(t.key)} />
          ))}
        </main>
```
If `openTile` becomes undefined after a remove, the drawer simply disappears (the `{openTile && …}` guard already handles it).

- [ ] **Step 8: Update `src/ui/teacher/RepairQueue.tsx`**

```tsx
import { wsKey } from "../../schemas/ws";

export function RepairQueue({ queue }: { queue: string[] }) {
  ...
          {queue.map((ws) => (
            <li key={wsKey(ws)} data-queue-ws={wsKey(ws)}>
              Workstation {ws}
            </li>
          ))}
```

- [ ] **Step 9: Update `src/ui/teacher/ScanModal.tsx`**

`useState<{ wire: string; ws: string } | undefined>()`. Nothing else.

- [ ] **Step 10: Update `src/ui/dev/LoadPage.tsx`**

Import `WsSchema` from `../../schemas/ws`. `wsList` → `Array.from({ length: count }, (_, i) => String(i + 1))`. `OfferMsg`: `ws: WsSchema`, `wire: z.string().startsWith("LAB2:")`. `<Tile key={t.key} …>`. The iframe `src` already interpolates `ws`; keep it.

- [ ] **Step 11: Update `src/ui/shared/styles.css`**

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  padding: 12px;
}
.badge {
  background: var(--amber);
  color: #000;
  border-radius: 6px;
  padding: 0 6px;
  font-weight: 700;
  font-size: 0.8rem;
  white-space: nowrap;
}
```

- [ ] **Step 12: Full verification**

Run, in order, and fix anything red before moving on:

```bash
pnpm exec prettier --write src test
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```
Expected: lint clean, typecheck clean (first time since Task 1), unit all pass, e2e all pass in both projects. Search the source for leftovers: `grep -rn "WS_MIN\|WS_MAX\|WsParamSchema\|LAB1:\|lab\.teacher\.v1\|lab\.student\.v1" src test` must show only `src/schemas/legacy.ts`, `src/core/sdpCodec.ts` (the legacy prefix), their tests, and the migration e2e.

- [ ] **Step 13: Commit**

```bash
git add -A src test
git commit -m "feat(teacher): dynamic tile grid, replaced badge, remove workstation; e2e for string IDs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs

**Files:**
- Modify: `AGENTS.md`, `README.md`, `docs/lab-checklist.md`

- [ ] **Step 1: AGENTS.md**

- "What this is": `up to 30 fixed, MDM-managed student iPads` → `any number of fixed, MDM-managed student iPads`.
- Roles line: `/student?ws=N` → `/student?ws=ID`.
- Add to **Non-negotiable facts**, after the "Student is the offerer" bullet:
  `- **Workstation IDs are strings, matched case-insensitively.** \`wsKey(ws)\` (lowercase) is the identity; the typed form is only for display. Pairing under an ID that already has a live session replaces it — reload-to-fix — and the tile shows "↺ replaced". Uniqueness in a room is the teacher's job.`
- Testing expectations, E2E bullet: append `Tiles are addressed by \`data-tile="<wsKey>"\`; use the \`tile(ws)\` helper.`

- [ ] **Step 2: README.md**

`up to 30 fixed iPads` → `any number of fixed iPads`; routes line `/student?ws=N` → `/student?ws=ID`; add the amendment spec under Design: `- Design amendment (string IDs, dynamic roster): \`docs/superpowers/specs/2026-09-21-variable-workstation-ids-design.md\``.

- [ ] **Step 3: docs/lab-checklist.md**

Line 6: `/student?ws=N` → `/student?ws=<ID>` and add ` IDs are free text (letters, digits, space, - and _; case does not matter). The teacher keeps them unique.`
Line 10: `?ws=N` → `?ws=<ID>`; `shows the workstation picker on first launch (tap the number once; it is remembered)` → `asks for the workstation ID on first launch (type it once; it is remembered; tap "change" in the status bar to fix a typo)`.
Line 11: `the number must come from the URL or be picked once inside the app` → `the ID must come from the URL or be typed once inside the app`.
Line 16: `Pair ws 1 only` → `Pair one station only`.
Line 21: `Dashboard: 30 green` → `Dashboard: every station green`.
Line 26: `Re-pair queue lists 1..30` → `Re-pair queue lists every station from the previous run`.
Line 32: `Leave all 30 connected` → `Leave every station connected`.
Append a new checklist item under the smoke section: `- [ ] Takeover: pair a station, then pair a second iPad under the same ID → one tile, "↺ replaced" badge, first iPad shows a fresh offer. Remove it from the drawer → tile gone; re-pair → tile back.`

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec prettier --check AGENTS.md README.md docs/lab-checklist.md
git add AGENTS.md README.md docs/lab-checklist.md
git commit -m "docs: string workstation IDs, dynamic roster, takeover in AGENTS/README/checklist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- §2.1 legal ID / normalisation → Task 1. §2.2 `wsKey` → Task 1, used in Tasks 4–8. §2.3 ordering → Task 1 (`compareWs`) + Task 6 (`orderedKeys`). §2.4 naming kept → all tasks.
- §3.1 `LAB2:`, `v: 2`, LAB1 message, 24-char budget → Task 2. §3.2 hello string, key compare → Tasks 1, 4.
- §4.1 shapes + `superRefine` → Task 3. §4.2 migration rules incl. "v2 wins, v1 removed" → Tasks 3, 5, 6 (+ e2e in Task 8).
- §5 LabController items (keys, `replaced`, `remove`, `acknowledgeReplaced`, `snapshot`, `repairQueue`, `counts`) → Task 6.
- §6 StudentController → Task 5. §7.1 `WsEntry`, status-bar change, conflict → Task 7. §7.2 grid, badge, drawer remove, empty hint, queue → Task 8. §7.3 courier unchanged (renders strings already). §7.4 `/dev/load` → Task 8.
- §8 tests → each task; e2e takeover/remove/typo/migration → Tasks 7, 8. §9 Phase 2 note → no code. §10 out of scope → nothing added.

**Placeholders:** none; every code step carries its code. Task 5 Step 1 tells the implementer to drop two throwaway lines from the pasted test rather than leaving them.

**Type consistency:** `remove(ws: string): boolean`, `acknowledgeReplaced(ws: string): void`, `RosterView.key/ws/replaced`, `repairQueue(): string[]`, `releaseStudent(ws: string): Promise<void>`, `tile(ws: string)` helper, `data-tile=<wsKey>`, `data-queue-ws=<wsKey>` are spelled identically in Tasks 6, 7, 8.
