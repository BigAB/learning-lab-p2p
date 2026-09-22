import { z } from "zod";

/** Capability advertised in `hello.caps` by a build that speaks the media.* namespace. */
export const MEDIA_CAP = "media";
/** A full Chrome SDP with every codec listed is 4–8 KB; 64 KB is a generous ceiling. */
export const MAX_SDP_BYTES = 65536;

/** Target encode height; the capture stays at 720 and the sender scales down (spec §3.5). */
export const ProfileSchema = z.object({
  height: z.union([z.literal(180), z.literal(360), z.literal(720)]),
  fps: z.number().int().min(1).max(30),
  kbps: z.number().int().min(50).max(4000),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MediaSourceSchema = z.enum(["camera", "screen"]);
export type MediaSource = z.infer<typeof MediaSourceSchema>;

export const CamStateSchema = z.enum(["off", "on", "error"]);
export type CamState = z.infer<typeof CamStateSchema>;

const SdpSchema = z.string().min(1).max(MAX_SDP_BYTES);

export const MediaOfferSchema = z.object({
  t: z.literal("media.offer"),
  seq: z.number().int().min(1),
  sdp: SdpSchema,
});
export const MediaAnswerSchema = z.object({
  t: z.literal("media.answer"),
  seq: z.number().int().min(1),
  sdp: SdpSchema,
});
/** Teacher → student: what to send. Idempotent; the latest wins. */
export const MediaRequestSchema = z.object({
  t: z.literal("media.request"),
  send: ProfileSchema.nullable(),
});
/** Student → teacher: what is actually being sent, after every applied request. */
export const MediaStatusSchema = z.object({
  t: z.literal("media.status"),
  cam: CamStateSchema,
  reason: z.string().max(200).optional(),
  send: ProfileSchema.nullable(),
});
/** Teacher → student: whether to show the teacher's video, and what it is. */
export const MediaBroadcastSchema = z.object({
  t: z.literal("media.broadcast"),
  on: z.boolean(),
  source: MediaSourceSchema.optional(),
});

export type MediaOfferMessage = z.infer<typeof MediaOfferSchema>;
export type MediaAnswerMessage = z.infer<typeof MediaAnswerSchema>;
export type MediaRequestMessage = z.infer<typeof MediaRequestSchema>;
export type MediaStatusMessage = z.infer<typeof MediaStatusSchema>;
export type MediaBroadcastMessage = z.infer<typeof MediaBroadcastSchema>;
export type MediaMessage =
  | MediaOfferMessage
  | MediaAnswerMessage
  | MediaRequestMessage
  | MediaStatusMessage
  | MediaBroadcastMessage;
