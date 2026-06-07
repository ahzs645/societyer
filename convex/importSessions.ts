import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { invalidOptionIssue, invalidOptionListIssues } from "./lib/orgHubOptions";
import { transactionImportMappingCandidates } from "./providers/accounting";
import {
  SESSION_TAG,
  RECORD_TAG,
  SESSION_CATEGORY,
  RECORD_CATEGORY,
  HISTORY_TAG,
  HISTORY_SOURCE_TAG,
  HISTORY_ITEM_TAG,
  HISTORY_SOURCE_CATEGORY,
  HISTORY_ITEM_CATEGORY,
  REVIEW_STATUSES,
  HISTORY_KINDS,
  SECTION_RECORD_KINDS,
  mergeExistingMeetingImport,
  minutesMotionFromPayload,
  shouldReplaceMeetingAgenda,
  isGenericImportedDiscussion,
  appendImportNote,
  ensureMeetingSourceDocuments,
  ensureImportSourceDocuments,
  insertSectionRecord,
  findExistingMeetingImport,
  resolveMeetingTargetForEvidence,
  resolvePersonLinks,
  personLookupKeys,
  normalizePersonLookupName,
  normalizeLookupText,
  importedMeetingAgenda,
  sessionRecords,
  recordsForSession,
  docsByCategory,
  sourceLookupDocs,
  upsertHistorySources,
  insertHistoryItem,
  patchRecordImportTarget,
  patchRecordPromotionBlocked,
  importPromotionIssues,
  addressKey,
  compactKey,
  addIssue,
  patchSessionUpdatedAt,
  recordsFromBundle,
  makeRecord,
  transactionCandidateMappingNotes,
  mappingMatchesCandidate,
  normalizePayload,
  normalizeSourcePayload,
  normalizeMotionPayload,
  normalizeMeetingMinutesPayload,
  structuredMinutesPatchFromPayload,
  normalizeRemoteParticipationPayload,
  normalizeDetailedAttendancePayload,
  normalizeMinuteSectionsPayload,
  normalizeActionItemsPayload,
  normalizeMinutesActionItem,
  normalizeSessionSegmentsPayload,
  normalizeAppendicesPayload,
  normalizeAgmDetailsPayload,
  normalizeDirectorAppointmentsPayload,
  normalizeSpecialResolutionExhibitsPayload,
  normalizeBudgetPayload,
  normalizeSectionPayload,
  dedupeInsurancePolicies,
  isImportableInsurancePolicy,
  insurancePolicyDedupeKey,
  insurancePolicySeriesKey,
  insurancePolicyTermLabel,
  mergeInsurancePolicies,
  mergeRecordArrays,
  normalizeCoveredParties,
  normalizeCoverageItems,
  normalizeCoveredLocations,
  normalizePolicyDefinitions,
  normalizeDeclinedCoverages,
  normalizeCertificatesOfInsurance,
  normalizeInsuranceRequirements,
  normalizeClaimsMadeTerms,
  normalizeClaimIncidents,
  normalizeAnnualReviews,
  normalizeComplianceChecks,
  sourceExternalIdsFor,
  titleForRecord,
  descriptionForRecord,
  titleForHistoryItem,
  insertSourceEvidenceForAppliedRecord,
  targetTableForRecordKind,
  summarizeRecords,
  summaryForSession,
  isPlainObject,
  summarizeFromSessionMetadata,
  hydrateSession,
  hydrateRecord,
  hydrateHistorySource,
  parseJson,
  parseJsonArray,
  externalIdFromTags,
  sourceCatalogForRecords,
  isImportSession,
  isImportRecord,
  isHistorySource,
  historySourceTags,
  riskFlagsFor,
  staticValidationFlagsFor,
  confidenceFor,
  normalizeReviewStatus,
  sessionName,
  sourceSystem,
  firstSection,
  importedLibrarySection,
  inferMeetingType,
  toMeetingDateTime,
  recordSortKey,
  sourceNoteFor,
  bylawImportHistory,
  cleanDate,
  cleanDateTime,
  todayDate,
  fiscalYearFromDate,
  splitName,
  personKey,
  tagValue,
  cleanText,
  arrayOf,
  compactStrings,
  compactRecord,
  unique,
  numberOrUndefined,
  optionalBoolean,
  sourceSystemFromExternalId,
  sourceSystemLabel,
  sourceSystemTag,
  fallbackSourceTitle,
} from "./importSessionHelpers";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const sessions = await docsByCategory(ctx, societyId, SESSION_CATEGORY);
    const rows: any[] = [];
    for (const doc of sessions.filter(isImportSession)) {
      const session = hydrateSession(doc);
      rows.push({
        ...session,
        summary: summaryForSession(session),
      });
    }

    return rows
      .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  },
});

