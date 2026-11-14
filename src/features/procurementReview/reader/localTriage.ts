/**
 * A bid triage kept in this browser, for the no-login demo, so the demo shows
 * the same review queue and decision panel a hosted workspace has. Hosted
 * workspaces use the shared Convex triage (triage.ts); nothing here reaches a
 * server. Action items need the Tasks backend, so the demo offers none.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Triage } from "../../../../shared/procurementTriage";
import type { ReaderTriage, TriageEntry } from "./triage";

const KEY = (societyId: string) => `societyer.procurementTriage.${societyId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; entries: ReadonlyMap<string, TriageEntry> }>();

function readRaw(societyId: string): string | null {
  try { return window.localStorage.getItem(KEY(societyId)); } catch { return null; }
}

function read(societyId: string): ReadonlyMap<string, TriageEntry> {
  const raw = readRaw(societyId);
  const hit = cache.get(societyId);
  if (hit && hit.raw === raw) return hit.entries;
  const entries = new Map<string, TriageEntry>();
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) for (const item of parsed as TriageEntry[]) if (item && typeof item.recordKey === "string") entries.set(item.recordKey, item);
  } catch { /* a damaged entry reads as no triage */ }
  cache.set(societyId, { raw, entries });
  return entries;
}

function write(societyId: string, entries: ReadonlyMap<string, TriageEntry>) {
  try { window.localStorage.setItem(KEY(societyId), JSON.stringify([...entries.values()])); } catch { /* private window: the change lasts until reload */ }
  cache.set(societyId, { raw: readRaw(societyId), entries });
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useLocalTriage(societyId: string, who: string | null): ReaderTriage {
  const entries = useSyncExternalStore(subscribe, () => read(societyId));
  const set = useCallback(async (recordKey: string, next: Triage) => {
    const updated = new Map(read(societyId));
    if (!next.reviewed && !next.classification) updated.delete(recordKey);
    else updated.set(recordKey, { recordKey, ...next, updatedBy: who, updatedAt: Date.now() });
    write(societyId, updated);
  }, [societyId, who]);
  return useMemo<ReaderTriage>(() => ({
    societyId,
    entries,
    canEdit: true,
    canCreateTask: false,
    actionItems: new Map(),
    set,
    createTask: () => Promise.reject(new Error("Action items need a signed-in workspace.")),
    addToTask: () => Promise.reject(new Error("Action items need a signed-in workspace.")),
  }), [societyId, entries, set]);
}
