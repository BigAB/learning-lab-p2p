# Learning Lab P2P — Phase 2 Bidirectional Media

**Status:** proposed design, pre-implementation
**Date:** 2026-09-21
**Builds on:** [2026-09-20-p2p-core-design.md](2026-09-20-p2p-core-design.md) as amended by [2026-09-21-variable-workstation-ids-design.md](2026-09-21-variable-workstation-ids-design.md). Nothing in those documents is changed except where this one says so. Roster is dynamic; every layout and every budget below is a function of `tiles.length`, never a constant.
**Scope:** live video in both directions over the Phase 1 peer connections. Student → teacher: one low-rate thumbnail per station in the dashboard grid, with a per-station "focus" that raises one station's quality. Teacher → students: one outbound video track (the teacher's camera **or** screen) fanned out to every connected station. Renegotiation carries full SDP over the DataChannel. No audio (§3.1).

---

## 1. The load question first: 30 decodes + 30 encodes on one MacBook

Everything else in this document is shaped by one fact about the browser:

> **A `MediaStreamTrack` attached to N `RTCPeerConnection`s is encoded N times.** libwebrtc has no cross-connection encoder sharing. Simulcast and SVC share an encoder only *within* one connection. So the teacher's one camera becomes 30 independent encoders on the Mac, each with its own scaler, rate controller and RTP packetizer.

Decoding is the cheap direction. Encoding is the constraint, and the design has to cap it.

### 1.1 Cost model

Cost is proportional to **pixel rate** (width × height × fps) summed over every encoder and decoder the tab runs. Order-of-magnitude per-frame costs for software VP8 (libvpx realtime speed, one thread) on an Apple M-series performance core, and the figures the Phase 2 defaults are built on:

| Frame | Encode | Decode |
|---|---|---|
| 320×180 | ~0.4 ms | ~0.15 ms |
| 640×360 | ~2.5 ms | ~0.7 ms |
| 1280×720 | ~7 ms | ~2 ms |

These are planning numbers, not promises; §1.4 says how the real ones are measured. H.264 via VideoToolbox takes most of the encode cost off the CPU **if** the Mac grants a hardware session to each of 30 encoders, which Apple does not document and Chrome falls back from silently. Treat hardware as a bonus, plan on software.

### 1.2 Budget for one teacher tab, N = 30

| Work | Rate | CPU (software) |
|---|---|---|
| Decode 30 thumbnails, 320×180 @ 10 fps | 300 frames/s | ≈ 0.05 core |
| Decode 1 focused station, 1280×720 @ 15 fps | 15 frames/s | ≈ 0.03 core |
| Encode teacher **camera** to 30 peers, 640×360 @ 15 fps | 450 frames/s | ≈ 1.1 cores |
| Encode teacher **screen** to 30 peers, 1280×720 @ 5 fps, moving content | 150 frames/s | ≈ 1.0 core; static content ≪ |
| Per-connection overhead ×30 (SRTP, RTCP, pacing, `getStats`) | — | ≈ 0.2 core |
| Compositing 30 `<video>` elements | — | GPU; not a CPU concern at thumbnail size |

Sustained total ≈ **2–2.5 cores** with everything on at once. That is acceptable on a MacBook Pro without fan noise becoming the classroom's problem. For contrast, what the design refuses:

| Not allowed | Why |
|---|---|
| Teacher camera 1280×720 @ 30 fps to 30 peers | 900 frames/s × 7 ms ≈ 6.3 cores. Thermal throttling, dropped frames everywhere. |
| Student thumbnails at 640×360 @ 15 | Decode is still cheap (≈ 0.3 core) but the **iPads'** encoders and the AP's airtime pay 7× more for a tile that is 200 px wide. |

### 1.3 Decisions that follow

