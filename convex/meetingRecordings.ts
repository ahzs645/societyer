/**
 * Meeting recordings kept in workspace file storage, and the workspace's
 * choice to keep recordings. Handlers: shared/functions/meetingRecordings.ts.
 * Where recordings go: shared/meetingRecordingStorage.ts.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { buildConvexCapabilities } from "./providers/capabilities";
import { assertWorkspaceNativeUploads, providers, workspaceStorage } from "./providers/env";
import {
  attachPortable,
  generateUploadUrlPortable,
  listPortable,
  removePortable,
  setPreferencePortable,
  settingsPortable,
} from "../shared/functions/meetingRecordings";

/** OpenAI's transcription endpoint takes files up to 25 MB; a self-hosted Whisper endpoint takes more. */
const OPENAI_TRANSCRIPTION_MAX_BYTES = 25_000_000;
const SELF_HOSTED_TRANSCRIPTION_MAX_BYTES = 200_000_000;

export const settings = authorizedQuery("meetingRecordings:settings", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const base = await settingsPortable(await toPortableQueryCtx(ctx), args);
    // An ambiguous storage policy refuses every upload; show it as "no file storage".
    const policy = await workspaceStorage(ctx.db, args.societyId).catch(() => ({ nativeUploads: false, documentVersionProvider: "native" as const }));
    const live = providers.transcription().live;
    return {
      ...base,
      policy,
      // transcripts:runPipeline transcribes a workspace recording; never offered with the demo provider.
      serverTranscription: live ? { maxBytes: process.env.WHISPER_ENDPOINT ? SELF_HOSTED_TRANSCRIPTION_MAX_BYTES : OPENAI_TRANSCRIPTION_MAX_BYTES } : null,
    };
  },
});

export const setPreference = authorizedMutation("meetingRecordings:setPreference", mutation)({
  args: { societyId: v.id("societies"), preference: v.union(v.literal("keep"), v.literal("transcripts_only")) },
  returns: v.any(),
  handler: async (ctx, args) => setPreferencePortable(await toPortableMutationCtx(ctx), args),
});

export const list = authorizedQuery("meetingRecordings:list", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  // A query's storage can only read URLs, which is all listing needs.
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx as any)), args),
});

export const generateUploadUrl = authorizedMutation("meetingRecordings:generateUploadUrl", mutation)({
  args: { meetingId: v.id("meetings"), fileName: v.string(), size: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    await assertWorkspaceNativeUploads(ctx.db, meeting?.societyId);
    return generateUploadUrlPortable(await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx)), args);
  },
});

export const attach = authorizedMutation("meetingRecordings:attach", mutation)({
  // The desktop app's portable handler takes provider "local-filesystem" with
  // its file key; here only an uploaded `_storage` blob is accepted.
  args: {
    meetingId: v.id("meetings"),
    fileName: v.string(),
    storageId: v.optional(v.id("_storage")),
    size: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    provider: v.optional(v.union(v.literal("convex"), v.literal("local-filesystem"))),
    storageKey: v.optional(v.string()),
    sha256: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { meetingId, fileName, storageId }) => {
    if (!storageId) throw new Error("Upload the recording first.");
    const meeting = await ctx.db.get(meetingId);
    await assertWorkspaceNativeUploads(ctx.db, meeting?.societyId);
    // Size and type come from the stored blob, never from the client.
    const metadata = await ctx.db.system.get(storageId);
    if (!metadata) throw new Error("Uploaded recording not found.");
    return attachPortable(await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx)), {
      meetingId,
      fileName,
      size: metadata.size,
      mimeType: metadata.contentType ?? undefined,
      provider: "convex",
      storageKey: storageId,
      sha256: undefined,
    });
  },
});

export const remove = authorizedMutation("meetingRecordings:remove", mutation)({
  args: { id: v.id("meetingRecordings") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx, buildConvexCapabilities(ctx)), args),
});
