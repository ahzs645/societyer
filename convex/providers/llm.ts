// LLM adapter — produces structured meeting minutes from a transcript.
import { providers } from "./env";

export type MinuteDraft = {
  chairName?: string;
  secretaryName?: string;
  recorderName?: string;
  calledToOrderAt?: string;
  adjournedAt?: string;
  remoteParticipation?: {
    url?: string;
    meetingId?: string;
    passcode?: string;
    instructions?: string;
  };
  detailedAttendance?: Array<{
    name: string;
    status: string;
    roleTitle?: string;
    affiliation?: string;
    memberIdentifier?: string;
    proxyFor?: string;
    quorumCounted?: boolean;
    notes?: string;
  }>;
  discussion: string;
  sections?: Array<{
    title: string;
    type?: string;
    presenter?: string;
    discussion?: string;
    reportSubmitted?: boolean;
    decisions?: string[];
    actionItems?: Array<{
      text: string;
      assignee?: string;
      dueDate?: string;
      done: boolean;
    }>;
  }>;
  motions: Array<{
    text: string;
    movedBy?: string;
    secondedBy?: string;
    outcome: string;
    votesFor?: number;
    votesAgainst?: number;
    abstentions?: number;
  }>;
  decisions: string[];
  actionItems: Array<{
    text: string;
    assignee?: string;
    dueDate?: string;
    done: boolean;
  }>;
  attendees: string[];
  absent: string[];
  nextMeetingAt?: string;
  nextMeetingLocation?: string;
  nextMeetingNotes?: string;
  sessionSegments?: Array<{
    type: string;
    title?: string;
    startedAt?: string;
    endedAt?: string;
    notes?: string;
  }>;
  appendices?: Array<{
    title: string;
    type?: string;
    reference?: string;
    notes?: string;
  }>;
  agmDetails?: {
    financialStatementsPresented?: boolean;
    financialStatementsNotes?: string;
    directorElectionNotes?: string;
    directorAppointments?: Array<{
      name: string;
      roleTitle?: string;
      affiliation?: string;
      term?: string;
      consentRecorded?: boolean;
      votesReceived?: number;
      elected?: boolean;
      status?: string;
      notes?: string;
    }>;
    specialResolutionExhibits?: Array<{
      title: string;
      reference?: string;
      notes?: string;
    }>;
  };
};

