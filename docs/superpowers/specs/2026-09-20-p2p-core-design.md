# Learning Lab P2P — Phase 1 Core Design

**Status:** shipped (Phase 1). **Amended by** [2026-09-21-variable-workstation-ids-design.md](2026-09-21-variable-workstation-ids-design.md): `ws` becomes a typed string ID, the roster is dynamic, and a repeated ID takes over. Where the two disagree, the amendment wins.
**Date:** 2026-09-20
**Scope:** Phase 1 only — QR-signaled WebRTC DataChannel connectivity between one teacher station and up to 30 fixed student iPads, with heartbeat monitoring and re-pair flow. Media (Phase 2+) is designed *for* but not built.

---

## 1. Problem & constraints

A learning lab has 25–30 fixed student workstations (iPads, MDM-managed, fixed mounts, built-in cameras) and one teacher station (MacBook Pro, built-in + external camera). We want live P2P WebRTC links teacher↔each student with **no backend**: the app is static files on GitHub Pages, the only network beyond the lab LAN is GitHub itself.

Hard constraints:

| Constraint | Consequence |
|---|---|
| GitHub Pages only, no server | Signaling must be manual (QR) or GitHub-as-dead-drop (future). |
| Same LAN, no STUN/TURN | Host ICE candidates only; gathering is sub-second. |
| iPads run WebKit (Safari; Chrome on iOS is also WebKit) | No enterprise browser policies; rely on WebKit behaviour. |
| Students have no phones during class; setup uses a phone as a **courier** | Every hop of signaling is a QR scan. |
| Setup once per semester; re-pair only on cold start | Pairing must be fast per station but need not be zero-touch. |

### 1.1 Decisions made during brainstorming (and why)

