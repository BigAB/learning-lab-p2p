import { expect, test } from "@playwright/test";
import { expectState } from "./helpers";

/**
 * An iPad Home Screen web app launches without the `?ws=` it was added from, and its storage is
 * isolated from Safari's, so on first launch the student page knows nothing. It must offer a
 * one-time typed entry instead of a dead end, remember the answer, and let a typo be fixed.
 */
test("student without ?ws and no saved workstation types an ID that persists", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student");
  const input = page.locator("[data-ws-input]");
  await expect(input).toBeVisible();
  await expect(page.locator("[data-ws-confirm]")).toBeDisabled();
  await input.fill("Row#2");
  await expect(page.locator("[data-ws-issue]")).toContainText("Letters, digits");
  await expect(page.locator("[data-ws-confirm]")).toBeDisabled();
  await input.fill("  Row   2 ");
  await page.locator("[data-ws-confirm]").click();
  await expect(page.locator(".bar .ws")).toHaveText("Row 2");
  await expectState(page, "#student", "awaiting-remote");

  await page.goto("/student"); // next launch, still no query string
  await expect(page.locator("[data-ws-input]")).toHaveCount(0);
  await expect(page.locator(".bar .ws")).toHaveText("Row 2");
  await ctx.close();
});

test("tapping the ID in the status bar lets the student fix a typo; the new ID gets a new offer", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student?ws=Rwo2");
  await expect(page.locator(".bar .ws")).toHaveText("Rwo2");
  const firstOffer = page.locator("canvas[data-payload][data-role='offer'][data-ws='Rwo2']");
  await expect(firstOffer).toHaveAttribute("data-payload", /^LAB2:/);

  await page.locator("[data-ws-change]").click();
  const input = page.locator("[data-ws-input]");
  await expect(input).toHaveValue("Rwo2");
  await page.locator("[data-ws-cancel]").click();
  await expect(page.locator(".bar .ws")).toHaveText("Rwo2");

  await page.locator("[data-ws-change]").click();
  await input.fill("Row2");
  await page.locator("[data-ws-confirm]").click();
  await expect(page.locator(".bar .ws")).toHaveText("Row2");
  await expect(
    page.locator("canvas[data-payload][data-role='offer'][data-ws='Row2']"),
  ).toHaveAttribute("data-payload", /^LAB2:/);
  await expectState(page, "#student", "awaiting-remote");

  await page.goto("/student");
  await expect(page.locator(".bar .ws")).toHaveText("Row2");
  await ctx.close();
});

test("an invalid ?ws with nothing saved shows the entry with a notice", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("/student?ws=Row%232");
  await expect(page.locator("[data-ws-notice]")).toBeVisible();
  await expect(page.locator("[data-ws-input]")).toBeVisible();
  await ctx.close();
});

test("a long typed ID stays inside the status bar on an iPad-width viewport", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    permissions: ["camera"],
    viewport: { width: 768, height: 1024 },
  });
  const page = await ctx.newPage();
  // A single 24-char token (the legal max, no spaces to wrap at) is the worst case: it stresses
  // overflow-wrap rather than the browser's free word-wrapping.
  const id = "BackRowLeftSeatNumberXXX";
  await page.goto(`/student?ws=${id}`);
  await expect(page.locator(".bar .ws")).toHaveText(id);
  const barBox = (await page.locator(".bar").boundingBox())!;
  const wsBox = (await page.locator(".bar .ws").boundingBox())!;
  expect(barBox.width).toBeLessThanOrEqual(768);
  expect(wsBox.width).toBeLessThanOrEqual(768);
  // The un-breakable token must not force the whole bar wider than the viewport — that pushes
  // the status pill/version off-screen even though each element's own box still reports <= 768.
  const overflow = await page.locator(".bar").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
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
