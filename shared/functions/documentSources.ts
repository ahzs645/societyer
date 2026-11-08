/**
 * Optional source configuration and reference records, shared by hosted and
 * local stores. Only the hosted actions call Microsoft. The context/commit
 * helpers below are internal on Convex and are never in the portable registry.
 */
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import type {
  DocumentSourceActor,
  ExternalDocumentReference,
  MicrosoftDocumentSource,
  MicrosoftDocumentSourceConfig,
} from "../documentSources/types";
import {
  assertReferenceMatchesSource,
  validateExternalDocumentReference,
  validateMicrosoftDocumentSource,
  validateMicrosoftDocumentSourceConfig,
} from "../documentSources/policy";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { createPortable, requireDocumentAccess } from "./documents";

const MAX_SOURCES = 50;
const PROVIDER_ID = "microsoft-sharepoint" as const;
const CONFIG_KEYS = ["tenantId", "clientId", "siteId", "driveId", "siteUrl"] as const;

type SourceRow = PortableDoc & {
  societyId: string;
  providerId: typeof PROVIDER_ID;
  label: string;
  enabled: boolean;
  config: MicrosoftDocumentSourceConfig;
  revision: number;
  createdAtISO: string;
  updatedAtISO: string;
};

export type SourceRequestContext = {
  source: MicrosoftDocumentSource;
  actor: DocumentSourceActor;
  revision: number;
};

export type ResolveRequestContext = SourceRequestContext & {
  documentId: string;
  referenceId: string;
  reference: ExternalDocumentReference;
};

/** A default-off module requires the explicit persisted opt-in. */
export function externalDocumentsEnabled(society: Record<string, unknown>) {
  return Array.isArray(society.disabledModules)
    && society.disabledModules.includes("+externalDocuments")
    && !society.disabledModules.includes("externalDocuments");
}

function sourceFromRow(row: SourceRow): MicrosoftDocumentSource {
  return validateMicrosoftDocumentSource({
    id: row._id, providerId: row.providerId, label: row.label,
    enabled: row.enabled, config: row.config,
  });
}

function sourceSummary(row: SourceRow) {
  return {
    ...sourceFromRow(row), _id: row._id,
    createdAtISO: row.createdAtISO, updatedAtISO: row.updatedAtISO,
  };
}

function requirePerson(ctx: PortableQueryCtx) {
  if (ctx.principal.kind !== "user" || ctx.principal.gatewayService) {
    throw new Error("Sign in to Societyer as a person to use an external document source.");
  }
}

async function requireSourceAdministrator(ctx: PortableQueryCtx, societyId: string) {
  requirePerson(ctx);
  const actor = await requirePermissionPortable(ctx, societyId, "settings:write");
  if (actor.role !== "Owner" && actor.role !== "Admin") {
    throw new Error("Only an Owner or Admin can configure document sources.");
  }
  return actor;
}

function sourceLabel(value: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new Error("Enter a source label of at most 120 characters.");
  }
  return value.trim();
}

function sameConfig(left: MicrosoftDocumentSourceConfig, right: MicrosoftDocumentSourceConfig) {
  return CONFIG_KEYS.every(key => left[key] === right[key]);
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requirePermissionPortable(ctx, societyId, "documents:read");
  const rows = await ctx.db.query<SourceRow>("documentSources")
    .withIndex("by_society", q => q.eq("societyId", societyId)).take(MAX_SOURCES + 1);
  if (rows.length > MAX_SOURCES) throw new Error("This workspace exceeds the document source limit.");
  return rows.map(sourceSummary).sort((left, right) => left.label.localeCompare(right.label));
}

export async function savePortable(ctx: PortableMutationCtx, args: {
  societyId: string; sourceId?: string; label: string; config: MicrosoftDocumentSourceConfig;
}) {
  await requireSourceAdministrator(ctx, args.societyId);
  const config = validateMicrosoftDocumentSourceConfig(args.config);
  const label = validateMicrosoftDocumentSource({
    id: args.sourceId ?? "new-source", providerId: PROVIDER_ID,
    label: sourceLabel(args.label), enabled: false, config,
  }).label;
  const now = new Date().toISOString();
  if (args.sourceId) {
    const row = await getOwned<SourceRow>(ctx, "documentSources", args.sourceId, args.societyId);
    // Retargeting an approved source would retarget every existing reference.
    // A different tenant, app, site or library must be a new source instead.
    if (!sameConfig(row.config, config)) {
      throw new Error("A source's Microsoft connection cannot be changed. Add a new source for a different tenant, app, site, or library.");
    }
    if (row.label !== label) {
      await ctx.db.patch(row._id, { label, revision: row.revision + 1, updatedAtISO: now });
    }
    return row._id;
  }
  const existing = await ctx.db.query<SourceRow>("documentSources")
    .withIndex("by_society", q => q.eq("societyId", args.societyId)).take(MAX_SOURCES + 1);
  if (existing.length >= MAX_SOURCES) throw new Error(`A workspace can have at most ${MAX_SOURCES} document sources.`);
  return ctx.db.insert("documentSources", {
    societyId: args.societyId, providerId: PROVIDER_ID, label,
    enabled: false, config, revision: 1, createdAtISO: now, updatedAtISO: now,
  });
}

export async function setEnabledPortable(ctx: PortableMutationCtx, args: {
  societyId: string; sourceId: string; enabled: boolean;
}) {
  await requireSourceAdministrator(ctx, args.societyId);
  const row = await getOwned<SourceRow>(ctx, "documentSources", args.sourceId, args.societyId);
  if (typeof args.enabled !== "boolean") throw new Error("Choose whether this document source is enabled.");
  if (row.enabled !== args.enabled) {
    await ctx.db.patch(row._id, {
      enabled: args.enabled, revision: row.revision + 1, updatedAtISO: new Date().toISOString(),
    });
  }
  return null;
}

