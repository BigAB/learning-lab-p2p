import { z } from "zod";
import { WsSchema } from "./ws";

export const SetupSchema = z.enum(["actpass", "active", "passive"]);
export const CandidateSchema = z.object({
  ip: z.string().min(2),
  port: z.number().int().min(1).max(65535),
  proto: z.literal("udp"),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Everything a peer cannot infer about our DataChannel-only SDP. */
export const SdpPayloadSchema = z.object({
  v: z.literal(1),
  role: z.enum(["offer", "answer"]),
  ws: WsSchema,
  mid: z.string().min(1).max(16),
  ufrag: z.string().min(4).max(256),
  pwd: z.string().min(22).max(256),
  fp: z
    .instanceof(Uint8Array)
    .refine((b) => b.length === 32, "sha-256 fingerprint must be 32 bytes"),
  setup: SetupSchema,
  cands: z.array(CandidateSchema).min(1).max(8),
});
export type SdpPayload = z.infer<typeof SdpPayloadSchema>;

/** Short-key JSON form that is deflated into the QR. */
export const CompactPayloadSchema = z.object({
  v: z.literal(1),
  r: z.enum(["o", "a"]),
  w: WsSchema,
  m: z.string().min(1).max(16),
  u: z.string().min(4).max(256),
  p: z.string().min(22).max(256),
  f: z.string().length(43),
  s: SetupSchema,
  c: z
    .array(z.tuple([z.string().min(2), z.number().int().min(1).max(65535)]))
    .min(1)
    .max(8),
});
export type CompactPayload = z.infer<typeof CompactPayloadSchema>;
