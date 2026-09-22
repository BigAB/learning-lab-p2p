import { z } from "zod";
import { WsSchema } from "./ws";
import {
  MediaAnswerSchema,
  MediaBroadcastSchema,
  MediaOfferSchema,
  MediaRequestSchema,
  MediaStatusSchema,
} from "./media";

/** Safari's DataChannel message limit. Larger messages are chunked. */
export const MAX_FRAME_BYTES = 16384;

export const HelloSchema = z.object({
  t: z.literal("hello"),
  role: z.enum(["student", "teacher"]),
  ws: WsSchema,
  appVersion: z.string().min(1).max(64),
  ua: z.string().max(512),
  /** Optional feature flags; a Phase 2 build sends ["media"]. Strings, not an enum, so newer peers parse. */
  caps: z.array(z.string().min(1).max(16)).max(8).optional(),
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
  MediaOfferSchema,
  MediaAnswerSchema,
  MediaRequestSchema,
  MediaStatusSchema,
  MediaBroadcastSchema,
]);

export type HelloMessage = z.infer<typeof HelloSchema>;
export type HbMessage = z.infer<typeof HbSchema>;
export type HbAckMessage = z.infer<typeof HbAckSchema>;
export type StatusMessage = z.infer<typeof StatusSchema>;
export type CmdMessage = z.infer<typeof CmdSchema>;
export type ChunkMessage = z.infer<typeof ChunkSchema>;
export type LabMessage = z.infer<typeof LabMessageSchema>;

/** Phase 2 media messages live in ./media. The remaining namespaces stay empty until their phase. */
export type { MediaMessage } from "./media";
export type CollabMessage = never; // Phase 3
export type RecMessage = never; // Phase 4
export type LogMessage = never; // Phase 5
