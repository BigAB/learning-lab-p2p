import { expect, test } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair, readPayload } from "./helpers";

test("student shows an offer QR on load", async ({ browser }) => {
  const s = await openStudent(browser, 7);
  await expect(s.page.locator(".bar .ws")).toHaveText("7");
  await expectState(s.page, "#student", "awaiting-remote");
  await expect(
    s.page.locator("canvas[data-payload][data-role='offer'][data-ws='7']"),
  ).toBeVisible();
  await s.ctx.close();
});

test("full pairing: both sides connected, heartbeats produce rtt", async ({ browser }) => {
  const t = await openTeacher(browser);
  const s = await openStudent(browser, 7);
  await pair(t.page, s.page, 7);
  await expectState(s.page, "#student", "connected");
  await expectState(t.page, "[data-tile='7']", "connected");
  await expect(t.page.locator("[data-tile='7'] [data-rtt]")).toBeVisible();
  await expect(t.page.locator("[data-count='connected']")).toHaveText(/1/);
  await expect(t.page.locator("[data-queue-ws='7']")).toHaveCount(0);
  await s.ctx.close();
  await t.ctx.close();
});

test("student loss → degraded → failed → repair queue → re-pair succeeds", async ({ browser }) => {
  const t = await openTeacher(browser);
  const s1 = await openStudent(browser, 3);
  await pair(t.page, s1.page, 3);
  await expectState(t.page, "[data-tile='3']", "connected");
  await s1.ctx.close();
  await expect(t.page.locator("[data-tile='3']")).toHaveAttribute("data-state", /degraded|failed/, {
    timeout: 5000,
  });
  await expectState(t.page, "[data-tile='3']", "failed", 8000);
  await expect(t.page.locator("[data-queue-ws='3']")).toBeVisible();
  const s2 = await openStudent(browser, 3);
  await pair(t.page, s2.page, 3);
  await expectState(t.page, "[data-tile='3']", "connected");
  await expectState(s2.page, "#student", "connected");
  await s2.ctx.close();
  await t.ctx.close();
});

test("student survives teacher disappearance by showing a fresh offer", async ({ browser }) => {
  const t = await openTeacher(browser);
  // The student's shipped timers (15 s degraded, 60 s failed) outlast any sane e2e wait and
  // Chromium's ICE consent failure does not land inside it either, so drive the student with the
  // dev-only `?timers=` override instead of loosening the assertion.
  const s = await openStudent(browser, 5, "timers=300,1200,2500");
  const firstOffer = await readPayload(s.page, "offer", 5);
  await pair(t.page, s.page, 5);
  await expectState(s.page, "#student", "connected");
  await t.ctx.close();
  await expectState(s.page, "#student", "awaiting-remote", 45_000);
  const secondOffer = await s.page
    .locator("canvas[data-payload][data-role='offer']")
    .getAttribute("data-payload");
  expect(secondOffer).not.toBe(firstOffer);
  await s.ctx.close();
});

test("two students pair independently", async ({ browser }) => {
  const t = await openTeacher(browser);
  const a = await openStudent(browser, 1);
  const b = await openStudent(browser, 2);
  await pair(t.page, a.page, 1);
  await pair(t.page, b.page, 2);
  await expectState(t.page, "[data-tile='1']", "connected");
  await expectState(t.page, "[data-tile='2']", "connected");
  await expect(t.page.locator("[data-count='connected']")).toHaveText(/2/);
  await Promise.all([a.ctx.close(), b.ctx.close(), t.ctx.close()]);
});

test("garbage injected into the student is rejected without breaking the session", async ({
  browser,
}) => {
  const s = await openStudent(browser, 9);
  await expectState(s.page, "#student", "awaiting-remote");
  await expect(s.page.evaluate(() => window.__lab!.inject("LAB1:garbage00"))).rejects.toThrow();
  await expectState(s.page, "#student", "awaiting-remote");
  await s.ctx.close();
});
