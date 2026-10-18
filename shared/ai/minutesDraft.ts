/**
 * AI MINUTES DRAFTING, provider-neutral.
 *
 * The one place that knows how a transcript becomes a structured minutes
 * draft: the prompt, the rule-based fallback, and how a model's reply is
 * parsed and normalised. Hosted Convex (convex/providers/llm.ts) and the
 * on-device client (src/features/meetings/useLocalMinutesDraft.ts) both call
 * this module, so the same transcript produces the same prompt and the same
 * normalised draft wherever the model runs.
 *
 * No network I/O and no Convex imports here: callers own the transport.
 * Model output is untrusted, so it is read as `unknown` and every field is
 * checked before it reaches a minutes row.
 */

export type MinuteDraftActionItem = {
  text: string;
  assignee?: string;
  dueDate?: string;
  done: boolean;
};

export type MinuteDraftMotion = {
  text: string;
  movedBy?: string;
  secondedBy?: string;
  outcome: string;
  votesFor?: number;
  votesAgainst?: number;
  abstentions?: number;
};

export type MinuteDraftAttendance = {
  name: string;
  status: string;
  roleTitle?: string;
  affiliation?: string;
  memberIdentifier?: string;
  proxyFor?: string;
  quorumCounted?: boolean;
  notes?: string;
};

export type MinuteDraftSection = {
  title: string;
  type?: string;
  presenter?: string;
  discussion?: string;
  reportSubmitted?: boolean;
  decisions?: string[];
  actionItems?: MinuteDraftActionItem[];
};

export type MinuteDraftRemoteParticipation = {
  url?: string;
  meetingId?: string;
  passcode?: string;
  instructions?: string;
};

export type MinuteDraftSessionSegment = {
  type: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  notes?: string;
};

export type MinuteDraftAppendix = {
  title: string;
  type?: string;
  reference?: string;
  notes?: string;
};

export type MinuteDraftDirectorAppointment = {
  name: string;
  roleTitle?: string;
  affiliation?: string;
  term?: string;
  consentRecorded?: boolean;
  votesReceived?: number;
  elected?: boolean;
  status?: string;
  notes?: string;
};

export type MinuteDraftAgmDetails = {
  financialStatementsPresented?: boolean;
  financialStatementsNotes?: string;
  directorElectionNotes?: string;
  directorAppointments?: MinuteDraftDirectorAppointment[];
  specialResolutionExhibits?: Array<{ title: string; reference?: string; notes?: string }>;
};

export type MinuteDraft = {
  chairName?: string;
  secretaryName?: string;
  recorderName?: string;
  calledToOrderAt?: string;
  adjournedAt?: string;
  remoteParticipation?: MinuteDraftRemoteParticipation;
  detailedAttendance?: MinuteDraftAttendance[];
  discussion: string;
  sections?: MinuteDraftSection[];
  motions: MinuteDraftMotion[];
  decisions: string[];
  actionItems: MinuteDraftActionItem[];
  attendees: string[];
  absent: string[];
  nextMeetingAt?: string;
  nextMeetingLocation?: string;
  nextMeetingNotes?: string;
  sessionSegments?: MinuteDraftSessionSegment[];
  appendices?: MinuteDraftAppendix[];
  agmDetails?: MinuteDraftAgmDetails;
};

