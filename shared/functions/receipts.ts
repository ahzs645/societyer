/**
 * PORTABLE FUNCTIONS: the donation-receipts domain
 * (list / issue / voidReceipt / remove).
 *
 * Reads/writes the `donationReceipts` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. Receipt numbers are serial per society (next = highest serial + 1,
 * zero-padded; numbers from another series, e.g. a previous receipting system,
 * are kept as written and never reused) — issued receipts are voided, never
 * deleted, to preserve the CRA audit trail.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export async function receiptsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("donationReceipts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

/** Next serial after the highest plain-digit receipt number (1 when there are none). */
export function nextReceiptSerial(receiptNumbers: readonly unknown[]): number {
  let highest = 0;
  for (const value of receiptNumbers) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) continue;
    highest = Math.max(highest, Number(value));
  }
  return highest + 1;
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
  await requireSocietyMembership(ctx, args.societyId);
  // Serial receipt numbers per society — next = highest serial + 1, zero-padded.
  // Only plain serials ("000041") count: receipts carried over from another
  // series ("RCS-2025-0031") keep their numbers and do not shift this one.
  const existing = await ctx.db
    .query("donationReceipts")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  const next = String(nextReceiptSerial(existing.map((receipt: any) => receipt.receiptNumber))).padStart(6, "0");
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
  const candidate = await ctx.db.get(id, "donationReceipts");
  if (!candidate) throw new Error("donationReceipts not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "donationReceipts", id, String(candidate.societyId));
  await ctx.db.patch(id, {
    voidedAtISO: new Date().toISOString(),
    voidReason: reason,
  });
}

export async function receiptRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  // Receipt numbers are serial (next = highest serial + 1). Deleting the last
  // receipt would make a future issue reuse its number, breaking the CRA
  // audit-trail invariant — void it instead (voidReceipt) to preserve it.
  const receipt = await ctx.db.get(id, "donationReceipts");
  if (!receipt) return;
  await requireSocietyMembership(ctx, String(receipt.societyId));
  await getOwned(ctx, "donationReceipts", id, String(receipt.societyId));
  if (receipt?.receiptNumber) {
    throw new Error(
      "Issued donation receipts cannot be deleted — void the receipt instead to preserve serial numbering.",
    );
  }
  await ctx.db.delete(id);
}
