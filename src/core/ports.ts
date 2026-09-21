export interface RtcFactory {
  create(config: RTCConfiguration): RTCPeerConnection;
}

/**
 * Implementations must never throw; wrap the underlying storage (see `browserKv`). Core relies
 * on this so `loadState`/`saveState` can stay simple.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface AsyncKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface WakeLockPort {
  /** Resolves true if a screen wake lock is held. */
  request(): Promise<boolean>;
}

export type Visibility = "visible" | "hidden";

export interface DevicePort {
  visibility(): Visibility;
  onVisibility(cb: (v: Visibility) => void): () => void;
  battery(): Promise<{ level: number; charging: boolean } | undefined>;
}
