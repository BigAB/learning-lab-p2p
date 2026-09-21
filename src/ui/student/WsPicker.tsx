import { WS_MAX, WS_MIN } from "../../schemas/ws";

const ALL_WS = Array.from({ length: WS_MAX - WS_MIN + 1 }, (_, i) => WS_MIN + i);

/**
 * First launch with nothing to go on: no `?ws=` in the URL and nothing saved. A Home Screen web
 * app on iPadOS gets here whenever it was added without the query string — its storage is
 * isolated from Safari's, so a workstation chosen in Safari earlier is invisible. One tap here
 * persists the number into the app's own storage, so this screen shows once per iPad.
 */
export function WsPicker({
  urlInvalid,
  onPick,
}: {
  urlInvalid: boolean;
  onPick: (ws: number) => void;
}) {
  return (
    <div className="center">
      <h1>Which workstation is this iPad?</h1>
      {urlInvalid && (
        <p className="meta" data-ws-notice>
          The ?ws value in this URL is not a workstation number (1–30).
        </p>
      )}
      <div className="ws-picker">
        {ALL_WS.map((ws) => (
          <button key={ws} data-ws-pick={ws} onClick={() => onPick(ws)}>
            {ws}
          </button>
        ))}
      </div>
      <p className="meta">Pick once; this iPad remembers it.</p>
    </div>
  );
}
