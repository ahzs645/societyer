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
const societyId = "cost_extensions",
  userId = "cost_owner";
const principal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: "cost-owner",
  issuer: "https://cost.test",
  userId,
  societyId,
} as const;
const seed = {
  societies: [{ _id: societyId, name: "Cost extensions organization" }],
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
  employees: ["standard", "covered", "salary"].map((id) => ({
    _id: id,
    societyId,
    firstName: id,
    lastName: "Worker",
    startDate: "2025-01-01",
    birthDate: "1990-01-01",
    role: "Staff",
    employmentType: "FullTime",
    cppExempt: false,
    eiExempt: false,
  })),
  financialAccounts: [
    "wages",
    "employer_cost",
    "netpay",
    "deductions",
    "benefits",
    "bank",
  ].map((id) => ({
    _id: id,
    societyId,
    name: id,
    accountType: ["wages", "employer_cost"].includes(id)
      ? "Expense"
      : id === "bank"
        ? "Bank"
        : "Liability",
    currency: "CAD",
  })),
  payrollSettings: [
    {
      _id: "settings",
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
  eiEmployerMultiplier: 1.2,
  reducedEiRateEvidence: "CRA reviewed coverage plan approval",
  uniformEmployerAssumptionsConfirmed: true,
  ehtEmployerClass: "ordinary",
  ehtOpeningRemunerationCents: 0,
  ehtOpeningThroughDate: "2025-12-31",
  ehtOpeningConfirmed: true,
  ehtOpeningSourceReference: "Same-employer year opening",
  ehtOpeningRepresentedPayRunIds: [],
  ehtAssociated: false,
  ehtPermanentEstablishmentDays: 365,
  workSafeRatePer100Dollars: 1.2,
  workSafeAssessableLimitCents: 12750000,
  workSafeClassificationCode: "Actual classification",
  workSafeRateEvidence: "Actual annual net rate",
  employerBenefitsCentsPerPay: 1000,
  employerPensionPercent: 2,
  employerPensionBonusEligible: false,
  ledger: {
    wagesExpenseAccountId: "wages",
    employerExpenseAccountId: "employer_cost",
    netPayLiabilityAccountId: "netpay",
    deductionsLiabilityAccountId: "deductions",
    benefitsLiabilityAccountId: "benefits",
  },
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
  td1: {
    confirmed: true,
    declarationReference: "Actual reviewed declarations",
  },
  cpp: { exempt: false },
  eiExempt: false,
};
const input: CalculationInput = {
  periodStart: "2026-05-01",
  periodEnd: "2026-05-15",
  payDate: "2026-05-15",
  runType: "regular",
  method: "option1",
  employeeIds: ["standard", "covered"],
};
for (const runtime of ["memory", "indexed-local"] as const) {
  const db =
    runtime === "memory"
      ? new MemoryDb({ seed: structuredClone(seed) })
      : new LocalStoreDb(
          new MemoryRowStore(structuredClone(seed), { indexed: true }),
        );
  const ctx = () =>
    ({
      db,
      principal,
      capabilities: makeCapabilities({}),
    }) as PortableMutationCtx;
  const invoke = <T>(fn: (c: PortableMutationCtx) => Promise<T>) =>
    db.transaction(() => fn(ctx()));
  await invoke((c) =>
    payroll.saveEmployerSettingsPortable(c, { societyId, fields: employer }),
  );
  for (const employeeId of ["standard", "covered", "salary"]) {
    await invoke((c) =>
      payroll.saveProfilePortable(c, {
        societyId,
        employeeId,
        fields: {
          ...profile,
          ...(employeeId === "salary"
            ? { compensation: "annual" as const, rateCents: 5200000 }
            : {}),
          ...(employeeId !== "covered"
            ? {
                employerOverrides: {
                  eiEmployerMultiplier: 1.4,
                  benefitsCentsPerPay: 0,
                  pensionPercent: 0,
                  evidence:
                    "Employee not covered by PRP plan; actual benefits and pension zero",
                },
              }
            : {}),
        },
      }),
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
          vacationBalanceCents: employeeId === "salary" ? 500000 : 100000,
          workSafeAssessableCents: 0,
          sickPaidDaysUsed: 0,
          sickUnpaidDaysUsed: 0,
          sourceReference: "Actual carried vacation liability",
          representedPayRunIds: [],
        },
      }),
    );
  }
  for (const employeeId of ["standard", "covered"])
    await invoke((c) =>
      payroll.saveWorkDayPortable(c, {
        societyId,
        employeeId,
        fields: { date: "2026-05-05", minutes: 480 },
      }),
    );
  const preview = await payroll.previewPortable(ctx(), { societyId, input });
  assert.deepEqual(preview.blockers, []);
  const standard = preview.employees[0],
    covered = preview.employees[1];
  assert.equal(standard.employerCosts!.benefitsCents, 0);
  assert.equal(standard.employerCosts!.pensionCents, 0);
  assert.equal(standard.deductions!.input.ei.employerMultiplier, 1.4);
  assert.equal(covered.deductions!.input.ei.employerMultiplier, 1.2);
  assert.equal(covered.employerCosts!.benefitsCents, 1000);
  assert.equal(covered.employerCosts!.pensionCents, 400);
  const bonusCode = await invoke((c) =>
    payroll.saveEarningCodePortable(c, {
      societyId,
      fields: {
        code: "BONUS",
        name: "Actual bonus",
        paymentKind: "bonus",
        classifications: {
          cash: true,
          taxable: true,
          pensionable: true,
          insurable: true,
          vacationable: true,
          eht: true,
          workSafe: true,
        },
        classificationEvidence: "Actual ordinary employment bonus",
        active: true,
      },
    }),
  );
  const bonusInput: CalculationInput = {
    ...input,
    employeeIds: ["covered"],
    runType: "bonus",
    adjustments: [
      {
        employeeId: "covered",
        earningCodeId: bonusCode,
        date: "2026-05-15",
        amountCents: 10000,
      },
    ],
  };
  const bonus = await payroll.previewPortable(ctx(), {
    societyId,
    input: bonusInput,
  });
  assert.deepEqual(bonus.blockers, []);
  assert.equal(
    bonus.employees[0].employerCosts!.benefitsCents,
    0,
    "fixed benefits are not charged again for an adjustments-only bonus",
  );
  assert.equal(
    bonus.employees[0].employerCosts!.pensionCents,
    0,
    "actual plan excludes bonus",
  );
  const extra = await payroll.previewPortable(ctx(), {
    societyId,
    input: {
      ...bonusInput,
      employerCostOverrides: [
        {
          employeeId: "covered",
          benefitsCents: 500,
          pensionCents: 123,
          evidence: "Actual extra bonus-run invoice and plan cost",
        },
      ],
    },
  });
  assert.deepEqual(extra.blockers, []);
  assert.equal(extra.employees[0].employerCosts!.benefitsCents, 500);
  assert.equal(extra.employees[0].employerCosts!.pensionCents, 123);
  assert.equal(
    extra.input.employerCostOverrides![0].evidence,
    "Actual extra bonus-run invoice and plan cost",
  );
  const payoutInput: CalculationInput = {
    ...input,
    employeeIds: ["standard"],
    vacationPayouts: [
      {
        employeeId: "standard",
        amountCents: 50000,
        sourceReference: "Actual vacation accrual payment approved",
        treatment: "vacation_leave",
        insurableMinutes: 1200,
      },
    ],
  };
  const payout = await payroll.previewPortable(ctx(), {
    societyId,
    input: payoutInput,
  });
  assert.deepEqual(payout.blockers, []);
  assert.equal(payout.input.vacationPayouts![0].amountCents, 50000);
  assert.equal(payout.employees[0].priorVacationLiabilityReleasedCents, 50000);
  assert.equal(payout.employees[0].vacationBalanceBeforeCents, 100000);
  assert.equal(payout.employees[0].insurableHours, 28);
  assert.equal(
    payout.employees[0].employerCosts!.vacationLiabilityReleasedCents,
    50000,
  );
  assert.equal(payout.employees[0].earnings.bases.cashCents, 70000);
  const draft = await invoke((c) =>
    payroll.saveDraftPortable(c, { societyId, input: payoutInput }),
  );
  await invoke((c) => payroll.approvePortable(c, { societyId, id: draft }));
  const runId = await invoke((c) =>
    payroll.finalizePortable(c, {
      societyId,
      id: draft,
      idempotencyKey: "hourly-vacation",
      postToLedger: true,
    }),
  );
  const run = await db.get(runId, "payRuns");
  assert.equal(run!.lines[0].vacationPaidCents, 50000);
  assert.equal(run!.lines[0].vacationAccruedCents, 2800);
  assert.equal(run!.lines[0].insurableHours, 28);
  const posted = (await db.get(draft, "payrollCalculations"))!
    .journalEntryIds[0];
  const ledgerLines = await db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("journalEntryId", posted))
    .collect();
  assert.equal(
    ledgerLines.reduce(
      (a, l) => a + (l.side === "debit" ? l.amountCents : -l.amountCents),
      0,
    ),
    0,
  );
  assert.ok(
    ledgerLines.some(
      (l) =>
        l.side === "debit" &&
        l.accountId === "benefits" &&
        l.amountCents === 50000,
    ),
  );
  assert.equal(
    ledgerLines
      .filter(
        (l) =>
          l.side === "debit" &&
          ["wages", "employer_cost"].includes(l.accountId),
      )
      .reduce((a, l) => a + l.amountCents, 0),
    payout.employees[0].employerCosts!.totalEmployerCostCents,
    "onlynewcostisexpensed;priorvacationreleasesliability",
  );
  assert.equal(
    await invoke((c) =>
      payroll.finalizePortable(c, {
        societyId,
        id: draft,
        idempotencyKey: "hourly-vacation",
        postToLedger: true,
      }),
    ),
    runId,
  );
  const days = [
    "2026-05-01",
    "2026-05-04",
    "2026-05-05",
    "2026-05-06",
    "2026-05-07",
    "2026-05-08",
    "2026-05-11",
    "2026-05-12",
    "2026-05-13",
    "2026-05-14",
    "2026-05-15",
  ];
  const request = await db.transaction(() =>
    db.insert("payrollVacationRequests", {
      societyId,
      employeeId: "salary",
      status: "approved",
      days: days.map((date) => ({ date, minutes: 480 })),
    }),
  );
  for (const date of days)
    await invoke((c) =>
      payroll.saveWorkDayPortable(c, {
        societyId,
        employeeId: "salary",
        fields: {
          date,
          minutes: 0,
          paidVacationMinutes: 480,
          salaryVacationSourceReference: "Approved annual-leave source",
          vacationRequestId: request,
        },
      }),
    );
  const leave = await payroll.previewPortable(ctx(), {
    societyId,
    input: { ...input, employeeIds: ["salary"] },
  });
  assert.deepEqual(leave.blockers, []);
  assert.equal(
    leave.employees[0].earnings.bases.cashCents,
    216667,
    "salary already funds leave; no second cash payout",
  );
  assert.equal(leave.employees[0].priorVacationLiabilityReleasedCents, 216667);
  assert.equal(
    leave.employees[0].insurableHours,
    88,
    "paid vacation hours counted once",
  );
  assert.equal(leave.employees[0].earnings.paidVacationMinutes, 5280);
  const salaryDraft = await invoke((c) =>
    payroll.saveDraftPortable(c, {
      societyId,
      input: { ...input, employeeIds: ["salary"] },
    }),
  );
  await invoke((c) =>
    payroll.approvePortable(c, { societyId, id: salaryDraft }),
  );
  const salaryRun = await invoke((c) =>
    payroll.finalizePortable(c, {
      societyId,
      id: salaryDraft,
      idempotencyKey: "salary-leave",
      postToLedger: true,
    }),
  );
  const salaryRow = await db.get(salaryRun, "payRuns");
  assert.equal(salaryRow!.lines[0].vacationPaidCents, 216667);
  assert.equal(
    (await db.get(request, "payrollVacationRequests"))!.status,
    "approved",
    "native payroll never decrements or changes time tracker independently",
  );
  const doubleSalary = await payroll.previewPortable(ctx(), {
    societyId,
    input: {
      ...input,
      employeeIds: ["salary"],
      runType: "bonus",
      vacationPayouts: [
        {
          employeeId: "salary",
          amountCents: 50000,
          sourceReference: "Cannot pay already funded salary absence again",
          treatment: "vacation_leave",
          vacationRequestId: request,
        },
      ],
    },
  });
  assert.ok(
    doubleSalary.blockers.some((b) =>
      b.includes("already funded by fixed salary"),
    ),
  );
  const badCashout = await payroll.previewPortable(ctx(), {
    societyId,
    input: {
      ...bonusInput,
      adjustments: [],
      vacationPayouts: [
        {
          employeeId: "covered",
          amountCents: 1000,
          sourceReference: "Actual unused vacation cashout",
          treatment: "unused_cashout",
          insurableMinutes: 480,
        },
      ],
    },
  });
  assert.ok(
    badCashout.blockers.some((b) =>
      b.includes("Unused vacation cashout does not create absence hours"),
    ),
  );
  const cashout = await payroll.previewPortable(ctx(), {
    societyId,
    input: {
      ...bonusInput,
      adjustments: [],
      vacationPayouts: [
        {
          employeeId: "covered",
          amountCents: 1000,
          sourceReference: "Actual unused vacation cashout",
          treatment: "unused_cashout",
          insurableMinutes: 0,
        },
      ],
    },
  });
  assert.deepEqual(cashout.blockers, []);
  assert.equal(cashout.employees[0].insurableHours, 0);
  const requestEmployee = await db.transaction(() =>
    db.insert("employees", {
      ...seed.employees[0],
      _id: undefined,
      firstName: "Hourly request",
    }),
  );
  await invoke((c) =>
    payroll.saveProfilePortable(c, {
      societyId,
      employeeId: requestEmployee,
      fields: {
        ...profile,
        employerOverrides: {
          eiEmployerMultiplier: 1.4,
          benefitsCentsPerPay: 0,
          pensionPercent: 0,
          evidence: "Actual group coverage/costs",
        },
      },
    }),
  );
  await invoke((c) =>
    payroll.saveOpeningBalancePortable(c, {
      societyId,
      employeeId: requestEmployee,
      fields: {
        year: 2026,
        coveredThroughDate: "2025-12-31",
        sameEmployerConfirmed: true,
        ytd: emptyPayrollYtd(),
        insurableHours: 0,
        cashPaidCents: 0,
        netPaidCents: 0,
        vacationBalanceCents: 100000,
        workSafeAssessableCents: 0,
        sickPaidDaysUsed: 0,
        sickUnpaidDaysUsed: 0,
        sourceReference: "Actual carried liability",
        representedPayRunIds: [],
      },
    }),
  );
  const actualRequest = await db.transaction(() =>
    db.insert("payrollVacationRequests", {
      societyId,
      employeeId: requestEmployee,
      status: "approved",
      days: [{ date: "2026-05-05", minutes: 480 }],
    }),
  );
  const requestInput: CalculationInput = {
    ...input,
    employeeIds: [requestEmployee],
    vacationPayouts: [
      {
        employeeId: requestEmployee,
        amountCents: 10000,
        sourceReference: "Actual approved hourly annual leave",
        treatment: "vacation_leave",
        vacationRequestId: actualRequest,
      },
    ],
  };
  const requestDraft = await invoke((c) =>
    payroll.saveDraftPortable(c, { societyId, input: requestInput }),
  );
  await invoke((c) =>
    payroll.approvePortable(c, { societyId, id: requestDraft }),
  );
  await invoke((c) =>
    payroll.finalizePortable(c, {
      societyId,
      id: requestDraft,
      idempotencyKey: "request-payout",
      postToLedger: true,
    }),
  );
  assert.equal(
    (await db.get(actualRequest, "payrollVacationRequests"))!
      .payrollPayoutCalculationId,
    requestDraft,
  );
  const duplicateRequest = await payroll.previewPortable(ctx(), {
    societyId,
    input: requestInput,
  });
  assert.ok(
    duplicateRequest.blockers.some((b) =>
      b.includes("already funded/its hours recorded"),
    ),
  );
  await invoke((c) =>
    payroll.reversePortable(c, {
      societyId,
      id: requestDraft,
      date: "2026-05-16",
      reason: "Unpaid source corrected",
      idempotencyKey: "unpaid-request-reversal",
    }),
  );
  assert.equal(
    (await db.get(actualRequest, "payrollVacationRequests"))!
      .payrollPayoutCalculationId,
    undefined,
  );
  assert.deepEqual(
    (await db.get(actualRequest, "payrollVacationRequests"))!
      .reversedPayrollPayoutCalculationIds,
    [requestDraft],
  );
  console.log(
    `${runtime}: mixed EI/benefit/pension groups, fixed bonus cost deduplication, actual per-run overrides, hourly accrued-vacation payment, salaried paid leave and immutable native register reconciliation passed`,
  );
}
