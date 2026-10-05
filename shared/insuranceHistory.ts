/** Comparisons only use explicitly linked records and known monetary amounts. */
export type InsuranceHistoryPolicy = {
  _id: string;
  societyId?: string;
  policySeriesKey?: string;
  policyNumber?: string;
  renewalOfPolicyNumber?: string;
  startDate?: string;
  premiumCents?: number;
  coverageCents?: number;
  deductibleCents?: number;
  [key: string]: any;
};

export function policyHistory<T extends InsuranceHistoryPolicy>(policy: T, rows: T[]): T[] {
  // A number alone can recur across insurers; never infer a series from it.
  const series = policy.policySeriesKey?.trim();
  return rows.filter((row) => row.societyId === policy.societyId && (
    series ? row.policySeriesKey?.trim() === series : row._id === policy._id
  )).sort((a, b) => String(a.startDate ?? "").localeCompare(String(b.startDate ?? "")) || a._id.localeCompare(b._id));
}

export function policyCostChange(current?: number, previous?: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  const cents = current! - previous!;
  return { cents, percent: previous! === 0 ? undefined : cents / previous! * 100 };
}

/** Amount in cents. A rate is cents charged for each $100 of assessable payroll. */
export function estimatePayrollAssessment(assessedPayrollCents?: number, netRatePer100PayrollCents?: number) {
  if (assessedPayrollCents == null || netRatePer100PayrollCents == null) return undefined;
  if (!Number.isSafeInteger(assessedPayrollCents) || assessedPayrollCents < 0 || !Number.isSafeInteger(netRatePer100PayrollCents) || netRatePer100PayrollCents < 0) return undefined;
  const estimatedCents = Math.round(assessedPayrollCents * netRatePer100PayrollCents / 10000);
  return Number.isSafeInteger(estimatedCents) ? estimatedCents : undefined;
}

type CoverageItem = { label: string; coverageType?: string; coveredClass?: string; limitCents?: number };
export type CoverageItemChange = { label: string; status: "changed" | "added" | "removed" | "unknown"; previousCents?: number; currentCents?: number };

export function policyCoverageChanges(previous?: CoverageItem[], current?: CoverageItem[]): CoverageItemChange[] {
  // Empty/absent schedules mean no item-level evidence was captured.
  if (!previous?.length || !current?.length) return [{ label: "Coverage schedule", status: "unknown" }];
  const key = (item: CoverageItem) => [item.label, item.coverageType, item.coveredClass].map(value => String(value ?? "").trim().toLowerCase()).join("|");
  const before = new Map<string, CoverageItem[]>();
  const after = new Map<string, CoverageItem[]>();
  for (const [rows, map] of [[previous, before], [current, after]] as const) {
    for (const item of rows) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  }
  const changes: CoverageItemChange[] = [];
  for (const identity of new Set([...before.keys(), ...after.keys()])) {
    const oldRows = before.get(identity) ?? [];
    const newRows = after.get(identity) ?? [];
    const oldItem = oldRows[0];
    const newItem = newRows[0];
    const label = newItem?.label || oldItem?.label || "Unnamed coverage";
    if (oldRows.length > 1 || newRows.length > 1) { changes.push({ label, status: "unknown" }); continue; }
    if (!oldItem) { changes.push({ label, status: "added", currentCents: newItem?.limitCents }); continue; }
    if (!newItem) { changes.push({ label, status: "removed", previousCents: oldItem.limitCents }); continue; }
    if (!Number.isFinite(oldItem.limitCents) || !Number.isFinite(newItem.limitCents)) {
      changes.push({ label, status: "unknown", previousCents: oldItem.limitCents, currentCents: newItem.limitCents });
    } else if (oldItem.limitCents !== newItem.limitCents) {
      changes.push({ label, status: "changed", previousCents: oldItem.limitCents, currentCents: newItem.limitCents });
    }
  }
  return changes;
}

/** A renewal starts as unverified; term-specific facts must come from new documents. */
export function renewalPolicyDraft(policy: InsuranceHistoryPolicy) {
  return {
    kind: policy.kind || "Other",
    insurer: policy.insurer || "",
    broker: policy.broker || "",
    policyNumber: "",
    policySeriesKey: policy.policySeriesKey?.trim() || `renewal:${policy._id}`,
    renewalOfPolicyNumber: policy.policyNumber || "",
    versionType: "Renewal",
    policyTermLabel: "",
    startDate: policy.endDate || policy.renewalDate || "",
    endDate: "",
    renewalDate: "",
    status: "NeedsReview",
    confidence: "Review",
    sensitivity: policy.sensitivity || "",
    riskFlags: ["needs review"],
  };
}
