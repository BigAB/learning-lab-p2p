import { expect, test } from "@playwright/test";

/**
 * /dev/load runs N auto-pairing student iframes against one LabController on a single page.
 * All iframes share the page's localStorage origin (each student overwrites lab.student.v2),
 * which is fine here since ws comes from the iframe's URL, not from persisted state.
 */
test("dev/load pairs 5 students against one teacher", async ({ page }) => {
  await page.goto("/dev/load");
  const count = page.locator("[data-load-count]");
  await count.fill("5");
  await count.dispatchEvent("change");
  await expect(page.locator("[data-tile][data-state='connected']")).toHaveCount(5, {
    timeout: 30_000,
  });
});

test("dev/load streams 5 thumbnails and a camera broadcast", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/dev/load");
  const count = page.locator("[data-load-count]");
  await count.fill("5");
  await count.dispatchEvent("change");
  await expect(page.locator("[data-tile][data-state='connected']")).toHaveCount(5, {
    timeout: 30_000,
  });
  await expect(page.locator(".thumb[data-media-state='ready']")).toHaveCount(5, {
    timeout: 30_000,
  });
  await page.locator("[data-action='cameras']").click();
  await expect(page.locator(".thumb[data-cam='on']")).toHaveCount(5, { timeout: 30_000 });
  await page.locator("[data-action='share-camera']").click();
  await expect(page.locator("[data-action='share-stop']")).toBeVisible();
  // Every station decodes the teacher and the teacher decodes every station.
  for (const ws of ["1", "2", "3", "4", "5"]) {
    await expect
      .poll(
        async () =>
          Number(await page.locator(`[data-stats-row='${ws}'] td:nth-child(8)`).textContent()),
        {
          timeout: 45_000,
        },
      )
      .toBeGreaterThan(0);
    const frame = page.frameLocator(`iframe[title='student ${ws}']`);
    await expect(frame.locator("video[data-teacher]")).toBeVisible({ timeout: 30_000 });
  }
});
