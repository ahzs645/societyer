/**
 * PORTABLE FUNCTIONS: the financials domain
 * (list / detailByFiscalYear / create / update / remove).
 *
 * Reads/writes `financials` plus the related `financialStatementImports`,
 * `financialStatementImportLines`, `budgets`, and resolved document/meeting
 * rows over `ctx.db`. Each handler runs unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function financialsList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("financials")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function detailByFiscalYearPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear: string },
) {
  const rows = await ctx.db
    .query("financials")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const financials = rows
    .filter((row) => row.fiscalYear === fiscalYear)
    .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")));
  const financial = financials[0] ?? null;

  const imports = await ctx.db
    .query("financialStatementImports")
    .withIndex("by_society_fy", (q) => q.eq("societyId", societyId).eq("fiscalYear", fiscalYear))
    .collect();
  const importsWithLines = await Promise.all(
    imports
      .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")))
      .map(async (row) => {
        const lines = await ctx.db
          .query("financialStatementImportLines")
          .withIndex("by_statement_import", (q) => q.eq("statementImportId", row._id))
          .collect();
        return {
          ...row,
          lines: lines.sort((a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0)),
        };
      }),
  );

  const documentIds = new Set<string>();
  if (financial?.statementsDocId) documentIds.add(financial.statementsDocId);
  for (const row of importsWithLines as any[]) {
    for (const id of row.sourceDocumentIds ?? []) documentIds.add(id);
  }
  const documents = (await Promise.all(Array.from(documentIds).map((id) => ctx.db.get(String(id)))))
    .filter(Boolean);

  const budgets = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) => q.eq("societyId", societyId).eq("fiscalYear", fiscalYear))
    .collect();
  const presentedAtMeeting = financial?.presentedAtMeetingId
    ? await ctx.db.get(String(financial.presentedAtMeetingId))
    : null;

  return {
    financial,
    financials,
    imports: importsWithLines,
    documents,
    budgets,
    presentedAtMeeting,
  };
}

export interface FinancialCreateArgs {
  societyId: string;
  fiscalYear: string;
  periodEnd: string;
  revenueCents: number;
  expensesCents: number;
  netAssetsCents: number;
  restrictedFundsCents?: number;
  auditStatus: string;
  auditorName?: string;
  remunerationDisclosures: Array<{ role: string; amountCents: number }>;
}

export async function financialCreate(ctx: PortableMutationCtx, args: FinancialCreateArgs): Promise<string> {
  return ctx.db.insert("financials", args);
}

export interface FinancialPatch {
  fiscalYear?: string;
  periodEnd?: string;
  revenueCents?: number;
  expensesCents?: number;
  netAssetsCents?: number;
  restrictedFundsCents?: number;
  auditStatus?: string;
  auditorName?: string;
  approvedByBoardAt?: string;
  presentedAtMeetingId?: string;
  remunerationDisclosures?: Array<{ role: string; amountCents: number }>;
}

export async function financialUpdate(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: FinancialPatch },
): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function financialRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
