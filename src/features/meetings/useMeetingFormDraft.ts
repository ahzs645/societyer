import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useMeetingDraft } from "./useMeetingDraft";
import { createMeetingFormDraft, type MeetingFormPayload } from "./lib/meetingFormDraft";

export function useMeetingFormDraft<T, B>(editor: string, valueValid: (value: unknown) => value is T, baselineValid: (value: unknown) => value is B) {
  const recovery = useMeetingDraft<MeetingFormPayload<T, B>>(editor, (value): value is MeetingFormPayload<T, B> => {
    const row = value as MeetingFormPayload<T, B> | null;
    return !!row && valueValid(row.value) && valueValid(row.initial) && baselineValid(row.baseline);
  });
  const controller = useMemo(() => createMeetingFormDraft<T, B>(recovery.journal), [recovery.journal]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.dirty() || recovery.journal?.getSnapshot().savedOnDevice) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [controller, recovery.journal]);
  return { recovery, controller, state, value: state?.value ?? null };
}
