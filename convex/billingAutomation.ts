import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./lib/untypedServer";
import { authorizedQuery, authorizedMutation } from "./lib/authorizedServer";
import { toPortableQueryCtx, toPortableMutationCtx, convexPortableDb } from "./lib/portable";
import { makeCapabilities } from "../shared/portable/capabilities";
import * as h from "../shared/functions/billingAutomation";
import { buildConvexCapabilities } from "./providers/capabilities";
const society = { societyId: v.id("societies") };
const run = { ...society, id: v.id("billingAutomationRuns") };
export const workspace = authorizedQuery("billingAutomation:workspace", query)({ args: { ...society, collection: v.optional(v.union(v.literal("schedules"), v.literal("runs"))), scheduleCursor: v.optional(v.union(v.string(), v.null())), runCursor: v.optional(v.union(v.string(), v.null())) }, returns: v.any(), handler: async (ctx, args) => h.workspacePortable(await toPortableQueryCtx(ctx), args) });
export const sourcePage = authorizedQuery("billingAutomation:sourcePage", query)({ args: { ...society, kind: v.union(v.literal("recurring_invoice"), v.literal("invoice_reminder"), v.literal("report"), v.literal("template")), cursor: v.optional(v.union(v.string(), v.null())), selectedId: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => h.sourcePagePortable(await toPortableQueryCtx(ctx), args) });
export const saveSettings = authorizedMutation("billingAutomation:saveSettings", mutation)({ args: { ...society, enabled: v.boolean(), fromEmail: v.string(), fromName: v.string(), replyTo: v.optional(v.string()), senderConfirmed: v.boolean() }, returns: v.id("billingAutomationSettings"), handler: async (ctx, args) => h.saveSettingsPortable(await toPortableMutationCtx(ctx), args) });
export const saveSchedule = authorizedMutation("billingAutomation:saveSchedule", mutation)({ args: { ...society, id: v.optional(v.id("billingAutomationSchedules")), name: v.string(), kind: v.union(v.literal("recurring_invoice"), v.literal("invoice_reminder"), v.literal("report")), sourceId: v.string(), templateId: v.optional(v.string()), recipients: v.array(v.string()), recipientsConfirmed: v.boolean(), timezone: v.string(), localTime: v.string(), cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")), startDate: v.string(), active: v.optional(v.boolean()) }, returns: v.id("billingAutomationSchedules"), handler: async (ctx, args) => h.saveSchedulePortable(await toPortableMutationCtx(ctx), args) });
export const setScheduleActive = authorizedMutation("billingAutomation:setScheduleActive", mutation)({ args: { ...society, id: v.id("billingAutomationSchedules"), active: v.boolean() }, returns: v.null(), handler: async (ctx, args) => h.setScheduleActivePortable(await toPortableMutationCtx(ctx), args) });
export const prepareDue = authorizedMutation("billingAutomation:prepareDue", mutation)({ args: society, returns: v.array(v.id("billingAutomationRuns")), handler: async (ctx, args) => h.prepareDuePortable(await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx)), args) });
export const claimRun = authorizedMutation("billingAutomation:claimRun", mutation)({ args: run, returns: v.any(), handler: async (ctx, args) => h.claimRunPortable(await toPortableMutationCtx(ctx), args) });
export const retryRun = authorizedMutation("billingAutomation:retryRun", mutation)({ args: run, returns: v.null(), handler: async (ctx, args) => h.retryRunPortable(await toPortableMutationCtx(ctx), args) });
export const getRun = authorizedQuery("billingAutomation:getRun", query)({ args: run, returns: v.any(), handler: async (ctx, args) => h.getRunPortable(await toPortableQueryCtx(ctx), args) });
export const deliverLocal = authorizedMutation("billingAutomation:deliverLocal", mutation)({ args: { ...run, pdfBase64: v.optional(v.string()), fileName: v.optional(v.string()), documentSnapshot: v.optional(v.any()) }, returns: v.any(), handler: async (ctx, args) => h.deliverLocalPortable(await toPortableMutationCtx(ctx), args) });

async function serviceContext(ctx: any, scheduleOrRun: any) {
  return { db: convexPortableDb(ctx.db), principal: { kind: "service" as const, runtime: "convex-hosted" as const, assurance: "trusted-internal" as const, subject: "billing-automation", societyId: String(scheduleOrRun.societyId), actorUserId: String(scheduleOrRun.createdByUserId), scopes: ["financials:read", "financials:write"] }, capabilities: makeCapabilities({}), runQuery: async () => { throw new Error("Use a bounded report source query."); }, runMutation: async () => { throw new Error("Nested mutations are not supported here."); } };
}
export const dueWork = internalQuery({ args: { cursor: v.optional(v.union(v.string(), v.null())), scanAtISO: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, { cursor, scanAtISO }) => {
  const at = new Date(scanAtISO ?? Date.now()).toISOString();
  const schedules = await ctx.db.query("billingAutomationSchedules").withIndex("by_active_due", (q) => q.eq("active", true).lte("nextRunAtISO", at)).paginate({ cursor: cursor ?? null, numItems: 10, maximumBytesRead: 4_000_000 });
  const retry = (await Promise.all(["queued", "retry", "blocked", "working"].map((status) => ctx.db.query("billingAutomationRuns").withIndex("by_status_retry", (q) => q.eq("status", status).lte("nextAttemptAtISO", at)).take(5)))).flat();
  const accepted = await ctx.db.query("billingAutomationRuns").withIndex("by_status_finalized_retry", (q) => q.eq("status", "accepted").eq("finalizedAtISO", undefined).lte("nextAttemptAtISO", at)).take(5);
  const actors = new Map([...schedules.page, ...retry, ...accepted].map((r) => [`${r.societyId}:${r.createdByUserId}`, { societyId: r.societyId, createdByUserId: r.createdByUserId }]));
  return { actors: [...actors.values()], isDone: schedules.isDone, continueCursor: schedules.continueCursor, scanAtISO: at };
} });
export const prepareInternal = internalMutation({ args: { ...society, actorUserId: v.string() }, returns: v.any(), handler: async (ctx, args) => h.prepareDuePortable(await serviceContext(ctx, { ...args, createdByUserId: args.actorUserId }), args) });
export const claimInternal = internalMutation({ args: run, returns: v.any(), handler: async (ctx, args) => { const row = await ctx.db.get(args.id); if (!row || row.societyId !== args.societyId) return null; return h.claimRunPortable(await serviceContext(ctx, row), args); } });
export const updateInternal = internalMutation({ args: { ...run, token: v.string(), event: v.string(), patch: v.any() }, returns: v.null(), handler: async (ctx, args) => { const row = await ctx.db.get(args.id); if (!row || row.societyId !== args.societyId) throw new Error("Delivery not found."); return h.workerUpdatePortable(await serviceContext(ctx, row), args); } });
export const outboxInternal = internalMutation({ args: { ...run, token: v.string(), index: v.number(), patch: v.any() }, returns: v.null(), handler: async (ctx, args) => { const row = await ctx.db.get(args.id); if (!row || row.societyId !== args.societyId || row.leaseToken !== args.token) throw new Error("Delivery lease expired."); const delivery = row.deliveries[args.index]; if (!delivery?.pendingEmailId) throw new Error("Delivery recipient not found."); await ctx.db.patch(delivery.pendingEmailId as any, args.patch); return null; } });
export const finalizeInternal = internalMutation({ args: run, returns: v.null(), handler: async (ctx, args) => { const row = await ctx.db.get(args.id); if (!row || row.societyId !== args.societyId) throw new Error("Delivery not found."); return h.finalizeRunPortable(await serviceContext(ctx, row), args); } });
export const workerContext = internalQuery({ args: run, returns: v.any(), handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id); if (!row || row.societyId !== args.societyId) throw new Error("Delivery not found.");
  const schedule = await ctx.db.get(row.scheduleId); const organization = await ctx.db.get(args.societyId);
  const template = schedule?.templateId ? await ctx.db.get(schedule.templateId as any) : null;
  if (template && template.societyId !== args.societyId) throw new Error("Template not found.");
  const logoUrl = organization?.logoStorageId ? await ctx.storage.getUrl(organization.logoStorageId as any) : null;
  return { organization: { name: organization?.name ?? "Organization", address: organization?.mailingAddress ?? organization?.registeredOfficeAddress, email: organization?.officialEmail, logoUrl }, config: template?.config };
} });
/** Source pages remain separately bounded, but execute as the schedule's current owner. */
export const reportSourceInternal = internalQuery({ args: { ...run, sourceTable: v.string(), cursor: v.union(v.string(), v.null()), pageSize: v.number(), snapshotAtISO: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id); if (!row || row.societyId !== args.societyId) throw new Error("Delivery not found.");
  const reports = await import("../shared/functions/commerceReports");
  return reports.sourcePagePortable(await serviceContext(ctx, row), args as any);
} });
