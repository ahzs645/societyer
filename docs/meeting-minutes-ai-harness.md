# Meeting Minutes AI Harness

The meeting detail page already stores meeting structure in fields that are suitable for an AI drafting workflow:

- `meetings.agendaJson`: ordered agenda item strings.
- `minutes.sections`: structured agenda sections with `title`, `type`, `presenter`, `discussion`, `decisions`, `actionItems`, and `reportSubmitted`.
- `minutes.motions`: formal motions with mover/seconder, outcome, vote counts, and optional agenda section linkage.
- `minutes.decisions` and `minutes.actionItems`: top-level summaries used by exports and tables.
- `minutes.draftTranscript` and `transcripts`: source text for draft generation.
- quorum, attendance, remote participation, approval, appendices, AGM details, and next-meeting fields are first-class minutes data.

The AI agent harness exposes this as the `minute_drafter` definition, labelled "Meeting minutes copilot". Its bounded modes are:

1. Draft an agenda from uploaded material, rough notes, or spoken instructions.
2. Edit existing draft minutes without approving or finalizing the record.
3. Generate structured draft minutes from prompt, transcript, agenda, and meeting metadata.

The expected output contract is intentionally aligned to existing fields:

```ts
type MeetingMinutesAgentOutput = {
  agendaItems?: string[];
  sections?: Array<{
    title: string;
    type?: "discussion" | "motion" | "report" | "decision" | "other";
    presenter?: string;
    discussion?: string;
    decisions?: string[];
    actionItems?: Array<{ text: string; assignee?: string; dueDate?: string; done: boolean }>;
    reportSubmitted?: boolean;
  }>;
  motions?: Array<{
    text: string;
    movedBy?: string;
    secondedBy?: string;
    outcome: string;
    votesFor?: number;
    votesAgainst?: number;
    abstentions?: number;
    sectionIndex?: number;
    sectionTitle?: string;
  }>;
  decisions?: string[];
  actionItems?: Array<{ text: string; assignee?: string; dueDate?: string; done: boolean }>;
  reviewGaps?: string[];
};
```

Implementation notes:

- Agenda drafting should patch `meetings.agendaJson` only after user confirmation.
- Draft editing should patch `minutes.sections`, `minutes.motions`, `minutes.decisions`, and `minutes.actionItems` while leaving `approvedAt` untouched.
- Minutes generation can continue using `minutes.generateDraft` and `minutes.upsertFromDraft`; the agent harness should add clearer tool planning, source-gap reporting, and human approval checkpoints around that action.
- Ambiguous speakers, missing quorum evidence, missing attendance, and unsupported source claims should be returned as `reviewGaps` rather than silently written into final records.
