/**
 * Governance-expectation rule pack for record continuity (finding A15).
 *
 * These are *record* expectations: what an organization's own history should
 * contain. They are matched against native records by `shared/continuity.ts`.
 * They complement the executable compliance rule packs in
 * `src/lib/compliance/rulePacks/*.json` (which create forward-looking
 * obligations); they do not replace them.
 *
 * Not legal advice. Citations were checked against the BC Laws consolidation
 * of the Societies Act, SBC 2015, c. 18 ("current to September 22, 2026",
 * retrieved 2026-10-06). Every rule is `draft` until a reviewer with the
 * relevant background signs off (CONTRIBUTING.md, rule-pack guidance).
 */

export type ExpectationKind =
  | "meeting"
  | "agm"
  | "annual_filing"
  | "financial_statement"
  | "director_consent"
  | "director_count"
  | "role_term"
  | "insurance_term"
  | "policy_review"
  | "funder_report";

export const EXPECTATION_KINDS: readonly ExpectationKind[] = [
  "meeting", "agm", "annual_filing", "financial_statement", "director_consent", "director_count",
  "role_term", "insurance_term", "policy_review", "funder_report",
];

export const EXPECTATION_KIND_LABELS: Record<ExpectationKind, string> = {
  meeting: "Meetings",
  agm: "Annual general meeting",
  annual_filing: "Annual report filed",
  financial_statement: "Financial statements presented",
  director_consent: "Director consent on file",
  director_count: "Minimum number of directors",
  role_term: "Role term renewed",
  insurance_term: "Insurance in force",
  policy_review: "Policy reviewed",
  funder_report: "Funder report submitted",
};

export type BodyKind = "members" | "board" | "committee" | "organization";
export type ExpectationSeverity = "statutory" | "bylaw" | "practice";
export type ExpectationOrigin = "rule_pack" | "bylaw_rules" | "manual" | "inferred" | "schedule_document" | "committee_structure";

export type CadenceFrequency =
  | "calendar_year"
  | "annual"
  | "monthly"
  | "quarterly"
  | "per_year_count"
  | "after_event"
  | "continuous"
  | "ad_hoc";

export const CADENCE_FREQUENCIES: readonly CadenceFrequency[] = [
  "calendar_year", "annual", "monthly", "quarterly", "per_year_count", "after_event", "continuous", "ad_hoc",
];

export const CADENCE_FREQUENCY_LABELS: Record<CadenceFrequency, string> = {
  calendar_year: "Once each calendar year",
  annual: "Annually",
  monthly: "Monthly",
  quarterly: "Quarterly",
  per_year_count: "N times per year",
  after_event: "Within N days after an event",
  continuous: "Continuously in force",
  ad_hoc: "As needed (no expectation)",
};

export type CadenceRule = {
  frequency: CadenceFrequency | string;
  count?: number;
  months?: number[];
  anchor?: string;
  offsetDays?: number;
  minimumCount?: number;
  seriesKey?: string;
  notes?: string;
};

export type RulePackSource = {
  sourceId: string;
  title: string;
  citation: string;
  url: string;
  retrievedAt: string;
  currentTo?: string;
};

export type ExpectationTemplate = {
  ruleKey: string;
  title: string;
  kind: ExpectationKind;
  bodyKind: BodyKind;
  meetingType?: string;
  rule: CadenceRule;
  severity: ExpectationSeverity;
  citation: string;
  sourceIds: string[];
  status: "draft" | "reviewed";
  caveat: string;
  /** Offset from the society's incorporation year at which the rule starts. */
  startsYearsAfterIncorporation?: number;
};

export type ExpectationRulePack = {
  packId: string;
  version: number;
  jurisdictionCode: string;
  entityTypes: string[];
  title: string;
  sources: RulePackSource[];
  rules: ExpectationTemplate[];
};

