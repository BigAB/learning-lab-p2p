# Phase 2 Bidirectional Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live video over the Phase 1 peer connections: a thumbnail per station in the teacher grid with a one-station "focus", and the teacher's camera or screen fanned out to every connected iPad.

**Architecture:** One `MediaLink` per `PeerSession` owns two pre-created video transceivers (teacher `sendonly` + `recvonly`), negotiated exactly once by the teacher over the DataChannel (`media.offer`/`media.answer`, full SDP, chunked). After that nothing touches SDP: video starts/stops with `replaceTrack`, quality with `setParameters`, and both UIs render from explicit `media.status` / `media.broadcast` messages. Capture goes through a new `MediaPort`; core never sees a DOM global. Settings grow additively on `lab.teacher.v2`.

**Tech Stack:** Vite · React 19 · TypeScript strict · Zod 3 · `node:test` + `tsx` · Playwright (Chromium + WebKit).

**Spec:** `docs/superpowers/specs/2026-09-21-phase2-media-design.md` (builds on `2026-09-20-p2p-core-design.md` and `2026-09-21-variable-workstation-ids-design.md`).

## Global Constraints

- **Video only, no audio.** No audio transceivers, no `audio: true` anywhere.
- **Teacher is the sole media offerer.** The student never calls `createOffer` after pairing. Offers are sequential (`seq`); a student answers only in signaling state `stable`.
- **Quality never renegotiates.** Profiles are applied with `RTCRtpSender.setParameters` (`scaleResolutionDownBy`, `maxFramerate`, `maxBitrate`), falling back to `track.applyConstraints`. Student capture is fixed at 1280×720 @ 15 (`CAPTURE`).
- Profiles (settings, defaults): `thumb {180,10,150}`, `focus {720,15,1200}`, `broadcastCamera {360,15,600}`, `broadcastScreen {720,5,1000}`; `codec` default `"h264"`; `cameras` default `false`. Timers: `mediaOfferMs` 10 000, `statsMs` 2 000, both injectable.
- `hello.caps` is `string[]` (≤ 8 items, each ≤ 16 chars), optional; Phase 2 sends `["media"]` (`MEDIA_CAP`). No `caps` ⇒ tile `unsupported`, nothing offered.
- Media is best-effort: nothing in media can move a `PeerSession` to `failed`. Capture is on only while a `ready` link asked for it; any failure stops it.
- `src/core/**` and `src/schemas/**` stay framework-free; DOM **types** are fine, DOM **globals** are not (so `new MediaStream()` lives in `src/ui/`, core hands out `MediaStreamTrack`s).
- Every `src/core/**` change ships with a unit test in the same commit. Every DC message change ships with schema + valid/invalid fixtures + protocol table. Conventional Commits. Run `pnpm exec prettier --write <files>` before every commit.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- After every task: `pnpm typecheck && pnpm test` green. From Task 11 on also `pnpm lint`. E2E (`pnpm test:e2e`) after Tasks 13, 14, 15.
- Work on branch `feat/phase2-media` from `main`. Integrate via PR (never merge locally).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/schemas/media.ts` (new) | `ProfileSchema`, the five `media.*` message schemas, `MediaMessage`, `MEDIA_CAP`, `MediaSource` |
| `src/schemas/protocol.ts` (modify) | `hello.caps`; splice media schemas into `LabMessageSchema`; drop `MediaMessage = never` |
| `src/schemas/storage.ts` (modify) | `MediaSettingsSchema`; `settings.media` with defaults |
| `src/core/ports.ts` (modify) | `MediaPort`, `CaptureConstraints`; `RtcFactory.videoCodecs?()` |
| `src/core/media.ts` (new) | Pure helpers: `CAPTURE`, `scaleFor`, `encodingFor`, `orderCodecs`, `offeredDirections`, `applyEncoding` |
| `src/core/mediaLink.ts` (new) | Per-session negotiation state machine, transceivers, capture lifecycle, stats |
| `src/core/peerSession.ts` (modify) | `caps` in hello; creates `MediaLink` at DC open; routes `media.*`; closes it on teardown |
| `src/core/labController.ts` (modify) | Broadcast, cameras, focus, retry, stats polling, `RosterView.media` |
| `src/core/studentController.ts` (modify) | Owns `MediaPort`; applies requests; `StudentMediaView` |
| `src/ui/platform/browserMedia.ts` (new) | `getUserMedia` / `getDisplayMedia` → `MediaPort` |
| `src/ui/platform/browserRtc.ts` (modify) | `videoCodecs()` |
| `src/boot/bootTeacher.ts`, `src/boot/bootStudent.ts`, `src/boot/testHook.ts` (modify) | Pass the port; dev hooks `mediaStats` / `activeTracks` |
| `src/hooks/useLabRoster.ts`, `src/hooks/useStudent.ts` (modify) | Expose media views |
| `src/ui/shared/VideoView.tsx` (new) | `<video>` bound to a track |
| `src/ui/teacher/{Tile,TeacherApp,TileDrawer}.tsx` (modify) | Thumbnail, header controls, focus pane, drawer media block |
| `src/ui/student/StudentApp.tsx` (modify) | Teacher video, camera pill |
| `src/ui/dev/LoadPage.tsx` (modify) | Media controls + stats table |
| `src/ui/shared/styles.css` (modify) | Thumbnail, focus pane, pills |
| `test/unit/helpers/fakeRtc.ts` (modify), `test/unit/helpers/fakeMedia.ts` (new) | Transceivers, senders, tracks, stats, `FakeMediaPort` |
| `test/fixtures/sdp/chrome-media-offer.sdp`, `safari-media-answer.sdp` (new) | 3-section SDPs for unit tests |
| `test/unit/schemas/media.test.ts`, `test/unit/core/media.test.ts`, `test/unit/core/mediaLink.test.ts` (new) | New unit suites |
| `test/e2e/media.spec.ts`, `test/e2e/media-renegotiation.spec.ts` (new); `load.spec.ts`, `playwright.config.ts` (modify) | E2E |
| `AGENTS.md`, `README.md`, `docs/lab-checklist.md`, the spec (modify) | Docs |

---

### Task 0: Branch

- [ ] **Step 1: Branch from main**

```bash
cd /Users/adambarrett/Projects/a-dec && git checkout main && git pull && git checkout -b feat/phase2-media
```

---

### Task 1: `media.*` schemas and `hello.caps`

**Files:**
- Create: `src/schemas/media.ts`
- Modify: `src/schemas/protocol.ts`
- Create: `test/unit/schemas/media.test.ts`
- Modify: `test/unit/schemas/protocol.test.ts`

**Interfaces:**
- Produces: `ProfileSchema`, `type Profile = { height: 180|360|720; fps: number; kbps: number }`, `MediaOfferSchema`/`MediaAnswerSchema` (`{ t, seq, sdp }`), `MediaRequestSchema` (`{ t, send: Profile | null }`), `MediaStatusSchema` (`{ t, cam: "off"|"on"|"error", reason?, send }`), `MediaBroadcastSchema` (`{ t, on, source? }`), types `MediaOfferMessage`, `MediaAnswerMessage`, `MediaRequestMessage`, `MediaStatusMessage`, `MediaBroadcastMessage`, `MediaMessage`, `MediaSource = "camera" | "screen"`, `CamState = "off" | "on" | "error"`, `MEDIA_CAP = "media"`, `MAX_SDP_BYTES = 65536`.
- Produces: `HelloMessage.caps?: string[]`; `LabMessageSchema` accepts every `media.*` message.

- [ ] **Step 1: Write the failing schema tests**

`test/unit/schemas/media.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SDP_BYTES,
  MEDIA_CAP,
  MediaBroadcastSchema,
  MediaOfferSchema,
  MediaRequestSchema,
  MediaStatusSchema,
  ProfileSchema,
} from "../../../src/schemas/media";
import { HelloSchema, LabMessageSchema } from "../../../src/schemas/protocol";

const thumb = { height: 180, fps: 10, kbps: 150 };

