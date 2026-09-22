import { z } from "zod";

export const WS_MAX_LEN = 24;
/** Letters, digits, space, dash, underscore: typed on an iPad, read across a room, put in a QR. */
export const WS_CHARS = /^[A-Za-z0-9 _-]+$/;

/**
 * Workstation ID as typed on the iPad, tidied: trimmed, inner whitespace collapsed to one space.
 * The parsed value is the *display form*. Use wsKey() for equality and for map keys.
 */
export const WsSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Enter a workstation ID")
      .max(WS_MAX_LEN, `At most ${WS_MAX_LEN} characters`)
      .regex(WS_CHARS, "Letters, digits, spaces, - and _ only"),
  );
export type Ws = z.infer<typeof WsSchema>;

/** Two IDs name the same station iff their keys are equal: Row2 === row2 === ROW2. */
export function wsKey(ws: string): string {
  return ws.toLowerCase();
}

// "en" is pinned so the order does not drift with the host locale.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** Natural, case-insensitive order for any list of stations: 1, 2, 10, Row 2, Row 10. */
export function compareWs(a: string, b: string): number {
  return collator.compare(a, b);
}
