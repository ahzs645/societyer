export const OPERATING_SUBSCRIPTION_INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual" },
  { value: "quarter", label: "Quarterly" },
  { value: "week", label: "Weekly" },
];

export const OPERATING_SUBSCRIPTION_STATUSES = [
  { value: "Active", label: "Active" },
  { value: "Planned", label: "Planned" },
  { value: "Paused", label: "Paused" },
];

export function newOperatingSubscriptionForm() {
  return {
    name: "",
    vendorName: "",
    category: "Software",
    amountCad: "",
    interval: "month",
    status: "Active",
    nextRenewalDate: "",
    notes: "",
  };
}

export function operatingSubscriptionFormFromRow(row: any) {
  return {
    id: row._id,
    name: row.name,
    vendorName: row.vendorName ?? "",
    category: row.category,
    amountCad: String((row.amountCents ?? 0) / 100),
    interval: row.interval,
    status: row.status,
    nextRenewalDate: row.nextRenewalDate ?? "",
    notes: row.notes ?? "",
  };
}

export function optionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function monthlyEstimateCents(row: { amountCents: number; interval: string }) {
  if (row.interval === "week") return Math.round((row.amountCents * 52) / 12);
  if (row.interval === "quarter") return Math.round(row.amountCents / 3);
  if (row.interval === "year") return Math.round(row.amountCents / 12);
  return row.amountCents;
}

export function operatingSubscriptionIntervalLabel(interval: string) {
  return OPERATING_SUBSCRIPTION_INTERVALS.find((row) => row.value === interval)?.label.toLowerCase() ?? interval;
}

export function operatingSubscriptionStatusTone(status: string): "success" | "warn" | "neutral" | "info" {
  if (status === "Active") return "success";
  if (status === "Planned") return "info";
  if (status === "Paused") return "warn";
  return "neutral";
}
