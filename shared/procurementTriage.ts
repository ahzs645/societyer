/**
 * The workspace's own bid triage of an opportunity: a "reviewed" tick and a
 * four-level classification, saved in Societyer (not in Zoer) and shared by
 * everyone in the workspace. It sits beside Zoer's published decision and AI
 * suggestion and never changes them. Used by convex/procurementTriage.ts and
 * the reader's list and notice page.
 */
export const TRIAGE_CLASSIFICATIONS = [
  { value: "doable", label: "Doable", color: "green" },
  { value: "possible", label: "Possible", color: "yellow" },
  { value: "needs_partner", label: "Needs a partner", color: "orange" },
  { value: "not_doable", label: "Not doable", color: "red" },
] as const;
export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number]["value"];
export type Triage = { reviewed: boolean; classification: TriageClassification | "" };
export const NO_TRIAGE: Triage = { reviewed: false, classification: "" };

export const isTriageClassification = (value: unknown): value is TriageClassification =>
  TRIAGE_CLASSIFICATIONS.some((entry) => entry.value === value);
/** A stored classification as the type allows it: anything unknown reads as unclassified. */
export const triageClassification = (value: unknown): TriageClassification | "" =>
  isTriageClassification(value) ? value : "";
export const triageLabel = (classification: string): string =>
  TRIAGE_CLASSIFICATIONS.find((entry) => entry.value === classification)?.label ?? "";

/** Triage applies to opportunities only; their record keys start with this. */
export const isOpportunityRecordKey = (recordKey: string): boolean =>
  recordKey.startsWith("opportunity:") && recordKey.length <= 500;

/**
 * Archived: reviewed and judged not doable. The notice is kept and still
 * opens by link; the list shows it only in its "Archived" view.
 */
export const isTriageArchived = (triage: Triage): boolean =>
  triage.reviewed && triage.classification === "not_doable";

/** An action item (a Societyer task) can be made once the opportunity is reviewed and classified as anything but not doable. */
export const canCreateTriageTask = (triage: Triage): boolean =>
  triage.reviewed && triage.classification !== "" && triage.classification !== "not_doable";

/** What the browser tells the server about the notice when it asks for an action item (the catalog may live outside Convex). */
export type TriageTaskNotice = {
  title: string;
  buyer: string;
  /** Closing date, `YYYY-MM-DD`, when known: the task's due date. */
  closes: string;
  /** The closing time as the source wrote it, for the description. */
  closesText: string;
  reference: string;
};