1. **Thumbnails are tiny and slow.** 320×180 @ 10 fps, 150 kbps. A tile is ~200 px wide; more pixels are invisible.
2. **The teacher's outbound track has a per-source ceiling, and the ceiling is the *fan-out* profile.** Camera: 640×360 @ 15 fps, 600 kbps. Screen: 1280×720 @ 5 fps, 1000 kbps, `contentHint = "detail"` (screen share needs resolution, not motion; text at 360p is unreadable). Both are settings (§8) so a lab with 12 stations can raise them.
3. **Quality is changed with `RTCRtpSender.setParameters`, never with renegotiation.** `scaleResolutionDownBy`, `maxFramerate`, `maxBitrate` apply per sender without an SDP exchange. Renegotiation happens once per session (§4) and carries no quality information.
4. **Chrome's own overuse adaptation is the safety net, not the plan.** Every encoder runs with `degradationPreference` (`"balanced"` for camera, `"maintain-resolution"` for screen). If the Mac is still overloaded, Chrome scales the offending encoders down itself and reports `qualityLimitationReason: "cpu"` in stats. The dashboard shows that count (§9.2) so overload is visible rather than mysterious.
5. **H.264 first.** The teacher sets codec preferences to H.264 (constrained baseline, packetization-mode 1) on both transceivers. iPads decode and encode H.264 in hardware; the Mac gets VideoToolbox if it can. VP8 stays negotiable as the fallback. Codec is a setting (§8) because §1.4 may prove the default wrong.
6. **Cameras are off by default.** The grid streams only while the teacher has "Cameras" on. Privacy, iPad thermals, and AP airtime all point the same way.
7. **Network is part of the budget.** Cameras on + camera broadcast ≈ 4.5 Mbps into the Mac and 18 Mbps out of it; screen broadcast ≈ 30 Mbps out (bursty). All of it crosses one access point that also serves 30 iPads. The lab checklist (§11) asks for the Mac on Ethernet.

### 1.4 Measurement, not belief

The planning numbers are validated on the Mac with `/dev/load` (§11.1) before the defaults are final. The page reports, per outbound stream, `encoderImplementation` (`"VideoToolbox"` vs `"libvpx"` / `"OpenH264"`), `qualityLimitationReason`, delivered `framesPerSecond` and `frameHeight`, and per inbound stream `framesDecoded` and `framesDropped`. A load run on one machine encodes the 30 *student* thumbnails on the Mac too, so it measures an upper bound: if the single-machine run stays under budget, the lab does.

### 1.5 If it is still too hot: the escape hatch (designed for, not built)

If measurement shows 30 encoders cannot fit, the fix is **encode once, fan out bytes**: `VideoEncoder` (WebCodecs) encodes the teacher's track once, the same encoded chunks are written to 30 DataChannels, and each iPad decodes with `VideoDecoder` onto a canvas. WebCodecs is in Safari 16.4+. It removes 29 encoders at the cost of building a jitter buffer, keyframe recovery and back-pressure ourselves, and it bypasses RTP entirely for that direction. Phase 2 keeps the door open by routing all teacher → student *control* over the DataChannel (`media.broadcast`, §6) rather than inferring state from RTP, so a later transport swap does not touch the UI. It is not in scope now.

---

## 2. What Phase 2 delivers

| Direction | What | Controlled by |
|---|---|---|
| Student → teacher | One video track per station, thumbnail profile by default, focus profile for one station at a time | Teacher: **Cameras** toggle (all), **Focus** (one) |
| Teacher → students | One video track, source = teacher camera **or** teacher screen, same frames to every connected station | Teacher: **Share camera / Share screen / Stop** |
| Both | State the UI can trust (`media.status`, `media.broadcast`), quality requests, negotiation | DataChannel `media.*` messages |

Not delivered: audio, student ↔ student, recording, student screen share, per-student mute of the broadcast, simulcast, any change to pairing, the courier or the QR codec.

---

## 3. Decisions and why

### 3.1 Video only, no audio
The lab is one room. The teacher's voice reaches every seat by air; 30 iPad speakers replaying it 200 ms late is feedback, and 30 open iPad microphones into one Mac is noise. Dropping audio also removes the autoplay-policy problem: a muted, playsinline `<video>` plays without a gesture on both platforms. Audio transceivers are **not** pre-negotiated; a later phase that wants them renegotiates (the mechanism in §4 is reusable).

