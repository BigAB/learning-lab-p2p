# Learning Lab P2P — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static Vite/React app on GitHub Pages where 30 iPads pair with a teacher MacBook over WebRTC DataChannels via QR-courier signaling, with heartbeat monitoring, a teacher dashboard, and automatic re-pair prompts on hard failure.

**Architecture:** Framework-free TypeScript core (`src/core`) owns every `RTCPeerConnection`, a 7-state `PeerSession` machine, an SDP→QR codec, heartbeat, chunking and persistence, all behind injected ports (clock, RTC factory, storage, device). Zod schemas in `src/schemas` are the single source of truth for every type crossing the core boundary. React (`src/ui`) renders from hooks in `src/hooks` and never touches WebRTC. Playwright drives two browser contexts through the real pairing flow on loopback by injecting QR payloads instead of using cameras.

**Tech Stack:** Vite 6, React 19, TypeScript 5 (strict), Zod 3, pnpm 9, Node 22, ESLint 9 flat config + typescript-eslint, Prettier, `node:test` + `tsx`, Playwright (Chromium + WebKit), `qrcode`, `jsqr`, GitHub Actions → GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-20-p2p-core-design.md`

## Global Constraints

- Node `>=22` (needed for `CompressionStream("deflate-raw")` and `node --test` glob support). pnpm `>=9`.
- `src/core/**` and `src/schemas/**` import nothing from `react`, `react-dom`, `src/ui`, `src/hooks`; no use of `window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `indexedDB`, `location`, or the `RTCPeerConnection` global. Enforced by ESLint; CI fails otherwise.
- Every value entering core (DataChannel frames, QR wire strings, storage reads, URL params) is parsed with a Zod schema first. Every value leaving core (outbound DC messages, persisted blobs) is parsed before leaving. TS types are `z.infer<>` of schemas; never hand-duplicate.
- Unknown DataChannel `t` → ignore and count; never throw on the wire.
- Storage keys: `lab.student.v1`, `lab.teacher.v1`. Corrupt blob → log, reset to defaults, continue.
- Default timers: `heartbeatMs 5000`, `degradedMs 15000`, `failedMs 60000`, `connectMs 20000`, `gatherMs 3000`. All injectable.
- Roles by pathname: `/student?ws=N` (N ∈ 1..30), `/teacher`, `/courier`, `/dev/load`.
- QR wire format: `LAB1:` + base64url(deflate-raw(compact JSON)) + 2 hex chars CRC-8 (poly 0x07) of the compressed bytes.
- DataChannel label `"lab"`, ordered, reliable. Frames > 16 384 bytes are chunked.
- No service worker. No router library. No new runtime dependency without a justification line in the PR.
- Conventional Commits. Every task ends with a commit.

---

## File map

| Path | Responsibility |
|---|---|
| `src/schemas/ws.ts` | Workstation number schemas (number + URL-coercing) |
| `src/schemas/sdpPayload.ts` | `SdpPayload` (rich) and `CompactPayload` (QR JSON) schemas |
| `src/schemas/protocol.ts` | DataChannel message schemas, `LabMessageSchema`, reserved namespaces |
| `src/schemas/storage.ts` | `StudentState`, `TeacherState`, settings schemas + storage keys |
| `src/core/events.ts` | Tiny typed `Emitter` |
| `src/core/clock.ts` | `Clock` port + `realClock` |
| `src/core/ports.ts` | `RtcFactory`, `KeyValueStore`, `AsyncKv`, `WakeLockPort`, `DevicePort` |
| `src/core/bytes.ts` | base64url, crc8, deflate/inflate helpers |
| `src/core/sdpCodec.ts` | SDP ⇄ payload ⇄ wire string |
| `src/core/store.ts` | `loadState` / `saveState` with Zod + defaults |
| `src/core/certStore.ts` | Persistent DTLS certificate via `AsyncKv` |
| `src/core/heartbeat.ts` | `Heartbeat` timer/RTT/miss detection |
| `src/core/chunker.ts` | `chunkMessage` + `Reassembler` |
| `src/core/peerSession.ts` | The state machine around one PC + DC |
| `src/core/studentController.ts` | One-session lifecycle, auto-restart, status, cmd |
| `src/core/labController.ts` | 30 sessions, roster, repair queue, settings |
| `src/ui/platform/*.ts` | Browser adapters implementing the ports |
| `src/hooks/*.ts` | `useSessionView`, `useStudent`, `useLabRoster` |
| `src/ui/shared/*` | `QrView`, `Scanner`, `StatusPill`, styles |
| `src/ui/student/*`, `src/ui/teacher/*`, `src/ui/courier/*`, `src/ui/dev/*` | Route UIs |
| `src/boot/*.ts` | Construct core objects outside React; register `window.__lab` test hook |
| `src/main.tsx` | Pathname router |
| `test/unit/**` | `node:test` suites + fakes |
| `test/e2e/**` | Playwright specs |
| `test/fixtures/sdp/*.sdp` | Captured browser SDPs |
| `.github/workflows/{ci,pages}.yml` | CI and deploy |

---

### Task 1: Scaffold + typed Emitter

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.nvmrc`, `index.html`, `src/main.tsx`, `src/core/events.ts`
- Test: `test/unit/core/events.test.ts`

**Interfaces:**
- Produces: `class Emitter<E extends Record<string, unknown[]>>` with `on<K>(name: K, cb: (...args: E[K]) => void): () => void` and `protected emit<K>(name: K, ...args: E[K]): void`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "learning-lab-p2p",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22", "pnpm": ">=9" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "test": "node --import tsx --test \"test/unit/**/*.test.ts\"",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "jsqr": "^1.4.0",
    "qrcode": "^1.5.4",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.20.0",
    "@playwright/test": "^1.50.0",
    "@types/node": "^22.10.0",
    "@types/qrcode": "^1.5.5",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "eslint": "^9.20.0",
    "eslint-plugin-react-hooks": "^5.1.0",
    "globals": "^15.14.0",
    "prettier": "^3.4.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "typescript-eslint": "^8.22.0",
    "vite": "^6.1.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "node"],
    "noEmit": true
  },
  "include": ["src", "test", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: Write vite.config.ts, eslint.config.js, .prettierrc, .prettierignore, .gitignore, .nvmrc**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? "dev"),
  },
});
```

`eslint.config.js`:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/core/**", "src/schemas/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*", "react-dom/*"], message: "core is framework-free" },
            { group: ["**/ui/*", "**/hooks/*", "**/boot/*"], message: "core must not import UI" },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window", "document", "navigator", "localStorage", "sessionStorage",
        "indexedDB", "location", "RTCPeerConnection", "requestAnimationFrame",
      ],
    },
  },
);
```

`.prettierrc`:
```json
{ "printWidth": 100, "singleQuote": false, "trailingComma": "all" }
```

`.prettierignore`:
```
dist
node_modules
pnpm-lock.yaml
playwright-report
test-results
test/fixtures
```

`.gitignore`:
```
node_modules
dist
playwright-report
test-results
.DS_Store
```

`.nvmrc`:
```
22
```

- [ ] **Step 4: Write index.html and a placeholder src/main.tsx**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="theme-color" content="#111" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Learning Lab</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx` (placeholder, replaced in Task 9):
```tsx
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(<h1>Learning Lab</h1>);
```

Add `declare const __APP_VERSION__: string;` in `src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: lockfile created, no errors.

- [ ] **Step 6: Write the failing Emitter test**

`test/unit/core/events.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../../../src/core/events";

type Ev = { ping: [number]; multi: [string, boolean] };
class T extends Emitter<Ev> {
  fire(n: number) { this.emit("ping", n); }
  fireMulti() { this.emit("multi", "a", true); }
}

test("on receives emitted args", () => {
  const t = new T();
  const got: number[] = [];
  t.on("ping", (n) => got.push(n));
  t.fire(1); t.fire(2);
  assert.deepEqual(got, [1, 2]);
});

test("unsubscribe stops delivery", () => {
  const t = new T();
  const got: number[] = [];
  const off = t.on("ping", (n) => got.push(n));
  t.fire(1); off(); t.fire(2);
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
  const off = t.on("ping", () => { calls++; off(); });
  t.on("ping", () => calls++);
  t.fire(1);
  assert.equal(calls, 2);
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `src/core/events`.

- [ ] **Step 8: Implement Emitter**

`src/core/events.ts`:
```ts
export type EventMap = Record<string, unknown[]>;
type Listener<A extends unknown[]> = (...args: A) => void;

