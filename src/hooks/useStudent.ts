import { useEffect, useState } from "react";
import type { PeerSession, SessionState } from "../core/peerSession";
import type { StudentController } from "../core/studentController";
import type { StudentState } from "../schemas/storage";

export function useStudent(c: StudentController) {
  const [session, setSession] = useState<PeerSession | null>(c.session);
  const [state, setState] = useState<StudentState>(c.state);
  const [lastCmd, setLastCmd] = useState<{ cmd: string; at: number } | undefined>();
  const [lastError, setLastError] = useState<{ message: string; at: number } | undefined>();
  useEffect(() => {
    setSession(c.session);
    const offs = [
      // The error is NOT cleared here: a respawn emits `session` immediately, long before the
      // new attempt has produced anything, and dropping the message then would leave the screen
      // blank for the whole backoff window.
      c.on("session", setSession),
      c.on("state", (s) => setState({ ...s })),
      c.on("cmd", (cmd) => setLastCmd({ cmd, at: Date.now() })),
      c.on("error", (message) => setLastError({ message, at: Date.now() })),
    ];
    return () => offs.forEach((off) => off());
  }, [c]);
  // A spawn only counts as recovered once it has something to show (a QR) or is up; clear the
  // error then. Checking the current state too, in case the session got there before we
  // subscribed.
  useEffect(() => {
    if (!session) return;
    const clear = (st: SessionState) => {
      if (st === "awaiting-remote" || st === "connected") setLastError(undefined);
    };
    clear(session.state);
    return session.on("state", clear);
  }, [session]);
  return { session, state, lastCmd, lastError };
}
