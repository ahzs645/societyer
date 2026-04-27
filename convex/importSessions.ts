import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { invalidOptionIssue, invalidOptionListIssues } from "./lib/orgHubOptions";

const SESSION_TAG = "import-session";
const RECORD_TAG = "import-session-record";
const SESSION_CATEGORY = "Import Session";
const RECORD_CATEGORY = "Import Candidate";

const HISTORY_TAG = "org-history";
const HISTORY_SOURCE_TAG = "org-history-source";
const HISTORY_ITEM_TAG = "org-history-item";
const HISTORY_SOURCE_CATEGORY = "Org History Source";
const HISTORY_ITEM_CATEGORY = "Org History Item";

const REVIEW_STATUSES = ["Pending", "Approved", "Rejected"] as const;
const HISTORY_KINDS = ["fact", "event", "boardTerm", "motion", "budget"] as const;
const SECTION_RECORD_KINDS = [
  "filing",
  "deadline",
  "bylawAmendment",
  "publication",
  "insurancePolicy",
  "financialStatement",
  "financialStatementImport",
  "grant",
  "recordsLocation",
  "archiveAccession",
  "boardRoleAssignment",
  "boardRoleChange",
  "signingAuthority",
  "meetingAttendance",
  "motionEvidence",
  "budgetSnapshot",
  "treasurerReport",
  "transactionCandidate",
  "organizationAddress",
  "organizationRegistration",
  "organizationIdentifier",
  "policy",
  "workflowPackage",
  "minuteBookItem",
  "roleHolder",
  "rightsClass",
  "rightsholdingTransfer",
  "legalTemplateDataField",
  "legalTemplate",
  "legalPrecedent",
  "legalPrecedentRun",
  "generatedLegalDocument",
  "legalSigner",
  "formationRecord",
  "nameSearchItem",
  "entityAmendment",
  "annualMaintenanceRecord",
  "jurisdictionMetadata",
  "supportLog",
  "sourceEvidence",
  "secretVaultItem",
  "pipaTraining",
  "employee",
  "volunteer",
] as const;

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

