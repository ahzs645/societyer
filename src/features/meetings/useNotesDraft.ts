/**
 * "Draft notes with AI" for the Notes tab: the hosted action on a connected
 * workspace, the on-device model in the browser-local workspace and the
 * desktop app (the same split as minutes drafting).
 */
import { useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { isLocalDataRuntime } from "../../lib/staticRuntime";
import { deviceAiClient } from "../../lib/localAi/client";
import { useDeviceAi } from "../../lib/localAi/useDeviceAi";
import { deviceAiModelLabel } from "../../lib/localAi/models";
import { DeviceAiError } from "../../lib/localAi/transport";
import type { Id } from "../../../convex/_generated/dataModel";
import { notesDraftTranscriptFromRow, type NotesDraftTemplateId } from "../../../shared/ai/notesDraft";
import { draftNotesOnDevice } from "./localNotesDraft";
import { beginDeviceDraft, DRAFT_CANCELLED } from "./deviceDraftProgress";

export const NOTES_DRAFT_UNAVAILABLE =
  "Drafting notes with AI needs a connected server or an on-device model. Set up on-device AI in Settings.";

export type NotesDraftMeeting = {
  _id: Id<"meetings">;
  title: string;
  scheduledAt?: string;
  attendeeIds?: string[];
  workingNotes?: string;
};

export function useNotesDraft(canWrite: boolean) {
  const local = isLocalDataRuntime();
  const hosted = useAction(api.meetings.generateNotesDraft);
  const save = usePermissionedMutation(api.meetings.saveNotesDraft, canWrite);
  const deviceAi = useDeviceAi("minutes");
  const model = deviceAiModelLabel(deviceAi.config.kind, deviceAi.config.model);

  const run = useCallback(
    async (input: { meeting: NotesDraftMeeting; template: NotesDraftTemplateId; notes: string; transcriptRow: unknown }) => {
      if (!local) return (await hosted({ id: input.meeting._id, template: input.template })) as { actionItemsAdded: number };
      if (!deviceAi.ready) throw new Error(deviceAi.reason ?? NOTES_DRAFT_UNAVAILABLE);
      const transcript = notesDraftTranscriptFromRow(input.transcriptRow);
      const progress = beginDeviceDraft(input.meeting._id);
      try {
        const result = await draftNotesOnDevice({
          client: deviceAiClient(),
          draft: {
            meetingTitle: input.meeting.title,
            meetingDate: String(input.meeting.scheduledAt ?? "").slice(0, 10) || undefined,
            template: input.template,
            notes: input.notes,
            transcript,
            attendees: input.meeting.attendeeIds?.slice(0, 50),
          },
          chunkChars: deviceAi.config.minutesChunkChars,
          signal: progress.signal,
          onProgress: progress.progress,
        });
        if (progress.signal.aborted) throw new DeviceAiError("aborted", DRAFT_CANCELLED);
        return (await save({
          id: input.meeting._id,
          template: input.template,
          draft: result.draft,
          generatedBy: `On-device: ${model}`,
          usedNotes: Boolean(input.notes.trim()),
          usedTranscript: Boolean(transcript.trim()),
        })) as { actionItemsAdded: number };
      } finally {
        progress.end();
      }
    },
    [local, hosted, save, deviceAi.ready, deviceAi.reason, deviceAi.config.minutesChunkChars, model],
  );

  return {
    /** Whether a draft can run here at all (a hosted workspace always can: it falls back to a rule-based draft). */
    available: !local || deviceAi.ready,
    unavailableReason: local && !deviceAi.ready ? deviceAi.reason ?? NOTES_DRAFT_UNAVAILABLE : undefined,
    via: local ? `on-device (${model})` : "workspace AI",
    run,
  };
}
