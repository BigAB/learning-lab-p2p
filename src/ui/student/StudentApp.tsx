import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudentController } from "../../core/studentController";
import { decodeWire } from "../../core/sdpCodec";
import { usePromise } from "../../hooks/usePromise";
import { useSessionView } from "../../hooks/useSessionView";
import { useStudent } from "../../hooks/useStudent";
import { wsKey } from "../../schemas/ws";
import { APP_VERSION } from "../platform/appVersion";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";
import { StatusPill } from "../shared/StatusPill";
import { VideoView } from "../shared/VideoView";
import { WsEntry } from "./WsEntry";

export function StudentApp({
  boot,
  onChangeWs,
}: {
  boot: Promise<StudentController>;
  onChangeWs: (ws: string) => void;
}) {
  const { value: c, error } = usePromise(boot);
  if (error)
    return (
      <div className="center">
        <h1>Could not start</h1>
        <pre>{error.message}</pre>
      </div>
    );
  if (!c)
    return (
      <div className="center">
        <h1>Starting…</h1>
      </div>
    );
  return <StudentView c={c} onChangeWs={onChangeWs} />;
}

function StudentView({
  c,
  onChangeWs,
}: {
  c: StudentController;
  onChangeWs: (ws: string) => void;
}) {
  const { session, lastCmd, lastError, media } = useStudent(c);
  const view = useSessionView(session);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  const [showId, setShowId] = useState(false);
  const [editing, setEditing] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Bumped whenever a scanned code is rejected, which schedules <Scanner> to offer the same QR
  // once more after its retry delay instead of swallowing it forever as a duplicate.
  const [scanResetKey, setScanResetKey] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((msg: string, ms: number) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(undefined), ms);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!media.broadcast.on) setPlaying(false);
  }, [media.broadcast.on]);

  useEffect(() => {
    if (view.state === "connected") setScanning(false);
    if (view.state !== "failed") return;
    // A start() that never got off the ground reports itself through `error` (rendered under the
    // status bar) and closes its session in the same tick. "Connection lost" would be a lie —
    // nothing was ever connected — so let the real message stand.
    if (lastError && Date.now() - lastError.at < 500) return;
    showToast("Connection lost — showing a new code", 4000);
  }, [view.state, lastError, showToast]);

  useEffect(() => {
    if (lastCmd?.cmd === "show-id") {
      setShowId(true);
      const t = setTimeout(() => setShowId(false), 5000);
      return () => clearTimeout(t);
    }
  }, [lastCmd]);

  const onWire = useCallback(
    (wire: string) => {
      void decodeWire(wire)
        .then((p) => session?.applyRemote(p))
        .catch((e: unknown) => {
          showToast(`Not a valid code: ${(e as Error).message}`, 3000);
          setScanResetKey((k) => k + 1);
        });
    },
    [session, showToast],
  );

  const onScanError = useCallback(
    (e: Error) => showToast(`Camera: ${e.message}`, 3000),
    [showToast],
  );

  return (
    <div id="student" data-state={view.state} data-cam={media.cam}>
      <header className="bar">
        <span className="ws">{c.ws}</span>
        <button
          className="secondary change"
          data-ws-change
          title="Change workstation ID"
          onClick={() => setEditing(true)}
        >
          change
        </button>
        <StatusPill state={view.state} />
        {media.cam === "on" && (
          <span className="pill pill-cam" data-cam-pill="on">
            ● Camera on
          </span>
        )}
        {media.cam === "error" && (
          <span
            className="pill pill-camerr"
            data-cam-pill="error"
            title={media.reason ?? "camera error"}
          >
            Camera unavailable
          </span>
        )}
        {view.rtt !== undefined && <span className="meta">{view.rtt} ms</span>}
        <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
      </header>
      {/* Outside the state switch: a dead spawn leaves the session `failed` with no branch of
          its own, and the message has to survive the respawn's `session` event. */}
      {lastError && (
        <p className="meta" data-student-error>
          Could not start: {lastError.message} — retrying…
        </p>
      )}
      {editing ? (
        <WsEntry
          initial={c.ws}
          onConfirm={(w) => {
            setEditing(false);
            if (wsKey(w) !== wsKey(c.ws)) onChangeWs(w);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <main className="center">
          {view.state === "awaiting-remote" && view.localWire && !scanning && (
            <>
              <QrView wire={view.localWire} role="offer" ws={c.ws} />
              <p>Waiting for teacher</p>
              <button onClick={() => setScanning(true)}>Show camera</button>
            </>
          )}
          {view.state === "awaiting-remote" && scanning && (
            <>
              <Scanner onWire={onWire} onError={onScanError} resetKey={scanResetKey} />
              <p>Hold the phone's code up to the camera</p>
              <button className="secondary" onClick={() => setScanning(false)}>
                Back to my code
              </button>
            </>
          )}
          {view.state === "connecting" && <h2>Connecting…</h2>}
          {(view.state === "connected" || view.state === "degraded") &&
            (media.broadcast.on && media.teacherTrack ? (
              <>
                <VideoView
                  track={media.teacherTrack}
                  className="teacher-video"
                  data-teacher={media.broadcast.source ?? "video"}
                  onPlaying={() => setPlaying(true)}
                />
                {!playing && (
                  <p className="caption">
                    Teacher's {media.broadcast.source === "screen" ? "screen" : "camera"}
                  </p>
                )}
              </>
            ) : (
              <h2 style={{ color: "var(--muted)" }}>Ready</h2>
            ))}
          {(view.state === "gathering" || view.state === "idle" || view.state === "none") && (
            <h2>Starting…</h2>
          )}
        </main>
      )}
      {showId && (
        <div className="overlay-id" style={{ "--id-len": c.ws.length } as CSSProperties}>
          {c.ws}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
