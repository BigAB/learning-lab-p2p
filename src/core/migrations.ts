import {
  LEGACY_STUDENT_KEY,
  LEGACY_TEACHER_KEY,
  LegacyStudentStateSchema,
  LegacyTeacherStateSchema,
} from "../schemas/legacy";
import type { StudentState, TeacherState } from "../schemas/storage";
import { WsSchema, wsKey } from "../schemas/ws";
import type { KeyValueStore } from "./ports";

type Log = (msg: string) => void;

function readLegacy<T>(
  kv: KeyValueStore,
  key: string,
  parse: (json: unknown) => { success: true; data: T } | { success: false },
  log: Log,
): T | undefined {
  const raw = kv.get(key);
  if (raw === null) return undefined;
  try {
    const r = parse(JSON.parse(raw));
    if (r.success) return r.data;
    log(`${key}: v1 blob does not match the v1 schema, not migrating`);
  } catch {
    log(`${key}: v1 blob is not JSON, not migrating`);
  }
  return undefined;
}

/** v1 `{ ws: 7 }` → v2 `{ ws: "7" }`. Does not remove the v1 key; the caller does, always. */
export function migrateStudentV1(kv: KeyValueStore, log: Log): StudentState | undefined {
  const v1 = readLegacy(kv, LEGACY_STUDENT_KEY, (j) => LegacyStudentStateSchema.safeParse(j), log);
  if (!v1) return undefined;
  const { ws, ...rest } = v1;
  return { ...rest, ws: String(ws) };
}

/**
 * v1 `roster["7"] = {…}` → v2 `roster["7"] = { ws: "7", … }`; settings copied. A v1 key that is
 * no longer a legal workstation ID (e.g. too long) is skipped and logged rather than letting one
 * bad key poison the whole migrated blob.
 */
export function migrateTeacherV1(kv: KeyValueStore, log: Log): TeacherState | undefined {
  const v1 = readLegacy(kv, LEGACY_TEACHER_KEY, (j) => LegacyTeacherStateSchema.safeParse(j), log);
  if (!v1) return undefined;
  const roster: TeacherState["roster"] = {};
  for (const [k, entry] of Object.entries(v1.roster)) {
    if (!WsSchema.safeParse(k).success) {
      log(`${LEGACY_TEACHER_KEY}: skipping roster key "${k}" — not a legal workstation ID`);
      continue;
    }
    roster[wsKey(k)] = { ...entry, ws: k };
  }
  return { roster, settings: v1.settings };
}
