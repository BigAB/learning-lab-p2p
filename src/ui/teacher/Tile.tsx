import type { RosterView } from "../../core/labController";
import { StatusPill } from "../shared/StatusPill";

function ago(ts?: number) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)}m ago`
      : `${Math.round(s / 3600)}h ago`;
}

export function Tile({ t, onClick }: { t: RosterView; onClick: () => void }) {
  return (
    <div
      className="tile"
      data-tile={t.ws}
      data-state={t.state}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="num">{t.ws}</span>
        <StatusPill state={t.state} />
      </div>
      <div className="meta">{t.label ?? "—"}</div>
      <div className="meta">
        {t.rtt !== undefined && <span data-rtt>{t.rtt} ms · </span>}
        <span>seen {ago(t.lastConnectedAt)}</span>
      </div>
      <div className="meta">
        {t.battery !== undefined && (
          <span>
            {t.charging ? "⚡" : "🔋"} {Math.round(t.battery * 100)}%{" "}
          </span>
        )}
        {t.visibility === "hidden" && <span title="Screen hidden">🙈 </span>}
        {t.wakeLock === false && <span title="No wake lock">💤 </span>}
        {t.versionMismatch && <span title={`Student runs ${t.remoteAppVersion}`}>⚠️ version</span>}
      </div>
    </div>
  );
}
