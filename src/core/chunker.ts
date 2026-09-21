import type { ChunkMessage } from "../schemas/protocol";

const enc = new TextEncoder();

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Returns the message itself if it fits, else JSON chunk frames each ≤ maxBytes. */
export function chunkMessage(json: string, maxBytes: number): string[] {
  if (enc.encode(json).length <= maxBytes) return [json];
  const id = randomId();
  // Overhead of the frame envelope (~80 bytes) plus UTF-8 expansion (≤3 bytes/char) leaves
  // maxBytes/4 chars per chunk comfortably under the limit.
  const size = Math.max(1, Math.floor(maxBytes / 4));
  const parts: string[] = [];
  for (let i = 0; i < json.length; i += size) parts.push(json.slice(i, i + size));
  return parts.map((data, i) =>
    JSON.stringify({ t: "chunk", id, i, n: parts.length, data } satisfies ChunkMessage),
  );
}

interface Pending {
  n: number;
  parts: (string | undefined)[];
  got: number;
}

export class Reassembler {
  private pending = new Map<string, Pending>();

  /** Returns the whole message once the last chunk of an id arrives. */
  push(c: ChunkMessage): string | undefined {
    let p = this.pending.get(c.id);
    if (!p) {
      p = { n: c.n, parts: new Array<string | undefined>(c.n), got: 0 };
      this.pending.set(c.id, p);
    }
    if (c.i >= p.n || p.parts[c.i] !== undefined) return undefined;
    p.parts[c.i] = c.data;
    p.got++;
    if (p.got < p.n) return undefined;
    this.pending.delete(c.id);
    return p.parts.join("");
  }
}
