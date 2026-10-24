import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import type {
  CalculationInput,
  EmployerSettingsFields,
  EmployeeProfileFields,
} from "../shared/payrollCalculation";
import { emptyPayrollYtd } from "../shared/payrollDeductions";
import * as payroll from "../shared/functions/payrollCalculation";
const societyId = "native_history_org",
  employeeId = "history_employee",
  userId = "history_owner";
const principal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: "history-owner",
  issuer: "https://history.test",
  userId,
  societyId,
} as const;
const seed = {
  societies: [{ _id: societyId, name: "Native history organization" }],
  users: [
    {
      _id: userId,
      societyId,
      role: "Owner",
      status: "Active",
      authSubject: principal.subject,
      authIssuer: principal.issuer,
    },
  ],
  employees: [
    {
      _id: employeeId,
      societyId,
      firstName: "History",
      lastName: "Worker",
      role: "Staff",
      birthDate: "1990-01-01",
      startDate: "2025-01-01",
      employmentType: "FullTime",
      cppExempt: false,
      eiExempt: false,
    },
  ],
  payrollSettings: [
    {
      _id: "history_settings",
      societyId,
      remitterType: "regular",
      updatedAtISO: "2026-01-01T00:00:00Z",
    },
  ],
};
const employer: EmployerSettingsFields = {
  year: 2026,
  payFrequency: "semimonthly",
  payDates: Array.from({ length: 12 }, (_, i) => [
    `2026-${String(i + 1).padStart(2, "0")}-15`,
    new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10),
  ]).flat(),
  eiEmployerMultiplier: 1.4,
  ehtEmployerClass: "ordinary",
  ehtOpeningRemunerationCents: 0,
  ehtOpeningThroughDate: "2025-12-31",
  ehtOpeningConfirmed: true,
  ehtOpeningSourceReference: "Actual year opening",
  ehtOpeningRepresentedPayRunIds: [],
  ehtAssociated: false,
  ehtPermanentEstablishmentDays: 365,
  workSafeRatePer100Dollars: 1.2,
  workSafeAssessableLimitCents: 12750000,
  workSafeClassificationCode: "Actual classification",
  workSafeRateEvidence: "Actual reviewed classification rate",
  employerBenefitsCentsPerPay: 0,
  employerPensionPercent: 0,
};
const profile: EmployeeProfileFields = {
  effectiveFrom: "2025-01-01",
  provinceOfEmployment: "BC",
  employmentKind: "ordinary",
  compensation: "hourly",
  rateCents: 2500,
  normalWeeklyMinutes: 2400,
  averageWeeklyMinutes: 2400,
  policy: "ordinary_bc",
  restPeriodsConfirmed: true,
  historyCompleteFrom: "2025-01-01",
  historyCompleteThrough: "2026-12-31",
  ytdConfirmed: true,
  vacationMode: "accrue",
  td1: { confirmed: true, declarationReference: "Actual signed declarations" },
  cpp: { exempt: false },
  eiExempt: false,
};
const firstInput: CalculationInput = {
    periodStart: "2026-08-16",
    periodEnd: "2026-08-31",
    payDate: "2026-08-31",
    runType: "regular",
    method: "option1",
    employeeIds: [employeeId],
  },
  secondInput: CalculationInput = {
    ...firstInput,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    payDate: "2026-09-15",
  };
