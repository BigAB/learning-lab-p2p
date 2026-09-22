import type { RosterView, TileMedia } from "../../core/labController";
import { StatusPill } from "../shared/StatusPill";
import { VideoView } from "../shared/VideoView";

function ago(ts?: number) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)}m ago`
      : `${Math.round(s / 3600)}h ago`;
}

function placeholder(m: TileMedia): string {
  if (m.state === "unsupported") return "no video (older build)";
  if (m.state === "failed") return `video failed: ${m.reason ?? "unknown"}`;
  if (m.state === "negotiating") return "negotiating video…";
  if (m.cam === "error") return `camera error: ${m.reason ?? "unknown"}`;
  return "camera off";
}

export function Tile({
  t,
  onClick,
  onFocus,
}: {
  t: RosterView;
  onClick: () => void;
  onFocus: () => void;
}) {
  const m = t.media;
  const live = m.cam === "on" && m.track !== undefined;
  return (
    <div
      className="tile"
      data-tile={t.key}
      data-state={t.state}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="num">{t.ws}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t.replaced && (
            <span className="badge" data-replaced title="A new pairing replaced a live session">
              ↺ replaced
            </span>
          )}
          <StatusPill state={t.state} />
        </span>
      </div>
      <div
        className="thumb"
        data-media-state={m.state}
        data-cam={m.cam}
        onClick={(e) => {
          // The thumbnail is the focus control; the rest of the tile opens the drawer.
          if (!live) return;
          e.stopPropagation();
          onFocus();
        }}
        title={live ? "Focus this station" : undefined}
      >
        {live && m.track ? (
          <VideoView track={m.track} />
        ) : (
          <span className="meta">{placeholder(m)}</span>
        )}
      </div>
      <div className="meta">{t.label ?? "—"}</div>
      <div className="meta">
        {t.rtt !== undefined && <span data-rtt>{t.rtt} ms · </span>}
        <span data-seen>seen {ago(t.lastSeenAt ?? t.lastConnectedAt)}</span>
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
        {m.stats?.cpuLimited && (
          <span title="Teacher encoder is CPU-limited for this station">🔥 </span>
        )}
      </div>
    </div>
  );
}
