import { z } from "zod";
import { SettingsSchema } from "./storage";

/**
 * Phase 1 (v1) persisted shapes, kept only so a v2 boot can migrate them once. Nothing but
 * src/core/migrations.ts may import the schemas; controllers import the keys to remove them.
 */
export const LEGACY_STUDENT_KEY = "lab.student.v1";
export const LEGACY_TEACHER_KEY = "lab.teacher.v1";

export const LegacyStudentStateSchema = z.object({
  ws: z.number().int().min(1).max(30),
  teacherAppVersion: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  pairCount: z.number().int().nonnegative().default(0),
});

export const LegacyRosterEntrySchema = z.object({
  label: z.string().max(64).optional(),
  lastConnectedAt: z.number().optional(),
  lastSeenAt: z.number().optional(),
  lastRtt: z.number().optional(),
  lastSeenUa: z.string().max(512).optional(),
  lastFingerprint: z.string().max(128).optional(),
  pairCount: z.number().int().nonnegative().default(0),
});

export const LegacyTeacherStateSchema = z.object({
  roster: z.record(z.string(), LegacyRosterEntrySchema).default({}),
  settings: SettingsSchema.default({}),
});
