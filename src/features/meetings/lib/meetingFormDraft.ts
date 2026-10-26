import { meetingFieldValuesMatch } from "../../../../shared/meetingConcurrency";
import type { MeetingDraftJournal } from "./meetingDraftStore";

export type MeetingFormPayload<T, B> = { value: T; baseline: B; initial: T; requiresSave?: boolean };
export type MeetingFormSubmission<T, B> = { payload: MeetingFormPayload<T, B>; revision: string | null; generation: number };
export function createMeetingFormDraft<T, B>(journal: MeetingDraftJournal<MeetingFormPayload<T, B>> | null) {
  let snapshot: MeetingFormPayload<T, B> | null = null;
  let generation = 0;
  let pending: MeetingFormSubmission<T, B> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => { snapshot = next; for (const fn of listeners) fn(); };
  const persist = () => {
    if (!snapshot) return;
    if (!snapshot.requiresSave && meetingFieldValuesMatch(snapshot.value, snapshot.initial)) journal?.discardCurrent();
    else journal?.write(snapshot);
  };
  const isCurrent = (submitted: MeetingFormSubmission<T, B>) => !!snapshot && submitted.generation === generation && (journal?.isActive() ?? true);
  return {
    getSnapshot: () => snapshot,
    generation: () => generation,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    begin(value: T, baseline: B) { generation++; pending = null; publish({ value, baseline, initial: value }); },
    change(next: T | ((previous: T) => T)) {
      if (!snapshot) return;
      const value = typeof next === "function" ? (next as (previous: T) => T)(snapshot.value) : next;
      const requiresSave = snapshot.requiresSave || (!!pending && pending.generation === generation && !meetingFieldValuesMatch(value, pending.payload.value));
      publish({ ...snapshot, value, ...(requiresSave ? { requiresSave: true } : {}) });
      persist();
    },
    restore(payload: MeetingFormPayload<T, B>) { generation++; pending = null; publish(payload); journal?.write(payload); },
    checkpoint(submitted: MeetingFormSubmission<T, B>, baseline: B) {
      if (!snapshot || !isCurrent(submitted)) return false;
      publish({ ...snapshot, baseline }); persist(); return true;
    },
    isCurrent,
    capture() {
      journal?.assertActive();
      pending = snapshot ? { payload: snapshot, revision: journal?.currentRevision() ?? null, generation } : null;
      return pending;
    },
    complete(submitted: MeetingFormSubmission<T, B>, baseline: B) {
      journal?.acknowledge(submitted.revision);
      if (!snapshot || !isCurrent(submitted)) return false;
      pending = null;
      if (meetingFieldValuesMatch(snapshot.value, submitted.payload.value)) {
        journal?.discardCurrent();
        publish(null);
        return true;
      }
      // The acknowledgement covers the submitted value, not newer typing.
      publish({ ...snapshot, baseline, initial: submitted.payload.value, requiresSave: false });
      persist();
      return false;
    },
    discard() { generation++; pending = null; journal?.discardCurrent(); publish(null); },
    dirty: () => !!snapshot && (!!snapshot.requiresSave || !meetingFieldValuesMatch(snapshot.value, snapshot.initial)),
  };
}