test("profile accepts the three heights and rejects the rest", () => {
  for (const height of [180, 360, 720])
    assert.equal(ProfileSchema.safeParse({ height, fps: 15, kbps: 600 }).success, true);
  for (const bad of [
    { height: 240, fps: 15, kbps: 600 },
    { height: 180, fps: 0, kbps: 600 },
    { height: 180, fps: 31, kbps: 600 },
    { height: 180, fps: 15, kbps: 49 },
    { height: 180, fps: 15, kbps: 4001 },
    { height: 180, fps: 1.5, kbps: 600 },
  ])
    assert.equal(ProfileSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("every media message parses through LabMessageSchema", () => {
  const ok = [
    { t: "media.offer", seq: 1, sdp: "v=0\r\n" },
    { t: "media.answer", seq: 1, sdp: "v=0\r\n" },
    { t: "media.request", send: thumb },
    { t: "media.request", send: null },
    { t: "media.status", cam: "on", send: thumb },
    { t: "media.status", cam: "error", reason: "NotAllowedError", send: null },
    { t: "media.broadcast", on: true, source: "screen" },
    { t: "media.broadcast", on: false },
  ];
  for (const m of ok) assert.equal(LabMessageSchema.safeParse(m).success, true, JSON.stringify(m));
});

test("rejects bad seq, oversize sdp, bad cam, bad source, unknown media.t", () => {
  const bad = [
    { t: "media.offer", seq: 0, sdp: "v=0" },
    { t: "media.offer", seq: 1, sdp: "" },
    { t: "media.offer", seq: 1, sdp: "x".repeat(MAX_SDP_BYTES + 1) },
    { t: "media.answer", sdp: "v=0" },
    { t: "media.request" },
    { t: "media.request", send: { height: 180 } },
    { t: "media.status", cam: "maybe", send: null },
    { t: "media.status", cam: "on", reason: "r".repeat(201), send: null },
    { t: "media.broadcast", on: true, source: "mic" },
    { t: "media.mute" },
  ];
  for (const m of bad)
    assert.equal(LabMessageSchema.safeParse(m).success, false, JSON.stringify(m));
});

test("individual schemas reject a foreign t", () => {
  assert.equal(MediaOfferSchema.safeParse({ t: "media.answer", seq: 1, sdp: "v" }).success, false);
  assert.equal(MediaRequestSchema.safeParse({ t: "media.status", send: null }).success, false);
  assert.equal(MediaStatusSchema.safeParse({ t: "media.request", cam: "on", send: null }).success, false);
  assert.equal(MediaBroadcastSchema.safeParse({ t: "media.request", on: true }).success, false);
});

test("hello.caps is optional, bounded, and MEDIA_CAP is 'media'", () => {
  assert.equal(MEDIA_CAP, "media");
  const base = { t: "hello", role: "student", ws: "7", appVersion: "v", ua: "u" };
  assert.equal(HelloSchema.safeParse(base).success, true);
  assert.deepEqual(HelloSchema.parse({ ...base, caps: ["media"] }).caps, ["media"]);
  assert.equal(HelloSchema.safeParse({ ...base, caps: [] }).success, true);
  assert.equal(HelloSchema.safeParse({ ...base, caps: ["x".repeat(17)] }).success, false);
  assert.equal(HelloSchema.safeParse({ ...base, caps: new Array(9).fill("a") }).success, false);
  assert.equal(HelloSchema.safeParse({ ...base, caps: "media" }).success, false);
});
```

Append to `test/unit/schemas/protocol.test.ts` (inside the existing "accepts every phase-1 message" `ok` array, add one line):

```ts
    { t: "hello", role: "teacher", ws: "7", appVersion: "abc1234", ua: "Chrome", caps: ["media"] },
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "media|fail" | head`
Expected: FAIL — `Cannot find module '../../../src/schemas/media'`.

- [ ] **Step 3: Write `src/schemas/media.ts`**

```ts
import { z } from "zod";

/** Capability advertised in `hello.caps` by a build that speaks the media.* namespace. */
export const MEDIA_CAP = "media";
/** A full Chrome SDP with every codec listed is 4–8 KB; 64 KB is a generous ceiling. */
export const MAX_SDP_BYTES = 65536;

/** Target encode height; the capture stays at 720 and the sender scales down (spec §3.5). */
export const ProfileSchema = z.object({
  height: z.union([z.literal(180), z.literal(360), z.literal(720)]),
  fps: z.number().int().min(1).max(30),
  kbps: z.number().int().min(50).max(4000),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MediaSourceSchema = z.enum(["camera", "screen"]);
export type MediaSource = z.infer<typeof MediaSourceSchema>;

export const CamStateSchema = z.enum(["off", "on", "error"]);
export type CamState = z.infer<typeof CamStateSchema>;

const SdpSchema = z.string().min(1).max(MAX_SDP_BYTES);

export const MediaOfferSchema = z.object({
  t: z.literal("media.offer"),
  seq: z.number().int().min(1),
  sdp: SdpSchema,
});
export const MediaAnswerSchema = z.object({
  t: z.literal("media.answer"),
  seq: z.number().int().min(1),
  sdp: SdpSchema,
});
/** Teacher → student: what to send. Idempotent; the latest wins. */
export const MediaRequestSchema = z.object({
  t: z.literal("media.request"),
  send: ProfileSchema.nullable(),
});
/** Student → teacher: what is actually being sent, after every applied request. */
export const MediaStatusSchema = z.object({
  t: z.literal("media.status"),
  cam: CamStateSchema,
  reason: z.string().max(200).optional(),
  send: ProfileSchema.nullable(),
});
/** Teacher → student: whether to show the teacher's video, and what it is. */
export const MediaBroadcastSchema = z.object({
  t: z.literal("media.broadcast"),
  on: z.boolean(),
  source: MediaSourceSchema.optional(),
});

export type MediaOfferMessage = z.infer<typeof MediaOfferSchema>;
export type MediaAnswerMessage = z.infer<typeof MediaAnswerSchema>;
export type MediaRequestMessage = z.infer<typeof MediaRequestSchema>;
export type MediaStatusMessage = z.infer<typeof MediaStatusSchema>;
export type MediaBroadcastMessage = z.infer<typeof MediaBroadcastSchema>;
export type MediaMessage =
  | MediaOfferMessage
  | MediaAnswerMessage
  | MediaRequestMessage
  | MediaStatusMessage
  | MediaBroadcastMessage;
```

- [ ] **Step 4: Modify `src/schemas/protocol.ts`**

Add the import after the `WsSchema` import:

```ts
import {
  MediaAnswerSchema,
  MediaBroadcastSchema,
  MediaOfferSchema,
  MediaRequestSchema,
  MediaStatusSchema,
} from "./media";
```

Add `caps` to `HelloSchema` (after `ua`):

```ts
  /** Optional feature flags; a Phase 2 build sends ["media"]. Strings, not an enum, so newer peers parse. */
  caps: z.array(z.string().min(1).max(16)).max(8).optional(),
```

Replace the `LabMessageSchema` union:

```ts
export const LabMessageSchema = z.discriminatedUnion("t", [
  HelloSchema,
  HbSchema,
  HbAckSchema,
  StatusSchema,
  CmdSchema,
  ChunkSchema,
  MediaOfferSchema,
  MediaAnswerSchema,
  MediaRequestSchema,
  MediaStatusSchema,
  MediaBroadcastSchema,
]);
```

Replace the reserved-namespace block at the bottom:

```ts
/** Phase 2 media messages live in ./media. The remaining namespaces stay empty until their phase. */
export type { MediaMessage } from "./media";
export type CollabMessage = never; // Phase 3
export type RecMessage = never; // Phase 4
export type LogMessage = never; // Phase 5
```

- [ ] **Step 5: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (all suites, including the new media schema tests).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src/schemas/media.ts src/schemas/protocol.ts test/unit/schemas/media.test.ts test/unit/schemas/protocol.test.ts
git add src/schemas/media.ts src/schemas/protocol.ts test/unit/schemas/media.test.ts test/unit/schemas/protocol.test.ts
git commit -m "feat(schemas): media.* DataChannel messages and hello.caps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `settings.media` on the teacher blob

**Files:**
- Modify: `src/schemas/storage.ts`
- Modify: `test/unit/schemas/storage.test.ts`

**Interfaces:**
- Produces: `MediaSettingsSchema`, `type MediaSettings = { cameras: boolean; codec: "h264"|"vp8"|"auto"; thumb: Profile; focus: Profile; broadcastCamera: Profile; broadcastScreen: Profile }`, `Settings.media: MediaSettings`. Key stays `lab.teacher.v2`.

- [ ] **Step 1: Write the failing tests** (append to `test/unit/schemas/storage.test.ts`)

```ts
test("settings.media defaults fill an old blob and the key stays v2", () => {
  const t = TeacherStateSchema.parse({ settings: { heartbeatMs: 5000 } });
  assert.equal(t.settings.media.cameras, false);
  assert.equal(t.settings.media.codec, "h264");
  assert.deepEqual(t.settings.media.thumb, { height: 180, fps: 10, kbps: 150 });
  assert.deepEqual(t.settings.media.focus, { height: 720, fps: 15, kbps: 1200 });
  assert.deepEqual(t.settings.media.broadcastCamera, { height: 360, fps: 15, kbps: 600 });
  assert.deepEqual(t.settings.media.broadcastScreen, { height: 720, fps: 5, kbps: 1000 });
  assert.equal(TEACHER_KEY, "lab.teacher.v2");
});

test("settings.media rejects a bad profile or codec", () => {
  assert.equal(
    TeacherStateSchema.safeParse({ settings: { media: { codec: "av1" } } }).success,
    false,
  );
  assert.equal(
    TeacherStateSchema.safeParse({ settings: { media: { thumb: { height: 240, fps: 10, kbps: 150 } } } })
      .success,
    false,
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "settings.media|fail" | head`
Expected: FAIL — `t.settings.media` is undefined.

- [ ] **Step 3: Modify `src/schemas/storage.ts`**

Add import: `import { ProfileSchema } from "./media";`

Add before `SettingsSchema`:

```ts
export const MediaSettingsSchema = z.object({
  cameras: z.boolean().default(false),
  codec: z.enum(["h264", "vp8", "auto"]).default("h264"),
  thumb: ProfileSchema.default({ height: 180, fps: 10, kbps: 150 }),
  focus: ProfileSchema.default({ height: 720, fps: 15, kbps: 1200 }),
  broadcastCamera: ProfileSchema.default({ height: 360, fps: 15, kbps: 600 }),
  broadcastScreen: ProfileSchema.default({ height: 720, fps: 5, kbps: 1000 }),
});
export type MediaSettings = z.infer<typeof MediaSettingsSchema>;
```

Add to `SettingsSchema` after `cameraDeviceId`:

```ts
  /** Additive with defaults, so the v2 key stands (spec §8). */
  media: MediaSettingsSchema.default({}),
```

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/schemas/storage.ts test/unit/schemas/storage.test.ts
git add src/schemas/storage.ts test/unit/schemas/storage.test.ts
git commit -m "feat(storage): settings.media profiles, codec and cameras flag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Ports and pure media helpers

**Files:**
- Modify: `src/core/ports.ts`
- Create: `src/core/media.ts`
- Create: `test/fixtures/sdp/chrome-media-offer.sdp`, `test/fixtures/sdp/safari-media-answer.sdp`
- Create: `test/unit/core/media.test.ts`

**Interfaces:**
- Produces (ports): `interface CaptureConstraints { width: number; height: number; frameRate: number }`, `interface MediaPort { camera(c: CaptureConstraints): Promise<MediaStreamTrack>; screen(): Promise<MediaStreamTrack> }`, `RtcFactory.videoCodecs?(): RTCRtpCodecCapability[]`.
- Produces (media.ts): `CAPTURE: CaptureConstraints = { width: 1280, height: 720, frameRate: 15 }`, `type CodecPref = "h264" | "vp8" | "auto"`, `type Degradation = "balanced" | "maintain-framerate" | "maintain-resolution"`, `scaleFor(trackHeight: number | undefined, targetHeight: number): number`, `encodingFor(p: Profile, trackHeight: number | undefined): RTCRtpEncodingParameters`, `orderCodecs(codecs: RTCRtpCodecCapability[], pref: CodecPref): RTCRtpCodecCapability[]`, `type OfferedDirection`, `offeredDirections(sdp: string): Map<string, OfferedDirection>`, `applyEncoding(sender: RTCRtpSender, enc: RTCRtpEncodingParameters, degradation?: Degradation): Promise<void>`.
- Produces (fixtures): `CHROME_MEDIA_OFFER` has mids `0` (application), `1` (`a=sendonly`), `2` (`a=recvonly`); `SAFARI_MEDIA_ANSWER` mirrors them (`1` recvonly, `2` sendonly).

- [ ] **Step 1: Write the fixtures**

`test/fixtures/sdp/chrome-media-offer.sdp` (hand-built to the shape Chrome produces; the real thing is exercised by `media-renegotiation.spec.ts`):

```
v=0
o=- 4611731400430051336 3 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1 2
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:aBcD
a=ice-pwd:0123456789abcdef0123456789
a=ice-options:trickle
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
m=video 9 UDP/TLS/RTP/SAVPF 96 97
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:aBcD
a=ice-pwd:0123456789abcdef0123456789
a=ice-options:trickle
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF
a=setup:actpass
a=mid:1
a=sendonly
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:96 H264/90000
a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:97 VP8/90000
m=video 9 UDP/TLS/RTP/SAVPF 96 97
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:aBcD
a=ice-pwd:0123456789abcdef0123456789
a=ice-options:trickle
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF
a=setup:actpass
a=mid:2
a=recvonly
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:96 H264/90000
a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:97 VP8/90000
```

`test/fixtures/sdp/safari-media-answer.sdp`:

```
v=0
o=- 1234567890123456789 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1 2
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:wXyZ
a=ice-pwd:fedcba9876543210fedcba9876
a=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00
a=setup:active
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
m=video 9 UDP/TLS/RTP/SAVPF 96
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:wXyZ
a=ice-pwd:fedcba9876543210fedcba9876
a=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00
a=setup:active
a=mid:1
a=recvonly
a=rtcp-mux
a=rtpmap:96 H264/90000
a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
m=video 9 UDP/TLS/RTP/SAVPF 96
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:wXyZ
a=ice-pwd:fedcba9876543210fedcba9876
a=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00
a=setup:active
a=mid:2
a=sendonly
a=rtcp-mux
a=rtpmap:96 H264/90000
a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
```

- [ ] **Step 2: Write the failing tests**

`test/unit/core/media.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPTURE,
  applyEncoding,
  encodingFor,
  offeredDirections,
  orderCodecs,
  scaleFor,
} from "../../../src/core/media";

const OFFER = readFileSync(new URL("../../fixtures/sdp/chrome-media-offer.sdp", import.meta.url), "utf8");

test("capture is 720p15", () => {
  assert.deepEqual(CAPTURE, { width: 1280, height: 720, frameRate: 15 });
});

test("scaleFor divides the capture height by the target and never upscales", () => {
  assert.equal(scaleFor(720, 180), 4);
  assert.equal(scaleFor(720, 360), 2);
  assert.equal(scaleFor(720, 720), 1);
  assert.equal(scaleFor(480, 720), 1);
  assert.equal(scaleFor(undefined, 180), 1);
  assert.equal(scaleFor(0, 180), 1);
});

test("encodingFor maps a profile to sender encoding parameters", () => {
  assert.deepEqual(encodingFor({ height: 180, fps: 10, kbps: 150 }, 720), {
    scaleResolutionDownBy: 4,
    maxFramerate: 10,
    maxBitrate: 150_000,
  });
});

const codecs: RTCRtpCodecCapability[] = [
  { mimeType: "video/VP8", clockRate: 90000 },
  { mimeType: "video/rtx", clockRate: 90000, sdpFmtpLine: "apt=96" },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f" },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" },
  { mimeType: "video/VP9", clockRate: 90000 },
];

test("orderCodecs puts the preferred codec first, packetization-mode=1 H264 first of all", () => {
  const h = orderCodecs(codecs, "h264").map((c) => c.sdpFmtpLine ?? c.mimeType);
  assert.equal(h[0], "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f");
  assert.equal(h[1], "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f");
  assert.deepEqual(h.slice(2), ["video/VP8", "apt=96", "video/VP9"]);
  assert.equal(orderCodecs(codecs, "vp8")[0]?.mimeType, "video/VP8");
  assert.deepEqual(orderCodecs(codecs, "auto"), codecs);
  assert.equal(orderCodecs(codecs, "h264").length, codecs.length);
});

test("orderCodecs leaves the list alone when the preferred codec is absent", () => {
  const noH264 = codecs.filter((c) => c.mimeType !== "video/H264");
  assert.deepEqual(orderCodecs(noH264, "h264"), noH264);
});

test("offeredDirections reads mid → direction for every m= section", () => {
  const d = offeredDirections(OFFER);
  assert.equal(d.get("1"), "sendonly");
  assert.equal(d.get("2"), "recvonly");
  assert.equal(d.has("0"), false);
  assert.equal(offeredDirections("v=0\r\na=sendonly\r\n").size, 0);
});

test("applyEncoding merges into encodings[0] and sets degradationPreference", async () => {
  const calls: RTCRtpSendParameters[] = [];
  const sender = {
    getParameters: () => ({ encodings: [{ active: true }], transactionId: "t", codecs: [], headerExtensions: [], rtcp: {} }),
    setParameters: async (p: RTCRtpSendParameters) => {
      calls.push(p);
    },
  } as unknown as RTCRtpSender;
  await applyEncoding(sender, { maxFramerate: 5 }, "maintain-resolution");
  assert.deepEqual(calls[0]?.encodings, [{ active: true, maxFramerate: 5 }]);
  assert.equal((calls[0] as { degradationPreference?: string }).degradationPreference, "maintain-resolution");
  const empty = {
    getParameters: () => ({ encodings: [], transactionId: "t", codecs: [], headerExtensions: [], rtcp: {} }),
    setParameters: async (p: RTCRtpSendParameters) => {
      calls.push(p);
    },
  } as unknown as RTCRtpSender;
  await applyEncoding(empty, { maxBitrate: 1 });
  assert.deepEqual(calls[1]?.encodings, [{ maxBitrate: 1 }]);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "core/media|fail" | head`
Expected: FAIL — `Cannot find module '../../../src/core/media'`.

- [ ] **Step 4: Modify `src/core/ports.ts`** — add to `RtcFactory` and append the media port:

```ts
export interface RtcFactory {
  create(config: RTCConfiguration): RTCPeerConnection;
  /** Receive-side video codec capabilities, for setCodecPreferences. Absent ⇒ engine defaults. */
  videoCodecs?(): RTCRtpCodecCapability[];
}
```

```ts
export interface CaptureConstraints {
  width: number;
  height: number;
  frameRate: number;
}

/**
 * Capture lives behind a port so core never touches `navigator`. `screen()` must be invoked
 * synchronously inside a user gesture: Chrome's getDisplayMedia needs transient activation.
 */
export interface MediaPort {
  camera(c: CaptureConstraints): Promise<MediaStreamTrack>;
  screen(): Promise<MediaStreamTrack>;
}
```

- [ ] **Step 5: Write `src/core/media.ts`**

```ts
import type { Profile } from "../schemas/media";
import type { CaptureConstraints } from "./ports";

/** The student camera captures at this fixed size; every profile is a scale-down of it (spec §3.5). */
export const CAPTURE: CaptureConstraints = { width: 1280, height: 720, frameRate: 15 };

export type CodecPref = "h264" | "vp8" | "auto";
export type Degradation = "balanced" | "maintain-framerate" | "maintain-resolution";
export type OfferedDirection = "sendonly" | "recvonly" | "sendrecv" | "inactive";

/** Sender scale factor from the captured height; never below 1 (no upscaling). */
export function scaleFor(trackHeight: number | undefined, targetHeight: number): number {
  if (!trackHeight || trackHeight <= targetHeight) return 1;
  return trackHeight / targetHeight;
}

export function encodingFor(p: Profile, trackHeight: number | undefined): RTCRtpEncodingParameters {
  return {
    scaleResolutionDownBy: scaleFor(trackHeight, p.height),
    maxFramerate: p.fps,
    maxBitrate: p.kbps * 1000,
  };
}

function h264Score(c: RTCRtpCodecCapability): number {
  const f = c.sdpFmtpLine ?? "";
  return (/packetization-mode=1/.test(f) ? 2 : 0) + (/42e01f/i.test(f) ? 1 : 0);
}

/**
 * Preferred codec first (stable order otherwise). For H.264 the packetization-mode=1 constrained
 * baseline entries lead, which is what iPads decode in hardware. Unknown preference ⇒ untouched.
 */
export function orderCodecs(codecs: RTCRtpCodecCapability[], pref: CodecPref): RTCRtpCodecCapability[] {
  if (pref === "auto") return codecs;
  const want = pref === "h264" ? "video/h264" : "video/vp8";
  const first = codecs.filter((c) => c.mimeType.toLowerCase() === want);
  if (first.length === 0) return codecs;
  if (pref === "h264") first.sort((a, b) => h264Score(b) - h264Score(a));
  const rest = codecs.filter((c) => c.mimeType.toLowerCase() !== want);
  return [...first, ...rest];
}

/** mid → direction line for each m= section of an SDP; sections without both are skipped. */
export function offeredDirections(sdp: string): Map<string, OfferedDirection> {
  const out = new Map<string, OfferedDirection>();
  const sections = sdp.split(/\r?\n(?=m=)/).slice(1);
  for (const sec of sections) {
    const lines = sec.split(/\r?\n/);
    const mid = lines.find((l) => l.startsWith("a=mid:"))?.slice(6).trim();
    const dir = lines.find((l) => /^a=(sendonly|recvonly|sendrecv|inactive)\s*$/.test(l))?.slice(2).trim();
    if (mid && dir) out.set(mid, dir as OfferedDirection);
  }
  return out;
}

/** Merge `enc` into encodings[0] (creating it if the engine returned none) and set parameters. */
export async function applyEncoding(
  sender: RTCRtpSender,
  enc: RTCRtpEncodingParameters,
  degradation?: Degradation,
): Promise<void> {
  const p = sender.getParameters();
  if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
  Object.assign(p.encodings[0]!, enc);
  if (degradation) (p as RTCRtpSendParameters & { degradationPreference?: Degradation }).degradationPreference = degradation;
  await sender.setParameters(p);
}
```

If `pnpm typecheck` complains that `RTCRtpCodecCapability` lacks `sdpFmtpLine`, the installed `lib.dom` is older than expected: change the parameter type to `RTCRtpCodec` throughout `orderCodecs` and the test (both carry `mimeType`, `clockRate`, `sdpFmtpLine?`).

- [ ] **Step 6: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write src/core/ports.ts src/core/media.ts test/unit/core/media.test.ts
git add src/core/ports.ts src/core/media.ts test/unit/core/media.test.ts test/fixtures/sdp/chrome-media-offer.sdp test/fixtures/sdp/safari-media-answer.sdp
git commit -m "feat(core): media port, profile → encoding helpers, offered-direction parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Fakes for transceivers, senders, tracks, stats and capture

**Files:**
- Modify: `test/unit/helpers/fakeRtc.ts`
- Create: `test/unit/helpers/fakeMedia.ts`
- Create: `test/unit/helpers/fakeRtc.test.ts`

**Interfaces:**
- Produces: `CHROME_MEDIA_OFFER`, `SAFARI_MEDIA_ANSWER` (strings); `FakeMediaStreamTrack { kind; id; readyState; stopped; contentHint; settings; constraintsApplied: MediaTrackConstraints[]; onended; getSettings(); stop(); applyConstraints(c) }`; `FakeRtpSender { track; replaceTrackCalls: (MediaStreamTrack|null)[]; params; setParametersCalls: RTCRtpSendParameters[]; rejectSetParameters?: Error; getParameters(); setParameters(p); replaceTrack(t) }`; `FakeTransceiver { kind; mid; direction; currentDirection; sender: FakeRtpSender; receiver: { track: FakeMediaStreamTrack }; codecPrefs?: RTCRtpCodecCapability[]; setCodecPreferences(c) }`; `FakeRTCPeerConnection` gains `signalingState`, `transceivers`, `addTransceiver(kind, init?)`, `getTransceivers()`, `statsReport: Map<string, Record<string, unknown>>`, `getStats()`, `rejectSetRemote?: Error`, `rejectCreateOffer?: Error`; `createOffer()`/`createAnswer()` return the media fixtures once any transceiver exists; `setRemoteDescription(offer)` creates `recvonly` transceivers for `m=video` sections it has not seen. `FakeRtcFactory.videoCodecs()` returns VP8, rtx, H264 (mode 0 and 1), VP9. `FakeMediaPort { cameraCalls: CaptureConstraints[]; screenCalls: number; tracks: FakeMediaStreamTrack[]; rejectCamera?: Error; rejectScreen?: Error; camera(c); screen() }`.

- [ ] **Step 1: Write the failing sanity test**

`test/unit/helpers/fakeRtc.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHROME_MEDIA_OFFER, FakeRTCPeerConnection, FakeRtcFactory } from "./fakeRtc";
import { FakeMediaPort } from "./fakeMedia";

test("addTransceiver switches createOffer to the media fixture and assigns mids", async () => {
  const pc = new FakeRTCPeerConnection({});
  const tx = pc.addTransceiver("video", { direction: "sendonly" });
  const rx = pc.addTransceiver("video", { direction: "recvonly" });
  assert.deepEqual([tx.mid, rx.mid], ["1", "2"]);
  assert.equal((await pc.createOffer()).sdp, CHROME_MEDIA_OFFER);
  await pc.setLocalDescription(await pc.createOffer());
  assert.equal(pc.signalingState, "have-local-offer");
});

test("setRemoteDescription(offer) creates recvonly transceivers per m=video and tracks signaling", async () => {
  const pc = new FakeRTCPeerConnection({});
  await pc.setRemoteDescription({ type: "offer", sdp: CHROME_MEDIA_OFFER });
  assert.equal(pc.signalingState, "have-remote-offer");
  assert.deepEqual(pc.getTransceivers().map((t) => [t.mid, t.direction]), [["1", "recvonly"], ["2", "recvonly"]]);
  await pc.setLocalDescription(await pc.createAnswer());
  assert.equal(pc.signalingState, "stable");
  // A second offer must not duplicate transceivers.
  await pc.setRemoteDescription({ type: "offer", sdp: CHROME_MEDIA_OFFER });
  assert.equal(pc.getTransceivers().length, 2);
});

test("factory exposes codecs; port hands out tracks and records calls", async () => {
  assert.ok(new FakeRtcFactory().videoCodecs().some((c) => c.mimeType === "video/H264"));
  const port = new FakeMediaPort();
  const t = await port.camera({ width: 1280, height: 720, frameRate: 15 });
  assert.equal(t.getSettings().height, 720);
  assert.deepEqual(port.cameraCalls, [{ width: 1280, height: 720, frameRate: 15 }]);
  port.rejectCamera = new Error("NotAllowedError");
  await assert.rejects(port.camera({ width: 1, height: 1, frameRate: 1 }), /NotAllowedError/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "fakeRtc|fail" | head`
Expected: FAIL — `addTransceiver is not a function` / missing module `./fakeMedia`.

- [ ] **Step 3: Extend `test/unit/helpers/fakeRtc.ts`**

Add after the `SAFARI_ANSWER` constant:

```ts
export const CHROME_MEDIA_OFFER = readFileSync(
  new URL("../../fixtures/sdp/chrome-media-offer.sdp", import.meta.url),
  "utf8",
);
export const SAFARI_MEDIA_ANSWER = readFileSync(
  new URL("../../fixtures/sdp/safari-media-answer.sdp", import.meta.url),
  "utf8",
);
```

Add after `FakeDataChannel` (before `FakeRTCPeerConnection`):

```ts
let trackSeq = 0;

export class FakeMediaStreamTrack {
  readonly kind = "video";
  readonly id = `track-${++trackSeq}`;
  readyState: MediaStreamTrackState = "live";
  stopped = false;
  contentHint = "";
  settings: MediaTrackSettings = { width: 1280, height: 720, frameRate: 15 };
  constraintsApplied: MediaTrackConstraints[] = [];
  onended: (() => void) | null = null;
  getSettings(): MediaTrackSettings {
    return { ...this.settings };
  }
  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }
  async applyConstraints(c: MediaTrackConstraints): Promise<void> {
    this.constraintsApplied.push(c);
  }
  /** Simulate the device going away (unplugged camera, screen share ended from the browser bar). */
  end(): void {
    this.readyState = "ended";
    this.onended?.();
  }
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

export class FakeRtpSender {
  track: MediaStreamTrack | null = null;
  replaceTrackCalls: (MediaStreamTrack | null)[] = [];
  setParametersCalls: RTCRtpSendParameters[] = [];
  rejectSetParameters: Error | undefined;
  params: RTCRtpSendParameters = {
    encodings: [{}],
    transactionId: "fake",
    codecs: [],
    headerExtensions: [],
    rtcp: {},
  };
  getParameters(): RTCRtpSendParameters {
    return { ...this.params, encodings: this.params.encodings.map((e) => ({ ...e })) };
  }
  async setParameters(p: RTCRtpSendParameters): Promise<void> {
    if (this.rejectSetParameters) throw this.rejectSetParameters;
    this.params = p;
    this.setParametersCalls.push(p);
  }
  async replaceTrack(t: MediaStreamTrack | null): Promise<void> {
    this.track = t;
    this.replaceTrackCalls.push(t);
  }
  /** encodings[0] as last set, for assertions. */
  encoding(): RTCRtpEncodingParameters {
    return this.params.encodings[0] ?? {};
  }
}

export class FakeTransceiver {
  readonly kind = "video";
  currentDirection: RTCRtpTransceiverDirection | null = null;
  readonly sender = new FakeRtpSender();
  readonly receiver: { track: FakeMediaStreamTrack } = { track: new FakeMediaStreamTrack() };
  codecPrefs: RTCRtpCodecCapability[] | undefined;
  constructor(
    public mid: string | null,
    public direction: RTCRtpTransceiverDirection,
  ) {}
  setCodecPreferences(c: RTCRtpCodecCapability[]): void {
    this.codecPrefs = c;
  }
}

const MID_LINE = /^a=mid:(\S+)/m;
```

Inside `FakeRTCPeerConnection` add fields and methods:

```ts
  signalingState: RTCSignalingState = "stable";
  transceivers: FakeTransceiver[] = [];
  statsReport = new Map<string, Record<string, unknown>>();
  rejectSetRemote: Error | undefined;
  rejectCreateOffer: Error | undefined;

  addTransceiver(kind: string, init?: RTCRtpTransceiverInit): FakeTransceiver {
    if (kind !== "video") throw new Error("fake supports video only");
    const t = new FakeTransceiver(String(this.transceivers.length + 1), init?.direction ?? "sendrecv");
    this.transceivers.push(t);
    return t;
  }
  getTransceivers(): FakeTransceiver[] {
    return [...this.transceivers];
  }
  async getStats(): Promise<RTCStatsReport> {
    return this.statsReport as unknown as RTCStatsReport;
  }
```

Replace `createOffer`, `createAnswer`, `setLocalDescription`, `setRemoteDescription`:

```ts
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (this.rejectCreateOffer) throw this.rejectCreateOffer;
    return { type: "offer", sdp: this.transceivers.length ? CHROME_MEDIA_OFFER : this.offerSdp };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: this.transceivers.length ? SAFARI_MEDIA_ANSWER : SAFARI_ANSWER };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    if (d.type === "answer") for (const t of this.transceivers) t.currentDirection = t.direction;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    if (this.rejectSetRemote) throw this.rejectSetRemote;
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
    if (d.type === "offer" && d.sdp) {
      // Like a real PC: each unseen m=video section gets a recvonly transceiver.
      for (const sec of d.sdp.split(/\r?\n(?=m=video)/).slice(1)) {
        const mid = MID_LINE.exec(sec)?.[1];
        if (mid && !this.transceivers.some((t) => t.mid === mid))
          this.transceivers.push(new FakeTransceiver(mid, "recvonly"));
      }
    }
    if (d.type === "answer") for (const t of this.transceivers) t.currentDirection = t.direction;
  }
```

Add to `FakeRtcFactory`:

```ts
  videoCodecs(): RTCRtpCodecCapability[] {
    return [
      { mimeType: "video/VP8", clockRate: 90000 },
      { mimeType: "video/rtx", clockRate: 90000, sdpFmtpLine: "apt=96" },
      { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f" },
      { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" },
      { mimeType: "video/VP9", clockRate: 90000 },
    ];
  }
```

- [ ] **Step 4: Write `test/unit/helpers/fakeMedia.ts`**

```ts
import type { CaptureConstraints, MediaPort } from "../../../src/core/ports";
import { FakeMediaStreamTrack } from "./fakeRtc";

export class FakeMediaPort implements MediaPort {
  cameraCalls: CaptureConstraints[] = [];
  screenCalls = 0;
  tracks: FakeMediaStreamTrack[] = [];
  rejectCamera: Error | undefined;
  rejectScreen: Error | undefined;
  async camera(c: CaptureConstraints): Promise<MediaStreamTrack> {
    this.cameraCalls.push({ ...c });
    if (this.rejectCamera) throw this.rejectCamera;
    const t = new FakeMediaStreamTrack();
    t.settings = { width: c.width, height: c.height, frameRate: c.frameRate };
    t.contentHint = "motion";
    this.tracks.push(t);
    return t.asTrack();
  }
  async screen(): Promise<MediaStreamTrack> {
    this.screenCalls++;
    if (this.rejectScreen) throw this.rejectScreen;
    const t = new FakeMediaStreamTrack();
    t.settings = { width: 2560, height: 1440, frameRate: 5 };
    t.contentHint = "detail";
    this.tracks.push(t);
    return t.asTrack();
  }
  last(): FakeMediaStreamTrack {
    const t = this.tracks[this.tracks.length - 1];
    if (!t) throw new Error("no track captured");
    return t;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (the existing PeerSession/controller suites are unaffected: no transceivers ⇒ DC-only fixtures).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write test/unit/helpers/fakeRtc.ts test/unit/helpers/fakeMedia.ts test/unit/helpers/fakeRtc.test.ts
git add test/unit/helpers/fakeRtc.ts test/unit/helpers/fakeMedia.ts test/unit/helpers/fakeRtc.test.ts
git commit -m "test(helpers): fake transceivers, senders, tracks, stats and media port

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: `MediaLink` — negotiation, teacher outbound, stats

**Files:**
- Create: `src/core/mediaLink.ts`
- Create: `test/unit/core/mediaLink.test.ts`

**Interfaces:**
- Produces: `type MediaState = "none" | "negotiating" | "ready" | "unsupported" | "failed"`, `interface MediaTimers { mediaOfferMs: number }`, `DEFAULT_MEDIA_TIMERS`, `interface MediaStatsView { cpuLimited: boolean; encoder?: string; outFps?: number; outHeight?: number; inFps?: number; inHeight?: number; framesDecoded?: number; framesDropped?: number }`, `interface MediaLinkOpts { role; pc: RTCPeerConnection; send(m: MediaMessage): void; clock: Clock; codecs?: RTCRtpCodecCapability[]; timers?: Partial<MediaTimers> }`, `type MediaLinkEvents = { state: [MediaState, string | undefined]; remoteTrack: [MediaStreamTrack]; status: [MediaStatusMessage]; broadcast: [MediaBroadcastMessage]; request: [Profile | null]; capture: [CamState]; ignored: [string] }`.
- `class MediaLink extends Emitter<MediaLinkEvents>` with fields `state`, `reason: string | undefined`, `remoteTrack: MediaStreamTrack | undefined`, `cam: CamState`, `sending: Profile | null`, `lastStatus: MediaStatusMessage | undefined`, `lastBroadcast: MediaBroadcastMessage | undefined`; methods `offer(codec: CodecPref): Promise<void>` (teacher), `markUnsupported(): void`, `setOutbound(track: MediaStreamTrack | null, profile: Profile | null, degradation?: Degradation): Promise<void>` (teacher), `request(send: Profile | null): void` (teacher), `broadcast(on: boolean, source?: MediaSource): void` (teacher), `stats(): Promise<MediaStatsView>`, `handle(m: MediaMessage): void`, `close(): void`. Student-side `applyRequest` and `captureActive` arrive in Task 6.

- [ ] **Step 1: Write the failing tests**

`test/unit/core/mediaLink.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaLink, type MediaState } from "../../../src/core/mediaLink";
import type { MediaMessage } from "../../../src/schemas/media";
import { FakeClock } from "../helpers/fakeClock";
import {
  CHROME_MEDIA_OFFER,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  FakeRtcFactory,
  SAFARI_MEDIA_ANSWER,
  flush,
} from "../helpers/fakeRtc";

const thumb = { height: 180, fps: 10, kbps: 150 } as const;

export function makeLink(role: "teacher" | "student", timers = { mediaOfferMs: 10_000 }) {
  const pc = new FakeRTCPeerConnection({});
  const clock = new FakeClock();
  const sent: MediaMessage[] = [];
  const link = new MediaLink({
    role,
    pc: pc as unknown as RTCPeerConnection,
    send: (m) => sent.push(m),
    clock,
    codecs: new FakeRtcFactory().videoCodecs(),
    timers,
  });
  const states: MediaState[] = [];
  const ignored: string[] = [];
  link.on("state", (s) => states.push(s));
  link.on("ignored", (r) => ignored.push(r));
  return { pc, clock, sent, link, states, ignored };
}

test("teacher offer: two transceivers, H264 first, media.offer seq 1, negotiating", async () => {
  const { pc, sent, link, states } = makeLink("teacher");
  await link.offer("h264");
  assert.deepEqual(pc.getTransceivers().map((t) => t.direction), ["sendonly", "recvonly"]);
  assert.equal(pc.getTransceivers()[0]?.codecPrefs?.[0]?.mimeType, "video/H264");
  assert.equal(pc.getTransceivers()[0]?.codecPrefs?.[0]?.sdpFmtpLine?.includes("packetization-mode=1"), true);
  assert.deepEqual(sent[0], { t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  assert.deepEqual(states, ["negotiating"]);
  assert.equal(pc.signalingState, "have-local-offer");
});

test("teacher: codec 'auto' sets no preferences", async () => {
  const { pc, link } = makeLink("teacher");
  await link.offer("auto");
  assert.equal(pc.getTransceivers()[0]?.codecPrefs, undefined);
});

test("teacher answer → ready, remoteTrack from the recvonly transceiver", async () => {
  const { pc, link, states } = makeLink("teacher");
  let track: unknown;
  link.on("remoteTrack", (t) => (track = t));
  await link.offer("h264");
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.deepEqual(states, ["negotiating", "ready"]);
  assert.equal(pc.signalingState, "stable");
  assert.equal(track, pc.getTransceivers()[1]?.receiver.track);
  assert.equal(link.remoteTrack, track);
});

test("teacher: stale or unexpected answers are ignored", async () => {
  const { link, ignored } = makeLink("teacher");
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  assert.equal(ignored.length, 1);
  await link.offer("h264");
  link.handle({ t: "media.answer", seq: 7, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(ignored.length, 2);
  assert.equal(link.state, "negotiating");
});

test("teacher: no answer within mediaOfferMs → failed with reason; retry re-offers with seq 2", async () => {
  const { clock, sent, link, states } = makeLink("teacher", { mediaOfferMs: 3000 });
  await link.offer("h264");
  clock.advance(3000);
  assert.equal(link.state, "failed");
  assert.match(link.reason ?? "", /no answer within 3000ms/);
  await link.offer("h264");
  assert.equal((sent[1] as { seq: number }).seq, 2);
  assert.deepEqual(states, ["negotiating", "failed", "negotiating"]);
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER }); // stale
  await flush();
  assert.equal(link.state, "negotiating");
  link.handle({ t: "media.answer", seq: 2, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "ready");
});

test("teacher: setRemoteDescription rejection → failed; offer() refused while ready", async () => {
  const { pc, link } = makeLink("teacher");
  await link.offer("h264");
  pc.rejectSetRemote = new Error("Failed to set remote answer sdp");
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "failed");
  assert.match(link.reason ?? "", /Failed to set remote answer sdp/);
  pc.rejectSetRemote = undefined;
  await link.offer("h264");
  link.handle({ t: "media.answer", seq: 2, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "ready");
  await assert.rejects(link.offer("h264"), /offer in state ready/);
});

test("teacher: createOffer rejection → failed without sending", async () => {
  const { pc, sent, link } = makeLink("teacher");
  pc.rejectCreateOffer = new Error("boom");
  await link.offer("h264");
  assert.equal(link.state, "failed");
  assert.equal(sent.length, 0);
});

test("markUnsupported only from none", async () => {
  const a = makeLink("teacher");
  a.link.markUnsupported();
  assert.equal(a.link.state, "unsupported");
  assert.equal(a.link.reason, "older build");
  const b = makeLink("teacher");
  await b.link.offer("h264");
  b.link.markUnsupported();
  assert.equal(b.link.state, "negotiating");
});

test("student: offer → answer sent with same seq, tx/rx chosen by offered direction, ready", async () => {
  const { pc, sent, link, states } = makeLink("student");
  let track: unknown;
  link.on("remoteTrack", (t) => (track = t));
  link.handle({ t: "media.offer", seq: 3, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.deepEqual(sent[0], { t: "media.answer", seq: 3, sdp: SAFARI_MEDIA_ANSWER });
  // mid 1 was offered sendonly (teacher sends) → we stay recvonly; mid 2 offered recvonly → we send.
  assert.deepEqual(pc.getTransceivers().map((t) => [t.mid, t.direction]), [["1", "recvonly"], ["2", "sendonly"]]);
  assert.deepEqual(states, ["negotiating", "ready"]);
  assert.equal(track, pc.getTransceivers()[0]?.receiver.track);
  assert.equal(pc.signalingState, "stable");
});

test("student: offer while not stable is ignored; offer at teacher / answer at student ignored", async () => {
  const s = makeLink("student");
  s.pc.signalingState = "have-local-offer";
  s.link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.equal(s.ignored.length, 1);
  assert.equal(s.link.state, "none");
  s.link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  assert.equal(s.ignored.length, 2);
  const t = makeLink("teacher");
  t.link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  assert.equal(t.ignored.length, 1);
});

test("student: setRemoteDescription rejection → failed, nothing sent", async () => {
  const { pc, sent, link } = makeLink("student");
  pc.rejectSetRemote = new Error("bad sdp");
  link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.equal(link.state, "failed");
  assert.match(link.reason ?? "", /bad sdp/);
  assert.equal(sent.length, 0);
});

test("routing: request → student event; status → teacher event; broadcast → student event", async () => {
  const s = makeLink("student");
  const reqs: unknown[] = [];
  const bcs: unknown[] = [];
  s.link.on("request", (r) => reqs.push(r));
  s.link.on("broadcast", (b) => bcs.push(b));
  s.link.handle({ t: "media.request", send: thumb });
  s.link.handle({ t: "media.request", send: null });
  s.link.handle({ t: "media.broadcast", on: true, source: "screen" });
  assert.deepEqual(reqs, [thumb, null]);
  assert.deepEqual(bcs, [{ t: "media.broadcast", on: true, source: "screen" }]);
  assert.deepEqual(s.link.lastBroadcast, { t: "media.broadcast", on: true, source: "screen" });
  s.link.handle({ t: "media.status", cam: "on", send: thumb });
  assert.equal(s.ignored.length, 1);
  const t = makeLink("teacher");
  const statuses: unknown[] = [];
  t.link.on("status", (m) => statuses.push(m));
  t.link.handle({ t: "media.status", cam: "on", send: thumb });
  assert.deepEqual(statuses, [{ t: "media.status", cam: "on", send: thumb }]);
  assert.equal(t.link.lastStatus?.cam, "on");
  t.link.handle({ t: "media.request", send: null });
  assert.equal(t.ignored.length, 1);
});

async function readyTeacher() {
  const ctx = makeLink("teacher");
  await ctx.link.offer("h264");
  ctx.link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  return ctx;
}

test("teacher setOutbound: replaceTrack + scaled encoding + degradation; null clears", async () => {
  const { pc, link } = await readyTeacher();
  const track = new FakeMediaStreamTrack();
  await link.setOutbound(track.asTrack(), { height: 360, fps: 15, kbps: 600 }, "balanced");
  const sender = pc.getTransceivers()[0]!.sender;
  assert.equal(sender.track, track.asTrack());
  assert.deepEqual(sender.encoding(), { scaleResolutionDownBy: 2, maxFramerate: 15, maxBitrate: 600_000 });
  assert.equal((sender.params as { degradationPreference?: string }).degradationPreference, "balanced");
  await link.setOutbound(null, null);
  assert.equal(sender.track, null);
  assert.equal(sender.setParametersCalls.length, 1);
});

test("teacher setOutbound / request / broadcast are no-ops before ready", async () => {
  const { pc, sent, link } = makeLink("teacher");
  await link.offer("h264");
  await link.setOutbound(new FakeMediaStreamTrack().asTrack(), thumb);
  link.request(thumb);
  link.broadcast(true, "camera");
  assert.equal(pc.getTransceivers()[0]?.sender.replaceTrackCalls.length, 0);
  assert.equal(sent.length, 1); // only the offer
});

test("teacher request / broadcast send the messages once ready", async () => {
  const { sent, link } = await readyTeacher();
  link.request(thumb);
  link.request(null);
  link.broadcast(true, "screen");
  link.broadcast(false);
  assert.deepEqual(sent.slice(1), [
    { t: "media.request", send: thumb },
    { t: "media.request", send: null },
    { t: "media.broadcast", on: true, source: "screen" },
    { t: "media.broadcast", on: false },
  ]);
});

test("stats picks the video outbound/inbound rtp entries", async () => {
  const { pc, link } = await readyTeacher();
  pc.statsReport.set("o1", {
    type: "outbound-rtp",
    kind: "video",
    encoderImplementation: "VideoToolbox",
    qualityLimitationReason: "cpu",
    framesPerSecond: 14,
    frameHeight: 360,
  });
  pc.statsReport.set("i1", {
    type: "inbound-rtp",
    kind: "video",
    framesPerSecond: 9,
    frameHeight: 180,
    framesDecoded: 120,
    framesDropped: 2,
  });
  pc.statsReport.set("x", { type: "candidate-pair" });
  assert.deepEqual(await link.stats(), {
    cpuLimited: true,
    encoder: "VideoToolbox",
    outFps: 14,
    outHeight: 360,
    inFps: 9,
    inHeight: 180,
    framesDecoded: 120,
    framesDropped: 2,
  });
  pc.statsReport.clear();
  assert.deepEqual(await link.stats(), { cpuLimited: false });
});

test("close cancels the offer timer and refuses further work", async () => {
  const { clock, link, states } = makeLink("teacher", { mediaOfferMs: 1000 });
  await link.offer("h264");
  link.close();
  clock.advance(5000);
  assert.deepEqual(states, ["negotiating"]);
  link.handle({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER });
  await flush();
  assert.equal(link.state, "negotiating");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "mediaLink|fail" | head`
Expected: FAIL — `Cannot find module '../../../src/core/mediaLink'`.

- [ ] **Step 3: Write `src/core/mediaLink.ts`**

```ts
import type {
  CamState,
  MediaAnswerMessage,
  MediaBroadcastMessage,
  MediaMessage,
  MediaOfferMessage,
  MediaSource,
  MediaStatusMessage,
  Profile,
} from "../schemas/media";
import type { Clock, TimerHandle } from "./clock";
import { Emitter } from "./events";
import {
  CAPTURE,
  applyEncoding,
  encodingFor,
  offeredDirections,
  orderCodecs,
  type CodecPref,
  type Degradation,
} from "./media";
import type { MediaPort } from "./ports";

export type MediaState = "none" | "negotiating" | "ready" | "unsupported" | "failed";

export interface MediaTimers {
  mediaOfferMs: number;
}
export const DEFAULT_MEDIA_TIMERS: MediaTimers = { mediaOfferMs: 10_000 };

export interface MediaStatsView {
  cpuLimited: boolean;
  encoder?: string;
  outFps?: number;
  outHeight?: number;
  inFps?: number;
  inHeight?: number;
  framesDecoded?: number;
  framesDropped?: number;
}

export type MediaLinkEvents = {
  state: [MediaState, string | undefined];
  remoteTrack: [MediaStreamTrack];
  /** Teacher side: the student reported what it is sending. */
  status: [MediaStatusMessage];
  /** Student side: the teacher said whether to show its video. */
  broadcast: [MediaBroadcastMessage];
  /** Student side: the teacher asked for a profile (or null). The controller applies it. */
  request: [Profile | null];
  /** Student side: our own capture state changed. */
  capture: [CamState];
  ignored: [string];
};

export interface MediaLinkOpts {
  role: "student" | "teacher";
  pc: RTCPeerConnection;
  send(m: MediaMessage): void;
  clock: Clock;
  codecs?: RTCRtpCodecCapability[];
  timers?: Partial<MediaTimers>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One session's media: two video transceivers negotiated once by the teacher over the DataChannel,
 * then driven with replaceTrack/setParameters only. Best-effort: nothing here touches the session.
 */
export class MediaLink extends Emitter<MediaLinkEvents> {
  state: MediaState = "none";
  reason: string | undefined;
  remoteTrack: MediaStreamTrack | undefined;
  /** Student side: what our camera is doing. */
  cam: CamState = "off";
  sending: Profile | null = null;
  lastStatus: MediaStatusMessage | undefined;
  lastBroadcast: MediaBroadcastMessage | undefined;

  private readonly timers: MediaTimers;
  /** The transceiver we send on. */
  private tx: RTCRtpTransceiver | undefined;
  /** The transceiver we receive on. */
  private rx: RTCRtpTransceiver | undefined;
  private seq = 0;
  private offerTimer: TimerHandle | undefined;
  private captureTrack: MediaStreamTrack | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly opts: MediaLinkOpts) {
    super();
    this.timers = { ...DEFAULT_MEDIA_TIMERS, ...opts.timers };
  }

  // ---- teacher ----

  /** Teacher only: add the two transceivers (once) and send a full-SDP offer. Sequential by seq. */
  async offer(codec: CodecPref): Promise<void> {
    if (this.opts.role !== "teacher") throw new Error("only the teacher offers media");
    if (this.state !== "none" && this.state !== "failed") throw new Error(`offer in state ${this.state}`);
    if (this.closed) return;
    const pc = this.opts.pc;
    this.tx ??= pc.addTransceiver("video", { direction: "sendonly" });
    this.rx ??= pc.addTransceiver("video", { direction: "recvonly" });
    const codecs = this.opts.codecs ?? [];
    if (codec !== "auto" && codecs.length > 0) {
      for (const t of [this.tx, this.rx]) {
        try {
          t.setCodecPreferences(orderCodecs(codecs, codec));
        } catch {
          /* engine without setCodecPreferences: its defaults are still negotiable */
        }
      }
    }
    this.setState("negotiating");
    try {
      await pc.setLocalDescription(await pc.createOffer());
    } catch (e) {
      return this.fail(`createOffer: ${msg(e)}`);
    }
    if (this.closed) return;
    const sdp = pc.localDescription?.sdp;
    if (!sdp) return this.fail("no local description after createOffer");
    this.seq += 1;
    this.opts.send({ t: "media.offer", seq: this.seq, sdp });
    this.offerTimer = this.opts.clock.setTimeout(
      () => this.fail(`no answer within ${this.timers.mediaOfferMs}ms`),
      this.timers.mediaOfferMs,
    );
  }

  /** The peer's hello had no "media" capability: nothing to negotiate, say so on the tile. */
  markUnsupported(): void {
    if (this.state === "none") this.setState("unsupported", "older build");
  }

  /** Teacher: attach (or detach) the broadcast track and cap its encoder. No-op unless ready. */
  async setOutbound(
    track: MediaStreamTrack | null,
    profile: Profile | null,
    degradation?: Degradation,
  ): Promise<void> {
    if (!this.tx || this.state !== "ready") return;
    try {
      await this.tx.sender.replaceTrack(track);
      if (track && profile)
        await applyEncoding(this.tx.sender, encodingFor(profile, track.getSettings().height), degradation);
    } catch (e) {
      this.reason = `outbound: ${msg(e)}`;
    }
  }

  /** Teacher: tell the student what to send. */
  request(send: Profile | null): void {
    if (this.state !== "ready") return;
    this.opts.send({ t: "media.request", send });
  }

  /** Teacher: tell the student whether our video is on, and what it is. */
  broadcast(on: boolean, source?: MediaSource): void {
    if (this.state !== "ready") return;
    this.opts.send({ t: "media.broadcast", on, ...(source ? { source } : {}) });
  }

  async stats(): Promise<MediaStatsView> {
    const v: MediaStatsView = { cpuLimited: false };
    let report: RTCStatsReport;
    try {
      report = await this.opts.pc.getStats();
    } catch {
      return v;
    }
    const num = (s: Record<string, unknown>, k: string) =>
      typeof s[k] === "number" ? (s[k] as number) : undefined;
    report.forEach((s: Record<string, unknown>) => {
      if (s["kind"] !== "video") return;
      if (s["type"] === "outbound-rtp") {
        if (typeof s["encoderImplementation"] === "string") v.encoder = s["encoderImplementation"];
        v.cpuLimited = s["qualityLimitationReason"] === "cpu";
        const fps = num(s, "framesPerSecond");
        const h = num(s, "frameHeight");
        if (fps !== undefined) v.outFps = fps;
        if (h !== undefined) v.outHeight = h;
      } else if (s["type"] === "inbound-rtp") {
        const fps = num(s, "framesPerSecond");
        const h = num(s, "frameHeight");
        const dec = num(s, "framesDecoded");
        const drop = num(s, "framesDropped");
        if (fps !== undefined) v.inFps = fps;
        if (h !== undefined) v.inHeight = h;
        if (dec !== undefined) v.framesDecoded = dec;
        if (drop !== undefined) v.framesDropped = drop;
      }
    });
    return v;
  }

  // ---- student ----
  // applyRequest / captureActive: Task 6.

  // ---- both ----

  /** Inbound media.* frame, already schema-valid. Wrong role or state ⇒ ignored, never thrown. */
  handle(m: MediaMessage): void {
    if (this.closed) return;
    const student = this.opts.role === "student";
    switch (m.t) {
      case "media.offer":
        if (!student) return this.ignore("media.offer at teacher");
        void this.onOffer(m);
        return;
      case "media.answer":
        if (student) return this.ignore("media.answer at student");
        void this.onAnswer(m);
        return;
      case "media.request":
        if (!student) return this.ignore("media.request at teacher");
        this.emit("request", m.send);
        return;
      case "media.status":
        if (student) return this.ignore("media.status at student");
        this.lastStatus = m;
        this.emit("status", m);
        return;
      case "media.broadcast":
        if (!student) return this.ignore("media.broadcast at teacher");
        this.lastBroadcast = m;
        this.emit("broadcast", m);
        return;
    }
  }

  /** Stop the offer timer and any capture we started. Idempotent; the PC is the session's to close. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearOfferTimer();
    this.stopCapture();
  }

  // ---- internals ----

  private async onOffer(m: MediaOfferMessage): Promise<void> {
    const pc = this.opts.pc;
    if (pc.signalingState !== "stable")
      return this.ignore(`media.offer in signaling state ${pc.signalingState}`);
    this.seq = m.seq;
    this.setState("negotiating");
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
      if (this.closed) return;
      const dirs = offeredDirections(m.sdp);
      for (const t of pc.getTransceivers()) {
        if (t.mid === null) continue;
        const d = dirs.get(t.mid);
        if (d === "recvonly") {
          // The teacher wants to receive here: this is where our camera goes.
          t.direction = "sendonly";
          this.tx = t;
        } else if (d === "sendonly") {
          this.rx = t;
        }
      }
      await pc.setLocalDescription(await pc.createAnswer());
      if (this.closed) return;
      const sdp = pc.localDescription?.sdp;
      if (!sdp) return this.fail("no local description after createAnswer");
      this.opts.send({ t: "media.answer", seq: m.seq, sdp });
      this.ready();
    } catch (e) {
      this.fail(`answer: ${msg(e)}`);
    }
  }

  private async onAnswer(m: MediaAnswerMessage): Promise<void> {
    if (this.state !== "negotiating") return this.ignore("media.answer while not negotiating");
    if (m.seq !== this.seq) return this.ignore(`media.answer seq ${m.seq}, expected ${this.seq}`);
    try {
      await this.opts.pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
      if (this.closed) return;
      this.ready();
    } catch (e) {
      this.fail(`answer: ${msg(e)}`);
    }
  }

  private ready(): void {
    this.clearOfferTimer();
    this.reason = undefined;
    this.setState("ready");
    if (this.rx) {
      this.remoteTrack = this.rx.receiver.track;
      this.emit("remoteTrack", this.remoteTrack);
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.clearOfferTimer();
    this.reason = reason;
    this.setState("failed", reason);
  }

  private clearOfferTimer(): void {
    if (this.offerTimer !== undefined) this.opts.clock.clearTimeout(this.offerTimer);
    this.offerTimer = undefined;
  }

  protected stopCapture(): void {
    const t = this.captureTrack;
    if (!t) return;
    t.onended = null;
    t.stop();
    this.captureTrack = null;
  }

  private ignore(why: string): void {
    this.emit("ignored", why);
  }

  private setState(s: MediaState, reason?: string): void {
    if (this.state === s) return;
    this.state = s;
    this.emit("state", s, reason);
  }
}

// Referenced by Task 6's student-side implementation; kept here so the import stays used.
export const STUDENT_CAPTURE = CAPTURE;
export type { MediaPort as StudentMediaPort };
```

(The two trailing exports exist only so `CAPTURE` and `MediaPort` are imported now without an unused-import lint error; Task 6 deletes them when `applyRequest` uses both.)

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/mediaLink.ts test/unit/core/mediaLink.test.ts
git add src/core/mediaLink.ts test/unit/core/mediaLink.test.ts
git commit -m "feat(core): MediaLink negotiates two video transceivers over the DataChannel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `MediaLink` — student capture lifecycle

**Files:**
- Modify: `src/core/mediaLink.ts`
- Modify: `test/unit/core/mediaLink.test.ts`

**Interfaces:**
- Produces: `MediaLink.applyRequest(send: Profile | null, port: MediaPort): Promise<void>` (student; serialised; resolves after `media.status` was sent), `MediaLink.captureActive(): boolean`. `capture` event fires with the new `cam` after every status report.

- [ ] **Step 1: Write the failing tests** (append to `test/unit/core/mediaLink.test.ts`)

```ts
import { FakeMediaPort } from "../helpers/fakeMedia";

async function readyStudent() {
  const ctx = makeLink("student");
  ctx.link.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  const port = new FakeMediaPort();
  const sender = ctx.pc.getTransceivers()[1]!.sender; // mid 2: offered recvonly → we send
  return { ...ctx, port, sender };
}

test("student thumb request: capture 720p15 once, replaceTrack, scale 4, status on", async () => {
  const { link, port, sender, sent } = await readyStudent();
  const caps: string[] = [];
  link.on("capture", (c) => caps.push(c));
  await link.applyRequest(thumb, port);
  assert.deepEqual(port.cameraCalls, [{ width: 1280, height: 720, frameRate: 15 }]);
  assert.equal(sender.track, port.last().asTrack());
  assert.deepEqual(sender.encoding(), { scaleResolutionDownBy: 4, maxFramerate: 10, maxBitrate: 150_000 });
  assert.deepEqual(sent.at(-1), { t: "media.status", cam: "on", send: thumb });
  assert.equal(link.cam, "on");
  assert.deepEqual(link.sending, thumb);
  assert.equal(link.captureActive(), true);
  assert.deepEqual(caps, ["on"]);
  // Focus: same track, new parameters, no second capture.
  await link.applyRequest({ height: 720, fps: 15, kbps: 1200 }, port);
  assert.equal(port.cameraCalls.length, 1);
  assert.deepEqual(sender.encoding(), { scaleResolutionDownBy: 1, maxFramerate: 15, maxBitrate: 1_200_000 });
});

test("student null request: track stopped, replaceTrack(null), status off", async () => {
  const { link, port, sender, sent } = await readyStudent();
  await link.applyRequest(thumb, port);
  await link.applyRequest(null, port);
  assert.equal(port.last().stopped, true);
  assert.equal(sender.replaceTrackCalls.at(-1), null);
  assert.deepEqual(sent.at(-1), { t: "media.status", cam: "off", send: null });
  assert.equal(link.captureActive(), false);
  // A later request captures afresh.
  await link.applyRequest(thumb, port);
  assert.equal(port.cameraCalls.length, 2);
});

test("student: setParameters rejection falls back to applyConstraints", async () => {
  const { link, port, sender } = await readyStudent();
  sender.rejectSetParameters = new Error("InvalidModificationError");
  await link.applyRequest({ height: 360, fps: 15, kbps: 1200 }, port);
  assert.deepEqual(port.last().constraintsApplied, [{ height: 360, frameRate: 15 }]);
  assert.equal(link.cam, "on");
});

test("student: camera rejection → status error with reason, no track", async () => {
  const { link, port, sender, sent } = await readyStudent();
  port.rejectCamera = new Error("NotAllowedError: permission denied");
  await link.applyRequest(thumb, port);
  assert.deepEqual(sent.at(-1), {
    t: "media.status",
    cam: "error",
    reason: "NotAllowedError: permission denied",
    send: null,
  });
  assert.equal(sender.replaceTrackCalls.length, 0);
  assert.equal(link.captureActive(), false);
});

test("student: capture track ended → status error 'camera ended'", async () => {
  const { link, port, sent } = await readyStudent();
  await link.applyRequest(thumb, port);
  port.last().end();
  assert.deepEqual(sent.at(-1), { t: "media.status", cam: "error", reason: "camera ended", send: null });
  assert.equal(link.captureActive(), false);
});

test("student: requests are serialised; the last one wins", async () => {
  const { link, port, sender } = await readyStudent();
  const a = link.applyRequest(thumb, port);
  const b = link.applyRequest(null, port);
  await Promise.all([a, b]);
  assert.equal(link.cam, "off");
  assert.equal(sender.replaceTrackCalls.at(-1), null);
  assert.equal(port.last().stopped, true);
});

test("student: request before ready is ignored; close stops the capture", async () => {
  const early = makeLink("student");
  const port = new FakeMediaPort();
  await early.link.applyRequest(thumb, port);
  assert.equal(port.cameraCalls.length, 0);
  const { link, port: p2 } = await readyStudent();
  await link.applyRequest(thumb, p2);
  link.close();
  assert.equal(p2.last().stopped, true);
  assert.equal(link.captureActive(), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "student thumb|applyRequest|fail" | head`
Expected: FAIL — `link.applyRequest is not a function`.

- [ ] **Step 3: Implement the student side in `src/core/mediaLink.ts`**

Delete the two trailing exports (`STUDENT_CAPTURE`, `StudentMediaPort`). Replace the `// ---- student ----` comment block with:

```ts
  // ---- student ----

  /**
   * Student: apply the teacher's request. Serialised so an in-flight camera grant cannot race the
   * next request. Resolves after the resulting media.status has been sent. Never rejects.
   */
  applyRequest(send: Profile | null, port: MediaPort): Promise<void> {
    this.queue = this.queue.then(() => this.doApply(send, port)).catch(() => {});
    return this.queue;
  }

  captureActive(): boolean {
    return this.captureTrack !== null;
  }
```

Add to the internals (after `onAnswer`):

```ts
  private async doApply(send: Profile | null, port: MediaPort): Promise<void> {
    if (this.closed || this.opts.role !== "student" || this.state !== "ready" || !this.tx) return;
    const sender = this.tx.sender;
    if (send === null) {
      this.stopCapture();
      try {
        await sender.replaceTrack(null);
      } catch {
        /* a closed PC has nothing to detach */
      }
      this.cam = "off";
      this.sending = null;
      return this.report();
    }
    if (!this.captureTrack) {
      let track: MediaStreamTrack;
      try {
        track = await port.camera(CAPTURE);
      } catch (e) {
        this.cam = "error";
        this.sending = null;
        return this.report(msg(e));
      }
      if (this.closed) {
        track.stop();
        return;
      }
      this.captureTrack = track;
      track.onended = () => {
        if (this.captureTrack !== track) return;
        this.captureTrack = null;
        this.cam = "error";
        this.sending = null;
        this.report("camera ended");
      };
      try {
        await sender.replaceTrack(track);
      } catch (e) {
        this.stopCapture();
        this.cam = "error";
        this.sending = null;
        return this.report(`replaceTrack: ${msg(e)}`);
      }
    }
    const track = this.captureTrack;
    try {
      await applyEncoding(sender, encodingFor(send, track.getSettings().height));
    } catch {
      // Older WebKit: no per-encoding scaling. Change the capture itself instead.
      try {
        await track.applyConstraints({ height: send.height, frameRate: send.fps });
      } catch {
        /* best effort: the thumbnail is then just larger than asked */
      }
    }
    this.cam = "on";
    this.sending = send;
    this.report();
  }

  private report(reason?: string): void {
    if (this.closed) return;
    this.opts.send({
      t: "media.status",
      cam: this.cam,
      send: this.sending,
      ...(reason ? { reason } : {}),
    });
    this.emit("capture", this.cam);
  }
```

Also change `protected stopCapture()` to `private stopCapture()` (nothing subclasses it).

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/mediaLink.ts test/unit/core/mediaLink.test.ts
git add src/core/mediaLink.ts test/unit/core/mediaLink.test.ts
git commit -m "feat(core): student side of MediaLink captures on request and reports status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: `PeerSession` creates the link, advertises `caps`, routes `media.*`

**Files:**
- Modify: `src/core/peerSession.ts`
- Modify: `test/unit/core/peerSession.test.ts`

**Interfaces:**
- Produces: `PeerSessionOpts.caps?: string[]`, `PeerSessionOpts.mediaTimers?: Partial<MediaTimers>`; `PeerSession.media: MediaLink | null` (non-null from DC open until teardown); event `media: [MediaLink]` emitted at DC open **before** `hello` is sent and before `state → connected`; `hello` carries `caps` when given; every `media.*` frame goes to `media.handle()` and is **not** re-emitted as `message`; `MediaLink` `ignored` events count in `ignoredCount`; `teardown()` calls `media.close()`.

- [ ] **Step 1: Write the failing tests** (append to `test/unit/core/peerSession.test.ts`)

```ts
import { CHROME_MEDIA_OFFER } from "../helpers/fakeRtc";
import type { MediaLink } from "../../../src/core/mediaLink";

function studentWithCaps() {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const s = new PeerSession({
    role: "student",
    ws: "7",
    rtc,
    clock,
    timers: TIMERS,
    appVersion: "t1",
    ua: "test",
    caps: ["media"],
  });
  return { rtc, clock, s };
}

async function connectedWithCaps() {
  const ctx = studentWithCaps();
  const links: MediaLink[] = [];
  const order: string[] = [];
  ctx.s.on("media", (l) => {
    links.push(l);
    order.push("media");
  });
  ctx.s.on("state", (st) => order.push(st));
  const p = ctx.s.start();
  await flush();
  ctx.rtc.last().completeGathering();
  await p;
  await ctx.s.applyRemote(answerPayload);
  const dc = ctx.rtc.last().channels[0]!;
  dc.open();
  return { ...ctx, dc, links, order };
}

test("hello carries caps when given, and omits it otherwise", async () => {
  const { dc } = await connectedWithCaps();
  const hello = dc.sentJson()[0] as { t: string; caps?: string[] };
  assert.deepEqual(hello.caps, ["media"]);
  const plain = await connectedStudent();
  assert.equal("caps" in (plain.dc.sentJson()[0] as object), false);
});

test("a MediaLink exists from DC open, emitted before connected, closed on teardown", async () => {
  const { s, dc, links, order } = await connectedWithCaps();
  assert.equal(links.length, 1);
  assert.equal(s.media, links[0]);
  assert.deepEqual(order.slice(-2), ["media", "connected"]);
  assert.equal(s.media?.state, "none");
  dc.close();
  assert.equal(s.state, "failed");
  // close() is idempotent; a closed link ignores handle() — prove it by routing an offer.
  s.media?.handle({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER });
  await flush();
  assert.equal(s.media?.state, "none");
});

test("media.* frames route to the link and are not re-emitted as message", async () => {
  const { s, dc } = await connectedWithCaps();
  const messages: string[] = [];
  s.on("message", (m) => messages.push(m.t));
  const requests: unknown[] = [];
  s.media!.on("request", (r) => requests.push(r));
  dc.receive(JSON.stringify({ t: "media.request", send: null }));
  dc.receive(JSON.stringify({ t: "cmd", cmd: "ping" }));
  assert.deepEqual(requests, [null]);
  assert.deepEqual(messages, ["cmd"]);
});

test("a media.answer arriving at the student counts as ignored", async () => {
  const { s, dc } = await connectedWithCaps();
  const before = s.ignoredCount;
  dc.receive(JSON.stringify({ t: "media.answer", seq: 1, sdp: "v=0" }));
  assert.equal(s.ignoredCount, before + 1);
});

test("student answers a media.offer received over the channel", async () => {
  const { s, dc } = await connectedWithCaps();
  dc.receive(JSON.stringify({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER }));
  await flush();
  assert.equal(s.media?.state, "ready");
  const answer = dc.sentJson().find((m) => (m as { t: string }).t === "media.answer") as
    | { seq: number }
    | undefined;
  assert.equal(answer?.seq, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "MediaLink exists|caps when|fail" | head`
Expected: FAIL — `caps` not in hello; `s.media` undefined.

- [ ] **Step 3: Modify `src/core/peerSession.ts`**

Imports: add `import { MediaLink, type MediaTimers } from "./mediaLink";`.

`PeerSessionOpts` gains:

```ts
  /** Feature flags advertised in hello (Phase 2 sends ["media"]). */
  caps?: string[];
  mediaTimers?: Partial<MediaTimers>;
```

`PeerSessionEvents` gains:

```ts
  /** The media link for this session, created at DC open (before `hello` goes out). */
  media: [MediaLink];
```

Field: `media: MediaLink | null = null;`

In `onOpen()`, before `this.send({ t: "hello", ... })`:

```ts
    if (this.pc) {
      const codecs = this.opts.rtc.videoCodecs?.();
      const link = new MediaLink({
        role: this.role,
        pc: this.pc,
        send: (m) => this.send(m),
        clock: this.opts.clock,
        ...(codecs ? { codecs } : {}),
        ...(this.opts.mediaTimers ? { timers: this.opts.mediaTimers } : {}),
      });
      link.on("ignored", (why) => this.ignore(why));
      this.media = link;
      this.emit("media", link);
    }
```

Hello: add `...(this.opts.caps ? { caps: this.opts.caps } : {}),` after `ua`.

In `onFrame()` switch, before `default`:

```ts
      case "media.offer":
      case "media.answer":
      case "media.request":
      case "media.status":
      case "media.broadcast":
        this.media?.handle(m);
        return;
```

In `teardown()`, first line: `this.media?.close();`

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/peerSession.ts test/unit/core/peerSession.test.ts
git add src/core/peerSession.ts test/unit/core/peerSession.test.ts
git commit -m "feat(core): PeerSession owns a MediaLink, advertises caps, routes media.*

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `LabController` — offer on hello, cameras, focus, broadcast, retry, stats

**Files:**
- Modify: `src/core/labController.ts`
- Modify: `test/unit/core/labController.test.ts`

**Interfaces:**
- Produces: `TeacherEnv.media?: MediaPort`, `TeacherEnv.mediaTimers?: Partial<MediaTimers>`, `TeacherEnv.statsMs?: number` (default 2000); `interface TileMedia { state: MediaState; reason?: string; cam: CamState; send: Profile | null; track?: MediaStreamTrack; stats?: MediaStatsView }`; `RosterView.media: TileMedia`; `LabController.broadcast: { source: MediaSource | null; track: MediaStreamTrack | null }`, `focused: string | undefined` (key); methods `startBroadcast(source: MediaSource): Promise<void>` (rejects if the port rejects; calls the port before its first `await`), `stopBroadcast(): void`, `setCameras(on: boolean): void`, `focus(ws: string | null): void`, `retryMedia(ws: string): boolean`.
- Behaviour: on `hello` with `caps` containing `"media"` → `link.offer(settings.media.codec)`; otherwise `link.markUnsupported()`. On link `ready` → apply broadcast (if any), send `media.broadcast`, send `media.request(desired)`. Desired = `focus` if focused, else `thumb` if `cameras`, else `null`. Session `failed`/`remove()` clears focus if it was that station. Stats polled every `statsMs` while any link is ready and (cameras ∨ focused ∨ broadcasting).

- [ ] **Step 1: Write the failing tests** (append to `test/unit/core/labController.test.ts`)

```ts
import { CHROME_MEDIA_OFFER, SAFARI_MEDIA_ANSWER } from "../helpers/fakeRtc";
import { FakeMediaPort } from "../helpers/fakeMedia";

const thumb = { height: 180, fps: 10, kbps: 150 };
const focusP = { height: 720, fps: 15, kbps: 1200 };

function makeMedia(kv = new MemoryKv()) {
  const rtc = new FakeRtcFactory();
  const clock = new FakeClock();
  const media = new FakeMediaPort();
  const lab = new LabController({ rtc, clock, kv, appVersion: "v1", ua: "mac", media, statsMs: 2000 });
  return { rtc, clock, kv, lab, media };
}

const hello = (caps?: string[]) =>
  JSON.stringify({ t: "hello", role: "student", ws: "x", appVersion: "v1", ua: "ipad", ...(caps ? { caps } : {}) });

/** Pair, deliver a hello with media caps, answer the teacher's offer → link ready. */
async function pairMedia(ctx: ReturnType<typeof makeMedia>, ws: string) {
  const { dc } = await pair(ctx, ws);
  const pc = ctx.rtc.last();
  dc.receive(hello(["media"]));
  await flush();
  dc.receive(JSON.stringify({ t: "media.answer", seq: 1, sdp: SAFARI_MEDIA_ANSWER }));
  await flush();
  return { dc, pc, sent: () => dc.sentJson() as { t: string; [k: string]: unknown }[] };
}

test("hello with media caps → offer sent; without → unsupported", async () => {
  const ctx = makeMedia();
  const a = await pair(ctx, "A");
  a.dc.receive(hello(["media"]));
  await flush();
  assert.equal(a.dc.sentJson().some((m) => (m as { t: string }).t === "media.offer"), true);
  assert.equal(tile(ctx, "A").media.state, "negotiating");
  const b = await pair(ctx, "B");
  b.dc.receive(hello());
  await flush();
  assert.equal(tile(ctx, "B").media.state, "unsupported");
  assert.equal(tile(ctx, "B").media.reason, "older build");
  assert.equal(b.dc.sentJson().some((m) => (m as { t: string }).t === "media.offer"), false);
});

test("ready link: broadcast off, request null by default; track exposed on the tile", async () => {
  const ctx = makeMedia();
  const { sent } = await pairMedia(ctx, "A");
  const t = tile(ctx, "A");
  assert.equal(t.media.state, "ready");
  assert.ok(t.media.track);
  const after = sent().filter((m) => m.t.startsWith("media.") && m.t !== "media.offer");
  assert.deepEqual(after, [
    { t: "media.broadcast", on: false },
    { t: "media.request", send: null },
  ]);
});

test("setCameras persists and pushes thumb / null to every ready link", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  const b = await pairMedia(ctx, "B");
  ctx.lab.setCameras(true);
  assert.equal(saved(ctx).settings.media.cameras, true);
  for (const s of [a, b]) assert.deepEqual(s.sent().at(-1), { t: "media.request", send: thumb });
  ctx.lab.setCameras(false);
  for (const s of [a, b]) assert.deepEqual(s.sent().at(-1), { t: "media.request", send: null });
  // A link that becomes ready while cameras are on is asked for thumb immediately.
  ctx.lab.setCameras(true);
  const c = await pairMedia(ctx, "C");
  assert.deepEqual(c.sent().at(-1), { t: "media.request", send: thumb });
});

test("focus swaps profiles between stations and clears when the station fails", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  const b = await pairMedia(ctx, "B");
  ctx.lab.focus("a");
  assert.equal(ctx.lab.focused, "a");
  assert.deepEqual(a.sent().at(-1), { t: "media.request", send: focusP });
  ctx.lab.focus("B");
  assert.deepEqual(a.sent().at(-1), { t: "media.request", send: null });
  assert.deepEqual(b.sent().at(-1), { t: "media.request", send: focusP });
  ctx.lab.focus("nobody");
  assert.equal(ctx.lab.focused, "b");
  b.dc.close();
  assert.equal(ctx.lab.focused, undefined);
  ctx.lab.focus("A");
  ctx.lab.focus(null);
  assert.deepEqual(a.sent().at(-1), { t: "media.request", send: null });
  assert.equal(ctx.lab.focused, undefined);
});

test("media.status updates the tile", async () => {
  const ctx = makeMedia();
  const { dc } = await pairMedia(ctx, "A");
  dc.receive(JSON.stringify({ t: "media.status", cam: "on", send: thumb }));
  assert.equal(tile(ctx, "A").media.cam, "on");
  assert.deepEqual(tile(ctx, "A").media.send, thumb);
  dc.receive(JSON.stringify({ t: "media.status", cam: "error", reason: "NotAllowedError", send: null }));
  assert.equal(tile(ctx, "A").media.cam, "error");
  assert.equal(tile(ctx, "A").media.reason, "NotAllowedError");
});

test("startBroadcast(camera) captures, attaches to every ready link, and notifies students", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  await ctx.lab.startBroadcast("camera");
  assert.equal(ctx.lab.broadcast.source, "camera");
  assert.deepEqual(ctx.media.cameraCalls, [{ width: 1280, height: 720, frameRate: 15 }]);
  const sender = a.pc.getTransceivers()[0]!.sender;
  assert.equal(sender.track, ctx.media.last().asTrack());
  assert.deepEqual(sender.encoding(), { scaleResolutionDownBy: 2, maxFramerate: 15, maxBitrate: 600_000 });
  assert.equal((sender.params as { degradationPreference?: string }).degradationPreference, "balanced");
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: true, source: "camera" });
  // A station that becomes ready later gets the track too.
  const b = await pairMedia(ctx, "B");
  assert.equal(b.pc.getTransceivers()[0]!.sender.track, ctx.media.last().asTrack());
  assert.deepEqual(b.sent().slice(-2)[0], { t: "media.broadcast", on: true, source: "camera" });
});

test("startBroadcast(screen) uses the screen profile; switching stops the old track", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  await ctx.lab.startBroadcast("camera");
  const cam = ctx.media.last();
  await ctx.lab.startBroadcast("screen");
  assert.equal(cam.stopped, true);
  assert.equal(ctx.media.screenCalls, 1);
  const sender = a.pc.getTransceivers()[0]!.sender;
  assert.deepEqual(sender.encoding(), { scaleResolutionDownBy: 2, maxFramerate: 5, maxBitrate: 1_000_000 });
  assert.equal((sender.params as { degradationPreference?: string }).degradationPreference, "maintain-resolution");
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: true, source: "screen" });
});

test("stopBroadcast and track ended both detach and notify", async () => {
  const ctx = makeMedia();
  const a = await pairMedia(ctx, "A");
  await ctx.lab.startBroadcast("camera");
  ctx.lab.stopBroadcast();
  assert.equal(ctx.lab.broadcast.source, null);
  assert.equal(ctx.media.last().stopped, true);
  assert.equal(a.pc.getTransceivers()[0]!.sender.track, null);
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: false });
  await ctx.lab.startBroadcast("screen");
  ctx.media.last().end();
  assert.equal(ctx.lab.broadcast.source, null);
  assert.deepEqual(a.sent().at(-1), { t: "media.broadcast", on: false });
});

test("startBroadcast rejects when the port rejects and changes nothing", async () => {
  const ctx = makeMedia();
  await pairMedia(ctx, "A");
  ctx.media.rejectScreen = new Error("NotAllowedError: cancelled");
  await assert.rejects(ctx.lab.startBroadcast("screen"), /cancelled/);
  assert.equal(ctx.lab.broadcast.source, null);
});

test("retryMedia re-offers only from failed", async () => {
  const ctx = makeMedia();
  const { dc } = await pair(ctx, "A");
  dc.receive(hello(["media"]));
  await flush();
  assert.equal(ctx.lab.retryMedia("A"), false);
  ctx.clock.advance(10_000);
  assert.equal(tile(ctx, "A").media.state, "failed");
  assert.equal(ctx.lab.retryMedia("A"), true);
  await flush();
  assert.equal(tile(ctx, "A").media.state, "negotiating");
  const offers = dc.sentJson().filter((m) => (m as { t: string }).t === "media.offer") as { seq: number }[];
  assert.deepEqual(offers.map((o) => o.seq), [1, 2]);
  assert.equal(ctx.lab.retryMedia("nobody"), false);
});

test("stats are polled only while media is active, and land on the tile", async () => {
  const ctx = makeMedia();
  const { pc } = await pairMedia(ctx, "A");
  pc.statsReport.set("i", { type: "inbound-rtp", kind: "video", frameHeight: 180, framesDecoded: 5 });
  ctx.clock.advance(4000);
  await flush();
  assert.equal(tile(ctx, "A").media.stats, undefined);
  ctx.lab.setCameras(true);
  ctx.clock.advance(2000);
  await flush();
  assert.equal(tile(ctx, "A").media.stats?.inHeight, 180);
  ctx.lab.setCameras(false);
  pc.statsReport.set("i", { type: "inbound-rtp", kind: "video", frameHeight: 360, framesDecoded: 9 });
  ctx.clock.advance(4000);
  await flush();
  assert.equal(tile(ctx, "A").media.stats?.inHeight, 180);
});

test("remove() clears focus and a fresh pairing starts with media none", async () => {
  const ctx = makeMedia();
  await pairMedia(ctx, "A");
  ctx.lab.focus("A");
  ctx.lab.remove("A");
  assert.equal(ctx.lab.focused, undefined);
  await pair(ctx, "A");
  assert.equal(tile(ctx, "A").media.state, "none");
  assert.equal(tile(ctx, "A").media.cam, "off");
});
```

Note: the existing `saved()` helper's return type needs `settings: { heartbeatMs: number; media: { cameras: boolean } }`; extend it.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test 2>&1 | grep -E "hello with media|setCameras|fail" | head`
Expected: FAIL — `media` missing on the tile; `setCameras` not a function.

- [ ] **Step 3: Modify `src/core/labController.ts`**

Imports to add:

```ts
import type { CamState, MediaSource, Profile } from "../schemas/media";
import { MEDIA_CAP } from "../schemas/media";
import type { TimerHandle } from "./clock";
import { CAPTURE, type Degradation } from "./media";
import type { MediaLink, MediaState, MediaStatsView, MediaTimers } from "./mediaLink";
import type { KeyValueStore, MediaPort, RtcFactory, Visibility } from "./ports";
```

`TeacherEnv` gains:

```ts
  media?: MediaPort;
  mediaTimers?: Partial<MediaTimers>;
  /** Stats poll period while media is active. */
  statsMs?: number;
```

New exported type and `RosterView.media`:

```ts
export interface TileMedia {
  state: MediaState;
  reason?: string;
  cam: CamState;
  send: Profile | null;
  /** The student's video, once negotiated. The UI wraps it in a MediaStream. */
  track?: MediaStreamTrack;
  stats?: MediaStatsView;
}
```

Add `media: TileMedia;` to `RosterView` (after `replaced`). Add to `Live`:

```ts
  media: { cam: CamState; send: Profile | null; reason?: string; track?: MediaStreamTrack; stats?: MediaStatsView };
```

Constants: `const DEFAULT_STATS_MS = 2000;`

New fields on the class:

```ts
  readonly broadcast: { source: MediaSource | null; track: MediaStreamTrack | null } = {
    source: null,
    track: null,
  };
  /** wsKey of the focused station, if any. */
  focused: string | undefined;
  private statsTimer: TimerHandle | undefined;
```

In `acceptOffer`, the `new PeerSession({...})` gains `caps: [MEDIA_CAP],` and `...(this.env.mediaTimers ? { mediaTimers: this.env.mediaTimers } : {}),`. The `this.live.set(key, {...})` call gains `media: { cam: "off", send: null },`.

In `remove()`, after `this.sessions.get(key)?.close();`: `if (this.focused === key) this.focused = undefined;` and before `this.persist()`: `this.syncStats();`.

New public methods (after `sendCmd`):

```ts
  /**
   * Start sending the teacher's camera or screen to every ready station. The port is called
   * before the first await so a click handler's user activation still covers getDisplayMedia.
   */
  async startBroadcast(source: MediaSource): Promise<void> {
    const port = this.env.media;
    if (!port) throw new Error("no media port");
    const pending = source === "camera" ? port.camera(CAPTURE) : port.screen();
    const track = await pending;
    this.stopBroadcastTrack();
    this.broadcast.source = source;
    this.broadcast.track = track;
    track.onended = () => {
      if (this.broadcast.track === track) this.stopBroadcast();
    };
    for (const s of this.sessions.values()) this.applyBroadcast(s);
    this.syncStats();
    this.changed();
  }

  stopBroadcast(): void {
    if (this.broadcast.source === null && this.broadcast.track === null) return;
    this.stopBroadcastTrack();
    this.broadcast.source = null;
    for (const s of this.sessions.values()) this.applyBroadcast(s);
    this.syncStats();
    this.changed();
  }

  /** Thumbnails from every station (persisted preference). */
  setCameras(on: boolean): void {
    this.state.settings.media.cameras = on;
    for (const [key, s] of this.sessions) s.media?.request(this.desiredSend(key));
    this.syncStats();
    this.persist();
  }

  /** Raise one station to the focus profile; null clears. Unknown ws ⇒ no change. */
  focus(ws: string | null): void {
    const key = ws === null ? undefined : wsKey(ws);
    if (key !== undefined && !this.sessions.has(key)) return;
    const prev = this.focused;
    if (prev === key) return;
    this.focused = key;
    if (prev !== undefined) this.sessions.get(prev)?.media?.request(this.desiredSend(prev));
    if (key !== undefined) this.sessions.get(key)?.media?.request(this.desiredSend(key));
    this.syncStats();
    this.changed();
  }

  /** Re-offer media to a station whose negotiation failed. */
  retryMedia(ws: string): boolean {
    const link = this.sessions.get(wsKey(ws))?.media;
    if (!link || link.state !== "failed") return false;
    void link.offer(this.state.settings.media.codec);
    return true;
  }
```

In `snapshot()`, inside the map, after computing `l`:

```ts
      const link = s?.media;
      const media: TileMedia = {
        state: link?.state ?? "none",
        cam: l?.media.cam ?? "off",
        send: l?.media.send ?? null,
      };
      const reason = link?.reason ?? l?.media.reason;
      if (reason !== undefined) media.reason = reason;
      if (l?.media.track) media.track = l.media.track;
      if (l?.media.stats) media.stats = l.media.stats;
```

and add `media,` to the `RosterView` literal.

In `wire()`:
- In the `"state"` handler, after the history push: `if (st === "failed" && this.focused === key) this.focused = undefined; if (st === "failed") this.syncStats();`
- Replace the `"hello"` handler:

```ts
    s.on("hello", (h) => {
      const e = this.entry(ws);
      e.lastSeenUa = h.ua;
      const l = this.live.get(key);
      if (l) l.remoteAppVersion = h.appVersion;
      this.persist();
      const link = s.media;
      if (link) {
        if (h.caps?.includes(MEDIA_CAP)) void link.offer(this.state.settings.media.codec);
        else link.markUnsupported();
      }
    });
    s.on("media", (link) => this.wireMedia(key, s, link));
```

New private methods:

```ts
  private wireMedia(key: string, s: PeerSession, link: MediaLink): void {
    link.on("state", (st) => {
      if (st === "ready") {
        this.applyBroadcast(s);
        link.request(this.desiredSend(key));
      }
      if (st === "failed" && this.focused === key) this.focused = undefined;
      this.syncStats();
      this.changed();
    });
    link.on("status", (m) => {
      const l = this.live.get(key);
      if (l) {
        l.media.cam = m.cam;
        l.media.send = m.send;
        if (m.reason !== undefined) l.media.reason = m.reason;
        else delete l.media.reason;
      }
      this.changed();
    });
    link.on("remoteTrack", (track) => {
      const l = this.live.get(key);
      if (l) l.media.track = track;
      this.changed();
    });
  }

  private desiredSend(key: string): Profile | null {
    const m = this.state.settings.media;
    if (this.focused === key) return m.focus;
    return m.cameras ? m.thumb : null;
  }

  /** Push the current broadcast (or its absence) to one ready link. */
  private applyBroadcast(s: PeerSession): void {
    const link = s.media;
    if (!link || link.state !== "ready") return;
    const { source, track } = this.broadcast;
    const m = this.state.settings.media;
    const profile = source === "camera" ? m.broadcastCamera : source === "screen" ? m.broadcastScreen : null;
    const degradation: Degradation = source === "screen" ? "maintain-resolution" : "balanced";
    void link.setOutbound(track, profile, degradation);
    if (source) link.broadcast(true, source);
    else link.broadcast(false);
  }

  private stopBroadcastTrack(): void {
    const t = this.broadcast.track;
    if (t) {
      t.onended = null;
      t.stop();
    }
    this.broadcast.track = null;
  }

  private mediaActive(): boolean {
    return this.broadcast.source !== null || this.state.settings.media.cameras || this.focused !== undefined;
  }

  /** Poll getStats only while something is streaming and someone is ready to report. */
  private syncStats(): void {
    const anyReady = [...this.sessions.values()].some((s) => s.media?.state === "ready");
    const want = this.mediaActive() && anyReady;
    if (want && this.statsTimer === undefined) {
      this.statsTimer = this.env.clock.setInterval(
        () => void this.pollStats(),
        this.env.statsMs ?? DEFAULT_STATS_MS,
      );
    } else if (!want && this.statsTimer !== undefined) {
      this.env.clock.clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private async pollStats(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [key, s] of this.sessions) {
      const link = s.media;
      if (!link || link.state !== "ready") continue;
      jobs.push(
        link.stats().then((v) => {
          const l = this.live.get(key);
          if (l) l.media.stats = v;
        }),
      );
    }
    if (jobs.length === 0) return;
    await Promise.all(jobs);
    this.changed();
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. If the "stats are polled only while media is active" test finds `inHeight` updated after `setCameras(false)`, the interval was not cleared: check that `syncStats()` runs inside `setCameras` **after** the flag flips.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/labController.ts test/unit/core/labController.test.ts
git add src/core/labController.ts test/unit/core/labController.test.ts
git commit -m "feat(core): LabController drives media: offer on hello, cameras, focus, broadcast, stats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `StudentController` — apply requests, expose a media view

**Files:**
- Modify: `src/core/studentController.ts`
- Modify: `test/unit/core/studentController.test.ts`

**Interfaces:**
- Produces: `StudentEnv.media: MediaPort` (required), `StudentEnv.mediaTimers?: Partial<MediaTimers>`; `interface StudentMediaView { state: MediaState; cam: CamState; send: Profile | null; teacherTrack?: MediaStreamTrack; broadcast: { on: boolean; source?: MediaSource } }`; `StudentController.mediaView(): StudentMediaView`; event `media: [StudentMediaView]` after every link change (state, request applied, broadcast, capture, remote track) and when the session fails.

- [ ] **Step 1: Write the failing tests** (modify `make()` in `test/unit/core/studentController.test.ts` to pass a port, then append tests)

In `make()`: add `const media = new FakeMediaPort();`, pass `media,` in the env object, and return `media` alongside the others. Add the import `import { FakeMediaPort } from "../helpers/fakeMedia";` and `import { CHROME_MEDIA_OFFER } from "../helpers/fakeRtc";`.

Append:

```ts
const thumb = { height: 180, fps: 10, kbps: 150 };

async function bringUpMedia(ctx: ReturnType<typeof make>) {
  const dc = await bringUp(ctx);
  dc.receive(JSON.stringify({ t: "media.offer", seq: 1, sdp: CHROME_MEDIA_OFFER }));
  await flush();
  return dc;
}

test("hello advertises the media capability", async () => {
  const ctx = make();
  const dc = await bringUp(ctx);
  assert.deepEqual((dc.sentJson()[0] as { caps?: string[] }).caps, ["media"]);
});

test("media view: none → ready with the teacher's track; broadcast state follows messages", async () => {
  const ctx = make();
  const views: unknown[] = [];
  ctx.c.on("media", (v) => views.push(v));
  assert.equal(ctx.c.mediaView().state, "none");
  const dc = await bringUpMedia(ctx);
  const v = ctx.c.mediaView();
  assert.equal(v.state, "ready");
  assert.ok(v.teacherTrack);
  assert.deepEqual(v.broadcast, { on: false });
  dc.receive(JSON.stringify({ t: "media.broadcast", on: true, source: "screen" }));
  assert.deepEqual(ctx.c.mediaView().broadcast, { on: true, source: "screen" });
  assert.ok(views.length >= 2);
});

test("media.request thumb → camera captured, status sent, view says cam on", async () => {
  const ctx = make();
  const dc = await bringUpMedia(ctx);
  dc.receive(JSON.stringify({ t: "media.request", send: thumb }));
  await flush();
  await flush();
  assert.equal(ctx.media.cameraCalls.length, 1);
  assert.deepEqual(dc.sentJson().at(-1), { t: "media.status", cam: "on", send: thumb });
  assert.equal(ctx.c.mediaView().cam, "on");
  assert.deepEqual(ctx.c.mediaView().send, thumb);
});

test("session failure stops the camera; the next session starts from media none", async () => {
  const ctx = make();
  const dc = await bringUpMedia(ctx);
  dc.receive(JSON.stringify({ t: "media.request", send: thumb }));
  await flush();
  await flush();
  const track = ctx.media.last();
  dc.close();
  assert.equal(track.stopped, true);
  assert.equal(ctx.c.mediaView().state, "none");
  assert.equal(ctx.c.mediaView().cam, "off");
});

test("stop() stops the camera", async () => {
  const ctx = make();
  const dc = await bringUpMedia(ctx);
  dc.receive(JSON.stringify({ t: "media.request", send: thumb }));
  await flush();
  await flush();
  ctx.c.stop();
  assert.equal(ctx.media.last().stopped, true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm typecheck 2>&1 | head -5; pnpm test 2>&1 | grep -E "media view|advertises|fail" | head`
Expected: typecheck error on `media` in env (unknown property) and test failures on `mediaView`.

- [ ] **Step 3: Modify `src/core/studentController.ts`**

Imports:

```ts
import type { CamState, MediaSource, Profile } from "../schemas/media";
import { MEDIA_CAP } from "../schemas/media";
import type { MediaLink, MediaState, MediaTimers } from "./mediaLink";
import type { DevicePort, KeyValueStore, MediaPort, RtcFactory, WakeLockPort } from "./ports";
```

`StudentEnv` gains `media: MediaPort;` and `mediaTimers?: Partial<MediaTimers>;`.

New exported type:

```ts
export interface StudentMediaView {
  state: MediaState;
  cam: CamState;
  send: Profile | null;
  /** The teacher's video, once negotiated. Shown only while broadcast.on. */
  teacherTrack?: MediaStreamTrack;
  broadcast: { on: boolean; source?: MediaSource };
}
```

`StudentEvents` gains `media: [StudentMediaView];`.

Public method:

```ts
  mediaView(): StudentMediaView {
    const link = this.session?.media;
    // A failed session's link is closed; report it as gone rather than frozen at its last state.
    const live = link && this.session?.state !== "failed" ? link : undefined;
    const b = live?.lastBroadcast;
    const v: StudentMediaView = {
      state: live?.state ?? "none",
      cam: live?.cam ?? "off",
      send: live?.sending ?? null,
      broadcast: { on: b?.on ?? false, ...(b?.source ? { source: b.source } : {}) },
    };
    if (live?.remoteTrack) v.teacherTrack = live.remoteTrack;
    return v;
  }
```

In `spawn()`, the `new PeerSession({...})` gains `caps: [MEDIA_CAP],` and `...(this.env.mediaTimers ? { mediaTimers: this.env.mediaTimers } : {}),`. In the existing `s.on("state", ...)` handler add at the top: `if (st === "failed") this.emitMedia(s);`. Add after it:

```ts
    s.on("media", (link: MediaLink) => {
      link.on("request", (send) => {
        void link.applyRequest(send, this.env.media).then(() => this.emitMedia(s));
      });
      link.on("state", () => this.emitMedia(s));
      link.on("remoteTrack", () => this.emitMedia(s));
      link.on("broadcast", () => this.emitMedia(s));
      link.on("capture", () => this.emitMedia(s));
    });
```

Private:

```ts
  private emitMedia(s: PeerSession): void {
    if (this.session !== s) return;
    this.emit("media", this.mediaView());
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. (`bootStudent.ts` does not typecheck yet because `media` is now required in `StudentEnv`; that is fixed in Task 10. If `pnpm typecheck` reports only that one error, proceed.)

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/core/studentController.ts test/unit/core/studentController.test.ts
git add src/core/studentController.ts test/unit/core/studentController.test.ts
git commit -m "feat(core): StudentController applies media requests and exposes a media view

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: Platform port, boot wiring, dev hooks, hooks and `<VideoView>`

**Files:**
- Create: `src/ui/platform/browserMedia.ts`, `src/ui/shared/VideoView.tsx`
- Modify: `src/ui/platform/browserRtc.ts`, `src/boot/testHook.ts`, `src/boot/bootTeacher.ts`, `src/boot/bootStudent.ts`, `src/hooks/useLabRoster.ts`, `src/hooks/useStudent.ts`

**Interfaces:**
- Produces: `browserMedia: MediaPort`; `browserRtc.videoCodecs()`; `window.__lab` gains optional `mediaStats(ws: string): Promise<MediaStatsView | undefined>` (teacher) and `activeTracks(): number` (student); `registerTestHook(role, inject, extras?)`; `useLabRoster()` returns `{ tiles, queue, counts, settings, focused, broadcast, media: { on: number; cpuLimited: number } }`; `useStudent()` returns `{ session, state, lastCmd, lastError, media: StudentMediaView }`; `<VideoView track className? onPlaying? data-*>`.

No unit tests here (browser glue, covered by e2e in Task 13). `pnpm typecheck` must go green again in this task.

- [ ] **Step 1: `src/ui/platform/browserMedia.ts`**

```ts
import type { MediaPort } from "../../core/ports";

/** Camera and screen capture. contentHint steers the encoder: motion for faces, detail for text. */
export const browserMedia: MediaPort = {
  async camera(c) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: c.width },
        height: { ideal: c.height },
        frameRate: { ideal: c.frameRate },
      },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("camera returned no video track");
    track.contentHint = "motion";
    return track;
  },
  async screen() {
    // Must run inside a user gesture; LabController calls this before its first await.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getAudioTracks().forEach((t) => t.stop());
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("screen share returned no video track");
    track.contentHint = "detail";
    return track;
  },
};
```

- [ ] **Step 2: `src/ui/platform/browserRtc.ts`**

```ts
import type { RtcFactory } from "../../core/ports";
export const browserRtc: RtcFactory = {
  create: (config) => new RTCPeerConnection(config),
  videoCodecs: () => RTCRtpReceiver.getCapabilities("video")?.codecs ?? [],
};
```

- [ ] **Step 3: `src/boot/testHook.ts`**

```ts
import type { MediaStatsView } from "../core/mediaLink";

export interface LabHook {
  role: string;
  inject(wire: string): Promise<string | void>;
  /** Teacher: getStats() for one station's media link. */
  mediaStats?(ws: string): Promise<MediaStatsView | undefined>;
  /** Student: number of live capture tracks (0 or 1). */
  activeTracks?(): number;
}
declare global {
  interface Window {
    __lab?: LabHook;
  }
}
/**
 * E2E tests and manual cross-tab checks bypass cameras by calling window.__lab.inject(wire) with
 * what the QR would carry. The teacher's hook resolves with the encoded answer wire. Phase 2 adds
 * read-only media probes.
 *
 * Dev builds only: Playwright runs against `pnpm dev`, and a production bundle must not hand a
 * remote-injection entry point to anything that can reach the page. Callers guard too, so the
 * whole hook (and the `__lab` name) is dead code a production build drops.
 */
export function registerTestHook(
  role: string,
  inject: (wire: string) => Promise<string | void>,
  extras: Omit<LabHook, "role" | "inject"> = {},
): void {
  if (!import.meta.env.DEV) return;
  window.__lab = { role, inject, ...extras };
}
```

- [ ] **Step 4: `src/boot/bootTeacher.ts`**

Add imports `import { browserMedia } from "../ui/platform/browserMedia";` and `import { wsKey } from "../schemas/ws";`. In `new LabController({...})` add `media: browserMedia,`. Replace the `registerTestHook` call:

```ts
    registerTestHook(
      "teacher",
      async (wire) => {
        const p = await decodeWire(wire);
        if (p.role !== "offer") throw new Error("teacher expects an offer");
        return encodeWire(await lab.acceptOffer(p));
      },
      { mediaStats: (ws) => lab.sessions.get(wsKey(ws))?.media?.stats() ?? Promise.resolve(undefined) },
    );
```

- [ ] **Step 5: `src/boot/bootStudent.ts`**

Add import `import { browserMedia } from "../ui/platform/browserMedia";`. In the `new StudentController({...}, ws)` env add `media: browserMedia,`. Replace the `registerTestHook` call:

```ts
    registerTestHook(
      "student",
      async (wire) => {
        const p = await decodeWire(wire);
        await c.session?.applyRemote(p);
      },
      { activeTracks: () => (c.session?.media?.captureActive() ? 1 : 0) },
    );
```

- [ ] **Step 6: `src/hooks/useLabRoster.ts`**

```ts
import { useEffect, useState } from "react";
import type { LabController } from "../core/labController";

function read(lab: LabController) {
  const tiles = lab.snapshot();
  return {
    tiles,
    queue: lab.repairQueue(),
    counts: lab.counts(),
    settings: lab.settings,
    focused: lab.focused,
    broadcast: lab.broadcast.source,
    media: {
      on: tiles.filter((t) => t.media.cam === "on").length,
      cpuLimited: tiles.filter((t) => t.media.stats?.cpuLimited).length,
    },
  };
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

- [ ] **Step 7: `src/hooks/useStudent.ts`**

Add `import type { StudentController, StudentMediaView } from "../core/studentController";` (replace the existing StudentController import). Add state `const [media, setMedia] = useState<StudentMediaView>(() => c.mediaView());`. In the first effect, add `setMedia(c.mediaView());` next to `setSession(c.session);` and `c.on("media", setMedia),` to the `offs` array. Return `{ session, state, lastCmd, lastError, media }`.

- [ ] **Step 8: `src/ui/shared/VideoView.tsx`**

```tsx
import { useEffect, useRef, type VideoHTMLAttributes } from "react";

type Props = { track: MediaStreamTrack } & Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  "ref" | "muted" | "autoPlay" | "playsInline"
>;

/** A muted, inline, autoplaying <video> bound to one track. The only place a MediaStream is built. */
export function VideoView({ track, ...rest }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = new MediaStream([track]);
    return () => {
      v.srcObject = null;
    };
  }, [track]);
  return <video ref={ref} muted autoPlay playsInline {...rest} />;
}
```

- [ ] **Step 9: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write src/ui/platform/browserMedia.ts src/ui/platform/browserRtc.ts src/boot/testHook.ts src/boot/bootTeacher.ts src/boot/bootStudent.ts src/hooks/useLabRoster.ts src/hooks/useStudent.ts src/ui/shared/VideoView.tsx
git add src/ui/platform/browserMedia.ts src/ui/platform/browserRtc.ts src/boot/testHook.ts src/boot/bootTeacher.ts src/boot/bootStudent.ts src/hooks/useLabRoster.ts src/hooks/useStudent.ts src/ui/shared/VideoView.tsx
git commit -m "feat(platform): camera/screen port, codec capabilities, media hooks and VideoView

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Teacher UI — thumbnails, header controls, focus pane, drawer

**Files:**
- Modify: `src/ui/teacher/Tile.tsx`, `src/ui/teacher/TeacherApp.tsx`, `src/ui/teacher/TileDrawer.tsx`, `src/ui/shared/styles.css`, `src/ui/dev/LoadPage.tsx` (only to pass the new `Tile` prop)

**Interfaces:**
- Produces: `Tile` props `{ t: RosterView; onClick(): void; onFocus(): void }`; DOM hooks for e2e: `[data-action='cameras']` (with `aria-pressed`), `[data-action='share-camera']`, `[data-action='share-screen']`, `[data-action='share-stop']`, `[data-media-summary]`, per-tile `.thumb[data-media-state][data-cam]`, `[data-tile] video`, `<section data-focus>` with a `[data-action='unfocus']` button, drawer `[data-media-detail]`, `[data-action='focus']`, `[data-action='retry-video']`.

- [ ] **Step 1: `src/ui/teacher/Tile.tsx`**

```tsx
import type { RosterView, TileMedia } from "../../core/labController";
import { StatusPill } from "../shared/StatusPill";
import { VideoView } from "../shared/VideoView";

function ago(ts?: number) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)}m ago`
      : `${Math.round(s / 3600)}h ago`;
}

function placeholder(m: TileMedia): string {
  if (m.state === "unsupported") return "no video (older build)";
  if (m.state === "failed") return `video failed: ${m.reason ?? "unknown"}`;
  if (m.state === "negotiating") return "negotiating video…";
  if (m.cam === "error") return `camera error: ${m.reason ?? "unknown"}`;
  return "camera off";
}

export function Tile({
  t,
  onClick,
  onFocus,
}: {
  t: RosterView;
  onClick: () => void;
  onFocus: () => void;
}) {
  const m = t.media;
  const live = m.cam === "on" && m.track !== undefined;
  return (
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
      <div
        className="thumb"
        data-media-state={m.state}
        data-cam={m.cam}
        onClick={(e) => {
          // The thumbnail is the focus control; the rest of the tile opens the drawer.
          if (!live) return;
          e.stopPropagation();
          onFocus();
        }}
        title={live ? "Focus this station" : undefined}
      >
        {live && m.track ? (
          <VideoView track={m.track} />
        ) : (
          <span className="meta">{placeholder(m)}</span>
        )}
      </div>
      <div className="meta">{t.label ?? "—"}</div>
      <div className="meta">
        {t.rtt !== undefined && <span data-rtt>{t.rtt} ms · </span>}
        <span data-seen>seen {ago(t.lastSeenAt ?? t.lastConnectedAt)}</span>
      </div>
      <div className="meta">
        {t.battery !== undefined && (
          <span>
            {t.charging ? "⚡" : "🔋"} {Math.round(t.battery * 100)}%{" "}
          </span>
        )}
        {t.visibility === "hidden" && <span title="Screen hidden">🙈 </span>}
        {t.wakeLock === false && <span title="No wake lock">💤 </span>}
        {t.versionMismatch && <span title={`Student runs ${t.remoteAppVersion}`}>⚠️ version</span>}
        {m.stats?.cpuLimited && <span title="Teacher encoder is CPU-limited for this station">🔥 </span>}
      </div>
    </div>
  );
}
```

In `src/ui/dev/LoadPage.tsx`, change `<Tile key={t.key} t={t} onClick={() => {}} />` to `<Tile key={t.key} t={t} onClick={() => {}} onFocus={() => lab.focus(t.ws)} />`.

- [ ] **Step 2: `src/ui/teacher/TeacherApp.tsx`** — replace `Dashboard`

```tsx
function Dashboard({ lab }: { lab: LabController }) {
  const { tiles, queue, counts, settings, focused, broadcast, media } = useLabRoster(lab);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const openTile = open !== undefined ? tiles.find((t) => t.key === open) : undefined;
  const focusedTile = focused !== undefined ? tiles.find((t) => t.key === focused) : undefined;
  const mediaActive = media.on > 0 || broadcast !== null;

  useEffect(() => {
    if (focused === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") lab.focus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lab, focused]);

  const share = (source: "camera" | "screen") => {
    setNotice(undefined);
    lab.startBroadcast(source).catch((e: unknown) => {
      setNotice(`Sharing cancelled: ${(e as Error).message}`);
    });
  };

  return (
    <div className="layout">
      <div>
        <header className="bar">
          <strong>Learning Lab</strong>
          <span data-count="connected" style={{ color: "var(--green)" }}>
            ● {counts.connected}
          </span>
          <span data-count="degraded" style={{ color: "var(--amber)" }}>
            ● {counts.degraded}
          </span>
          <span data-count="failed" style={{ color: "var(--red)" }}>
            ● {counts.failed + counts.never}
          </span>
          <button onClick={() => setScanning(true)} data-action="scan">
            Scan
          </button>
          <button
            className={settings.media.cameras ? "" : "secondary"}
            data-action="cameras"
            aria-pressed={settings.media.cameras}
            onClick={() => lab.setCameras(!settings.media.cameras)}
          >
            Cameras {settings.media.cameras ? "on" : "off"}
          </button>
          {broadcast === null ? (
            <>
              <button className="secondary" data-action="share-camera" onClick={() => share("camera")}>
                Share camera
              </button>
              <button className="secondary" data-action="share-screen" onClick={() => share("screen")}>
                Share screen
              </button>
            </>
          ) : (
            <button data-action="share-stop" onClick={() => lab.stopBroadcast()}>
              Stop sharing {broadcast}
            </button>
          )}
          {mediaActive && (
            <span className="meta" data-media-summary>
              📷 {media.on} on{media.cpuLimited > 0 ? ` · ⚠ ${media.cpuLimited} CPU-limited` : ""}
            </span>
          )}
          {notice && (
            <span className="meta" data-notice style={{ color: "var(--amber)" }}>
              {notice}
            </span>
          )}
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
        </header>
        {focusedTile && focusedTile.media.track && (
          <section className="focus" data-focus={focusedTile.key}>
            <VideoView track={focusedTile.media.track} />
            <div className="focus-bar">
              <span className="num">{focusedTile.ws}</span>
              {focusedTile.media.stats && (
                <span className="meta" data-focus-stats>
                  {focusedTile.media.stats.inHeight ?? "?"}p · {focusedTile.media.stats.inFps ?? "?"} fps
                </span>
              )}
              <button className="secondary" data-action="unfocus" onClick={() => lab.focus(null)}>
                Close
              </button>
            </div>
          </section>
        )}
        <main className="grid">
          {tiles.length === 0 && (
            <p className="meta" data-empty style={{ gridColumn: "1 / -1", textAlign: "center" }}>
              No workstations yet — tap Scan and point the camera at a student's code.
            </p>
          )}
          {tiles.map((t) => (
            <Tile
              key={t.key}
              t={t}
              onClick={() => setOpen(t.key)}
              onFocus={() => lab.focus(focused === t.key ? null : t.ws)}
            />
          ))}
        </main>
      </div>
      <RepairQueue queue={queue} />
      {scanning && <ScanModal lab={lab} onClose={() => setScanning(false)} />}
      {openTile && (
        <TileDrawer lab={lab} t={openTile} focused={focused === openTile.key} onClose={() => setOpen(undefined)} />
      )}
    </div>
  );
}
```

Update imports at the top of the file: `import { useEffect, useState } from "react";` and `import { VideoView } from "../shared/VideoView";`.

- [ ] **Step 3: `src/ui/teacher/TileDrawer.tsx`**

Add prop `focused: boolean` to the component signature. Insert after the fingerprint paragraph:

```tsx
        <div className="meta" data-media-detail>
          <p>
            Video: {t.media.state}
            {t.media.reason ? ` — ${t.media.reason}` : ""} · camera {t.media.cam}
            {t.media.send ? ` (${t.media.send.height}p @ ${t.media.send.fps})` : ""}
          </p>
          {t.media.stats && (
            <p>
              in {t.media.stats.inHeight ?? "?"}p @ {t.media.stats.inFps ?? "?"} fps
              {t.media.stats.framesDropped !== undefined ? ` · dropped ${t.media.stats.framesDropped}` : ""}
              {" · "}out {t.media.stats.outHeight ?? "?"}p @ {t.media.stats.outFps ?? "?"} fps
              {t.media.stats.encoder ? ` · ${t.media.stats.encoder}` : ""}
              {t.media.stats.cpuLimited ? " · ⚠ CPU-limited" : ""}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {t.media.state === "ready" && (
              <button
                data-action="focus"
                onClick={() => {
                  lab.focus(focused ? null : t.ws);
                  onClose();
                }}
              >
                {focused ? "Unfocus" : "Focus"}
              </button>
            )}
            {t.media.state === "failed" && (
              <button className="secondary" data-action="retry-video" onClick={() => lab.retryMedia(t.ws)}>
                Retry video
              </button>
            )}
          </div>
        </div>
```

- [ ] **Step 4: `src/ui/shared/styles.css`** — change the grid minimum and append

Change `.grid` to `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));`. Append:

```css
.thumb {
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}
.thumb .meta {
  text-align: center;
  padding: 4px;
}
.focus {
  margin: 12px 12px 0;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.focus video {
  width: 100%;
  max-height: 50vh;
  object-fit: contain;
  background: #000;
}
.focus-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: #1c1c1c;
}
.focus-bar .num {
  font-size: 1.25rem;
  font-weight: 800;
}
.focus-bar button {
  margin-left: auto;
}
.pill-cam {
  background: var(--red);
  color: #fff;
}
.pill-camerr {
  background: var(--amber);
}
.teacher-video {
  position: fixed;
  top: 72px;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: calc(100% - 72px);
  object-fit: contain;
  background: #000;
}
.caption {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: var(--muted);
  font-size: 1.5rem;
  pointer-events: none;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Then `pnpm dev`, open `/teacher`: the header shows **Cameras off**, **Share camera**, **Share screen**; tiles have a black 16:9 strip reading "camera off".

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src/ui/teacher/Tile.tsx src/ui/teacher/TeacherApp.tsx src/ui/teacher/TileDrawer.tsx src/ui/shared/styles.css src/ui/dev/LoadPage.tsx
git add src/ui/teacher/Tile.tsx src/ui/teacher/TeacherApp.tsx src/ui/teacher/TileDrawer.tsx src/ui/shared/styles.css src/ui/dev/LoadPage.tsx
git commit -m "feat(teacher): thumbnails, cameras/share controls, focus pane, drawer media block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Student UI — teacher video and camera pill

**Files:**
- Modify: `src/ui/student/StudentApp.tsx`

**Interfaces:**
- Produces: `#student[data-cam="off"|"on"|"error"]`; `video[data-teacher]` present only while `media.broadcast.on` and a track exists; `.caption` until the first frame plays; status-bar pill `[data-cam-pill]`.

- [ ] **Step 1: Modify `StudentView`**

Add import `import { VideoView } from "../shared/VideoView";`. Destructure `media` from `useStudent(c)`: `const { session, lastCmd, lastError, media } = useStudent(c);`. Add state `const [playing, setPlaying] = useState(false);` and reset it when the broadcast turns off:

```tsx
  useEffect(() => {
    if (!media.broadcast.on) setPlaying(false);
  }, [media.broadcast.on]);
```

Change the root element to `<div id="student" data-state={view.state} data-cam={media.cam}>`.

In the header, after `<StatusPill state={view.state} />`:

```tsx
        {media.cam === "on" && (
          <span className="pill pill-cam" data-cam-pill="on">
            ● Camera on
          </span>
        )}
        {media.cam === "error" && (
          <span className="pill pill-camerr" data-cam-pill="error" title={media.send === null ? "camera error" : undefined}>
            Camera unavailable
          </span>
        )}
```

Replace the connected/degraded branch:

```tsx
          {(view.state === "connected" || view.state === "degraded") &&
            (media.broadcast.on && media.teacherTrack ? (
              <>
                <VideoView
                  track={media.teacherTrack}
                  className="teacher-video"
                  data-teacher={media.broadcast.source ?? "video"}
                  onPlaying={() => setPlaying(true)}
                />
                {!playing && (
                  <p className="caption">
                    Teacher's {media.broadcast.source === "screen" ? "screen" : "camera"}
                  </p>
                )}
              </>
            ) : (
              <h2 style={{ color: "var(--muted)" }}>Ready</h2>
            ))}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Manual: `pnpm dev`, two tabs (`/teacher`, `/student?ws=1`), pair with `window.__lab.inject` as in the Phase 1 README workflow; toggle **Cameras on** → student header shows the red "● Camera on" pill and the teacher tile shows video; **Share camera** → student shows the teacher's video full-screen.

- [ ] **Step 3: Commit**

```bash
pnpm exec prettier --write src/ui/student/StudentApp.tsx
git add src/ui/student/StudentApp.tsx
git commit -m "feat(student): show the teacher's video and a camera-on pill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 13: E2E — media flow (Chromium) and renegotiation guard (Chromium + WebKit)

**Files:**
- Create: `test/e2e/media.spec.ts`, `test/e2e/media-renegotiation.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: `test/e2e/media.spec.ts`**

```ts
import { expect, test, type Page } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair, tile } from "./helpers";

interface Stats {
  cpuLimited: boolean;
  inHeight?: number;
  framesDecoded?: number;
}

const stats = (page: Page, ws: string) =>
  page.evaluate((w) => window.__lab!.mediaStats!(w), ws) as Promise<Stats | undefined>;

test("cameras, focus and broadcast flow both ways over loopback", async ({ browser }) => {
  test.setTimeout(120_000);
  const t = await openTeacher(browser);
  const s = await openStudent(browser, "Row 7");
  await pair(t.page, s.page, "Row 7");
  await expectState(t.page, tile("Row 7"), "connected");

  // One negotiation, right after hello.
  const thumb = t.page.locator(`${tile("Row 7")} .thumb`);
  await expect(thumb).toHaveAttribute("data-media-state", "ready", { timeout: 15_000 });
  await expect(thumb).toHaveAttribute("data-cam", "off");
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "off");

  // Cameras on → the student captures and the teacher decodes a ≤180p thumbnail.
  await t.page.locator("[data-action='cameras']").click();
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "on", { timeout: 15_000 });
  await expect(thumb).toHaveAttribute("data-cam", "on", { timeout: 15_000 });
  await expect(t.page.locator(`${tile("Row 7")} video`)).toBeVisible();
  await expect
    .poll(async () => (await stats(t.page, "Row 7"))?.framesDecoded ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await stats(t.page, "Row 7"))?.inHeight ?? 9999, { timeout: 30_000 })
    .toBeLessThanOrEqual(180);
  await expect(t.page.locator("[data-media-summary]")).toContainText("1 on");

  // Focus → the same track, re-parameterised to ≥360p (Chrome ramps over a few seconds).
  await t.page.locator(`${tile("Row 7")} video`).click();
  await expect(t.page.locator("[data-focus='row 7']")).toBeVisible();
  await expect
    .poll(async () => (await stats(t.page, "Row 7"))?.inHeight ?? 0, { timeout: 45_000 })
    .toBeGreaterThanOrEqual(360);

  // Share camera → the student renders the teacher's video.
  await t.page.locator("[data-action='share-camera']").click();
  const teacherVideo = s.page.locator("video[data-teacher]");
  await expect(teacherVideo).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => teacherVideo.evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(s.page.locator(".caption")).toHaveCount(0, { timeout: 15_000 });

  // Stop → placeholder is back; Escape clears focus; Cameras off → capture released.
  await t.page.locator("[data-action='share-stop']").click();
  await expect(teacherVideo).toHaveCount(0, { timeout: 10_000 });
  await expect(s.page.locator("#student h2")).toHaveText("Ready");
  await t.page.keyboard.press("Escape");
  await expect(t.page.locator("[data-focus]")).toHaveCount(0);
  await t.page.locator("[data-action='cameras']").click();
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "off", { timeout: 15_000 });
  await expect.poll(() => s.page.evaluate(() => window.__lab!.activeTracks!())).toBe(0);
  await expect(thumb).toHaveAttribute("data-cam", "off", { timeout: 15_000 });

  await s.ctx.close();
  await t.ctx.close();
});

test("a student that loses its session stops its camera and re-pairs with media none", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, "Row 8", "timers=300,1200,2500");
  await pair(t.page, s.page, "Row 8");
  const thumb = t.page.locator(`${tile("Row 8")} .thumb`);
  await expect(thumb).toHaveAttribute("data-media-state", "ready", { timeout: 15_000 });
  await t.page.locator("[data-action='cameras']").click();
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "on", { timeout: 15_000 });
  await t.ctx.close();
  await expectState(s.page, "#student", "awaiting-remote", 45_000);
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "off");
  await expect.poll(() => s.page.evaluate(() => window.__lab!.activeTracks!())).toBe(0);
  await s.ctx.close();
});
```

- [ ] **Step 2: `test/e2e/media-renegotiation.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

/**
 * Spec §4.4 guard: the Phase 1 remote description is rebuilt from the compact QR payload; the
 * media offer must be accepted by the engine as a continuation of it. Runs in Chromium and WebKit.
 */
test("media transceivers negotiate on top of a codec-built DataChannel session", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const codec = window.__labCodec!;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: true });
      st.getTracks().forEach((t) => t.stop());
    } catch {
      /* Chromium's fake device path does not need it */
    }
    const gather = (pc: RTCPeerConnection) =>
      new Promise<void>((res) => {
        if (pc.iceGatheringState === "complete") return res();
        const t = setTimeout(res, 3000);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(t);
            res();
          }
        };
      });
    const roundtrip = async (sdp: string, role: "offer" | "answer") =>
      codec.buildSdp(await codec.decodeWire(await codec.encodeWire(codec.extractPayload(sdp, role, "7"))));

    // Phase 1: student (a) offers a DataChannel through the compact codec; teacher (b) answers.
    const a = new RTCPeerConnection({ iceServers: [] });
    a.createDataChannel("lab");
    await a.setLocalDescription(await a.createOffer());
    await gather(a);
    const b = new RTCPeerConnection({ iceServers: [] });
    await b.setRemoteDescription({ type: "offer", sdp: await roundtrip(a.localDescription!.sdp, "offer") });
    await b.setLocalDescription(await b.createAnswer());
    await gather(b);
    await a.setRemoteDescription({ type: "answer", sdp: await roundtrip(b.localDescription!.sdp, "answer") });

    // Phase 2: the teacher offers two video transceivers with a full SDP.
    b.addTransceiver("video", { direction: "sendonly" });
    b.addTransceiver("video", { direction: "recvonly" });
    await b.setLocalDescription(await b.createOffer());
    await a.setRemoteDescription({ type: "offer", sdp: b.localDescription!.sdp });
    const aVideo = a.getTransceivers().filter((t) => t.receiver.track.kind === "video");
    aVideo[1]!.direction = "sendonly"; // offered recvonly → we send
    await a.setLocalDescription(await a.createAnswer());
    await b.setRemoteDescription({ type: "answer", sdp: a.localDescription!.sdp });

    const dirs = (pc: RTCPeerConnection) => pc.getTransceivers().map((t) => t.currentDirection);
    const out = {
      aCount: a.getTransceivers().length,
      bCount: b.getTransceivers().length,
      aState: a.signalingState,
      bState: b.signalingState,
      aDirs: dirs(a),
      bDirs: dirs(b),
      bundle: /^a=group:BUNDLE \S+ \S+ \S+/m.test(b.localDescription!.sdp),
    };
    a.close();
    b.close();
    return out;
  });
  expect(r.aCount).toBe(2);
  expect(r.bCount).toBe(2);
  expect(r.aState).toBe("stable");
  expect(r.bState).toBe("stable");
  expect(r.bDirs).toEqual(["sendonly", "recvonly"]);
  expect(r.aDirs).toEqual(["recvonly", "sendonly"]);
  expect(r.bundle).toBe(true);
});
```

- [ ] **Step 3: `playwright.config.ts`** — run the guard in WebKit too

Change the webkit project's `testMatch` to `/codec\.spec\.ts|media-renegotiation\.spec\.ts/`.

- [ ] **Step 4: Run**

Run: `pnpm test:e2e`
Expected: PASS in both projects. Known-flaky spots and what they mean:
- `inHeight ≥ 360` never reached: Chrome's bandwidth estimator did not ramp on loopback within 45 s. Check `[data-focus-stats]` shows fps > 0 first; if fps is 0, `setParameters` was not applied (look for `outbound: …` in the tile's `reason`).
- WebKit rejects the media offer in `media-renegotiation.spec.ts`: this is the §4.4 risk. The fix goes in `SdpCodec.buildSdp`'s template (add the attribute WebKit's error names), never in the media offer.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write test/e2e/media.spec.ts test/e2e/media-renegotiation.spec.ts playwright.config.ts
git add test/e2e/media.spec.ts test/e2e/media-renegotiation.spec.ts playwright.config.ts
git commit -m "test(e2e): media flow over loopback; renegotiation guard in Chromium and WebKit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `/dev/load` media controls, stats table, and the load e2e

**Files:**
- Modify: `src/ui/dev/LoadPage.tsx`, `test/e2e/load.spec.ts`

**Interfaces:**
- Produces: on `/dev/load`, `[data-action='cameras']`, `[data-action='share-camera']`, `[data-action='share-screen']`, `[data-action='share-stop']`, `[data-media-summary]`, and a `<table data-stats>` with one `tr[data-stats-row=<key>]` per station showing media state, cam, encoder, CPU-limited, out fps/height, in fps/height, framesDecoded.

- [ ] **Step 1: Modify `Load` in `src/ui/dev/LoadPage.tsx`**

Destructure `settings, broadcast, media` from `useLabRoster(lab)` alongside `tiles, counts`. Add to the header after the counts:

```tsx
        <button
          className={settings.media.cameras ? "" : "secondary"}
          data-action="cameras"
          aria-pressed={settings.media.cameras}
          onClick={() => lab.setCameras(!settings.media.cameras)}
        >
          Cameras {settings.media.cameras ? "on" : "off"}
        </button>
        {broadcast === null ? (
          <>
            <button className="secondary" data-action="share-camera" onClick={() => void lab.startBroadcast("camera").catch(console.warn)}>
              Share camera
            </button>
            <button className="secondary" data-action="share-screen" onClick={() => void lab.startBroadcast("screen").catch(console.warn)}>
              Share screen
            </button>
          </>
        ) : (
          <button data-action="share-stop" onClick={() => lab.stopBroadcast()}>
            Stop sharing {broadcast}
          </button>
        )}
        <span className="meta" data-media-summary>
          📷 {media.on} on · ⚠ {media.cpuLimited} CPU-limited
        </span>
