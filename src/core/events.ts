export type EventMap = Record<string, unknown[]>;
type Listener<A extends unknown[]> = (...args: A) => void;

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
    let firstError: unknown;
    let hasError = false;
    for (const cb of [...set]) {
      try {
        cb(...args);
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
      }
    }
    if (hasError) throw firstError;
  }
}
