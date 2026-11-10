/**
 * The workspace's own bid triage of an opportunity: a "reviewed" tick and a
 * four-level classification, saved in Societyer (not in Zoer) and shared by
 * everyone in the workspace. It sits beside Zoer's published decision and AI
 * suggestion; it never changes them. Shared by the hosted query and the list.
 */
export const TRIAGE_CLASSIFICATIONS = [
  { value: "doable", label: "Doable", color: "green", rank: 1 },
  { value: "possible", label: "Possible", color: "amber", rank: 2 },
  { value: "needs_partner", label: "Needs a partner", color: "orange", rank: 3 },
  { value: "not_doable", label: "Not doable", color: "red", rank: 4 },
] as const;
export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number]["value"];
export type Triage = { reviewed: boolean; classification: TriageClassification | "" };

/** Rows that are reviewed but not classified sort after every classified row. */
export const TRIAGE_UNCLASSIFIED_RANK = 9;
export const NO_TRIAGE: Triage = { reviewed: false, classification: "" };

export const isTriageClassification = (value: unknown): value is TriageClassification =>
  TRIAGE_CLASSIFICATIONS.some((entry) => entry.value === value);
export const triageRank = (classification: string): number =>
  TRIAGE_CLASSIFICATIONS.find((entry) => entry.value === classification)?.rank ?? TRIAGE_UNCLASSIFIED_RANK;
export const triageLabel = (classification: string): string =>
  TRIAGE_CLASSIFICATIONS.find((entry) => entry.value === classification)?.label ?? "";

/**
 * Archived: reviewed and judged not doable. The row is kept and still opens by
 * link; the list leaves it out unless "Show archived" is on.
 */
export const isTriageArchived = (triage: Triage): boolean =>
  triage.reviewed && triage.classification === "not_doable";

/** An action item (a Societyer task) can be made once the opportunity is reviewed and classified as anything but not doable. */
export const canCreateTriageTask = (triage: Triage): boolean =>
  triage.reviewed && triage.classification !== "" && triage.classification !== "not_doable";
/** A triage with the task made from it, if any. */
export type TriageState = Triage & { taskId?: string };
