import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { SupersededError, type LabController } from "../../core/labController";
import { decodeWire, encodeWire } from "../../core/sdpCodec";
import { useLabRoster } from "../../hooks/useLabRoster";
import { usePromise } from "../../hooks/usePromise";
import { WsSchema } from "../../schemas/ws";
import { Tile } from "../teacher/Tile";

export function LoadPage({ boot }: { boot: Promise<LabController> }) {
  const { value: lab } = usePromise(boot);
  const [count, setCount] = useState(30);
  if (!lab)
    return (
      <div className="center">
        <h1>Starting…</h1>
      </div>
    );
  return <Load lab={lab} count={count} setCount={setCount} />;
}

function Load({
  lab,
  count,
  setCount,
}: {
  lab: LabController;
  count: number;
  setCount: (n: number) => void;
}) {
  const { tiles, counts } = useLabRoster(lab);
  const wsList = useMemo(() => Array.from({ length: count }, (_, i) => String(i + 1)), [count]);

  useEffect(() => {
    // Declared here, not at module scope: a top-level z.object() call is a side effect rollup
    // cannot prove away, which kept this dev-only module (and its message names) in the
    // production bundle even once main.tsx stopped routing to it.
    const OfferMsg = z.object({
      type: z.literal("lab-offer"),
      ws: WsSchema,
      wire: z.string().startsWith("LAB2:"),
    });
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== location.origin) return;
      const m = OfferMsg.safeParse(ev.data);
      if (!m.success) return;
      void (async () => {
        try {
          const answer = await lab.acceptOffer(await decodeWire(m.data.wire));
          (ev.source as Window | null)?.postMessage(
            { type: "lab-answer", wire: await encodeWire(answer) },
            location.origin,
          );
        } catch (e: unknown) {
          if (e instanceof SupersededError) return;
          console.warn("[dev/load]", e);
        }
      })();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [lab]);

  return (
    <div>
      <header className="bar">
        <strong>Load test</strong>
        <label>
          Students{" "}
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            data-load-count
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <span style={{ color: "var(--green)" }}>● {counts.connected}</span>
        <span style={{ color: "var(--amber)" }}>● {counts.degraded}</span>
        <span style={{ color: "var(--red)" }}>● {counts.failed + counts.never}</span>
      </header>
      <main className="grid">
        {tiles.slice(0, count).map((t) => (
          <Tile key={t.key} t={t} onClick={() => {}} />
        ))}
      </main>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4, padding: 12 }}>
        {wsList.map((ws) => (
          <iframe
            key={ws}
            title={`student ${ws}`}
            src={`${import.meta.env.BASE_URL}student?ws=${ws}&autopair=1`}
            style={{ width: "100%", height: 120, border: 0, background: "#000" }}
          />
        ))}
      </div>
    </div>
  );
}