### 3.2 The teacher is the only offerer for media, and offers sequentially
Phase 1 made the student the offerer because the student had to show a QR without teacher action. That reason does not apply once the DataChannel is up. Making the teacher the sole media offerer removes glare entirely: the student never calls `createOffer` after pairing. Re-offers (retry after failure, §4.5) are allowed but serialised by a `seq`; the student answers any offer that arrives while its signaling state is `stable`.

### 3.3 Negotiate once, at connect; everything after is `replaceTrack` + `setParameters`
The teacher's single media offer adds **two video transceivers**: one `sendonly` (teacher → student) and one `recvonly` (student → teacher). Both are added whether or not anything is being sent yet. Starting, stopping and switching video is `sender.replaceTrack(track | null)`; quality is `setParameters`. Neither needs SDP. The DataChannel's `media.*` messages carry the intent so both UIs know what *should* be on screen without waiting for RTP `mute`/`unmute` events, which fire on timeouts and differ between engines.

### 3.4 Capability flag in `hello`
`hello` gains an optional `caps: string[]`. A Phase 2 build sends `["media"]`. The teacher offers media only to a student whose `hello.caps` includes `"media"`; otherwise the tile says "no video (older build)" and nothing is sent. A Phase 1 student would have ignored `media.offer` as an unknown `t` anyway (rule 4), but the flag turns a 10 s timeout into an immediate, explained state. `caps` is `z.array(z.string().max(16)).max(8).optional()`, not an enum, so a newer peer's extra capabilities do not break parsing.

### 3.5 Capture resolution is fixed; the encoder scales
The iPad captures at a constant `ideal` 1280×720 @ 15 fps and every profile is expressed as a target `height`; the student computes `scaleResolutionDownBy = trackHeight / height` from `track.getSettings()`. Switching thumb ↔ focus never touches the camera, so it is instant and never triggers a WebKit capture restart. If `setParameters` rejects (older WebKit), the student falls back to `track.applyConstraints({ height, frameRate })` and logs it. Floor: **iPadOS 17**.

### 3.6 Media is best-effort; the DataChannel session is the truth
A media failure of any kind (`setRemoteDescription` rejects, no answer, camera error) marks the station's media state and leaves the Phase 1 session untouched. Tiles stay green on the DataChannel. Nothing in media can move a session to `failed`.

---

## 4. Negotiation

### 4.1 Sequence (per session, teacher side drives)

```
student                                  teacher
   |-- DC open, hello{caps:["media"]} -->|
   |<-- hello{caps:["media"]} -----------|
   |                                     | addTransceiver("video",{direction:"sendonly"})   // T→S
   |                                     | addTransceiver("video",{direction:"recvonly"})   // S→T
   |                                     | setCodecPreferences(both, settings.media.codec)
   |                                     | createOffer → setLocalDescription
   |<-- media.offer{seq:1, sdp} ---------|   (chunked by the Phase 1 chunker if > 16 KB)
   | setRemoteDescription(offer)         |
   | for each transceiver from offer:    |
   |   offered sendonly → leave recvonly |
   |   offered recvonly → direction=sendonly
   | createAnswer → setLocalDescription  |
   |-- media.answer{seq:1, sdp} -------->|
   |                                     | setRemoteDescription(answer)
   |                                     | media = ready; if broadcasting: sender.replaceTrack(track)
   |<-- media.broadcast{on,source} ------|
   |<-- media.request{send} -------------|   thumb if Cameras on, else null
```

No ICE gathering wait: the new m-sections BUNDLE onto the transport that already exists, so `localDescription` is complete the moment `setLocalDescription` resolves. No trickle.

### 4.2 Transceiver identification
The student identifies the two transceivers by the **direction the offer asked for**, not by `mid` or order: `sendonly` in the offer means "teacher sends, you receive"; `recvonly` means "you send". The teacher keeps references to the transceivers it created. `mid` values are whatever the browser assigns.

