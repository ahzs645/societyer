// LLM adapter — produces structured meeting minutes from a transcript.
import { providers } from "./env";

export type MinuteDraft = {
  discussion: string;
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
  const discussion = [openLine, closeLine]
    .filter(Boolean)
    .concat([
      `Topics covered: ${
        motions.map((motion) => motion.text.split(".")[0]).slice(0, 3).join("; ") ||
        `${args.meetingType} business for ${args.meetingTitle}`
      }.`,
    ])
    .join("\n\n");

  return { discussion, motions, decisions, actionItems, attendees, absent };
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
    discussion:
      typeof draft?.discussion === "string" && draft.discussion.trim()
        ? draft.discussion.trim()
        : fallback.discussion,
    motions,
    decisions,
    actionItems,
    attendees,
    absent,
  };
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
            "You turn meeting transcripts into strict JSON for nonprofit minutes. Return only valid JSON with keys discussion, motions, decisions, actionItems, attendees, absent. Keep motions factual and concise.",
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
        "You turn meeting transcripts into strict JSON for nonprofit minutes. Return only valid JSON with keys discussion, motions, decisions, actionItems, attendees, absent.",
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
