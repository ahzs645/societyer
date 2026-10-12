/**
 * PORTABLE FUNCTIONS: the dividends domain (list / preview / create / declare /
 * remove / summary).
 *
 * Reads/writes the `dividends` table over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle. The
 * dividend math (exact decimal rates, record-date entitlements, the solvency
 * gate) lives in the framework-free `../dividends` module.
 *
 * Shares outstanding come from the posted share ledger as at the record date
 * when the declaration names a class; a hand-typed count is accepted only when
 * the ledger holds nothing for that class. The YCN ±1% total cross-check stays
 * a warning and never blocks.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import {
  classByClassWarnings,
  dividendDeclarationProblems,
  dividendEntitlements,
  dividendStatusNeedsSolvency,
  dividendTotalForShares,
  legacyPerShareCents,
  normalizePerShareAmount,
  perShareAmountFromCents,
  reconcileTotals,
  rowPerShareAmount,
  totalDeclaredByClass,
  totalDeclaredByCurrency,
  validateDividend,
  type DividendClassFacts,
  type DividendDeclaration,
  type DividendEntitlementSnapshot,
  type DividendRuleScope,
  type DividendStatus,
} from "../dividends";
// Swap point: replace with `holdingsAsOf` from "../equityLedger" once the
// ledger's own as-of helper lands (same name and signature).
import { holdingsAsOf, toDividendHoldingRows, undatedPostedTransfers } from "../dividendHoldingsAsOf";
import { legalGovernanceProfile } from "../legalGovernanceProfiles";

function centsToAmount(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("dividends")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return (rows as Array<Record<string, any>>)
    .map((row): Record<string, any> => ({ ...row, perShareAmount: rowPerShareAmount(row) }))
    .sort((a, b) => String(a.declaredOn).localeCompare(String(b.declaredOn)));
}

/** Which dividend rule family applies to the organization. */
export function dividendRuleScope(society: Record<string, any> | null | undefined): DividendRuleScope {
  return legalGovernanceProfile(society as any)?.id === "bc_company" ? "bc_company" : "other_corporation";
}

export interface DividendDraftArgs {
  societyId: string;
  declaredOn: string;
  /** Free-text class label (required for older callers; derived from the class when rightsClassId is set). */
  shareClass?: string;
  rightsClassId?: string;
  /** Decimal per-share amount in currency units, e.g. "0.0125". Preferred. */
  perShareAmount?: string;
  /** Legacy integer cents per share; used only when perShareAmount is absent. */
  perShareCents?: number;
  /** Manual count, used only when the ledger has no holdings for the class. */
  sharesOutstanding?: number;
  currency: string;
  recordDate?: string;
  paymentDate?: string;
  excludedClassIds?: string[];
}

export interface DividendPreview {
  shareClass: string;
  perShareAmount: string;
  perShareCents: number;
  perShareCentsExact: boolean;
  sharesOutstanding: number;
  sharesSource: "ledger" | "manual";
  snapshot: DividendEntitlementSnapshot | null;
  totalAmount: string;
  totalCents: number;
  warnings: string[];
  scope: DividendRuleScope;
}

/**
 * Validate a draft and compute the record-date snapshot. Shared by preview and
 * create so the drawer shows exactly what will be stored.
 */
