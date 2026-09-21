import type { Clock, TimerHandle } from "../../../src/core/clock";

interface Entry {
  at: number;
  fn: () => void;
  every?: number;
}

export class FakeClock implements Clock {
  private t = 0;
  private next = 1;
  private timers = new Map<number, Entry>();

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id as unknown as TimerHandle;
  }
  clearTimeout(h: TimerHandle): void {
    this.timers.delete(h as unknown as number);
  }
  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id as unknown as TimerHandle;
  }
  clearInterval(h: TimerHandle): void {
    this.clearTimeout(h);
  }

  /** Advance virtual time, firing due timers in order (including ones scheduled meanwhile). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let dueId: number | undefined;
      let due: Entry | undefined;
      for (const [id, e] of this.timers) {
        if (e.at <= end && (due === undefined || e.at < due.at)) {
          dueId = id;
          due = e;
        }
      }
      if (due === undefined || dueId === undefined) break;
      this.t = due.at;
      if (due.every !== undefined) due.at += due.every;
      else this.timers.delete(dueId);
      due.fn();
    }
    this.t = end;
  }
}
