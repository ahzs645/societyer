/**
 * How field provenance rows are shown to people (the "View source" drawer).
 *
 * Intake promotion records one provenance row per promoted source path, so a
 * record also carries rows for structural paths (the extractor's `kind`
 * classification, the organization name a filing repeats, source ids, table
 * column keys, arithmetic checks). Those rows stay stored — they explain how
 * a record was built — but the drawer hides them and shows human labels
 * ("Term start", not `termStart`).
 */

/** Leaf field names that describe how a record was extracted, not a value of it. */
export const STRUCTURAL_PROVENANCE_FIELDS: ReadonlySet<string> = new Set([
  "kind",
  "docClass",
  "recordStatus",
  "organizationName",
  "sourceExternalIds",
  "importedSourceVersions",
  "sourceLocator",
  "confidence",
  "external",
  "arithmeticCheck",
  "column",
  "itemIndex",
  "asOfDate",
]);

const FIELD_LABELS: Record<string, string> = {
  fullName: "Name",
  name: "Name",
  termStart: "Term start",
  termEnd: "Term end",
  consentGiven: "Consent given",
  signedDate: "Signed",
  organisationRepresented: "Organization represented",
  representativeType: "Representative type",
  role: "Role",
  seat: "Seat",
  scheduledAt: "Date",
  localStartText: "Start time",
  localEndText: "End time",
  endTime: "End time",
  calledToOrderAt: "Called to order",
  adjournedAt: "Adjourned",
  chairName: "Chair",
  detailedAttendance: "Attendance",
  sections: "Section",
  agendaItems: "Agenda item",
  consentItems: "Consent item",
  itemNumber: "Item number",
  number: "Number",
  requestedAction: "Requested action",
  groupAction: "Group action",
  movedBy: "Moved by",
  secondedBy: "Seconded by",
  text: "Text",
  outcome: "Outcome",
  policyName: "Policy name",
  policyNumber: "Policy number",
  effectiveDate: "Effective date",
  reviewDate: "Review date",
  adoptedAt: "Adopted at",
  owner: "Owner",
  clauses: "Clause",
  heading: "Heading",
  feePaidCents: "Fee paid",
  filedAt: "Filed",
  periodLabel: "Period",
  agmDate: "AGM date",
  incorporationNumber: "Incorporation number",
  premiumCents: "Premium",
  startDate: "Start date",
  endDate: "End date",
  versionType: "Document type",
  coverageSummary: "Coverage",
  amountAwardedCents: "Amount awarded",
  amountRequestedCents: "Amount requested",
  restrictedPurpose: "Restricted purpose",
  reportingRequirements: "Reporting requirement",
  paymentSchedule: "Payment",
  due: "Due",
  dueDate: "Due date",
  periodEnd: "Period end",
  periodStart: "Period start",
  fiscalYearEnd: "Fiscal year end",
  statementType: "Statement type",
  lines: "Line",
  totals: "Total",
  label: "Label",
  amount: "Amount",
  quorumRule: "Quorum rule",
  bodyQuorumRules: "Quorum rule",
  quorumType: "Quorum type",
  quorumValue: "Quorum value",
  noticeDays: "Notice (days)",
  noticeMaxDays: "Maximum notice (days)",
  directorCountMin: "Minimum directors",
  directorCountMax: "Maximum directors",
  directorTermYears: "Director term (years)",
  specialResolutionThresholdPct: "Special resolution threshold",
  electronicMeetings: "Electronic meetings",
  proxiesAllowed: "Proxies allowed",
  agmFrequency: "AGM frequency",
  summary: "Summary",
};

function segments(fieldPath: string): Array<{ name: string; index?: number }> {
  return String(fieldPath)
    .split(".")
    .filter(Boolean)
    .map((segment) => {
      const match = /^([^[]+)(?:\[(\d+)\])?$/.exec(segment);
      return match ? { name: match[1], ...(match[2] !== undefined ? { index: Number(match[2]) } : {}) } : { name: segment };
    });
}

function humanize(name: string): string {
  return FIELD_LABELS[name] ?? name.replace(/Cents$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (_match, char: string) => ` ${char.toLowerCase()}`);
}

/** True for provenance rows the drawer hides (structural paths). */
export function isStructuralProvenanceField(fieldPath: string): boolean {
  const parts = segments(fieldPath);
  const leaf = parts.at(-1)?.name;
  return !leaf || STRUCTURAL_PROVENANCE_FIELDS.has(leaf);
}

/** "detailedAttendance[2].status" → "Attendance 3 › Status"; "termStart" → "Term start". */
export function provenanceFieldLabel(fieldPath: string): string {
  return segments(fieldPath)
    .map((part) => `${humanize(part.name)}${part.index !== undefined ? ` ${part.index + 1}` : ""}`)
    .join(" › ");
}
