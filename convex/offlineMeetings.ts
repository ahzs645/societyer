import { internalMutationGeneric, mutationGeneric, queryGeneric, type DataModelFromSchemaDefinition, type MutationBuilder, type QueryBuilder } from "convex/server";
import { ConvexError, v } from "convex/values";
import type schema from "./schema";
import { assertOfflineMeetingPreparationEnabled, offlineMeetingPreparationEnabled } from "./lib/offlineMeetingFeature";
import { visibleSnapshots, rebuildMeetingDownloads, blockMeetingDownloads, assertMeetingScopeAvailable } from "./lib/offlineMeetingProjection";
import { authorizedQuery, authorizedMutation } from "./lib/authorizedServer";
export { rebuildMeetingDownloads } from "./lib/offlineMeetingProjection";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { assertNativeFileStorageEnabled } from "./providers/env";
import { requirePermissionPortable } from "../shared/functions/permissions";
import { claimStorageId, getOwned } from "../shared/functions/access";
import { requireDocumentAccess } from "../shared/functions/documents";
import { documentAccessContextForActor } from "./lib/access/documentAccess";
import { canAccessMeetingMaterial } from "./lib/access/materialAccess";
import { runMeetingCommand } from "../shared/offline/meetingDomain";
import { validateCommand, type FileDescriptor, type Mapping, type MeetingCommand, type MeetingResult } from "../shared/offline/meetingProtocol";

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

export const rebuildDownloads = internalMutation({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  try { await rebuildMeetingDownloads(ctx, args.societyId); return { refreshed: true }; }
  catch { await blockMeetingDownloads(ctx, args.societyId); return { refreshed: false }; }
} });
export const applyCommand = authorizedMutation("offlineMeetings:applyCommand", mutation)({
  args: { societyId: v.id("societies"), command: commandValidator },
  handler: async (ctx, { societyId, command }) => {
    assertOfflineMeetingPreparationEnabled();
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
    await rebuildMeetingDownloads(ctx, societyId);
    return result;
  },
});

export const authorizedSnapshot = authorizedQuery("offlineMeetings:authorizedSnapshot", query)({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => visibleSnapshots(await toPortableQueryCtx(ctx), args.societyId) });
export const syncIdentity = authorizedQuery("offlineMeetings:syncIdentity", query)({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  assertOfflineMeetingPreparationEnabled();
  const portable = await toPortableQueryCtx(ctx);
  try {
    for (const permission of ["meetings:read", "minutes:read", "agendas:read", "documents:read"] as const) await requirePermissionPortable(portable, args.societyId, permission);
    if (portable.principal.kind !== "user" || portable.principal.assurance !== "verified-jwt") throw new Error("Verified user identity required.");
    await assertMeetingScopeAvailable(portable, args.societyId);
  } catch (error) {
    if (/membership not found|membership is not active|User is disabled|External identity is disabled|Permission (meetings|minutes|agendas|documents):read required|Verified user identity required|Authentication required/.test(String(error))) {
      throw new ConvexError({ code: "OFFLINE_ACCESS_DENIED", message: "Meeting preparation access denied." });
    }
    throw error;
  }
  return { actorKey: `${portable.principal.issuer}|${portable.principal.subject}`, societyId: args.societyId };
} });
export const downloads = authorizedQuery("offlineMeetings:downloads", query)({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  assertOfflineMeetingPreparationEnabled();
  const portable = await toPortableQueryCtx(ctx);
  for (const permission of ["meetings:read", "minutes:read", "agendas:read", "documents:read"] as const) await requirePermissionPortable(portable, args.societyId, permission);
  if (portable.principal.kind !== "user") throw new Error("User identity required.");
  await assertMeetingScopeAvailable(portable, args.societyId);
  const actorKey = `${portable.principal.issuer}|${portable.principal.subject}`;
  return ctx.db.query("offlineMeetingDownloads").withIndex("by_actor", q => q.eq("actor_key", actorKey).eq("society_id", args.societyId)).collect();
} });

