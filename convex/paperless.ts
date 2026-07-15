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
import { assertNativeFileStorageEnabled } from "./providers/env";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  tagProfilesPortable,
  listConnectionPortable,
  recentSyncsPortable,
  syncForDocumentPortable,
  sourcePullContextPortable,
  authorizeMeetingImportPortable,
  getSyncPortable,
  recordConnectionTestPortable,
} from "../shared/functions/paperless";

import {
  latestVersion,
  fetchBlob,
  buildPaperlessTags,
  inferUsageTags,
  addTagsFromTable,
  normalizeTagPrefix,
  externalIdFromDocument,
  transposedBundleFromPaperlessDocuments,
  bylawsHistoryBundleFromPaperlessDocuments,
  bylawsHistoryCandidateFromPaperlessDocument,
  isLikelyBylawsHistorySource,
  looksLikeFullBylaws,
  rawPaperlessContent,
  bylawsMarkdownFromText,
  rebreakBylawsText,
  normalizeBylawLine,
  isPdfPageMarker,
  sameNormalizedText,
  isLikelyStandaloneHeading,
  visionReviewMarkdown,
  bylawHistoryTitle,
  sourceDateTime,
  transposedBundleKey,
  transposedRecordsFromPaperlessDocument,
  transposedSourceFromDoc,
  transposedFiling,
  transposedDeadline,
  isPublicationSpecificDocument,
  hasSocietyGovernanceSignal,
  transposedInsurancePolicy,
  isLikelyInsurancePolicyDocument,
  insuranceSeriesKeyFromText,
  insuranceRequirementsFromText,
  complianceChecksFromInsuranceText,
  insuranceCoveredParties,
  transposedFinancialStatement,
  transposedFinancialStatementImport,
  transposedGrant,
  transposedRecordsLocation,
  transposedArchiveAccession,
  transposedBoardRoleAssignment,
  transposedBoardRoleChange,
  transposedSigningAuthority,
  transposedMeetingAttendance,
  transposedMotionEvidence,
  transposedBudgetSnapshot,
  transposedTreasurerReport,
  transposedTransactionCandidate,
  transposedPipaTraining,
  transposedEmployee,
  transposedVolunteer,
  paperlessText,
  inferredPaperlessDate,
  fiscalYearLabel,
  safeTranspositionSnippet,
  safeRestrictedNote,
  isSensitivePaperlessDocument,
  dateNear,
  monthNumberPadded,
  moneyNear,
  formatMoneyFromCents,
  financialLinesFromText,
  firstMatchedPerson,
  namesNear,
  isLikelyNonPersonNameMatch,
  addOneYear,
  DISCOVERY_RULES,
  discoveryCandidateFromPaperlessDocument,
  sectionReasons,
  discoverySourceNotes,
  evidenceForRule,
  discoverySnippet,
  summarizeDiscoveryCandidates,
  discoverySortKey,
  isLikelyMeetingMinutesDocument,
  meetingMinutesFromPaperlessDocument,
  meetingAttendanceFromMinutes,
  motionEvidenceFromMinutes,
  sectionLooksLikeMinutes,
  hasMeetingMinutesEvidence,
  meetingEvidenceScore,
  splitMeetingSections,
  motionsFromText,
  cleanMotionText,
  voteSummaryFromText,
  meetingDateMatches,
  meetingYearlessDateMatches,
  meetingHeadingMatches,
  agendaFromText,
  attendeesFromText,
  absentFromText,
  peopleListAfterLabel,
  trimAttendanceInlineBlock,
  attendanceBlockAfter,
  parsePeopleList,
  columnAttendanceFromText,
  cleanPersonName,
  isPersonName,
  trimMeetingSectionText,
  discussionFromText,
  meetingTitleFromSection,
  meetingDateFromText,
  meetingDateWithoutYearFromText,
  inferYearFromText,
  meetingDateRegex,
  monthNumber,
  outcomeFromText,
  personAfter,
  paperlessDocumentTitle,
  paperlessFileName,
  documentDate,
  cleanOcrText,
  paperlessIdFromExternalId,
  parseJsonObject,
  tagValue,
  unique,
} from "./paperlessHelpers";

export const tagProfiles = query({
  args: {},
  returns: v.any(),
  handler: () => tagProfilesPortable(),
});


export const listConnection = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listConnectionPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => recentSyncsPortable(await toPortableQueryCtx(ctx), args),
});


export const syncForDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => syncForDocumentPortable(await toPortableQueryCtx(ctx), args),
});


export const sourcePullContext = query({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => sourcePullContextPortable(await toPortableQueryCtx(ctx), args),
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
    // Pulling copies the Paperless file into Convex's native storage, which the
    // "no native file storage" mode forbids. The connector still works as a
    // read-only source (list/link/open at Paperless) — it just won't cache here.
    assertNativeFileStorageEnabled();
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
    assertNativeFileStorageEnabled();
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
  handler: async (ctx, args) => authorizeMeetingImportPortable(await toPortableQueryCtx(ctx), args),
});


export const getSync = query({
  args: { id: v.id("paperlessDocumentSyncs") },
  returns: v.any(),
  handler: async (ctx, args) => getSyncPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => recordConnectionTestPortable(await toPortableMutationCtx(ctx), args),
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
      } else if (syncCtx.source.provider === "local-filesystem") {
        throw new Error("Paperless-ngx sync is unavailable for Electron local filesystem documents.");
      } else if (syncCtx.source.provider === "local") {
        throw new Error("Paperless-ngx sync is unavailable for API-local generated documents.");
      } else if (syncCtx.source.provider !== "rustfs") {
        throw new Error(`Paperless-ngx sync does not support ${syncCtx.source.provider} document versions.`);
      } else {
        const url = await createDownloadUrl({
          provider: syncCtx.source.provider,
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

