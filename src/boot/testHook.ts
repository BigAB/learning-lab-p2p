declare global {
  interface Window {
    __lab?: { role: string; inject(wire: string): Promise<string | void> };
  }
}
/**
 * E2E tests and manual cross-tab checks bypass cameras by calling window.__lab.inject(wire) with
 * what the QR would carry. The teacher's hook resolves with the encoded answer wire.
 *
 * Dev builds only: Playwright runs against `pnpm dev`, and a production bundle must not hand a
 * remote-injection entry point to anything that can reach the page. Callers guard too, so the
 * whole hook (and the `__lab` name) is dead code a production build drops.
 */
export function registerTestHook(
  role: string,
  inject: (wire: string) => Promise<string | void>,
): void {
  if (!import.meta.env.DEV) return;
  window.__lab = { role, inject };
}
