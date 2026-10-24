export const COST_CADENCES = ["once", "weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"] as const;
export const PLANNING_STATUSES = ["committed", "planned", "paused"] as const;
export const COST_BASES = ["cash", "allocated"] as const;
export const COMPENSATION_TYPES = ["hourly", "monthly", "annual"] as const;
export const PAY_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
export type CostCadence = typeof COST_CADENCES[number];
export type PlanningStatus = typeof PLANNING_STATUSES[number];
export type CostBasis = typeof COST_BASES[number];
export type StaffCompensation = typeof COMPENSATION_TYPES[number];
export type PayFrequency = typeof PAY_FREQUENCIES[number];
export const COST_CADENCE_LABELS: Record<CostCadence, string> = { once: "Once", weekly: "Weekly", biweekly: "Every two weeks", monthly: "Monthly", quarterly: "Quarterly", semiannual: "Every six months", annual: "Annually" };
export const PLANNING_STATUS_LABELS: Record<PlanningStatus, string> = { committed: "Committed", planned: "Planned", paused: "Paused" };
export const COST_BASIS_LABELS: Record<CostBasis, string> = { cash: "Cash due in period", allocated: "Cost allocated to period" };
export const COST_BASE_LABELS = COST_BASIS_LABELS;
export const COMPENSATION_LABELS: Record<StaffCompensation, string> = { hourly: "Hourly", monthly: "Monthly salary", annual: "Annual salary" };
export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = { weekly: "Weekly", biweekly: "Every two weeks", semimonthly: "15th and month end", monthly: "Monthly" };
export type CostPeriod = { _id?: string; name: string; startDate: string; endDate: string; currency: string; allocationCents: number; openingBalanceCents: number; reserveCents: number; basis: CostBasis; includePlanned: boolean; spendBudgetId?: string };
export type PlanningCost = { _id?: string; name: string; category: string; currency: string; amountCents: number; cadence: CostCadence; startDate: string; anchorDate: string; endDate?: string; status: PlanningStatus; sourceKind: "manual" | "insurance" | "subscription"; sourceId?: string; notes?: string };
export type StaffCostPlan = { _id?: string; name: string; employeeId?: string; currency: string; startDate: string; endDate?: string; status: PlanningStatus; compensation: StaffCompensation; rateCents: number; hoursPerWeek?: number; payFrequency: PayFrequency; payAnchorDate: string; vacationPercent?: number; employerPercent?: number; monthlyBenefitsCents?: number; assumptionsConfirmed: boolean; notes?: string };
export type CostCashOccurrence = { id: string; itemId: string; kind: "cost" | "staff"; name: string; category: string; date: string; amountCents: number; periodStart: string; periodEnd: string };
export type CostProjectionItem = { id: string; name: string; kind: "cost" | "staff"; category: string; status: PlanningStatus; currency: string; cashCents: number; allocatedCents: number; selectedCents: number; occurrences: CostCashOccurrence[]; included: boolean; excludedReason?: "foreign_currency" | "paused" | "planned" | "missing_assumptions" };
export type CostProjectionMonth = { month: string; label: string; costCashCents: number; costAllocatedCents: number; staffCashCents: number; staffAllocatedCents: number; cashCents: number; allocatedCents: number; selectedCents: number };
export type CostProjectionCategory = { category: string; cashCents: number; allocatedCents: number; selectedCents: number };
export type CostPeriodProjection = { period: CostPeriod; costCashCents: number; costAllocatedCents: number; staffCashCents: number; staffAllocatedCents: number; cashCents: number; allocatedCents: number; selectedCents: number; availableFundingCents: number; remainingAfterReserveCents: number; months: CostProjectionMonth[]; categories: CostProjectionCategory[]; items: CostProjectionItem[]; cashOccurrences: CostCashOccurrence[]; warnings: string[]; excludedCounts: { foreignCurrency: number; paused: number; planned: number; missingAssumptions: number } };
export type CostPlanningProjection = CostPeriodProjection;

