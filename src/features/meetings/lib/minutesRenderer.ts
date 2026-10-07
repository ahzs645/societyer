import { resolveSourceMeetingRecord, changedSourceMinuteSections, type SourceMeetingRecord, type SourceMeetingBlock } from "../../../../shared/sourceMeetingRecord";
import { isDateOnlyPlaceholder } from "../../../../shared/meetingDates";
import { screenAttendanceName } from "../../../../shared/attendanceNames";
import { checkpointResult, decisionReadiness } from "../../../../shared/evidenceReview";
import type { QuorumCheckpoint } from "../../../../shared/evidenceReview";
import type { ActionObservation, ImportedSourceVersion } from "../../../../shared/meetingHistory";
// Meeting-minutes domain renderer. Takes structured minutes data + a chosen
// style (Standard / Formal AGM / Executive Agenda / Numbered Agenda / Action
// Table / Board Public) and produces an HTML body string that the generic
// docx/pdf exporters in lib/ can package up. This file knows nothing about
// docx or PDF — it only emits HTML.

import { escapeHtml } from "../../../lib/html";
import { renderMarkdownInline } from "../../../lib/markdown";
import { MINUTES_EXPORT_STYLES, type MinutesExportStyleId } from "./minutesExportStyles";
import { agendaSequenceLabel } from "./agendaNumbering";
import { minutesQuorumLabel, recordedMinutesQuorum } from "../../../../shared/minutesQuorum";

export type { MinutesExportStyleId };
export { MINUTES_EXPORT_STYLES };

/** A captured e-signature to render in the signature block. */
export type MinutesSignatureLine = {
  signerName: string;
  signerRole?: string;
  signedAtISO?: string;
  /** PNG data URL for a drawn signature; rendered as an image when present. */
  imageDataUrl?: string;
};

/** A conflict-of-interest / recusal declaration to render into the minutes. */
export type MinutesConflictLine = {
  directorName: string;
  contractOrMatter: string;
  natureOfInterest?: string;
  abstainedFromVote?: boolean;
  leftRoom?: boolean;
  motionLabel?: string;
};

/** A proxy appointment to render into the minutes. */
export type MinutesProxyLine = {
  grantorName: string;
  proxyHolderName: string;
  instructions?: string;
  revoked?: boolean;
};

export type MinutesExportOptions = {
  sourceFidelity?: boolean;
  publicOnly?: boolean;
  privateCopy?: boolean;
  /** Public-copy export: omit history and source evidence until separately reviewed for publication. */
  publicCopy?: boolean;
  includeTranscript?: boolean;
  includeActionItems?: boolean;
  includeDiscussionSummary?: boolean;
  includeApprovalBlock?: boolean;
  includeSignatures?: boolean;
  includePlaceholders?: boolean;
  includeGeneratedFooter?: boolean;
  /** How sub-items are numbered in styles with numbered headings: "letters"
   *  renders 1. / 1a., "decimal" renders 1. / 1.1. Mirrors the agenda-editor
   *  preference so exports match what the user sees on screen. */
  agendaNumberingMode?: "letters" | "decimal";
  /** Captured e-signatures. When present, the signature block lists the actual
   *  signers + dates instead of blank Chair/Secretary signature lines. */
  signatures?: MinutesSignatureLine[];
  /** Conflict-of-interest / recusal declarations recorded for the meeting. */
  conflicts?: MinutesConflictLine[];
  /** Proxy appointments recorded for the meeting. */
  proxies?: MinutesProxyLine[];
};

export type MinutesDataGap = {
  label: string;
  status: "available" | "missing" | "not_collected";
  detail: string;
};

type MinutesActionItem = {
  text: string;
  assignee?: string;
  dueDate?: string;
  done: boolean;
};

type DetailedAttendance = {
  name: string;
  status: string;
  roleTitle?: string;
  affiliation?: string;
  memberIdentifier?: string;
  proxyFor?: string;
  quorumCounted?: boolean;
  notes?: string;
};

export type MinutesRenderArgs = {
  society: {
    name: string;
    incorporationNumber?: string | null;
    logoUrl?: string | null;
    letterheadUrl?: string | null;
  };
  meeting: {
    title: string;
    type: string;
    scheduledAt: string;
    location?: string | null;
    electronic?: boolean;
    noticeSentAt?: string | null;
    agendaItems?: string[];
    // Optional structured form. When present, renderers that produce a visible
    // agenda list (adoption, numbered) nest sub-items under their root.
    // `agendaItems` continues to represent root titles only — sub-items never
    // become their own minute section, table row, or executive heading.
    agendaItemTree?: { title: string; depth: 0 | 1 }[];
  };
  minutes: {
    sourceMeetingRecord?: SourceMeetingRecord | null;
    sourceTransposition?: any;
    linkedTasks?: any[];
    consentItems?: any[];
    conditionalDecisions?: any[];
    decisionRequirements?: any[];
    attendanceEvents?: any[];
    quorumCheckpoints?: QuorumCheckpoint[];
    futureMeetingSuggestions?: any[];
    heldAt: string;
    chairName?: string | null;
    secretaryName?: string | null;
    recorderName?: string | null;
    calledToOrderAt?: string | null;
    adjournedAt?: string | null;
    remoteParticipation?: {
      url?: string | null;
      meetingId?: string | null;
      passcode?: string | null;
      instructions?: string | null;
    } | null;
    detailedAttendance?: DetailedAttendance[] | null;
    attendees: string[];
    absent: string[];
    quorumMet: boolean;
    quorumStatus?: "confirmed" | "not_met" | "not_recorded";
    quorumRequired?: number;
    quorumSourceLabel?: string;
    discussion: string;
    sections?: {
      title: string;
      agendaItemId?: string;
      type?: string;
      presenter?: string;
      discussion?: string;
      motionText?: string;
      motionId?: string;
      linkedTaskIds?: string[];
      sourceKind?: string;
      sourceReference?: string;
      sourceReviewStatus?: string;
      sourceEvidence?: any;
      publicVisible?: boolean;
      depth?: 0 | 1;
      reportSubmitted?: boolean;
      decisions?: string[];
      actionItems?: MinutesActionItem[];
    }[] | null;
    motions: {
      text: string;
      movedBy?: string;
      secondedBy?: string;
      outcome: string;
      votesFor?: number;
      votesAgainst?: number;
      abstentions?: number;
      sectionIndex?: number;
      sectionTitle?: string;
    }[];
    decisions: string[];
    actionItems: MinutesActionItem[];
    approvedAt?: string | null;
    nextMeetingAt?: string | null;
    nextMeetingLocation?: string | null;
    nextMeetingNotes?: string | null;
    sessionSegments?: {
      type: string;
      title?: string;
      startedAt?: string;
      endedAt?: string;
      notes?: string;
    }[] | null;
    appendices?: {
      title: string;
      type?: string;
      reference?: string;
      notes?: string;
    }[] | null;
    agmDetails?: {
      financialStatementsPresented?: boolean;
      financialStatementsNotes?: string;
      directorElectionNotes?: string;
      directorAppointments?: {
        name: string;
        roleTitle?: string;
        affiliation?: string;
        term?: string;
        consentRecorded?: boolean;
        votesReceived?: number;
        elected?: boolean;
        status?: string;
        notes?: string;
      }[];
      specialResolutionExhibits?: {
        title: string;
        reference?: string;
        notes?: string;
      }[];
    } | null;
    actionObservations?: ActionObservation[] | null;
    importedSourceVersions?: ImportedSourceVersion[] | null;
    draftTranscript?: string | null;
  };
  styleId?: MinutesExportStyleId;
  options?: MinutesExportOptions;
};

const DEFAULT_MINUTES_EXPORT_OPTIONS: Required<MinutesExportOptions> = {
  sourceFidelity: true,
  publicOnly: false,
  privateCopy: false,
  publicCopy: false,
  includeTranscript: true,
  includeActionItems: true,
  includeDiscussionSummary: false,
  includeApprovalBlock: true,
  includeSignatures: true,
  includePlaceholders: false,
  includeGeneratedFooter: true,
  agendaNumberingMode: "letters",
  signatures: [],
  conflicts: [],
  proxies: [],
};

/** Build the body HTML for a meeting-minutes export. */
export function renderMinutesHtml(args: MinutesRenderArgs): string {
  if (isImportMetadataTranscript(args.minutes.draftTranscript)) args = {...args,minutes:{...args.minutes,draftTranscript:null}};
  const styleId = normalizeMinutesStyleId(args.styleId);
  const options = { ...DEFAULT_MINUTES_EXPORT_OPTIONS, ...(args.options ?? {}) };

  options.publicCopy = options.publicCopy || options.publicOnly;
  const sourceRecord = resolveSourceMeetingRecord(args.minutes);
  if (sourceRecord && options.sourceFidelity && !options.publicCopy && (styleId !== "board-public" || options.privateCopy)) {
    return renderDocumentHeader(args.society) + renderSourceFidelityMinutes(args, sourceRecord, styleId, options);
  }

  let body: string;
  if (styleId === "formal-agm") body = renderFormalAgmMinutes(args, options);
  else if (styleId === "executive-agenda") body = renderExecutiveAgendaMinutes(args, options);
  else if (styleId === "numbered-agenda") body = renderNumberedAgendaMinutes(args, options);
  else if (styleId === "action-table") body = renderActionTableMinutes(args, options);
  else if (styleId === "board-public") body = renderBoardPublicMinutes(args, options);
  else body = renderStandardMinutes(args, options);

  return renderDocumentHeader(args.society) + body + renderUnrepresentedSectionDetails(args.minutes,body,options) + renderMeetingHistory(args.minutes, options) + (options.publicOnly || options.publicCopy ? "" : renderSourceDecisionEvidence(args.minutes, styleId === "board-public")) + renderFooter(options);
}

/**
 * Returns an HTML header for the top of an exported document.
 * Uses the uploaded letterhead only — the chrome logo is intentionally NOT a
 * fallback so the export header has a clear semantic role (formal branding)
 * distinct from the app chrome avatar.
 * Renders a single right-aligned image with inline styles so it displays
 * correctly in every export context (Word .doc, in-app preview, meeting
 * pack) without relying on an external stylesheet.
 * Returns an empty string when no letterhead is uploaded.
 */
export function renderDocumentHeader(society: {
  name?: string;
  incorporationNumber?: string | null;
  letterheadUrl?: string | null;
}): string {
  const eh = escapeHtml;
  if (!society.letterheadUrl) return "";
  // align="right" + hspace are deprecated HTML attributes that Word honors
  // reliably across versions for inline float layout. Inline CSS covers
  // modern browsers (preview page + print).
  return `<img src="${eh(society.letterheadUrl)}" alt="" align="right" hspace="12" style="float: right; height: 28pt; width: auto; max-height: 28pt; max-width: 120pt; margin: 0 0 6pt 12pt;" />`;
}

