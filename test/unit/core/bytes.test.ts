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