export class Emitter<E extends EventMap> {
  private listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  on<K extends keyof E>(name: K, cb: Listener<E[K]>): () => void {
    const set = (this.listeners[name] ??= new Set());
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  protected emit<K extends keyof E>(name: K, ...args: E[K]): void {
    const set = this.listeners[name];
    if (!set) return;
    for (const cb of [...set]) cb(...args);
  }
}
```

- [ ] **Step 9: Run tests, typecheck, lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 4 tests pass; typecheck clean; lint clean (run `pnpm format` first if Prettier complains).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite+react+ts, eslint core boundary, node:test; add Emitter"
```

---

### Task 2: Zod schemas

**Files:**
- Create: `src/schemas/ws.ts`, `src/schemas/sdpPayload.ts`, `src/schemas/protocol.ts`, `src/schemas/storage.ts`
- Test: `test/unit/schemas/protocol.test.ts`, `test/unit/schemas/storage.test.ts`, `test/unit/schemas/sdpPayload.test.ts`

**Interfaces:**
- Produces: `WsSchema`, `WsParamSchema`, `SdpPayloadSchema`/`SdpPayload`, `CompactPayloadSchema`/`CompactPayload`, `LabMessageSchema`/`LabMessage` and per-message types `HelloMessage`, `HbMessage`, `HbAckMessage`, `StatusMessage`, `CmdMessage`, `ChunkMessage`, `MAX_FRAME_BYTES = 16384`, `StudentStateSchema`/`StudentState`, `TeacherStateSchema`/`TeacherState`, `SettingsSchema`/`Settings`, `RosterEntrySchema`, `STUDENT_KEY`, `TEACHER_KEY`.

- [ ] **Step 1: Write failing schema tests**

`test/unit/schemas/protocol.test.ts`:
```ts
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
  for (const m of bad) assert.equal(LabMessageSchema.safeParse(m).success, false, JSON.stringify(m));
});

test("frame limit is Safari's 16 KiB", () => {
  assert.equal(MAX_FRAME_BYTES, 16384);
});
```

`test/unit/schemas/storage.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StudentStateSchema, TeacherStateSchema, STUDENT_KEY, TEACHER_KEY } from "../../../src/schemas/storage";

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
```

`test/unit/schemas/sdpPayload.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SdpPayloadSchema, CompactPayloadSchema } from "../../../src/schemas/sdpPayload";

const base = {
  v: 1, role: "offer", ws: 7, mid: "0", ufrag: "kJ3q", pwd: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
  fp: new Uint8Array(32), setup: "actpass", cands: [{ ip: "192.168.1.42", port: 54321, proto: "udp" }],
};

test("accepts a valid payload", () => {
  assert.equal(SdpPayloadSchema.safeParse(base).success, true);
});

test("rejects wrong fingerprint length and empty candidates", () => {
  assert.equal(SdpPayloadSchema.safeParse({ ...base, fp: new Uint8Array(20) }).success, false);
  assert.equal(SdpPayloadSchema.safeParse({ ...base, cands: [] }).success, false);
});

test("compact form requires 43-char base64url fingerprint", () => {
  const c = { v: 1, r: "o", w: 7, m: "0", u: "kJ3q", p: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul", f: "A".repeat(43), s: "actpass", c: [["192.168.1.42", 54321]] };
  assert.equal(CompactPayloadSchema.safeParse(c).success, true);
  assert.equal(CompactPayloadSchema.safeParse({ ...c, f: "A".repeat(42) }).success, false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement schemas**

`src/schemas/ws.ts`:
```ts
import { z } from "zod";

export const WS_MIN = 1;
export const WS_MAX = 30;
export const WsSchema = z.number().int().min(WS_MIN).max(WS_MAX);
/** For URL params: coerces "7" → 7. */
export const WsParamSchema = z.coerce.number().int().min(WS_MIN).max(WS_MAX);
export type Ws = z.infer<typeof WsSchema>;
```

`src/schemas/sdpPayload.ts`:
```ts
import { z } from "zod";
import { WsSchema } from "./ws";

export const SetupSchema = z.enum(["actpass", "active", "passive"]);
export const CandidateSchema = z.object({
  ip: z.string().min(2),
  port: z.number().int().min(1).max(65535),
  proto: z.literal("udp"),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Everything a peer cannot infer about our DataChannel-only SDP. */
export const SdpPayloadSchema = z.object({
  v: z.literal(1),
  role: z.enum(["offer", "answer"]),
  ws: WsSchema,
  mid: z.string().min(1).max(16),
  ufrag: z.string().min(4).max(256),
  pwd: z.string().min(22).max(256),
  fp: z.instanceof(Uint8Array).refine((b) => b.length === 32, "sha-256 fingerprint must be 32 bytes"),
  setup: SetupSchema,
  cands: z.array(CandidateSchema).min(1).max(8),
});
export type SdpPayload = z.infer<typeof SdpPayloadSchema>;

/** Short-key JSON form that is deflated into the QR. */
export const CompactPayloadSchema = z.object({
  v: z.literal(1),
  r: z.enum(["o", "a"]),
  w: WsSchema,
  m: z.string().min(1).max(16),
  u: z.string().min(4).max(256),
  p: z.string().min(22).max(256),
  f: z.string().length(43),
  s: SetupSchema,
  c: z.array(z.tuple([z.string().min(2), z.number().int().min(1).max(65535)])).min(1).max(8),
});
export type CompactPayload = z.infer<typeof CompactPayloadSchema>;
```

`src/schemas/protocol.ts`:
```ts
import { z } from "zod";
import { WsSchema } from "./ws";

/** Safari's DataChannel message limit. Larger messages are chunked. */
export const MAX_FRAME_BYTES = 16384;

export const HelloSchema = z.object({
  t: z.literal("hello"),
  role: z.enum(["student", "teacher"]),
  ws: WsSchema,
  appVersion: z.string().min(1).max(64),
  ua: z.string().max(512),
});
export const HbSchema = z.object({ t: z.literal("hb"), seq: z.number().int().nonnegative(), ts: z.number() });
export const HbAckSchema = z.object({ t: z.literal("hb-ack"), seq: z.number().int().nonnegative(), ts: z.number() });
export const StatusSchema = z.object({
  t: z.literal("status"),
  battery: z.number().min(0).max(1).optional(),
  charging: z.boolean().optional(),
  visibility: z.enum(["visible", "hidden"]),
  wakeLock: z.boolean(),
});
export const CmdSchema = z.object({ t: z.literal("cmd"), cmd: z.enum(["reload", "show-id", "ping"]) });
export const ChunkSchema = z.object({
  t: z.literal("chunk"),
  id: z.string().min(1).max(32),
  i: z.number().int().nonnegative(),
  n: z.number().int().min(1),
  data: z.string(),
});

export const LabMessageSchema = z.discriminatedUnion("t", [
  HelloSchema, HbSchema, HbAckSchema, StatusSchema, CmdSchema, ChunkSchema,
]);

export type HelloMessage = z.infer<typeof HelloSchema>;
export type HbMessage = z.infer<typeof HbSchema>;
export type HbAckMessage = z.infer<typeof HbAckSchema>;
export type StatusMessage = z.infer<typeof StatusSchema>;
export type CmdMessage = z.infer<typeof CmdSchema>;
export type ChunkMessage = z.infer<typeof ChunkSchema>;
export type LabMessage = z.infer<typeof LabMessageSchema>;

/** Reserved namespaces. Empty until their phase's spec exists. Do not squat. */
export type MediaMessage = never; // Phase 2: media.offer / media.answer / media.request
export type CollabMessage = never; // Phase 3
export type RecMessage = never; // Phase 4
export type LogMessage = never; // Phase 5
```

`src/schemas/storage.ts`:
```ts
import { z } from "zod";
import { WsSchema } from "./ws";

export const STUDENT_KEY = "lab.student.v1";
export const TEACHER_KEY = "lab.teacher.v1";

export const StudentStateSchema = z.object({
  ws: WsSchema,
  teacherAppVersion: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  pairCount: z.number().int().nonnegative().default(0),
});
export type StudentState = z.infer<typeof StudentStateSchema>;

export const RosterEntrySchema = z.object({
  label: z.string().max(64).optional(),
  lastConnectedAt: z.number().optional(),
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

export const TeacherStateSchema = z.object({
  roster: z.record(z.string(), RosterEntrySchema).default({}),
  settings: SettingsSchema.default({}),
});
export type TeacherState = z.infer<typeof TeacherStateSchema>;
```

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas test/unit/schemas
git commit -m "feat(schemas): zod schemas for sdp payload, dc protocol, storage"
```

---

### Task 3: Byte helpers + SDP codec

**Files:**
- Create: `src/core/bytes.ts`, `src/core/sdpCodec.ts`, `test/fixtures/sdp/chrome-offer.sdp`, `test/fixtures/sdp/safari-answer.sdp`
- Modify: `docs/superpowers/specs/2026-09-20-p2p-core-design.md` §3.1 (add `mid`)
- Test: `test/unit/core/bytes.test.ts`, `test/unit/core/sdpCodec.test.ts`

**Interfaces:**
- Consumes: `SdpPayloadSchema`, `CompactPayloadSchema` from Task 2.
- Produces: `toBase64Url(b: Uint8Array): string`, `fromBase64Url(s: string): Uint8Array`, `crc8(b: Uint8Array): number`, `deflateRaw(b): Promise<Uint8Array>`, `inflateRaw(b): Promise<Uint8Array>`; `extractPayload(sdp: string, role: "offer"|"answer", ws: number): SdpPayload`, `buildSdp(p: SdpPayload): string`, `encodeWire(p: SdpPayload): Promise<string>`, `decodeWire(wire: string): Promise<SdpPayload>`, `class CodecError extends Error`, `WIRE_PREFIX = "LAB1:"`.

- [ ] **Step 1: Add `mid` to spec §3.1**

In the spec's §3.1 payload block insert `mid: string,   // a=mid of the m=application section; answer must echo the offer's` after `ws`. Add to §3.2: "`a=mid` and `a=group:BUNDLE` use the transmitted `mid`."

- [ ] **Step 2: Write fixtures**

`test/fixtures/sdp/chrome-offer.sdp` (CRLF or LF both accepted by the parser):
```
v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:1467250027 1 udp 2122260223 192.168.1.42 54321 typ host generation 0 network-id 1 network-cost 10
a=candidate:2039283591 1 udp 2122194687 fd00::1a2b:3c4d:5e6f:7a8b 54322 typ host generation 0 network-id 2
a=candidate:3034527412 1 udp 2122129151 169.254.10.5 54323 typ host generation 0 network-id 3
a=candidate:3034527413 1 udp 2122129150 192.168.1.42 54321 typ host generation 0 network-id 1
a=ice-ufrag:kJ3q
a=ice-pwd:Yl6wO9zZ0z3XZ7RlN4CkO0Ul
a=ice-options:trickle
a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
```

`test/fixtures/sdp/safari-answer.sdp`:
```
v=0
o=- 8829356152651425622 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:842163049 1 UDP 2122260223 10.0.0.15 61234 typ host generation 0 network-id 1
a=candidate:842163050 1 UDP 2122194687 fe80::1c2d:3e4f:5a6b:7c8d 61235 typ host generation 0 network-id 2
a=ice-ufrag:Rt7P
a=ice-pwd:aBcDeFgHiJkLmNoPqRsTuVwXyZ012345
a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9
a=setup:active
a=mid:0
a=sctp-port:5000
a=max-message-size:65536
```

- [ ] **Step 3: Write failing tests**

`test/unit/core/bytes.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase64Url, fromBase64Url, crc8, deflateRaw, inflateRaw } from "../../../src/core/bytes";

test("base64url roundtrip for all lengths mod 3", () => {
  for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
    const b = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 255);
    const s = toBase64Url(b);
    assert.doesNotMatch(s, /[+/=]/);
    assert.deepEqual([...fromBase64Url(s)], [...b]);
  }
});

test("32 bytes encode to 43 chars", () => {
  assert.equal(toBase64Url(new Uint8Array(32)).length, 43);
});

test("fromBase64Url rejects illegal chars", () => {
  assert.throws(() => fromBase64Url("ab+c"));
});

test("crc8 known vector", () => {
  // CRC-8 poly 0x07, init 0, over "123456789" is 0xF4
  assert.equal(crc8(new TextEncoder().encode("123456789")), 0xf4);
});

test("deflate/inflate roundtrip and actually shrinks", async () => {
  const src = new TextEncoder().encode("a=candidate ".repeat(50));
  const packed = await deflateRaw(src);
  assert.ok(packed.length < src.length / 4);
  assert.deepEqual([...(await inflateRaw(packed))], [...src]);
});
```

`test/unit/core/sdpCodec.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPayload, buildSdp, encodeWire, decodeWire, CodecError, WIRE_PREFIX } from "../../../src/core/sdpCodec";

const chromeOffer = readFileSync(new URL("../../fixtures/sdp/chrome-offer.sdp", import.meta.url), "utf8");
const safariAnswer = readFileSync(new URL("../../fixtures/sdp/safari-answer.sdp", import.meta.url), "utf8");

test("extracts ice/dtls and host candidates, dropping link-local and duplicates", () => {
  const p = extractPayload(chromeOffer, "offer", 7);
  assert.equal(p.role, "offer");
  assert.equal(p.ws, 7);
  assert.equal(p.mid, "0");
  assert.equal(p.ufrag, "kJ3q");
  assert.equal(p.pwd, "Yl6wO9zZ0z3XZ7RlN4CkO0Ul");
  assert.equal(p.setup, "actpass");
  assert.equal(p.fp.length, 32);
  assert.equal(p.fp[0], 0x7b);
  assert.deepEqual(p.cands, [
    { ip: "192.168.1.42", port: 54321, proto: "udp" },
    { ip: "fd00::1a2b:3c4d:5e6f:7a8b", port: 54322, proto: "udp" },
  ]);
});

test("Safari answer: uppercase UDP, fe80 dropped, setup active", () => {
  const p = extractPayload(safariAnswer, "answer", 7);
  assert.equal(p.setup, "active");
  assert.deepEqual(p.cands, [{ ip: "10.0.0.15", port: 61234, proto: "udp" }]);
});

test("buildSdp emits a single application m-section with all attributes", () => {
  const sdp = buildSdp(extractPayload(chromeOffer, "offer", 7));
  const lines = sdp.split("\r\n");
  assert.equal(lines.filter((l) => l.startsWith("m=")).length, 1);
  assert.ok(lines.includes("m=application 9 UDP/DTLS/SCTP webrtc-datachannel"));
  assert.ok(lines.includes("a=ice-ufrag:kJ3q"));
  assert.ok(lines.includes("a=setup:actpass"));
  assert.ok(lines.includes("a=mid:0"));
  assert.ok(lines.includes("a=group:BUNDLE 0"));
  assert.ok(lines.includes("a=end-of-candidates"));
  assert.ok(lines.some((l) => l.startsWith("a=fingerprint:sha-256 7B:8B:F0:65")));
  assert.equal(lines.filter((l) => l.startsWith("a=candidate:")).length, 2);
  assert.ok(sdp.endsWith("\r\n"));
});

test("extract(build(extract(x))) is stable", () => {
  const p1 = extractPayload(chromeOffer, "offer", 7);
  const p2 = extractPayload(buildSdp(p1), "offer", 7);
  assert.deepEqual({ ...p2, fp: [...p2.fp] }, { ...p1, fp: [...p1.fp] });
});

test("wire roundtrip, prefix, size budget", async () => {
  const p = extractPayload(chromeOffer, "offer", 7);
  const wire = await encodeWire(p);
  assert.ok(wire.startsWith(WIRE_PREFIX));
  assert.ok(wire.length < 260, `wire too long: ${wire.length}`);
  const back = await decodeWire(wire);
  assert.deepEqual({ ...back, fp: [...back.fp] }, { ...p, fp: [...p.fp] });
});

test("decodeWire rejects bad prefix, bad crc, garbage", async () => {
  const wire = await encodeWire(extractPayload(chromeOffer, "offer", 7));
  await assert.rejects(decodeWire("NOPE:" + wire.slice(5)), CodecError);
  const flipped = wire.slice(0, -2) + (wire.endsWith("00") ? "01" : "00");
  await assert.rejects(decodeWire(flipped), CodecError);
  await assert.rejects(decodeWire(WIRE_PREFIX + "!!"), CodecError);
});

test("extractPayload throws on missing attributes", () => {
  assert.throws(() => extractPayload("v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n", "offer", 1));
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement bytes.ts**

```ts
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHA[(n >> 18) & 63]! + ALPHA[(n >> 12) & 63]!;
    if (b !== undefined) out += ALPHA[(n >> 6) & 63]!;
    if (c !== undefined) out += ALPHA[n & 63]!;
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const quad = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < quad.length; j++) {
      const v = ALPHA.indexOf(quad[j]!);
      if (v < 0) throw new Error(`illegal base64url char '${quad[j]}'`);
      n |= v << (18 - 6 * j);
    }
    out.push((n >> 16) & 255);
    if (quad.length > 2) out.push((n >> 8) & 255);
    if (quad.length > 3) out.push(n & 255);
  }
  return new Uint8Array(out);
}

/** CRC-8, polynomial 0x07, init 0x00, no reflection. */
export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  void w.write(data);
  void w.close();
  return pump(cs.readable);
}

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  void w.write(data);
  void w.close();
  return pump(ds.readable);
}
```

- [ ] **Step 6: Implement sdpCodec.ts**

```ts
import type { Candidate, CompactPayload, SdpPayload } from "../schemas/sdpPayload";
import { CompactPayloadSchema, SdpPayloadSchema } from "../schemas/sdpPayload";
import { crc8, deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from "./bytes";

export const WIRE_PREFIX = "LAB1:";

export class CodecError extends Error {
  override name = "CodecError";
}

const LINK_LOCAL = /^(169\.254\.|fe80:)/i;
const CANDIDATE = /^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/i;

export function extractPayload(sdp: string, role: "offer" | "answer", ws: number): SdpPayload {
  const lines = sdp.split(/\r?\n/);
  const attr = (name: string) =>
    lines.find((l) => l.startsWith(`a=${name}:`))?.slice(name.length + 3);
  const ufrag = attr("ice-ufrag");
  const pwd = attr("ice-pwd");
  const fpLine = attr("fingerprint");
  const setup = attr("setup");
  const mid = attr("mid");
  if (!ufrag || !pwd || !fpLine || !setup || !mid) {
    throw new CodecError("sdp missing ice-ufrag/ice-pwd/fingerprint/setup/mid");
  }
  const [alg, hex] = fpLine.trim().split(/\s+/);
  if (alg?.toLowerCase() !== "sha-256" || !hex) throw new CodecError("only sha-256 fingerprints are supported");
  const fp = new Uint8Array(hex.split(":").map((h) => parseInt(h, 16)));

  const cands: Candidate[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const m = CANDIDATE.exec(l);
    if (!m) continue;
    const ip = m[1]!;
    const port = Number(m[2]);
    const key = `${ip}:${port}`;
    if (LINK_LOCAL.test(ip) || seen.has(key)) continue;
    seen.add(key);
    cands.push({ ip, port, proto: "udp" });
  }
  return SdpPayloadSchema.parse({ v: 1, role, ws, mid, ufrag, pwd, fp, setup, cands });
}

export function buildSdp(p: SdpPayload): string {
  const payload = SdpPayloadSchema.parse(p);
  const fpHex = Array.from(payload.fp, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const cands = payload.cands.map(
    (c, i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${c.ip} ${c.port} typ host`,
  );
  return [
    "v=0",
    "o=- 2 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${payload.mid}`,
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${payload.ufrag}`,
    `a=ice-pwd:${payload.pwd}`,
    `a=fingerprint:sha-256 ${fpHex}`,
    `a=setup:${payload.setup}`,
    `a=mid:${payload.mid}`,
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    ...cands,
    "a=end-of-candidates",
    "",
  ].join("\r\n");
}

export function toCompact(p: SdpPayload): CompactPayload {
  return CompactPayloadSchema.parse({
    v: 1,
    r: p.role === "offer" ? "o" : "a",
    w: p.ws,
    m: p.mid,
    u: p.ufrag,
    p: p.pwd,
    f: toBase64Url(p.fp),
    s: p.setup,
    c: p.cands.map((c) => [c.ip, c.port] as [string, number]),
  });
}

export function fromCompact(c: CompactPayload): SdpPayload {
  return SdpPayloadSchema.parse({
    v: 1,
    role: c.r === "o" ? "offer" : "answer",
    ws: c.w,
    mid: c.m,
    ufrag: c.u,
    pwd: c.p,
    fp: fromBase64Url(c.f),
    setup: c.s,
    cands: c.c.map(([ip, port]) => ({ ip, port, proto: "udp" as const })),
  });
}

export async function encodeWire(p: SdpPayload): Promise<string> {
  const json = JSON.stringify(toCompact(SdpPayloadSchema.parse(p)));
  const packed = await deflateRaw(new TextEncoder().encode(json));
  return `${WIRE_PREFIX}${toBase64Url(packed)}${crc8(packed).toString(16).padStart(2, "0")}`;
}

export async function decodeWire(wire: string): Promise<SdpPayload> {
  if (!wire.startsWith(WIRE_PREFIX)) throw new CodecError("not a LAB1 payload");
  const body = wire.slice(WIRE_PREFIX.length);
  if (body.length < 4) throw new CodecError("payload too short");
  const crcHex = body.slice(-2);
  let packed: Uint8Array;
  try {
    packed = fromBase64Url(body.slice(0, -2));
  } catch (e) {
    throw new CodecError(`bad base64url: ${(e as Error).message}`);
  }
  if (crc8(packed) !== parseInt(crcHex, 16)) throw new CodecError("crc mismatch");
  let json: string;
  try {
    json = new TextDecoder().decode(await inflateRaw(packed));
  } catch {
    throw new CodecError("inflate failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CodecError("payload is not JSON");
  }
  const compact = CompactPayloadSchema.safeParse(parsed);
  if (!compact.success) throw new CodecError(`schema: ${compact.error.issues[0]?.message ?? "invalid"}`);
  return fromCompact(compact.data);
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass. If the wire-length assertion fails, print `wire.length`; anything under 260 is acceptable, adjust the bound only upward with a comment.

- [ ] **Step 8: Commit**

```bash
git add src/core/bytes.ts src/core/sdpCodec.ts test/unit/core test/fixtures docs/superpowers/specs
git commit -m "feat(core): sdp codec — extract, rebuild, LAB1 wire format with deflate+crc8"
```

---

### Task 4: Clock, ports, persistence, certificate store

**Files:**
- Create: `src/core/clock.ts`, `src/core/ports.ts`, `src/core/store.ts`, `src/core/certStore.ts`, `test/unit/helpers/fakeClock.ts`, `test/unit/helpers/memoryKv.ts`
- Test: `test/unit/core/store.test.ts`, `test/unit/core/certStore.test.ts`, `test/unit/helpers/fakeClock.test.ts`

**Interfaces:**
- Produces:
  - `interface Clock { now(): number; setTimeout(fn: () => void, ms: number): TimerHandle; clearTimeout(h: TimerHandle): void; setInterval(fn: () => void, ms: number): TimerHandle; clearInterval(h: TimerHandle): void }`, `type TimerHandle = ReturnType<typeof globalThis.setTimeout>`, `realClock: Clock`.
  - `interface RtcFactory { create(config: RTCConfiguration): RTCPeerConnection }`
  - `interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }`
  - `interface AsyncKv { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }`
  - `interface WakeLockPort { request(): Promise<boolean> }`
  - `interface DevicePort { visibility(): "visible" | "hidden"; onVisibility(cb: (v: "visible" | "hidden") => void): () => void; battery(): Promise<{ level: number; charging: boolean } | undefined> }`
  - `loadState<S extends z.ZodTypeAny>(kv, key, schema: S, fallback: z.infer<S>, log?: (m: string) => void): z.infer<S>`, `saveState<S>(kv, key, schema, value): void`
  - `getOrCreateCertificate(kv: AsyncKv, generate: () => Promise<RTCCertificate>): Promise<RTCCertificate>`, `CERT_KEY = "lab.cert.v1"`
  - Test helpers: `class FakeClock implements Clock { advance(ms: number): void }`, `class MemoryKv implements KeyValueStore`, `class MemoryAsyncKv implements AsyncKv`.

- [ ] **Step 1: Write failing tests**

`test/unit/helpers/fakeClock.test.ts`:
```ts
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
  c.setTimeout(() => { log.push(c.now()); c.setTimeout(() => log.push(c.now()), 5); }, 10);
  c.advance(20);
  assert.deepEqual(log, [10, 15]);
});
```

`test/unit/core/store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadState, saveState } from "../../../src/core/store";
import { MemoryKv } from "../helpers/memoryKv";

const S = z.object({ n: z.number().default(1), s: z.string().optional() });
const fallback = S.parse({});

test("missing key returns fallback without writing", () => {
  const kv = new MemoryKv();
  assert.deepEqual(loadState(kv, "k", S, fallback), { n: 1 });
  assert.equal(kv.get("k"), null);
});

test("valid blob parses with defaults applied", () => {
  const kv = new MemoryKv();
  kv.set("k", JSON.stringify({ s: "x" }));
  assert.deepEqual(loadState(kv, "k", S, fallback), { n: 1, s: "x" });
});

test("corrupt JSON resets to fallback and logs", () => {
  const kv = new MemoryKv();
  kv.set("k", "{not json");
  const logs: string[] = [];
  assert.deepEqual(loadState(kv, "k", S, fallback, (m) => logs.push(m)), { n: 1 });
  assert.equal(kv.get("k"), JSON.stringify(fallback));
  assert.equal(logs.length, 1);
});

test("schema-invalid blob resets to fallback", () => {
  const kv = new MemoryKv();
  kv.set("k", JSON.stringify({ n: "nope" }));
  assert.deepEqual(loadState(kv, "k", S, fallback), { n: 1 });
});

test("saveState validates before writing", () => {
  const kv = new MemoryKv();
  saveState(kv, "k", S, { n: 5 });
  assert.equal(kv.get("k"), JSON.stringify({ n: 5 }));
  assert.throws(() => saveState(kv, "k", S, { n: "bad" } as unknown as z.infer<typeof S>));
});
```

`test/unit/core/certStore.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateCertificate, CERT_KEY } from "../../../src/core/certStore";
import { MemoryAsyncKv } from "../helpers/memoryKv";

const fakeCert = (id: number) => ({ expires: Date.now() + 1e9, id }) as unknown as RTCCertificate;

test("generates once then reuses", async () => {
  const kv = new MemoryAsyncKv();
  let gen = 0;
  const generate = async () => fakeCert(++gen);
  const a = await getOrCreateCertificate(kv, generate);
  const b = await getOrCreateCertificate(kv, generate);
  assert.equal(gen, 1);
  assert.equal(a, b);
  assert.ok(await kv.get(CERT_KEY));
});

