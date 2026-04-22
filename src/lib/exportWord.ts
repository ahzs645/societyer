const DOCUMENT_CSS = `
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 6pt; line-height: 1.35; }
  ul, ol { margin: 0 0 8pt 24pt; padding: 0; }
  li { margin: 0 0 2pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; }
  th, td { border: 1px solid #bbb; padding: 4pt 6pt; font-size: 10.5pt; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; }
  .motion { border-left: 3pt solid #3b5bdb; padding: 4pt 8pt; background: #f6f8ff; margin: 0 0 8pt; }
  .motion .outcome-carried { color: #0a8f4e; font-weight: 600; }
  .motion .outcome-defeated { color: #c9264a; font-weight: 600; }
  .motion .outcome-tabled { color: #a86400; font-weight: 600; }
  .meta { color: #666; font-size: 10pt; }
  .muted { color: #888; }
  @page { margin: 0.65in; }
`;

/**
 * Export a DOM-friendly HTML fragment as a .doc file that Word / Pages / Google Docs
 * open natively. We wrap the body in Word-compatible boilerplate and serve it as
 * `application/msword` with a `.doc` extension. No external library.
 */
export function exportWordDoc({
  filename,
  title,
  bodyHtml,
}: {
  filename: string;
  title: string;
  bodyHtml: string;
}) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <!--[if gte mso 9]>
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <![endif]-->
      <style>${DOCUMENT_CSS}</style>
    </head>
    <body>${bodyHtml}</body>
  </html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openPrintableDocument({
  title,
  bodyHtml,
}: {
  title: string;
  bodyHtml: string;
}) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(`
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>${DOCUMENT_CSS}</style>
      </head>
      <body>${bodyHtml}</body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
  return true;
}

export function escapeHtml(s: string | undefined | null): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function markdownToHtml(markdown: string | undefined | null): string {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderMarkdownInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const openList = (type: "ul" | "ol") => {
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length, 4);
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push("<hr />");
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      openList("ul");
      html.push(`<li>${renderMarkdownInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      openList("ol");
      html.push(`<li>${renderMarkdownInline(ordered[1])}</li>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return html.join("\n");
}

export function exportMarkdownWordDoc({
  filename,
  title,
  markdown,
}: {
  filename: string;
  title: string;
  markdown: string;
}) {
  exportWordDoc({
    filename,
    title,
    bodyHtml: markdownToHtml(markdown),
  });
}

function renderMarkdownInline(value: string) {
  const tokens: string[] = [];
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@CODE${tokens.length}@@`;
    tokens.push(`<code>${code}</code>`);
    return token;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, href) => {
      const safeHref = escapeHtml(href);
      return `<a href="${safeHref}">${label}</a>`;
    });

  tokens.forEach((token, index) => {
    html = html.replace(`@@CODE${index}@@`, token);
  });
  return html;
}

export const MINUTES_EXPORT_STYLES = [
  {
    id: "standard",
    label: "Standard",
    source: "Societyer default",
    tone: "Balanced sections for attendance, discussion, motions, decisions, actions, and approval.",
  },
  {
    id: "formal-agm",
    label: "Formal AGM",
    source: "Annual General Meeting Minutes template",
    tone: "Narrative member-meeting minutes with formal resolved clauses and signature lines.",
  },
  {
    id: "executive-agenda",
    label: "Executive Agenda",
    source: "AABC executive minutes",
    tone: "Numbered agenda minutes with bullets, action items, reports, next meeting, and adjournment.",
  },
  {
    id: "action-table",
    label: "Action Table",
    source: "PGAIR AGM & board minutes",
    tone: "Agenda-item table with group actions, motions, carried notes, and appendix-style rosters.",
  },
  {
    id: "board-public",
    label: "Board Public",
    source: "Public board meeting minutes",
    tone: "Numbered public-session format with Motion / First-Second / In Favour / Carried blocks.",
  },
] as const;

export type MinutesExportStyleId = typeof MINUTES_EXPORT_STYLES[number]["id"];

