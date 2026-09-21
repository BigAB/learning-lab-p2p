import { useCallback, useEffect, useRef, useState } from "react";
import { SupersededError, type LabController } from "../../core/labController";
import { decodeWire, encodeWire } from "../../core/sdpCodec";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";

export function ScanModal({ lab, onClose }: { lab: LabController; onClose: () => void }) {
  const [answer, setAnswer] = useState<{ wire: string; ws: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [pending, setPending] = useState(false);
  // Synchronous guard: onWire fires from a requestAnimationFrame loop, so a second scan can land
  // before the `pending` state update from the first has re-rendered. A ref makes the "already
  // answering one offer" check immediate instead of racing the render.
  const busy = useRef(false);
  const deviceId = lab.settings.cameraDeviceId;

  useEffect(() => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((x) => x.kind === "videoinput")));
  }, []);

  const onWire = useCallback(
    (wire: string) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      void (async () => {
        try {
          const p = await decodeWire(wire);
          if (p.role !== "offer") throw new Error("That is an answer code; scan a student's offer");
          const a = await lab.acceptOffer(p);
          setAnswer({ wire: await encodeWire(a), ws: p.ws });
          setError(undefined);
        } catch (e) {
          // A same-ws re-scan supersedes the pending acceptOffer() for that workstation; the
          // superseding scan is the one that matters, so this rejection is not a user-facing error.
          if (e instanceof SupersededError) return;
          setError((e as Error).message);
        } finally {
          busy.current = false;
          setPending(false);
        }
      })();
    },
    [lab],
  );

  const onScanError = useCallback((e: Error) => setError(e.message), []);

  return (
    <div className="modal">
      <div className="card">
        {!answer ? (
          <>
            <h2>Scan a student's code</h2>
            <Scanner {...(deviceId ? { deviceId } : {})} onWire={onWire} onError={onScanError} />
            {pending && <p className="meta">Processing…</p>}
            {devices.length > 1 && (
              <select
                value={deviceId ?? ""}
                onChange={(e) => lab.updateSettings({ cameraDeviceId: e.target.value })}
              >
                <option value="">Default camera</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId.slice(0, 8)}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : (
          <>
            <h2>Answer for workstation {answer.ws}</h2>
            <QrView wire={answer.wire} role="answer" ws={answer.ws} size={420} />
            <p>Scan this with the phone, then show the phone to iPad {answer.ws}.</p>
            <button onClick={() => setAnswer(undefined)}>Done — scan next</button>
          </>
        )}
        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
