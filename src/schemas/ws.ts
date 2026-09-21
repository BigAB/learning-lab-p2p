import { z } from "zod";

export const WS_MIN = 1;
export const WS_MAX = 30;
export const WsSchema = z.number().int().min(WS_MIN).max(WS_MAX);
/** For URL params: coerces "7" → 7. */
export const WsParamSchema = z.coerce.number().int().min(WS_MIN).max(WS_MAX);
export type Ws = z.infer<typeof WsSchema>;
