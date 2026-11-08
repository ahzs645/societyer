import { v, type Infer } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authorizedAction, authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  assertSourceContextCurrent, commitLinkPortable, listPortable, resolveContextPortable,
  savePortable, setEnabledPortable, sourceContextPortable, unlinkPortable,
  type ResolveRequestContext, type SourceRequestContext,
} from "../shared/functions/documentSources";
import { createMicrosoftGraphDocumentSource } from "../shared/documentSources/microsoftGraph";
import { DocumentSourceError } from "../shared/documentSources/policy";
import { documentSourceConfigValidator, microsoftDocumentLocatorValidator } from "./tables/documentSources";

const sourceValidator = v.object({
  id: v.id("documentSources"), providerId: v.literal("microsoft-sharepoint"),
  label: v.string(), enabled: v.boolean(), config: documentSourceConfigValidator,
});
const sourceSummaryValidator = v.object({
  id: v.id("documentSources"), _id: v.id("documentSources"),
  providerId: v.literal("microsoft-sharepoint"), label: v.string(), enabled: v.boolean(),
  config: documentSourceConfigValidator, createdAtISO: v.string(), updatedAtISO: v.string(),
});
const referenceValidator = v.object({
  providerId: v.literal("microsoft-sharepoint"), sourceId: v.id("documentSources"),
  mode: v.literal("latest"), locator: microsoftDocumentLocatorValidator,
});
const contextFields = {
  source: sourceValidator,
  actor: v.object({ userId: v.id("users"), societyId: v.id("societies") }),
  revision: v.number(),
};
const contextValidator = v.object(contextFields);
const resolveContextValidator = v.object({
  ...contextFields, documentId: v.id("documents"),
  referenceId: v.id("externalDocumentReferences"), reference: referenceValidator,
});
const itemValidator = v.object({
  locator: microsoftDocumentLocatorValidator,
  kind: v.union(v.literal("file"), v.literal("folder")), name: v.string(),
  mimeType: v.optional(v.string()), sizeBytes: v.optional(v.number()),
  modifiedAtISO: v.optional(v.string()), webUrl: v.optional(v.string()), eTag: v.optional(v.string()),
});

/** Keep the credential out of the secondary authorization-query arguments. */
function resourceAuthorizationArgs(args: Record<string, unknown>) {
  const { accessToken, ...resources } = args;
  void accessToken;
  return resources;
}

function adapterFor(context: SourceRequestContext, accessToken: string) {
  if (!accessToken || accessToken.length > 16_384 || /\s/.test(accessToken)) {
    throw new DocumentSourceError("DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED");
  }
  return createMicrosoftGraphDocumentSource({
    getDelegatedToken: async (actor, source) => {
      if (actor.userId !== context.actor.userId || actor.societyId !== context.actor.societyId
          || source.id !== context.source.id) throw new DocumentSourceError("DOCUMENT_SOURCE_FORBIDDEN");
      return accessToken;
    },
  });
}

export const list = authorizedQuery("documentSources:list", query)({
  args: { societyId: v.id("societies") }, returns: v.array(sourceSummaryValidator),
  // Portable IDs are strings. Hosted reads below obtained them from the
  // corresponding Convex tables; validators retain the branded-ID boundary.
  handler: async (ctx, args) => await listPortable(await toPortableQueryCtx(ctx), args) as Array<Infer<typeof sourceSummaryValidator>>,
});

export const save = authorizedMutation("documentSources:save", mutation)({
  args: {
    societyId: v.id("societies"), sourceId: v.optional(v.id("documentSources")),
    label: v.string(), config: documentSourceConfigValidator,
  }, returns: v.id("documentSources"),
  handler: async (ctx, args) => await savePortable(await toPortableMutationCtx(ctx), args) as Id<"documentSources">,
});