1. **Stored SDP cannot be reused for reconnect.** ICE ufrag/pwd and DTLS handshake are bound to the live `RTCPeerConnection`. Any cold start (page reload, crash, power cycle) on either side requires a fresh offer/answer. Transient drops are handled by ICE itself. Therefore: *transient = trust ICE; hard failure = re-pair*. No ICE restart (it also needs an exchange, and our only in-band channel is dead when we'd need it).
2. **Phase 1 signaling = QR courier; signaling is a pluggable interface** so a `GitHubDeadDropTransport` (teacher writes SDPs to a repo/gist via API, students poll) can be added later without touching the P2P core. Deferred because it needs token management and makes SDPs semi-public.
3. **Student is the offerer.** Student page shows its offer QR on load with no teacher action; re-pair is student-initiated and self-serve.
4. **mDNS candidate obfuscation is avoided by holding camera permission.** WebKit and Chromium emit real host IPs when the origin has media-capture permission. We need the camera for QR scanning anyway, so request it *before* creating the PC.
5. **iPad kiosk = Home Screen web app under MDM Single App Mode**, Auto-Lock Never, plugged in. Standalone web apps are exempt from Safari's 7-day script-storage purge. Screen Wake Lock as belt-and-braces.
6. **Stack:** Vite + React + TypeScript (strict). Zod at every core boundary. `node:test` for core, Playwright for end-to-end.
7. **Phase 2 target is bidirectional media** (student→teacher grid + teacher→students). Phase 1 reserves protocol namespaces and builds the DC chunker so Phase 2 renegotiation can carry full SDP over the DataChannel.

---

## 2. Roles & pairing flow

One app, three roles selected by pathname:

| Route | Device | Lifetime |
|---|---|---|
| `/student?ws=N` (N ∈ 1..30) | iPad, Home Screen app, Single App Mode | Always on |
| `/teacher` | MacBook Chrome, persistent tab | Always on during lab hours |
| `/courier` | Any phone browser | Transient; holds one payload |
| `/dev/load` | Dev only | Loads student iframes for local load testing; **route exists only in dev builds** |

Dev-only surfaces — `/dev/load`, `window.__lab` (e2e injection hook), `window.__labCodec`, the `?timers=` watchdog override and the iframe `autopair` bridge — are all behind `import.meta.env.DEV`. A production bundle contains none of them (`grep -c '__lab\b\|lab-offer\|lab-answer\|dev/load' dist/assets/*.js` → 0); Playwright runs against `pnpm dev`, so e2e still has them.

### 2.1 Student startup
1. Read `ws` from URL (fallback: persisted value; conflict → prompt, see §6). Neither present → a full-screen **workstation picker** (1–30); the choice is persisted, so it appears once per iPad. This is the Home Screen web-app path: iPadOS isolates the standalone app's storage from Safari's, so a `ws` chosen in Safari before "Add to Home Screen" is not visible to the installed app.
2. Request `getUserMedia({video:true})` once to obtain permission (stream stopped immediately). Ensures real-IP candidates.
3. Create `RTCPeerConnection({ certificates:[cert] })` with the persisted DTLS certificate (§6). Create DataChannel `"lab"` (ordered, reliable).
4. `createOffer` → `setLocalDescription` → wait for `iceGatheringState === "complete"` (no STUN configured → fast).
5. Compress local description (§3) → render QR. State `awaiting-remote`.

### 2.2 Pairing one workstation — 4 scans
1. Courier scans **student screen** → holds `OFFER ws=N`.
2. **Teacher station camera** scans courier → dashboard creates `PeerSession(N)`, `setRemoteDescription(offer)`, `createAnswer`, waits gathering complete, shows compressed **answer QR** in the scan modal.
3. Courier scans **teacher screen** → holds `ANSWER ws=N`.
4. Student taps "Show camera", **iPad camera** scans courier → `setRemoteDescription(answer)` → ICE → DC open → `connected`.

The student rejects an answer whose `ws` is not its own ("This code is for workstation 9, not 7") before touching the PC and stays in `awaiting-remote`, so a courier mix-up costs one rescan rather than a dead session. A rejected scan also resets the scanner's duplicate filter, so holding the same QR up again retries.

Courier displays payload kind + `ws` prominently ("ws 7 · ANSWER → show to iPad 7") to prevent mix-ups while walking the room. Courier holds exactly one payload (batching deferred).

### 2.3 Cold-start rule
- Student restart → student shows a fresh offer; teacher tile for that `ws` goes red "needs re-pair".
- Teacher restart → all stations need re-pair; dashboard shows a "Re-pair queue" in `ws` order.
- Transient network drops never require re-pair (§4).

---

## 3. SDP codec

Full SDP (1.5–3 KB) is not QR-friendly. Only fields the peer cannot infer are transmitted.

### 3.1 Payload
```ts
{
  v: 1,
  role: "offer" | "answer",
  ws: number,                       // 1..30
  mid: string,                      // a=mid of the m=application section; the answer must echo the offer's
  ufrag: string,
  pwd: string,
  fp: Uint8Array,                   // sha-256 fingerprint, 32 raw bytes
  setup: "actpass" | "active" | "passive",
  cands: Array<{ ip: string; port: number; proto: "udp" }>  // host candidates only; IPv4 + IPv6; link-local and mDNS excluded
}
```
Encoding: compact JSON → deflate-raw via `CompressionStream` (native, Safari 16.4+/Chromium) → base64url. Wire form: `LAB1:<base64url><crc8-hex>`. **Measured: 233 chars for a 2-candidate Chrome offer** (201 for one candidate) → QR version ≈ 11–13; the e2e codec roundtrip asserts < 300 chars in both engines.

**Charsets are validated, not just lengths.** Every field below is interpolated into the rebuilt SDP, so a CRLF smuggled through a QR would inject session attributes: `ip` must match `/^[0-9A-Fa-f:.]+$/` (IPv4/IPv6 literal, so an mDNS name cannot pass), `ufrag`/`pwd` `/^[A-Za-z0-9+/\-_=]+$/`, `mid` `/^[A-Za-z0-9_\-]+$/`. The rules apply to both the full and the compact schema.

### 3.2 Decode
Reconstruct a full SDP from a fixed template: one `m=application 9 UDP/DTLS/SCTP webrtc-datachannel` section, `a=group:BUNDLE <mid>`, `a=mid:<mid>`, `a=ice-ufrag`, `a=ice-pwd`, `a=fingerprint:sha-256`, `a=setup`, `a=sctp-port:5000`, `a=max-message-size`, host `a=candidate` lines, `a=end-of-candidates`. Feed to `setRemoteDescription`.

The template is validated by Playwright roundtrips WebKit↔Chromium against captured fixtures (§8). Any change to the template requires those tests to pass in both directions.

**mDNS candidates are refused at extraction.** A `<uuid>.local` host candidate means the origin never got the camera grant (§1.1.4) and the peer would have to resolve it over multicast DNS the lab LAN may not carry. Such candidates are skipped, as are link-local ones (`169.254.*`, `fe80::*`). If nothing usable remains, extraction throws a `CodecError` whose message names the actual cause rather than producing a payload that can never connect: `only mDNS candidates found — camera permission missing, cannot pair` **only when a `.local` candidate was present**; `no usable host candidate — only link-local addresses were gathered; check the LAN connection` when the gather was link-local only; `no host candidates in sdp` when there were none at all.

### 3.3 Failure mode
CRC mismatch or Zod failure → payload rejected at the boundary; courier flashes red and stays scanning. `setRemoteDescription` rejection → UI shows the error message (student: a toast; teacher: inline in the scan modal).

The **copyable diagnostic blob** (raw payload + UA + error) is descoped to a Phase 1.5 follow-up. Current behaviour is a plain message, which is what the lab actually needs mid-pairing; the blob only pays off once someone is triaging remotely.

### 3.4 Scope
The codec is **DataChannel-only, forever**. Phase 2 media renegotiation carries full, uncompressed SDP over the DataChannel (§5) and never touches QR.

---

## 4. PeerSession state machine

One `PeerSession` per (teacher, ws). Student has exactly one. Core class, no DOM/React imports; wraps one `RTCPeerConnection`, one DataChannel, heartbeat timers.

```
idle → gathering → awaiting-remote → connecting → connected ⇄ degraded
                                          ↓             ↓         ↓
                                        failed ←────────┴─────────┘
```

| State | Entry | Exit |
|---|---|---|
| `idle` | constructed | `start()` |
| `gathering` | PC created, local description set | ICE gathering complete → emit `localPayload` |
| `awaiting-remote` | QR shown | `applyRemote(payload)`; no timeout (offer valid while PC alive) |
| `connecting` | remote set | DC `open` → `connected`; 20 s timeout or ICE `failed` → `failed` |
| `connected` | DC open, heartbeat started | ICE `disconnected` or 15 s heartbeat silence → `degraded`; DC `close`/ICE `failed` → `failed` |
| `degraded` | amber; **do nothing**, trust ICE consent checks | heartbeat resumes → `connected`; > 60 s in degraded → `failed` |
| `failed` | terminal for this PC; emit `needsRepair`; `close()` PC | student: auto `start()` a new session; teacher: tile red |

`gathering` can also end in `failed`: a DC or PC error while gathering (or a `close()` from a superseding scan) tears the session down without ever emitting `localPayload`.

**Timers** (all injectable, §6.2 for the persisted three):

| Timer | Default | Meaning |
|---|---|---|
| `gatherMs` | 3 s | Fallback: proceed with whatever candidates we have if `iceGatheringState` never reaches `complete` |
| `connectMs` | 20 s | `connecting` → `failed` if the DataChannel never opens |
| `heartbeatMs` | 5 s | `hb` interval |
| `degradedMs` | 15 s | heartbeat silence → `degraded` |
| `failedMs` | 60 s | time in `degraded` → `failed` |

**`start()` rejection → the controller respawns with backoff.** If the student's `start()` rejects (no usable candidate, codec refusal), `StudentController` logs it, `close()`s the dead session, drops it, emits `error` with the message (rendered under "Starting…") and respawns after `restartDelayMs * 2^attempt`, capped at 30 s. `attempt` resets when a session reaches `connected` and on `stop()`/`start()`, so a restarted controller backs off from `restartDelayMs` again; `stop()` also cancels a pending respawn. Without this the kiosk sits on "Starting…" forever with no session and no QR.

### 4.1 Heartbeat
Every 5 s each side sends `hb {seq, ts}`; receiver replies `hb-ack {seq, ts}`. RTT = now − ts on ack; the **last RTT is kept per session** (`PeerSession.lastRtt`, mirrored into the roster) — the dashboard shows a current number, not a series. Miss threshold 15 s. All three timers (`heartbeatMs`, `degradedMs`, `failedMs`) come from teacher settings (§6) and are injectable for tests.

### 4.2 Keep-alive on iPad
`navigator.wakeLock.request("screen")` on load; re-request on `visibilitychange → visible` (locks release when hidden). Single App Mode + Auto-Lock Never via MDM are the primary defence; wake lock is secondary.

### 4.3 Signaling boundary
```ts
interface SignalingTransport {
  publish(local: SdpPayload): Promise<void>;        // render QR / POST to dead-drop
  onRemote(cb: (remote: SdpPayload) => void): () => void;
}
```
Phase 1: `QrCourierTransport` (QR render + camera decode). Future: `GitHubDeadDropTransport`. `PeerSession` depends only on the interface.

---

## 5. DataChannel protocol

Single channel `"lab"`, ordered, reliable, JSON, discriminated on `t`. Envelope `{ t: string; id?: string; ...payload }`, `id` = correlation for request/reply.

### 5.1 Phase 1 messages
| `t` | Direction | Payload | Purpose |
|---|---|---|---|
| `hello` | both, first after open | `{ role, ws, appVersion, ua }` | Identify; version mismatch → dashboard warning, no disconnect |
| `hb` / `hb-ack` | both | `{ seq, ts }` | Heartbeat / RTT |
| `status` | student → teacher, on change | `{ battery?, charging?, visibility, wakeLock }` | Dashboard hints ("unplugged", "screen hidden") |
| `cmd` | teacher → student | `{ cmd: "reload" \| "show-id" \| "ping" }` | Remote actions; `reload` = deliberate re-pair from the desk |
| `chunk` | both | `{ id, i, n, data }` | Reassembly frame for messages > 16 KB (Safari DC limit); built now, used by Phase 2 SDP. The reassembler buffers ≤ 8 in-flight ids; duplicates, out-of-range indices and the buffered chunks of an evicted id all count as dropped |

### 5.2 Reserved namespaces (typed as empty unions now)
- `media.*` — Phase 2: `media.offer` / `media.answer` (full SDP), `media.request {kind, res}` for per-peer quality bumps.
- `collab.*` — Phase 3. `rec.*` — Phase 4. `log.*` — Phase 5.

### 5.3 Rules
- Unknown `t` → ignore and increment a counter; never throw.
- **Every inbound message is `zod.parse`d before entering core; every outbound message is `zod.parse`d before `send`.** Schemas in `src/schemas/`, TS types via `z.infer`. Core never handles `unknown`.
- Any message change ships with: schema, valid + invalid fixtures, protocol table update, in the same PR.

---

## 6. Persistence

What survives a restart. **Never** SDPs, candidates, or anything connection-scoped.

### 6.1 Student — `localStorage["lab.student.v1"]`
```ts
{ ws: number; teacherAppVersion?: string; lastConnectedAt?: number; pairCount: number }
```
`ws` from URL on first load, then persisted so the Home Screen app launches without a query string. If URL is present and differs → prompt "This iPad was ws 7, URL says 9 — switch?". If `?ws=` is present but *invalid*, the page says so ("Invalid ?ws in URL — using saved workstation N", or the same notice above the picker when nothing is saved) instead of falling back silently.

`pairCount` counts **pairings** — `connecting → connected` transitions — not recoveries: an ICE blip that goes `degraded → connected` is the same pairing continuing.

### 6.2 Teacher — `localStorage["lab.teacher.v1"]`
```ts
{
  roster: Record<number, { label?: string; lastConnectedAt?: number; lastSeenAt?: number; lastRtt?: number;
                           lastSeenUa?: string; lastFingerprint?: string; pairCount: number }>;
  settings: { heartbeatMs: 5000; degradedMs: 15000; failedMs: 60000; cameraDeviceId?: string };
}
```
Roster is dashboard metadata ("last seen", labels like "Row 2 seat 3"), not connection state. `pairCount` has the same `connecting → connected` meaning as §6.1. `lastConnectedAt` is the pairing time; `lastSeenAt` is the last inbound frame of any kind (`PeerSession` emits `inbound` for every schema-valid frame). The live value updates on every frame and is what the tile shows; it is persisted at most once a minute per station, plus immediately on `degraded`/`failed`, so a teacher-tab reload still shows when a red tile was last heard from. `lastSeenAt` is optional and additive, so the `v1` key stands. `lastFingerprint` (uppercase colon-separated hex of the offer's sha-256 fingerprint) is compared with the stored value when `acceptOffer` is called, and **written only once that call's answer resolves**: a superseded or blown-up scan never becomes the baseline for the next continuity check. The drawer shows the first 8 bytes of the stored fingerprint whenever one exists, and adds the verdict — "same device as last pairing" or "⚠️ different device than last pairing" — only while the tile has a session this run (state ≠ `never`), because the verdict is a claim about the current pairing.

### 6.3 DTLS certificate — IndexedDB
`RTCPeerConnection.generateCertificate({name:"ECDSA", namedCurve:"P-256"})` once per device, stored, passed as `certificates:[cert]`. Gives a stable fingerprint per device so the teacher can confirm "same iPad 7 as last week". Does **not** enable SDP reuse.

### 6.4 Rules
All reads are Zod-parsed with defaults. Corrupt blob → log, reset to defaults, never crash. `v1` in the key is the migration handle.

---

## 7. UI surfaces

### 7.1 Student (iPad, fullscreen, glanceable from across the room)
- Top status bar: large `ws`, state pill (grey idle / blue waiting / amber degraded / green connected / red re-pair), RTT, `appVersion`.
- `awaiting-remote`: offer QR centred at ~60 % viewport, "Waiting for teacher", "Show camera" button → camera view to scan courier. Camera opens only on demand.
- `connected`: QR gone, calm screen, status bar only (Phase 2 content goes here).
- `failed`: auto-regenerates offer; toast "Connection lost — showing new code".
- No settings UI; configuration from URL/MDM only.

### 7.2 Teacher dashboard (Mac, Chrome)
- 5×6 grid of tiles: `ws`, label, state colour, RTT, last seen (`lastSeenAt`, falling back to `lastConnectedAt` for a station never heard from this run), battery/plugged icon. Click → detail drawer (state timeline, UA, DTLS fingerprint + continuity verdict, `cmd` buttons). The timeline survives re-pairs, so the drawer still shows how the previous session died.
- Header: green/amber/red counts, `appVersion`, **Scan** → camera modal (external cam by default, `deviceId` remembered). Scanning an offer auto-routes by embedded `ws`; the answer QR appears in the same modal until the teacher taps "Done".
- Side panel: **Re-pair queue** listing red tiles in `ws` order — the walking route.
- All rendering via `useLabRoster()`; UI never touches `RTCPeerConnection`.

### 7.3 Courier (phone, portrait)

The manifest declares `orientation: "any"`, not `portrait`: the iPads are landscape-mounted and the courier phone is portrait, and one manifest serves both. It declares **no `start_url`**: iPadOS honours it for Home Screen web apps, and a fixed `./student` threw away the `?ws=N` the app was added from (and was wrong for the teacher and courier anyway). Without it, iOS launches the URL that was on screen at "Add to Home Screen". Icons: `icon.svg` plus a 180×180 `apple-touch-icon.png` (generated by `pnpm icon`), because iOS ignores SVG icons for Home Screen web apps.
Three states: **Scan** (full-screen camera, auto-detect) → **Holding** (huge QR, "ws 7 · OFFER → show to teacher") → "Done, scan next" → Scan. Payload Zod-validated before holding; bad scan = red flash, stay in Scan.

### 7.4 Shared
`<Scanner>` wraps `getUserMedia` + `BarcodeDetector` when available (Chromium, Safari 17+), falls back to `jsQR` (Vite import). `<QrView>` renders via `qrcode` package to canvas.

---

## 8. Testing

### 8.1 Unit — `node:test` + `tsx`, `src/core/**` and `src/schemas/**` only
- `SdpCodec`: roundtrip on fixture SDPs captured from real Safari and Chrome; CRC catches bit flips; wrong prefix rejected.
- `PeerSession` vs `FakeRTCPeerConnection` (scriptable ICE/DC events, fake timers): every §4 transition, timeouts, heartbeat miss → degraded → failed, degraded recovery.
- Schemas: valid/invalid fixtures per message type; unknown `t` ignored.
- Persistence: corrupt blob → defaults; key versioning.
- ESLint `no-restricted-imports` forbids `react`, `react-dom`, DOM globals in `src/core/**`.

### 8.2 End-to-end — Playwright, Chromium + WebKit
- Two contexts on one machine (student + teacher) P2P over loopback. Camera bypass: test reads `data-payload` attribute from the QR element and injects it into the other context via `page.evaluate` (simulated courier). Assert `connected` + heartbeats.
- Failure path: close student context → teacher tile degraded → failed within shortened timers; new context re-pairs.
- Codec through real browsers: the roundtrip spec (`codec.spec.ts`) runs **per engine** — Chromium and WebKit each extract → encode → decode → rebuild → `setRemoteDescription` in both directions within their own engine. A single cross-process WebKit-offer → Chromium-answer handoff is a follow-up.
- One real-scanner test (`scanner.spec.ts`, Chromium only): the student's offer wire is rendered into a Y4M clip (`test/e2e/qrVideo.ts`) that a second browser plays as the teacher's camera via `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<qr.y4m>`. The teacher's answer QR appears only if `<Scanner>` decoded the frames, so the camera → decode → `acceptOffer` path is covered end to end; the rest of the suite still bypasses the camera through `data-payload`.

### 8.3 Manual — `docs/lab-checklist.md`
30-iPad smoke; 10 s WiFi pull → amber → green; 90 s → red → re-pair; teacher tab reload → re-pair all; overnight soak.

### 8.4 Load — `/dev/load`
Teacher opens N student iframes locally, each pairing via `postMessage` (same-origin checked). CI runs **5** iframes to keep the run honest on a shared runner; 30 is the manual check on the Mac. Phase 2 adds `canvas.captureStream()` mock video.

---

## 9. Repository layout, build, deploy

```
AGENTS.md
docs/
  superpowers/specs/2026-09-20-p2p-core-design.md
  lab-checklist.md
src/
  core/        # plain TS. PeerSession, SdpCodec, heartbeat, transport interface, store
  schemas/     # Zod schemas; types via z.infer
  ui/          # React: student/, teacher/, courier/, shared/
  hooks/       # usePeerSession, useLabRoster — sole bridge core↔React
  main.tsx     # pathname router: /student /teacher /courier /dev/load
scripts/
  make-icon.mjs              # pnpm icon → public/apple-touch-icon.png
test/
  unit/  e2e/  fixtures/sdp/
.github/workflows/ci.yml     # lint, typecheck, unit, playwright
.github/workflows/pages.yml  # vite build → actions/deploy-pages on push to main
vite.config.ts               # base = process.env.VITE_BASE ?? "/"
```

- **Routing:** pathname switch in `main.tsx`, no router lib. Pages SPA fallback: `404.html` copy of `index.html`.
- **PWA:** `manifest.webmanifest` (standalone, `orientation: "any"`, `icon.svg` + `apple-touch-icon.png` 180×180). **No service worker in Phase 1** (SW caching + kiosk + hot fixes is a footgun).
- **Dev-only code:** `/dev/load`, `window.__lab`, `window.__labCodec`, `?timers=` and `autopair` are gated on `import.meta.env.DEV` and absent from the deployed bundle (§2).
- **Tooling:** pnpm, strict TS, ESLint + Prettier, Conventional Commits.
- **Deploy:** push `main` → GitHub Pages. `VITE_BASE` derived from `GITHUB_REPOSITORY` in the workflow. `appVersion` = short git SHA baked in at build; shown on student bar and teacher header so version skew is visible.

---

## 10. Out of scope for Phase 1
Media streams, screen share, chat, recording, analytics, GitHub dead-drop signaling, courier batching, service worker/offline boot, ICE restart.

## 11. Open risks
| Risk | Mitigation |
|---|---|
| WebKit changes real-IP-with-camera-permission behaviour | Playwright WebKit e2e will fail; fallback would be dead-drop transport (still no server). |
| Lab LAN blocks peer-to-peer UDP (client isolation) | Out of our control; lab-checklist step 1 detects it on day one. |
| iPad suspends page despite Single App Mode | Wake lock + `status.visibility` reporting exposes it on the dashboard. |
| SDP template drifts from browser expectations | Fixture roundtrips in both engines on every CI run. |

## 12. Follow-ups
Small, agreed, not yet scheduled. Each ships with its own tests when picked up.

| Item | Where | Note |
|---|---|---|
| Heartbeat silence is detected on the 5 s tick with a strict `>` compare, so `degraded` lands at **20 s** after the last frame, not the documented 15 s | `Heartbeat.tick()` | Change to `>=` (15 s exactly) or document 20 s; the unit test for `lastSeenAt` persistence currently encodes the 20 s behaviour. |
| Copyable diagnostic blob (raw payload + UA + error) on codec/`setRemoteDescription` failure | §3.3 | Phase 1.5; pays off only when triaging remotely. |
| Cross-process WebKit-offer → Chromium-answer codec handoff | §8.2 | Today each engine round-trips within itself. |
| Roster entry is created and persisted at `acceptOffer`, before the pairing is confirmed | `LabController.acceptOffer` | A scan on a broken LAN leaves a permanent `never` tile until removed. Consider deferring entry creation to the answer, as `lastFingerprint` already is. |
| `counts()` walks `snapshot()`, which deep-copies every station's history; `useLabRoster` calls both per `change` | `LabController.counts` | Iterate `orderedKeys()` and read session state directly. Pre-existing cost, now cheap to fix. |
| `TeacherApp.open` is not cleared when the open tile disappears from the roster | `TeacherApp.tsx` | Unreachable today (only the drawer removes); a future removal path would re-open the drawer when that key re-pairs. |
| `releaseStudent()` rethrows if the cached boot promise rejected; caller uses `void` | `bootStudent.ts` | Unreachable today (a failed boot has no "change" button); add a `.catch`. |
| Compact QR schema lacks a direct "rejects a bad `w`" unit test | `sdpPayload.test.ts` | Same `WsSchema` as the full payload, so risk ≈ 0; spec §8 of the IDs amendment names it. |
| `TileDrawer` acknowledges `replaced` keyed on `t.ws` (display) rather than `t.key` | `TileDrawer.tsx` | Idempotent either way; `t.key` is the stable handle. |
| `migrateTeacherV1` silently merges two v1 keys that case-fold to one `wsKey` | `migrations.ts` | Unreachable with real v1 data (numeric keys); illegal keys are now skipped with a log. |
