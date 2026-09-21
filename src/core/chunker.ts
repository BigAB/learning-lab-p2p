import type { ChunkMessage } from "../schemas/protocol";

const enc = new TextEncoder();

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Returns the message itself if it fits, else JSON chunk frames each ≤ maxBytes. */
export function chunkMessage(json: string, maxBytes: number): string[] {
  if (enc.encode(json).length <= maxBytes) return [json];
  const id = randomId();
  // Build frames by measuring actual UTF-8 byte length of each frame.
  // Start with initial size estimate and halve until all frames fit within maxBytes.
  let size = Math.max(1, Math.floor(maxBytes / 4));
  let frames: string[] = [];
  let allFit = false;
  while (!allFit) {
    frames = [];
    for (let i = 0; i < json.length; i += size) {
      const data = json.slice(i, i + size);
      const frame = JSON.stringify({
        t: "chunk",
        id,
        i: frames.length,
        n: 0,
        data,
      } satisfies ChunkMessage);
      frames.push(frame);
    }
    allFit = frames.every((f) => enc.encode(f).length <= maxBytes);
    if (!allFit) size = Math.max(1, Math.floor(size / 2));
  }
  // Rebuild with correct n values
  const n = frames.length;
  return Array.from({ length: n }, (_, idx) => {
    const data = json.slice(idx * size, (idx + 1) * size);
    return JSON.stringify({ t: "chunk", id, i: idx, n, data } satisfies ChunkMessage);
  });
}

interface Pending {
  n: number;
  parts: (string | undefined)[];
  got: number;
}

export class Reassembler {
  private pending = new Map<string, Pending>();
  /** Chunks thrown away as duplicates or out-of-range; PeerSession counts them as ignored. */
  dropped = 0;

  constructor(private readonly maxPending = 8) {}

  /** Returns the whole message once the last chunk of an id arrives. */
  push(c: ChunkMessage): string | undefined {
    let p = this.pending.get(c.id);
    if (!p) {
      // Evict oldest entry if at capacity
      if (this.pending.size >= this.maxPending) {
        const oldest = this.pending.keys().next().value as string;
        this.pending.delete(oldest);
      }
      p = { n: c.n, parts: new Array<string | undefined>(c.n), got: 0 };
      this.pending.set(c.id, p);
    }
    if (c.i >= p.n || p.parts[c.i] !== undefined) {
      this.dropped++;
      return undefined;
    }
    p.parts[c.i] = c.data;
    p.got++;
    if (p.got < p.n) return undefined;
    this.pending.delete(c.id);
    return p.parts.join("");
  }
}
