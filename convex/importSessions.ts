import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
  "sourceEvidence",
  "secretVaultItem",
  "pipaTraining",
  "employee",
  "volunteer",
] as const;

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const sessions = await docsByCategory(ctx, societyId, SESSION_CATEGORY);
    const rows = [];
    for (const doc of sessions.filter(isImportSession)) {
      const session = hydrateSession(doc);
      const recordDocs = await recordsForSession(ctx, doc._id);
      const records = recordDocs.map(hydrateRecord);
      rows.push({
        ...session,
        summary: records.length ? summarizeRecords(records) : summarizeFromSessionMetadata(session),
      });
    }

    return rows
      .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  },
});

export const get = query({
  args: { sessionId: v.id("documents") },
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
  handler: async (ctx, { societyId, name, bundle }) => {
    const now = new Date().toISOString();
    const records = recordsFromBundle(bundle);
    const sessionPayload = {
      kind: "importSession",
      name: cleanText(name) || sessionName(bundle),
      sourceSystem: sourceSystem(bundle),
      bundleMetadata: bundle?.metadata ?? null,
      createdAtISO: now,
      updatedAtISO: now,
      status: "Reviewing",
      qualitySummary: bundle?.specialistReports?.qualityDuplicates?.summary ?? null,
    };

    const sessionId = await ctx.db.insert("documents", {
      societyId,
      title: sessionPayload.name,
      category: SESSION_CATEGORY,
      content: JSON.stringify(sessionPayload),
      createdAtISO: now,
      flaggedForDeletion: false,
      tags: [SESSION_TAG, tagValue(sessionPayload.sourceSystem)],
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
          reviewNotes: "",
          importedTargets: {},
          createdAtISO: now,
          updatedAtISO: now,
        }),
        createdAtISO: now,
        flaggedForDeletion: false,
        tags: [SESSION_TAG, RECORD_TAG, tagValue(record.recordKind), tagValue(record.targetModule)],
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
      tags: [SESSION_TAG, RECORD_TAG, tagValue(next.recordKind), tagValue(next.targetModule)],
    });
    return recordId;
  },
});

export const bulkSetStatus = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordIds: v.optional(v.array(v.id("documents"))),
  },
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
    return { updated };
  },
});

