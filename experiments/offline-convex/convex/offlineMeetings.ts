import { internalMutationGeneric, mutationGeneric, queryGeneric, type DataModelFromSchemaDefinition, type MutationBuilder, type QueryBuilder } from "convex/server";
import { v } from "convex/values";
import type schema from "./schema";
import { toPortableMutationCtx, toPortableQueryCtx } from "../../../convex/lib/portable";
import { hostedPrincipal } from "../../../convex/lib/authIdentity";
import { assertNativeFileStorageEnabled } from "../../../convex/providers/env";
import { requirePermissionPortable } from "../../../shared/functions/permissions";
import { claimStorageId } from "../../../shared/functions/access";
import { listPortable as listMeetings } from "../../../shared/functions/meetings";
import { listForMeetingPortable } from "../../../shared/functions/meetingMaterials";
import type { PortableQueryCtx } from "../../../shared/portable/ctx";
import { runMeetingCommand } from "../domain";
import { validateCommand, type FileDescriptor, type Mapping, type MeetingCommand, type MeetingResult, type Snapshot } from "../src/meetingProtocol";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, "internal">;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const common = { version: v.number(), operationId: v.string(), meetingUuid: v.string(), baseRevision: v.number() };
const commandValidator = v.union(
  v.object({ ...common, kind: v.literal("create-meeting"), title: v.string(), scheduledAt: v.string(), notes: v.string(), agendaTitle: v.string(),
    keys: v.object({ meeting: v.string(), minutes: v.string(), agenda: v.string(), item: v.string(), document: v.string(), material: v.string() }),
    file: v.optional(v.object({ name: v.string(), mime: v.string(), size: v.number(), sha256: v.string() })) }),
  v.object({ ...common, kind: v.literal("edit-meeting"), title: v.string(), notes: v.string() }),
  v.object({ ...common, kind: v.literal("edit-minutes"), discussion: v.string() }),
);

async function visibleSnapshots(portable: PortableQueryCtx, societyId: string): Promise<Snapshot[]> {
  await requirePermissionPortable(portable, societyId, "meetings:read");
  await requirePermissionPortable(portable, societyId, "minutes:read");
  await requirePermissionPortable(portable, societyId, "agendas:read");
  const meetings = await listMeetings(portable, { societyId });
  const aggregates = await portable.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", societyId)).take(101);
  if (aggregates.length > 100) throw new Error("PILOT_DATASET_LIMIT: no partial snapshot is permitted.");
  const result: Snapshot[] = [];
  for (const aggregate of aggregates) {
    const mappings: Mapping[] = JSON.parse(aggregate.mappings);
    const meeting = meetings.find(row => row._id === mappings.find(row => row.table === "meetings")?.nativeId);
    if (!meeting) continue;
    const minutes = await portable.db.get(String(meeting.minutesId), "minutes");
    const agenda = await portable.db.query("agendas").withIndex("by_meeting", q => q.eq("meetingId", meeting._id)).unique();
    const items = agenda ? await portable.db.query("agendaItems").withIndex("by_agenda", q => q.eq("agendaId", agenda._id)).collect() : [];
    await requirePermissionPortable(portable, societyId, "documents:read");
    // Existing material availability, explicit grants AND document ACLs apply.
    const materials = await listForMeetingPortable(portable, { meetingId: meeting._id });
    const file: FileDescriptor | undefined = aggregate.file ? JSON.parse(aggregate.file) : undefined;
    const document = mappings.find(row => row.table === "documents");
    const files = file && document && materials.some(row => row.document?._id === document.nativeId) ?
      [{ uuid: document.uuid, name: file.name, sha256: file.sha256, size: file.size, available: Boolean(aggregate.fileStorageId) }] : [];
    result.push({ meetingUuid: aggregate.uuid, revision: aggregate.revision, title: meeting.title, scheduledAt: meeting.scheduledAt,
      ids: { minutes: mappings.find(row => row.table === "minutes")!.uuid, agenda: mappings.find(row => row.table === "agendas")!.uuid,
        items: items.map(item => mappings.find(row => row.nativeId === item._id)!.uuid) }, editable: !minutes?.approvedAt,
      notes: meeting.notes ?? "", discussion: minutes?.discussion ?? "", agenda: items.map(row => row.title), files });
  }
  return result;
}

