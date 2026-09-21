import type { SessionState } from "../../core/peerSession";
export type PillState = SessionState | "never" | "none";
const LABEL: Record<PillState, string> = {
  idle: "Starting",
  gathering: "Starting",
  "awaiting-remote": "Waiting for teacher",
  connecting: "Connecting",
  connected: "Connected",
  degraded: "Unstable",
  failed: "Re-pair needed",
  never: "Not paired",
  none: "—",
};
export function StatusPill({ state }: { state: PillState }) {
  return (
    <span className={`pill pill-${state}`} data-state={state}>
      {LABEL[state]}
    </span>
  );
}
