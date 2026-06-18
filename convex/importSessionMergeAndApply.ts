// Import-session apply layer: ctx-taking writes, meeting merge, and record insertion.

import { transactionImportMappingCandidates } from "./providers/accounting";
import {
  HISTORY_ITEM_CATEGORY,
  HISTORY_ITEM_TAG,
  HISTORY_SOURCE_CATEGORY,
  HISTORY_TAG,
  RECORD_TAG,
  SESSION_TAG,
} from "./importSessionConstants";
import {
  arrayOf,
  cleanDate,
  cleanDateTime,
  cleanText,
  fallbackSourceTitle,
  fiscalYearFromDate,
  numberOrUndefined,
  optionalBoolean,
  personKey,
  sourceSystemFromExternalId,
  sourceSystemLabel,
  sourceSystemTag,
  splitName,
  tagValue,
  todayDate,
  unique,
} from "./importSessionUtils";
import {
  insurancePolicySeriesKey,
  insurancePolicyTermLabel,
  normalizeAnnualReviews,
  normalizeCertificatesOfInsurance,
  normalizeClaimIncidents,
  normalizeClaimsMadeTerms,
  normalizeComplianceChecks,
  normalizeCoverageItems,
  normalizeCoveredLocations,
  normalizeCoveredParties,
  normalizeDeclinedCoverages,
  normalizeInsuranceRequirements,
  normalizePayload,
  normalizePolicyDefinitions,
  normalizeSourcePayload,
  structuredMinutesPatchFromPayload,
} from "./importSessionNormalize";
import {
  hydrateHistorySource,
  hydrateRecord,
  hydrateSession,
  isHistorySource,
  isImportRecord,
  isImportSession,
  parseJson,
  sourceNoteFor,
  summarizeRecords,
  titleForHistoryItem,
} from "./importSessionMetadata";
import {
  bylawImportHistory,
  confidenceFor,
  historySourceTags,
  importedLibrarySection,
  sourceSystem,
  targetTableForRecordKind,
  toMeetingDateTime,
} from "./importSessionRecordKinds";

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

  const currentAgenda = await meetingAgendaItemTitles(ctx, meeting._id);
  const nextAgenda = arrayOf(payload.agendaItems).map(String).map(cleanText).filter(Boolean);
  const meetingPatch: any = {};
  if ((!Array.isArray(meeting.attendeeIds) || meeting.attendeeIds.length === 0) && arrayOf(payload.attendees).length > 0) {
    meetingPatch.attendeeIds = arrayOf(payload.attendees).map(String).map(cleanText).filter(Boolean);
  }
  // Agenda lives in the relational agendas/agendaItems store. Only overwrite the
  // existing items when the current agenda is just the generic imported
  // scaffold (so we don't clobber a reviewed agenda).
  if (nextAgenda.length > 0 && shouldReplaceMeetingAgenda(currentAgenda)) {
    await setMeetingAgendaItems(ctx, meeting, nextAgenda);
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

type SectionRecordContext = {
  ctx: any;
  societyId: string;
  record: any;
  payload: any;
  sourceDocumentIds: any[];
  firstSourceDocumentId: any;
  sourceNote: any;
};

type SectionRecordHandler = (h: SectionRecordContext) => Promise<any>;

// Per-record-kind insert handlers, keyed by recordKind. Each body is the verbatim
// logic formerly inlined in insertSectionRecord's if-chain; dispatch is now a lookup.
const SECTION_RECORD_HANDLERS: Record<string, SectionRecordHandler> = {
  filing: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  deadline: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
    return await ctx.db.insert("deadlines", {
      societyId,
      title: cleanText(payload.title) || record.title || "Imported deadline",
      description: sourceNote,
      dueDate: cleanDate(payload.dueDate) || cleanDate(payload.sourceDate) || todayDate(),
      category: cleanText(payload.category) || "Paperless",
      done: Boolean(payload.done),
      recurrence: cleanText(payload.recurrence),
    });
  },

  bylawAmendment: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  publication: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  insurancePolicy: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  financialStatement: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  financialStatementImport: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  grant: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  recordsLocation: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
    return await ctx.db.insert("recordsLocation", {
      societyId,
      address: cleanText(payload.address) || "Needs review",
      noticePostedAtOffice: Boolean(payload.noticePostedAtOffice),
      postedAtISO: cleanDate(payload.postedAtISO),
      computerProvidedForInspection: Boolean(payload.computerProvidedForInspection),
      notes: sourceNote,
    });
  },

  archiveAccession: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  boardRoleAssignment: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  boardRoleChange: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  signingAuthority: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  meetingAttendance: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  motionEvidence: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  budgetSnapshot: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  treasurerReport: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  transactionCandidate: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
    const mappingNotes = await transactionCandidateMappingNotes(ctx, societyId, payload, record);
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
      notes: [sourceNote, mappingNotes].filter(Boolean).join("\n"),
      createdAtISO: new Date().toISOString(),
    });
  },

  organizationAddress: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  organizationRegistration: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  organizationIdentifier: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  policy: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  workflowPackage: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  minuteBookItem: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  roleHolder: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  rightsClass: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  rightsholdingTransfer: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  legalTemplateDataField: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  legalTemplate: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  legalPrecedent: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  legalPrecedentRun: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  generatedLegalDocument: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  legalSigner: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  formationRecord: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  nameSearchItem: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  entityAmendment: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  annualMaintenanceRecord: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  jurisdictionMetadata: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  supportLog: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  sourceEvidence: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  secretVaultItem: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  pipaTraining: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  employee: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },

  volunteer: async ({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote }: SectionRecordContext) => {
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
  },
};

