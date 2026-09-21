import type { Candidate, CompactPayload, SdpPayload } from "../schemas/sdpPayload";
import { CompactPayloadSchema, SdpPayloadSchema } from "../schemas/sdpPayload";
import { crc8, deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from "./bytes";

export const WIRE_PREFIX = "LAB1:";

export class CodecError extends Error {
  override name = "CodecError";
}

const LINK_LOCAL = /^(169\.254\.|fe80:)/i;
const MDNS = /\.local$/i;
const CANDIDATE = /^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/i;

export function extractPayload(sdp: string, role: "offer" | "answer", ws: number): SdpPayload {
  const lines = sdp.split(/\r?\n/);
  const attr = (name: string) =>
    lines.find((l) => l.startsWith(`a=${name}:`))?.slice(name.length + 3);
  const ufrag = attr("ice-ufrag");
  const pwd = attr("ice-pwd");
  const fpLine = attr("fingerprint");
  const setup = attr("setup");
  const mid = attr("mid");
  if (!ufrag || !pwd || !fpLine || !setup || !mid) {
    throw new CodecError("sdp missing ice-ufrag/ice-pwd/fingerprint/setup/mid");
  }
  const [alg, hex] = fpLine.trim().split(/\s+/);
  if (alg?.toLowerCase() !== "sha-256" || !hex)
    throw new CodecError("only sha-256 fingerprints are supported");
  const fp = new Uint8Array(hex.split(":").map((h) => parseInt(h, 16)));

  const cands: Candidate[] = [];
  const seen = new Set<string>();
  let sawMdns = false;
  let sawLinkLocal = false;
  for (const l of lines) {
    const m = CANDIDATE.exec(l);
    if (!m) continue;
    const ip = m[1]!;
    const port = Number(m[2]);
    const key = `${ip}:${port}`;
    // An `<uuid>.local` candidate is mDNS obfuscation: the peer would have to resolve it over
    // multicast DNS, which the lab LAN may not carry. It means the origin never got the camera
    // grant that makes the browser publish real host IPs.
    if (MDNS.test(ip)) {
      sawMdns = true;
      continue;
    }
    if (LINK_LOCAL.test(ip)) {
      sawLinkLocal = true;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push({ ip, port, proto: "udp" });
  }
  // Each empty outcome gets its own diagnosis: the camera message is only right when an mDNS
  // name was actually offered — a link-local-only gather is a network problem, not a permission one.
  if (cands.length === 0) {
    if (sawMdns) {
      throw new CodecError("only mDNS candidates found — camera permission missing, cannot pair");
    }
    if (sawLinkLocal) {
      throw new CodecError(
        "no usable host candidate — only link-local addresses were gathered; check the LAN connection",
      );
    }
    throw new CodecError("no host candidates in sdp");
  }
  const result = SdpPayloadSchema.safeParse({ v: 1, role, ws, mid, ufrag, pwd, fp, setup, cands });
  if (!result.success) {
    throw new CodecError(`sdp: ${result.error.issues[0]?.message ?? "invalid"}`);
  }
  return result.data;
}

export function buildSdp(p: SdpPayload): string {
  const payload = SdpPayloadSchema.parse(p);
  const fpHex = Array.from(payload.fp, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(
    ":",
  );
  const cands = payload.cands.map(
    (c, i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${c.ip} ${c.port} typ host`,
  );
  return [
    "v=0",
    "o=- 2 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${payload.mid}`,
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${payload.ufrag}`,
    `a=ice-pwd:${payload.pwd}`,
    `a=fingerprint:sha-256 ${fpHex}`,
    `a=setup:${payload.setup}`,
    `a=mid:${payload.mid}`,
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    ...cands,
    "a=end-of-candidates",
    "",
  ].join("\r\n");
}

export function toCompact(p: SdpPayload): CompactPayload {
  return CompactPayloadSchema.parse({
    v: 1,
    r: p.role === "offer" ? "o" : "a",
    w: p.ws,
    m: p.mid,
    u: p.ufrag,
    p: p.pwd,
    f: toBase64Url(p.fp),
    s: p.setup,
    c: p.cands.map((c) => [c.ip, c.port] as [string, number]),
  });
}

export function fromCompact(c: CompactPayload): SdpPayload {
  return SdpPayloadSchema.parse({
    v: 1,
    role: c.r === "o" ? "offer" : "answer",
    ws: c.w,
    mid: c.m,
    ufrag: c.u,
    pwd: c.p,
    fp: fromBase64Url(c.f),
    setup: c.s,
    cands: c.c.map(([ip, port]) => ({ ip, port, proto: "udp" as const })),
  });
}

export async function encodeWire(p: SdpPayload): Promise<string> {
  const json = JSON.stringify(toCompact(SdpPayloadSchema.parse(p)));
  const packed = await deflateRaw(new TextEncoder().encode(json));
  return `${WIRE_PREFIX}${toBase64Url(packed)}${crc8(packed).toString(16).padStart(2, "0")}`;
}

export async function decodeWire(wire: string): Promise<SdpPayload> {
  if (!wire.startsWith(WIRE_PREFIX)) throw new CodecError("not a LAB1 payload");
  const body = wire.slice(WIRE_PREFIX.length);
  if (body.length < 4) throw new CodecError("payload too short");
  const crcHex = body.slice(-2);
  let packed: Uint8Array;
  try {
    packed = fromBase64Url(body.slice(0, -2));
  } catch (e) {
    throw new CodecError(`bad base64url: ${(e as Error).message}`);
  }
  if (crc8(packed) !== parseInt(crcHex, 16)) throw new CodecError("crc mismatch");
  let json: string;
  try {
    json = new TextDecoder().decode(await inflateRaw(packed));
  } catch {
    throw new CodecError("inflate failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CodecError("payload is not JSON");
  }
  const compact = CompactPayloadSchema.safeParse(parsed);
  if (!compact.success)
    throw new CodecError(`schema: ${compact.error.issues[0]?.message ?? "invalid"}`);
  try {
    return fromCompact(compact.data);
  } catch (e) {
    throw new CodecError(`payload: ${(e as Error).message}`);
  }
}