async function computeDraft(ctx: PortableQueryCtx, args: DividendDraftArgs): Promise<DividendPreview> {
  const society = await ctx.db.get(args.societyId, "societies");
  const scope = dividendRuleScope(society as any);
  const warnings: string[] = [];

  const perShareAmount = args.perShareAmount !== undefined
    ? normalizePerShareAmount(args.perShareAmount)
    : typeof args.perShareCents === "number" && Number.isInteger(args.perShareCents) && args.perShareCents >= 0
      ? perShareAmountFromCents(args.perShareCents)
      : null;
  if (!perShareAmount) throw new Error("Enter the per-share amount as a decimal number of up to 10 decimal places, such as 0.25.");
  const legacy = legacyPerShareCents(perShareAmount)!;

  let rightsClass: Record<string, any> | null = null;
  if (args.rightsClassId) rightsClass = await getOwned(ctx, "rightsClasses", args.rightsClassId, args.societyId);
  const excluded: Record<string, any>[] = [];
  for (const id of args.excludedClassIds ?? []) excluded.push(await getOwned(ctx, "rightsClasses", id, args.societyId));
  const shareClass = String(rightsClass?.className ?? args.shareClass ?? "").trim();
  if (!shareClass) throw new Error("Choose the share class the dividend is declared on.");

  let snapshot: DividendEntitlementSnapshot | null = null;
  let sharesOutstanding: number;
  let sharesSource: "ledger" | "manual" = "manual";
  if (rightsClass && args.recordDate) {
    const [transfers, roleHolders] = await Promise.all([
      ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
      ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    ]);
    const names = new Map<string, string>(roleHolders.map((row) => [`roleHolder:${row._id}`, String(row.fullName ?? "")]));
    const classTransfers = transfers.filter((row) => row.rightsClassId === rightsClass!._id);
    const holdings = toDividendHoldingRows(holdingsAsOf(classTransfers as any, args.recordDate));
    if (holdings.some((row) => row.rightsClassId === rightsClass!._id && row.quantity > 0)) {
      snapshot = dividendEntitlements(holdings, String(rightsClass._id), perShareAmount, (key) => names.get(key) || undefined);
      sharesOutstanding = snapshot.sharesOutstanding;
      sharesSource = "ledger";
      const undated = undatedPostedTransfers(classTransfers as any[]).length;
      if (undated) warnings.push(`${undated} posted ledger entr${undated === 1 ? "y has" : "ies have"} no transfer date and ${undated === 1 ? "is" : "are"} left out of the record-date snapshot. Date ${undated === 1 ? "it" : "them"} in the share ledger.`);
      if (typeof args.sharesOutstanding === "number" && args.sharesOutstanding !== sharesOutstanding) {
        warnings.push(`The share ledger shows ${sharesOutstanding.toLocaleString()} shares of ${shareClass} at the record date, not the ${args.sharesOutstanding.toLocaleString()} entered. The ledger count is used.`);
      }
      if (snapshot.roundingDifferenceCents !== 0) {
        warnings.push(`Paying each holder in whole cents differs from the exact total by ${snapshot.roundingDifferenceCents > 0 ? "+" : ""}${snapshot.roundingDifferenceCents} cent(s).`);
      }
    } else {
      if (typeof args.sharesOutstanding !== "number") throw new Error(`The share ledger has no posted ${shareClass} holdings at the record date. Post the share issuances, or enter the shares outstanding by hand.`);
      sharesOutstanding = args.sharesOutstanding;
      warnings.push(`The share ledger has no posted ${shareClass} holdings at the record date, so the hand-entered share count is used and no per-holder schedule is produced.`);
    }
  } else {
    if (typeof args.sharesOutstanding !== "number") throw new Error("Choose a share class and a record date so shares outstanding can be taken from the ledger, or enter the shares outstanding.");
    sharesOutstanding = args.sharesOutstanding;
    if (!rightsClass) warnings.push("No share class record is linked, so shares outstanding are not checked against the ledger.");
    else warnings.push("Set a record date so shares outstanding and each holder's entitlement come from the share ledger.");
  }

  const validation = validateDividend({
    declaredOn: args.declaredOn,
    shareClass,
    perShareCents: legacy.cents,
    sharesOutstanding,
    currency: args.currency,
  });
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  const problems = dividendDeclarationProblems({
    declaredOn: args.declaredOn,
    recordDate: args.recordDate,
    paymentDate: args.paymentDate,
    rightsClassId: args.rightsClassId,
    excludedClassIds: args.excludedClassIds,
  }, scope);
  if (problems.length) throw new Error(problems.join(" "));

  const facts = (row: Record<string, any>): DividendClassFacts => ({ id: String(row._id), className: String(row.className ?? ""), dividendEntitlement: row.dividendEntitlement });
  warnings.push(...classByClassWarnings(rightsClass ? facts(rightsClass) : undefined, excluded.map(facts)));
  if (!legacy.exact) warnings.push(`The rate ${perShareAmount} includes a fraction of a cent. It is stored exactly; each payment is rounded to whole cents.`);

  const totals = snapshot ?? dividendTotalForShares(perShareAmount, sharesOutstanding);
  return {
    shareClass,
    perShareAmount,
    perShareCents: legacy.cents,
    perShareCentsExact: legacy.exact,
    sharesOutstanding,
    sharesSource,
    snapshot,
    totalAmount: totals.totalAmount,
    totalCents: totals.totalCents,
    warnings,
    scope,
  };
}

