import { expect, test } from "@playwright/test";
import { expectState, openStudent, openTeacher, pair } from "./helpers";

const STORED_FP = new Array(32).fill("AB").join(":");

test("fingerprint continuity verdict appears only once the tile has a live session", async ({
  browser,
}) => {
  const t = await openTeacher(browser, undefined, {
    "4": { pairCount: 1, lastFingerprint: STORED_FP },
  });
  await t.page.locator("[data-tile='4']").click();
  const fp = t.page.locator("[data-fingerprint]");
  // Persisted evidence from a previous day is still worth showing…
  await expect(fp).toContainText("AB:AB:AB:AB:AB:AB:AB:AB");
  // …but "same device as last pairing" is a claim about *this* pairing, and there is none yet.
  await expect(fp).not.toContainText(/same device|different device/);
  await t.page.getByRole("button", { name: "Close" }).click();

  const s = await openStudent(browser, 4);
  await pair(t.page, s.page, 4);
  await expectState(t.page, "[data-tile='4']", "connected");
  await t.page.locator("[data-tile='4']").click();
  // The e2e student uses a fresh certificate, so the stored 0xAB… fingerprint cannot match.
  await expect(t.page.locator("[data-fingerprint]")).toContainText("different device");
  await s.ctx.close();
  await t.ctx.close();
});
