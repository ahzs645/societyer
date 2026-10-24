import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import type {
  EmployerSettingsFields,
  PayrollCalculationPreview,
  PayrollCalculatedEmployee,
} from "../payrollCalculation";
import { getOwned } from "./access";
import {
  payrollActor,
  payrollBounded,
  type PayrollRow,
} from "./payrollCalculationData";
import { booksCurrency } from "./costPlanning";
import { cashLedgerAccountId } from "./bankAccounts";
export type PayrollLedgerLine = {
  accountId: string;
  amountCents: number;
  side: "debit" | "credit";
  description?: string;
  programCode?: string;
  grantId?: string;
  fundRestrictionId?: string;
  financialTransactionId?: string;
};
export async function assertPayrollBooksOpen(
  ctx: PortableQueryCtx,
  societyId: string,
  date: string,
) {
  const settings = await payrollBounded(
    ctx.db
      .query<PayrollRow>("booksSettings")
      .withIndex("by_society", (q) => q.eq("societyId", societyId)),
    10,
    "Books settings",
  );
  if (settings.some((s) => s.closeDate && date <= s.closeDate))
    throw new Error(
      "The posting date is in closed books. Reopen the date or use an open dated correction.",
    );
  const periods = await payrollBounded(
    ctx.db
      .query<PayrollRow>("accountingFiscalPeriods")
      .withIndex("by_society", (q) => q.eq("societyId", societyId)),
    200,
    "Fiscal periods",
  );
  const found = periods.filter((p) => p.startDate <= date && p.endDate >= date);
  if (found.some((p) => p.status !== "open"))
    throw new Error(
      "The posting date belongs to a closed or archived fiscal period.",
    );
  return found[0];
}
export async function payrollLedgerMappings(
  ctx: PortableQueryCtx,
  societyId: string,
  employer: EmployerSettingsFields,
) {
  const books = await booksCurrency(ctx, societyId);
  if (books.baseCurrency !== "CAD")
    throw new Error(
      `Native payroll posting requires unambiguous CAD books; ${books.baseCurrency ?? "unknown"} books require an explicitly supported FX workflow.`,
    );
  const result = employer.ledger;
  if (!result || Object.values(result).filter(Boolean).length !== 5)
    throw new Error(
      "Map all five payroll expense and liability accounts before posting to the ledger.",
    );
  for (const [key, id] of Object.entries(result)) {
    const account = await getOwned<PayrollRow>(
      ctx,
      "financialAccounts",
      id!,
      societyId,
    );
    if (
      account.currency !== "CAD" ||
      (key.includes("Expense")
        ? account.accountType !== "Expense"
        : account.accountType !== "Liability")
    )
      throw new Error(
        "Payroll mappings require owned CAD expense and liability accounts.",
      );
  }
  return result as Required<NonNullable<EmployerSettingsFields["ledger"]>>;
}
export async function payrollPost(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    date: string;
    source: string;
    key: string;
    memo: string;
    basis: "both" | "accrual-only" | "cash-only";
    lines: PayrollLedgerLine[];
  },
) {
  const live = await payrollBounded(
    ctx.db
      .query<PayrollRow>("journalEntries")
      .withIndex("by_society_source_external", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("source", args.source)
          .eq("sourceExternalId", args.key),
      ),
    10,
    "Payroll journal keys",
  );
  const existing = live.find((e) => e.status === "posted");
  if (existing) return existing._id;
  const lines = args.lines.filter((l) => l.amountCents !== 0);
  if (!lines.length) return undefined;
  let balance = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0)
      throw new Error("Payroll journals require nonnegative integer cents.");
    balance += line.side === "debit" ? line.amountCents : -line.amountCents;
    await getOwned(ctx, "financialAccounts", line.accountId, args.societyId);
    if (line.grantId)
      await getOwned(ctx, "grants", line.grantId, args.societyId);
    if (line.fundRestrictionId)
      await getOwned(
        ctx,
        "fundRestrictions",
        line.fundRestrictionId,
        args.societyId,
      );
  }
  if (balance !== 0)
    throw new Error("Payroll journal does not balance exactly.");
  const period = await assertPayrollBooksOpen(ctx, args.societyId, args.date),
    at = new Date().toISOString(),
    actor = await payrollActor(ctx, args.societyId);
  const id = await ctx.db.insert("journalEntries", {
    societyId: args.societyId,
    date: args.date,
    memo: args.memo,
    source: args.source,
    sourceExternalId: args.key,
    status: "posted",
    basis: args.basis,
    ...(period
      ? { fiscalPeriodId: period._id, fiscalYear: period.fiscalYear }
      : {}),
    createdByUserId: actor,
    postedAtISO: at,
    createdAtISO: at,
    updatedAtISO: at,
  });
  for (const [lineOrder, line] of lines.entries())
    await ctx.db.insert("journalLines", {
      ...line,
      societyId: args.societyId,
      journalEntryId: id,
      lineOrder,
      createdAtISO: at,
      updatedAtISO: at,
    });
  return id;
}
export function payrollAccrualLines(
  result: PayrollCalculationPreview,
  m: Required<NonNullable<EmployerSettingsFields["ledger"]>>,
): PayrollLedgerLine[] {
  const lines: PayrollLedgerLine[] = [];
  for (const e of result.employees) {
    const d = e.deductions!,
      c = e.employerCosts!;
    for (const allocation of e.allocations ?? []) {
      const {
        cashRemunerationCents,
        vacationLiabilityReleasedCents = 0,
        ...extras
      } = allocation.amounts;
      const dims = {
        ...(allocation.grantId ? { grantId: allocation.grantId } : {}),
        ...(allocation.fundRestrictionId
          ? { fundRestrictionId: allocation.fundRestrictionId }
          : {}),
        ...(allocation.programCode
          ? { programCode: allocation.programCode }
          : {}),
      };
      lines.push(
        {
          accountId: m.wagesExpenseAccountId,
          amountCents: cashRemunerationCents - vacationLiabilityReleasedCents,
          side: "debit",
          description: `Wages: ${e.employeeName}`,
          ...dims,
        },
        {
          accountId: m.employerExpenseAccountId,
          amountCents: Object.values(extras).reduce((a, b) => a + b, 0),
          side: "debit",
          description: `Employer costs: ${e.employeeName}`,
          ...dims,
        },
      );
    }
    if (e.priorVacationLiabilityReleasedCents)
      lines.push({
        accountId: m.benefitsLiabilityAccountId,
        amountCents: e.priorVacationLiabilityReleasedCents,
        side: "debit",
        description: "Previously accrued vacation liability paid",
      });
    const employeeWithheld = d.totalDeductionsCents;
    lines.push(
      {
        accountId: m.netPayLiabilityAccountId,
        amountCents: d.netCashCents,
        side: "credit",
        description: `Net wages payable: ${e.employeeName}`,
      },
      {
        accountId: m.deductionsLiabilityAccountId,
        amountCents:
          employeeWithheld +
          d.cppEmployerCents +
          d.cpp2EmployerCents +
          d.eiEmployerCents,
        side: "credit",
        description: "Employee deductions and employer CPP/EI payable",
      },
      {
        accountId: m.benefitsLiabilityAccountId,
        amountCents:
          c.vacationAccrualCents +
          c.workSafeCents +
          c.ehtCents +
          c.benefitsCents +
          c.pensionCents,
        side: "credit",
        description: "Vacation, WorkSafe, EHT, benefits and pension payable",
      },
    );
  }
  return lines;
}
export async function payrollMirror(
  ctx: PortableMutationCtx,
  societyId: string,
  id: string,
  date: string,
  key: string,
  memo: string,
) {
  const entry = await getOwned<PayrollRow>(
    ctx,
    "journalEntries",
    id,
    societyId,
  );
  if (entry.status !== "posted")
    throw new Error(
      "An original payroll journal is missing or no longer posted.",
    );
  const originals = await payrollBounded(
    ctx.db
      .query<PayrollRow>("journalLines")
      .withIndex("by_entry", (q) => q.eq("journalEntryId", id)),
    2500,
    "Original payroll journal lines",
  );
  return payrollPost(ctx, {
    societyId,
    date,
    source: "payroll_reversal",
    key,
    memo,
    basis: entry.basis ?? "both",
    lines: originals.map((l) => ({
      accountId: l.accountId,
      amountCents: l.amountCents,
      side: l.side === "debit" ? "credit" : "debit",
      description: memo,
      ...(l.programCode ? { programCode: l.programCode } : {}),
      ...(l.grantId ? { grantId: l.grantId } : {}),
      ...(l.fundRestrictionId
        ? { fundRestrictionId: l.fundRestrictionId }
        : {}),
    })),
  });
}
export async function payrollPaymentJournal(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    calculationId: string;
    payRunId: string;
    transaction: PayrollRow;
    date: string;
    key: string;
    employees: PayrollCalculatedEmployee[];
    employer: EmployerSettingsFields;
  },
) {
  const m = await payrollLedgerMappings(ctx, args.societyId, args.employer),
    cash = await cashLedgerAccountId(
      ctx,
      args.societyId,
      args.transaction.accountId,
    );
  const account = await getOwned<PayrollRow>(
    ctx,
    "financialAccounts",
    cash,
    args.societyId,
  );
  if (account.currency !== "CAD")
    throw new Error("The linked cash ledger account must be CAD.");
  const associated = await payrollBounded(
    ctx.db
      .query<PayrollRow>("journalLines")
      .withIndex("by_financial_transaction", (q) =>
        q.eq("financialTransactionId", args.transaction._id),
      ),
    100,
    "Existing bank transaction journal lines",
  );
  const entries: PayrollRow[] = [];
  for (const id of new Set(associated.map((l) => l.journalEntryId))) {
    const entry = await getOwned<PayrollRow>(
      ctx,
      "journalEntries",
      id,
      args.societyId,
    );
    if (entry.status === "posted") entries.push(entry);
  }
  const mirrors: string[] = [];
  for (const entry of entries) {
    if (entry.source !== "financialTransactionBackfill")
      throw new Error(
        "The bank payment already belongs to a posted journal. Reconcile it explicitly before linking payroll.",
      );
    const id = await payrollMirror(
      ctx,
      args.societyId,
      entry._id,
      args.date,
      `${args.key}:bank-mirror:${entry._id}`,
      "Release original bank classification for payroll settlement",
    );
    if (id) mirrors.push(id);
  }
  const net = args.employees.reduce(
    (a, e) => a + e.deductions!.netCashCents,
    0,
  );
  const id = await payrollPost(ctx, {
    societyId: args.societyId,
    date: args.date,
    source: "payroll_payment",
    key: args.key,
    memo: `Recorded payroll payment ${args.payRunId}`,
    basis: "both",
    lines: [
      {
        accountId: m.netPayLiabilityAccountId,
        amountCents: net,
        side: "debit",
        description: "Payroll liability settled",
      },
      {
        accountId: cash,
        amountCents: net,
        side: "credit",
        financialTransactionId: args.transaction._id,
      },
    ],
  });
  const cashLines: PayrollLedgerLine[] = [];
  for (const e of args.employees) {
    const d = e.deductions!;
    for (const a of e.allocations ?? [])
      cashLines.push({
        accountId: m.wagesExpenseAccountId,
        amountCents: a.amounts.cashRemunerationCents,
        side: "debit",
        description: `Cash wages: ${e.employeeName}`,
        ...(a.grantId ? { grantId: a.grantId } : {}),
        ...(a.fundRestrictionId
          ? { fundRestrictionId: a.fundRestrictionId }
          : {}),
        ...(a.programCode ? { programCode: a.programCode } : {}),
      });
    cashLines.push(
      {
        accountId: m.netPayLiabilityAccountId,
        amountCents: d.netCashCents,
        side: "credit",
      },
      {
        accountId: m.deductionsLiabilityAccountId,
        amountCents: d.totalDeductionsCents,
        side: "credit",
      },
    );
  }
  const recognized = await payrollPost(ctx, {
    societyId: args.societyId,
    date: args.date,
    source: "payroll_cash_recognition",
    key: `${args.key}:cash`,
    memo: "Cash-basis wages recognized on recorded payment; employer obligations remain unpaid",
    basis: "cash-only",
    lines: cashLines,
  });
  return {
    journalEntryId: id,
    bankMirrorEntryIds: [...mirrors, ...(recognized ? [recognized] : [])],
  };
}