test("regenerates when stored cert is expired", async () => {
  const kv = new MemoryAsyncKv();
  await kv.set(CERT_KEY, { expires: Date.now() - 1000 });
  let gen = 0;
  await getOrCreateCertificate(kv, async () => fakeCert(++gen));
  assert.equal(gen, 1);
});

test("regenerates when store throws", async () => {
  const kv: import("../../../src/core/ports").AsyncKv = {
    get: async () => { throw new Error("idb down"); },
    set: async () => { throw new Error("idb down"); },
  };
  let gen = 0;
  const c = await getOrCreateCertificate(kv, async () => fakeCert(++gen));
  assert.equal(gen, 1);
  assert.ok(c);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement clock.ts and ports.ts**

`src/core/clock.ts`:
```ts
export type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(h: TimerHandle): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h),
};
```

`src/core/ports.ts`:
```ts
export interface RtcFactory {
  create(config: RTCConfiguration): RTCPeerConnection;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface AsyncKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface WakeLockPort {
  /** Resolves true if a screen wake lock is held. */
  request(): Promise<boolean>;
}

export type Visibility = "visible" | "hidden";

export interface DevicePort {
  visibility(): Visibility;
  onVisibility(cb: (v: Visibility) => void): () => void;
  battery(): Promise<{ level: number; charging: boolean } | undefined>;
}
```

- [ ] **Step 4: Implement store.ts and certStore.ts**

`src/core/store.ts`:
```ts
import type { z } from "zod";
import type { KeyValueStore } from "./ports";

export function loadState<S extends z.ZodTypeAny>(
  kv: KeyValueStore,
  key: string,
  schema: S,
  fallback: z.infer<S>,
  log: (msg: string) => void = () => {},
): z.infer<S> {
  const raw = kv.get(key);
  if (raw === null) return fallback;
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

`src/core/certStore.ts`:
```ts
import type { AsyncKv } from "./ports";

export const CERT_KEY = "lab.cert.v1";

function isLiveCert(v: unknown): v is RTCCertificate {
  return typeof v === "object" && v !== null && typeof (v as RTCCertificate).expires === "number" &&
    (v as RTCCertificate).expires > Date.now() + 24 * 3600 * 1000;
}

/** Stable DTLS certificate per device. Falls back to a fresh cert if storage misbehaves. */
export async function getOrCreateCertificate(
  kv: AsyncKv,
  generate: () => Promise<RTCCertificate>,
): Promise<RTCCertificate> {
  try {
    const stored = await kv.get(CERT_KEY);
    if (isLiveCert(stored)) return stored;
  } catch {
    // fall through
  }
  const cert = await generate();
  try {
    await kv.set(CERT_KEY, cert);
  } catch {
    // storage unavailable; cert still usable for this session
  }
  return cert;
}
```

- [ ] **Step 5: Implement test helpers**

`test/unit/helpers/fakeClock.ts`:
```ts
import type { Clock, TimerHandle } from "../../../src/core/clock";

interface Entry { at: number; fn: () => void; every?: number }

export class FakeClock implements Clock {
  private t = 0;
  private next = 1;
  private timers = new Map<number, Entry>();

  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id as unknown as TimerHandle;
  }
  clearTimeout(h: TimerHandle): void { this.timers.delete(h as unknown as number); }
  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id as unknown as TimerHandle;
  }
  clearInterval(h: TimerHandle): void { this.clearTimeout(h); }

  /** Advance virtual time, firing due timers in order (including ones scheduled meanwhile). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let dueId: number | undefined;
      let due: Entry | undefined;
      for (const [id, e] of this.timers) {
        if (e.at <= end && (due === undefined || e.at < due.at)) { dueId = id; due = e; }
      }
      if (due === undefined || dueId === undefined) break;
      this.t = due.at;
      if (due.every !== undefined) due.at += due.every; else this.timers.delete(dueId);
      due.fn();
    }
    this.t = end;
  }
}
```

`test/unit/helpers/memoryKv.ts`:
```ts
import type { AsyncKv, KeyValueStore } from "../../../src/core/ports";

export class MemoryKv implements KeyValueStore {
  private m = new Map<string, string>();
  get(key: string): string | null { return this.m.get(key) ?? null; }
  set(key: string, value: string): void { this.m.set(key, value); }
  remove(key: string): void { this.m.delete(key); }
}

export class MemoryAsyncKv implements AsyncKv {
  private m = new Map<string, unknown>();
  async get(key: string): Promise<unknown> { return this.m.get(key); }
  async set(key: string, value: unknown): Promise<void> { this.m.set(key, value); }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/clock.ts src/core/ports.ts src/core/store.ts src/core/certStore.ts test/unit
git commit -m "feat(core): clock/ports, zod-guarded persistence, certificate store, test fakes"
```

---

### Task 5: Heartbeat + chunker

**Files:**
- Create: `src/core/heartbeat.ts`, `src/core/chunker.ts`
- Test: `test/unit/core/heartbeat.test.ts`, `test/unit/core/chunker.test.ts`

**Interfaces:**
- Consumes: `Clock`, `HbMessage`, `HbAckMessage`, `ChunkMessage`, `MAX_FRAME_BYTES`.
- Produces:
  - `interface HeartbeatOpts { clock: Clock; intervalMs: number; missMs: number; send(m: HbMessage | HbAckMessage): void; onMiss(): void; onRecover(): void; onRtt(ms: number): void }`
  - `class Heartbeat { constructor(o: HeartbeatOpts); start(): void; stop(): void; handle(m: HbMessage | HbAckMessage): void; readonly missed: boolean }`
  - `chunkMessage(json: string, maxBytes: number): string[]`
  - `class Reassembler { push(c: ChunkMessage): string | undefined }`

- [ ] **Step 1: Write failing tests**

`test/unit/core/heartbeat.test.ts`:
```ts
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
    clock, intervalMs: 5000, missMs: 15000,
    send: (m) => sent.push(m),
    onMiss: () => ev.push("miss"), onRecover: () => ev.push("recover"), onRtt: (ms) => rtts.push(ms),
  });
  return { clock, sent, ev, rtts, hb };
}

test("sends hb every interval with increasing seq", () => {
  const { clock, sent, hb } = make();
  hb.start();
  clock.advance(15000);
  assert.deepEqual(sent.map((m) => m.t), ["hb", "hb", "hb"]);
  assert.deepEqual(sent.map((m) => m.seq), [0, 1, 2]);
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
```

`test/unit/core/chunker.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMessage, Reassembler } from "../../../src/core/chunker";
import { ChunkSchema, MAX_FRAME_BYTES } from "../../../src/schemas/protocol";

test("small message passes through untouched", () => {
  const json = JSON.stringify({ t: "hb", seq: 1, ts: 2 });
  assert.deepEqual(chunkMessage(json, MAX_FRAME_BYTES), [json]);
});

test("large message is split into valid chunk frames under the limit and reassembles", () => {
  const big = JSON.stringify({ t: "hello", role: "student", ws: 1, appVersion: "x", ua: "é".repeat(40000) });
  const frames = chunkMessage(big, MAX_FRAME_BYTES);
  assert.ok(frames.length > 1);
  const r = new Reassembler();
  let out: string | undefined;
  for (const f of frames) {
    assert.ok(new TextEncoder().encode(f).length <= MAX_FRAME_BYTES);
    const c = ChunkSchema.parse(JSON.parse(f));
    out = r.push(c);
  }
  assert.equal(out, big);
});

test("out-of-order and interleaved ids reassemble independently", () => {
  const a = "A".repeat(40000);
  const b = "B".repeat(40000);
  const fa = chunkMessage(a, MAX_FRAME_BYTES).map((f) => ChunkSchema.parse(JSON.parse(f)));
  const fb = chunkMessage(b, MAX_FRAME_BYTES).map((f) => ChunkSchema.parse(JSON.parse(f)));
  const r = new Reassembler();
  const results: string[] = [];
  for (const c of [fa[1]!, fb[0]!, fa[0]!, ...fa.slice(2), ...fb.slice(1)]) {
    const out = r.push(c);
    if (out !== undefined) results.push(out);
  }
  assert.deepEqual(results, [a, b]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement heartbeat.ts**

```ts
import type { Clock, TimerHandle } from "./clock";
import type { HbAckMessage, HbMessage } from "../schemas/protocol";

export interface HeartbeatOpts {
  clock: Clock;
  intervalMs: number;
  missMs: number;
  send(m: HbMessage | HbAckMessage): void;
  onMiss(): void;
  onRecover(): void;
  onRtt(ms: number): void;
}

export class Heartbeat {
  private seq = 0;
  private lastSeen: number;
  private timer: TimerHandle | undefined;
  missed = false;

  constructor(private readonly o: HeartbeatOpts) {
    this.lastSeen = o.clock.now();
  }

  start(): void {
    this.lastSeen = this.o.clock.now();
    this.timer = this.o.clock.setInterval(() => this.tick(), this.o.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) this.o.clock.clearInterval(this.timer);
    this.timer = undefined;
  }

  handle(m: HbMessage | HbAckMessage): void {
    const now = this.o.clock.now();
    this.lastSeen = now;
    if (m.t === "hb") this.o.send({ t: "hb-ack", seq: m.seq, ts: m.ts });
    else this.o.onRtt(Math.max(0, now - m.ts));
    if (this.missed) {
      this.missed = false;
      this.o.onRecover();
    }
  }

  private tick(): void {
    const now = this.o.clock.now();
    this.o.send({ t: "hb", seq: this.seq++, ts: now });
    if (!this.missed && now - this.lastSeen > this.o.missMs) {
      this.missed = true;
      this.o.onMiss();
    }
  }
}
```

- [ ] **Step 4: Implement chunker.ts**

```ts
import type { ChunkMessage } from "../schemas/protocol";

const enc = new TextEncoder();

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Returns the message itself if it fits, else JSON chunk frames each ≤ maxBytes. */
export function chunkMessage(json: string, maxBytes: number): string[] {
  if (enc.encode(json).length <= maxBytes) return [json];
  const id = randomId();
  // Overhead of the frame envelope (~80 bytes) plus UTF-8 expansion (≤3 bytes/char) leaves
  // maxBytes/4 chars per chunk comfortably under the limit.
  const size = Math.max(1, Math.floor(maxBytes / 4));
  const parts: string[] = [];
  for (let i = 0; i < json.length; i += size) parts.push(json.slice(i, i + size));
  return parts.map((data, i) =>
    JSON.stringify({ t: "chunk", id, i, n: parts.length, data } satisfies ChunkMessage),
  );
}

interface Pending { n: number; parts: (string | undefined)[]; got: number }

export class Reassembler {
  private pending = new Map<string, Pending>();

  /** Returns the whole message once the last chunk of an id arrives. */
  push(c: ChunkMessage): string | undefined {
    let p = this.pending.get(c.id);
    if (!p) {
      p = { n: c.n, parts: new Array<string | undefined>(c.n), got: 0 };
      this.pending.set(c.id, p);
    }
    if (c.i >= p.n || p.parts[c.i] !== undefined) return undefined;
    p.parts[c.i] = c.data;
    p.got++;
    if (p.got < p.n) return undefined;
    this.pending.delete(c.id);
    return p.parts.join("");
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/heartbeat.ts src/core/chunker.ts test/unit/core
git commit -m "feat(core): heartbeat with rtt/miss detection; 16KiB chunker + reassembler"
```

---

### Task 6: PeerSession state machine

**Files:**
- Create: `src/core/peerSession.ts`, `test/unit/helpers/fakeRtc.ts`
- Test: `test/unit/core/peerSession.test.ts`

**Interfaces:**
- Consumes: `Emitter`, `Clock`, `RtcFactory`, `extractPayload`, `buildSdp`, `Heartbeat`, `chunkMessage`, `Reassembler`, `LabMessageSchema`, `MAX_FRAME_BYTES`, `SdpPayload`.
- Produces:
  - `type SessionState = "idle" | "gathering" | "awaiting-remote" | "connecting" | "connected" | "degraded" | "failed"`
  - `interface SessionTimers { heartbeatMs; degradedMs; failedMs; connectMs; gatherMs }`, `DEFAULT_TIMERS`
  - `interface PeerSessionOpts { role: "student" | "teacher"; ws: number; rtc: RtcFactory; clock: Clock; timers?: Partial<SessionTimers>; certificates?: RTCCertificate[]; appVersion: string; ua: string }`
  - `type PeerSessionEvents = { state: [SessionState, SessionState]; localPayload: [SdpPayload]; message: [LabMessage]; hello: [HelloMessage]; rtt: [number]; needsRepair: [string]; ignored: [string] }`
  - `class PeerSession extends Emitter<PeerSessionEvents> { readonly role; readonly ws; state: SessionState; ignoredCount: number; lastRtt?: number; remoteHello?: HelloMessage; start(): Promise<void>; applyRemote(p: SdpPayload): Promise<void>; send(m: LabMessage): void; close(): void }`
  - Test helper: `class FakeRTCPeerConnection { completeGathering(); setIce(s: RTCIceConnectionState); incomingChannel(): FakeDataChannel; channels: FakeDataChannel[]; closed: boolean; remoteDescription }`, `class FakeDataChannel { open(); receive(s: string); sent: string[]; readyState }`, `class FakeRtcFactory implements RtcFactory { pcs: FakeRTCPeerConnection[] }`.

- [ ] **Step 1: Write the fake RTC helper**

`test/unit/helpers/fakeRtc.ts`:
```ts
import { readFileSync } from "node:fs";
import type { RtcFactory } from "../../../src/core/ports";

export const CHROME_OFFER = readFileSync(new URL("../../fixtures/sdp/chrome-offer.sdp", import.meta.url), "utf8");
export const SAFARI_ANSWER = readFileSync(new URL("../../fixtures/sdp/safari-answer.sdp", import.meta.url), "utf8");

export class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public readonly label: string) {}
  send(d: string): void {
    if (this.readyState !== "open") throw new Error("send on non-open channel");
    this.sent.push(d);
  }
  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  }
  open(): void { this.readyState = "open"; this.onopen?.(); }
  receive(s: string): void { this.onmessage?.({ data: s }); }
  /** Parsed JSON of everything sent. */
  sentJson(): unknown[] { return this.sent.map((s) => JSON.parse(s) as unknown); }
}

export class FakeRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  onicegatheringstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null = null;
  channels: FakeDataChannel[] = [];
  closed = false;
  constructor(public readonly config: RTCConfiguration) {}
  createDataChannel(label: string): FakeDataChannel {
    const dc = new FakeDataChannel(label);
    this.channels.push(dc);
    return dc;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: "offer", sdp: CHROME_OFFER }; }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return { type: "answer", sdp: SAFARI_ANSWER }; }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> { this.localDescription = d; }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> { this.remoteDescription = d; }
  close(): void { this.closed = true; }
  completeGathering(): void { this.iceGatheringState = "complete"; this.onicegatheringstatechange?.(); }
  setIce(s: RTCIceConnectionState): void { this.iceConnectionState = s; this.oniceconnectionstatechange?.(); }
  incomingChannel(): FakeDataChannel {
    const dc = new FakeDataChannel("lab");
    this.channels.push(dc);
    this.ondatachannel?.({ channel: dc });
    return dc;
  }
}

export class FakeRtcFactory implements RtcFactory {
  pcs: FakeRTCPeerConnection[] = [];
  create(config: RTCConfiguration): RTCPeerConnection {
    const pc = new FakeRTCPeerConnection(config);
    this.pcs.push(pc);
    return pc as unknown as RTCPeerConnection;
  }
  last(): FakeRTCPeerConnection {
    const pc = this.pcs[this.pcs.length - 1];
    if (!pc) throw new Error("no pc created");
    return pc;
  }
}

