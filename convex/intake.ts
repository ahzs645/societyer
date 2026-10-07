import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import * as handlers from "../shared/functions/intake";
import * as review from "../shared/functions/intakeReview";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";

const societyId = v.id("societies");
const runId = v.id("intakeRuns");

export const listRuns = authorizedQuery("intake:listRuns", query)({ args: { societyId }, returns: v.any(), handler: async (ctx, args) => handlers.listRuns(await toPortableQueryCtx(ctx), args) });
export const getRun = authorizedQuery("intake:getRun", query)({ args: { societyId, runId }, returns: v.any(), handler: async (ctx, args) => handlers.getRun(await toPortableQueryCtx(ctx), args) });
export const listFiles = authorizedQuery("intake:listFiles", query)({ args: { societyId, runId }, returns: v.any(), handler: async (ctx, args) => handlers.listFiles(await toPortableQueryCtx(ctx), args) });
export const listClusters = authorizedQuery("intake:listClusters", query)({ args: { societyId, runId }, returns: v.any(), handler: async (ctx, args) => handlers.listClusters(await toPortableQueryCtx(ctx), args) });
export const listExtractions = authorizedQuery("intake:listExtractions", query)({ args: { societyId, runId }, returns: v.any(), handler: async (ctx, args) => handlers.listExtractions(await toPortableQueryCtx(ctx), args) });
export const getExtraction = authorizedQuery("intake:getExtraction", query)({ args: { societyId, extractionId: v.id("intakeExtractions") }, returns: v.any(), handler: async (ctx, args) => handlers.getExtraction(await toPortableQueryCtx(ctx), args) });
export const getExtractionInput = authorizedQuery("intake:getExtractionInput", query)({ args: { societyId, runId, fileKey: v.string() }, returns: v.any(), handler: async (ctx, args) => handlers.getExtractionInput(await toPortableQueryCtx(ctx), args) });
export const processingLog = authorizedQuery("intake:processingLog", query)({ args: { societyId, runId }, returns: v.any(), handler: async (ctx, args) => handlers.processingLog(await toPortableQueryCtx(ctx), args) });
export const provenanceForRecord = authorizedQuery("intake:provenanceForRecord", query)({ args: { societyId, targetTable: v.string(), targetId: v.string() }, returns: v.any(), handler: async (ctx, args) => handlers.provenanceForRecord(await toPortableQueryCtx(ctx), args) });

export const createRun = authorizedMutation("intake:createRun", mutation)({ args: { societyId, name: v.string(), sourceKind: v.string(), sourceRoot: v.optional(v.string()), settings: v.optional(v.any()), engine: v.optional(v.any()) }, returns: v.any(), handler: async (ctx, args) => handlers.createRun(await toPortableMutationCtx(ctx), args) });
export const updateRun = authorizedMutation("intake:updateRun", mutation)({ args: { societyId, runId, patch: v.any() }, returns: v.any(), handler: async (ctx, args) => handlers.updateRun(await toPortableMutationCtx(ctx), args) });
export const recordFiles = authorizedMutation("intake:recordFiles", mutation)({ args: { societyId, runId, files: v.array(v.any()) }, returns: v.any(), handler: async (ctx, args) => handlers.recordFiles(await toPortableMutationCtx(ctx), args) });
export const saveExtract = authorizedMutation("intake:saveExtract", mutation)({ args: { societyId, runId, fileKey: v.string(), extract: v.any() }, returns: v.any(), handler: async (ctx, args) => handlers.saveExtract(await toPortableMutationCtx(ctx), args) });
export const saveClusters = authorizedMutation("intake:saveClusters", mutation)({ args: { societyId, runId, clusters: v.array(v.any()) }, returns: v.any(), handler: async (ctx, args) => handlers.saveClusters(await toPortableMutationCtx(ctx), args) });
export const saveExtraction = authorizedMutation("intake:saveExtraction", mutation)({ args: { societyId, runId, fileKey: v.string(), extraction: v.any() }, returns: v.any(), handler: async (ctx, args) => handlers.saveExtraction(await toPortableMutationCtx(ctx), args) });
export const setExtractionStatus = authorizedMutation("intake:setExtractionStatus", mutation)({ args: { societyId, extractionId: v.id("intakeExtractions"), status: v.string() }, returns: v.any(), handler: async (ctx, args) => handlers.setExtractionStatus(await toPortableMutationCtx(ctx), args) });
export const appendProcessingLog = authorizedMutation("intake:appendProcessingLog", mutation)({ args: { societyId, runId, entries: v.array(v.any()) }, returns: v.any(), handler: async (ctx, args) => handlers.appendProcessingLog(await toPortableMutationCtx(ctx), args) });
export const reviewField = authorizedMutation("intake:reviewField", mutation)({ args: { societyId, extractionId: v.id("intakeExtractions"), fieldPath: v.string(), decision: v.string(), editedValue: v.optional(v.any()), note: v.optional(v.string()), gap: v.optional(v.any()) }, returns: v.any(), handler: async (ctx, args) => handlers.reviewField(await toPortableMutationCtx(ctx), args) });
export const recordProvenance = authorizedMutation("intake:recordProvenance", mutation)({ args: { societyId, entries: v.array(v.any()) }, returns: v.any(), handler: async (ctx, args) => handlers.recordProvenance(await toPortableMutationCtx(ctx), args) });

