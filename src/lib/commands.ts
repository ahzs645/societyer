import { useEffect, useSyncExternalStore } from "react";
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
const listeners = new Set<() => void >();

function notify() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): CommandAction[] {
  return Array.from(registry.values());
}

/** Read all currently-registered actions. Re-renders when any component
 * registers or unregisters a command. */
export function useRegisteredCommands(): CommandAction[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Register a contextual command while the caller is mounted. The id must
 * be stable per caller. Multiple callers with the same id overwrite — last
 * mount wins. */
export function useRegisterCommand(action: CommandAction | null | undefined) {
  useEffect(() => {
    if (!action) return;
    registry.set(action.id, action);
    notify();
    return () => {
      registry.delete(action.id);
      notify();
    };
  }, [action]);
}
