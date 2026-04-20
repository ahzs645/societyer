import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";

export type CommandAction = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  /** Optional secondary line (e.g. "on 12 selected rows"). */
  hint?: ReactNode;
  /** Shown as a <kbd> on the row. */
  shortcut?: string;
  run: () => void | Promise<void>;
};

const registry = new Map<string, CommandAction>();
const listeners = new Set<() => void>();

/** Cached snapshot. Mutated in lock-step with `registry` so
 * `useSyncExternalStore` sees a stable reference between changes — passing a
 * fresh `Array.from(...)` on every read causes infinite re-renders. */
let snapshot: CommandAction[] = [];

function rebuildSnapshot() {
  snapshot = Array.from(registry.values());
}

function notify() {
  rebuildSnapshot();
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): CommandAction[] {
  return snapshot;
}

/** Read all currently-registered actions. Re-renders when any component
 * registers or unregisters a command. */
export function useRegisteredCommands(): CommandAction[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Register a contextual command while the caller is mounted. The id must
 * be stable per caller. Multiple callers with the same id overwrite — last
 * mount wins.
 *
 * Safe to call with a freshly-constructed action object each render: the
 * effect only re-runs when the structural signature (id/label/shortcut)
 * changes, and the wrapped `run` always calls the latest closure via a ref. */
export function useRegisterCommand(action: CommandAction | null | undefined) {
  const latestRef = useRef(action);
  latestRef.current = action;

  const id = action?.id ?? null;
  const signature = action
    ? `${action.id}\u0000${action.label}\u0000${action.shortcut ?? ""}`
    : null;

  useEffect(() => {
    if (!id || !action) return;
    registry.set(id, {
      ...action,
      run: () => latestRef.current?.run() ?? undefined,
    });
    notify();
    return () => {
      registry.delete(id);
      notify();
    };
    // `action` intentionally omitted — we re-register only on structural
    // changes (tracked via `signature`); the ref keeps `run` current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, signature]);
}