function env(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

function extractAttendees(transcript: string): { attendees: string[]; absent: string[] } {
  const speakers = new Set<string>();
  for (const line of transcript.split("\n")) {
    const m = line.match(/^([A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)+):/);
    if (m) speakers.add(m[1]);
  }
  const absentMatch = transcript.match(/([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) (?:is )?absent/i);
  const absent = absentMatch ? [absentMatch[1]] : [];
  return { attendees: Array.from(speakers), absent };
}

function findNearbyContext(transcript: string, keyword: RegExp): string {
  const lines = transcript.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (keyword.test(lines[i])) return lines[i];
  }
  return "";
}

function heuristicSummary(args: {
  transcript: string;
  meetingTitle: string;
  meetingType: string;
}): MinuteDraft {
  const { attendees, absent } = extractAttendees(args.transcript);
  const lines = args.transcript.split("\n").map((l) => l.trim()).filter(Boolean);

  const motions: MinuteDraft["motions"] = [];
  const decisions: string[] = [];
  const actionItems: MinuteDraft["actionItems"] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moveMatch = line.match(/^(.+?):\s*I move (?:that )?(.+?)[.\n]?$/i);
    if (moveMatch) {
      const movedBy = moveMatch[1];
      const text = moveMatch[2].replace(/[.?!]+$/, "");
      const secondLine = lines.slice(i + 1, i + 3).find((l) => /second/i.test(l));
      const secondedBy = secondLine?.match(/^(.+?):/)?.[1];
      const outcomeLine = lines
        .slice(i + 1, i + 5)
        .find((l) => /(carried|defeated|tabled|motion carries)/i.test(l)) ?? "";
      let outcome = "Tabled";
      if (/defeat/i.test(outcomeLine)) outcome = "Defeated";
      else if (/carried|carries/i.test(outcomeLine)) outcome = "Carried";
      const vf = outcomeLine.match(/(\d+)\s*in\s*favour/i);
      const va = outcomeLine.match(/(\d+)\s*(?:opposed|against)/i);
      const vx = outcomeLine.match(/(\d+)\s*(?:abstention|abstain)/i);
      motions.push({
        text: text.charAt(0).toUpperCase() + text.slice(1) + ".",
        movedBy,
        secondedBy,
        outcome,
        votesFor: vf ? Number(vf[1]) : undefined,
        votesAgainst: va ? Number(va[1]) : undefined,
        abstentions: vx ? Number(vx[1]) : undefined,
      });
    }

    if (/decision recorded:/i.test(line)) {
      decisions.push(line.replace(/^.*decision recorded:\s*/i, "").trim());
    }
    const actionMatch = line.match(/action item:\s*(.+)$/i);
    if (actionMatch) {
      const chunks = actionMatch[1]
        .split(/\.(?:\s|$)/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const chunk of chunks) {
        const who = chunk.match(/^([A-Z][a-z]+)/)?.[1];
        const byDate = chunk.match(/by\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)/i)?.[1];
        actionItems.push({
          text: chunk.charAt(0).toUpperCase() + chunk.slice(1),
          assignee: who,
          dueDate: byDate,
          done: false,
        });
      }
    }
  }

  if (decisions.length === 0) {
    for (const motion of motions) {
      if (motion.outcome === "Carried") decisions.push(motion.text);
    }
  }

  const openLine = findNearbyContext(args.transcript, /call the meeting to order|good evening/i);
  const closeLine = findNearbyContext(args.transcript, /adjourn/i);
  const calledToOrderAt = extractTime(openLine);
  const adjournedAt = extractTime(closeLine);
  const chairName = extractOfficerName(openLine, /(called|convened).*?(?:by\s+)?([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)|([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)\s+(?:called|convened)/i);
  const nextMeetingAt = extractNextMeeting(args.transcript);
  const remoteParticipation = extractRemoteParticipation(args.transcript);
  const discussion = [openLine, closeLine]
    .filter(Boolean)
    .concat([
      `Topics covered: ${
        motions.map((motion) => motion.text.split(".")[0]).slice(0, 3).join("; ") ||
        `${args.meetingType} business for ${args.meetingTitle}`
      }.`,
    ])
    .join("\n\n");

  const detailedAttendance = [
    ...attendees.map((name) => ({ name, status: "present", quorumCounted: true })),
    ...absent.map((name) => ({ name, status: "absent", quorumCounted: false })),
  ];

  return {
    chairName,
    calledToOrderAt,
    adjournedAt,
    remoteParticipation,
    detailedAttendance,
    discussion,
    sections: inferredSections(lines),
    motions,
    decisions,
    actionItems,
    attendees,
    absent,
    nextMeetingAt,
  };
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeDraft(draft: any, fallback: MinuteDraft): MinuteDraft {
  const motions = Array.isArray(draft?.motions)
    ? draft.motions
        .filter((row: any) => typeof row?.text === "string" && row.text.trim())
        .map((row: any) => ({
          text: row.text.trim(),
          movedBy: row.movedBy?.trim() || undefined,
          secondedBy: row.secondedBy?.trim() || undefined,
          outcome: row.outcome?.trim() || "Recorded",
          votesFor: Number.isFinite(Number(row.votesFor)) ? Number(row.votesFor) : undefined,
          votesAgainst:
            Number.isFinite(Number(row.votesAgainst)) ? Number(row.votesAgainst) : undefined,
          abstentions:
            Number.isFinite(Number(row.abstentions)) ? Number(row.abstentions) : undefined,
        }))
    : fallback.motions;

  const decisions = Array.isArray(draft?.decisions)
    ? draft.decisions.filter((row: any) => typeof row === "string" && row.trim()).map((row: string) => row.trim())
    : fallback.decisions;

  const actionItems = Array.isArray(draft?.actionItems)
    ? draft.actionItems
        .filter((row: any) => typeof row?.text === "string" && row.text.trim())
        .map((row: any) => ({
          text: row.text.trim(),
          assignee: row.assignee?.trim() || undefined,
          dueDate: row.dueDate?.trim() || undefined,
          done: !!row.done,
        }))
    : fallback.actionItems;

  const attendees = Array.isArray(draft?.attendees)
    ? draft.attendees.filter((row: any) => typeof row === "string" && row.trim()).map((row: string) => row.trim())
    : fallback.attendees;
  const absent = Array.isArray(draft?.absent)
    ? draft.absent.filter((row: any) => typeof row === "string" && row.trim()).map((row: string) => row.trim())
    : fallback.absent;

  return {
    chairName: optionalString(draft?.chairName) ?? fallback.chairName,
    secretaryName: optionalString(draft?.secretaryName) ?? fallback.secretaryName,
    recorderName: optionalString(draft?.recorderName) ?? fallback.recorderName,
    calledToOrderAt: optionalString(draft?.calledToOrderAt) ?? fallback.calledToOrderAt,
    adjournedAt: optionalString(draft?.adjournedAt) ?? fallback.adjournedAt,
    remoteParticipation: normalizeRemoteParticipation(draft?.remoteParticipation) ?? fallback.remoteParticipation,
    detailedAttendance: normalizeDetailedAttendance(draft?.detailedAttendance) ?? fallback.detailedAttendance,
    discussion:
      typeof draft?.discussion === "string" && draft.discussion.trim()
        ? draft.discussion.trim()
        : fallback.discussion,
    sections: normalizeSections(draft?.sections) ?? fallback.sections,
    motions,
    decisions,
    actionItems,
    attendees,
    absent,
    nextMeetingAt: optionalString(draft?.nextMeetingAt) ?? fallback.nextMeetingAt,
    nextMeetingLocation: optionalString(draft?.nextMeetingLocation) ?? fallback.nextMeetingLocation,
    nextMeetingNotes: optionalString(draft?.nextMeetingNotes) ?? fallback.nextMeetingNotes,
    sessionSegments: normalizeSessionSegments(draft?.sessionSegments) ?? fallback.sessionSegments,
    appendices: normalizeAppendices(draft?.appendices) ?? fallback.appendices,
    agmDetails: normalizeAgmDetails(draft?.agmDetails) ?? fallback.agmDetails,
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRemoteParticipation(value: any): MinuteDraft["remoteParticipation"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out = {
    url: optionalString(value.url),
    meetingId: optionalString(value.meetingId),
    passcode: optionalString(value.passcode),
    instructions: optionalString(value.instructions),
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

function normalizeDetailedAttendance(value: any): MinuteDraft["detailedAttendance"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row) => optionalString(row?.name))
    .map((row) => ({
      name: optionalString(row.name)!,
      status: optionalString(row.status) ?? "present",
      roleTitle: optionalString(row.roleTitle),
      affiliation: optionalString(row.affiliation),
      memberIdentifier: optionalString(row.memberIdentifier),
      proxyFor: optionalString(row.proxyFor),
      quorumCounted: typeof row.quorumCounted === "boolean" ? row.quorumCounted : undefined,
      notes: optionalString(row.notes),
    }));
  return rows.length ? rows : undefined;
}

function normalizeSections(value: any): MinuteDraft["sections"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row) => optionalString(row?.title))
    .map((row) => ({
      title: optionalString(row.title)!,
      type: optionalString(row.type),
      presenter: optionalString(row.presenter),
      discussion: optionalString(row.discussion),
      reportSubmitted: typeof row.reportSubmitted === "boolean" ? row.reportSubmitted : undefined,
      decisions: Array.isArray(row.decisions) ? row.decisions.map(optionalString).filter(Boolean) as string[] : undefined,
      actionItems: Array.isArray(row.actionItems)
        ? row.actionItems
            .filter((item: any) => optionalString(item?.text))
            .map((item: any) => ({
              text: optionalString(item.text)!,
              assignee: optionalString(item.assignee),
              dueDate: optionalString(item.dueDate),
              done: !!item.done,
            }))
        : undefined,
    }));
  return rows.length ? rows : undefined;
}

function normalizeSessionSegments(value: any): MinuteDraft["sessionSegments"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row) => optionalString(row?.type))
    .map((row) => ({
      type: optionalString(row.type)!,
      title: optionalString(row.title),
      startedAt: optionalString(row.startedAt),
      endedAt: optionalString(row.endedAt),
      notes: optionalString(row.notes),
    }));
  return rows.length ? rows : undefined;
}