export const get = query({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const sessionDoc = await ctx.db.get(sessionId);
    if (!isImportSession(sessionDoc)) return null;

    const docs = await recordsForSession(ctx, sessionId);
    const records = docs
      .filter(isImportRecord)
      .map(hydrateRecord)
      .filter((record) => record.sessionId === sessionId)
      .sort((a, b) => recordSortKey(a).localeCompare(recordSortKey(b)));

    return {
      session: {
        ...hydrateSession(sessionDoc),
        summary: records.length ? summarizeRecords(records) : summarizeFromSessionMetadata(hydrateSession(sessionDoc)),
      },
      records,
    };
  },
});

export const createFromBundle = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.optional(v.string()),
    bundle: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, name, bundle }) => {
    const now = new Date().toISOString();
    const records = recordsFromBundle(bundle);
    if (records.length === 0) {
      throw new Error("Import bundle did not contain any supported records.");
    }
    const sessionPayload = {
      kind: "importSession",
      name: cleanText(name) || sessionName(bundle),
      sourceSystem: sourceSystem(bundle),
      bundleMetadata: bundle?.metadata ?? null,
      createdAtISO: now,
      updatedAtISO: now,
      status: "Reviewing",
      qualitySummary: bundle?.specialistReports?.qualityDuplicates?.summary ?? null,
      summary: summarizeRecords(records.map((record) => ({
        ...record,
        status: "Pending",
        importedTargets: {},
      }))),
    };

    const sessionId = await ctx.db.insert("documents", {
      societyId,
      title: sessionPayload.name,
      category: SESSION_CATEGORY,
      content: JSON.stringify(sessionPayload),
      createdAtISO: now,
      flaggedForDeletion: false,
      tags: compactStrings([SESSION_TAG, tagValue(sessionPayload.sourceSystem)]),
    });

    for (const record of records) {
      await ctx.db.insert("documents", {
        societyId,
        title: record.title,
        category: RECORD_CATEGORY,
        importSessionId: sessionId,
        importRecordKind: record.recordKind,
        content: JSON.stringify({
          ...record,
          sessionId,
          kind: "importRecord",
          status: "Pending",
          reviewNotes: cleanText(record.payload?.reviewNotes) || cleanText(record.payload?.reviewSummary) || "",
          importedTargets: {},
          createdAtISO: now,
          updatedAtISO: now,
        }),
        createdAtISO: now,
        flaggedForDeletion: false,
        tags: compactStrings([SESSION_TAG, RECORD_TAG, tagValue(record.recordKind), tagValue(record.targetModule)]),
      });
    }

    return sessionId;
  },
});

