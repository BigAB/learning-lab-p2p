import { test } from "node:test";
import assert from "node:assert/strict";
import { SdpPayloadSchema, CompactPayloadSchema } from "../../../src/schemas/sdpPayload";

const base = {
  v: 2,
  role: "offer",
  ws: "7",
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
    v: 2,
    r: "o",
    w: "7",
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

test("rejects SDP-injection charsets in ip, ufrag, pwd and mid", () => {
  const bad = (patch: Record<string, unknown>) => SdpPayloadSchema.safeParse({ ...base, ...patch });
  assert.equal(
    bad({ cands: [{ ip: "192.168.1.42\r\na=evil:1", port: 1, proto: "udp" }] }).success,
    false,
  );
  assert.equal(bad({ cands: [{ ip: "abc.local", port: 1, proto: "udp" }] }).success, false);
  assert.equal(bad({ ufrag: "kJ3q\r\na=evil:1" }).success, false);
  assert.equal(bad({ pwd: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul\r\nx" }).success, false);
  assert.equal(bad({ mid: "0 evil" }).success, false);
  // The real-world charsets still pass.
  assert.equal(bad({ ufrag: "a+b/c-d_e=", pwd: "A".repeat(21) + "+/=-_" }).success, true);
});

test("compact form applies the same charset rules", () => {
  const c = {
    v: 2,
    r: "o",
    w: "7",
    m: "0",
    u: "kJ3q",
    p: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
    f: "A".repeat(43),
    s: "actpass",
    c: [["192.168.1.42", 54321]],
  };
  assert.equal(CompactPayloadSchema.safeParse({ ...c, c: [["10.0.0.1\r\nx", 1]] }).success, false);
  assert.equal(CompactPayloadSchema.safeParse({ ...c, u: "kJ3q\r\n" }).success, false);
  assert.equal(CompactPayloadSchema.safeParse({ ...c, m: "0;" }).success, false);
});

test("v2 payload: ws is a tidied string; numbers and off-charset IDs are rejected", () => {
  assert.equal(SdpPayloadSchema.parse({ ...base, ws: " Row  2 " }).ws, "Row 2");
  assert.equal(SdpPayloadSchema.safeParse({ ...base, ws: 7 }).success, false);
  assert.equal(SdpPayloadSchema.safeParse({ ...base, ws: "Row#2" }).success, false);
  assert.equal(SdpPayloadSchema.safeParse({ ...base, v: 1 }).success, false, "v1 is gone");
});
