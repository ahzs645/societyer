import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableQueryCtx } from "../shared/portable/ctx";
import { emptyPayrollYtd } from "../shared/payrollDeductions";
import { exportContextPortable } from "../shared/functions/payrollCalculationExports";

const societyId = "payroll_export_society", foreignId = "other_society", ownerId = "payroll_export_owner";
const principal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "payroll-export-owner", issuer: "https://payroll-export.test", userId: ownerId, societyId } as const;
const amountLine = (employeeId: string, grossCents: number, overrides: Record<string, unknown> = {}) => ({ employeeId, employeeName: `Sample ${employeeId}`, provinceOfEmployment: "BC", grossCents, cppEmployeeCents: grossCents / 20, cpp2EmployeeCents: 0, eiEmployeeCents: grossCents / 100, incomeTaxCents: grossCents / 10, cppEmployerCents: grossCents / 20, cpp2EmployerCents: 0, eiEmployerCents: grossCents * 14 / 1000, classifiedBases: { cashCents: grossCents, taxableCents: grossCents, pensionableCents: grossCents, insurableCents: grossCents, vacationableCents: grossCents, ehtCents: grossCents, workSafeCents: grossCents }, insurableHours: grossCents / 2500, ...overrides });
const run = (id: string, day: string, lines: unknown[], overrides: Record<string, unknown> = {}) => ({ _id: id, societyId, periodStart: `${day.slice(0, 7)}-01`, periodEnd: day, payDate: day, lines, ...overrides });
const seed = {
  societies: [{ _id: societyId, name: "Sample payroll organization" }, { _id: foreignId, name: "Foreign organization" }],
  users: [{ _id: ownerId, societyId, role: "Owner", status: "Active", authSubject: principal.subject, authIssuer: principal.issuer }],
  employees: [{ _id: "a", societyId, firstName: "Sample", lastName: "A", sinSecretVaultItemId: "NEVER-RETURN-SIN", birthDate: "1990-01-01", phone: "NEVER-RETURN-PHONE" }, { _id: "b", societyId, firstName: "Sample", lastName: "B" }, { _id: "foreign-employee", societyId: foreignId, firstName: "Foreign" }],
  payrollSettings: [{ _id: "settings", societyId, payrollAccountNumber: "123456789RP0001", workersCompAccount: "NEVER-RETURN-WCB" }],
  payrollEmployerProfiles: [{ _id: "employer", societyId, year: 2026, payFrequency: "biweekly" }],
  payrollOpeningBalances: [{ _id: "opening-a", societyId, legalEmployerId: societyId, employeeId: "a", year: 2026, sameEmployerConfirmed: true, coveredThroughDate: "2026-01-15", provinceOfEmployment: "BC", representedPayRunIds: ["first"], ytd: { ...emptyPayrollYtd(), regularTaxableCents: 100000, regularPensionableCents: 100000, regularInsurableCents: 100000, cppCents: 5000, eiCents: 1000, employerEiCents: 1400, regularTaxCents: 10000, registeredPlanCents: 2000 }, employerCppCents: 5000, employerCpp2Cents: 0, insurableHours: 40 }],
  payRuns: [run("first", "2026-01-15", [amountLine("a", 100000), amountLine("b", 200000)]), run("second", "2026-02-15", [amountLine("a", 300000)]), run("foreign-run", "2026-01-15", [amountLine("foreign-employee", 999000)], { societyId: foreignId }), run("wrong-year", "2025-12-15", [amountLine("a", 999000)])],
};
function context(db: PortableQueryCtx["db"], caller: PortableQueryCtx["principal"] = principal) {
  let paginateCount = 0;
  const proxy = new Proxy(db, { get(target, key) {
    if (key === "query") return (table: string) => {
      const query = target.query(table);
      const wrapped = new Proxy(query, { get(inner, method) { const fn = Reflect.get(inner, method); if (typeof fn !== "function") return fn; return (...args: unknown[]) => { if (method === "paginate") assert.equal(++paginateCount, 1, "one native pagination per invocation"); const result = fn.apply(inner, args); return result === inner ? wrapped : result; }; } });
      return wrapped;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { ctx: { db: proxy, principal: caller, capabilities: makeCapabilities({}) } as PortableQueryCtx, count: () => paginateCount };
}
async function allPages(db: PortableQueryCtx["db"]) {
  const pages = []; let cursor: string | undefined; const seen = new Set<string>();
  do { const tracked = context(db), page = await exportContextPortable(tracked.ctx, { societyId, year: 2026, cursor }); assert.equal(tracked.count(), 1); pages.push(page); if (page.isDone) break; assert.ok(page.continueCursor && !seen.has(page.continueCursor)); seen.add(page.continueCursor); cursor = page.continueCursor; } while (pages.length < 100);
  assert.ok(pages.at(-1)!.isDone, "source phase cursor reaches all openings"); return pages;
}
for (const runtime of ["memory", "indexed-local"] as const) {
  const db = runtime === "memory" ? new MemoryDb({ seed: structuredClone(seed) }) : new LocalStoreDb(new MemoryRowStore(structuredClone(seed), { indexed: true }));
  await db.transaction(async () => {
    const pages = await allPages(db), records = pages.flatMap(page => page.annualRecords);
    assert.equal(pages.reduce((total, page) => total + page.sourceCount, 0), 3, "two owned payment-year runs and one opening");
    assert.ok(pages.every(page => page.complete));
    assert.equal(records.filter(record => record.employeeId === "a").reduce((total, record) => total + record.employmentIncomeCents, 0), 400000, "represented line replaced by opening once");
    assert.equal(records.filter(record => record.employeeId === "b").reduce((total, record) => total + record.employmentIncomeCents, 0), 200000, "another employee in represented run is retained");
    assert.equal(pages.reduce((total, page) => total + page.employerContributions.cppCents, 0), 30000);
    assert.ok(records.some(record => record.rppClassificationRequired));
    assert.ok(records.every(record => record.rppContributionsCents === undefined && record.pensionAdjustmentCents === undefined), "generic plan deductions are never guessed as RPP or pension adjustment");
    assert.ok(pages.flatMap(page => page.warnings).some(warning => /aggregate opening.*ROE/.test(warning)));
    assert.equal(pages.flatMap(page => page.roeSources).filter(source => source.employeeId === "a").flatMap(source => source.periods).reduce((sum, period) => sum + period.insurableEarningsCents, 0), 400000, "opening-represented runs retain actual ROE period history");
    assert.equal(pages[0].payrollAccountLast4, "0001");
    assert.ok(!JSON.stringify(pages).includes("123456789RP")); assert.ok(!JSON.stringify(pages).includes("NEVER-RETURN")); assert.ok(!JSON.stringify(pages).includes("birthDate"));
    const firstCursor = pages[0].continueCursor;
    await assert.rejects(() => exportContextPortable(context(db).ctx, { societyId, year: 2025, cursor: firstCursor }), /another organization or earnings year/);
    await assert.rejects(() => exportContextPortable(context(db).ctx, { societyId, year: 2026, cursor: "not-json" }), /Invalid payroll filing page/);
    const financeOnly = { kind: "service", runtime: "test", assurance: "trusted-internal", subject: "finance-reader", societyId, actorUserId: ownerId, scopes: ["financials:read"] } as const;
    await assert.rejects(() => exportContextPortable(context(db, financeOnly).ctx, { societyId, year: 2026 }), /employees:read/);
    await db.insert("payRuns", run("reversal", "2026-02-15", [amountLine("a", -300000)], { runType: "reversal" }));
    const corrected = await allPages(db);
    const february = corrected.flatMap(page => page.roeSources).filter(source => source.employeeId === "a").flatMap(source => source.periods).filter(period => period.periodEnd === "2026-02-15");
    assert.equal(february.reduce((total, period) => total + period.insurableEarningsCents, 0), 0, "signed reversal offsets the actual original ROE period");
    assert.equal(february.reduce((total, period) => total + period.insurableHours, 0), 0);
    assert.equal(corrected.flatMap(page => page.annualRecords).filter(record => record.employeeId === "a").reduce((total, record) => total + record.employmentIncomeCents, 0), 100000, "signed recorded correction also offsets annual figures once");
    for (let index = 0; index < 27; index++) {
      const employeeId = await db.insert("employees", { societyId, firstName: "Zero", lastName: String(index) });
      await db.insert("payrollOpeningBalances", { societyId, legalEmployerId: societyId, employeeId, year: 2026, sameEmployerConfirmed: true, coveredThroughDate: "2025-12-31", representedPayRunIds: [], ytd: emptyPayrollYtd() });
    }
    const expanded = await allPages(db);
    assert.equal(expanded.reduce((total, page) => total + page.sourceCount, 0), 31, "all 28 opening balances continue beyond the first 25-row page");
    assert.ok(expanded.every(page => page.complete), "genuine pre-year zero openings need no invented province or contribution metadata");
    await db.insert("payRuns", run("missing-hours", "2026-03-15", [amountLine("b", 100000, { insurableHours: undefined })]));
    const withoutHours = await allPages(db);
    assert.ok(withoutHours.every(page => page.complete), "ROE-only missing hours does not invalidate known T4 bases");
    const hourPage = withoutHours.find(page => page.warnings.some(warning => /missing-hours.*ROE period omitted/.test(warning)))!;
    assert.ok(hourPage); assert.equal(hourPage.roeSources[0].complete, false); assert.equal(hourPage.roeSources[0].periods.length, 0);
    await db.insert("payRuns", run("missing-bases", "2026-04-15", [amountLine("b", 100000, { classifiedBases: undefined })]));
    const missing = await allPages(db);
    assert.ok(missing.some(page => !page.complete && page.blockers.some(blocker => /missing-bases.*taxable earnings/.test(blocker))));
    await db.insert("payRuns", run("unlinked", "2026-05-15", [amountLine("", 100000, { providerEmployeeId: "provider-not-owned-id" })]));
    assert.ok((await allPages(db)).some(page => page.blockers.some(blocker => /owned employee link/.test(blocker))));
    await db.insert("payRuns", run("bad-foreign-link", "2026-06-15", [amountLine("foreign-employee", 100000)]));
    await assert.rejects(() => allPages(db), /not found/);
  });
}
console.log("Payroll filing-source export checks passed (memory + indexed local): scoped phases, one pagination, employee-specific opening deduplication, actual bases, unknown-field blockers, RPP review, privacy and permissions.");
