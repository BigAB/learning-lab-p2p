import type { WakeLockPort } from "../../core/ports";
let sentinel: WakeLockSentinel | null = null;
export const browserWakeLock: WakeLockPort = {
  async request() {
    if (!("wakeLock" in navigator)) return false;
    try {
      if (sentinel && !sentinel.released) return true;
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => {
        sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  },
};
