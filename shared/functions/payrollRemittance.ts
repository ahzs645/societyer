import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  payrollActor,
  payrollBounded,
  payrollOrganization,
  payrollRead,
  payrollWrite,
  type PayrollRow,
} from "./payrollCalculationData";
import {
  payrollDate,
  payrollInteger,
  payrollText,
} from "../payrollCalculationValidation";
import { payrollFingerprint } from "../payrollProvenance";
import { addCraPayrollWorkingDays } from "../businessRegisters";
import {
  assertPayrollBooksOpen,
  payrollMirror,
  payrollPost,
} from "./payrollCalculationLedger";
import { cashLedgerAccountId } from "./bankAccounts";
import { booksCurrency } from "./costPlanning";
import { syncRegisterDeadlines } from "./businessRegisters";
import {
  cleanRemittancePlan,
  cleanRemittanceReadiness,
  cleanRemittanceRp,
  maskRemittanceRp,
  REMITTANCE_COMPONENTS,
  remittanceInstructions,
  remittanceReadiness,
  type RemittanceComponents,
  type RemittancePlan,
  type RemittancePlanFields,
  type RemittanceReadinessFields,
  type RemittanceSettlementFields,
  type RemittanceSource,
} from "../payrollRemittance";

type Ctx = PortableQueryCtx;
const now = () => new Date().toISOString();
const defaults: RemittanceReadinessFields = {
  rpRegistrationConfirmed: false,
  remitterCategoryConfirmed: false,
  mandateConfirmed: false,
  statusWebhookConfirmed: false,
  leadBusinessDays: 5,
  timezone: "America/Vancouver",
};
const query = (ctx: Ctx, table: string, societyId: string) =>
  ctx.db
    .query<PayrollRow>(table)
    .withIndex("by_society", (q) => q.eq("societyId", societyId));
const forObligation = (
  ctx: Ctx,
  table: string,
  societyId: string,
  obligationId: string,
) =>
  ctx.db
    .query<PayrollRow>(table)
    .withIndex("by_society_obligation", (q) =>
      q.eq("societyId", societyId).eq("obligationId", obligationId),
    );
