import { z } from "zod";
import { WsSchema } from "./ws";

/** Safari's DataChannel message limit. Larger messages are chunked. */
export const MAX_FRAME_BYTES = 16384;

export const HelloSchema = z.object({
  t: z.literal("hello"),
  role: z.enum(["student", "teacher"]),
  ws: WsSchema,
  appVersion: z.string().min(1).max(64),
  ua: z.string().max(512),
});
export const HbSchema = z.object({
  t: z.literal("hb"),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
});
export const HbAckSchema = z.object({
  t: z.literal("hb-ack"),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
});
export const StatusSchema = z.object({
  t: z.literal("status"),
  battery: z.number().min(0).max(1).optional(),
  charging: z.boolean().optional(),
  visibility: z.enum(["visible", "hidden"]),
  wakeLock: z.boolean(),
});
export const CmdSchema = z.object({
  t: z.literal("cmd"),
  cmd: z.enum(["reload", "show-id", "ping"]),
});
export const ChunkSchema = z.object({
  t: z.literal("chunk"),
  id: z.string().min(1).max(32),
  i: z.number().int().nonnegative(),
  n: z.number().int().min(1),
  data: z.string(),
});

export const LabMessageSchema = z.discriminatedUnion("t", [
  HelloSchema,
  HbSchema,
  HbAckSchema,
  StatusSchema,
  CmdSchema,
  ChunkSchema,
]);

export type HelloMessage = z.infer<typeof HelloSchema>;
export type HbMessage = z.infer<typeof HbSchema>;
export type HbAckMessage = z.infer<typeof HbAckSchema>;
export type StatusMessage = z.infer<typeof StatusSchema>;
export type CmdMessage = z.infer<typeof CmdSchema>;
export type ChunkMessage = z.infer<typeof ChunkSchema>;
export type LabMessage = z.infer<typeof LabMessageSchema>;

/** Reserved namespaces. Empty until their phase's spec exists. Do not squat. */
export type MediaMessage = never; // Phase 2: media.offer / media.answer / media.request
export type CollabMessage = never; // Phase 3
export type RecMessage = never; // Phase 4
export type LogMessage = never; // Phase 5
