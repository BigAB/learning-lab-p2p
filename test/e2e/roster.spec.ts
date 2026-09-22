import { expect, test } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair, tile } from "./helpers";

test("dashboard starts empty and grows one tile per paired station, in natural order", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  await expect(t.page.locator("[data-empty]")).toBeVisible();
  await expect(t.page.locator("[data-tile]")).toHaveCount(0);
  const b = await openStudent(browser, "Row 10");
  const a = await openStudent(browser, "Row 2");
  await pair(t.page, b.page, "Row 10");
  await pair(t.page, a.page, "Row 2");
  await expect(t.page.locator("[data-empty]")).toHaveCount(0);
  await expect(t.page.locator("[data-tile] .num")).toHaveText(["Row 2", "Row 10"]);
  await Promise.all([a.ctx.close(), b.ctx.close(), t.ctx.close()]);
});

test("a second iPad pairing under the same ID (any case) takes over; the tile flags it until the drawer opens", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  const a = await openStudent(browser, "Row2");
  await pair(t.page, a.page, "Row2");
  await expectState(t.page, tile("Row2"), "connected");

  const b = await openStudent(browser, "row2");
  await pair(t.page, b.page, "row2");
  await expect(t.page.locator("[data-tile]")).toHaveCount(1);
  await expectState(t.page, tile("row2"), "connected");
  await expect(t.page.locator(`${tile("row2")} .num`)).toHaveText("row2");
  await expect(t.page.locator(`${tile("row2")} [data-replaced]`)).toBeVisible();
  // The kicked iPad loses its session and offers a fresh code on its own.
  await expect(a.page.locator("#student")).toHaveAttribute("data-state", /failed|awaiting-remote/);
  await expectState(a.page, "#student", "awaiting-remote");

  await t.page.locator(tile("row2")).click();
  await t.page.getByRole("button", { name: "Close" }).click();
  await expect(t.page.locator(`${tile("row2")} [data-replaced]`)).toHaveCount(0);
  await Promise.all([a.ctx.close(), b.ctx.close(), t.ctx.close()]);
});

test("remove deletes the tile; the same iPad can pair again as a new station", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, "Seat 4");
  await pair(t.page, s.page, "Seat 4");
  await expectState(t.page, tile("Seat 4"), "connected");

  t.page.once("dialog", (d) => d.accept());
  await t.page.locator(tile("Seat 4")).click();
  await t.page.locator("[data-action='remove']").click();
  await expect(t.page.locator("[data-tile]")).toHaveCount(0);
  await expect(t.page.locator("[data-empty]")).toBeVisible();
  await expect(t.page.locator("[data-count='connected']")).toHaveText(/0/);

  // Teacher closed our PC: the student fails over to a new offer, which pairs as a fresh station.
  await expectState(s.page, "#student", "awaiting-remote");
  await pair(t.page, s.page, "Seat 4");
  await expectState(t.page, tile("Seat 4"), "connected");
  await Promise.all([s.ctx.close(), t.ctx.close()]);
});

test("v1 blobs are migrated on the first v2 boot and then removed", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      "lab.teacher.v1",
      JSON.stringify({
        roster: { "7": { label: "Row 1 seat 7", pairCount: 3 } },
        settings: { heartbeatMs: 300, degradedMs: 1200, failedMs: 2500 },
      }),
    );
    localStorage.setItem("lab.student.v1", JSON.stringify({ ws: 7, pairCount: 2 }));
  });
  const teacher = await ctx.newPage();
  await teacher.goto("/teacher");
  await expect(teacher.locator(`${tile("7")} .meta`).first()).toHaveText("Row 1 seat 7");
  await expect(teacher.locator("[data-queue-ws='7']")).toBeVisible();
  const teacherKeys = await teacher.evaluate(() => ({
    v2: localStorage.getItem("lab.teacher.v2"),
    v1: localStorage.getItem("lab.teacher.v1"),
  }));
  expect(teacherKeys.v1).toBeNull();
  expect(JSON.parse(teacherKeys.v2!).roster["7"].ws).toBe("7");

  const student = await ctx.newPage();
  await student.goto("/student"); // no query: the migrated ws must be found
  await expect(student.locator(".bar .ws")).toHaveText("7");
  const studentKeys = await student.evaluate(() => ({
    v2: localStorage.getItem("lab.student.v2"),
    v1: localStorage.getItem("lab.student.v1"),
  }));
  expect(studentKeys.v1).toBeNull();
  expect(JSON.parse(studentKeys.v2!).pairCount).toBe(2);
  await ctx.close();
});