async function readiness(ctx: Ctx, societyId: string) {
  const saved = await payrollBounded(
    query(ctx, "payrollRemittanceReadiness", societyId),
    2,
    "Remittance readiness settings",
  );
  if (saved.length > 1)
    throw new Error("Duplicate remittance readiness settings need review.");
  return {
    record: saved[0],
    ...remittanceReadiness(saved[0]?.fields ?? defaults),
  };
}
async function settings(ctx: Ctx, societyId: string) {
  const rows = await payrollBounded(
    query(ctx, "payrollSettings", societyId),
    2,
    "Payroll register settings",
  );
  if (rows.length !== 1)
    throw new Error(
      "Save one reviewed payroll register settings record before preparing remittances.",
    );
  return rows[0];
}
function boundedSize(value: unknown, maximum = 3500000) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum)
    throw new Error(
      "Remittance source artwork/data exceeds the safe calculation bound; prepare a narrower obligation or reconcile the source register first.",
    );
}
async function source(
  ctx: Ctx,
  societyId: string,
  obligationId: string,
): Promise<RemittanceSource> {
  const obligation = await getOwned<PayrollRow>(
      ctx,
      "payrollRemittances",
      obligationId,
      societyId,
    ),
    s = await settings(ctx, societyId);
  payrollDate(obligation.periodStart, "Obligation start");
  payrollDate(obligation.periodEnd, "Obligation end");
  if (obligation.periodEnd < obligation.periodStart)
    throw new Error("The remittance period is invalid.");
  const runs = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payRuns")
      .withIndex("by_society_pay_date", (q) =>
        q
          .eq("societyId", societyId)
          .gte("payDate", obligation.periodStart)
          .lte("payDate", obligation.periodEnd),
      ),
    100,
    "Remittance pay runs",
  );
  boundedSize(runs);
  if (!runs.length)
    throw new Error(
      "This obligation has no retained payroll source runs; reconcile its source register before preparing a new payment.",
    );
  const components = Object.fromEntries(
    REMITTANCE_COMPONENTS.map((k) => [k, 0]),
  ) as RemittanceComponents;
  const sourceRuns = runs
    .map((run) => {
      if (run.sourceMissingFields?.length && !run.missingValuesConfirmed)
        throw new Error(
          "A source pay run has unconfirmed missing payroll values. Complete its actual payroll amounts first.",
        );
      const values: Record<string, number> = {};
      for (const key of REMITTANCE_COMPONENTS) {
        const value = run[key] ?? 0;
        payrollInteger(value, key, Number.MAX_SAFE_INTEGER, true);
        components[key] += value;
        payrollInteger(components[key], key, Number.MAX_SAFE_INTEGER, true);
        values[key] = value;
      }
      return {
        _id: run._id,
        payDate: run.payDate,
        updatedAtISO: run.updatedAtISO,
        calculationId: run.calculationId,
        ...values,
      };
    })
    .sort((a, b) => a._id.localeCompare(b._id));
  const amountDueCents = Object.values(components).reduce((a, b) => a + b, 0);
  payrollInteger(amountDueCents, "CRA obligation cents");
  if (amountDueCents !== obligation.amountDueCents)
    throw new Error(
      "The CRA obligation differs from its retained payroll amounts. Refresh/reconcile the payroll register before payment preparation.",
    );
  const paidCents = payrollInteger(
    obligation.paidCents ?? 0,
    "Recorded remittance cents",
  );
  if ((paidCents > 0 || obligation.paidOn) && !obligation.payrollAccountNumber)
    throw new Error(
      "This legacy paid obligation has no retained CRA RP attribution. Confirm its actual historical RP account and evidence before preparing a remaining payment or changing global payroll settings.",
    );
  const payrollAccountNumber = cleanRemittanceRp(
      paidCents > 0 || obligation.paidOn
        ? obligation.payrollAccountNumber
        : s.payrollAccountNumber,
    ),
    warnings: string[] = [];
  const retainedPayments = await payments(ctx, societyId, obligationId);
  if (
    retainedPayments.some(
      (payment) => payment.payrollAccountNumber !== payrollAccountNumber,
    )
  )
    throw new Error(
      "Recorded settlements belong to a different CRA RP account. Review the actual CRA account allocation before preparing another payment; changing settings cannot transfer paid amounts between RP accounts.",
    );
  if (!obligation.dueDate)
    throw new Error(
      "Confirm the effective CRA remitter schedule and due date before preparing payment.",
    );
  if (paidCents > amountDueCents)
    warnings.push(
      "Recorded payments exceed the current obligation. Review the CRA account credit rather than prepare another debit.",
    );
  const payload = {
    obligationId,
    periodStart: obligation.periodStart,
    periodEnd: obligation.periodEnd,
    dueDate: obligation.dueDate,
    schedule: obligation.schedule,
    amountDueCents,
    payrollAccountNumber,
    remitterType: obligation.schedule?.remitterType ?? s.remitterType,
    sourceRuns,
  };
  return {
    obligationId,
    periodStart: obligation.periodStart,
    periodEnd: obligation.periodEnd,
    dueDate: obligation.dueDate,
    amountDueCents,
    paidCents,
    outstandingCents: Math.max(0, amountDueCents - paidCents),
    payrollAccountNumber,
    remitterType: payload.remitterType,
    components,
    payRunIds: sourceRuns.map((r) => r._id),
    sourceFingerprint: await payrollFingerprint(payload),
    warnings,
  };
}
async function ownedPlan(ctx: Ctx, societyId: string, id: string) {
  return (await getOwned(
    ctx,
    "payrollRemittancePlans",
    id,
    societyId,
  )) as unknown as RemittancePlan;
}
function version(row: RemittancePlan, expected: number) {
  if (expected !== row.version)
    throw new Error(
      "This plan changed. Reload its current version before continuing.",
    );
}
function audit(
  row: RemittancePlan | undefined,
  action: string,
  actorUserId: string,
  reference?: string,
) {
  const history = [
    ...(row?.history ?? []),
    { action, atISO: now(), actorUserId, ...(reference ? { reference } : {}) },
  ];
  if (history.length > 100)
    throw new Error(
      "This plan has reached its audit limit. Retain it and create a new plan.",
    );
  return history;
}
async function validateBank(ctx: Ctx, societyId: string, id: string) {
  const bank = await getOwned<PayrollRow>(
    ctx,
    "financialAccounts",
    id,
    societyId,
  );
  if (bank.accountType !== "Bank" || bank.currency !== "CAD")
    throw new Error("Select an owned CAD bank account for CRA remittance.");
  return bank;
}
async function validateExpense(ctx: Ctx, societyId: string, id?: string) {
  if (!id) return;
  const account = await getOwned<PayrollRow>(
    ctx,
    "financialAccounts",
    id,
    societyId,
  );
  if (account.accountType !== "Expense" || account.currency !== "CAD")
    throw new Error(
      "Select an owned CAD employer-contributions expense account.",
    );
}
async function validateLiability(ctx: Ctx, societyId: string, id?: string) {
  if (!id) return;
  const account = await getOwned<PayrollRow>(
    ctx,
    "financialAccounts",
    id,
    societyId,
  );
  if (account.accountType !== "Liability" || account.currency !== "CAD")
    throw new Error(
      "Select the owned CAD source-deductions liability account credited by payroll.",
    );
}
async function payments(ctx: Ctx, societyId: string, obligationId: string) {
  return payrollBounded(
    forObligation(ctx, "payrollRemittanceSettlements", societyId, obligationId),
    500,
    "Recorded CRA settlements",
  );
}
async function assertCapacity(
  ctx: Ctx,
  societyId: string,
  live: RemittanceSource,
  fields: RemittancePlanFields,
  ignoreId?: string,
) {
  const plans = await payrollBounded(
      forObligation(
        ctx,
        "payrollRemittancePlans",
        societyId,
        fields.obligationId,
      ),
      100,
      "Obligation plans",
    ),
    settlements = await payments(ctx, societyId, fields.obligationId);
  const reserved = plans
    .filter(
      (p) =>
        p._id !== ignoreId &&
        ["approved", "exported", "manual_submitted"].includes(p.status),
    )
    .reduce(
      (sum, p) =>
        sum +
        Math.max(
          0,
          p.amountCents -
            settlements
              .filter((s) => s.planId === p._id)
              .reduce((n, s) => n + s.amountCents, 0),
        ),
      0,
    );
  if (fields.amountCents > live.outstandingCents - reserved)
    throw new Error(
      "This amount exceeds the outstanding CRA obligation after other approved payment plans. Reject or reconcile those plans first.",
    );
}
export async function previewPortable(
  ctx: Ctx,
  args: { societyId: string; obligationId: string },
) {
  await payrollRead(ctx, args.societyId, false);
  const result = await source(ctx, args.societyId, args.obligationId),
    r = await readiness(ctx, args.societyId),
    { today } = await payrollOrganization(ctx, args.societyId);
  return {
    ...result,
    readiness: r,
    earliestSuggestedDate: addCraPayrollWorkingDays(
      today,
      r.fields.leadBusinessDays,
    ),
    today,
  };
}
export async function workspacePortable(
  ctx: Ctx,
  args: {
    societyId: string;
    collection:
      | "obligations"
      | "plans"
      | "settlements"
      | "banks"
      | "transactions"
      | "liabilities"
      | "expenses"
      | "credentials"
      | "readiness"
      | "plan";
    cursor?: string | null;
    id?: string;
    bankAccountId?: string;
  },
) {
  await payrollRead(ctx, args.societyId, false);
  if (args.collection === "credentials")
    await requirePermissionPortable(ctx, args.societyId, "settings:read");
  const { today } = await payrollOrganization(ctx, args.societyId);
  if (args.collection === "readiness")
    return { today, ...(await readiness(ctx, args.societyId)) };
  if (args.collection === "plan") {
    if (!args.id) throw new Error("Choose a plan.");
    const row = await ownedPlan(ctx, args.societyId, args.id);
    const bank = await getOwned<PayrollRow>(
      ctx,
      "financialAccounts",
      row.bankAccountId,
      args.societyId,
    );
    const liability = row.liabilityAccountId
      ? await getOwned<PayrollRow>(
          ctx,
          "financialAccounts",
          row.liabilityAccountId,
          args.societyId,
        )
      : null;
    const expense = row.employerExpenseAccountId
      ? await getOwned<PayrollRow>(
          ctx,
          "financialAccounts",
          row.employerExpenseAccountId,
          args.societyId,
        )
      : null;
    return {
      today,
      plan: row,
      bank: { name: bank.name, currency: bank.currency },
      liabilityAccountName: liability?.name,
      employerExpenseAccountName: expense?.name,
      settlements: (
        await payments(ctx, args.societyId, row.obligationId)
      ).filter((p) => p.planId === row._id),
    };
  }
  let q = query(
    ctx,
    args.collection === "obligations"
      ? "payrollRemittances"
      : args.collection === "plans"
        ? "payrollRemittancePlans"
        : args.collection === "settlements"
          ? "payrollRemittanceSettlements"
          : args.collection === "credentials"
            ? "secretVaultItems"
            : "financialAccounts",
    args.societyId,
  );
  if (
    args.collection === "banks" ||
    args.collection === "liabilities" ||
    args.collection === "expenses"
  )
    q = ctx.db
      .query<PayrollRow>("financialAccounts")
      .withIndex("by_society_type", (index) =>
        index
          .eq("societyId", args.societyId)
          .eq(
            "accountType",
            args.collection === "banks"
              ? "Bank"
              : args.collection === "expenses"
                ? "Expense"
                : "Liability",
          ),
      );
  if (args.collection === "transactions") {
    if (!args.bankAccountId) throw new Error("Choose an owned bank account.");
    await validateBank(ctx, args.societyId, args.bankAccountId);
    q = ctx.db
      .query<PayrollRow>("financialTransactions")
      .withIndex("by_account", (index) =>
        index.eq("accountId", args.bankAccountId),
      );
  }
  const page = await q.order("desc").paginate({
    numItems: 10,
    cursor: args.cursor ?? null,
    maximumBytesRead: 2500000,
  });
  const rows = page.page.map((row) =>
    args.collection === "plans"
      ? {
          _id: row._id,
          version: row.version,
          status: row.status,
          obligationId: row.obligationId,
          amountCents: row.amountCents,
          scheduledDate: row.scheduledDate,
          channel: row.channel,
          periodStart: row.source.periodStart,
          periodEnd: row.source.periodEnd,
          payrollAccount: maskRemittanceRp(row.source.payrollAccountNumber),
          updatedAtISO: row.updatedAtISO,
        }
      : args.collection === "banks" ||
          args.collection === "liabilities" ||
          args.collection === "expenses"
        ? {
            _id: row._id,
            name: row.name,
            currency: row.currency,
            accountType: row.accountType,
          }
        : args.collection === "credentials"
          ? {
              _id: row._id,
              name: row.name,
              service: row.service,
              status: row.status,
              storageMode: row.storageMode,
            }
          : args.collection === "transactions"
            ? {
                _id: row._id,
                date: row.date,
                description: row.description,
                amountCents: row.amountCents,
                status: row.status,
                matchedKind: row.matchedKind,
                matchedId: row.matchedId,
                accountId: row.accountId,
              }
            : args.collection === "obligations"
              ? {
                  _id: row._id,
                  periodStart: row.periodStart,
                  periodEnd: row.periodEnd,
                  dueDate: row.dueDate,
                  amountDueCents: row.amountDueCents,
                  paidCents: row.paidCents ?? 0,
                  paidOn: row.paidOn,
                  payrollAccountNumber: row.payrollAccountNumber,
                  legacyUnattributedPaid: Boolean(
                    (row.paidCents > 0 || row.paidOn) &&
                    !row.payrollAccountNumber,
                  ),
                }
              : row,
  );
  return {
    today,
    rows,
    continueCursor: page.continueCursor,
    isDone: page.isDone,
  };
}
export async function saveDraftPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id?: string;
    expectedVersion?: number;
    fields: RemittancePlanFields;
  },
) {
  await payrollWrite(ctx, args.societyId, false);
  const fields = cleanRemittancePlan(args.fields),
    old = args.id ? await ownedPlan(ctx, args.societyId, args.id) : undefined;
  if (old) {
    version(old, args.expectedVersion!);
    if (old.status !== "draft")
      throw new Error(
        "Approved plans retain their reviewed snapshot. Create a new draft for a changed instruction.",
      );
  }
  const live = await source(ctx, args.societyId, fields.obligationId);
  await validateBank(ctx, args.societyId, fields.bankAccountId);
  await validateLiability(ctx, args.societyId, fields.liabilityAccountId);
  await validateExpense(ctx, args.societyId, fields.employerExpenseAccountId);
  await assertCapacity(ctx, args.societyId, live, fields, old?._id);
  const row = {
    societyId: args.societyId,
    ...fields,
    status: "draft",
    version: (old?.version ?? 0) + 1,
    source: live,
    sourceFingerprint: live.sourceFingerprint,
    history: audit(
      old,
      old ? "draft_revised" : "draft_created",
      await payrollActor(ctx, args.societyId),
    ),
    revisions: [
      ...(old?.revisions ?? []),
      ...(old
        ? [
            {
              version: old.version,
              fields: cleanRemittancePlan(old),
              sourceFingerprint: old.sourceFingerprint,
            },
          ]
        : []),
    ],
    createdAtISO: old?.createdAtISO ?? now(),
    updatedAtISO: now(),
  };
  boundedSize(row, 400000);
  if (old) {
    await ctx.db.patch(old._id, {
      ...row,
      notes: fields.notes,
      liabilityAccountId: fields.liabilityAccountId,
      employerExpenseAccountId: fields.employerExpenseAccountId,
    });
    return old._id;
  }
  return ctx.db.insert("payrollRemittancePlans", row);
}
async function current(ctx: Ctx, row: RemittancePlan) {
  const live = await source(ctx, row.societyId, row.obligationId);
  if (live.sourceFingerprint !== row.sourceFingerprint)
    throw new Error(
      "Payroll amounts, RP account or effective due schedule changed after this snapshot. Prepare a new reviewed plan.",
    );
  await validateBank(ctx, row.societyId, row.bankAccountId);
  await validateLiability(ctx, row.societyId, row.liabilityAccountId);
  await validateExpense(ctx, row.societyId, row.employerExpenseAccountId);
  return live;
}
export async function approvePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id: string; expectedVersion: number },
) {
  await payrollWrite(ctx, args.societyId, false);
  const row = await ownedPlan(ctx, args.societyId, args.id);
  version(row, args.expectedVersion);
  if (row.status !== "draft") throw new Error("Only a draft can be approved.");
  const live = await current(ctx, row);
  await assertCapacity(ctx, args.societyId, live, row, row._id);
  const actor = await payrollActor(ctx, args.societyId);
  await ctx.db.patch(row._id, {
    status: "approved",
    version: row.version + 1,
    approvedAtISO: now(),
    approvedByUserId: actor,
    history: audit(row, "approved", actor),
    updatedAtISO: now(),
  });
  return row._id;
}
export async function recordPreparedExportPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id: string; expectedVersion: number },
) {
  await payrollWrite(ctx, args.societyId, false);
  await requirePermissionPortable(ctx, args.societyId, "exports:download");
  const row = await ownedPlan(ctx, args.societyId, args.id);
  version(row, args.expectedVersion);
  if (!["approved", "exported", "manual_submitted"].includes(row.status))
    throw new Error(
      "Approve a current payment plan before exporting instructions.",
    );
  const live = await current(ctx, row);
  const settledCents = (await payments(ctx, args.societyId, row.obligationId))
    .filter((s) => s.planId === row._id)
    .reduce((sum, s) => sum + s.amountCents, 0);
  await assertCapacity(
    ctx,
    args.societyId,
    live,
    { ...row, amountCents: row.amountCents - settledCents },
    row._id,
  );
  const status = row.status === "manual_submitted" ? row.status : "exported";
  await ctx.db.patch(row._id, {
    status,
    version: row.version + 1,
    history: audit(
      row,
      "instructions_exported",
      await payrollActor(ctx, args.societyId),
    ),
    updatedAtISO: now(),
  });
  const bank = await validateBank(ctx, args.societyId, row.bankAccountId);
  return remittanceInstructions(
    { ...row, status, version: row.version + 1 },
    settledCents,
    bank.name,
  );
}
export async function recordManualSubmissionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    expectedVersion: number;
    reference: string;
  },
) {
  await payrollWrite(ctx, args.societyId, false);
  const row = await ownedPlan(ctx, args.societyId, args.id);
  version(row, args.expectedVersion);
  if (!["approved", "exported", "manual_submitted"].includes(row.status))
    throw new Error("Approve a plan before recording an external submission.");
  await current(ctx, row);
  const reference = payrollText(
    args.reference,
    "Actual external submission reference",
    200,
  );
  await ctx.db.patch(row._id, {
    status: "manual_submitted",
    version: row.version + 1,
    submissionReference: reference,
    history: audit(
      row,
      "manual_submission_recorded",
      await payrollActor(ctx, args.societyId),
      reference,
    ),
    updatedAtISO: now(),
  });
  return row._id;
}
export async function rejectPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    expectedVersion: number;
    reason: string;
  },
) {
  await payrollWrite(ctx, args.societyId, false);
  const row = await ownedPlan(ctx, args.societyId, args.id);
  version(row, args.expectedVersion);
  if (row.status === "settled" || row.status === "rejected")
    throw new Error(
      "Retained settled or rejected plans cannot be rejected again.",
    );
  const settledCents = (await payments(ctx, args.societyId, row.obligationId))
    .filter((s) => s.planId === row._id)
    .reduce((sum, s) => sum + s.amountCents, 0);
  if (settledCents >= row.amountCents)
    throw new Error(
      "A fully settled plan cannot release a remaining commitment.",
    );
  await ctx.db.patch(row._id, {
    status: "rejected",
    version: row.version + 1,
    history: audit(
      row,
      settledCents ? "remaining_commitment_cancelled" : "rejected",
      await payrollActor(ctx, args.societyId),
      payrollText(args.reason, "Rejection/cancellation reason", 1000),
    ),
    updatedAtISO: now(),
  });
  return row._id;
}
async function settlementJournal(
  ctx: PortableMutationCtx,
  row: RemittancePlan,
  tx: PayrollRow,
  date: string,
  amountCents: number,
  key: string,
  employerContributionsRecognizedCents: number,
) {
  if (!row.liabilityAccountId)
    throw new Error(
      "Map the exact source-deductions liability in the reviewed plan before ledger posting.",
    );
  if ((await booksCurrency(ctx, row.societyId)).baseCurrency !== "CAD")
    throw new Error("CRA remittance posting requires unambiguous CAD books.");
  const cash = await cashLedgerAccountId(ctx, row.societyId, row.bankAccountId);
  const cashAccount = await getOwned<PayrollRow>(
    ctx,
    "financialAccounts",
    cash,
    row.societyId,
  );
  if (
    cashAccount.currency !== "CAD" ||
    !["Bank", "Credit", "Asset", "Liability"].includes(cashAccount.accountType)
  )
    throw new Error(
      "The source bank's resolved cash ledger must be denominated in CAD.",
    );
  const associated = await payrollBounded(
      ctx.db
        .query<PayrollRow>("journalLines")
        .withIndex("by_financial_transaction", (q) =>
          q.eq("financialTransactionId", tx._id),
        ),
      100,
      "Bank source journals",
    ),
    entries: PayrollRow[] = [];
  for (const id of new Set(associated.map((l) => l.journalEntryId))) {
    const entry = await getOwned<PayrollRow>(
      ctx,
      "journalEntries",
      id,
      row.societyId,
    );
    if (entry.status === "posted") entries.push(entry);
  }
  if (entries.some((e) => e.source !== "financialTransactionBackfill"))
    throw new Error(
      "The bank outflow already belongs to a posted journal. Reconcile its accounting before remittance settlement.",
    );
  const ids: string[] = [];
  for (const entry of entries) {
    const mirror = await payrollMirror(
      ctx,
      row.societyId,
      entry._id,
      date,
      `${key}:bank-mirror:${entry._id}`,
      "Release bank classification for CRA source-deductions settlement",
    );
    if (mirror) ids.push(mirror);
  }
  const id = await payrollPost(ctx, {
    societyId: row.societyId,
    date,
    source: "payroll_remittance",
    key,
    memo: `CRA payroll remittance ${row.source.payrollAccountNumber} ${row.source.periodStart}–${row.source.periodEnd}`,
    basis: "both",
    lines: [
      {
        accountId: row.liabilityAccountId,
        amountCents,
        side: "debit",
        description: "CRA source-deductions liability settled",
      },
      {
        accountId: cash,
        amountCents,
        side: "credit",
        financialTransactionId: tx._id,
      },
    ],
  });
  if (id) ids.push(id);
  if (employerContributionsRecognizedCents) {
    if (!row.employerExpenseAccountId)
      throw new Error(
        "Map employer CPP/CPP2/EI expense before recognizing the actual paid employer contributions on a cash basis.",
      );
    const recognized = await payrollPost(ctx, {
      societyId: row.societyId,
      date,
      source: "payroll_remittance_cash_recognition",
      key: `${key}:employer-cash`,
      memo: "Cash-basis employer CPP, CPP2 and EI paid to CRA; excludes EHT and WorkSafe",
      basis: "cash-only",
      lines: [
        {
          accountId: row.employerExpenseAccountId,
          amountCents: employerContributionsRecognizedCents,
          side: "debit",
        },
        {
          accountId: row.liabilityAccountId,
          amountCents: employerContributionsRecognizedCents,
          side: "credit",
        },
      ],
    });
    if (recognized) ids.push(recognized);
  }
  return ids;
}
export async function reconcilePaymentPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id: string } & RemittanceSettlementFields,
) {
  await payrollWrite(ctx, args.societyId, false);
  const row = await ownedPlan(ctx, args.societyId, args.id),
    key = payrollText(args.idempotencyKey, "Settlement idempotency key", 200),
    date = payrollDate(args.date, "Actual settlement date"),
    amountCents = payrollInteger(args.amountCents, "Actual settlement cents"),
    evidence = payrollText(
      args.evidence,
      "Actual bank/CRA settlement evidence",
      2000,
    ),
    confirmation = args.craConfirmationNumber
      ? payrollText(args.craConfirmationNumber, "CRA payment confirmation", 200)
      : undefined;
  if (!args.destinationConfirmed)
    throw new Error(
      "Confirm that the actual payment went to this exact CRA RP account and obligation.",
    );
  if (!amountCents)
    throw new Error("The actual settlement amount must be positive.");
  if (!args.transactionId && !confirmation)
    throw new Error(
      "Select an actual posted bank outflow or retain an actual CRA payment confirmation.",
    );
  const retained = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollRemittanceSettlements")
      .withIndex("by_society_key", (q) =>
        q.eq("societyId", args.societyId).eq("idempotencyKey", key),
      ),
    2,
    "Settlement keys",
  );
  if (retained.length) {
    const s = retained[0];
    if (
      s.planId !== row._id ||
      s.date !== date ||
      s.amountCents !== amountCents ||
      s.transactionId !== args.transactionId ||
      s.craConfirmationNumber !== confirmation ||
      s.evidence !== evidence ||
      Boolean(s.journalEntryIds?.length) !== args.postToLedger
    )
      throw new Error(
        "This idempotency key already records different actual settlement facts.",
      );
    return s._id;
  }
  if (!["approved", "exported", "manual_submitted"].includes(row.status))
    throw new Error("Reconcile an approved current payment plan.");
  const live = await current(ctx, row),
    { today } = await payrollOrganization(ctx, args.societyId);
  if (date > today)
    throw new Error(
      "A future intended payment is not an actual settled payment.",
    );
  await assertPayrollBooksOpen(ctx, args.societyId, date);
  const existing = await payments(ctx, args.societyId, row.obligationId),
    already = existing
      .filter((s) => s.planId === row._id)
      .reduce((n, s) => n + s.amountCents, 0);
  if (
    amountCents > row.amountCents - already ||
    amountCents > live.outstandingCents
  )
    throw new Error(
      "The actual amount exceeds this plan or the remaining CRA obligation. Review any excess as a CRA account credit separately.",
    );
  let tx: PayrollRow | undefined;
  if (args.transactionId) {
    tx = await getOwned<PayrollRow>(
      ctx,
      "financialTransactions",
      args.transactionId,
      args.societyId,
    );
    if (
      tx.accountId !== row.bankAccountId ||
      tx.amountCents !== -amountCents ||
      tx.date !== date
    )
      throw new Error(
        "The owned bank outflow must match the selected source bank, actual amount and settlement date exactly.",
      );
    if (tx.status && !["posted", "recorded", "settled"].includes(tx.status))
      throw new Error(
        "A pending, rejected or unconfirmed bank transaction cannot settle a remittance.",
      );
    if (tx.matchedKind || tx.matchedId || tx.reconciledAtISO)
      throw new Error(
        "This bank transaction already belongs to another reconciliation.",
      );
    const linked = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollRemittanceSettlements")
        .withIndex("by_society_transaction", (q) =>
          q
            .eq("societyId", args.societyId)
            .eq("transactionId", args.transactionId),
        ),
      2,
      "Bank settlement links",
    );
    if (linked.length)
      throw new Error(
        "This bank outflow is already retained as a CRA settlement.",
      );
  }
  if (confirmation) {
    const same = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollRemittanceSettlements")
        .withIndex("by_society_confirmation", (q) =>
          q
            .eq("societyId", args.societyId)
            .eq("craConfirmationNumber", confirmation),
        ),
      2,
      "CRA confirmation links",
    );
    if (same.length)
      throw new Error(
        "This CRA payment confirmation is already recorded. Retain one settlement for each actual payment.",
      );
  }
  if (typeof args.postToLedger !== "boolean")
    throw new Error(
      "Choose whether to post the actual bank settlement to the ledger.",
    );
  if (args.postToLedger && !tx)
    throw new Error(
      "A CRA receipt without a matched bank outflow cannot create a bank journal. Reconcile the bank first.",
    );
  const employerTotal =
    live.components.cppEmployerCents +
    live.components.cpp2EmployerCents +
    live.components.eiEmployerCents;
  const allocated = (paid: number) =>
    Number(
      (BigInt(employerTotal) * BigInt(paid)) / BigInt(live.amountDueCents),
    );
  const employerContributionsRecognizedCents = args.postToLedger
    ? allocated(live.paidCents + amountCents) - allocated(live.paidCents)
    : 0;
  if (employerContributionsRecognizedCents < 0)
    throw new Error(
      "Signed employer contribution corrections require an explicit reviewed CRA allocation before posting.",
    );
  const journalEntryIds = args.postToLedger
      ? await settlementJournal(
          ctx,
          row,
          tx!,
          date,
          amountCents,
          `cra:${row._id}:${key}`,
          employerContributionsRecognizedCents,
        )
      : [],
    at = now(),
    actor = await payrollActor(ctx, args.societyId),
    id = await ctx.db.insert("payrollRemittanceSettlements", {
      societyId: args.societyId,
      planId: row._id,
      obligationId: row.obligationId,
      bankAccountId: row.bankAccountId,
      date,
      amountCents,
      evidence,
      ...(tx ? { transactionId: tx._id } : {}),
      ...(confirmation ? { craConfirmationNumber: confirmation } : {}),
      idempotencyKey: key,
      destinationReference: row.destinationReference,
      payrollAccountNumber: row.source.payrollAccountNumber,
      journalEntryIds,
      employerContributionsRecognizedCents,
      createdAtISO: at,
      createdByUserId: actor,
    });
  if (tx)
    await ctx.db.patch(tx._id, {
      matchedKind: "payroll_remittance",
      matchedId: id,
      reconciledAtISO: at,
      reconciledByName: "Reviewed CRA remittance",
      reconciliationNote: `CRA ${row.source.payrollAccountNumber}; ${evidence}`,
    });
  const obligation = await getOwned<PayrollRow>(
    ctx,
    "payrollRemittances",
    row.obligationId,
    args.societyId,
  );
  await ctx.db.patch(obligation._id, {
    payrollAccountNumber: row.source.payrollAccountNumber,
    rpAccountEvidence:
      obligation.rpAccountEvidence ?? `Actual reviewed settlement ${id}`,
    rpAccountConfirmedAtISO: obligation.rpAccountConfirmedAtISO ?? at,
    rpAccountConfirmedByUserId: obligation.rpAccountConfirmedByUserId ?? actor,
    paidCents: live.paidCents + amountCents,
    paidOn:
      obligation.paidOn && obligation.paidOn > date ? obligation.paidOn : date,
    confirmationNumber: confirmation ?? obligation.confirmationNumber,
    ...(tx ? { transactionId: tx._id } : {}),
    updatedAtISO: at,
  });
  await ctx.db.patch(row._id, {
    status: already + amountCents === row.amountCents ? "settled" : row.status,
    version: row.version + 1,
    history: audit(
      row,
      "actual_settlement_recorded",
      actor,
      confirmation ?? tx?._id,
    ),
    updatedAtISO: at,
  });
  await syncRegisterDeadlines(ctx, args.societyId);
  return id;
}
export async function confirmLegacyAccountPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    obligationId: string;
    payrollAccountNumber: string;
    evidence: string;
  },
) {
  await payrollWrite(ctx, args.societyId, false);
  const row = await getOwned<PayrollRow>(
      ctx,
      "payrollRemittances",
      args.obligationId,
      args.societyId,
    ),
    account = cleanRemittanceRp(args.payrollAccountNumber),
    evidence = payrollText(
      args.evidence,
      "Historical CRA account attribution evidence",
      2000,
    );
  if (!(row.paidCents > 0 || row.paidOn))
    throw new Error(
      "Only a retained legacy paid obligation needs historical RP confirmation.",
    );
  if (row.payrollAccountNumber) {
    if (row.payrollAccountNumber !== account)
      throw new Error(
        "This obligation already retains its historical CRA RP account. Review a real CRA transfer separately; paid facts cannot be reassigned.",
      );
    return row._id;
  }
  const retained = await payments(ctx, args.societyId, row._id);
  if (retained.some((s) => s.payrollAccountNumber !== account))
    throw new Error(
      "The historical RP account must agree with the actual retained settlements.",
    );
  await ctx.db.patch(row._id, {
    payrollAccountNumber: account,
    rpAccountEvidence: evidence,
    rpAccountConfirmedAtISO: now(),
    rpAccountConfirmedByUserId: await payrollActor(ctx, args.societyId),
    updatedAtISO: now(),
  });
  return row._id;
}
export async function saveReadinessPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; fields: RemittanceReadinessFields },
) {
  await payrollWrite(ctx, args.societyId, false);
  const fields = cleanRemittanceReadiness(args.fields);
  const old = (await readiness(ctx, args.societyId)).record;
  if (fields.rpRegistrationConfirmed)
    cleanRemittanceRp(
      (await settings(ctx, args.societyId)).payrollAccountNumber,
    );
  if (fields.credentialVaultItemId !== old?.fields.credentialVaultItemId) {
    await requirePermissionPortable(ctx, args.societyId, "settings:read");
  }
  if (
    fields.credentialVaultItemId &&
    fields.credentialVaultItemId !== old?.fields.credentialVaultItemId
  ) {
    const secret = await getOwned<PayrollRow>(
      ctx,
      "secretVaultItems",
      fields.credentialVaultItemId,
      args.societyId,
    );
    if (
      secret.status !== "Active" ||
      ![
        "stored_encrypted",
        "external_reference",
        "encrypted_elsewhere",
      ].includes(secret.storageMode)
    )
      throw new Error(
        "Select an active secure credential reference, without copying credentials into payroll notes.",
      );
  }
  const row = {
    societyId: args.societyId,
    fields,
    version: (old?.version ?? 0) + 1,
    updatedAtISO: now(),
    updatedByUserId: await payrollActor(ctx, args.societyId),
  };
  if (old) {
    await ctx.db.patch(old._id, row);
    return old._id;
  }
  return ctx.db.insert("payrollRemittanceReadiness", row);
}
