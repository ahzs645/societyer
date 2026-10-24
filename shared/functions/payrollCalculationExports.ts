import type { PortableQueryCtx } from "../portable/ctx";
import type { PayrollT4AnnualRecord } from "../payrollReporting";
import { getOwned } from "./access";
import { payrollBounded, payrollOrganization, payrollRead, type PayrollRow } from "./payrollCalculationData";
import { payrollYear } from "../payrollCalculationValidation";

type AnnualRecord = PayrollT4AnnualRecord & { sourceCount: number; complete: boolean };
type RoeSource = { employeeId: string; employeeName: string; payFrequency: string; periods: Array<{ periodStart: string; periodEnd: string; payDate: string; insurableEarningsCents: number; insurableHours: number }>; complete: boolean };
type PageCursor = { version: 1; scope: string; phase: "recorded_runs" | "openings"; cursor: string | null };
const annualAmounts = ["employmentIncomeCents", "cppEmployeeCents", "cpp2EmployeeCents", "eiEmployeeCents", "incomeTaxCents", "pensionableEarningsCents", "insurableEarningsCents"] as const;
function integer(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} is missing actual integer cents.`); return value; }
function add(...values: number[]) { const total = values.reduce((sum, value) => sum + BigInt(integer(value, "Payroll amount")), 0n); return integer(Number(total), "Payroll total"); }
function parseCursor(raw: string | null | undefined, scope: string): PageCursor {
  if (!raw) return { version: 1, scope, phase: "recorded_runs", cursor: null };
  let cursor: Partial<PageCursor>; try { cursor = JSON.parse(raw); } catch { throw new Error("Invalid payroll filing page. Restart from the first page."); }
  if (cursor?.version !== 1 || cursor.scope !== scope || !["recorded_runs", "openings"].includes(String(cursor.phase)) || (cursor.cursor !== null && typeof cursor.cursor !== "string")) throw new Error("This payroll filing page belongs to another organization or earnings year.");
  return cursor as PageCursor;
}

/** Filing projections contain no SIN, employee contact data or full RP account.
 * Each call uses one native paginate; clients retain every reactive page before
 * combining annual bases. In particular, CPP/EI annual caps apply AFTER that
 * combination, never to individual source pages. */
export async function exportContextPortable(ctx: PortableQueryCtx, args: { societyId: string; year: number; cursor?: string | null }) {
  await payrollRead(ctx, args.societyId);
  const year = payrollYear(args.year), scope = JSON.stringify([args.societyId, year]);
  const cursor = parseCursor(args.cursor, scope);
  const { organization } = await payrollOrganization(ctx, args.societyId);
  const [settings, employers] = await Promise.all([
    payrollBounded(ctx.db.query<PayrollRow>("payrollSettings").withIndex("by_society", q => q.eq("societyId", args.societyId)), 1, "Payroll settings"),
    payrollBounded(ctx.db.query<PayrollRow>("payrollEmployerProfiles").withIndex("by_society_year", q => q.eq("societyId", args.societyId).eq("year", year)), 1, "Employer year settings"),
  ]);
  const page = cursor.phase === "recorded_runs"
    ? await ctx.db.query<PayrollRow>("payRuns").withIndex("by_society_pay_date", q => q.eq("societyId", args.societyId).gte("payDate", `${year}-01-01`).lte("payDate", `${year}-12-31`)).order("asc").paginate({ numItems: 1, cursor: cursor.cursor, maximumBytesRead: 1_500_000 })
    : await ctx.db.query<PayrollRow>("payrollOpeningBalances").withIndex("by_society_year", q => q.eq("societyId", args.societyId).eq("year", year)).order("asc").paginate({ numItems: 25, cursor: cursor.cursor, maximumBytesRead: 1_500_000 });
  const warnings = new Set<string>(), blockers = new Set<string>();
  const annual = new Map<string, AnnualRecord>(), roe = new Map<string, RoeSource>();
  const employerContributions = { cppCents: 0, cpp2Cents: 0, eiCents: 0 };
  const openings = new Map<string, PayrollRow | null>(), employees = new Map<string, PayrollRow>(), representedRuns = new Map<string, PayrollRow>();
  let sourceCount = 0;
  const ownedEmployee = async (id: string) => { let employee = employees.get(id); if (!employee) { employee = await getOwned<PayrollRow>(ctx, "employees", id, args.societyId); employees.set(id, employee); } return employee; };
  const openingFor = async (employeeId: string) => {
    if (!openings.has(employeeId)) {
      const rows = await payrollBounded(ctx.db.query<PayrollRow>("payrollOpeningBalances").withIndex("by_society_employee_year", q => q.eq("societyId", args.societyId).eq("employeeId", employeeId).eq("year", year)), 1, "Employee opening balance");
      openings.set(employeeId, rows[0] ?? null);
    }
    return openings.get(employeeId)!;
  };
  const addAnnual = (record: AnnualRecord) => {
    const key = JSON.stringify([record.employeeId, record.provinceOfEmployment]), previous = annual.get(key);
    if (!previous) { annual.set(key, record); return; }
    for (const field of annualAmounts) previous[field] = add(previous[field], record[field]);
    if (record.unionDuesCents !== undefined) previous.unionDuesCents = add(previous.unionDuesCents ?? 0, record.unionDuesCents);
    previous.rppClassificationRequired ||= record.rppClassificationRequired;
    previous.complete &&= record.complete; previous.sourceCount += record.sourceCount;
  };
  const roeFor = (id: string, name: string) => { let source = roe.get(id); if (!source) { source = { employeeId: id, employeeName: name, payFrequency: String(employers[0]?.payFrequency ?? "unknown"), periods: [], complete: true }; roe.set(id, source); } return source; };
  const recordEmployer = (cpp: unknown, cpp2: unknown, ei: unknown, label: string) => {
    try { employerContributions.cppCents = add(employerContributions.cppCents, integer(cpp, `${label} employer CPP`)); employerContributions.cpp2Cents = add(employerContributions.cpp2Cents, integer(cpp2, `${label} employer CPP2`)); employerContributions.eiCents = add(employerContributions.eiCents, integer(ei, `${label} employer EI`)); }
    catch (error) { blockers.add(error instanceof Error ? error.message : `Review ${label} employer contributions.`); }
  };
  if (cursor.phase === "recorded_runs") for (const run of page.page) {
    sourceCount++;
    if (!Array.isArray(run.lines) || !run.lines.length) { blockers.add(`Recorded run ${run._id} has no employee allocations. Allocate its actual amounts before filing.`); continue; }
    // Public register writes already bound this to 5,000; retain an explicit
    // completeness failure for malformed/imported records rather than truncate.
    if (run.lines.length > 5000) throw new Error("A recorded run exceeds the complete 5,000-line filing bound. Reconcile its source records before export.");
    if (Array.isArray(run.sourceMissingFields) && run.sourceMissingFields.length && !run.missingValuesConfirmed) blockers.add(`Recorded run ${run._id} has unreviewed missing provider fields.`);
    for (const [index, line] of run.lines.entries()) {
      const label = `Recorded run ${run._id}, employee line ${index + 1}`;
      if (!line?.employeeId) { blockers.add(`${label} needs an owned employee link; provider IDs and names alone cannot identify a filing recipient.`); continue; }
      const employee = await ownedEmployee(line.employeeId), opening = await openingFor(line.employeeId);
      const represented = Boolean(opening?.representedPayRunIds?.includes(run._id));
      if (represented && opening) {
        if (!opening.sameEmployerConfirmed || opening.legalEmployerId !== args.societyId || run.payDate > opening.coveredThroughDate) blockers.add(`${label} has an inconsistent opening-balance representation.`);
      }
      const name = String(line.employeeName || `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || line.employeeId);
      const roeSource = roeFor(line.employeeId, name);
      try {
        const insurable = integer(line.classifiedBases?.insurableCents, `${label} insurable earnings`);
        if (typeof line.insurableHours !== "number" || !Number.isFinite(line.insurableHours)) throw new Error("Actual insurable hours are unavailable.");
        // Signed correction/reversal rows must reach the complete-page merge:
        // dropping them would leave overstated original positive ROE history.
        roeSource.periods.push({ periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate, insurableEarningsCents: insurable, insurableHours: line.insurableHours });
      } catch {
        roeSource.complete = false;
        warnings.add(`${label}: ROE period omitted because actual insurable hours/earnings are unavailable; review historical periods and any correction explicitly.`);
      }
      // The opening phase replaces annual figures, not actual ROE period
      // history. Other employees in this run are independent source lines.
      if (represented) continue;
      try {
        if (typeof line.provinceOfEmployment !== "string" || !line.provinceOfEmployment.trim()) throw new Error(`${label} is missing the actual province of employment.`);
        const bases = line.classifiedBases;
        const taxable = integer(bases?.taxableCents, `${label} taxable earnings`), pensionable = integer(bases?.pensionableCents, `${label} pensionable earnings`), insurable = integer(bases?.insurableCents, `${label} insurable earnings`);
        if (taxable !== integer(line.grossCents, `${label} gross earnings`)) throw new Error(`${label} taxable classifications do not reconcile to recorded employment gross.`);
        const delta = line.deductionYtdDelta;
        addAnnual({ employeeId: line.employeeId, provinceOfEmployment: line.provinceOfEmployment.trim().toUpperCase(), employmentIncomeCents: taxable, pensionableEarningsCents: pensionable, insurableEarningsCents: insurable, cppEmployeeCents: integer(line.cppEmployeeCents, `${label} employee CPP`), cpp2EmployeeCents: integer(line.cpp2EmployeeCents, `${label} employee CPP2`), eiEmployeeCents: integer(line.eiEmployeeCents, `${label} employee EI`), incomeTaxCents: integer(line.incomeTaxCents, `${label} income tax`), ...(delta?.unionDuesCents === undefined ? {} : { unionDuesCents: integer(delta.unionDuesCents, `${label} union dues`) }), rppClassificationRequired: Boolean(delta && (delta.registeredPlanCents || delta.bonusRegisteredPlanCents)) || (!delta && Boolean(line.otherDeductionsCents)), sourceCount: 1, complete: true });
        recordEmployer(line.cppEmployerCents, line.cpp2EmployerCents, line.eiEmployerCents, label);
      } catch (error) {
        blockers.add(error instanceof Error ? error.message : `Review actual filing amounts for ${label}.`);
        warnings.add(`${label}: incomplete source omitted from annual figures; no missing classification has been treated as zero.`);
      }
    }
  }
  else for (const opening of page.page) {
    sourceCount++;
    const employee = await ownedEmployee(opening.employeeId), label = `Opening balance ${opening._id}`;
    const ytd = opening.ytd;
    try {
      if (!opening.sameEmployerConfirmed || opening.legalEmployerId !== args.societyId) throw new Error(`${label} needs confirmed same-legal-employer provenance.`);
      const taxable = add(integer(ytd?.regularTaxableCents, `${label} regular taxable earnings`), integer(ytd?.bonusTaxableCents, `${label} bonus taxable earnings`));
      const record: AnnualRecord = { employeeId: opening.employeeId, provinceOfEmployment: String(opening.provinceOfEmployment ?? "").trim().toUpperCase(), employmentIncomeCents: taxable, pensionableEarningsCents: add(integer(ytd.regularPensionableCents, `${label} regular pensionable earnings`), integer(ytd.bonusPensionableCents, `${label} bonus pensionable earnings`)), insurableEarningsCents: add(integer(ytd.regularInsurableCents, `${label} regular insurable earnings`), integer(ytd.bonusInsurableCents, `${label} bonus insurable earnings`)), cppEmployeeCents: integer(ytd.cppCents, `${label} CPP`), cpp2EmployeeCents: integer(ytd.cpp2Cents, `${label} CPP2`), eiEmployeeCents: integer(ytd.eiCents, `${label} EI`), incomeTaxCents: add(integer(ytd.regularTaxCents, `${label} regular tax`), integer(ytd.bonusTaxCents, `${label} bonus tax`), integer(ytd.additionalTaxCents, `${label} additional tax`)), unionDuesCents: integer(ytd.unionDuesCents, `${label} union dues`), rppClassificationRequired: Boolean(ytd.registeredPlanCents || ytd.bonusRegisteredPlanCents), sourceCount: 1, complete: true };
      const hasAmounts = annualAmounts.some(field => record[field] !== 0) || record.unionDuesCents !== 0 || record.rppClassificationRequired;
      if (!hasAmounts) continue; // A genuine January zero opening is not a T4 slip.
      if (!record.provinceOfEmployment) throw new Error(`${label} is missing the actual province of employment; it cannot be inferred from the home address.`);
      if (!Array.isArray(opening.representedPayRunIds) || opening.representedPayRunIds.length > 200) throw new Error(`${label} needs a bounded explicit represented-run list.`);
      for (const id of opening.representedPayRunIds) {
        let run = representedRuns.get(id); if (!run) { run = await getOwned<PayrollRow>(ctx, "payRuns", id, args.societyId); representedRuns.set(id, run); }
        if (!String(run.payDate).startsWith(`${year}-`) || run.payDate > opening.coveredThroughDate || (run.lines?.length && !run.lines.some((line: any) => line.employeeId === opening.employeeId))) throw new Error(`${label} represents a run outside this employee, coverage date or payment year.`);
      }
      addAnnual(record); recordEmployer(opening.employerCppCents, opening.employerCpp2Cents, ytd.employerEiCents, label);
      const source = roeFor(opening.employeeId, `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || opening.employeeId);
      source.complete = false;
      warnings.add(`${label}: aggregate opening insurable hours/earnings cannot supply individual ROE pay periods. Enter the actual consecutive historical periods when preparing an ROE.`);
    } catch (error) { blockers.add(error instanceof Error ? error.message : `Review ${label} filing classifications.`); }
  }
  let continuation: PageCursor | null;
  if (!page.isDone) continuation = { ...cursor, cursor: page.continueCursor };
  else continuation = cursor.phase === "recorded_runs" ? { version: 1, scope, phase: "openings", cursor: null } : null;
  const account = typeof settings[0]?.payrollAccountNumber === "string" ? settings[0].payrollAccountNumber.replace(/\s/g, "") : "";
  return {
    earningsYear: year, employerName: String(organization.name ?? ""), ...(account ? { payrollAccountLast4: account.slice(-4) } : {}),
    sourceCount, complete: blockers.size === 0, warnings: [...warnings], blockers: [...blockers], annualRecords: [...annual.values()], employerContributions,
    roeSources: [...roe.values()], isDone: continuation === null, continueCursor: continuation ? JSON.stringify(continuation) : "",
  };
}
