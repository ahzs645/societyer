import type { PortableMutationCtx } from "../portable/ctx";
import type {
  CalculationInput,
  EmployerSettingsFields,
  PayrollPaymentMethod,
} from "../payrollCalculation";
import { getOwned } from "./access";
import {
  payrollDate,
  payrollJson,
  payrollText,
} from "../payrollCalculationValidation";
import {
  buildPayrollPreview,
  payrollFingerprint,
  payrollYtdDelta,
} from "./payrollCalculationAdapter";
import {
  payrollActor,
  payrollBounded,
  payrollHydrate,
  payrollWrite,
  type PayrollRow,
} from "./payrollCalculationData";
import {
  assertPayrollBooksOpen,
  payrollAccrualLines,
  payrollLedgerMappings,
  payrollMirror,
  payrollPaymentJournal,
  payrollPost,
} from "./payrollCalculationLedger";
import { refreshPayrollRegister } from "./businessRegisters";
const AMOUNTS = [
  "grossCents",
  "nonCashTaxableCents",
  "nonTaxableCashCents",
  "cppEmployeeCents",
  "cpp2EmployeeCents",
  "eiEmployeeCents",
  "incomeTaxCents",
  "federalTaxCents",
  "provincialTaxCents",
  "additionalIncomeTaxCents",
  "otherDeductionsCents",
  "cppEmployerCents",
  "cpp2EmployerCents",
  "eiEmployerCents",
  "netCents",
];
const at = () => new Date().toISOString();
async function employerFor(
  ctx: PortableMutationCtx,
  societyId: string,
  year: number,
) {
  const rows = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollEmployerProfiles")
      .withIndex("by_society_year", (q) =>
        q.eq("societyId", societyId).eq("year", year),
      ),
    1,
    "Employer year settings",
  );
  if (!rows[0]) throw new Error("Employer year settings are missing.");
  return rows[0] as PayrollRow & EmployerSettingsFields;
}
function assertPayable(row: PayrollRow) {
  const result = JSON.parse(row.resultJson);
  if (
    result.blockers.length ||
    result.employees.length !== row.employeeIds.length ||
    result.employees.some(
      (e: any) => !e.deductions || !e.employerCosts || e.blockers.length,
    )
  )
    throw new Error(
      "Resolve every calculation blocker before approval/finalization.",
    );
  return result;
}
async function current(ctx: PortableMutationCtx, row: PayrollRow) {
  const result = await buildPayrollPreview(
    ctx,
    { societyId: row.societyId, input: JSON.parse(row.inputJson) },
    row._id,
  );
  if (result.sourceFingerprint !== row.sourceFingerprint)
    throw new Error(
      "Payroll source data changed after review. Save a fresh draft and approve its new snapshot.",
    );
  if ((await payrollFingerprint(result)) !== row.resultFingerprint)
    throw new Error(
      "Payroll calculation rules or result changed after review. Save and review a fresh draft.",
    );
  return result;
}
export async function saveDraftPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id?: string; input: CalculationInput },
) {
  await payrollWrite(ctx, args.societyId);
  const old = args.id
    ? await getOwned<PayrollRow>(
        ctx,
        "payrollCalculations",
        args.id,
        args.societyId,
      )
    : null;
  if (old && old.status !== "draft")
    throw new Error(
      "Approved/finalized payroll snapshots cannot be overwritten. Create a new draft for changed sources.",
    );
  const result = await buildPayrollPreview(ctx, args, old?._id),
    stamp = at(),
    actor = await payrollActor(ctx, args.societyId);
  const data = {
    societyId: args.societyId,
    year: Number(result.input.payDate.slice(0, 4)),
    periodStart: result.input.periodStart,
    periodEnd: result.input.periodEnd,
    payDate: result.input.payDate,
    runType: result.input.runType,
    employeeIds: result.input.employeeIds,
    status: "draft",
    inputJson: payrollJson(result.input, 100000),
    resultJson: payrollJson(result, 750000),
    sourceFingerprint: result.sourceFingerprint,
    resultFingerprint: await payrollFingerprint(result),
    version: (old?.version ?? 0) + 1,
    createdAtISO: old?.createdAtISO ?? stamp,
    createdByUserId: old?.createdByUserId ?? actor,
    updatedAtISO: stamp,
    updatedByUserId: actor,
    ...(result.input.correctionOfId
      ? { correctionOfId: result.input.correctionOfId }
      : {}),
  };
  if (old) {
    await ctx.db.replace(old._id, data);
    return old._id;
  }
  return ctx.db.insert("payrollCalculations", data);
}
export async function approvePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id: string; expectedVersion?: number },
) {
  await payrollWrite(ctx, args.societyId);
  const row = await getOwned<PayrollRow>(
    ctx,
    "payrollCalculations",
    args.id,
    args.societyId,
  );
  if (
    args.expectedVersion !== undefined &&
    row.version !== args.expectedVersion
  )
    throw new Error(
      "This payroll version changed; reopen the current snapshot before approving.",
    );
  if (row.status === "approved") return row._id;
  if (row.status !== "draft") throw new Error("Only a draft can be approved.");
  assertPayable(row);
  await current(ctx, row);
  await ctx.db.patch(row._id, {
    status: "approved",
    approvedAtISO: at(),
    approvedByUserId: await payrollActor(ctx, args.societyId),
    updatedAtISO: at(),
  });
  return row._id;
}
function runLine(e: any) {
  const d = e.deductions,
    lines = e.earnings.lines;
  const delta = payrollYtdDelta(e.ytdBefore, e.ytdAfter);
  const nonCash = lines
      .filter((l: any) => !l.cash && l.taxable)
      .reduce((a: number, l: any) => a + l.amountCents, 0),
    nonTax = lines
      .filter((l: any) => l.cash && !l.taxable)
      .reduce((a: number, l: any) => a + l.amountCents, 0);
  const hours =
    (e.earnings.minutes.regular +
      e.earnings.minutes.overtime15 +
      e.earnings.minutes.overtime2 +
      e.earningsInput.workDays
        .filter(
          (w: any) =>
            w.date >= e.earningsInput.periodStart &&
            w.date <= e.earningsInput.periodEnd,
        )
        .reduce(
          (a: number, w: any) => a + (e.paidLeaveMinutesByDate?.[w.date] ?? 0),
          0,
        )) /
    60;
  return {
    ...(e.ehtLocationId
      ? {
          ehtLocationId: e.ehtLocationId,
          ehtAttributionBasis: e.ehtAttributionBasis,
          ehtAttributionEvidence: e.ehtAttributionEvidence,
        }
      : {}),
    employeeId: e.employeeId,
    employeeName: e.employeeName,
    provinceOfEmployment: e.provinceOfEmployment,
    grossCents: e.earnings.bases.taxableCents,
    nonCashTaxableCents: nonCash,
    nonTaxableCashCents: nonTax,
    cppEmployeeCents: d.cppEmployeeCents,
    cpp2EmployeeCents: d.cpp2EmployeeCents,
    eiEmployeeCents: d.eiEmployeeCents,
    incomeTaxCents: d.incomeTaxCents,
    ...(d.federalTaxCents === null
      ? {}
      : { federalTaxCents: d.federalTaxCents }),
    ...(d.provincialTaxCents === null
      ? {}
      : { provincialTaxCents: d.provincialTaxCents }),
    additionalIncomeTaxCents: d.additionalIncomeTaxCents,
    otherDeductionsCents:
      d.totalDeductionsCents -
      d.cppEmployeeCents -
      d.cpp2EmployeeCents -
      d.eiEmployeeCents -
      d.incomeTaxCents,
    cppEmployerCents: d.cppEmployerCents,
    cpp2EmployerCents: d.cpp2EmployerCents,
    eiEmployerCents: d.eiEmployerCents,
    netCents: d.netCashCents,
    deductionYtdDelta: delta,
    classifiedBases: e.earnings.bases,
    regularClassifiedBases: e.earnings.regularBases,
    bonusClassifiedBases: e.earnings.bonusBases,
    ...(e.insurableHoursComplete === false
      ? {}
      : { insurableHours: e.insurableHours ?? hours }),
    vacationAccruedCents:
      e.earnings.vacationAccruedCents + (e.currentVacationPaidCents ?? 0),
    vacationPaidCents:
      (e.priorVacationLiabilityReleasedCents ?? 0) +
      (e.currentVacationPaidCents ?? 0),
    sickPaidDaysUsed:
      (e.earnings.sickBank?.paidDaysUsed ?? 0) -
      (e.earningsInput.sickBank?.paidDaysUsed ?? 0),
    sickUnpaidDaysUsed:
      (e.earnings.sickBank?.unpaidDaysUsed ?? 0) -
      (e.earningsInput.sickBank?.unpaidDaysUsed ?? 0),
  };
}
function runTotals(lines: any[]) {
  const totals: Record<string, number> = {};
  for (const key of AMOUNTS) {
    if (lines.every((l) => l[key] !== undefined))
      totals[key] = lines.reduce((a, l) => a + l[key], 0);
  }
  return totals;
}
export async function finalizePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    idempotencyKey: string;
    postToLedger?: boolean;
  },
) {
  await payrollWrite(ctx, args.societyId);
  const key = payrollText(args.idempotencyKey, "Finalization key", 200),
    row = await getOwned<PayrollRow>(
      ctx,
      "payrollCalculations",
      args.id,
      args.societyId,
    );
  if (row.status === "finalized" || row.status === "reversed") {
    if (row.finalizeKey !== key)
      throw new Error(
        "This snapshot was already finalized with a different key; use its retained result.",
      );
    return row.payRunId;
  }
  if (row.status !== "approved")
    throw new Error("Approve the concrete payroll snapshot before finalizing.");
  const duplicate = await ctx.db
    .query<PayrollRow>("payrollCalculations")
    .withIndex("by_society_finalize_key", (q) =>
      q.eq("societyId", args.societyId).eq("finalizeKey", key),
    )
    .first();
  if (duplicate && duplicate._id !== row._id)
    throw new Error("That finalization key belongs to another calculation.");
  assertPayable(row);
  const result = await current(ctx, row);
  await assertPayrollBooksOpen(ctx, args.societyId, row.payDate);
  const employer = await employerFor(ctx, args.societyId, row.year),
    lines = result.employees.map(runLine),
    stamp = at();
  const payRunId = await ctx.db.insert("payRuns", {
    societyId: args.societyId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: row.payDate,
    ...runTotals(lines),
    lines,
    source: "native",
    providerName: "Societyer reviewed native BC",
    providerRunId: `native:${row._id}`,
    runType: row.runType,
    calculationId: row._id,
    ...(row.correctionOfId
      ? {
          correctsRunId: (
            await getOwned<PayrollRow>(
              ctx,
              "payrollCalculations",
              row.correctionOfId,
              args.societyId,
            )
          ).payRunId,
        }
      : {}),
    createdAtISO: stamp,
    updatedAtISO: stamp,
  });
  const journalEntryIds: string[] = [];
  if (args.postToLedger) {
    const mappings = await payrollLedgerMappings(ctx, args.societyId, employer);
    const id = await payrollPost(ctx, {
      societyId: args.societyId,
      date: row.payDate,
      source: "payroll_accrual",
      key: `payroll:${row._id}:accrual`,
      memo: `Payroll accrued ${row.periodStart}–${row.periodEnd}`,
      basis: "accrual-only",
      lines: payrollAccrualLines(result, mappings),
    });
    if (id) journalEntryIds.push(id);
  }
  for (const e of result.employees)
    for (const id of e.workDayIds) {
      const day = await getOwned<PayrollRow>(
        ctx,
        "payrollWorkDays",
        id,
        args.societyId,
      );
      if (day.postedCalculationId && day.postedCalculationId !== row._id)
        throw new Error("Work was finalized by another calculation.");
      await ctx.db.patch(id, { postedCalculationId: row._id });
    }
  for (const payout of result.input.vacationPayouts ?? []) {
    if (!payout.vacationRequestId) continue;
    const request = await getOwned<PayrollRow>(
      ctx,
      "payrollVacationRequests",
      payout.vacationRequestId,
      args.societyId,
    );
    if (
      request.payrollPayoutCalculationId &&
      request.payrollPayoutCalculationId !== row._id
    )
      throw new Error(
        "This actual leave request already belongs to another retained payroll payout.",
      );
    await ctx.db.patch(request._id, { payrollPayoutCalculationId: row._id });
  }
  await ctx.db.patch(row._id, {
    status: "finalized",
    finalizeKey: key,
    payRunId,
    journalEntryIds,
    ...(args.postToLedger ? { ledgerSnapshot: employer.ledger } : {}),
    finalizedAtISO: stamp,
    finalizedByUserId: await payrollActor(ctx, args.societyId),
    updatedAtISO: stamp,
  });
  await refreshPayrollRegister(ctx, args.societyId);
  return payRunId;
}
export async function reversePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    date: string;
    reason: string;
    idempotencyKey: string;
  },
) {
  await payrollWrite(ctx, args.societyId);
  const row = await getOwned<PayrollRow>(
      ctx,
      "payrollCalculations",
      args.id,
      args.societyId,
    ),
    date = payrollDate(args.date),
    reason = payrollText(args.reason, "Reversal reason", 2000),
    key = payrollText(args.idempotencyKey, "Reversal key", 200);
  if (row.status === "reversed") {
    if (
      row.reversalKey !== key ||
      row.reversedDate !== date ||
      row.reversalReason !== reason
    )
      throw new Error(
        "This snapshot already has a different retained reversal.",
      );
    return row.reversalPayRunId;
  }
  if (row.status !== "finalized" || !row.payRunId)
    throw new Error("Only finalized payroll can be reversed.");
  if (row.payments?.length)
    throw new Error(
      "This payroll has an actual recorded bank payment. A paid wage cannot be erased from YTD or remittances by reversing an accrual; document repayment/cancellation and use a reviewed payroll correction workflow.",
    );
  if (date < row.payDate || Number(date.slice(0, 4)) !== row.year)
    throw new Error(
      "A native reversal must be dated on/after the original pay date in the same payment year. Cross-year amended returns require reviewed provider correction.",
    );
  await assertPayrollBooksOpen(ctx, args.societyId, date);
  const original = await getOwned<PayrollRow>(
    ctx,
    "payRuns",
    row.payRunId,
    args.societyId,
  );
  const later = await ctx.db
    .query<PayrollRow>("payRuns")
    .withIndex("by_society_pay_date", (q) =>
      q
        .eq("societyId", args.societyId)
        .gte("payDate", row.payDate)
        .lte("payDate", `${row.year}-12-31`),
    )
    .paginate({ numItems: 100, cursor: null, maximumBytesRead: 4000000 });
  if (!later.isDone)
    throw new Error(
      "The complete dependent payroll source exceeds the 100-run/4 MB reversal bound; reconcile later runs explicitly before reversal.",
    );
  if (
    later.page.some(
      (run) =>
        run._id !== original._id &&
        !run.reversedDate &&
        run.source !== "native_reversal" &&
        (!run.lines?.length ||
          run.lines.some(
            (line: any) =>
              !line.employeeId || row.employeeIds.includes(line.employeeId),
          )) &&
        (run.payDate > row.payDate ||
          (run._creationTime ?? 0) > (original._creationTime ?? 0) ||
          String(run.createdAtISO ?? "") >=
            String(original.createdAtISO ?? "")),
    )
  )
    throw new Error(
      "Later recorded payroll depends on these YTD contributions. Reverse/correct those later employee runs first, including provider imports.",
    );
  const lines = original.lines.map((line: any) => ({
    ...line,
    ...Object.fromEntries(
      AMOUNTS.filter((k) => line[k] !== undefined).map((k) => [k, -line[k]]),
    ),
    deductionYtdDelta: Object.fromEntries(
      Object.entries(line.deductionYtdDelta).map(([k, v]) => [
        k,
        -(v as number),
      ]),
    ),
    classifiedBases: Object.fromEntries(
      Object.entries(line.classifiedBases).map(([k, v]) => [k, -(v as number)]),
    ),
    ...(line.regularClassifiedBases
      ? {
          regularClassifiedBases: Object.fromEntries(
            Object.entries(line.regularClassifiedBases).map(([k, v]) => [
              k,
              -(v as number),
            ]),
          ),
        }
      : {}),
    ...(line.bonusClassifiedBases
      ? {
          bonusClassifiedBases: Object.fromEntries(
            Object.entries(line.bonusClassifiedBases).map(([k, v]) => [
              k,
              -(v as number),
            ]),
          ),
        }
      : {}),
    ...(line.insurableHours === undefined
      ? {}
      : { insurableHours: -line.insurableHours }),
    vacationAccruedCents: -(line.vacationAccruedCents ?? 0),
    vacationPaidCents: -(line.vacationPaidCents ?? 0),
    sickPaidDaysUsed: -(line.sickPaidDaysUsed ?? 0),
    sickUnpaidDaysUsed: -(line.sickUnpaidDaysUsed ?? 0),
  }));
  const stamp = at();
  const reversalPayRunId = await ctx.db.insert("payRuns", {
    societyId: args.societyId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: date,
    ...runTotals(lines),
    lines,
    source: "native_reversal",
    providerName: "Societyer reviewed native BC",
    providerRunId: `native-reversal:${row._id}`,
    runType: "correction",
    correctsRunId: original._id,
    calculationId: row._id,
    notes: `${reason}${row.payments?.length ? " Recorded bank payments remain actual cash settlements; review employee recovery/overpayment separately." : ""}`,
    createdAtISO: stamp,
    updatedAtISO: stamp,
  });
  const reversalJournalEntryIds: string[] = [];
  for (const id of row.journalEntryIds ?? []) {
    const mirror = await payrollMirror(
      ctx,
      args.societyId,
      id,
      date,
      `payroll:${row._id}:reversal:${id}`,
      `Payroll reversal: ${reason}`,
    );
    if (mirror) reversalJournalEntryIds.push(mirror);
  }
  const result = JSON.parse(row.resultJson);
  for (const employee of result.employees)
    for (const id of employee.workDayIds) {
      const day = await getOwned<PayrollRow>(
        ctx,
        "payrollWorkDays",
        id,
        args.societyId,
      );
      if (day.postedCalculationId === row._id) {
        const { _id, _creationTime, postedCalculationId, ...rest } = day;
        await ctx.db.replace(id, {
          ...rest,
          reversedCalculationIds: [
            ...new Set([...(day.reversedCalculationIds ?? []), row._id]),
          ],
        });
      }
    }
  for (const payout of result.input.vacationPayouts ?? []) {
    if (!payout.vacationRequestId) continue;
    const request = await getOwned<PayrollRow>(
      ctx,
      "payrollVacationRequests",
      payout.vacationRequestId,
      args.societyId,
    );
    if (request.payrollPayoutCalculationId === row._id) {
      const { _id, _creationTime, payrollPayoutCalculationId, ...rest } =
        request;
      await ctx.db.replace(request._id, {
        ...rest,
        reversedPayrollPayoutCalculationIds: [
          ...new Set([
            ...(request.reversedPayrollPayoutCalculationIds ?? []),
            row._id,
          ]),
        ],
      });
    }
  }
  await ctx.db.patch(original._id, {
    reversedDate: date,
    reversalId: reversalPayRunId,
    updatedAtISO: stamp,
  });
  await ctx.db.patch(row._id, {
    status: "reversed",
    reversedDate: date,
    reversalReason: reason,
    reversalKey: key,
    reversalPayRunId,
    reversalJournalEntryIds,
    updatedAtISO: stamp,
  });
  await refreshPayrollRegister(ctx, args.societyId);
  return reversalPayRunId;
}
export async function recordPaymentPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    employeeId?: string;
    transactionId: string;
    date: string;
    reference: string;
    idempotencyKey: string;
    method: PayrollPaymentMethod;
    payee?: string;
    destinationReference?: string;
    postToLedger?: boolean;
  },
) {
  await payrollWrite(ctx, args.societyId);
  const row = await getOwned<PayrollRow>(
      ctx,
      "payrollCalculations",
      args.id,
      args.societyId,
    ),
    key = payrollText(args.idempotencyKey, "Payment key", 200),
    date = payrollDate(args.date),
    reference = payrollText(args.reference, "Payment reference", 200),
    method = args.method;
  if (
    !["bank_transfer", "direct_deposit", "cheque", "cash", "other"].includes(
      method,
    )
  )
    throw new Error("Select the actual recorded payment method.");
  const payee = args.payee ? payrollText(args.payee, "Payee", 200) : undefined,
    destinationReference = args.destinationReference
      ? payrollText(args.destinationReference, "Destination description", 200)
      : undefined;
  const existing = row.payments?.find((p: any) => p.key === key);
  if (existing) {
    if (
      existing.transactionId !== args.transactionId ||
      existing.employeeId !== args.employeeId ||
      existing.date !== date ||
      existing.reference !== reference ||
      existing.method !== method ||
      existing.payee !== payee ||
      existing.destinationReference !== destinationReference ||
      Boolean(existing.journalEntryId) !== Boolean(args.postToLedger)
    )
      throw new Error("That payment key already records different provenance.");
    return existing.transactionId;
  }
  if (row.status !== "finalized")
    throw new Error(
      "Only an active finalized payroll can be linked to an actual payment.",
    );
  if (args.employeeId && !row.employeeIds.includes(args.employeeId))
    throw new Error("Choose an employee included in this calculation.");
  const payments = row.payments ?? [];
  if (
    payments.some(
      (p: any) =>
        !p.employeeId || !args.employeeId || p.employeeId === args.employeeId,
    )
  )
    throw new Error(
      "This payroll/employee already has a recorded net payment; partial/duplicate settlement is not silently inferred.",
    );
  const result = payrollHydrate(row).result,
    employees = result.employees.filter(
      (e) => !args.employeeId || e.employeeId === args.employeeId,
    ),
    amountCents = employees.reduce((a, e) => a + e.deductions!.netCashCents, 0),
    transaction = await getOwned<PayrollRow>(
      ctx,
      "financialTransactions",
      args.transactionId,
      args.societyId,
    ),
    account = await getOwned<PayrollRow>(
      ctx,
      "financialAccounts",
      transaction.accountId,
      args.societyId,
    );
  if (
    amountCents <= 0 ||
    account.accountType !== "Bank" ||
    account.currency !== "CAD" ||
    (transaction.status !== undefined &&
      !["recorded", "posted"].includes(transaction.status)) ||
    transaction.amountCents !== -amountCents ||
    transaction.date !== date ||
    date < row.payDate
  )
    throw new Error(
      "Link an owned posted CAD bank outflow on this date equal to the selected net pay, on/after payroll payment date.",
    );
  if (transaction.matchedId || transaction.matchedKind)
    throw new Error(
      "That bank transaction is already linked to another record.",
    );
  await assertPayrollBooksOpen(ctx, args.societyId, date);
  let posting = {};
  if (args.postToLedger) {
    if (!row.journalEntryIds?.length)
      throw new Error(
        "Post the payroll accrual before recording a ledger settlement.",
      );
    posting = await payrollPaymentJournal(ctx, {
      societyId: args.societyId,
      calculationId: row._id,
      payRunId: row.payRunId,
      transaction,
      date,
      key: `payroll:${row._id}:payment:${key}`,
      employees,
      employer: {
        ...(await employerFor(ctx, args.societyId, row.year)),
        ledger: row.ledgerSnapshot,
      },
    });
  }
  const payment = {
    key,
    ...(args.employeeId ? { employeeId: args.employeeId } : {}),
    transactionId: transaction._id,
    date,
    amountCents,
    reference,
    method,
    ...(payee ? { payee } : {}),
    ...(destinationReference ? { destinationReference } : {}),
    recordedByUserId: await payrollActor(ctx, args.societyId),
    recordedAtISO: at(),
    ...posting,
  };
  await ctx.db.patch(row._id, {
    payments: [...payments, payment],
    updatedAtISO: at(),
  });
  await ctx.db.patch(transaction._id, {
    matchedKind: "payroll",
    matchedId: row.payRunId,
    reconciledAtISO: at(),
    reconciliationNote: reference,
  });
  return transaction._id;
}
