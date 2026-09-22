export function WsConflict({
  urlWs,
  storedWs,
  onPick,
}: {
  urlWs: string;
  storedWs: string;
  onPick: (ws: string) => void;
}) {
  return (
    <div className="center">
      <h1>Which workstation is this?</h1>
      <p>
        This iPad was workstation <b>{storedWs}</b>, but the address says <b>{urlWs}</b>.
      </p>
      <div style={{ display: "flex", gap: 16 }}>
        <button onClick={() => onPick(urlWs)}>Switch to {urlWs}</button>
        <button className="secondary" onClick={() => onPick(storedWs)}>
          Stay {storedWs}
        </button>
      </div>
    </div>
  );
}