export const BC_SOCIETIES_EXPECTATION_PACK: ExpectationRulePack = {
  packId: "ca-bc-societies-record-continuity",
  version: 1,
  jurisdictionCode: "CA-BC",
  entityTypes: ["society"],
  title: "BC Societies Act record continuity",
  sources: [
    {
      sourceId: "bc-societies-act",
      title: "Societies Act",
      citation: "Societies Act, SBC 2015, c. 18",
      url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01",
      retrievedAt: "2026-10-06",
      currentTo: "2026-09-22",
    },
  ],
  rules: [
    {
      ruleKey: "BC-SOC-AGM-ANNUAL",
      title: "Annual general meeting held each calendar year",
      kind: "agm",
      bodyKind: "members",
      meetingType: "AGM",
      rule: { frequency: "calendar_year" },
      severity: "statutory",
      citation: "Societies Act, SBC 2015, c. 18, s. 71(1)–(2)",
      sourceIds: ["bc-societies-act"],
      status: "draft",
      caveat: "An AGM is not required in the calendar year of incorporation (s. 71(2)). A registrar-authorized postponement or a resolution in lieu of an AGM can satisfy a year; record it with \"waived\" and the evidence. Years before 28 Nov 2016 were governed by the former Society Act; check the bylaws then in force.",
      startsYearsAfterIncorporation: 1,
    },
    {
      ruleKey: "BC-SOC-ANNUAL-REPORT",
      title: "Annual report filed within 30 days after the AGM",
      kind: "annual_filing",
      bodyKind: "organization",
      rule: { frequency: "after_event", anchor: "agm", offsetDays: 30 },
      severity: "statutory",
      citation: "Societies Act, SBC 2015, c. 18, s. 73(1)",
      sourceIds: ["bc-societies-act"],
      status: "draft",
      caveat: "Missing filing evidence in the records is not proof the report was not filed; confirm against BC Registries before treating a year as unfiled.",
      startsYearsAfterIncorporation: 1,
    },
    {
      ruleKey: "BC-SOC-FS-AT-AGM",
      title: "Financial statements presented at each AGM",
      kind: "financial_statement",
      bodyKind: "members",
      rule: { frequency: "after_event", anchor: "agm", offsetDays: 0 },
      severity: "statutory",
      citation: "Societies Act, SBC 2015, c. 18, s. 35(1)",
      sourceIds: ["bc-societies-act"],
      status: "draft",
      caveat: "Matched against official financials and imported statements for the fiscal year ending before the AGM. A fiscal-year-end change can leave a transition period that needs a manual note.",
      startsYearsAfterIncorporation: 1,
    },
    {
      ruleKey: "BC-SOC-DIRECTORS-MIN",
      title: "At least three directors",
      kind: "director_count",
      bodyKind: "board",
      rule: { frequency: "continuous", minimumCount: 3 },
      severity: "statutory",
      citation: "Societies Act, SBC 2015, c. 18, s. 40",
      sourceIds: ["bc-societies-act"],
      status: "draft",
      caveat: "Member-funded societies may have fewer directors (Part 11, s. 197). At least one director must be ordinarily resident in BC; residency is checked on the dashboard.",
      startsYearsAfterIncorporation: 0,
    },
    {
      ruleKey: "BC-SOC-DIRECTOR-CONSENT",
      title: "Director consent to act on file",
      kind: "director_consent",
      bodyKind: "board",
      rule: { frequency: "continuous" },
      severity: "statutory",
      citation: "Societies Act, SBC 2015, c. 18, s. 42(4)",
      sourceIds: ["bc-societies-act"],
      status: "draft",
      caveat: "A designation, election or appointment is valid with written consent, or if made at a meeting the individual attends without refusing. Record either form of evidence.",
      startsYearsAfterIncorporation: 0,
    },
  ],
};

export const EXPECTATION_RULE_PACKS: readonly ExpectationRulePack[] = [BC_SOCIETIES_EXPECTATION_PACK];

export function rulePackForSociety(society: { jurisdictionCode?: string | null; entityType?: string | null } | null | undefined): ExpectationRulePack | undefined {
  if (!society) return undefined;
  const jurisdiction = String(society.jurisdictionCode ?? "").toUpperCase();
  const entityType = String(society.entityType ?? "society").toLowerCase();
  return EXPECTATION_RULE_PACKS.find((pack) => pack.jurisdictionCode === jurisdiction && pack.entityTypes.includes(entityType));
}

/** Validates a cadence rule from a form or import; throws on nonsense input. */
export function normalizeCadenceRule(rule: CadenceRule): CadenceRule {
  if (!rule || typeof rule !== "object") throw new Error("A cadence rule is required.");
  const frequency = String(rule.frequency ?? "");
  if (!(CADENCE_FREQUENCIES as readonly string[]).includes(frequency)) throw new Error(`Unsupported cadence frequency: ${frequency || "(empty)"}.`);
  const out: CadenceRule = { frequency };
  if (rule.count !== undefined) {
    if (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 366) throw new Error("Meetings per year must be a whole number from 1 to 366.");
    out.count = rule.count;
  }
  if (frequency === "per_year_count" && !out.count) throw new Error("Enter how many times per year.");
  if (rule.months !== undefined) {
    const months = [...new Set(rule.months)].sort((a, b) => a - b);
    if (months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) throw new Error("Months must be 1–12.");
    if (months.length) out.months = months;
  }
  if (out.count && out.months?.length && frequency === "per_year_count" && out.count > out.months.length * 31) throw new Error("Too many meetings for the selected months.");
  if (rule.offsetDays !== undefined) {
    if (!Number.isInteger(rule.offsetDays) || rule.offsetDays < 0 || rule.offsetDays > 730) throw new Error("Offset days must be 0–730.");
    out.offsetDays = rule.offsetDays;
  }
  if (frequency === "after_event") out.anchor = String(rule.anchor || "agm");
  else if (rule.anchor) out.anchor = String(rule.anchor);
  if (rule.minimumCount !== undefined) {
    if (!Number.isInteger(rule.minimumCount) || rule.minimumCount < 0 || rule.minimumCount > 1000) throw new Error("Minimum count must be a whole number.");
    out.minimumCount = rule.minimumCount;
  }
  if (rule.seriesKey) out.seriesKey = String(rule.seriesKey).slice(0, 120);
  if (rule.notes) out.notes = String(rule.notes).slice(0, 500);
  return out;
}

export function describeCadenceRule(rule: CadenceRule | undefined | null): string {
  if (!rule) return "No structured cadence";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = rule.months?.length ? ` (${rule.months.map((month) => monthNames[month - 1]).join(", ")})` : "";
  switch (rule.frequency) {
    case "calendar_year": return "Once each calendar year";
    case "annual": return "Annually";
    case "monthly": return `Monthly${months}`;
    case "quarterly": return "Quarterly";
    case "per_year_count": return `${rule.count ?? "?"} per year${months}`;
    case "after_event": {
      const anchor = rule.anchor === "agm" || !rule.anchor ? "AGM" : rule.anchor;
      return rule.offsetDays ? `Within ${rule.offsetDays} days after the ${anchor}` : `At each ${anchor}`;
    }
    case "continuous": return rule.minimumCount !== undefined ? `At least ${rule.minimumCount} at all times` : "Continuously";
    case "ad_hoc": return "As needed";
    default: return String(rule.frequency);
  }
}
