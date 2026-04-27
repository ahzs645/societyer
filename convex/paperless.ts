import { action, mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import {
  downloadPaperlessDocument,
  getPaperlessTask,
  listPaperlessDocuments,
  paperlessDocumentUrl,
  paperlessRuntimeStatus,
  testPaperlessConnection,
  uploadDocumentToPaperless,
} from "./providers/paperless";
import { createDownloadUrl } from "./providers/storage";

export const tagProfiles = query({
  args: {},
  returns: v.any(),
  handler: async () => [
    {
      scope: "Core record",
      tags: ["societyer", "category:<document category>", "local document tags"],
      usage: "Every synced document carries stable app-level context.",
    },
    {
      scope: "Governance",
      tags: ["constitution", "bylaws", "minutes", "election", "auditor"],
      usage: "Society profile, meetings, elections, bylaws, and auditor records.",
    },
    {
      scope: "Compliance",
      tags: ["filing", "filing:<kind>", "records-inspection", "pipa-training"],
      usage: "Filing evidence, retained records, inspections, and privacy training proof.",
    },
    {
      scope: "Finance and programs",
      tags: ["financial-statement", "grant-report", "grant-transaction", "volunteer-screening"],
      usage: "Financials, grants, donation evidence, and volunteer screening files.",
    },
  ],
});

export const listConnection = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("paperlessConnections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.sort((a, b) => b.connectedAtISO.localeCompare(a.connectedAtISO))[0] ?? null;
  },
});

export const connectionStatus = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const connection = await ctx.db
      .query("paperlessConnections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.connectedAtISO.localeCompare(a.connectedAtISO))[0] ?? null);
    return {
      connection,
      runtime: paperlessRuntimeStatus(),
    };
  },
});

export const recentSyncs = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { societyId, limit }) => {
    const rows = await ctx.db
      .query("paperlessDocumentSyncs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const sorted = rows
      .sort((a, b) => b.queuedAtISO.localeCompare(a.queuedAtISO))
      .slice(0, limit ?? 20);
    return await Promise.all(
      sorted.map(async (row) => {
        const document = await ctx.db.get(row.documentId);
        return {
          ...row,
          documentTitle: document?.title ?? row.title,
          documentCategory: document?.category,
        };
      }),
    );
  },
});

export const syncForDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { documentId }) => {
    const rows = await ctx.db
      .query("paperlessDocumentSyncs")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    return rows.sort((a, b) => b.queuedAtISO.localeCompare(a.queuedAtISO))[0] ?? null;
  },
});

export const sourcePullContext = query({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await requireRole(ctx, {
        actingUserId: args.actingUserId,
        societyId: args.societyId,
        required: "Director",
      });
    }
    const document = await ctx.db.get(args.documentId);
    if (!document || document.societyId !== args.societyId) {
      throw new Error("Document not found.");
    }
    return { document };
  },
});

export const pullSourceDocument = action({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    externalId: v.optional(v.string()),
    original: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { document } = await ctx.runQuery(api.paperless.sourcePullContext, {
      societyId: args.societyId,
      documentId: args.documentId,
      actingUserId: args.actingUserId,
    });
    const externalId = args.externalId ?? externalIdFromDocument(document);
    const paperlessId = paperlessIdFromExternalId(externalId);
    if (!paperlessId) {
      throw new Error("This source document is not linked to a Paperless document id.");
    }

    const pulled = await downloadPaperlessDocument(paperlessId, args.original ?? false);
    const storageId = await ctx.storage.store(pulled.blob);
    await ctx.runMutation(api.paperless.recordPulledSourceDocument, {
      societyId: args.societyId,
      documentId: args.documentId,
      storageId,
      externalId: `paperless:${paperlessId}`,
      paperlessDocumentUrl: pulled.documentUrl,
      fileName: pulled.fileName,
      mimeType: pulled.mimeType,
      fileSizeBytes: pulled.sizeBytes,
      metadata: pulled.metadata,
    });

    return {
      documentId: args.documentId,
      paperlessId,
      fileName: pulled.fileName,
      mimeType: pulled.mimeType,
      fileSizeBytes: pulled.sizeBytes,
      demo: pulled.demo,
    };
  },
});

export const recordPulledSourceDocument = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    storageId: v.id("_storage"),
    externalId: v.string(),
    paperlessDocumentUrl: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.societyId !== args.societyId) {
      throw new Error("Document not found.");
    }
    const existingContent = parseJsonObject(document.content);
    await ctx.db.patch(args.documentId, {
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      content: JSON.stringify({
        ...existingContent,
        externalSystem: existingContent.externalSystem ?? "paperless",
        externalId: existingContent.externalId ?? args.externalId,
        paperlessDocumentUrl: args.paperlessDocumentUrl,
        paperlessPulledAtISO: new Date().toISOString(),
        paperlessMetadata: args.metadata,
      }),
      tags: unique([
        ...(document.tags ?? []),
        "paperless-import",
        "paperless-pulled",
        tagValue(args.externalId),
      ]),
    });
  },
});

export const createMeetingMinutesImportSession = action({
  args: {
    societyId: v.id("societies"),
    query: v.optional(v.string()),
    maxDocuments: v.optional(v.number()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await ctx.runQuery(api.paperless.authorizeMeetingImport, {
        societyId: args.societyId,
        actingUserId: args.actingUserId,
      });
    }
    const docs = await listPaperlessDocuments({
      query: args.query,
      maxDocuments: args.maxDocuments ?? 500,
    });
    const candidates = docs
      .filter((doc) => !isPublicationSpecificDocument(doc) || hasSocietyGovernanceSignal(doc))
      .filter(isLikelyMeetingMinutesDocument);
    const sources = candidates.map((doc) => ({
      externalSystem: "paperless",
      externalId: `paperless:${doc.id}`,
      title: paperlessDocumentTitle(doc),
      sourceDate: documentDate(doc),
      category: "Meeting Minutes",
      confidence: "Medium",
      notes: `Detected from Paperless title/OCR. Original file: ${paperlessFileName(doc) ?? "unknown"}.`,
      url: paperlessDocumentUrl(doc.id),
    }));
    const meetingMinutes = candidates.flatMap((doc) => meetingMinutesFromPaperlessDocument(doc));
    const meetingAttendance = meetingMinutes.flatMap((minutes) => meetingAttendanceFromMinutes(minutes));
    const motionEvidence = meetingMinutes.flatMap((minutes) => motionEvidenceFromMinutes(minutes));
    const sessionId = await ctx.runMutation(api.importSessions.createFromBundle, {
      societyId: args.societyId,
      name: `Paperless meeting minutes scan (${new Date().toISOString().slice(0, 10)})`,
      bundle: {
        metadata: {
          name: "Paperless meeting minutes scan",
          createdFrom: "Paperless-ngx live scan",
          query: args.query ?? null,
          scannedDocuments: docs.length,
          candidateDocuments: candidates.length,
          generatedMeetingRecords: meetingMinutes.length,
          generatedAttendanceRecords: meetingAttendance.length,
          generatedMotionEvidenceRecords: motionEvidence.length,
        },
        sources,
        meetingMinutes,
        meetingAttendance,
        motionEvidence,
      },
    });
    return {
      sessionId,
      scannedDocuments: docs.length,
      candidateDocuments: candidates.length,
      meetingMinutes: meetingMinutes.length,
      meetingAttendance: meetingAttendance.length,
      motionEvidence: motionEvidence.length,
      sample: meetingMinutes.slice(0, 8).map((record) => ({
        meetingTitle: record.meetingTitle,
        meetingDate: record.meetingDate,
        sourceExternalIds: record.sourceExternalIds,
        motions: record.motions.length,
      })),
    };
  },
});

export const createDiscoveryImportSession = action({
  args: {
    societyId: v.id("societies"),
    query: v.optional(v.string()),
    maxDocuments: v.optional(v.number()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await ctx.runQuery(api.paperless.authorizeMeetingImport, {
        societyId: args.societyId,
        actingUserId: args.actingUserId,
      });
    }

    const docs = await listPaperlessDocuments({
      query: args.query,
      maxDocuments: args.maxDocuments ?? 1179,
    });
    const candidates = docs
      .map(discoveryCandidateFromPaperlessDocument)
      .filter(Boolean)
      .sort((a: any, b: any) => discoverySortKey(a).localeCompare(discoverySortKey(b)));
    const sources = candidates.map((candidate: any) => ({
      externalSystem: "paperless",
      externalId: `paperless:${candidate.id}`,
      title: candidate.title,
      sourceDate: candidate.created,
      category: candidate.sections[0] ?? "Documents",
      confidence: candidate.confidence,
      notes: discoverySourceNotes(candidate),
      url: paperlessDocumentUrl(candidate.id),
    }));
    const sectionSummary = summarizeDiscoveryCandidates(candidates);
    const sessionId = await ctx.runMutation(api.importSessions.createFromBundle, {
      societyId: args.societyId,
      name: `Paperless expanded discovery (${new Date().toISOString().slice(0, 10)})`,
      bundle: {
        metadata: {
          name: "Paperless expanded discovery",
          createdFrom: "Paperless-ngx live scan",
          query: args.query ?? null,
          scannedDocuments: docs.length,
          candidateDocuments: candidates.length,
          sectionSummary,
          note: "Review staged records before applying. Sensitive finance, HR, privacy, insurance, legal, and member data should stay restricted until redaction/access controls are confirmed.",
        },
        sources,
        documentMap: candidates,
      },
    });
    return {
      sessionId,
      scannedDocuments: docs.length,
      candidateDocuments: candidates.length,
      sectionSummary,
      sample: candidates.slice(0, 12).map((candidate: any) => ({
        id: candidate.id,
        title: candidate.title,
        sections: candidate.sections,
        confidence: candidate.confidence,
        sensitivity: candidate.sensitivity,
      })),
    };
  },
});

export const createTransposedImportSession = action({
  args: {
    societyId: v.id("societies"),
    query: v.optional(v.string()),
    maxDocuments: v.optional(v.number()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await ctx.runQuery(api.paperless.authorizeMeetingImport, {
        societyId: args.societyId,
        actingUserId: args.actingUserId,
      });
    }

    const docs = await listPaperlessDocuments({
      query: args.query,
      maxDocuments: args.maxDocuments ?? 1179,
    });
    const bundle = transposedBundleFromPaperlessDocuments(docs, args.query);
    const sessionId = await ctx.runMutation(api.importSessions.createFromBundle, {
      societyId: args.societyId,
      name: `Paperless transposed section import (${new Date().toISOString().slice(0, 10)})`,
      bundle,
    });
    return {
      sessionId,
      scannedDocuments: docs.length,
      sources: bundle.sources.length,
      byKind: {
        filings: bundle.filings.length,
        deadlines: bundle.deadlines.length,
        insurancePolicies: bundle.insurancePolicies.length,
        financialStatements: bundle.financialStatements.length,
        financialStatementImports: bundle.financialStatementImports.length,
        grants: bundle.grants.length,
        recordsLocations: bundle.recordsLocations.length,
        archiveAccessions: bundle.archiveAccessions.length,
        boardRoleAssignments: bundle.boardRoleAssignments.length,
        boardRoleChanges: bundle.boardRoleChanges.length,
        signingAuthorities: bundle.signingAuthorities.length,
        meetingAttendance: bundle.meetingAttendance.length,
        motionEvidence: bundle.motionEvidence.length,
        budgetSnapshots: bundle.budgetSnapshots.length,
        treasurerReports: bundle.treasurerReports.length,
        transactionCandidates: bundle.transactionCandidates.length,
        pipaTrainings: bundle.pipaTrainings.length,
        employees: bundle.employees.length,
        volunteers: bundle.volunteers.length,
      },
    };
  },
});

export const createBylawsHistoryImportSession = action({
  args: {
    societyId: v.id("societies"),
    query: v.optional(v.string()),
    maxDocuments: v.optional(v.number()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await ctx.runQuery(api.paperless.authorizeMeetingImport, {
        societyId: args.societyId,
        actingUserId: args.actingUserId,
      });
    }

    const query = args.query?.trim() || "bylaws by-laws constitution special resolution form 10";
    const docs = await listPaperlessDocuments({
      query,
      maxDocuments: args.maxDocuments ?? 500,
    });
    const bundle = bylawsHistoryBundleFromPaperlessDocuments(docs, query);
    const sessionId = await ctx.runMutation(api.importSessions.createFromBundle, {
      societyId: args.societyId,
      name: `Bylaws history bot - Paperless (${new Date().toISOString().slice(0, 10)})`,
      bundle,
    });
    return {
      sessionId,
      scannedDocuments: docs.length,
      candidateDocuments: bundle.sources.length,
      bylawAmendments: bundle.bylawAmendments.length,
      visionQueue: bundle.metadata.visionQueue,
      sample: bundle.bylawAmendments.slice(0, 8).map((record: any) => ({
        title: record.title,
        status: record.status,
        filedAtISO: record.filedAtISO,
        confidence: record.confidence,
      })),
    };
  },
});

