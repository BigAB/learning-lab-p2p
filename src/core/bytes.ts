const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHA[(n >> 18) & 63]! + ALPHA[(n >> 12) & 63]!;
    if (b !== undefined) out += ALPHA[(n >> 6) & 63]!;
    if (c !== undefined) out += ALPHA[n & 63]!;
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const quad = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < quad.length; j++) {
      const v = ALPHA.indexOf(quad[j]!);
      if (v < 0) throw new Error(`illegal base64url char '${quad[j]}'`);
      n |= v << (18 - 6 * j);
    }
    out.push((n >> 16) & 255);
    if (quad.length > 2) out.push((n >> 8) & 255);
    if (quad.length > 3) out.push(n & 255);
  }
  return new Uint8Array(out);
}

/** CRC-8, polynomial 0x07, init 0x00, no reflection. */
export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  void w.write(data as BufferSource);
  void w.close();
  return pump(cs.readable);
}

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  void w.write(data as BufferSource);
  void w.close();
  return pump(ds.readable);
}