/** Internal authorization snapshot; never accepts an actor asserted by a client. */
export async function sourceContextPortable(ctx: PortableQueryCtx, args: {
  societyId: string; sourceId: string; purpose: "browse" | "link" | "resolve";
}): Promise<SourceRequestContext> {
  requirePerson(ctx);
  const actor = await requirePermissionPortable(ctx, args.societyId,
    args.purpose === "link" ? "documents:write" : "documents:read");
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society || !externalDocumentsEnabled(society)) {
    throw new Error("External document sources are turned off for this workspace. Enable them in Settings first.");
  }
  const row = await getOwned<SourceRow>(ctx, "documentSources", args.sourceId, args.societyId);
  const source = sourceFromRow(row);
  if (!source.enabled) throw new Error("This document source is disabled.");
  return { source, actor: { userId: actor._id, societyId: args.societyId }, revision: row.revision };
}

export async function resolveContextPortable(ctx: PortableQueryCtx, { documentId }: { documentId: string }): Promise<ResolveRequestContext> {
  const document = await requireDocumentAccess(ctx, documentId);
  const marker = document.externalReference;
  if (!marker || marker.providerId !== PROVIDER_ID || marker.mode !== "latest") {
    throw new Error("This document does not have an external source reference.");
  }
  const context = await sourceContextPortable(ctx, {
    societyId: String(document.societyId), sourceId: marker.sourceId, purpose: "resolve",
  });
  const row = await getOwned(ctx, "externalDocumentReferences", marker.referenceId, context.actor.societyId);
  if (row.documentId !== documentId || row.sourceId !== marker.sourceId) throw new Error("External document reference not found.");
  const reference = validateExternalDocumentReference({
    providerId: row.providerId, sourceId: row.sourceId, mode: row.mode, locator: row.locator,
  });
  assertReferenceMatchesSource(reference, context.source);
  return { ...context, documentId, referenceId: row._id, reference };
}

/** Fail closed if authority changed while Microsoft was being contacted. */
export function assertSourceContextCurrent(before: SourceRequestContext, after: SourceRequestContext) {
  if (before.actor.userId !== after.actor.userId || before.actor.societyId !== after.actor.societyId
      || before.source.id !== after.source.id || before.revision !== after.revision
      || !sameConfig(before.source.config, after.source.config)) {
    throw new Error("The document source or your access changed. Try again.");
  }
}

/**
 * Called only by the hosted internal mutation after delegated Graph verification.
 * No public mutation or local registry entry can manufacture a verified link.
 */
export async function commitLinkPortable(ctx: PortableMutationCtx, args: {
  societyId: string; sourceId: string; actorUserId: string; sourceRevision: number;
  reference: ExternalDocumentReference; title?: string; category?: string;
}) {
  const context = await sourceContextPortable(ctx, { ...args, purpose: "link" });
  if (context.actor.userId !== args.actorUserId || context.revision !== args.sourceRevision) {
    throw new Error("The document source or your access changed. Try linking the document again.");
  }
  const reference = validateExternalDocumentReference(args.reference);
  assertReferenceMatchesSource(reference, context.source);
  const title = args.title?.trim() || "Linked document";
  const category = args.category?.trim() || "Other";
  if (title.length > 240 || category.length > 120) throw new Error("The document title or category is too long.");
  const existing = await ctx.db.query("externalDocumentReferences")
    .withIndex("by_source_and_item", q => q.eq("sourceId", args.sourceId).eq("locator.itemId", reference.locator.itemId)).unique();
  if (existing) {
    if (existing.societyId !== args.societyId) throw new Error("External document reference not found.");
    const document = await ctx.db.get(String(existing.documentId), "documents");
    if (document) {
      await requireDocumentAccess(ctx, document._id, "manage");
      if (document.externalReference?.referenceId !== existing._id) throw new Error("External document reference not found.");
      return { documentId: document._id, alreadyLinked: true };
    }
    // A prior local record deletion may have left an orphan; no remote file is touched.
    await ctx.db.delete(existing._id);
  }
  const documentId = await createPortable(ctx, {
    societyId: args.societyId, title, category, tags: [],
  });
  const referenceId = await ctx.db.insert("externalDocumentReferences", {
    ...reference, societyId: args.societyId, documentId, createdAtISO: new Date().toISOString(),
  });
  await ctx.db.patch(documentId, {
    externalReference: { sourceId: args.sourceId, providerId: PROVIDER_ID, referenceId, mode: "latest" },
  });
  return { documentId, alreadyLinked: false };
}

/** Removing an app reference is possible even after its source is disabled. */
export async function unlinkPortable(ctx: PortableMutationCtx, { documentId }: { documentId: string }) {
  const document = await requireDocumentAccess(ctx, documentId, "manage");
  await requirePermissionPortable(ctx, String(document.societyId), "documents:write");
  if (!document.externalReference) throw new Error("This document does not have an external source reference.");
  const reference = await ctx.db.get(document.externalReference.referenceId, "externalDocumentReferences");
  if (reference && (reference.societyId !== document.societyId || reference.documentId !== documentId
      || reference.sourceId !== document.externalReference.sourceId)) {
    throw new Error("External document reference not found.");
  }
  if (reference) await ctx.db.delete(reference._id);
  // Keep the user's record, history and meeting associations. Deleting the
  // record remains the separate, existing documents:remove operation.
  await ctx.db.patch(documentId, { externalReference: undefined });
  return null;
}