export const authorizeMeetingImport = query({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.id("users"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    return true;
  },
});

export const getSync = query({
  args: { id: v.id("paperlessDocumentSyncs") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const upsertConnection = mutation({
  args: {
    societyId: v.id("societies"),
    autoCreateTags: v.boolean(),
    autoUpload: v.boolean(),
    tagPrefix: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await requireRole(ctx, {
        actingUserId: args.actingUserId,
        societyId: args.societyId,
        required: "Admin",
      });
    }

    const existing = await ctx.db
      .query("paperlessConnections")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect()
      .then((rows) => rows[0] ?? null);
    const runtime = paperlessRuntimeStatus();
    const patch = {
      status: "connected",
      baseUrl: runtime.baseUrl,
      autoCreateTags: args.autoCreateTags,
      autoUpload: args.autoUpload,
      tagPrefix: normalizeTagPrefix(args.tagPrefix),
      connectedAtISO: new Date().toISOString(),
      lastError: undefined,
      demo: !runtime.live,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("paperlessConnections", {
      societyId: args.societyId,
      ...patch,
    });
  },
});

export const disconnect = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await requireRole(ctx, {
        actingUserId: args.actingUserId,
        societyId: args.societyId,
        required: "Admin",
      });
    }
    const rows = await ctx.db
      .query("paperlessConnections")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.patch(row._id, { status: "disconnected" })));
  },
});

export const testConnection = action({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const result = await testPaperlessConnection();
    await ctx.runMutation(api.paperless.recordConnectionTest, {
      societyId,
      ok: result.ok,
      baseUrl: result.baseUrl,
      apiVersion: result.apiVersion,
      serverVersion: result.serverVersion,
      error: result.error,
      demo: result.demo,
    });
    return result;
  },
});

export const recordConnectionTest = mutation({
  args: {
    societyId: v.id("societies"),
    ok: v.boolean(),
    baseUrl: v.optional(v.string()),
    apiVersion: v.optional(v.string()),
    serverVersion: v.optional(v.string()),
    error: v.optional(v.string()),
    demo: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("paperlessConnections")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect()
      .then((rows) => rows[0] ?? null);
    if (!connection) return null;
    await ctx.db.patch(connection._id, {
      status: args.ok ? "connected" : "error",
      baseUrl: args.baseUrl,
      apiVersion: args.apiVersion,
      serverVersion: args.serverVersion,
      lastCheckedAtISO: new Date().toISOString(),
      lastError: args.error,
      demo: args.demo,
    });
    return connection._id;
  },
});

export const syncContext = query({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.actingUserId) {
      await requireRole(ctx, {
        actingUserId: args.actingUserId,
        societyId: args.societyId,
        required: "Director",
      });
    }

    const document = await ctx.db.get(args.documentId);
    if (!document || document.societyId !== args.societyId) {
      throw new Error("Document not found.");
    }
    const connection = await ctx.db
      .query("paperlessConnections")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect()
      .then((rows) =>
        rows
          .filter((row) => row.status !== "disconnected")
          .sort((a, b) => b.connectedAtISO.localeCompare(a.connectedAtISO))[0] ?? null,
      );
    if (!connection) {
      throw new Error("Connect Paperless-ngx before syncing documents.");
    }

    const version = args.versionId
      ? await ctx.db.get(args.versionId)
      : await latestVersion(ctx, args.documentId);
    if (version && version.documentId !== args.documentId) {
      throw new Error("Version does not belong to this document.");
    }

    const usageTags = await inferUsageTags(ctx, document);
    const tags = buildPaperlessTags({
      document,
      connection,
      usageTags,
    });

    return {
      connection,
      document,
      version,
      tags,
      source: version
        ? {
            kind: "version",
            provider: version.storageProvider,
            key: version.storageKey,
            fileName: version.fileName,
            mimeType: version.mimeType,
          }
        : document.storageId
          ? {
              kind: "convex",
              storageId: document.storageId,
              fileName: document.fileName ?? `${document.title}.pdf`,
              mimeType: document.mimeType,
            }
          : null,
    };
  },
});

export const syncDocument = action({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const syncCtx = await ctx.runQuery(api.paperless.syncContext, args);
    if (!syncCtx.source) {
      throw new Error("This document has no stored file or version to send to Paperless-ngx.");
    }

    const fileName = syncCtx.source.fileName ?? syncCtx.document.fileName ?? `${syncCtx.document.title}.pdf`;
    const title = syncCtx.document.title;
    let blob: Blob | null = null;

    if (syncCtx.source.kind === "version") {
      if (syncCtx.source.provider === "demo") {
        blob = new Blob([`Demo Paperless document for ${title}`], {
          type: syncCtx.source.mimeType ?? "text/plain",
        });
      } else {
        const url = await createDownloadUrl({
          provider: syncCtx.source.provider as "rustfs" | "demo",
          key: syncCtx.source.key,
        });
        blob = await fetchBlob(url);
      }
    } else if (syncCtx.source.kind === "convex") {
      const url = await ctx.runQuery(api.files.getUrl, {
        storageId: syncCtx.source.storageId as Id<"_storage">,
      });
      if (!url) throw new Error("The stored file is no longer available.");
      blob = await fetchBlob(url);
    }

    if (!blob) throw new Error("The stored file could not be prepared for Paperless-ngx.");

    try {
      const result = await uploadDocumentToPaperless({
        blob,
        fileName,
        title,
        createdISO: syncCtx.document.createdAtISO,
        tags: syncCtx.tags,
        autoCreateTags: syncCtx.connection.autoCreateTags,
      });
      const status = result.documentId ? "complete" : "queued";
      await ctx.runMutation(api.paperless.recordSyncResult, {
        societyId: args.societyId,
        documentId: args.documentId,
        versionId: args.versionId ?? syncCtx.version?._id,
        connectionId: syncCtx.connection._id,
        status,
        paperlessTaskId: result.taskId,
        paperlessDocumentId: result.documentId,
        paperlessDocumentUrl: result.documentUrl,
        title,
        fileName,
        tags: syncCtx.tags,
      });
      return { ...result, status, tags: syncCtx.tags };
    } catch (error: any) {
      await ctx.runMutation(api.paperless.recordSyncResult, {
        societyId: args.societyId,
        documentId: args.documentId,
        versionId: args.versionId ?? syncCtx.version?._id,
        connectionId: syncCtx.connection._id,
        status: "failed",
        title,
        fileName,
        tags: syncCtx.tags,
        lastError: error?.message ?? "Paperless-ngx sync failed.",
      });
      throw error;
    }
  },
});

export const refreshSync = action({
  args: { syncId: v.id("paperlessDocumentSyncs") },
  returns: v.any(),
  handler: async (ctx, { syncId }) => {
    const sync = await ctx.runQuery(api.paperless.getSync, { id: syncId });
    if (!sync?.paperlessTaskId) return null;
    const task = await getPaperlessTask(sync.paperlessTaskId);
    await ctx.runMutation(api.paperless.recordSyncRefresh, {
      syncId,
      status: task.status,
      paperlessDocumentId: task.documentId,
      paperlessDocumentUrl: task.documentUrl,
      lastError: task.status === "failed" ? "Paperless-ngx reported a failed consumer task." : undefined,
    });
    return task;
  },
});

export const recordSyncResult = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    connectionId: v.optional(v.id("paperlessConnections")),
    status: v.string(),
    paperlessTaskId: v.optional(v.string()),
    paperlessDocumentId: v.optional(v.number()),
    paperlessDocumentUrl: v.optional(v.string()),
    title: v.string(),
    fileName: v.optional(v.string()),
    tags: v.array(v.string()),
    lastError: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("paperlessDocumentSyncs")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const existing =
      existingRows.find((row) => row.versionId === args.versionId) ??
      (args.versionId ? null : existingRows[0]);
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      documentId: args.documentId,
      versionId: args.versionId,
      connectionId: args.connectionId,
      status: args.status,
      paperlessTaskId: args.paperlessTaskId,
      paperlessDocumentId: args.paperlessDocumentId,
      paperlessDocumentUrl:
        args.paperlessDocumentUrl ??
        (args.paperlessDocumentId ? paperlessDocumentUrl(args.paperlessDocumentId) : undefined),
      title: args.title,
      fileName: args.fileName,
      tags: args.tags,
      queuedAtISO: now,
      completedAtISO: args.status === "complete" ? now : undefined,
      lastCheckedAtISO: args.status === "failed" ? now : undefined,
      lastError: args.lastError,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("paperlessDocumentSyncs", payload);
    }

    if (args.connectionId) {
      await ctx.db.patch(args.connectionId, {
        lastSyncAtISO: now,
        lastError: args.lastError,
      });
    }
  },
});

export const recordSyncRefresh = mutation({
  args: {
    syncId: v.id("paperlessDocumentSyncs"),
    status: v.string(),
    paperlessDocumentId: v.optional(v.number()),
    paperlessDocumentUrl: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    await ctx.db.patch(args.syncId, {
      status: args.status,
      paperlessDocumentId: args.paperlessDocumentId,
      paperlessDocumentUrl:
        args.paperlessDocumentUrl ??
        (args.paperlessDocumentId ? paperlessDocumentUrl(args.paperlessDocumentId) : undefined),
      completedAtISO: args.status === "complete" ? now : undefined,
      lastCheckedAtISO: now,
      lastError: args.lastError,
    });
  },
});

async function latestVersion(ctx: any, documentId: Id<"documents">) {
  const rows = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q: any) => q.eq("documentId", documentId))
    .collect();
  return rows.sort((a: any, b: any) => b.version - a.version)[0] ?? null;
}