async function insertSectionRecord(ctx: any, societyId: string, record: any, sourceDocumentIds: any[]) {
  const payload = normalizePayload(record.recordKind, record.payload ?? {});
  const firstSourceDocumentId = sourceDocumentIds[0];
  const sourceNote = sourceNoteFor(record, sourceDocumentIds);

  const handler = SECTION_RECORD_HANDLERS[record.recordKind];
  if (!handler) {
    throw new Error(`Unsupported section record kind: ${record.recordKind}`);
  }
  return await handler({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId, sourceNote });
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

function inferImportedAgendaItemType(title: string) {
  const lower = String(title ?? "").toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
}

// Read the ordered agenda item titles for a meeting from the relational
// agendas/agendaItems store (the single source of truth).
async function meetingAgendaItemTitles(ctx: any, meetingId: any): Promise<string[]> {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a: any, b: any) => a.createdAtISO.localeCompare(b.createdAtISO));
  const agenda = agendas[0];
  if (!agenda) return [];
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q: any) => q.eq("agendaId", agenda._id))
    .collect();
  items.sort((a: any, b: any) => a.order - b.order);
  return items
    .map((item: any) => String(item.title ?? "").trim())
    .filter(Boolean);
}

// Replace (or seed) the agenda items for a meeting from a list of ordered
// titles. Creates the agenda row if one does not yet exist, then rewrites its
// items so the relational store reflects the imported agenda.
async function setMeetingAgendaItems(ctx: any, meeting: any, titles: string[]) {
  const cleaned = (titles ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) return;
  const now = new Date().toISOString();
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meeting._id))
    .collect();
  agendas.sort((a: any, b: any) => a.createdAtISO.localeCompare(b.createdAtISO));
  let agendaId = agendas[0]?._id;
  if (!agendaId) {
    agendaId = await ctx.db.insert("agendas", {
      societyId: meeting.societyId,
      meetingId: meeting._id,
      title: `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
  } else {
    const existingItems = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q: any) => q.eq("agendaId", agendaId))
      .collect();
    for (const item of existingItems) await ctx.db.delete(item._id);
    await ctx.db.patch(agendaId, { updatedAtISO: now });
  }
  for (let order = 0; order < cleaned.length; order += 1) {
    const title = cleaned[order];
    await ctx.db.insert("agendaItems", {
      societyId: meeting.societyId,
      agendaId,
      order,
      type: inferImportedAgendaItemType(title),
      title,
      depth: 0,
      createdAtISO: now,
    });
  }
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

async function transactionCandidateMappingNotes(ctx: any, societyId: any, payload: any, record: any) {
  const candidates = transactionImportMappingCandidates({
    sourceSystem: payload?.sourceSystem ?? payload?.externalSystem ?? sourceSystemFromExternalId(record?.sourceExternalIds?.[0]),
    accountName: cleanText(payload?.accountName),
    accountExternalId: cleanText(payload?.accountExternalId) ?? cleanText(payload?.accountId),
    accountCode: cleanText(payload?.accountCode),
    category: cleanText(payload?.category),
  });
  if (candidates.length === 0) return undefined;

  const providers = unique(candidates.map((candidate) => candidate.provider));
  const mappings = (
    await Promise.all(
      providers.map((provider) =>
        ctx.db
          .query("accountingAccountMappings")
          .withIndex("by_society_provider", (q: any) => q.eq("societyId", societyId).eq("provider", provider))
          .collect(),
      ),
    )
  ).flat().filter((mapping: any) => mapping.status === "active");

  const matches = candidates
    .map((candidate) => {
      const match = mappings.find((mapping: any) => mappingMatchesCandidate(mapping, candidate));
      if (!match) return undefined;
      return `${candidate.externalCategory ? "category" : "account"} ${candidate.externalAccountName ?? candidate.externalCategory ?? candidate.externalAccountId ?? candidate.externalAccountCode} -> ${match.financialAccountId}`;
    })
    .filter(Boolean);
  if (matches.length === 0) return undefined;
  return `Accounting mapping suggestions: ${unique(matches).join("; ")}`;
}

function mappingMatchesCandidate(mapping: any, candidate: any) {
  const equal = (a: unknown, b: unknown) => {
    const left = cleanText(a)?.toLowerCase();
    const right = cleanText(b)?.toLowerCase();
    return Boolean(left && right && left === right);
  };
  return (
    equal(mapping.externalAccountId, candidate.externalAccountId) ||
    equal(mapping.externalAccountCode, candidate.externalAccountCode) ||
    equal(mapping.externalAccountName, candidate.externalAccountName) ||
    equal(mapping.externalCategory, candidate.externalCategory)
  );
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

export {
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
  setMeetingAgendaItems,
  meetingAgendaItemTitles,
  sessionRecords,
  recordsForSession,
  docsByCategory,
  sourceLookupDocs,
  upsertHistorySources,
  insertHistoryItem,
  patchRecordImportTarget,
  patchRecordPromotionBlocked,
  patchSessionUpdatedAt,
  transactionCandidateMappingNotes,
  mappingMatchesCandidate,
  insertSourceEvidenceForAppliedRecord,
};
