import { expect, test } from "@playwright/test";
import { expectState } from "./helpers";

/**
 * An iPad Home Screen web app launches without the `?ws=` it was added from, and its storage is
 * isolated from Safari's, so on first launch the student page knows nothing. It must offer a
 * one-time picker instead of a dead end, and remember the answer.
 */
test("student without ?ws and no saved workstation gets a picker that persists", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student");
  await expect(page.locator("[data-ws-pick]")).toHaveCount(30);
  await page.locator("[data-ws-pick='7']").click();
  await expect(page.locator(".bar .ws")).toHaveText("7");
  await expectState(page, "#student", "awaiting-remote");

  await page.goto("/student"); // next launch, still no query string
  await expect(page.locator("[data-ws-pick]")).toHaveCount(0);
  await expect(page.locator(".bar .ws")).toHaveText("7");
  await ctx.close();
});

test("manifest has no start_url, so iOS keeps the URL the app was added from", async ({
  request,
}) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as Record<string, unknown>;
  expect(manifest.start_url).toBeUndefined();
  expect(manifest.display).toBe("standalone");
});
