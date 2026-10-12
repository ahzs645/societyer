/**
 * PORTABLE FUNCTIONS: the rightsholding-transfer (cap-table) domain.
 *
 * Exercises the MULTI-ROW atomic write: `upsertRightsholdingTransfer` validates
 * the proposed ledger, writes the transfer, then `syncRightsHoldings` re-derives
 * every rightsHolding from the transfer ledger — deleting, patching, and
 * inserting several rows. On the local runtime all of that runs inside one
 * `db.transaction`, so a `validateLedger` rejection or any mid-sync failure rolls
 * the whole thing back (no half-applied cap table). Same handler on Convex.
 */

import {
  compareLedgerEntries,
  ledgerPostingIssues,
  materializeRightsHoldings,
  validateLedger,
  validateLedgerWithout,
} from "../equityLedger";
import { assertAllowedOption } from "../orgHubOptions";
import { organizationRuleScope } from "../entityRuleScope";
import { legalGovernanceProfile } from "../legalGovernanceProfiles";
import { transferConsentRequired } from "../operativeArticles";
import { cleanText, cleanList } from "./text";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { assertRegisterRowMayBeDeleted } from "../registerRetention";

/** Ledger order: date, then the optional same-day sequence, then creation time. */
export function transferChronologicalSort(left: any, right: any): number {
  return compareLedgerEntries(left, right);
}

/** Which posting gates apply to an organization's share ledger. */
export async function ledgerOrganizationContext(ctx: PortableQueryCtx, societyId: string) {
  const organization = await ctx.db.get(societyId, "societies");
  return {
    isCorporation: organizationRuleScope(organization as any).isCorporation,
    isBcCompany: legalGovernanceProfile(organization as any)?.id === "bc_company",
    transferConsentRequired: transferConsentRequired(organization as any),
  };
}

