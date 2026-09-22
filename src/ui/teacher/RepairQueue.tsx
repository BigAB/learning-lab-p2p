import { wsKey } from "../../schemas/ws";

export function RepairQueue({ queue }: { queue: string[] }) {
  return (
    <aside className="side" data-repair-queue>
      <h3>Needs re-pair ({queue.length})</h3>
      {queue.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>All stations connected.</p>
      ) : (
        <ol>
          {queue.map((ws) => (
            <li key={wsKey(ws)} data-queue-ws={wsKey(ws)}>
              Workstation {ws}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