function normalizeAppendices(value: any): MinuteDraft["appendices"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row) => optionalString(row?.title))
    .map((row) => ({
      title: optionalString(row.title)!,
      type: optionalString(row.type),
      reference: optionalString(row.reference),
      notes: optionalString(row.notes),
    }));
  return rows.length ? rows : undefined;
}

function normalizeAgmDetails(value: any): MinuteDraft["agmDetails"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const directorAppointments = Array.isArray(value.directorAppointments)
    ? value.directorAppointments
        .filter((row: any) => optionalString(row?.name))
        .map((row: any) => ({
          name: optionalString(row.name)!,
          roleTitle: optionalString(row.roleTitle),
          affiliation: optionalString(row.affiliation),
          term: optionalString(row.term),
          consentRecorded: typeof row.consentRecorded === "boolean" ? row.consentRecorded : undefined,
          votesReceived: typeof row.votesReceived === "number" ? row.votesReceived : undefined,
          elected: typeof row.elected === "boolean" ? row.elected : undefined,
          status: optionalString(row.status),
          notes: optionalString(row.notes),
        }))
    : undefined;
  const specialResolutionExhibits = Array.isArray(value.specialResolutionExhibits)
    ? value.specialResolutionExhibits
        .filter((row: any) => optionalString(row?.title))
        .map((row: any) => ({
          title: optionalString(row.title)!,
          reference: optionalString(row.reference),
          notes: optionalString(row.notes),
        }))
    : undefined;
  const out = {
    financialStatementsPresented: typeof value.financialStatementsPresented === "boolean" ? value.financialStatementsPresented : undefined,
    financialStatementsNotes: optionalString(value.financialStatementsNotes),
    directorElectionNotes: optionalString(value.directorElectionNotes),
    directorAppointments: directorAppointments?.length ? directorAppointments : undefined,
    specialResolutionExhibits: specialResolutionExhibits?.length ? specialResolutionExhibits : undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
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

function extractRemoteParticipation(text: string): MinuteDraft["remoteParticipation"] | undefined {
  const url = optionalString(text.match(/https?:\/\/\S+/i)?.[0]);
  const meetingId = optionalString(text.match(/\bmeeting id[:\s]+([A-Z0-9 -]{5,})/i)?.[1]);
  if (!url && !meetingId) return undefined;
  return { url, meetingId };
}

function inferredSections(lines: string[]): MinuteDraft["sections"] | undefined {
  const headings = lines
    .filter((line) => /^(?:\d+[\). -]+)?[A-Z][A-Za-z &/,'’-]{3,60}$/.test(line) && !/^(motion|action item|minutes)$/i.test(line))
    .slice(0, 12)
    .map((title) => ({ title, type: /report/i.test(title) ? "report" : "discussion" }));
  return headings.length ? headings : undefined;
}

async function openaiSummary(args: {
  transcript: string;
  meetingTitle: string;
  meetingType: string;
}) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = env("OPENAI_MINUTES_MODEL") ?? env("OPENAI_MODEL") ?? "gpt-4o-mini";
  const endpoint = env("OPENAI_API_BASE_URL") ?? "https://api.openai.com/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You turn meeting transcripts into strict JSON for nonprofit minutes. Return only valid JSON. Include keys discussion, motions, decisions, actionItems, attendees, absent, plus optional chairName, secretaryName, recorderName, calledToOrderAt, adjournedAt, remoteParticipation, detailedAttendance, sections, nextMeetingAt, nextMeetingLocation, nextMeetingNotes, sessionSegments, appendices, and agmDetails when clearly supported by the transcript. Use detailedAttendance.memberIdentifier for student/member numbers. Use agmDetails.directorAppointments votesReceived/elected when election results are stated. Keep motions factual and concise. Omit unknown optional fields.",
        },
        {
          role: "user",
          content: `Meeting title: ${args.meetingTitle}\nMeeting type: ${args.meetingType}\n\nTranscript:\n${args.transcript}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `OpenAI request failed with status ${response.status}.`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI minutes response was empty.");
  }
  return JSON.parse(stripCodeFence(content));
}

async function anthropicSummary(args: {
  transcript: string;
  meetingTitle: string;
  meetingType: string;
}) {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const model =
    env("ANTHROPIC_MINUTES_MODEL") ?? env("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest";
  const endpoint = env("ANTHROPIC_API_BASE_URL") ?? "https://api.anthropic.com/v1/messages";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      temperature: 0.2,
      system:
        "You turn meeting transcripts into strict JSON for nonprofit minutes. Return only valid JSON. Include keys discussion, motions, decisions, actionItems, attendees, absent, plus optional chairName, secretaryName, recorderName, calledToOrderAt, adjournedAt, remoteParticipation, detailedAttendance, sections, nextMeetingAt, nextMeetingLocation, nextMeetingNotes, sessionSegments, appendices, and agmDetails when clearly supported by the transcript. Use detailedAttendance.memberIdentifier for student/member numbers. Use agmDetails.directorAppointments votesReceived/elected when election results are stated. Omit unknown optional fields.",
      messages: [
        {
          role: "user",
          content: `Meeting title: ${args.meetingTitle}\nMeeting type: ${args.meetingType}\n\nTranscript:\n${args.transcript}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `Anthropic request failed with status ${response.status}.`);
  }
  const data = await response.json();
  const content = Array.isArray(data?.content)
    ? data.content
        .map((block: any) => (block?.type === "text" ? block.text : ""))
        .join("\n")
        .trim()
    : "";
  if (!content) {
    throw new Error("Anthropic minutes response was empty.");
  }
  return JSON.parse(stripCodeFence(content));
}

export async function summarizeMinutes(args: {
  transcript: string;
  meetingTitle: string;
  meetingType: string;
}): Promise<MinuteDraft> {
  const fallback = heuristicSummary(args);
  const provider = providers.llm();

  if (provider.id === "demo") {
    return fallback;
  }

  try {
    const raw =
      provider.id === "anthropic"
        ? await anthropicSummary(args)
        : await openaiSummary(args);
    return normalizeDraft(raw, fallback);
  } catch (error) {
    console.error("[minutes-llm] falling back to heuristic draft", error);
    return fallback;
  }
}
