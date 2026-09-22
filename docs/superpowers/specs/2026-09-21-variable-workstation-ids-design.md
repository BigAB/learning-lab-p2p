# Learning Lab P2P — Variable Workstation IDs

**Status:** approved design, pre-implementation
**Date:** 2026-09-21
**Amends:** [2026-09-20-p2p-core-design.md](2026-09-20-p2p-core-design.md) (Phase 1). Where the two disagree, this document wins. Phase 1 text that still holds is not repeated here.
**Scope:** replace the fixed `ws ∈ 1..30` workstation number with a teacher-managed, student-typed string ID; make the roster dynamic (grows as stations pair, shrinks when the teacher removes one); make a repeated ID take over the earlier one.

---

## 1. Why

- A lab is not always 30 seats, and a fixed grid of 30 red tiles hides the ones that matter.
- Numbers on a button grid were a stop-gap for the Home Screen launch problem. Teachers already name seats ("Row 2 seat 3"); let the iPad carry that name.
- **Reload-to-fix.** If an iPad's connection is wedged, the student reloads and pairs again under the same ID. The new session must simply replace the old one; it must never create a duplicate, wait for a timeout, or ask the teacher to clean up first. Keeping IDs unique in a room is the teacher's job, not the software's.

Everything not mentioned here (labels, the big on-screen ID, heartbeat, fingerprint continuity, re-pair queue, courier flow, dev-only surfaces) stays as in Phase 1.

## 2. Identity

### 2.1 Legal ID
`WsSchema` in `src/schemas/ws.ts` becomes a string schema:

| Rule | Value |
|---|---|
| Length | 1–24 characters **after** normalisation |
| Charset | `A–Z a–z 0–9`, space, `-`, `_` |
| Normalisation (Zod `transform`) | trim; collapse internal runs of whitespace to one space |
| Rejected | anything else, including an all-whitespace string |

The value that comes out of the schema is the **display form**: what the student typed, tidied. It is what the status bar, the tile, the drawer, the courier and the re-pair queue show.

### 2.2 Same station
```ts
export const wsKey = (ws: string) => ws.toLowerCase();
```
Two IDs name the same station iff their keys are equal. `Row2`, `row2` and `ROW2` are one station. Every map in core is keyed by `wsKey`; every string a human sees is a display form. When a station pairs again under a differently-cased spelling, the display form updates to the latest spelling.

### 2.3 Ordering
Wherever stations are listed (grid, re-pair queue, `snapshot()`), they are sorted by key with `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`: `1, 2, 10, Row 2, Row 10`. Insertion order is never exposed.

### 2.4 Naming
The field keeps its Phase 1 name `ws` everywhere (payload, protocol, storage, controller, hooks, UI, tests). Its TS type becomes `string`. A rename to `stationId` is a possible later mechanical change, out of scope here.

## 3. Wire

### 3.1 QR payload
`SdpPayload.ws` and the compact `w` become strings validated by `WsSchema`; the compact schema applies the same regex and length. Payload `v` becomes `2`. Wire prefix becomes **`LAB2:`**.

`decodeWire`:
- `LAB2:` → as today.
- `LAB1:` → `CodecError("this is a LAB1 code — the other device is running an older version")`. Surfaces as the normal red flash / toast / inline error.
- anything else → `CodecError("not a LAB2 payload")`.

The rest of the codec (template, CRC, deflate, candidate rules, charset validation) is untouched. `ws` never appears in the rebuilt SDP.

Size: a 24-character ID adds ≤ 24 bytes before deflate; the e2e roundtrip budget (< 300 chars) stands and is asserted with a 24-character ID.

### 3.2 DataChannel
`hello.ws` becomes a string. The student's "this code is for workstation X, not Y" guard compares `wsKey`. No other message changes. Reserved namespaces untouched.

## 4. Storage

### 4.1 Shapes
```ts
// localStorage["lab.student.v2"]
{ ws: string; teacherAppVersion?: string; lastConnectedAt?: number; pairCount: number }

// localStorage["lab.teacher.v2"]
{
  roster: Record<wsKey, { ws: string;            // display form, latest spelling
                          label?: string; lastConnectedAt?: number; lastSeenAt?: number; lastRtt?: number;
                          lastSeenUa?: string; lastFingerprint?: string; pairCount: number }>;
  settings: { heartbeatMs; degradedMs; failedMs; cameraDeviceId? };   // unchanged
}
```
A Zod `superRefine` on the roster rejects an entry whose key ≠ `wsKey(entry.ws)`; the read path then treats the blob as corrupt (defaults), as for any other schema failure.

### 4.2 Migration v1 → v2
`loadState(kv, key, schema, defaults, log, migrate?)` gains an optional `migrate` hook. Both boots call it with:

| From | To |
|---|---|
| `lab.student.v1` `{ ws: 7, … }` | `lab.student.v2` `{ ws: "7", … }` |
| `lab.teacher.v1` `roster["7"] = { … }` | `lab.teacher.v2` `roster["7"] = { ws: "7", … }`; settings copied |

Rules: v2 present → v1 ignored and removed. v2 absent, v1 parses → migrate, save v2, remove v1. v1 unparseable → log, defaults, remove v1. The v1 schemas live in `src/schemas/legacy.ts` and are imported only by the migration; nothing else may reference them.

## 5. LabController

