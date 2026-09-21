import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootStudent, resolveWs } from "./boot/bootStudent";
import { bootTeacher } from "./boot/bootTeacher";
import type { StudentController } from "./core/studentController";
import { CourierApp } from "./ui/courier/CourierApp";
import { HomePage } from "./ui/HomePage";
import { StudentApp } from "./ui/student/StudentApp";
import { WsConflict } from "./ui/student/WsConflict";
import { TeacherApp } from "./ui/teacher/TeacherApp";
import "./ui/shared/styles.css";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const path = location.pathname.replace(base, "").replace(/\/+$/, "") || "/";

function StudentRoute() {
  const { urlWs, storedWs } = resolveWs();
  const [ws, setWs] = useState<number | undefined>(
    urlWs !== undefined && storedWs !== undefined && urlWs !== storedWs
      ? undefined
      : (urlWs ?? storedWs),
  );
  const [boot, setBoot] = useState<Promise<StudentController> | undefined>(() =>
    ws !== undefined ? bootStudent(ws) : undefined,
  );
  if (ws === undefined && urlWs !== undefined && storedWs !== undefined) {
    return (
      <WsConflict
        urlWs={urlWs}
        storedWs={storedWs}
        onPick={(w) => {
          setWs(w);
          setBoot(bootStudent(w));
        }}
      />
    );
  }
  if (boot === undefined)
    return (
      <div className="center">
        <h1>Open this page as /student?ws=N (1–30)</h1>
      </div>
    );
  return <StudentApp boot={boot} />;
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
      return <HomePage />;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode>{route()}</StrictMode>);