const DAY = 86400000, MAX_ITEMS = 5000, MAX_EXPANSION = 100000;
const MIN_DAY = Math.floor(Date.parse("0000-01-01T00:00:00Z") / DAY), MAX_DAY = Math.floor(Date.parse("9999-12-31T00:00:00Z") / DAY);
function parts(day: number) { const date = new Date(day * DAY); return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate() }; }
function calendarDay(year: number, month: number, date: number) { const value = new Date(0); value.setUTCFullYear(year, month, date); value.setUTCHours(0, 0, 0, 0); return Math.floor(value.getTime() / DAY); }
function iso(day: number) { return new Date(Math.max(MIN_DAY, Math.min(MAX_DAY, day)) * DAY).toISOString().slice(0, 10); }
function monthDays(year: number, month: number) { return parts(calendarDay(year, month + 1, 0)).date; }
function monthStart(day: number) { const p = parts(day); return calendarDay(p.year, p.month, 1); }
function monthEnd(day: number) { const p = parts(day); return calendarDay(p.year, p.month + 1, 0); }
function addMonths(anchor: number, count: number) { const p = parts(anchor), total = p.year * 12 + p.month + count, year = Math.floor(total / 12), month = total - year * 12; return calendarDay(year, month, Math.min(p.date, monthDays(year, month))); }
function dateDay(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  const day = Date.parse(`${value}T00:00:00Z`) / DAY;
  if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY || iso(day) !== value) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return day;
}
function object(raw: unknown) { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Enter valid planning fields."); return raw as Record<string, unknown>; }
function text(value: unknown, label: string, max = 200) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must contain 1–${max} characters.`); return value.trim(); }
function optionalText(value: unknown, label: string, max = 4000) { if (value == null || value === "") return undefined; return text(value, label, max); }
function currency(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) throw new Error("Choose a three-letter currency."); return value.trim().toUpperCase(); }
function cents(value: unknown, label: string, signed = false) { if (typeof value !== "number" || !Number.isSafeInteger(value) || (!signed && value < 0)) throw new Error(`${label} must be safe integer cents${signed ? "" : " at or above zero"}.`); return value; }
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`Choose a supported ${label}.`); return value as T; }
function bool(value: unknown, label: string) { if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`); return value; }
function optionalNumber(value: unknown, label: string, max: number) { if (value == null) return undefined; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label} must be between 0 and ${max}.`); return value; }
function optionalDate(value: unknown, label: string) { if (value == null || value === "") return undefined; dateDay(value, label); return value as string; }
function idFields(row: Record<string, unknown>) { const id = optionalText(row._id, "Record ID", 1000); return id ? { _id: id } : {}; }
function defined<T extends Record<string, unknown>>(row: T): T { return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T; }

export function validateCostPeriod(raw: unknown): CostPeriod {
  const row = object(raw), startDate = text(row.startDate, "Period start"), endDate = text(row.endDate, "Period end"), start = dateDay(startDate, "Period start"), end = dateDay(endDate, "Period end");
  if (end < start) throw new Error("The period end must be on or after its start.");
  if (end >= addMonths(start, 24)) throw new Error("Planning periods may cover at most two calendar years, with an inclusive end date.");
  return defined({ ...idFields(row), name: text(row.name, "Period name"), startDate, endDate, currency: currency(row.currency), allocationCents: cents(row.allocationCents, "Allocation"), openingBalanceCents: cents(row.openingBalanceCents, "Opening balance", true), reserveCents: cents(row.reserveCents, "Reserve"), basis: choice(row.basis, COST_BASES, "cost basis"), includePlanned: bool(row.includePlanned, "Include planned costs"), spendBudgetId: optionalText(row.spendBudgetId, "Spend budget", 1000) });
}
export function validatePlanningCost(raw: unknown): PlanningCost {
  const row = object(raw), startDate = text(row.startDate, "Cost start"), anchorDate = text(row.anchorDate, "First payment date"), start = dateDay(startDate, "Cost start"), anchor = dateDay(anchorDate, "First payment date"), endDate = optionalDate(row.endDate, "Cost end");
  if (anchor < start) throw new Error("The first payment date must be on or after the cost start date.");
  if (endDate && dateDay(endDate, "Cost end") < start) throw new Error("The cost end must be on or after its start.");
  return defined({ ...idFields(row), name: text(row.name, "Cost name"), category: text(row.category, "Category", 100), currency: currency(row.currency), amountCents: cents(row.amountCents, "Cost amount"), cadence: choice(row.cadence, COST_CADENCES, "cost frequency"), startDate, anchorDate, endDate, status: choice(row.status, PLANNING_STATUSES, "planning status"), sourceKind: choice(row.sourceKind, ["manual", "insurance", "subscription"] as const, "cost source"), sourceId: optionalText(row.sourceId, "Source ID", 1000), notes: optionalText(row.notes, "Notes") });
}
export function validateStaffCostPlan(raw: unknown): StaffCostPlan {
  const row = object(raw), startDate = text(row.startDate, "Staff start"), start = dateDay(startDate, "Staff start"), endDate = optionalDate(row.endDate, "Staff end"), payAnchorDate = text(row.payAnchorDate, "First pay date"), anchor = dateDay(payAnchorDate, "First pay date"), payFrequency = choice(row.payFrequency, PAY_FREQUENCIES, "pay frequency");
  if (endDate && dateDay(endDate, "Staff end") < start) throw new Error("The staff end must be on or after its start.");
  if (payFrequency === "semimonthly" && parts(anchor).date !== 15 && anchor !== monthEnd(anchor)) throw new Error("Semimonthly pay dates must fall on the 15th or the last day of a month.");
  return defined({ ...idFields(row), name: text(row.name, "Staff plan name"), employeeId: optionalText(row.employeeId, "Employee ID", 1000), currency: currency(row.currency), startDate, endDate, status: choice(row.status, PLANNING_STATUSES, "planning status"), compensation: choice(row.compensation, COMPENSATION_TYPES, "compensation type"), rateCents: cents(row.rateCents, "Compensation rate"), hoursPerWeek: optionalNumber(row.hoursPerWeek, "Hours per week", 168), payFrequency, payAnchorDate, vacationPercent: optionalNumber(row.vacationPercent, "Vacation percent", 100), employerPercent: optionalNumber(row.employerPercent, "Employer contribution percent", 1000), monthlyBenefitsCents: row.monthlyBenefitsCents == null ? undefined : cents(row.monthlyBenefitsCents, "Monthly benefits"), assumptionsConfirmed: bool(row.assumptionsConfirmed, "Confirmed assumptions"), notes: optionalText(row.notes, "Notes") });
}
export const cleanCostPeriod = validateCostPeriod, cleanPlanningCost = validatePlanningCost, cleanStaffCostPlan = validateStaffCostPlan;

export function defaultCostPeriod(today: string, chosenCurrency = "CAD"): CostPeriod { const day = dateDay(today, "Today"), p = parts(day), firstMonth = Math.floor(p.month / 4) * 4, term = ["Winter", "Summer", "Fall"][firstMonth / 4]; return { name: `${term} ${p.year}`, startDate: iso(calendarDay(p.year, firstMonth, 1)), endDate: iso(calendarDay(p.year, firstMonth + 4, 0)), currency: currency(chosenCurrency), allocationCents: 0, openingBalanceCents: 0, reserveCents: 0, basis: "cash", includePlanned: true }; }
export function defaultPlanningCost(today: string, chosenCurrency = "CAD"): PlanningCost { dateDay(today, "Today"); return { name: "", category: "Other", currency: currency(chosenCurrency), amountCents: 0, cadence: "monthly", startDate: today, anchorDate: today, status: "planned", sourceKind: "manual" }; }
export function defaultStaffCostPlan(today: string, chosenCurrency = "CAD"): StaffCostPlan { const day = dateDay(today, "Today"); return { name: "", currency: currency(chosenCurrency), startDate: today, status: "planned", compensation: "hourly", rateCents: 0, payFrequency: "monthly", payAnchorDate: iso(monthEnd(day)), assumptionsConfirmed: false }; }

type Fraction = { n: bigint; d: bigint };
const ZERO: Fraction = { n: 0n, d: 1n };
function gcd(a: bigint, b: bigint): bigint { while (b) { const r = a % b; a = b; b = r; } return a < 0n ? -a : a; }
function fraction(n: bigint | number, d: bigint | number = 1): Fraction { let numerator = BigInt(n), denominator = BigInt(d); if (!denominator) throw new Error("A planning allocation has no coverage days."); if (denominator < 0n) { numerator = -numerator; denominator = -denominator; } const divisor = gcd(numerator, denominator); return { n: numerator / divisor, d: denominator / divisor }; }
function add(a: Fraction, b: Fraction): Fraction { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a: Fraction, b: Fraction): Fraction { return fraction(a.n * b.n, a.d * b.d); }
function decimal(value: number): Fraction { const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value)); if (!match) throw new Error("Enter finite non-negative planning assumptions."); const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0), digits = BigInt(match[1] + (match[2] ?? "")); return exponent >= 0 ? fraction(digits * 10n ** BigInt(exponent)) : fraction(digits, 10n ** BigInt(-exponent)); }
function safe(value: bigint, label = "Planning total") { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error(`${label} exceeds the supported safe integer cents range.`); return number; }
function roundedBig(value: Fraction) { const negative = value.n < 0n, n = negative ? -value.n : value.n; return (negative ? -1n : 1n) * ((n * 2n + value.d) / (value.d * 2n)); }
function rounded(value: Fraction) { return safe(roundedBig(value)); }
function roundedDifference(to: Fraction, from: Fraction) { return safe(roundedBig(to) - roundedBig(from)); }
function sum(values: number[]) { return safe(values.reduce((total, value) => total + BigInt(value), 0n)); }
function subtract(a: number, b: number) { return safe(BigInt(a) - BigInt(b)); }
function monthDistance(a: number, b: number) { const x = parts(a), y = parts(b); return (x.year - y.year) * 12 + x.month - y.month; }
function weekdayCount(start: number, end: number) { if (end < start) return 0; const count = end - start + 1, weeks = Math.floor(count / 7); let weekdays = weeks * 5; for (let offset = 0; offset < count % 7; offset++) { const weekday = new Date((start + weeks * 7 + offset) * DAY).getUTCDay(); if (weekday !== 0 && weekday !== 6) weekdays++; } return weekdays; }
function monthlyAmount(rate: number, start: number, end: number): Fraction {
  if (end < start || !rate) return ZERO;
  const a = parts(start), b = parts(end), distance = monthDistance(end, start);
  if (!distance) return fraction(BigInt(rate) * BigInt(end - start + 1), monthDays(a.year, a.month));
  return add(add(fraction(BigInt(rate) * BigInt(monthEnd(start) - start + 1), monthDays(a.year, a.month)), fraction(BigInt(rate) * BigInt(end - monthStart(end) + 1), monthDays(b.year, b.month))), fraction(BigInt(rate) * BigInt(distance - 1)));
}
function annualAmount(rate: number, start: number, end: number): Fraction {
  if (end < start || !rate) return ZERO;
  const a = parts(start), b = parts(end), first = calendarDay(a.year, 0, 1), firstEnd = calendarDay(a.year + 1, 0, 1) - 1;
  if (a.year === b.year) return fraction(BigInt(rate) * BigInt(end - start + 1), firstEnd - first + 1);
  const last = calendarDay(b.year, 0, 1), lastEnd = calendarDay(b.year + 1, 0, 1) - 1;
  return add(add(fraction(BigInt(rate) * BigInt(firstEnd - start + 1), firstEnd - first + 1), fraction(BigInt(rate) * BigInt(end - last + 1), lastEnd - last + 1)), fraction(BigInt(rate) * BigInt(b.year - a.year - 1)));
}
function staffEarnedThrough(plan: StaffCostPlan, day: number): Fraction {
  const start = dateDay(plan.startDate, "Staff start"), end = Math.min(day, plan.endDate ? dateDay(plan.endDate, "Staff end") : MAX_DAY);
  if (end < start) return ZERO;
  const gross = plan.compensation === "hourly" ? multiply(fraction(BigInt(plan.rateCents) * BigInt(weekdayCount(start, end)), 5), decimal(plan.hoursPerWeek ?? 0)) : plan.compensation === "monthly" ? monthlyAmount(plan.rateCents, start, end) : annualAmount(plan.rateCents, start, end);
  const vacationFactor = add(fraction(1), multiply(decimal(plan.vacationPercent ?? 0), fraction(1, 100)));
  const employerFactor = add(fraction(1), multiply(decimal(plan.employerPercent ?? 0), fraction(1, 100)));
  return add(multiply(multiply(gross, vacationFactor), employerFactor), monthlyAmount(plan.monthlyBenefitsCents ?? 0, start, end));
}
function cadenceStep(cadence: CostCadence) { return ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as Partial<Record<CostCadence, number>>)[cadence]; }
function costDate(plan: PlanningCost, index: number) { const anchor = dateDay(plan.anchorDate, "First payment date"); return plan.cadence === "weekly" || plan.cadence === "biweekly" ? anchor + index * (plan.cadence === "weekly" ? 7 : 14) : addMonths(anchor, index * (cadenceStep(plan.cadence) ?? 0)); }
function firstCostIndex(plan: PlanningCost, start: number) { const anchor = dateDay(plan.anchorDate, "First payment date"); return Math.max(0, (plan.cadence === "weekly" || plan.cadence === "biweekly" ? Math.floor((start - anchor) / (plan.cadence === "weekly" ? 7 : 14)) : Math.floor(monthDistance(start, anchor) / (cadenceStep(plan.cadence) ?? 1))) - 1); }
function payDate(plan: StaffCostPlan, index: number) {
  const anchor = dateDay(plan.payAnchorDate, "First pay date");
  if (plan.payFrequency === "weekly" || plan.payFrequency === "biweekly") return anchor + index * (plan.payFrequency === "weekly" ? 7 : 14);
  if (plan.payFrequency === "monthly") return addMonths(anchor, index);
  const p = parts(anchor), slot = p.year * 24 + p.month * 2 + (p.date === 15 ? 0 : 1) + index, month = Math.floor(slot / 2), year = Math.floor(month / 12), monthIndex = month - year * 12;
  return slot % 2 === 0 ? calendarDay(year, monthIndex, 15) : calendarDay(year, monthIndex + 1, 0);
}
function firstPayIndex(plan: StaffCostPlan, start: number) { const anchor = dateDay(plan.payAnchorDate, "First pay date"); if (plan.payFrequency === "weekly" || plan.payFrequency === "biweekly") return Math.max(0, Math.floor((start - anchor) / (plan.payFrequency === "weekly" ? 7 : 14)) - 1); return Math.max(0, monthDistance(start, anchor) * (plan.payFrequency === "semimonthly" ? 2 : 1) - 2); }

/** Calendar forecasts. Prefix rounding assigns each earned/covered cent once, conserving totals across period boundaries. */
export function projectCostPeriod(rawPeriod: CostPeriod, rawCosts: PlanningCost[], rawStaff: StaffCostPlan[]): CostPeriodProjection {
  const period = validateCostPeriod(rawPeriod);
  if (!Array.isArray(rawCosts) || !Array.isArray(rawStaff) || rawCosts.length + rawStaff.length > MAX_ITEMS) throw new Error(`A projection supports at most ${MAX_ITEMS.toLocaleString("en-CA")} reusable cost and staff plans.`);
  const costs = rawCosts.map(validatePlanningCost), staff = rawStaff.map(validateStaffCostPlan), start = dateDay(period.startDate, "Period start"), end = dateDay(period.endDate, "Period end");
  const months: CostProjectionMonth[] = [], ranges: Array<{ start: number; end: number }> = [];
  for (let day = monthStart(start); day <= end; day = addMonths(day, 1)) { const month = iso(day).slice(0, 7); months.push({ month, label: new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(day * DAY)), costCashCents: 0, costAllocatedCents: 0, staffCashCents: 0, staffAllocatedCents: 0, cashCents: 0, allocatedCents: 0, selectedCents: 0 }); ranges.push({ start: Math.max(start, day), end: Math.min(end, monthEnd(day)) }); }
  const warnings: string[] = [], items: CostProjectionItem[] = [], cashOccurrences: CostCashOccurrence[] = [], excludedCounts = { foreignCurrency: 0, paused: 0, planned: 0, missingAssumptions: 0 }, seen = new Set<string>();
  let expanded = 0;
  const countExpansion = () => { if (++expanded > MAX_EXPANSION) throw new Error("This projection exceeds 100,000 schedule occurrences. Shorten the period or reduce the included plans."); };
  const addOccurrence = (item: CostProjectionItem, day: number, amountCents: number, coverageStart: number, coverageEnd: number) => { if (!amountCents) return; countExpansion(); const date = iso(day), occurrence: CostCashOccurrence = { id: `${item.kind}:${item.id}:${date}`, itemId: item.id, kind: item.kind, name: item.name, category: item.category, date, amountCents, periodStart: iso(coverageStart), periodEnd: iso(coverageEnd) }; item.occurrences.push(occurrence); cashOccurrences.push(occurrence); const month = months.find((row) => row.month === date.slice(0, 7))!; const key = item.kind === "cost" ? "costCashCents" : "staffCashCents"; month[key] = sum([month[key], amountCents]); };
  const makeItem = (plan: PlanningCost | StaffCostPlan, index: number, kind: "cost" | "staff"): CostProjectionItem => { const id = plan._id ?? `${kind}:${index}`; if (seen.has(`${kind}:${id}`)) throw new Error("A planning record appears more than once in this projection."); seen.add(`${kind}:${id}`); const item: CostProjectionItem = { id, name: plan.name, kind, category: "category" in plan ? plan.category : "Staff", status: plan.status, currency: plan.currency, cashCents: 0, allocatedCents: 0, selectedCents: 0, occurrences: [], included: true }; if (plan.currency !== period.currency) { excludedCounts.foreignCurrency++; item.excludedReason = "foreign_currency"; } else if (plan.status === "paused") { excludedCounts.paused++; item.excludedReason = "paused"; } else if (plan.status === "planned" && !period.includePlanned) { excludedCounts.planned++; item.excludedReason = "planned"; } if (item.excludedReason) item.included = false; items.push(item); return item; };
  for (const [index, plan] of costs.entries()) {
    const item = makeItem(plan, index, "cost"); if (!item.included) continue;
    const activeStart = dateDay(plan.startDate, "Cost start"), activeEnd = plan.endDate ? dateDay(plan.endDate, "Cost end") : MAX_DAY, anchor = dateDay(plan.anchorDate, "First payment date");
    if (anchor > activeEnd) { warnings.push(`${plan.name} ends before its first payment date and contributes no scheduled cost.`); continue; }
    if (plan.cadence === "once") { if (anchor >= start && anchor <= end) { addOccurrence(item, anchor, plan.amountCents, anchor, anchor); const month = months.find((row) => row.month === plan.anchorDate.slice(0, 7))!; month.costAllocatedCents = sum([month.costAllocatedCents, plan.amountCents]); item.allocatedCents = plan.amountCents; } }
    else {
      if (anchor > activeStart) warnings.push(`${plan.name}: first-cycle coverage starts ${plan.startDate}, before its first payment on ${plan.anchorDate}; the next payment ends that first coverage cycle.`);
      for (let cycle = firstCostIndex(plan, start); ; cycle++) {
        countExpansion(); const due = costDate(plan, cycle), next = costDate(plan, cycle + 1), coverageStart = cycle === 0 ? activeStart : due;
        if (coverageStart > end || due > activeEnd) break;
        const coverageEnd = Math.min(next - 1, activeEnd), denominator = next - coverageStart;
        if (denominator <= 0) throw new Error("A recurring cost has an invalid coverage cycle.");
        if (due >= start && due <= end) addOccurrence(item, due, plan.amountCents, coverageStart, coverageEnd);
        for (const [monthIndex, range] of ranges.entries()) { const from = Math.max(range.start, coverageStart), to = Math.min(range.end, coverageEnd); if (to < from) continue; const amount = subtract(rounded(fraction(BigInt(plan.amountCents) * BigInt(to - coverageStart + 1), denominator)), rounded(fraction(BigInt(plan.amountCents) * BigInt(from - coverageStart), denominator))); months[monthIndex].costAllocatedCents = sum([months[monthIndex].costAllocatedCents, amount]); item.allocatedCents = sum([item.allocatedCents, amount]); }
      }
    }
    item.cashCents = sum(item.occurrences.map((row) => row.amountCents)); item.selectedCents = period.basis === "cash" ? item.cashCents : item.allocatedCents;
  }
  for (const [index, plan] of staff.entries()) {
    const item = makeItem(plan, index, "staff"); if (!item.included) continue;
    if (plan.compensation === "hourly" && plan.hoursPerWeek == null) { item.included = false; item.excludedReason = "missing_assumptions"; excludedCounts.missingAssumptions++; warnings.push(`${plan.name}: enter hours per week before this hourly staff cost can be estimated. Its cost is excluded.`); continue; }
    if (!plan.assumptionsConfirmed) warnings.push(`${plan.name}: employer-cost assumptions have not been confirmed.`);
    const missing = [plan.vacationPercent == null && "vacation percent", plan.employerPercent == null && "employer contribution percent", plan.monthlyBenefitsCents == null && "monthly benefits"].filter(Boolean);
    if (missing.length) warnings.push(`${plan.name}: ${missing.join(", ")} not entered; this estimate assumes zero for those inputs.`);
    if (dateDay(plan.startDate, "Staff start") < payDate(plan, -1) + 1) warnings.push(`${plan.name}: the first planned pay on ${plan.payAnchorDate} includes catch-up earnings from ${plan.startDate}. Check the forecast coverage start and first covered payroll period; earlier actual payroll is not subtracted.`);
    for (const [monthIndex, range] of ranges.entries()) { const amount = roundedDifference(staffEarnedThrough(plan, range.end), staffEarnedThrough(plan, range.start - 1)); months[monthIndex].staffAllocatedCents = sum([months[monthIndex].staffAllocatedCents, amount]); item.allocatedCents = sum([item.allocatedCents, amount]); }
    const activeStart = dateDay(plan.startDate, "Staff start"), activeEnd = plan.endDate ? dateDay(plan.endDate, "Staff end") : MAX_DAY;
    for (let pay = firstPayIndex(plan, start); ; pay++) { countExpansion(); const due = payDate(plan, pay); if (due > end) break; if (due < start) continue; const previous = pay === 0 ? activeStart - 1 : payDate(plan, pay - 1), from = Math.max(activeStart, previous + 1), to = Math.min(activeEnd, due); if (to < from) continue; const amount = roundedDifference(staffEarnedThrough(plan, to), staffEarnedThrough(plan, from - 1)); addOccurrence(item, due, amount, from, to); }
    item.cashCents = sum(item.occurrences.map((row) => row.amountCents)); item.selectedCents = period.basis === "cash" ? item.cashCents : item.allocatedCents;
  }
  const costCashCents = sum(items.filter((row) => row.kind === "cost").map((row) => row.cashCents)), costAllocatedCents = sum(items.filter((row) => row.kind === "cost").map((row) => row.allocatedCents)), staffCashCents = sum(items.filter((row) => row.kind === "staff").map((row) => row.cashCents)), staffAllocatedCents = sum(items.filter((row) => row.kind === "staff").map((row) => row.allocatedCents));
  const cashCents = sum([costCashCents, staffCashCents]), allocatedCents = sum([costAllocatedCents, staffAllocatedCents]), selectedCents = period.basis === "cash" ? cashCents : allocatedCents, availableFundingCents = sum([period.allocationCents, period.openingBalanceCents]), remainingAfterReserveCents = subtract(subtract(availableFundingCents, selectedCents), period.reserveCents);
  for (const month of months) { month.cashCents = sum([month.costCashCents, month.staffCashCents]); month.allocatedCents = sum([month.costAllocatedCents, month.staffAllocatedCents]); month.selectedCents = period.basis === "cash" ? month.cashCents : month.allocatedCents; }
  const categoryMap = new Map<string, CostProjectionCategory>();
  for (const item of items.filter((row) => row.included)) { const category = categoryMap.get(item.category) ?? { category: item.category, cashCents: 0, allocatedCents: 0, selectedCents: 0 }; category.cashCents = sum([category.cashCents, item.cashCents]); category.allocatedCents = sum([category.allocatedCents, item.allocatedCents]); category.selectedCents = sum([category.selectedCents, item.selectedCents]); categoryMap.set(item.category, category); }
  if (excludedCounts.foreignCurrency) warnings.unshift(`${excludedCounts.foreignCurrency} foreign-currency plan(s) excluded. Only ${period.currency} amounts are included; no currency conversion is applied.`);
  warnings.push("Staff costs are estimates from entered assumptions, not statutory withholding calculations or actual pay runs.", "Payment amounts include any nonrecoverable tax entered in the cost amount.");
  cashOccurrences.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { period, costCashCents, costAllocatedCents, staffCashCents, staffAllocatedCents, cashCents, allocatedCents, selectedCents, availableFundingCents, remainingAfterReserveCents, months, categories: [...categoryMap.values()].sort((a, b) => a.category.localeCompare(b.category)), items, cashOccurrences, warnings, excludedCounts };
}