export type MinutesExportOptions = {
  includeTranscript?: boolean;
  includeActionItems?: boolean;
  includeApprovalBlock?: boolean;
  includeSignatures?: boolean;
  includePlaceholders?: boolean;
  includeGeneratedFooter?: boolean;
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
  society: { name: string; incorporationNumber?: string | null };
  meeting: {
    title: string;
    type: string;
    scheduledAt: string;
    location?: string | null;
    electronic?: boolean;
    noticeSentAt?: string | null;
    agendaItems?: string[];
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
  includeApprovalBlock: true,
  includeSignatures: true,
  includePlaceholders: false,
  includeGeneratedFooter: true,
};

/** Build the body HTML for a meeting-minutes export. */
export function renderMinutesHtml(args: MinutesRenderArgs): string {
  const styleId = normalizeMinutesStyleId(args.styleId);
  const options = { ...DEFAULT_MINUTES_EXPORT_OPTIONS, ...(args.options ?? {}) };

  if (styleId === "formal-agm") return renderFormalAgmMinutes(args, options);
  if (styleId === "executive-agenda") return renderExecutiveAgendaMinutes(args, options);
  if (styleId === "action-table") return renderActionTableMinutes(args, options);
  if (styleId === "board-public") return renderBoardPublicMinutes(args, options);
  return renderStandardMinutes(args, options);
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
  const motionHasVoteLanguage = minutes.motions.some(
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
    gap("Motions and outcomes", minutes.motions.length > 0, "Motions can be rendered as resolutions or vote blocks.", "No structured motions are recorded."),
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

  const motionRow = (m: typeof minutes.motions[number]) => `
    <div class="motion">
      <p><strong>Motion.</strong> ${eh(m.text)}</p>
      <p class="meta">
        ${m.movedBy ? `Moved by <strong>${eh(m.movedBy)}</strong>` : ""}
        ${m.secondedBy ? ` · Seconded by <strong>${eh(m.secondedBy)}</strong>` : ""}
      </p>
      <p><span class="outcome-${eh(m.outcome.toLowerCase())}">${eh(m.outcome.toUpperCase())}</span>${
        m.votesFor != null
          ? ` · For ${m.votesFor} · Against ${m.votesAgainst ?? 0} · Abstain ${m.abstentions ?? 0}`
          : ""
      }</p>
    </div>
  `;

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
    <p><strong>Quorum:</strong> ${minutes.quorumMet ? "Met" : "Not met"}${
      minutes.quorumRequired != null ? ` · ${minutes.attendees.length} present / ${minutes.quorumRequired} required` : ""
    }${minutes.quorumSourceLabel ? ` · Rule: ${eh(minutes.quorumSourceLabel)}` : ""}</p>

    ${renderMinuteSections(minutes.sections, options)}
    ${renderOptionalSection("Discussion", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options)}

    ${renderOptionalSection("Motions", minutes.motions.map(motionRow).join(""), minutes.motions.length > 0, options)}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(minutes.actionItems, options), minutes.actionItems.length > 0, options) : ""}
    ${renderAppendices(minutes.appendices, options)}
    ${renderNextMeeting(minutes, options)}

    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}

    ${options.includeSignatures ? renderSignatureBlock() : ""}

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

    ${renderAgendaAdoption(meeting.agendaItems ?? [], options)}

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
    ${options.includeSignatures ? renderSignatureBlock("Chair", "Secretary") : ""}
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

    ${renderOptionalSection("Discussion Summary", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options)}

    ${renderOptionalSection("Decisions", renderDecisionsList(minutes.decisions, options), minutes.decisions.length > 0, options)}

    ${renderNextMeeting(minutes, options)}
    ${renderAppendices(minutes.appendices, options)}

    ${adjournedAt || options.includePlaceholders ? `<p><strong>The meeting adjourned at ${eh(adjournedAt ?? placeholder("adjournment time", options))}.</strong></p>` : ""}
    ${options.includeApprovalBlock ? renderApprovalBlock(minutes, options) : ""}
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

    ${renderOptionalSection("Discussion Summary", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options)}

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

    ${renderOptionalSection("Discussion", renderDiscussion(minutes.discussion, options), hasText(minutes.discussion), options)}

    ${renderOptionalSection("Motions", minutes.motions.map(renderBoardMotion).join(""), minutes.motions.length > 0, options)}

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
  const matchingMotions = minutes.motions.filter((motion) => motionMatchesSection(motion.text, section));
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

function renderAgendaAdoption(agendaItems: string[], options: Required<MinutesExportOptions>) {
  if (!agendaItems.length) return placeholderParagraph("Agenda adoption", options);
  return `
    <h2>2. Approval of Agenda</h2>
    <p>The agenda was presented to the meeting.</p>
    <ol>${agendaItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
  `;
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
        section.discussion ? `<p>${escapeHtml(section.discussion).replace(/\n/g, "<br/>")}</p>` : "",
        section.decisions?.length ? renderOptionalSection("Decisions", renderDecisionsList(section.decisions, options), true, options, "h3") : "",
        section.actionItems?.length && options.includeActionItems ? renderOptionalSection("Action Items", renderActionItemsTable(section.actionItems, options), true, options, "h3") : "",
      ].filter(Boolean).join("");
      return renderOptionalSection(section.title, bits, hasText(bits), options);
    })
    .join("");
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

function renderSignatureBlock(leftLabel = "Chair", rightLabel = "Secretary") {
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

function staticGap(label: string, status: MinutesDataGap["status"], detail: string): MinutesDataGap {
  return { label, status, detail };
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
