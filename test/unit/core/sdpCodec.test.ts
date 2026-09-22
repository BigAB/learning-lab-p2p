import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractPayload,
  buildSdp,
  encodeWire,
  decodeWire,
  CodecError,
  WIRE_PREFIX,
} from "../../../src/core/sdpCodec";
import { deflateRaw, toBase64Url, crc8 } from "../../../src/core/bytes";

const chromeOffer = readFileSync(
  new URL("../../fixtures/sdp/chrome-offer.sdp", import.meta.url),
  "utf8",
);
const safariAnswer = readFileSync(
  new URL("../../fixtures/sdp/safari-answer.sdp", import.meta.url),
  "utf8",
);

test("extracts ice/dtls and host candidates, dropping link-local and duplicates", () => {
  const p = extractPayload(chromeOffer, "offer", "7");
  assert.equal(p.role, "offer");
  assert.equal(p.ws, "7");
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
  const p = extractPayload(safariAnswer, "answer", "7");
  assert.equal(p.setup, "active");
  assert.deepEqual(p.cands, [{ ip: "10.0.0.15", port: 61234, proto: "udp" }]);
});

test("buildSdp emits a single application m-section with all attributes", () => {
  const sdp = buildSdp(extractPayload(chromeOffer, "offer", "7"));
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
  const p1 = extractPayload(chromeOffer, "offer", "7");
  const p2 = extractPayload(buildSdp(p1), "offer", "7");
  assert.deepEqual({ ...p2, fp: [...p2.fp] }, { ...p1, fp: [...p1.fp] });
});

test("wire roundtrip, prefix, size budget", async () => {
  const p = extractPayload(chromeOffer, "offer", "7");
  const wire = await encodeWire(p);
  assert.ok(wire.startsWith(WIRE_PREFIX));
  assert.ok(wire.length < 260, `wire too long: ${wire.length}`);
  const back = await decodeWire(wire);
  assert.deepEqual({ ...back, fp: [...back.fp] }, { ...p, fp: [...p.fp] });
});

test("decodeWire rejects bad prefix, bad crc, garbage", async () => {
  const wire = await encodeWire(extractPayload(chromeOffer, "offer", "7"));
  await assert.rejects(decodeWire("NOPE:" + wire.slice(5)), CodecError);
  const flipped = wire.slice(0, -2) + (wire.endsWith("00") ? "01" : "00");
  await assert.rejects(decodeWire(flipped), CodecError);
  await assert.rejects(decodeWire(WIRE_PREFIX + "!!"), CodecError);
});

test("extractPayload throws on missing attributes", () => {
  assert.throws(() =>
    extractPayload("v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n", "offer", "1"),
  );
});

test("extractPayload throws CodecError when only candidate is link-local", () => {
  const sdp = [
    "v=0",
    "o=- 1 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    "a=candidate:1 1 udp 2122260223 169.254.10.5 54321 typ host",
    "a=ice-ufrag:kJ3q",
    "a=ice-pwd:Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
    "a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08",
    "a=setup:actpass",
    "a=mid:0",
  ].join("\r\n");
  assert.throws(() => extractPayload(sdp, "offer", "7"), CodecError);
});

test("decodeWire rejects a non-base64url compact fingerprint without leaking a raw error", async () => {
  const compact = {
    v: 2,
    r: "o",
    w: "7",
    m: "0",
    u: "kJ3q",
    p: "Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
    f: "!".repeat(43),
    s: "actpass",
    c: [["192.168.1.42", 54321]],
  };
  const packed = await deflateRaw(new TextEncoder().encode(JSON.stringify(compact)));
  const wire = `${WIRE_PREFIX}${toBase64Url(packed)}${crc8(packed).toString(16).padStart(2, "0")}`;
  await assert.rejects(decodeWire(wire), CodecError);
});

/** Build a minimal DataChannel SDP with exactly the given `a=candidate:` address/port pairs. */
function sdpWith(cands: [string, number][]): string {
  return [
    "v=0",
    "o=- 1 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...cands.map(([ip, port], i) => `a=candidate:${i + 1} 1 udp 2122260223 ${ip} ${port} typ host`),
    "a=ice-ufrag:kJ3q",
    "a=ice-pwd:Yl6wO9zZ0z3XZ7RlN4CkO0Ul",
    "a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08",
    "a=setup:actpass",
    "a=mid:0",
  ].join("\r\n");
}

test("mDNS-only SDP is refused with the camera-permission message", () => {
  const sdp = sdpWith([["8f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8.local", 54321]]);
  assert.throws(() => extractPayload(sdp, "offer", "7"), {
    name: "CodecError",
    message: /only mDNS candidates found — camera permission missing/,
  });
});

test("mDNS candidates are skipped when a literal IP is also offered", () => {
  const sdp = sdpWith([
    ["8f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8.local", 54321],
    ["192.168.1.42", 54322],
  ]);
  assert.deepEqual(extractPayload(sdp, "offer", "7").cands, [
    { ip: "192.168.1.42", port: 54322, proto: "udp" },
  ]);
});

test("link-local-only SDP names link-local, never blames camera permission", () => {
  const sdp = sdpWith([
    ["169.254.10.5", 54321],
    ["fe80::1", 54322],
  ]);
  assert.throws(
    () => extractPayload(sdp, "offer", "7"),
    (e: unknown) => {
      assert.ok(e instanceof CodecError);
      assert.match(e.message, /link-local/);
      assert.doesNotMatch(e.message, /mDNS|camera/);
      return true;
    },
  );
});

test("SDP with no host candidates at all says so", () => {
  assert.throws(
    () => extractPayload(sdpWith([]), "offer", "7"),
    (e: unknown) => {
      assert.ok(e instanceof CodecError);
      assert.match(e.message, /no host candidates/);
      assert.doesNotMatch(e.message, /mDNS|camera|link-local/);
      return true;
    },
  );
});

test("mDNS plus link-local and nothing else still points at camera permission", () => {
  const sdp = sdpWith([
    ["8f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8.local", 54321],
    ["169.254.10.5", 54322],
  ]);
  assert.throws(() => extractPayload(sdp, "offer", "7"), {
    name: "CodecError",
    message: /only mDNS candidates found — camera permission missing/,
  });
});

test("a LAB1 code is refused with a version message, not a schema error", async () => {
  await assert.rejects(decodeWire("LAB1:abcd00"), {
    name: "CodecError",
    message: /this is a LAB1 code — the other device is running an older version/,
  });
  await assert.rejects(decodeWire("NOPE:abcd00"), {
    name: "CodecError",
    message: /not a LAB2 payload/,
  });
});

test("a 24-character ID survives the roundtrip and stays inside the QR budget", async () => {
  const id = "Back Row Left Seat 12345"; // exactly 24 characters
  assert.equal(id.length, 24);
  const wire = await encodeWire(extractPayload(chromeOffer, "offer", id));
  assert.ok(wire.startsWith("LAB2:"));
  assert.ok(wire.length < 300, `wire too long: ${wire.length}`);
  assert.equal((await decodeWire(wire)).ws, id);
});
