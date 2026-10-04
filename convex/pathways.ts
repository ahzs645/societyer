import { v } from "convex/values";
import { internal } from "./_generated/api";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation, internalQuery, internalMutation, internalAction } from "./lib/untypedServer";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import * as pathway from "../shared/functions/pathways";
import { dispatchSubmission as dispatchTrustedSubmission, submissionIdentitySha256, type SubmissionRecord } from "../shared/pathways/submissions";
import { pathwaySubmissionAdapters, pathwaySubmissionCapabilities } from "./lib/pathwaySubmissionAdapters";
import type { PortablePrincipal } from "../shared/portable/ctx";
import { canonicalPipelineJson } from "../shared/pathways/pipeline";

export const status = authorizedQuery("pathways:status", query)({ args: { societyId: v.id("societies") }, handler: async (ctx: any, args: any) => ({ ...await pathway.statusPortable(await toPortableQueryCtx(ctx), args), submissionCapabilities: await pathwaySubmissionCapabilities() }) });
export const start = authorizedMutation("pathways:start", mutation)({ args: { societyId: v.id("societies") }, handler: async (ctx: any, args: any) => pathway.startPortable(await toPortableMutationCtx(ctx), args) });
export const saveInput = authorizedMutation("pathways:saveInput", mutation)({ args: { runId: v.id("pathwayRuns"), inputs: v.any() }, handler: async (ctx: any, args: any) => pathway.saveInputPortable(await toPortableMutationCtx(ctx), args) });
const stepArgs = { runId: v.id("pathwayRuns"), nodeKey: v.string(), notes: v.optional(v.string()) };
export const completeStep = authorizedMutation("pathways:completeStep", mutation)({ args: { ...stepArgs, documentId: v.optional(v.id("documents")) }, handler: async (ctx: any, args: any) => pathway.completeStepPortable(await toPortableMutationCtx(ctx), args) });
export const approve = authorizedMutation("pathways:approve", mutation)({ args: stepArgs, handler: async (ctx: any, args: any) => pathway.approvePortable(await toPortableMutationCtx(ctx), args) });
export const reject = authorizedMutation("pathways:reject", mutation)({ args: stepArgs, handler: async (ctx: any, args: any) => pathway.rejectPortable(await toPortableMutationCtx(ctx), args) });
export const requestSubmission = authorizedMutation("pathways:requestSubmission", mutation)({ args: { runId: v.id("pathwayRuns"), nodeKey: v.string() }, handler: async (ctx: any, args: any) => {
  const id = await pathway.requestSubmissionPortable(await toPortableMutationCtx(ctx), args);
  const row = await ctx.db.get(id);
  if (row?.status === "queued") {
    const adapter = pathwaySubmissionAdapters.resolve(row.adapterId);
    if (!adapter || !await adapter.isConfigured()) throw new Error("The reviewed submission adapter is not installed or configured. No submission was queued.");
    await ctx.scheduler.runAfter(0, internal.pathways.dispatchSubmission, { submissionId: id });
  }
  return id;
} });
export const recordManualReceipt = authorizedMutation("pathways:recordManualReceipt", mutation)({ args: { ...stepArgs, documentId: v.id("documents"), reference: v.string() }, handler: async (ctx: any, args: any) => pathway.recordManualReceiptPortable(await toPortableMutationCtx(ctx), args) });

