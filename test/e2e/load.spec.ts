import { expect, test } from "@playwright/test";

/**
 * /dev/load runs N auto-pairing student iframes against one LabController on a single page.
 * All iframes share the page's localStorage origin, so every student overwrites lab.student.v2;
 * an autopair iframe must therefore take its ws from the URL and never raise the conflict prompt.
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

test("dev/load iframes ignore a stored workstation ID that differs from their URL", async ({
  page,
}) => {
  // The first iframe to boot persists its ws; with 30 iframes most of the rest read storage after
  // that write and would see "This iPad was 1, the address says N". Seed the worst case up front.
  await page.addInitScript(() => {
    localStorage.setItem("lab.student.v2", JSON.stringify({ ws: "99", pairCount: 0 }));
  });
  await page.goto("/dev/load");
  const count = page.locator("[data-load-count]");
  await count.fill("5");
  await count.dispatchEvent("change");
  await expect(page.locator("[data-tile][data-state='connected']")).toHaveCount(5, {
    timeout: 30_000,
  });
  for (const ws of ["1", "2", "3", "4", "5"]) {
    const frame = page.frameLocator(`iframe[title='student ${ws}']`);
    await expect(frame.locator("h1", { hasText: "Which workstation" })).toHaveCount(0);
    await expect(frame.locator(".bar .ws")).toHaveText(ws);
  }
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