### 4.3 What the SDP contains
Full, uncompressed `pc.localDescription.sdp` — 4–8 KB from Chrome with every codec listed, smaller from WebKit. Zod: `z.string().min(1).max(65536)`. The chunker splits anything over `MAX_FRAME_BYTES` and the Reassembler on the other side rebuilds it; nothing in the SDP is rewritten by us. The QR codec is not involved and never will be (Phase 1 §3.4).

### 4.4 Renegotiating onto a template-built remote description
Both peers' *first* remote description was rebuilt from the compact QR payload (Phase 1 §3.2): one `m=application` section with the real `ice-ufrag`/`ice-pwd`/fingerprint and host candidates. The media offer is generated by Chrome from its own full state and must be accepted by WebKit as a continuation of that rebuilt description: same ICE credentials, same fingerprint, same application `mid`, BUNDLE group extended. This is standard behaviour, but it is the one place Phase 2 touches the Phase 1 template's assumptions, so it is pinned by e2e in both engines (§10.2). If an engine rejects the continuation, the fix belongs in the template (adding an attribute the engine expects), never in the media offer.

### 4.5 Media states (per session, both sides)

```
none ──offer sent/received──▶ negotiating ──answer applied──▶ ready
  │                                │
  │ hello without "media"          │ setRemoteDescription rejects, or no answer in mediaOfferMs (10 s)
  ▼                                ▼
unsupported                      failed ──teacher "Retry video" (drawer)──▶ negotiating (seq+1)
```

- `none` → `negotiating` on the teacher when it sends the offer; on the student when a `media.offer` arrives in signaling state `stable`.
- An offer arriving while the student is not `stable`, or an answer whose `seq` is not the in-flight one, is ignored and counted (rule 4).
- `failed` records a reason string shown in the drawer. Retry is a teacher action only; there is no automatic retry, because the likely causes (engine incompatibility, exhausted decoder) do not fix themselves and a loop would spam the DataChannel.
- Session `failed` (Phase 1) tears media down with it: the student stops its capture track, the teacher forgets the remote stream. A re-pair starts at `none`.

### 4.6 What each side does when `ready`

Teacher:
- Keeps `rx.receiver.track` wrapped in a `new MediaStream([track])` (the student attaches its track with `replaceTrack`, so `ontrack` may carry no stream). This is the tile's thumbnail source.
- If a broadcast is active, `tx.sender.replaceTrack(broadcastTrack)` + `setParameters(fanoutProfile)` and sends `media.broadcast { on: true, source }`. Otherwise sends `media.broadcast { on: false }`.
- Sends `media.request { send: thumb }` if Cameras is on (or `focus` if this station is focused), else `{ send: null }`.

Student:
- Keeps the receive transceiver's track wrapped in a `MediaStream`; the UI mounts it while `media.broadcast.on` is true.
- Applies each `media.request` (§5.2) and replies `media.status`.

---

## 5. Quality control

### 5.1 Profiles
```ts
Profile = { height: 180 | 360 | 720; fps: 1..30; kbps: 50..4000 }
```
Defaults (all in `settings.media`, §8):

| Name | height | fps | kbps | Used for |
|---|---|---|---|---|
| `thumb` | 180 | 10 | 150 | every station while Cameras is on |
| `focus` | 720 | 15 | 1200 | the one focused station |
| `broadcastCamera` | 360 | 15 | 600 | teacher camera to every station |
| `broadcastScreen` | 720 | 5 | 1000 | teacher screen to every station |

### 5.2 Student side: applying `media.request { send }`
- `send: null` → `sender.replaceTrack(null)`, stop the capture track, `media.status { cam: "off", send: null }`.
- `send: profile` → if no capture track, `MediaPort.camera({ ideal 1280×720 @ 15 })`; on failure `media.status { cam: "error", reason, send: null }` and stop. Otherwise `replaceTrack(track)` (idempotent), then `setParameters({ encodings: [{ scaleResolutionDownBy: scaleFor(trackHeight, profile.height), maxFramerate: profile.fps, maxBitrate: profile.kbps * 1000 }] })`, falling back to `applyConstraints` per §3.5. Reply `media.status { cam: "on", send: profile }`.
- Requests are idempotent; the latest wins. The student never changes its own profile spontaneously.
- `scaleFor(trackHeight, targetHeight) = max(1, trackHeight / targetHeight)` — a pure core function, unit-tested.