/** Let pending microtasks (awaits inside the session) settle. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
```

- [ ] **Step 2: Write failing PeerSession tests**

`test/unit/core/peerSession.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PeerSession, type SessionState } from "../../../src/core/peerSession";
import { extractPayload } from "../../../src/core/sdpCodec";
import { FakeClock } from "../helpers/fakeClock";
import { FakeRtcFactory, CHROME_OFFER, SAFARI_ANSWER, flush } from "../helpers/fakeRtc";

const TIMERS = { heartbeatMs: 5000, degradedMs: 15000, failedMs: 60000, connectMs: 20000, gatherMs: 3000 };
const offerPayload = extractPayload(CHROME_OFFER, "offer", 7);
const answerPayload = extractPayload(SAFARI_ANSWER, "answer", 7);

function student() {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const s = new PeerSession({ role: "student", ws: 7, rtc, clock, timers: TIMERS, appVersion: "t1", ua: "test" });
  const states: SessionState[] = [];
  s.on("state", (st) => states.push(st));
  return { rtc, clock, s, states };
}

async function connectedStudent() {
  const ctx = student();
  const p = ctx.s.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  await ctx.s.applyRemote(answerPayload);
  const dc = ctx.rtc.last().channels[0]!;
  dc.open();
  return { ...ctx, dc };
}

test("student: start → gathering → localPayload → awaiting-remote", async () => {
  const { rtc, s, states } = student();
  let local: unknown;
  s.on("localPayload", (p) => (local = p));
  const p = s.start();
  await flush();
  assert.equal(s.state, "gathering");
  rtc.last().completeGathering();
  await p;
  assert.deepEqual(states, ["gathering", "awaiting-remote"]);
  assert.equal((local as { role: string }).role, "offer");
  assert.equal(rtc.last().channels[0]?.label, "lab");
});

test("student: gathering proceeds after gatherMs even if never 'complete'", async () => {
  const { clock, s } = student();
  const p = s.start();
  await flush();
  clock.advance(3000);
  await p;
  assert.equal(s.state, "awaiting-remote");
});

test("student: applyRemote → connecting; dc open → connected; hello sent", async () => {
  const { s, dc, states } = await connectedStudent();
  assert.deepEqual(states, ["gathering", "awaiting-remote", "connecting", "connected"]);
  const first = dc.sentJson()[0] as { t: string; role: string; ws: number };
  assert.equal(first.t, "hello");
  assert.equal(first.role, "student");
  assert.equal(first.ws, 7);
  assert.equal((s as PeerSession).state, "connected");
});

test("student: rejects applyRemote with an offer or from wrong state", async () => {
  const { rtc, s } = student();
  await assert.rejects(s.applyRemote(answerPayload));
  const p = s.start();
  await flush();
  rtc.last().completeGathering();
  await p;
  await assert.rejects(s.applyRemote(offerPayload));
});

test("connect timeout → failed + needsRepair; pc closed", async () => {
  const { rtc, clock, s } = student();
  const p = s.start();
  await flush();
  rtc.last().completeGathering();
  await p;
  await s.applyRemote(answerPayload);
  const reasons: string[] = [];
  s.on("needsRepair", (r) => reasons.push(r));
  clock.advance(20000);
  assert.equal(s.state, "failed");
  assert.equal(reasons.length, 1);
  assert.equal(rtc.last().closed, true);
});

test("heartbeat: sends hb; silence → degraded; more silence → failed", async () => {
  const { clock, dc, s, states } = await connectedStudent();
  clock.advance(5000);
  assert.equal((dc.sentJson()[1] as { t: string }).t, "hb");
  clock.advance(15000);
  assert.equal(s.state, "degraded");
  clock.advance(60000);
  assert.equal(s.state, "failed");
  assert.deepEqual(states.slice(-2), ["degraded", "failed"]);
});

test("degraded recovers on inbound hb-ack and reports rtt", async () => {
  const { clock, dc, s } = await connectedStudent();
  const rtts: number[] = [];
  s.on("rtt", (ms) => rtts.push(ms));
  clock.advance(20000);
  assert.equal(s.state, "degraded");
  dc.receive(JSON.stringify({ t: "hb-ack", seq: 0, ts: clock.now() - 12 }));
  assert.equal(s.state, "connected");
  assert.deepEqual(rtts, [12]);
  assert.equal(s.lastRtt, 12);
  clock.advance(60000);
  assert.notEqual(s.state, "failed", "degraded timer must be cleared on recovery");
});

test("ice disconnected → degraded; ice connected → connected; ice failed → failed", async () => {
  const { rtc, s } = await connectedStudent();
  rtc.last().setIce("disconnected");
  assert.equal(s.state, "degraded");
  rtc.last().setIce("connected");
  assert.equal(s.state, "connected");
  rtc.last().setIce("failed");
  assert.equal(s.state, "failed");
});

test("inbound hb gets hb-ack; hello recorded; other messages emitted", async () => {
  const { dc, s } = await connectedStudent();
  const got: unknown[] = [];
  s.on("message", (m) => got.push(m));
  dc.receive(JSON.stringify({ t: "hb", seq: 3, ts: 99 }));
  assert.deepEqual(dc.sentJson().at(-1), { t: "hb-ack", seq: 3, ts: 99 });
  dc.receive(JSON.stringify({ t: "hello", role: "teacher", ws: 7, appVersion: "t1", ua: "mac" }));
  assert.equal(s.remoteHello?.role, "teacher");
  dc.receive(JSON.stringify({ t: "cmd", cmd: "ping" }));
  assert.deepEqual(got, [{ t: "cmd", cmd: "ping" }]);
});

test("garbage and unknown t are ignored and counted, never thrown", async () => {
  const { dc, s } = await connectedStudent();
  dc.receive("not json");
  dc.receive(JSON.stringify({ t: "evil" }));
  dc.receive(JSON.stringify({ t: "cmd", cmd: "rm-rf" }));
  assert.equal(s.ignoredCount, 3);
  assert.equal(s.state, "connected");
});

test("chunked inbound frames reassemble into one message", async () => {
  const { dc, s } = await connectedStudent();
  const got: unknown[] = [];
  s.on("message", (m) => got.push(m));
  const whole = JSON.stringify({ t: "cmd", cmd: "show-id" });
  dc.receive(JSON.stringify({ t: "chunk", id: "x", i: 0, n: 2, data: whole.slice(0, 5) }));
  dc.receive(JSON.stringify({ t: "chunk", id: "x", i: 1, n: 2, data: whole.slice(5) }));
  assert.deepEqual(got, [{ t: "cmd", cmd: "show-id" }]);
});

test("send validates outbound and is a no-op when channel not open", async () => {
  const { s } = student();
  s.send({ t: "cmd", cmd: "ping" }); // idle, no channel: no throw
  const c = await connectedStudent();
  assert.throws(() => c.s.send({ t: "cmd", cmd: "nope" } as never));
  c.s.send({ t: "status", visibility: "visible", wakeLock: true });
  assert.deepEqual(c.dc.sentJson().at(-1), { t: "status", visibility: "visible", wakeLock: true });
});

test("dc close → failed", async () => {
  const { dc, s } = await connectedStudent();
  dc.close();
  assert.equal(s.state, "failed");
});

test("close() tears down silently: state failed, no needsRepair", async () => {
  const { s, rtc } = await connectedStudent();
  let repairs = 0;
  s.on("needsRepair", () => repairs++);
  s.close();
  assert.equal(s.state, "failed");
  assert.equal(repairs, 0);
  assert.equal(rtc.last().closed, true);
});

test("teacher: applyRemote(offer) from idle → gathering → localPayload(answer) → connecting → connected", async () => {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const t = new PeerSession({ role: "teacher", ws: 7, rtc, clock, timers: TIMERS, appVersion: "t1", ua: "mac" });
  const states: SessionState[] = [];
  t.on("state", (st) => states.push(st));
  let local: { role: string } | undefined;
  t.on("localPayload", (p) => (local = p));
  const p = t.applyRemote(offerPayload);
  await flush();
  assert.equal(t.state, "gathering");
  assert.ok(rtc.last().remoteDescription?.sdp?.includes("a=ice-ufrag:kJ3q"));
  rtc.last().completeGathering();
  await p;
  assert.equal(local?.role, "answer");
  assert.deepEqual(states, ["gathering", "connecting"]);
  const dc = rtc.last().incomingChannel();
  dc.open();
  assert.equal(t.state, "connected");
  assert.equal((dc.sentJson()[0] as { role: string }).role, "teacher");
});

test("teacher: start() is rejected", async () => {
  const t = new PeerSession({ role: "teacher", ws: 1, rtc: new FakeRtcFactory(), clock: new FakeClock(), appVersion: "t", ua: "u" });
  await assert.rejects(t.start());
});

test("passes certificates into the pc config", async () => {
  const rtc = new FakeRtcFactory();
  const cert = { expires: 1 } as unknown as RTCCertificate;
  const s = new PeerSession({ role: "student", ws: 1, rtc, clock: new FakeClock(), certificates: [cert], appVersion: "t", ua: "u" });
  const p = s.start();
  await flush();
  assert.deepEqual(rtc.last().config.certificates, [cert]);
  rtc.last().completeGathering();
  await p;
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — `src/core/peerSession` not found.

- [ ] **Step 4: Implement peerSession.ts**

```ts
import type { HelloMessage, LabMessage } from "../schemas/protocol";
import { LabMessageSchema, MAX_FRAME_BYTES } from "../schemas/protocol";
import type { SdpPayload } from "../schemas/sdpPayload";
import { chunkMessage, Reassembler } from "./chunker";
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import { Heartbeat } from "./heartbeat";
import type { RtcFactory } from "./ports";
import { buildSdp, extractPayload } from "./sdpCodec";

export type SessionState =
  | "idle" | "gathering" | "awaiting-remote" | "connecting" | "connected" | "degraded" | "failed";

export interface SessionTimers {
  heartbeatMs: number;
  degradedMs: number;
  failedMs: number;
  connectMs: number;
  gatherMs: number;
}

export const DEFAULT_TIMERS: SessionTimers = {
  heartbeatMs: 5000, degradedMs: 15000, failedMs: 60000, connectMs: 20000, gatherMs: 3000,
};

export interface PeerSessionOpts {
  role: "student" | "teacher";
  ws: number;
  rtc: RtcFactory;
  clock: Clock;
  timers?: Partial<SessionTimers>;
  certificates?: RTCCertificate[];
  appVersion: string;
  ua: string;
}

export type PeerSessionEvents = {
  state: [SessionState, SessionState];
  localPayload: [SdpPayload];
  message: [LabMessage];
  hello: [HelloMessage];
  rtt: [number];
  needsRepair: [string];
  ignored: [string];
};

/**
 * One RTCPeerConnection + one "lab" DataChannel. Student offers, teacher answers.
 * Transient trouble → degraded (do nothing, trust ICE). Hard failure → failed → needsRepair.
 */
export class PeerSession extends Emitter<PeerSessionEvents> {
  readonly role: "student" | "teacher";
  readonly ws: number;
  state: SessionState = "idle";
  ignoredCount = 0;
  lastRtt: number | undefined;
  remoteHello: HelloMessage | undefined;

  private readonly timers: SessionTimers;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private hb: Heartbeat | null = null;
  private readonly reasm = new Reassembler();
  private connectTimer: TimerHandle | undefined;
  private degradedTimer: TimerHandle | undefined;
  private done = false;

  constructor(private readonly opts: PeerSessionOpts) {
    super();
    this.role = opts.role;
    this.ws = opts.ws;
    this.timers = { ...DEFAULT_TIMERS, ...opts.timers };
  }

  /** Student only: create the offer and publish it. */
  async start(): Promise<void> {
    if (this.role !== "student") throw new Error("only the student side offers");
    if (this.state !== "idle") throw new Error(`start() called in state ${this.state}`);
    const pc = this.createPc();
    this.attachChannel(pc.createDataChannel("lab", { ordered: true }));
    this.setState("gathering");
    await pc.setLocalDescription(await pc.createOffer());
    await this.waitGathering(pc);
    if (this.done) return;
    this.emit("localPayload", extractPayload(pc.localDescription?.sdp ?? "", "offer", this.ws));
    this.setState("awaiting-remote");
  }

  /** Student: apply the teacher's answer. Teacher: accept the student's offer and publish an answer. */
  async applyRemote(remote: SdpPayload): Promise<void> {
    if (this.role === "student") {
      if (this.state !== "awaiting-remote") throw new Error(`applyRemote in state ${this.state}`);
      if (remote.role !== "answer") throw new Error("student expects an answer");
      if (!this.pc) throw new Error("no peer connection");
      await this.pc.setRemoteDescription({ type: "answer", sdp: buildSdp(remote) });
      if (this.done) return;
      this.setState("connecting");
      this.armConnectTimer();
      return;
    }
    if (this.state !== "idle") throw new Error(`applyRemote in state ${this.state}`);
    if (remote.role !== "offer") throw new Error("teacher expects an offer");
    const pc = this.createPc();
    pc.ondatachannel = (ev) => this.attachChannel(ev.channel);
    this.setState("gathering");
    await pc.setRemoteDescription({ type: "offer", sdp: buildSdp(remote) });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.waitGathering(pc);
    if (this.done) return;
    this.emit("localPayload", extractPayload(pc.localDescription?.sdp ?? "", "answer", this.ws));
    this.setState("connecting");
    this.armConnectTimer();
  }

  /** Outbound boundary: validate, chunk if needed, drop silently if channel not open. */
  send(m: LabMessage): void {
    const parsed = LabMessageSchema.parse(m);
    if (!this.dc || this.dc.readyState !== "open") return;
    for (const frame of chunkMessage(JSON.stringify(parsed), MAX_FRAME_BYTES)) this.dc.send(frame);
  }