export function getMinutesStyleGaps({
  styleId,
  meeting,
  minutes,
}: {
  styleId: MinutesExportStyleId;
  meeting: MinutesRenderArgs["meeting"];
  minutes: MinutesRenderArgs["minutes"];
}): MinutesDataGap[] {
  const sourceRecord = resolveSourceMeetingRecord(minutes);
  if (sourceRecord && styleId !== "board-public") return [
    gap("Complete linked source documents",sourceRecord.documents.every(document=>document.blocks.length>0),"Original source content and related package materials can be recreated.","One linked source has no readable content."),
    gap("Literal meeting header",!!sourceRecord.header.literalTitle,"Title, dates and location retain their original wording.","The source header is not recorded."),
    gap("Source attendance",sourceRecord.participants.length>0,"Participant observations retain the source names and categories.","The source does not identify a structured attendance list; its original wording remains in the export."),
  ];
  const agendaItems = meeting.agendaItems ?? [];
  const businessMotions = minutes.motions.filter((motion) => !isAdjournmentMotionForExport(motion));
  const motionHasVoteLanguage = businessMotions.some(
    (motion) =>
      motion.votesFor != null ||
      motion.votesAgainst != null ||
      motion.abstentions != null ||
      !!motion.movedBy ||
      !!motion.secondedBy,
  );
  const common: MinutesDataGap[] = [
    // F15: role words, organizations and headings ("Members", "Public Member")
    // do not make an attendance list ready.
    gap("Attendance list", minutes.attendees.some((name) => screenAttendanceName(name).kind === "person"), "Present attendees are structured.", minutes.attendees.length ? "Only role words, organizations or headings are listed as present — correct the attendance grid." : "No present attendees are recorded."),
    gap("Agenda items", agendaItems.length > 0, "Agenda headings can drive styled sections.", "Agenda items are not recorded on this meeting."),
    gap("Motions and outcomes", businessMotions.length > 0, "Motions can be rendered as resolutions or vote blocks.", "No structured motions are recorded."),
    gap(
      "Chair, secretary, minute-taker",
      hasAny(minutes.chairName, minutes.secretaryName, minutes.recorderName),
      "Officer/minute-taker details can be rendered.",
      "No chair, secretary, or recorder is recorded.",
    ),
    gap(
      "Call-to-order and adjournment times",
      hasAny(minutes.calledToOrderAt, minutes.adjournedAt),
      "Opening or adjournment time is structured.",
      "No separate call-to-order or adjournment time is recorded.",
    ),
    gap(
      "Per-agenda discussion",
      (minutes.sections ?? []).some((section) => hasAny(section.discussion, section.presenter, section.reportSubmitted)),
      "Per-agenda sections can drive styled minutes.",
      "No per-agenda discussion/report sections are recorded.",
    ),
    gap(
      "Appendices and attachments",
      (minutes.appendices ?? []).length > 0,
      "Report appendices and exhibit references can be rendered.",
      "No appendix or attachment references are recorded.",
    ),
  ];

  if (styleId === "formal-agm") {
    return [
      gap("Notice sent date", !!meeting.noticeSentAt, "Notice date can be cited in the call-to-order clause.", "No notice date is recorded."),
      ...common,
      gap(
        "Financial statements and director elections",
        hasAny(minutes.agmDetails?.financialStatementsPresented, minutes.agmDetails?.financialStatementsNotes, minutes.agmDetails?.directorElectionNotes, (minutes.agmDetails?.directorAppointments ?? []).length),
        "AGM financial/election details can be rendered.",
        "No AGM financial-statement or director-election details are recorded.",
      ),
      gap(
        "Exhibits and attachments",
        (minutes.agmDetails?.specialResolutionExhibits ?? []).length > 0,
        "Special-resolution exhibit references are structured.",
        "No special-resolution exhibit references are recorded.",
      ),
    ];
  }

  if (styleId === "executive-agenda") {
    return [
      ...common,
      gap("Action items", minutes.actionItems.length > 0, "Action items can be rendered inline under agenda topics.", "No structured action items are recorded."),
      gap(
        "Meeting link and remote access details",
        hasAny(minutes.remoteParticipation?.url, minutes.remoteParticipation?.meetingId, minutes.remoteParticipation?.instructions),
        "Remote participation details can be rendered.",
        "No remote meeting URL, meeting ID, or instructions are recorded.",
      ),
      gap(
        "Committee report appendices",
        (minutes.sections ?? []).some((section) => section.type === "report" || section.reportSubmitted),
        "Report sections can be rendered as appendices or report items.",
        "No report sections or report-submitted flags are recorded.",
      ),
    ];
  }

  if (styleId === "numbered-agenda") {
    return [
      ...common,
      gap("Meeting location and time range", hasAny(meeting.location, minutes.calledToOrderAt, minutes.adjournedAt), "The export can fill the sample-style Date / Time / Location line.", "Location or call-to-order/adjournment times are not fully recorded."),
      gap("Motion first/second details", motionHasVoteLanguage, "Motion blocks can render First and Second lines.", "Motions are missing mover/first or seconder details."),
      gap("Next meeting details", hasAny(minutes.nextMeetingAt, minutes.nextMeetingLocation, minutes.nextMeetingNotes), "Next meeting details can render at the end of the minutes.", "No next meeting details are recorded."),
    ];
  }

  if (styleId === "action-table") {
    return [
      ...common,
      gap("Action items", minutes.actionItems.length > 0, "Action rows can be pulled into the group-action column.", "No structured action items are recorded."),
      gap(
        "Affiliations, proxies, and staff/guest categories",
        (minutes.detailedAttendance ?? []).some((row) => hasAny(row.affiliation, row.proxyFor, row.roleTitle) || !["present", "absent"].includes(row.status)),
        "Detailed attendance rows include roles, affiliations, proxies, or categories.",
        "No detailed attendance categories, affiliations, or proxy details are recorded.",
      ),
      gap(
        "Appendix rosters and vacancies",
        (minutes.agmDetails?.directorAppointments ?? []).length > 0,
        "Director/committee appointment rows can render as appendix tables.",
        "No director, committee, vacancy, or roster snapshots are recorded.",
      ),
    ];
  }

  if (styleId === "board-public") {
    return [
      ...common,
      gap("Motion mover/seconder and vote detail", motionHasVoteLanguage, "Motion blocks can include mover, seconder, and vote detail.", "Motions are missing mover/seconder or vote details."),
      gap(
        "Public/in-camera session transitions",
        (minutes.sessionSegments ?? []).length > 0,
        "Session boundaries can be rendered.",
        "No public/in-camera session boundaries are recorded.",
      ),
      gap(
        "Participant roles",
        (minutes.detailedAttendance ?? []).some((row) => hasAny(row.roleTitle, row.affiliation)),
        "Participant roles or affiliations can be rendered.",
        "No participant role snapshots are recorded.",
      ),
    ];
  }

  return common;
}

function renderStandardMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const held = formatLongDateTime(minutes.heldAt);
  const businessMotions = minutes.motions.filter((motion) => !isAdjournmentMotionForExport(motion));

  const motionRow = (m: typeof minutes.motions[number]) => {
    const meta = [
      m.movedBy ? `Moved by ${eh(m.movedBy)}` : "",
      m.secondedBy ? `Seconded by ${eh(m.secondedBy)}` : "",
    ].filter(Boolean).join(" · ");
    const voteTail =
      m.votesFor != null
        ? ` · For ${m.votesFor} · Against ${m.votesAgainst ?? 0} · Abstain ${m.abstentions ?? 0}`
        : "";
    return `
      <div class="motion">
        <p>Motion: ${eh(m.text)}</p>
        ${meta ? `<p class="meta">${meta}</p>` : ""}
        <p class="outcome-${eh(m.outcome.toLowerCase())}">${eh(m.outcome.toUpperCase())}${voteTail}</p>
      </div>
    `;
  };

  return `
    <h1>${eh(meeting.title)}</h1>
    <p class="meta">
      ${eh(meeting.type)} · ${eh(held)}
      ${meeting.location ? ` · ${eh(meeting.location)}` : ""}
      ${meeting.electronic ? " · Electronic participation" : ""}
    </p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>

    ${renderOfficialDetails(minutes)}
    ${renderRemoteParticipation(minutes.remoteParticipation)}
    ${renderSessionSegments(minutes.sessionSegments)}

    <h2>Attendance</h2>
    ${renderAttendance(minutes)}
    <p>Quorum: ${minutesQuorumLabel(minutes)}${
      minutes.quorumRequired != null ? ` · ${minutes.attendees.length} present / ${minutes.quorumRequired} required` : ""
    }${minutes.quorumSourceLabel ? ` · Rule: ${eh(minutes.quorumSourceLabel)}` : ""}</p>

    ${renderMinuteSections(minutes.sections, options)}
    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}

    ${renderOptionalSection("Motions", businessMotions.map(motionRow).join(""), businessMotions.length > 0, options)}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(minutes.actionItems, options), minutes.actionItems.length > 0, options) : ""}
    ${renderAppendices(minutes.appendices, options)}
    ${renderNextMeeting(minutes, options)}

    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}

    ${renderProxiesBlock(options.proxies)}
    ${renderConflictsBlock(options.conflicts)}
    ${options.includeSignatures ? renderSignatureBlock(options.signatures) : ""}

    ${options.includeTranscript && minutes.draftTranscript ? `
      <h2>Transcript</h2>
      <p class="muted">Raw transcript retained with these minutes.</p>
      <p style="font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; white-space: pre-wrap;">${eh(minutes.draftTranscript)}</p>
    ` : ""}


  `;
}

function renderFormalAgmMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const meetingKind = meeting.type === "AGM" ? "Annual General Meeting" : `${meeting.type} Meeting`;
  const chair = minutes.chairName ?? placeholder("Chair", options);
  const secretary = minutes.secretaryName ?? minutes.recorderName ?? placeholder("Secretary", options);
  const callTime = displayDateOrText(minutes.calledToOrderAt) ?? timeOrUnrecorded(minutes.heldAt);
  const adjournedAt = displayDateOrText(minutes.adjournedAt);
  const adjournmentMotion = minutes.motions.find((motion) => /adjourn/i.test(motion.text));
  const nonAdjournmentMotions = minutes.motions.filter((motion) => motion !== adjournmentMotion);

  return `
    <h1>MINUTES OF THE ${eh(meetingKind.toUpperCase())} OF MEMBERS</h1>
    <p><strong>${eh(society.name)}</strong>${society.incorporationNumber ? ` (${eh(society.incorporationNumber)})` : ""}</p>
    <p class="meta">Held ${meeting.location ? `at ${eh(meeting.location)}` : "at the recorded meeting location"} on ${eh(formatLongDate(minutes.heldAt))}</p>
    ${renderRemoteParticipation(minutes.remoteParticipation)}

    <h2>Present</h2>
    ${renderAttendance(minutes)}

    <h2>1. Call the Meeting to Order</h2>
    <p>The ${eh(meetingKind)} of the Members of the Society was convened at ${eh(callTime)} by ${eh(chair)}, who acted as Chair of the meeting. ${meeting.noticeSentAt ? `Notice of meeting was sent on ${eh(formatLongDate(meeting.noticeSentAt))}.` : placeholderSentence("Notice date", options)} ${recordedMinutesQuorum(minutes) === true ? "Quorum was declared present." : recordedMinutesQuorum(minutes) === false ? "Quorum was not met." : "Quorum was not recorded in the source."} ${eh(secretary)} acted as Secretary of the Meeting.</p>

    ${renderAgendaAdoption(meeting.agendaItems ?? [], options, meeting.agendaItemTree)}

    <h2>Business of the Meeting</h2>
    ${minutes.discussion ? `<p>${eh(minutes.discussion).replace(/\n/g, "<br/>")}</p>` : placeholderParagraph("Business discussion", options)}
    ${renderAgmDetails(minutes.agmDetails, options)}
    ${renderMinuteSections(minutes.sections, options)}

    ${renderOptionalSection("Resolutions", nonAdjournmentMotions.map(renderFormalMotion).join(""), nonAdjournmentMotions.length > 0, options)}

    <h2>Other Business</h2>
    ${minutes.decisions.length
      ? `<ol>${minutes.decisions.map((decision) => `<li>${eh(decision)}</li>`).join("")}</ol>`
      : "<p>There was no other business recorded.</p>"}

    ${options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(minutes.actionItems, options), minutes.actionItems.length > 0, options) : ""}
    ${renderAppendices(minutes.appendices, options)}
    ${renderNextMeeting(minutes, options)}

    <h2>Conclusion of Meeting</h2>
    ${adjournmentMotion || adjournedAt || options.includePlaceholders ? `<p>There being no further business, ${adjournmentMotion ? `upon motion duly made and accepted, ${eh(adjournmentMotion.text)}` : `the meeting was concluded at ${eh(adjournedAt ?? placeholder("adjournment time", options))}`}</p>` : ""}

    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${renderProxiesBlock(options.proxies)}
    ${renderConflictsBlock(options.conflicts)}
    ${options.includeSignatures ? renderSignatureBlock(options.signatures, "Chair", "Secretary") : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}

  `;
}

function renderExecutiveAgendaMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const agenda = meeting.agendaItems ?? [];
  // Render full recorded sections (discussion, decisions, action items), not
  // just their titles — falling back to bare agenda titles when nothing has
  // been recorded yet.
  const sectionRecords: Array<NonNullable<MinutesRenderArgs["minutes"]["sections"]>[number] | { title: string }> =
    (minutes.sections ?? []).length ? (minutes.sections ?? []) : agenda.map((title) => ({ title }));
  const callTime = displayDateOrText(minutes.calledToOrderAt) ?? timeOrUnrecorded(minutes.heldAt);
  const adjournedAt = displayDateOrText(minutes.adjournedAt);
  // Motions that no section claims still need to appear somewhere.
  const unplacedMotions = minutes.motions.filter(
    (motion) =>
      !isAdjournmentMotionForExport(motion) &&
      !sectionRecords.some((section, sectionIndex) =>
        motionBelongsToAgendaSection(motion, sectionIndex, section.title, agendaSectionSearchText(section)),
      ),
  );

  return `
    <h1>Minutes</h1>
    <p><strong>${eh(meeting.title)}</strong></p>
    <p class="meta">${eh(formatLongDateTime(minutes.heldAt))}${meeting.location ? ` · ${eh(meeting.location)}` : ""}${meeting.electronic ? " · Electronic / hybrid meeting" : ""}</p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>
    ${renderRemoteParticipation(minutes.remoteParticipation)}

    ${renderAttendanceSummary(minutes, options)}
    <p><strong>Meeting called to order:</strong> ${eh(callTime)}</p>

    ${sectionRecords.map((section, index) => renderExecutiveSection(index + 1, section, index, minutes, options)).join("")}
    ${unplacedMotions.length ? `<h2>Other Business</h2><ul>${unplacedMotions.map((motion) => `<li>${eh(executiveMotionBullet(motion))}</li>`).join("")}</ul>` : ""}

    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion Summary", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${renderNextMeeting(minutes, options)}
    ${renderAppendices(minutes.appendices, options)}

    ${adjournedAt || options.includePlaceholders ? `<p><strong>The meeting adjourned at ${eh(adjournedAt ?? placeholder("adjournment time", options))}.</strong></p>` : ""}
    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}

  `;
}

function renderNumberedAgendaMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const agendaItems = meeting.agendaItems ?? [];
  // Track each section's ORIGINAL index — motion.sectionIndex points into the
  // unfiltered sections array (or the full agenda tree, children included), so
  // filtering/flattening must not renumber the indexes motions are matched by.
  const recordedSections = (minutes.sections ?? [])
    .map((section, originalIndex) => ({ section: section as any, originalIndex }))
    .filter(({ section }) => hasAny(section.title, section.presenter, section.discussion, section.reportSubmitted, section.decisions?.length, section.actionItems?.length));
  const fallbackAgendaEntries = (
    meeting.agendaItemTree?.length
      ? meeting.agendaItemTree.map((entry) => ({ title: entry.title, depth: entry.depth }))
      : agendaItems.map((title) => ({ title }))
  ).map((section, originalIndex) => ({ section: section as any, originalIndex }));
  const businessSections = recordedSections.length ? recordedSections : fallbackAgendaEntries;
  const sections = businessSections.length
    ? businessSections
    : [{ title: "Call to order" }, { title: "Business arising" }, { title: "Other business" }].map(
        (section, originalIndex) => ({ section: section as any, originalIndex }),
      );
  const date = formatLongDate(minutes.heldAt || meeting.scheduledAt);
  const startTime = minutes.calledToOrderAt ? formatTime(minutes.calledToOrderAt) : timeOrUnrecorded(minutes.heldAt || meeting.scheduledAt);
  const endTime = minutes.adjournedAt ? formatTime(minutes.adjournedAt) : "";
  const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
  const location = meeting.location || minutes.nextMeetingLocation || placeholder("location", options);
  const presentLine = minutes.attendees.length ? minutes.attendees.join(", ") : placeholder("attendees", options);
  const absentLine = minutes.absent.length ? minutes.absent.join(", ") : "";
  const adjournmentMotion = minutes.motions.find((motion) => /adjourn/i.test(motion.text));
  const topicMotions = minutes.motions.filter((motion) => motion !== adjournmentMotion);
  const sectionTitles = new Set(sections.map(({ section }) => section.title));
  const extraSections = recordedSections
    .filter(({ section }) => !sectionTitles.has(section.title))
    .map(({ section }) => section);
  const unplacedTopicMotions = topicMotions.filter((motion) =>
    !sections.some(({ section, originalIndex }) =>
      motionBelongsToAgendaSection(
        motion,
        originalIndex,
        section.title,
        agendaSectionSearchText(section),
      ),
    ),
  );

  return `
    <h1>${eh(minutesTitleForSampleStyle(society.name, meeting))}</h1>
    <p><strong>Date:</strong> ${eh(date)} · <strong>Time:</strong> ${eh(timeRange)} · <strong>Location:</strong> ${eh(location)}</p>

    <h2>Attendees:</h2>
    <p><strong>Present:</strong> ${eh(presentLine)}</p>
    ${absentLine ? `<p><strong>Absent / Regrets:</strong> ${eh(absentLine)}</p>` : ""}
    <p>Quorum: ${minutesQuorumLabel(minutes)}${minutes.quorumRequired != null ? ` (${minutes.attendees.length} present / ${minutes.quorumRequired} required)` : ""}${minutes.quorumSourceLabel ? `; ${eh(minutes.quorumSourceLabel)}` : ""}</p>
    ${renderOfficialLine(minutes, options)}
    ${renderRemoteParticipation(minutes.remoteParticipation)}

    ${agendaItems.length || options.includePlaceholders ? `
      <h2>Agenda Items:</h2>
      ${agendaItems.length ? renderAgendaListHtml(agendaItems, meeting.agendaItemTree) : placeholderParagraph("agenda items", options)}
    ` : ""}

    ${(() => {
      // Walk sections, deriving "1." / "1a." labels from depth so sub-sections
      // render under their parent with letter-numbered headings.
      let rootCount = 0;
      let childCount = 0;
      return sections.map(({ section, originalIndex }) => {
        const depth: 0 | 1 = section?.depth === 1 ? 1 : 0;
        if (depth === 0 || rootCount === 0) {
          rootCount += 1;
          childCount = 0;
        } else {
          childCount += 1;
        }
        const label = agendaSequenceLabel(rootCount, childCount, options.agendaNumberingMode);
        return renderNumberedAgendaSection(label, originalIndex, section, minutes, topicMotions, options, depth);
      }).join("");
    })()}
    ${extraSections.length ? renderMinuteSections(extraSections, options) : ""}
    ${unplacedTopicMotions.length ? `<h2>Other Motions</h2>${unplacedTopicMotions.map(renderSampleMotion).join("")}` : ""}

    <h2>Adjournment</h2>
    ${adjournmentMotion ? renderSampleMotion(adjournmentMotion) : ""}
    ${minutes.adjournedAt || options.includePlaceholders ? `<p>The meeting was adjourned at ${eh(minutes.adjournedAt ? formatTime(minutes.adjournedAt) : placeholder("adjournment time", options))}.</p>` : "<p>There being no further business, the meeting was adjourned.</p>"}

    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion Summary", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}
    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${options.includeActionItems ? renderSampleActionItems(minutes.actionItems, options) : ""}
    ${renderSampleNextMeeting(minutes, options)}
    ${renderAppendices(minutes.appendices, options)}
    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${renderProxiesBlock(options.proxies)}
    ${renderConflictsBlock(options.conflicts)}
    ${options.includeSignatures ? renderSignatureBlock(options.signatures) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}

  `;
}

function renderActionTableMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const agenda = (minutes.sections ?? []).length ? (minutes.sections ?? []).map((section) => section.title) : meeting.agendaItems ?? [];
  const rows = agenda.length ? agenda : ["Welcome", "Business", "Other Business", "Upcoming Meetings", "Adjourn"];
  return `
    <h1>${eh(meeting.title)}</h1>
    <p class="meta">${eh(formatLongDateTime(minutes.heldAt))}${meeting.location ? ` · ${eh(meeting.location)}` : ""}</p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>
    ${renderRemoteParticipation(minutes.remoteParticipation)}

    <h2>Attendance</h2>
    ${renderAttendance(minutes, "Members Present", "Regrets")}

    <h2>Agenda</h2>
    <table>
      <tr><th style="width: 30%;">Agenda Item</th><th>Group Action</th></tr>
      ${rows.map((item, index) => `
        <tr>
          <td><strong>${eh(item)}</strong></td>
          <td>${renderActionTableCell(index, minutes, options)}</td>
        </tr>
      `).join("")}
    </table>

    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion Summary", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(minutes.actionItems, options), minutes.actionItems.length > 0, options) : ""}
    ${renderAgmDetails(minutes.agmDetails, options)}
    ${renderAppendices(minutes.appendices, options)}
    ${renderNextMeeting(minutes, options)}
    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}

  `;
}

function renderBoardPublicMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  // Render full recorded sections (discussion, decisions, action items, and
  // the motions that belong to each) rather than bare headings with content
  // hardcoded under positions 1 and 3 of whatever the agenda happens to be.
  const sectionRecords: Array<NonNullable<MinutesRenderArgs["minutes"]["sections"]>[number] | { title: string }> =
    (minutes.sections ?? []).length
      ? (minutes.sections ?? [])
      : ((meeting.agendaItems ?? []).length
          ? (meeting.agendaItems ?? []).map((title) => ({ title }))
          : ["Call to order", "Approval of the Agenda", "Minutes", "Reports", "Other Business", "Adjournment"].map((title) => ({ title })));
  const callTime = displayDateOrText(minutes.calledToOrderAt) ?? timeOrUnrecorded(minutes.heldAt);
  const callToOrderSentence = `<p>${eh(minutes.chairName ?? placeholder("presiding officer", options))} called the meeting to order at ${eh(callTime)}.</p>`;
  // Attach the call-to-order line to the section actually about it, not
  // blindly to whichever section renders first.
  const callToOrderIndex = sectionRecords.findIndex((section) =>
    /\b(call(?:ed)? to order|welcome|opening)\b/i.test(String(section.title ?? "")),
  );
  // Motions no section claims still need to appear once — previously ALL
  // motions re-rendered in a trailing "Motions" block, duplicating any that
  // also matched a section.
  const unplacedMotions = minutes.motions.filter(
    (motion) =>
      !isAdjournmentMotionForExport(motion) &&
      !sectionRecords.some((section, sectionIndex) =>
        motionBelongsToAgendaSection(motion, sectionIndex, section.title, agendaSectionSearchText(section)),
      ),
  );
  return `
    <h1>${eh(meeting.title)}</h1>
    <p><strong>Public Session Minutes</strong></p>
    <p class="meta">${eh(formatLongDate(minutes.heldAt))}${formatTime(minutes.heldAt) ? ` · ${eh(formatTime(minutes.heldAt))}` : ""}${meeting.location ? ` · ${eh(meeting.location)}` : ""}</p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>
    ${renderSessionSegments(minutes.sessionSegments)}
    ${callToOrderIndex === -1 ? callToOrderSentence : ""}

    ${sectionRecords.map((section, index) =>
      renderBoardPublicSection(index, section, minutes, options, index === callToOrderIndex ? callToOrderSentence : ""),
    ).join("")}

    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}

    ${unplacedMotions.length ? `<h2>Other Motions</h2>${unplacedMotions.map(renderBoardMotion).join("")}` : ""}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(minutes.actionItems, options), minutes.actionItems.length > 0, options) : ""}
    ${renderAppendices(minutes.appendices, options)}

    <h2>Participants</h2>
    ${renderAttendance(minutes)}

    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}

  `;
}

function renderBoardPublicSection(
  index: number,
  section: NonNullable<MinutesRenderArgs["minutes"]["sections"]>[number] | { title: string },
  minutes: MinutesRenderArgs["minutes"],
  options: Required<MinutesExportOptions>,
  lead: string,
) {
  const eh = escapeHtml;
  // Explicit motion→section assignments win over keyword matching, so an
  // assigned motion never renders under the wrong heading or twice.
  const searchText = agendaSectionSearchText(section);
  const matchingMotions = minutes.motions.filter((motion) =>
    motionBelongsToAgendaSection(motion, index, section.title, searchText),
  );
  const presenter = "presenter" in section ? section.presenter ?? "" : "";
  const discussion = "discussion" in section ? section.discussion ?? "" : "";
  const decisions = "decisions" in section ? section.decisions ?? [] : [];
  const actionItems = "actionItems" in section ? section.actionItems ?? [] : [];
  const parts = [
    lead,
    presenter ? `<p><strong>Presenter:</strong> ${eh(presenter)}</p>` : "",
    discussion ? renderMinutesMarkdownHtml(discussion) : "",
    decisions.length ? `<ul>${decisions.map((decision) => `<li>${eh(decision)}</li>`).join("")}</ul>` : "",
    matchingMotions.map(renderBoardMotion).join(""),
    options.includeActionItems && actionItems.length
      ? `<p><strong>Action Items:</strong></p><ul>${actionItems.map((item) => `<li>${eh(item.assignee ? `${item.assignee}: ${item.text}` : item.text)}${item.dueDate ? ` (${eh(item.dueDate)})` : ""}</li>`).join("")}</ul>`
      : "",
  ].filter(Boolean).join("");
  return `
    <h2>${index + 1} – ${eh(section.title)}</h2>
    ${parts}
  `;
}

