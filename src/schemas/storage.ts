import { z } from "zod";
import { WsSchema, wsKey } from "./ws";

export const STUDENT_KEY = "lab.student.v2";
export const TEACHER_KEY = "lab.teacher.v2";

export const StudentStateSchema = z.object({
  ws: WsSchema,
  teacherAppVersion: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  pairCount: z.number().int().nonnegative().default(0),
});
export type StudentState = z.infer<typeof StudentStateSchema>;

export const RosterEntrySchema = z.object({
  /** Display form: the ID as the student most recently typed it. The record key is wsKey(ws). */
  ws: WsSchema,
  label: z.string().max(64).optional(),
  lastConnectedAt: z.number().optional(),
  /** Last inbound frame from this station (heartbeat or otherwise); coarse, see LabController. */
  lastSeenAt: z.number().optional(),
  lastRtt: z.number().optional(),
  lastSeenUa: z.string().max(512).optional(),
  lastFingerprint: z.string().max(128).optional(),
  pairCount: z.number().int().nonnegative().default(0),
});
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

export const SettingsSchema = z.object({
  heartbeatMs: z.number().int().min(200).default(5000),
  degradedMs: z.number().int().min(500).default(15000),
  failedMs: z.number().int().min(1000).default(60000),
  cameraDeviceId: z.string().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A roster whose key ≠ wsKey(entry.ws) is corrupt: the read path resets it like any bad blob. */
const RosterSchema = z.record(z.string(), RosterEntrySchema).superRefine((roster, ctx) => {
  for (const [key, entry] of Object.entries(roster)) {
    if (key !== wsKey(entry.ws)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `roster key "${key}" does not match ws "${entry.ws}"`,
        path: [key],
      });
    }
  }
});

export const TeacherStateSchema = z.object({
  roster: RosterSchema.default({}),
  settings: SettingsSchema.default({}),
});
export type TeacherState = z.infer<typeof TeacherStateSchema>;
