import { expect, test } from "@playwright/test";

/**
 * /dev/load runs N auto-pairing student iframes against one LabController on a single page.
 * All iframes share the page's localStorage origin (each student overwrites lab.student.v1),
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
