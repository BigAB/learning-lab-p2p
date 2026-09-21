import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadState, saveState } from "../../../src/core/store";
import { MemoryKv } from "../helpers/memoryKv";

const S = z.object({ n: z.number().default(1), s: z.string().optional() });
const fallback = S.parse({});

test("missing key returns fallback without writing", () => {
  const kv = new MemoryKv();
  assert.deepEqual(loadState(kv, "k", S, fallback), { n: 1 });
  assert.equal(kv.get("k"), null);
});

test("valid blob parses with defaults applied", () => {
  const kv = new MemoryKv();
  kv.set("k", JSON.stringify({ s: "x" }));
  assert.deepEqual(loadState(kv, "k", S, fallback), { n: 1, s: "x" });
});

test("corrupt JSON resets to fallback and logs", () => {
  const kv = new MemoryKv();
  kv.set("k", "{not json");
  const logs: string[] = [];
  assert.deepEqual(
    loadState(kv, "k", S, fallback, (m) => logs.push(m)),
    { n: 1 },
  );
  assert.equal(kv.get("k"), JSON.stringify(fallback));
  assert.equal(logs.length, 1);
});

test("schema-invalid blob resets to fallback", () => {
  const kv = new MemoryKv();
  kv.set("k", JSON.stringify({ n: "nope" }));
  assert.deepEqual(loadState(kv, "k", S, fallback), { n: 1 });
});

test("saveState validates before writing", () => {
  const kv = new MemoryKv();
  saveState(kv, "k", S, { n: 5 });
  assert.equal(kv.get("k"), JSON.stringify({ n: 5 }));
  assert.throws(() => saveState(kv, "k", S, { n: "bad" } as unknown as z.infer<typeof S>));
});