export type MinutesDraftInput = {
  transcript: string;
  meetingTitle: string;
  meetingType: string;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const MINUTES_DRAFT_SYSTEM_PROMPT =
  "You turn meeting transcripts into strict JSON for nonprofit minutes. Return only valid JSON. Include keys discussion, motions, decisions, actionItems, attendees, absent, plus optional chairName, secretaryName, recorderName, calledToOrderAt, adjournedAt, remoteParticipation, detailedAttendance, sections, nextMeetingAt, nextMeetingLocation, nextMeetingNotes, sessionSegments, appendices, and agmDetails when clearly supported by the transcript. Use detailedAttendance.memberIdentifier for student/member numbers. Use agmDetails.directorAppointments votesReceived/elected when election results are stated. Keep motions factual and concise. Omit unknown optional fields.";

/** The user turn: meeting identity, then the transcript verbatim. */
export function minutesDraftUserPrompt(input: MinutesDraftInput): string {
  return `Meeting title: ${input.meetingTitle}\nMeeting type: ${input.meetingType}\n\nTranscript:\n${input.transcript}`;
}

/** Chat messages for one minutes draft request (OpenAI-compatible shape). */
export function buildMinutesDraftMessages(input: MinutesDraftInput): ChatMessage[] {
  return [
    { role: "system", content: MINUTES_DRAFT_SYSTEM_PROMPT },
    { role: "user", content: minutesDraftUserPrompt(input) },
  ];
}

/**
 * A loose JSON schema for `response_format: json_schema`. Non-strict: optional
 * fields stay optional, and servers that only check the top level still work.
 */
export const MINUTES_DRAFT_JSON_SCHEMA = {
  name: "meeting_minutes_draft",
  strict: false,
  schema: {
    type: "object",
    properties: {
      discussion: { type: "string" },
      motions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            movedBy: { type: "string" },
            secondedBy: { type: "string" },
            outcome: { type: "string" },
            votesFor: { type: "number" },
            votesAgainst: { type: "number" },
            abstentions: { type: "number" },
          },
          required: ["text", "outcome"],
        },
      },
      decisions: { type: "array", items: { type: "string" } },
      actionItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            assignee: { type: "string" },
            dueDate: { type: "string" },
            done: { type: "boolean" },
          },
          required: ["text"],
        },
      },
      attendees: { type: "array", items: { type: "string" } },
      absent: { type: "array", items: { type: "string" } },
      chairName: { type: "string" },
      secretaryName: { type: "string" },
      calledToOrderAt: { type: "string" },
      adjournedAt: { type: "string" },
      nextMeetingAt: { type: "string" },
      sections: { type: "array", items: { type: "object" } },
    },
    required: ["discussion", "motions", "decisions", "actionItems", "attendees", "absent"],
  },
} as const;

/** Removes a Markdown code fence a model may wrap around its JSON. */
export function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Parses a model reply into a draft. Accepts bare JSON, fenced JSON, or JSON
 * surrounded by prose (the outermost `{...}`). Anything unreadable yields the
 * fallback, and readable JSON is normalised field by field over the fallback.
 */
export function parseMinutesDraft(text: string, fallback: MinuteDraft): MinuteDraft {
  return normalizeDraft(parseJsonObject(text), fallback);
}

/** Returns the reply's JSON object, or undefined when there is none. */
export function parseJsonObject(text: string): unknown {
  const stripped = stripCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;
}

function rows(value: unknown): Row[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(asRow).filter((row): row is Row => Boolean(row));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(optionalString).filter((entry): entry is string => Boolean(entry));
}

function normalizeActionItems(value: unknown): MinuteDraftActionItem[] | undefined {
  const list = rows(value);
  if (!list) return undefined;
  return list
    .filter((row) => optionalString(row.text))
    .map((row) => ({
      text: optionalString(row.text)!,
      assignee: optionalString(row.assignee),
      dueDate: optionalString(row.dueDate),
      done: row.done === true,
    }));
}

function normalizeMotions(value: unknown): MinuteDraftMotion[] | undefined {
  const list = rows(value);
  if (!list) return undefined;
  return list
    .filter((row) => optionalString(row.text))
    .map((row) => ({
      text: optionalString(row.text)!,
      movedBy: optionalString(row.movedBy),
      secondedBy: optionalString(row.secondedBy),
      outcome: optionalString(row.outcome) ?? "Recorded",
      votesFor: optionalCount(row.votesFor),
      votesAgainst: optionalCount(row.votesAgainst),
      abstentions: optionalCount(row.abstentions),
    }));
}

