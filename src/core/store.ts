import type { z } from "zod";
import type { KeyValueStore } from "./ports";

/**
 * Read a persisted blob with defaults. `migrate` runs only when `key` is absent: it may produce a
 * value from an older key; that value is validated and saved under `key` like any other write.
 */
export function loadState<S extends z.ZodTypeAny>(
  kv: KeyValueStore,
  key: string,
  schema: S,
  fallback: z.infer<S>,
  log: (msg: string) => void = () => {},
  migrate?: () => z.infer<S> | undefined,
): z.infer<S> {
  const raw = kv.get(key);
  if (raw === null) {
    const migrated = migrate?.();
    if (migrated === undefined) return fallback;
    const r = schema.safeParse(migrated);
    if (r.success) {
      kv.set(key, JSON.stringify(r.data));
      return r.data as z.infer<S>;
    }
    log(`${key}: migrated value invalid, using defaults (${r.error.issues[0]?.message ?? "?"})`);
    return fallback;
  }
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
