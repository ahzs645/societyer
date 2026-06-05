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
    id: "numbered-agenda",
    label: "Numbered Agenda",
    source: "OTE sample board minutes",
    tone: "Indented Word-style board minutes with metadata, agenda list, numbered topics, motion/first/second blocks, actions, and next meeting.",
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
