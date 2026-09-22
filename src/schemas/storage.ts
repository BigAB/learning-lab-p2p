import { z } from "zod";
import { WsSchema, wsKey } from "./ws";
import { ProfileSchema } from "./media";

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

export const MediaSettingsSchema = z.object({
  cameras: z.boolean().default(false),
  codec: z.enum(["h264", "vp8", "auto"]).default("h264"),
  thumb: ProfileSchema.default({ height: 180, fps: 10, kbps: 150 }),
  focus: ProfileSchema.default({ height: 720, fps: 15, kbps: 1200 }),
  broadcastCamera: ProfileSchema.default({ height: 360, fps: 15, kbps: 600 }),
  broadcastScreen: ProfileSchema.default({ height: 720, fps: 5, kbps: 1000 }),
});
export type MediaSettings = z.infer<typeof MediaSettingsSchema>;

export const SettingsSchema = z.object({
  heartbeatMs: z.number().int().min(200).default(5000),
  degradedMs: z.number().int().min(500).default(15000),
  failedMs: z.number().int().min(1000).default(60000),
  cameraDeviceId: z.string().optional(),
  /** Additive with defaults, so the v2 key stands (spec §8). */
  media: MediaSettingsSchema.default({}),
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
