import { recordPreflightGapsForBundle } from "./representationGaps";
import { existingImportTarget, rememberImportTarget } from "./importTargetIdentity";
/**
 * PORTABLE FUNCTIONS: the import-session review domain.
 *
 * These handlers read/write exclusively through the portable `ctx.db` contract
 * (plus the pure import-session helpers under ./importSessionHelpers) and run
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { syncMotionsForMinutes, transposeFreshImportedSourcePortable, assertMeetingHistoryReferences } from "./minutes";
import { actionPermission } from "./actionPolicy";
import { requirePermissionPortable, type Permission } from "./permissions";
import { requireDocumentAccess } from "./documents";
import {
  SESSION_TAG,
  RECORD_TAG,
  SESSION_CATEGORY,
  RECORD_CATEGORY,
  HISTORY_KINDS,
  SECTION_RECORD_KINDS,
  mergeExistingMeetingImport,
  minutesMotionFromPayload,
  ensureMeetingSourceDocuments,
  ensureImportSourceDocuments,
  insertSectionRecord,
  patchRecordPromotionBlocked,
  importPromotionIssues,
  insertSourceEvidenceForAppliedRecord,
  importedLibrarySection,
  sourceSystemFromExternalId,
  sourceSystemLabel,
  sourceSystemTag,
  findExistingMeetingImport,
  importedMeetingAgenda,
  setMeetingAgendaItems,
  meetingAgendaItemTitles,
  sessionRecords,
  recordsForSession,
  docsByCategory,
  upsertHistorySources,
  insertHistoryItem,
  patchRecordImportTarget,
  patchSessionUpdatedAt,
  recordsFromBundle,
  normalizeMotionPayload,
  normalizeMeetingMinutesPayload,
  structuredMinutesPatchFromPayload,
  summarizeRecords,
  summaryForSession,
  hydrateSession,
  hydrateRecord,
  parseJson,
  sourceCatalogForRecords,
  isImportSession,
  isImportRecord,
  riskFlagsFor,
  normalizeReviewStatus,
  sessionName,
  sourceSystem,
  inferMeetingType,
  toMeetingDateTime,
  recordSortKey,
  tagValue,
  cleanText,
  compactStrings,
  unique,
  numberOrUndefined,
  normalizePayload,
  titleForRecord,
  summarizeFromSessionMetadata,
} from "./importSessionHelpers";
import {
  findMeetingByIdentity,
  importedMeetingStatus,
  importedMeetingTime,
  importedMotionFromPayload,
  importedSectionsWithLinks,
  importedSourceVersionFor,
  linkActionItem,
  loadDirectoryIndex,
  prepareImportedMeeting,
  resolveImportCommittee,
  screenImportedAttendance,
  sourceVersionsCover,
} from "./importSessionHelpers/importMeetingApply";

// Import payloads and targetModule labels are untrusted. Destination authority
// comes from the accepted kind and the same domains used by normal mutations.
const SECTION_MUTATION_DOMAINS = {
  filing: "filings", deadline: "deadlines", bylawAmendment: "bylawAmendments",
  publication: "transparency", insurancePolicy: "insurance", financialStatement: "financials",
  financialStatementImport: "financialHub", grant: "grants", recordsLocation: "recordsLocation",
  archiveAccession: "library", boardRoleAssignment: "evidenceRegisters", boardRoleChange: "evidenceRegisters",
  signingAuthority: "evidenceRegisters", meetingAttendance: "evidenceRegisters", motionEvidence: "evidenceRegisters",
  budgetSnapshot: "financialHub", treasurerReport: "financialHub", transactionCandidate: "financialHub",
  organizationAddress: "organizationDetails", organizationRegistration: "organizationDetails", organizationIdentifier: "organizationDetails",
  policy: "policies", workflowPackage: "workflowPackages", minuteBookItem: "minuteBook",
  roleHolder: "legalOperations", rightsClass: "legalOperations", rightsholdingTransfer: "legalOperations",
  serviceProvider: "serviceProviders", dividend: "dividends", nameHistory: "nameHistory",
  constatingEvent: "constating", significantIndividualStep: "significantIndividualSteps", asset: "assets",
  shareCertificate: "shareCertificates", legalTemplateDataField: "legalOperations", legalTemplate: "legalOperations",
  legalPrecedent: "legalOperations", legalPrecedentRun: "legalOperations", generatedLegalDocument: "legalOperations",
  legalSigner: "legalOperations", formationRecord: "legalOperations", nameSearchItem: "legalOperations",
  entityAmendment: "legalOperations", annualMaintenanceRecord: "legalOperations", jurisdictionMetadata: "legalOperations",
  supportLog: "legalOperations", sourceEvidence: "evidenceRegisters", secretVaultItem: "secrets",
  pipaTraining: "pipaTraining", employee: "employees", volunteer: "volunteers",
  committee: "committees", committeeMember: "committees", member: "members", director: "directors",
  task: "tasks", goal: "goals", commitment: "commitments", fundingSource: "fundingSources",
  grantReport: "grants", meetingMaterial: "meetingMaterials", organizationSeat: "memberGovernance",
  conflict: "conflicts", proxy: "proxies", bylawRuleSet: "bylawRules", operatingBudget: "financialHub",
  representationGap: "representationGaps",
} satisfies Record<typeof SECTION_RECORD_KINDS[number], string>;

async function requireSectionPromotionPermissions(ctx: PortableMutationCtx, societyId: string, records: any[]) {
  // Source placeholders, evidence records and import-session updates also write
  // documents. Check the complete selection before even creating a placeholder.
  const permissions = new Set<Permission>(["documents:read", "documents:write"]);
  for (const record of records) {
    if (!Object.prototype.hasOwnProperty.call(SECTION_MUTATION_DOMAINS, record.recordKind)) {
      throw new Error(`Unsupported import section kind: ${record.recordKind}.`);
    }
    const domain = SECTION_MUTATION_DOMAINS[record.recordKind as keyof typeof SECTION_MUTATION_DOMAINS];
    const permission = actionPermission(`${domain}:importSection`, "mutation");
    if (!permission) throw new Error(`Unclassified import section kind: ${record.recordKind}.`);
    permissions.add(permission);
    if (record.recordKind === "roleHolder") {
      const roleType = cleanText(record.payload?.roleType) || cleanText(record.payload?.type) || cleanText(record.payload?.role);
      if (roleType === "controller") permissions.add("settings:write");
      if (roleType === "director" || roleType === "officer") permissions.add("directors:write");
    }
  }
  for (const permission of permissions) await requirePermissionPortable(ctx, societyId, permission);
}

async function selectedImportRecords(ctx: PortableMutationCtx, societyId: string, sessionId: string, records: any[], recordIds?: string[]) {
  await requirePermissionPortable(ctx, societyId, "settings:write");
  await requireDocumentAccess(ctx, sessionId, "manage");
  const selected = recordIds == null ? records : records.filter(row => recordIds.includes(String(row._id)));
  if (recordIds && new Set(recordIds).size !== selected.length) throw new Error("Selected records must belong to this import session.");
  for (const row of selected) await requireDocumentAccess(ctx, row._id, "manage");
  return new Set(selected.map(row => String(row._id)));
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const sessions = await docsByCategory(ctx, societyId, SESSION_CATEGORY);
  const rows: any[] = [];
  for (const doc of sessions.filter(isImportSession)) {
    const session = hydrateSession(doc);
    const summary = Number.isFinite(session.summary?.approvedUnapplied)
      ? summaryForSession(session)
      : summarizeRecords(await sessionRecords(ctx, societyId, doc._id));
    rows.push({
      ...session,
      summary,
    });
  }

  return rows
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
}

export async function getPortable(ctx: PortableQueryCtx, { sessionId }: { sessionId: string }) {
  const sessionDoc = await ctx.db.get(sessionId);
  if (!isImportSession(sessionDoc)) return null;

  const docs = await recordsForSession(ctx, sessionId);
  const records = docs
    .filter(isImportRecord)
    .map(hydrateRecord)
    .filter((record: any) => record.sessionId === sessionId)
    .sort((a: any, b: any) => recordSortKey(a).localeCompare(recordSortKey(b)));

  return {
    session: {
      ...hydrateSession(sessionDoc),
      summary: records.length ? summarizeRecords(records) : summarizeFromSessionMetadata(hydrateSession(sessionDoc)),
    },
    records,
  };
}

export async function createFromBundlePortable(
  ctx: PortableMutationCtx,
  { societyId, name, bundle }: { societyId: string; name?: string; bundle: any },
) {
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
    summary: summarizeRecords(records.map((record: any) => ({
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

  // Preflight losses become typed representation gaps (finding A14).
  await recordPreflightGapsForBundle(ctx, societyId, bundle, sessionId);
  return sessionId;
}

export async function updateRecordPortable(
  ctx: PortableMutationCtx,
  { recordId, status, reviewNotes, payload, sourceExternalIds }: {
    recordId: string;
    status?: string;
    reviewNotes?: string;
    payload?: any;
    sourceExternalIds?: string[];
  },
) {
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
}

export async function bulkSetStatusPortable(
  ctx: PortableMutationCtx,
  { sessionId, status, recordIds }: { sessionId: string; status: string; recordIds?: string[] },
) {
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
}

export async function bulkSetStatusByKindPortable(
  ctx: PortableMutationCtx,
  { sessionId, status, recordKinds, sourceExternalIds }: {
    sessionId: string;
    status: string;
    recordKinds: string[];
    sourceExternalIds?: string[];
  },
) {
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
        .map((source: any) => source.toLowerCase());
      if (!recordSources.some((source: any) => sources.has(source))) continue;
    }
    await ctx.db.patch(doc._id, {
      content: JSON.stringify({ ...record, status: wanted, updatedAtISO: new Date().toISOString() }),
    });
    updated += 1;
  }
  await patchSessionUpdatedAt(ctx, sessionId);
  return { updated };
}

export async function bulkSetStatusByFilterPortable(
  ctx: PortableMutationCtx,
  { sessionId, status, currentStatus, recordKinds, targetModules }: {
    sessionId: string;
    status: string;
    currentStatus?: string;
    recordKinds?: string[];
    targetModules?: string[];
  },
) {
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
}

export async function refreshSessionSummariesPortable(
  ctx: PortableMutationCtx,
  { societyId, sessionIds }: { societyId: string; sessionIds?: string[] },
) {
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
}

export async function removeSessionPortable(ctx: PortableMutationCtx, { sessionId }: { sessionId: string }) {
  const session = await ctx.db.get(sessionId);
  if (!isImportSession(session)) return;
  const docs = await recordsForSession(ctx, sessionId);
  await Promise.all(
    docs
      .filter(isImportRecord)
      .map(hydrateRecord)
      .filter((record: any) => record.sessionId === sessionId)
      .map((record: any) => ctx.db.delete(record._id)),
  );
  await ctx.db.delete(sessionId);
}

export async function applyApprovedToOrgHistoryPortable(ctx: PortableMutationCtx, { sessionId, recordIds }: { sessionId: string; recordIds?: string[] }) {
  const session = await ctx.db.get<any>(sessionId);
  if (!isImportSession(session)) return { sources: 0, items: 0 };
  await requirePermissionPortable(ctx, String(session.societyId), "society:write");
  await requirePermissionPortable(ctx, String(session.societyId), "documents:write");
  const records = await sessionRecords(ctx, session.societyId, sessionId);
  const selected = await selectedImportRecords(ctx, String(session.societyId), sessionId, records, recordIds);
  const approvedItems = records.filter(
    (record: any) =>
      selected.has(String(record._id)) && record.status === "Approved" &&
      HISTORY_KINDS.includes(record.recordKind) &&
      !record.importedTargets?.orgHistory,
  );
  const approvedSourceRecords = records.filter((record: any) => selected.has(String(record._id)) && record.status === "Approved" && record.recordKind === "source");
  const referencedExternalIds = new Set<string>();
  for (const record of approvedItems) {
    for (const externalId of record.sourceExternalIds ?? []) referencedExternalIds.add(externalId);
  }

  const sourceRecords = records.filter((record: any) => {
    if (record.recordKind !== "source") return false;
    const externalId = cleanText(record.payload?.externalId);
    return approvedSourceRecords.some((source: any) => source._id === record._id) || (externalId && referencedExternalIds.has(externalId));
  });

  const sourceIdByExternalId = await upsertHistorySources(ctx, session.societyId, sourceRecords, referencedExternalIds);
  let items = 0;
  for (const record of approvedItems) {
    const existingTarget = await existingImportTarget(ctx, String(session.societyId), record);
    if (existingTarget) { await patchRecordImportTarget(ctx, record, "orgHistory", existingTarget); continue; }
    const payload = {
      ...record.payload,
      sourceIds: (record.sourceExternalIds ?? [])
        .map((externalId: string) => sourceIdByExternalId.get(externalId))
        .filter(Boolean),
    };
    const itemId = await insertHistoryItem(ctx, session.societyId, record.recordKind, payload);
    await rememberImportTarget(ctx, String(session.societyId), record, String(itemId));
    await patchRecordImportTarget(ctx, record, "orgHistory", itemId);
    items += 1;
  }

  for (const record of sourceRecords.filter((source: any) => source.status === "Approved")) {
    const externalId = cleanText(record.payload?.externalId);
    const sourceId = externalId ? sourceIdByExternalId.get(externalId) : undefined;
    if (sourceId) await patchRecordImportTarget(ctx, record, "orgHistory", sourceId);
  }

  await patchSessionUpdatedAt(ctx, sessionId);
  return { sources: sourceRecords.length, items };
}

export async function applyApprovedMeetingsPortable(ctx: PortableMutationCtx, { sessionId, recordIds }: { sessionId: string; recordIds?: string[] }) {
  const session = await ctx.db.get<any>(sessionId);
  if (!isImportSession(session)) return { meetings: 0, minutes: 0, motions: 0 };
  for (const permission of ["meetings:write", "minutes:write", "motions:write", "documents:write"] as const) await requirePermissionPortable(ctx, String(session.societyId), permission);
  const societyId = String(session.societyId);
  const records = await sessionRecords(ctx, session.societyId, sessionId);
  const selected = await selectedImportRecords(ctx, societyId, sessionId, records, recordIds);
  const sourceCatalog = sourceCatalogForRecords(records);
  const motions = records.filter(
    (record: any) =>
      record.recordKind === "motion" &&
      selected.has(String(record._id)) && record.status === "Approved" &&
      !record.importedTargets?.meetings,
  );
  const minuteRecords = records.filter(
    (record: any) =>
      record.recordKind === "meetingMinutes" &&
      selected.has(String(record._id)) && record.status === "Approved" &&
      !record.importedTargets?.meetings,
  );
  // Validate the entire selection before creating source placeholders or any
  // meeting. Portable callers can catch failures without transaction rollback.
  for (const record of [...motions, ...minuteRecords]) toMeetingDateTime(record.payload?.meetingDate);
  const directory = await loadDirectoryIndex(ctx, societyId);
  // Meeting identity for import is calendar date + body (not title), so a
  // draft, its approved copy and a .doc/.pdf twin fold into one meeting while
  // an AGM and a Board meeting held the same evening stay separate.
  const groups = new Map<string, any[]>();
  for (const record of motions) {
    const payload = normalizeMotionPayload(record.payload);
    const prepared = prepareImportedMeeting(payload, toMeetingDateTime(payload.meetingDate));
    const key = `${prepared.dateKey}::${prepared.body.bodyKey}::${prepared.body.special ? "special" : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), { record, payload }]);
  }

  let meetings = 0;
  let minutes = 0;
  let motionCount = 0;
  let existing = 0;
  let committeesCreated = 0;
  let nonPersonAttendance = 0;
  for (const group of groups.values()) {
    const first = group[0].payload;
    const placeholder = toMeetingDateTime(first.meetingDate);
    const prepared = prepareImportedMeeting(first, placeholder);
    const sourceExternalIds = unique(group.flatMap(({ record }) => record.sourceExternalIds ?? []));
    const sourceDocumentIds = await ensureMeetingSourceDocuments(ctx, session.societyId, sourceExternalIds, sourceCatalog);
    const existingTarget = await findMeetingByIdentity(ctx, societyId, { dateKey: prepared.dateKey, bodyKey: prepared.body.bodyKey, special: prepared.body.special, sourceExternalIds, title: cleanText(first.meetingTitle), bodyBasis: prepared.body.basis });
    if (existingTarget) {
      await mergeExistingMeetingImport(ctx, session, existingTarget, { ...first, motions: group.map(({ payload }) => payload) }, sourceExternalIds, sourceDocumentIds, sessionId, { directory, bodyKey: prepared.body.bodyKey });
      for (const { record } of group) await patchRecordImportTarget(ctx, record, "meetings", existingTarget);
      existing += 1;
      continue;
    }
    const committee = await resolveImportCommittee(ctx, societyId, prepared.body, { create: true });
    if (committee.created) committeesCreated += 1;
    const time = importedMeetingTime(first, placeholder);
    const meetingId = await ctx.db.insert("meetings", {
      societyId: session.societyId,
      type: prepared.body.type,
      ...(committee.committeeId ? { committeeId: committee.committeeId } : {}),
      title: prepared.title,
      ...(prepared.sourceTitle ? { sourceTitle: prepared.sourceTitle } : {}),
      scheduledAt: time.scheduledAt,
      scheduledAtPrecision: time.scheduledAtPrecision,
      electronic: false,
      status: "Held",
      attendeeIds: [],
      sourceReviewStatus: "imported_needs_review",
      sourceReviewNotes: "Created from approved import-session motion records. Verify against source minutes before relying on it as an official meeting record.",
      packageReviewStatus: "needs_review",
      packageReviewNotes: "Imported meeting source review must be completed before the board package is ready.",
      notes: `Imported from ${hydrateSession(session).name} (${group.length} converted motion${group.length === 1 ? "" : "s"}). Review attendance, quorum, discussion, and source minutes before treating as official minutes.`,
    });
    await setMeetingAgendaItems(
      ctx,
      { _id: meetingId, societyId: session.societyId, title: prepared.title },
      importedMeetingAgenda(prepared.title, group.map(({ payload }) => payload), sourceExternalIds),
    );
    const importedMotions: any[] = [];
    for (const { payload } of group) {
      importedMotions.push(await importedMotionFromPayload(ctx, societyId, payload, { dateKey: prepared.dateKey, bodyKey: prepared.body.bodyKey, directory, sourceExternalIds }));
    }
    const version = importedSourceVersionFor(first, sourceExternalIds);
    const minutesId = await ctx.db.insert("minutes", {
      societyId: session.societyId,
      meetingId,
      heldAt: time.scheduledAt,
      attendees: [],
      absent: [],
      quorumMet: false,
      quorumStatus: "not_recorded",
      discussion: "Imported from converted Paperless meeting-minute motions. Review the source document before approving these minutes.",
      decisions: [],
      actionItems: [],
      ...(version ? { importedSourceVersions: [version] } : {}),
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
    // Materialize the imported motions into the table (Phase 4C — not stored on
    // the minutes row); reads resolve from motionIds.
    if (importedMotions.length) {
      await syncMotionsForMinutes(ctx, { societyId: session.societyId, minutesId, meetingId, motions: importedMotions });
    }
    await transposeFreshImportedSourcePortable(ctx,{id:minutesId});
    for (const { record } of group) {
      await patchRecordImportTarget(ctx, record, "meetings", { meetingId, minutesId });
    }
    meetings += 1;
    minutes += 1;
    motionCount += group.length;
  }

  for (const record of minuteRecords) {
    const payload = normalizeMeetingMinutesPayload(record.payload);
    const placeholder = toMeetingDateTime(payload.meetingDate);
    const prepared = prepareImportedMeeting(payload, placeholder);
    const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
    const sourceDocumentIds = await ensureMeetingSourceDocuments(ctx, session.societyId, sourceExternalIds, sourceCatalog);
    const sourceDocumentIdsByExternal = new Map(sourceExternalIds.map((externalId, index) => [externalId, String(sourceDocumentIds[index])]));
    const existingTarget = await findMeetingByIdentity(ctx, societyId, {
      dateKey: prepared.dateKey, bodyKey: prepared.body.bodyKey, special: prepared.body.special,
      identityKey: payload.meetingIdentityKey, sourceExternalIds, title: cleanText(payload.meetingTitle), bodyBasis: prepared.body.basis,
    });
    if (existingTarget) {
      await mergeExistingMeetingImport(ctx, session, existingTarget, payload, sourceExternalIds, sourceDocumentIds, sessionId, { directory, bodyKey: prepared.body.bodyKey, identityKey: payload.meetingIdentityKey });
      await patchRecordImportTarget(ctx, record, "meetings", existingTarget);
      existing += 1;
      continue;
    }
    await assertMeetingHistoryReferences(ctx, societyId, payload, undefined, payload.meetingDate);
    const committee = await resolveImportCommittee(ctx, societyId, prepared.body, { create: !prepared.body.external });
    if (committee.created) committeesCreated += 1;
    const time = importedMeetingTime(payload, placeholder);
    const screened = screenImportedAttendance(payload, directory);
    nonPersonAttendance += screened.rejected.length;
    const status = importedMeetingStatus(payload);

    const meetingId = await ctx.db.insert("meetings", {
      societyId: session.societyId,
      type: prepared.body.type,
      ...(committee.committeeId ? { committeeId: committee.committeeId } : {}),
      title: prepared.title,
      ...(prepared.sourceTitle ? { sourceTitle: prepared.sourceTitle } : {}),
      scheduledAt: time.scheduledAt,
      scheduledAtPrecision: time.scheduledAtPrecision,
      ...(time.localStartText ? { localStartText: time.localStartText } : {}),
      ...(time.localEndText ? { localEndText: time.localEndText } : {}),
      ...(time.timeZone ? { timeZone: time.timeZone } : {}),
      ...(prepared.body.external ? { hostBody: "external", externalOrganization: prepared.body.external } : {}),
      location: payload.location,
      electronic: payload.electronic ?? false,
      remoteUrl: payload.remoteParticipation?.url,
      remoteMeetingId: payload.remoteParticipation?.meetingId,
      remotePasscode: payload.remoteParticipation?.passcode,
      remoteInstructions: payload.remoteParticipation?.instructions,
      status,
      attendeeIds: screened.attendees,
      sourceReviewStatus: "imported_needs_review",
      sourceReviewNotes: "Created from approved import-session meeting minutes. Verify against source minutes before relying on it as an official meeting record.",
      packageReviewStatus: "needs_review",
      packageReviewNotes: "Imported meeting source review must be completed before the board package is ready.",
      notes: `Imported from ${hydrateSession(session).name}. Review source minutes before treating as official minutes.`,
    });
    await setMeetingAgendaItems(
      ctx,
      { _id: meetingId, societyId: session.societyId, title: prepared.title },
      payload.agendaItems.length
        ? payload.agendaItems
        : importedMeetingAgenda(prepared.title, payload.motions, sourceExternalIds),
    );
    const importedMotions: any[] = [];
    for (const motion of payload.motions) {
      importedMotions.push(await importedMotionFromPayload(ctx, societyId, motion, { dateKey: prepared.dateKey, bodyKey: prepared.body.bodyKey, directory, sourceExternalIds, sourceDocumentIdsByExternal }));
    }
    const structured: Record<string, any> = structuredMinutesPatchFromPayload(payload);
    const version = importedSourceVersionFor(payload, sourceExternalIds, payload.meetingIdentityKey);
    if (version && !sourceVersionsCover(structured.importedSourceVersions, version.sourceExternalIds)) {
      structured.importedSourceVersions = [...(structured.importedSourceVersions ?? []), version];
    }
    if (structured.sections) structured.sections = importedSectionsWithLinks(structured.sections, [], directory);
    if (screened.detailedAttendance) structured.detailedAttendance = screened.detailedAttendance;
    if (structured.nextMeetings?.length && !structured.nextMeetingAt) structured.nextMeetingAt = structured.nextMeetings.find((row: any) => row.at)?.at;
    const nonPersonNote = screened.rejected.length
      ? ` ${screened.rejected.length} attendance entr${screened.rejected.length === 1 ? "y was" : "ies were"} a role, organization or heading rather than a person and ${screened.rejected.length === 1 ? "is" : "are"} kept as source evidence only.`
      : "";
    const minutesId = await ctx.db.insert("minutes", {
      societyId: session.societyId,
      meetingId,
      heldAt: time.scheduledAt,
      attendees: screened.attendees,
      absent: screened.absent,
      quorumMet: payload.quorumMet,
      quorumStatus: payload.quorumStatus,
      discussion: payload.discussion || "Imported from Paperless meeting minutes. Review the source document before approving these minutes.",
      ...structured,
      decisions: payload.decisions,
      actionItems: payload.actionItems.map((item: any) => linkActionItem(item, directory)),
      sourceDocumentIds,
      sourceExternalIds,
      sourceReviewStatus: "imported_needs_review",
      sourceReviewNotes: `Created from approved import-session meeting minutes. Verify against source minutes before relying on it as official minutes.${nonPersonNote}`,
      draftTranscript: JSON.stringify({
        importSessionId: sessionId,
        sourceExternalIds,
        sourceDocumentIds,
        sourceDocumentTitle: payload.sourceDocumentTitle,
        sourceDocumentId: payload.sourceDocumentId,
        sectionIndex: payload.sectionIndex,
        nonPersonAttendance: screened.rejected.map((row) => ({ name: row.original, kind: row.kind, list: row.list })),
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
    // Materialize the imported motions into the table (Phase 4C — not stored on
    // the minutes row); reads resolve from motionIds.
    if (importedMotions.length) {
      await syncMotionsForMinutes(ctx, { societyId: session.societyId, minutesId, meetingId, motions: importedMotions });
      // C7: link sections that named a payload motion by index.
      if ((payload.sections ?? []).some((section: any) => typeof section.motionIndex === "number")) {
        const row: any = await ctx.db.get(minutesId);
        const linked = importedSectionsWithLinks((structuredMinutesPatchFromPayload(payload) as any).sections, row?.motionIds ?? [], directory);
        if (linked) await ctx.db.patch(minutesId, { sections: linked });
      }
    }
    await transposeFreshImportedSourcePortable(ctx,{id:minutesId});
    await patchRecordImportTarget(ctx, record, "meetings", { meetingId, minutesId });
    meetings += 1;
    minutes += 1;
    motionCount += payload.motions.length;
  }

  await patchSessionUpdatedAt(ctx, sessionId);
  return { meetings, minutes, motions: motionCount, existing, committeesCreated, nonPersonAttendance };
}

export async function backfillApprovedMeetingReferencesPortable(ctx: PortableMutationCtx, { sessionId }: { sessionId: string }) {
  const session = await ctx.db.get<any>(sessionId);
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
    if (!meeting || !minutesRow || minutesRow.approvedAt || minutesRow.adoptedSnapshot || Array.isArray(minutesRow.motionSnapshots)) continue;

    const payloads = recordsForMeeting.map((record: any) => normalizeMotionPayload(record.payload));
    const sourceExternalIds = unique(recordsForMeeting.flatMap((record: any) => record.sourceExternalIds ?? []));
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

    const existingAgendaTitles = await meetingAgendaItemTitles(ctx, meeting._id);
    if (existingAgendaTitles.length === 0) {
      await setMeetingAgendaItems(ctx, meeting, importedMeetingAgenda(meeting.title, payloads, sourceExternalIds));
    }
    meetings += 1;
  }

  await patchSessionUpdatedAt(ctx, sessionId);
  return { meetings, minutes, documents };
}

export async function applyApprovedDocumentsPortable(
  ctx: PortableMutationCtx,
  { sessionId, recordIds }: { sessionId: string; recordIds?: string[] },
) {
  const session = await ctx.db.get(sessionId);
  if (!isImportSession(session)) return { documents: 0 };
  const societyId = String(session.societyId);
  await requirePermissionPortable(ctx, societyId, "documents:write");
  const records = await sessionRecords(ctx, societyId, sessionId);
  const selected = await selectedImportRecords(ctx, String(session.societyId), sessionId, records, recordIds);
  const candidates = records.filter(
    (record: any) =>
      record.recordKind === "documentCandidate" &&
      selected.has(String(record._id)) && record.status === "Approved" &&
      !record.importedTargets?.documents,
  );

  let documents = 0;
  for (const record of candidates) {
    const existingTarget = await existingImportTarget(ctx, societyId, record);
    if (existingTarget) { await patchRecordImportTarget(ctx, record, "documents", existingTarget); continue; }
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
      societyId,
      title: cleanText(payload.title) || record.title || externalId || "Imported document candidate",
      category: cleanText(payload.category) || cleanText(record.targetModule) || cleanText(sections[0]) || "Imported Document",
      fileName: cleanText(payload.fileName),
      mimeType: cleanText(payload.mimeType),
      fileSizeBytes: numberOrUndefined(payload.fileSizeBytes),
      url: cleanText(payload.url),
      content: JSON.stringify({
        importedFrom: `${sourceSystemLabel(externalSystem)} import session`,
        importSessionId: sessionId,
        externalSystem,
        externalId,
        sourceExternalIds,
        paperlessId,
        localPath: cleanText(payload.localPath),
        sha256: cleanText(payload.sha256),
        extractedText: cleanText(payload.extractedText),
        extractionMethod: cleanText(payload.extractionMethod),
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
    await rememberImportTarget(ctx, societyId, record, String(docId));
    await patchRecordImportTarget(ctx, record, "documents", docId);
    documents += 1;
  }

  await patchSessionUpdatedAt(ctx, sessionId);
  return { documents };
}

export async function applyApprovedSectionRecordsPortable(
  ctx: PortableMutationCtx,
  { sessionId, recordIds }: { sessionId: string; recordIds?: string[] },
) {
  const session = await ctx.db.get(sessionId);
  if (!isImportSession(session)) return { total: 0, byKind: {} };
  const societyId = String(session.societyId);
  await requirePermissionPortable(ctx, societyId, "settings:write");
  await requirePermissionPortable(ctx, societyId, "documents:read");
  await requireDocumentAccess(ctx, sessionId, "manage");
  const records = await sessionRecords(ctx, societyId, sessionId);
  const selected = await selectedImportRecords(ctx, String(session.societyId), sessionId, records, recordIds);
  for (const record of records.filter(row => selected.has(String(row._id)))) {
    const candidate = await ctx.db.get(record._id, "documents");
    if (String(candidate?.societyId) !== societyId) throw new Error("documents not found.");
    const document = await requireDocumentAccess(ctx, record._id, "manage");
    if (String(document.societyId) !== societyId) throw new Error("documents not found.");
    if (selected.has(String(record._id)) && record.status === "Approved" && !SECTION_RECORD_KINDS.includes(record.recordKind) &&
        ![...HISTORY_KINDS, "source", "meetingMinutes", "documentCandidate"].includes(record.recordKind)) {
      throw new Error(`Unsupported import section kind: ${record.recordKind}.`);
    }
  }
  const sourceCatalog = sourceCatalogForRecords(records);
  // Registers other kinds refer to by name are created first (a committee
  // before its members and quorum rules, a grant before its reports, people
  // before the conflicts and proxies that name them).
  const KIND_PRIORITY: Record<string, number> = { committee: 0, member: 1, director: 1, grant: 1, committeeMember: 2, organizationSeat: 2 };
  const sectionRecords = records.filter(
    (record: any) =>
      SECTION_RECORD_KINDS.includes(record.recordKind) &&
      selected.has(String(record._id)) && record.status === "Approved" &&
      !record.importedTargets?.sections,
  ).sort((a: any, b: any) => (KIND_PRIORITY[a.recordKind] ?? 3) - (KIND_PRIORITY[b.recordKind] ?? 3));

  await requireSectionPromotionPermissions(ctx, societyId, sectionRecords);

  // Resolve existing source references for the whole selection before writes.
  // Otherwise a later revoked/foreign source could follow an earlier insertion
  // in portable runtimes that do not roll back caught errors automatically.
  const externalIds = unique(sectionRecords.flatMap(record => [
    ...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? []),
  ]));
  for (const externalId of externalIds) {
    let documentId = sourceCatalog.get(externalId)?.documentId;
    if (!documentId) {
      const evidence = await ctx.db.query("sourceEvidence")
        .withIndex("by_society_external", q => q.eq("societyId", societyId).eq("externalId", externalId)).first();
      documentId = evidence?.sourceDocumentId;
    }
    if (documentId) {
      const candidate = await ctx.db.get(documentId, "documents");
      if (String(candidate?.societyId) !== societyId) throw new Error("documents not found.");
      const document = await requireDocumentAccess(ctx, documentId);
      if (String(document.societyId) !== societyId) throw new Error("documents not found.");
    }
  }

  const blocked: { record: any; issues: string[] }[] = [];
  for (const record of sectionRecords) {
    if (await existingImportTarget(ctx, societyId, record)) continue;
    const issues = await importPromotionIssues(ctx, societyId, record);
    if (issues.length) blocked.push({ record, issues });
  }
  if (blocked.length) {
    for (const { record, issues } of blocked) await patchRecordPromotionBlocked(ctx, record, issues);
    return { total: 0, byKind: { blocked: blocked.length }, preflightBlocked: true, blockedRecordIds: blocked.map(item => item.record._id) };
  }

  const byKind: Record<string, number> = {};
  let total = 0;
  for (const record of sectionRecords) {
    const existingTarget = await existingImportTarget(ctx, societyId, record);
    if (existingTarget) { await patchRecordImportTarget(ctx, record, "sections", existingTarget); continue; }
    const sourceDocumentIds = await ensureImportSourceDocuments(
      ctx,
      societyId,
      unique([...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? [])]),
      "Imported Source",
      `Source placeholder created while applying ${record.recordKind} from ${hydrateSession(session).name}. Pull or review the original source document before publishing content.`,
      sourceCatalog,
    );
    const promotionIssues = await importPromotionIssues(ctx, societyId, record);
    if (promotionIssues.length > 0) {
      await patchRecordPromotionBlocked(ctx, record, promotionIssues);
      byKind[`${record.recordKind}:blocked`] = (byKind[`${record.recordKind}:blocked`] ?? 0) + 1;
      continue;
    }
    const target = await insertSectionRecord(ctx, societyId, record, sourceDocumentIds);
    if (record.recordKind !== "sourceEvidence" && record.recordKind !== "representationGap") {
      await insertSourceEvidenceForAppliedRecord(ctx, societyId, record, target, sourceDocumentIds);
    }
    await rememberImportTarget(ctx, societyId, record, String(target));
    await patchRecordImportTarget(ctx, record, "sections", target);
    byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
    total += 1;
  }

  await patchSessionUpdatedAt(ctx, sessionId);
  return { total, byKind };
}
