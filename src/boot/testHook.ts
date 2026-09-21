declare global {
  interface Window {
    __lab?: { role: string; inject(wire: string): Promise<string | void> };
  }
}
/**
 * E2E tests and manual cross-tab checks bypass cameras by calling window.__lab.inject(wire) with
 * what the QR would carry. The teacher's hook resolves with the encoded answer wire.
 */
export function registerTestHook(
  role: string,
  inject: (wire: string) => Promise<string | void>,
): void {
  window.__lab = { role, inject };
}
