import { APP_VERSION } from "./platform/appVersion";
export function HomePage() {
  return (
    <div className="center">
      <h1>Learning Lab</h1>
      <p>
        <a href="teacher">Teacher</a> · <a href="courier">Courier</a> ·{" "}
        <a href="student?ws=1">Student 1</a>
      </p>
      <p style={{ color: "var(--muted)" }}>{APP_VERSION}</p>
    </div>
  );
}