export const removeSession = mutation({
  args: { sessionId: v.id("documents") },
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
        motions: payload.motions.map(minutesMotionFromPayload),
        decisions: payload.decisions,
        actionItems: payload.actionItems,
        sourceDocumentIds,
        sourceExternalIds,
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

  const mergedSourceExternalIds = unique([...(minutesRow.sourceExternalIds ?? []), ...sourceExternalIds]);
  if (mergedSourceExternalIds.length !== (minutesRow.sourceExternalIds ?? []).length) minutesPatch.sourceExternalIds = mergedSourceExternalIds;
  const mergedSourceDocumentIds = unique([...(minutesRow.sourceDocumentIds ?? []), ...sourceDocumentIds]);
  if (mergedSourceDocumentIds.length !== (minutesRow.sourceDocumentIds ?? []).length) minutesPatch.sourceDocumentIds = mergedSourceDocumentIds;

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
      const meeting = await ctx.db.get(target.meetingId);
      const minutesRow = await ctx.db.get(target.minutesId);
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
      coverageCents: numberOrUndefined(payload.coverageCents),
      premiumCents: numberOrUndefined(payload.premiumCents),
      deductibleCents: numberOrUndefined(payload.deductibleCents),
      coverageSummary: cleanText(payload.coverageSummary),
      additionalInsureds: arrayOf(payload.additionalInsureds).map(String).map(cleanText).filter(Boolean),
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
      notes: sourceNote,
      createdAtISO: new Date().toISOString(),
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
    return await ctx.db.insert("boardRoleAssignments", {
      societyId,
      personName,
      personKey: personKey(personName),
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
    return await ctx.db.insert("boardRoleChanges", {
      societyId,
      effectiveDate: cleanDate(payload.effectiveDate) || cleanDate(payload.sourceDate) || todayDate(),
      changeType: cleanText(payload.changeType) || "needs_review",
      roleTitle: cleanText(payload.roleTitle) || cleanText(payload.position) || "Needs review",
      personName: cleanText(payload.personName),
      previousPersonName: cleanText(payload.previousPersonName),
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
    return await ctx.db.insert("meetingAttendanceRecords", {
      societyId,
      meetingTitle: cleanText(payload.meetingTitle) || record.title || "Imported meeting",
      meetingDate: cleanDate(payload.meetingDate) || cleanDate(payload.sourceDate) || todayDate(),
      personName: cleanText(payload.personName) || cleanText(payload.name) || "Needs review",
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
    return await ctx.db.insert("motionEvidence", {
      societyId,
      meetingTitle: cleanText(payload.meetingTitle) || record.title || "Imported meeting",
      meetingDate: cleanDate(payload.meetingDate) || cleanDate(payload.sourceDate) || todayDate(),
      motionText: cleanText(payload.motionText) || cleanText(payload.evidenceText) || "Imported motion evidence",
      movedBy: cleanText(payload.movedBy) || cleanText(payload.movedByName),
      secondedBy: cleanText(payload.secondedBy) || cleanText(payload.secondedByName),
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

async function patchSessionUpdatedAt(ctx: any, sessionId: string) {
  const doc = await ctx.db.get(sessionId);
  if (!isImportSession(doc)) return;
  const payload = hydrateSession(doc);
  await ctx.db.patch(sessionId, {
    content: JSON.stringify({ ...payload, updatedAtISO: new Date().toISOString() }),
  });
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
  for (const publication of arrayOf(bundle?.publications)) records.push(makeRecord("publication", "publications", publication));
  for (const policy of arrayOf(bundle?.insurancePolicies)) records.push(makeRecord("insurancePolicy", "insurance", policy));
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
    attendees: arrayOf(minutes?.attendees).map(String).map(cleanText).filter(Boolean),
    absent: arrayOf(minutes?.absent).map(String).map(cleanText).filter(Boolean),
    quorumMet: Boolean(minutes?.quorumMet),
    agendaItems: arrayOf(minutes?.agendaItems).map(String).map(cleanText).filter(Boolean),
    discussion: cleanText(minutes?.discussion),
    motions: arrayOf(minutes?.motions).map(normalizeMotionPayload),
    decisions: arrayOf(minutes?.decisions).map(String).map(cleanText).filter(Boolean),
    actionItems: arrayOf(minutes?.actionItems),
    sourceExternalIds: arrayOf(minutes?.sourceExternalIds).map(String),
    sourceDocumentTitle: cleanText(minutes?.sourceDocumentTitle),
    sourceDocumentId: minutes?.sourceDocumentId != null ? String(minutes.sourceDocumentId) : undefined,
    sectionIndex: numberOrUndefined(minutes?.sectionIndex),
    pageRef: cleanText(minutes?.pageRef),
    confidence: confidenceFor(minutes),
    notes: cleanText(minutes?.notes),
  };
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
    additionalInsureds: arrayOf(payload?.additionalInsureds).map(String).map(cleanText).filter(Boolean),
  };
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

function hydrateSession(doc: any) {
  const payload = parseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    name: payload.name ?? doc.title,
    createdAtISO: payload.createdAtISO ?? doc.createdAtISO,
  };
}

function hydrateRecord(doc: any) {
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

function isImportSession(doc: any) {
  return Boolean(doc?.tags?.includes(SESSION_TAG) && !doc?.tags?.includes(RECORD_TAG));
}

function isImportRecord(doc: any) {
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
  return Array.from(flags);
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

function inferMeetingType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("annual general") || lower.includes("agm")) return "AGM";
  if (lower.includes("committee")) return "Committee";
  if (lower.includes("special general") || lower.includes("sgm")) return "SGM";
  return "Board";
}

function toMeetingDateTime(date: string) {
  const value = cleanText(date);
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

function unique(values: unknown[]) {
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean))) as string[];
}

function numberOrUndefined(value: unknown) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
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