// Only trusted server functions reconstruct authority from the frozen requester.
// Neither clients nor adapter responses supply a principal, actor, or scope.
function workerPrincipal(row: SubmissionRecord): PortablePrincipal {
  return { kind: "service", runtime: "convex-hosted", assurance: "trusted-internal", subject: `pathway:${row._id}`, societyId: row.societyId, actorUserId: row.actorId, scopes: ["tasks:read", "tasks:write", "filings:submit", "documents:read"] };
}
export const loadSubmission = internalQuery({ args: { submissionId: v.id("pathwaySubmissionOutbox") }, handler: async (ctx: any, args: any) => ctx.db.get(args.submissionId) });
export const authorizeSubmission = internalQuery({ args: { submissionId: v.id("pathwaySubmissionOutbox") }, handler: async (ctx: any, args: any) => {
  const row = await ctx.db.get(args.submissionId);
  if (!row) throw new Error("Submission not found.");
  const portable = await toPortableQueryCtx(ctx); portable.principal = workerPrincipal(row);
  await pathway.authorizeSubmissionPortable(portable, row); return null;
} });
export const claimSubmission = internalMutation({ args: { submissionId: v.id("pathwaySubmissionOutbox"), expectedIdentitySha256: v.string(), attemptId: v.string(), startedAtISO: v.string() }, handler: async (ctx: any, args: any) => {
  const row = await ctx.db.get(args.submissionId);
  if (!row || row.status !== "queued") return null;
  if (await submissionIdentitySha256(row) !== args.expectedIdentitySha256) throw new Error("Submission identity changed before claim.");
  const portable = await toPortableMutationCtx(ctx); portable.principal = workerPrincipal(row);
  await pathway.authorizeSubmissionPortable(portable, row);
  await ctx.db.patch(row._id, { status: "dispatching", attemptId: args.attemptId, updatedAtISO: args.startedAtISO });
  await ctx.db.insert("pathwayAudit", { societyId: row.societyId, runId: row.runId, nodeKey: row.stepKey, event: "submission.dispatch-claimed", actorUserId: row.actorId, atISO: args.startedAtISO, detailJson: canonicalPipelineJson({ attemptId: args.attemptId }) });
  return { ...row, status: "dispatching", attemptId: args.attemptId, updatedAtISO: args.startedAtISO };
} });
export const completeSubmission = internalMutation({ args: { submissionId: v.id("pathwaySubmissionOutbox"), attemptId: v.string(), outcome: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("uncertain"), v.literal("blocked")), receiptJson: v.string(), error: v.optional(v.string()), completedAtISO: v.string() }, handler: async (ctx: any, args: any) => {
  const row = await ctx.db.get(args.submissionId);
  if (!row || row.status !== "dispatching" || row.attemptId !== args.attemptId) throw new Error("Submission attempt is no longer active.");
  await ctx.db.patch(row._id, { status: args.outcome, receiptJson: args.receiptJson, ...(args.error ? { error: args.error } : {}), updatedAtISO: args.completedAtISO });
  const step = await ctx.db.query("pathwaySteps").withIndex("by_run_node", (q: any) => q.eq("runId", row.runId).eq("nodeKey", row.stepKey)).unique();
  if (!step || step.societyId !== row.societyId) throw new Error("Submission step is invalid.");
  if (args.outcome === "accepted" || args.outcome === "rejected") await ctx.db.patch(step._id, { state: args.outcome === "accepted" ? "submitted" : "rejected", updatedAtISO: args.completedAtISO });
  await ctx.db.patch(row.runId, { status: args.outcome === "accepted" ? "running" : args.outcome === "rejected" ? "rejected" : "submission_attention", updatedAtISO: args.completedAtISO });
  await ctx.db.insert("pathwayAudit", { societyId: row.societyId, runId: row.runId, nodeKey: row.stepKey, event: `submission.${args.outcome}`, actorUserId: row.actorId, atISO: args.completedAtISO, detailJson: canonicalPipelineJson({ submissionId: row._id, attemptId: args.attemptId, receipt: JSON.parse(args.receiptJson) }) });
  return null;
} });
/** Only the reviewed server allowlist can send; no client URLs or credentials. */
export const dispatchSubmission = internalAction({ args: { submissionId: v.id("pathwaySubmissionOutbox") }, handler: async (ctx: any, args: any) => dispatchTrustedSubmission(args, {
  adapters: pathwaySubmissionAdapters,
  authorize: async row => { await ctx.runQuery(internal.pathways.authorizeSubmission, { submissionId: row._id }); },
  store: {
    load: id => ctx.runQuery(internal.pathways.loadSubmission, { submissionId: id }),
    claim: claim => ctx.runMutation(internal.pathways.claimSubmission, claim),
    complete: complete => ctx.runMutation(internal.pathways.completeSubmission, complete),
  },
}) });
