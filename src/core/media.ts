import type { Profile } from "../schemas/media";
import type { CaptureConstraints } from "./ports";

/** The student camera captures at this fixed size; every profile is a scale-down of it (spec §3.5). */
export const CAPTURE: CaptureConstraints = { width: 1280, height: 720, frameRate: 15 };

export type CodecPref = "h264" | "vp8" | "auto";
export type Degradation = "balanced" | "maintain-framerate" | "maintain-resolution";
export type OfferedDirection = "sendonly" | "recvonly" | "sendrecv" | "inactive";

/** Sender scale factor from the captured height; never below 1 (no upscaling). */
export function scaleFor(trackHeight: number | undefined, targetHeight: number): number {
  if (!trackHeight || trackHeight <= targetHeight) return 1;
  return trackHeight / targetHeight;
}

export function encodingFor(p: Profile, trackHeight: number | undefined): RTCRtpEncodingParameters {
  return {
    scaleResolutionDownBy: scaleFor(trackHeight || CAPTURE.height, p.height),
    maxFramerate: p.fps,
    maxBitrate: p.kbps * 1000,
  };
}

function h264Score(c: RTCRtpCodec): number {
  const f = c.sdpFmtpLine ?? "";
  return (/packetization-mode=1/.test(f) ? 2 : 0) + (/42e01f/i.test(f) ? 1 : 0);
}

/**
 * Preferred codec first (stable order otherwise). For H.264 the packetization-mode=1 constrained
 * baseline entries lead, which is what iPads decode in hardware. Unknown preference ⇒ untouched.
 */
export function orderCodecs(codecs: RTCRtpCodec[], pref: CodecPref): RTCRtpCodec[] {
  if (pref === "auto") return codecs;
  const want = pref === "h264" ? "video/h264" : "video/vp8";
  const first = codecs.filter((c) => c.mimeType.toLowerCase() === want);
  if (first.length === 0) return codecs;
  if (pref === "h264") first.sort((a, b) => h264Score(b) - h264Score(a));
  const rest = codecs.filter((c) => c.mimeType.toLowerCase() !== want);
  return [...first, ...rest];
}

/** mid → direction line for each m= section of an SDP; sections without both are skipped. */
export function offeredDirections(sdp: string): Map<string, OfferedDirection> {
  const out = new Map<string, OfferedDirection>();
  const sections = sdp.split(/\r?\n(?=m=)/).slice(1);
  for (const sec of sections) {
    const lines = sec.split(/\r?\n/);
    const mid = lines
      .find((l) => l.startsWith("a=mid:"))
      ?.slice(6)
      .trim();
    const dir = lines
      .find((l) => /^a=(sendonly|recvonly|sendrecv|inactive)\s*$/.test(l))
      ?.slice(2)
      .trim();
    if (mid && dir) out.set(mid, dir as OfferedDirection);
  }
  return out;
}

/** Merge `enc` into encodings[0] (creating it if the engine returned none) and set parameters. */
export async function applyEncoding(
  sender: RTCRtpSender,
  enc: RTCRtpEncodingParameters,
  degradation?: Degradation,
): Promise<void> {
  const p = sender.getParameters();
  if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
  Object.assign(p.encodings[0]!, enc);
  if (degradation)
    (p as RTCRtpSendParameters & { degradationPreference?: Degradation }).degradationPreference =
      degradation;
  await sender.setParameters(p);
}
