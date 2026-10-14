import { v } from "convex/values";
import { internalMutation } from "./lib/untypedServer";
import { requirePermissionPortable } from "../shared/functions/permissions";
import { toPortableMutationCtx } from "./lib/portable";

/**
 * Usage log and rate limit for record-table AI filter suggestions
 * (aiFilterActions:suggestRecordFilter). Entries go to the AI audit trail with
 * provider, model, sizes and outcome — never the request text or any row data.
 */

const AGENT_KEY = "record_filter";
/** Suggestions one person may request per minute in a workspace. */
export const FILTER_SUGGESTIONS_PER_MINUTE = 12;

export const _beginFilterSuggestion = internalMutation({
  args: {
    societyId: v.id("societies"),
    objectNameSingular: v.string(),
    fieldCount: v.number(),
    queryLength: v.number(),
    provider: v.string(),
    modelId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actor = await requirePermissionPortable(await toPortableMutationCtx(ctx), args.societyId, "tasks:write");
    const now = Date.now();
    const since = new Date(now - 60_000).toISOString();
    const recent = await ctx.db
      .query("aiAgentAuditEvents")
      .withIndex("by_society_agent", (q: any) => q.eq("societyId", args.societyId).eq("agentKey", AGENT_KEY))
      .order("desc")
      .take(200);
    const mine = recent.filter((event: any) => event.actorUserId === actor._id && event.createdAtISO >= since);
    if (mine.length >= FILTER_SUGGESTIONS_PER_MINUTE) return { limited: true };
    const eventId = await ctx.db.insert("aiAgentAuditEvents", {
      societyId: args.societyId,
      agentKey: AGENT_KEY,
      eventType: "run_requested",
      summary: `Requested an AI filter suggestion for ${args.objectNameSingular}.`,
      metadata: {
        objectNameSingular: args.objectNameSingular,
        fieldCount: args.fieldCount,
        queryLength: args.queryLength,
        provider: args.provider,
        modelId: args.modelId,
        rowDataSent: false,
      },
      createdAtISO: new Date(now).toISOString(),
      actorUserId: actor._id,
    });
    return { limited: false, eventId };
  },
});

export const _finishFilterSuggestion = internalMutation({
  args: {
    societyId: v.id("societies"),
    eventId: v.id("aiAgentAuditEvents"),
    outcome: v.string(),
    conditionCount: v.optional(v.number()),
    droppedCount: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actor = await requirePermissionPortable(await toPortableMutationCtx(ctx), args.societyId, "tasks:write");
    const event = await ctx.db.get(args.eventId);
    if (!event || event.societyId !== args.societyId || event.agentKey !== AGENT_KEY || event.actorUserId !== actor._id) {
      throw new Error("Record not found.");
    }
    await ctx.db.patch(args.eventId, {
      eventType: args.outcome === "ok" ? "run_completed" : "run_failed",
      metadata: {
        ...(event.metadata ?? {}),
        outcome: args.outcome,
        conditionCount: args.conditionCount,
        droppedCount: args.droppedCount,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
      },
    });
    return null;
  },
});