- `sessions`, `live` and `state.roster` are keyed by `wsKey`. `ALL_WS`, `WS_MIN`, `WS_MAX` are deleted.
- **`acceptOffer(offer)`**: `key = wsKey(offer.ws)`. If a session for `key` exists **and** is `connected` or `degraded`, the new `Live` gets `replaced = true` (history carried over as today). The old session is closed silently (no `needsRepair`), exactly as a same-ws re-scan does now. The roster entry is created if missing and its `ws` set to `offer.ws`. Fingerprint comparison and the deferred `lastFingerprint` write are unchanged: a different iPad taking over a live ID shows both `↺ replaced` and "⚠️ different device".
- **`remove(ws): boolean`**: closes any session for the key, deletes the roster entry and live state, persists, emits `change`. `false` if the key is unknown. Removing a station whose iPad is still running is fine: its next scanned offer creates a fresh entry.
- **`acknowledgeReplaced(ws)`**: clears `replaced`; the drawer calls it on open.
- **`snapshot()`**: one `RosterView` per roster entry, ordered per §2.3. New fields: `key: string`, `replaced: boolean`. `state: "never"` still means "known, no session this run".
- **`repairQueue()`**: roster entries whose session is absent or `failed`, same order, returning display forms. A teacher cold start therefore lists every station from the previous day, preserving the "re-pair all" route.
- **`counts()`**: unchanged shape; `never` now counts roster entries with no session, so the red header number is `failed + never` as today.
- **`sendCmd`, `setLabel`, `updateSettings`**: unchanged apart from key lookup.

## 6. StudentController
- `ws` is a string display form; persisted as such. `persistedWs` returns it.
- No takeover logic on the student: the teacher decides. Reload → new offer under the same ID → teacher replaces.

## 7. UI

### 7.1 Student
- `WsPicker` is replaced by **`WsEntry`**: a text field (`autocapitalize="off" autocorrect="off" spellcheck={false} maxLength={24} inputMode="text"`), the first Zod issue rendered inline as the user types, and a **Connect** button disabled until valid. Shown when no `?ws=` and nothing saved (the Home Screen first-launch case) and for the invalid-`?ws=` notice.
- The big ID in the status bar becomes a button with a small "change" affordance. Tapping it opens `WsEntry` prefilled with the current ID. Confirming with a different key: `controller.stop()`, persist, boot a new controller (`bootStudent` cache keyed by `wsKey`), new offer QR. Confirming with the same key just closes the entry. Cancel is available.
- URL/stored conflict prompt (`WsConflict`) compares keys and shows display forms; unchanged otherwise.

### 7.2 Teacher
- Grid: `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`; tiles in §2.3 order; `data-tile` carries the **key**. Empty roster → centred hint "No workstations yet — Scan a student's code."
- Tile: shows display ID; a `↺ replaced` badge (`data-replaced`) while `replaced` is set.
- Drawer: on open calls `acknowledgeReplaced`. New **Remove workstation** button (secondary style) behind `confirm("Remove <ws>? Its tile and label are deleted; the iPad can pair again as a new station.")`. Closes the drawer on success.
- Re-pair queue and header counts: unchanged apart from strings.

### 7.3 Courier
Unchanged; already renders `ws` as text.

### 7.4 `/dev/load`
Iframes boot with IDs `"1".."N"`; the autopair bridge compares keys. CI still runs 5.

## 8. Testing
Unit (`node:test`):
- `ws.ts`: valid/invalid table (length, charset, whitespace-only), normalisation, `wsKey` equality, collator order.
- codec: v2 roundtrip with a 24-char ID; `LAB1:` and unknown prefixes rejected with their messages; compact schema rejects a bad `w`.
- storage: v2 schemas; `superRefine` key/ws mismatch → corrupt; migration table above incl. unparseable v1 and "v2 wins".
- LabController: dynamic snapshot and order; `acceptOffer` sets `replaced` only when the old session was `connected`/`degraded` (not for `failed`/absent); `remove` (known/unknown, with live session); `acknowledgeReplaced`; `repairQueue` from roster; existing fingerprint/lastSeen tests ported to string IDs.
- StudentController: string `ws` persisted and exposed.
- PeerSession: `hello` with string `ws`; mismatched-key answer rejected.

E2E (Playwright, Chromium; codec spec also WebKit):
- Pairing specs use IDs such as `Row 2`.
- Takeover: two student contexts, `Row2` then `row2` → first goes `failed`, one tile, `data-replaced` visible, open drawer → badge gone.
- Remove: drawer → Remove → tile gone, count updated; re-pair the same iPad → tile back with `pairCount` 1.
- Student typo fix: tap status-bar ID, enter new ID, new offer QR for the new ID, saved across reload.
- Migration: seed `lab.teacher.v1`/`lab.student.v1` in `addInitScript`, assert v2 written, v1 gone, label preserved.
- Homescreen, scanner, drawer, load specs adjusted for string IDs.

Fixtures: `test/fixtures/sdp/*` unchanged.

## 9. Phase 2 note
Media layout must handle N tiles, N unknown until runtime. `useLabRoster()` already returns the list; Phase 2 designs against `tiles.length`, never a constant.

## 10. Out of scope
Renaming `ws` → `stationId`; teacher-side rename of a station; bulk "forget all"; confirming takeovers; courier batching.