export const updateRecord = mutation({
  args: {
    recordId: v.id("documents"),
    status: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
    payload: v.optional(v.any()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, { recordId, status, reviewNotes, payload, sourceExternalIds }) => {
    const doc = await ctx.db.get(recordId);
    if (!isImportRecord(doc)) return null;
    const record = hydrateRecord(doc);
    const nextPayload = payload != null ? normalizePayload(record.recordKind, payload) : record.payload;
    const nextSourceExternalIds = sourceExternalIds != null
      ? sourceExternalIds.map(String).filter(Boolean)
      : record.sourceExternalIds;
    const next = {
      ...record,
      status: normalizeReviewStatus(status ?? record.status),
      reviewNotes: reviewNotes != null ? cleanText(reviewNotes) : record.reviewNotes,
      payload: nextPayload,
      sourceExternalIds: nextSourceExternalIds,
      riskFlags: riskFlagsFor(record.recordKind, record.targetModule, nextPayload),
      updatedAtISO: new Date().toISOString(),
    };
    const title = titleForRecord(next.recordKind, next.payload);
    await ctx.db.patch(recordId, {
      title,
      content: JSON.stringify({ ...next, title }),
      tags: compactStrings([SESSION_TAG, RECORD_TAG, tagValue(next.recordKind), tagValue(next.targetModule)]),
    });
    if (next.sessionId) await patchSessionUpdatedAt(ctx, next.sessionId);
    return recordId;
  },
});

export const bulkSetStatus = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: async (ctx, { sessionId, status, recordIds }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { updated: 0 };
    const wanted = normalizeReviewStatus(status);
    const docs = await recordsForSession(ctx, sessionId);
    const idSet = recordIds ? new Set(recordIds) : null;
    let updated = 0;
    for (const doc of docs.filter(isImportRecord)) {
      if (idSet && !idSet.has(doc._id)) continue;
      const record = hydrateRecord(doc);
      if (record.sessionId !== sessionId) continue;
      await ctx.db.patch(doc._id, {
        content: JSON.stringify({ ...record, status: wanted, updatedAtISO: new Date().toISOString() }),
      });
      updated += 1;
    }
    await patchSessionUpdatedAt(ctx, sessionId);
    return { updated };
  },
});

export const bulkSetStatusByKind = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordKinds: v.array(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, { sessionId, status, recordKinds, sourceExternalIds }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { updated: 0 };
    const wanted = normalizeReviewStatus(status);
    const kinds = new Set(recordKinds.map((kind) => cleanText(kind)).filter(Boolean));
    const sources = sourceExternalIds ? new Set(sourceExternalIds.map((source) => cleanText(source)?.toLowerCase()).filter(Boolean)) : null;
    const docs = await recordsForSession(ctx, sessionId);
    let updated = 0;
    for (const doc of docs.filter(isImportRecord)) {
      const record = hydrateRecord(doc);
      if (record.sessionId !== sessionId || !kinds.has(record.recordKind)) continue;
      if (sources) {
        const recordSources = unique([...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? [])])
          .map((source) => source.toLowerCase());
        if (!recordSources.some((source) => sources.has(source))) continue;
      }
      await ctx.db.patch(doc._id, {
        content: JSON.stringify({ ...record, status: wanted, updatedAtISO: new Date().toISOString() }),
      });
      updated += 1;
    }
    await patchSessionUpdatedAt(ctx, sessionId);
    return { updated };
  },
});

export const bulkSetStatusByFilter = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    currentStatus: v.optional(v.string()),
    recordKinds: v.optional(v.array(v.string())),
    targetModules: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, { sessionId, status, currentStatus, recordKinds, targetModules }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { updated: 0 };
    const wanted = normalizeReviewStatus(status);
    const current = currentStatus ? normalizeReviewStatus(currentStatus) : null;
    const kinds = recordKinds ? new Set(recordKinds.map((kind) => cleanText(kind)).filter(Boolean)) : null;
    const targets = targetModules ? new Set(targetModules.map((target) => cleanText(target)).filter(Boolean)) : null;
    const docs = await recordsForSession(ctx, sessionId);
    let updated = 0;
    for (const doc of docs.filter(isImportRecord)) {
      const record = hydrateRecord(doc);
      if (record.sessionId !== sessionId) continue;
      if (current && record.status !== current) continue;
      if (kinds && !kinds.has(record.recordKind)) continue;
      if (targets && !targets.has(record.targetModule)) continue;
      await ctx.db.patch(doc._id, {
        content: JSON.stringify({ ...record, status: wanted, updatedAtISO: new Date().toISOString() }),
      });
      updated += 1;
    }
    await patchSessionUpdatedAt(ctx, sessionId);
    return { updated };
  },
});