async function societyClasses(ctx: PortableQueryCtx, societyId: string) {
  return ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

/** Re-derive rightsHoldings from the transfer ledger. Multi-row write. */
export async function syncRightsHoldings(ctx: PortableMutationCtx, societyId: string): Promise<void> {
  const [existingHoldings, transfers] = await Promise.all([
    ctx.db.query("rightsHoldings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const now = new Date().toISOString();
  const nextHoldings = materializeRightsHoldings(transfers.slice().sort(transferChronologicalSort) as any);
  const nextByKey = new Map(nextHoldings.map((h) => [`${h.rightsClassId}:${h.holderKey}`, h]));
  const existingByKey = new Map<string, any>(existingHoldings.map((h) => [`${h.rightsClassId}:${h.holderKey}`, h]));

  for (const existing of existingHoldings) {
    const key = `${existing.rightsClassId}:${existing.holderKey}`;
    if (!nextByKey.has(key)) await ctx.db.delete(existing._id);
  }
  for (const holding of nextHoldings) {
    const key = `${holding.rightsClassId}:${holding.holderKey}`;
    const existing = existingByKey.get(key);
    const payload = {
      societyId,
      rightsClassId: holding.rightsClassId,
      holderRoleHolderId: holding.holderRoleHolderId,
      holderKey: holding.holderKey,
      quantity: holding.quantity,
      status: holding.status,
      lastTransactionId: holding.lastTransactionId,
      sourceDocumentIds: holding.sourceDocumentIds,
      sourceExternalIds: holding.sourceExternalIds,
      updatedAtISO: now,
    };
    if (existing) await ctx.db.patch(existing._id, payload);
    else await ctx.db.insert("rightsHoldings", { ...payload, createdAtISO: now });
  }
}

export interface UpsertRightsholdingTransferArgs {
  id?: string;
  societyId: string;
  transferType: string;
  status?: string;
  transferDate?: string;
  eventId?: string;
  precedentRunId?: string;
  rightsClassId?: string;
  sourceRoleHolderId?: string;
  destinationRoleHolderId?: string;
  sourceHolderName?: string;
  destinationHolderName?: string;
  quantity?: number;
  considerationType?: string;
  considerationDescription?: string;
  priceToOrganizationCents?: number;
  priceToOrganizationCurrency?: string;
  priceToVendorCents?: number;
  priceToVendorCurrency?: string;
  sequence?: number;
  fullyPaidConfirmedAt?: string;
  directorConsentDocumentId?: string;
  directorConsentResolutionId?: string;
  redemptionNoticeDate?: string;
  redemptionNoticeWaivedOn?: string;
  solvencyConfirmedAt?: string;
  solvencyBasis?: string;
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertRightsholdingTransferPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertRightsholdingTransferArgs,
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (id) await requireOwnedRow(ctx, "rightsholdingTransfers", id);
  if (args.precedentRunId) {
    await getOwned(ctx, "legalPrecedentRuns", args.precedentRunId, args.societyId);
  }
  if (args.rightsClassId) await getOwned(ctx, "rightsClasses", args.rightsClassId, args.societyId);
  if (args.sourceRoleHolderId) {
    await getOwned(ctx, "roleHolders", args.sourceRoleHolderId, args.societyId);
  }
  if (args.destinationRoleHolderId) {
    await getOwned(ctx, "roleHolders", args.destinationRoleHolderId, args.societyId);
  }
  for (const documentId of args.sourceDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, args.societyId);
  }
  if (args.directorConsentDocumentId) await getOwned(ctx, "documents", args.directorConsentDocumentId, args.societyId);
  if (args.directorConsentResolutionId) await getOwned(ctx, "writtenResolutions", args.directorConsentResolutionId, args.societyId);
  if (args.sequence !== undefined && !(Number.isInteger(args.sequence) && args.sequence >= 0)) {
    throw new Error("The same-day sequence must be a whole number (0, 1, 2 ...).");
  }
  assertAllowedOption("rightsholdingTransferTypes", args.transferType, "Rights transfer type", false);
  assertAllowedOption("rightsholdingTransferStatuses", args.status, "Rights transfer status");
  assertAllowedOption("currencies", args.priceToOrganizationCurrency, "Organization consideration currency");
  assertAllowedOption("currencies", args.priceToVendorCurrency, "Vendor consideration currency");
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    transferType: cleanText(args.transferType) || "transfer",
    status: cleanText(args.status) || "draft",
    transferDate: cleanText(args.transferDate),
    eventId: cleanText(args.eventId),
    precedentRunId: args.precedentRunId,
    rightsClassId: args.rightsClassId,
    sourceRoleHolderId: args.sourceRoleHolderId,
    destinationRoleHolderId: args.destinationRoleHolderId,
    sourceHolderName: cleanText(args.sourceHolderName),
    destinationHolderName: cleanText(args.destinationHolderName),
    quantity: args.quantity,
    considerationType: cleanText(args.considerationType),
    considerationDescription: cleanText(args.considerationDescription),
    priceToOrganizationCents: args.priceToOrganizationCents,
    priceToOrganizationCurrency: cleanText(args.priceToOrganizationCurrency),
    priceToVendorCents: args.priceToVendorCents,
    priceToVendorCurrency: cleanText(args.priceToVendorCurrency),
    sequence: args.sequence,
    fullyPaidConfirmedAt: cleanText(args.fullyPaidConfirmedAt),
    directorConsentDocumentId: args.directorConsentDocumentId,
    directorConsentResolutionId: args.directorConsentResolutionId,
    redemptionNoticeDate: cleanText(args.redemptionNoticeDate),
    redemptionNoticeWaivedOn: cleanText(args.redemptionNoticeWaivedOn),
    solvencyConfirmedAt: cleanText(args.solvencyConfirmedAt),
    solvencyBasis: cleanText(args.solvencyBasis),
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  const existingTransfer = id ? await ctx.db.get(id) : null;
  const [existingTransfers, classes, organization] = await Promise.all([
    ctx.db
      .query("rightsholdingTransfers")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect(),
    societyClasses(ctx, args.societyId),
    ledgerOrganizationContext(ctx, args.societyId),
  ]);
  const otherTransfers = existingTransfers.filter((transfer) => !id || String(transfer._id) !== String(id));
  const proposedRow = {
    ...payload,
    _id: id ?? "proposed",
    _creationTime: existingTransfer?._creationTime ?? Date.now(),
    createdAtISO: existingTransfer?.createdAtISO ?? now,
  } as any;
  const postingIssues = ledgerPostingIssues(proposedRow, {
    ...organization,
    rightsClass: classes.find((row) => String(row._id) === String(payload.rightsClassId)) as any,
    otherTransfers: otherTransfers.slice().sort(transferChronologicalSort) as any,
  });
  if (postingIssues.length) throw new Error(postingIssues.join(" "));
  const proposedTransfers = otherTransfers.concat([proposedRow]).sort(transferChronologicalSort);
  if (existingTransfer?.status === "posted" && payload.status !== "posted") {
    // Voiding (or un-posting) a posted row must not orphan the entries after it.
    validateLedgerWithout(otherTransfers as any, existingTransfer as any, "void", { classes: classes as any });
  }
  validateLedger(proposedTransfers as any, { classes: classes as any });
  if (id) {
    await ctx.db.patch(id, payload);
    await syncRightsHoldings(ctx, args.societyId);
    const previousSocietyId = existingTransfer?.societyId ? String(existingTransfer.societyId) : undefined;
    if (previousSocietyId && previousSocietyId !== args.societyId) {
      await syncRightsHoldings(ctx, previousSocietyId);
    }
    return id;
  }
  const transferId = await ctx.db.insert("rightsholdingTransfers", { ...payload, createdAtISO: now });
  await syncRightsHoldings(ctx, args.societyId);
  return transferId;
}

export async function removeRightsholdingTransferPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  const existing = await requireOwnedRow(ctx, "rightsholdingTransfers", id);
  // A posted transaction is part of the permanent securities register.
  assertRegisterRowMayBeDeleted(await ctx.db.get(String(existing.societyId)), "rightsholdingTransfers", existing);
  if (existing?.status === "posted") {
    // Re-validate what remains: deleting an issuance must not leave a later
    // transfer or redemption drawing on shares that no longer exist.
    const societyId = String(existing.societyId);
    const [rows, classes] = await Promise.all([
      ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      societyClasses(ctx, societyId),
    ]);
    validateLedgerWithout(
      rows.filter((row) => String(row._id) !== String(id)) as any,
      existing as any,
      "delete",
      { classes: classes as any },
    );
  }
  await ctx.db.delete(id);
  if (existing?.societyId) await syncRightsHoldings(ctx, String(existing.societyId));
}

export async function removeRightsClassPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await requireOwnedRow(ctx, "rightsClasses", id);
  const [holding, transfer] = await Promise.all([
    ctx.db
      .query("rightsHoldings")
      .withIndex("by_class", (q) => q.eq("rightsClassId", id))
      .first(),
    ctx.db
      .query("rightsholdingTransfers")
      .withIndex("by_class", (q) => q.eq("rightsClassId", id))
      .first(),
  ]);
  if (holding || transfer) {
    throw new Error("Cannot delete a rights class while holdings or transfers reference it.");
  }
  await ctx.db.delete(id);
}