export const setEnabled = authorizedMutation("documentSources:setEnabled", mutation)({
  args: { societyId: v.id("societies"), sourceId: v.id("documentSources"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => setEnabledPortable(await toPortableMutationCtx(ctx), args),
});

export const unlink = authorizedMutation("documentSources:unlink", mutation)({
  args: { documentId: v.id("documents") }, returns: v.null(),
  handler: async (ctx, args) => unlinkPortable(await toPortableMutationCtx(ctx), args),
});

export const browse = authorizedAction("documentSources:browse", action, resourceAuthorizationArgs)({
  args: {
    societyId: v.id("societies"), sourceId: v.id("documentSources"), accessToken: v.string(),
    parent: v.optional(v.object({ itemId: v.string() })), cursor: v.optional(v.string()),
  },
  returns: v.object({ items: v.array(itemValidator), nextCursor: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const request = { societyId: args.societyId, sourceId: args.sourceId, purpose: "browse" as const };
    const context: SourceRequestContext = await ctx.runQuery(internal.documentSources.sourceContext, request);
    const page = await adapterFor(context, args.accessToken).browse({
      source: context.source, actor: context.actor, parentItemId: args.parent?.itemId, cursor: args.cursor,
    });
    // Revoking Societyer access or the source during a remote request also
    // prevents the just-fetched source metadata from being delivered.
    assertSourceContextCurrent(context, await ctx.runQuery(internal.documentSources.sourceContext, request));
    return page;
  },
});

export const link = authorizedAction("documentSources:link", action, resourceAuthorizationArgs)({
  args: {
    societyId: v.id("societies"), sourceId: v.id("documentSources"), accessToken: v.string(),
    item: v.object({ itemId: v.string() }), title: v.optional(v.string()), category: v.optional(v.string()),
  },
  returns: v.object({ documentId: v.id("documents"), alreadyLinked: v.boolean() }),
  handler: async (ctx, args) => {
    const context: SourceRequestContext = await ctx.runQuery(internal.documentSources.sourceContext, {
      societyId: args.societyId, sourceId: args.sourceId, purpose: "link",
    });
    const { tenantId, siteId, driveId } = context.source.config;
    const item = await adapterFor(context, args.accessToken).resolve({
      source: context.source, actor: context.actor,
      locator: { tenantId, siteId, driveId, itemId: args.item.itemId },
    });
    if (item.kind !== "file") throw new Error("Choose a file to link, rather than a folder.");
    return ctx.runMutation(internal.documentSources.commitLink, {
      societyId: args.societyId, sourceId: args.sourceId,
      actorUserId: context.actor.userId, sourceRevision: context.revision,
      reference: { providerId: context.source.providerId, sourceId: context.source.id, locator: item.locator, mode: "latest" },
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.category !== undefined ? { category: args.category } : {}),
    });
  },
});

export const resolve = authorizedAction("documentSources:resolve", action, resourceAuthorizationArgs)({
  args: { documentId: v.id("documents"), accessToken: v.string() }, returns: itemValidator,
  handler: async (ctx, args) => {
    const context: ResolveRequestContext = await ctx.runQuery(internal.documentSources.resolveContext, { documentId: args.documentId });
    const item = await adapterFor(context, args.accessToken).resolve({
      source: context.source, actor: context.actor, locator: context.reference.locator,
    });
    if (item.kind !== "file") throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_REFERENCE");
    const current: ResolveRequestContext = await ctx.runQuery(internal.documentSources.resolveContext, { documentId: args.documentId });
    assertSourceContextCurrent(context, current);
    if (context.referenceId !== current.referenceId
        || context.reference.locator.itemId !== current.reference.locator.itemId) {
      throw new Error("The document reference changed. Open it again.");
    }
    return item;
  },
});

export const sourceContext = internalQuery({
  args: {
    societyId: v.id("societies"), sourceId: v.id("documentSources"),
    purpose: v.union(v.literal("browse"), v.literal("link"), v.literal("resolve")),
  }, returns: contextValidator,
  handler: async (ctx, args) => await sourceContextPortable(await toPortableQueryCtx(ctx), args) as Infer<typeof contextValidator>,
});

export const resolveContext = internalQuery({
  args: { documentId: v.id("documents") },
  returns: resolveContextValidator,
  handler: async (ctx, args) => await resolveContextPortable(await toPortableQueryCtx(ctx), args) as Infer<typeof resolveContextValidator>,
});

export const commitLink = internalMutation({
  args: {
    societyId: v.id("societies"), sourceId: v.id("documentSources"), actorUserId: v.id("users"),
    sourceRevision: v.number(), reference: referenceValidator,
    title: v.optional(v.string()), category: v.optional(v.string()),
  }, returns: v.object({ documentId: v.id("documents"), alreadyLinked: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await commitLinkPortable(await toPortableMutationCtx(ctx), args);
    return { ...result, documentId: result.documentId as Id<"documents"> };
  },
});
