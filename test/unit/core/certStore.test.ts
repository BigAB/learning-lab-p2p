import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateCertificate, CERT_KEY } from "../../../src/core/certStore";
import type { AsyncKv } from "../../../src/core/ports";
import { MemoryAsyncKv } from "../helpers/memoryKv";

const fakeCert = (id: number) => ({ expires: Date.now() + 1e9, id }) as unknown as RTCCertificate;

test("generates once then reuses", async () => {
  const kv = new MemoryAsyncKv();
  let gen = 0;
  const generate = async () => fakeCert(++gen);
  const a = await getOrCreateCertificate(kv, generate);
  const b = await getOrCreateCertificate(kv, generate);
  assert.equal(gen, 1);
  assert.equal(a, b);
  assert.ok(await kv.get(CERT_KEY));
});

test("regenerates when stored cert is expired", async () => {
  const kv = new MemoryAsyncKv();
  await kv.set(CERT_KEY, { expires: Date.now() - 1000 });
  let gen = 0;
  await getOrCreateCertificate(kv, async () => fakeCert(++gen));
  assert.equal(gen, 1);
});

test("regenerates when store throws", async () => {
  const kv: AsyncKv = {
    get: async () => {
      throw new Error("idb down");
    },
    set: async () => {
      throw new Error("idb down");
    },
  };
  let gen = 0;
  const c = await getOrCreateCertificate(kv, async () => fakeCert(++gen));
  assert.equal(gen, 1);
  assert.ok(c);
});
