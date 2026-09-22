import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootStudent, releaseStudent, resolveWs } from "./boot/bootStudent";
import { bootTeacher } from "./boot/bootTeacher";
import * as codec from "./core/sdpCodec";
import type { StudentController } from "./core/studentController";
import { wsKey } from "./schemas/ws";
import { CourierApp } from "./ui/courier/CourierApp";
import { LoadPage } from "./ui/dev/LoadPage";
import { HomePage } from "./ui/HomePage";
import { StudentApp } from "./ui/student/StudentApp";
import { WsConflict } from "./ui/student/WsConflict";
import { WsEntry } from "./ui/student/WsEntry";
import { TeacherApp } from "./ui/teacher/TeacherApp";
import "./ui/shared/styles.css";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const path = location.pathname.replace(base, "").replace(/\/+$/, "") || "/";

function StudentRoute() {
  const { urlWs, storedWs, urlInvalid } = resolveWs();
  const conflict =
    urlWs !== undefined && storedWs !== undefined && wsKey(urlWs) !== wsKey(storedWs);
  const [ws, setWs] = useState<string | undefined>(conflict ? undefined : (urlWs ?? storedWs));
  const [boot, setBoot] = useState<Promise<StudentController> | undefined>(() =>
    ws !== undefined ? bootStudent(ws) : undefined,
  );
  const pick = (w: string) => {
    setWs(w);
    setBoot(bootStudent(w));
  };
  // Changing ID mid-run: stop the old controller (its PC and offer die with it) and boot afresh.
  const change = (w: string) => {
    if (ws !== undefined) void releaseStudent(ws);
    pick(w);
  };
  if (ws === undefined && urlWs !== undefined && storedWs !== undefined) {
    return <WsConflict urlWs={urlWs} storedWs={storedWs} onPick={pick} />;
  }
  if (boot === undefined) return <WsEntry urlInvalid={urlInvalid} onConfirm={pick} />;
  // A typo'd web-clip URL silently booting the saved workstation is how two iPads end up
  // fighting over one ID; say which one is actually in use.
  return (
    <>
      {urlInvalid && ws !== undefined && (
        <p className="meta" data-ws-notice>
          Invalid ?ws in URL — using saved workstation {ws}
        </p>
      )}
      <StudentApp boot={boot} onChangeWs={change} />
    </>
  );
}

function route() {
  switch (path) {
    case "/student":
      return <StudentRoute />;
    case "/teacher":
      return <TeacherApp boot={bootTeacher()} />;
    case "/courier":
      return <CourierApp />;
    default:
      // Dev only, and inside the default arm rather than its own `case` so that a production
      // build drops the route, its path string and the LoadPage module altogether.
      if (import.meta.env.DEV && path === "/dev/load") return <LoadPage boot={bootTeacher()} />;
      return <HomePage />;
  }
}

declare global {
  interface Window {
    __labCodec?: typeof codec;
  }
}
if (import.meta.env.DEV) window.__labCodec = codec;

createRoot(document.getElementById("root")!).render(<StrictMode>{route()}</StrictMode>);