```

Add between `</main>` and the iframe grid:

```tsx
      <table data-stats className="meta" style={{ margin: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>ws</th><th>media</th><th>cam</th><th>encoder</th><th>cpu</th><th>out</th><th>in</th><th>decoded</th>
          </tr>
        </thead>
        <tbody>
          {tiles.slice(0, count).map((t) => (
            <tr key={t.key} data-stats-row={t.key}>
              <td>{t.ws}</td>
              <td>{t.media.state}</td>
              <td>{t.media.cam}</td>
              <td>{t.media.stats?.encoder ?? "—"}</td>
              <td>{t.media.stats?.cpuLimited ? "⚠" : ""}</td>
              <td>{t.media.stats?.outHeight ?? "—"}p @ {t.media.stats?.outFps ?? "—"}</td>
              <td>{t.media.stats?.inHeight ?? "—"}p @ {t.media.stats?.inFps ?? "—"}</td>
              <td>{t.media.stats?.framesDecoded ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
```

- [ ] **Step 2: Extend `test/e2e/load.spec.ts`**

```ts
test("dev/load streams 5 thumbnails and a camera broadcast", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/dev/load");
  const count = page.locator("[data-load-count]");
  await count.fill("5");
  await count.dispatchEvent("change");
  await expect(page.locator("[data-tile][data-state='connected']")).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator(".thumb[data-media-state='ready']")).toHaveCount(5, { timeout: 30_000 });
  await page.locator("[data-action='cameras']").click();
  await expect(page.locator(".thumb[data-cam='on']")).toHaveCount(5, { timeout: 30_000 });
  await page.locator("[data-action='share-camera']").click();
  await expect(page.locator("[data-action='share-stop']")).toBeVisible();
  // Every station decodes the teacher and the teacher decodes every station.
  for (const ws of ["1", "2", "3", "4", "5"]) {
    await expect
      .poll(async () => Number(await page.locator(`[data-stats-row='${ws}'] td:nth-child(8)`).textContent()), {
        timeout: 45_000,
      })
      .toBeGreaterThan(0);
    const frame = page.frameLocator(`iframe[title='student ${ws}']`);
    await expect(frame.locator("video[data-teacher]")).toBeVisible({ timeout: 30_000 });
  }
});
```

- [ ] **Step 3: Run**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e --project=chromium load.spec.ts`
Expected: PASS. Note the iframes share the parent's fake camera; five same-origin students each call `getUserMedia` and each gets a track.

- [ ] **Step 4: Manual load measurement on the Mac (record in the spec §14)**

`pnpm dev`, open `/dev/load` in Chrome, 30 students, **Cameras on**, **Share screen** (pick any window). Wait 5 minutes. Record from the stats table and Activity Monitor: `encoder` column (expect `VideoToolbox` or `libvpx`/`OpenH264`), number of `⚠` rows, Chrome renderer CPU %, whether fans spun up. Paste the result into the spec's §14 table row "`/dev/load` measurement results". If any row shows `⚠` for the whole run, lower `broadcastScreen`/`broadcastCamera` in settings (the drawer has no editor yet: edit `lab.teacher.v2` in DevTools → Application → Local Storage) and re-run; record what held.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/ui/dev/LoadPage.tsx test/e2e/load.spec.ts
git add src/ui/dev/LoadPage.tsx test/e2e/load.spec.ts
git commit -m "feat(dev): load page media controls and per-station stats; load e2e streams both ways

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Docs and full verification

**Files:**
- Modify: `AGENTS.md`, `README.md`, `docs/lab-checklist.md`, `docs/superpowers/specs/2026-09-21-phase2-media-design.md`

- [ ] **Step 1: `AGENTS.md`**

- First paragraph: after the variable-IDs link add `, and extended by [docs/superpowers/specs/2026-09-21-phase2-media-design.md](docs/superpowers/specs/2026-09-21-phase2-media-design.md) (Phase 2 media).`
- Under **Non-negotiable facts** append:
  - `- **Media: video only, teacher is the sole offerer, negotiate once.** No audio. The teacher sends one \`media.offer\` per session (two video transceivers); after that only \`replaceTrack\` and \`setParameters\`. Quality never renegotiates. Media failures never fail the session.`
  - `- **Capture only while asked.** A student's camera is on only while a ready link has a non-null \`media.request\`; any failure stops it. Cameras default off.`
- Under **Architecture rules** rule 7 becomes: `7. **Reserved namespaces stay reserved.** \`media.*\` is live (Phase 2, \`src/schemas/media.ts\`). \`collab.*\`, \`rec.*\`, \`log.*\` are typed as empty unions until their phase. Don't squat on them.`
- Under **Architecture rules** add: `8. **Core hands out \`MediaStreamTrack\`s, never builds a \`MediaStream\`.** \`<VideoView>\` is the only place \`new MediaStream()\` appears. Capture goes through \`MediaPort\`.`
- Under **Testing expectations** append: `- Media e2e (\`media.spec.ts\`) reads \`window.__lab.mediaStats(ws)\` / \`window.__lab.activeTracks()\` (dev-only). \`media-renegotiation.spec.ts\` runs in **both** engines and guards the SDP template against the media offer; a WebKit failure there is fixed in \`buildSdp\`, not in \`MediaLink\`.`
- **Roadmap**: `Phase 2 (media spec): student thumbnails + focus, teacher camera/screen broadcast, \`media.*\` over the DataChannel.` Keep Phase 3 as `collab (student screen share, whiteboard, chat)`.

- [ ] **Step 2: `README.md`**

After the design amendment bullet add: `- Phase 2 design (bidirectional media): \`docs/superpowers/specs/2026-09-21-phase2-media-design.md\``. Under **Routes** add a line: `Teacher header: **Cameras** (thumbnails from every iPad), **Share camera / Share screen** (to every iPad). Click a thumbnail to focus one station.`

- [ ] **Step 3: `docs/lab-checklist.md`**

Under §0 add: `- [ ] Teacher Mac on **Ethernet** if the room has a port (30 video streams in and out cross one access point otherwise). Note the AP model.` Add a new section before §4 Soak:

```
## 3b. Media
- [ ] Teacher: **Cameras on** → every green tile shows video within 10 s. Any tile reading "no video (older build)" is a stale Home Screen app: reload that iPad.
- [ ] Click one thumbnail → focus pane shows a readable face; `[data-focus-stats]` reads ≥ 360p.
- [ ] **Share screen** → every iPad shows it; text on a terminal window is legible. **Stop sharing** → every iPad back to Ready.
- [ ] **Share camera** → every iPad shows the teacher. Header shows "⚠ N CPU-limited" only transiently; if it stays > 0, note N and the Mac's Activity Monitor CPU.
- [ ] Cameras off → every iPad's "● Camera on" pill disappears.
```

Under §4 Soak add: `- [ ] Cameras on for two hours. Note any tile that goes to "camera error" (thermal) and whether the Mac's fans came on.`

- [ ] **Step 4: Spec touch-ups** (keep the spec honest about what shipped)

In `docs/superpowers/specs/2026-09-21-phase2-media-design.md`:
- §4.6 and §7.3/§7.4/§9: where it says the link/tile/view carries a `MediaStream`, change to `MediaStreamTrack` and add one sentence to §7: "Core hands out tracks; `<VideoView>` in `src/ui/shared/` is the only place a `MediaStream` is constructed, so core never touches that global."
- §7.2 first paragraph: replace "Constructed by `PeerSession` when the session reaches `connected` **and** both `hello`s have been exchanged" with "Constructed by `PeerSession` at DataChannel open, before its own `hello` goes out; the capability gate is applied by `LabController` when the student's `hello` arrives."
- §4.5: add "`applyRequest` before `ready` is a no-op." to the bullet list.
- **Status** line: `approved design, implemented`.

- [ ] **Step 5: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`
Expected: all PASS; `grep -c '__lab\b\|mediaStats\|activeTracks\|dev/load' dist/assets/*.js` → 0 (dev-only surfaces stay out of the production bundle).

- [ ] **Step 6: Commit and open the PR**

```bash
pnpm exec prettier --write AGENTS.md README.md docs/lab-checklist.md docs/superpowers/specs/2026-09-21-phase2-media-design.md
git add AGENTS.md README.md docs/lab-checklist.md docs/superpowers/specs/2026-09-21-phase2-media-design.md
git commit -m "docs: Phase 2 media rules, checklist items, spec reconciled with the implementation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/phase2-media
gh pr create --title "feat: Phase 2 bidirectional media" --body "$(cat <<'BODY'
## What
Student → teacher thumbnails with per-station focus; teacher camera/screen broadcast to every iPad. One teacher-driven renegotiation per session over the DataChannel; quality via setParameters. Spec: docs/superpowers/specs/2026-09-21-phase2-media-design.md.

## Verification
pnpm lint, typecheck, test (unit), build, test:e2e (Chromium + WebKit renegotiation guard). /dev/load run on the Mac recorded in spec §14.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-review notes

- **Spec coverage:** §1 load budget → Task 14 step 4 (measurement) and §14 record; §3.1 no audio → `audio: false` in Task 10, no audio transceivers anywhere; §3.2 sole offerer + `seq` → Tasks 5, 7; §3.3 negotiate once → Task 5 (`offer` refused unless none/failed); §3.4 caps → Tasks 1, 7, 8, 9; §3.5 fixed capture + fallback → Tasks 3, 6; §3.6 best-effort → nothing in `MediaLink` reaches `PeerSession.fail`; §4.4 → Task 13 guard; §4.5 states → Task 5; §5 profiles → Tasks 2, 8; §6 protocol → Task 1; §7 architecture → Tasks 3–10; §8 persistence → Task 2; §9 UI → Tasks 11, 12; §10 tests → every task; §11 load page + checklist → Tasks 14, 15; §12 risks → Task 13 notes, Task 15 checklist.
- **Deviations from the spec, reconciled in Task 15:** tracks instead of streams cross the core boundary; the link is created at DC open rather than after both hellos.
- **Type consistency:** `TileMedia`/`RosterView.media` (Task 8) is what Tasks 11, 14 read; `StudentMediaView` (Task 9) is what Task 12 reads; `MediaStatsView` (Task 5) is what `testHook.ts` (Task 10) and the load table (Task 14) use; `Tile` gains `onFocus` in Task 11 and `LoadPage` is updated in the same task.
