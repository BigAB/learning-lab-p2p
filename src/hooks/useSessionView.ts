import { useEffect, useState } from "react";
import type { PeerSession, SessionState } from "../core/peerSession";
import { encodeWire } from "../core/sdpCodec";

export interface SessionView {
  state: SessionState | "none";
  localWire?: string;
  localRole?: "offer" | "answer";
  rtt?: number;
}

export function useSessionView(session: PeerSession | null): SessionView {
  const [view, setView] = useState<SessionView>({ state: session?.state ?? "none" });
  useEffect(() => {
    if (!session) {
      setView({ state: "none" });
      return;
    }
    setView({
      state: session.state,
      ...(session.lastRtt !== undefined ? { rtt: session.lastRtt } : {}),
    });
    const offs = [
      session.on("state", (s) => setView((v) => ({ ...v, state: s }))),
      session.on("rtt", (rtt) => setView((v) => ({ ...v, rtt }))),
      session.on("localPayload", (p) => {
        void encodeWire(p).then((localWire) =>
          setView((v) => ({ ...v, localWire, localRole: p.role })),
        );
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [session]);
  return view;
}
