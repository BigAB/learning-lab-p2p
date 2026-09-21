import type { AsyncKv } from "../../core/ports";
const DB = "lab",
  STORE = "kv";
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const r = fn(db.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
  );
}
export const idbKv: AsyncKv = {
  get: (key) => tx("readonly", (s) => s.get(key) as IDBRequest<unknown>),
  set: (key, value) => tx("readwrite", (s) => s.put(value, key)).then(() => undefined),
};
