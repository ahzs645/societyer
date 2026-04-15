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

export async function summarizeMinutes(args: {
  transcript: string;
  meetingTitle: string;
  meetingType: string;
}): Promise<MinuteDraft> {
  const p = providers.llm();
  const { attendees, absent } = extractAttendees(args.transcript);
  if (p.id !== "demo") {
    // Live stub — a real implementation would stream a structured JSON output
    // via the Anthropic or OpenAI SDK. The schema of the response matches
    // MinuteDraft so callers don't branch on provider.
    throw new Error("Live LLM summarization requires ANTHROPIC_API_KEY or OPENAI_API_KEY plus an action context.");
  }

  // Deterministic demo summarizer. Far richer than the old regex pass: walks
  // the transcript line-by-line, grouping motions with their seconder, vote
  // outcome, and any following action items.
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
      const outcomeLine = lines.slice(i + 1, i + 5).find((l) => /(carried|defeated|tabled|motion carries)/i.test(l)) ?? "";
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
      const chunks = actionMatch[1].split(/\.(?:\s|$)/).map((s) => s.trim()).filter(Boolean);
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
    for (const m of motions) if (m.outcome === "Carried") decisions.push(m.text);
  }

  const openLine = findNearbyContext(args.transcript, /call the meeting to order|good evening/i);
  const closeLine = findNearbyContext(args.transcript, /adjourn/i);
  const discussion = [openLine, closeLine]
    .filter(Boolean)
    .concat([`Topics covered: ${motions.map((m) => m.text.split(".")[0]).slice(0, 3).join("; ")}.`])
    .join("\n\n");

  return { discussion, motions, decisions, actionItems, attendees, absent };
}
