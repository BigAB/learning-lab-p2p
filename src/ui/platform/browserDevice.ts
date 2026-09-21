import type { DevicePort, Visibility } from "../../core/ports";
interface BatteryLike {
  level: number;
  charging: boolean;
}
type NavWithBattery = Navigator & { getBattery?: () => Promise<BatteryLike> };
export const browserDevice: DevicePort = {
  visibility: (): Visibility => (document.visibilityState === "visible" ? "visible" : "hidden"),
  onVisibility(cb) {
    const h = () => cb(document.visibilityState === "visible" ? "visible" : "hidden");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  },
  async battery() {
    const nav = navigator as NavWithBattery;
    if (!nav.getBattery) return undefined; // Safari has no Battery API; that's fine
    try {
      const b = await nav.getBattery();
      return { level: b.level, charging: b.charging };
    } catch {
      return undefined;
    }
  },
};