function context(db: PortableMutationCtx["db"]) {
  let paginations = 0;
  const proxy = new Proxy(db, {
    get(target, method) {
      if (method === "query")
        return (table: string) => {
          const query = target.query(table);
          const wrapped = new Proxy(query, {
            get(inner, key) {
              const fn = Reflect.get(inner, key);
              if (typeof fn !== "function") return fn;
              return (...args: any[]) => {
                if (key === "paginate")
                  assert.ok(
                    ++paginations <= 1,
                    "one paginate per preview/mutation",
                  );
                const result = fn.apply(inner, args);
                return result === inner ? wrapped : result;
              };
            },
          });
          return wrapped;
        };
      const value = Reflect.get(target, method);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: proxy,
    principal,
    capabilities: makeCapabilities({}),
  } as PortableMutationCtx;
}
for (const runtime of ["memory", "indexed-local"] as const) {
  const db =
    runtime === "memory"
      ? new MemoryDb({ seed: structuredClone(seed) })
      : new LocalStoreDb(
          new MemoryRowStore(structuredClone(seed), { indexed: true }),
        );
  const invoke = <T>(fn: (c: PortableMutationCtx) => Promise<T>) =>
    db.transaction(() => fn(context(db)));
  await invoke((c) =>
    payroll.saveEmployerSettingsPortable(c, { societyId, fields: employer }),
  );
  await invoke((c) =>
    payroll.saveProfilePortable(c, { societyId, employeeId, fields: profile }),
  );
  await invoke((c) =>
    payroll.saveOpeningBalancePortable(c, {
      societyId,
      employeeId,
      fields: {
        year: 2026,
        coveredThroughDate: "2025-12-31",
        sameEmployerConfirmed: true,
        ytd: emptyPayrollYtd(),
        insurableHours: 0,
        cashPaidCents: 0,
        netPaidCents: 0,
        vacationBalanceCents: 0,
        workSafeAssessableCents: 0,
        sickPaidDaysUsed: 0,
        sickUnpaidDaysUsed: 0,
        sourceReference: "Actual zero same-employer opening",
        representedPayRunIds: [],
      },
    }),
  );
  const priorDays = [
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-31",
    ],
    priorIds: string[] = [];
  for (const date of priorDays)
    priorIds.push(
      await invoke((c) =>
        payroll.saveWorkDayPortable(c, {
          societyId,
          employeeId,
          fields: { date, minutes: date === "2026-08-17" ? 600 : 480 },
        }),
      ),
    );
  const first = await payroll.previewPortable(context(db), {
    societyId,
    input: firstInput,
  });
  assert.deepEqual(first.blockers, []);
  assert.equal(first.totals.cashCents, 227500);
  const firstId = await invoke((c) =>
    payroll.saveDraftPortable(c, { societyId, input: firstInput }),
  );
  await invoke((c) => payroll.approvePortable(c, { societyId, id: firstId }));
  await invoke((c) =>
    payroll.finalizePortable(c, {
      societyId,
      id: firstId,
      idempotencyKey: "prior-frozen",
    }),
  );
  for (const id of priorIds)
    assert.equal(
      (await db.get(id, "payrollWorkDays"))!.historicalNonOvertimeWagesCents,
      undefined,
      "finalization does not mutate paid work into editable history",
    );
  for (const date of [
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-14",
    "2026-09-15",
  ])
    await invoke((c) =>
      payroll.saveWorkDayPortable(c, {
        societyId,
        employeeId,
        fields: { date, minutes: 480 },
      }),
    );
  const second = await payroll.previewPortable(context(db), {
    societyId,
    input: secondInput,
  });
  assert.deepEqual(
    second.blockers,
    [],
    "native prior and current preholiday wages never require manual duplicate history",
  );
  assert.equal(second.totals.cashCents, 220000);
  const employee = second.employees[0],
    holiday = employee.earnings.lines.find((l) => l.code === "STAT_AVERAGE");
  assert.equal(holiday!.date, "2026-09-07");
  assert.equal(
    holiday!.amountCents,
    20000,
    "15-of-30 eligible holiday uses exact200 dollar average excluding prior OT",
  );
  assert.equal(
    employee.earningsInput.history!.find((d) => d.date === "2026-08-17")!
      .nonOvertimeWagesCents,
    20000,
  );
  assert.equal(
    employee.earningsInput.history!.find((d) => d.date === "2026-09-04")!
      .nonOvertimeWagesCents,
    20000,
  );
  assert.equal(
    new Set(employee.earningsInput.history!.map((d) => d.date)).size,
    employee.earningsInput.history!.length,
  );
  assert.ok(
    employee.wageHistoryProvenance!.some(
      (p) => p.kind === "native" && p.calculationIds?.includes(firstId),
    ),
  );
  assert.ok(
    employee.wageHistoryProvenance!.some(
      (p) => p.kind === "current" && p.date === "2026-09-04",
    ),
  );
  await db.transaction(() =>
    db.patch(priorIds[0], {
      historicalNonOvertimeWagesCents: 99999,
      workedOrEarned: true,
    }),
  );
  const conflicting = await payroll.previewPortable(context(db), {
    societyId,
    input: secondInput,
  });
  assert.deepEqual(conflicting.blockers, []);
  assert.equal(
    conflicting.employees[0].earnings.lines.find(
      (l) => l.code === "STAT_AVERAGE",
    )!.amountCents,
    20000,
    "manual source cannot duplicate or override actual frozen wages",
  );
  assert.ok(
    conflicting.employees[0].warnings.some((w) =>
      w.includes("take precedence"),
    ),
  );
  await db.transaction(async () => {
    const {
      _id,
      _creationTime,
      historicalNonOvertimeWagesCents,
      workedOrEarned,
      ...rest
    } = (await db.get(priorIds[0], "payrollWorkDays"))!;
    await db.replace(priorIds[0], rest);
  });
  const unknownId = await invoke((c) =>
    payroll.saveWorkDayPortable(c, {
      societyId,
      employeeId,
      fields: { date: "2026-08-15", minutes: 480 },
    }),
  );
  const unknown = await payroll.previewPortable(context(db), {
    societyId,
    input: secondInput,
  });
  assert.ok(
    unknown.blockers.some(
      (b) =>
        b.includes("2026-08-15") &&
        b.includes("reviewed non-overtime wage history"),
    ),
    "unfinalized/external prior wages still need factual history",
  );
  await db.transaction(() => db.delete(unknownId));
  const pending = await invoke((c) =>
    payroll.saveDraftPortable(c, { societyId, input: secondInput }),
  );
  const frozen = (await db.get(firstId, "payrollCalculations"))!,
    originalResult = frozen.resultJson,
    changed = JSON.parse(originalResult);
  changed.employees[0].earnings.lines.find(
    (l: any) => l.code === "REGULAR",
  ).amountCents += 100;
  await db.transaction(() =>
    db.patch(firstId, { resultJson: JSON.stringify(changed) }),
  );
  await assert.rejects(
    () => invoke((c) => payroll.approvePortable(c, { societyId, id: pending })),
    /source data changed/,
  );
  await db.transaction(() => db.patch(firstId, { resultJson: originalResult }));
  await invoke((c) =>
    payroll.reversePortable(c, {
      societyId,
      id: firstId,
      date: "2026-08-31",
      reason: "Unpaid calculation corrected",
      idempotencyKey: "reverse-prior",
    }),
  );
  const voided = await payroll.previewPortable(context(db), {
    societyId,
    input: secondInput,
  });
  assert.ok(
    voided.blockers.some((b) =>
      b.includes("reviewed non-overtime wage history"),
    ),
    "voided native source is never reused as active wages",
  );
  const replacementInput = {
    ...firstInput,
    runType: "correction" as const,
    correctionOfId: firstId,
  };
  const replacement = await invoke((c) =>
    payroll.saveDraftPortable(c, { societyId, input: replacementInput }),
  );
  const detail = await payroll.workspacePortable(context(db), {
    societyId,
    collection: "calculation",
    id: replacement,
  });
  assert.deepEqual(detail.detail!.result.blockers, []);
  await invoke((c) =>
    payroll.approvePortable(c, { societyId, id: replacement }),
  );
  await invoke((c) =>
    payroll.finalizePortable(c, {
      societyId,
      id: replacement,
      idempotencyKey: "replace-prior",
    }),
  );
  const restored = await payroll.previewPortable(context(db), {
    societyId,
    input: secondInput,
  });
  assert.deepEqual(restored.blockers, []);
  assert.equal(
    restored.employees[0].earnings.lines.find((l) => l.code === "STAT_AVERAGE")!
      .amountCents,
    20000,
  );
  assert.ok(
    restored.employees[0]
      .wageHistoryProvenance!.filter((p) => p.kind === "native")
      .every((p) => !p.calculationIds?.includes(firstId)),
  );
  console.log(
    `${runtime}: finalized native plus current ordinary wages produce eligible statutory holiday averages, exclude overtime, retain immutable source provenance, reject unknown external wages, and respect dated unpaid reversals/replacements`,
  );
}
