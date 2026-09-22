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
  assert.equal(
    MediaStatusSchema.safeParse({ t: "media.request", cam: "on", send: null }).success,
    false,
  );
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
