import { useEffect, useState } from "react";
import type { PeerSession, SessionState } from "../core/peerSession";
import type { StudentController, StudentMediaView } from "../core/studentController";
import type { StudentState } from "../schemas/storage";

/** Field-wise equality: the controller emits a fresh view per link event, most of them unchanged. */
function sameMediaView(a: StudentMediaView, b: StudentMediaView): boolean {
  return (
    a.state === b.state &&
    a.cam === b.cam &&
    a.reason === b.reason &&
    a.teacherTrack === b.teacherTrack &&
    a.broadcast.on === b.broadcast.on &&
    a.broadcast.source === b.broadcast.source &&
    (a.send === b.send ||
      (a.send !== null &&
        b.send !== null &&
        a.send.height === b.send.height &&
        a.send.fps === b.send.fps &&
        a.send.kbps === b.send.kbps))
  );
}

export function useStudent(c: StudentController) {
  const [session, setSession] = useState<PeerSession | null>(c.session);
  const [state, setState] = useState<StudentState>(c.state);
  const [lastCmd, setLastCmd] = useState<{ cmd: string; at: number } | undefined>();
  const [lastError, setLastError] = useState<{ message: string; at: number } | undefined>();
  const [media, setMedia] = useState<StudentMediaView>(() => c.mediaView());
  useEffect(() => {
    setSession(c.session);
    const update = (v: StudentMediaView) => setMedia((prev) => (sameMediaView(prev, v) ? prev : v));
    update(c.mediaView());
    const offs = [
      // The error is NOT cleared here: a respawn emits `session` immediately, long before the
      // new attempt has produced anything, and dropping the message then would leave the screen
      // blank for the whole backoff window.
      c.on("session", setSession),
      c.on("state", (s) => setState({ ...s })),
      c.on("cmd", (cmd) => setLastCmd({ cmd, at: Date.now() })),
      c.on("error", (message) => setLastError({ message, at: Date.now() })),
      c.on("media", update),
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
  return { session, state, lastCmd, lastError, media };
}
