import { addDaysToDateOnly, parseDateOnly } from "./dateOnly";

export const PAYROLL_VACATION_SOURCES = [{ title: "B.C. annual vacation", url: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/time-off/vacation", reviewedOn: "2026-10-23" }, { title: "Employment Standards Act, section 57", url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/00_96113_01#section57", reviewedOn: "2026-10-23" }, { title: "B.C. section 57 interpretation and anniversary-year example", url: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-7-section-57", reviewedOn: "2026-10-23" }] as const;
export type PayrollVacationStatus = "requested" | "approved" | "taken" | "cancelled" | "rejected";
export type PayrollVacationPeriodFields = {
  serviceYear: number; provinceOfEmployment: "BC"; normalWeeklyMinutes: number; normalDailyMinutes: number;
  openingThroughDate: string; openingUsedMinutes: number; openingCarryoverMinutes: number; openingReviewed: boolean; openingEvidence: string;
  additionalEntitlementMinutes: number; policyEvidence?: string; notes?: string;
};
export type PayrollVacationDay = { date: string; minutes: number; payrollWorkDayId?: string };
export type PayrollVacationRequestFields = { label: string; days: PayrollVacationDay[]; employeeRequestedShortPeriod: boolean; advanceAgreementConfirmed: boolean; statutoryHolidaysExcluded: boolean; evidence: string; lateUseEvidence?: string; notes?: string };
export type PayrollVacationAudit = { atISO: string; actorUserId: string; action: string; reason?: string; previousVersion: number };
export type PayrollVacationPeriodRecord = PayrollVacationPeriodFields & { _id: string; societyId: string; employeeId: string; employmentStartDate: string; accrualStart: string; earnedOn: string; takeBy: string; statutoryWeeks: number; statutoryMinutes: number; version: number; createdAtISO: string; updatedAtISO: string; history: PayrollVacationAudit[]; balance?: PayrollVacationBalance };
export type PayrollVacationRequestRecord = PayrollVacationRequestFields & { _id: string; societyId: string; employeeId: string; periodId: string; startDate: string; endDate: string; minutes: number; status: PayrollVacationStatus; version: number; createdAtISO: string; updatedAtISO: string; history: PayrollVacationAudit[]; payrollPayoutCalculationId?: string; reversedPayrollPayoutCalculationIds?: string[] };
export type PayrollVacationBalance = {
  asOf: string; phase: "before_entitlement" | "available" | "overdue"; statutoryWeeks: number; statutoryMinutes: number;
  entitlementMinutes: number; earnedMinutes: number; carryoverMinutes: number; openingUsedMinutes: number;
  takenMinutes: number; approvedMinutes: number; requestedMinutes: number; remainingMinutes: number; uncommittedMinutes: number;
  remainingDays: number; remainingWeeks: number; earnedOn: string; takeBy: string; complete: true; warnings: string[];
};
export type PayrollVacationWorkspace = { page: Array<PayrollVacationPeriodRecord | PayrollVacationRequestRecord>; isDone: boolean; continueCursor: string; today: string; employee: { _id: string; name: string; startDate: string; endDate?: string }; period?: PayrollVacationPeriodRecord | null; balance?: PayrollVacationBalance | null; sources: typeof PAYROLL_VACATION_SOURCES };

export function vacationDate(value: unknown, label = "Vacation date"): string {
  if (typeof value !== "string" || !parseDateOnly(value)) throw new Error(`${label} must be an actual YYYY-MM-DD calendar date.`);
  return value;
}
function minutes(value: unknown, label: string, maximum = 1_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be whole, nonnegative minutes up to ${maximum.toLocaleString("en-CA")}.`);
  return value;
}
function text(value: unknown, label: string, required = false, maximum = 4000) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim().length > maximum || required && !value.trim()) throw new Error(`${label} ${required ? "is required and " : ""}must contain at most ${maximum.toLocaleString("en-CA")} characters.`);
  return value.trim();
}
function flag(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new Error(`Confirm ${label} explicitly.`); return value; }
function defined<T>(value: T): T { return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== undefined)) as T; }
function anniversary(start: string, years: number) {
  const year = Number(start.slice(0, 4)) + years, month = Number(start.slice(5, 7)), day = Number(start.slice(8));
  if (year > 2200) throw new Error("Vacation entitlement year is outside the supported calendar.");
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate())).padStart(2, "0")}`;
}
export function bcVacationTimeEntitlement(employmentStartDate: string, serviceYear: number, normalWeeklyMinutes: number) {
  vacationDate(employmentStartDate, "Employment start"); minutes(serviceYear, "Completed service years", 100); if (serviceYear < 1) throw new Error("Vacation time is earned after a completed service year; select service year one or later.");
  minutes(normalWeeklyMinutes, "Reviewed normal weekly minutes", 10080); if (!normalWeeklyMinutes) throw new Error("Record the reviewed normal weekly working time.");
  const statutoryWeeks = serviceYear >= 5 ? 3 : 2, earnedOn = anniversary(employmentStartDate, serviceYear);
  return { accrualStart: anniversary(employmentStartDate, serviceYear - 1), earnedOn, takeBy: addDaysToDateOnly(anniversary(employmentStartDate, serviceYear + 1), -1)!, statutoryWeeks, statutoryMinutes: statutoryWeeks * normalWeeklyMinutes };
}
export function cleanVacationPeriod(raw: PayrollVacationPeriodFields, employmentStartDate: string, today: string) {
  vacationDate(today, "Today"); const rule = bcVacationTimeEntitlement(employmentStartDate, raw.serviceYear, raw.normalWeeklyMinutes);
  if (raw.provinceOfEmployment !== "BC") throw new Error("This reviewed vacation time policy covers ordinary B.C. employment only.");
  const daily = minutes(raw.normalDailyMinutes, "Reviewed normal daily minutes", 1440); if (!daily || daily > raw.normalWeeklyMinutes) throw new Error("Normal daily time must be positive and no greater than normal weekly time.");
  const openingThroughDate = vacationDate(raw.openingThroughDate, "Opening coverage"), openingUsedMinutes = minutes(raw.openingUsedMinutes, "Opening used vacation"), openingCarryoverMinutes = minutes(raw.openingCarryoverMinutes, "Reviewed carryover vacation"), additionalEntitlementMinutes = minutes(raw.additionalEntitlementMinutes, "Additional contractual entitlement");
  if (openingThroughDate > today || openingThroughDate > rule.takeBy) throw new Error("Opening history must cover an actual past/current date no later than this entitlement's use-by date.");
  if (openingThroughDate < rule.accrualStart && openingUsedMinutes) throw new Error("Vacation used before this entitlement's earning year cannot be assigned to this period's opening.");
  if (!flag(raw.openingReviewed, "complete opening leave history")) throw new Error("Review actual prior vacation used, including an explicit zero opening, before saving this balance.");
  const policyEvidence = text(raw.policyEvidence, "Additional entitlement/carryover policy evidence", Boolean(additionalEntitlementMinutes || openingCarryoverMinutes));
  return { fields: defined({ serviceYear: raw.serviceYear, provinceOfEmployment: "BC", normalWeeklyMinutes: raw.normalWeeklyMinutes, normalDailyMinutes: daily, openingThroughDate, openingUsedMinutes, openingCarryoverMinutes, additionalEntitlementMinutes, openingReviewed: true, openingEvidence: text(raw.openingEvidence, "Opening history evidence", true)!, policyEvidence, notes: text(raw.notes, "Vacation period notes") } as PayrollVacationPeriodFields), rule };
}
export function cleanVacationRequest(raw: PayrollVacationRequestFields, period: PayrollVacationPeriodRecord) {
  if (!Array.isArray(raw.days) || !raw.days.length || raw.days.length > 366) throw new Error("Record one to 366 actual vacation dates with exact minutes.");
  const seen = new Set<string>(); const days = raw.days.map(day => {
    const date = vacationDate(day.date); if (seen.has(date)) throw new Error("Record each vacation date once within a request."); seen.add(date);
    const value = minutes(day.minutes, "Vacation on one date", 1440); if (!value) throw new Error("Vacation time must be positive on every recorded date.");
    if (date < period.accrualStart || date <= period.openingThroughDate) throw new Error("Leave must be after this period's reviewed opening coverage and within its earning year or later; opening history already includes earlier usage.");
    return defined({ date, minutes: value, payrollWorkDayId: text(day.payrollWorkDayId, "Linked work record", false, 1000) });
  }).sort((a, b) => a.date.localeCompare(b.date));
  const total = days.reduce((sum, day) => sum + day.minutes, 0), startDate = days[0].date, endDate = days.at(-1)!.date;
  const short = flag(raw.employeeRequestedShortPeriod, "employee request for vacation shorter than a week"), advance = flag(raw.advanceAgreementConfirmed, "approved advance-vacation agreement");
  if (!flag(raw.statutoryHolidaysExcluded, "exclusion of entitled statutory holidays")) throw new Error("Entitled statutory holidays must be excluded from annual vacation time. Review the actual holiday entitlement before recording these minutes.");
  // Derive the maximum normal rest gap from the reviewed daily/weekly basis,
  // without assuming Monday–Friday. Irregular schedules need the employee's
  // explicit request rather than treating scattered dates as one full week.
  const normalDays = period.normalWeeklyMinutes / period.normalDailyMinutes;
  if (!short && (!Number.isInteger(normalDays) || normalDays < 1 || normalDays > 7)) throw new Error("An irregular normal daily/weekly schedule requires the employee's explicit request for these exact vacation periods; a continuous normal week cannot be inferred.");
  const maximumRestGap = 8 - normalDays;
  const blocks: typeof days[] = [];
  for (const day of days) { const previous = blocks.at(-1)?.at(-1); if (!previous || Date.parse(`${day.date}T00:00Z`) - Date.parse(`${previous.date}T00:00Z`) > maximumRestGap * 86400000) blocks.push([]); blocks.at(-1)!.push(day); }
  if (!short && blocks.some(block => !block.some(start => block.filter(day => day.date >= start.date && day.date <= addDaysToDateOnly(start.date, 6)!).reduce((sum, day) => sum + day.minutes, 0) >= period.normalWeeklyMinutes))) throw new Error("Each annual vacation block must be at least one normal week unless the employee requests a shorter period. Separate scattered dates cannot be added together to waive that request.");
  if (startDate < period.earnedOn && !advance) throw new Error("Vacation before the employment anniversary requires an explicit approved advance-vacation agreement.");
  return { fields: defined({ label: text(raw.label, "Vacation request label", true, 200)!, days, employeeRequestedShortPeriod: short, advanceAgreementConfirmed: advance, statutoryHolidaysExcluded: true, evidence: text(raw.evidence, "Employee request/approval evidence", true)!, lateUseEvidence: text(raw.lateUseEvidence, "Late-use reconciliation evidence", endDate > period.takeBy), notes: text(raw.notes, "Vacation request notes") }), startDate, endDate, minutes: total };
}
export function vacationTimeBalance(period: PayrollVacationPeriodRecord, requests: readonly PayrollVacationRequestRecord[], asOf: string): PayrollVacationBalance {
  vacationDate(asOf); const active = requests.filter(request => request.periodId === period._id), total = (status: PayrollVacationStatus) => active.filter(request => request.status === status).reduce((sum, request) => sum + request.minutes, 0);
  const entitlementMinutes = period.statutoryMinutes + period.additionalEntitlementMinutes, takenMinutes = period.openingUsedMinutes + total("taken"), approvedMinutes = total("approved"), requestedMinutes = total("requested");
  const remainingMinutes = entitlementMinutes + period.openingCarryoverMinutes - takenMinutes, uncommittedMinutes = remainingMinutes - approvedMinutes, warnings = ["Vacation time is separate from vacation pay. Paying vacation on each cheque does not remove the requirement to take time off."];
  if (asOf < period.earnedOn) warnings.push("This entitlement is planned; the completed-service-year time entitlement has not yet been earned. Any earlier leave requires an explicit advance agreement.");
  if (asOf > period.takeBy && remainingMinutes > 0) warnings.push("Unused vacation is overdue. This balance remains visible; carryover does not waive B.C.'s requirement to take annual vacation within 12 months of earning it.");
  if (period.openingCarryoverMinutes) warnings.push("Carryover is a separately reviewed opening from untracked history. Its original deadline is not independently recorded here and must be reviewed in the source evidence; this period's use-by date does not create a new carryover deadline or automatically transfer another tracked balance.");
  if (remainingMinutes < 0 || uncommittedMinutes < 0) warnings.push("Recorded or approved vacation exceeds the reviewed entitlement. Reconcile the opening, policy or actual absence records.");
  if (active.some(request => !["cancelled", "rejected"].includes(request.status) && request.endDate > period.takeBy)) warnings.push("A late-use record has explicit evidence; it does not retrospectively satisfy the original statutory deadline.");
  return { asOf, phase: asOf < period.earnedOn ? "before_entitlement" : asOf > period.takeBy && remainingMinutes > 0 ? "overdue" : "available", statutoryWeeks: period.statutoryWeeks, statutoryMinutes: period.statutoryMinutes, entitlementMinutes, earnedMinutes: asOf >= period.earnedOn ? entitlementMinutes : 0, carryoverMinutes: period.openingCarryoverMinutes, openingUsedMinutes: period.openingUsedMinutes, takenMinutes, approvedMinutes, requestedMinutes, remainingMinutes, uncommittedMinutes, remainingDays: remainingMinutes / period.normalDailyMinutes, remainingWeeks: remainingMinutes / period.normalWeeklyMinutes, earnedOn: period.earnedOn, takeBy: period.takeBy, complete: true, warnings };
}
