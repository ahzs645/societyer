// Meeting-minutes domain renderer. Takes structured minutes data + a chosen
// style (Standard / Formal AGM / Executive Agenda / Numbered Agenda / Action
// Table / Board Public) and produces an HTML body string that the generic
// docx/pdf exporters in lib/ can package up. This file knows nothing about
// docx or PDF — it only emits HTML.

import { escapeHtml } from "../../../lib/html";
import { renderMarkdownInline } from "../../../lib/markdown";
import { MINUTES_EXPORT_STYLES, type MinutesExportStyleId } from "./minutesExportStyles";

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

export type MinutesExportOptions = {
  includeTranscript?: boolean;
  includeActionItems?: boolean;
  includeDiscussionSummary?: boolean;
  includeApprovalBlock?: boolean;
  includeSignatures?: boolean;
  includePlaceholders?: boolean;
  includeGeneratedFooter?: boolean;
  /** Captured e-signatures. When present, the signature block lists the actual
   *  signers + dates instead of blank Chair/Secretary signature lines. */
  signatures?: MinutesSignatureLine[];
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

type MinutesRenderArgs = {
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
    quorumRequired?: number;
    quorumSourceLabel?: string;
    discussion: string;
    sections?: {
      title: string;
      type?: string;
      presenter?: string;
      discussion?: string;
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
    draftTranscript?: string | null;
  };
  styleId?: MinutesExportStyleId;
  options?: MinutesExportOptions;
};

const DEFAULT_MINUTES_EXPORT_OPTIONS: Required<MinutesExportOptions> = {
  includeTranscript: true,
  includeActionItems: true,
  includeDiscussionSummary: false,
  includeApprovalBlock: true,
  includeSignatures: true,
  includePlaceholders: false,
  includeGeneratedFooter: true,
  signatures: [],
};

/** Build the body HTML for a meeting-minutes export. */
export function renderMinutesHtml(args: MinutesRenderArgs): string {
  const styleId = normalizeMinutesStyleId(args.styleId);
  const options = { ...DEFAULT_MINUTES_EXPORT_OPTIONS, ...(args.options ?? {}) };

  let body: string;
  if (styleId === "formal-agm") body = renderFormalAgmMinutes(args, options);
  else if (styleId === "executive-agenda") body = renderExecutiveAgendaMinutes(args, options);
  else if (styleId === "numbered-agenda") body = renderNumberedAgendaMinutes(args, options);
  else if (styleId === "action-table") body = renderActionTableMinutes(args, options);
  else if (styleId === "board-public") body = renderBoardPublicMinutes(args, options);
  else body = renderStandardMinutes(args, options);

  return renderDocumentHeader(args.society) + body;
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
    gap("Attendance list", minutes.attendees.length > 0, "Present attendees are structured.", "No present attendees are recorded."),
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
  const held = new Date(minutes.heldAt).toLocaleString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
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
    <p>Quorum: ${minutes.quorumMet ? "Met" : "Not met"}${
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

    ${options.includeSignatures ? renderSignatureBlock(options.signatures) : ""}

    ${options.includeTranscript && minutes.draftTranscript ? `
      <h2>Transcript</h2>
      <p class="muted">Raw transcript retained with these minutes.</p>
      <p style="font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; white-space: pre-wrap;">${eh(minutes.draftTranscript)}</p>
    ` : ""}

    ${renderFooter(options)}
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
  const callTime = displayDateOrText(minutes.calledToOrderAt) ?? formatTime(minutes.heldAt);
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
    <p>The ${eh(meetingKind)} of the Members of the Society was convened at ${eh(callTime)} by ${eh(chair)}, who acted as Chair of the meeting. ${meeting.noticeSentAt ? `Notice of meeting was sent on ${eh(formatLongDate(meeting.noticeSentAt))}.` : placeholderSentence("Notice date", options)} ${minutes.quorumMet ? "Quorum was declared present and the meeting was properly called and constituted." : "Quorum was not recorded as present."} ${eh(secretary)} acted as Secretary of the Meeting.</p>

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
    ${options.includeSignatures ? renderSignatureBlock(options.signatures, "Chair", "Secretary") : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}
    ${renderFooter(options)}
  `;
}

function renderExecutiveAgendaMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const agenda = meeting.agendaItems ?? [];
  const sections = (minutes.sections ?? []).length
    ? (minutes.sections ?? []).map((section) => section.title)
    : agenda;
  const callTime = displayDateOrText(minutes.calledToOrderAt) ?? formatTime(minutes.heldAt);
  const adjournedAt = displayDateOrText(minutes.adjournedAt);

  return `
    <h1>Minutes</h1>
    <p><strong>${eh(meeting.title)}</strong></p>
    <p class="meta">${eh(formatLongDateTime(minutes.heldAt))}${meeting.location ? ` · ${eh(meeting.location)}` : ""}${meeting.electronic ? " · Electronic / hybrid meeting" : ""}</p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>
    ${renderRemoteParticipation(minutes.remoteParticipation)}

    ${renderAttendanceSummary(minutes, options)}
    <p><strong>Meeting called to order:</strong> ${eh(callTime)}</p>

    ${sections.map((section, index) => renderExecutiveSection(index + 1, section, minutes, sections.length === 0 && index > 0)).join("")}
    ${renderMinuteSections((minutes.sections ?? []).filter((section) => !sections.includes(section.title)), options)}

    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion Summary", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${renderNextMeeting(minutes, options)}
    ${renderAppendices(minutes.appendices, options)}

    ${adjournedAt || options.includePlaceholders ? `<p><strong>The meeting adjourned at ${eh(adjournedAt ?? placeholder("adjournment time", options))}.</strong></p>` : ""}
    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}
    ${renderFooter(options)}
  `;
}

function renderNumberedAgendaMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const agendaItems = meeting.agendaItems ?? [];
  const recordedSections = (minutes.sections ?? []).filter((section) => hasAny(section.title, section.presenter, section.discussion, section.reportSubmitted, section.decisions?.length, section.actionItems?.length));
  const businessSections = recordedSections.length
    ? recordedSections
    : agendaItems.map((title) => ({ title }));
  const sections = businessSections.length
    ? businessSections
    : [{ title: "Call to order" }, { title: "Business arising" }, { title: "Other business" }];
  const date = formatLongDate(minutes.heldAt || meeting.scheduledAt);
  const startTime = minutes.calledToOrderAt ? formatTime(minutes.calledToOrderAt) : formatTime(minutes.heldAt || meeting.scheduledAt);
  const endTime = minutes.adjournedAt ? formatTime(minutes.adjournedAt) : "";
  const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
  const location = meeting.location || minutes.nextMeetingLocation || placeholder("location", options);
  const presentLine = minutes.attendees.length ? minutes.attendees.join(", ") : placeholder("attendees", options);
  const absentLine = minutes.absent.length ? minutes.absent.join(", ") : "";
  const adjournmentMotion = minutes.motions.find((motion) => /adjourn/i.test(motion.text));
  const topicMotions = minutes.motions.filter((motion) => motion !== adjournmentMotion);
  const sectionTitles = new Set(sections.map((section) => section.title));
  const extraSections = recordedSections.filter((section) => !sectionTitles.has(section.title));
  const unplacedTopicMotions = topicMotions.filter((motion) =>
    !sections.some((section: any, sectionIndex: number) =>
      motionBelongsToAgendaSection(
        motion,
        sectionIndex,
        section.title,
        agendaSectionSearchText(section),
      ),
    ),
  );

  return `
    <h1>${eh(minutesTitleForSampleStyle(society.name, meeting))}</h1>
    <p><strong>Date:</strong> ${eh(date)} &nbsp;&nbsp; <strong>Time:</strong> ${eh(timeRange)} &nbsp;&nbsp; <strong>Location:</strong> ${eh(location)}</p>

    <h2>Attendees:</h2>
    <p><strong>Present:</strong> ${eh(presentLine)}</p>
    ${absentLine ? `<p><strong>Absent / Regrets:</strong> ${eh(absentLine)}</p>` : ""}
    <p>Quorum: ${minutes.quorumMet ? "Met" : "Not recorded as met"}${minutes.quorumRequired != null ? ` (${minutes.attendees.length} present / ${minutes.quorumRequired} required)` : ""}${minutes.quorumSourceLabel ? `; ${eh(minutes.quorumSourceLabel)}` : ""}</p>
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
      return sections.map((section: any, index: number) => {
        const depth: 0 | 1 = section?.depth === 1 ? 1 : 0;
        let label: string;
        if (depth === 0 || rootCount === 0) {
          rootCount += 1;
          childCount = 0;
          label = `${rootCount}.`;
        } else {
          childCount += 1;
          label = `${rootCount}${String.fromCharCode(96 + childCount)}.`;
        }
        return renderNumberedAgendaSection(label, index, section, minutes, topicMotions, options, depth);
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
    ${options.includeSignatures ? renderSignatureBlock(options.signatures) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}
    ${renderFooter(options)}
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
    ${renderFooter(options)}
  `;
}

function renderBoardPublicMinutes({
  society,
  meeting,
  minutes,
}: MinutesRenderArgs, options: Required<MinutesExportOptions>): string {
  const eh = escapeHtml;
  const agenda = (minutes.sections ?? []).length ? (minutes.sections ?? []).map((section) => section.title) : meeting.agendaItems ?? [];
  const sections = agenda.length ? agenda : ["Call to order", "Approval of the Agenda", "Minutes", "Reports", "Other Business", "Adjournment"];
  const callTime = displayDateOrText(minutes.calledToOrderAt) ?? formatTime(minutes.heldAt);
  return `
    <h1>${eh(meeting.title)}</h1>
    <p><strong>Public Session Minutes</strong></p>
    <p class="meta">${eh(formatLongDate(minutes.heldAt))} · ${eh(formatTime(minutes.heldAt))}${meeting.location ? ` · ${eh(meeting.location)}` : ""}</p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>
    ${renderSessionSegments(minutes.sessionSegments)}

    ${sections.map((section, index) => `
      <h2>${index + 1} – ${eh(section)}</h2>
      ${index === 0 ? `<p>${eh(minutes.chairName ?? placeholder("presiding officer", options))} called the meeting to order at ${eh(callTime)}.</p>` : ""}
      ${index === 2 ? renderPreviousMinutesMotions(minutes) : ""}
    `).join("")}

    ${options.includeDiscussionSummary ? renderOptionalSection("Discussion", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options) : ""}

    ${renderOptionalSection("Motions", minutes.motions.filter((motion) => !isAdjournmentMotionForExport(motion)).map(renderBoardMotion).join(""), minutes.motions.some((motion) => !isAdjournmentMotionForExport(motion)), options)}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(minutes.actionItems, options), minutes.actionItems.length > 0, options) : ""}
    ${renderAppendices(minutes.appendices, options)}

    <h2>Participants</h2>
    ${renderAttendance(minutes)}

    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
    ${options.includeTranscript && minutes.draftTranscript ? renderTranscript(minutes.draftTranscript) : ""}
    ${renderFooter(options)}
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

function renderExecutiveSection(
  index: number,
  section: string,
  minutes: MinutesRenderArgs["minutes"],
  useGenericContent: boolean,
) {
  const eh = escapeHtml;
  const matchingMotions = minutes.motions.filter((motion) => !isAdjournmentMotionForExport(motion) && motionMatchesSection(motion.text, section));
  const matchingActions = minutes.actionItems.filter((item) => motionMatchesSection(item.text, section));
  const bullets = [
    ...(useGenericContent && index === 4 && minutes.discussion ? [minutes.discussion] : []),
    ...matchingMotions.map((motion) => `Motion to ${stripMotionLeadIn(motion.text)}${motion.movedBy ? ` by ${motion.movedBy}` : ""}${motion.secondedBy ? `; seconded by ${motion.secondedBy}` : ""}. ${motion.outcome}.`),
    ...matchingActions.map((item) => `Action Item: ${item.assignee ? `${item.assignee} to ` : ""}${item.text}${item.dueDate ? ` by ${item.dueDate}` : ""}.`),
  ];
  return `
    <h2>${index}. ${eh(section)}</h2>
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
  return `<p>${officers.map(escapeHtml).join(" &nbsp;&nbsp; ")}</p>`;
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
      `Meeting started at ${eh(formatTime(minutes.heldAt))}`,
      minutes.quorumMet ? "Quorum achieved" : "Quorum not recorded as achieved",
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
  if (index === 4) return `Meeting adjourned at ${eh(placeholder("adjournment time", options))}`;
  return placeholderParagraph("group action", options);
}

function renderPreviousMinutesMotions(minutes: MinutesRenderArgs["minutes"]) {
  const motions = minutes.motions.filter((motion) => /minute/i.test(motion.text));
  if (!motions.length) return "";
  return motions.map(renderBoardMotion).join("");
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
    `<table>
      <tr><th>Title</th><th>Type</th><th>Reference</th><th>Notes</th></tr>
      ${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.title)}</td>
          <td>${escapeHtml(row.type ? humanizeLabel(row.type) : "—")}</td>
          <td>${escapeHtml(row.reference ?? "—")}</td>
          <td>${escapeHtml(row.notes ?? "—")}</td>
        </tr>
      `).join("")}
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
    ? `<p class="meta" style="margin-top: 18pt;">Generated by Societyer · ${new Date().toISOString().slice(0, 10)}</p>`
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

function formatLongDateTime(value: string) {
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
  return new Date(value).toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
}