  /** Tear down without signalling a repair (used when replacing a session deliberately). */
  close(): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.setState("failed");
  }

  // ---- internals ----

  private createPc(): RTCPeerConnection {
    const config: RTCConfiguration = { iceServers: [] };
    if (this.opts.certificates) config.certificates = this.opts.certificates;
    const pc = this.opts.rtc.create(config);
    pc.oniceconnectionstatechange = () => this.onIce(pc.iceConnectionState);
    this.pc = pc;
    return pc;
  }

  private waitGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const t = this.opts.clock.setTimeout(resolve, this.timers.gatherMs);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          this.opts.clock.clearTimeout(t);
          resolve();
        }
      };
    });
  }

  private attachChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => this.onOpen();
    dc.onclose = () => this.fail("datachannel closed");
    dc.onmessage = (ev) => this.onFrame(String(ev.data));
  }

  private onOpen(): void {
    if (this.done) return;
    this.clearConnectTimer();
    this.setState("connected");
    this.hb = new Heartbeat({
      clock: this.opts.clock,
      intervalMs: this.timers.heartbeatMs,
      missMs: this.timers.degradedMs,
      send: (m) => this.send(m),
      onMiss: () => this.degrade("heartbeat silence"),
      onRecover: () => this.recover(),
      onRtt: (ms) => {
        this.lastRtt = ms;
        this.emit("rtt", ms);
      },
    });
    this.hb.start();
    this.send({ t: "hello", role: this.role, ws: this.ws, appVersion: this.opts.appVersion, ua: this.opts.ua });
  }

  /** Inbound boundary: JSON → Zod → route. Never throws. */
  private onFrame(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.ignore("not json");
    }
    const r = LabMessageSchema.safeParse(json);
    if (!r.success) return this.ignore("schema");
    const m = r.data;
    switch (m.t) {
      case "chunk": {
        const whole = this.reasm.push(m);
        if (whole !== undefined) this.onFrame(whole);
        return;
      }
      case "hb":
      case "hb-ack":
        this.hb?.handle(m);
        return;
      case "hello":
        this.remoteHello = m;
        this.emit("hello", m);
        return;
      default:
        this.emit("message", m);
    }
  }

  private ignore(why: string): void {
    this.ignoredCount++;
    this.emit("ignored", why);
  }

  private onIce(s: RTCIceConnectionState): void {
    if (this.done) return;
    if (s === "failed") return this.fail("ice failed");
    if (s === "disconnected") this.degrade("ice disconnected");
    if (s === "connected" || s === "completed") this.recover();
  }

  private degrade(reason: string): void {
    if (this.state !== "connected") return;
    this.setState("degraded");
    this.degradedTimer = this.opts.clock.setTimeout(
      () => this.fail(`degraded for ${this.timers.failedMs}ms (${reason})`),
      this.timers.failedMs,
    );
  }

  private recover(): void {
    if (this.state !== "degraded") return;
    if (this.degradedTimer !== undefined) this.opts.clock.clearTimeout(this.degradedTimer);
    this.degradedTimer = undefined;
    this.setState("connected");
  }

  private armConnectTimer(): void {
    this.connectTimer = this.opts.clock.setTimeout(() => this.fail("connect timeout"), this.timers.connectMs);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined) this.opts.clock.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private fail(reason: string): void {
    if (this.done) return;
    this.done = true;
    this.teardown();
    this.setState("failed");
    this.emit("needsRepair", reason);
  }

  private teardown(): void {
    this.clearConnectTimer();
    if (this.degradedTimer !== undefined) this.opts.clock.clearTimeout(this.degradedTimer);
    this.hb?.stop();
    this.hb = null;
    if (this.dc) {
      this.dc.onclose = null;
      this.dc.onmessage = null;
      this.dc.onopen = null;
      try { this.dc.close(); } catch { /* already closed */ }
    }
    if (this.pc) {
      this.pc.oniceconnectionstatechange = null;
      this.pc.onicegatheringstatechange = null;
      this.pc.ondatachannel = null;
      try { this.pc.close(); } catch { /* already closed */ }
    }
  }

  private setState(s: SessionState): void {
    const prev = this.state;
    if (prev === s) return;
    this.state = s;
    this.emit("state", s, prev);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass. If `noUncheckedIndexedAccess` complains in tests about `channels[0]`, the tests already use `!`; keep them that way.

- [ ] **Step 6: Commit**

```bash
git add src/core/peerSession.ts test/unit
git commit -m "feat(core): PeerSession state machine with heartbeat, degraded/failed, zod boundaries"
```

---

### Task 7: Student and Lab controllers

**Files:**
- Create: `src/core/studentController.ts`, `src/core/labController.ts`, `test/unit/helpers/fakeDevice.ts`
- Test: `test/unit/core/studentController.test.ts`, `test/unit/core/labController.test.ts`

**Interfaces:**
- Consumes: `PeerSession`, `SessionTimers`, `loadState`/`saveState`, `StudentStateSchema`, `TeacherStateSchema`, `STUDENT_KEY`, `TEACHER_KEY`, ports.
- Produces:
  - `interface StudentEnv { rtc: RtcFactory; clock: Clock; kv: KeyValueStore; wakeLock: WakeLockPort; device: DevicePort; reload(): void; appVersion: string; ua: string; certificates?: RTCCertificate[]; timers?: Partial<SessionTimers>; restartDelayMs?: number; log?(m: string): void }`
  - `type StudentEvents = { session: [PeerSession]; cmd: [CmdMessage["cmd"]]; state: [StudentState] }`
  - `class StudentController extends Emitter<StudentEvents> { readonly ws: number; session: PeerSession | null; state: StudentState; wakeLockHeld: boolean; static persistedWs(kv): number | undefined; constructor(env, ws); start(): void; stop(): void; pushStatus(): Promise<void> }`
  - `interface TeacherEnv { rtc; clock; kv; appVersion; ua; certificates?; log?(m: string): void }`
  - `interface RosterView { ws: number; state: SessionState | "never"; rtt?: number; label?: string; lastConnectedAt?: number; lastSeenUa?: string; battery?: number; charging?: boolean; visibility?: Visibility; wakeLock?: boolean; remoteAppVersion?: string; versionMismatch: boolean; history: { at: number; state: SessionState }[] }`
  - `type LabEvents = { change: [] }`
  - `class LabController extends Emitter<LabEvents> { state: TeacherState; readonly sessions: Map<number, PeerSession>; get settings(): Settings; updateSettings(p: Partial<Settings>): void; setLabel(ws, label): void; acceptOffer(offer: SdpPayload): Promise<SdpPayload>; sendCmd(ws, cmd): void; repairQueue(): number[]; snapshot(): RosterView[]; counts(): { connected: number; degraded: number; failed: number; never: number } }`
  - Test helper: `class FakeDevice implements DevicePort { vis: Visibility; setVisibility(v); batteryInfo? }`, `class FakeWakeLock implements WakeLockPort { requests: number; result: boolean }`.

- [ ] **Step 1: Write the device fakes**

`test/unit/helpers/fakeDevice.ts`:
```ts
import type { DevicePort, Visibility, WakeLockPort } from "../../../src/core/ports";

export class FakeDevice implements DevicePort {
  vis: Visibility = "visible";
  batteryInfo: { level: number; charging: boolean } | undefined = { level: 0.8, charging: true };
  private subs = new Set<(v: Visibility) => void>();
  visibility(): Visibility { return this.vis; }
  onVisibility(cb: (v: Visibility) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  async battery() { return this.batteryInfo; }
  setVisibility(v: Visibility): void {
    this.vis = v;
    for (const cb of this.subs) cb(v);
  }
}

export class FakeWakeLock implements WakeLockPort {
  requests = 0;
  result = true;
  async request(): Promise<boolean> {
    this.requests++;
    return this.result;
  }
}
```

- [ ] **Step 2: Write failing StudentController tests**

`test/unit/core/studentController.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StudentController } from "../../../src/core/studentController";
import { extractPayload } from "../../../src/core/sdpCodec";
import { STUDENT_KEY } from "../../../src/schemas/storage";
import { FakeClock } from "../helpers/fakeClock";
import { FakeDevice, FakeWakeLock } from "../helpers/fakeDevice";
import { MemoryKv } from "../helpers/memoryKv";
import { FakeRtcFactory, SAFARI_ANSWER, flush } from "../helpers/fakeRtc";

const answer = extractPayload(SAFARI_ANSWER, "answer", 7);

function make(ws = 7) {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const kv = new MemoryKv();
  const device = new FakeDevice();
  const wakeLock = new FakeWakeLock();
  let reloads = 0;
  const c = new StudentController(
    { rtc, clock, kv, device, wakeLock, reload: () => reloads++, appVersion: "v1", ua: "ipad", restartDelayMs: 500 },
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
  const saved = JSON.parse(ctx.kv.get(STUDENT_KEY)!) as { pairCount: number; lastConnectedAt?: number };
  assert.equal(saved.pairCount, 1);
  assert.equal(typeof saved.lastConnectedAt, "number");
  const status = dc.sentJson().find((m) => (m as { t: string }).t === "status") as Record<string, unknown>;
  assert.deepEqual(status, { t: "status", battery: 0.8, charging: true, visibility: "visible", wakeLock: true });
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
```

- [ ] **Step 3: Write failing LabController tests**

`test/unit/core/labController.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LabController } from "../../../src/core/labController";
import { extractPayload } from "../../../src/core/sdpCodec";
import { TEACHER_KEY } from "../../../src/schemas/storage";
import { FakeClock } from "../helpers/fakeClock";
import { MemoryKv } from "../helpers/memoryKv";
import { CHROME_OFFER, FakeRtcFactory, flush } from "../helpers/fakeRtc";

const offer = (ws: number) => extractPayload(CHROME_OFFER, "offer", ws);

function make() {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const kv = new MemoryKv();
  const lab = new LabController({ rtc, clock, kv, appVersion: "v1", ua: "mac" });
  return { rtc, clock, kv, lab };
}

async function pair(ctx: ReturnType<typeof make>, ws: number) {
  const p = ctx.lab.acceptOffer(offer(ws));
  await flush();
  ctx.rtc.last().completeGathering();
  const answer = await p;
  const dc = ctx.rtc.last().incomingChannel();
  dc.open();
  return { answer, dc };
}

test("fresh lab: 30 tiles never, repair queue is 1..30", () => {
  const { lab } = make();
  const snap = lab.snapshot();
  assert.equal(snap.length, 30);
  assert.ok(snap.every((t) => t.state === "never"));
  assert.deepEqual(lab.repairQueue(), Array.from({ length: 30 }, (_, i) => i + 1));
});

test("acceptOffer resolves with an answer payload for the same ws", async () => {
  const ctx = make();
  const { answer } = await pair(ctx, 7);
  assert.equal(answer.role, "answer");
  assert.equal(answer.ws, 7);
  assert.equal(ctx.lab.snapshot()[6]?.state, "connected");
  assert.ok(!ctx.lab.repairQueue().includes(7));
});

test("change event fires on state transitions and roster is persisted", async () => {
  const ctx = make();
  let changes = 0;
  ctx.lab.on("change", () => changes++);
  const { dc } = await pair(ctx, 3);
  assert.ok(changes >= 2);
  dc.receive(JSON.stringify({ t: "hello", role: "student", ws: 3, appVersion: "v1", ua: "iPad Safari" }));
  const saved = JSON.parse(ctx.kv.get(TEACHER_KEY)!) as { roster: Record<string, { pairCount: number; lastSeenUa?: string }> };
  assert.equal(saved.roster["3"]?.pairCount, 1);
  assert.equal(saved.roster["3"]?.lastSeenUa, "iPad Safari");
});

test("status messages populate the tile; version mismatch flagged", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 5);
  dc.receive(JSON.stringify({ t: "status", battery: 0.4, charging: false, visibility: "hidden", wakeLock: false }));
  dc.receive(JSON.stringify({ t: "hello", role: "student", ws: 5, appVersion: "v0", ua: "x" }));
  const tile = ctx.lab.snapshot()[4]!;
  assert.equal(tile.battery, 0.4);
  assert.equal(tile.visibility, "hidden");
  assert.equal(tile.versionMismatch, true);
  assert.equal(tile.remoteAppVersion, "v0");
});

test("re-accepting an offer for a connected ws replaces the session", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 2);
  const first = ctx.lab.sessions.get(2)!;
  let repairs = 0;
  first.on("needsRepair", () => repairs++);
  await pair(ctx, 2);
  assert.notEqual(ctx.lab.sessions.get(2), first);
  assert.equal(first.state, "failed");
  assert.equal(repairs, 0, "replacement is silent");
  assert.equal(dc.readyState, "closed");
});

test("failed session lands in repairQueue with history", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 9);
  dc.close();
  assert.ok(ctx.lab.repairQueue().includes(9));
  const tile = ctx.lab.snapshot()[8]!;
  assert.equal(tile.state, "failed");
  assert.deepEqual(tile.history.map((h) => h.state).slice(-2), ["connected", "failed"]);
});

test("settings update persists and is applied to new sessions", async () => {
  const ctx = make();
  ctx.lab.updateSettings({ heartbeatMs: 1000, degradedMs: 2000, failedMs: 3000 });
  assert.equal(JSON.parse(ctx.kv.get(TEACHER_KEY)!).settings.heartbeatMs, 1000);
  const { dc } = await pair(ctx, 1);
  ctx.clock.advance(1000);
  assert.equal((dc.sentJson().at(-1) as { t: string }).t, "hb");
  ctx.clock.advance(2000);
  assert.equal(ctx.lab.snapshot()[0]?.state, "degraded");
});

test("sendCmd routes to the right session and sets labels", async () => {
  const ctx = make();
  const { dc } = await pair(ctx, 4);
  ctx.lab.sendCmd(4, "ping");
  assert.deepEqual(dc.sentJson().at(-1), { t: "cmd", cmd: "ping" });
  ctx.lab.setLabel(4, "Row 1 seat 4");
  assert.equal(ctx.lab.snapshot()[3]?.label, "Row 1 seat 4");
  ctx.lab.sendCmd(29, "ping"); // no session: no throw
});

test("counts", async () => {
  const ctx = make();
  await pair(ctx, 1);
  const c = ctx.lab.counts();
  assert.deepEqual(c, { connected: 1, degraded: 0, failed: 0, never: 29 });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — controllers not found.

- [ ] **Step 5: Implement studentController.ts**

```ts
import type { CmdMessage } from "../schemas/protocol";
import type { StudentState } from "../schemas/storage";
import { STUDENT_KEY, StudentStateSchema } from "../schemas/storage";
import type { Clock } from "./clock";
import { Emitter } from "./events";
import { PeerSession, type SessionTimers } from "./peerSession";
import type { DevicePort, KeyValueStore, RtcFactory, WakeLockPort } from "./ports";
import { loadState, saveState } from "./store";

export interface StudentEnv {
  rtc: RtcFactory;
  clock: Clock;
  kv: KeyValueStore;
  wakeLock: WakeLockPort;
  device: DevicePort;
  reload(): void;
  appVersion: string;
  ua: string;
  certificates?: RTCCertificate[];
  timers?: Partial<SessionTimers>;
  restartDelayMs?: number;
  log?(msg: string): void;
}

export type StudentEvents = {
  session: [PeerSession];
  cmd: [CmdMessage["cmd"]];
  state: [StudentState];
};

/** Owns the one student PeerSession: spawns, persists, auto-restarts on failure, reports status. */
export class StudentController extends Emitter<StudentEvents> {
  readonly ws: number;
  session: PeerSession | null = null;
  state: StudentState;
  wakeLockHeld = false;
  private stopped = false;
  private offVisibility: (() => void) | undefined;

  static persistedWs(kv: KeyValueStore): number | undefined {
    const raw = kv.get(STUDENT_KEY);
    if (raw === null) return undefined;
    try {
      const r = StudentStateSchema.safeParse(JSON.parse(raw));
      return r.success ? r.data.ws : undefined;
    } catch {
      return undefined;
    }
  }

  constructor(private readonly env: StudentEnv, ws: number) {
    super();
    this.ws = ws;
    const log = env.log ?? (() => {});
    const loaded = loadState(env.kv, STUDENT_KEY, StudentStateSchema, StudentStateSchema.parse({ ws }), log);
    this.state = { ...loaded, ws };
    this.persist();
  }

  start(): void {
    this.stopped = false;
    this.offVisibility = this.env.device.onVisibility((v) => {
      if (v === "visible") void this.acquireWakeLock();
      void this.pushStatus();
    });
    void this.acquireWakeLock();
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    this.offVisibility?.();
    this.session?.close();
    this.session = null;
  }

  async pushStatus(): Promise<void> {
    const s = this.session;
    if (!s || s.state !== "connected" && s.state !== "degraded") return;
    const b = await this.env.device.battery();
    s.send({
      t: "status",
      ...(b ? { battery: b.level, charging: b.charging } : {}),
      visibility: this.env.device.visibility(),
      wakeLock: this.wakeLockHeld,
    });
  }

  private spawn(): void {
    if (this.stopped) return;
    const s = new PeerSession({
      role: "student",
      ws: this.ws,
      rtc: this.env.rtc,
      clock: this.env.clock,
      appVersion: this.env.appVersion,
      ua: this.env.ua,
      ...(this.env.timers ? { timers: this.env.timers } : {}),
      ...(this.env.certificates ? { certificates: this.env.certificates } : {}),
    });
    s.on("state", (st) => {
      if (st === "connected") {
        this.state.lastConnectedAt = this.env.clock.now();
        this.state.pairCount += 1;
        this.persist();
        void this.pushStatus();
      }
    });
    s.on("hello", (h) => {
      this.state.teacherAppVersion = h.appVersion;
      this.persist();
    });
    s.on("message", (m) => {
      if (m.t === "cmd") this.onCmd(m.cmd);
    });
    s.on("needsRepair", (reason) => {
      this.env.log?.(`session failed: ${reason}`);
      this.env.clock.setTimeout(() => {
        if (this.session === s) this.spawn();
      }, this.env.restartDelayMs ?? 500);
    });
    this.session = s;
    this.emit("session", s);
    s.start().catch((e: unknown) => this.env.log?.(`start failed: ${String(e)}`));
  }

  private onCmd(cmd: CmdMessage["cmd"]): void {
    this.emit("cmd", cmd);
    if (cmd === "ping") void this.pushStatus();
    if (cmd === "reload") this.env.reload();
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLockHeld = await this.env.wakeLock.request();
    } catch {
      this.wakeLockHeld = false;
    }
  }

  private persist(): void {
    saveState(this.env.kv, STUDENT_KEY, StudentStateSchema, this.state);
    this.emit("state", this.state);
  }
}
```

- [ ] **Step 6: Implement labController.ts**

```ts
import type { CmdMessage } from "../schemas/protocol";
import type { SdpPayload } from "../schemas/sdpPayload";
import type { Settings, TeacherState } from "../schemas/storage";
import { TEACHER_KEY, TeacherStateSchema } from "../schemas/storage";
import { WS_MAX, WS_MIN } from "../schemas/ws";
import type { Clock } from "./clock";
import { Emitter } from "./events";
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
  ws: number;
  state: SessionState | "never";
  rtt?: number;
  label?: string;
  lastConnectedAt?: number;
  lastSeenUa?: string;
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  versionMismatch: boolean;
  history: { at: number; state: SessionState }[];
}

interface Live {
  battery?: number;
  charging?: boolean;
  visibility?: Visibility;
  wakeLock?: boolean;
  remoteAppVersion?: string;
  history: { at: number; state: SessionState }[];
}

export type LabEvents = { change: [] };

const ALL_WS = Array.from({ length: WS_MAX - WS_MIN + 1 }, (_, i) => WS_MIN + i);

/** Teacher side: up to 30 PeerSessions, persisted roster metadata, repair queue. */
export class LabController extends Emitter<LabEvents> {
  state: TeacherState;
  readonly sessions = new Map<number, PeerSession>();
  private readonly live = new Map<number, Live>();

  constructor(private readonly env: TeacherEnv) {
    super();
    this.state = loadState(env.kv, TEACHER_KEY, TeacherStateSchema, TeacherStateSchema.parse({}), env.log);
  }

  get settings(): Settings {
    return this.state.settings;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    this.persist();
  }

  setLabel(ws: number, label: string): void {
    const e = this.entry(ws);
    e.label = label;
    this.persist();
  }

  /** Accept a student's offer; resolves with our answer payload once ICE gathering completes. */
  acceptOffer(offer: SdpPayload): Promise<SdpPayload> {
    const ws = offer.ws;
    this.sessions.get(ws)?.close();
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
    this.sessions.set(ws, s);
    this.live.set(ws, { history: [] });
    this.wire(s);

    const answer = new Promise<SdpPayload>((resolve, reject) => {
      const off = s.on("localPayload", (p) => {
        off();
        resolve(p);
      });
      s.applyRemote(offer).catch((e: unknown) => {
        off();
        reject(e);
      });
    });
    this.changed();
    return answer;
  }

  sendCmd(ws: number, cmd: CmdMessage["cmd"]): void {
    this.sessions.get(ws)?.send({ t: "cmd", cmd });
  }

  /** Stations that need a walk: never paired this run, or hard-failed. Ordered by ws. */
  repairQueue(): number[] {
    return ALL_WS.filter((ws) => {
      const st = this.sessions.get(ws)?.state;
      return st === undefined || st === "failed";
    });
  }

