import type { z } from "zod";
import type { KeyValueStore } from "./ports";

export function loadState<S extends z.ZodTypeAny>(
  kv: KeyValueStore,
  key: string,
  schema: S,
  fallback: z.infer<S>,
  log: (msg: string) => void = () => {},
): z.infer<S> {
  const raw = kv.get(key);
  if (raw === null) return fallback;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    if (r.success) return r.data as z.infer<S>;
    log(`${key}: schema invalid, resetting (${r.error.issues[0]?.message ?? "?"})`);
  } catch (e) {
    log(`${key}: corrupt JSON, resetting (${(e as Error).message})`);
  }
  kv.set(key, JSON.stringify(fallback));
  return fallback;
}

export function saveState<S extends z.ZodTypeAny>(
  kv: KeyValueStore,
  key: string,
  schema: S,
  value: z.infer<S>,
): void {
  kv.set(key, JSON.stringify(schema.parse(value)));
}