function normalizeMinutesStyleId(styleId: MinutesExportStyleId | undefined): MinutesExportStyleId {
  return MINUTES_EXPORT_STYLES.some((style) => style.id === styleId) ? styleId! : "standard";
}

function renderFormalMotion(motion: MinutesRenderArgs["minutes"]["motions"][number]) {
  const eh = escapeHtml;
  const accepted = motion.secondedBy ? "seconded" : "accepted";
  return `
    <p><strong>UPON MOTION</strong> duly made${motion.movedBy ? ` by ${eh(motion.movedBy)}` : ""} and ${accepted}${motion.secondedBy ? ` by ${eh(motion.secondedBy)}` : ""}, it was RESOLVED THAT ${eh(stripMotionLeadIn(motion.text))}</p>
    <p class="meta"><strong>${eh(motion.outcome.toUpperCase())}</strong>${voteSummary(motion) ? ` · ${eh(voteSummary(motion))}` : ""}</p>
  `;
}

function executiveMotionBullet(motion: MinutesRenderArgs["minutes"]["motions"][number]) {
  return `Motion to ${stripMotionLeadIn(motion.text)}${motion.movedBy ? ` by ${motion.movedBy}` : ""}${motion.secondedBy ? `; seconded by ${motion.secondedBy}` : ""}. ${motion.outcome}.`;
}

function renderExecutiveSection(
  displayNumber: number,
  section: NonNullable<MinutesRenderArgs["minutes"]["sections"]>[number] | { title: string },
  sectionIndex: number,
  minutes: MinutesRenderArgs["minutes"],
  options: Required<MinutesExportOptions>,
) {
  const eh = escapeHtml;
  // Respect explicit motion→section assignments (sectionIndex/sectionTitle)
  // before falling back to keyword matching, so an assigned motion never
  // renders under the wrong heading or twice.
  const sectionSearchText = agendaSectionSearchText(section);
  const matchingMotions = minutes.motions.filter(
    (motion) => motionBelongsToAgendaSection(motion, sectionIndex, section.title, sectionSearchText),
  );
  const presenter = "presenter" in section ? section.presenter ?? "" : "";
  const discussion = "discussion" in section ? section.discussion ?? "" : "";
  const decisions = "decisions" in section ? section.decisions ?? [] : [];
  const sectionActions = "actionItems" in section ? section.actionItems ?? [] : [];
  const bullets = [
    ...(presenter ? [`Presenter: ${presenter}`] : []),
    ...(discussion ? [discussion] : []),
    ...decisions.map((decision) => `Decision: ${decision}`),
    ...matchingMotions.map(executiveMotionBullet),
    ...(options.includeActionItems
      ? sectionActions.map((item) => `Action Item: ${item.assignee ? `${item.assignee} to ` : ""}${item.text}${item.dueDate ? ` by ${item.dueDate}` : ""}.`)
      : []),
  ];
  return `
    <h2>${displayNumber}. ${eh(section.title)}</h2>
    ${bullets.length ? `<ul>${bullets.map((bullet) => `<li>${eh(bullet)}</li>`).join("")}</ul>` : "<p class='muted'>No structured notes recorded for this agenda item.</p>"}
  `;
}

function renderNumberedAgendaSection(
  label: string,
  sectionIndex: number,
  section: NonNullable<MinutesRenderArgs["minutes"]["sections"]>[number] | { title: string },
  minutes: MinutesRenderArgs["minutes"],
  motions: MinutesRenderArgs["minutes"]["motions"],
  options: Required<MinutesExportOptions>,
  depth: 0 | 1 = 0,
) {
  const eh = escapeHtml;
  const sectionSearchText = agendaSectionSearchText(section);
  const matchingMotions = motions.filter((motion) => motionBelongsToAgendaSection(motion, sectionIndex, section.title, sectionSearchText));
  const matchingActions = "actionItems" in section ? section.actionItems ?? [] : [];
  const discussion = "discussion" in section ? section.discussion : "";
  const decisions = "decisions" in section ? section.decisions ?? [] : [];
  const presenter = "presenter" in section ? section.presenter : "";
  const reportSubmitted = "reportSubmitted" in section ? section.reportSubmitted : false;
  const parts = [
    presenter ? `<p><strong>Presenter:</strong> ${eh(presenter)}</p>` : "",
    reportSubmitted ? "<p>Report submitted in writing.</p>" : "",
    discussion ? renderMinutesMarkdownHtml(discussion) : "",
    decisions.length ? `<ul>${decisions.map((decision) => `<li>${eh(decision)}</li>`).join("")}</ul>` : "",
    matchingMotions.map(renderSampleMotion).join(""),
    options.includeActionItems && matchingActions.length ? `<p><strong>Action Items:</strong></p><ul>${matchingActions.map((item) => `<li>${eh(item.assignee ? `${item.assignee}: ${item.text}` : item.text)}${item.dueDate ? ` (${eh(item.dueDate)})` : ""}</li>`).join("")}</ul>` : "",
  ].filter(Boolean).join("");

  // Sub-sections drop down to <h3> so screen readers and Word's outline view
  // pick up the parent/child relationship.
  const heading = depth === 1 ? "h3" : "h2";
  return `
    <${heading}>${eh(label)} ${eh(section.title)}</${heading}>
    ${parts || placeholderParagraph("agenda item details", options)}
  `;
}

function renderSampleMotion(motion: MinutesRenderArgs["minutes"]["motions"][number]) {
  const eh = escapeHtml;
  const normalizedOutcome = motion.outcome ? humanizeLabel(motion.outcome) : "Recorded";
  return `
    <p><strong>Motion:</strong> ${eh(stripMotionLeadIn(motion.text))}</p>
    ${motion.movedBy ? `<p><strong>First:</strong> ${eh(motion.movedBy)}</p>` : ""}
    ${motion.secondedBy ? `<p><strong>Second:</strong> ${eh(motion.secondedBy)}</p>` : ""}
    <p><strong>Motion ${eh(normalizedOutcome)}</strong>${voteSummary(motion) ? ` (${eh(voteSummary(motion))})` : ""}</p>
  `;
}

