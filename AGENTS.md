# AGENTS.md — Learning Lab P2P

Instructions for AI coding agents and humans working in this repo. Read the current spec before touching code: [docs/superpowers/specs/2026-09-20-p2p-core-design.md](docs/superpowers/specs/2026-09-20-p2p-core-design.md), as amended by [docs/superpowers/specs/2026-09-21-variable-workstation-ids-design.md](docs/superpowers/specs/2026-09-21-variable-workstation-ids-design.md), and extended by [docs/superpowers/specs/2026-09-21-phase2-media-design.md](docs/superpowers/specs/2026-09-21-phase2-media-design.md) (Phase 2 media).

## What this is

Serverless WebRTC between one teacher MacBook and any number of fixed, MDM-managed student iPads on the same LAN. Static site on GitHub Pages. Signaling is manual: SDP compressed into QR codes, carried between screens by a phone ("courier"). No STUN/TURN, no backend, no network beyond GitHub.

Roles by pathname: `/student?ws=ID`, `/teacher`, `/courier`, `/dev/load`.

## Non-negotiable facts (don't re-litigate)

- **Stored SDP cannot reconnect.** ICE creds + DTLS are bound to the live `RTCPeerConnection`. Cold start on either side → re-pair. Transient drops → trust ICE, do nothing. No ICE restart.
- **Student is the offerer.** Student page shows an offer QR on load. Teacher answers.
- **Workstation IDs are strings, matched case-insensitively.** `wsKey(ws)` (lowercase) is the identity; the typed form is only for display. Pairing under an ID that already has a live session replaces it — reload-to-fix — and the tile shows "↺ replaced". Uniqueness in a room is the teacher's job.
- **Request camera permission before creating the PC.** WebKit/Chromium emit real host IPs only when the origin holds media-capture permission. Otherwise you get mDNS `.local` candidates that may not resolve on the lab LAN.
- **iPads are WebKit.** Chrome on iOS is WebKit. No browser policies available. Kiosk = Home Screen web app + MDM Single App Mode + Auto-Lock Never.
- **The QR codec is DataChannel-only, forever.** Media renegotiation (Phase 2+) sends full SDP over the DataChannel.
- **Signaling is a pluggable interface.** `SignalingTransport` in core; `QrCourierTransport` now, GitHub dead-drop later. `PeerSession` must never know which.
- **Media: video only, teacher is the sole offerer, negotiate once.** No audio. The teacher sends one `media.offer` per session (two video transceivers); after that only `replaceTrack` and `setParameters`. Quality never renegotiates. Media failures never fail the session.
- **Capture only while asked.** A student's camera is on only while a ready link has a non-null `media.request`; any failure stops it. Cameras default off.
- **Cameras-off is fire-and-forget over the DataChannel.** A degraded station keeps its camera until its session tears down (≤ 60 s); there is no acknowledgement to wait for and no retry.

## Stack

Vite · React · TypeScript (strict) · Zod · pnpm · ESLint + Prettier · `node:test` + `tsx` (unit) · Playwright Chromium + WebKit (e2e) · GitHub Actions → GitHub Pages.

## Architecture rules

1. **`src/core/` is framework-free.** No `react`, `react-dom`, or DOM globals. Enforced by ESLint `no-restricted-imports`. Core exposes classes/events; `src/hooks/` is the only bridge to React.
2. **Zod at every core boundary.** Every input into core (DataChannel messages, QR payloads, `localStorage` reads, URL params) is `schema.parse`d before core sees it. Every output from core (outbound DC messages, persisted blobs) is `schema.parse`d before leaving. Schemas live in `src/schemas/`; TS types are `z.infer<>` of them, never hand-written duplicates. Core never handles `unknown`.
3. **UI never touches `RTCPeerConnection`.** Components render from `usePeerSession()` / `useLabRoster()` only.
4. **Unknown DC message `t` → ignore + count.** Never throw on the wire.
5. **Persistence reads always have defaults.** Corrupt blob → log, reset, continue. Never crash on storage.
6. **Timers are injectable.** `heartbeatMs` / `degradedMs` / `failedMs` come from settings and are overridable in tests.
7. **Reserved namespaces stay reserved.** `media.*` is live (Phase 2, `src/schemas/media.ts`). `collab.*`, `rec.*`, `log.*` are typed as empty unions until their phase. Don't squat on them.
8. **Core hands out `MediaStreamTrack`s, never builds a `MediaStream`.** `<VideoView>` is the only place `new MediaStream()` appears. Capture goes through `MediaPort`.

## Change rules

- Any change in `src/core/**` ships with a unit test in the same PR.
- Any DataChannel message change ships with: Zod schema, valid + invalid fixtures, protocol table update in the spec.
- Any change to the SDP template in `SdpCodec` must pass the WebKit↔Chromium roundtrip e2e in **both** directions.
- New persisted shape → bump the storage key version (`lab.*.v2`) and add a migration or reset path.
- No service worker in Phase 1. No router library. No new runtime deps without a line in the PR explaining why.
- Conventional Commits.

## Commands

```
pnpm install
pnpm dev            # vite dev server
pnpm typecheck
pnpm lint
pnpm test           # node:test unit suite
pnpm test:e2e       # playwright (installs browsers on first run)
pnpm build          # vite build → dist/
```

## Testing expectations

- Unit: `test/unit/**` — core + schemas, `FakeRTCPeerConnection` for state-machine tests.
- E2E: `test/e2e/**` — two browser contexts P2P over loopback; camera bypassed by reading the QR element's `data-payload` and injecting into the other context. Keep that attribute. `scanner.spec.ts` is the exception: it feeds a generated QR clip to Chromium's fake camera so the real `<Scanner>` path is exercised. Tiles are addressed by `data-tile="<wsKey>"`; use the `tile(ws)` helper.
- Fixtures: `test/fixtures/sdp/` — real captured SDPs from Safari and Chrome. Add one when you see a new browser variant.
- Manual: `docs/lab-checklist.md` before any lab day.
- Media e2e (`media.spec.ts`) reads `window.__lab.mediaStats(ws)` / `window.__lab.activeTracks()` (dev-only). `media-renegotiation.spec.ts` runs in **both** engines and guards the SDP template against the media offer; a WebKit failure there is fixed in `buildSdp`, not in `MediaLink`.
- Media `failed` recovers only via the drawer's **Retry video** (`retryMedia`), never on a repeated `hello`: the teacher offers once per session, from `none` only. Tests that expect a re-offer must go through `retryMedia`.

## Deploy

Push to `main` → `pages.yml` builds and deploys. `VITE_BASE` is derived from `GITHUB_REPOSITORY`. `appVersion` = short git SHA, baked in at build and shown in UI. No staging environment; verify on `/dev/load` first.

## Roadmap

Phase 1 (this spec): DC connectivity, QR signaling, heartbeat, dashboard.
Phase 2 (media spec): student thumbnails + focus, teacher camera/screen broadcast, `media.*` over the DataChannel. Phase 3: collab (student screen share, whiteboard, chat). Phase 4: recording. Phase 5: analytics.
Optional at any point: `GitHubDeadDropTransport` for automatic re-pair.