function normalizeRemoteParticipation(value: unknown): MinuteDraftRemoteParticipation | undefined {
  const row = asRow(value);
  if (!row) return undefined;
  const out = {
    url: optionalString(row.url),
    meetingId: optionalString(row.meetingId),
    passcode: optionalString(row.passcode),
    instructions: optionalString(row.instructions),
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

function normalizeDetailedAttendance(value: unknown): MinuteDraftAttendance[] | undefined {
  const list = rows(value)
    ?.filter((row) => optionalString(row.name))
    .map((row) => ({
      name: optionalString(row.name)!,
      status: optionalString(row.status) ?? "present",
      roleTitle: optionalString(row.roleTitle),
      affiliation: optionalString(row.affiliation),
      memberIdentifier: optionalString(row.memberIdentifier),
      proxyFor: optionalString(row.proxyFor),
      quorumCounted: optionalBoolean(row.quorumCounted),
      notes: optionalString(row.notes),
    }));
  return list?.length ? list : undefined;
}

function normalizeSections(value: unknown): MinuteDraftSection[] | undefined {
  const list = rows(value)
    ?.filter((row) => optionalString(row.title))
    .map((row) => ({
      title: optionalString(row.title)!,
      type: optionalString(row.type),
      presenter: optionalString(row.presenter),
      discussion: optionalString(row.discussion),
      reportSubmitted: optionalBoolean(row.reportSubmitted),
      decisions: stringList(row.decisions),
      actionItems: normalizeActionItems(row.actionItems),
    }));
  return list?.length ? list : undefined;
}

function normalizeSessionSegments(value: unknown): MinuteDraftSessionSegment[] | undefined {
  const list = rows(value)
    ?.filter((row) => optionalString(row.type))
    .map((row) => ({
      type: optionalString(row.type)!,
      title: optionalString(row.title),
      startedAt: optionalString(row.startedAt),
      endedAt: optionalString(row.endedAt),
      notes: optionalString(row.notes),
    }));
  return list?.length ? list : undefined;
}

function normalizeAppendices(value: unknown): MinuteDraftAppendix[] | undefined {
  const list = rows(value)
    ?.filter((row) => optionalString(row.title))
    .map((row) => ({
      title: optionalString(row.title)!,
      type: optionalString(row.type),
      reference: optionalString(row.reference),
      notes: optionalString(row.notes),
    }));
  return list?.length ? list : undefined;
}

function normalizeAgmDetails(value: unknown): MinuteDraftAgmDetails | undefined {
  const row = asRow(value);
  if (!row) return undefined;
  const directorAppointments = rows(row.directorAppointments)
    ?.filter((entry) => optionalString(entry.name))
    .map((entry) => ({
      name: optionalString(entry.name)!,
      roleTitle: optionalString(entry.roleTitle),
      affiliation: optionalString(entry.affiliation),
      term: optionalString(entry.term),
      consentRecorded: optionalBoolean(entry.consentRecorded),
      votesReceived: typeof entry.votesReceived === "number" ? entry.votesReceived : undefined,
      elected: optionalBoolean(entry.elected),
      status: optionalString(entry.status),
      notes: optionalString(entry.notes),
    }));
  const specialResolutionExhibits = rows(row.specialResolutionExhibits)
    ?.filter((entry) => optionalString(entry.title))
    .map((entry) => ({
      title: optionalString(entry.title)!,
      reference: optionalString(entry.reference),
      notes: optionalString(entry.notes),
    }));
  const out = {
    financialStatementsPresented: optionalBoolean(row.financialStatementsPresented),
    financialStatementsNotes: optionalString(row.financialStatementsNotes),
    directorElectionNotes: optionalString(row.directorElectionNotes),
    directorAppointments: directorAppointments?.length ? directorAppointments : undefined,
    specialResolutionExhibits: specialResolutionExhibits?.length ? specialResolutionExhibits : undefined,
  };
  return Object.values(out).some((entry) => entry !== undefined) ? out : undefined;
}

/** Normalises an untrusted model reply over the rule-based fallback. */
export function normalizeDraft(raw: unknown, fallback: MinuteDraft): MinuteDraft {
  const draft = asRow(raw);
  if (!draft) return fallback;
  return {
    chairName: optionalString(draft.chairName) ?? fallback.chairName,
    secretaryName: optionalString(draft.secretaryName) ?? fallback.secretaryName,
    recorderName: optionalString(draft.recorderName) ?? fallback.recorderName,
    calledToOrderAt: optionalString(draft.calledToOrderAt) ?? fallback.calledToOrderAt,
    adjournedAt: optionalString(draft.adjournedAt) ?? fallback.adjournedAt,
    remoteParticipation: normalizeRemoteParticipation(draft.remoteParticipation) ?? fallback.remoteParticipation,
    detailedAttendance: normalizeDetailedAttendance(draft.detailedAttendance) ?? fallback.detailedAttendance,
    discussion: optionalString(draft.discussion) ?? fallback.discussion,
    sections: normalizeSections(draft.sections) ?? fallback.sections,
    motions: normalizeMotions(draft.motions) ?? fallback.motions,
    decisions: stringList(draft.decisions) ?? fallback.decisions,
    actionItems: normalizeActionItems(draft.actionItems) ?? fallback.actionItems,
    attendees: stringList(draft.attendees) ?? fallback.attendees,
    absent: stringList(draft.absent) ?? fallback.absent,
    nextMeetingAt: optionalString(draft.nextMeetingAt) ?? fallback.nextMeetingAt,
    nextMeetingLocation: optionalString(draft.nextMeetingLocation) ?? fallback.nextMeetingLocation,
    nextMeetingNotes: optionalString(draft.nextMeetingNotes) ?? fallback.nextMeetingNotes,
    sessionSegments: normalizeSessionSegments(draft.sessionSegments) ?? fallback.sessionSegments,
    appendices: normalizeAppendices(draft.appendices) ?? fallback.appendices,
    agmDetails: normalizeAgmDetails(draft.agmDetails) ?? fallback.agmDetails,
  };
}

// ---------------------------------------------------------------------------
// Rule-based fallback: used when no model is configured or a reply is unusable.
// ---------------------------------------------------------------------------

function extractAttendees(transcript: string): { attendees: string[]; absent: string[] } {
  const speakers = new Set<string>();
  for (const line of transcript.split("\n")) {
    const match = line.match(/^([A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)+):/);
    if (match) speakers.add(match[1]);
  }
  const absentMatch = transcript.match(/([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) (?:is )?absent/i);
  return { attendees: Array.from(speakers), absent: absentMatch ? [absentMatch[1]] : [] };
}

function findLine(transcript: string, keyword: RegExp): string {
  return transcript.split("\n").find((line) => keyword.test(line)) ?? "";
}

function extractTime(value: string) {
  return value.match(/\b(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?)\b/i)?.[1]?.replace(/\s+/g, " ");
}

function extractOfficerName(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return optionalString(match?.[2] ?? match?.[3]);
}

function extractNextMeeting(text: string) {
  return optionalString(text.match(/\bnext meeting(?:\s+(?:is|set for|scheduled for))?\s+([^.\n]+)/i)?.[1]);
}

function extractRemoteParticipation(text: string): MinuteDraftRemoteParticipation | undefined {
  const url = optionalString(text.match(/https?:\/\/\S+/i)?.[0]);
  const meetingId = optionalString(text.match(/\bmeeting id[:\s]+([A-Z0-9 -]{5,})/i)?.[1]);
  if (!url && !meetingId) return undefined;
  return { url, meetingId };
}

function inferredSections(lines: string[]): MinuteDraftSection[] | undefined {
  const headings = lines
    .filter((line) => /^(?:\d+[\). -]+)?[A-Z][A-Za-z &/,'’-]{3,60}$/.test(line) && !/^(motion|action item|minutes)$/i.test(line))
    .slice(0, 12)
    .map((title) => ({ title, type: /report/i.test(title) ? "report" : "discussion" }));
  return headings.length ? headings : undefined;
}

/** A draft built from transcript patterns alone ("I move", "action item:", …). */
export function heuristicMinutesDraft(args: MinutesDraftInput): MinuteDraft {
  const { attendees, absent } = extractAttendees(args.transcript);
  const lines = args.transcript.split("\n").map((line) => line.trim()).filter(Boolean);
  const motions: MinuteDraftMotion[] = [];
  const decisions: string[] = [];
  const actionItems: MinuteDraftActionItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moveMatch = line.match(/^(.+?):\s*I move (?:that )?(.+?)[.\n]?$/i);
    if (moveMatch) {
      const movedBy = moveMatch[1];
      const text = moveMatch[2].replace(/[.?!]+$/, "");
      const secondLine = lines.slice(i + 1, i + 3).find((candidate) => /second/i.test(candidate));
      const secondedBy = secondLine?.match(/^(.+?):/)?.[1];
      const outcomeLine = lines.slice(i + 1, i + 5).find((candidate) => /(carried|defeated|tabled|motion carries)/i.test(candidate)) ?? "";
      let outcome = "Tabled";
      if (/defeat/i.test(outcomeLine)) outcome = "Defeated";
      else if (/carried|carries/i.test(outcomeLine)) outcome = "Carried";
      const votesFor = outcomeLine.match(/(\d+)\s*in\s*favour/i);
      const votesAgainst = outcomeLine.match(/(\d+)\s*(?:opposed|against)/i);
      const abstentions = outcomeLine.match(/(\d+)\s*(?:abstention|abstain)/i);
      motions.push({
        text: text.charAt(0).toUpperCase() + text.slice(1) + ".",
        movedBy,
        secondedBy,
        outcome,
        votesFor: votesFor ? Number(votesFor[1]) : undefined,
        votesAgainst: votesAgainst ? Number(votesAgainst[1]) : undefined,
        abstentions: abstentions ? Number(abstentions[1]) : undefined,
      });
    }
    if (/decision recorded:/i.test(line)) decisions.push(line.replace(/^.*decision recorded:\s*/i, "").trim());
    const actionMatch = line.match(/action item:\s*(.+)$/i);
    if (actionMatch) {
      for (const chunk of actionMatch[1].split(/\.(?:\s|$)/).map((part) => part.trim()).filter(Boolean)) {
        actionItems.push({
          text: chunk.charAt(0).toUpperCase() + chunk.slice(1),
          assignee: chunk.match(/^([A-Z][a-z]+)/)?.[1],
          dueDate: chunk.match(/by\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)/i)?.[1],
          done: false,
        });
      }
    }
  }
  if (decisions.length === 0) {
    for (const motion of motions) if (motion.outcome === "Carried") decisions.push(motion.text);
  }

  const openLine = findLine(args.transcript, /call the meeting to order|good evening/i);
  const closeLine = findLine(args.transcript, /adjourn/i);
  const topics = motions.map((motion) => motion.text.split(".")[0]).slice(0, 3).join("; ") || `${args.meetingType} business for ${args.meetingTitle}`;
  const discussion = [openLine, closeLine].filter(Boolean).concat([`Topics covered: ${topics}.`]).join("\n\n");
  return {
    chairName: extractOfficerName(openLine, /(called|convened).*?(?:by\s+)?([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)|([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)\s+(?:called|convened)/i),
    calledToOrderAt: extractTime(openLine),
    adjournedAt: extractTime(closeLine),
    remoteParticipation: extractRemoteParticipation(args.transcript),
    detailedAttendance: [
      ...attendees.map((name) => ({ name, status: "present", quorumCounted: true })),
      ...absent.map((name) => ({ name, status: "absent", quorumCounted: false })),
    ],
    discussion,
    sections: inferredSections(lines),
    motions,
    decisions,
    actionItems,
    attendees,
    absent,
    nextMeetingAt: extractNextMeeting(args.transcript),
  };
}
