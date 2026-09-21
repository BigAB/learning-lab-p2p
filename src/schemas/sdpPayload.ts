import { z } from "zod";
import { WsSchema } from "./ws";

export const SetupSchema = z.enum(["actpass", "active", "passive"]);

/**
 * Charsets, not just lengths: every one of these fields is interpolated into an SDP line, so a
 * CRLF (or a space) smuggled through the QR would inject attributes into the rebuilt session
 * description. IP literals only — an mDNS `.local` name is rejected here and reported with a
 * clearer message by the codec.
 */
export const IP_LITERAL = /^[0-9A-Fa-f:.]+$/;
/** ICE ufrag/pwd: RFC 5245 ice-char, plus the base64 padding some stacks emit. */
export const ICE_CHAR = /^[A-Za-z0-9+/\-_=]+$/;
export const MID_CHAR = /^[A-Za-z0-9_-]+$/;

export const CandidateSchema = z.object({
  ip: z.string().min(2).max(45).regex(IP_LITERAL, "candidate ip must be an IPv4/IPv6 literal"),
  port: z.number().int().min(1).max(65535),
  proto: z.literal("udp"),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Everything a peer cannot infer about our DataChannel-only SDP. */
export const SdpPayloadSchema = z.object({
  v: z.literal(1),
  role: z.enum(["offer", "answer"]),
  ws: WsSchema,
  mid: z.string().min(1).max(16).regex(MID_CHAR, "mid charset"),
  ufrag: z.string().min(4).max(256).regex(ICE_CHAR, "ice-ufrag charset"),
  pwd: z.string().min(22).max(256).regex(ICE_CHAR, "ice-pwd charset"),
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
  m: z.string().min(1).max(16).regex(MID_CHAR, "mid charset"),
  u: z.string().min(4).max(256).regex(ICE_CHAR, "ice-ufrag charset"),
  p: z.string().min(22).max(256).regex(ICE_CHAR, "ice-pwd charset"),
  f: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "base64url fingerprint"),
  s: SetupSchema,
  c: z
    .array(
      z.tuple([
        z.string().min(2).max(45).regex(IP_LITERAL, "candidate ip must be an IPv4/IPv6 literal"),
        z.number().int().min(1).max(65535),
      ]),
    )
    .min(1)
    .max(8),
});
export type CompactPayload = z.infer<typeof CompactPayloadSchema>;
