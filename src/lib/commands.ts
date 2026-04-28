import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";

export type CommandAction = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  category?: "Actions" | "Navigation" | "Governance" | "Finance" | "Compliance" | "System" | "Recent";
  scope?: CommandScope;
  objectMetadataId?: string;
  pagePath?: string;
  selectionCount?: number;
  requiredSelection?: "none" | "single" | "multiple" | "any";
  /** Optional secondary line (e.g. "on 12 selected rows"). */
  hint?: ReactNode;
  /** Shown as a <kbd> on the row. */
  shortcut?: string;
  run: () => void | Promise<void>;
};

export type CommandScope =
  | { type: "global" }
  | { type: "page"; path: string }
  | { type: "object"; objectMetadataId: string; objectNameSingular?: string }
  | { type: "record"; objectMetadataId: string; recordId: string }
  | { type: "selection"; objectMetadataId: string; recordIds: string[] };

export type CommandMetadata = Omit<CommandAction, "icon" | "run"> & {
  iconName?: string;
  commandKey?: string;
  payload?: Record<string, unknown>;
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

export function commandMatchesScope(
  command: Pick<CommandAction, "scope" | "objectMetadataId" | "pagePath" | "requiredSelection">,
  scope: CommandScope,
): boolean {
  if (!command.scope && !command.objectMetadataId && !command.pagePath) return true;
  if (command.scope?.type === "global") return true;
  if (command.scope?.type === scope.type) {
    switch (scope.type) {
      case "page":
        return command.scope.type === "page" && command.scope.path === scope.path;
      case "object":
        return command.scope.type === "object" && command.scope.objectMetadataId === scope.objectMetadataId;
      case "record":
        return command.scope.type === "record" && command.scope.objectMetadataId === scope.objectMetadataId;
      case "selection":
        return command.scope.type === "selection" && command.scope.objectMetadataId === scope.objectMetadataId;
    }
  }
  if (command.pagePath && scope.type === "page") return command.pagePath === scope.path;
  if (command.objectMetadataId && "objectMetadataId" in scope) {
    return command.objectMetadataId === scope.objectMetadataId;
  }
  return false;
}

export function commandSelectionRequirementMet(
  command: Pick<CommandAction, "requiredSelection">,
  selectedRecordIds: string[] = [],
) {
  switch (command.requiredSelection ?? "any") {
    case "none":
      return selectedRecordIds.length === 0;
    case "single":
      return selectedRecordIds.length === 1;
    case "multiple":
      return selectedRecordIds.length > 1;
    case "any":
    default:
      return true;
  }
}
