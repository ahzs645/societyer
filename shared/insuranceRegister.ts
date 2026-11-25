export const coverageCodes: Record<string, string> = {
  CGL: "Commercial general liability",
  ManagementLiability: "Management liability",
  ProfessionalLiability: "Professional liability",
  Property: "Property",
  Cyber: "Cyber",
  NonOwnedAuto: "Non-owned automobile",
};

/** Suggested bases. The stored wording may also be a carrier-specific basis. */
export const limitBases = [
  "Each occurrence",
  "Aggregate",
  "Per claim",
  "Per claim and aggregate",
  "Per person",
  "Per person or organization",
  "Any one premises",
  "Per policy term",
];

export const insuranceTermTextFields = [
  ["namedInsured", "Named insured"],
  ["currency", "Policy currency"],
  ["coverholder", "Coverholder"],
  ["brokerCustomerNumber", "Broker customer number"],
  ["billingMethod", "Billing method"],
  ["declaredOperations", "Declared operations"],
] as const;

export const optionalPolicyFields = new Set([
  ...insuranceTermTextFields.map(([key]) => key),
  "grossReceiptsCents",
  "minimumRetainedPremiumPercent",
  "broker",
  "policySeriesKey",
  "policyTermLabel",
  "versionType",
  "renewalOfPolicyNumber",
  "coverageCents",
  "premiumCents",
  "policyFeeCents",
  "totalCostCents",
  "deductibleCents",
  "coverageSummary",
  "claimsMadeTerms",
  "endDate",
  "confidence",
  "sensitivity",
  "notes",
]);

export function addressCoverageLines<T extends { lineId?: string }>(
  lines: T[],
): T[] {
  const used = new Set(lines.map((line) => line.lineId).filter(Boolean));
  let next = 1;
  return lines.map((line) => {
    if (line.lineId) return line;
    while (used.has(`line-${next}`)) next++;
    const lineId = `line-${next++}`;
    used.add(lineId);
    return { ...line, lineId };
  });
}

export function insuranceAmount(cents?: number, currency?: string) {
  if (cents == null) return "—";
  const value = (cents / 100).toLocaleString("en-CA", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${value}` : `$${value}`;
}

/** One visible badge per meaning; the source flags stay available to the editor. */
export function policyCellBadges(status: string | undefined, flags: string[]) {
  const key = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const seen = new Set<string>();
  return [status && status !== "Active" ? status : "", ...flags].flatMap(value => {
    const normalized = key(value);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ label: normalized === "needsreview" ? "Needs review" : value.trim(), tone: normalized === "restricted" ? "danger" as const : value === status ? "status" as const : "warn" as const }];
  });
}
