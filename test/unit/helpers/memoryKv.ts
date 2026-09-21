import type { AsyncKv, KeyValueStore } from "../../../src/core/ports";

export class MemoryKv implements KeyValueStore {
  private m = new Map<string, string>();
  get(key: string): string | null {
    return this.m.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.m.set(key, value);
  }
  remove(key: string): void {
    this.m.delete(key);
  }
}

export class MemoryAsyncKv implements AsyncKv {
  private m = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.m.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.m.set(key, value);
  }
}
