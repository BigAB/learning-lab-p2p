import { useState } from "react";
import type { LabController } from "../../core/labController";
import { useLabRoster } from "../../hooks/useLabRoster";
import { usePromise } from "../../hooks/usePromise";
import { APP_VERSION } from "../platform/appVersion";
import { RepairQueue } from "./RepairQueue";
import { ScanModal } from "./ScanModal";
import { Tile } from "./Tile";
import { TileDrawer } from "./TileDrawer";

export function TeacherApp({ boot }: { boot: Promise<LabController> }) {
  const { value: lab, error } = usePromise(boot);
  if (error)
    return (
      <div className="center">
        <h1>Could not start</h1>
        <pre>{error.message}</pre>
      </div>
    );
  if (!lab)
    return (
      <div className="center">
        <h1>Starting…</h1>
      </div>
    );
  return <Dashboard lab={lab} />;
}

function Dashboard({ lab }: { lab: LabController }) {
  const { tiles, queue, counts } = useLabRoster(lab);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<number | undefined>();
  const openTile = open !== undefined ? tiles[open - 1] : undefined;
  return (
    <div className="layout">
      <div>
        <header className="bar">
          <strong>Learning Lab</strong>
          <span data-count="connected" style={{ color: "var(--green)" }}>
            ● {counts.connected}
          </span>
          <span data-count="degraded" style={{ color: "var(--amber)" }}>
            ● {counts.degraded}
          </span>
          <span data-count="failed" style={{ color: "var(--red)" }}>
            ● {counts.failed + counts.never}
          </span>
          <button onClick={() => setScanning(true)} data-action="scan">
            Scan
          </button>
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
        </header>
        <main className="grid">
          {tiles.map((t) => (
            <Tile key={t.ws} t={t} onClick={() => setOpen(t.ws)} />
          ))}
        </main>
      </div>
      <RepairQueue queue={queue} />
      {scanning && <ScanModal lab={lab} onClose={() => setScanning(false)} />}
      {openTile && <TileDrawer lab={lab} t={openTile} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
