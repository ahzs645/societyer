import type { CostPeriod } from "../../../../shared/costPlanning";

export const moneyInput = (cents: number) => (cents / 100).toFixed(2);
export function planningCents(value: string, label: string, signed = false): number {
  if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value.trim())) throw new Error(`${label}: enter an amount with up to two decimal places.`);
  const clean = value.trim(), negative = clean.startsWith("-"), [whole, decimals = ""] = clean.replace(/^-/, "").split(".");
  const result = (Number(whole) * 100 + Number(decimals.padEnd(2, "0"))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the supported range.`);
  return result;
}
export function semesterDates(season: "winter" | "summer" | "fall", year: number) {
  const first = { winter: "01-01", summer: "05-01", fall: "09-01" }[season];
  const last = { winter: "04-30", summer: "08-31", fall: "12-31" }[season];
  return { name: `${season[0].toUpperCase()}${season.slice(1)} ${year}`, startDate: `${year}-${first}`, endDate: `${year}-${last}` };
}
export function nextSemester(period: CostPeriod): CostPeriod {
  const month = Number(period.endDate.slice(5, 7)), year = Number(period.endDate.slice(0, 4));
  const next = month < 5 ? semesterDates("summer", year) : month < 9 ? semesterDates("fall", year) : semesterDates("winter", year + 1);
  const { _id: _oldId, ...fields } = period;
  return { ...fields, ...next };
}
export const planningError = (cause: unknown) => cause instanceof Error ? cause.message : "The planning change could not be saved.";
export type Archived<T> = T & { _id: string; archivedAtISO?: string };
export type PlanningBudget = { _id: string; name?: string; title?: string; amountCents?: number; currency?: string };
export type PlanningActual = { _id: string; date: string; description?: string; amountCents: number; currency?: string | null; sourceCurrency?: string | null; spendCents?: number; excludedReason?: string };
export function periodFields(period: CostPeriod): Omit<CostPeriod, "_id"> {
  const { name, startDate, endDate, currency, allocationCents, openingBalanceCents, reserveCents, basis, includePlanned, spendBudgetId } = period;
  return { name, startDate, endDate, currency, allocationCents, openingBalanceCents, reserveCents, basis, includePlanned, ...(spendBudgetId ? { spendBudgetId } : {}) };
}
export function costFields(value: import("../../../../shared/costPlanning").PlanningCost) {
  const { name, category, currency, amountCents, cadence, startDate, anchorDate, endDate, status, sourceKind, sourceId, notes } = value;
  return { name, category, currency, amountCents, cadence, startDate, anchorDate, ...(endDate ? { endDate } : {}), status, sourceKind, ...(sourceId ? { sourceId } : {}), ...(notes ? { notes } : {}) };
}
