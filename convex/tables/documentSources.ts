import { defineTable } from "convex/server";
import { v } from "convex/values";

export const documentSourceConfigValidator = v.object({
  tenantId: v.string(),
  clientId: v.string(),
  siteId: v.string(),
  driveId: v.string(),
  siteUrl: v.string(),
});

export const microsoftDocumentLocatorValidator = v.object({
  tenantId: v.string(),
  siteId: v.string(),
  driveId: v.string(),
  itemId: v.string(),
});

/** The catalog marker contains no source filename, URL, or bearer credential. */
export const externalDocumentMarkerValidator = v.object({
  sourceId: v.id("documentSources"),
  providerId: v.literal("microsoft-sharepoint"),
  referenceId: v.id("externalDocumentReferences"),
  mode: v.literal("latest"),
});

export const documentSourceTables = {
  documentSources: defineTable({
    societyId: v.id("societies"),
    providerId: v.literal("microsoft-sharepoint"),
    label: v.string(),
    enabled: v.boolean(),
    config: documentSourceConfigValidator,
    revision: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  // Stable IDs are private to the resolver. Microsoft metadata is returned
  // only after the current person has been checked by Graph, never cached here.
  externalDocumentReferences: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    sourceId: v.id("documentSources"),
    providerId: v.literal("microsoft-sharepoint"),
    mode: v.literal("latest"),
    locator: microsoftDocumentLocatorValidator,
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"])
    .index("by_source_and_item", ["sourceId", "locator.itemId"]),
};
