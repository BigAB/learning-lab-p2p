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

test("chunkMessage handles JSON-escaped unicode safely (\\uXXXX expansion)", () => {
  const original = JSON.stringify({
    t: "hello",
    role: "student",
    ws: 1,
    appVersion: "x",
    ua: "\u0001".repeat(20000),
  });
  const frames = chunkMessage(original, MAX_FRAME_BYTES);
  const r = new Reassembler();
  let out: string | undefined;
  for (const f of frames) {
    const frameBytes = new TextEncoder().encode(f).length;
    assert.ok(
      frameBytes <= MAX_FRAME_BYTES,
      `Frame exceeded max bytes: ${frameBytes} > ${MAX_FRAME_BYTES}`,
    );
    const c = ChunkSchema.parse(JSON.parse(f));
    out = r.push(c);
  }
  assert.equal(out, original);
});

test("Reassembler evicts oldest id when exceeding maxPending", () => {
  const r = new Reassembler(2);
  // Push chunk 0 of ids "a", "b", "c" (each n=2)
  r.push({ t: "chunk", id: "a", i: 0, n: 2, data: "a0" });
  r.push({ t: "chunk", id: "b", i: 0, n: 2, data: "b0" });
  // This evicts "a"
  r.push({ t: "chunk", id: "c", i: 0, n: 2, data: "c0" });
  // Push chunk 1 of "a" - returns undefined because "a" was evicted
  const aResult = r.push({ t: "chunk", id: "a", i: 1, n: 2, data: "a1" });
  assert.equal(aResult, undefined);
  // Push chunks 0 and 1 of "c" - completes normally
  const cResult = r.push({ t: "chunk", id: "c", i: 1, n: 2, data: "c1" });
  assert.equal(cResult, "c0c1");
});