### 5.3 Teacher side: fan-out ceilings
The broadcast profile for the current source is applied identically to every `tx.sender` via `setParameters` (plus `degradationPreference` per §1.3). It is applied when a link becomes `ready`, when the broadcast starts, and when the source switches. The teacher does not scale by `tiles.length`; the per-source ceilings are chosen for 30 and Chrome's adaptation handles anything beyond. A lab that wants sharper broadcast on fewer stations edits the settings.

### 5.4 Focus
`LabController.focus(ws | null)`. At most one station is focused. Focusing station B while A is focused sends A `thumb` (or `null` if Cameras is off) and B `focus`. Focus works with Cameras off: it turns on exactly one camera. The focus pane and B's tile show the same `MediaStream`. Losing B's session clears focus.

---

## 6. DataChannel protocol: the `media.*` namespace

All on the existing `"lab"` channel. The `MediaMessage` union replaces Phase 1's `never`.

| `t` | Direction | Payload | Purpose |
|---|---|---|---|
| `hello` (changed) | both | `+ caps?: string[]` | Phase 2 builds send `["media"]`; teacher offers only if present |
| `media.offer` | teacher → student | `{ seq: int ≥ 1, sdp: string ≤ 64 KB }` | Full SDP offer; chunked when large |
| `media.answer` | student → teacher | `{ seq, sdp }` | Full SDP answer; `seq` echoes the offer |
| `media.request` | teacher → student | `{ send: Profile \| null }` | What the student should send; idempotent |
| `media.status` | student → teacher | `{ cam: "off" \| "on" \| "error", reason?: string ≤ 200, send: Profile \| null }` | Sent after every applied request and on capture-track `ended` |
| `media.broadcast` | teacher → student | `{ on: boolean, source?: "camera" \| "screen" }` | Whether the student should be showing the teacher's video, and what it is |

Rules unchanged from Phase 1 §5.3: every inbound frame Zod-parsed before core; every outbound parsed before `send`; unknown `t` ignored and counted; each message ships with schema + valid/invalid fixtures + this table. Schemas live in `src/schemas/media.ts` and are spliced into `LabMessageSchema`. `collab.*`, `rec.*`, `log.*` stay `never`.

---

## 7. Core architecture

Rule 1 (framework-free core), rule 3 (UI never touches the PC) and rule 6 (injectable timers) all hold. DOM *types* (`MediaStreamTrack`, `RTCRtpTransceiver`, `RTCStatsReport`) are allowed in core exactly as `RTCPeerConnection` already is; DOM *globals* are not, so capture goes through a port.

### 7.1 New port: `MediaPort` (`src/core/ports.ts`)
```ts
interface MediaPort {
  camera(c: { width: number; height: number; frameRate: number }): Promise<MediaStreamTrack>;
  screen(): Promise<MediaStreamTrack>;   // teacher only; must be called synchronously inside a user gesture
}
```
Browser implementation `src/ui/platform/browserMedia.ts` wraps `getUserMedia` / `getDisplayMedia`, sets `contentHint` (`"motion"` / `"detail"`), and stops the audio tracks `getDisplayMedia` may hand back. `LabController.startBroadcast("screen")` calls the port before its first `await` so Chrome's user-activation requirement is met from the button's click handler. Unit tests use `FakeMediaPort` returning `FakeMediaStreamTrack`s.

### 7.2 `MediaLink` (`src/core/mediaLink.ts`) — one per `PeerSession`
Owns the two transceivers, the negotiation state (§4.5), the remote `MediaStream`, and the send-side profile. Constructed by `PeerSession` when the session reaches `connected` **and** both `hello`s have been exchanged; it receives the `pc`, a `send(m: MediaMessage)` function, a `Clock` and the timers. `PeerSession` routes `media.*` frames to it and exposes it as `session.media`. `PeerSession.teardown()` calls `media.close()`, which stops any capture track it started and clears handlers.