/**
 * The drawer's live preview. Input problems come back as `{ ok: false }`
 * instead of throwing, so a half-filled form never breaks the page.
 */
export async function previewPortable(
  ctx: PortableQueryCtx,
  args: DividendDraftArgs,
): Promise<({ ok: true } & DividendPreview) | { ok: false; error: string }> {
  await requireSocietyMembership(ctx, args.societyId);
  try {
    return { ok: true, ...(await computeDraft(ctx, args)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Pick-lists for the declaration drawer: the share classes (with any recorded
 * dividend entitlement) and the directors' written resolutions a declaration
 * can cite. Only identifying fields are returned.
 */
export async function optionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [classes, resolutions, society] = await Promise.all([
    ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("writtenResolutions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.get(societyId, "societies"),
  ]);
  return {
    scope: dividendRuleScope(society as any),
    classes: (classes as Array<Record<string, any>>)
      .filter((row) => row.classType !== "membership")
      .map((row) => ({
        _id: String(row._id),
        className: String(row.className ?? ""),
        classType: row.classType,
        status: row.status,
        ...(typeof row.dividendEntitlement === "string" ? { dividendEntitlement: row.dividendEntitlement } : {}),
      }))
      .sort((a, b) => a.className.localeCompare(b.className)),
    resolutions: (resolutions as Array<Record<string, any>>)
      .filter((row) => row.body === undefined || row.body === "directors")
      .map((row) => ({ _id: String(row._id), title: String(row.title ?? ""), circulatedAtISO: row.circulatedAtISO, completedAtISO: row.completedAtISO }))
      .sort((a, b) => String(b.circulatedAtISO ?? "").localeCompare(String(a.circulatedAtISO ?? ""))),
  };
}

export interface DividendCreateArgs extends DividendDraftArgs {
  status?: DividendStatus;
  solvencyConfirmedAt?: string;
  solvencyBasis?: string;
  declaredByResolutionId?: string;
  expectedTotalCents?: number;
  notes?: string;
  nowISO: string;
}

export async function createPortable(ctx: PortableMutationCtx, args: DividendCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.declaredByResolutionId) await getOwned(ctx, "writtenResolutions", args.declaredByResolutionId, args.societyId);
  const draft = await computeDraft(ctx, args);
  const status: DividendStatus = args.status ?? "draft";
  const gate = dividendDeclarationProblems({ ...args, status }, draft.scope);
  if (gate.length) throw new Error(gate.join(" "));

  // Surface a reconciliation warning (never block) when a keyed total disagrees
  // with the exact total (the YCN "Record - Dividends" ±1% cross-check).
  const mismatch: string[] = [];
  if (typeof args.expectedTotalCents === "number") {
    const recon = reconcileTotals(draft.totalCents, args.expectedTotalCents);
    if (!recon.reconciled) {
      mismatch.push(`⚠ Dividend total mismatch: entered ${args.currency} ${centsToAmount(recon.enteredCents)} vs computed ${args.currency} ${centsToAmount(recon.expectedCents)} (per-share × shares). Verify the rate, share count, or total.`);
    }
  }
  const notes = [...mismatch, args.notes].filter(Boolean).join("\n\n") || undefined;

  return ctx.db.insert("dividends", {
    societyId: args.societyId,
    declaredOn: args.declaredOn,
    shareClass: draft.shareClass,
    perShareCents: draft.perShareCents,
    perShareAmount: draft.perShareAmount,
    sharesOutstanding: draft.sharesOutstanding,
    sharesSource: draft.sharesSource,
    currency: args.currency,
    totalCents: draft.totalCents,
    totalAmount: draft.totalAmount,
    ...(args.rightsClassId ? { rightsClassId: args.rightsClassId } : {}),
    ...(args.recordDate ? { recordDate: args.recordDate } : {}),
    ...(args.paymentDate ? { paymentDate: args.paymentDate } : {}),
    ...(args.excludedClassIds?.length ? { excludedClassIds: args.excludedClassIds } : {}),
    ...(draft.snapshot ? { entitlements: draft.snapshot.entitlements } : {}),
    status,
    ...(args.solvencyConfirmedAt ? { solvencyConfirmedAt: args.solvencyConfirmedAt } : {}),
    ...(args.solvencyBasis?.trim() ? { solvencyBasis: args.solvencyBasis.trim() } : {}),
    ...(args.declaredByResolutionId ? { declaredByResolutionId: args.declaredByResolutionId } : {}),
    notes,
    createdAtISO: args.nowISO,
    updatedAtISO: args.nowISO,
  });
}

/**
 * Move a declaration to declared / paid / cancelled. Declared and paid require
 * the directors' solvency confirmation and its basis (BC: s. 70 (2)).
 */
export async function setStatusPortable(
  ctx: PortableMutationCtx,
  args: {
    id: string;
    status: DividendStatus;
    solvencyConfirmedAt?: string;
    solvencyBasis?: string;
    declaredByResolutionId?: string;
    paymentDate?: string;
    nowISO: string;
  },
): Promise<void> {
  const row = await requireOwnedRow<Record<string, any> & { _id: string; societyId: string }>(ctx, "dividends", args.id);
  if (args.declaredByResolutionId) await getOwned(ctx, "writtenResolutions", args.declaredByResolutionId, row.societyId);
  const society = await ctx.db.get(row.societyId, "societies");
  const scope = dividendRuleScope(society as any);
  const next = {
    status: args.status,
    declaredOn: row.declaredOn,
    recordDate: row.recordDate,
    paymentDate: args.paymentDate ?? row.paymentDate,
    solvencyConfirmedAt: args.solvencyConfirmedAt ?? row.solvencyConfirmedAt,
    solvencyBasis: args.solvencyBasis ?? row.solvencyBasis,
  };
  const problems = dividendDeclarationProblems(next, scope);
  if (problems.length) throw new Error(problems.join(" "));
  if (row.status === "cancelled" && args.status !== "cancelled") throw new Error("A cancelled declaration cannot be reopened. Record a new declaration.");
  if (row.status === "paid" && dividendStatusNeedsSolvency(args.status) && args.status !== "paid") throw new Error("A paid dividend cannot be moved back to declared.");
  await ctx.db.patch(args.id, {
    status: args.status,
    ...(next.paymentDate ? { paymentDate: next.paymentDate } : {}),
    ...(next.solvencyConfirmedAt ? { solvencyConfirmedAt: next.solvencyConfirmedAt } : {}),
    ...(typeof next.solvencyBasis === "string" && next.solvencyBasis.trim() ? { solvencyBasis: next.solvencyBasis.trim() } : {}),
    ...(args.declaredByResolutionId ? { declaredByResolutionId: args.declaredByResolutionId } : {}),
    updatedAtISO: args.nowISO,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await requireOwnedRow(ctx, "dividends", id);
  await ctx.db.delete(id);
}

/** Drafts and cancelled declarations are not declared dividends. */
export function countsAsDeclared(row: { status?: unknown }): boolean {
  return row.status !== "draft" && row.status !== "cancelled";
}

export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("dividends")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();

  const declarations: DividendDeclaration[] = (rows as Array<Record<string, any>>).filter(countsAsDeclared).map((r) => ({
    declaredOn: String(r.declaredOn),
    shareClass: String(r.shareClass),
    perShareCents: Number(r.perShareCents),
    sharesOutstanding: Number(r.sharesOutstanding),
    currency: String(r.currency),
    totalCents: typeof r.totalCents === "number" ? r.totalCents : undefined,
  }));

  return {
    byClass: totalDeclaredByClass(declarations),
    byCurrency: totalDeclaredByCurrency(declarations),
  };
}