export const refreshSessionSummaries = mutation({
  args: {
    societyId: v.id("societies"),
    sessionIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, sessionIds }) => {
    const sessions = sessionIds
      ? (await Promise.all(sessionIds.map((id) => ctx.db.get(id)))).filter(isImportSession)
      : (await docsByCategory(ctx, societyId, SESSION_CATEGORY)).filter(isImportSession);
    const results: any[] = [];
    for (const session of sessions) {
      if (String(session.societyId) !== String(societyId)) continue;
      const summary = await patchSessionUpdatedAt(ctx, session._id);
      results.push({ sessionId: session._id, summary });
    }
    return { updated: results.length, sessions: results };
  },
});

export const removeSession = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return;
    const docs = await recordsForSession(ctx, sessionId);
    await Promise.all(
      docs
        .filter(isImportRecord)
        .map(hydrateRecord)
        .filter((record) => record.sessionId === sessionId)
        .map((record) => ctx.db.delete(record._id)),
    );
    await ctx.db.delete(sessionId);
  },
});

export const applyApprovedToOrgHistory = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { sources: 0, items: 0 };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const approvedItems = records.filter(
      (record) =>
        record.status === "Approved" &&
        HISTORY_KINDS.includes(record.recordKind) &&
        !record.importedTargets?.orgHistory,
    );
    const approvedSourceRecords = records.filter((record) => record.status === "Approved" && record.recordKind === "source");
    const referencedExternalIds = new Set<string>();
    for (const record of approvedItems) {
      for (const externalId of record.sourceExternalIds ?? []) referencedExternalIds.add(externalId);
    }

    const sourceRecords = records.filter((record) => {
      if (record.recordKind !== "source") return false;
      const externalId = cleanText(record.payload?.externalId);
      return approvedSourceRecords.some((source) => source._id === record._id) || (externalId && referencedExternalIds.has(externalId));
    });

    const sourceIdByExternalId = await upsertHistorySources(ctx, session.societyId, sourceRecords, referencedExternalIds);
    let items = 0;
    for (const record of approvedItems) {
      const payload = {
        ...record.payload,
        sourceIds: (record.sourceExternalIds ?? [])
          .map((externalId: string) => sourceIdByExternalId.get(externalId))
          .filter(Boolean),
      };
      const itemId = await insertHistoryItem(ctx, session.societyId, record.recordKind, payload);
      await patchRecordImportTarget(ctx, record, "orgHistory", itemId);
      items += 1;
    }

    for (const record of sourceRecords.filter((source) => source.status === "Approved")) {
      const externalId = cleanText(record.payload?.externalId);
      const sourceId = externalId ? sourceIdByExternalId.get(externalId) : undefined;
      if (sourceId) await patchRecordImportTarget(ctx, record, "orgHistory", sourceId);
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { sources: sourceRecords.length, items };
  },
});

