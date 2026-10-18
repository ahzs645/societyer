import { useCallback, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TranscriptRef } from "../../../../shared/transcriptModel";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { usePermissions } from "../../../hooks/usePermissions";
import { formatTranscriptTime } from "./activeIndex";
import {
  minutesActionItems,
  minutesLinkTargets,
  type LinkableMotion,
  type MinutesLinkTarget,
} from "./transcriptLinks";

type ActionRow = { text: string; transcriptRef?: TranscriptRef };
export type LinkMinutes = {
  approvedAt?: string;
  adoptedSnapshot?: unknown;
  motionSnapshots?: unknown[];
  actionItems?: ActionRow[];
  sections?: { actionItems?: ActionRow[] }[];
};
export type LinkMinutesItem = (target: MinutesLinkTarget, range: TranscriptRef) => Promise<void>;

const NO_TARGETS: MinutesLinkTarget[] = [];

/** Minutes motions and action items as transcript link targets, and the save. */
export function useMinutesLinks({
  societyId,
  meetingId,
  minutes,
  motions,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  minutes?: LinkMinutes | null;
  motions?: readonly LinkableMotion[];
}) {
  const { can } = usePermissions();
  const targets = useMemo(
    () => minutesLinkTargets(motions ?? [], minutesActionItems(minutes)),
    [motions, minutes],
  );
  // Approved or adopted minutes are the legal record; their links are read-only.
  const frozen = Boolean(
    minutes?.approvedAt || minutes?.adoptedSnapshot || Array.isArray(minutes?.motionSnapshots),
  );
  const linkable = useMemo(
    () => targets.filter((target) => target.kind === "actionItem" || target.motionId),
    [targets],
  );
  const canLink =
    can("minutes:write") && can("meetings:write") && Boolean(minutes) && !frozen && linkable.length > 0;
  const linkMinutesItem = usePermissionedMutation(api.transcripts.linkMinutesItem, canLink);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const onLink = useCallback<LinkMinutesItem>(
    async (target, range) => {
      setError("");
      setStatus("");
      try {
        await linkMinutesItem({
          societyId,
          meetingId,
          kind: target.kind,
          ...(target.motionId ? { motionId: target.motionId as Id<"motions"> } : {}),
          ...(target.action
            ? {
                ...(target.action.sectionIndex === null ? {} : { sectionIndex: target.action.sectionIndex }),
                actionIndex: target.action.actionIndex,
                expectedText: target.action.text,
              }
            : {}),
          startSec: range.startSec,
          endSec: range.endSec,
        });
        setStatus(`${target.label} linked to ${formatTranscriptTime(range.startSec)}.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not link the minutes item.");
      }
    },
    [linkMinutesItem, societyId, meetingId],
  );
  return { targets, linkTargets: canLink ? linkable : NO_TARGETS, onLink, status, error };
}