async function fetchBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read stored file (${response.status}).`);
  }
  return await response.blob();
}

function buildPaperlessTags(args: {
  document: any;
  connection: any;
  usageTags: string[];
}) {
  const prefix = args.connection.tagPrefix || "societyer";
  return unique([
    prefix,
    args.document.category && `${prefix}:${tagValue(args.document.category)}`,
    args.document.category,
    ...(args.document.tags ?? []),
    ...args.usageTags,
  ]);
}

async function inferUsageTags(ctx: any, document: any) {
  const societyId = document.societyId;
  const documentId = document._id;
  const tags: string[] = [];
  const society = await ctx.db.get(societyId);
  if (society?.constitutionDocId === documentId) tags.push("constitution");
  if (society?.bylawsDocId === documentId) tags.push("bylaws");
  if (society?.privacyPolicyDocId === documentId) tags.push("privacy-policy");

  await addTagsFromTable(ctx, "filings", societyId, (row: any) => {
    if (row.receiptDocumentId === documentId) return ["filing", `filing:${tagValue(row.kind)}`, "filing-receipt"];
    if (row.stagedPacketDocumentId === documentId) return ["filing", `filing:${tagValue(row.kind)}`, "filing-packet"];
    return [];
  }, tags);
  await addTagsFromTable(ctx, "financials", societyId, (row: any) =>
    row.statementsDocId === documentId ? ["financial-statement"] : [], tags);
  await addTagsFromTable(ctx, "grantReports", societyId, (row: any) =>
    row.documentId === documentId ? ["grant-report"] : [], tags);
  await addTagsFromTable(ctx, "grantTransactions", societyId, (row: any) =>
    row.documentId === documentId ? ["grant-transaction"] : [], tags);
  await addTagsFromTable(ctx, "pipaTrainings", societyId, (row: any) =>
    row.documentId === documentId ? ["pipa-training"] : [], tags);
  await addTagsFromTable(ctx, "auditorAppointments", societyId, (row: any) =>
    row.engagementLetterDocId === documentId ? ["auditor", "engagement-letter"] : [], tags);
  await addTagsFromTable(ctx, "courtOrders", societyId, (row: any) =>
    row.documentId === documentId ? ["court-order"] : [], tags);
  await addTagsFromTable(ctx, "inspections", societyId, (row: any) =>
    row.documentId === documentId ? ["records-inspection"] : [], tags);
  await addTagsFromTable(ctx, "elections", societyId, (row: any) =>
    row.evidenceDocumentId === documentId ? ["election", "election-evidence"] : [], tags);
  await addTagsFromTable(ctx, "volunteerScreenings", societyId, (row: any) => {
    if (row.consentDocumentId === documentId) return ["volunteer-screening", "screening-consent"];
    if (row.resultDocumentId === documentId) return ["volunteer-screening", "screening-result"];
    return [];
  }, tags);

  return unique(tags);
}

async function addTagsFromTable(
  ctx: any,
  table: string,
  societyId: Id<"societies">,
  mapTags: (row: any) => string[],
  output: string[],
) {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  for (const row of rows) output.push(...mapTags(row));
}

function normalizeTagPrefix(prefix?: string) {
  const normalized = tagValue(prefix || "societyer");
  return normalized || "societyer";
}

function externalIdFromDocument(document: any) {
  const payload = parseJsonObject(document.content);
  const fromContent = String(payload.externalId ?? "").trim();
  if (fromContent) return fromContent;
  const fromTags = (document.tags ?? []).find((tag: string) => /^paperless:\d+$/i.test(tag));
  return fromTags ? String(fromTags) : undefined;
}

function transposedBundleFromPaperlessDocuments(docs: any[], query?: string) {
  const sourcesByExternalId = new Map<string, any>();
  const bundle: any = {
    metadata: {
      name: "Paperless transposed section import",
      createdFrom: "Paperless-ngx live OCR transposition",
      query: query ?? null,
      scannedDocuments: docs.length,
      note: "Records were transposed from Paperless OCR/title metadata into section-native review records. Approve each record in the GUI before applying. Restricted rows keep OCR content out of the review table.",
    },
    sources: [],
    filings: [],
    deadlines: [],
    insurancePolicies: [],
    financialStatements: [],
    financialStatementImports: [],
    grants: [],
    recordsLocations: [],
    archiveAccessions: [],
    boardRoleAssignments: [],
    boardRoleChanges: [],
    signingAuthorities: [],
    meetingAttendance: [],
    motionEvidence: [],
    budgetSnapshots: [],
    treasurerReports: [],
    transactionCandidates: [],
    pipaTrainings: [],
    employees: [],
    volunteers: [],
  };

  const push = (kind: string, record: any | null) => {
    if (!record) return;
    const key = `${kind}:${record.sourceExternalIds?.join(",") ?? record.title}`;
    const seenKey = `__seen_${kind}`;
    bundle[seenKey] ??= new Set<string>();
    if (bundle[seenKey].has(key)) return;
    bundle[seenKey].add(key);
    const target = transposedBundleKey(kind);
    bundle[target].push(record);
    for (const externalId of record.sourceExternalIds ?? []) {
      const doc = docs.find((candidate) => `paperless:${candidate.id}` === externalId);
      if (doc && !sourcesByExternalId.has(externalId)) sourcesByExternalId.set(externalId, transposedSourceFromDoc(doc, record.sensitivity));
    }
  };

  for (const doc of docs) {
    for (const record of transposedRecordsFromPaperlessDocument(doc)) {
      push(record.kind, record.payload);
    }
  }

  bundle.sources = Array.from(sourcesByExternalId.values());
  for (const key of Object.keys(bundle)) {
    if (key.startsWith("__seen_")) delete bundle[key];
  }
  bundle.metadata.recordCounts = {
    sources: bundle.sources.length,
    filings: bundle.filings.length,
    deadlines: bundle.deadlines.length,
    insurancePolicies: bundle.insurancePolicies.length,
    financialStatements: bundle.financialStatements.length,
    financialStatementImports: bundle.financialStatementImports.length,
    grants: bundle.grants.length,
    recordsLocations: bundle.recordsLocations.length,
    archiveAccessions: bundle.archiveAccessions.length,
    boardRoleAssignments: bundle.boardRoleAssignments.length,
    boardRoleChanges: bundle.boardRoleChanges.length,
    signingAuthorities: bundle.signingAuthorities.length,
    meetingAttendance: bundle.meetingAttendance.length,
    motionEvidence: bundle.motionEvidence.length,
    budgetSnapshots: bundle.budgetSnapshots.length,
    treasurerReports: bundle.treasurerReports.length,
    transactionCandidates: bundle.transactionCandidates.length,
    pipaTrainings: bundle.pipaTrainings.length,
    employees: bundle.employees.length,
    volunteers: bundle.volunteers.length,
  };
  return bundle;
}

function bylawsHistoryBundleFromPaperlessDocuments(docs: any[], query?: string) {
  const candidates = docs
    .map(bylawsHistoryCandidateFromPaperlessDocument)
    .filter(Boolean)
    .sort((a: any, b: any) =>
      String(a.sourceDate ?? "").localeCompare(String(b.sourceDate ?? "")) ||
      String(a.title ?? "").localeCompare(String(b.title ?? "")),
    );

  let previousText = "";
  const bylawAmendments = candidates.map((candidate: any, index: number) => {
    const record = {
      title: candidate.title,
      status: candidate.status,
      baseText: previousText,
      proposedText: candidate.markdown,
      createdByName: "Bylaws history bot",
      createdAtISO: sourceDateTime(candidate.sourceDate),
      updatedAtISO: sourceDateTime(candidate.sourceDate),
      filedAtISO: candidate.status === "Filed" ? sourceDateTime(candidate.sourceDate) : undefined,
      sourceDate: candidate.sourceDate,
      sourceExternalIds: [candidate.externalId],
      importedFrom: "Paperless bylaws history bot",
      confidence: candidate.confidence,
      notes: candidate.notes,
      extractionPlan: candidate.extractionPlan,
      sourceTitle: candidate.sourceTitle,
    };
    if (candidate.status === "Filed") previousText = candidate.markdown;
    else if (index === 0 && !previousText) previousText = candidate.markdown;
    return record;
  });

  return {
    metadata: {
      name: "Bylaws history bot - Paperless",
      createdFrom: "Paperless-ngx bylaws history bot",
      query: query ?? null,
      scannedDocuments: docs.length,
      candidateDocuments: candidates.length,
      bylawAmendments: bylawAmendments.length,
      visionQueue: candidates.filter((candidate: any) => candidate.needsVisionReview).length,
      note: "The bot normalizes OCR into Markdown so reviewers can compare bylaw versions. Sparse OCR or scan-only PDFs are staged with a page-by-page vision review plan instead of being trusted automatically.",
    },
    sources: candidates.map((candidate: any) => ({
      externalSystem: "paperless",
      externalId: candidate.externalId,
      title: candidate.sourceTitle,
      sourceDate: candidate.sourceDate,
      category: "Bylaws Source",
      confidence: candidate.confidence,
      notes: candidate.sourceNotes,
      url: candidate.url,
      fileName: candidate.fileName,
      tags: ["bylaws", candidate.needsVisionReview ? "vision-review" : "ocr-markdown"],
    })),
    bylawAmendments,
  };
}

function bylawsHistoryCandidateFromPaperlessDocument(doc: any) {
  const title = paperlessDocumentTitle(doc);
  const fileName = paperlessFileName(doc);
  const rawContent = rawPaperlessContent(doc);
  const haystack = `${title}\n${fileName ?? ""}\n${rawContent}`;
  if (!isLikelyBylawsHistorySource(haystack)) return null;

  const sourceDate = inferredPaperlessDate(doc);
  const externalId = `paperless:${doc.id}`;
  const fullBylaws = looksLikeFullBylaws(haystack);
  const needsVisionReview = cleanOcrText(rawContent).length < 300;
  const markdown = needsVisionReview
    ? visionReviewMarkdown(title, doc)
    : bylawsMarkdownFromText(rawContent, title);
  const status = fullBylaws && !needsVisionReview ? "Filed" : "Draft";
  const confidence = fullBylaws && !needsVisionReview
    ? "Medium"
    : needsVisionReview
      ? "Review"
      : "Review";
  const sourceNotes = needsVisionReview
    ? "Paperless returned little or no OCR for this bylaws source. Pull the source file and run a page-by-page vision review before approving."
    : "OCR was normalized into Markdown for reviewer comparison. Verify numbering, headings, signatures, and any handwritten marks against the source PDF.";

  return {
    title: bylawHistoryTitle(title, sourceDate, status),
    sourceTitle: title,
    fileName,
    sourceDate,
    externalId,
    url: paperlessDocumentUrl(doc.id),
    markdown,
    status,
    confidence,
    needsVisionReview,
    sourceNotes,
    notes: [
      sourceNotes,
      fullBylaws
        ? "Looks like a full bylaws document, so it was staged as a filed replacement version."
        : "Looks like an amendment, resolution, or partial source. Review and merge into the previous full bylaws text before filing in the history.",
    ].join(" "),
    extractionPlan: needsVisionReview
      ? {
          mode: "page_by_page_vision",
          reason: "Paperless OCR was sparse or missing.",
          reviewerInstruction: "Render each PDF page as an image, transcribe clauses in order, preserve numbering, and mark uncertain words with [[uncertain: ...]].",
        }
      : {
          mode: "ocr_markdown_normalization",
          reason: "Paperless OCR text was available.",
        },
  };
}

function isLikelyBylawsHistorySource(text: string) {
  return /\b(bylaws?|by-laws?|constitution|special resolution|copy of resolution|form\s*10|transition application)\b/i.test(text) &&
    /\b(societ(?:y|ies)|bc registr|registrar|directors?|members?|general meetings?|special resolution|quorum|voting)\b/i.test(text);
}

function looksLikeFullBylaws(text: string) {
  const score = [
    /\bbylaws?|by-laws?\b/i,
    /\bpart\s+\d+|article\s+\d+|section\s+\d+|\b\d+\.\s+[A-Z]/i,
    /\bmembers?\b/i,
    /\bdirectors?\b/i,
    /\bgeneral meetings?|annual general meeting|special general meeting\b/i,
    /\bquorum|vot(?:e|ing)|special resolution\b/i,
  ].reduce((sum, regex) => sum + (regex.test(text) ? 1 : 0), 0);
  return score >= 4 && cleanOcrText(text).length > 900;
}

function rawPaperlessContent(doc: any) {
  return String(doc.content ?? "").replace(/\r/g, "\n").trim();
}

function bylawsMarkdownFromText(raw: string, title: string) {
  const source = rebreakBylawsText(raw || title);
  const lines = source
    .split(/\n+/)
    .map((line) => normalizeBylawLine(line))
    .filter(Boolean);
  const out: string[] = [`# ${title}`];
  let previousWasHeading = true;

  for (const line of lines) {
    if (isPdfPageMarker(line)) continue;
    if (sameNormalizedText(line, title)) continue;

    if (/^(part|article)\s+[0-9ivxlcdm]+(\b|[:. -])/i.test(line)) {
      out.push("", `## ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (/^(section|bylaw)\s+\d+(\b|[:. -])/i.test(line)) {
      out.push("", `### ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (isLikelyStandaloneHeading(line)) {
      out.push("", `## ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (/^\d+(?:\.\d+)*[.)]?\s+/.test(line) || /^\([a-z0-9ivxlcdm]+\)\s+/i.test(line)) {
      out.push(previousWasHeading ? line : `\n${line}`);
      previousWasHeading = false;
      continue;
    }

    out.push(line);
    previousWasHeading = false;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function rebreakBylawsText(value: string) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+(Part\s+[0-9IVXLCDM]+[:. -])/gi, "\n\n$1")
    .replace(/\s+((?:Article|Section|Bylaw)\s+\d+(?:\.\d+)*[:. -])/gi, "\n\n$1")
    .replace(/\s+(\d+(?:\.\d+)*[.)]\s+)/g, "\n$1")
    .replace(/\s+(\([a-z0-9ivxlcdm]+\)\s+)/gi, "\n$1")
    .trim();
}

function normalizeBylawLine(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function isPdfPageMarker(line: string) {
  return /^(page\s*)?\d+\s*(of\s+\d+)?$/i.test(line) ||
    /^-+\s*\d+\s*-+$/.test(line);
}

function sameNormalizedText(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalize(left) === normalize(right);
}

function isLikelyStandaloneHeading(line: string) {
  if (line.length < 4 || line.length > 90) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/^(and|or|the|a|an|to|of|in|for)\b/i.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > 10) return false;
  const capitalized = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
  return capitalized >= Math.max(1, Math.ceil(words.length * 0.6));
}

function visionReviewMarkdown(title: string, doc: any) {
  return [
    `# ${title}`,
    "",
    "## Vision transcription required",
    "",
    "Paperless did not return enough OCR text to reconstruct this bylaws version safely.",
    "",
    "Reviewer checklist:",
    "",
    "1. Pull the original PDF from Paperless.",
    "2. Render each page as an image and transcribe it in order.",
    "3. Preserve all headings, clause numbers, definitions, schedules, signatures, and handwritten annotations.",
    "4. Mark uncertain words as `[[uncertain: text]]` and missing/unreadable areas as `[[illegible: page N]]`.",
    "",
    `Source: Paperless #${doc.id}`,
  ].join("\n");
}

function bylawHistoryTitle(sourceTitle: string, sourceDate: string | undefined, status: string) {
  const suffix = sourceDate ? ` (${sourceDate})` : "";
  const prefix = status === "Filed" ? "Bylaws version" : "Bylaws source needing review";
  return `${prefix}: ${sourceTitle}${suffix}`;
}

function sourceDateTime(date: string | undefined) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00Z`;
  return new Date().toISOString();
}

function transposedBundleKey(kind: string) {
  return ({
    filing: "filings",
    deadline: "deadlines",
    insurancePolicy: "insurancePolicies",
    financialStatement: "financialStatements",
    financialStatementImport: "financialStatementImports",
    grant: "grants",
    recordsLocation: "recordsLocations",
    archiveAccession: "archiveAccessions",
    boardRoleAssignment: "boardRoleAssignments",
    boardRoleChange: "boardRoleChanges",
    signingAuthority: "signingAuthorities",
    meetingAttendance: "meetingAttendance",
    motionEvidence: "motionEvidence",
    budgetSnapshot: "budgetSnapshots",
    treasurerReport: "treasurerReports",
    transactionCandidate: "transactionCandidates",
    pipaTraining: "pipaTrainings",
    employee: "employees",
    volunteer: "volunteers",
  } as Record<string, string>)[kind] ?? "documentMap";
}

function transposedRecordsFromPaperlessDocument(doc: any) {
  const out: Array<{ kind: string; payload: any }> = [];
  if (isPublicationSpecificDocument(doc) && !hasSocietyGovernanceSignal(doc)) return out;
  const filing = transposedFiling(doc);
  if (filing) out.push({ kind: "filing", payload: filing });
  const deadline = transposedDeadline(doc);
  if (deadline) out.push({ kind: "deadline", payload: deadline });
  const insurance = transposedInsurancePolicy(doc);
  if (insurance) out.push({ kind: "insurancePolicy", payload: insurance });
  const financial = transposedFinancialStatement(doc);
  if (financial) out.push({ kind: "financialStatement", payload: financial });
  const financialImport = transposedFinancialStatementImport(doc);
  if (financialImport) out.push({ kind: "financialStatementImport", payload: financialImport });
  const grant = transposedGrant(doc);
  if (grant) out.push({ kind: "grant", payload: grant });
  const recordsLocation = transposedRecordsLocation(doc);
  if (recordsLocation) out.push({ kind: "recordsLocation", payload: recordsLocation });
  const archiveAccession = transposedArchiveAccession(doc);
  if (archiveAccession) out.push({ kind: "archiveAccession", payload: archiveAccession });
  const roleAssignment = transposedBoardRoleAssignment(doc);
  if (roleAssignment) out.push({ kind: "boardRoleAssignment", payload: roleAssignment });
  const roleChange = transposedBoardRoleChange(doc);
  if (roleChange) out.push({ kind: "boardRoleChange", payload: roleChange });
  const signingAuthority = transposedSigningAuthority(doc);
  if (signingAuthority) out.push({ kind: "signingAuthority", payload: signingAuthority });
  for (const attendance of transposedMeetingAttendance(doc)) out.push({ kind: "meetingAttendance", payload: attendance });
  const motionEvidence = transposedMotionEvidence(doc);
  if (motionEvidence) out.push({ kind: "motionEvidence", payload: motionEvidence });
  const budgetSnapshot = transposedBudgetSnapshot(doc);
  if (budgetSnapshot) out.push({ kind: "budgetSnapshot", payload: budgetSnapshot });
  const treasurerReport = transposedTreasurerReport(doc);
  if (treasurerReport) out.push({ kind: "treasurerReport", payload: treasurerReport });
  const transactionCandidate = transposedTransactionCandidate(doc);
  if (transactionCandidate) out.push({ kind: "transactionCandidate", payload: transactionCandidate });
  const pipaTraining = transposedPipaTraining(doc);
  if (pipaTraining) out.push({ kind: "pipaTraining", payload: pipaTraining });
  const employee = transposedEmployee(doc);
  if (employee) out.push({ kind: "employee", payload: employee });
  const volunteer = transposedVolunteer(doc);
  if (volunteer) out.push({ kind: "volunteer", payload: volunteer });
  return out;
}

function transposedSourceFromDoc(doc: any, sensitivity?: string) {
  const restricted = sensitivity === "restricted" || isSensitivePaperlessDocument(doc);
  return {
    externalSystem: "paperless",
    externalId: `paperless:${doc.id}`,
    title: paperlessDocumentTitle(doc),
    sourceDate: inferredPaperlessDate(doc),
    category: restricted ? "Restricted Paperless Source" : "Paperless Source",
    confidence: "Review",
    notes: restricted
      ? "Restricted source. OCR/content is intentionally withheld from the import review table; open Paperless or pull the source file for authorized review."
      : safeTranspositionSnippet(doc),
    url: paperlessDocumentUrl(doc.id),
  };
}

function transposedFiling(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(society act|registrar|bc registr|bc companies|annual report|form\s*10|constitution|bylaws?|by-laws?|copy of resolution|special resolution|notice of dissolution|incorporation)\b/i.test(text)) {
    return null;
  }
  const lower = text.toLowerCase();
  const kind = lower.includes("annual report")
    ? "AnnualReport"
    : lower.includes("director")
    ? "ChangeOfDirectors"
    : lower.includes("constitution")
    ? "ConstitutionAlteration"
    : lower.includes("bylaw") || lower.includes("resolution") || lower.includes("form 10")
    ? "BylawAmendment"
    : lower.includes("dissolution")
    ? "DissolutionNotice"
    : "RegistryRecord";
  const date = inferredPaperlessDate(doc);
  return {
    title,
    kind,
    periodLabel: fiscalYearLabel(date),
    dueDate: date,
    filedAt: /\b(filed|filing|documents filed)\b/i.test(text) ? date : undefined,
    submissionMethod: "Paperless source review",
    status: /\b(active|filed|documents filed|annual report)\b/i.test(text) ? "Filed" : "NeedsReview",
    registryUrl: "https://www.bcregistry.gov.bc.ca/societies/",
    evidenceNotes: safeRestrictedNote(doc, "Filing evidence transposed from Paperless OCR/title metadata."),
    notes: safeRestrictedNote(doc, "Review filing source before treating this as authoritative registry data."),
    confidence: /\b(file number|registrar|annual report|form\s*10)\b/i.test(text) ? "High" : "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: date,
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedDeadline(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(deadline|due date|renewal|expires?|expiry|filing deadline|publication days?|copy deadline|ad deadline)\b/i.test(text)) {
    return null;
  }
  if (
    /\b(invoices?|receipts?|statements?|bank|bmo|cheques?|payroll)\b/i.test(title) &&
    !/\b(deadline|renewal|expires?|expiry|filing deadline|publication days?|copy deadline|ad deadline)\b/i.test(title)
  ) {
    return null;
  }
  if (
    /\b(invoices?|receipts?|statements?|bank|cheques?|payroll|balance due|amount due)\b/i.test(text) &&
    !/\b(deadline|renewal|expires?|expiry|filing deadline|publication days?|copy deadline|ad deadline)\b/i.test(text)
  ) {
    return null;
  }
  const dueDate = dateNear(text, /\b(deadline|due|renewal|expires?|expiry|publication)\b/i) ?? inferredPaperlessDate(doc);
  return {
    title,
    dueDate,
    category: /\binsurance|policy\b/i.test(text) ? "Insurance" : /\bannual report|filing|registry\b/i.test(text) ? "Filing" : /\bissue|publication|ad\b/i.test(text) ? "Publication" : "Paperless",
    description: safeRestrictedNote(doc, "Deadline candidate transposed from Paperless OCR/title metadata. Verify that the date is a true due date, not a scan date."),
    recurrence: /\bannual|yearly|renewal\b/i.test(text) ? "annual" : undefined,
    status: "NeedsReview",
    confidence: dueDate ? "Medium" : "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function isPublicationSpecificDocument(doc: any) {
  const text = paperlessText(doc);
  return /\b(newspaper|masthead|media kit|advertis(e|ing|ement)|distribution|article draft|web article|for print|for web|copy editor|production coordinator|volume\s+\d+|vol\.?\s*\d+|issue\s+\d+)\b/i.test(text);
}

function hasSocietyGovernanceSignal(doc: any) {
  const text = paperlessText(doc);
  return /\b(society act|annual report|change of directors|board minutes?|meeting minutes?|agm|special general|motion|seconded|carried|budget|financial statement|balance sheet|income statement|treasurer report|bank|signing authority|insurance|grant|archive custody|records location|archival agreement)\b/i.test(text);
}

function transposedInsurancePolicy(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!isLikelyInsurancePolicyDocument(text, title)) {
    return null;
  }
  const policyNumber = text.match(/\b(?:policy\s*(?:number|no\.?)[:\s]*)([A-Z0-9-]{4,})/i)?.[1];
  const startDate = dateNear(text, /\b(effective|start|from)\b/i) ?? inferredPaperlessDate(doc);
  const endDate = dateNear(text, /\b(expires?|expiry|expiration|to)\b/i);
  const renewalDate = dateNear(text, /\b(renewal|expires?|expiry|to)\b/i) ?? endDate ?? addOneYear(startDate);
  const coverageCents = moneyNear(text, /\b(coverage|limit|liability)\b/i);
  const sourceExternalId = `paperless:${doc.id}`;
  const isDno = /\bdirector|d&o|officer\b/i.test(text);
  const isCgl = /\bgeneral liability|commercial general\b/i.test(text);
  return {
    title,
    kind: isDno ? "DirectorsOfficers" : /\bcyber\b/i.test(text) ? "CyberLiability" : isCgl ? "GeneralLiability" : "Other",
    insurer: text.match(/\b(?:insurer|insurance company|underwritten by)[:\s-]+([A-Z][A-Za-z& .'-]{2,80})/i)?.[1] ?? "Needs review",
    broker: text.match(/\b(?:broker|agent|producer)[:\s-]+([A-Z][A-Za-z& .'-]{2,80})/i)?.[1],
    policyNumber: policyNumber || "Needs review",
    policySeriesKey: insuranceSeriesKeyFromText(text, policyNumber, isDno, isCgl),
    policyTermLabel: startDate && (endDate || renewalDate) ? `${startDate.slice(0, 4)}-${String(endDate ?? renewalDate).slice(0, 4)}` : undefined,
    versionType: /\brenewal\b/i.test(text) ? "renewal" : undefined,
    coverageCents,
    premiumCents: moneyNear(text, /\b(premium|amount due|balance due)\b/i),
    deductibleCents: moneyNear(text, /\b(deductible|retention)\b/i),
    coverageSummary: coverageCents ? `OCR detected policy limit ${formatMoneyFromCents(coverageCents)}. Verify against source declarations.` : undefined,
    coveredParties: insuranceCoveredParties(text, sourceExternalId),
    coverageItems: coverageCents ? [{
      label: "Policy limit detected by OCR",
      coverageType: isDno ? "Directors and officers liability" : isCgl ? "Commercial general liability" : "Insurance coverage",
      limitCents: coverageCents,
      summary: "OCR-derived limit. Verify against declarations before approval.",
      sourceExternalIds: [sourceExternalId],
    }] : [],
    insuranceRequirements: insuranceRequirementsFromText(text, sourceExternalId, coverageCents),
    claimsMadeTerms: isDno ? {
      retroactiveDate: dateNear(text, /\b(retroactive|prior acts)\b/i),
      reportingDeadline: dateNear(text, /\b(report|notice|claim)\b/i),
      defenseCostsInsideLimit: /\b(defen[cs]e costs?.{0,40}(inside|inclusive|erode)|limit.{0,40}defen[cs]e costs?)\b/i.test(text) ? true : undefined,
      retentionCents: moneyNear(text, /\b(retention|deductible)\b/i),
      territory: text.match(/\b(worldwide|canada|united states|north america)\b/i)?.[1],
      sourceExternalIds: [sourceExternalId],
      notes: "OCR-derived claims-made terms. Verify reporting deadline and defence-cost wording against the policy.",
    } : undefined,
    claimIncidents: /\b(claim|incident|injury|loss)\b/i.test(text) ? [{
      status: "Needs review",
      privacyFlag: true,
      sourceExternalIds: [sourceExternalId],
      notes: "Insurance source mentions claim/incident/loss language. Review before creating a final claim record.",
    }] : [],
    complianceChecks: complianceChecksFromInsuranceText(text, sourceExternalId, renewalDate),
    startDate,
    endDate,
    renewalDate,
    status: "Active",
    notes: "Restricted insurance metadata transposed from Paperless. Verify policy number, coverage, premium, and effective dates before use.",
    confidence: policyNumber ? "Medium" : "Review",
    sensitivity: "restricted",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function isLikelyInsurancePolicyDocument(text: string, title: string) {
  const haystack = `${title}\n${text}`;
  if (/\b(payment options?|statement of account|tax credit|td1|resume|curriculum vitae|service plan|easy care|cra|information return)\b/i.test(title)) {
    return false;
  }
  const hasPolicyNumber = /\bpolicy\s*(?:number|no\.?)[:\s]*[A-Z0-9-]{4,}\b/i.test(haystack);
  const hasPolicyDocumentTitle = /\b(policy declaration|policy declarations|renewal terms|certificate of insurance|commercial general liability|directors?[& ]+officers?|management liability|d&o)\b/i.test(haystack);
  const hasInsurerOrBroker = /\b(insurer|insurance company|underwritten by|broker|brownridge|intact|markel|lloyd'?s)\b/i.test(haystack);
  const hasCoverageTerms = /\b(commercial general liability|tenant'?s legal liability|non-owned auto|policy limit|premium|deductible|retention|additional insured|claims-made|coverage summary)\b/i.test(haystack);
  return hasPolicyNumber || (hasPolicyDocumentTitle && hasInsurerOrBroker) || (hasInsurerOrBroker && hasCoverageTerms && /\b(insurance|liability|policy)\b/i.test(haystack));
}

function insuranceSeriesKeyFromText(text: string, policyNumber: string | undefined, isDno: boolean, isCgl: boolean) {
  const insurer = text.match(/\b(?:insurer|insurance company|underwritten by)[:\s-]+([A-Z][A-Za-z& .'-]{2,80})/i)?.[1];
  const broker = text.match(/\b(?:broker|agent|producer)[:\s-]+([A-Z][A-Za-z& .'-]{2,80})/i)?.[1];
  return [isCgl ? "cgl" : isDno ? "dno" : "insurance", insurer, broker, isCgl ? policyNumber : isDno ? "management-liability" : policyNumber]
    .map((value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean)
    .join("|") || undefined;
}

function insuranceRequirementsFromText(text: string, sourceExternalId: string, coverageCents?: number) {
  const requirements: any[] = [];
  if (/\b(certificate of insurance|additional insured|room booking|space booking|facility|tenant'?s legal liability|vendor|exhibitor|alcohol|liquor|special occasion permit)\b/i.test(text)) {
    requirements.push({
      context: /\b(room booking|space booking|facility)\b/i.test(text) ? "Facility or room booking" : /\bvendor|exhibitor\b/i.test(text) ? "Vendor or exhibitor requirement" : "Insurance requirement",
      requirementType: /\balcohol|liquor|special occasion permit\b/i.test(text) ? "alcohol_event" : /\bvendor|exhibitor\b/i.test(text) ? "vendor" : "event_or_facility",
      coverageSource: "Needs review",
      cglLimitRequiredCents: coverageCents,
      additionalInsuredRequired: /\badditional insured\b/i.test(text) ? true : undefined,
      coiStatus: /\bcertificate of insurance\b/i.test(text) ? "Referenced" : "Needs review",
      tenantLegalLiabilityLimitCents: moneyNear(text, /\btenant'?s legal liability\b/i),
      hostLiquorLiability: /\balcohol|liquor|special occasion permit\b/i.test(text) ? "Needs review" : undefined,
      vendorCoiRequired: /\bvendor|exhibitor\b/i.test(text) ? true : undefined,
      studentEventChecklistRequired: /\bstudent event checklist\b/i.test(text) ? true : undefined,
      riskTriggers: [
        /\balcohol|liquor|special occasion permit\b/i.test(text) ? "alcohol" : undefined,
        /\bvendor|exhibitor\b/i.test(text) ? "vendor" : undefined,
        /\bfood|catering\b/i.test(text) ? "food" : undefined,
        /\bfee|admission|donation\b/i.test(text) ? "fees_or_donations" : undefined,
      ].filter(Boolean),
      sourceExternalIds: [sourceExternalId],
      notes: "OCR-derived requirement cue. Confirm against booking, lease, or vendor source before approval.",
    });
  }
  return requirements;
}

function complianceChecksFromInsuranceText(text: string, sourceExternalId: string, renewalDate?: string) {
  const checks: any[] = [];
  if (/\bworksafe|worker|employee|staff|payroll\b/i.test(text)) {
    checks.push({
      label: "Confirm WorkSafeBC coverage or exemption",
      status: "Needs review",
      dueDate: renewalDate,
      sourceExternalIds: [sourceExternalId],
      notes: "Created because the insurance source mentions workers, employees, staff, or payroll.",
    });
  }
  if (/\bannual review|board review|renewal|risk assessment\b/i.test(text)) {
    checks.push({
      label: "Board insurance review before renewal",
      status: "Needs review",
      dueDate: renewalDate,
      sourceExternalIds: [sourceExternalId],
      notes: "Confirm current operations, certificates, claims, declined coverages, and renewal recommendation.",
    });
  }
  return checks;
}

function insuranceCoveredParties(text: string, sourceExternalId: string) {
  const parties: any[] = [];
  if (/\bdirector|d&o|officer\b/i.test(text)) {
    parties.push({
      name: "Board of directors and officers",
      partyType: "covered class",
      coveredClass: "directors_officers",
      sourceExternalIds: [sourceExternalId],
      notes: "Inferred from D&O/management liability source text; verify named insured wording.",
    });
  }
  if (/\bvolunteer worker|volunteers?\b/i.test(text)) {
    parties.push({
      name: "Volunteer workers",
      partyType: "covered class",
      coveredClass: "volunteers",
      sourceExternalIds: [sourceExternalId],
      notes: "Inferred from insurance wording; verify source definition before use.",
    });
  }
  return parties;
}

function transposedFinancialStatement(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(income statement|balance sheet|financial report|financial statement|trial balance)\b/i.test(text)) return null;
  const revenueCents = moneyNear(text, /\b(revenue|income|student fees?|sales)\b/i);
  const expensesCents = moneyNear(text, /\b(expenses?|expenditures?|printing|honou?rarium)\b/i);
  const netAssetsCents = moneyNear(text, /\b(net assets?|balance|equity|ending balance)\b/i);
  if (revenueCents == null && expensesCents == null && netAssetsCents == null) return null;
  const periodEnd = dateNear(text, /\b(period end|year end|as at|for the year ended)\b/i) ?? inferredPaperlessDate(doc);
  return {
    title,
    fiscalYear: fiscalYearLabel(periodEnd),
    periodEnd,
    revenueCents: revenueCents ?? 0,
    expensesCents: expensesCents ?? 0,
    netAssetsCents: netAssetsCents ?? 0,
    auditStatus: "NeedsReview",
    notes: "Restricted financial statement totals were OCR-derived. Verify amounts against the source before approving.",
    confidence: "Review",
    sensitivity: "restricted",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedFinancialStatementImport(doc: any) {
  const statement = transposedFinancialStatement(doc);
  if (!statement) return null;
  return {
    ...statement,
    statementType: /\btrial balance\b/i.test(paperlessText(doc))
      ? "trial_balance"
      : /\bbalance sheet\b/i.test(paperlessText(doc))
      ? "balance_sheet"
      : /\bincome statement\b/i.test(paperlessText(doc))
      ? "income_statement"
      : "full_statement",
    status: "NeedsReview",
    lines: financialLinesFromText(paperlessText(doc)),
  };
}

function transposedGrant(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(grant|funding|proposal|subsidy|canada summer jobs|club funding)\b/i.test(text)) return null;
  return {
    title,
    funder: text.match(/\b(?:funder|funding from|grantor|sponsor)[:\s-]+([A-Z][A-Za-z& .'-]{2,80})/i)?.[1] ?? (/\bcanada summer jobs\b/i.test(text) ? "Canada Summer Jobs" : "Needs review"),
    program: text.match(/\b(?:program|grant program|funding program)[:\s-]+([A-Z][A-Za-z& .'-]{2,80})/i)?.[1],
    status: /\bsubmitted|proposal\b/i.test(text) ? "Submitted" : "Drafting",
    amountRequestedCents: moneyNear(text, /\b(request|requested|budget|amount)\b/i),
    restrictedPurpose: safeRestrictedNote(doc, "Grant/funding candidate transposed from Paperless."),
    submittedAtISO: dateNear(text, /\b(submitted|proposal|application)\b/i),
    notes: safeRestrictedNote(doc, "Review funding source before creating public grant details."),
    confidence: "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedRecordsLocation(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(records location|key control|archives?|archival agreement|records office|inspection|custody|accession)\b/i.test(text)) return null;
  return {
    title,
    address: text.match(/\b\d{3,5}\s+[A-Z][A-Za-z0-9 .-]+(?:Street|St|Avenue|Ave|Way|Road|Rd|Drive|Dr)[^.\n,]*/i)?.[0],
    noticePostedAtOffice: /\bnotice\b.{0,60}\b(office|posted)\b/i.test(text),
    computerProvidedForInspection: /\bcomputer\b.{0,80}\binspection\b/i.test(text),
    notes: safeRestrictedNote(doc, "Records custody/location candidate transposed from Paperless. Archive holdings may need a separate custody/accession model."),
    confidence: "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedArchiveAccession(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(archival agreement|archives?|accession|fonds|collection|records custody|custodian|box|binder|storage location)\b/i.test(text)) return null;
  return {
    title,
    accessionNumber: text.match(/\b(?:accession|fonds|collection)\s*(?:no\.?|number|#)?[:\s-]*([A-Z0-9-]{3,})/i)?.[1],
    containerType: /\bbox\b/i.test(text) ? "box" : /\bbinder\b/i.test(text) ? "binder" : /\bdrive|disk\b/i.test(text) ? "drive" : "other",
    location: text.match(/\b(?:location|stored at|custodian)[:\s]+([^.\n]{6,90})/i)?.[1] ?? "Needs review",
    custodian: text.match(/\b(?:custodian|archive contact)[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})/i)?.[1],
    dateReceived: dateNear(text, /\b(received|transferred|accession|archival agreement)\b/i) ?? inferredPaperlessDate(doc),
    dateRange: text.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/)?.[0],
    status: "NeedsReview",
    accessRestrictions: isSensitivePaperlessDocument(doc) ? "Restricted source; verify access before exposing content." : undefined,
    notes: safeRestrictedNote(doc, "Archive custody/accession candidate transposed from Paperless metadata."),
    confidence: "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedBoardRoleAssignment(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(board|director|officer|president|vice[- ]president|secretary|treasurer|chair)\b/i.test(text)) return null;
  if (!/\b(elected|appointed|resigned|removed|directors?|officers?|board)\b/i.test(text)) return null;
  const personName = firstMatchedPerson(text, /\b(?:director|officer|president|treasurer|secretary|chair|appointed|elected)[:\s-]+/i);
  const roleTitle = text.match(/\b(President|Vice[- ]President|Treasurer|Secretary|Chair|Director)\b/i)?.[1];
  return {
    title,
    personName,
    roleTitle: roleTitle ?? "Needs review",
    roleGroup: /\bexecutive\b/i.test(text) ? "Executive board" : "Board",
    roleType: /\bdirector|president|treasurer|secretary|chair\b/i.test(text) ? "director" : "observed",
    startDate: dateNear(text, /\b(elected|appointed|term|effective|director)\b/i) ?? inferredPaperlessDate(doc),
    status: "Observed",
    notes: safeRestrictedNote(doc, "Board/director role candidate. Verify before promoting to the legal director register."),
    confidence: personName && roleTitle ? "Medium" : "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedBoardRoleChange(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(resign(?:ed|ation)?|removed|appointed|elected|change of directors|vacancy|role changed|position changed)\b/i.test(text)) return null;
  const personName = firstMatchedPerson(text, /\b(?:appointed|elected|resigned|removed|director)[:\s-]+/i);
  return {
    title,
    effectiveDate: dateNear(text, /\b(resign(?:ed|ation)?|removed|appointed|elected|effective|change)\b/i) ?? inferredPaperlessDate(doc),
    changeType: /\bresign/i.test(text) ? "resigned" : /\bremove/i.test(text) ? "removed" : /\belect/i.test(text) ? "elected" : /\bappoint/i.test(text) ? "appointed" : "needs_review",
    roleTitle: text.match(/\b(President|Vice[- ]President|Treasurer|Secretary|Chair|Director)\b/i)?.[1] ?? "Needs review",
    personName,
    status: "NeedsReview",
    notes: safeRestrictedNote(doc, "Board role change candidate. Link to the source motion/minutes before relying on it."),
    confidence: personName ? "Medium" : "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedSigningAuthority(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(signing authorit(?:y|ies)|authorized sign(?:er|atory)|bank sign(?:er|ing)|online banking|cheque sign(?:er|ing))\b/i.test(text)) return null;
  return {
    title,
    personName: firstMatchedPerson(text, /\b(?:signer|signatory|authorized|authority)[:\s-]+/i),
    roleTitle: text.match(/\b(President|Vice[- ]President|Treasurer|Secretary|Chair|Director)\b/i)?.[1],
    institutionName: text.match(/\b(TD|BMO|RBC|Scotiabank|CIBC|Credit Union|Integris)\b/i)?.[1],
    accountLabel: text.match(/\b(?:account|acct)[:\s#-]+([A-Z0-9 -]{4,40})/i)?.[1],
    authorityType: /\bonline banking\b/i.test(text) ? "online-banking" : "signing",
    effectiveDate: dateNear(text, /\b(effective|authorized|approved|signing)\b/i) ?? inferredPaperlessDate(doc),
    status: "NeedsReview",
    notes: "Restricted signing-authority candidate. Verify against board motion and bank paperwork before use.",
    confidence: "Review",
    sensitivity: "restricted",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedMeetingAttendance(doc: any) {
  const text = paperlessText(doc);
  if (!/\b(meeting minutes?|board minutes?|agm|annual general|attendees?|present|regrets|absent|quorum)\b/i.test(text)) return [];
  const title = paperlessDocumentTitle(doc);
  const meetingDate = dateNear(text, /\b(date|meeting|held)\b/i) ?? inferredPaperlessDate(doc);
  const names = namesNear(text, /\b(present|attendees?|attendance)\b/i).slice(0, 12);
  return names.map((personName) => ({
    title,
    meetingTitle: title,
    meetingDate,
    personName,
    attendanceStatus: "present",
    quorumCounted: true,
    notes: safeRestrictedNote(doc, "Attendance candidate extracted from meeting-minute OCR."),
    confidence: "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  }));
}

function transposedMotionEvidence(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(motion|moved by|seconded by|carried|defeated|tabled)\b/i.test(text)) return null;
  const motionText = text.match(/\bMotion[:\s-]+([^.\n]{12,260})/i)?.[1] ?? text.match(/\bthat\s+([^.\n]{12,260})/i)?.[1];
  return {
    title,
    meetingTitle: title,
    meetingDate: dateNear(text, /\b(date|meeting|held|motion)\b/i) ?? inferredPaperlessDate(doc),
    motionText,
    movedBy: text.match(/\bmoved by[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i)?.[1],
    secondedBy: text.match(/\bseconded by[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i)?.[1],
    outcome: /\bdefeated\b/i.test(text) ? "Defeated" : /\btabled\b/i.test(text) ? "Tabled" : /\bcarried|approved\b/i.test(text) ? "Carried" : "NeedsReview",
    evidenceText: isSensitivePaperlessDocument(doc) ? undefined : motionText,
    status: "Extracted",
    notes: safeRestrictedNote(doc, "Motion evidence candidate extracted from Paperless OCR."),
    confidence: motionText ? "Medium" : "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedBudgetSnapshot(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(budget|forecast|variance|projected income|projected expense|status quo)\b/i.test(text)) return null;
  if (/\b(invoice|receipt|bank statement|payroll|tax return)\b/i.test(title)) return null;
  const sourceDate = inferredPaperlessDate(doc);
  return {
    title,
    fiscalYear: fiscalYearLabel(sourceDate),
    sourceDate,
    currency: "CAD",
    status: "NeedsReview",
    notes: "Budget snapshot candidate. Totals are intentionally left blank because broad OCR amount extraction can confuse line items, balances, dates, and true totals. Review source pages before entering official figures.",
    confidence: "Review",
    sensitivity: "restricted",
    lines: financialLinesFromText(text).slice(0, 12),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedTreasurerReport(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(treasurer report|finance report|financial update|budget report)\b/i.test(text)) return null;
  const reportDate = dateNear(text, /\b(treasurer report|finance report|date|submitted)\b/i) ?? inferredPaperlessDate(doc);
  return {
    title,
    fiscalYear: fiscalYearLabel(reportDate),
    reportDate,
    authorName: firstMatchedPerson(text, /\b(?:treasurer|submitted by|prepared by)[:\s-]+/i),
    cashBalanceCents: moneyNear(text, /\b(cash balance|bank balance|ending balance)\b/i),
    highlights: ["Transposed from Paperless OCR; review the source report before relying on this summary."],
    concerns: /\b(deficit|shortfall|over budget|past due)\b/i.test(text) ? ["Possible concern keyword found in OCR."] : [],
    status: "NeedsReview",
    notes: "Restricted treasurer-report candidate.",
    confidence: "Review",
    sensitivity: "restricted",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedTransactionCandidate(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(invoice|receipt|bank statement|cheque|deposit|withdrawal|payment|transaction|visa|mastercard|etransfer|e-transfer)\b/i.test(text)) return null;
  return {
    title,
    transactionDate: dateNear(text, /\b(date|invoice|receipt|payment|deposit|transaction)\b/i) ?? inferredPaperlessDate(doc),
    description: title,
    accountName: text.match(/\b(TD|BMO|RBC|Scotiabank|CIBC|Credit Union|Visa|Mastercard)\b/i)?.[1],
    counterparty: text.match(/\b(?:from|to|vendor|payee|received from)[:\s]+([^.\n]{3,80})/i)?.[1],
    status: "NeedsReview",
    sensitivity: "restricted",
    confidence: "Review",
    notes: "Restricted transaction candidate. Amount is intentionally left blank because broad OCR amount extraction can confuse line items, dates, totals, and statement balances. Reconcile only after finance review.",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedPipaTraining(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(pipa|privacy training|casl training|privacy refresh)\b/i.test(text)) return null;
  if (!/\b(completed|training|attended)\b/i.test(text)) return null;
  return {
    title,
    participantName: text.match(/\b(?:participant|name)[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i)?.[1] ?? "Needs review",
    role: /\bvolunteer\b/i.test(text) ? "Volunteer" : /\bdirector|board\b/i.test(text) ? "Director" : "Staff",
    topic: /\bcasl\b/i.test(text) ? "CASL" : "PIPA",
    completedAtISO: dateNear(text, /\b(completed|training|attended)\b/i) ?? inferredPaperlessDate(doc),
    notes: "Restricted privacy training candidate. Verify participant, role, topic, and completion date before approving.",
    confidence: "Review",
    sensitivity: "restricted",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedEmployee(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(employee|employment contract|editor-in-chief contract|section editor|staff contract|worksafe|roe|payroll|td1|t4)\b/i.test(text)) return null;
  if (/\b(payroll|td1|t4|roe|source deductions?|sin)\b/i.test(text)) return null;
  return {
    title,
    name: text.match(/\b(?:employee|contractor|name)[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i)?.[1],
    role: text.match(/\b(Editor[- ]in[- ]Chief|Production Coordinator|Managing Editor|News Editor|Copy Editor|Section Editor)\b/i)?.[1] ?? "Needs review",
    startDate: dateNear(text, /\b(start|term|effective|commencing)\b/i) ?? inferredPaperlessDate(doc),
    employmentType: "Contractor",
    notes: "Restricted HR candidate. Import only after reviewing the contract/source and confirming compensation privacy handling.",
    confidence: "Review",
    sensitivity: "restricted",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function transposedVolunteer(doc: any) {
  const text = paperlessText(doc);
  const title = paperlessDocumentTitle(doc);
  if (!/\b(volunteer|orientation|screening|criminal record|board application|application for.*board)\b/i.test(text)) return null;
  if (/\b(criminal record|screening result|reference check)\b/i.test(text)) return null;
  return {
    title,
    name: text.match(/\b(?:applicant|name)[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i)?.[1],
    status: "Applied",
    roleWanted: /\bboard\b/i.test(text) ? "Board volunteer" : /\bwriter|contributor\b/i.test(text) ? "Contributor" : "Needs review",
    interests: [],
    screeningRequired: /\bscreening|criminal record\b/i.test(text),
    applicationReceivedAtISO: dateNear(text, /\b(application|received|submitted)\b/i) ?? inferredPaperlessDate(doc),
    intakeSource: "paperless",
    notes: safeRestrictedNote(doc, "Volunteer/intake candidate. Hold personal applications until privacy review."),
    confidence: "Review",
    sensitivity: isSensitivePaperlessDocument(doc) ? "restricted" : "standard",
    sourceDate: inferredPaperlessDate(doc),
    sourceExternalIds: [`paperless:${doc.id}`],
  };
}

function paperlessText(doc: any) {
  return cleanOcrText([
    paperlessDocumentTitle(doc),
    paperlessFileName(doc),
    Array.isArray(doc.tags) ? doc.tags.join(" ") : "",
    doc.content,
  ].filter(Boolean).join("\n"));
}

function inferredPaperlessDate(doc: any) {
  const title = `${paperlessDocumentTitle(doc)} ${paperlessFileName(doc) ?? ""}`;
  const compact = title.match(/\b((?:19|20)\d{2})([01]\d)([0-3]\d)\b/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = title.match(/\b((?:19|20)\d{2})[-_ .]([01]?\d)[-_ .]([0-3]?\d)\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const yearless = title.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i);
  if (yearless) {
    const year = inferYearFromText(title) ?? Number(documentDate(doc)?.slice(0, 4));
    const month = monthNumber(yearless[1]);
    const day = Number(yearless[2]);
    if (year && month && day) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const created = documentDate(doc);
  if (created && !/^(1920|1970|1976)-/.test(created)) return created;
  const year = title.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? `${year}-01-01` : new Date().toISOString().slice(0, 10);
}

function fiscalYearLabel(date: string | undefined) {
  const value = String(date ?? "");
  const year = value.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ?? new Date().toISOString().slice(0, 4);
}

function safeTranspositionSnippet(doc: any) {
  const content = cleanOcrText(doc.content);
  if (!content) return `Paperless source ${doc.id}. Review original source before publishing.`;
  return content.slice(0, 360);
}

function safeRestrictedNote(doc: any, standardNote: string) {
  if (isSensitivePaperlessDocument(doc)) {
    return `${standardNote} Restricted source; OCR text is withheld from this review row.`;
  }
  return standardNote;
}

function isSensitivePaperlessDocument(doc: any) {
  return /\b(bank|payroll|tax|t4|td1|roe|sin|insurance|policy number|employee|employment|contract|resume|cv|criminal record|screening|privacy|pipa|confidential|consent|member id|student number|direct deposit|signing authority)\b/i.test(paperlessText(doc));
}

function dateNear(text: string, anchor: RegExp) {
  const cleaned = cleanOcrText(text);
  const anchorMatch = cleaned.match(anchor);
  const windowText = anchorMatch?.index != null
    ? cleaned.slice(Math.max(0, anchorMatch.index - 80), anchorMatch.index + 220)
    : cleaned.slice(0, 360);
  const iso = windowText.match(/\b((?:19|20)\d{2})[-/ ]([01]?\d)[-/ ]([0-3]?\d)\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const month = windowText.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+([0-3]?\d),?\s+((?:19|20)\d{2})\b/i);
  if (month) return `${month[3]}-${monthNumberPadded(month[1])}-${month[2].padStart(2, "0")}`;
  return undefined;
}

function monthNumberPadded(value: string) {
  const key = value.slice(0, 3).toLowerCase();
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key);
  return String(Math.max(0, index) + 1).padStart(2, "0");
}

function moneyNear(text: string, anchor: RegExp) {
  const cleaned = cleanOcrText(text);
  const anchorMatch = cleaned.match(anchor);
  const windowText = anchorMatch?.index != null
    ? cleaned.slice(Math.max(0, anchorMatch.index - 80), anchorMatch.index + 260)
    : cleaned;
  const match = windowText.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/);
  if (!match) return undefined;
  const dollars = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : undefined;
}

function formatMoneyFromCents(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

function financialLinesFromText(text: string) {
  return cleanOcrText(text)
    .split(/\n| {2,}/)
    .map((line) => line.trim())
    .filter((line) => /\$?\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})/.test(line))
    .slice(0, 20)
    .map((line) => {
      const amount = line.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/)?.[1];
      const label = line.replace(/\$?\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}).*$/, "").trim();
      const amountCents = amount ? Math.round(Number(amount.replace(/,/g, "")) * 100) : undefined;
      return {
        section: /\bincome|revenue|sales|student fees?\b/i.test(line) ? "income" : /\bexpense|printing|honou?rarium|payroll|rent\b/i.test(line) ? "expense" : "unclassified",
        lineType: /\bincome|revenue|sales|student fees?\b/i.test(line) ? "income" : /\bexpense|printing|honou?rarium|payroll|rent\b/i.test(line) ? "expense" : "note",
        category: label || "Imported line",
        label: label || "Imported line",
        amountCents,
        confidence: "Review",
      };
    });
}

function firstMatchedPerson(text: string, anchor: RegExp) {
  const cleaned = cleanOcrText(text);
  const anchorMatch = cleaned.match(anchor);
  const windowText = anchorMatch?.index != null
    ? cleaned.slice(anchorMatch.index, anchorMatch.index + 180)
    : cleaned.slice(0, 240);
  return windowText.match(/\b([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})\b/)?.[1];
}

function namesNear(text: string, anchor: RegExp) {
  const cleaned = cleanOcrText(text);
  const anchorMatch = cleaned.match(anchor);
  const windowText = anchorMatch?.index != null
    ? cleaned.slice(anchorMatch.index, anchorMatch.index + 420)
    : cleaned.slice(0, 420);
  const matches = windowText.match(/\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3}\b/g) ?? [];
  return unique(matches.filter((name) => !isLikelyNonPersonNameMatch(name)));
}

function isLikelyNonPersonNameMatch(name: string) {
  return /\b(Meeting Minutes|Board Meeting|Annual General|Special General)\b/i.test(name);
}

function addOneYear(date: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
}

const DISCOVERY_RULES = [
  {
    section: "filings",
    sensitivity: "restricted",
    keywords: /\b(society act|registrar|bc companies|certificate|incorporation|annual report|form\s*10|change of directors|registered office|copy of resolution|special resolution)\b/i,
  },
  {
    section: "orgHistory",
    sensitivity: "standard",
    keywords: /\b(history|archive|fonds|collection|incorporated|purposes|constitution|bylaws?|by-laws?|amendments?|mission statement|terms of reference)\b/i,
  },
  {
    section: "directors",
    sensitivity: "standard",
    keywords: /\b(directors?|board|chair|vice-chair|treasurer|secretary|officers?|signing authority|editorial board|committee)\b/i,
  },
  {
    section: "meetings",
    sensitivity: "standard",
    keywords: /\b(meeting minutes?|board minutes?|bod minutes?|agenda|agm|annual general|special general|quorum|motion|seconded|carried|approved unanimously)\b/i,
  },
  {
    section: "financials",
    sensitivity: "restricted",
    keywords: /\b(budget|financial|statement|bank|treasurer|accounting|bookkeep|audit|invoice|receipt|gst|tax|reconciliation|payroll|honou?rarium|commission|student fees?|levy)\b/i,
  },
  {
    section: "grants",
    sensitivity: "restricted",
    keywords: /\b(grant|subsidy|funding|application|reporting|canada summer jobs)\b/i,
  },
  {
    section: "communications",
    sensitivity: "standard",
    keywords: /\b(poster|notice|email|newsletter|blackboard|website|redesign|social media)\b/i,
  },
  {
    section: "policies",
    sensitivity: "standard",
    keywords: /\b(policy|policies|code of conduct|conflict of interest|privacy policy|document policy|ad sales policy|hiring policy|job description)\b/i,
  },
  {
    section: "privacy",
    sensitivity: "restricted",
    keywords: /\b(pipa|privacy|personal information|consent|foi|confidential|nondisclosure|non-disclosure)\b/i,
  },
  {
    section: "insurance",
    sensitivity: "restricted",
    keywords: /\b(insurance|liability|policy number|certificate of insurance|coverage|premium)\b/i,
  },
  {
    section: "employees",
    sensitivity: "restricted",
    keywords: /\b(employee|employment|contract|editor-in-chief contract|section editor|staff|resume|cv|cover letter|job application|performance review)\b/i,
  },
  {
    section: "volunteers",
    sensitivity: "restricted",
    keywords: /\b(volunteer|screening|orientation|training|reference check|criminal record|application)\b/i,
  },
  {
    section: "deadlines",
    sensitivity: "standard",
    keywords: /\b(deadline|due date|renewal|expiry|expires|filing deadline|notice period)\b/i,
  },
  {
    section: "documents",
    sensitivity: "standard",
    keywords: /\b(source|record|document|manual|template|form|spreadsheet|pdf)\b/i,
  },
] as const;

function discoveryCandidateFromPaperlessDocument(doc: any) {
  const title = paperlessDocumentTitle(doc);
  const fileName = paperlessFileName(doc);
  const created = documentDate(doc);
  const content = String(doc.content ?? "");
  const haystack = `${title}\n${fileName ?? ""}\n${content}`;
  const matches = DISCOVERY_RULES
    .map((rule) => ({
      ...rule,
      evidence: evidenceForRule(haystack, rule.keywords),
    }))
    .filter((match) => match.evidence.length > 0);
  if (matches.length === 0) return null;

  const sections = unique(matches.map((match) => match.section));
  const restricted = matches.some((match) => match.sensitivity === "restricted");
  const evidence = matches.flatMap((match) => match.evidence.map((value) => `${match.section}: ${value}`));
  const score = evidence.length + sections.length;
  const confidence = score >= 6 ? "High" : score >= 3 ? "Medium" : "Review";
  const restrictedReason = restricted
    ? "Restricted document. Review the original Paperless source with appropriate access before importing OCR content."
    : "";
  return {
    id: doc.id,
    externalId: `paperless:${doc.id}`,
    title,
    created,
    fileName,
    sections,
    candidateSections: sections,
    confidence,
    sensitivity: restricted ? "restricted" : "standard",
    tags: unique([
      `paperless:${doc.id}`,
      restricted ? "restricted" : "standard",
      ...sections,
      ...(doc.tags ?? []).map((tag: unknown) => `paperless-tag:${tag}`),
    ]),
    why: restricted ? sectionReasons(matches) : evidence.slice(0, 10),
    snippet: restricted ? restrictedReason : discoverySnippet(content, matches.map((match) => match.keywords)),
    sourceExternalIds: [`paperless:${doc.id}`],
    url: paperlessDocumentUrl(doc.id),
  };
}

function sectionReasons(matches: any[]) {
  return unique(matches.map((match) => `${match.section}: keyword match`)).slice(0, 10);
}

function discoverySourceNotes(candidate: any) {
  if (candidate.sensitivity === "restricted") {
    return "Restricted Paperless candidate. Metadata was staged, but OCR evidence is withheld from the import review table until redaction/access controls are confirmed.";
  }
  return candidate.snippet || candidate.why?.join?.("; ");
}

function evidenceForRule(text: string, keywords: RegExp) {
  const out: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanOcrText(line))
    .filter(Boolean);
  for (const line of lines) {
    if (!keywords.test(line)) continue;
    out.push(line.slice(0, 180));
    if (out.length >= 3) break;
  }
  return out;
}

function discoverySnippet(content: string, rules: RegExp[]) {
  const cleaned = cleanOcrText(content);
  if (!cleaned) return "";
  const index = rules
    .map((rule) => {
      const match = cleaned.match(rule);
      return match?.index ?? -1;
    })
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  return cleaned.slice(Math.max(0, index - 120), index + 420).trim();
}

function summarizeDiscoveryCandidates(candidates: any[]) {
  const bySection: Record<string, number> = {};
  const bySensitivity: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const section of candidate.sections ?? []) bySection[section] = (bySection[section] ?? 0) + 1;
    bySensitivity[candidate.sensitivity] = (bySensitivity[candidate.sensitivity] ?? 0) + 1;
    byConfidence[candidate.confidence] = (byConfidence[candidate.confidence] ?? 0) + 1;
  }
  return { bySection, bySensitivity, byConfidence };
}

function discoverySortKey(candidate: any) {
  const restricted = candidate.sensitivity === "restricted" ? "1" : "0";
  const confidence = candidate.confidence === "High" ? "0" : candidate.confidence === "Medium" ? "1" : "2";
  return [restricted, confidence, candidate.sections?.[0] ?? "", candidate.created ?? "", candidate.title ?? ""].join("::");
}

function isLikelyMeetingMinutesDocument(doc: any) {
  const title = [doc.title, doc.original_file_name, doc.original_filename, doc.archived_file_name, doc.archive_filename]
    .filter(Boolean)
    .join(" ");
  const content = String(doc.content ?? "");
  const strongTitle = /\b(meeting minutes?|board meeting minutes?|board minutes?|bod minutes?|board of directors meeting minutes|minutes of\b|motions for meeting)\b/i.test(title);
  if (/(resumes?|staff hours?|timesheets?|curriculum vitae|cover letters?|job applications?|society act|constitution|bylaws?|policy manual|poster|finance report|bankruptcy|contracts?|newspaper|volume|issue|faculty association)/i.test(title) && !strongTitle) {
    return false;
  }
  if (strongTitle) return true;
  const lead = content.slice(0, 1500);
  return sectionLooksLikeMinutes(lead);
}

function meetingMinutesFromPaperlessDocument(doc: any) {
  const sourceExternalId = `paperless:${doc.id}`;
  return splitMeetingSections(doc).flatMap((section: any, index: number) => {
    const sectionText = trimMeetingSectionText(section.text);
    if (!sectionLooksLikeMinutes(sectionText)) {
      return [];
    }
    const date = meetingDateFromText(sectionText) ?? inferredPaperlessDate(doc);
    const title = meetingTitleFromSection(sectionText, doc, date, index);
    const motions = motionsFromText(sectionText).map((motion) => ({
      ...motion,
      meetingDate: motion.meetingDate ?? date,
      meetingTitle: title,
      sourceExternalIds: [sourceExternalId],
    }));
    const agendaItems = agendaFromText(sectionText);
    const attendees = attendeesFromText(sectionText);
    const absent = absentFromText(sectionText);
    if (!motions.length && !attendees.length && !absent.length && !/\b(meeting adjourned|meeting commencement|meeting begins?|meeting ends?)\b/i.test(sectionText)) {
      return [];
    }
    return [{
      meetingDate: date,
      meetingTitle: title,
      attendees,
      absent,
      quorumMet: /\bquorum\b.{0,40}\b(met|present|confirmed)\b/i.test(sectionText),
      agendaItems,
      discussion: discussionFromText(sectionText),
      motions,
      decisions: [],
      actionItems: [],
      sourceExternalIds: [sourceExternalId],
      sourceDocumentTitle: paperlessDocumentTitle(doc),
      sourceDocumentId: doc.id,
      sectionIndex: index + 1,
      confidence: motions.length || agendaItems.length ? "Medium" : "Review",
      notes: `Generated from Paperless OCR page section ${index + 1}; review against source PDF before approval.`,
    }];
  });
}

function meetingAttendanceFromMinutes(minutes: any) {
  const present = (minutes.attendees ?? []).map((personName: string) => ({
    title: `${minutes.meetingTitle} attendance`,
    meetingTitle: minutes.meetingTitle,
    meetingDate: minutes.meetingDate,
    personName,
    attendanceStatus: "present",
    quorumCounted: true,
    confidence: minutes.confidence ?? "Review",
    notes: `Extracted from ${minutes.sourceDocumentTitle ?? "Paperless meeting minutes"} section ${minutes.sectionIndex ?? "unknown"}.`,
    sourceExternalIds: minutes.sourceExternalIds ?? [],
  }));
  const absent = (minutes.absent ?? []).map((personName: string) => ({
    title: `${minutes.meetingTitle} absence`,
    meetingTitle: minutes.meetingTitle,
    meetingDate: minutes.meetingDate,
    personName,
    attendanceStatus: "absent",
    quorumCounted: false,
    confidence: minutes.confidence ?? "Review",
    notes: `Extracted from ${minutes.sourceDocumentTitle ?? "Paperless meeting minutes"} section ${minutes.sectionIndex ?? "unknown"}.`,
    sourceExternalIds: minutes.sourceExternalIds ?? [],
  }));
  return [...present, ...absent];
}

function motionEvidenceFromMinutes(minutes: any) {
  return (minutes.motions ?? []).map((motion: any, index: number) => ({
    title: `${minutes.meetingTitle} motion ${index + 1}`,
    meetingTitle: minutes.meetingTitle,
    meetingDate: minutes.meetingDate,
    motionText: motion.motionText,
    movedBy: motion.movedByName,
    secondedBy: motion.secondedByName,
    outcome: motion.outcome,
    voteSummary: motion.voteSummary,
    evidenceText: motion.evidenceText ?? motion.motionText,
    pageRef: motion.pageRef,
    status: "Extracted",
    confidence: motion.confidence ?? minutes.confidence ?? "Review",
    notes: `Extracted from ${minutes.sourceDocumentTitle ?? "Paperless meeting minutes"} section ${minutes.sectionIndex ?? "unknown"}.`,
    sourceExternalIds: minutes.sourceExternalIds ?? [],
  }));
}

function sectionLooksLikeMinutes(text: string) {
  const lead = text.slice(0, 1200);
  if (/\b(meeting minutes?|board meeting minutes?|board minutes?|bod minutes?|motions for meeting)\b/i.test(lead)) {
    return true;
  }
  return hasMeetingMinutesEvidence(text) &&
    /\b(attendees?|present|voting members in attendance|absent|regrets|motions?:|meeting adjourned|meeting commencement|meeting begins?|time:|location:)\b/i.test(lead);
}

function hasMeetingMinutesEvidence(text: string) {
  const score = meetingEvidenceScore(text);
  return score >= 3 && /\b(meeting|minutes|board|directors?|bod)\b/i.test(text);
}

function meetingEvidenceScore(text: string) {
  const evidence = [
    /\b(meeting minutes?|board minutes?|bod minutes?|minutes|meeting commencement|meeting adjourned)\b/i,
    /\b(attendees?|present|voting members in attendance|absent|regrets)\b/i,
    /\b(motions?|moved by|seconded by|birt|bifrt|resolved that)\b/i,
    /\b(quorum|approved unanimously|carried|defeated|tabled)\b/i,
    /\b(board|directors?|bod|editorial board)\b/i,
  ];
  return evidence.reduce((score, regex) => score + (regex.test(text) ? 1 : 0), 0);
}

function splitMeetingSections(doc: any) {
  const content = String(doc.content ?? "").trim();
  if (!content) return [{ text: paperlessDocumentTitle(doc) }];
  const matches = [
    ...meetingDateMatches(content),
    ...meetingYearlessDateMatches(content),
    ...meetingHeadingMatches(content),
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const distinct = matches.filter((match, index) => {
    const previous = matches[index - 1];
    return !previous || Math.abs((match.index ?? 0) - (previous.index ?? 0)) > 120;
  });
  if (distinct.length <= 1) return [{ text: content }];
  return distinct.map((match, index) => {
    const start = match.index ?? 0;
    const end = distinct[index + 1]?.index ?? content.length;
    return { text: trimMeetingSectionText(content.slice(start, end).trim()) };
  }).filter((section) => section.text.length > 80);
}

function motionsFromText(text: string) {
  const markers = /(?:^|\n|\b)\s*(Motion\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+)|Motion\s+to|Motion:|Resolved that|Be it resolved that|Upon motion|It was moved)[:\s-]*|(?:^|\n|\b)(BIRT|BIFRT)\b[:\s-]*/gi;
  const matches = [...text.matchAll(markers)].filter((match) => match.index != null);
  if (matches.length === 0) return [];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const label = match[1] ?? match[2] ?? "Motion";
    const rawText = cleanOcrText(`${label} ${text.slice(start, end)}`).slice(0, 1600);
    const motionText = cleanMotionText(rawText).slice(0, 1200);
    return {
      meetingDate: meetingDateFromText(text),
      meetingTitle: undefined,
      motionText,
      outcome: outcomeFromText(motionText),
      movedByName: personAfter(motionText, /moved by\s+([^.;\n]+)/i),
      secondedByName: personAfter(motionText, /seconded by\s+([^.;\n]+)/i),
      voteSummary: voteSummaryFromText(motionText),
      evidenceText: rawText,
      category: "Governance",
      notes: "Parsed from Paperless OCR.",
    };
  }).filter((motion) => motion.motionText.length > 12);
}

function cleanMotionText(value: string) {
  const voteBoundary = value.match(/^(.*?\b(?:Vote:\s*)?(?:Unanimous approved|approved unanimously|approvedunanimously|carried|passed|defeated|tabled)\b)(?:\s+\d+[\).]\s+.+)$/i);
  if (voteBoundary) return cleanOcrText(voteBoundary[1]);
  const sectionBoundary = value.match(/^(.*?)(?:\bFurther Business\b|\bMeeting adjourned\b|\bWebsite Redesign\b)/i);
  return cleanOcrText(sectionBoundary?.[1] ?? value);
}

function voteSummaryFromText(text: string) {
  const vote = text.match(/\bVote[:\s-]+([^.;]{3,120})/i)?.[1];
  if (vote) return cleanOcrText(vote);
  if (/\bapproved\s*unanimously|unanimous approved|approvedunanimously|carried unanimously\b/i.test(text)) return "Unanimous approval";
  return undefined;
}

function meetingDateMatches(content: string) {
  return [...content.matchAll(meetingDateRegex())].filter((match) => {
    if (match.index == null) return false;
    const context = content.slice(Math.max(0, match.index - 140), Math.min(content.length, match.index + 220));
    return /\b(meeting minutes?|board meeting minutes?|bod minutes?|motions for meeting|attendees?|present|voting members in attendance|agenda|quorum|moved|seconded|carried)\b/i.test(context);
  });
}

function meetingYearlessDateMatches(content: string) {
  const matches: Array<{ index: number }> = [];
  const regex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*(?:st|nd|rd|th)?\D{0,50}\b(?:Board Meeting Minutes|Meeting Minutes|BOD Minutes|Motions for Meeting)\b/gi;
  for (const match of content.matchAll(regex)) {
    if (match.index == null) continue;
    const context = content.slice(Math.max(0, match.index - 160), Math.min(content.length, match.index + 260));
    if (!/\b(minutes?|meeting|board|bod|attendees?|motions?|agenda|quorum)\b/i.test(context)) continue;
    matches.push({ index: match.index });
  }
  return matches;
}

function meetingHeadingMatches(content: string) {
  const matches: Array<{ index: number }> = [];
  const heading = /(^|\n)([^\n]{0,140}\b(?:Board Meeting Minutes|Board of Directors Meeting Minutes|BOD Minutes|Meeting Minutes|Motions for Meeting of Board of Directors|Annual General Meeting|Special General Meeting)\b[^\n]{0,140})/gim;
  for (const match of content.matchAll(heading)) {
    if (match.index == null) continue;
    const line = match[2] ?? "";
    if (/\b(required to submit|submit all|contract|responsibilities|agreement)\b/i.test(line)) continue;
    matches.push({ index: match.index + match[1].length });
  }
  return matches;
}

function agendaFromText(text: string) {
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:\d+|[a-z])[\).,]\s+(.{4,160})$/i);
    if (!match) continue;
    const value = cleanOcrText(match[1]);
    if (!value || /discussion|motion/i.test(value) && value.length > 120) continue;
    items.push(value);
    if (items.length >= 20) break;
  }
  return unique(items);
}

function attendeesFromText(text: string) {
  const columns = columnAttendanceFromText(text);
  const labeled = [
    ...peopleListAfterLabel(text, /(?:Present|Attendees|Voting members in attendance|Voting Members in attendance|Non-Voting Members in attendance|Board Members Present|Editors present):/i),
    ...peopleListAfterLabel(text, /(?:Board Members Skyping|Skyping|Remote attendees?):/i),
  ];
  return columns.attendees.length ? columns.attendees : unique(labeled);
}

function absentFromText(text: string) {
  const columns = columnAttendanceFromText(text);
  return columns.absent.length
    ? columns.absent
    : peopleListAfterLabel(text, /(?:Absent|Voting Members not in attendance|Regrets|Editors absent|_~sent|~sent|Ahsent|Absen):/i);
}

function peopleListAfterLabel(text: string, labelRegex: RegExp) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelRegex.test(line)) continue;
    const sameLine = trimAttendanceInlineBlock(line.replace(labelRegex, "").trim());
    const block = sameLine || attendanceBlockAfter(lines, index + 1);
    return parsePeopleList(block);
  }
  return [];
}

function trimAttendanceInlineBlock(value: string) {
  return value
    .replace(/\b(?:Absent|Regrets|Editors absent|Voting Members not in attendance|Time|Date|Meeting Begins?|Meeting Ends?|Agenda|Motions?|Discussion|Further Business)\b[:\s\S]*$/i, "")
    .trim();
}

function attendanceBlockAfter(lines: string[], startIndex: number) {
  const out: string[] = [];
  for (const line of lines.slice(startIndex, startIndex + 8)) {
    const value = line.trim();
    if (!value) {
      if (out.length) break;
      continue;
    }
    if (/\b(Time|Date|Meeting Begins?|Meeting Ends?|Agenda|Motions?|Discussion|Further Business|Old Business|New Business)\b:?/i.test(value)) break;
    out.push(value);
  }
  return out.join(", ");
}

function parsePeopleList(value: string) {
  return unique(
    value
      .split(/,|;|\band\b| {2,}/i)
      .map(cleanPersonName)
      .filter(isPersonName),
  );
}

function columnAttendanceFromText(text: string) {
  const compact = text.match(/\bAttendees?:\s*Absent:\s*([\s\S]{0,900}?)(?:\bMotions?:|\bAgenda\b|\bFurther Business\b)/i);
  if (compact) {
    const people = [...compact[1].matchAll(/\b([A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+)\s*-\s*(?:Chair|Vice-Chair|Director)\b/gi)]
      .map((match) => cleanPersonName(match[1]));
    if (people.length >= 2) {
      return {
        attendees: unique(people.filter((_, index) => index % 2 === 0).filter(isPersonName)),
        absent: unique(people.filter((_, index) => index % 2 === 1).filter(isPersonName)),
      };
    }
  }
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /\b(Attendees?|Present)\b.*\bAbsent\b/i.test(line));
  if (headerIndex < 0) return { attendees: [], absent: [] };
  const attendees: string[] = [];
  const absent: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (/\b(Motions?|Further Business|Discussion|Agenda)\b/i.test(line)) break;
    if (!line.trim()) continue;
    const parts = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      attendees.push(cleanPersonName(parts[0]));
      absent.push(cleanPersonName(parts.slice(1).join(" ")));
    }
  }
  return {
    attendees: unique(attendees.filter(isPersonName)),
    absent: unique(absent.filter(isPersonName)),
  };
}

function cleanPersonName(value: string) {
  return cleanOcrText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*-\s*.*$/, "")
    .replace(/\b(?:news|manager|eic|sports|production|editing|web|features|arts|student life)\b/gi, " ")
    .replace(/[^A-Za-z .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPersonName(name: string) {
  return /^[A-Z][A-Za-z .'-]{1,60}$/.test(name) && !/^(Absent|Present|Attendees?|Regrets|Editors?|Board Members?|Voting Members?)$/i.test(name);
}

function trimMeetingSectionText(text: string) {
  const cut = text.slice(500).search(/\b(Editor-In-Chief Contract|Website Redesign and New Features|This Agreement is made|This contract is made)\b/i);
  if (cut < 0) return text.trim();
  return text.slice(0, 500 + cut).trim();
}

function discussionFromText(text: string) {
  const cleaned = cleanOcrText(text);
  return cleaned.length > 1800 ? `${cleaned.slice(0, 1800)}...` : cleaned;
}

function meetingTitleFromSection(text: string, doc: any, date: string | undefined, index: number) {
  const firstTitleLine = text
    .slice(0, 1000)
    .split(/\r?\n/)
    .map((line) => cleanOcrText(line))
    .find((line) =>
      /\b(meeting minutes?|board meeting minutes?|board minutes?|bod minutes?|minutes of|motions for meeting)\b/i.test(line) &&
      line.length < 120,
    );
  if (firstTitleLine) return firstTitleLine;
  const dateLabel = date ? `${date} ` : "";
  return `${dateLabel}${paperlessDocumentTitle(doc)}${index ? ` section ${index + 1}` : ""}`.trim();
}

function meetingDateFromText(text: string) {
  const headingDate = meetingDateWithoutYearFromText(text.slice(0, 600), text);
  if (headingDate) return headingDate;
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*(?:st|nd|rd|th)?\D{0,12}(\d{4})\b/i);
  if (!match) return meetingDateWithoutYearFromText(text);
  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function meetingDateWithoutYearFromText(text: string, yearContext = text) {
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*(?:st|nd|rd|th)?\D{0,40}\b(?:Meeting Minutes|Board Meeting Minutes|Minutes|Motions)\b/i);
  if (!match) return undefined;
  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = inferYearFromText(yearContext);
  if (!month || !day || !year) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferYearFromText(text: string) {
  const sample = text.slice(0, 12000);
  const range = sample.match(/\b(20\d{2})\s*[-–]\s*(20\d{2})\b/);
  if (range) return Number(range[1]);
  const counts = new Map<number, number>();
  for (const match of sample.matchAll(/\b(20\d{2})\b/g)) {
    const year = Number(match[1]);
    if (year < 2000 || year > 2035) continue;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

function meetingDateRegex() {
  return /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*(?:st|nd|rd|th)?\D{0,12}(\d{4})\b/gi;
}

function monthNumber(month: string) {
  return [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(month.toLowerCase()) + 1;
}

function outcomeFromText(text: string) {
  if (/\b(table[d]?)\b/i.test(text)) return "Tabled";
  if (/\b(defeated|failed)\b/i.test(text)) return "Defeated";
  if (/\b(carried|passed|approved unanimously|approvedunanimously|unanimous approved|agrees unanimously)\b/i.test(text)) return "Passed";
  return "NeedsReview";
}

function personAfter(text: string, regex: RegExp) {
  return cleanPersonName(cleanOcrText(text.match(regex)?.[1]).replace(/\b(approved|carried|passed|defeated|tabled)\b.*$/i, "").replace(/\band\b.*$/i, "")) || undefined;
}

function paperlessDocumentTitle(doc: any) {
  return cleanOcrText(doc.title) || paperlessFileName(doc) || `Paperless ${doc.id}`;
}

function paperlessFileName(doc: any) {
  return cleanOcrText(doc.original_file_name ?? doc.original_filename ?? doc.archived_file_name ?? doc.archive_filename);
}

function documentDate(doc: any) {
  const raw = String(doc.created ?? doc.created_date ?? doc.added ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function cleanOcrText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function paperlessIdFromExternalId(externalId: string | undefined) {
  const value = Number(String(externalId ?? "").match(/^paperless:(\d+)$/i)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function tagValue(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9:/ -]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function unique(values: Array<string | undefined | null | false>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