export const prepareFileUpload = authorizedMutation("offlineMeetings:prepareFileUpload", mutation)({ args: { societyId: v.id("societies") }, handler: async (ctx, args) => {
  assertOfflineMeetingPreparationEnabled();
  assertNativeFileStorageEnabled();
  const portable = await toPortableMutationCtx(ctx);
  await requirePermissionPortable(portable, args.societyId, "meetings:write");
  await requirePermissionPortable(portable, args.societyId, "documents:write");
  return ctx.storage.generateUploadUrl();
} });

export const commitFile = authorizedMutation("offlineMeetings:commitFile", mutation)({ args: { societyId: v.id("societies"), meetingUuid: v.string(), storageId: v.id("_storage") }, handler: async (ctx, args) => {
  assertOfflineMeetingPreparationEnabled();
  assertNativeFileStorageEnabled();
  const portable = await toPortableMutationCtx(ctx);
  await requirePermissionPortable(portable, args.societyId, "meetings:write");
  await requirePermissionPortable(portable, args.societyId, "documents:write");
  const aggregate = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", args.societyId).eq("uuid", args.meetingUuid)).unique();
  if (!aggregate?.file) throw new Error("PARENT_NOT_ACCEPTED");
  const file: FileDescriptor = JSON.parse(aggregate.file);
  const mappings: Mapping[] = JSON.parse(aggregate.mappings);
  const document = mappings.find(row => row.table === "documents");
  const materialMapping = mappings.find(row => row.table === "meetingMaterials");
  const meeting = mappings.find(row => row.table === "meetings");
  if (!document || !materialMapping || !meeting) throw new Error("FILE_WRITE_DENIED");
  const material = await getOwned(portable, "meetingMaterials", materialMapping.nativeId, args.societyId);
  if (material.documentId !== document.nativeId || material.meetingId !== meeting.nativeId) throw new Error("FILE_WRITE_DENIED");
  await requireDocumentAccess(portable, document.nativeId, "manage");
  const accessContext = await documentAccessContextForActor(ctx, args.societyId);
  if (!accessContext || !canAccessMeetingMaterial(material, accessContext, "manage")) throw new Error("FILE_WRITE_DENIED");
  const stored = await ctx.db.system.get(args.storageId);
  // Convex _storage reports SHA-256 in base64; our portable descriptor uses hex.
  const storedHash = stored ? Array.from(atob(stored.sha256), char => char.charCodeAt(0).toString(16).padStart(2, "0")).join("") : undefined;
  if (!stored || storedHash !== file.sha256 || stored.size !== file.size) throw new Error("FILE_HASH_MISMATCH");
  if (aggregate.fileStorageId) return { accepted: true, storageId: aggregate.fileStorageId }; // Immutable content hash already attached.
  await claimStorageId(portable, args.storageId, args.societyId);
  await portable.db.patch(document.nativeId, { storageId: args.storageId, fileSizeBytes: file.size });
  await portable.db.patch(materialMapping.nativeId, { syncStatus: "synced" });
  await ctx.db.patch(aggregate._id, { fileStorageId: args.storageId });
  await rebuildMeetingDownloads(ctx, args.societyId);
  return { accepted: true, storageId: args.storageId };
} });

export const fileForDownload = authorizedQuery("offlineMeetings:fileForDownload", query)({ args: { societyId: v.id("societies"), meetingUuid: v.string() }, handler: async (ctx, args) => {
  assertOfflineMeetingPreparationEnabled();
  const portable = await toPortableQueryCtx(ctx);
  const snapshots = await visibleSnapshots(portable, args.societyId);
  if (!snapshots.find(row => row.meetingUuid === args.meetingUuid)?.files.some(file => file.available)) throw new Error("FILE_NOT_AVAILABLE");
  const aggregate = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", args.societyId).eq("uuid", args.meetingUuid)).unique();
  return aggregate!.fileStorageId!;
} });

/** Repair due scopes in bounded batches; a scheduled failure never grants data. */
export const repairDownloads = internalMutation({ args: {}, handler: async ctx => {
  if (!offlineMeetingPreparationEnabled()) return { refreshed: 0 };
  const due = await ctx.db.query("offlineMeetingScopes").withIndex("by_refresh", q => q.lte("nextRefreshAt", Date.now())).take(20);
  for (const scope of due) {
    try { await rebuildMeetingDownloads(ctx, scope.societyId); }
    catch { await blockMeetingDownloads(ctx, scope.societyId); }
  }
  return { refreshed: due.length };
} });
