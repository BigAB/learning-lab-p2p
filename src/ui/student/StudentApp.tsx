import { useCallback, useEffect, useRef, useState } from "react";
import type { StudentController } from "../../core/studentController";
import { decodeWire } from "../../core/sdpCodec";
import { usePromise } from "../../hooks/usePromise";
import { useSessionView } from "../../hooks/useSessionView";
import { useStudent } from "../../hooks/useStudent";
import { APP_VERSION } from "../platform/appVersion";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";
import { StatusPill } from "../shared/StatusPill";

export function StudentApp({ boot }: { boot: Promise<StudentController> }) {
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
  return <StudentView c={c} />;
}

function StudentView({ c }: { c: StudentController }) {
  const { session, lastCmd, lastError } = useStudent(c);
  const view = useSessionView(session);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  const [showId, setShowId] = useState(false);
  // Bumped whenever a scanned code is rejected, so <Scanner> forgets it and the same QR held up
  // again is decoded a second time instead of being swallowed as a duplicate.
  const [scanResetKey, setScanResetKey] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((msg: string, ms: number) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(undefined), ms);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (view.state === "connected") setScanning(false);
    if (view.state === "failed") showToast("Connection lost — showing a new code", 4000);
  }, [view.state, showToast]);

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
    <div id="student" data-state={view.state}>
      <header className="bar">
        <span className="ws">{c.ws}</span>
        <StatusPill state={view.state} />
        {view.rtt !== undefined && <span className="meta">{view.rtt} ms</span>}
        <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{APP_VERSION}</span>
      </header>
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
        {(view.state === "connected" || view.state === "degraded") && (
          <h2 style={{ color: "var(--muted)" }}>Ready</h2>
        )}
        {(view.state === "gathering" || view.state === "idle" || view.state === "none") && (
          <>
            <h2>Starting…</h2>
            {lastError && (
              <p className="meta" data-student-error>
                {lastError.message}
              </p>
            )}
          </>
        )}
      </main>
      {showId && <div className="overlay-id">{c.ws}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