async function mergeExistingMeetingImport(
  ctx: any,
  session: any,
  target: { meetingId: any; minutesId: any },
  payload: any,
  sourceExternalIds: string[],
  sourceDocumentIds: any[],
  sessionId: any,
) {
  const meeting = await ctx.db.get(target.meetingId);
  const minutesRow = await ctx.db.get(target.minutesId);
  if (!meeting || !minutesRow) return;

  const currentAgenda = parseJsonArray(meeting.agendaJson);
  const nextAgenda = arrayOf(payload.agendaItems).map(String).map(cleanText).filter(Boolean);
  const meetingPatch: any = {};
  if ((!Array.isArray(meeting.attendeeIds) || meeting.attendeeIds.length === 0) && arrayOf(payload.attendees).length > 0) {
    meetingPatch.attendeeIds = arrayOf(payload.attendees).map(String).map(cleanText).filter(Boolean);
  }
  if (nextAgenda.length > 0 && shouldReplaceMeetingAgenda(currentAgenda)) {
    meetingPatch.agendaJson = JSON.stringify(nextAgenda);
  }
  const mergedMeetingNote = appendImportNote(
    meeting.notes,
    `Merged richer Paperless minutes import from ${hydrateSession(session).name}; review before treating as official minutes.`,
  );
  if (mergedMeetingNote !== meeting.notes) meetingPatch.notes = mergedMeetingNote;
  if (meeting.sourceReviewStatus !== "source_reviewed") {
    meetingPatch.sourceReviewStatus = "imported_needs_review";
    meetingPatch.sourceReviewNotes = "Merged imported meeting-minute data. Verify against source minutes before relying on it as official.";
  }
  if (meeting.packageReviewStatus !== "released") {
    meetingPatch.packageReviewStatus = "needs_review";
    meetingPatch.packageReviewNotes = "Meeting source data changed through import and needs board package review.";
  }
  if (Object.keys(meetingPatch).length > 0) await ctx.db.patch(meeting._id, meetingPatch);

  const minutesPatch: any = {};
  const attendees = arrayOf(payload.attendees).map(String).map(cleanText).filter(Boolean);
  const absent = arrayOf(payload.absent).map(String).map(cleanText).filter(Boolean);
  const motions = arrayOf(payload.motions).map(minutesMotionFromPayload);
  if ((!Array.isArray(minutesRow.attendees) || minutesRow.attendees.length === 0) && attendees.length > 0) minutesPatch.attendees = attendees;
  if ((!Array.isArray(minutesRow.absent) || minutesRow.absent.length === 0) && absent.length > 0) minutesPatch.absent = absent;
  if (!minutesRow.quorumMet && payload.quorumMet) minutesPatch.quorumMet = true;
  if (isGenericImportedDiscussion(minutesRow.discussion) && cleanText(payload.discussion)) minutesPatch.discussion = cleanText(payload.discussion);
  if ((!Array.isArray(minutesRow.motions) || minutesRow.motions.length === 0) && motions.length > 0) minutesPatch.motions = motions;
  const structuredPatch = structuredMinutesPatchFromPayload(payload);
  for (const [key, value] of Object.entries(structuredPatch)) {
    const current = (minutesRow as any)[key];
    const currentIsBlank = Array.isArray(current)
      ? current.length === 0
      : current == null || (typeof current === "object" && Object.keys(current).length === 0) || current === "";
    if (currentIsBlank) minutesPatch[key] = value;
  }

  const mergedSourceExternalIds = unique([...(minutesRow.sourceExternalIds ?? []), ...sourceExternalIds]);
  if (mergedSourceExternalIds.length !== (minutesRow.sourceExternalIds ?? []).length) minutesPatch.sourceExternalIds = mergedSourceExternalIds;
  const mergedSourceDocumentIds = unique([...(minutesRow.sourceDocumentIds ?? []), ...sourceDocumentIds]);
  if (mergedSourceDocumentIds.length !== (minutesRow.sourceDocumentIds ?? []).length) minutesPatch.sourceDocumentIds = mergedSourceDocumentIds;
  if (minutesRow.sourceReviewStatus !== "source_reviewed") {
    minutesPatch.sourceReviewStatus = "imported_needs_review";
    minutesPatch.sourceReviewNotes = "Merged imported meeting-minute data. Verify against source minutes before relying on it as official.";
  }

  minutesPatch.draftTranscript = JSON.stringify({
    ...parseJson(minutesRow.draftTranscript),
    lastImportSessionId: sessionId,
    sourceExternalIds: mergedSourceExternalIds,
    sourceDocumentIds: mergedSourceDocumentIds,
    sourceDocumentTitle: cleanText(payload.sourceDocumentTitle),
    sourceDocumentId: cleanText(payload.sourceDocumentId),
    sectionIndex: payload.sectionIndex,
    importedMotions: arrayOf(payload.motions).map((motion: any) => ({
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
  });

  await ctx.db.patch(minutesRow._id, minutesPatch);
}

function minutesMotionFromPayload(motion: any) {
  return {
    text: cleanText(motion.motionText) || "Imported motion",
    movedBy: cleanText(motion.movedByName),
    secondedBy: cleanText(motion.secondedByName),
    outcome: cleanText(motion.outcome) || "NeedsReview",
    votesFor: numberOrUndefined(motion.votesFor),
    votesAgainst: numberOrUndefined(motion.votesAgainst),
    abstentions: numberOrUndefined(motion.abstentions),
    resolutionType: cleanText(motion.resolutionType),
  };
}

function shouldReplaceMeetingAgenda(currentAgenda: any[]) {
  if (!currentAgenda.length) return true;
  return currentAgenda.every((item) => {
    const text = typeof item === "string" ? item : cleanText(item?.title ?? item?.text);
    return !text || /\b(review source document|business item|converted motion|call to order|confirm attendance|approve agenda|adjournment)\b/i.test(text);
  });
}

function isGenericImportedDiscussion(value: unknown) {
  const text = cleanText(value) ?? "";
  return !text || /\bImported from|Review the source document|converted Paperless\b/i.test(text);
}

function appendImportNote(current: unknown, note: string) {
  const text = cleanText(current);
  if (!text) return note;
  if (text.includes(note)) return text;
  return `${text}\n${note}`;
}

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
        tags: [
          `${sourceSystemTag(externalSystem)}-import`,
          "import-candidate",
          externalId,
          ...sections.map(tagValue),
          ...sourceTags.map(tagValue).slice(0, 8),
        ].filter(Boolean),
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

async function ensureMeetingSourceDocuments(
  ctx: any,
  societyId: string,
  sourceExternalIds: string[],
  sourceCatalog?: Map<string, any>,
) {
  return await ensureImportSourceDocuments(
    ctx,
    societyId,
    sourceExternalIds,
    "Meeting Source",
    "Placeholder source created from a converted meeting-minute import. Review the original source before treating it as the official source.",
    sourceCatalog,
  );
}

async function ensureImportSourceDocuments(
  ctx: any,
  societyId: string,
  sourceExternalIds: string[],
  category: string,
  note: string,
  sourceCatalog?: Map<string, any>,
) {
  const externalIds = unique(sourceExternalIds);
  if (externalIds.length === 0) return [];

  const byExternalId = new Map<string, any>();
  for (const [externalId, source] of sourceCatalog ?? []) {
    if (source?.documentId && !byExternalId.has(externalId)) {
      byExternalId.set(externalId, { _id: source.documentId });
    }
  }
  if (byExternalId.size < externalIds.length) {
    for (const externalId of externalIds) {
      if (byExternalId.has(externalId)) continue;
      const evidence = await ctx.db
        .query("sourceEvidence")
        .withIndex("by_society_external", (q: any) => q.eq("societyId", societyId).eq("externalId", externalId))
        .first();
      if (!evidence?.sourceDocumentId) continue;
      byExternalId.set(externalId, { _id: evidence.sourceDocumentId });
    }
  }
  const ids: any[] = [];
  for (const externalId of externalIds) {
    const existing = byExternalId.get(externalId);
    if (existing) {
      ids.push(existing._id);
      continue;
    }

    const source = sourceCatalog?.get(externalId);
    const externalSystem = cleanText(source?.externalSystem) || sourceSystemFromExternalId(externalId);
    const title = cleanText(source?.title) || fallbackSourceTitle(externalId);
    const sourceCategory = cleanText(source?.category) || category;
    const id = await ctx.db.insert("documents", {
      societyId,
      title,
      category: sourceCategory,
      fileName: cleanText(source?.fileName),
      mimeType: cleanText(source?.mimeType),
      fileSizeBytes: numberOrUndefined(source?.fileSizeBytes),
      url: cleanText(source?.url),
      content: JSON.stringify({
        importedFrom: `${sourceSystemLabel(externalSystem)} transposition`,
        externalSystem,
        externalId,
        title,
        sourceDate: cleanText(source?.sourceDate),
        localPath: cleanText(source?.localPath),
        sha256: cleanText(source?.sha256),
        sensitivity: cleanText(source?.sensitivity),
        tags: arrayOf(source?.tags).map(String),
        confidence: cleanText(source?.confidence) || "Review",
        note: cleanText(source?.notes) || note,
      }),
      createdAtISO: new Date().toISOString(),
      reviewStatus: "in_review",
      librarySection: importedLibrarySection(sourceCategory, arrayOf(source?.sections).map(String)),
      flaggedForDeletion: false,
      tags: [
        `${sourceSystemTag(externalSystem)}-import`,
        "transposed-source",
        tagValue(externalId),
        tagValue(sourceCategory),
        source?.sensitivity === "restricted" ? "restricted" : undefined,
      ].filter(Boolean),
    });
    ids.push(id);
  }
  return ids;
}

async function insertSectionRecord(ctx: any, societyId: string, record: any, sourceDocumentIds: any[]) {
  const payload = normalizePayload(record.recordKind, record.payload ?? {});
  const firstSourceDocumentId = sourceDocumentIds[0];
  const sourceNote = sourceNoteFor(record, sourceDocumentIds);

  if (record.recordKind === "filing") {
    return await ctx.db.insert("filings", {
      societyId,
      kind: cleanText(payload.kind) || "Other",
      periodLabel: cleanText(payload.periodLabel),
      dueDate: cleanDate(payload.dueDate) || cleanDate(payload.filedAt) || cleanDate(payload.sourceDate) || todayDate(),
      filedAt: cleanDate(payload.filedAt),
      submissionMethod: cleanText(payload.submissionMethod),
      confirmationNumber: cleanText(payload.confirmationNumber),
      feePaidCents: numberOrUndefined(payload.feePaidCents),
      receiptDocumentId: firstSourceDocumentId,
      stagedPacketDocumentId: firstSourceDocumentId,
      submissionChecklist: arrayOf(payload.submissionChecklist).map(String),
      registryUrl: cleanText(payload.registryUrl),
      evidenceNotes: sourceNote,
      status: cleanText(payload.status) || "NeedsReview",
      notes: cleanText(payload.notes),
    });
  }

  if (record.recordKind === "deadline") {
    return await ctx.db.insert("deadlines", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported deadline",
      description: sourceNote,
      dueDate: cleanDate(payload.dueDate) || cleanDate(payload.sourceDate) || todayDate(),
      category: cleanText(payload.category) || "Paperless",
      done: Boolean(payload.done),
      recurrence: cleanText(payload.recurrence),
    });
  }

  if (record.recordKind === "bylawAmendment") {
    const now = new Date().toISOString();
    const status = cleanText(payload.status) || "Draft";
    const title = cleanText(payload.title) || record.title || "Imported bylaw amendment";
    const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
    const history = bylawImportHistory(payload, status, sourceExternalIds);
    return await ctx.db.insert("bylawAmendments", {
      societyId,
      title,
      baseText: cleanText(payload.baseText) || "",
      proposedText: cleanText(payload.proposedText) || cleanText(payload.currentText) || "",
      status,
      createdByName: cleanText(payload.createdByName) || cleanText(payload.filedBy) || "Import review",
      createdAtISO: cleanDateTime(payload.createdAtISO) || cleanDateTime(payload.sourceDate) || now,
      updatedAtISO: cleanDateTime(payload.updatedAtISO) || cleanDateTime(payload.filedAtISO) || now,
      consultationStartedAtISO: cleanDateTime(payload.consultationStartedAtISO),
      consultationEndedAtISO: cleanDateTime(payload.consultationEndedAtISO),
      resolutionPassedAtISO: cleanDateTime(payload.resolutionPassedAtISO) || cleanDateTime(payload.specialResolutionDate),
      votesFor: numberOrUndefined(payload.votesFor),
      votesAgainst: numberOrUndefined(payload.votesAgainst),
      abstentions: numberOrUndefined(payload.abstentions),
      filedAtISO: cleanDateTime(payload.filedAtISO) || cleanDateTime(payload.filedAt),
      sourceDocumentIds,
      sourceExternalIds,
      importedFrom: cleanText(payload.importedFrom) || "Import session",
      confidence: confidenceFor(payload),
      notes: sourceNote,
      history,
    });
  }

  if (record.recordKind === "publication") {
    return await ctx.db.insert("publications", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported publication",
      summary: sourceNote,
      category: cleanText(payload.category) || "Custom",
      documentId: firstSourceDocumentId,
      url: cleanText(payload.url),
      publishedAtISO: cleanDate(payload.publishedAtISO) || cleanDate(payload.publishedAt),
      status: cleanText(payload.status) || "Draft",
      reviewStatus: cleanText(payload.reviewStatus) || "InReview",
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "insurancePolicy") {
    const riskFlags = unique([...(record.riskFlags ?? []), ...arrayOf(payload.riskFlags).map(String)])
      .map(cleanText)
      .filter(Boolean);
    return await ctx.db.insert("insurancePolicies", {
      societyId,
      kind: cleanText(payload.kind) || "Other",
      insurer: cleanText(payload.insurer) || "Needs review",
      broker: cleanText(payload.broker),
      policyNumber: cleanText(payload.policyNumber) || "Needs review",
      policySeriesKey: cleanText(payload.policySeriesKey) || insurancePolicySeriesKey(payload),
      policyTermLabel: cleanText(payload.policyTermLabel) || insurancePolicyTermLabel(payload),
      versionType: cleanText(payload.versionType),
      renewalOfPolicyNumber: cleanText(payload.renewalOfPolicyNumber),
      coverageCents: numberOrUndefined(payload.coverageCents),
      premiumCents: numberOrUndefined(payload.premiumCents),
      deductibleCents: numberOrUndefined(payload.deductibleCents),
      coverageSummary: cleanText(payload.coverageSummary),
      additionalInsureds: arrayOf(payload.additionalInsureds).map(String).map(cleanText).filter(Boolean),
      coveredParties: normalizeCoveredParties(payload.coveredParties),
      coverageItems: normalizeCoverageItems(payload.coverageItems),
      coveredLocations: normalizeCoveredLocations(payload.coveredLocations),
      policyDefinitions: normalizePolicyDefinitions(payload.policyDefinitions),
      declinedCoverages: normalizeDeclinedCoverages(payload.declinedCoverages),
      certificatesOfInsurance: normalizeCertificatesOfInsurance(payload.certificatesOfInsurance),
      insuranceRequirements: normalizeInsuranceRequirements(payload.insuranceRequirements),
      claimsMadeTerms: normalizeClaimsMadeTerms(payload.claimsMadeTerms),
      claimIncidents: normalizeClaimIncidents(payload.claimIncidents),
      annualReviews: normalizeAnnualReviews(payload.annualReviews),
      complianceChecks: normalizeComplianceChecks(payload.complianceChecks),
      startDate: cleanDate(payload.startDate) || cleanDate(payload.sourceDate) || todayDate(),
      endDate: cleanDate(payload.endDate),
      renewalDate: cleanDate(payload.renewalDate) || cleanDate(payload.endDate) || cleanDate(payload.sourceDate) || todayDate(),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      confidence: confidenceFor(payload),
      sensitivity: cleanText(payload.sensitivity) || (riskFlags.includes("restricted") ? "restricted" : undefined),
      riskFlags,
      notes: sourceNote,
      status: cleanText(payload.status) || "Active",
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "financialStatement") {
    return await ctx.db.insert("financials", {
      societyId,
      fiscalYear: cleanText(payload.fiscalYear) || fiscalYearFromDate(payload.periodEnd ?? payload.sourceDate),
      periodEnd: cleanDate(payload.periodEnd) || cleanDate(payload.sourceDate) || todayDate(),
      revenueCents: numberOrUndefined(payload.revenueCents) ?? 0,
      expensesCents: numberOrUndefined(payload.expensesCents) ?? 0,
      netAssetsCents: numberOrUndefined(payload.netAssetsCents) ?? 0,
      restrictedFundsCents: numberOrUndefined(payload.restrictedFundsCents),
      auditStatus: cleanText(payload.auditStatus) || "NeedsReview",
      auditorName: cleanText(payload.auditorName),
      approvedByBoardAt: cleanDate(payload.approvedByBoardAt),
      remunerationDisclosures: arrayOf(payload.remunerationDisclosures),
      statementsDocId: firstSourceDocumentId,
    });
  }

  if (record.recordKind === "financialStatementImport") {
    const statementId = await ctx.db.insert("financialStatementImports", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported financial statement",
      fiscalYear: cleanText(payload.fiscalYear) || fiscalYearFromDate(payload.periodEnd ?? payload.sourceDate),
      statementType: cleanText(payload.statementType) || "full_statement",
      periodStart: cleanDate(payload.periodStart),
      periodEnd: cleanDate(payload.periodEnd) || cleanDate(payload.sourceDate) || todayDate(),
      revenueCents: numberOrUndefined(payload.revenueCents),
      expensesCents: numberOrUndefined(payload.expensesCents),
      netAssetsCents: numberOrUndefined(payload.netAssetsCents),
      restrictedFundsCents: numberOrUndefined(payload.restrictedFundsCents),
      status: cleanText(payload.status) || "NeedsReview",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
    for (const line of arrayOf(payload.lines)) {
      await ctx.db.insert("financialStatementImportLines", {
        societyId,
        statementImportId: statementId,
        section: cleanText(line?.section) || "Unclassified",
        label: cleanText(line?.label) || cleanText(line?.description) || "Imported line",
        amountCents: numberOrUndefined(line?.amountCents),
        confidence: confidenceFor(line),
        notes: cleanText(line?.notes),
      });
    }
    return statementId;
  }

  if (record.recordKind === "grant") {
    const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
    const riskFlags = unique([...(record.riskFlags ?? []), ...arrayOf(payload.riskFlags).map(String)])
      .map(cleanText)
      .filter(Boolean);
    const now = new Date().toISOString();
    return await ctx.db.insert("grants", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported grant",
      funder: cleanText(payload.funder) || "Needs review",
      program: cleanText(payload.program),
      status: cleanText(payload.status) || "Drafting",
      amountRequestedCents: numberOrUndefined(payload.amountRequestedCents),
      amountAwardedCents: numberOrUndefined(payload.amountAwardedCents),
      restrictedPurpose: cleanText(payload.restrictedPurpose),
      applicationDueDate: cleanDate(payload.applicationDueDate),
      submittedAtISO: cleanDate(payload.submittedAtISO),
      decisionAtISO: cleanDate(payload.decisionAtISO),
      startDate: cleanDate(payload.startDate),
      endDate: cleanDate(payload.endDate),
      nextReportDueAtISO: cleanDate(payload.nextReportDueAtISO),
      sourceDocumentIds,
      sourceExternalIds,
      confidence: confidenceFor(payload),
      sensitivity: cleanText(payload.sensitivity) || (riskFlags.includes("restricted") ? "restricted" : undefined),
      riskFlags,
      notes: sourceNote,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }

  if (record.recordKind === "recordsLocation") {
    return await ctx.db.insert("recordsLocation", {
      societyId,
      address: cleanText(payload.address) || "Needs review",
      noticePostedAtOffice: Boolean(payload.noticePostedAtOffice),
      postedAtISO: cleanDate(payload.postedAtISO),
      computerProvidedForInspection: Boolean(payload.computerProvidedForInspection),
      notes: sourceNote,
    });
  }

  if (record.recordKind === "archiveAccession") {
    return await ctx.db.insert("archiveAccessions", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported archive accession",
      accessionNumber: cleanText(payload.accessionNumber),
      containerType: cleanText(payload.containerType) || "other",
      location: cleanText(payload.location) || cleanText(payload.address) || "Needs review",
      custodian: cleanText(payload.custodian),
      dateReceived: cleanDate(payload.dateReceived) || cleanDate(payload.sourceDate),
      dateRange: cleanText(payload.dateRange),
      status: cleanText(payload.status) || "NeedsReview",
      accessRestrictions: cleanText(payload.accessRestrictions),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "boardRoleAssignment") {
    const personName = cleanText(payload.personName) || cleanText(payload.name) || "Needs review";
    const personLinks = await resolvePersonLinks(ctx, societyId, personName);
    return await ctx.db.insert("boardRoleAssignments", {
      societyId,
      personName,
      personKey: personKey(personName),
      memberId: personLinks.memberId,
      directorId: personLinks.directorId,
      roleTitle: cleanText(payload.roleTitle) || cleanText(payload.position) || "Director",
      roleGroup: cleanText(payload.roleGroup) || cleanText(payload.committeeName),
      roleType: cleanText(payload.roleType) || "observed",
      startDate: cleanDate(payload.startDate) || cleanDate(payload.sourceDate) || todayDate(),
      endDate: cleanDate(payload.endDate),
      status: cleanText(payload.status) || "Observed",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      importedFrom: cleanText(payload.importedFrom) || "Paperless transposition",
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "boardRoleChange") {
    const personLinks = await resolvePersonLinks(ctx, societyId, payload.personName);
    const previousPersonLinks = await resolvePersonLinks(ctx, societyId, payload.previousPersonName);
    return await ctx.db.insert("boardRoleChanges", {
      societyId,
      effectiveDate: cleanDate(payload.effectiveDate) || cleanDate(payload.sourceDate) || todayDate(),
      changeType: cleanText(payload.changeType) || "needs_review",
      roleTitle: cleanText(payload.roleTitle) || cleanText(payload.position) || "Needs review",
      personName: cleanText(payload.personName),
      previousPersonName: cleanText(payload.previousPersonName),
      memberId: personLinks.memberId,
      directorId: personLinks.directorId,
      previousMemberId: previousPersonLinks.memberId,
      previousDirectorId: previousPersonLinks.directorId,
      motionEvidenceId: cleanText(payload.motionEvidenceId),
      status: cleanText(payload.status) || "NeedsReview",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "signingAuthority") {
    return await ctx.db.insert("signingAuthorities", {
      societyId,
      personName: cleanText(payload.personName) || cleanText(payload.name) || "Needs review",
      roleTitle: cleanText(payload.roleTitle),
      institutionName: cleanText(payload.institutionName) || cleanText(payload.bankName),
      accountLabel: cleanText(payload.accountLabel),
      authorityType: cleanText(payload.authorityType) || "signing",
      effectiveDate: cleanDate(payload.effectiveDate) || cleanDate(payload.sourceDate) || todayDate(),
      endDate: cleanDate(payload.endDate),
      status: cleanText(payload.status) || "NeedsReview",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "meetingAttendance") {
    const personName = cleanText(payload.personName) || cleanText(payload.name) || "Needs review";
    const personLinks = await resolvePersonLinks(ctx, societyId, personName);
    const meetingTarget = await resolveMeetingTargetForEvidence(ctx, societyId, payload, record);
    return await ctx.db.insert("meetingAttendanceRecords", {
      societyId,
      meetingId: meetingTarget?.meetingId,
      minutesId: meetingTarget?.minutesId,
      meetingTitle: cleanText(payload.meetingTitle) || record.title || "Imported meeting",
      meetingDate: cleanDate(payload.meetingDate) || cleanDate(payload.sourceDate) || todayDate(),
      personName,
      memberId: personLinks.memberId,
      directorId: personLinks.directorId,
      roleTitle: cleanText(payload.roleTitle),
      attendanceStatus: cleanText(payload.attendanceStatus) || "needs_review",
      quorumCounted: payload.quorumCounted == null ? undefined : Boolean(payload.quorumCounted),
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "motionEvidence") {
    const movedBy = cleanText(payload.movedBy) || cleanText(payload.movedByName);
    const secondedBy = cleanText(payload.secondedBy) || cleanText(payload.secondedByName);
    const movedByLinks = await resolvePersonLinks(ctx, societyId, movedBy);
    const secondedByLinks = await resolvePersonLinks(ctx, societyId, secondedBy);
    const meetingTarget = await resolveMeetingTargetForEvidence(ctx, societyId, payload, record);
    return await ctx.db.insert("motionEvidence", {
      societyId,
      meetingId: meetingTarget?.meetingId,
      minutesId: meetingTarget?.minutesId,
      meetingTitle: cleanText(payload.meetingTitle) || record.title || "Imported meeting",
      meetingDate: cleanDate(payload.meetingDate) || cleanDate(payload.sourceDate) || todayDate(),
      motionText: cleanText(payload.motionText) || cleanText(payload.evidenceText) || "Imported motion evidence",
      movedBy,
      movedByMemberId: movedByLinks.memberId,
      movedByDirectorId: movedByLinks.directorId,
      secondedBy,
      secondedByMemberId: secondedByLinks.memberId,
      secondedByDirectorId: secondedByLinks.directorId,
      outcome: cleanText(payload.outcome) || "NeedsReview",
      voteSummary: cleanText(payload.voteSummary),
      pageRef: cleanText(payload.pageRef),
      evidenceText: cleanText(payload.evidenceText),
      confidence: confidenceFor(payload),
      status: cleanText(payload.status) || "Extracted",
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "budgetSnapshot") {
    const snapshotId = await ctx.db.insert("budgetSnapshots", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported budget snapshot",
      fiscalYear: cleanText(payload.fiscalYear) || fiscalYearFromDate(payload.sourceDate),
      periodLabel: cleanText(payload.periodLabel),
      sourceDate: cleanDate(payload.sourceDate),
      currency: cleanText(payload.currency) || "CAD",
      totalIncomeCents: numberOrUndefined(payload.totalIncomeCents),
      totalExpenseCents: numberOrUndefined(payload.totalExpenseCents),
      netCents: numberOrUndefined(payload.netCents),
      endingBalanceCents: numberOrUndefined(payload.endingBalanceCents),
      preparedByName: cleanText(payload.preparedByName),
      lastModifiedDate: cleanDate(payload.lastModifiedDate),
      sourcePageCount: numberOrUndefined(payload.sourcePageCount),
      importGroupKey: cleanText(payload.importGroupKey),
      status: cleanText(payload.status) || "NeedsReview",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
    for (const line of arrayOf(payload.lines)) {
      await ctx.db.insert("budgetSnapshotLines", {
        societyId,
        snapshotId,
        lineType: cleanText(line?.lineType) || cleanText(line?.type) || "note",
        category: cleanText(line?.category) || "Unclassified",
        parentCategory: cleanText(line?.parentCategory),
        rowKind: cleanText(line?.rowKind) || cleanText(line?.lineType),
        sortOrder: numberOrUndefined(line?.sortOrder),
        description: cleanText(line?.description),
        amountCents: numberOrUndefined(line?.amountCents),
        projectedCents: numberOrUndefined(line?.projectedCents),
        ytdCents: numberOrUndefined(line?.ytdCents),
        sourcePage: cleanText(line?.sourcePage),
        rawLabel: cleanText(line?.rawLabel),
        rawAmountText: cleanText(line?.rawAmountText),
        confidence: confidenceFor(line),
        notes: cleanText(line?.notes),
      });
    }
    return snapshotId;
  }

  if (record.recordKind === "treasurerReport") {
    return await ctx.db.insert("treasurerReports", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported treasurer report",
      fiscalYear: cleanText(payload.fiscalYear) || fiscalYearFromDate(payload.reportDate ?? payload.sourceDate),
      reportDate: cleanDate(payload.reportDate) || cleanDate(payload.sourceDate) || todayDate(),
      authorName: cleanText(payload.authorName),
      cashBalanceCents: numberOrUndefined(payload.cashBalanceCents),
      highlights: arrayOf(payload.highlights).map(String),
      concerns: arrayOf(payload.concerns).map(String),
      status: cleanText(payload.status) || "NeedsReview",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "transactionCandidate") {
    return await ctx.db.insert("transactionCandidates", {
      societyId,
      transactionDate: cleanDate(payload.transactionDate) || cleanDate(payload.sourceDate) || todayDate(),
      importGroupKey: cleanText(payload.importGroupKey),
      periodLabel: cleanText(payload.periodLabel),
      sourcePage: cleanText(payload.sourcePage),
      rowOrder: numberOrUndefined(payload.rowOrder),
      description: cleanText(payload.description) || record.title || "Imported transaction candidate",
      amountCents: numberOrUndefined(payload.amountCents),
      debitCents: numberOrUndefined(payload.debitCents),
      creditCents: numberOrUndefined(payload.creditCents),
      balanceCents: numberOrUndefined(payload.balanceCents),
      chequeNumber: cleanText(payload.chequeNumber) || cleanText(payload.checkNumber),
      comment: cleanText(payload.comment),
      rawText: cleanText(payload.rawText),
      accountName: cleanText(payload.accountName),
      counterparty: cleanText(payload.counterparty),
      category: cleanText(payload.category),
      debitCredit: cleanText(payload.debitCredit),
      status: cleanText(payload.status) || "NeedsReview",
      sensitivity: cleanText(payload.sensitivity) || "restricted",
      confidence: confidenceFor(payload),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "organizationAddress") {
    return await ctx.db.insert("organizationAddresses", {
      societyId,
      type: cleanText(payload.type) || "other",
      status: cleanText(payload.status) || "needs_review",
      effectiveFrom: cleanDate(payload.effectiveFrom),
      effectiveTo: cleanDate(payload.effectiveTo),
      street: cleanText(payload.street) || cleanText(payload.address) || "Needs review",
      unit: cleanText(payload.unit),
      city: cleanText(payload.city) || "Needs review",
      provinceState: cleanText(payload.provinceState) || cleanText(payload.province),
      postalCode: cleanText(payload.postalCode),
      country: cleanText(payload.country) || "Canada",
      sourceDocumentIds,
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "organizationRegistration") {
    return await ctx.db.insert("organizationRegistrations", {
      societyId,
      jurisdiction: cleanText(payload.jurisdiction) || "Needs review",
      assumedName: cleanText(payload.assumedName),
      registrationNumber: cleanText(payload.registrationNumber),
      registrationDate: cleanDate(payload.registrationDate),
      activityCommencementDate: cleanDate(payload.activityCommencementDate),
      deRegistrationDate: cleanDate(payload.deRegistrationDate),
      nuansNumber: cleanText(payload.nuansNumber),
      officialEmail: cleanText(payload.officialEmail),
      representativeIds: arrayOf(payload.representativeIds).map(String).map(cleanText).filter(Boolean),
      status: cleanText(payload.status) || "needs_review",
      sourceDocumentIds,
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "organizationIdentifier") {
    return await ctx.db.insert("organizationIdentifiers", {
      societyId,
      kind: cleanText(payload.kind) || cleanText(payload.type) || "other",
      number: cleanText(payload.number) || "Needs review",
      jurisdiction: cleanText(payload.jurisdiction),
      foreignJurisdiction: cleanText(payload.foreignJurisdiction),
      registeredAt: cleanDate(payload.registeredAt) || cleanDate(payload.registrationDate),
      status: cleanText(payload.status) || "needs_review",
      accessLevel: cleanText(payload.accessLevel) || "restricted",
      sourceDocumentIds,
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "policy") {
    return await ctx.db.insert("policies", {
      societyId,
      policyName: cleanText(payload.policyName) || cleanText(payload.name) || record.title || "Imported policy",
      policyNumber: cleanText(payload.policyNumber),
      owner: cleanText(payload.owner),
      effectiveDate: cleanDate(payload.effectiveDate),
      reviewDate: cleanDate(payload.reviewDate),
      ceasedDate: cleanDate(payload.ceasedDate),
      docxDocumentId: cleanText(payload.docxDocumentId) as any,
      pdfDocumentId: cleanText(payload.pdfDocumentId) as any,
      html: cleanText(payload.html),
      requiredSigners: arrayOf(payload.requiredSigners).map(String).map(cleanText).filter(Boolean),
      signatureRequired: Boolean(payload.signatureRequired),
      jurisdictions: arrayOf(payload.jurisdictions).map(String).map(cleanText).filter(Boolean),
      entityTypes: arrayOf(payload.entityTypes).map(String).map(cleanText).filter(Boolean),
      status: cleanText(payload.status) || "Draft",
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "workflowPackage") {
    return await ctx.db.insert("workflowPackages", {
      societyId,
      workflowId: cleanText(payload.workflowId) as any,
      workflowRunId: cleanText(payload.workflowRunId) as any,
      eventType: cleanText(payload.eventType) || "custom.event",
      effectiveDate: cleanDate(payload.effectiveDate),
      status: cleanText(payload.status) || "draft",
      packageName: cleanText(payload.packageName) || cleanText(payload.package) || record.title || "Imported package",
      parts: arrayOf(payload.parts).map(String).map(cleanText).filter(Boolean),
      notes: sourceNote,
      supportingDocumentIds: sourceDocumentIds,
      priceItems: arrayOf(payload.priceItems).map(String).map(cleanText).filter(Boolean),
      transactionId: cleanText(payload.transactionId),
      signerRoster: arrayOf(payload.signerRoster).map(String).map(cleanText).filter(Boolean),
      signerEmails: arrayOf(payload.signerEmails).map(String).map(cleanText).filter(Boolean),
      signingPackageIds: arrayOf(payload.signingPackageIds).map(String).map(cleanText).filter(Boolean),
      stripeCheckoutSessionId: cleanText(payload.stripeCheckoutSessionId),
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "minuteBookItem") {
    return await ctx.db.insert("minuteBookItems", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported minute book record",
      recordType: cleanText(payload.recordType) || cleanText(payload.type) || "imported_record",
      effectiveDate: cleanDate(payload.effectiveDate) || cleanDate(payload.sourceDate),
      status: cleanText(payload.status) || "NeedsReview",
      documentIds: sourceDocumentIds,
      meetingId: cleanText(payload.meetingId) as any,
      minutesId: cleanText(payload.minutesId) as any,
      filingId: cleanText(payload.filingId) as any,
      policyId: cleanText(payload.policyId) as any,
      workflowPackageId: cleanText(payload.workflowPackageId) as any,
      signatureIds: [],
      sourceEvidenceIds: [],
      archivedAtISO: cleanDate(payload.archivedAtISO),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "roleHolder") {
    return await ctx.db.insert("roleHolders", {
      societyId,
      roleType: cleanText(payload.roleType) || cleanText(payload.type) || cleanText(payload.role) || "authorized_representative",
      status: cleanText(payload.status) || "needs_review",
      fullName: cleanText(payload.fullName) || cleanText(payload.name) || [payload.firstName, payload.lastName].map(cleanText).filter(Boolean).join(" ") || "Imported role holder",
      firstName: cleanText(payload.firstName),
      middleName: cleanText(payload.middleName),
      lastName: cleanText(payload.lastName),
      email: cleanText(payload.email),
      phone: cleanText(payload.phone),
      signerTag: cleanText(payload.signerTag),
      membershipId: cleanText(payload.membershipId),
      membershipClassName: cleanText(payload.membershipClassName) || cleanText(payload.membershipClass),
      membershipClassId: cleanText(payload.membershipClassId) as any,
      officerTitle: cleanText(payload.officerTitle) || cleanText(payload.title),
      directorTerm: cleanText(payload.directorTerm) || cleanText(payload.term),
      startDate: cleanDate(payload.startDate),
      endDate: cleanDate(payload.endDate),
      referenceDate: cleanDate(payload.referenceDate),
      street: cleanText(payload.street) || cleanText(payload.address),
      unit: cleanText(payload.unit),
      city: cleanText(payload.city),
      provinceState: cleanText(payload.provinceState) || cleanText(payload.province),
      postalCode: cleanText(payload.postalCode),
      country: cleanText(payload.country),
      alternateStreet: cleanText(payload.alternateStreet) || cleanText(payload.alternateAddress),
      alternateUnit: cleanText(payload.alternateUnit),
      alternateCity: cleanText(payload.alternateCity),
      alternateProvinceState: cleanText(payload.alternateProvinceState) || cleanText(payload.alternateProvince),
      alternatePostalCode: cleanText(payload.alternatePostalCode),
      alternateCountry: cleanText(payload.alternateCountry),
      serviceStreet: cleanText(payload.serviceStreet) || cleanText(payload.serviceAddress),
      serviceUnit: cleanText(payload.serviceUnit),
      serviceCity: cleanText(payload.serviceCity),
      serviceProvinceState: cleanText(payload.serviceProvinceState) || cleanText(payload.serviceProvince),
      servicePostalCode: cleanText(payload.servicePostalCode),
      serviceCountry: cleanText(payload.serviceCountry),
      ageOver18: optionalBoolean(payload.ageOver18 ?? payload.age18OrGreater),
      dateOfBirth: cleanDate(payload.dateOfBirth ?? payload.dob),
      occupation: cleanText(payload.occupation),
      citizenshipResidency: cleanText(payload.citizenshipResidency),
      citizenshipCountries: arrayOf(payload.citizenshipCountries ?? payload.citizenship).map(String).map(cleanText).filter(Boolean),
      taxResidenceCountries: arrayOf(payload.taxResidenceCountries ?? payload.taxResidence).map(String).map(cleanText).filter(Boolean),
      nonNaturalPerson: optionalBoolean(payload.nonNaturalPerson),
      nonNaturalPersonType: cleanText(payload.nonNaturalPersonType),
      nonNaturalJurisdiction: cleanText(payload.nonNaturalJurisdiction),
      natureOfControl: cleanText(payload.natureOfControl),
      authorizedRepresentative: optionalBoolean(payload.authorizedRepresentative),
      relatedRoleHolderId: cleanText(payload.relatedRoleHolderId) as any,
      relatedShareholderIds: arrayOf(payload.relatedShareholderIds).map(String).map(cleanText).filter(Boolean),
      controllingIndividualIds: arrayOf(payload.controllingIndividualIds).map(String).map(cleanText).filter(Boolean),
      extraProvincialRegistrationId: cleanText(payload.extraProvincialRegistrationId) as any,
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "rightsClass") {
    return await ctx.db.insert("rightsClasses", {
      societyId,
      className: cleanText(payload.className) || cleanText(payload.name) || cleanText(payload.rightsClassName) || "Imported rights class",
      classType: cleanText(payload.classType) || cleanText(payload.type) || "membership",
      status: cleanText(payload.status) || "needs_review",
      idPrefix: cleanText(payload.idPrefix),
      highestAssignedNumber: numberOrUndefined(payload.highestAssignedNumber),
      votingRights: cleanText(payload.votingRights),
      startDate: cleanDate(payload.startDate),
      endDate: cleanDate(payload.endDate),
      conditionsToHold: cleanText(payload.conditionsToHold),
      conditionsToTransfer: cleanText(payload.conditionsToTransfer),
      conditionsForRemoval: cleanText(payload.conditionsForRemoval ?? payload.conditionsToRemove),
      otherProvisions: cleanText(payload.otherProvisions),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "rightsholdingTransfer") {
    return await ctx.db.insert("rightsholdingTransfers", {
      societyId,
      transferType: cleanText(payload.transferType) || cleanText(payload.type) || "transfer",
      status: cleanText(payload.status) || "needs_review",
      transferDate: cleanDate(payload.transferDate) || cleanDate(payload.date),
      eventId: cleanText(payload.eventId) || cleanText(payload.relatedEventId),
      precedentRunId: cleanText(payload.precedentRunId) as any,
      rightsClassId: cleanText(payload.rightsClassId) as any,
      sourceRoleHolderId: cleanText(payload.sourceRoleHolderId) as any,
      destinationRoleHolderId: cleanText(payload.destinationRoleHolderId) as any,
      sourceHolderName: cleanText(payload.sourceHolderName) || cleanText(payload.sourceShareholder),
      destinationHolderName: cleanText(payload.destinationHolderName) || cleanText(payload.destinationShareholder),
      quantity: numberOrUndefined(payload.quantity),
      considerationType: cleanText(payload.considerationType),
      considerationDescription: cleanText(payload.considerationDescription),
      priceToOrganizationCents: numberOrUndefined(payload.priceToOrganizationCents ?? payload.priceToCorpCents),
      priceToOrganizationCurrency: cleanText(payload.priceToOrganizationCurrency ?? payload.priceToCorpCurrency),
      priceToVendorCents: numberOrUndefined(payload.priceToVendorCents),
      priceToVendorCurrency: cleanText(payload.priceToVendorCurrency),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "legalTemplateDataField") {
    return await ctx.db.insert("legalTemplateDataFields", {
      societyId,
      name: cleanText(payload.name) || cleanText(payload.fieldName) || "Imported data field",
      label: cleanText(payload.label),
      fieldType: cleanText(payload.fieldType) || cleanText(payload.type),
      number: numberOrUndefined(payload.number),
      dynamicIndicator: cleanText(payload.dynamicIndicator),
      required: optionalBoolean(payload.required),
      reviewRequired: optionalBoolean(payload.reviewRequired),
      notes: sourceNote,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "legalTemplate") {
    return await ctx.db.insert("legalTemplates", {
      societyId,
      templateType: cleanText(payload.templateType) || cleanText(payload.type) || "document",
      name: cleanText(payload.name) || cleanText(payload.templateName) || record.title || "Imported template",
      status: cleanText(payload.status) || "needs_review",
      templateDocumentId: cleanText(payload.templateDocumentId) as any,
      docxDocumentId: cleanText(payload.docxDocumentId) as any,
      pdfDocumentId: cleanText(payload.pdfDocumentId) as any,
      html: cleanText(payload.html),
      notes: sourceNote,
      owner: cleanText(payload.owner),
      ownerIsTobuso: optionalBoolean(payload.ownerIsTobuso),
      signatureRequired: optionalBoolean(payload.signatureRequired),
      documentTag: cleanText(payload.documentTag),
      entityTypes: arrayOf(payload.entityTypes).map(String).map(cleanText).filter(Boolean),
      jurisdictions: arrayOf(payload.jurisdictions).map(String).map(cleanText).filter(Boolean),
      requiredSigners: arrayOf(payload.requiredSigners).map(String).map(cleanText).filter(Boolean),
      requiredDataFieldIds: arrayOf(payload.requiredDataFieldIds).map(String).map(cleanText).filter(Boolean) as any,
      optionalDataFieldIds: arrayOf(payload.optionalDataFieldIds).map(String).map(cleanText).filter(Boolean) as any,
      reviewDataFieldIds: arrayOf(payload.reviewDataFieldIds).map(String).map(cleanText).filter(Boolean) as any,
      requiredDataFields: arrayOf(payload.requiredDataFields).map(String).map(cleanText).filter(Boolean),
      optionalDataFields: arrayOf(payload.optionalDataFields).map(String).map(cleanText).filter(Boolean),
      reviewDataFields: arrayOf(payload.reviewDataFields).map(String).map(cleanText).filter(Boolean),
      timeline: cleanText(payload.timeline),
      deliverable: cleanText(payload.deliverable),
      terms: cleanText(payload.terms),
      filingType: cleanText(payload.filingType),
      priceItems: arrayOf(payload.priceItems).map(String).map(cleanText).filter(Boolean),
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "legalPrecedent") {
    return await ctx.db.insert("legalPrecedents", {
      societyId,
      packageName: cleanText(payload.packageName) || cleanText(payload.name) || record.title || "Imported precedent",
      partType: cleanText(payload.partType),
      status: cleanText(payload.status) || "needs_review",
      description: cleanText(payload.description),
      shortDescription: cleanText(payload.shortDescription),
      timeline: cleanText(payload.timeline),
      deliverables: cleanText(payload.deliverables),
      internalNotes: cleanText(payload.internalNotes),
      addOnTerms: cleanText(payload.addOnTerms),
      templateIds: arrayOf(payload.templateIds).map(String).map(cleanText).filter(Boolean) as any,
      templateNames: arrayOf(payload.templateNames ?? payload.templates).map(String).map(cleanText).filter(Boolean),
      templateFilingNames: arrayOf(payload.templateFilingNames).map(String).map(cleanText).filter(Boolean),
      templateSearchNames: arrayOf(payload.templateSearchNames).map(String).map(cleanText).filter(Boolean),
      templateRegistrationNames: arrayOf(payload.templateRegistrationNames).map(String).map(cleanText).filter(Boolean),
      requiresAmendmentRecord: optionalBoolean(payload.requiresAmendmentRecord),
      requiresAnnualMaintenanceRecord: optionalBoolean(payload.requiresAnnualMaintenanceRecord),
      priceItems: arrayOf(payload.priceItems).map(String).map(cleanText).filter(Boolean),
      entityTypes: arrayOf(payload.entityTypes).map(String).map(cleanText).filter(Boolean),
      jurisdictions: arrayOf(payload.jurisdictions).map(String).map(cleanText).filter(Boolean),
      subloopPairs: arrayOf(payload.subloopPairs),
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "legalPrecedentRun") {
    return await ctx.db.insert("legalPrecedentRuns", {
      societyId,
      name: cleanText(payload.name) || cleanText(payload.partName) || record.title || "Imported package run",
      status: cleanText(payload.status) || "needs_review",
      precedentId: cleanText(payload.precedentId) as any,
      eventId: cleanText(payload.eventId) || cleanText(payload.relatedEventId),
      dateTime: cleanDateTime(payload.dateTime) || cleanDateTime(payload.createdAtISO),
      dataJson: typeof payload.dataJson === "string" ? payload.dataJson : payload.dataJson != null ? JSON.stringify(payload.dataJson) : undefined,
      dataJsonList: arrayOf(payload.dataJsonList),
      dataReviewed: optionalBoolean(payload.dataReviewed),
      externalNotes: cleanText(payload.externalNotes),
      searchIds: arrayOf(payload.searchIds).map(String).map(cleanText).filter(Boolean),
      registrationIds: arrayOf(payload.registrationIds).map(String).map(cleanText).filter(Boolean),
      filingIds: arrayOf(payload.filingIds).map(String).map(cleanText).filter(Boolean) as any,
      generatedDocumentIds: arrayOf(payload.generatedDocumentIds).map(String).map(cleanText).filter(Boolean) as any,
      signerRoleHolderIds: arrayOf(payload.signerRoleHolderIds).map(String).map(cleanText).filter(Boolean) as any,
      priceItems: arrayOf(payload.priceItems).map(String).map(cleanText).filter(Boolean),
      abstainingDirectorIds: arrayOf(payload.abstainingDirectorIds).map(String).map(cleanText).filter(Boolean),
      abstainingRightsholderIds: arrayOf(payload.abstainingRightsholderIds).map(String).map(cleanText).filter(Boolean),
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "generatedLegalDocument") {
    return await ctx.db.insert("generatedLegalDocuments", {
      societyId,
      title: cleanText(payload.title) || cleanText(payload.documentName) || record.title || "Imported generated document",
      status: cleanText(payload.status) || "needs_review",
      draftDocumentId: cleanText(payload.draftDocumentId) as any,
      signedDocumentId: cleanText(payload.signedDocumentId) as any,
      draftFileUrl: cleanText(payload.draftFileUrl) || cleanText(payload.draftUrl),
      sourceTemplateId: cleanText(payload.sourceTemplateId) as any,
      sourceTemplateName: cleanText(payload.sourceTemplateName),
      precedentRunId: cleanText(payload.precedentRunId) as any,
      eventId: cleanText(payload.eventId) || cleanText(payload.relatedEventId),
      effectiveDate: cleanDate(payload.effectiveDate),
      documentTag: cleanText(payload.documentTag),
      dataJson: typeof payload.dataJson === "string" ? payload.dataJson : payload.dataJson != null ? JSON.stringify(payload.dataJson) : undefined,
      subloopJsonList: arrayOf(payload.subloopJsonList ?? payload.subloops),
      syngrafiiFileId: cleanText(payload.syngrafiiFileId),
      syngrafiiDocumentId: cleanText(payload.syngrafiiDocumentId),
      syngrafiiPackageId: cleanText(payload.syngrafiiPackageId),
      signersRequiredRoleHolderIds: arrayOf(payload.signersRequiredRoleHolderIds).map(String).map(cleanText).filter(Boolean) as any,
      signersWhoSignedIds: arrayOf(payload.signersWhoSignedIds).map(String).map(cleanText).filter(Boolean) as any,
      signerTagsRequired: arrayOf(payload.signerTagsRequired ?? payload.signersRequired).map(String).map(cleanText).filter(Boolean),
      signerTagsSigned: arrayOf(payload.signerTagsSigned ?? payload.signersWhoSigned).map(String).map(cleanText).filter(Boolean),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "legalSigner") {
    return await ctx.db.insert("legalSigners", {
      societyId,
      status: cleanText(payload.status) || cleanText(payload.signerStatus) || "needs_review",
      fullName: cleanText(payload.fullName) || cleanText(payload.name) || [payload.firstName, payload.lastName].map(cleanText).filter(Boolean).join(" ") || "Imported signer",
      firstName: cleanText(payload.firstName),
      lastName: cleanText(payload.lastName),
      email: cleanText(payload.email),
      phone: cleanText(payload.phone),
      signerId: cleanText(payload.signerId),
      signerTag: cleanText(payload.signerTag),
      eventId: cleanText(payload.eventId) || cleanText(payload.relatedEventId),
      generatedDocumentId: cleanText(payload.generatedDocumentId) as any,
      roleHolderId: cleanText(payload.roleHolderId) as any,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "formationRecord") {
    return await ctx.db.insert("formationRecords", {
      societyId,
      status: cleanText(payload.status) || "needs_review",
      statusNumber: numberOrUndefined(payload.statusNumber),
      logStartDate: cleanDate(payload.logStartDate),
      nuansDate: cleanDate(payload.nuansDate),
      nuansNumber: cleanText(payload.nuansNumber),
      relatedUserId: cleanText(payload.relatedUserId) as any,
      addressRental: optionalBoolean(payload.addressRental),
      stepDataInput: cleanText(payload.stepDataInput),
      assignedStaffIds: arrayOf(payload.assignedStaffIds).map(String).map(cleanText).filter(Boolean),
      signingPackageIds: arrayOf(payload.signingPackageIds).map(String).map(cleanText).filter(Boolean),
      articlesRestrictionOnActivities: cleanText(payload.articlesRestrictionOnActivities),
      purposeStatement: cleanText(payload.purposeStatement),
      additionalProvisions: cleanText(payload.additionalProvisions),
      classesOfMembership: cleanText(payload.classesOfMembership),
      distributionOfProperty: cleanText(payload.distributionOfProperty),
      draftDocumentIds: arrayOf(payload.draftDocumentIds).map(String).map(cleanText).filter(Boolean) as any,
      supportingDocumentIds: sourceDocumentIds,
      relatedIncorporationEventId: cleanText(payload.relatedIncorporationEventId),
      relatedOrganizingEventId: cleanText(payload.relatedOrganizingEventId),
      priceItems: arrayOf(payload.priceItems).map(String).map(cleanText).filter(Boolean),
      jurisdiction: cleanText(payload.jurisdiction),
      extraProvincialRegistrationJurisdiction: cleanText(payload.extraProvincialRegistrationJurisdiction),
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "nameSearchItem") {
    return await ctx.db.insert("nameSearchItems", {
      societyId,
      formationRecordId: cleanText(payload.formationRecordId) as any,
      name: cleanText(payload.name) || record.title || "Imported name search",
      success: optionalBoolean(payload.success),
      errors: arrayOf(payload.errors).map(String).map(cleanText).filter(Boolean),
      reportUrl: cleanText(payload.reportUrl) || cleanText(payload.reportLink),
      reportDocumentId: cleanText(payload.reportDocumentId) as any,
      rank: numberOrUndefined(payload.rank),
      expressService: optionalBoolean(payload.expressService),
      descriptiveElement: cleanText(payload.descriptiveElement),
      distinctiveElement: cleanText(payload.distinctiveElement),
      nuansReportNumber: cleanText(payload.nuansReportNumber),
      suffix: cleanText(payload.suffix),
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "entityAmendment") {
    return await ctx.db.insert("entityAmendments", {
      societyId,
      status: cleanText(payload.status) || "needs_review",
      effectiveDate: cleanDate(payload.effectiveDate),
      entityNameNew: cleanText(payload.entityNameNew) || cleanText(payload.newEntityName),
      directorsMinimum: numberOrUndefined(payload.directorsMinimum),
      directorsMaximum: numberOrUndefined(payload.directorsMaximum),
      relatedPrecedentRunId: cleanText(payload.relatedPrecedentRunId) as any,
      shareClassAmendmentText: cleanText(payload.shareClassAmendmentText),
      jurisdictionNew: cleanText(payload.jurisdictionNew) || cleanText(payload.newJurisdiction),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "annualMaintenanceRecord") {
    return await ctx.db.insert("annualMaintenanceRecords", {
      societyId,
      status: cleanText(payload.status) || "needs_review",
      yearFilingFor: cleanText(payload.yearFilingFor) || cleanText(payload.filingYear),
      lastAgmDate: cleanDate(payload.lastAgmDate),
      filingDate: cleanDate(payload.filingDate),
      draftFilingDocumentId: cleanText(payload.draftFilingDocumentId) as any,
      signedFilingDocumentId: cleanText(payload.signedFilingDocumentId) as any,
      processedFilingDocumentId: cleanText(payload.processedFilingDocumentId) as any,
      relatedPrecedentRunId: cleanText(payload.relatedPrecedentRunId) as any,
      filingId: cleanText(payload.filingId) as any,
      keyVaultItemId: cleanText(payload.keyVaultItemId) as any,
      templateFilingId: cleanText(payload.templateFilingId) as any,
      authorizingPhone: cleanText(payload.authorizingPhone),
      authorizingRoleHolderId: cleanText(payload.authorizingRoleHolderId) as any,
      financialStatementsDocumentId: cleanText(payload.financialStatementsDocumentId) as any,
      fiscalYearEndDate: cleanDate(payload.fiscalYearEndDate),
      incomeTaxReturnDate: cleanDate(payload.incomeTaxReturnDate),
      annualFinancialStatementType: cleanText(payload.annualFinancialStatementType),
      financialStatementReportDate: cleanDate(payload.financialStatementReportDate),
      financialStatementReportType: cleanText(payload.financialStatementReportType),
      auditedFinancialStatements: optionalBoolean(payload.auditedFinancialStatements),
      auditedFinancialStatementsNextYear: optionalBoolean(payload.auditedFinancialStatementsNextYear),
      annualFinancialsEngagementLevel: cleanText(payload.annualFinancialsEngagementLevel),
      annualFinancialStatementOption: cleanText(payload.annualFinancialStatementOption),
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "jurisdictionMetadata") {
    return await ctx.db.insert("jurisdictionMetadata", {
      jurisdiction: cleanText(payload.jurisdiction) || cleanText(payload.value) || "foreign",
      label: cleanText(payload.label) || cleanText(payload.jurisdiction) || "Imported jurisdiction",
      actFormedUnder: cleanText(payload.actFormedUnder),
      nuansJurisdictionNumber: cleanText(payload.nuansJurisdictionNumber),
      nuansReservationReportTypeId: cleanText(payload.nuansReservationReportTypeId),
      incorporationServiceEligible: optionalBoolean(payload.incorporationServiceEligible),
      sourceOptionId: cleanText(payload.sourceOptionId) || cleanText(payload.id),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "supportLog") {
    return await ctx.db.insert("supportLogs", {
      societyId,
      logType: cleanText(payload.logType) || cleanText(payload.type) || "edit",
      severity: cleanText(payload.severity) || (cleanText(payload.errorMessage) ? "error" : "info"),
      page: cleanText(payload.page),
      pageLocationUrl: cleanText(payload.pageLocationUrl) || cleanText(payload.url),
      userId: cleanText(payload.userId) as any,
      relatedUserId: cleanText(payload.relatedUserId) as any,
      relatedEventId: cleanText(payload.relatedEventId),
      relatedEntityId: cleanText(payload.relatedEntityId) as any,
      relatedSubscriptionId: cleanText(payload.relatedSubscriptionId),
      relatedIncorporationId: cleanText(payload.relatedIncorporationId),
      errorCode: cleanText(payload.errorCode),
      errorMessage: cleanText(payload.errorMessage),
      detailsHeading: cleanText(payload.detailsHeading),
      detailsBody: cleanText(payload.detailsBody),
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      createdAtISO: cleanDateTime(payload.createdAtISO) || new Date().toISOString(),
    });
  }

  if (record.recordKind === "sourceEvidence") {
    const externalId = cleanText(payload.externalId) || cleanText(payload.sourceExternalIds?.[0]);
    return await ctx.db.insert("sourceEvidence", {
      societyId,
      sourceDocumentId: firstSourceDocumentId,
      externalSystem: cleanText(payload.externalSystem) || sourceSystemFromExternalId(externalId),
      externalId,
      sourceTitle: cleanText(payload.sourceTitle) || cleanText(payload.title) || record.title || "Imported source evidence",
      sourceDate: cleanDate(payload.sourceDate),
      evidenceKind: cleanText(payload.evidenceKind) || "provenance",
      targetTable: cleanText(payload.targetTable),
      targetId: cleanText(payload.targetId),
      sensitivity: cleanText(payload.sensitivity) || "standard",
      accessLevel: cleanText(payload.accessLevel) || (payload.sensitivity === "restricted" ? "restricted" : "internal"),
      summary: cleanText(payload.summary) || sourceNote || "Imported source evidence",
      excerpt: payload.sensitivity === "restricted" ? undefined : cleanText(payload.excerpt),
      status: cleanText(payload.status) || "NeedsReview",
      notes: cleanText(payload.notes),
      createdAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "secretVaultItem") {
    return await ctx.db.insert("secretVaultItems", {
      societyId,
      name: cleanText(payload.name) || cleanText(payload.title) || record.title || "Imported secret reference",
      service: cleanText(payload.service) || "Needs review",
      credentialType: cleanText(payload.credentialType) || "other",
      ownerRole: cleanText(payload.ownerRole),
      custodianPersonName: cleanText(payload.custodianPersonName) || cleanText(payload.custodianName) || cleanText(payload.ownerName),
      custodianEmail: cleanText(payload.custodianEmail),
      backupCustodianName: cleanText(payload.backupCustodianName),
      backupCustodianEmail: cleanText(payload.backupCustodianEmail),
      username: cleanText(payload.username),
      accessUrl: cleanText(payload.accessUrl),
      storageMode: cleanText(payload.storageMode) || "external_reference",
      externalLocation: cleanText(payload.externalLocation) || cleanText(payload.localPath),
      revealPolicy: cleanText(payload.revealPolicy) || "owner_admin_custodian",
      lastVerifiedAtISO: cleanDate(payload.lastVerifiedAtISO),
      rotationDueAtISO: cleanDate(payload.rotationDueAtISO),
      status: cleanText(payload.status) || "NeedsReview",
      sensitivity: cleanText(payload.sensitivity) || "restricted",
      accessLevel: cleanText(payload.accessLevel) || "restricted",
      sourceDocumentIds,
      sourceExternalIds: unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]),
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
  }

  if (record.recordKind === "pipaTraining") {
    return await ctx.db.insert("pipaTrainings", {
      societyId,
      participantName: cleanText(payload.participantName) || "Needs review",
      role: cleanText(payload.role) || "Staff",
      participantEmail: cleanText(payload.participantEmail),
      topic: cleanText(payload.topic) || "PIPA",
      completedAtISO: cleanDate(payload.completedAtISO) || cleanDate(payload.sourceDate) || todayDate(),
      nextDueAtISO: cleanDate(payload.nextDueAtISO),
      trainer: cleanText(payload.trainer),
      documentId: firstSourceDocumentId,
      notes: sourceNote,
    });
  }

  if (record.recordKind === "employee") {
    const name = splitName(cleanText(payload.name) || `${payload.firstName ?? ""} ${payload.lastName ?? ""}`);
    return await ctx.db.insert("employees", {
      societyId,
      firstName: cleanText(payload.firstName) || name.firstName || "Needs",
      lastName: cleanText(payload.lastName) || name.lastName || "Review",
      email: cleanText(payload.email),
      role: cleanText(payload.role) || "Needs review",
      startDate: cleanDate(payload.startDate) || cleanDate(payload.sourceDate) || todayDate(),
      endDate: cleanDate(payload.endDate),
      employmentType: cleanText(payload.employmentType) || "Contractor",
      annualSalaryCents: numberOrUndefined(payload.annualSalaryCents),
      hourlyWageCents: numberOrUndefined(payload.hourlyWageCents),
      worksafeBCNumber: cleanText(payload.worksafeBCNumber),
      cppExempt: Boolean(payload.cppExempt),
      eiExempt: Boolean(payload.eiExempt),
      notes: sourceNote,
    });
  }

  if (record.recordKind === "volunteer") {
    const name = splitName(cleanText(payload.name) || `${payload.firstName ?? ""} ${payload.lastName ?? ""}`);
    return await ctx.db.insert("volunteers", {
      societyId,
      firstName: cleanText(payload.firstName) || name.firstName || "Needs",
      lastName: cleanText(payload.lastName) || name.lastName || "Review",
      email: cleanText(payload.email),
      phone: cleanText(payload.phone),
      status: cleanText(payload.status) || "Applied",
      roleWanted: cleanText(payload.roleWanted),
      availability: cleanText(payload.availability),
      interests: arrayOf(payload.interests).map(String),
      screeningRequired: Boolean(payload.screeningRequired),
      orientationCompletedAtISO: cleanDate(payload.orientationCompletedAtISO),
      trainingStatus: cleanText(payload.trainingStatus),
      applicationReceivedAtISO: cleanDate(payload.applicationReceivedAtISO) || cleanDate(payload.sourceDate),
      approvedAtISO: cleanDate(payload.approvedAtISO),
      renewalDueAtISO: cleanDate(payload.renewalDueAtISO),
      intakeSource: cleanText(payload.intakeSource) || "paperless",
      notes: sourceNote,
    });
  }

  throw new Error(`Unsupported section record kind: ${record.recordKind}`);
}

async function findExistingMeetingImport(
  ctx: any,
  societyId: string,
  scheduledAt: string,
  title: string,
  sourceExternalIds: string[],
) {
  const dateKey = String(scheduledAt).slice(0, 10);
  const sources = new Set(sourceExternalIds.map((value) => String(value).toLowerCase()));
  const minutesRows = await ctx.db
    .query("minutes")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  for (const row of minutesRows) {
    const rowDate = String(row.heldAt ?? "").slice(0, 10);
    const rowSources = Array.isArray(row.sourceExternalIds) ? row.sourceExternalIds.map((value: string) => value.toLowerCase()) : [];
    if (rowDate === dateKey && rowSources.some((source: string) => sources.has(source))) {
      return { meetingId: row.meetingId, minutesId: row._id };
    }
  }

  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  const normalizedTitle = cleanText(title)?.toLowerCase();
  const existing = meetings.find(
    (meeting: any) =>
      String(meeting.scheduledAt ?? "").slice(0, 10) === dateKey &&
      cleanText(meeting.title)?.toLowerCase() === normalizedTitle &&
      meeting.minutesId,
  );
  return existing?.minutesId ? { meetingId: existing._id, minutesId: existing.minutesId } : null;
}

async function resolveMeetingTargetForEvidence(ctx: any, societyId: string, payload: any, record: any) {
  const meetingDate = cleanDate(payload.meetingDate) || cleanDate(payload.sourceDate);
  const meetingTitle = cleanText(payload.meetingTitle) || cleanText(record.title);
  if (!meetingDate) return null;
  const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
  const exact = await findExistingMeetingImport(
    ctx,
    societyId,
    toMeetingDateTime(meetingDate),
    meetingTitle ?? "",
    sourceExternalIds,
  );
  if (exact) return exact;

  const titleKey = normalizeLookupText(meetingTitle);
  if (!titleKey) return null;
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  const matches = meetings.filter(
    (meeting: any) =>
      String(meeting.scheduledAt ?? "").slice(0, 10) === meetingDate &&
      normalizeLookupText(meeting.title) === titleKey &&
      meeting.minutesId,
  );
  if (matches.length !== 1) return null;
  return { meetingId: matches[0]._id, minutesId: matches[0].minutesId };
}

async function resolvePersonLinks(ctx: any, societyId: string, value: unknown) {
  const key = normalizePersonLookupName(value);
  if (!key) return {};
  const [members, directors] = await Promise.all([
    ctx.db.query("members").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("directors").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
  ]);
  const member = members.find((row: any) => personLookupKeys(row).includes(key));
  const director = directors.find((row: any) => personLookupKeys(row).includes(key));
  return { memberId: member?._id, directorId: director?._id };
}

function personLookupKeys(row: any) {
  return unique([
    `${row?.firstName ?? ""} ${row?.lastName ?? ""}`,
    `${row?.lastName ?? ""}, ${row?.firstName ?? ""}`,
    row?.name,
    ...arrayOf(row?.aliases),
  ]).map(normalizePersonLookupName).filter(Boolean);
}

function normalizePersonLookupName(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  const withoutFormer = text.replace(/\([^)]*\)/g, " ");
  const commaMatch = withoutFormer.match(/^\s*([^,]+),\s*(.+?)\s*$/);
  const name = commaMatch ? `${commaMatch[2]} ${commaMatch[1]}` : withoutFormer;
  return normalizeLookupText(name);
}

function normalizeLookupText(value: unknown) {
  return cleanText(value)
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function importedMeetingAgenda(title: string, motions: any[], sourceExternalIds: string[]) {
  return [
    "Call to order",
    "Confirm attendance, regrets, and quorum",
    "Approve agenda",
    sourceExternalIds.length
      ? `Review source document${sourceExternalIds.length === 1 ? "" : "s"}: ${sourceExternalIds.join(", ")}`
      : "Review source document",
    ...motions.map((motion, index) => {
      const text = cleanText(motion.motionText) || cleanText(motion.meetingTitle) || `Converted motion ${index + 1}`;
      return `Business item ${index + 1}: ${text}`;
    }),
    title.toLowerCase().includes("adjourn") ? "Record adjournment" : "Adjournment",
  ];
}

async function sessionRecords(ctx: any, societyId: string, sessionId: string) {
  const docs = await recordsForSession(ctx, sessionId);
  return docs
    .filter(isImportRecord)
    .map(hydrateRecord)
    .filter((record) => record.sessionId === sessionId);
}

async function recordsForSession(ctx: any, sessionId: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_import_session", (q: any) => q.eq("importSessionId", sessionId))
    .collect();
}

async function docsByCategory(ctx: any, societyId: string, category: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_society_category", (q: any) => q.eq("societyId", societyId).eq("category", category))
    .collect();
}

async function sourceLookupDocs(ctx: any, societyId: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
}

async function upsertHistorySources(ctx: any, societyId: string, sourceRecords: any[], referencedExternalIds: Set<string>) {
  const docs = await docsByCategory(ctx, societyId, HISTORY_SOURCE_CATEGORY);
  const existingSources = docs.filter(isHistorySource).map(hydrateHistorySource);
  const sourceIdByExternalId = new Map<string, any>();

  for (const record of sourceRecords) {
    const source = normalizeSourcePayload(record.payload);
    if (!source.title) continue;
    let sourceId = null;
    if (source.externalId) {
      const existing = existingSources.find(
        (candidate) =>
          candidate.externalId === source.externalId &&
          (candidate.externalSystem ?? "paperless") === (source.externalSystem ?? "paperless"),
      );
      sourceId = existing?._id ?? null;
    }
    if (sourceId) {
      await ctx.db.patch(sourceId, {
        title: source.title,
        content: JSON.stringify(source),
        url: source.url,
        tags: historySourceTags(source),
      });
    } else {
      sourceId = await ctx.db.insert("documents", {
        societyId,
        title: source.title,
        category: HISTORY_SOURCE_CATEGORY,
        content: JSON.stringify(source),
        url: source.url,
        createdAtISO: new Date().toISOString(),
        flaggedForDeletion: false,
        tags: historySourceTags(source),
      });
    }
    if (source.externalId) sourceIdByExternalId.set(source.externalId, sourceId);
  }

  for (const externalId of referencedExternalIds) {
    if (sourceIdByExternalId.has(externalId)) continue;
    const placeholder = {
      externalSystem: sourceSystemFromExternalId(externalId),
      externalId,
      title: fallbackSourceTitle(externalId),
      category: "Other",
      confidence: "Review",
      notes: "Placeholder source created because an approved import record referenced this source without a staged source record.",
    };
    const sourceId = await ctx.db.insert("documents", {
      societyId,
      title: placeholder.title,
      category: HISTORY_SOURCE_CATEGORY,
      content: JSON.stringify(placeholder),
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      tags: historySourceTags(placeholder),
    });
    sourceIdByExternalId.set(externalId, sourceId);
  }

  return sourceIdByExternalId;
}

async function insertHistoryItem(ctx: any, societyId: string, kind: string, payload: any) {
  const data = { ...normalizePayload(kind, payload), sourceIds: Array.isArray(payload.sourceIds) ? payload.sourceIds : [] };
  return await ctx.db.insert("documents", {
    societyId,
    title: titleForHistoryItem(kind, data),
    category: HISTORY_ITEM_CATEGORY,
    content: JSON.stringify({ kind, ...data }),
    createdAtISO: new Date().toISOString(),
    flaggedForDeletion: false,
    tags: [HISTORY_TAG, HISTORY_ITEM_TAG, tagValue(kind)].filter(Boolean),
  });
}

async function patchRecordImportTarget(ctx: any, record: any, target: string, value: any) {
  await ctx.db.patch(record._id, {
    content: JSON.stringify({
      ...record,
      importedTargets: { ...(record.importedTargets ?? {}), [target]: value },
      updatedAtISO: new Date().toISOString(),
    }),
  });
}

async function patchRecordPromotionBlocked(ctx: any, record: any, issues: string[]) {
  const riskFlags = unique([
    ...(record.riskFlags ?? []),
    "validation",
    issues.some((issue) => issue.toLowerCase().includes("duplicate")) ? "duplicate" : "",
    issues.some((issue) => issue.toLowerCase().includes("confidence")) ? "confidence" : "",
  ]);
  await ctx.db.patch(record._id, {
    content: JSON.stringify({
      ...record,
      status: "Pending",
      reviewNotes: appendImportNote(
        record.reviewNotes,
        `Promotion blocked: ${issues.join("; ")}`,
      ),
      riskFlags,
      updatedAtISO: new Date().toISOString(),
    }),
    tags: [SESSION_TAG, RECORD_TAG, tagValue(record.recordKind), tagValue(record.targetModule), "promotion-blocked"].filter(Boolean),
  });
}

async function importPromotionIssues(ctx: any, societyId: string, record: any) {
  const kind = record.recordKind;
  if (![
    "organizationAddress",
    "organizationRegistration",
    "organizationIdentifier",
    "policy",
    "workflowPackage",
    "minuteBookItem",
    "roleHolder",
    "rightsClass",
    "rightsholdingTransfer",
    "legalTemplateDataField",
    "legalTemplate",
    "legalPrecedent",
    "legalPrecedentRun",
    "generatedLegalDocument",
    "legalSigner",
    "formationRecord",
    "nameSearchItem",
    "entityAmendment",
    "annualMaintenanceRecord",
    "jurisdictionMetadata",
    "supportLog",
  ].includes(kind)) {
    return [];
  }

  const payload = normalizePayload(kind, record.payload ?? {});
  const issues: string[] = [];
  if (confidenceFor(payload) === "Review" && !cleanText(record.reviewNotes)) {
    issues.push("Review-confidence records need reviewer notes before promotion.");
  }

  if (kind === "organizationAddress") {
    if (!cleanText(payload.street) && !cleanText(payload.address)) issues.push("Address street/address is required.");
    if (!cleanText(payload.city)) issues.push("Address city is required.");
    addIssue(issues, invalidOptionIssue("addressTypes", payload.type, "Address type", false));
    addIssue(issues, invalidOptionIssue("addressStatuses", payload.status, "Address status"));
    const rows = await ctx.db.query("organizationAddresses").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = addressKey({
      type: cleanText(payload.type) || "other",
      street: cleanText(payload.street) || cleanText(payload.address),
      city: cleanText(payload.city),
      provinceState: cleanText(payload.provinceState) || cleanText(payload.province),
      postalCode: cleanText(payload.postalCode),
      country: cleanText(payload.country) || "Canada",
    });
    if (key && rows.some((row: any) => addressKey(row) === key)) issues.push("Duplicate structured address already exists.");
  }

  if (kind === "organizationRegistration") {
    if (!cleanText(payload.jurisdiction)) issues.push("Registration jurisdiction is required.");
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction, "Registration jurisdiction", false));
    addIssue(issues, invalidOptionIssue("registrationStatuses", payload.status, "Registration status"));
    const rows = await ctx.db.query("organizationRegistrations").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.jurisdiction, payload.registrationNumber, payload.assumedName]);
    if (key && rows.some((row: any) => compactKey([row.jurisdiction, row.registrationNumber, row.assumedName]) === key)) {
      issues.push("Duplicate organization registration already exists.");
    }
  }

  if (kind === "organizationIdentifier") {
    if (!cleanText(payload.number)) issues.push("Identifier number is required.");
    if (!cleanText(payload.kind) && !cleanText(payload.type)) issues.push("Identifier kind is required.");
    addIssue(issues, invalidOptionIssue("taxNumberTypes", payload.kind ?? payload.type, "Identifier kind", false));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction, "Identifier jurisdiction"));
    addIssue(issues, invalidOptionIssue("identifierStatuses", payload.status, "Identifier status"));
    addIssue(issues, invalidOptionIssue("accessLevels", payload.accessLevel, "Identifier access level"));
    const rows = await ctx.db.query("organizationIdentifiers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.kind ?? payload.type, payload.number, payload.jurisdiction, payload.foreignJurisdiction]);
    if (key && rows.some((row: any) => compactKey([row.kind, row.number, row.jurisdiction, row.foreignJurisdiction]) === key)) {
      issues.push("Duplicate organization identifier already exists.");
    }
  }

  if (kind === "policy") {
    if (!cleanText(payload.policyName) && !cleanText(payload.name)) issues.push("Policy name is required.");
    addIssue(issues, invalidOptionIssue("policyStatuses", payload.status, "Policy status"));
    issues.push(...invalidOptionListIssues("requiredSigners", payload.requiredSigners, "Required signers"));
    issues.push(...invalidOptionListIssues("entityJurisdictions", payload.jurisdictions, "Jurisdictions"));
    issues.push(...invalidOptionListIssues("entityTypes", payload.entityTypes, "Entity types"));
    const rows = await ctx.db.query("policies").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.policyNumber || payload.policyName || payload.name]);
    if (key && rows.some((row: any) => compactKey([row.policyNumber || row.policyName]) === key)) issues.push("Duplicate policy already exists.");
  }

  if (kind === "workflowPackage") {
    if (!cleanText(payload.eventType)) issues.push("Workflow package event type is required.");
    if (!cleanText(payload.packageName) && !cleanText(payload.package)) issues.push("Workflow package name is required.");
    addIssue(issues, invalidOptionIssue("eventTypes", payload.eventType, "Workflow package event type", false));
    addIssue(issues, invalidOptionIssue("workflowPackageStatuses", payload.status, "Workflow package status"));
    const rows = await ctx.db.query("workflowPackages").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.eventType, payload.packageName ?? payload.package, payload.effectiveDate]);
    if (key && rows.some((row: any) => compactKey([row.eventType, row.packageName, row.effectiveDate]) === key)) {
      issues.push("Duplicate workflow package already exists.");
    }
  }

  if (kind === "minuteBookItem") {
    if (!cleanText(payload.title)) issues.push("Minute book title is required.");
    addIssue(issues, invalidOptionIssue("minuteBookRecordTypes", payload.recordType ?? payload.type, "Minute book record type"));
    addIssue(issues, invalidOptionIssue("minuteBookStatuses", payload.status, "Minute book status"));
    const rows = await ctx.db.query("minuteBookItems").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.title, payload.recordType ?? payload.type, payload.effectiveDate ?? payload.sourceDate]);
    if (key && rows.some((row: any) => compactKey([row.title, row.recordType, row.effectiveDate]) === key)) {
      issues.push("Duplicate minute book record already exists.");
    }
  }

  if (kind === "roleHolder") {
    if (!cleanText(payload.fullName) && !cleanText(payload.name) && !cleanText(payload.firstName) && !cleanText(payload.lastName)) {
      issues.push("Role holder name is required.");
    }
    addIssue(issues, invalidOptionIssue("representativeTypes", payload.roleType ?? payload.type ?? payload.role, "Role-holder type", false));
    addIssue(issues, invalidOptionIssue("roleHolderStatuses", payload.status, "Role-holder status"));
    addIssue(issues, invalidOptionIssue("officerTitles", payload.officerTitle ?? payload.title, "Officer title"));
    addIssue(issues, invalidOptionIssue("directorTerms", payload.directorTerm ?? payload.term, "Director term"));
    addIssue(issues, invalidOptionIssue("citizenshipResidencies", payload.citizenshipResidency, "Citizenship/residency"));
    const rows = await ctx.db.query("roleHolders").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.fullName ?? payload.name, payload.email, payload.roleType ?? payload.type ?? payload.role, payload.startDate]);
    if (key && rows.some((row: any) => compactKey([row.fullName, row.email, row.roleType, row.startDate]) === key)) {
      issues.push("Duplicate role holder already exists.");
    }
  }

  if (kind === "rightsClass") {
    if (!cleanText(payload.className) && !cleanText(payload.name) && !cleanText(payload.rightsClassName)) issues.push("Rights class name is required.");
    addIssue(issues, invalidOptionIssue("rightsClassTypes", payload.classType ?? payload.type, "Rights class type", false));
    addIssue(issues, invalidOptionIssue("rightsClassStatuses", payload.status, "Rights class status"));
    const rows = await ctx.db.query("rightsClasses").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.className ?? payload.name ?? payload.rightsClassName, payload.classType ?? payload.type]);
    if (key && rows.some((row: any) => compactKey([row.className, row.classType]) === key)) issues.push("Duplicate rights class already exists.");
  }

  if (kind === "rightsholdingTransfer") {
    addIssue(issues, invalidOptionIssue("rightsholdingTransferTypes", payload.transferType ?? payload.type, "Rights transfer type", false));
    addIssue(issues, invalidOptionIssue("rightsholdingTransferStatuses", payload.status, "Rights transfer status"));
    addIssue(issues, invalidOptionIssue("currencies", payload.priceToOrganizationCurrency ?? payload.priceToCorpCurrency, "Organization consideration currency"));
    addIssue(issues, invalidOptionIssue("currencies", payload.priceToVendorCurrency, "Vendor consideration currency"));
    const rows = await ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.transferDate ?? payload.date, payload.rightsClassId ?? payload.rightsClassName, payload.sourceHolderName, payload.destinationHolderName, payload.quantity]);
    if (key && rows.some((row: any) => compactKey([row.transferDate, row.rightsClassId, row.sourceHolderName, row.destinationHolderName, row.quantity]) === key)) {
      issues.push("Duplicate rightsholding transfer already exists.");
    }
  }

  if (kind === "legalTemplateDataField") {
    if (!cleanText(payload.name) && !cleanText(payload.fieldName)) issues.push("Template data field name is required.");
    const rows = await ctx.db.query("legalTemplateDataFields").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.name ?? payload.fieldName]);
    if (key && rows.some((row: any) => compactKey([row.name]) === key)) issues.push("Duplicate template data field already exists.");
  }

  if (kind === "legalTemplate") {
    if (!cleanText(payload.name) && !cleanText(payload.templateName)) issues.push("Template name is required.");
    addIssue(issues, invalidOptionIssue("templateTypes", payload.templateType ?? payload.type, "Template type", false));
    addIssue(issues, invalidOptionIssue("templateStatuses", payload.status, "Template status"));
    addIssue(issues, invalidOptionIssue("documentTags", payload.documentTag, "Document tag"));
    addIssue(issues, invalidOptionIssue("filingTypes", payload.filingType, "Filing type"));
    issues.push(...invalidOptionListIssues("requiredSigners", payload.requiredSigners, "Required signers"));
    issues.push(...invalidOptionListIssues("entityJurisdictions", payload.jurisdictions, "Jurisdictions"));
    issues.push(...invalidOptionListIssues("entityTypes", payload.entityTypes, "Entity types"));
    const rows = await ctx.db.query("legalTemplates").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.templateType ?? payload.type, payload.name ?? payload.templateName]);
    if (key && rows.some((row: any) => compactKey([row.templateType, row.name]) === key)) issues.push("Duplicate legal template already exists.");
  }

  if (kind === "legalPrecedent") {
    if (!cleanText(payload.packageName) && !cleanText(payload.name)) issues.push("Precedent package name is required.");
    addIssue(issues, invalidOptionIssue("precedentStatuses", payload.status, "Precedent status"));
    addIssue(issues, invalidOptionIssue("partTypes", payload.partType, "Part type"));
    const rows = await ctx.db.query("legalPrecedents").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.packageName ?? payload.name, payload.partType]);
    if (key && rows.some((row: any) => compactKey([row.packageName, row.partType]) === key)) issues.push("Duplicate legal precedent already exists.");
  }

  if (kind === "legalPrecedentRun") {
    if (!cleanText(payload.name) && !cleanText(payload.partName)) issues.push("Precedent run name is required.");
    addIssue(issues, invalidOptionIssue("precedentRunStatuses", payload.status, "Precedent run status"));
    const rows = await ctx.db.query("legalPrecedentRuns").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.name ?? payload.partName, payload.eventId ?? payload.relatedEventId, payload.dateTime]);
    if (key && rows.some((row: any) => compactKey([row.name, row.eventId, row.dateTime]) === key)) issues.push("Duplicate legal precedent run already exists.");
  }

  if (kind === "generatedLegalDocument") {
    if (!cleanText(payload.title) && !cleanText(payload.documentName)) issues.push("Generated document title is required.");
    addIssue(issues, invalidOptionIssue("generatedDocumentStatuses", payload.status, "Generated document status"));
    addIssue(issues, invalidOptionIssue("documentTags", payload.documentTag, "Generated document tag"));
    const rows = await ctx.db.query("generatedLegalDocuments").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.title ?? payload.documentName, payload.syngrafiiDocumentId, payload.effectiveDate]);
    if (key && rows.some((row: any) => compactKey([row.title, row.syngrafiiDocumentId, row.effectiveDate]) === key)) {
      issues.push("Duplicate generated legal document already exists.");
    }
  }

  if (kind === "legalSigner") {
    if (!cleanText(payload.fullName) && !cleanText(payload.name) && !cleanText(payload.email)) issues.push("Signer name or email is required.");
    addIssue(issues, invalidOptionIssue("signerStatuses", payload.status ?? payload.signerStatus, "Signer status"));
    const rows = await ctx.db.query("legalSigners").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.email, payload.signerId, payload.signerTag]);
    if (key && rows.some((row: any) => compactKey([row.email, row.signerId, row.signerTag]) === key)) issues.push("Duplicate legal signer already exists.");
  }

  if (kind === "formationRecord") {
    addIssue(issues, invalidOptionIssue("formationStatuses", payload.status, "Formation status"));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction, "Formation jurisdiction"));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.extraProvincialRegistrationJurisdiction, "Extra-provincial registration jurisdiction"));
    const rows = await ctx.db.query("formationRecords").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.nuansNumber, payload.jurisdiction, payload.relatedIncorporationEventId]);
    if (key && rows.some((row: any) => compactKey([row.nuansNumber, row.jurisdiction, row.relatedIncorporationEventId]) === key)) {
      issues.push("Duplicate formation record already exists.");
    }
  }

  if (kind === "nameSearchItem") {
    if (!cleanText(payload.name)) issues.push("Name search name is required.");
    addIssue(issues, invalidOptionIssue("suffixCompanyNames", payload.suffix, "Name suffix"));
    const rows = await ctx.db.query("nameSearchItems").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.name, payload.nuansReportNumber, payload.rank]);
    if (key && rows.some((row: any) => compactKey([row.name, row.nuansReportNumber, row.rank]) === key)) issues.push("Duplicate name search item already exists.");
  }

  if (kind === "entityAmendment") {
    addIssue(issues, invalidOptionIssue("amendmentStatuses", payload.status, "Amendment status"));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdictionNew ?? payload.newJurisdiction, "New jurisdiction"));
    const rows = await ctx.db.query("entityAmendments").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.entityNameNew ?? payload.newEntityName, payload.effectiveDate, payload.jurisdictionNew ?? payload.newJurisdiction]);
    if (key && rows.some((row: any) => compactKey([row.entityNameNew, row.effectiveDate, row.jurisdictionNew]) === key)) issues.push("Duplicate entity amendment already exists.");
  }

  if (kind === "annualMaintenanceRecord") {
    addIssue(issues, invalidOptionIssue("annualMaintenanceStatuses", payload.status, "Annual maintenance status"));
    addIssue(issues, invalidOptionIssue("annualFinancialStatementOptions", payload.annualFinancialStatementOption, "Annual financial statement option"));
    const rows = await ctx.db.query("annualMaintenanceRecords").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.yearFilingFor ?? payload.filingYear, payload.filingDate, payload.lastAgmDate]);
    if (key && rows.some((row: any) => compactKey([row.yearFilingFor, row.filingDate, row.lastAgmDate]) === key)) {
      issues.push("Duplicate annual maintenance record already exists.");
    }
  }

  if (kind === "jurisdictionMetadata") {
    if (!cleanText(payload.jurisdiction) && !cleanText(payload.value)) issues.push("Jurisdiction value is required.");
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction ?? payload.value, "Jurisdiction", false));
    addIssue(issues, invalidOptionIssue("actsFormedUnder", payload.actFormedUnder, "Act formed under"));
    const rows = await ctx.db.query("jurisdictionMetadata").collect();
    const key = compactKey([payload.jurisdiction ?? payload.value]);
    if (key && rows.some((row: any) => compactKey([row.jurisdiction]) === key)) issues.push("Duplicate jurisdiction metadata already exists.");
  }

  if (kind === "supportLog") {
    addIssue(issues, invalidOptionIssue("logTypes", payload.logType ?? payload.type, "Log type", false));
    addIssue(issues, invalidOptionIssue("logSeverities", payload.severity, "Log severity"));
    const rows = await ctx.db.query("supportLogs").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.createdAtISO, payload.logType ?? payload.type, payload.errorCode, payload.errorMessage, payload.pageLocationUrl ?? payload.url]);
    if (key && rows.some((row: any) => compactKey([row.createdAtISO, row.logType, row.errorCode, row.errorMessage, row.pageLocationUrl]) === key)) {
      issues.push("Duplicate support log already exists.");
    }
  }

  return unique(issues);
}

function addressKey(row: any) {
  return compactKey([row.type, row.street, row.city, row.provinceState, row.postalCode, row.country]);
}

function compactKey(values: unknown[]) {
  return values.map((value) => cleanText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean).join("|");
}

function addIssue(issues: string[], issue?: string) {
  if (issue) issues.push(issue);
}

async function patchSessionUpdatedAt(ctx: any, sessionId: string) {
  const doc = await ctx.db.get(sessionId);
  if (!isImportSession(doc)) return;
  const payload = hydrateSession(doc);
  const records = (await recordsForSession(ctx, sessionId))
    .filter(isImportRecord)
    .map(hydrateRecord)
    .filter((record) => record.sessionId === sessionId);
  const summary = summarizeRecords(records);
  await ctx.db.patch(sessionId, {
    content: JSON.stringify({ ...payload, summary, updatedAtISO: new Date().toISOString() }),
  });
  return summary;
}

function recordsFromBundle(bundle: any) {
  const records: any[] = [];
  for (const source of arrayOf(bundle?.sources)) records.push(makeRecord("source", "Org history sources", source));
  for (const fact of arrayOf(bundle?.facts)) records.push(makeRecord("fact", "Org history", fact));
  for (const event of arrayOf(bundle?.events)) records.push(makeRecord("event", "Org history", event));
  for (const term of arrayOf(bundle?.boardTerms)) records.push(makeRecord("boardTerm", "Directors and roles", term));
  for (const motion of arrayOf(bundle?.motions)) records.push(makeRecord("motion", "Meetings and minutes", motion));
  for (const minutes of arrayOf(bundle?.meetingMinutes)) records.push(makeRecord("meetingMinutes", "Meetings and minutes", minutes));
  for (const budget of arrayOf(bundle?.budgets)) records.push(makeRecord("budget", "Budgets", budget));
  for (const filing of arrayOf(bundle?.filings)) records.push(makeRecord("filing", "filings", filing));
  for (const deadline of arrayOf(bundle?.deadlines)) records.push(makeRecord("deadline", "deadlines", deadline));
  for (const amendment of arrayOf(bundle?.bylawAmendments)) records.push(makeRecord("bylawAmendment", "bylawAmendments", amendment));
  for (const publication of arrayOf(bundle?.publications)) records.push(makeRecord("publication", "publications", publication));
  for (const policy of dedupeInsurancePolicies(arrayOf(bundle?.insurancePolicies))) records.push(makeRecord("insurancePolicy", "insurance", policy));
  for (const financial of arrayOf(bundle?.financialStatements)) records.push(makeRecord("financialStatement", "financials", financial));
  for (const financial of arrayOf(bundle?.financialStatementImports)) records.push(makeRecord("financialStatementImport", "financialStatementImports", financial));
  for (const grant of arrayOf(bundle?.grants)) records.push(makeRecord("grant", "grants", grant));
  for (const location of arrayOf(bundle?.recordsLocations)) records.push(makeRecord("recordsLocation", "recordsLocation", location));
  for (const accession of arrayOf(bundle?.archiveAccessions)) records.push(makeRecord("archiveAccession", "archiveAccessions", accession));
  for (const assignment of arrayOf(bundle?.boardRoleAssignments)) records.push(makeRecord("boardRoleAssignment", "boardRoleAssignments", assignment));
  for (const change of arrayOf(bundle?.boardRoleChanges)) records.push(makeRecord("boardRoleChange", "boardRoleChanges", change));
  for (const authority of arrayOf(bundle?.signingAuthorities)) records.push(makeRecord("signingAuthority", "signingAuthorities", authority));
  for (const attendance of arrayOf(bundle?.meetingAttendance)) records.push(makeRecord("meetingAttendance", "meetingAttendanceRecords", attendance));
  for (const evidence of arrayOf(bundle?.motionEvidence)) records.push(makeRecord("motionEvidence", "motionEvidence", evidence));
  for (const snapshot of arrayOf(bundle?.budgetSnapshots)) records.push(makeRecord("budgetSnapshot", "budgetSnapshots", snapshot));
  for (const report of arrayOf(bundle?.treasurerReports)) records.push(makeRecord("treasurerReport", "treasurerReports", report));
  for (const transaction of arrayOf(bundle?.transactionCandidates)) records.push(makeRecord("transactionCandidate", "transactionCandidates", transaction));
  for (const address of arrayOf(bundle?.organizationAddresses)) records.push(makeRecord("organizationAddress", "organizationAddresses", address));
  for (const registration of arrayOf(bundle?.organizationRegistrations)) records.push(makeRecord("organizationRegistration", "organizationRegistrations", registration));
  for (const identifier of arrayOf(bundle?.organizationIdentifiers)) records.push(makeRecord("organizationIdentifier", "organizationIdentifiers", identifier));
  for (const identifier of arrayOf(bundle?.taxRegistrations)) records.push(makeRecord("organizationIdentifier", "organizationIdentifiers", identifier));
  for (const policy of arrayOf(bundle?.policies)) records.push(makeRecord("policy", "policies", policy));
  for (const workflowPackage of arrayOf(bundle?.workflowPackages)) records.push(makeRecord("workflowPackage", "workflowPackages", workflowPackage));
  for (const item of arrayOf(bundle?.minuteBookItems)) records.push(makeRecord("minuteBookItem", "minuteBookItems", item));
  for (const holder of arrayOf(bundle?.roleHolders ?? bundle?.representatives)) records.push(makeRecord("roleHolder", "roleHolders", holder));
  for (const rightsClass of arrayOf(bundle?.rightsClasses ?? bundle?.shareClasses)) records.push(makeRecord("rightsClass", "rightsClasses", rightsClass));
  for (const transfer of arrayOf(bundle?.rightsholdingTransfers ?? bundle?.shareTransfers)) records.push(makeRecord("rightsholdingTransfer", "rightsholdingTransfers", transfer));
  for (const field of arrayOf(bundle?.legalTemplateDataFields ?? bundle?.dataFields)) records.push(makeRecord("legalTemplateDataField", "legalTemplateDataFields", field));
  for (const template of arrayOf(bundle?.legalTemplates ?? bundle?.templates)) records.push(makeRecord("legalTemplate", "legalTemplates", template));
  for (const precedent of arrayOf(bundle?.legalPrecedents ?? bundle?.parts ?? bundle?.partPrecedents)) records.push(makeRecord("legalPrecedent", "legalPrecedents", precedent));
  for (const run of arrayOf(bundle?.legalPrecedentRuns ?? bundle?.partRuns)) records.push(makeRecord("legalPrecedentRun", "legalPrecedentRuns", run));
  for (const doc of arrayOf(bundle?.generatedLegalDocuments ?? bundle?.draftDocuments)) records.push(makeRecord("generatedLegalDocument", "generatedLegalDocuments", doc));
  for (const signer of arrayOf(bundle?.legalSigners ?? bundle?.signers)) records.push(makeRecord("legalSigner", "legalSigners", signer));
  for (const formation of arrayOf(bundle?.formationRecords ?? bundle?.incorporations)) records.push(makeRecord("formationRecord", "formationRecords", formation));
  for (const search of arrayOf(bundle?.nameSearchItems ?? bundle?.nameSearches)) records.push(makeRecord("nameSearchItem", "nameSearchItems", search));
  for (const amendment of arrayOf(bundle?.entityAmendments ?? bundle?.amendments)) records.push(makeRecord("entityAmendment", "entityAmendments", amendment));
  for (const annual of arrayOf(bundle?.annualMaintenanceRecords ?? bundle?.annualGeneralMeetings)) records.push(makeRecord("annualMaintenanceRecord", "annualMaintenanceRecords", annual));
  for (const jurisdiction of arrayOf(bundle?.jurisdictionMetadata)) records.push(makeRecord("jurisdictionMetadata", "jurisdictionMetadata", jurisdiction));
  for (const log of arrayOf(bundle?.supportLogs ?? bundle?.logs)) records.push(makeRecord("supportLog", "supportLogs", log));
  for (const evidence of arrayOf(bundle?.sourceEvidence)) records.push(makeRecord("sourceEvidence", "sourceEvidence", evidence));
  for (const secret of arrayOf(bundle?.secretVaultItems)) records.push(makeRecord("secretVaultItem", "secrets", secret));
  for (const training of arrayOf(bundle?.pipaTrainings)) records.push(makeRecord("pipaTraining", "pipaTraining", training));
  for (const employee of arrayOf(bundle?.employees)) records.push(makeRecord("employee", "employees", employee));
  for (const volunteer of arrayOf(bundle?.volunteers)) records.push(makeRecord("volunteer", "volunteers", volunteer));
  for (const doc of arrayOf(bundle?.documentMap)) records.push(makeRecord("documentCandidate", firstSection(doc), doc));
  return records;
}

function makeRecord(recordKind: string, targetModule: string, rawPayload: any) {
  const payload = normalizePayload(recordKind, rawPayload);
  const sourceExternalIds = sourceExternalIdsFor(recordKind, payload);
  const confidence = confidenceFor(payload);
  return {
    recordKind,
    targetModule,
    title: titleForRecord(recordKind, payload),
    description: descriptionForRecord(recordKind, payload),
    payload,
    sourceExternalIds,
    confidence,
    riskFlags: riskFlagsFor(recordKind, targetModule, payload),
  };
}

function normalizePayload(recordKind: string, payload: any) {
  if (recordKind === "source") return normalizeSourcePayload(payload);
  if (recordKind === "motion") return normalizeMotionPayload(payload);
  if (recordKind === "meetingMinutes") return normalizeMeetingMinutesPayload(payload);
  if (recordKind === "budget") return normalizeBudgetPayload(payload);
  if (SECTION_RECORD_KINDS.includes(recordKind as any)) return normalizeSectionPayload(payload);
  return { ...(payload ?? {}) };
}

function normalizeSourcePayload(source: any) {
  return {
    externalSystem: cleanText(source?.externalSystem) || "paperless",
    externalId: cleanText(source?.externalId),
    title: cleanText(source?.title),
    sourceDate: cleanText(source?.sourceDate),
    category: cleanText(source?.category) || "Other",
    confidence: confidenceFor(source),
    notes: cleanText(source?.notes),
    url: cleanText(source?.url),
    localPath: cleanText(source?.localPath),
    fileName: cleanText(source?.fileName),
    mimeType: cleanText(source?.mimeType),
    fileSizeBytes: numberOrUndefined(source?.fileSizeBytes),
    sha256: cleanText(source?.sha256),
    sensitivity: cleanText(source?.sensitivity),
    tags: arrayOf(source?.tags).map(String),
  };
}

function normalizeMotionPayload(motion: any) {
  return {
    meetingDate: cleanText(motion?.meetingDate),
    meetingTitle: cleanText(motion?.meetingTitle),
    motionText: cleanText(motion?.motionText),
    outcome: cleanText(motion?.outcome),
    movedByName: cleanText(motion?.movedByName),
    secondedByName: cleanText(motion?.secondedByName),
    votesFor: numberOrUndefined(motion?.votesFor),
    votesAgainst: numberOrUndefined(motion?.votesAgainst),
    abstentions: numberOrUndefined(motion?.abstentions),
    resolutionType: cleanText(motion?.resolutionType),
    voteSummary: cleanText(motion?.voteSummary),
    pageRef: cleanText(motion?.pageRef),
    evidenceText: cleanText(motion?.evidenceText),
    rawText: cleanText(motion?.rawText),
    category: cleanText(motion?.category) || "Governance",
    sourceExternalIds: arrayOf(motion?.sourceExternalIds).map(String),
    notes: cleanText(motion?.notes),
  };
}

function normalizeMeetingMinutesPayload(minutes: any) {
  return {
    meetingDate: cleanText(minutes?.meetingDate),
    meetingTitle: cleanText(minutes?.meetingTitle),
    chairName: cleanText(minutes?.chairName),
    secretaryName: cleanText(minutes?.secretaryName),
    recorderName: cleanText(minutes?.recorderName),
    calledToOrderAt: cleanText(minutes?.calledToOrderAt),
    adjournedAt: cleanText(minutes?.adjournedAt),
    remoteParticipation: normalizeRemoteParticipationPayload(minutes?.remoteParticipation),
    detailedAttendance: normalizeDetailedAttendancePayload(minutes?.detailedAttendance),
    attendees: compactStrings(arrayOf(minutes?.attendees)),
    absent: compactStrings(arrayOf(minutes?.absent)),
    quorumMet: Boolean(minutes?.quorumMet),
    agendaItems: compactStrings(arrayOf(minutes?.agendaItems)),
    discussion: cleanText(minutes?.discussion),
    sections: normalizeMinuteSectionsPayload(minutes?.sections),
    motions: arrayOf(minutes?.motions).map(normalizeMotionPayload),
    decisions: compactStrings(arrayOf(minutes?.decisions)),
    actionItems: arrayOf(minutes?.actionItems).map(normalizeMinutesActionItem).filter(Boolean),
    nextMeetingAt: cleanText(minutes?.nextMeetingAt),
    nextMeetingLocation: cleanText(minutes?.nextMeetingLocation),
    nextMeetingNotes: cleanText(minutes?.nextMeetingNotes),
    sessionSegments: normalizeSessionSegmentsPayload(minutes?.sessionSegments),
    appendices: normalizeAppendicesPayload(minutes?.appendices),
    agmDetails: normalizeAgmDetailsPayload(minutes?.agmDetails),
    sourceExternalIds: arrayOf(minutes?.sourceExternalIds).map(String),
    sourceDocumentTitle: cleanText(minutes?.sourceDocumentTitle),
    sourceDocumentId: minutes?.sourceDocumentId != null ? String(minutes.sourceDocumentId) : undefined,
    sectionIndex: numberOrUndefined(minutes?.sectionIndex),
    pageRef: cleanText(minutes?.pageRef),
    confidence: confidenceFor(minutes),
    notes: cleanText(minutes?.notes),
  };
}

function structuredMinutesPatchFromPayload(payload: any) {
  return compactRecord({
    chairName: cleanText(payload?.chairName),
    secretaryName: cleanText(payload?.secretaryName),
    recorderName: cleanText(payload?.recorderName),
    calledToOrderAt: cleanText(payload?.calledToOrderAt),
    adjournedAt: cleanText(payload?.adjournedAt),
    remoteParticipation: normalizeRemoteParticipationPayload(payload?.remoteParticipation),
    detailedAttendance: normalizeDetailedAttendancePayload(payload?.detailedAttendance),
    sections: normalizeMinuteSectionsPayload(payload?.sections),
    nextMeetingAt: cleanText(payload?.nextMeetingAt),
    nextMeetingLocation: cleanText(payload?.nextMeetingLocation),
    nextMeetingNotes: cleanText(payload?.nextMeetingNotes),
    sessionSegments: normalizeSessionSegmentsPayload(payload?.sessionSegments),
    appendices: normalizeAppendicesPayload(payload?.appendices),
    agmDetails: normalizeAgmDetailsPayload(payload?.agmDetails),
  }) ?? {};
}

function normalizeRemoteParticipationPayload(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return compactRecord({
    url: cleanText(value.url),
    meetingId: cleanText(value.meetingId),
    passcode: cleanText(value.passcode),
    instructions: cleanText(value.instructions),
  });
}

function normalizeDetailedAttendancePayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      name: cleanText(row?.name),
      status: cleanText(row?.status) || "present",
      roleTitle: cleanText(row?.roleTitle),
      affiliation: cleanText(row?.affiliation),
      memberIdentifier: cleanText(row?.memberIdentifier),
      proxyFor: cleanText(row?.proxyFor),
      quorumCounted: optionalBoolean(row?.quorumCounted),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.name);
  return rows.length ? rows : undefined;
}

function normalizeMinuteSectionsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      type: cleanText(row?.type),
      presenter: cleanText(row?.presenter),
      discussion: cleanText(row?.discussion),
      reportSubmitted: optionalBoolean(row?.reportSubmitted),
      decisions: arrayOf(row?.decisions).map(String).map(cleanText).filter(Boolean),
      actionItems: normalizeActionItemsPayload(row?.actionItems),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeActionItemsPayload(value: any) {
  const rows = arrayOf(value)
    .map(normalizeMinutesActionItem)
    .filter((row: any) => row?.text);
  return rows.length ? rows : undefined;
}

function normalizeMinutesActionItem(row: any) {
  const text = typeof row === "string" ? cleanText(row) : cleanText(row?.text);
  if (!text) return null;
  return compactRecord({
    text,
    assignee: cleanText(row?.assignee),
    dueDate: cleanText(row?.dueDate),
    done: Boolean(row?.done),
  });
}

function normalizeSessionSegmentsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      type: cleanText(row?.type) || "other",
      title: cleanText(row?.title),
      startedAt: cleanText(row?.startedAt),
      endedAt: cleanText(row?.endedAt),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.type);
  return rows.length ? rows : undefined;
}

function normalizeAppendicesPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      type: cleanText(row?.type),
      reference: cleanText(row?.reference),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeAgmDetailsPayload(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return compactRecord({
    financialStatementsPresented: optionalBoolean(value.financialStatementsPresented),
    financialStatementsNotes: cleanText(value.financialStatementsNotes),
    directorElectionNotes: cleanText(value.directorElectionNotes),
    directorAppointments: normalizeDirectorAppointmentsPayload(value.directorAppointments),
    specialResolutionExhibits: normalizeSpecialResolutionExhibitsPayload(value.specialResolutionExhibits),
  });
}

function normalizeDirectorAppointmentsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      name: cleanText(row?.name),
      roleTitle: cleanText(row?.roleTitle),
      affiliation: cleanText(row?.affiliation),
      term: cleanText(row?.term),
      consentRecorded: optionalBoolean(row?.consentRecorded),
      votesReceived: numberOrUndefined(row?.votesReceived),
      elected: optionalBoolean(row?.elected),
      status: cleanText(row?.status),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.name);
  return rows.length ? rows : undefined;
}

function normalizeSpecialResolutionExhibitsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      reference: cleanText(row?.reference),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeBudgetPayload(budget: any) {
  return {
    ...(budget ?? {}),
    totalIncomeCents: numberOrUndefined(budget?.totalIncomeCents),
    totalExpenseCents: numberOrUndefined(budget?.totalExpenseCents),
    netCents: numberOrUndefined(budget?.netCents),
    endingBalanceCents: numberOrUndefined(budget?.endingBalanceCents),
    lines: arrayOf(budget?.lines),
    sourceExternalIds: arrayOf(budget?.sourceExternalIds).map(String),
  };
}

function normalizeSectionPayload(payload: any) {
  return {
    ...(payload ?? {}),
    sourceExternalIds: arrayOf(payload?.sourceExternalIds).map(String),
    highlights: arrayOf(payload?.highlights).map(String),
    concerns: arrayOf(payload?.concerns).map(String),
    sourceLines: arrayOf(payload?.sourceLines),
    lines: arrayOf(payload?.lines),
    submissionChecklist: arrayOf(payload?.submissionChecklist).map(String),
    interests: arrayOf(payload?.interests).map(String),
    riskFlags: arrayOf(payload?.riskFlags).map(String).map(cleanText).filter(Boolean),
    remunerationDisclosures: arrayOf(payload?.remunerationDisclosures),
    feePaidCents: numberOrUndefined(payload?.feePaidCents),
    coverageCents: numberOrUndefined(payload?.coverageCents),
    premiumCents: numberOrUndefined(payload?.premiumCents),
    deductibleCents: numberOrUndefined(payload?.deductibleCents),
    revenueCents: numberOrUndefined(payload?.revenueCents),
    expensesCents: numberOrUndefined(payload?.expensesCents),
    netAssetsCents: numberOrUndefined(payload?.netAssetsCents),
    restrictedFundsCents: numberOrUndefined(payload?.restrictedFundsCents),
    amountRequestedCents: numberOrUndefined(payload?.amountRequestedCents),
    amountAwardedCents: numberOrUndefined(payload?.amountAwardedCents),
    annualSalaryCents: numberOrUndefined(payload?.annualSalaryCents),
    hourlyWageCents: numberOrUndefined(payload?.hourlyWageCents),
    totalIncomeCents: numberOrUndefined(payload?.totalIncomeCents),
    totalExpenseCents: numberOrUndefined(payload?.totalExpenseCents),
    endingBalanceCents: numberOrUndefined(payload?.endingBalanceCents),
    cashBalanceCents: numberOrUndefined(payload?.cashBalanceCents),
    amountCents: numberOrUndefined(payload?.amountCents),
    policySeriesKey: cleanText(payload?.policySeriesKey),
    policyTermLabel: cleanText(payload?.policyTermLabel),
    versionType: cleanText(payload?.versionType),
    renewalOfPolicyNumber: cleanText(payload?.renewalOfPolicyNumber),
    additionalInsureds: arrayOf(payload?.additionalInsureds).map(String).map(cleanText).filter(Boolean),
    coveredParties: normalizeCoveredParties(payload?.coveredParties),
    coverageItems: normalizeCoverageItems(payload?.coverageItems),
    coveredLocations: normalizeCoveredLocations(payload?.coveredLocations),
    policyDefinitions: normalizePolicyDefinitions(payload?.policyDefinitions),
    declinedCoverages: normalizeDeclinedCoverages(payload?.declinedCoverages),
    certificatesOfInsurance: normalizeCertificatesOfInsurance(payload?.certificatesOfInsurance),
    insuranceRequirements: normalizeInsuranceRequirements(payload?.insuranceRequirements),
    claimsMadeTerms: normalizeClaimsMadeTerms(payload?.claimsMadeTerms),
    claimIncidents: normalizeClaimIncidents(payload?.claimIncidents),
    annualReviews: normalizeAnnualReviews(payload?.annualReviews),
    complianceChecks: normalizeComplianceChecks(payload?.complianceChecks),
  };
}

function dedupeInsurancePolicies(value: unknown[]) {
  const byKey = new Map<string, any>();
  for (const raw of value) {
    const policy = normalizeSectionPayload(raw);
    if (!isImportableInsurancePolicy(policy)) continue;
    const key = insurancePolicyDedupeKey(policy);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeInsurancePolicies(existing, policy) : policy);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    String(a.policySeriesKey ?? "").localeCompare(String(b.policySeriesKey ?? "")) ||
    String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")),
  );
}

function isImportableInsurancePolicy(policy: any) {
  const policyNumber = cleanText(policy?.policyNumber);
  const insurer = cleanText(policy?.insurer);
  const hasKnownPolicy = Boolean(policyNumber && policyNumber !== "Needs review");
  const hasKnownInsurer = Boolean(insurer && insurer !== "Needs review");
  const hasInsuranceEvidence = Boolean(
    policy?.coverageCents != null ||
    policy?.premiumCents != null ||
    policy?.coverageSummary ||
    arrayOf(policy?.coverageItems).length ||
    arrayOf(policy?.coveredParties).length ||
    arrayOf(policy?.sourceExternalIds).some((id) => /^local:|^paperless:/i.test(String(id))),
  );
  return (hasKnownPolicy || hasKnownInsurer) && hasInsuranceEvidence;
}

function insurancePolicyDedupeKey(policy: any) {
  return compactKey([
    cleanText(policy?.policySeriesKey) || insurancePolicySeriesKey(policy),
    cleanText(policy?.policyNumber),
    cleanDate(policy?.startDate),
    cleanDate(policy?.endDate),
    cleanText(policy?.kind),
  ]);
}

function insurancePolicySeriesKey(policy: any) {
  const kind = cleanText(policy?.kind) || "Other";
  const insurer = cleanText(policy?.insurer);
  const broker = cleanText(policy?.broker);
  const policyNumber = cleanText(policy?.policyNumber);
  if (kind === "GeneralLiability" && policyNumber && policyNumber !== "Needs review") {
    return compactKey(["cgl", insurer, broker, policyNumber]);
  }
  if (kind === "DirectorsOfficers") {
    return compactKey(["dno", insurer, broker, "management-liability"]);
  }
  return compactKey([kind, insurer, broker, policyNumber]);
}

function insurancePolicyTermLabel(policy: any) {
  const start = cleanDate(policy?.startDate);
  const end = cleanDate(policy?.endDate);
  if (start && end) return `${start.slice(0, 4)}-${end.slice(0, 4)}`;
  return start?.slice(0, 4) || cleanDate(policy?.renewalDate)?.slice(0, 4);
}

function mergeInsurancePolicies(existing: any, incoming: any) {
  const merged: any = { ...existing };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      merged[key] = mergeRecordArrays(merged[key], value);
      continue;
    }
    const current = merged[key];
    if (current == null || current === "" || current === "Needs review") {
      merged[key] = value;
    }
  }
  merged.sourceExternalIds = unique([...(existing.sourceExternalIds ?? []), ...(incoming.sourceExternalIds ?? [])]);
  merged.riskFlags = unique([...(existing.riskFlags ?? []), ...(incoming.riskFlags ?? [])]);
  merged.notes = [existing.notes, incoming.notes].map(cleanText).filter(Boolean).filter((note, index, arr) => arr.indexOf(note) === index).join("\n") || undefined;
  return merged;
}

function mergeRecordArrays(a: unknown, b: unknown) {
  const rows = [...arrayOf(a), ...arrayOf(b)];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function normalizeCoveredParties(value: unknown) {
  return arrayOf(value)
    .map((party: any) => compactRecord({
      name: cleanText(party?.name),
      partyType: cleanText(party?.partyType),
      coveredClass: cleanText(party?.coveredClass),
      sourceExternalIds: unique(arrayOf(party?.sourceExternalIds)),
      citationId: cleanText(party?.citationId),
      notes: cleanText(party?.notes),
    }))
    .filter((party): party is any => Boolean(party?.name));
}

function normalizeCoverageItems(value: unknown) {
  return arrayOf(value)
    .map((item: any) => compactRecord({
      label: cleanText(item?.label),
      coverageType: cleanText(item?.coverageType),
      coveredClass: cleanText(item?.coveredClass),
      limitCents: numberOrUndefined(item?.limitCents),
      deductibleCents: numberOrUndefined(item?.deductibleCents),
      summary: cleanText(item?.summary),
      sourceExternalIds: unique(arrayOf(item?.sourceExternalIds)),
      citationId: cleanText(item?.citationId),
    }))
    .filter((item): item is any => Boolean(item?.label));
}

function normalizeCoveredLocations(value: unknown) {
  return arrayOf(value)
    .map((location: any) => compactRecord({
      label: cleanText(location?.label),
      address: cleanText(location?.address),
      room: cleanText(location?.room),
      coverageCents: numberOrUndefined(location?.coverageCents),
      sourceExternalIds: unique(arrayOf(location?.sourceExternalIds)),
      citationId: cleanText(location?.citationId),
      notes: cleanText(location?.notes),
    }))
    .filter((location): location is any => Boolean(location?.label));
}

function normalizePolicyDefinitions(value: unknown) {
  return arrayOf(value)
    .map((definition: any) => compactRecord({
      term: cleanText(definition?.term),
      definition: cleanText(definition?.definition),
      sourceExternalIds: unique(arrayOf(definition?.sourceExternalIds)),
      citationId: cleanText(definition?.citationId),
    }))
    .filter((definition): definition is any => Boolean(definition?.term && definition?.definition));
}

function normalizeDeclinedCoverages(value: unknown) {
  return arrayOf(value)
    .map((declined: any) => compactRecord({
      label: cleanText(declined?.label),
      reason: cleanText(declined?.reason),
      offeredLimitCents: numberOrUndefined(declined?.offeredLimitCents),
      premiumCents: numberOrUndefined(declined?.premiumCents),
      declinedAt: cleanDate(declined?.declinedAt),
      sourceExternalIds: unique(arrayOf(declined?.sourceExternalIds)),
      citationId: cleanText(declined?.citationId),
      notes: cleanText(declined?.notes),
    }))
    .filter((declined): declined is any => Boolean(declined?.label));
}

function normalizeCertificatesOfInsurance(value: unknown) {
  return arrayOf(value)
    .map((certificate: any) => compactRecord({
      holderName: cleanText(certificate?.holderName),
      additionalInsuredLegalName: cleanText(certificate?.additionalInsuredLegalName),
      eventName: cleanText(certificate?.eventName),
      eventDate: cleanDate(certificate?.eventDate),
      requiredLimitCents: numberOrUndefined(certificate?.requiredLimitCents),
      issuedAt: cleanDate(certificate?.issuedAt),
      expiresAt: cleanDate(certificate?.expiresAt),
      status: cleanText(certificate?.status),
      sourceExternalIds: unique(arrayOf(certificate?.sourceExternalIds)),
      citationId: cleanText(certificate?.citationId),
      notes: cleanText(certificate?.notes),
    }))
    .filter((certificate): certificate is any => Boolean(certificate?.holderName));
}

function normalizeInsuranceRequirements(value: unknown) {
  return arrayOf(value)
    .map((requirement: any) => compactRecord({
      context: cleanText(requirement?.context),
      requirementType: cleanText(requirement?.requirementType),
      coverageSource: cleanText(requirement?.coverageSource),
      cglLimitRequiredCents: numberOrUndefined(requirement?.cglLimitRequiredCents),
      cglLimitConfirmedCents: numberOrUndefined(requirement?.cglLimitConfirmedCents),
      additionalInsuredRequired: optionalBoolean(requirement?.additionalInsuredRequired),
      additionalInsuredLegalName: cleanText(requirement?.additionalInsuredLegalName),
      coiStatus: cleanText(requirement?.coiStatus),
      coiDueDate: cleanDate(requirement?.coiDueDate),
      tenantLegalLiabilityLimitCents: numberOrUndefined(requirement?.tenantLegalLiabilityLimitCents),
      hostLiquorLiability: cleanText(requirement?.hostLiquorLiability),
      indemnityRequired: optionalBoolean(requirement?.indemnityRequired),
      waiverRequired: optionalBoolean(requirement?.waiverRequired),
      vendorCoiRequired: optionalBoolean(requirement?.vendorCoiRequired),
      studentEventChecklistRequired: optionalBoolean(requirement?.studentEventChecklistRequired),
      riskTriggers: unique(arrayOf(requirement?.riskTriggers)),
      sourceExternalIds: unique(arrayOf(requirement?.sourceExternalIds)),
      citationId: cleanText(requirement?.citationId),
      notes: cleanText(requirement?.notes),
    }))
    .filter((requirement): requirement is any => Boolean(requirement?.context));
}

function normalizeClaimsMadeTerms(value: unknown) {
  const terms = value && typeof value === "object" ? value as any : undefined;
  if (!terms) return undefined;
  return compactRecord({
    retroactiveDate: cleanDate(terms.retroactiveDate),
    continuityDate: cleanDate(terms.continuityDate),
    reportingDeadline: cleanDate(terms.reportingDeadline),
    extendedReportingPeriod: cleanText(terms.extendedReportingPeriod),
    defenseCostsInsideLimit: optionalBoolean(terms.defenseCostsInsideLimit),
    territory: cleanText(terms.territory),
    retentionCents: numberOrUndefined(terms.retentionCents),
    claimsNoticeContact: cleanText(terms.claimsNoticeContact),
    sourceExternalIds: unique(arrayOf(terms.sourceExternalIds)),
    citationId: cleanText(terms.citationId),
    notes: cleanText(terms.notes),
  });
}

function normalizeClaimIncidents(value: unknown) {
  return arrayOf(value)
    .map((incident: any) => compactRecord({
      incidentDate: cleanDate(incident?.incidentDate),
      claimNoticeDate: cleanDate(incident?.claimNoticeDate),
      status: cleanText(incident?.status),
      privacyFlag: optionalBoolean(incident?.privacyFlag),
      insurerNotifiedAt: cleanDateTime(incident?.insurerNotifiedAt),
      brokerNotifiedAt: cleanDateTime(incident?.brokerNotifiedAt),
      sourceExternalIds: unique(arrayOf(incident?.sourceExternalIds)),
      citationId: cleanText(incident?.citationId),
      notes: cleanText(incident?.notes),
    }))
    .filter((incident): incident is any => Boolean(incident?.incidentDate || incident?.claimNoticeDate || incident?.notes));
}

function normalizeAnnualReviews(value: unknown) {
  return arrayOf(value)
    .map((review: any) => compactRecord({
      reviewDate: cleanDate(review?.reviewDate),
      boardMeetingDate: cleanDate(review?.boardMeetingDate),
      reviewer: cleanText(review?.reviewer),
      outcome: cleanText(review?.outcome),
      nextReviewDate: cleanDate(review?.nextReviewDate),
      sourceExternalIds: unique(arrayOf(review?.sourceExternalIds)),
      citationId: cleanText(review?.citationId),
      notes: cleanText(review?.notes),
    }))
    .filter((review): review is any => Boolean(review?.reviewDate));
}

function normalizeComplianceChecks(value: unknown) {
  return arrayOf(value)
    .map((check: any) => compactRecord({
      label: cleanText(check?.label),
      status: cleanText(check?.status),
      dueDate: cleanDate(check?.dueDate),
      completedAt: cleanDate(check?.completedAt),
      sourceExternalIds: unique(arrayOf(check?.sourceExternalIds)),
      citationId: cleanText(check?.citationId),
      notes: cleanText(check?.notes),
    }))
    .filter((check): check is any => Boolean(check?.label));
}

function sourceExternalIdsFor(recordKind: string, payload: any) {
  if (recordKind === "source" && payload.externalId) return [payload.externalId];
  if (Array.isArray(payload.sourceExternalIds)) return payload.sourceExternalIds.map(String);
  if (payload.externalId) return [String(payload.externalId)];
  if (typeof payload.id === "number") return [`paperless:${payload.id}`];
  return [];
}

function titleForRecord(recordKind: string, payload: any) {
  if (recordKind === "source") return cleanText(payload?.title) || cleanText(payload?.externalId) || "Source";
  if (recordKind === "fact") return cleanText(payload?.label) || "Profile fact";
  if (recordKind === "event") return cleanText(payload?.title) || "Timeline event";
  if (recordKind === "boardTerm") return cleanText(payload?.personName) || "Board or role service";
  if (recordKind === "motion") return cleanText(payload?.motionText) || cleanText(payload?.meetingTitle) || "Meeting motion";
  if (recordKind === "meetingMinutes") return cleanText(payload?.meetingTitle) || cleanText(payload?.sourceDocumentTitle) || "Meeting minutes";
  if (recordKind === "budget") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Budget snapshot";
  if (recordKind === "filing") return cleanText(payload?.title) || cleanText(payload?.kind) || "Filing";
  if (recordKind === "deadline") return cleanText(payload?.title) || "Deadline";
  if (recordKind === "bylawAmendment") return cleanText(payload?.title) || cleanText(payload?.filedAtISO) || "Bylaw amendment";
  if (recordKind === "publication") return cleanText(payload?.title) || "Publication";
  if (recordKind === "insurancePolicy") return cleanText(payload?.title) || cleanText(payload?.policyNumber) || "Insurance policy";
  if (recordKind === "financialStatement") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Financial statement";
  if (recordKind === "grant") return cleanText(payload?.title) || cleanText(payload?.program) || "Grant";
  if (recordKind === "recordsLocation") return cleanText(payload?.title) || cleanText(payload?.address) || "Records location";
  if (recordKind === "archiveAccession") return cleanText(payload?.title) || cleanText(payload?.accessionNumber) || "Archive accession";
  if (recordKind === "boardRoleAssignment") return cleanText(payload?.personName) || cleanText(payload?.name) || "Board role assignment";
  if (recordKind === "boardRoleChange") return cleanText(payload?.roleTitle) || cleanText(payload?.changeType) || "Board role change";
  if (recordKind === "signingAuthority") return cleanText(payload?.personName) || cleanText(payload?.institutionName) || "Signing authority";
  if (recordKind === "meetingAttendance") return cleanText(payload?.personName) || cleanText(payload?.meetingTitle) || "Meeting attendance";
  if (recordKind === "motionEvidence") return cleanText(payload?.motionText) || cleanText(payload?.meetingTitle) || "Motion evidence";
  if (recordKind === "budgetSnapshot") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Budget snapshot";
  if (recordKind === "financialStatementImport") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Financial statement import";
  if (recordKind === "treasurerReport") return cleanText(payload?.title) || cleanText(payload?.reportDate) || "Treasurer report";
  if (recordKind === "transactionCandidate") return cleanText(payload?.description) || cleanText(payload?.title) || "Transaction candidate";
  if (recordKind === "organizationAddress") return cleanText(payload?.title) || cleanText(payload?.type) || cleanText(payload?.address) || "Organization address";
  if (recordKind === "organizationRegistration") return cleanText(payload?.jurisdiction) || cleanText(payload?.registrationNumber) || "Organization registration";
  if (recordKind === "organizationIdentifier") return cleanText(payload?.kind) || cleanText(payload?.type) || "Organization identifier";
  if (recordKind === "policy") return cleanText(payload?.policyName) || cleanText(payload?.name) || "Policy";
  if (recordKind === "workflowPackage") return cleanText(payload?.packageName) || cleanText(payload?.eventType) || "Workflow package";
  if (recordKind === "minuteBookItem") return cleanText(payload?.title) || cleanText(payload?.recordType) || "Minute book record";
  if (recordKind === "roleHolder") return cleanText(payload?.fullName) || cleanText(payload?.name) || [payload?.firstName, payload?.lastName].map(cleanText).filter(Boolean).join(" ") || "Role holder";
  if (recordKind === "rightsClass") return cleanText(payload?.className) || cleanText(payload?.rightsClassName) || cleanText(payload?.name) || "Rights class";
  if (recordKind === "rightsholdingTransfer") return cleanText(payload?.title) || cleanText(payload?.transferType) || "Rightsholding transfer";
  if (recordKind === "legalTemplateDataField") return cleanText(payload?.name) || cleanText(payload?.fieldName) || "Template data field";
  if (recordKind === "legalTemplate") return cleanText(payload?.name) || cleanText(payload?.templateName) || "Legal template";
  if (recordKind === "legalPrecedent") return cleanText(payload?.packageName) || cleanText(payload?.name) || "Legal precedent";
  if (recordKind === "legalPrecedentRun") return cleanText(payload?.name) || cleanText(payload?.partName) || "Legal package run";
  if (recordKind === "generatedLegalDocument") return cleanText(payload?.title) || cleanText(payload?.documentName) || "Generated legal document";
  if (recordKind === "legalSigner") return cleanText(payload?.fullName) || cleanText(payload?.name) || cleanText(payload?.email) || "Legal signer";
  if (recordKind === "formationRecord") return cleanText(payload?.nuansNumber) || cleanText(payload?.jurisdiction) || "Formation record";
  if (recordKind === "nameSearchItem") return cleanText(payload?.name) || cleanText(payload?.nuansReportNumber) || "Name search";
  if (recordKind === "entityAmendment") return cleanText(payload?.entityNameNew) || cleanText(payload?.newEntityName) || "Entity amendment";
  if (recordKind === "annualMaintenanceRecord") return cleanText(payload?.yearFilingFor) || cleanText(payload?.filingYear) || "Annual maintenance";
  if (recordKind === "jurisdictionMetadata") return cleanText(payload?.label) || cleanText(payload?.jurisdiction) || cleanText(payload?.value) || "Jurisdiction metadata";
  if (recordKind === "supportLog") return cleanText(payload?.detailsHeading) || cleanText(payload?.logType) || cleanText(payload?.type) || "Support log";
  if (recordKind === "sourceEvidence") return cleanText(payload?.sourceTitle) || cleanText(payload?.title) || "Source evidence";
  if (recordKind === "secretVaultItem") return cleanText(payload?.name) || cleanText(payload?.title) || cleanText(payload?.service) || "Access custody reference";
  if (recordKind === "pipaTraining") return cleanText(payload?.participantName) || cleanText(payload?.title) || "PIPA training";
  if (recordKind === "employee") return cleanText(payload?.name) || [payload?.firstName, payload?.lastName].map(cleanText).filter(Boolean).join(" ") || "Employee";
  if (recordKind === "volunteer") return cleanText(payload?.name) || [payload?.firstName, payload?.lastName].map(cleanText).filter(Boolean).join(" ") || "Volunteer";
  return cleanText(payload?.title) || cleanText(payload?.id) || "Document candidate";
}

function descriptionForRecord(recordKind: string, payload: any) {
  if (recordKind === "fact") return cleanText(payload?.value);
  if (recordKind === "event") return cleanText(payload?.summary);
  if (recordKind === "boardTerm") return [payload?.position, payload?.committeeName, payload?.startDate].map(cleanText).filter(Boolean).join(" · ");
  if (recordKind === "motion") return cleanText(payload?.motionText);
  if (recordKind === "meetingMinutes") return [payload?.meetingDate, `${payload?.motions?.length ?? 0} motions`, payload?.notes].map(cleanText).filter(Boolean).join(" · ");
  if (recordKind === "budget") return [payload?.fiscalYear, payload?.currency, payload?.notes].map(cleanText).filter(Boolean).join(" · ");
  if (recordKind === "source") return [payload?.category, payload?.sourceDate, payload?.notes].map(cleanText).filter(Boolean).join(" · ");
  if (SECTION_RECORD_KINDS.includes(recordKind as any)) {
    return [
      payload?.sourceDate,
      payload?.dueDate,
      payload?.filedAt,
      payload?.filedAtISO,
      payload?.status,
      payload?.category,
      payload?.notes,
    ].map(cleanText).filter(Boolean).join(" · ");
  }
  return [payload?.created, payload?.tags?.join?.(", "), payload?.snippet].map(cleanText).filter(Boolean).join(" · ");
}

function titleForHistoryItem(kind: string, payload: any) {
  if (kind === "fact") return cleanText(payload?.label) || "Profile fact";
  if (kind === "event") return cleanText(payload?.title) || "History event";
  if (kind === "boardTerm") return cleanText(payload?.personName) || "Board term";
  if (kind === "motion") return cleanText(payload?.motionText) || cleanText(payload?.meetingTitle) || "Motion";
  if (kind === "budget") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Budget";
  return "History item";
}

async function insertSourceEvidenceForAppliedRecord(
  ctx: any,
  societyId: string,
  record: any,
  targetId: any,
  sourceDocumentIds: any[],
) {
  const payload = record.payload ?? {};
  const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
  const restricted = payload.sensitivity === "restricted" || (record.riskFlags ?? []).includes("restricted");
  const firstSourceDocumentId = sourceDocumentIds[0];
  const externalSystem = cleanText(payload.externalSystem) || sourceSystemFromExternalId(sourceExternalIds[0]);
  await ctx.db.insert("sourceEvidence", {
    societyId,
    sourceDocumentId: firstSourceDocumentId,
    externalSystem,
    externalId: sourceExternalIds[0],
    sourceTitle: cleanText(payload.sourceTitle) || cleanText(payload.title) || record.title || `${sourceSystemLabel(externalSystem)} source`,
    sourceDate: cleanDate(payload.sourceDate),
    evidenceKind: restricted ? "restricted" : "import_support",
    targetTable: targetTableForRecordKind(record.recordKind),
    targetId: String(targetId),
    sensitivity: restricted ? "restricted" : "standard",
    accessLevel: restricted ? "restricted" : "internal",
    summary: sourceNoteFor(record, sourceDocumentIds) || "Source evidence created from an approved import-session record.",
    excerpt: restricted ? undefined : cleanText(payload.excerpt),
    status: "Linked",
    notes: "Created automatically when the approved import record was applied.",
    createdAtISO: new Date().toISOString(),
  });
}

function targetTableForRecordKind(kind: string) {
  return ({
    filing: "filings",
    deadline: "deadlines",
    bylawAmendment: "bylawAmendments",
    publication: "publications",
    insurancePolicy: "insurancePolicies",
    financialStatement: "financials",
    financialStatementImport: "financialStatementImports",
    grant: "grants",
    recordsLocation: "recordsLocation",
    archiveAccession: "archiveAccessions",
    boardRoleAssignment: "boardRoleAssignments",
    boardRoleChange: "boardRoleChanges",
    signingAuthority: "signingAuthorities",
    meetingAttendance: "meetingAttendanceRecords",
    motionEvidence: "motionEvidence",
    budgetSnapshot: "budgetSnapshots",
    treasurerReport: "treasurerReports",
    transactionCandidate: "transactionCandidates",
    organizationAddress: "organizationAddresses",
    organizationRegistration: "organizationRegistrations",
    organizationIdentifier: "organizationIdentifiers",
    policy: "policies",
    workflowPackage: "workflowPackages",
    minuteBookItem: "minuteBookItems",
    roleHolder: "roleHolders",
    rightsClass: "rightsClasses",
    rightsholdingTransfer: "rightsholdingTransfers",
    legalTemplateDataField: "legalTemplateDataFields",
    legalTemplate: "legalTemplates",
    legalPrecedent: "legalPrecedents",
    legalPrecedentRun: "legalPrecedentRuns",
    generatedLegalDocument: "generatedLegalDocuments",
    legalSigner: "legalSigners",
    formationRecord: "formationRecords",
    nameSearchItem: "nameSearchItems",
    entityAmendment: "entityAmendments",
    annualMaintenanceRecord: "annualMaintenanceRecords",
    jurisdictionMetadata: "jurisdictionMetadata",
    supportLog: "supportLogs",
    secretVaultItem: "secretVaultItems",
    pipaTraining: "pipaTrainings",
    employee: "employees",
    volunteer: "volunteers",
  } as Record<string, string>)[kind] ?? kind;
}

function summarizeRecords(records: any[]) {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byTarget: Record<string, number> = {};
  let riskCount = 0;
  let orgHistoryApplied = 0;
  let meetingsApplied = 0;
  let documentsApplied = 0;
  let sectionsApplied = 0;
  for (const record of records) {
    byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    byTarget[record.targetModule] = (byTarget[record.targetModule] ?? 0) + 1;
    if ((record.riskFlags ?? []).length > 0) riskCount += 1;
    if (record.importedTargets?.orgHistory) orgHistoryApplied += 1;
    if (record.importedTargets?.meetings) meetingsApplied += 1;
    if (record.importedTargets?.documents) documentsApplied += 1;
    if (record.importedTargets?.sections) sectionsApplied += 1;
  }
  return {
    total: records.length,
    byKind,
    byStatus,
    byTarget,
    riskCount,
    orgHistoryApplied,
    meetingsApplied,
    documentsApplied,
    sectionsApplied,
  };
}

function summaryForSession(session: any) {
  const summary = session?.summary;
  if (summary && typeof summary === "object" && Number.isFinite(Number(summary.total))) {
    return {
      total: Number(summary.total) || 0,
      byKind: isPlainObject(summary.byKind) ? summary.byKind : {},
      byStatus: isPlainObject(summary.byStatus) ? summary.byStatus : {},
      byTarget: isPlainObject(summary.byTarget) ? summary.byTarget : {},
      riskCount: Number(summary.riskCount) || 0,
      orgHistoryApplied: Number(summary.orgHistoryApplied) || 0,
      meetingsApplied: Number(summary.meetingsApplied) || 0,
      documentsApplied: Number(summary.documentsApplied) || 0,
      sectionsApplied: Number(summary.sectionsApplied) || 0,
    };
  }
  return summarizeFromSessionMetadata(session);
}

function isPlainObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function summarizeFromSessionMetadata(session: any) {
  const metadata = session?.bundleMetadata ?? {};
  const counts = { ...(metadata.recordCounts ?? {}) };
  if (metadata.generatedMeetingRecords || metadata.candidateDocuments) {
    if (metadata.generatedMeetingRecords) counts.meetingMinutes = metadata.generatedMeetingRecords;
    if (metadata.candidateDocuments) {
      counts.source = Math.max(Number(counts.source ?? 0), Number(metadata.candidateDocuments) || 0);
      counts.documentCandidates = Math.max(Number(counts.documentCandidates ?? 0), Number(metadata.candidateDocuments) || 0);
    }
  }
  if (session?.qualitySummary?.sourceDocumentRows && Object.keys(counts).length === 0) {
    counts.documentCandidates = Number(session.qualitySummary.sourceDocumentRows) || 0;
  }
  const byKind: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (key === "sources") byKind.source = Number(value) || 0;
    else if (key === "source") byKind.source = Number(value) || 0;
    else if (key === "meetingMinutes") byKind.meetingMinutes = Number(value) || 0;
    else {
      const singular = String(key).replace(/ies$/, "y").replace(/s$/, "");
      byKind[singular] = Number(value) || 0;
    }
  }
  const total = Object.values(byKind).reduce((sum, value) => sum + value, 0);
  return {
    total,
    byKind,
    byStatus: total ? { Pending: total } : {},
    byTarget: {},
    riskCount: 0,
    orgHistoryApplied: 0,
    meetingsApplied: 0,
    documentsApplied: 0,
    sectionsApplied: 0,
  };
}

function hydrateSession(doc: any): any {
  const payload = parseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    name: payload.name ?? doc.title,
    createdAtISO: payload.createdAtISO ?? doc.createdAtISO,
  };
}

function hydrateRecord(doc: any): any {
  const payload = parseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: payload.title ?? doc.title,
    status: normalizeReviewStatus(payload.status),
    sourceExternalIds: Array.isArray(payload.sourceExternalIds) ? payload.sourceExternalIds : [],
    riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags : [],
    importedTargets: payload.importedTargets ?? {},
  };
}

function hydrateHistorySource(doc: any) {
  const payload = parseJson(doc?.content);
  return { ...payload, _id: doc._id };
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function externalIdFromTags(tags: unknown) {
  if (!Array.isArray(tags)) return undefined;
  const tag = tags.map(String).find((value) => /^(paperless:\d+|local:sha256:[a-f0-9]{16,}|file:|onedrive:)/i.test(value));
  return tag || undefined;
}

function sourceCatalogForRecords(records: any[]) {
  const catalog = new Map<string, any>();
  for (const record of records) {
    if (record.recordKind === "source") {
      const source = normalizeSourcePayload(record.payload);
      if (source.externalId && !catalog.has(source.externalId)) {
        catalog.set(source.externalId, source);
      }
      continue;
    }

    if (record.recordKind === "documentCandidate" && record.importedTargets?.documents) {
      const payload = record.payload ?? {};
      const externalIds = unique([
        ...(record.sourceExternalIds ?? []),
        ...(payload.sourceExternalIds ?? []),
        payload.externalId,
        payload.id != null ? `paperless:${payload.id}` : undefined,
      ]);
      for (const externalId of externalIds) {
        const existing = catalog.get(externalId) ?? {};
        catalog.set(externalId, { ...existing, documentId: record.importedTargets.documents });
      }
    }
  }
  return catalog;
}

function isImportSession(doc: any): doc is Record<string, any> {
  return Boolean(doc?.tags?.includes(SESSION_TAG) && !doc?.tags?.includes(RECORD_TAG));
}

function isImportRecord(doc: any): doc is Record<string, any> {
  return Boolean(doc?.tags?.includes(SESSION_TAG) && doc?.tags?.includes(RECORD_TAG));
}

function isHistorySource(doc: any) {
  return Boolean(doc?.tags?.includes(HISTORY_TAG) && doc?.tags?.includes(HISTORY_SOURCE_TAG));
}

function historySourceTags(source: any) {
  return [HISTORY_TAG, HISTORY_SOURCE_TAG, tagValue(source.category), tagValue(source.externalSystem)].filter(Boolean);
}

function riskFlagsFor(recordKind: string, targetModule: string, payload: any) {
  const flags = new Set<string>();
  const sections = Array.isArray(payload?.sections) ? payload.sections.join(" ") : "";
  const tags = Array.isArray(payload?.tags) ? payload.tags.join(" ") : "";
  const text = `${recordKind} ${targetModule} ${payload?.category ?? ""} ${payload?.notes ?? ""} ${payload?.title ?? ""} ${payload?.name ?? ""} ${payload?.service ?? ""} ${payload?.credentialType ?? ""} ${payload?.sensitivity ?? ""} ${sections} ${tags}`.toLowerCase();
  if (confidenceFor(payload) === "Review" || payload?.status === "NeedsReview") flags.add("needs review");
  if (payload?.sensitivity === "restricted") flags.add("restricted");
  if (/(finance|financial|treasurer|receipt|invoice|payroll|tax|bank|employee|member|student id|privacy|insurance|legal|sin|secret|credential|password|recovery key|registry key|api key)/.test(text)) flags.add("restricted");
  if (/(duplicate|ocr|bad date|manual review|placeholder)/.test(text)) flags.add("cleanup");
  for (const flag of staticValidationFlagsFor(recordKind, payload)) flags.add(flag);
  return Array.from(flags);
}

function staticValidationFlagsFor(recordKind: string, payload: any) {
  const flags: string[] = [];
  if ([
    "organizationAddress",
    "organizationRegistration",
    "organizationIdentifier",
    "policy",
    "workflowPackage",
    "minuteBookItem",
    "roleHolder",
    "rightsClass",
    "rightsholdingTransfer",
    "legalTemplateDataField",
    "legalTemplate",
    "legalPrecedent",
    "legalPrecedentRun",
    "generatedLegalDocument",
    "legalSigner",
    "formationRecord",
    "nameSearchItem",
    "entityAmendment",
    "annualMaintenanceRecord",
    "jurisdictionMetadata",
    "supportLog",
  ].includes(recordKind)) {
    if (confidenceFor(payload) === "Review") flags.push("confidence");
  }
  if (recordKind === "organizationAddress" && (!cleanText(payload?.street) && !cleanText(payload?.address))) flags.push("validation");
  if (recordKind === "organizationAddress" && !cleanText(payload?.city)) flags.push("validation");
  if (recordKind === "organizationRegistration" && !cleanText(payload?.jurisdiction)) flags.push("validation");
  if (recordKind === "organizationIdentifier" && (!cleanText(payload?.number) || (!cleanText(payload?.kind) && !cleanText(payload?.type)))) flags.push("validation");
  if (recordKind === "policy" && !cleanText(payload?.policyName) && !cleanText(payload?.name)) flags.push("validation");
  if (recordKind === "workflowPackage" && (!cleanText(payload?.eventType) || (!cleanText(payload?.packageName) && !cleanText(payload?.package)))) flags.push("validation");
  if (recordKind === "minuteBookItem" && !cleanText(payload?.title)) flags.push("validation");
  if (recordKind === "roleHolder" && !cleanText(payload?.fullName) && !cleanText(payload?.name) && !cleanText(payload?.firstName) && !cleanText(payload?.lastName)) flags.push("validation");
  if (recordKind === "rightsClass" && !cleanText(payload?.className) && !cleanText(payload?.name) && !cleanText(payload?.rightsClassName)) flags.push("validation");
  if (recordKind === "legalTemplateDataField" && !cleanText(payload?.name) && !cleanText(payload?.fieldName)) flags.push("validation");
  if (recordKind === "legalTemplate" && !cleanText(payload?.name) && !cleanText(payload?.templateName)) flags.push("validation");
  if (recordKind === "legalPrecedent" && !cleanText(payload?.packageName) && !cleanText(payload?.name)) flags.push("validation");
  if (recordKind === "legalPrecedentRun" && !cleanText(payload?.name) && !cleanText(payload?.partName)) flags.push("validation");
  if (recordKind === "generatedLegalDocument" && !cleanText(payload?.title) && !cleanText(payload?.documentName)) flags.push("validation");
  if (recordKind === "legalSigner" && !cleanText(payload?.fullName) && !cleanText(payload?.name) && !cleanText(payload?.email)) flags.push("validation");
  if (recordKind === "nameSearchItem" && !cleanText(payload?.name)) flags.push("validation");
  if (recordKind === "jurisdictionMetadata" && !cleanText(payload?.jurisdiction) && !cleanText(payload?.value)) flags.push("validation");
  return flags;
}

function confidenceFor(payload: any) {
  return payload?.confidence === "High" || payload?.confidence === "Medium" ? payload.confidence : "Review";
}

function normalizeReviewStatus(status: unknown) {
  const value = cleanText(status);
  return REVIEW_STATUSES.includes(value as any) ? value : "Pending";
}

function sessionName(bundle: any) {
  return cleanText(bundle?.metadata?.name) || cleanText(bundle?.name) || "Paperless import session";
}

function sourceSystem(bundle: any) {
  return cleanText(bundle?.metadata?.createdFrom) || cleanText(bundle?.sourceExport?.baseUrl) || "Paperless";
}

function firstSection(doc: any) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : Array.isArray(doc?.candidateSections) ? doc.candidateSections : [];
  return cleanText(sections[0]) || "Documents";
}

function importedLibrarySection(targetModule: unknown, sections: string[] = []) {
  const haystack = [targetModule, ...sections].map((value) => cleanText(value)?.toLowerCase()).filter(Boolean).join(" ");
  if (/\bmeeting|minutes|agenda|board\b/.test(haystack)) return "meeting_material";
  if (/\bfinancial|treasurer|budget|receipt|expense\b/.test(haystack)) return "finance";
  if (/\bpolicy|privacy|pipa\b/.test(haystack)) return "policy";
  if (/\bconstitution|bylaw|governance|filing|resolution|minute-book\b/.test(haystack)) return "governance";
  return "reference";
}

function inferMeetingType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("annual general") || lower.includes("agm")) return "AGM";
  if (lower.includes("committee")) return "Committee";
  if (lower.includes("special general") || lower.includes("sgm")) return "SGM";
  return "Board";
}

function toMeetingDateTime(date: unknown) {
  const value = cleanText(date) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01T12:00:00.000Z`;
  if (/^\d{4}$/.test(value)) return `${value}-01-01T12:00:00.000Z`;
  return new Date().toISOString();
}

function recordSortKey(record: any) {
  const payload = record.payload ?? {};
  return [
    record.status === "Pending" ? "0" : record.status === "Approved" ? "1" : "2",
    record.recordKind,
    payload.eventDate ?? payload.meetingDate ?? payload.startDate ?? payload.sourceDate ?? "",
    record.title,
  ].join("::");
}

function sourceNoteFor(record: any, sourceDocumentIds: any[]) {
  const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? [])]);
  const parts = [
    cleanText(record.payload?.notes),
    sourceExternalIds.length ? `Sources: ${sourceExternalIds.join(", ")}` : undefined,
    sourceDocumentIds.length ? `Linked source document ids: ${sourceDocumentIds.join(", ")}` : undefined,
    cleanText(record.payload?.confidence) ? `Confidence: ${record.payload.confidence}` : undefined,
    cleanText(record.payload?.sensitivity) ? `Sensitivity: ${record.payload.sensitivity}` : undefined,
  ].filter(Boolean);
  return parts.join("\n");
}

function bylawImportHistory(payload: any, status: string, sourceExternalIds: string[]) {
  const now = new Date().toISOString();
  const actor = cleanText(payload.createdByName) || cleanText(payload.filedBy) || "Import review";
  const createdAt = cleanDateTime(payload.createdAtISO) || cleanDateTime(payload.sourceDate) || now;
  const history = [
    {
      atISO: createdAt,
      actor,
      action: "created",
      note: [
        "Created from approved import-session record.",
        sourceExternalIds.length ? `Sources: ${sourceExternalIds.join(", ")}` : undefined,
      ].filter(Boolean).join(" "),
    },
  ];
  const resolutionAt = cleanDateTime(payload.resolutionPassedAtISO) || cleanDateTime(payload.specialResolutionDate);
  if (resolutionAt) {
    history.push({
      atISO: resolutionAt,
      actor,
      action: "resolution_passed",
      note: "Resolution date imported from source document.",
    });
  }
  const filedAt = cleanDateTime(payload.filedAtISO) || cleanDateTime(payload.filedAt);
  if (status === "Filed" && filedAt) {
    history.push({
      atISO: filedAt,
      actor,
      action: "filed",
      note: "Filing date imported from source document.",
    });
  }
  return history;
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  const date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (date) return date;
  const month = text.match(/\d{4}-\d{2}/)?.[0];
  if (month) return `${month}-01`;
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
  if (year) return `${year}-01-01`;
  return undefined;
}

function cleanDateTime(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const date = cleanDate(text);
  return date ? `${date}T00:00:00.000Z` : undefined;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function fiscalYearFromDate(value: unknown) {
  const date = cleanDate(value) ?? todayDate();
  return date.slice(0, 4);
}

function splitName(value: unknown) {
  const parts = cleanText(value)?.split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return { firstName: undefined, lastName: undefined };
  if (parts.length === 1) return { firstName: parts[0], lastName: undefined };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function personKey(value: unknown) {
  return cleanText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function tagValue(value: unknown) {
  const text = cleanText(value);
  return text ? text.toLowerCase().replace(/\s+/g, "-") : undefined;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function arrayOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function compactStrings(values: unknown[]): string[] {
  return values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value));
}

function compactRecord<T extends Record<string, any>>(value: T): T | undefined {
  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean))) as string[];
}

function numberOrUndefined(value: unknown) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = cleanText(value)?.toLowerCase();
  if (!text) return undefined;
  if (["yes", "y", "true", "1", "counted", "recorded", "carried", "elected"].includes(text)) return true;
  if (["no", "n", "false", "0", "not counted", "not recorded", "defeated", "not elected"].includes(text)) return false;
  return undefined;
}

function sourceSystemFromExternalId(externalId: unknown) {
  const text = cleanText(externalId)?.toLowerCase() ?? "";
  if (text.startsWith("local:")) return "local";
  if (text.startsWith("file:")) return "local";
  if (text.startsWith("onedrive:")) return "onedrive";
  return "paperless";
}

function sourceSystemLabel(externalSystem: unknown) {
  const system = cleanText(externalSystem)?.toLowerCase();
  if (system === "local") return "Local file";
  if (system === "onedrive") return "OneDrive file";
  if (system === "paperless") return "Paperless";
  return cleanText(externalSystem) || "External source";
}

function sourceSystemTag(externalSystem: unknown) {
  const system = cleanText(externalSystem)?.toLowerCase() || "paperless";
  if (system === "local" || system === "file") return "local";
  if (system === "onedrive") return "onedrive";
  if (system === "paperless") return "paperless";
  return system.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "external";
}

function fallbackSourceTitle(externalId: unknown) {
  const text = cleanText(externalId) || "Imported source";
  if (/^paperless:/i.test(text)) return `Paperless source ${text.replace(/^paperless:/i, "")}`;
  if (/^local:sha256:/i.test(text)) return `Local source ${text.replace(/^local:sha256:/i, "").slice(0, 12)}`;
  if (/^file:/i.test(text)) return text.replace(/^file:/i, "").split(/[\\/]/).filter(Boolean).pop() || text;
  return text;
}