Events: `state: [MediaState, reason?]`, `remoteStream: [MediaStream]`, `status: [MediaStatusMessage]` (teacher side), `broadcast: [MediaBroadcastMessage]` (student side).

Teacher-side API: `offer(codec)`, `setOutbound(track | null, profile | null)`, `request(profile | null)`, `stats(): Promise<MediaStatsView>`.
Student-side API: `applyRequest(send, port)` (called by `StudentController`, which owns the port), `remoteStream`.

Keeping this out of `PeerSession` keeps the Phase 1 state machine and its 40-odd tests untouched; `PeerSession` gains only the `caps` field in `hello`, a `media` property, a route for `media.*` frames and the teardown call.

### 7.3 `LabController` additions
- `broadcast: { source: "camera" | "screen" | null; track: MediaStreamTrack | null }`; `startBroadcast(source)`, `stopBroadcast()`. Track `ended` (screen share stopped from Chrome's own bar, camera unplugged) → `stopBroadcast()` automatically.
- `setCameras(on: boolean)`: persists `settings.media.cameras`, sends `media.request` to every `ready` link.
- `focus(ws | null)`, `focused: string | undefined` (key).
- `retryMedia(ws)`: allowed only from `failed`.
- Stats: while any link is `ready` and (Cameras on or broadcasting), poll `getStats()` every `statsMs` (2 s, injectable) per link, off the `change` path; aggregate `cpuLimited` count and per-station inbound fps/height into `RosterView.media`.
- On each link's `ready`: apply broadcast track + profile, send `media.broadcast`, send the station's current `media.request`.
- `RosterView.media: { state: MediaState; reason?: string; cam: "off" | "on" | "error"; send: Profile | null; stream?: MediaStream; inFps?: number; inHeight?: number; outCpuLimited?: boolean; encoder?: string }`.

### 7.4 `StudentController` additions
- Owns `MediaPort`; on `session.media.request` → `applyRequest`; emits `media` view changes.
- `StudentMediaView: { state: MediaState; cam; send: Profile | null; teacherStream?: MediaStream; broadcast: { on: boolean; source?: "camera" | "screen" } }` exposed through `useStudent()`.
- Stops capture on `stop()`, on session `failed`, and on `media.request { send: null }`. The camera is never on without a live, ready session that asked for it.

### 7.5 Fakes (`test/unit/helpers/fakeRtc.ts`)
`FakeRTCPeerConnection` gains `signalingState`, `addTransceiver()`, `getTransceivers()`, `ontrack` with a `deliverRemoteTrack(transceiver)` helper, `getStats()` returning a scriptable map; `FakeRtpSender` records `replaceTrack` and `setParameters` calls and can be told to reject `setParameters`; `FakeMediaStreamTrack` has `kind`, `readyState`, `stop()`, `getSettings()`, `applyConstraints()`, `onended`. `FakeMediaPort` returns them and can be told to reject.

---

## 8. Persistence

Additive fields with defaults on the existing `lab.teacher.v2` blob (same reasoning as Phase 1's `lastSeenAt`: optional and defaulted, so the key stands; the Zod default fills old blobs):

```ts
settings.media: {
  cameras: boolean = false;
  codec: "h264" | "vp8" | "auto" = "h264";
  thumb: Profile = { height: 180, fps: 10, kbps: 150 };
  focus: Profile = { height: 720, fps: 15, kbps: 1200 };
  broadcastCamera: Profile = { height: 360, fps: 15, kbps: 600 };
  broadcastScreen: Profile = { height: 720, fps: 5, kbps: 1000 };
}
```
`updateSettings` validates the merge as today. Nothing is persisted on the student. No SDP, track or stream is ever persisted (Phase 1 §6).

Timers, injectable, not persisted: `mediaOfferMs` 10 000, `statsMs` 2 000.

---

## 9. UI

### 9.1 Student (iPad)
- `connected`/`degraded` with `broadcast.on`: the teacher's video fills the main area (`<video muted playsinline autoplay>`, `object-fit: contain`, black background). Until the first frame arrives a centred "Teacher's camera / screen" caption sits on the black. `broadcast.on: false` → the Phase 1 "Ready" screen.
- While `cam === "on"`: a red "● Camera on" pill in the status bar next to the state pill. `cam === "error"`: an amber "Camera unavailable" pill with the reason in `title`. WebKit's own camera indicator is not relied on.
- Media `failed`/`unsupported` is not shown on the iPad; the teacher sees it.
- No new controls. The student has no say in media; that is the teacher's job.

### 9.2 Teacher (Mac)
- Header gains: **Cameras** toggle (`data-action="cameras"`), **Share camera** / **Share screen** / **Stop sharing** (`data-action="share-camera" | "share-screen" | "share-stop"`, one visible set), and a media summary "📷 n on · ⚠ k CPU-limited" that appears only while media is active (`data-media-summary`).
- Tile: a 16:9 thumbnail (`<video>` bound to `media.stream`) above the Phase 1 meta lines while `cam === "on"`; otherwise a placeholder strip with the reason: "camera off", "camera error: …", "no video (older build)", "video failed: …" (`data-media-state`). Grid `minmax` widens to 200 px so the video is legible. Clicking the thumbnail toggles focus; clicking anywhere else opens the drawer as today.
- Focus pane: `<section data-focus>` above the grid, 16:9, `max-height: 50vh`, the station's ID and a Close button; Escape closes. One at a time.
- Drawer gains a media block: state + reason, encoder implementation, in/out fps and height, `cpuLimited`, **Focus**/**Unfocus** and **Retry video** (only when `failed`).
- All rendering from `useLabRoster()`; a shared `<VideoView stream>` component owns `srcObject`. The UI never sees a transceiver.

### 9.3 Courier
Unchanged. Media never touches the QR path.

---

## 10. Testing

### 10.1 Unit (`node:test`)
- `schemas/media.test.ts`: valid + invalid fixtures for all five messages and `Profile`; `hello` with and without `caps`; oversize `sdp` rejected; unknown `media.*` `t` ignored by `LabMessageSchema`.
- `core/mediaLink.test.ts` against the fakes: teacher offer creates exactly two transceivers with the right directions; codec preference ordering (`orderCodecs(caps, pref)` pure function); student answer sets `sendonly` on the offered-`recvonly` transceiver only; `seq` mismatch ignored; offer in non-`stable` state ignored and counted; `mediaOfferMs` → `failed`; `setRemoteDescription` rejection → `failed` with reason; `close()` stops the capture track; `ready` emits `remoteStream`.
- `core/labController.test.ts` additions: offer sent only when `hello.caps` has `"media"`, else `unsupported`; `setCameras` requests to every `ready` link; `focus` swap sends the right profiles to the right stations and clears on session failure; `startBroadcast` calls `replaceTrack` + `setParameters` on every `ready` link and on links that become `ready` later; track `ended` → `stopBroadcast` and `media.broadcast {on:false}` to all; `retryMedia` refused unless `failed`; stats aggregation from a scripted `getStats`.
- `core/studentController.test.ts` additions: `applyRequest` thumb → capture once, `setParameters` with `scaleResolutionDownBy 4`; focus → `1`; `setParameters` rejection → `applyConstraints` fallback; `null` → track stopped; port rejection → `media.status {cam:"error"}`; session `failed` stops capture; `scaleFor` table.
- `core/peerSession.test.ts` additions: `hello` carries `caps`; `media.*` frames routed to the link; teardown closes it. Existing tests unchanged.

### 10.2 End-to-end (Playwright)
- `media.spec.ts` (Chromium, two contexts, loopback, fake camera): pair → tile `data-media-state="ready"`; Cameras on → student `data-cam="on"`, teacher `window.__lab.mediaStats(ws)` reports `framesDecoded > 0` and `frameHeight ≤ 180`; Focus → `frameHeight ≥ 360` within 10 s; Share camera → student `<video>` `videoWidth > 0`; Stop → student back to "Ready"; Cameras off → student `data-cam="off"` and the capture track count is 0 (`window.__lab.activeTracks()`).
- `media-renegotiation.spec.ts` (**Chromium and WebKit**, intra-engine like `codec.spec.ts`): Phase 1 pairing through the compact codec, then the media offer/answer, asserting both peers reach `ready` and `getTransceivers().length === 2` (the application section is not a transceiver). This is the §4.4 guard.
- `load.spec.ts`: 5 iframes with Cameras on and Share camera; every tile `ready` with `framesDecoded > 0`; every iframe decoding.
- Dev hooks `window.__lab.mediaStats`, `window.__lab.activeTracks` are `import.meta.env.DEV`-only like the rest of `__lab`.

### 10.3 Fixtures
`test/fixtures/sdp/` gains a captured Chrome media offer (3 m-sections) and a Safari media answer, used by `MediaLink` unit tests and the fake PC's `createOffer`/`createAnswer` in media mode.

---

## 11. Load page and lab checklist

### 11.1 `/dev/load` (dev only)
Iframes use Chromium's fake camera (`--use-fake-device-for-media-stream`; every iframe shares it). The page adds the Cameras/Share controls and a table per station: media state, `encoderImplementation` for the teacher's sender, `qualityLimitationReason`, out fps/height, in fps/height. A header line sums CPU-limited senders. Run on the Mac with 30 iframes with Cameras on and Share screen, watch Activity Monitor: the pass bar is "no `cpu` limitation for 5 minutes with the defaults". If it fails, lower `broadcastCamera`/`broadcastScreen` in settings or switch `codec`, and record the outcome in this document's §12 before the defaults ship. Remember the run double-counts (§1.4).

### 11.2 `docs/lab-checklist.md` additions
- Prerequisite: teacher Mac on **Ethernet** if the room has a port; note the AP model.
- Media smoke: Cameras on → every tile shows video within 10 s; one Focus → readable face; Share screen → every iPad shows it, text legible; Stop → every iPad back to Ready.
- Soak: Cameras on for two hours; note any iPad whose tile goes to "camera error" (thermal) and whether the Mac's fans came on.
- Older-build check: any tile saying "no video (older build)" means that iPad's Home Screen app is stale; reload it.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Mac grants fewer than 30 VideoToolbox sessions; the rest fall back to software silently | `encoderImplementation` per sender on `/dev/load`; the software budget (§1.2) already fits; `codec: "vp8"` setting as a uniform fallback |
| WebKit rejects the media offer as a continuation of the template-built remote description | `media-renegotiation.spec.ts` in WebKit on every CI run; fix goes in the Phase 1 template |
| `setParameters` on iPad ignores `maxFramerate` or `scaleResolutionDownBy` | `applyConstraints` fallback (§3.5); e2e asserts the delivered `frameHeight` |
| AP airtime with 31 clients streaming | Mac on Ethernet; thumbnails at 150 kbps; broadcast ceilings; the lab checklist measures it on day one |
| iPads throttle after hours with the camera on | Cameras default off; `media.status {cam:"error"}` surfaces dropouts; soak item in the checklist |
| Camera on without the student knowing | Capture only on a live, ready session that asked for it; stopped on any failure; visible "● Camera on" pill |
| `getDisplayMedia` picker refused / cancelled | `startBroadcast` rejects, UI shows "Sharing cancelled", state unchanged |

---

## 13. Out of scope
Audio in either direction; student → student media; recording (Phase 4); student screen share, whiteboard, chat (Phase 3 — "screen share" here means the teacher's screen as the broadcast source, which is transport-identical to the camera); per-student mute of the broadcast; simulcast/SVC; the WebCodecs encode-once fan-out (§1.5); courier batching; ICE restart; any QR codec change.

## 14. Follow-ups
Recorded here so they are not lost; none blocks Phase 2.

| Item | Note |
|---|---|
| `/dev/load` measurement results | Fill in after the first Mac run (§11.1) with `encoderImplementation`, CPU %, and whether the defaults held at 30 |
| Audio transceivers | If a remote-classroom use ever appears, add `audio` transceivers in the same single offer and gate with a `caps` entry |
| Phase 2b encode-once fan-out | Only if §11.1 fails after tuning; §1.5 sketches it |
