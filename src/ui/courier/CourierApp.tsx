import { useCallback, useEffect, useRef, useState } from "react";
import type { SdpPayload } from "../../schemas/sdpPayload";
import { decodeWire } from "../../core/sdpCodec";
import { QrView } from "../shared/QrView";
import { Scanner } from "../shared/Scanner";

type Held = { wire: string; payload: SdpPayload };

export function CourierApp() {
  const [held, setHeld] = useState<Held | undefined>();
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const showFlash = useCallback(() => {
    clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = setTimeout(() => setFlash(false), 600);
  }, []);

  const onWire = useCallback(
    (wire: string) => {
      void decodeWire(wire).then(
        (payload) => setHeld({ wire, payload }),
        () => showFlash(),
      );
    },
    [showFlash],
  );

  const onError = useCallback((e: Error) => setError(e.message), []);

  if (held) {
    const { payload } = held;
    const target =
      payload.role === "offer" ? "show to the TEACHER station" : `show to iPad ${payload.ws}`;
    return (
      <div className="center" data-courier="holding">
        <h2>
          ws {payload.ws} · {payload.role.toUpperCase()}
        </h2>
        <QrView
          wire={held.wire}
          role={payload.role}
          ws={payload.ws}
          size={Math.min(window.innerWidth - 32, 520)}
        />
        <p>Now {target}.</p>
        <button onClick={() => setHeld(undefined)}>Done — scan next</button>
      </div>
    );
  }
  return (
    <div
      className="center"
      data-courier="scanning"
      style={{ background: flash ? "var(--red)" : undefined }}
    >
      <h2>Point at a code</h2>
      <Scanner onWire={onWire} onError={onError} />
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
    </div>
  );
}