  snapshot(): RosterView[] {
    return ALL_WS.map((ws) => {
      const s = this.sessions.get(ws);
      const e = this.state.roster[String(ws)];
      const l = this.live.get(ws);
      const view: RosterView = {
        ws,
        state: s?.state ?? "never",
        versionMismatch: l?.remoteAppVersion !== undefined && l.remoteAppVersion !== this.env.appVersion,
        history: l?.history ?? [],
      };
      if (s?.lastRtt !== undefined) view.rtt = s.lastRtt;
      if (e?.label !== undefined) view.label = e.label;
      if (e?.lastConnectedAt !== undefined) view.lastConnectedAt = e.lastConnectedAt;
      if (e?.lastSeenUa !== undefined) view.lastSeenUa = e.lastSeenUa;
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

  private wire(s: PeerSession): void {
    const ws = s.ws;
    s.on("state", (st) => {
      this.live.get(ws)?.history.push({ at: this.env.clock.now(), state: st });
      if (st === "connected") {
        const e = this.entry(ws);
        e.lastConnectedAt = this.env.clock.now();
        e.pairCount += 1;
        this.persist();
      }
      this.changed();
    });
    s.on("hello", (h) => {
      const e = this.entry(ws);
      e.lastSeenUa = h.ua;
      const l = this.live.get(ws);
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
      const l = this.live.get(ws);
      if (!l) return;
      if (m.battery !== undefined) l.battery = m.battery;
      if (m.charging !== undefined) l.charging = m.charging;
      l.visibility = m.visibility;
      l.wakeLock = m.wakeLock;
      this.changed();
    });
    s.on("needsRepair", (reason) => this.env.log?.(`ws ${ws} failed: ${reason}`));
  }

  private entry(ws: number) {
    const key = String(ws);
    return (this.state.roster[key] ??= { pairCount: 0 });
  }

  private persist(): void {
    saveState(this.env.kv, TEACHER_KEY, TeacherStateSchema, this.state);
    this.changed();
  }

  private changed(): void {
    this.emit("change");
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/studentController.ts src/core/labController.ts test/unit
git commit -m "feat(core): StudentController (auto-restart, status, cmd) and LabController (roster, repair queue)"
```

---

### Task 8: Browser platform adapters, hooks, shared UI

**Files:**
- Create: `src/ui/platform/browserRtc.ts`, `src/ui/platform/browserKv.ts`, `src/ui/platform/browserWakeLock.ts`, `src/ui/platform/browserDevice.ts`, `src/ui/platform/idbKv.ts`, `src/ui/platform/cert.ts`, `src/ui/platform/camera.ts`, `src/ui/platform/appVersion.ts`, `src/ui/platform/barcodeDetector.d.ts`, `src/hooks/useSessionView.ts`, `src/hooks/useLabRoster.ts`, `src/hooks/useStudent.ts`, `src/hooks/usePromise.ts`, `src/ui/shared/QrView.tsx`, `src/ui/shared/Scanner.tsx`, `src/ui/shared/StatusPill.tsx`, `src/ui/shared/styles.css`

**Interfaces:**
- Consumes: ports from Task 4, `PeerSession`, `StudentController`, `LabController`, `encodeWire`/`decodeWire`.
- Produces:
  - `browserRtc: RtcFactory`, `browserKv: KeyValueStore`, `browserWakeLock: WakeLockPort`, `browserDevice: DevicePort`, `idbKv: AsyncKv`, `loadCertificate(): Promise<RTCCertificate[] | undefined>`, `primeCameraPermission(): Promise<boolean>`, `APP_VERSION: string`.
  - `useSessionView(session: PeerSession | null): { state: SessionState | "none"; localWire?: string; localRole?: "offer"|"answer"; rtt?: number }`
  - `useLabRoster(lab: LabController): { tiles: RosterView[]; queue: number[]; counts: ReturnType<LabController["counts"]>; settings: Settings }`
  - `useStudent(c: StudentController): { session: PeerSession | null; state: StudentState; lastCmd?: { cmd: string; at: number } }`
  - `usePromise<T>(p: Promise<T>): { value?: T; error?: Error }`
  - `<QrView wire={string} role="offer"|"answer" ws={number} size?={number} />` renders `<canvas data-payload={wire} data-role data-ws>`
  - `<Scanner onWire={(wire: string) => void} deviceId?={string} onError?={(e: Error) => void} />`
  - `<StatusPill state={SessionState | "never" | "none"} />` renders `<span data-state={state} class="pill pill-…">`

- [ ] **Step 1: Platform adapters**

`src/ui/platform/browserRtc.ts`:
```ts
import type { RtcFactory } from "../../core/ports";
export const browserRtc: RtcFactory = { create: (config) => new RTCPeerConnection(config) };
```

`src/ui/platform/browserKv.ts`:
```ts
import type { KeyValueStore } from "../../core/ports";
/** localStorage can throw (private mode, quota, ITP). Every call is guarded. */
export const browserKv: KeyValueStore = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
```

`src/ui/platform/browserWakeLock.ts`:
```ts
import type { WakeLockPort } from "../../core/ports";
let sentinel: WakeLockSentinel | null = null;
export const browserWakeLock: WakeLockPort = {
  async request() {
    if (!("wakeLock" in navigator)) return false;
    try {
      if (sentinel && !sentinel.released) return true;
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => { sentinel = null; });
      return true;
    } catch { return false; }
  },
};
```

`src/ui/platform/browserDevice.ts`:
```ts
import type { DevicePort, Visibility } from "../../core/ports";
interface BatteryLike { level: number; charging: boolean }
type NavWithBattery = Navigator & { getBattery?: () => Promise<BatteryLike> };
export const browserDevice: DevicePort = {
  visibility: (): Visibility => (document.visibilityState === "visible" ? "visible" : "hidden"),
  onVisibility(cb) {
    const h = () => cb(document.visibilityState === "visible" ? "visible" : "hidden");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  },
  async battery() {
    const nav = navigator as NavWithBattery;
    if (!nav.getBattery) return undefined; // Safari has no Battery API; that's fine
    try { const b = await nav.getBattery(); return { level: b.level, charging: b.charging }; } catch { return undefined; }
  },
};
```

`src/ui/platform/idbKv.ts`:
```ts
import type { AsyncKv } from "../../core/ports";
const DB = "lab", STORE = "kv";
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((res, rej) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
export const idbKv: AsyncKv = {
  get: (key) => tx("readonly", (s) => s.get(key) as IDBRequest<unknown>),
  set: (key, value) => tx("readwrite", (s) => s.put(value, key)).then(() => undefined),
};
```

`src/ui/platform/cert.ts`:
```ts
import { getOrCreateCertificate } from "../../core/certStore";
import { idbKv } from "./idbKv";
export async function loadCertificate(): Promise<RTCCertificate[] | undefined> {
  if (typeof RTCPeerConnection === "undefined" || !RTCPeerConnection.generateCertificate) return undefined;
  try {
    const cert = await getOrCreateCertificate(idbKv, () =>
      RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" } as EcKeyGenParams),
    );
    return [cert];
  } catch { return undefined; }
}
```

`src/ui/platform/camera.ts`:
```ts
/** Obtain camera permission so WebRTC emits real host IPs instead of mDNS names. Stream is stopped at once. */
export async function primeCameraPermission(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch { return false; }
}
```

`src/ui/platform/appVersion.ts`:
```ts
export const APP_VERSION: string = __APP_VERSION__;
```

`src/ui/platform/barcodeDetector.d.ts`:
```ts
interface DetectedBarcode { rawValue: string; format: string }
declare class BarcodeDetector {
  constructor(opts?: { formats?: string[] });
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
```

- [ ] **Step 2: Hooks**

`src/hooks/usePromise.ts`:
```ts
import { useEffect, useState } from "react";
export function usePromise<T>(p: Promise<T>): { value?: T; error?: Error } {
  const [r, setR] = useState<{ value?: T; error?: Error }>({});
  useEffect(() => {
    let live = true;
    p.then((value) => live && setR({ value }), (e: unknown) => live && setR({ error: e as Error }));
    return () => { live = false; };
  }, [p]);
  return r;
}
```

`src/hooks/useSessionView.ts`:
```ts
import { useEffect, useState } from "react";
import type { PeerSession, SessionState } from "../core/peerSession";
import { encodeWire } from "../core/sdpCodec";

export interface SessionView {
  state: SessionState | "none";
  localWire?: string;
  localRole?: "offer" | "answer";
  rtt?: number;
}

export function useSessionView(session: PeerSession | null): SessionView {
  const [view, setView] = useState<SessionView>({ state: session?.state ?? "none" });
  useEffect(() => {
    if (!session) { setView({ state: "none" }); return; }
    setView({ state: session.state, ...(session.lastRtt !== undefined ? { rtt: session.lastRtt } : {}) });
    const offs = [
      session.on("state", (s) => setView((v) => ({ ...v, state: s }))),
      session.on("rtt", (rtt) => setView((v) => ({ ...v, rtt }))),
      session.on("localPayload", (p) => {
        void encodeWire(p).then((localWire) => setView((v) => ({ ...v, localWire, localRole: p.role })));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [session]);
  return view;
}
```

`src/hooks/useStudent.ts`:
```ts
import { useEffect, useState } from "react";
import type { PeerSession } from "../core/peerSession";
import type { StudentController } from "../core/studentController";
import type { StudentState } from "../schemas/storage";

export function useStudent(c: StudentController) {
  const [session, setSession] = useState<PeerSession | null>(c.session);
  const [state, setState] = useState<StudentState>(c.state);
  const [lastCmd, setLastCmd] = useState<{ cmd: string; at: number } | undefined>();
  useEffect(() => {
    setSession(c.session);
    const offs = [
      c.on("session", setSession),
      c.on("state", (s) => setState({ ...s })),
      c.on("cmd", (cmd) => setLastCmd({ cmd, at: Date.now() })),
    ];
    return () => offs.forEach((off) => off());
  }, [c]);
  return { session, state, lastCmd };
}
```

`src/hooks/useLabRoster.ts`:
```ts
import { useEffect, useState } from "react";
import type { LabController } from "../core/labController";

function read(lab: LabController) {
  return { tiles: lab.snapshot(), queue: lab.repairQueue(), counts: lab.counts(), settings: lab.settings };
}

export function useLabRoster(lab: LabController) {
  const [v, setV] = useState(() => read(lab));
  useEffect(() => {
    setV(read(lab));
    return lab.on("change", () => setV(read(lab)));
  }, [lab]);
  return v;
}
```

- [ ] **Step 3: Shared UI**

`src/ui/shared/QrView.tsx`:
```tsx
import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export function QrView({ wire, role, ws, size = 480 }: { wire: string; role: "offer" | "answer"; ws: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, wire, { errorCorrectionLevel: "M", width: size, margin: 2 });
  }, [wire, size]);
  return <canvas ref={ref} className="qr" data-payload={wire} data-role={role} data-ws={ws} aria-label={`${role} code for workstation ${ws}`} />;
}
```

`src/ui/shared/Scanner.tsx`:
```tsx
import { useEffect, useRef } from "react";
import jsQR from "jsqr";

export function Scanner({ onWire, deviceId, onError }: { onWire: (wire: string) => void; deviceId?: string; onError?: (e: Error) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let raf = 0;
    let last = "";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const detector = typeof BarcodeDetector !== "undefined" ? new BarcodeDetector({ formats: ["qr_code"] }) : null;

    const loop = async () => {
      if (stop) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        let text: string | undefined;
        try {
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue;
          } else if (ctx) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height)?.data;
          }
        } catch { /* a bad frame is not an error */ }
        if (text && text !== last) { last = text; onWire(text); }
      }
      raf = requestAnimationFrame(() => void loop());
    };

    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
      });
      video.srcObject = stream;
      await video.play();
      void loop();
    })().catch((e: unknown) => onError?.(e as Error));

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId, onWire, onError]);
  return <video ref={videoRef} className="scanner" playsInline muted />;
}
```

`src/ui/shared/StatusPill.tsx`:
```tsx
import type { SessionState } from "../../core/peerSession";
export type PillState = SessionState | "never" | "none";
const LABEL: Record<PillState, string> = {
  idle: "Starting", gathering: "Starting", "awaiting-remote": "Waiting for teacher", connecting: "Connecting",
  connected: "Connected", degraded: "Unstable", failed: "Re-pair needed", never: "Not paired", none: "—",
};
export function StatusPill({ state }: { state: PillState }) {
  return <span className={`pill pill-${state}`} data-state={state}>{LABEL[state]}</span>;
}
```

`src/ui/shared/styles.css`:
```css
:root { color-scheme: dark; --bg:#111; --fg:#eee; --muted:#888; --green:#2ecc71; --amber:#f5b041; --red:#e74c3c; --blue:#3498db; --grey:#555; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 16px system-ui, sans-serif; }
.pill { padding: .25em .75em; border-radius: 999px; background: var(--grey); color: #000; font-weight: 600; white-space: nowrap; }
.pill-connected { background: var(--green); } .pill-degraded { background: var(--amber); }
.pill-failed, .pill-never { background: var(--red); } .pill-awaiting-remote, .pill-connecting, .pill-gathering, .pill-idle { background: var(--blue); }
.qr { background: #fff; padding: 12px; border-radius: 12px; max-width: 90vw; max-height: 60vh; }
.scanner { width: 100%; max-height: 70vh; object-fit: cover; border-radius: 12px; background: #000; }
.bar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: #000; }
.bar .ws { font-size: 2.5rem; font-weight: 800; }
.center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 16px; min-height: calc(100% - 72px); text-align: center; }
button { font: inherit; padding: .6em 1.2em; border-radius: 8px; border: 0; background: var(--blue); color: #fff; cursor: pointer; }
button.secondary { background: #333; color: var(--fg); }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; padding: 12px; }
.tile { background: #1c1c1c; border-radius: 10px; padding: 10px; cursor: pointer; border: 2px solid transparent; display: flex; flex-direction: column; gap: 6px; }
.tile[data-state="connected"] { border-color: var(--green); } .tile[data-state="degraded"] { border-color: var(--amber); }
.tile[data-state="failed"], .tile[data-state="never"] { border-color: var(--red); opacity: .85; }
.tile .num { font-size: 1.6rem; font-weight: 800; } .tile .meta { color: var(--muted); font-size: .85rem; }
.layout { display: grid; grid-template-columns: 1fr 260px; height: 100%; }
.side { border-left: 1px solid #222; padding: 12px; overflow: auto; }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: flex; align-items: center; justify-content: center; padding: 16px; }
.modal .card { background: #1c1c1c; border-radius: 12px; padding: 16px; max-width: 640px; width: 100%; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.overlay-id { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 40vmin; font-weight: 900; background: rgba(0,0,0,.9); }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #333; padding: 10px 16px; border-radius: 8px; }
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (No unit tests here: these files are browser-only glue; Tasks 12–13 exercise them under Playwright.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/platform src/hooks src/ui/shared
git commit -m "feat(ui): browser port adapters, core↔react hooks, QrView/Scanner/StatusPill"
```

---

### Task 9: Boot layer, router, Student route

**Files:**
- Create: `src/boot/testHook.ts`, `src/boot/bootStudent.ts`, `src/ui/student/StudentApp.tsx`, `src/ui/student/WsConflict.tsx`, `src/ui/HomePage.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Task 7 controllers, Task 8 adapters/hooks/components.
- Produces:
  - `window.__lab: { inject(wire: string): Promise<string | void>; role: string }` (test hook; always registered; teacher's inject resolves with the encoded answer wire)
  - `bootStudent(ws: number): Promise<StudentController>`
  - `resolveWs(): { ws?: number; urlWs?: number; storedWs?: number }` in `bootStudent.ts`
  - `<StudentApp boot={Promise<StudentController>} />`

- [ ] **Step 1: Test hook**

`src/boot/testHook.ts`:
```ts
declare global {
  interface Window { __lab?: { role: string; inject(wire: string): Promise<string | void> } }
}
/**
 * E2E tests and manual cross-tab checks bypass cameras by calling window.__lab.inject(wire) with
 * what the QR would carry. The teacher's hook resolves with the encoded answer wire.
 */
export function registerTestHook(role: string, inject: (wire: string) => Promise<string | void>): void {
  window.__lab = { role, inject };
}
```

- [ ] **Step 2: Student boot**

`src/boot/bootStudent.ts`:
```ts
import { realClock } from "../core/clock";
import { decodeWire } from "../core/sdpCodec";
import { StudentController } from "../core/studentController";
import { WsParamSchema } from "../schemas/ws";
import { APP_VERSION } from "../ui/platform/appVersion";
import { browserDevice } from "../ui/platform/browserDevice";
import { browserKv } from "../ui/platform/browserKv";
import { browserRtc } from "../ui/platform/browserRtc";
import { browserWakeLock } from "../ui/platform/browserWakeLock";
import { primeCameraPermission } from "../ui/platform/camera";
import { loadCertificate } from "../ui/platform/cert";
import { registerTestHook } from "./testHook";

export function resolveWs(): { urlWs?: number; storedWs?: number } {
  const out: { urlWs?: number; storedWs?: number } = {};
  const raw = new URLSearchParams(location.search).get("ws");
  const parsed = WsParamSchema.safeParse(raw);
  if (raw !== null && parsed.success) out.urlWs = parsed.data;
  const stored = StudentController.persistedWs(browserKv);
  if (stored !== undefined) out.storedWs = stored;
  return out;
}

export async function bootStudent(ws: number): Promise<StudentController> {
  await primeCameraPermission(); // real-IP candidates; failure is non-fatal
  const certificates = await loadCertificate();
  const c = new StudentController(
    {
      rtc: browserRtc, clock: realClock, kv: browserKv, wakeLock: browserWakeLock, device: browserDevice,
      reload: () => location.reload(), appVersion: APP_VERSION, ua: navigator.userAgent,
      ...(certificates ? { certificates } : {}),
      log: (m) => console.warn("[student]", m),
    },
    ws,
  );
  registerTestHook("student", async (wire) => {
    const p = await decodeWire(wire);
    await c.session?.applyRemote(p);
  });
  c.start();
  return c;
}
```

- [ ] **Step 3: Student UI**

`src/ui/student/WsConflict.tsx`:
```tsx
export function WsConflict({ urlWs, storedWs, onPick }: { urlWs: number; storedWs: number; onPick: (ws: number) => void }) {
  return (
    <div className="center">
      <h1>Which workstation is this?</h1>
      <p>This iPad was workstation <b>{storedWs}</b>, but the address says <b>{urlWs}</b>.</p>
      <div style={{ display: "flex", gap: 16 }}>
        <button onClick={() => onPick(urlWs)}>Switch to {urlWs}</button>
        <button className="secondary" onClick={() => onPick(storedWs)}>Stay {storedWs}</button>
      </div>
    </div>
  );
}
```

`src/ui/student/StudentApp.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import type { StudentController } from "../../core/studentController";
import { decodeWire } from "../../core/sdpCodec";
import { usePromise } from "../../hooks/usePromise";
import { useSessionView } from "../../hooks/useSessionView";
import { useStudent } from "../../hooks/useStudent";
import { APP_VERSION } from "../platform/appVersion";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";
import { StatusPill } from "../shared/StatusPill";

export function StudentApp({ boot }: { boot: Promise<StudentController> }) {
  const { value: c, error } = usePromise(boot);
  if (error) return <div className="center"><h1>Could not start</h1><pre>{error.message}</pre></div>;
  if (!c) return <div className="center"><h1>Starting…</h1></div>;
  return <StudentView c={c} />;
}

function StudentView({ c }: { c: StudentController }) {
  const { session, lastCmd } = useStudent(c);
  const view = useSessionView(session);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  const [showId, setShowId] = useState(false);

  useEffect(() => {
    if (view.state === "connected") setScanning(false);
    if (view.state === "failed") { setToast("Connection lost — showing a new code"); setTimeout(() => setToast(undefined), 4000); }
  }, [view.state]);

  useEffect(() => {
    if (lastCmd?.cmd === "show-id") { setShowId(true); const t = setTimeout(() => setShowId(false), 5000); return () => clearTimeout(t); }
  }, [lastCmd]);

  const onWire = useCallback((wire: string) => {
    void decodeWire(wire)
      .then((p) => session?.applyRemote(p))
      .catch((e: unknown) => { setToast(`Not a valid code: ${(e as Error).message}`); setTimeout(() => setToast(undefined), 3000); });
  }, [session]);

  return (
    <div data-state={view.state}>
      <header className="bar">
        <span className="ws">{c.ws}</span>
        <StatusPill state={view.state} />
        {view.rtt !== undefined && <span className="meta">{view.rtt} ms</span>}
        <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
      </header>
      <main className="center">
        {view.state === "awaiting-remote" && view.localWire && !scanning && (
          <>
            <QrView wire={view.localWire} role="offer" ws={c.ws} />
            <p>Waiting for teacher</p>
            <button onClick={() => setScanning(true)}>Show camera</button>
          </>
        )}
        {view.state === "awaiting-remote" && scanning && (
          <>
            <Scanner onWire={onWire} onError={(e) => setToast(`Camera: ${e.message}`)} />
            <p>Hold the phone's code up to the camera</p>
            <button className="secondary" onClick={() => setScanning(false)}>Back to my code</button>
          </>
        )}
        {view.state === "connecting" && <h2>Connecting…</h2>}
        {(view.state === "connected" || view.state === "degraded") && <h2 style={{ color: "var(--muted)" }}>Ready</h2>}
        {(view.state === "gathering" || view.state === "idle" || view.state === "none") && <h2>Starting…</h2>}
      </main>
      {showId && <div className="overlay-id">{c.ws}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Home page and router**

`src/ui/HomePage.tsx`:
```tsx
import { APP_VERSION } from "./platform/appVersion";
export function HomePage() {
  return (
    <div className="center">
      <h1>Learning Lab</h1>
      <p><a href="teacher">Teacher</a> · <a href="courier">Courier</a> · <a href="student?ws=1">Student 1</a></p>
      <p style={{ color: "var(--muted)" }}>{APP_VERSION}</p>
    </div>
  );
}
```

`src/main.tsx`:
```tsx
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootStudent, resolveWs } from "./boot/bootStudent";
import { HomePage } from "./ui/HomePage";
import { StudentApp } from "./ui/student/StudentApp";
import { WsConflict } from "./ui/student/WsConflict";
import "./ui/shared/styles.css";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const path = location.pathname.replace(base, "").replace(/\/+$/, "") || "/";

function StudentRoute() {
  const { urlWs, storedWs } = resolveWs();
  const [ws, setWs] = useState<number | undefined>(
    urlWs !== undefined && storedWs !== undefined && urlWs !== storedWs ? undefined : (urlWs ?? storedWs),
  );
  const [boot, setBoot] = useState<Promise<import("./core/studentController").StudentController> | undefined>(
    () => (ws !== undefined ? bootStudent(ws) : undefined),
  );
  if (ws === undefined && urlWs !== undefined && storedWs !== undefined) {
    return <WsConflict urlWs={urlWs} storedWs={storedWs} onPick={(w) => { setWs(w); setBoot(bootStudent(w)); }} />;
  }
  if (boot === undefined) return <div className="center"><h1>Open this page as /student?ws=N (1–30)</h1></div>;
  return <StudentApp boot={boot} />;
}

function route() {
  switch (path) {
    case "/student": return <StudentRoute />;
    default: return <HomePage />;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode>{route()}</StrictMode>);
```

(Teacher, courier and dev routes are added to this `switch` in Tasks 10, 11 and 13.)

- [ ] **Step 5: Manual check**

Run: `pnpm dev`, open `http://localhost:5173/student?ws=7` in Chrome. Allow camera. Expected: header shows `7`, pill "Waiting for teacher", a QR appears within ~1 s. Reload: no camera re-prompt, same flow. Open `/student` (no query): the persisted ws is used. Open `/student?ws=9`: conflict prompt appears.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/boot src/ui/student src/ui/HomePage.tsx src/main.tsx
git commit -m "feat(student): boot layer, ws resolution, offer QR + scanner UI, test hook"
```

---

### Task 10: Teacher route

**Files:**
- Create: `src/boot/bootTeacher.ts`, `src/ui/teacher/TeacherApp.tsx`, `src/ui/teacher/Tile.tsx`, `src/ui/teacher/ScanModal.tsx`, `src/ui/teacher/TileDrawer.tsx`, `src/ui/teacher/RepairQueue.tsx`
- Modify: `src/main.tsx` (add `/teacher` case)

**Interfaces:**
- Consumes: `LabController`, `useLabRoster`, `QrView`, `Scanner`, `StatusPill`, `encodeWire`/`decodeWire`.
- Produces: `bootTeacher(): Promise<LabController>`; `<TeacherApp boot />`. DOM contract for e2e: each tile is `[data-tile="N"][data-state=…]`; the answer QR is `canvas[data-payload][data-role="answer"][data-ws="N"]`; header counts are `[data-count="connected"]` etc.

- [ ] **Step 1: Teacher boot**

`src/boot/bootTeacher.ts`:
```ts
import { realClock } from "../core/clock";
import { LabController } from "../core/labController";
import { decodeWire, encodeWire } from "../core/sdpCodec";
import { APP_VERSION } from "../ui/platform/appVersion";
import { browserKv } from "../ui/platform/browserKv";
import { browserRtc } from "../ui/platform/browserRtc";
import { primeCameraPermission } from "../ui/platform/camera";
import { loadCertificate } from "../ui/platform/cert";
import { registerTestHook } from "./testHook";

export async function bootTeacher(): Promise<LabController> {
  await primeCameraPermission();
  const certificates = await loadCertificate();
  const lab = new LabController({
    rtc: browserRtc, clock: realClock, kv: browserKv, appVersion: APP_VERSION, ua: navigator.userAgent,
    ...(certificates ? { certificates } : {}),
    log: (m) => console.warn("[teacher]", m),
  });
  registerTestHook("teacher", async (wire) => {
    const p = await decodeWire(wire);
    if (p.role !== "offer") throw new Error("teacher expects an offer");
    return encodeWire(await lab.acceptOffer(p));
  });
  return lab;
}
```

- [ ] **Step 2: Tile, RepairQueue, TileDrawer**

`src/ui/teacher/Tile.tsx`:
```tsx
import type { RosterView } from "../../core/labController";
import { StatusPill } from "../shared/StatusPill";

function ago(ts?: number) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export function Tile({ t, onClick }: { t: RosterView; onClick: () => void }) {
  return (
    <div className="tile" data-tile={t.ws} data-state={t.state} onClick={onClick} role="button" tabIndex={0}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="num">{t.ws}</span>
        <StatusPill state={t.state} />
      </div>
      <div className="meta">{t.label ?? "—"}</div>
      <div className="meta">
        {t.rtt !== undefined && <span data-rtt>{t.rtt} ms · </span>}
        <span>seen {ago(t.lastConnectedAt)}</span>
      </div>
      <div className="meta">
        {t.battery !== undefined && <span>{t.charging ? "⚡" : "🔋"} {Math.round(t.battery * 100)}% </span>}
        {t.visibility === "hidden" && <span title="Screen hidden">🙈 </span>}
        {t.wakeLock === false && <span title="No wake lock">💤 </span>}
        {t.versionMismatch && <span title={`Student runs ${t.remoteAppVersion}`}>⚠️ version</span>}
      </div>
    </div>
  );
}
```

`src/ui/teacher/RepairQueue.tsx`:
```tsx
export function RepairQueue({ queue }: { queue: number[] }) {
  return (
    <aside className="side" data-repair-queue>
      <h3>Needs re-pair ({queue.length})</h3>
      {queue.length === 0 ? <p style={{ color: "var(--muted)" }}>All stations connected.</p> : (
        <ol>{queue.map((ws) => <li key={ws} data-queue-ws={ws}>Workstation {ws}</li>)}</ol>
      )}
    </aside>
  );
}
```

`src/ui/teacher/TileDrawer.tsx`:
```tsx
import { useState } from "react";
import type { LabController, RosterView } from "../../core/labController";

export function TileDrawer({ lab, t, onClose }: { lab: LabController; t: RosterView; onClose: () => void }) {
  const [label, setLabel] = useState(t.label ?? "");
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ alignItems: "stretch" }}>
        <h2>Workstation {t.ws}</h2>
        <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => lab.setLabel(t.ws, label)} /></label>
        <p className="meta">UA: {t.lastSeenUa ?? "—"}</p>
        <p className="meta">Student version: {t.remoteAppVersion ?? "—"}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => lab.sendCmd(t.ws, "ping")}>Ping</button>
          <button onClick={() => lab.sendCmd(t.ws, "show-id")}>Show ID on iPad</button>
          <button className="secondary" onClick={() => { if (confirm(`Reload workstation ${t.ws}? It will need re-pairing.`)) lab.sendCmd(t.ws, "reload"); }}>Reload</button>
        </div>
        <h3>History</h3>
        <ul className="meta">{t.history.slice(-20).reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleTimeString()} — {h.state}</li>)}</ul>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ScanModal**

`src/ui/teacher/ScanModal.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import type { LabController } from "../../core/labController";
import { decodeWire, encodeWire } from "../../core/sdpCodec";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";

export function ScanModal({ lab, onClose }: { lab: LabController; onClose: () => void }) {
  const [answer, setAnswer] = useState<{ wire: string; ws: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const deviceId = lab.settings.cameraDeviceId;

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "videoinput")));
  }, []);

  const onWire = useCallback((wire: string) => {
    void (async () => {
      try {
        const p = await decodeWire(wire);
        if (p.role !== "offer") throw new Error("That is an answer code; scan a student's offer");
        const a = await lab.acceptOffer(p);
        setAnswer({ wire: await encodeWire(a), ws: p.ws });
        setError(undefined);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [lab]);

  return (
    <div className="modal">
      <div className="card">
        {!answer ? (
          <>
            <h2>Scan a student's code</h2>
            <Scanner {...(deviceId ? { deviceId } : {})} onWire={onWire} onError={(e) => setError(e.message)} />
            {devices.length > 1 && (
              <select value={deviceId ?? ""} onChange={(e) => lab.updateSettings({ cameraDeviceId: e.target.value })}>
                <option value="">Default camera</option>
                {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
              </select>
            )}
          </>
        ) : (
          <>
            <h2>Answer for workstation {answer.ws}</h2>
            <QrView wire={answer.wire} role="answer" ws={answer.ws} size={420} />
            <p>Scan this with the phone, then show the phone to iPad {answer.ws}.</p>
            <button onClick={() => setAnswer(undefined)}>Done — scan next</button>
          </>
        )}
        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: TeacherApp**

`src/ui/teacher/TeacherApp.tsx`:
```tsx
import { useState } from "react";
import type { LabController } from "../../core/labController";
import { usePromise } from "../../hooks/usePromise";
import { useLabRoster } from "../../hooks/useLabRoster";
import { APP_VERSION } from "../platform/appVersion";
import { RepairQueue } from "./RepairQueue";
import { ScanModal } from "./ScanModal";
import { Tile } from "./Tile";
import { TileDrawer } from "./TileDrawer";

export function TeacherApp({ boot }: { boot: Promise<LabController> }) {
  const { value: lab, error } = usePromise(boot);
  if (error) return <div className="center"><h1>Could not start</h1><pre>{error.message}</pre></div>;
  if (!lab) return <div className="center"><h1>Starting…</h1></div>;
  return <Dashboard lab={lab} />;
}

function Dashboard({ lab }: { lab: LabController }) {
  const { tiles, queue, counts } = useLabRoster(lab);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<number | undefined>();
  const openTile = open !== undefined ? tiles[open - 1] : undefined;
  return (
    <div className="layout">
      <div>
        <header className="bar">
          <strong>Learning Lab</strong>
          <span data-count="connected" style={{ color: "var(--green)" }}>● {counts.connected}</span>
          <span data-count="degraded" style={{ color: "var(--amber)" }}>● {counts.degraded}</span>
          <span data-count="failed" style={{ color: "var(--red)" }}>● {counts.failed + counts.never}</span>
          <button onClick={() => setScanning(true)} data-action="scan">Scan</button>
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
        </header>
        <main className="grid">{tiles.map((t) => <Tile key={t.ws} t={t} onClick={() => setOpen(t.ws)} />)}</main>
      </div>
      <RepairQueue queue={queue} />
      {scanning && <ScanModal lab={lab} onClose={() => setScanning(false)} />}
      {openTile && <TileDrawer lab={lab} t={openTile} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
```

- [ ] **Step 5: Route**

In `src/main.tsx` add imports and a case:
```tsx
import { bootTeacher } from "./boot/bootTeacher";
import { TeacherApp } from "./ui/teacher/TeacherApp";
// inside route():
    case "/teacher": return <TeacherApp boot={bootTeacher()} />;
```
`bootTeacher()` is called once at module level inside `route()`, which runs once; StrictMode re-renders do not re-run it.

- [ ] **Step 6: Manual cross-tab check**

Run `pnpm dev`. Open `/teacher` in one Chrome window and `/student?ws=7` in another (allow camera in both).

1. Student tab console: `copy(document.querySelector('canvas[data-payload]').dataset.payload)` — the offer wire is now on the clipboard.
2. Teacher tab console: `const answer = await window.__lab.inject("<paste offer>"); copy(answer)` — tile 7 turns "Connecting", the answer wire is on the clipboard.
3. Student tab console: `await window.__lab.inject("<paste answer>")`.

Expected: student pill "Connected" with an RTT, teacher tile 7 green with RTT, header count `● 1`, repair queue no longer lists 7. Click tile 7: drawer shows history `gathering → connecting → connected`; "Show ID on iPad" flashes a large `7` on the student tab.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/boot/bootTeacher.ts src/ui/teacher src/main.tsx
git commit -m "feat(teacher): dashboard grid, scan modal with answer QR, repair queue, tile drawer"
```

---

### Task 11: Courier route, PWA manifest, SPA fallback

**Files:**
- Create: `src/ui/courier/CourierApp.tsx`, `public/manifest.webmanifest`, `public/icon.svg`
- Modify: `src/main.tsx`, `vite.config.ts` (404 fallback plugin)

**Interfaces:**
- Consumes: `Scanner`, `QrView`, `decodeWire`.
- Produces: `/courier` route. Build emits `dist/404.html` identical to `dist/index.html`.

- [ ] **Step 1: CourierApp**

`src/ui/courier/CourierApp.tsx`:
```tsx
import { useCallback, useState } from "react";
import type { SdpPayload } from "../../schemas/sdpPayload";
import { decodeWire } from "../../core/sdpCodec";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";

type Held = { wire: string; payload: SdpPayload };

export function CourierApp() {
  const [held, setHeld] = useState<Held | undefined>();
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const onWire = useCallback((wire: string) => {
    void decodeWire(wire).then(
      (payload) => setHeld({ wire, payload }),
      () => { setFlash(true); setTimeout(() => setFlash(false), 600); },
    );
  }, []);

  if (held) {
    const { payload } = held;
    const target = payload.role === "offer" ? "show to the TEACHER station" : `show to iPad ${payload.ws}`;
    return (
      <div className="center" data-courier="holding">
        <h2>ws {payload.ws} · {payload.role.toUpperCase()}</h2>
        <QrView wire={held.wire} role={payload.role} ws={payload.ws} size={Math.min(window.innerWidth - 32, 520)} />
        <p>Now {target}.</p>
        <button onClick={() => setHeld(undefined)}>Done — scan next</button>
      </div>
    );
  }
  return (
    <div className="center" data-courier="scanning" style={{ background: flash ? "var(--red)" : undefined }}>
      <h2>Point at a code</h2>
      <Scanner onWire={onWire} onError={(e) => setError(e.message)} />
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Route**

In `src/main.tsx`:
```tsx
import { CourierApp } from "./ui/courier/CourierApp";
// inside route():
    case "/courier": return <CourierApp />;
```

- [ ] **Step 3: Manifest, icon, 404 fallback**

`public/manifest.webmanifest`:
```json
{
  "name": "Learning Lab",
  "short_name": "Lab",
  "start_url": "./student",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [{ "src": "icon.svg", "sizes": "any", "type": "image/svg+xml" }]
}
```

`public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#111"/><circle cx="40" cy="64" r="14" fill="#3498db"/><circle cx="88" cy="64" r="14" fill="#2ecc71"/><path d="M54 64h20" stroke="#eee" stroke-width="8" stroke-linecap="round"/></svg>
```

In `index.html`, change the manifest link to a relative path so the Pages base works: `<link rel="manifest" href="manifest.webmanifest" />`. Also add `<link rel="apple-touch-icon" href="icon.svg" />` (iOS falls back to a screenshot if it rejects SVG; acceptable for Phase 1).

`vite.config.ts` — add a plugin that copies `index.html` to `404.html` on build:
```ts
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const spaFallback = (): Plugin => ({
  name: "spa-404-fallback",
  closeBundle() {
    const dist = resolve(__dirname, "dist");
    try { copyFileSync(resolve(dist, "index.html"), resolve(dist, "404.html")); } catch { /* dev */ }
  },
});

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), spaFallback()],
  server: { port: 5173, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? "dev") },
});
```

- [ ] **Step 4: Verify build**

Run: `pnpm build && ls dist`
Expected: `index.html`, `404.html`, `manifest.webmanifest`, `icon.svg`, `assets/`.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/courier src/main.tsx public index.html vite.config.ts
git commit -m "feat(courier): scan→hold→show flow; PWA manifest; 404 SPA fallback"
```

---

### Task 12: Playwright end-to-end

**Files:**
- Create: `playwright.config.ts`, `test/e2e/helpers.ts`, `test/e2e/pairing.spec.ts`, `test/e2e/codec.spec.ts`
- Modify: `src/main.tsx` (expose codec on `window.__labCodec` in dev builds), `.gitignore`

**Interfaces:**
- Consumes: `window.__lab.inject` (Task 9/10), DOM contract: student root `[data-state]`, `canvas[data-payload][data-role][data-ws]`, teacher `[data-tile][data-state]`, `[data-queue-ws]`, `[data-count]`.
- Produces: `window.__labCodec = { extractPayload, buildSdp, encodeWire, decodeWire }` (dev only). Test helpers `openTeacher(browser, settings?)`, `openStudent(browser, ws)`, `pair(teacherPage, studentPage, ws)`.

- [ ] **Step 1: Expose codec for the template test (dev only)**

In `src/main.tsx` add before `createRoot`:
```tsx
import * as codec from "./core/sdpCodec";
declare global { interface Window { __labCodec?: typeof codec } }
if (import.meta.env.DEV) window.__labCodec = codec;
```

- [ ] **Step 2: Playwright config**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev", url: "http://localhost:5173", reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
    {
      name: "webkit",
      testMatch: /codec\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
```

Add to `.gitignore`: `playwright/.cache`.

- [ ] **Step 3: Helpers**

`test/e2e/helpers.ts`:
```ts
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const SHORT_TIMERS = { heartbeatMs: 300, degradedMs: 1200, failedMs: 2500 };

export async function openTeacher(browser: Browser, settings = SHORT_TIMERS): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  await ctx.addInitScript((s) => {
    localStorage.setItem("lab.teacher.v1", JSON.stringify({ roster: {}, settings: s }));
  }, settings);
  const page = await ctx.newPage();
  await page.goto("/teacher");
  await expect(page.locator("[data-tile='1']")).toBeVisible();
  return { ctx, page };
}

export async function openStudent(browser: Browser, ws: number): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto(`/student?ws=${ws}`);
  return { ctx, page };
}

export async function readPayload(page: Page, role: "offer" | "answer", ws: number): Promise<string> {
  const loc = page.locator(`canvas[data-payload][data-role='${role}'][data-ws='${ws}']`);
  await expect(loc).toHaveAttribute("data-payload", /^LAB1:/);
  return (await loc.getAttribute("data-payload"))!;
}

/** Simulates the courier: student offer → teacher, teacher answer → student. */
export async function pair(teacher: Page, student: Page, ws: number): Promise<void> {
  const offer = await readPayload(student, "offer", ws);
  const answer = await teacher.evaluate((w) => window.__lab!.inject(w), offer);
  expect(typeof answer).toBe("string");
  await student.evaluate((w) => window.__lab!.inject(w), answer as string);
}

export async function expectState(page: Page, selector: string, state: string, timeout = 15_000) {
  await expect(page.locator(selector)).toHaveAttribute("data-state", state, { timeout });
}
```

- [ ] **Step 4: Pairing spec**

`test/e2e/pairing.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair } from "./helpers";

test("student shows an offer QR on load", async ({ browser }) => {
  const s = await openStudent(browser, 7);
  await expect(s.page.locator(".bar .ws")).toHaveText("7");
  await expectState(s.page, "[data-state]", "awaiting-remote");
  await expect(s.page.locator("canvas[data-payload][data-role='offer'][data-ws='7']")).toBeVisible();
  await s.ctx.close();
});

test("full pairing: both sides connected, heartbeats produce rtt", async ({ browser }) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, 7);
  await pair(t.page, s.page, 7);
  await expectState(s.page, "[data-state]", "connected");
  await expectState(t.page, "[data-tile='7']", "connected");
  await expect(t.page.locator("[data-tile='7'] [data-rtt]")).toBeVisible();
  await expect(t.page.locator("[data-count='connected']")).toHaveText(/1/);
  await expect(t.page.locator("[data-queue-ws='7']")).toHaveCount(0);
  await s.ctx.close();
  await t.ctx.close();
});

