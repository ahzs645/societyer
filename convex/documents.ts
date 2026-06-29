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
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("documents"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const getMany = query({
  args: { ids: v.array(v.id("documents")), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => getManyPortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const markOpened = mutation({
  args: {
    id: v.id("documents"),
    userId: v.optional(v.id("users")),
    actorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => markOpenedPortable(toPortableMutationCtx(ctx), args),
});

export const updateReviewStatus = mutation({
  args: {
    id: v.id("documents"),
    reviewStatus: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => updateReviewStatusPortable(toPortableMutationCtx(ctx), args),
});

export const reviewQueues = query({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => reviewQueuesPortable(toPortableQueryCtx(ctx), args),
});

export const createPipaPolicyDraft = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => createPipaPolicyDraftPortable(toPortableMutationCtx(ctx), args),
});

export const rebuildPipaPolicyDraftFromSociety = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => rebuildPipaPolicyDraftFromSocietyPortable(toPortableMutationCtx(ctx), args),
});

export const createMemberDataGapMemoDraft = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => createMemberDataGapMemoDraftPortable(toPortableMutationCtx(ctx), args),
});

export const updateDraftContent = mutation({
  args: {
    id: v.id("documents"),
    title: v.string(),
    content: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: (ctx, args) => updateDraftContentPortable(toPortableMutationCtx(ctx), args),
});

export const linkPrivacyPolicyEvidence = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
  },
  returns: v.any(),
  handler: (ctx, args) => linkPrivacyPolicyEvidencePortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => createGovernanceDocumentFromLocalFilePortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => createLocalDocumentFromConnectorPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => mergeConnectorDocumentMetadataPortable(toPortableMutationCtx(ctx), args),
});

export const flagForDeletion = mutation({
  args: { id: v.id("documents"), flagged: v.boolean() },
  returns: v.any(),
  handler: (ctx, args) => flagForDeletionPortable(toPortableMutationCtx(ctx), args),
});

export const archive = mutation({
  args: { id: v.id("documents"), reason: v.string() },
  returns: v.any(),
  handler: (ctx, args) => archivePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
