import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMessage, Reassembler } from "../../../src/core/chunker";
import { ChunkSchema, MAX_FRAME_BYTES } from "../../../src/schemas/protocol";

test("small message passes through untouched", () => {
  const json = JSON.stringify({ t: "hb", seq: 1, ts: 2 });
  assert.deepEqual(chunkMessage(json, MAX_FRAME_BYTES), [json]);
});

test("large message is split into valid chunk frames under the limit and reassembles", () => {
  const big = JSON.stringify({
    t: "hello",
    role: "student",
    ws: 1,
    appVersion: "x",
    ua: "é".repeat(40000),
  });
  const frames = chunkMessage(big, MAX_FRAME_BYTES);
  assert.ok(frames.length > 1);
  const r = new Reassembler();
  let out: string | undefined;
  for (const f of frames) {
    assert.ok(new TextEncoder().encode(f).length <= MAX_FRAME_BYTES);
    const c = ChunkSchema.parse(JSON.parse(f));
    out = r.push(c);
  }
  assert.equal(out, big);
});

test("out-of-order and interleaved ids reassemble independently", () => {
  const a = "A".repeat(40000);
  const b = "B".repeat(40000);
  const fa = chunkMessage(a, MAX_FRAME_BYTES).map((f) => ChunkSchema.parse(JSON.parse(f)));
  const fb = chunkMessage(b, MAX_FRAME_BYTES).map((f) => ChunkSchema.parse(JSON.parse(f)));
  const r = new Reassembler();
  const results: string[] = [];
  for (const c of [fa[1]!, fb[0]!, fa[0]!, ...fa.slice(2), ...fb.slice(1)]) {
    const out = r.push(c);
    if (out !== undefined) results.push(out);
  }
  assert.deepEqual(results, [a, b]);
});
