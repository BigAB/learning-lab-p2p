import { useState } from "react";
import type { LabController, RosterView } from "../../core/labController";

/** 8 bytes is plenty to eyeball across pairings and fits on one line of the drawer. */
function shortFingerprint(fp: string): string {
  return fp.split(":").slice(0, 8).join(":");
}

export function TileDrawer({
  lab,
  t,
  onClose,
}: {
  lab: LabController;
  t: RosterView;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(t.label ?? "");
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
            (t.fingerprintChanged
              ? " · ⚠️ different device than last pairing"
              : " · same device as last pairing")}
        </p>
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