test("student loss → degraded → failed → repair queue → re-pair succeeds", async ({ browser }) => {
  const t = await openTeacher(browser);
  const s1 = await openStudent(browser, 3);
  await pair(t.page, s1.page, 3);
  await expectState(t.page, "[data-tile='3']", "connected");
  await s1.ctx.close();
  await expect(t.page.locator("[data-tile='3']")).toHaveAttribute("data-state", /degraded|failed/, { timeout: 5000 });
  await expectState(t.page, "[data-tile='3']", "failed", 8000);
  await expect(t.page.locator("[data-queue-ws='3']")).toBeVisible();
  const s2 = await openStudent(browser, 3);
  await pair(t.page, s2.page, 3);
  await expectState(t.page, "[data-tile='3']", "connected");
  await expectState(s2.page, "[data-state]", "connected");
  await s2.ctx.close();
  await t.ctx.close();
});

test("student survives teacher disappearance by showing a fresh offer", async ({ browser }) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, 5);
  await pair(t.page, s.page, 5);
  await expectState(s.page, "[data-state]", "connected");
  const firstOffer = await s.page.locator("canvas[data-payload]").first().getAttribute("data-payload").catch(() => null);
  await t.ctx.close();
  // student timers are defaults (15 s degraded, 60 s failed) — too slow for CI, so ICE 'failed'/dc close must drive it.
  await expectState(s.page, "[data-state]", "awaiting-remote", 45_000);
  const secondOffer = await s.page.locator("canvas[data-payload][data-role='offer']").getAttribute("data-payload");
  expect(secondOffer).not.toBe(firstOffer);
  await s.ctx.close();
});

