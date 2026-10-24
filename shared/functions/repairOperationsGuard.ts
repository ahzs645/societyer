import type { PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { computeInvoiceTotals } from "../invoicing";

export function repairApprovalScope(job: Record<string, any>): string {
  return JSON.stringify({ partyKind: job.partyKind, memberId: job.memberId, counterpartyId: job.counterpartyId, billToName: job.billToName, asset: job.asset, serialNumber: job.serialNumber, problem: job.problem, currency: job.currency, lines: job.lines ?? [] });
}

/** Shared by every repair status and billing entry point, including legacy APIs. */
export async function assertRepairApprovalPortable(ctx: PortableQueryCtx, repairJobId: string): Promise<void> {
  const job: any = await ctx.db.get(repairJobId, "repairJobs");
  if (!job) throw new Error("repairJobs not found.");
  await getOwned(ctx, "repairJobs", repairJobId, job.societyId);
  const operations: any = await ctx.db.query("repairOperations").withIndex("by_repair_job", (q) => q.eq("repairJobId", repairJobId)).first();
  if (!operations?.approvalRequired) return;
  if (operations.approvalStatus !== "approved" || operations.approvalScope !== repairApprovalScope(job) || operations.approvedAmountCents !== computeInvoiceTotals(job.lines ?? []).totalCents) {
    throw new Error("Record customer approval for the current repair scope and estimate before starting work or billing.");
  }
}

export async function assertRepairBillablePortable(ctx: PortableQueryCtx, repairJobId: string): Promise<void> {
  await assertRepairApprovalPortable(ctx, repairJobId);
  const entries = await ctx.db.query("repairTimeEntries").withIndex("by_repair_job", (q) => q.eq("repairJobId", repairJobId)).take(10001);
  if (entries.length > 10000) throw new Error("This repair's time history exceeds the billing limit.");
  if (entries.some((entry) => !entry.endAtISO)) throw new Error("Stop running timers before billing the repair.");
}