export const applyApprovedMeetings = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { meetings: 0, minutes: 0, motions: 0 };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const sourceCatalog = sourceCatalogForRecords(records);
    const motions = records.filter(
      (record) =>
        record.recordKind === "motion" &&
        record.status === "Approved" &&
        !record.importedTargets?.meetings,
    );
    const minuteRecords = records.filter(
      (record) =>
        record.recordKind === "meetingMinutes" &&
        record.status === "Approved" &&
        !record.importedTargets?.meetings,
    );
    const groups = new Map<string, any[]>();
    for (const record of motions) {
      const payload = normalizeMotionPayload(record.payload);
      const key = `${payload.meetingDate || "undated"}::${payload.meetingTitle || "Imported meeting minutes"}`;
      groups.set(key, [...(groups.get(key) ?? []), { record, payload }]);
    }

    let meetings = 0;
    let minutes = 0;
    let motionCount = 0;
    let existing = 0;
    for (const group of groups.values()) {
      const first = group[0].payload;
      const scheduledAt = toMeetingDateTime(first.meetingDate);
      const title = cleanText(first.meetingTitle) || `Imported meeting minutes ${first.meetingDate || ""}`.trim();
      const sourceExternalIds = unique(group.flatMap(({ record }) => record.sourceExternalIds ?? []));
      const sourceDocumentIds = await ensureMeetingSourceDocuments(ctx, session.societyId, sourceExternalIds, sourceCatalog);
      const existingTarget = await findExistingMeetingImport(ctx, session.societyId, scheduledAt, title, sourceExternalIds);
      if (existingTarget) {
        await mergeExistingMeetingImport(ctx, session, existingTarget, first, sourceExternalIds, sourceDocumentIds, sessionId);
        for (const { record } of group) await patchRecordImportTarget(ctx, record, "meetings", existingTarget);
        existing += 1;
        continue;
      }
      const meetingId = await ctx.db.insert("meetings", {
        societyId: session.societyId,
        type: inferMeetingType(title),
        title,
        scheduledAt,
        electronic: false,
        status: "Held",
        attendeeIds: [],
        agendaJson: JSON.stringify(importedMeetingAgenda(title, group.map(({ payload }) => payload), sourceExternalIds)),
        sourceReviewStatus: "imported_needs_review",
        sourceReviewNotes: "Created from approved import-session motion records. Verify against source minutes before relying on it as an official meeting record.",
        packageReviewStatus: "needs_review",
        packageReviewNotes: "Imported meeting source review must be completed before the board package is ready.",
        notes: `Imported from ${hydrateSession(session).name} (${group.length} converted motion${group.length === 1 ? "" : "s"}). Review attendance, quorum, discussion, and source minutes before treating as official minutes.`,
      });
      const minutesId = await ctx.db.insert("minutes", {
        societyId: session.societyId,
        meetingId,
        heldAt: scheduledAt,
        attendees: [],
        absent: [],
        quorumMet: false,
        discussion: "Imported from converted Paperless meeting-minute motions. Review the source document before approving these minutes.",
        motions: group.map(({ payload }) => ({
          text: cleanText(payload.motionText) || "Imported motion",
          movedBy: cleanText(payload.movedByName),
          secondedBy: cleanText(payload.secondedByName),
          outcome: cleanText(payload.outcome) || "Unknown",
          votesFor: numberOrUndefined(payload.votesFor),
          votesAgainst: numberOrUndefined(payload.votesAgainst),
          abstentions: numberOrUndefined(payload.abstentions),
        })),
        decisions: [],
        actionItems: [],
        sourceDocumentIds,
        sourceExternalIds,
        sourceReviewStatus: "imported_needs_review",
        sourceReviewNotes: "Created from approved import-session motion records. Verify against source minutes before relying on it as official minutes.",
        draftTranscript: JSON.stringify({
          importSessionId: sessionId,
          sourceExternalIds,
          sourceDocumentIds,
          note: "Converted from Paperless import session; not an audio transcript.",
        }),
      });
      await ctx.db.patch(meetingId, { minutesId });
      for (const { record } of group) {
        await patchRecordImportTarget(ctx, record, "meetings", { meetingId, minutesId });
      }
      meetings += 1;
      minutes += 1;
      motionCount += group.length;
    }

    for (const record of minuteRecords) {
      const payload = normalizeMeetingMinutesPayload(record.payload);
      const scheduledAt = toMeetingDateTime(payload.meetingDate);
      const title = cleanText(payload.meetingTitle) || `Imported meeting minutes ${payload.meetingDate || ""}`.trim();
      const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
      const sourceDocumentIds = await ensureMeetingSourceDocuments(ctx, session.societyId, sourceExternalIds, sourceCatalog);
      const existingTarget = await findExistingMeetingImport(ctx, session.societyId, scheduledAt, title, sourceExternalIds);
      if (existingTarget) {
        await mergeExistingMeetingImport(ctx, session, existingTarget, payload, sourceExternalIds, sourceDocumentIds, sessionId);
        await patchRecordImportTarget(ctx, record, "meetings", existingTarget);
        existing += 1;
        continue;
      }

      const meetingId = await ctx.db.insert("meetings", {
        societyId: session.societyId,
        type: inferMeetingType(title),
        title,
        scheduledAt,
        electronic: false,
        status: "Held",
        attendeeIds: payload.attendees,
        agendaJson: JSON.stringify(
          payload.agendaItems.length
            ? payload.agendaItems
            : importedMeetingAgenda(title, payload.motions, sourceExternalIds),
        ),
        sourceReviewStatus: "imported_needs_review",
        sourceReviewNotes: "Created from approved import-session meeting minutes. Verify against source minutes before relying on it as an official meeting record.",
        packageReviewStatus: "needs_review",
        packageReviewNotes: "Imported meeting source review must be completed before the board package is ready.",
        notes: `Imported from ${hydrateSession(session).name}. Review source minutes before treating as official minutes.`,
      });
      const minutesId = await ctx.db.insert("minutes", {
        societyId: session.societyId,
        meetingId,
        heldAt: scheduledAt,
        attendees: payload.attendees,
        absent: payload.absent,
        quorumMet: payload.quorumMet,
        discussion: payload.discussion || "Imported from Paperless meeting minutes. Review the source document before approving these minutes.",
        ...structuredMinutesPatchFromPayload(payload),
        motions: payload.motions.map(minutesMotionFromPayload),
        decisions: payload.decisions,
        actionItems: payload.actionItems,
        sourceDocumentIds,
        sourceExternalIds,
        sourceReviewStatus: "imported_needs_review",
        sourceReviewNotes: "Created from approved import-session meeting minutes. Verify against source minutes before relying on it as official minutes.",
        draftTranscript: JSON.stringify({
          importSessionId: sessionId,
          sourceExternalIds,
          sourceDocumentIds,
          sourceDocumentTitle: payload.sourceDocumentTitle,
          sourceDocumentId: payload.sourceDocumentId,
          sectionIndex: payload.sectionIndex,
          importedMotions: payload.motions.map((motion: any) => ({
            motionText: cleanText(motion.motionText),
            outcome: cleanText(motion.outcome),
            movedByName: cleanText(motion.movedByName),
            secondedByName: cleanText(motion.secondedByName),
            voteSummary: cleanText(motion.voteSummary),
            pageRef: cleanText(motion.pageRef),
            evidenceText: cleanText(motion.evidenceText),
            rawText: cleanText(motion.rawText),
          })),
          note: "Converted from Paperless meeting-minute OCR; not an audio transcript.",
        }),
      });
      await ctx.db.patch(meetingId, { minutesId });
      await patchRecordImportTarget(ctx, record, "meetings", { meetingId, minutesId });
      meetings += 1;
      minutes += 1;
      motionCount += payload.motions.length;
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { meetings, minutes, motions: motionCount, existing };
  },
});

