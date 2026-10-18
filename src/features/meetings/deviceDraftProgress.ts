/**
 * The on-device minutes draft in progress, shared by every place a draft can
 * be started (Minutes empty state, the transcript card, the Transcript tab),
 * so each can show "Drafting part 2 of 4…" with a Cancel that aborts the
 * same request. One draft runs at a time per page.
 */
import { useSyncExternalStore } from "react";
import { DeviceAiError } from "../../lib/localAi/transport";

export const DRAFT_CANCELLED = "Draft cancelled. Nothing was changed.";

export type DeviceDraftProgress = { meetingId: string; done: number; total: number };

type Active = DeviceDraftProgress & { controller: AbortController };

let active: Active | null = null;
let snapshot: DeviceDraftProgress | null = null;
const listeners = new Set<() => void>();

function publish(next: Active | null) {
  active = next;
  snapshot = next ? { meetingId: next.meetingId, done: next.done, total: next.total } : null;
  for (const listener of listeners) listener();
}

/** Starts tracking a draft; `end()` must run when it settles. */
export function beginDeviceDraft(meetingId: string) {
  active?.controller.abort(new DeviceAiError("aborted", DRAFT_CANCELLED));
  const entry: Active = { meetingId, done: 0, total: 1, controller: new AbortController() };
  publish(entry);
  return {
    signal: entry.controller.signal,
    progress(done: number, total: number) {
      if (active === entry) publish({ ...entry, done, total });
    },
    end() {
      if (active?.controller === entry.controller) publish(null);
    },
  };
}

export function cancelDeviceDraft() {
  active?.controller.abort(new DeviceAiError("aborted", DRAFT_CANCELLED));
}

/** True when the error is the person's Cancel, not a failure. */
export function isDraftCancelled(error: unknown) {
  return error instanceof DeviceAiError && error.code === "aborted";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The draft running for this meeting, or null. */
export function useDeviceDraftProgress(meetingId: string | undefined): DeviceDraftProgress | null {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => null);
  return current && current.meetingId === meetingId ? current : null;
}

export function deviceDraftLabel(progress: DeviceDraftProgress): string {
  if (progress.done >= progress.total) return "Saving the draft…";
  if (progress.total > 1) return `Drafting part ${progress.done + 1} of ${progress.total}…`;
  return "Drafting on this device…";
}
