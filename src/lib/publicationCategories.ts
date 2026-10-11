/** Human labels for transparency publication categories (stored as codes). */
export const PUBLICATION_CATEGORY_LABELS: Record<string, string> = {
  AnnualReport: "Annual report",
  Bylaws: "Bylaws",
  AGM: "AGM materials",
  FinancialSummary: "Financial summary",
  Grant: "Grant disclosure",
  InspectionInstructions: "Records inspection instructions",
  Policy: "Policy",
  Notice: "Notice",
  Resource: "Resource",
  Custom: "Custom",
};

export function publicationCategoryLabel(category?: string | null): string {
  return (category && PUBLICATION_CATEGORY_LABELS[category]) || category || "Other";
}
