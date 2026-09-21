import { useEffect, useState } from "react";
import type { PeerSession } from "../core/peerSession";
import type { StudentController } from "../core/studentController";
import type { StudentState } from "../schemas/storage";

export function useStudent(c: StudentController) {
  const [session, setSession] = useState<PeerSession | null>(c.session);
  const [state, setState] = useState<StudentState>(c.state);
  const [lastCmd, setLastCmd] = useState<{ cmd: string; at: number } | undefined>();
  useEffect(() => {
    setSession(c.session);
    const offs = [
      c.on("session", setSession),
      c.on("state", (s) => setState({ ...s })),
      c.on("cmd", (cmd) => setLastCmd({ cmd, at: Date.now() })),
    ];
    return () => offs.forEach((off) => off());
  }, [c]);
  return { session, state, lastCmd };
}
