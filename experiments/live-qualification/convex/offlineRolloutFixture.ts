/** Internal-only disposable HTTPS qualification helpers; never shipped to production. */
import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { rebuildMeetingDownloads } from "../../../convex/offlineMeetings";

export const migrateIssuer = internalMutationGeneric({
  args: { userIds: v.array(v.id("users")), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    if (process.env.OFFLINE_LOCAL_QUALIFICATION !== "1") throw new Error("Disposable qualification is disabled.");
    const permitted = ["http://127.0.0.1:43477", "https://societyer-qualification.test:43479"];
    if (!permitted.includes(args.from) || !permitted.includes(args.to) || args.from === args.to || args.userIds.length > 20) throw new Error("Only the fixed disposable issuers are permitted.");
    const users = await Promise.all(args.userIds.map(id => ctx.db.get(id)));
    if (users.some(user => !user || user.authIssuer !== args.from)) throw new Error("Qualification binding changed; issuer migration refused.");
    const societies = new Set<string>();
    for (const user of users) { await ctx.db.patch(user!._id, { authIssuer: args.to }); societies.add(user!.societyId); }
    for (const society of societies) await rebuildMeetingDownloads(ctx, society);
    return { changed: users.length };
  },
});

export const cleanPreparedMeetings = internalMutationGeneric({
  args: { societyId: v.id("societies"), prefix: v.string() },
  handler: async (ctx, args) => {
    if (process.env.OFFLINE_LOCAL_QUALIFICATION !== "1" || !/^Rollout qualification [a-f0-9-]{36}$/.test(args.prefix)) throw new Error("Invalid disposable cleanup scope.");
    const aggregates = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", args.societyId)).collect();
    let removed = 0;
    for (const aggregate of aggregates) {
      const mappings = JSON.parse(aggregate.mappings);
      const meetingMapping = mappings.find((mapping: { table: string }) => mapping.table === "meetings");
      if (!meetingMapping) continue;
      const meeting = await ctx.db.get(meetingMapping.nativeId);
      if (!meeting || !String((meeting as any).title).startsWith(args.prefix)) continue;
      for (const mapping of mappings) {
        const row = await ctx.db.get(mapping.nativeId);
        if (row && mapping.table === "documents" && (row as any).storageId) {
          const storageId = (row as any).storageId;
          await ctx.storage.delete(storageId);
          for (const ownership of await ctx.db.query("storageOwnership").withIndex("by_storage", q => q.eq("storageId", storageId)).collect()) await ctx.db.delete(ownership._id);
        }
        if (row) await ctx.db.delete(mapping.nativeId);
      }
      for (const receipt of await ctx.db.query("offlineMeetingReceipts").withIndex("by_actor_operation", q => q.eq("societyId", args.societyId)).collect()) {
        const command = JSON.parse(receipt.payload);
        if (command.meetingUuid === aggregate.uuid) await ctx.db.delete(receipt._id);
      }
      await ctx.db.delete(aggregate._id); removed++;
    }
    await rebuildMeetingDownloads(ctx, args.societyId);
    return { removed };
  },
});
