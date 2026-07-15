import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  getManyPortable,
  createPortable,
  markOpenedPortable,
  updateReviewStatusPortable,
  reviewQueuesPortable,
  createPipaPolicyDraftPortable,
  rebuildPipaPolicyDraftFromSocietyPortable,
  createMemberDataGapMemoDraftPortable,
  updateDraftContentPortable,
  linkPrivacyPolicyEvidencePortable,
  createGovernanceDocumentFromLocalFilePortable,
  createLocalDocumentFromConnectorPortable,
  mergeConnectorDocumentMetadataPortable,
  flagForDeletionPortable,
  archivePortable,
  removePortable,
} from "../shared/functions/documents";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("documents"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const getMany = query({
  args: { ids: v.array(v.id("documents")), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => getManyPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    agendaItemId: v.optional(v.id("agendaItems")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    retentionYears: v.optional(v.number()),
    reviewStatus: v.optional(v.string()),
    librarySection: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const markOpened = mutation({
  args: {
    id: v.id("documents"),
    userId: v.optional(v.id("users")),
    actorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => markOpenedPortable(await toPortableMutationCtx(ctx), args),
});

export const updateReviewStatus = mutation({
  args: {
    id: v.id("documents"),
    reviewStatus: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateReviewStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const reviewQueues = query({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => reviewQueuesPortable(await toPortableQueryCtx(ctx), args),
});

export const createPipaPolicyDraft = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => createPipaPolicyDraftPortable(await toPortableMutationCtx(ctx), args),
});

export const rebuildPipaPolicyDraftFromSociety = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => rebuildPipaPolicyDraftFromSocietyPortable(await toPortableMutationCtx(ctx), args),
});

export const createMemberDataGapMemoDraft = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => createMemberDataGapMemoDraftPortable(await toPortableMutationCtx(ctx), args),
});

export const updateDraftContent = mutation({
  args: {
    id: v.id("documents"),
    title: v.string(),
    content: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateDraftContentPortable(await toPortableMutationCtx(ctx), args),
});

export const linkPrivacyPolicyEvidence = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
  },
  returns: v.any(),
  handler: async (ctx, args) => linkPrivacyPolicyEvidencePortable(await toPortableMutationCtx(ctx), args),
});

export const createGovernanceDocumentFromLocalFile = mutation({
  args: {
    societyId: v.id("societies"),
    documentKind: v.union(
      v.literal("constitution"),
      v.literal("bylaws"),
      v.literal("constitutionAndBylaws"),
      v.literal("privacyPolicy"),
    ),
    title: v.string(),
    category: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    replaceExisting: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createGovernanceDocumentFromLocalFilePortable(await toPortableMutationCtx(ctx), args),
});

export const createLocalDocumentFromConnector = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    category: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    storageKey: v.string(),
    sha256: v.optional(v.string()),
    tags: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    skipDuplicateCheck: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createLocalDocumentFromConnectorPortable(await toPortableMutationCtx(ctx), args),
});

export const mergeConnectorDocumentMetadata = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourcePayloadJson: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => mergeConnectorDocumentMetadataPortable(await toPortableMutationCtx(ctx), args),
});

export const flagForDeletion = mutation({
  args: { id: v.id("documents"), flagged: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => flagForDeletionPortable(await toPortableMutationCtx(ctx), args),
});

export const archive = mutation({
  args: { id: v.id("documents"), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => archivePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
