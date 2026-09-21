import type { DevicePort, Visibility, WakeLockPort } from "../../../src/core/ports";

export class FakeDevice implements DevicePort {
  vis: Visibility = "visible";
  batteryInfo: { level: number; charging: boolean } | undefined = { level: 0.8, charging: true };
  private subs = new Set<(v: Visibility) => void>();
  visibility(): Visibility {
    return this.vis;
  }
  onVisibility(cb: (v: Visibility) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  async battery() {
    return this.batteryInfo;
  }
  setVisibility(v: Visibility): void {
    this.vis = v;
    for (const cb of this.subs) cb(v);
  }
}

export class FakeWakeLock implements WakeLockPort {
  requests = 0;
  result = true;
  async request(): Promise<boolean> {
    this.requests++;
    return this.result;
  }
}
