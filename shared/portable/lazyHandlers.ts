/**
 * Lazy handler modules for the portable registry (SU-11).
 *
 * `lazyHandlers(() => import("./intake"))` returns an object whose properties
 * are async handlers with the same signatures as the module's exports. The
 * module is fetched the first time any of its handlers is called, so the local
 * data client no longer ships every domain (intake, import sessions,
 * accounting, …) in its boot chunk. Registry semantics are unchanged: every
 * entry still names its handler up front, and a handler is still
 * `(ctx, args) => Promise<result>`; the first call simply awaits the chunk.
 *
 * Hosted Convex never imports the registry, so it is unaffected.
 */

type AnyHandler = (...args: any[]) => any;

export type LazyHandlers<M> = {
  [K in keyof M]: M[K] extends AnyHandler ? (...args: Parameters<M[K]>) => Promise<Awaited<ReturnType<M[K]>>> : never;
};

export function lazyHandlers<M extends object>(load: () => Promise<M>, label = "handler module"): LazyHandlers<M> {
  let loading: Promise<M> | undefined;
  const ensure = () => {
    loading ??= load().catch((error) => {
      // A failed chunk fetch (offline, redeploy) is retried on the next call.
      loading = undefined;
      throw error;
    });
    return loading;
  };
  const handlers = new Map<string, AnyHandler>();
  return new Proxy({} as LazyHandlers<M>, {
    get(_target, key) {
      // Never look like a thenable or a symbol-keyed protocol object.
      if (typeof key !== "string" || key === "then") return undefined;
      let handler = handlers.get(key);
      if (!handler) {
        handler = async (...args: unknown[]) => {
          const module = await ensure();
          const exported = (module as Record<string, unknown>)[key];
          if (typeof exported !== "function") throw new Error(`${label} has no handler "${key}".`);
          return (exported as AnyHandler)(...args);
        };
        handlers.set(key, handler);
      }
      return handler;
    },
  });
}
