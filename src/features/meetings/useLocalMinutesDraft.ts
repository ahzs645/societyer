/**
 * Minutes drafting with the on-device model (browser-local workspace and the
 * desktop app).
 *
 *   transcript -> device model (shared prompt; long transcripts in parts)
 *   -> parseMinutesDraft -> draftToMinutesArgs -> portable minutes:upsertFromDraft
 *
 * The model call happens here, in the page (core in ./localMinutesDraft.ts). The portable mutation only writes
 * and stays authoritative: it repeats the draft-blocker check and refuses
 * adopted minutes, exactly as on a server. No network I/O ever happens inside
 * a portable mutation.
 */
import { useCallback } from "react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { deviceAiClient } from "../../lib/localAi/client";
import { useDeviceAi } from "../../lib/localAi/useDeviceAi";
import { DeviceAiError } from "../../lib/localAi/transport";
import { draftMinutesOnDevice, type LocalDraftMeeting } from "./localMinutesDraft";
import { beginDeviceDraft, DRAFT_CANCELLED } from "./deviceDraftProgress";

export { draftMinutesOnDevice, type LocalDraftMeeting, type LocalDraftResult } from "./localMinutesDraft";

/**
 * Page hook: whether on-device drafting is ready, and how to run it. Progress
 * and Cancel are shared through ./deviceDraftProgress.ts; a cancelled draft
 * throws DeviceAiError("aborted") and writes nothing.
 */
export function useLocalMinutesDraft() {
  const { can } = usePermissions();
  const upsertFromDraft = usePermissionedMutation(api.minutes.upsertFromDraft, can("minutes:write"));
  const deviceAi = useDeviceAi("minutes");
  const chunkChars = deviceAi.config.minutesChunkChars;
  const run = useCallback(
    async (input: { meeting: LocalDraftMeeting; transcript: string; existingMinutes: unknown }) => {
      const draft = beginDeviceDraft(input.meeting._id);
      try {
        const result = await draftMinutesOnDevice({
          client: deviceAiClient(),
          meeting: input.meeting,
          transcript: input.transcript,
          existingMinutes: input.existingMinutes,
          chunkChars,
          signal: draft.signal,
          onProgress: draft.progress,
        });
        // Cancelled after the last reply: still write nothing.
        if (draft.signal.aborted) throw new DeviceAiError("aborted", DRAFT_CANCELLED);
        await upsertFromDraft(result.args);
        return result;
      } finally {
        draft.end();
      }
    },
    [chunkChars, upsertFromDraft],
  );
  return { ready: deviceAi.ready, model: deviceAi.config.model, reason: deviceAi.reason, run };
}
