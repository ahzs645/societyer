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

import { materializeRightsHoldings, validateLedger } from "../equityLedger";
import { assertAllowedOption } from "../orgHubOptions";
import { cleanText, cleanList } from "./text";
import type { PortableMutationCtx } from "../portable/ctx";

export function transferChronologicalSort(left: any, right: any): number {
  const leftDate = String(left.transferDate ?? left.createdAtISO ?? left._creationTime ?? "");
  const rightDate = String(right.transferDate ?? right.createdAtISO ?? right._creationTime ?? "");
  const dateSort = leftDate.localeCompare(rightDate);
  if (dateSort !== 0) return dateSort;
  return Number(left._creationTime ?? 0) - Number(right._creationTime ?? 0);
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
  sourceDocumentIds?: string[];
  sourceExternalIds?: string[];
  notes?: string;
}

export async function upsertRightsholdingTransferPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertRightsholdingTransferArgs,
): Promise<string> {
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
    sourceDocumentIds: args.sourceDocumentIds ?? [],
    sourceExternalIds: cleanList(args.sourceExternalIds),
    notes: cleanText(args.notes),
    updatedAtISO: now,
  };
  const existingTransfers = await ctx.db
    .query("rightsholdingTransfers")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  const proposedTransfers = existingTransfers
    .filter((transfer) => !id || String(transfer._id) !== String(id))
    .concat([{ ...payload, _id: id ?? "proposed", _creationTime: Date.now(), createdAtISO: now } as any])
    .sort(transferChronologicalSort);
  validateLedger(proposedTransfers as any);
  if (id) {
    await ctx.db.patch(id, payload);
    await syncRightsHoldings(ctx, args.societyId);
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
  const existing = await ctx.db.get(id);
  await ctx.db.delete(id);
  if (existing?.societyId) await syncRightsHoldings(ctx, String(existing.societyId));
}

export async function removeRightsClassPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string },
): Promise<void> {
  await ctx.db.delete(id);
}