test("two students pair independently", async ({ browser }) => {
  const t = await openTeacher(browser);
  const a = await openStudent(browser, 1);
  const b = await openStudent(browser, 2);
  await pair(t.page, a.page, 1);
  await pair(t.page, b.page, 2);
  await expectState(t.page, "[data-tile='1']", "connected");
  await expectState(t.page, "[data-tile='2']", "connected");
  await expect(t.page.locator("[data-count='connected']")).toHaveText(/2/);
  await Promise.all([a.ctx.close(), b.ctx.close(), t.ctx.close()]);
});

test("garbage injected into the student is rejected without breaking the session", async ({ browser }) => {
  const s = await openStudent(browser, 9);
  await expectState(s.page, "[data-state]", "awaiting-remote");
  await expect(s.page.evaluate(() => window.__lab!.inject("LAB1:garbage00"))).rejects.toThrow();
  await expectState(s.page, "[data-state]", "awaiting-remote");
  await s.ctx.close();
});
```

- [ ] **Step 5: Codec template spec (runs in Chromium and WebKit)**

`test/e2e/codec.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

/** Offer from a real browser → extract → rebuild → another real PC accepts it and answers → extract again. */
test("rebuilt SDP is accepted by a real RTCPeerConnection in both directions", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const codec = window.__labCodec!;
    const gather = (pc: RTCPeerConnection) =>
      new Promise<void>((res) => {
        if (pc.iceGatheringState === "complete") return res();
        const t = setTimeout(res, 3000);
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } };
      });

    const a = new RTCPeerConnection({ iceServers: [] });
    a.createDataChannel("lab");
    await a.setLocalDescription(await a.createOffer());
    await gather(a);
    const offer = codec.extractPayload(a.localDescription!.sdp, "offer", 7);
    const offerWire = await codec.encodeWire(offer);
    const offerBack = await codec.decodeWire(offerWire);

    const b = new RTCPeerConnection({ iceServers: [] });
    await b.setRemoteDescription({ type: "offer", sdp: codec.buildSdp(offerBack) });
    await b.setLocalDescription(await b.createAnswer());
    await gather(b);
    const answer = codec.extractPayload(b.localDescription!.sdp, "answer", 7);
    const answerWire = await codec.encodeWire(answer);
    const answerBack = await codec.decodeWire(answerWire);

    await a.setRemoteDescription({ type: "answer", sdp: codec.buildSdp(answerBack) });

    const connected = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 15000);
      const check = () => {
        if (a.iceConnectionState === "connected" || a.iceConnectionState === "completed") { clearTimeout(t); res(true); }
      };
      a.oniceconnectionstatechange = check;
      check();
    });

    return {
      offerWireLen: offerWire.length,
      answerWireLen: answerWire.length,
      offerCands: offer.cands.length,
      mid: offer.mid,
      connected,
      ice: a.iceConnectionState,
    };
  });
  expect(result.offerCands).toBeGreaterThan(0);
  expect(result.offerWireLen).toBeLessThan(300);
  expect(result.answerWireLen).toBeLessThan(300);
  // Loopback ICE inside one browser process may legitimately not complete in headless CI; the assertion
  // that matters for the codec is that both setRemoteDescription calls above did not throw.
  test.info().annotations.push({ type: "ice", description: `${result.ice} (connected=${result.connected})` });
});
```

- [ ] **Step 6: Install browsers and run**

Run: `pnpm exec playwright install --with-deps chromium webkit` (first time), then `pnpm test:e2e`
Expected: all Chromium specs pass; WebKit codec spec passes. If the "teacher disappearance" test is slow (> 45 s) in your environment, the student's ICE never reported `failed`; check that closing the teacher context closes its PCs (Playwright does) and that `dc.onclose` fires — the test's assertion is on `awaiting-remote`.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts test/e2e src/main.tsx .gitignore
git commit -m "test(e2e): playwright pairing, failure/re-pair, and cross-engine codec template checks"
```

---

### Task 13: `/dev/load` — 30 students on one machine

**Files:**
- Create: `src/ui/dev/LoadPage.tsx`
- Modify: `src/boot/bootStudent.ts` (autopair via `postMessage` when framed), `src/main.tsx`

**Interfaces:**
- Consumes: `bootTeacher`, `LabController`, `useLabRoster`, `Tile`, `encodeWire`/`decodeWire`.
- Produces: `/dev/load` route; iframe protocol `{ type: "lab-offer", ws, wire }` (child → parent) and `{ type: "lab-answer", wire }` (parent → child), guarded by Zod.

- [ ] **Step 1: Autopair in the student boot**

In `src/boot/bootStudent.ts`, add at top:
```ts
import { z } from "zod";
const AnswerMsg = z.object({ type: z.literal("lab-answer"), wire: z.string().startsWith("LAB1:") });
```
and at the end of `bootStudent` before `c.start()`:
```ts
  if (window.parent !== window && new URLSearchParams(location.search).get("autopair") === "1") {
    c.on("session", (s) => {
      s.on("localPayload", (p) => {
        void encodeWire(p).then((wire) => window.parent.postMessage({ type: "lab-offer", ws, wire }, "*"));
      });
    });
    window.addEventListener("message", (ev) => {
      const m = AnswerMsg.safeParse(ev.data);
      if (!m.success) return;
      void decodeWire(m.data.wire).then((p) => c.session?.applyRemote(p)).catch((e: unknown) => console.warn("[autopair]", e));
    });
  }
```
Add `encodeWire` to the existing `sdpCodec` import.

- [ ] **Step 2: LoadPage**

`src/ui/dev/LoadPage.tsx`:
```tsx
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { LabController } from "../../core/labController";
import { decodeWire, encodeWire } from "../../core/sdpCodec";
import { useLabRoster } from "../../hooks/useLabRoster";
import { usePromise } from "../../hooks/usePromise";
import { Tile } from "../teacher/Tile";

const OfferMsg = z.object({ type: z.literal("lab-offer"), ws: z.number().int().min(1).max(30), wire: z.string().startsWith("LAB1:") });

export function LoadPage({ boot }: { boot: Promise<LabController> }) {
  const { value: lab } = usePromise(boot);
  const [count, setCount] = useState(30);
  if (!lab) return <div className="center"><h1>Starting…</h1></div>;
  return <Load lab={lab} count={count} setCount={setCount} />;
}

function Load({ lab, count, setCount }: { lab: LabController; count: number; setCount: (n: number) => void }) {
  const { tiles, counts } = useLabRoster(lab);
  const wsList = useMemo(() => Array.from({ length: count }, (_, i) => i + 1), [count]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const m = OfferMsg.safeParse(ev.data);
      if (!m.success) return;
      void (async () => {
        const answer = await lab.acceptOffer(await decodeWire(m.data.wire));
        (ev.source as Window | null)?.postMessage({ type: "lab-answer", wire: await encodeWire(answer) }, "*");
      })();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [lab]);

  return (
    <div>
      <header className="bar">
        <strong>Load test</strong>
        <label>Students <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
        <span style={{ color: "var(--green)" }}>● {counts.connected}</span>
        <span style={{ color: "var(--amber)" }}>● {counts.degraded}</span>
        <span style={{ color: "var(--red)" }}>● {counts.failed + counts.never}</span>
      </header>
      <main className="grid">{tiles.slice(0, count).map((t) => <Tile key={t.ws} t={t} onClick={() => {}} />)}</main>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4, padding: 12 }}>
        {wsList.map((ws) => (
          <iframe key={ws} title={`student ${ws}`} src={`${import.meta.env.BASE_URL}student?ws=${ws}&autopair=1`} style={{ width: "100%", height: 120, border: 0, background: "#000" }} />
        ))}
      </div>
    </div>
  );
}
```

Note: every iframe shares the same `localStorage` origin, so each student overwrites `lab.student.v1`. That is fine for load testing (ws comes from the URL), but it means `persistedWs` after a load run is whatever iframe wrote last. Document that in the page header if it bites.

- [ ] **Step 3: Route**

In `src/main.tsx`:
```tsx
import { LoadPage } from "./ui/dev/LoadPage";
// inside route():
    case "/dev/load": return <LoadPage boot={bootTeacher()} />;
```

- [ ] **Step 4: Manual check**

Run `pnpm dev`, open `/dev/load` in Chrome, allow camera once. Expected: within ~10 s, 30 tiles green, counts show 30 connected. Chrome DevTools → `chrome://webrtc-internals` shows 60 PCs. Watch for 1 minute: no tile leaves green.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/dev src/boot/bootStudent.ts src/main.tsx
git commit -m "feat(dev): /dev/load runs 30 auto-pairing student iframes against one LabController"
```

---

### Task 14: CI, Pages deploy, README

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `README.md`

**Interfaces:**
- Consumes: package scripts from Task 1.
- Produces: green CI on PRs; `main` deploys to `https://<owner>.github.io/<repo>/` with `VITE_BASE=/<repo>/` and `VITE_APP_VERSION=<short sha>`.

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm exec playwright install --with-deps chromium webkit
      - run: pnpm test:e2e
        env: { CI: "true" }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report, retention-days: 7 }
```

- [ ] **Step 2: Pages workflow**

`.github/workflows/pages.yml`:
```yaml
name: pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Build
        run: |
          REPO="${GITHUB_REPOSITORY#*/}"
          export VITE_BASE="/${REPO}/"
          export VITE_APP_VERSION="${GITHUB_SHA::7}"
          pnpm build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Repository setting required once: Settings → Pages → Source = "GitHub Actions".

- [ ] **Step 3: README**

`README.md`:
```markdown
# Learning Lab P2P

Serverless WebRTC between one teacher MacBook and up to 30 fixed iPads, signaled by QR codes carried on a phone. Static site on GitHub Pages.

- Design: `docs/superpowers/specs/2026-09-20-p2p-core-design.md`
- Agent/contributor rules: `AGENTS.md`
- Lab day checklist: `docs/lab-checklist.md`

## Routes
`/student?ws=N` · `/teacher` · `/courier` · `/dev/load`

## Develop
```
pnpm install
pnpm dev
pnpm test        # unit
pnpm test:e2e    # playwright (pnpm exec playwright install --with-deps chromium webkit once)
```

## Deploy
Push to `main`. Pages workflow sets `VITE_BASE=/<repo>/` and bakes the short SHA into the UI as the app version.
```

- [ ] **Step 4: Verify build with a base path locally**

Run: `VITE_BASE=/a-dec/ VITE_APP_VERSION=local pnpm build && grep -c '/a-dec/assets' dist/index.html`
Expected: build succeeds; count ≥ 1. Run `pnpm preview` and open `http://localhost:4173/a-dec/student?ws=1` — page loads with version `local` in the bar.

- [ ] **Step 5: Commit**

```bash
git add .github README.md
git commit -m "ci: lint/typecheck/unit/e2e workflow; pages deploy with base path and version stamp"
```

---

## Self-review notes

- **Spec coverage:** §2 roles/flow → Tasks 9–11; §3 codec (incl. `mid`) → Task 3 + e2e Task 12; §4 state machine/heartbeat/wake lock/transport boundary → Tasks 5–6, 8 (the `SignalingTransport` interface from §4.3 is deliberately *not* introduced as a class in Phase 1: the boundary is `PeerSession.applyRemote` + the `localPayload` event, which is what a future `GitHubDeadDropTransport` would plug into; add the interface when the second implementation exists rather than speculatively); §5 protocol → Tasks 2, 5, 6; §6 persistence + cert → Tasks 4, 7, 8; §7 UI → Tasks 8–11; §8 testing → Tasks 1–7 (unit), 12 (e2e), 13 (load), lab checklist already exists; §9 layout/deploy → Tasks 1, 11, 14.
- **Known gap, intentional:** Task 12's "teacher disappearance" test depends on the student's ICE reporting `failed` or the DC closing when the teacher context closes. If a browser keeps the DC in limbo, the student only fails after the default 60 s degraded window; the test allows 45 s. If it flakes, pass shortened student timers via a dev-only `?timers=hb,deg,fail` query param parsed with Zod in `bootStudent` — do that as a follow-up task, not silently.
- **Type consistency checked:** `SessionState` union, `SdpPayload` field names (`mid` included everywhere), `LabMessage` variants, `RosterView` fields used in `Tile`, `window.__lab.inject` returns `Promise<string | void>` (teacher returns the answer wire; see Tasks 9/10/12 — the teacher hook must `return encodeWire(answer)`).
