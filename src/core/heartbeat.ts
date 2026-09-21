import type { Clock, TimerHandle } from "./clock";
import type { HbAckMessage, HbMessage } from "../schemas/protocol";

export interface HeartbeatOpts {
  clock: Clock;
  intervalMs: number;
  missMs: number;
  send(m: HbMessage | HbAckMessage): void;
  onMiss(): void;
  onRecover(): void;
  onRtt(ms: number): void;
}

export class Heartbeat {
  private seq = 0;
  private lastSeen: number;
  private timer: TimerHandle | undefined;
  missed = false;

  constructor(private readonly o: HeartbeatOpts) {
    this.lastSeen = o.clock.now();
  }

  start(): void {
    this.lastSeen = this.o.clock.now();
    this.timer = this.o.clock.setInterval(() => this.tick(), this.o.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) this.o.clock.clearInterval(this.timer);
    this.timer = undefined;
  }

  handle(m: HbMessage | HbAckMessage): void {
    const now = this.o.clock.now();
    this.lastSeen = now;
    if (m.t === "hb") this.o.send({ t: "hb-ack", seq: m.seq, ts: m.ts });
    else this.o.onRtt(Math.max(0, now - m.ts));
    if (this.missed) {
      this.missed = false;
      this.o.onRecover();
    }
  }

  private tick(): void {
    const now = this.o.clock.now();
    this.o.send({ t: "hb", seq: this.seq++, ts: now });
    if (!this.missed && now - this.lastSeen > this.o.missMs) {
      this.missed = true;
      this.o.onMiss();
    }
  }
}
