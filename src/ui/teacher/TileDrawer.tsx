import { useEffect, useState } from "react";
import type { LabController, RosterView } from "../../core/labController";

/** 8 bytes is plenty to eyeball across pairings and fits on one line of the drawer. */
function shortFingerprint(fp: string): string {
  return fp.split(":").slice(0, 8).join(":");
}

export function TileDrawer({
  lab,
  t,
  focused,
  onClose,
}: {
  lab: LabController;
  t: RosterView;
  focused: boolean;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(t.label ?? "");
  // The verdict compares *this* pairing's certificate with the last one. With no session this
  // run there is nothing to compare, so only the stored fingerprint itself is shown.
  const hasSession = t.state !== "never";
  // Opening the drawer is how the teacher acknowledges the "replaced" badge.
  useEffect(() => {
    lab.acknowledgeReplaced(t.ws);
  }, [lab, t.ws]);
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ alignItems: "stretch" }}>
        <h2>Workstation {t.ws}</h2>
        <label>
          Label{" "}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => lab.setLabel(t.ws, label)}
          />
        </label>
        <p className="meta">UA: {t.lastSeenUa ?? "—"}</p>
        <p className="meta">Student version: {t.remoteAppVersion ?? "—"}</p>
        <p className="meta" data-fingerprint>
          Device fingerprint: {t.fingerprint ? shortFingerprint(t.fingerprint) : "—"}
          {t.fingerprint &&
            hasSession &&
            (t.fingerprintChanged
              ? " · ⚠️ different device than last pairing"
              : " · same device as last pairing")}
        </p>
        <div className="meta" data-media-detail>
          <p>
            Video: {t.media.state}
            {t.media.reason ? ` — ${t.media.reason}` : ""} · camera {t.media.cam}
            {t.media.send ? ` (${t.media.send.height}p @ ${t.media.send.fps})` : ""}
          </p>
          {t.media.stats && (
            <p>
              in {t.media.stats.inHeight ?? "?"}p @ {t.media.stats.inFps ?? "?"} fps
              {t.media.stats.framesDropped !== undefined
                ? ` · dropped ${t.media.stats.framesDropped}`
                : ""}
              {" · "}out {t.media.stats.outHeight ?? "?"}p @ {t.media.stats.outFps ?? "?"} fps
              {t.media.stats.encoder ? ` · ${t.media.stats.encoder}` : ""}
              {t.media.stats.cpuLimited ? " · ⚠ CPU-limited" : ""}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {t.media.state === "ready" && (
              <button
                data-action="focus"
                onClick={() => {
                  lab.focus(focused ? null : t.ws);
                  onClose();
                }}
              >
                {focused ? "Unfocus" : "Focus"}
              </button>
            )}
            {t.media.state === "failed" && (
              <button
                className="secondary"
                data-action="retry-video"
                onClick={() => lab.retryMedia(t.ws)}
              >
                Retry video
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => lab.sendCmd(t.ws, "ping")}>Ping</button>
          <button onClick={() => lab.sendCmd(t.ws, "show-id")}>Show ID on iPad</button>
          <button
            className="secondary"
            onClick={() => {
              if (confirm(`Reload workstation ${t.ws}? It will need re-pairing.`))
                lab.sendCmd(t.ws, "reload");
            }}
          >
            Reload
          </button>
          <button
            className="secondary"
            data-action="remove"
            onClick={() => {
              if (
                confirm(
                  `Remove ${t.ws}? Its tile and label are deleted; the iPad can pair again as a new station.`,
                )
              ) {
                lab.remove(t.ws);
                onClose();
              }
            }}
          >
            Remove workstation
          </button>
        </div>
        <h3>History</h3>
        <ul className="meta">
          {t.history
            .slice(-20)
            .reverse()
            .map((h, i) => (
              <li key={i}>
                {new Date(h.at).toLocaleTimeString()} — {h.state}
              </li>
            ))}
        </ul>
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
