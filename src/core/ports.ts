export interface RtcFactory {
  create(config: RTCConfiguration): RTCPeerConnection;
  /** Receive-side video codec capabilities, for setCodecPreferences. Absent ⇒ engine defaults. */
  videoCodecs?(): RTCRtpCodec[];
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

export interface CaptureConstraints {
  width: number;
  height: number;
  frameRate: number;
}

/**
 * Capture lives behind a port so core never touches `navigator`. `screen()` must be invoked
 * synchronously inside a user gesture: Chrome's getDisplayMedia needs transient activation.
 */
export interface MediaPort {
  camera(c: CaptureConstraints): Promise<MediaStreamTrack>;
  screen(): Promise<MediaStreamTrack>;
}
