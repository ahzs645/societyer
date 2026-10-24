import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";

/** A native payment has an immutable calculation and journal behind its bank
 * link. Legacy employee reconciliation remains a separate supported flow. */
export async function nativePayrollBankLink(
  ctx: PortableQueryCtx,
  row: PortableDoc,
) {
  if (typeof row.matchedId !== "string") return null;
  if (row.matchedKind === "payroll_remittance") {
    const settlement = await ctx.db.get(
      row.matchedId,
      "payrollRemittanceSettlements",
    );
    if (
      !settlement ||
      settlement.societyId !== row.societyId ||
      settlement.transactionId !== row._id
    )
      throw new Error(
        "The retained payroll remittance bank link is invalid; review its settlement record.",
      );
    return { settlement };
  }
  if (row.matchedKind !== "payroll") return null;
  const payRun = await ctx.db.get(row.matchedId, "payRuns");
  if (!payRun?.calculationId) return null;
  if (payRun.societyId !== row.societyId)
    throw new Error("Payroll payment not found.");
  return { payRun, calculationId: String(payRun.calculationId) };
}

const FROZEN_BANK_FIELDS = [
  "date",
  "amountCents",
  "accountId",
  "connectionId",
  "externalId",
  "matchedKind",
  "matchedId",
  "category",
  "accountingAccountId",
  "fundRestrictionId",
  "lines",
  "tagIds",
] as const;
export async function assertNativePayrollBankPatch(
  ctx: PortableQueryCtx,
  row: PortableDoc,
  patch: Record<string, unknown>,
) {
  if (
    !FROZEN_BANK_FIELDS.some(
      (field) =>
        Object.prototype.hasOwnProperty.call(patch, field) &&
        JSON.stringify(patch[field] ?? null) !==
          JSON.stringify(row[field] ?? null),
    )
  )
    return;
  if (await nativePayrollBankLink(ctx, row))
    throw new Error(
      "This bank transaction records a finalized payroll payment. Its amount, date, payment link and accounting allocation are retained with that payroll; use a reviewed payroll correction instead of editing the settled bank facts.",
    );
}

/** Protect the meaning of a retained bank payment even when ledger posting was
 * disabled for its payroll. Descriptive account edits remain available. */
export async function assertNativePayrollBankAccountPatch(
  ctx: PortableQueryCtx,
  account: PortableDoc,
  patch: { currency: string; accountType: string },
) {
  if (
    patch.currency === account.currency &&
    patch.accountType === account.accountType
  )
    return;
  for (const kind of ["payroll", "payroll_remittance"]) {
    const matches = await ctx.db
      .query("financialTransactions")
      .withIndex("by_account_match", (q) =>
        q.eq("accountId", String(account._id)).eq("matchedKind", kind),
      )
      .take(1001);
    if (matches.length > 1000)
      throw new Error(
        "This account has more than 1,000 payroll payment links. Review its retained payment history before changing its currency or account type.",
      );
    for (const row of matches) {
      if (await nativePayrollBankLink(ctx, row))
        throw new Error(
          "This account records a finalized payroll payment. Its currency and account type are retained with that payment; create a separate account for different bank facts.",
        );
    }
  }
}
