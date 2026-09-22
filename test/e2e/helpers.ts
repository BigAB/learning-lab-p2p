import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const SHORT_TIMERS = { heartbeatMs: 300, degradedMs: 1200, failedMs: 2500 };

/** Selector for a station's tile: `data-tile` carries wsKey(ws). */
export const tile = (ws: string) => `[data-tile='${ws.toLowerCase()}']`;

/**
 * `roster` seeds persisted per-station metadata as if from an earlier lab day. Keys are wsKey;
 * every entry needs its display `ws`.
 */
export async function openTeacher(
  browser: Browser,
  settings = SHORT_TIMERS,
  roster: Record<string, { ws: string; pairCount: number; [k: string]: unknown }> = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  await ctx.addInitScript(
    ({ settings, roster }) => {
      localStorage.setItem("lab.teacher.v2", JSON.stringify({ roster, settings }));
    },
    { settings, roster },
  );
  const page = await ctx.newPage();
  await page.goto("/teacher");
  await expect(page.locator("[data-action='scan']")).toBeVisible();
  return { ctx, page };
}

/** `query` appends dev-only params (e.g. `timers=300,1200,2500`) to the student URL. */
export async function openStudent(
  browser: Browser,
  ws: string,
  query = "",
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto(`/student?ws=${encodeURIComponent(ws)}${query ? `&${query}` : ""}`);
  return { ctx, page };
}

export async function readPayload(
  page: Page,
  role: "offer" | "answer",
  ws: string,
): Promise<string> {
  const loc = page.locator(`canvas[data-payload][data-role='${role}'][data-ws='${ws}']`);
  await expect(loc).toHaveAttribute("data-payload", /^LAB2:/);
  return (await loc.getAttribute("data-payload"))!;
}

/** Simulates the courier: student offer → teacher, teacher answer → student. */
export async function pair(teacher: Page, student: Page, ws: string): Promise<void> {
  const offer = await readPayload(student, "offer", ws);
  const answer = await teacher.evaluate((w) => window.__lab!.inject(w), offer);
  expect(typeof answer).toBe("string");
  await student.evaluate((w) => window.__lab!.inject(w), answer as string);
}

export async function expectState(page: Page, selector: string, state: string, timeout = 15_000) {
  await expect(page.locator(selector)).toHaveAttribute("data-state", state, { timeout });
}