function renderSampleActionItems(actionItems: MinutesActionItem[], options: Required<MinutesExportOptions>) {
  if (!actionItems.length) {
    return options.includePlaceholders ? `<h2>Action Items</h2>${placeholderParagraph("action items", options)}` : "";
  }
  const grouped = new Map<string, MinutesActionItem[]>();
  for (const item of actionItems) {
    const key = item.assignee?.trim() || "Unassigned";
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return `
    <h2>Action Items</h2>
    ${Array.from(grouped.entries()).map(([assignee, items]) => `
      <p><strong>${escapeHtml(assignee)}:</strong></p>
      <ul>${items.map((item) => `<li>${escapeHtml(item.text)}${item.dueDate ? ` (${escapeHtml(item.dueDate)})` : ""}${item.done ? " - Done" : ""}</li>`).join("")}</ul>
    `).join("")}
  `;
}

function renderSampleNextMeeting(minutes: MinutesRenderArgs["minutes"], options: Required<MinutesExportOptions>) {
  if (!hasAny(minutes.nextMeetingAt, minutes.nextMeetingLocation, minutes.nextMeetingNotes)) {
    return options.includePlaceholders ? `<h2>Next Meeting</h2>${placeholderParagraph("next meeting details", options)}` : "";
  }
  const notes = String(minutes.nextMeetingNotes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return `
    <h2>Next Meeting</h2>
    ${minutes.nextMeetingAt ? `<p><strong>Date / Time:</strong> ${escapeHtml(displayDateOrText(minutes.nextMeetingAt) ?? minutes.nextMeetingAt)}</p>` : ""}
    ${minutes.nextMeetingLocation ? `<p><strong>Location:</strong> ${escapeHtml(minutes.nextMeetingLocation)}</p>` : ""}
    ${notes.length ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
  `;
}

function renderOfficialLine(minutes: MinutesRenderArgs["minutes"], options: Required<MinutesExportOptions>) {
  const officers = [
    minutes.chairName ? `Chair: ${minutes.chairName}` : "",
    minutes.secretaryName ? `Secretary: ${minutes.secretaryName}` : "",
    minutes.recorderName ? `Recorder: ${minutes.recorderName}` : "",
  ].filter(Boolean);
  if (!officers.length) return options.includePlaceholders ? `<p class="muted">[chair, secretary, and recorder not recorded]</p>` : "";
  return `<p>${officers.map(escapeHtml).join(" · ")}</p>`;
}

function minutesTitleForSampleStyle(societyName: string, meeting: MinutesRenderArgs["meeting"]) {
  if (/minutes$/i.test(meeting.title.trim())) return meeting.title;
  if (/board/i.test(meeting.title) || meeting.type === "Board") return `${societyName} Board of Directors Meeting Minutes`;
  return `${meeting.title} Minutes`;
}

function renderActionTableCell(
  index: number,
  minutes: MinutesRenderArgs["minutes"],
  options: Required<MinutesExportOptions>,
) {
  const eh = escapeHtml;
  if (index === 0) {
    return [
      `Meeting started at ${eh(timeOrUnrecorded(minutes.heldAt))}`,
      `Quorum: ${minutesQuorumLabel(minutes)}`,
    ].join("<br/>");
  }
  if (index === 1) {
    const motions = minutes.motions.slice(0, 4);
    if (motions.length) {
      return motions.map((motion) => `Motion to ${eh(stripMotionLeadIn(motion.text))}<br/><strong>${eh(motion.outcome)}</strong>`).join("<br/><br/>");
    }
  }
  if (index === 2 && minutes.discussion) return eh(minutes.discussion).replace(/\n/g, "<br/>");
  if (index === 3 && minutes.actionItems.length) {
    return minutes.actionItems.map((item) => `ACTION - ${eh(item.assignee ? `${item.assignee} to ${item.text}` : item.text)}`).join("<br/>");
  }
  if (index === 4) {
    return `Meeting adjourned at ${
      minutes.adjournedAt
        ? eh(displayDateOrText(minutes.adjournedAt) ?? minutes.adjournedAt)
        : eh(placeholder("adjournment time", options))
    }`;
  }
  return placeholderParagraph("group action", options);
}

function renderBoardMotion(motion: MinutesRenderArgs["minutes"]["motions"][number]) {
  const eh = escapeHtml;
  return `
    <div class="motion">
      <p><strong>${eh(stripMotionLeadIn(motion.text))}</strong></p>
      <p>Motion: ${eh(motion.movedBy ?? "Not recorded")}</p>
      <p>First/Second: ${eh([motion.movedBy, motion.secondedBy].filter(Boolean).join("/") || "Not recorded")}</p>
      <p>In Favour: ${motion.votesFor != null ? eh(String(motion.votesFor)) : "All recorded votes"}</p>
      <p><strong>${eh(motion.outcome.toUpperCase())}</strong>${voteSummary(motion) ? ` · ${eh(voteSummary(motion))}` : ""}</p>
    </div>
  `;
}

function renderAgendaAdoption(
  agendaItems: string[],
  options: Required<MinutesExportOptions>,
  tree?: { title: string; depth: 0 | 1 }[],
) {
  if (!agendaItems.length) return placeholderParagraph("Agenda adoption", options);
  return `
    <h2>2. Approval of Agenda</h2>
    <p>The agenda was presented to the meeting.</p>
    ${renderAgendaListHtml(agendaItems, tree)}
  `;
}

// Build an <ol> of agenda items. When the structured tree is supplied,
// sub-items render as "1a. / 1b." rows beneath their root, matching the
// formal-minutes convention used in the on-screen section list.
function renderAgendaListHtml(
  agendaItems: string[],
  tree?: { title: string; depth: 0 | 1 }[],
): string {
  if (!tree || tree.length === 0) {
    return `<ol>${agendaItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
  }
  const parts: string[] = [];
  let rootNumber = 0;
  for (let i = 0; i < tree.length; i += 1) {
    const entry = tree[i];
    if (entry.depth !== 0) continue;
    rootNumber += 1;
    const children: string[] = [];
    for (let j = i + 1; j < tree.length && tree[j].depth === 1; j += 1) {
      children.push(tree[j].title);
    }
    const childList = children.length
      ? `<ol style="list-style: none; padding-left: 1.25em;">${children
          .map((title, ci) => `<li>${escapeHtml(`${rootNumber}${String.fromCharCode(97 + ci)}.`)} ${escapeHtml(title)}</li>`)
          .join("")}</ol>`
      : "";
    parts.push(`<li>${escapeHtml(entry.title)}${childList}</li>`);
  }
  return `<ol>${parts.join("")}</ol>`;
}

function renderOfficialDetails(minutes: MinutesRenderArgs["minutes"]) {
  const rows = [
    ["Chair", minutes.chairName],
    ["Secretary", minutes.secretaryName],
    ["Recorder", minutes.recorderName],
    ["Called to order", displayDateOrText(minutes.calledToOrderAt)],
    ["Adjourned", displayDateOrText(minutes.adjournedAt)],
  ].filter(([, value]) => hasText(value));
  if (!rows.length) return "";
  return `
    <h2>Meeting Officers</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><th style="width: 32%;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}
    </table>
  `;
}

function renderRemoteParticipation(remote: MinutesRenderArgs["minutes"]["remoteParticipation"]) {
  if (!remote || !hasAny(remote.url, remote.meetingId, remote.passcode, remote.instructions)) return "";
  const rows = [
    ["Meeting link", remote.url],
    ["Meeting ID", remote.meetingId],
    ["Passcode", remote.passcode],
    ["Instructions", remote.instructions],
  ].filter(([, value]) => hasText(value));
  return `
    <h2>Remote Participation</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><th style="width: 32%;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}
    </table>
  `;
}

function renderSessionSegments(segments: MinutesRenderArgs["minutes"]["sessionSegments"]) {
  if (!segments?.length) return "";
  return `
    <h2>Session Segments</h2>
    <table>
      <tr><th>Type</th><th>Title</th><th>Start</th><th>End</th><th>Notes</th></tr>
      ${segments.map((segment) => `
        <tr>
          <td>${escapeHtml(humanizeLabel(segment.type))}</td>
          <td>${escapeHtml(segment.title ?? "—")}</td>
          <td>${escapeHtml(displayDateOrText(segment.startedAt) ?? "—")}</td>
          <td>${escapeHtml(displayDateOrText(segment.endedAt) ?? "—")}</td>
          <td>${escapeHtml(segment.notes ?? "—")}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function renderAttendance(
  minutes: MinutesRenderArgs["minutes"],
  presentLabel = "Present",
  absentLabel = "Absent / Regrets",
) {
  if (minutes.detailedAttendance?.length) return renderDetailedAttendance(minutes.detailedAttendance);
  return renderAttendanceTwoColumn(minutes.attendees, minutes.absent, presentLabel, absentLabel);
}

function renderDetailedAttendance(rows: DetailedAttendance[]) {
  return `
    <table>
      <tr><th>Status</th><th>Name</th><th>Role</th><th>Affiliation</th><th>ID</th><th>Proxy / quorum</th><th>Notes</th></tr>
      ${rows.map((row) => `
        <tr>
          <td>${escapeHtml(humanizeLabel(row.status))}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.roleTitle ?? "—")}</td>
          <td>${escapeHtml(row.affiliation ?? "—")}</td>
          <td>${escapeHtml(row.memberIdentifier ?? "—")}</td>
          <td>${escapeHtml([
            row.proxyFor ? `Proxy for ${row.proxyFor}` : "",
            row.quorumCounted == null ? "" : row.quorumCounted ? "Counts for quorum" : "Not counted for quorum",
          ].filter(Boolean).join("; ") || "—")}</td>
          <td>${escapeHtml(row.notes ?? "—")}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function renderAttendanceSummary(minutes: MinutesRenderArgs["minutes"], options: Required<MinutesExportOptions>) {
  if (minutes.detailedAttendance?.length) {
    return `
      <h2>Attendance</h2>
      ${renderDetailedAttendance(minutes.detailedAttendance)}
    `;
  }
  const present = minutes.attendees.length ? escapeHtml(minutes.attendees.join("; ")) : escapeHtml(placeholder("attendees", options));
  const regrets = minutes.absent.length ? escapeHtml(minutes.absent.join("; ")) : escapeHtml(placeholder("regrets", options));
  return `
    <p><strong>In attendance:</strong> ${present}</p>
    <p><strong>Regrets:</strong> ${regrets}</p>
  `;
}

function renderMinuteSections(sections: MinutesRenderArgs["minutes"]["sections"], options: Required<MinutesExportOptions>) {
  if (!sections?.length) return "";
  return sections
    .filter((section) => hasAny(section.title, section.presenter, section.discussion, section.reportSubmitted, section.decisions?.length, section.actionItems?.length))
    .map((section) => {
      const bits = [
        section.presenter ? `<p class="meta">Presenter: ${escapeHtml(section.presenter)}</p>` : "",
        section.reportSubmitted ? `<p class="meta">Report submitted in writing.</p>` : "",
        section.discussion ? renderMinutesMarkdownHtml(section.discussion) : "",
        section.motionText ? `<p><strong>${section.sourceKind && section.sourceKind !== "recorded_minutes" ? "Proposed motion wording" : "Motion wording"}:</strong> ${escapeHtml(section.motionText)}</p>` : "",
        section.sourceReference ? `<p class="meta">Source: ${escapeHtml(section.sourceReference)}${section.sourceReviewStatus ? ` · ${escapeHtml(section.sourceReviewStatus)}` : ""}</p>` : "",
        section.decisions?.length ? renderOptionalSection("Decisions", renderDecisionsList(section.decisions, options), true, options, "h3") : "",
        section.actionItems?.length && options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(section.actionItems, options), true, options, "h3") : "",
      ].filter(Boolean).join("");
      return renderOptionalSection(section.title, bits, hasText(bits), options);
    })
    .join("");
}

function renderMinutesMarkdownHtml(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const hasMarkdownList = lines.some((line) => /^\s*(?:[-*+]|[o○●]|\d+[.)])\s+/.test(line));
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  if (!hasMarkdownList && nonEmptyLines.length > 1) {
    return `<ul>${nonEmptyLines.map((line) => `<li>${renderMarkdownInline(line)}</li>`).join("")}</ul>`;
  }

  const html: string[] = [];
  let openTop = false;
  let openChild = false;

  const closeChild = () => {
    if (!openChild) return;
    html.push("</ul>");
    openChild = false;
  };
  const closeTop = () => {
    closeChild();
    if (!openTop) return;
    html.push("</li></ul>");
    openTop = false;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      closeTop();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeTop();
      const level = Math.min(heading[1].length + 2, 4);
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = rawLine.match(/^(\s*)(?:[-*+]|[o○●]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const level = bullet[1].replace(/\t/g, "  ").length >= 2 ? 1 : 0;
      if (level > 0 && openTop) {
        if (!openChild) {
          html.push("<ul>");
          openChild = true;
        }
        html.push(`<li>${renderMarkdownInline(bullet[2].trim())}</li>`);
      } else {
        closeChild();
        if (!openTop) {
          html.push("<ul>");
          openTop = true;
        } else {
          html.push("</li>");
        }
        html.push(`<li>${renderMarkdownInline(bullet[2].trim())}`);
      }
      continue;
    }
    closeTop();
    html.push(`<p>${renderMarkdownInline(trimmed)}</p>`);
  }
  closeTop();
  return html.join("");
}

function renderAppendices(appendices: MinutesRenderArgs["minutes"]["appendices"], options: Required<MinutesExportOptions>) {
  if (!appendices?.length) {
    return options.includePlaceholders ? renderOptionalSection("Appendices", placeholderParagraph("appendices", options), true, options) : "";
  }
  const rows = appendices.filter((row) => hasAny(row.title, row.type, row.reference, row.notes));
  if (!rows.length) return "";
  return renderOptionalSection(
    "Appendices",
    `<table data-variant="statement">
      <thead>
        <tr><th data-rule="header" style="width:38%">Title</th><th data-rule="header" style="width:22%">Type</th><th data-rule="header" style="width:25%">Reference</th><th data-rule="header" style="width:15%">Notes</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.title)}</td>
            <td>${escapeHtml(row.type ? humanizeLabel(row.type) : "—")}</td>
            <td>${escapeHtml(row.reference ?? "—")}</td>
            <td>${escapeHtml(row.notes ?? "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`,
    true,
    options,
  );
}

function renderAgmDetails(agm: MinutesRenderArgs["minutes"]["agmDetails"], options: Required<MinutesExportOptions>) {
  if (!agm || !hasAny(agm.financialStatementsPresented, agm.financialStatementsNotes, agm.directorElectionNotes, agm.directorAppointments?.length, agm.specialResolutionExhibits?.length)) {
    return options.includePlaceholders ? placeholderParagraph("AGM details", options) : "";
  }
  const parts = [
    agm.financialStatementsPresented || agm.financialStatementsNotes
      ? renderOptionalSection(
          "Financial Statements",
          `<p>${agm.financialStatementsPresented ? "Financial statements were presented." : ""}${agm.financialStatementsNotes ? ` ${escapeHtml(agm.financialStatementsNotes)}` : ""}</p>`,
          true,
          options,
          "h3",
        )
      : "",
    agm.directorElectionNotes ? renderOptionalSection("Director Elections", `<p>${escapeHtml(agm.directorElectionNotes)}</p>`, true, options, "h3") : "",
    agm.directorAppointments?.length
      ? renderOptionalSection(
          "Director Appointments",
          `<table>
            <tr><th>Name</th><th>Role</th><th>Affiliation</th><th>Term</th><th>Votes</th><th>Elected</th><th>Consent</th><th>Status</th><th>Notes</th></tr>
            ${agm.directorAppointments.map((row) => `
              <tr>
                <td>${escapeHtml(row.name)}</td>
                <td>${escapeHtml(row.roleTitle ?? "—")}</td>
                <td>${escapeHtml(row.affiliation ?? "—")}</td>
                <td>${escapeHtml(row.term ?? "—")}</td>
                <td>${row.votesReceived == null ? "—" : row.votesReceived}</td>
                <td>${row.elected == null ? "—" : row.elected ? "Yes" : "No"}</td>
                <td>${row.consentRecorded == null ? "—" : row.consentRecorded ? "Recorded" : "Not recorded"}</td>
                <td>${escapeHtml(row.status ?? "—")}</td>
                <td>${escapeHtml(row.notes ?? "—")}</td>
              </tr>
            `).join("")}
          </table>`,
          true,
          options,
          "h3",
        )
      : "",
    agm.specialResolutionExhibits?.length
      ? renderOptionalSection(
          "Special Resolution Exhibits",
          `<table>
            <tr><th>Title</th><th>Reference</th><th>Notes</th></tr>
            ${agm.specialResolutionExhibits.map((row) => `
              <tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.reference ?? "—")}</td><td>${escapeHtml(row.notes ?? "—")}</td></tr>
            `).join("")}
          </table>`,
          true,
          options,
          "h3",
        )
      : "",
  ].filter(Boolean).join("");
  return renderOptionalSection("AGM Details", parts, hasText(parts), options);
}

function renderNextMeeting(minutes: MinutesRenderArgs["minutes"], options: Required<MinutesExportOptions>) {
  if (!hasAny(minutes.nextMeetingAt, minutes.nextMeetingLocation, minutes.nextMeetingNotes)) {
    return options.includePlaceholders ? renderOptionalSection("Next Meeting", placeholderParagraph("next meeting date and time", options), true, options) : "";
  }
  const rows = [
    ["Date/time", displayDateOrText(minutes.nextMeetingAt)],
    ["Location", minutes.nextMeetingLocation],
    ["Notes", minutes.nextMeetingNotes],
  ].filter(([, value]) => hasText(value));
  return `
    <h2>Next Meeting</h2>
    <table>${rows.map(([label, value]) => `<tr><th style="width: 32%;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>
  `;
}

function renderOptionalSection(
  title: string,
  body: string,
  hasContent: boolean,
  options: Required<MinutesExportOptions>,
  heading: "h2" | "h3" = "h2",
) {
  if (!hasContent && !options.includePlaceholders) return "";
  const content = hasContent ? body : placeholderParagraph(title, options);
  return `<${heading}>${escapeHtml(title)}</${heading}>${content}`;
}

function renderAttendanceTwoColumn(
  attendees: string[],
  absent: string[],
  presentLabel = "Present",
  absentLabel = "Absent / Regrets",
) {
  return `
    <table>
      <tr>
        <th style="width: 50%;">${escapeHtml(presentLabel)}</th>
        <th style="width: 50%;">${escapeHtml(absentLabel)}</th>
      </tr>
      <tr>
        <td>${renderList(attendees)}</td>
        <td>${renderList(absent)}</td>
      </tr>
    </table>
  `;
}

function renderList(items: string[]) {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p class='muted'>—</p>";
}

function renderActionItemsTable(
  actionItems: MinutesActionItem[],
  options: Required<MinutesExportOptions> = DEFAULT_MINUTES_EXPORT_OPTIONS,
) {
  const eh = escapeHtml;
  return actionItems.length
    ? `<table>
        <tr><th>Item</th><th>Assignee</th><th>Due</th><th>Status</th></tr>
        ${actionItems.map((a) => `
          <tr>
            <td>${eh(a.text)}</td>
            <td>${eh(a.assignee ?? "—")}</td>
            <td>${eh(a.dueDate ?? "—")}</td>
            <td>${a.done ? "Done" : "Open"}</td>
          </tr>
        `).join("")}
      </table>`
    : placeholderParagraph("action items", options);
}

function renderDiscussion(discussion: string, options: Required<MinutesExportOptions>) {
  return discussion
    ? `<p>${escapeHtml(discussion).replace(/\n/g, "<br/>")}</p>`
    : placeholderParagraph("discussion", options);
}

function renderDecisionsList(
  decisions: string[],
  options: Required<MinutesExportOptions> = DEFAULT_MINUTES_EXPORT_OPTIONS,
) {
  return decisions.length
    ? `<ol>${decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol>`
    : placeholderParagraph("decisions", options);
}

function renderApprovalBlock(
  minutes: MinutesRenderArgs["minutes"],
  options: Required<MinutesExportOptions>,
) {
  if (!options.includeApprovalBlock) return "";
  return `
    <h2>Approval</h2>
    <p>${minutes.approvedAt
      ? `Approved on <strong>${escapeHtml(new Date(minutes.approvedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }))}</strong>.`
      : "<em>Pending approval at next meeting.</em>"}</p>
  `;
}

function renderProxiesBlock(proxies: MinutesProxyLine[] = []) {
  const active = proxies.filter((proxy) => !proxy.revoked);
  if (!active.length) return "";
  const rows = active
    .map(
      (proxy) => `
      <tr>
        <td>${escapeHtml(proxy.grantorName)}</td>
        <td>${escapeHtml(proxy.proxyHolderName)}</td>
        <td>${escapeHtml(proxy.instructions ?? "")}</td>
      </tr>`,
    )
    .join("");
  return `
    <h2>Proxies</h2>
    <table>
      <tr>
        <td class="meta">Grantor</td>
        <td class="meta">Proxy holder</td>
        <td class="meta">Instructions</td>
      </tr>
      ${rows}
    </table>
  `;
}

function renderConflictsBlock(conflicts: MinutesConflictLine[] = []) {
  if (!conflicts.length) return "";
  const rows = conflicts
    .map((conflict) => {
      const measures = [
        conflict.abstainedFromVote ? "abstained from the vote" : "",
        conflict.leftRoom ? "left the room" : "",
      ].filter(Boolean).join(" and ");
      const scope = conflict.motionLabel ? ` (${escapeHtml(conflict.motionLabel)})` : "";
      const detail = [
        conflict.natureOfInterest ? escapeHtml(conflict.natureOfInterest) : "",
        measures ? `The director ${measures}.` : "",
      ].filter(Boolean).join(" ");
      return `
      <tr>
        <td>${escapeHtml(conflict.directorName)}</td>
        <td>${escapeHtml(conflict.contractOrMatter)}${scope}</td>
        <td>${detail}</td>
      </tr>`;
    })
    .join("");
  return `
    <h2>Conflicts of Interest &amp; Recusals</h2>
    <table>
      <tr>
        <td class="meta">Director</td>
        <td class="meta">Matter</td>
        <td class="meta">Disclosure &amp; action taken</td>
      </tr>
      ${rows}
    </table>
  `;
}

function renderSignatureBlock(
  signatures: MinutesSignatureLine[] = [],
  leftLabel = "Chair",
  rightLabel = "Secretary",
) {
  // When e-signatures have been captured, list the actual signers, their role,
  // and the date signed instead of blank Chair/Secretary signature lines.
  if (signatures.length) {
    const rows = signatures
      .map((signature) => {
        const signed = signature.signedAtISO
          ? new Date(signature.signedAtISO).toLocaleDateString("en-CA", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";
        const mark = signature.imageDataUrl
          ? `<img src="${escapeHtml(signature.imageDataUrl)}" alt="${escapeHtml(signature.signerName)} signature" style="height: 32pt; max-width: 180pt; object-fit: contain;" />`
          : `<span style="font-family: 'Segoe Script', 'Brush Script MT', cursive; font-size: 14pt;">${escapeHtml(signature.signerName)}</span>`;
        return `
      <tr>
        <td style="border-left: 0; border-right: 0; border-top: 0;">
          ${mark}
          <div class="meta">${escapeHtml(signature.signerName)}</div>
        </td>
        <td class="meta" style="border: 0; white-space: nowrap;">${escapeHtml(signature.signerRole ?? "")}</td>
        <td class="meta" style="border: 0; white-space: nowrap;">${escapeHtml(signed)}</td>
      </tr>`;
      })
      .join("");
    return `
    <h2>Signatures</h2>
    <table>
      <tr>
        <td class="meta" style="border: 0; width: 50%;">Signature</td>
        <td class="meta" style="border: 0;">Role</td>
        <td class="meta" style="border: 0;">Date signed</td>
      </tr>
      ${rows}
    </table>
    <p class="meta">Electronically signed and retained with these minutes.</p>
  `;
  }
  return `
    <h2>Signatures</h2>
    <table>
      <tr>
        <td style="height: 42pt; border-left: 0; border-right: 0; border-top: 0;"></td>
        <td style="width: 12%; border: 0;"></td>
        <td style="height: 42pt; border-left: 0; border-right: 0; border-top: 0;"></td>
      </tr>
      <tr>
        <td class="meta">${escapeHtml(leftLabel)}</td>
        <td style="border: 0;"></td>
        <td class="meta">${escapeHtml(rightLabel)}</td>
      </tr>
    </table>
  `;
}

function renderTranscript(transcript: string) {
  return `
    <h2>Transcript</h2>
    <p class="muted">Raw transcript retained with these minutes.</p>
    <p style="font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; white-space: pre-wrap;">${escapeHtml(transcript)}</p>
  `;
}

function renderFooter(options: Required<MinutesExportOptions>) {
  return options.includeGeneratedFooter
    ? `<p class="meta" style="margin-top: 18pt;">Generated by Societyer · ${new Date().toLocaleDateString("en-CA")}</p>`
    : "";
}

function gap(label: string, ok: boolean, available: string, missing: string): MinutesDataGap {
  return {
    label,
    status: ok ? "available" : "missing",
    detail: ok ? available : missing,
  };
}

function hasText(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function hasAny(...values: unknown[]) {
  return values.some(hasText);
}

function humanizeLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayDateOrText(value: string | null | undefined) {
  if (!hasText(value)) return undefined;
  const text = String(value).trim();
  // Date-only values: parse as LOCAL calendar date and render without a time.
  // `new Date("2026-07-15")` is UTC midnight, which both shifts the day for
  // west-of-UTC users and fabricates a "5:00 p.m." time in the export.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const local = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (!Number.isNaN(local.getTime())) {
      return local.toLocaleDateString("en-CA", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(text)) {
    return date.toLocaleString("en-CA", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return text;
}

function placeholder(label: string, options: Required<MinutesExportOptions>) {
  return options.includePlaceholders ? `[${label} not recorded]` : "not recorded";
}

function placeholderSentence(label: string, options: Required<MinutesExportOptions>) {
  return options.includePlaceholders ? `${label}: [not recorded].` : "";
}

function placeholderParagraph(label: string, options: Required<MinutesExportOptions>) {
  return options.includePlaceholders ? `<p class="muted">[${escapeHtml(label)} not recorded]</p>` : "";
}

function stripMotionLeadIn(text: string) {
  return text
    .replace(/^\s*(?:motion|resolved|be it resolved)\s*(?:to|that)?\s*:?\s*/i, "")
    .trim()
    .replace(/[.]+$/, ".");
}

function motionMatchesSection(text: string, section: string) {
  const sectionWords = keywordSet(section);
  const textWords = keywordSet(text);
  return [...sectionWords].some((word) => textWords.has(word));
}

function motionBelongsToAgendaSection(
  motion: MinutesRenderArgs["minutes"]["motions"][number],
  sectionIndex: number,
  sectionTitle: string,
  sectionSearchText: string,
) {
  if (isAdjournmentMotionForExport(motion)) return false;
  if (motion.sectionIndex != null) return motion.sectionIndex === sectionIndex;
  if (motion.sectionTitle) {
    return normalizeExportText(motion.sectionTitle) === normalizeExportText(sectionTitle);
  }

  const sectionText = sectionSearchText || sectionTitle;
  const normalizedSection = normalizeExportText(sectionText);
  const normalizedMotion = normalizeExportText(motion.text);
  if (
    /\bagenda\b/.test(normalizedSection) &&
    /\b(approve|adopt|approval)\b/.test(normalizedMotion) &&
    /\bagenda\b/.test(normalizedMotion)
  ) {
    return true;
  }
  if (
    /\b(minutes?|previous minutes?|adopt minutes?)\b/.test(normalizedSection) &&
    /\b(approve|adopt|approval)\b/.test(normalizedMotion) &&
    /\bminutes?\b/.test(normalizedMotion)
  ) {
    return true;
  }
  const amounts = moneyAmounts(motion.text);
  if (amounts.length) {
    const compactSectionText = String(sectionText).replace(/\s+/g, "");
    if (!amounts.some((amount) => compactSectionText.includes(amount))) return false;
  }
  return motionMatchesSection(motion.text, sectionText);
}

function agendaSectionSearchText(section: NonNullable<MinutesRenderArgs["minutes"]["sections"]>[number] | { title: string }) {
  const discussion = "discussion" in section ? section.discussion ?? "" : "";
  const decisions = "decisions" in section ? section.decisions ?? [] : [];
  return [section.title, discussion, ...decisions].filter(Boolean).join(" ");
}

function moneyAmounts(text: string) {
  return String(text ?? "").match(/\$\s?\d[\d,]*(?:\.\d{2})?/g)?.map((amount) => amount.replace(/\s+/g, "")) ?? [];
}

function isAdjournmentMotionForExport(motion: { text?: string | null; sectionTitle?: string | null; resolutionType?: string | null }) {
  const text = `${motion.text ?? ""} ${motion.sectionTitle ?? ""} ${motion.resolutionType ?? ""}`.toLowerCase();
  return /\badjourn(?:ment|ed|s)?\b/.test(text);
}

function normalizeExportText(text: string | undefined | null) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function keywordSet(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 3 && !["meeting", "minutes", "motion", "approve"].includes(word)),
  );
}

function voteSummary(motion: MinutesRenderArgs["minutes"]["motions"][number]) {
  if (motion.votesFor == null && motion.votesAgainst == null && motion.abstentions == null) return "";
  return `For ${motion.votesFor ?? 0} · Against ${motion.votesAgainst ?? 0} · Abstain ${motion.abstentions ?? 0}`;
}

/** A stored instant that only carries a calendar day (A13): the noon-UTC
 *  placeholder or a bare YYYY-MM-DD. Never shown with a clock time. */
function isDateOnlyValue(value: string | null | undefined) {
  return isDateOnlyPlaceholder(value) || /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

function formatLongDateTime(value: string) {
  if (isDateOnlyValue(value)) return formatLongDate(value);
  return new Date(value).toLocaleString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLongDate(value: string) {
  if (isDateOnlyValue(value)) {
    // Format the calendar day itself; a time zone must not move it.
    return new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`).toLocaleDateString("en-CA", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
    });
  }
  return new Date(value).toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(value: string) {
  // Date-only meetings have no time; free text ("3:04 PM") is kept as written.
  if (!value || isDateOnlyValue(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).trim();
  return date.toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeOrUnrecorded(value: string) {
  return formatTime(value) || "a time not recorded in the source";
}

function renderSourceDecisionEvidence(minutes: MinutesRenderArgs["minutes"], quorumOnly = false) {
  const groups: [string, any[], (row:any)=>string][] = [
    ['Consent adoption', minutes.consentItems ?? [], row => `${row.title ?? row.id}: ${row.outcome}; pinned version ${row.documentVersionId ?? row.targetMinutesId ?? 'unknown'}`],
    ['Conditional decisions', minutes.conditionalDecisions ?? [], row => `${row.title ?? row.id}: source ${row.outcome}; ${decisionReadiness(row, minutes.decisionRequirements ?? [], minutes.quorumCheckpoints ?? [])}`],
    ['Condition and ratification observations', minutes.decisionRequirements ?? [], row => `${row.observedDate ?? 'unknown date'}: ${row.title ?? row.requirementKey ?? row.id}; ${row.kind}; ${row.state}`],
    ['Attendance observations', minutes.attendanceEvents ?? [], row => `${row.personName}: ${row.kind}; ${row.boundary ?? 'unknown time'}`],
    ['Quorum observations', minutes.quorumCheckpoints ?? [], row => `${row.scope === 'session' ? 'Session' : row.scope === 'item' ? 'Item' : 'Meeting'}${row.scopeLabel ? `: ${row.scopeLabel}` : ''}; boundary ${row.boundary}; source assertion ${row.assertion ?? 'not recorded'}; review ${row.reviewStatus ?? 'pending'}; result ${checkpointResult(row)}; time ${row.atTime ?? 'not recorded'}; present count ${row.eligibleCount ?? 'unknown'}, eligible population ${row.eligiblePopulation ?? 'unknown'}, threshold ${row.required ?? 'unknown'}; ${row.reason ?? ''}; ${row.evidence ?? ''}; ${(row.sourceExternalIds ?? []).join(', ')}`],
    ['Future meeting suggestions', minutes.futureMeetingSuggestions ?? [], row => `${row.title ?? row.committee ?? 'Meeting'}: ${row.date ?? 'unknown date'}; ${row.status}; ${row.venue ?? 'unknown venue'}`],
  ];
  return groups.filter(([title,rows])=>rows.length && (!quorumOnly || title === 'Quorum observations')).map(([title,rows,label])=>`<section><h2>${escapeHtml(title)}</h2><ul>${rows.map(row=>`<li>${escapeHtml(label(row))} <span class="meta">${escapeHtml(row.sourceReference ?? '')} · ${escapeHtml(row.sourceUrl ?? '')}</span></li>`).join('')}</ul></section>`).join('');
}

function isImportMetadataTranscript(value:unknown):boolean {
 if(typeof value!=='string')return false;
 try{const metadata=JSON.parse(value);return !!metadata&&typeof metadata==='object'&&(metadata.importSessionId||metadata.sourceDocumentIds||metadata.sourceExternalIds||metadata.importedMotions);}catch{return false;}
}
function sourceImageUrl(value:string|undefined):string|undefined {
 if(!value)return undefined;
 return /^(?:data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,|https?:\/\/|\/(?!\/)|\.\.?\/)/i.test(value)?value:undefined;
}
function sourceLinkUrl(value:string|undefined):string|undefined {return value&&/^(?:https?:\/\/|mailto:|\/(?!\/)|\.\.?\/)/i.test(value)?value:undefined;}
function renderLiteralSourceText(text:string,links:Array<{text:string;url:string;offset?:number}>=[]):string {
 let cursor=0;const pieces:string[]=[];
 for(const link of links){
  if(!sourceLinkUrl(link.url)||!link.text)continue;
  const offset=link.offset??text.indexOf(link.text,cursor);
  if(offset<cursor||text.slice(offset,offset+link.text.length)!==link.text)continue;
  pieces.push(escapeHtml(text.slice(cursor,offset)),`<a href="${escapeHtml(link.url)}">${escapeHtml(link.text)}</a>`);cursor=offset+link.text.length;
 }
 pieces.push(escapeHtml(text.slice(cursor)));return pieces.join('').replace(/\n/g,'<br/>');
}
/** A block taken from the original's page header or footer (word/header1.xml …). */
function isSourceHeaderFooterBlock(block:SourceMeetingBlock):boolean {
 return /word\/(?:header|footer)\d*\.xml/i.test(String((block as any).sourceReference??''));
}
/** Source table column widths as percentages. Importers record OOXML twips
 *  (e.g. [460, 2049, 7097, …]); rendering those as "%" overflowed the page and
 *  collapsed continuation rows to one-character columns (F20). */
export function sourceTableWidthPercents(widths:unknown):number[]|undefined {
 if(!Array.isArray(widths)||!widths.length)return undefined;
 const values=widths.map(value=>Number(value));
 if(values.some(value=>!Number.isFinite(value)||value<0))return undefined;
 const total=values.reduce((sum,value)=>sum+value,0);
 if(total<=0)return undefined;
 if(total<=100.5)return values;
 return values.map(value=>Math.round(value/total*1000)/10);
}
/** Width for a source image: leading letterhead logos stay logo-sized and an
 *  implausible page-wide width (a mis-read extent) never stretches it (F21). */
function sourceImageWidthStyle(block:Extract<SourceMeetingBlock,{kind:'image'}>,leading:boolean):string {
 const width=Number((block as any).width);
 if(leading)return `width:${Number.isFinite(width)&&width>0&&width<=192?Math.max(1,width):168}px;`;
 if(!Number.isFinite(width)||width<=0)return '';
 return `width:${Math.min(Math.max(1,width),576)}px;`;
}
export function renderSourceMeetingBlocks(blocks:SourceMeetingBlock[]):string {
 const firstTextIndex=blocks.findIndex(block=>(block.kind==='paragraph'||block.kind==='heading')&&!isSourceHeaderFooterBlock(block)&&String((block as any).text??'').trim());
 // Page-header text (a "DRAFT" watermark repeated in header1/2/3.xml) is shown
 // once as a watermark marker, not as repeated body headings (F21).
 const seenHeaderText=new Set<string>();
 return blocks.map((block,blockIndex)=>{
  if(block.kind==='page_break')return '<div style="page-break-before:always; break-before:page;"></div>';
  if((block.kind==='heading'||block.kind==='paragraph')&&isSourceHeaderFooterBlock(block)){
   const text=String((block as any).text??'').trim();
   if(!text||seenHeaderText.has(text.toLowerCase()))return '';
   seenHeaderText.add(text.toLowerCase());
   return `<p class="source-watermark" data-source-watermark="true" style="text-align:center;color:#b3b3b3;font-size:16pt;font-weight:bold;letter-spacing:6pt;margin:0 0 6pt;" title="Page header or watermark in the original">${escapeHtml(text)}</p>`;
  }
  if(block.kind==='image'){
   const url=sourceImageUrl(block.dataUrl??block.url);const description=[block.caption].filter(Boolean).join(' · ');
   const leading=firstTextIndex<0||blockIndex<firstTextIndex;
   return `<figure>${url?`<img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt??'Source image')}" style="max-width:100%;height:auto;${sourceImageWidthStyle(block,leading)}" />`:''}${description?`<p class="meta">${escapeHtml(description)}</p>`:''}${!url?'<p class="meta">Source image is retained with the original document.</p>':''}</figure>`;
  }
  if(block.kind==='table'){
   const percents=sourceTableWidthPercents(block.widths);
   return `<table data-variant="source" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tbody>${block.rows.map(row=>`<tr>${row.cells.map((cell,index)=>{
    const tag=cell.header?'th':'td';const paragraphs=cell.paragraphs?.length?cell.paragraphs:[cell.text];
    const contents=cell.blocks?.length?renderSourceMeetingBlocks(cell.blocks):paragraphs.map(text=>`<p style="white-space:pre-wrap;margin:0 0 3pt;">${escapeHtml(text).replace(/\n/g,'<br/>')}</p>`).join('');
    return `<${tag}${cell.colSpan&&cell.colSpan>1?` colspan="${cell.colSpan}"`:''}${cell.rowSpan&&cell.rowSpan>1?` rowspan="${cell.rowSpan}"`:''} style="vertical-align:top;border:1px solid #777;padding:4pt;${percents?.[index]?`width:${percents[index]}%;`:''}">${contents}</${tag}>`;
   }).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if(block.kind==='heading'){const level=Math.max(1,Math.min(6,block.level??2));return `<h${level}>${renderLiteralSourceText(block.text,block.links)}</h${level}>`;}
  return block.text?`<p style="white-space:pre-wrap;">${renderLiteralSourceText(block.text,block.links)}</p>`:'<p style="height:3pt;margin:0;"></p>';
 }).join('\n');
}
function renderSourceFidelityMinutes(args:MinutesRenderArgs,record:SourceMeetingRecord,styleId:MinutesExportStyleId,options:Required<MinutesExportOptions>):string {
 const renderedOriginals=new Map<string,SourceMeetingRecord['documents'][number]>();
 const sourceDocuments=record.documents.map((document,index)=>{
  const key=document.originalSha256?`${document.originalSha256}:${document.fullText}`:undefined;
  if(key&&renderedOriginals.has(key))return `<p class="meta">Additional reference to the same original: ${escapeHtml(document.title)} · ${escapeHtml(document.sourceReference)}. Its complete source content is included above.${sourceLinkUrl(document.originalUrl)?` <a href="${escapeHtml(document.originalUrl!)}">Original document</a>`:''}</p>`;
  if(key)renderedOriginals.set(key,document);
  const before=document.blocks.slice(0,document.primaryBlockStart);
  const main=document.blocks.slice(document.primaryBlockStart,document.primaryBlockEnd);
  const after=document.blocks.slice(document.primaryBlockEnd);
  const related=(blocks:SourceMeetingBlock[],label:string)=>blocks.length?`<section class="source-materials"><h2>${escapeHtml(label)}</h2><p class="meta">Related source material; it does not establish decisions at the selected meeting.</p>${renderSourceMeetingBlocks(blocks)}</section>`:'';
  return `<section class="source-document" data-source-document="${escapeHtml(document.documentId)}">
   ${index?`<h2>${escapeHtml(document.title)}</h2>`:''}
   <p class="meta">Source: ${escapeHtml(document.sourceReference)}${sourceLinkUrl(document.originalUrl)?` · <a href="${escapeHtml(document.originalUrl!)}">Original document</a>`:''}</p>
   ${related(before,'Source materials preceding the selected meeting')}
   <section class="source-meeting-body">${renderSourceMeetingBlocks(main)}</section>
   ${related(after,'Additional source materials')}
  </section>`;
 }).join('\n');
 const changed=changedSourceMinuteSections(record,args.minutes.sections??[]);
 const supplements=changed.length?`<section class="current-minute-additions"><h2>Current minute additions and edits</h2><p class="meta">These editable records supplement the retained source wording.</p>${renderMinuteSections(changed,{...options,includeActionItems:true})}${renderUnrepresentedSectionDetails({...args.minutes,sections:changed},renderMinuteSections(changed,{...options,includeActionItems:true}),options)}</section>`:'';
 const structuredExtras=renderNewStructuredMinuteInformation(args.minutes,record,options);
 return `<article data-minutes-style="${escapeHtml(styleId)}" data-source-fidelity="true" class="source-fidelity source-fidelity-${escapeHtml(styleId)}">
  <p class="meta">${escapeHtml(record.sourceKind==='recorded_minutes'?'Source recreation · imported minutes pending review':'Source recreation · proposed script, agenda or template wording')}${args.minutes.approvedAt?' · Adoption is recorded separately.':' · No approval is inferred.'}</p>
  ${sourceDocuments}${supplements}${structuredExtras}${renderMeetingHistory(args.minutes, options)}
  ${options.includeApprovalBlock?renderApprovalBlock(args.minutes,options):''}
  ${options.includeSignatures&&options.signatures.length?renderSignatureBlock(options.signatures):''}
  ${renderFooter(options)}
 </article>`;
}
function renderUnrepresentedSectionDetails(minutes:MinutesRenderArgs['minutes'],existingHtml:string,options:Required<MinutesExportOptions>):string {
 const content=(minutes.sections??[]).map(section=>{
  const parts:string[]=[];
  if(section.motionText&&!existingHtml.includes(escapeHtml(section.motionText)))parts.push(`<p><strong>${section.sourceKind&&section.sourceKind!=='recorded_minutes'?'Proposed motion wording':'Motion wording'}:</strong> ${escapeHtml(section.motionText)}</p>`);
  const tasks=(section.linkedTaskIds??[]).map(id=>{
   const task=minutes.linkedTasks?.find(row=>row._id===id||row.id===id);
   return `<li>${escapeHtml(task?.title??id)}${task?.description?` — ${escapeHtml(task.description)}`:''}${task?.dueDate?` · Due ${escapeHtml(task.dueDate)}`:''}${task?.status?` · ${escapeHtml(task.status)}`:''}</li>`;
  });
  if(tasks.length)parts.push(`<h3>Linked actions</h3><ul>${tasks.join('')}</ul>`);
  if(!parts.length)return '';
  if(section.sourceReference&&!existingHtml.includes(escapeHtml(section.sourceReference)))parts.push(`<p class="meta">Source: ${escapeHtml(section.sourceReference)}</p>`);
  return `<section><h2>${escapeHtml(section.title)}</h2>${parts.join('')}</section>`;
 }).filter(Boolean);
 return content.join('');
}
const CHANGE_FIELD_LABELS: Record<string, string> = {
 detailedAttendance: 'Attendance details', attendees: 'Present', absent: 'Regrets / absent', chairName: 'Chair',
 secretaryName: 'Secretary', recorderName: 'Recorder', calledToOrderAt: 'Called to order', adjournedAt: 'Adjourned',
 remoteParticipation: 'Remote participation', nextMeetingAt: 'Next meeting', nextMeetingLocation: 'Next meeting location',
 nextMeetingNotes: 'Next meeting notes', sessionSegments: 'Session segments', appendices: 'Appendices', quorumStatus: 'Quorum',
};
/** Reader-facing label for a corrected field ("detailedAttendance" → "Attendance details"). */
function changeFieldLabel(field: string): string {
 return CHANGE_FIELD_LABELS[field] ?? humanizeLabel(field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}
/** One-line, human-readable description of a corrected field. */
function describeFieldChange(field: string, before: any, after: any): string {
 const blank = (value: any) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
 const text = (value: any) => blank(value) ? '(blank)' : typeof value === 'string' ? value : String(value);
 const nameOf = (row: any) => typeof row === 'string' ? row : String(row?.name ?? row?.title ?? '').trim();
 if (Array.isArray(before) || Array.isArray(after)) {
  const beforeRows = Array.isArray(before) ? before : [];
  const afterRows = Array.isArray(after) ? after : [];
  const beforeNames = beforeRows.map(nameOf).filter(Boolean);
  const afterNames = afterRows.map(nameOf).filter(Boolean);
  const key = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const beforeKeys = new Set(beforeNames.map(key));
  const afterKeys = new Set(afterNames.map(key));
  const added = afterNames.filter((name) => !beforeKeys.has(key(name)));
  const removed = beforeNames.filter((name) => !afterKeys.has(key(name)));
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(', ')}`);
  if (removed.length) parts.push(`removed ${removed.join(', ')}`);
  if (!parts.length) {
   const statusChanges = afterRows.filter((row: any) => {
    const prior = beforeRows.find((candidate: any) => key(nameOf(candidate)) === key(nameOf(row)));
    return prior && typeof prior === 'object' && typeof row === 'object' && JSON.stringify(prior) !== JSON.stringify(row);
   }).length;
   parts.push(statusChanges ? `${statusChanges} entr${statusChanges === 1 ? 'y' : 'ies'} updated (status, role or affiliation)` : 'reordered or reformatted');
  }
  return `${parts.join('; ')} (now ${afterRows.length}, was ${beforeRows.length})`;
 }
 if ((before && typeof before === 'object') || (after && typeof after === 'object')) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const changed = keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null) && !(blank(before?.[k]) && blank(after?.[k])));
  return changed.length ? changed.map((k) => `${humanizeLabel(k)} ${text(before?.[k])} → ${text(after?.[k])}`).join('; ') : 'reformatted';
 }
 return `${text(before)} → ${text(after)}`;
}

function renderNewStructuredMinuteInformation(minutes:MinutesRenderArgs['minutes'],record:SourceMeetingRecord,options:Required<MinutesExportOptions>):string {
 const source=record.documents.map(document=>document.fullText).join('\n');
 const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
 const notInSource=(value:string)=>!!value&&!normalized(source).includes(normalized(value))&&!record.sectionBaseline.some(section=>JSON.stringify(section).includes(value));
 const baseline=record.structuredBaseline;
 const decisionBaseline=baseline?.decisions??[];const actionBaseline=baseline?.actionItems??[];const motionBaseline=baseline?.motions??[];
 const sameMotion=(a:any,b:any)=>JSON.stringify(['text','movedBy','secondedBy','outcome','votesFor','votesAgainst','abstentions'].map(key=>a[key]??null))===JSON.stringify(['text','movedBy','secondedBy','outcome','votesFor','votesAgainst','abstentions'].map(key=>b[key]??null));
 const sameAction=(a:any,b:any)=>JSON.stringify(['text','assignee','dueDate','done'].map(key=>a[key]??null))===JSON.stringify(['text','assignee','dueDate','done'].map(key=>b[key]??null));
 const extraDecisions=minutes.decisions.filter(decision=>baseline?!decisionBaseline.includes(decision):notInSource(decision));
 const extraActions=minutes.actionItems.filter(action=>baseline?!actionBaseline.some(old=>sameAction(old,action)):notInSource(action.text));
 const extraMotions=minutes.motions.filter(motion=>baseline?!motionBaseline.some(old=>sameMotion(old,motion)):notInSource(motion.text));
 const removedDecisions=baseline?decisionBaseline.filter(decision=>!minutes.decisions.includes(decision)):[];
 const removedActions=baseline?actionBaseline.filter(action=>!minutes.actionItems.some(current=>sameAction(current,action))):[];
 const removedMotions=baseline?motionBaseline.filter(motion=>!minutes.motions.some(current=>sameMotion(current,motion))):[];
 const removals=[...removedDecisions,...removedActions.map(action=>action.text),...removedMotions.map(motion=>motion.text)];
 const listFields=new Set(['detailedAttendance','attendees','absent','sessionSegments','appendices']);
 const comparableField=(field:string,value:any)=>listFields.has(field)&&(value==null||(Array.isArray(value)&&value.length===0))?null:value??null;
 const revisedFields=baseline?Object.keys(baseline.details).filter(field=>JSON.stringify(comparableField(field,(minutes as any)[field]))!==JSON.stringify(comparableField(field,baseline.details[field]))):[];
 // Human-readable "changes since import" (F21): what changed, not a dump of
 // every nested field. Internal copies only; public copies never carry it.
 const fieldChanges=revisedFields.length&&!options.publicCopy&&!options.publicOnly
  ?`<h2>Changes since import</h2><p class="meta">Corrections made in Societyer after the source was imported. The source wording is retained above.</p><ul>${revisedFields.map(field=>`<li><strong>${escapeHtml(changeFieldLabel(field))}:</strong> ${escapeHtml(describeFieldChange(field,baseline!.details[field],(minutes as any)[field]))}</li>`).join('')}</ul>`
  :'';
 const extras=[fieldChanges,removals.length?`<h2>Items changed or removed from the editable record</h2><p class="meta">The original source wording remains retained above.</p>${renderList(removals)}`:'',extraDecisions.length?`<h2>Current decisions</h2>${renderDecisionsList(extraDecisions,options)}`:'',extraActions.length?`<h2>Current actions</h2>${renderActionItemsTable(extraActions,options)}`:'',extraMotions.length?`<h2>Current motions</h2>${extraMotions.map(renderSampleMotion).join('')}`:'',renderSourceDecisionEvidence(minutes)];
 return extras.filter(Boolean).join('');
}

/** Shared history appendix: independent of layout style, and excluded from public copies. */
function renderMeetingHistory(minutes: MinutesRenderArgs["minutes"], options: Required<MinutesExportOptions>): string {
  if (options.publicCopy || options.publicOnly) return "";
  const eh = escapeHtml;
  const unknown = (value: string | number | undefined) => eh(value === undefined || value === "" ? "Not recorded" : String(value));
  const paragraph = (label: string, value?: string) => value ? `<p><strong>${eh(label)}:</strong> ${eh(value)}</p>` : "";
  const sources = (row: { sourceExternalIds?: string[]; sourceLocator?: string; evidence?: string; notes?: string }) => [
    row.sourceExternalIds?.length ? paragraph("Sources", row.sourceExternalIds.join("; ")) : "",
    paragraph("Source location", row.sourceLocator), paragraph("Evidence", row.evidence), paragraph("Notes", row.notes),
  ].join("");
  const actionLabels: Record<ActionObservation["status"], string> = { unknown: "Unknown", open: "Open", in_progress: "In progress", ongoing: "Ongoing", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };
  const actions = options.includeActionItems && minutes.actionObservations?.length ? `
    <section class="minutes-history"><h2>Action observations</h2>
    <p>Statuses are observations as of the recorded source date. They do not establish current completion. Separate observations may refer to the same action.</p>
    ${minutes.actionObservations.map((row) => `<div class="historical-action">
      <h3>${eh(row.text)}</h3>
      <p><strong>Status:</strong> ${eh(actionLabels[row.status] ?? "Unknown")} · <strong>As of:</strong> ${unknown(row.statusAsOf)}</p>
      <p><strong>Assignee:</strong> ${unknown(row.assignee)} · <strong>Assigned:</strong> ${unknown(row.dateAssigned)} · <strong>Due:</strong> ${unknown(row.dueDate)}</p>
      ${paragraph("Source action reference", row.sourceActionId)}
      <p class="meta"><strong>Action identity:</strong> ${eh(row.actionKey)} · <strong>Observation:</strong> ${eh(row.entryId)}</p>
      ${paragraph("Source status wording", row.sourceStatus)}
      ${row.carriedFromMinutesId ? paragraph("Carried from", `Minutes ${row.carriedFromMinutesId}, observation ${row.carriedFromEntryId ?? "not recorded"}`) : ""}
      ${sources(row)}
    </div>`).join("")}</section>` : "";
  const versionLabels: Record<ImportedSourceVersion["status"], string> = { unknown: "Unknown", draft: "Draft", revised: "Revised", adopted: "Adopted" };
  const versionById = new Map((minutes.importedSourceVersions ?? []).map((row) => [row.versionId, row]));
  const versions = minutes.importedSourceVersions?.length ? `
    <section class="minutes-history"><h2>Imported source versions</h2>
    <p>Imported source document versions / external adoption assertions are distinct from the app’s approved minutes revision. An unknown status does not establish adoption.</p>
    ${minutes.importedSourceVersions.map((row) => `<div class="source-version">
      <h3>${eh(row.label)}</h3>
      <p><strong>Source status:</strong> ${eh(versionLabels[row.status] ?? "Unknown")} · <strong>Source date:</strong> ${unknown(row.sourceDate)}</p>
      ${paragraph("Version reference", row.versionId)}
      ${row.supersedesVersionId ? paragraph("Supersedes", versionById.get(row.supersedesVersionId)?.label ?? row.supersedesVersionId) : ""}
      ${row.status === "adopted" ? `<p><strong>Adopted:</strong> ${unknown(row.adoptedAt)}</p>` : ""}
      ${paragraph("Adoption evidence", row.adoptionEvidence)}
      ${paragraph("Adopting meeting reference", row.adoptedInMeetingId)}
      ${paragraph("Adoption motion reference", row.adoptionMotionId)}
      ${sources(row)}
    </div>`).join("")}</section>` : "";
  return actions + versions;
}
