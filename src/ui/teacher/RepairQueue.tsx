export function RepairQueue({ queue }: { queue: number[] }) {
  return (
    <aside className="side" data-repair-queue>
      <h3>Needs re-pair ({queue.length})</h3>
      {queue.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>All stations connected.</p>
      ) : (
        <ol>
          {queue.map((ws) => (
            <li key={ws} data-queue-ws={ws}>
              Workstation {ws}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
