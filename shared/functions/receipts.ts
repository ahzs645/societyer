/**
 * PORTABLE FUNCTIONS: the donation-receipts domain
 * (list / issue / voidReceipt / remove).
 *
 * Reads/writes the `donationReceipts` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. Receipt numbers are serial per society (next = count + 1, zero-padded)
 * — issued receipts are voided, never deleted, to preserve the CRA audit trail.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function receiptsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("donationReceipts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function receiptIssuePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    charityNumber: string;
    donorName: string;
    donorEmail?: string;
    donorAddress?: string;
    amountCents: number;
    eligibleAmountCents: number;
    receivedOnISO: string;
    location: string;
    description?: string;
    isNonCash: boolean;
    appraiserName?: string;
  },
): Promise<string> {
  // Serial receipt numbers per society — next = count + 1, zero-padded.
  const existing = await ctx.db
    .query("donationReceipts")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  const next = String(existing.length + 1).padStart(6, "0");
  return ctx.db.insert("donationReceipts", {
    ...args,
    receiptNumber: next,
    issuedAtISO: new Date().toISOString(),
  });
}

export async function receiptVoidPortable(
  ctx: PortableMutationCtx,
  { id, reason }: { id: string; reason: string },
): Promise<void> {
  await ctx.db.patch(id, {
    voidedAtISO: new Date().toISOString(),
    voidReason: reason,
  });
}

export async function receiptRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  // Receipt numbers are serial (next = count + 1). Deleting a receipt would
  // make a future issue reuse a number, breaking the CRA audit-trail
  // invariant — void it instead (voidReceipt) to preserve the sequence.
  const receipt = await ctx.db.get(id);
  if (receipt?.receiptNumber) {
    throw new Error(
      "Issued donation receipts cannot be deleted — void the receipt instead to preserve serial numbering.",
    );
  }
  await ctx.db.delete(id);
}
