import { z } from "zod";
import { WsSchema } from "./ws";

export const STUDENT_KEY = "lab.student.v1";
export const TEACHER_KEY = "lab.teacher.v1";

export const StudentStateSchema = z.object({
  ws: WsSchema,
  teacherAppVersion: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  pairCount: z.number().int().nonnegative().default(0),
});
export type StudentState = z.infer<typeof StudentStateSchema>;

export const RosterEntrySchema = z.object({
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

export const TeacherStateSchema = z.object({
  roster: z.record(z.string(), RosterEntrySchema).default({}),
  settings: SettingsSchema.default({}),
});
export type TeacherState = z.infer<typeof TeacherStateSchema>;