// Review and promotion (shared/functions/intakeReview.ts).
const reviewItem = v.object({ extractionId: v.id("intakeExtractions"), fieldPath: v.string(), decision: v.string(), editedValue: v.optional(v.any()), note: v.optional(v.string()), gap: v.optional(v.any()) });
export const mergeCandidates = authorizedQuery("intake:mergeCandidates", query)({ args: { societyId, extractionId: v.id("intakeExtractions") }, returns: v.any(), handler: async (ctx, args) => review.mergeCandidates(await toPortableQueryCtx(ctx), args) });
export const provenanceForExtraction = authorizedQuery("intake:provenanceForExtraction", query)({ args: { societyId, extractionId: v.id("intakeExtractions") }, returns: v.any(), handler: async (ctx, args) => review.provenanceForExtraction(await toPortableQueryCtx(ctx), args) });
export const runSummaries = authorizedQuery("intake:runSummaries", query)({ args: { societyId }, returns: v.any(), handler: async (ctx, args) => review.runSummaries(await toPortableQueryCtx(ctx), args) });
export const reviewFields = authorizedMutation("intake:reviewFields", mutation)({ args: { societyId, items: v.array(reviewItem) }, returns: v.any(), handler: async (ctx, args) => review.reviewFields(await toPortableMutationCtx(ctx), args) });
export const undoReviews = authorizedMutation("intake:undoReviews", mutation)({ args: { societyId, reviewIds: v.array(v.id("intakeFieldReviews")) }, returns: v.any(), handler: async (ctx, args) => review.undoReviews(await toPortableMutationCtx(ctx), args) });
export const promoteExtraction = authorizedMutation("intake:promoteExtraction", mutation)({ args: { societyId, extractionId: v.id("intakeExtractions"), mode: v.optional(v.string()), targetMeetingId: v.optional(v.id("meetings")) }, returns: v.any(), handler: async (ctx, args) => review.promoteExtraction(await toPortableMutationCtx(ctx), args) });
export const reconcileRun = authorizedMutation("intake:reconcileRun", mutation)({ args: { societyId, runId }, returns: v.any(), handler: async (ctx, args) => review.reconcileRun(await toPortableMutationCtx(ctx), args) });
export const getFileExtract = authorizedQuery("intake:getFileExtract", query)({ args: { societyId, fileId: v.id("intakeFiles") }, returns: v.any(), handler: async (ctx, args) => review.getFileExtract(await toPortableQueryCtx(ctx), args) });
export const entityCandidates = authorizedQuery("intake:entityCandidates", query)({ args: { societyId, extractionId: v.id("intakeExtractions") }, returns: v.any(), handler: async (ctx, args) => review.entityCandidates(await toPortableQueryCtx(ctx), args) });
export const linkNameAcrossRun = authorizedMutation("intake:linkNameAcrossRun", mutation)({ args: { societyId, runId, name: v.string(), personId: v.optional(v.id("peopleDirectory")), mode: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => review.linkNameAcrossRun(await toPortableMutationCtx(ctx), args) });
export const provenanceForRecords = authorizedQuery("intake:provenanceForRecords", query)({ args: { societyId, targets: v.array(v.object({ targetTable: v.string(), targetId: v.string() })) }, returns: v.any(), handler: async (ctx, args) => review.provenanceForRecords(await toPortableQueryCtx(ctx), args) });