/** Internal, bounded pilot materializer. Must run after EVERY ACL/identity change. */
async function rebuild(ctx: any, societyId: string) {
  const portable = await toPortableQueryCtx(ctx);
  const users = await ctx.db.query("users").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).take(51);
  if (users.length > 50) throw new Error("PILOT_MEMBERSHIP_LIMIT");
  const previous = await ctx.db.query("offlineMeetingDownloads").withIndex("by_society", (q: any) => q.eq("society_id", societyId)).collect();
  const desired = new Map<string, any>();
  for (const user of users) {
    if (!user.authIssuer || !user.authSubject) continue;
    const actorKey = `${user.authIssuer}|${user.authSubject}`;
    // Projection identity is derived solely from authoritative bindings, never client claims.
    const principal = hostedPrincipal({ issuer: user.authIssuer, subject: user.authSubject, tokenIdentifier: actorKey } as any);
    const scoped = { ...portable, principal };
    // Only membership/permission denial clears this actor's view. Other errors
    // must abort rebuilding, rather than silently publishing an incomplete view.
    try { await requirePermissionPortable(scoped, societyId, "meetings:read"); }
    catch (error) {
      if (/membership not found|membership is not active|User is disabled|External identity is disabled|Permission meetings:read required/.test(String(error))) continue;
      throw error;
    }
    for (const snapshot of await visibleSnapshots(scoped, societyId)) {
      const uuid = JSON.stringify([societyId, actorKey, snapshot.meetingUuid]);
      desired.set(uuid, { uuid, society_id: societyId, actor_key: actorKey, meeting_uuid: snapshot.meetingUuid, revision: snapshot.revision, payload: JSON.stringify(snapshot) });
    }
  }
  for (const row of previous) {
    const next = desired.get(row.uuid);
    if (!next) await ctx.db.delete(row._id);
    else { if (row.payload !== next.payload) await ctx.db.patch(row._id, next); desired.delete(row.uuid); }
  }
  for (const row of desired.values()) await ctx.db.insert("offlineMeetingDownloads", row);
}

export const rebuildDownloads = internalMutation({ args: { societyId: v.id("societies") }, handler: (ctx, args) => rebuild(ctx, args.societyId) });
export const applyCommand = mutation({
  args: { societyId: v.id("societies"), command: commandValidator },
  handler: async (ctx, { societyId, command }) => {
    validateCommand(command);
    const portable = await toPortableMutationCtx(ctx);
    const user = await requirePermissionPortable(portable, societyId, "meetings:write");
    await requirePermissionPortable(portable, societyId, "minutes:write");
    if (command.kind === "create-meeting") {
      await requirePermissionPortable(portable, societyId, "agendas:write");
      if (command.file) await requirePermissionPortable(portable, societyId, "documents:write");
    }
    const payload = JSON.stringify(command);
    const receipt = await ctx.db.query("offlineMeetingReceipts").withIndex("by_actor_operation", q => q.eq("societyId", societyId).eq("userId", user._id as any).eq("operationId", command.operationId)).unique();
    if (receipt) {
      if (receipt.payload !== payload) throw new Error("REPLAY_MISMATCH");
      return { ...JSON.parse(receipt.result), replay: true } as MeetingResult;
    }
    const aggregate = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", societyId).eq("uuid", command.meetingUuid)).unique();
    if (!aggregate && command.kind !== "create-meeting") throw new Error("PARENT_NOT_ACCEPTED");
    if ((aggregate?.revision ?? 0) !== command.baseRevision || (aggregate && command.kind === "create-meeting")) throw new Error("REVISION_CONFLICT");
    const mappings = await runMeetingCommand(portable, societyId, command as MeetingCommand, aggregate ? JSON.parse(aggregate.mappings) : []);
    const revision = command.baseRevision + 1;
    if (aggregate) await ctx.db.patch(aggregate._id, { revision, updatedByUserId: user._id as any });
    else await ctx.db.insert("offlineMeetingAggregates", { societyId, uuid: command.meetingUuid, revision, mappings: JSON.stringify(mappings),
      ...(command.kind === "create-meeting" && command.file ? { file: JSON.stringify(command.file) } : {}), updatedByUserId: user._id as any });
    const result: MeetingResult = { accepted: true, revision, mappings, replay: false };
    await ctx.db.insert("offlineMeetingReceipts", { societyId, userId: user._id as any, operationId: command.operationId, payload, result: JSON.stringify(result) });
    await rebuild(ctx, societyId);
    return result;
  },
});

