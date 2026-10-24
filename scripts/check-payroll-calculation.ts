import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import type {
  EmployerSettingsFields,
  EmployeeProfileFields,
  CalculationInput,
} from "../shared/payrollCalculation";
import { emptyPayrollYtd } from "../shared/payrollDeductions";
import * as payroll from "../shared/functions/payrollCalculation";
const societyId = "native_org",
  ownerId = "native_owner",
  employeeId = "native_employee";
const principal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: "native-owner",
  issuer: "https://native.test",
  userId: ownerId,
  societyId,
} as const;
const accounts = [
  ["wages", "Expense"],
  ["employer_cost", "Expense"],
  ["netpay", "Liability"],
  ["deductions", "Liability"],
  ["benefits", "Liability"],
  ["bank", "Bank"],
].map(([id, accountType]) => ({
  _id: id,
  societyId,
  name: id,
  accountType,
  currency: "CAD",
  connectionId: "connection",
  externalId: id,
  balanceCents: 0,
  isRestricted: false,
}));
const seed = {
  societies: [
    { _id: societyId, name: "Native payroll test", jurisdictionCode: "CA-BC" },
    { _id: "foreign", name: "Elsewhere" },
  ],
  users: [
    {
      _id: ownerId,
      societyId,
      role: "Owner",
      status: "Active",
      authSubject: principal.subject,
      authIssuer: principal.issuer,
    },
    { _id: "viewer", societyId, role: "Viewer", status: "Active" },
  ],
  employees: [
    {
      _id: employeeId,
      societyId,
      firstName: "Avery",
      lastName: "Worker",
      role: "Coordinator",
      startDate: "2025-02-01",
      birthDate: "1990-05-05",
      sinSecretVaultItemId: "NEVER-STORE-SIN",
      email: "NEVER-STORE-EMAIL",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    },
    {
      _id: "foreign_employee",
      societyId: "foreign",
      firstName: "Elsewhere",
      lastName: "Person",
    },
  ],
  financialAccounts: accounts,
  payrollSettings: [
    {
      _id: "settings",
      societyId,
      remitterType: "regular",
      payrollAccountNumber: "123456789RP0001",
      updatedAtISO: "2026-01-01T00:00:00Z",
    },
  ],
  fundRestrictions: [
    { _id: "fund", societyId, name: "Student program", status: "active" },
  ],
};
const employer: EmployerSettingsFields = {
  year: 2026,
  payFrequency: "semimonthly",
  payDates: Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    return [
      `2026-${month}-15`,
      new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10),
    ];
  }).flat(),
  eiEmployerMultiplier: 1.4,
  ehtEmployerClass: "ordinary",
  ehtOpeningRemunerationCents: 0,
  ehtOpeningThroughDate: "2025-12-31",
  ehtOpeningConfirmed: true,
  ehtOpeningSourceReference: "Confirmed zero same-employer year opening",
  ehtOpeningRepresentedPayRunIds: [],
  ehtAssociated: false,
  ehtPermanentEstablishmentDays: 365,
  workSafeRatePer100Dollars: 1.2,
  workSafeAssessableLimitCents: 12750000,
  workSafeClassificationCode: "reviewed",
  workSafeRateEvidence: "Actual reviewed annual net rate",
  employerBenefitsCentsPerPay: 0,
  employerPensionPercent: 0,
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
    declarationReference: "Employer recorded signed current TD1",
  },
  cpp: { exempt: false },
  eiExempt: false,
  fundingAllocations: [
    {
      label: "Student program",
      shareBps: 10000,
      fundRestrictionId: "fund",
      programCode: "STUDENT",
    },
  ],
};
const input: CalculationInput = {
  periodStart: "2026-05-01",
  periodEnd: "2026-05-15",
  payDate: "2026-05-15",
  runType: "regular",
  employeeIds: [employeeId],
  method: "option2",
};
function tracked(
  db: PortableMutationCtx["db"],
  caller: PortableMutationCtx["principal"] = principal,
) {
  let paginations = 0;
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === "query")
        return (table: string) => {
          const query = target.query(table);
          const wrapper = new Proxy(query, {
            get(inner, method) {
              const fn = Reflect.get(inner, method);
              if (typeof fn !== "function") return fn;
              return (...args: any[]) => {
                if (method === "paginate")
                  assert.ok(++paginations <= 1, "one paginate per invocation");
                const value = fn.apply(inner, args);
                return value === inner ? wrapper : value;
              };
            },
          });
          return wrapper;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: proxy,
    principal: caller,
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
  const invoke = <T>(fn: (ctx: PortableMutationCtx) => Promise<T>) =>
    db.transaction(() => fn(tracked(db)));
  await invoke((ctx) =>
    payroll.saveEmployerSettingsPortable(ctx, { societyId, fields: employer }),
  );
  const profileId = await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      employeeId,
      fields: profile,
    }),
  );
  const zero = emptyPayrollYtd();
  delete zero.regularFederalTaxCents;
  delete zero.regularProvincialTaxCents;
  delete zero.bonusFederalTaxCents;
  delete zero.bonusProvincialTaxCents;
  await invoke((ctx) =>
    payroll.saveOpeningBalancePortable(ctx, {
      societyId,
      employeeId,
      fields: {
        year: 2026,
        coveredThroughDate: "2025-12-31",
        sameEmployerConfirmed: true,
        ytd: zero,
        insurableHours: 0,
        cashPaidCents: 0,
        netPaidCents: 0,
        vacationBalanceCents: 10000,
        workSafeAssessableCents: 0,
        sickPaidDaysUsed: 0,
        sickUnpaidDaysUsed: 0,
        sourceReference:
          "Confirmed same-employer zero deductions; prior vacation liability",
        representedPayRunIds: [],
        provinceOfEmployment: "BC",
        employerCppCents: 0,
        employerCpp2Cents: 0,
      },
    }),
  );
  const workId = await invoke((ctx) =>
    payroll.saveWorkDayPortable(ctx, {
      societyId,
      employeeId,
      fields: {
        date: "2026-05-05",
        minutes: 480,
        historicalNonOvertimeWagesCents: 20000,
        workedOrEarned: true,
      },
    }),
  );
  const preview = await payroll.previewPortable(tracked(db), {
    societyId,
    input,
  });
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.totals.cashCents, 20000);
  assert.equal(preview.employees[0].allocations![0].fundRestrictionId, "fund");
  assert.equal(
    preview.employees[0].statement!.totals.employerCostCents,
    preview.totals.employerCostCents,
  );
  const json = JSON.stringify(preview);
  for (const secret of ["1990-05-05", "NEVER-STORE", "123456789RP0001"])
    assert.ok(!json.includes(secret), secret);
  const id = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, { societyId, input }),
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.finalizePortable(ctx, {
          societyId,
          id,
          idempotencyKey: "unapproved",
        }),
      ),
    /Approve/,
  );
  await invoke((ctx) =>
    payroll.approvePortable(ctx, { societyId, id, expectedVersion: 1 }),
  );
  await assert.rejects(
    () =>
      invoke((ctx) => payroll.saveDraftPortable(ctx, { societyId, id, input })),
    /cannot be overwritten/,
  );
  const runId = await invoke((ctx) =>
    payroll.finalizePortable(ctx, {
      societyId,
      id,
      idempotencyKey: "first-final",
      postToLedger: true,
    }),
  );
  assert.equal(
    await invoke((ctx) =>
      payroll.finalizePortable(ctx, {
        societyId,
        id,
        idempotencyKey: "first-final",
        postToLedger: true,
      }),
    ),
    runId,
  );
  assert.equal((await db.query("payRuns").collect()).length, 1);
  const run = await db.get(runId, "payRuns");
  assert.equal(run!.lines[0].insurableHours, 8);
  assert.ok(
    run!.lines[0].deductionYtdDelta.regularFederalTaxCents !== undefined,
  );
  assert.equal(
    (await db.get(workId, "payrollWorkDays"))!.postedCalculationId,
    id,
  );
  const journal = (await db.query("journalEntries").collect()).find(
    (e) => e.source === "payroll_accrual",
  )!;
  const lines = await db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("journalEntryId", journal._id))
    .collect();
  assert.equal(
    lines.reduce(
      (a, l) => a + (l.side === "debit" ? l.amountCents : -l.amountCents),
      0,
    ),
    0,
  );
  assert.ok(
    lines.some(
      (l) => l.fundRestrictionId === "fund" && l.programCode === "STUDENT",
    ),
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.saveWorkDayPortable(ctx, {
          societyId,
          id: workId,
          employeeId,
          fields: { date: "2026-05-05", minutes: 600 },
        }),
      ),
    /Finalized/,
  );
  const bonusCode = await invoke((ctx) =>
    payroll.saveEarningCodePortable(ctx, {
      societyId,
      fields: {
        code: "BONUS",
        name: "Bonus",
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
        classificationEvidence: "Ordinary employee bonus",
        active: true,
      },
    }),
  );
  const bonus = await payroll.previewPortable(tracked(db), {
    societyId,
    input: {
      ...input,
      runType: "bonus",
      adjustments: [
        {
          employeeId,
          earningCodeId: bonusCode,
          date: "2026-05-15",
          amountCents: 10000,
        },
      ],
    },
  });
  assert.deepEqual(bonus.blockers, []);
  assert.equal(bonus.totals.cashCents, 10000);
  assert.deepEqual(bonus.employees[0].workDayIds, []);
  assert.equal(bonus.employees[0].earnings.bases.taxableCents, 10000);
  const secondInput = {
    ...input,
    periodStart: "2026-05-16",
    periodEnd: "2026-05-31",
    payDate: "2026-05-31",
  };
  await invoke((ctx) =>
    payroll.saveWorkDayPortable(ctx, {
      societyId,
      employeeId,
      fields: {
        date: "2026-05-26",
        minutes: 480,
        historicalNonOvertimeWagesCents: 20000,
        workedOrEarned: true,
      },
    }),
  );
  const second = await payroll.previewPortable(tracked(db), {
    societyId,
    input: secondInput,
  });
  assert.deepEqual(
    second.blockers,
    [],
    "second Option2 uses actual known splits from blank-split zero opening",
  );
  assert.equal(second.employees[0].ytdBefore.cppCents, run!.cppEmployeeCents);
  const staleId = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, { societyId, input: secondInput }),
  );
  await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      id: profileId,
      employeeId,
      fields: { ...profile, rateCents: 2600 },
    }),
  );
  await assert.rejects(
    () =>
      invoke((ctx) => payroll.approvePortable(ctx, { societyId, id: staleId })),
    /source data changed/,
  );
  await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      id: profileId,
      employeeId,
      fields: profile,
    }),
  );
  await db.transaction(() =>
    db.insert("booksSettings", { societyId, closeDate: "2026-05-31" }),
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.reversePortable(ctx, {
          societyId,
          id,
          date: "2026-05-20",
          reason: "Void unpaid payroll",
          idempotencyKey: "reverse",
        }),
      ),
    /closed books/,
  );
  const books = (await db.query("booksSettings").collect())[0];
  await db.transaction(() => db.delete(books._id));
  const laterProvider = await db.transaction(() =>
    db.insert("payRuns", {
      societyId,
      payDate: "2026-05-18",
      periodStart: "2026-05-16",
      periodEnd: "2026-05-18",
      source: "import",
      lines: [{ employeeId }],
      createdAtISO: "2026-05-18T00:00:00Z",
    }),
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.reversePortable(ctx, {
          societyId,
          id,
          date: "2026-05-20",
          reason: "Later provider dependency",
          idempotencyKey: "blocked-provider-reverse",
        }),
      ),
    /Later recorded payroll/,
  );
  await db.transaction(() => db.delete(laterProvider));
  const reversed = await invoke((ctx) =>
    payroll.reversePortable(ctx, {
      societyId,
      id,
      date: "2026-05-20",
      reason: "Void unpaid payroll",
      idempotencyKey: "reverse",
    }),
  );
  assert.equal(
    await invoke((ctx) =>
      payroll.reversePortable(ctx, {
        societyId,
        id,
        date: "2026-05-20",
        reason: "Void unpaid payroll",
        idempotencyKey: "reverse",
      }),
    ),
    reversed,
  );
  const mirror = await db.get(reversed, "payRuns");
  assert.equal(mirror!.grossCents, -run!.grossCents);
  assert.equal((await db.get(id, "payrollCalculations"))!.status, "reversed");
  assert.equal(
    (await db.get(workId, "payrollWorkDays"))!.postedCalculationId,
    undefined,
  );
  const replacement = {
    ...input,
    runType: "correction" as const,
    correctionOfId: id,
    payDate: "2026-05-22",
  };
  const replacementId = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, { societyId, input: replacement }),
  );
  const replacementDetail = await payroll.workspacePortable(tracked(db), {
    societyId,
    collection: "calculation",
    id: replacementId,
  });
  assert.deepEqual(replacementDetail.detail!.result.blockers, []);
  await invoke((ctx) =>
    payroll.approvePortable(ctx, { societyId, id: replacementId }),
  );
  const replacementRun = await invoke((ctx) =>
    payroll.finalizePortable(ctx, {
      societyId,
      id: replacementId,
      idempotencyKey: "replacement",
      postToLedger: true,
    }),
  );
  const net = (await db.get(replacementRun, "payRuns"))!.netCents;
  const newNetAccount = await db.transaction(() =>
    db.insert("financialAccounts", {
      ...accounts.find((a) => a._id === "netpay"),
      _id: undefined,
      name: "New net wages payable",
    }),
  );
  await invoke((ctx) =>
    payroll.saveEmployerSettingsPortable(ctx, {
      societyId,
      fields: {
        ...employer,
        ledger: { ...employer.ledger, netPayLiabilityAccountId: newNetAccount },
      },
    }),
  );
  const txn = await db.transaction(() =>
    db.insert("financialTransactions", {
      societyId,
      accountId: "bank",
      date: "2026-05-22",
      description: "Recorded net wages",
      amountCents: -net,
      status: "posted",
    }),
  );
  const backfill = await db.transaction(() =>
    db.insert("journalEntries", {
      societyId,
      date: "2026-05-22",
      source: "financialTransactionBackfill",
      status: "posted",
      memo: "Original bank classification",
      basis: "both",
    }),
  );
  await db.transaction(async () => {
    await db.insert("journalLines", {
      societyId,
      journalEntryId: backfill,
      accountId: "wages",
      amountCents: net,
      side: "debit",
      financialTransactionId: txn,
    });
    await db.insert("journalLines", {
      societyId,
      journalEntryId: backfill,
      accountId: "bank",
      amountCents: net,
      side: "credit",
      financialTransactionId: txn,
    });
  });
  await invoke((ctx) =>
    payroll.recordPaymentPortable(ctx, {
      societyId,
      id: replacementId,
      transactionId: txn,
      date: "2026-05-22",
      reference: "Payment reference",
      method: "bank_transfer",
      payee: "Avery Worker",
      destinationReference: "Employee nominated destination",
      idempotencyKey: "record-payment",
      postToLedger: true,
    }),
  );
  assert.equal(
    (await db.get(txn, "financialTransactions"))!.matchedId,
    replacementRun,
  );
  assert.equal(
    (await db.get(txn, "financialTransactions"))!.matchedKind,
    "payroll",
  );
  const paidSnapshot = await db.get(replacementId, "payrollCalculations");
  assert.equal(paidSnapshot!.ledgerSnapshot.netPayLiabilityAccountId, "netpay");
  const settlementLines = await db
    .query("journalLines")
    .withIndex("by_entry", (q) =>
      q.eq("journalEntryId", paidSnapshot!.payments[0].journalEntryId),
    )
    .collect();
  assert.ok(
    settlementLines.some((l) => l.side === "debit" && l.accountId === "netpay"),
  );
  assert.ok(!settlementLines.some((l) => l.accountId === newNetAccount));
  const bankLines = await db
    .query("journalLines")
    .withIndex("by_account", (q) => q.eq("accountId", "bank"))
    .collect();
  assert.equal(
    bankLines.reduce(
      (a, l) => a + (l.side === "credit" ? l.amountCents : -l.amountCents),
      0,
    ),
    net,
    "original bank classification plus dated mirror plus settlement counts cash once",
  );
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.reversePortable(ctx, {
          societyId,
          id: replacementId,
          date: "2026-05-31",
          reason: "Cannot erase paid wages",
          idempotencyKey: "paid-reverse",
        }),
      ),
    /actual recorded bank payment/,
  );
  await assert.rejects(
    () =>
      payroll.previewPortable(tracked(db), {
        societyId,
        input: { ...input, employeeIds: ["foreign_employee"] },
      }),
    /not found/,
  );
  await assert.rejects(
    () =>
      payroll.saveWorkDayPortable(
        tracked(db, { ...principal, userId: "viewer", subject: "viewer" }),
        { societyId, employeeId, fields: { date: "2026-06-02", minutes: 480 } },
      ),
    /permission|not allowed|denied|Forbidden/i,
  );
  const finalEmployee = await db.transaction(() =>
    db.insert("employees", {
      ...seed.employees[0],
      _id: undefined,
      firstName: "Final",
      lastName: "Worker",
      endDate: "2026-06-15",
    }),
  );
  await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      employeeId: finalEmployee,
      fields: profile,
    }),
  );
  await invoke((ctx) =>
    payroll.saveOpeningBalancePortable(ctx, {
      societyId,
      employeeId: finalEmployee,
      fields: {
        year: 2026,
        coveredThroughDate: "2025-12-31",
        sameEmployerConfirmed: true,
        ytd: emptyPayrollYtd(),
        insurableHours: 0,
        cashPaidCents: 0,
        netPaidCents: 0,
        vacationBalanceCents: 10000,
        workSafeAssessableCents: 0,
        sickPaidDaysUsed: 0,
        sickUnpaidDaysUsed: 0,
        sourceReference: "Prior retained vacation liability",
        representedPayRunIds: [],
        provinceOfEmployment: "BC",
        employerCppCents: 0,
        employerCpp2Cents: 0,
      },
    }),
  );
  await invoke((ctx) =>
    payroll.saveWorkDayPortable(ctx, {
      societyId,
      employeeId: finalEmployee,
      fields: { date: "2026-06-02", minutes: 480 },
    }),
  );
  const finalInput: CalculationInput = {
    ...input,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    payDate: "2026-06-15",
    runType: "final",
    employeeIds: [finalEmployee],
    termination: {
      at: "2026-06-15T12:00:00-07:00",
      initiatedBy: "employer",
      paidAt: "2026-06-15T14:00:00-07:00",
    },
  };
  const finalPreview = await payroll.previewPortable(tracked(db), {
    societyId,
    input: finalInput,
  });
  assert.deepEqual(finalPreview.blockers, []);
  assert.equal(finalPreview.totals.cashCents, 30800);
  assert.equal(
    finalPreview.employees[0].priorVacationLiabilityReleasedCents,
    10000,
  );
  assert.equal(finalPreview.employees[0].earnings.vacationAccruedCents, 0);
  assert.equal(finalPreview.employees[0].currentVacationPaidCents, 800);
  assert.equal(
    finalPreview.employees[0]
      .statement!.employerCosts.find((c) => c.amountCents === -10000)!
      .label.includes("liability"),
    true,
  );
  const finalId = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, { societyId, input: finalInput }),
  );
  await invoke((ctx) =>
    payroll.approvePortable(ctx, { societyId, id: finalId }),
  );
  const finalRunId = await invoke((ctx) =>
    payroll.finalizePortable(ctx, {
      societyId,
      id: finalId,
      idempotencyKey: "final-vacation",
      postToLedger: true,
    }),
  );
  const finalRun = await db.get(finalRunId, "payRuns");
  assert.equal(finalRun!.lines[0].vacationAccruedCents, 800);
  assert.equal(finalRun!.lines[0].vacationPaidCents, 10800);
  const finalSnapshot = await db.get(finalId, "payrollCalculations");
  const finalJournalLines = await db
    .query("journalLines")
    .withIndex("by_entry", (q) =>
      q.eq("journalEntryId", finalSnapshot!.journalEntryIds[0]),
    )
    .collect();
  assert.equal(
    finalJournalLines.reduce(
      (a, l) => a + (l.side === "debit" ? l.amountCents : -l.amountCents),
      0,
    ),
    0,
  );
  assert.ok(
    finalJournalLines.some(
      (l) =>
        l.accountId === "benefits" &&
        l.side === "debit" &&
        l.amountCents === 10000,
    ),
  );
  const salaryEmployee = await db.transaction(() =>
    db.insert("employees", {
      ...seed.employees[0],
      _id: undefined,
      firstName: "Salary",
    }),
  );
  await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      employeeId: salaryEmployee,
      fields: { ...profile, compensation: "annual", rateCents: 5200000 },
    }),
  );
  for (const date of [
    "2026-06-01",
    "2026-06-02",
    "2026-06-03",
    "2026-06-04",
    "2026-06-05",
    "2026-06-08",
    "2026-06-09",
    "2026-06-10",
    "2026-06-11",
    "2026-06-12",
    "2026-06-15",
  ])
    await invoke((ctx) =>
      payroll.saveWorkDayPortable(ctx, {
        societyId,
        employeeId: salaryEmployee,
        fields: { date, minutes: date === "2026-06-05" ? 600 : 480 },
      }),
    );
  const salary = await payroll.previewPortable(tracked(db), {
    societyId,
    input: {
      ...finalInput,
      runType: "regular",
      employeeIds: [salaryEmployee],
      termination: undefined,
    },
  });
  assert.deepEqual(salary.blockers, []);
  assert.equal(
    salary.employees[0].earningsInput.salary!.coveredStraightTimeMinutes,
    5280,
  );
  assert.equal(salary.employees[0].insurableHours, 90);
  assert.ok(
    salary.employees[0].earnings.lines.some((l) => l.kind === "overtime"),
  );
  const shortEmployee = await db.transaction(() =>
    db.insert("employees", {
      ...seed.employees[0],
      _id: undefined,
      firstName: "Short final",
      endDate: "2026-06-21",
    }),
  );
  await invoke((ctx) =>
    payroll.saveProfilePortable(ctx, {
      societyId,
      employeeId: shortEmployee,
      fields: {
        ...profile,
        compensation: "annual",
        rateCents: 5200000,
        salaryProration: {
          basis: "calendar_days",
          reviewed: true,
          evidence:
            "Reviewed employment contract specifies calendar-day proration",
        },
      },
    }),
  );
  for (const date of ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"])
    await invoke((ctx) =>
      payroll.saveWorkDayPortable(ctx, {
        societyId,
        employeeId: shortEmployee,
        fields: { date, minutes: 480 },
      }),
    );
  await invoke((ctx) =>
    payroll.saveOpeningBalancePortable(ctx, {
      societyId,
      employeeId: shortEmployee,
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
        sourceReference: "Reviewed explicit zero carried vacation liability",
        representedPayRunIds: [],
      },
    }),
  );
  const shortInput: CalculationInput = {
    ...finalInput,
    employeeIds: [shortEmployee],
    periodStart: "2026-06-16",
    periodEnd: "2026-06-21",
    payDate: "2026-06-21",
    regularPayDate: "2026-06-30",
    termination: {
      at: "2026-06-21T12:00:00-07:00",
      initiatedBy: "employer",
      paidAt: "2026-06-21T14:00:00-07:00",
    },
  };
  const short = await payroll.previewPortable(tracked(db), {
    societyId,
    input: shortInput,
  });
  assert.deepEqual(short.blockers, []);
  assert.equal(short.input.regularPayDate, "2026-06-30");
  assert.equal(
    short.employees[0].deductions!.input.periodNumber,
    12,
    "early final uses explicit upcoming regular period rather than elapsed11",
  );
  assert.equal(
    short.employees[0].earningsInput.salary!.calendarPeriodEnd,
    "2026-06-30",
  );
  assert.equal(
    short.employees[0].earningsInput.salary!.periodSalaryCents,
    86667,
  );
  const ambiguous = await payroll.previewPortable(tracked(db), {
    societyId,
    input: { ...shortInput, regularPayDate: undefined },
  });
  assert.ok(
    ambiguous.blockers.some((b) =>
      b.includes("Select the applicable regular pay date"),
    ),
  );
  const badCalendar = await payroll.previewPortable(tracked(db), {
    societyId,
    input: { ...shortInput, regularPayDate: "2026-06-29" },
  });
  assert.ok(
    badCalendar.blockers.some((b) =>
      b.includes("saved actual annual calendar"),
    ),
  );
  const unknownRules = await payroll.previewPortable(tracked(db), {
    societyId,
    input: {
      ...input,
      periodStart: "2027-01-01",
      periodEnd: "2027-01-15",
      payDate: "2027-01-15",
    },
  });
  assert.ok(unknownRules.blockers.some((b) => b.includes("2027")));
  const extraRunIds: string[] = [];
  await db.transaction(async () => {
    for (let i = 0; i < 101; i++)
      extraRunIds.push(
        await db.insert("payRuns", {
          societyId,
          payDate: "2026-01-15",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-15",
          lines: [],
          source: "import",
        }),
      );
  });
  const overflow = await payroll.previewPortable(tracked(db), {
    societyId,
    input,
  });
  assert.ok(overflow.blockers.some((b) => b.includes("complete 100-run")));
  await db.transaction(async () => {
    for (const id of extraRunIds) await db.delete(id);
  });
  const financeOnly = {
    kind: "service",
    runtime: "test",
    assurance: "trusted-internal",
    subject: "finance-only",
    actorUserId: ownerId,
    societyId,
    scopes: ["financials:read", "financials:write"],
  } as const;
  await payroll.workspacePortable(tracked(db, financeOnly), {
    societyId,
    collection: "employer",
    year: 2026,
  });
  await assert.rejects(
    () =>
      payroll.workspacePortable(tracked(db, financeOnly), {
        societyId,
        collection: "employees",
      }),
    /employees:read/,
  );
  await assert.rejects(
    () =>
      payroll.previewPortable(tracked(db, financeOnly), { societyId, input }),
    /employees:read/,
  );
  const employeePicker = await payroll.workspacePortable(tracked(db), {
    societyId,
    collection: "employees",
  });
  assert.ok(!JSON.stringify(employeePicker).includes("NEVER-STORE"));
  assert.ok(!JSON.stringify(employeePicker).includes("1990-05-05"));
  const salaryDraft = await invoke((ctx) =>
    payroll.saveDraftPortable(ctx, {
      societyId,
      input: {
        ...finalInput,
        runType: "regular",
        employeeIds: [salaryEmployee],
        termination: undefined,
      },
    }),
  );
  await invoke((ctx) =>
    payroll.approvePortable(ctx, { societyId, id: salaryDraft }),
  );
  const usdAr = await db.transaction(() =>
    db.insert("financialAccounts", {
      ...accounts[0],
      _id: undefined,
      name: "USD receivable",
      accountType: "Asset",
      subtype: "receivable",
      code: "1100",
      currency: "USD",
    }),
  );
  const usdSettings = await db.transaction(() =>
    db.insert("invoiceSettings", { societyId, receivableAccountId: usdAr }),
  );
  const runCountBefore = (await db.query("payRuns").collect()).length;
  await assert.rejects(
    () =>
      invoke((ctx) =>
        payroll.finalizePortable(ctx, {
          societyId,
          id: salaryDraft,
          idempotencyKey: "foreign-books",
          postToLedger: true,
        }),
      ),
    /CAD books/,
  );
  assert.equal(
    (await db.query("payRuns").collect()).length,
    runCountBefore,
    "failed FX posting atomically rolls back native register insertion",
  );
  assert.equal(
    (await db.get(salaryDraft, "payrollCalculations"))!.status,
    "approved",
  );
  await db.transaction(async () => {
    await db.delete(usdSettings);
    await db.delete(usdAr);
  });
  console.log(
    `${runtime}: native payroll snapshots, source freshness, YTD, approvals, idempotency, allocated balanced accrual, dated reversal, actual bank provenance and privacy passed`,
  );
}
