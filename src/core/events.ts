export type EventMap = Record<string, unknown[]>;
type Listener<A extends unknown[]> = (...args: A) => void;

/**
 * Listener errors are isolated: every listener runs, and `emit()` never throws.
 *
 * Why: core emits from inside its own state machines (`MediaLink.ready()` inside a try that
 * ends in `fail()`, `PeerSession.fail()` mid-teardown). If a UI or controller listener throws
 * and `emit()` re-throws it, the *emitter's* state machine takes the blame — a throwing
 * LabController listener used to land a MediaLink in `failed` with reason "answer: …".
 * A listener's bug is the listener's problem; report it and keep going.
 */
export class Emitter<E extends EventMap> {
  private listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  /** Dedupes identical function references via Set, matching EventTarget.addEventListener semantics. */
  on<K extends keyof E>(name: K, cb: Listener<E[K]>): () => void {
    const set = (this.listeners[name] ??= new Set());
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  protected emit<K extends keyof E>(name: K, ...args: E[K]): void {
    const set = this.listeners[name];
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(...args);
      } catch (err) {
        this.onListenerError(String(name), err);
      }
    }
  }

  /** Where an isolated listener error goes. Subclasses (and tests) may override; default logs. */
  protected onListenerError(name: string, err: unknown): void {
    console.error(`[${this.constructor.name}] listener for "${name}" threw:`, err);
  }
}