export const authorizedSnapshot = query({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => visibleSnapshots(await toPortableQueryCtx(ctx), args.societyId) });
export const syncIdentity = query({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  const portable = await toPortableQueryCtx(ctx);
  await requirePermissionPortable(portable, args.societyId, "meetings:read");
  if (portable.principal.kind !== "user" || portable.principal.assurance !== "verified-jwt") throw new Error("Verified user identity required.");
  return { actorKey: `${portable.principal.issuer}|${portable.principal.subject}`, societyId: args.societyId };
} });
export const downloads = query({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  const portable = await toPortableQueryCtx(ctx);
  await requirePermissionPortable(portable, args.societyId, "meetings:read");
  if (portable.principal.kind !== "user") throw new Error("User identity required.");
  const actorKey = `${portable.principal.issuer}|${portable.principal.subject}`;
  return ctx.db.query("offlineMeetingDownloads").withIndex("by_actor", q => q.eq("actor_key", actorKey).eq("society_id", args.societyId)).collect();
} });

export const prepareFileUpload = mutation({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  assertNativeFileStorageEnabled();
  const portable = await toPortableMutationCtx(ctx);
  await requirePermissionPortable(portable, args.societyId, "meetings:write");
  await requirePermissionPortable(portable, args.societyId, "documents:write");
  return ctx.storage.generateUploadUrl();
} });

export const commitFile = mutation({ args: { societyId: v.id("societies"), meetingUuid: v.string(), storageId: v.id("_storage") }, handler: async (ctx, args) => {
  assertNativeFileStorageEnabled();
  const portable = await toPortableMutationCtx(ctx);
  await requirePermissionPortable(portable, args.societyId, "meetings:write");
  await requirePermissionPortable(portable, args.societyId, "documents:write");
  const aggregate = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", args.societyId).eq("uuid", args.meetingUuid)).unique();
  if (!aggregate?.file) throw new Error("PARENT_NOT_ACCEPTED");
  const file: FileDescriptor = JSON.parse(aggregate.file);
  const stored = await ctx.db.system.get(args.storageId);
  // Convex _storage reports SHA-256 in base64; our portable descriptor uses hex.
  const storedHash = stored ? Array.from(atob(stored.sha256), char => char.charCodeAt(0).toString(16).padStart(2, "0")).join("") : undefined;
  if (!stored || storedHash !== file.sha256 || stored.size !== file.size) throw new Error("FILE_HASH_MISMATCH");
  if (aggregate.fileStorageId) return { accepted: true, storageId: aggregate.fileStorageId }; // Immutable content hash already attached.
  await claimStorageId(portable, args.storageId, args.societyId);
  const mappings: Mapping[] = JSON.parse(aggregate.mappings);
  const document = mappings.find(row => row.table === "documents")!;
  const material = mappings.find(row => row.table === "meetingMaterials")!;
  await portable.db.patch(document.nativeId, { storageId: args.storageId, fileSizeBytes: file.size });
  await portable.db.patch(material.nativeId, { syncStatus: "synced" });
  await ctx.db.patch(aggregate._id, { fileStorageId: args.storageId });
  await rebuild(ctx, args.societyId);
  return { accepted: true, storageId: args.storageId };
} });

export const fileForDownload = query({ args: { societyId: v.id("societies"), meetingUuid: v.string() }, handler: async (ctx, args) => {
  const portable = await toPortableQueryCtx(ctx);
  const snapshots = await visibleSnapshots(portable, args.societyId);
  if (!snapshots.find(row => row.meetingUuid === args.meetingUuid)?.files.some(file => file.available)) throw new Error("FILE_NOT_AVAILABLE");
  const aggregate = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", args.societyId).eq("uuid", args.meetingUuid)).unique();
  return aggregate!.fileStorageId!;
} });
