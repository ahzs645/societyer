/**
 * The `minutes:upsertFromDraft` arguments for an AI draft.
 *
 * Shared by the hosted actions (minutes:generateDraft, transcripts:runPipeline)
 * and the on-device orchestrator, so a draft is stored the same way whichever
 * runtime called the model. The upsert itself stays authoritative: it repeats
 * the draft-blocker check and refuses adopted minutes.
 */
import type { MinuteDraft } from "./minutesDraft";

export type DraftMeeting = {
  _id: string;
  societyId: string;
  scheduledAt: string;
  attendeeIds?: string[];
  quorumRequired?: number | null;
};

export function draftToMinutesArgs(meeting: DraftMeeting, draft: MinuteDraft, transcript: string) {
  // The draft's own attendee list when it has one; otherwise the meeting's.
  const attendees = draft.attendees.length ? draft.attendees : meeting.attendeeIds ?? [];
  // Unknown quorum requirement means quorum is NOT established. Every other
  // creation path treats it that way (see meetings createPortable).
  const quorumRequired = meeting.quorumRequired ?? null;
  const quorumMet = quorumRequired == null ? false : draft.attendees.length >= quorumRequired;
  return {
    societyId: meeting.societyId,
    meetingId: meeting._id,
    heldAt: meeting.scheduledAt,
    chairName: draft.chairName,
    secretaryName: draft.secretaryName,
    recorderName: draft.recorderName,
    calledToOrderAt: draft.calledToOrderAt,
    adjournedAt: draft.adjournedAt,
    remoteParticipation: draft.remoteParticipation,
    detailedAttendance: draft.detailedAttendance,
    attendees,
    absent: draft.absent,
    quorumStatus: quorumRequired == null ? "not_recorded" : quorumMet ? "confirmed" : "not_met",
    quorumMet,
    discussion: draft.discussion,
    sections: draft.sections,
    motions: draft.motions,
    decisions: draft.decisions,
    actionItems: draft.actionItems,
    nextMeetingAt: draft.nextMeetingAt,
    nextMeetingLocation: draft.nextMeetingLocation,
    nextMeetingNotes: draft.nextMeetingNotes,
    sessionSegments: draft.sessionSegments,
    appendices: draft.appendices,
    agmDetails: draft.agmDetails,
    draftTranscript: transcript,
  };
}

export type MinutesDraftUpsertArgs = ReturnType<typeof draftToMinutesArgs>;
