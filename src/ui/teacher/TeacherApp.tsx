import { useEffect, useState } from "react";
import type { LabController } from "../../core/labController";
import { useLabRoster } from "../../hooks/useLabRoster";
import { usePromise } from "../../hooks/usePromise";
import { APP_VERSION } from "../platform/appVersion";
import { VideoView } from "../shared/VideoView";
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
  const { tiles, queue, counts, settings, focused, broadcast, media } = useLabRoster(lab);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const openTile = open !== undefined ? tiles.find((t) => t.key === open) : undefined;
  const focusedTile = focused !== undefined ? tiles.find((t) => t.key === focused) : undefined;
  const mediaActive = media.on > 0 || broadcast !== null;

  useEffect(() => {
    if (focused === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") lab.focus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lab, focused]);

  const share = (source: "camera" | "screen") => {
    setNotice(undefined);
    lab.startBroadcast(source).catch((e: unknown) => {
      const cancelled = e instanceof DOMException && e.name === "NotAllowedError";
      const message = e instanceof Error ? e.message : String(e);
      setNotice(cancelled ? "Sharing cancelled" : `Sharing failed: ${message}`);
    });
  };

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
          <button
            className={settings.media.cameras ? "" : "secondary"}
            data-action="cameras"
            aria-pressed={settings.media.cameras}
            onClick={() => lab.setCameras(!settings.media.cameras)}
          >
            Cameras {settings.media.cameras ? "on" : "off"}
          </button>
          {broadcast === null ? (
            <>
              <button
                className="secondary"
                data-action="share-camera"
                onClick={() => share("camera")}
              >
                Share camera
              </button>
              <button
                className="secondary"
                data-action="share-screen"
                onClick={() => share("screen")}
              >
                Share screen
              </button>
            </>
          ) : (
            <button data-action="share-stop" onClick={() => lab.stopBroadcast()}>
              Stop sharing {broadcast}
            </button>
          )}
          {mediaActive && (
            <span className="meta" data-media-summary>
              📷 {media.on} on{media.cpuLimited > 0 ? ` · ⚠ ${media.cpuLimited} CPU-limited` : ""}
            </span>
          )}
          {notice && (
            <span className="meta" data-notice style={{ color: "var(--amber)" }}>
              {notice}
            </span>
          )}
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
        </header>
        {focusedTile && focusedTile.media.track && (
          <section className="focus" data-focus={focusedTile.key}>
            <VideoView track={focusedTile.media.track} />
            <div className="focus-bar">
              <span className="num">{focusedTile.ws}</span>
              {focusedTile.media.stats && (
                <span className="meta" data-focus-stats>
                  {focusedTile.media.stats.inHeight ?? "?"}p ·{" "}
                  {focusedTile.media.stats.inFps ?? "?"} fps
                </span>
              )}
              <button className="secondary" data-action="unfocus" onClick={() => lab.focus(null)}>
                Close
              </button>
            </div>
          </section>
        )}
        <main className="grid">
          {tiles.length === 0 && (
            <p className="meta" data-empty style={{ gridColumn: "1 / -1", textAlign: "center" }}>
              No workstations yet — tap Scan and point the camera at a student's code.
            </p>
          )}
          {tiles.map((t) => (
            <Tile
              key={t.key}
              t={t}
              onClick={() => setOpen(t.key)}
              onFocus={() => lab.focus(focused === t.key ? null : t.ws)}
            />
          ))}
        </main>
      </div>
      <RepairQueue queue={queue} />
      {scanning && <ScanModal lab={lab} onClose={() => setScanning(false)} />}
      {openTile && (
        <TileDrawer
          lab={lab}
          t={openTile}
          focused={focused === openTile.key}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
