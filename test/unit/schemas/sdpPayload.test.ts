import { test } from "node:test";
import assert from "node:assert/strict";
import { SdpPayloadSchema, CompactPayloadSchema } from "../../../src/schemas/sdpPayload";

const base = {
  v: 1,
  role: "offer",
  ws: 7,
  mid: "0",
  ufrag: "kJ3q",
  pwd: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
  fp: new Uint8Array(32),
  setup: "actpass",
  cands: [{ ip: "192.168.1.42", port: 54321, proto: "udp" }],
};

test("accepts a valid payload", () => {
  assert.equal(SdpPayloadSchema.safeParse(base).success, true);
});

test("rejects wrong fingerprint length and empty candidates", () => {
  assert.equal(SdpPayloadSchema.safeParse({ ...base, fp: new Uint8Array(20) }).success, false);
  assert.equal(SdpPayloadSchema.safeParse({ ...base, cands: [] }).success, false);
});

test("compact form requires 43-char base64url fingerprint", () => {
  const c = {
    v: 1,
    r: "o",
    w: 7,
    m: "0",
    u: "kJ3q",
    p: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
    f: "A".repeat(43),
    s: "actpass",
    c: [["192.168.1.42", 54321]],
  };
  assert.equal(CompactPayloadSchema.safeParse(c).success, true);
  assert.equal(CompactPayloadSchema.safeParse({ ...c, f: "A".repeat(42) }).success, false);
  assert.equal(CompactPayloadSchema.safeParse({ ...c, f: "!".repeat(43) }).success, false);
});