export const backfillApprovedMeetingReferences = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { meetings: 0, minutes: 0, documents: 0 };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const sourceCatalog = sourceCatalogForRecords(records);
    const groups = new Map<string, any[]>();

    for (const record of records) {
      const target = record.importedTargets?.meetings;
      if (record.recordKind !== "motion" || !target?.meetingId || !target?.minutesId) continue;
      const key = `${target.meetingId}::${target.minutesId}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }

    let meetings = 0;
    let minutes = 0;
    let documents = 0;
    for (const recordsForMeeting of groups.values()) {
      const target = recordsForMeeting[0].importedTargets.meetings;
      const meeting = await ctx.db.get(target.meetingId) as any;
      const minutesRow = await ctx.db.get(target.minutesId) as any;
      if (!meeting || !minutesRow) continue;

      const payloads = recordsForMeeting.map((record) => normalizeMotionPayload(record.payload));
      const sourceExternalIds = unique(recordsForMeeting.flatMap((record) => record.sourceExternalIds ?? []));
      const sourceDocumentIds = await ensureMeetingSourceDocuments(ctx, session.societyId, sourceExternalIds, sourceCatalog);
      documents += sourceDocumentIds.length;

      const nextTranscript = {
        ...parseJson(minutesRow.draftTranscript),
        importSessionId: sessionId,
        sourceExternalIds,
        sourceDocumentIds,
        note: "Converted from Paperless import session; not an audio transcript.",
      };
      await ctx.db.patch(minutesRow._id, {
        sourceDocumentIds,
        sourceExternalIds,
        draftTranscript: JSON.stringify(nextTranscript),
      });
      minutes += 1;

      if (!Array.isArray(parseJsonArray(meeting.agendaJson)) || parseJsonArray(meeting.agendaJson).length === 0) {
        await ctx.db.patch(meeting._id, {
          agendaJson: JSON.stringify(importedMeetingAgenda(meeting.title, payloads, sourceExternalIds)),
        });
      }
      meetings += 1;
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { meetings, minutes, documents };
  },
});

export const applyApprovedDocuments = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { documents: 0 };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const candidates = records.filter(
      (record) =>
        record.recordKind === "documentCandidate" &&
        record.status === "Approved" &&
        !record.importedTargets?.documents,
    );

    let documents = 0;
    for (const record of candidates) {
      const payload = record.payload ?? {};
      const sourceExternalIds = unique([
        ...(record.sourceExternalIds ?? []),
        ...(payload.sourceExternalIds ?? []),
        payload.externalId,
        payload.id != null ? `paperless:${payload.id}` : undefined,
      ]);
      const externalId = sourceExternalIds[0];
      const externalSystem = cleanText(payload.externalSystem) || sourceSystemFromExternalId(externalId);
      const paperlessId = externalSystem === "paperless" && externalId ? externalId : undefined;
      const sections = Array.isArray(payload.sections) ? payload.sections.map(String) : [];
      const sourceTags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
      const docId = await ctx.db.insert("documents", {
        societyId: session.societyId,
        title: cleanText(payload.title) || record.title || externalId || "Imported document candidate",
        category: cleanText(record.targetModule) || cleanText(sections[0]) || "Imported Document",
        fileName: cleanText(payload.fileName),
        mimeType: cleanText(payload.mimeType),
        fileSizeBytes: numberOrUndefined(payload.fileSizeBytes),
        content: JSON.stringify({
          importedFrom: `${sourceSystemLabel(externalSystem)} import session`,
          importSessionId: sessionId,
          externalSystem,
          externalId,
          sourceExternalIds,
          paperlessId,
          localPath: cleanText(payload.localPath),
          sha256: cleanText(payload.sha256),
          sections,
          confidence: payload.confidence,
          why: payload.why,
          created: payload.created,
          tags: sourceTags,
          note: `Metadata-only import. Review the original ${sourceSystemLabel(externalSystem)} source before relying on OCR or publishing content.`,
        }),
        createdAtISO: new Date().toISOString(),
        reviewStatus: "in_review",
        librarySection: importedLibrarySection(record.targetModule, sections),
        flaggedForDeletion: false,
        tags: unique([
          `${sourceSystemTag(externalSystem)}-import`,
          "import-candidate",
          externalId,
          ...sections.map(tagValue),
          ...sourceTags.map(tagValue).slice(0, 8),
        ]),
      });
      await patchRecordImportTarget(ctx, record, "documents", docId);
      documents += 1;
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { documents };
  },
});

export const applyApprovedSectionRecords = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { total: 0, byKind: {} };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const sourceCatalog = sourceCatalogForRecords(records);
    const sectionRecords = records.filter(
      (record) =>
        SECTION_RECORD_KINDS.includes(record.recordKind) &&
        record.status === "Approved" &&
        !record.importedTargets?.sections,
    );

    const byKind: Record<string, number> = {};
    let total = 0;
    for (const record of sectionRecords) {
      const sourceDocumentIds = await ensureImportSourceDocuments(
        ctx,
        session.societyId,
        unique([...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? [])]),
        "Imported Source",
        `Source placeholder created while applying ${record.recordKind} from ${hydrateSession(session).name}. Pull or review the original source document before publishing content.`,
        sourceCatalog,
      );
      const promotionIssues = await importPromotionIssues(ctx, session.societyId, record);
      if (promotionIssues.length > 0) {
        await patchRecordPromotionBlocked(ctx, record, promotionIssues);
        byKind[`${record.recordKind}:blocked`] = (byKind[`${record.recordKind}:blocked`] ?? 0) + 1;
        continue;
      }
      const target = await insertSectionRecord(ctx, session.societyId, record, sourceDocumentIds);
      if (record.recordKind !== "sourceEvidence") {
        await insertSourceEvidenceForAppliedRecord(ctx, session.societyId, record, target, sourceDocumentIds);
      }
      await patchRecordImportTarget(ctx, record, "sections", target);
      byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
      total += 1;
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { total, byKind };
  },
});
