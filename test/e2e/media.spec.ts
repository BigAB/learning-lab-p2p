import { expect, test, type Page } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair, tile } from "./helpers";

interface Stats {
  cpuLimited: boolean;
  inHeight?: number;
  framesDecoded?: number;
}

const stats = (page: Page, ws: string) =>
  page.evaluate((w) => window.__lab!.mediaStats!(w), ws) as Promise<Stats | undefined>;

test("cameras, focus and broadcast flow both ways over loopback", async ({ browser }) => {
  test.setTimeout(120_000);
  const t = await openTeacher(browser);
  const s = await openStudent(browser, "Row 7");
  await pair(t.page, s.page, "Row 7");
  await expectState(t.page, tile("Row 7"), "connected");

  // One negotiation, right after hello.
  const thumb = t.page.locator(`${tile("Row 7")} .thumb`);
  await expect(thumb).toHaveAttribute("data-media-state", "ready", { timeout: 15_000 });
  await expect(thumb).toHaveAttribute("data-cam", "off");
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "off");

  // Cameras on → the student captures and the teacher decodes a ≤180p thumbnail.
  await t.page.locator("[data-action='cameras']").click();
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "on", { timeout: 15_000 });
  await expect(thumb).toHaveAttribute("data-cam", "on", { timeout: 15_000 });
  await expect(t.page.locator(`${tile("Row 7")} video`)).toBeVisible();
  await expect
    .poll(async () => (await stats(t.page, "Row 7"))?.framesDecoded ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await stats(t.page, "Row 7"))?.inHeight ?? 9999, { timeout: 30_000 })
    .toBeLessThanOrEqual(180);
  await expect(t.page.locator("[data-media-summary]")).toContainText("1 on");

  // Focus → the same track, re-parameterised to ≥360p (Chrome ramps over a few seconds).
  await t.page.locator(`${tile("Row 7")} video`).click();
  await expect(t.page.locator("[data-focus='row 7']")).toBeVisible();
  await expect
    .poll(async () => (await stats(t.page, "Row 7"))?.inHeight ?? 0, { timeout: 45_000 })
    .toBeGreaterThanOrEqual(360);

  // Share camera → the student renders the teacher's video.
  await t.page.locator("[data-action='share-camera']").click();
  const teacherVideo = s.page.locator("video[data-teacher]");
  await expect(teacherVideo).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => teacherVideo.evaluate((v) => (v as HTMLVideoElement).videoWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(s.page.locator(".caption")).toHaveCount(0, { timeout: 15_000 });

  // Stop → placeholder is back; Escape clears focus; Cameras off → capture released.
  await t.page.locator("[data-action='share-stop']").click();
  await expect(teacherVideo).toHaveCount(0, { timeout: 10_000 });
  await expect(s.page.locator("#student h2")).toHaveText("Ready");
  await t.page.keyboard.press("Escape");
  await expect(t.page.locator("[data-focus]")).toHaveCount(0);
  await t.page.locator("[data-action='cameras']").click();
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "off", { timeout: 15_000 });
  await expect.poll(() => s.page.evaluate(() => window.__lab!.activeTracks!())).toBe(0);
  await expect(thumb).toHaveAttribute("data-cam", "off", { timeout: 15_000 });

  await s.ctx.close();
  await t.ctx.close();
});

test("a student that loses its session stops its camera and re-pairs with media none", async ({
  browser,
}) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, "Row 8", "timers=300,1200,2500");
  await pair(t.page, s.page, "Row 8");
  const thumb = t.page.locator(`${tile("Row 8")} .thumb`);
  await expect(thumb).toHaveAttribute("data-media-state", "ready", { timeout: 15_000 });
  await t.page.locator("[data-action='cameras']").click();
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "on", { timeout: 15_000 });
  await t.ctx.close();
  await expectState(s.page, "#student", "awaiting-remote", 45_000);
  await expect(s.page.locator("#student")).toHaveAttribute("data-cam", "off");
  await expect.poll(() => s.page.evaluate(() => window.__lab!.activeTracks!())).toBe(0);
  await s.ctx.close();
});
