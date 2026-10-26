/** Meeting integrity checks over an immutable, offline export. Never repairs data. */
import { createHash } from "node:crypto";
import schema from "../../convex/schema";
import { meetingCalendarDate } from "../../shared/meetingDates";
import type { IntegrityInput, RecordRow } from "./meetingIntegrityInput";

export const MEETING_AUDIT_TABLES = [
  "meetings", "minutes", "agendas", "agendaItems", "motions", "motionEvidence",
  "meetingAttendanceRecords", "meetingMaterials", "meetingSources", "meetingSourceText",
  "transcripts", "transcriptionJobs", "meetingTranscriptionJobs", "meetingTranscriptPages", "minuteBookItems",
] as const;
const CORE = new Set<string>(MEETING_AUDIT_TABLES);
const FOLLOW = new Set(["documents", "documentVersions", "sourceEvidence", "tasks", "signatures"]);
const isObject = (value: unknown): value is RecordRow => !!value && typeof value === "object" && !Array.isArray(value);
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const idString = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;
const normalized = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-CA") : "";
// Convex's installed validators expose their JSON schema at runtime. Keep this
// offline introspection checked explicitly because the getter is not public in
// every SDK type declaration; synthetic tests detect incompatible SDK changes.
const schemas = new Map<string, Validator>(Object.entries(schema.tables).map(([name, table]) => {
  const validator = (table.validator as unknown as { json: Validator }).json;
  if (!validator || typeof validator.type !== "string") throw new Error("The installed Convex validator schema format is unsupported by this offline checker.");
  return [name, validator];
}));
const historicalPath = (field: string) => /^(?:history|motionSnapshots|adoptedSnapshot|adoptionHistory|importedSourceVersions|actionObservations)(?:\.|\[|$)/.test(field);
type Reference = { field: string; id: unknown; targets: string[]; historical: boolean };
type Validator = { type: string; value?: any; tableName?: string; keys?: any; values?: any };

function referenceTargets(validator: Validator): string[] {
  if (validator.type === "id") return [validator.tableName!];
  if (validator.type === "object") return Object.values(validator.value ?? {}).flatMap((field: any) => referenceTargets(field.fieldType));
  if (validator.type === "array") return referenceTargets(validator.value);
  if (validator.type === "union") return validator.value.flatMap(referenceTargets);
  if (validator.type === "record") return referenceTargets(validator.values?.fieldType ?? validator.values ?? { type: "any" });
  return [];
}

function typedReferences(validator: Validator, value: any, field = "", historical = false): Reference[] {
  if (value === undefined || value === null) return [];
  if (validator.type === "id") return [{ field, id: value, targets: [validator.tableName!], historical: historical || historicalPath(field) }];
  if (validator.type === "object" && isObject(value)) return Object.entries(validator.value ?? {}).flatMap(([key, definition]: [string, any]) => typedReferences(definition.fieldType, value[key], field ? `${field}.${key}` : key, historical));
  if (validator.type === "array" && Array.isArray(value)) return value.flatMap((entry, index) => typedReferences(validator.value, entry, `${field}[${index}]`, historical));
  if (validator.type === "union") {
    const ids = validator.value.filter((branch: Validator) => branch.type === "id");
    // A free string/any alternative is not a contractual database reference.
    if (ids.length && validator.value.some((branch: Validator) => branch.type === "string" || branch.type === "any")) return [];
    if (ids.length) return [{ field, id: value, targets: ids.map((branch: Validator) => branch.tableName!), historical: historical || historicalPath(field) }];
    return validator.value.flatMap((branch: Validator) => typedReferences(branch, value, field, historical));
  }
  if (validator.type === "record" && isObject(value)) return Object.values(value).flatMap((entry, index) => typedReferences(validator.values?.fieldType ?? validator.values ?? { type: "any" }, entry, `${field}[entry:${index}]`, historical));
  return [];
}

/** No guessed `*Id` matching: untyped links below are established application contracts. */
function references(table: string, row: RecordRow): Reference[] {
  const result = schemas.has(table) ? typedReferences(schemas.get(table)!, row) : [];
  const extra = (field: string, id: unknown, target: string, historical = false) => {
    if (id !== undefined && id !== null && id !== "") result.push({ field, id, targets: [target], historical });
  };
  if (table === "minutes") {
    if (isObject(row.adoptedSnapshot)) result.push(...typedReferences(schemas.get("minutes")!, row.adoptedSnapshot, "adoptedSnapshot", true));
    for (const [index, entry] of array(row.adoptionHistory).entries()) {
      if (!isObject(entry)) continue;
      extra(`adoptionHistory[${index}].amendedByUserId`, entry.amendedByUserId, "users", true);
      if (isObject(entry.snapshot)) result.push(...typedReferences(schemas.get("minutes")!, entry.snapshot, `adoptionHistory[${index}].snapshot`, true));
    }
    for (const [index, source] of array(row.sourceTransposition?.originalSources).entries()) extra(`sourceTransposition.originalSources[${index}].documentId`, source?.documentId, "documents");
    for (const [index, source] of array(row.sourceMeetingRecord?.documents).entries()) extra(`sourceMeetingRecord.documents[${index}].documentId`, source?.documentId, "documents");
  }
  if (table === "sourceEvidence" && typeof row.targetTable === "string" && schemas.has(row.targetTable)) extra("targetId", row.targetId, row.targetTable);
  if (table === "signatures") {
    const target = ({ minutes: "minutes", resolution: "writtenResolutions", filing: "filings" } as Record<string, string>)[row.entityType];
    if (target) {
      extra("subjectId", row.subjectId, target);
      extra("entityId", row.entityId, target);
    }
  }
  if (table === "meetingMaterials") for (const [index, grant] of array(row.accessGrants).entries()) {
    const target = ({ user: "users", member: "members", director: "directors", committee: "committees" } as Record<string, string>)[grant?.subjectType];
    if (target) extra(`accessGrants[${index}].subjectId`, grant.subjectId, target);
  }
  const deduped = new Map<string, Reference>();
  for (const ref of result) {
    const key = JSON.stringify([ref.field, ref.id]);
    const prev = deduped.get(key);
    if (prev) prev.targets = [...new Set([...prev.targets, ...ref.targets])];
    else deduped.set(key, ref);
  }
  return [...deduped.values()];
}

export type IntegrityFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  certainty: "confirmed" | "candidate" | "unresolved";
  table: string;
  rowIds: string[];
  societyId?: string;
  field?: string;
  targetTable?: string;
  targetId?: string;
  count?: number;
  approvedRecord?: boolean;
  explanation: string;
};

export function auditMeetingIntegrity(input: IntegrityInput, options: { societyId?: string; maxFindings?: number } = {}) {
  const indexes = new Map<string, Map<string, RecordRow>>();
  const locations = new Map<string, Set<string>>();
  const findings: IntegrityFinding[] = [];
  const findingCounts: Record<string, number> = {};
  const certaintyCounts = { confirmed: 0, candidate: 0, unresolved: 0 };
  const severityCounts = { error: 0, warning: 0, info: 0 };
  const maxFindings = options.maxFindings ?? 10_000;
  let totalFindings = 0;
  const add = (finding: IntegrityFinding) => {
    findingCounts[finding.code] = (findingCounts[finding.code] ?? 0) + 1;
    certaintyCounts[finding.certainty]++;
    severityCounts[finding.severity]++;
    totalFindings++;
    if (findings.length < maxFindings) findings.push(finding);
  };
  const issue = (code: string, table: string, row: RecordRow | undefined, explanation: string, extra: Partial<IntegrityFinding> = {}) => add({ code, severity: "warning", certainty: "candidate", table, rowIds: idString(row?._id) ? [row!._id] : [], ...(idString(row?.societyId) ? { societyId: row!.societyId } : {}), ...(table === "minutes" && (row?.approvedAt || row?.adoptedSnapshot) ? { approvedRecord: true } : {}), explanation, ...extra });
  const rowRefs = new Map<RecordRow, Reference[]>();
  const idProblems: { code: string; table: string; row: RecordRow }[] = [];
  for (const [table, rows] of input.tables) {
    const index = new Map<string, RecordRow>();
    for (const row of rows) {
      const id = idString(row._id);
      if (!id) {
        if (CORE.has(table)) idProblems.push({ code: "missing_record_id", table, row });
        continue;
      }
      if (index.has(id)) {
        if (CORE.has(table) || FOLLOW.has(table)) idProblems.push({ code: "duplicate_record_id", table, row });
      } else index.set(id, row);
      const existing = locations.get(id) ?? new Set<string>();
      existing.add(table); locations.set(id, existing);
    }
    indexes.set(table, index);
  }
  const get = (table: string, id: unknown) => typeof id === "string" ? indexes.get(table)?.get(id) : undefined;
  const refs = (table: string, row: RecordRow) => {
    let result = rowRefs.get(row);
    if (!result) { result = references(table, row); rowRefs.set(row, result); }
    return result;
  };
  const owner = (table: string, row: RecordRow | undefined, seen = new Set<RecordRow>()): string | undefined => {
    if (!row || seen.has(row)) return undefined;
    seen.add(row);
    if (table === "societies") return idString(row._id);
    if (idString(row.societyId)) return row.societyId;
    if (table === "meetingSourceText") return owner("meetingSources", get("meetingSources", row.sourceId), seen);
    return undefined;
  };
  const withinScope = (table: string, row: RecordRow) => !options.societyId || owner(table, row) === options.societyId;
  for (const problem of idProblems) if (withinScope(problem.table, problem.row)) issue(problem.code, problem.table, problem.row, problem.code === "duplicate_record_id" ? "The export contains the same table/ID more than once. This may be an export pagination overlap rather than duplicate database rows; only its first occurrence is reconciled." : "A supplied row has no usable ID; its references cannot be reliably reconciled.", { certainty: "confirmed", severity: "error" });
  let coreRowsWithUnknownWorkspace = 0;
  const selected = new Map<string, Set<RecordRow>>();
  const select = (table: string, row: RecordRow | undefined) => {
    if (!row || !withinScope(table, row) || (idString(row._id) && get(table, row._id) !== row)) return false;
    const rows = selected.get(table) ?? new Set<RecordRow>();
    if (rows.has(row)) return false;
    rows.add(row); selected.set(table, rows); return true;
  };
  // Include core records plus records with typed inbound links to the meeting graph.
  for (const [table, rows] of input.tables) for (const row of rows) {
    if (CORE.has(table) && !owner(table, row)) coreRowsWithUnknownWorkspace++;
    if (CORE.has(table) || refs(table, row).some(ref => ref.targets.some(target => CORE.has(target)))) select(table, row);
  }
  // Follow only business evidence and task/file links, never expand into every
  // user/financial record merely because a participant or workflow is linked.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [table, rows] of selected) for (const row of rows) for (const ref of refs(table, row)) {
      for (const target of ref.targets) if (FOLLOW.has(target) && select(target, get(target, ref.id))) changed = true;
    }
    for (const table of ["documentVersions", "sourceEvidence", "signatures"]) for (const row of input.tables.get(table) ?? []) {
      if (refs(table, row).some(ref => ref.targets.some(target => selected.get(target)?.has(get(target, ref.id)!))) && select(table, row)) changed = true;
    }
  }
  if (options.societyId && !get("societies", options.societyId) && ![...selected.values()].some(rows => rows.size)) issue("workspace_not_observed", "societies", undefined, "No records for the requested workspace were observed. This does not establish that the workspace is empty.", { certainty: "unresolved", severity: "info", targetId: options.societyId });
  if (options.societyId && coreRowsWithUnknownWorkspace) issue("rows_with_unknown_workspace_excluded", "export", undefined, "Some meeting-graph rows have no resolvable workspace owner and could not be assigned to the requested workspace. Audit without --society-id to inspect them.", { count: coreRowsWithUnknownWorkspace, certainty: "unresolved", severity: "info" });
  else if (coreRowsWithUnknownWorkspace) issue("rows_with_unknown_workspace", "export", undefined, "Some meeting-graph rows have no resolvable workspace owner. Their observed links are inspected, but tenant-ownership reconciliation remains incomplete.", { count: coreRowsWithUnknownWorkspace, certainty: "unresolved", severity: "info" });
  const requiredTables = new Set<string>(MEETING_AUDIT_TABLES);
  const referenceCounts = { checked: 0, resolved: 0, missingInCompleteSnapshot: 0, unresolved: 0, historicalMissing: 0, crossWorkspace: 0, wrongTable: 0 };
  const coverageCanProveAbsence = (table: string, societyId?: string) => {
    const coverage = input.coverage.get(table);
    if (input.consistency !== "point-in-time" || coverage?.state !== "complete" || coverage.fields !== "full") return false;
    if (input.scope.kind === "deployment") return true;
    return !!societyId && input.scope.kind === "workspaces" && input.scope.societyIds.includes(societyId);
  };
  for (const [table, rows] of selected) for (const row of rows) {
    const societyId = owner(table, row);
    if (input.scope.kind === "workspaces" && societyId && !input.scope.societyIds.includes(societyId)) issue("row_outside_declared_scope", table, row, "A supplied record belongs to a workspace outside the export's declared scope.", { certainty: "confirmed", severity: "error" });
    for (const ref of refs(table, row)) {
      referenceCounts.checked++;
      ref.targets.forEach(target => requiredTables.add(target));
      const id = idString(ref.id);
      if (!id) {
        issue("invalid_reference_value", table, row, "A present schema-defined reference is not a nonempty string.", { field: ref.field, targetTable: ref.targets.join("|"), certainty: "confirmed", severity: "error" });
        continue;
      }
      const targetTable = ref.targets.find(target => get(target, id));
      if (targetTable) {
        referenceCounts.resolved++;
        const targetOwner = owner(targetTable, get(targetTable, id));
        if (societyId && targetOwner && societyId !== targetOwner) {
          referenceCounts.crossWorkspace++;
          issue("cross_workspace_reference", table, row, "Both records are present, but the reference crosses their recorded workspace ownership. Review the linkage; this does not prove access was exposed.", { field: ref.field, targetTable, targetId: id, certainty: "confirmed", severity: "error" });
        }
      } else if (locations.has(id)) {
        referenceCounts.wrongTable++;
        issue("reference_wrong_table", table, row, "This ID occurs in a supplied table outside the reference's schema target tables.", { field: ref.field, targetTable: ref.targets.join("|"), targetId: id, certainty: "confirmed", severity: "error" });
      } else if (ref.historical) {
        referenceCounts.historicalMissing++;
        issue("historical_reference_not_resolved", table, row, "A retained history/snapshot reference has no supplied live target. Historical IDs can intentionally outlive records; review source history without changing adopted content.", { field: ref.field, targetTable: ref.targets.join("|"), targetId: id, certainty: "unresolved", severity: "info" });
      } else if (ref.targets.every(target => coverageCanProveAbsence(target, societyId))) {
        referenceCounts.missingInCompleteSnapshot++;
        issue("dangling_reference_in_snapshot", table, row, "The reference target is absent from the declared complete, unredacted, point-in-time table coverage. This establishes an absent target in this snapshot, not its current live state.", { field: ref.field, targetTable: ref.targets.join("|"), targetId: id, certainty: "confirmed", severity: "error" });
      } else {
        referenceCounts.unresolved++;
        issue("reference_not_resolved_in_export", table, row, "The target is not supplied, but missing/partial/redacted/non-atomic coverage prevents treating this as a broken live reference.", { field: ref.field, targetTable: ref.targets.join("|"), targetId: id, certainty: "unresolved", severity: "info" });
      }
    }
  }
  const rows = (table: string) => [...(selected.get(table) ?? [])];
  const groups = (records: RecordRow[], key: (row: RecordRow) => string | undefined) => {
    const result = new Map<string, RecordRow[]>();
    for (const row of records) { const value = key(row); if (value !== undefined) result.set(value, [...(result.get(value) ?? []), row]); }
    return result;
  };
  const minuteGroups = groups(rows("minutes"), row => idString(row.meetingId) ? JSON.stringify([row.societyId, row.meetingId]) : undefined);
  for (const group of minuteGroups.values()) if (group.length > 1) issue("multiple_minutes_for_meeting", "minutes", group[0], "Several distinct minutes records refer to the same meeting. Preserve every version and approved snapshot before deciding which record is canonical.", { rowIds: group.map(row => row._id).filter(idString), count: group.length, approvedRecord: group.some(row => row.approvedAt || row.adoptedSnapshot), certainty: "confirmed", severity: "error" });
  const meetingGroups = groups(rows("meetings"), row => {
    let date: string | undefined;
    try { date = meetingCalendarDate(row, "UTC"); } catch { return undefined; }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || !normalized(row.title)) return undefined;
    return JSON.stringify([row.societyId, row.committeeId ?? null, row.hostBody ?? "own", normalized(row.externalOrganization), normalized(row.type), normalized(row.title), date]);
  });
  for (const group of meetingGroups.values()) if (group.length > 1) issue("possible_duplicate_meetings", "meetings", group[0], "Records share workspace, body/committee, type, normalized title and calendar date. Separate sessions or retained versions may be legitimate; this is a review candidate, not a merge instruction.", { rowIds: group.map(row => row._id).filter(idString), count: group.length });
  for (const group of groups(rows("agendas"), row => idString(row.meetingId) ? JSON.stringify([row.societyId, row.meetingId]) : undefined).values()) if (group.length > 1) issue("multiple_agendas_for_meeting", "agendas", group[0], "Several agendas refer to one meeting; confirm whether these are intentional versions and which is canonical.", { rowIds: group.map(row => row._id).filter(idString), count: group.length });
  for (const meeting of rows("meetings")) {
    const minutes = get("minutes", meeting.minutesId);
    if (minutes && minutes.meetingId !== meeting._id) issue("meeting_minutes_backlink_mismatch", "meetings", meeting, "The meeting's canonical minutes points back to a different meeting.", { field: "minutesId", targetTable: "minutes", targetId: minutes._id, certainty: "confirmed", severity: "error" });
    if (!meeting.minutesId && minuteGroups.has(JSON.stringify([meeting.societyId, meeting._id]))) issue("missing_canonical_minutes_pointer", "meetings", meeting, "Minutes are present for this meeting, but its optional canonical minutes pointer is absent. Review before relinking.");
  }
  const approved = (row: RecordRow) => !!(row.approvedAt || row.adoptedSnapshot);
  for (const minutes of rows("minutes")) {
    const ids = array(minutes.motionIds);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length) issue("duplicate_motion_ids", "minutes", minutes, "The ordered motion ID list repeats an ID, which can display or reconcile one motion more than once.", { field: "motionIds", count: duplicates.length, certainty: "confirmed", severity: "error" });
    for (const id of [...new Set(ids)]) {
      const motion = get("motions", id);
      if (motion && motion.minutesId !== minutes._id) issue("motion_minutes_backlink_mismatch", "minutes", minutes, approved(minutes) ? "A frozen record's live motion reference has a different current minutes owner; examine the retained snapshot before deciding whether this is intentional history." : "A draft minutes lists a motion whose minutesId does not point back to it.", { field: "motionIds", targetTable: "motions", targetId: id, certainty: approved(minutes) ? "candidate" : "confirmed", severity: approved(minutes) ? "warning" : "error" });
    }
    if (array(minutes.motions).length) issue("legacy_embedded_motions_present", "minutes", minutes, "Legacy embedded motions remain even though current draft readers use motionIds and the motions table. Compare both versions; do not discard historical content.", { field: "motions", count: minutes.motions.length });
    if (approved(minutes) && (!isObject(minutes.adoptedSnapshot) || !Array.isArray(minutes.motionSnapshots))) issue("approved_record_missing_frozen_snapshot", "minutes", minutes, "An approved/adopted record lacks part of today's frozen snapshot format. Older records may predate it; confirm source evidence and migration history without re-approving automatically.");
    const meeting = get("meetings", minutes.meetingId);
    if (meeting && meeting.status !== "Held" && (array(minutes.attendees).length || minutes.quorumMet === true || minutes.quorumStatus === "confirmed")) issue("attendance_on_unheld_meeting_review", "minutes", minutes, "Attendance/quorum is recorded while the linked meeting is not Held. This can reflect legacy scaffolding or an outdated meeting status; inspect original evidence before changing either.");
    if ((minutes.quorumStatus === "confirmed" && minutes.quorumMet !== true) || (["not_met", "not_recorded"].includes(minutes.quorumStatus) && minutes.quorumMet === true)) issue("quorum_fields_disagree", "minutes", minutes, "Recorded quorumMet and quorumStatus disagree. This is a field inconsistency, not a determination that quorum legally existed.", { certainty: "confirmed" });
    if (minutes.quorumMet === true && !minutes.quorumStatus) issue("legacy_quorum_requires_evidence_review", "minutes", minutes, "Legacy quorumMet has no explicit quorumStatus. Older scaffolding could set it automatically; source evidence is needed to decide whether confirmation was justified.");
    const questionable = array(minutes.detailedAttendance).filter(entry => entry?.quorumCounted === true && ["absent", "regrets", "invited", "unknown"].includes(String(entry?.status).toLowerCase()));
    if (questionable.length) issue("attendance_quorum_count_review", "minutes", minutes, "Some detailed attendance entries count toward quorum while marked absent/regrets/invited/unknown. Proxy and historical rules require human review.", { count: questionable.length });
    const versions = array(minutes.importedSourceVersions).filter(isObject);
    const versionIds = new Set(versions.map(version => version.versionId));
    if (versionIds.size !== versions.length) issue("duplicate_source_version_ids", "minutes", minutes, "Imported source-version identifiers repeat within this minutes record.", { field: "importedSourceVersions", certainty: "confirmed" });
    for (const [index, version] of versions.entries()) {
      if (version.supersedesVersionId && !versionIds.has(version.supersedesVersionId)) issue("source_version_chain_not_resolved", "minutes", minutes, "A source version names a predecessor absent from this record's retained version list.", { field: `importedSourceVersions[${index}].supersedesVersionId` });
      if (version.supersedesVersionId && version.supersedesVersionId === version.versionId) issue("source_version_self_cycle", "minutes", minutes, "A source version declares itself as its predecessor.", { field: `importedSourceVersions[${index}]`, certainty: "confirmed" });
      if (typeof version.contentJson === "string") try { JSON.parse(version.contentJson); } catch { issue("source_snapshot_invalid_json", "minutes", minutes, "A retained source snapshot is not valid JSON; its text is omitted from this report and must be preserved for review.", { field: `importedSourceVersions[${index}].contentJson`, certainty: "confirmed" }); }
    }
  }
  for (const motion of rows("motions")) {
    const minutes = get("minutes", motion.minutesId);
    if (minutes && Array.isArray(minutes.motionIds) && !minutes.motionIds.includes(motion._id)) issue("motion_missing_from_minutes_order", "motions", motion, "The motion points to a minutes record whose ordered motionIds omit it. Review placement and migration history.", { targetTable: "minutes", targetId: minutes._id, approvedRecord: approved(minutes) });
    if (minutes && motion.primaryMeetingId && motion.primaryMeetingId !== minutes.meetingId) issue("motion_meeting_minutes_mismatch", "motions", motion, "The motion's current meeting differs from the meeting of its current minutes record.", { certainty: "confirmed", severity: "error" });
  }
  const parentMeeting = (agendaItemId: unknown) => {
    const item = get("agendaItems", agendaItemId);
    return item ? get("agendas", item.agendaId)?.meetingId : undefined;
  };
  for (const table of ["meetingMaterials", "documents", "tasks", "meetingAttendanceRecords", "motionEvidence", "minuteBookItems", "meetingTranscriptionJobs", "meetingTranscriptPages"]) for (const row of rows(table)) {
    const childMeeting = row.agendaItemId ? parentMeeting(row.agendaItemId) : row.minutesId ? get("minutes", row.minutesId)?.meetingId : row.sourceId ? get("meetingSources", row.sourceId)?.meetingId : row.jobId ? get("meetingTranscriptionJobs", row.jobId)?.meetingId : undefined;
    if (row.meetingId && childMeeting && row.meetingId !== childMeeting) issue("related_record_meeting_mismatch", table, row, "The record's meetingId disagrees with its linked agenda item/minutes/source/job parent.", { certainty: "confirmed", severity: "error" });
  }
  for (const item of rows("agendaItems")) {
    const motion = get("motions", item.motionId);
    if (motion?.agendaItemId && motion.agendaItemId !== item._id) issue("agenda_motion_link_review", "agendaItems", item, "The linked motion names another agenda item. Motion carry-forward can be intentional; review both placements.", { targetTable: "motions", targetId: motion._id });
  }
  for (const group of groups(rows("agendaItems"), row => idString(row.agendaId) && typeof row.order === "number" ? JSON.stringify([row.agendaId, row.order]) : undefined).values()) if (group.length > 1) issue("agenda_order_collision", "agendaItems", group[0], "Multiple agenda items have the same position within one agenda.", { rowIds: group.map(row => row._id).filter(idString), count: group.length });
  for (const transcript of rows("transcripts")) {
    const job = get("meetingTranscriptionJobs", transcript.pagedJobId);
    if (job && transcript.meetingId !== job.meetingId) issue("transcript_job_meeting_mismatch", "transcripts", transcript, "The transcript and its paged transcription job refer to different meetings.", { certainty: "confirmed", severity: "error" });
  }
  for (const item of input.issues) issue(item.code, item.table ?? "export", undefined, "The supplied export's manifest or attachment inventory is incomplete or inconsistent; no live data state was inferred.", { rowIds: idString(item.rowId) ? [item.rowId!] : [], certainty: item.code.includes("unverified") || item.code.includes("absent") ? "unresolved" : "confirmed", severity: item.code.includes("mismatch") || item.code === "archive_file_missing" ? "error" : "warning", ...(item.count !== undefined ? { count: item.count } : {}) });
  for (const attachment of input.attachments) {
    if (options.societyId && idString(attachment.societyId) && attachment.societyId !== options.societyId) continue;
    const version = get("documentVersions", attachment.versionId);
    if (version && attachment.documentId && version.documentId && attachment.documentId !== version.documentId && (!options.societyId || owner("documentVersions", version) === options.societyId)) issue("attachment_version_document_mismatch", "exportAttachments", undefined, "The attachment inventory and its document version name different document owners.", { rowIds: [version._id], targetTable: "documents", targetId: idString(attachment.documentId), certainty: "confirmed", severity: "error" });
    for (const [field, targetTable] of [["documentId", "documents"], ["versionId", "documentVersions"]] as const) {
      const id = idString(attachment[field]);
      if (!id) continue;
      const target = get(targetTable, id);
      if (target && options.societyId && owner(targetTable, target) !== options.societyId) continue;
      if (!target) issue("attachment_target_not_resolved", "exportAttachments", undefined, "An attachment inventory entry references a document/version absent from the supplied tables; it may be outside export coverage.", { field, targetTable, targetId: id, certainty: coverageCanProveAbsence(targetTable, idString(attachment.societyId)) ? "confirmed" : "unresolved", severity: "warning" });
    }
  }
  const tableCoverage = [...new Set([...requiredTables, ...selected.keys()])].sort().map(table => {
    const coverage = input.coverage.get(table) ?? { state: "missing", rows: 0, fields: "unknown", basis: "Table was not supplied; not assumed empty." };
    return { table, ...coverage, inspectedRows: selected.get(table)?.size ?? 0 };
  });
  const incomplete = tableCoverage.filter(entry => entry.state !== "complete" || entry.fields !== "full");
  const descriptorCatalog = Object.fromEntries([...schemas].map(([table, validator]) => [table, [...new Set(referenceTargets(validator))].sort()]));
  return {
    kind: "societyer.meetingIntegrityReport", version: 1,
    generatedAtISO: new Date().toISOString(),
    evidence: "Offline supplied records only. No live database was queried or modified. Confirmed findings describe the export, not the deployment's current state.",
    input: { sha256: input.sha256, format: input.format, component: input.component || "root", otherComponentsNotInspected: input.otherComponents, consistency: input.consistency, completenessDeclaration: input.declaration, scope: input.scope, requestedSocietyId: options.societyId ?? null, suppliedTables: input.tables.size, suppliedRows: [...input.tables.values()].reduce((sum, rows) => sum + rows.length, 0), binaryVerification: input.binaryVerification, binaryFiles: input.binaryFiles },
    scope: { coreTables: MEETING_AUDIT_TABLES, schemaReferenceCatalogSha256: createHash("sha256").update(JSON.stringify(descriptorCatalog)).digest("hex"), tableCoverage, coreRowsWithUnknownWorkspace, unsupportedSuppliedTables: [...input.tables.keys()].filter(table => !schemas.has(table) && table !== "_storage" && table !== "_tables").sort() },
    outcome: severityCounts.error ? "issues-found-in-export" : severityCounts.warning ? "review-required" : incomplete.length || input.consistency !== "point-in-time" || certaintyCounts.unresolved ? "inconclusive-coverage" : "no-issues-found-within-declared-scope",
    totals: { inspectedRows: [...selected.values()].reduce((sum, rows) => sum + rows.size, 0), findings: totalFindings, bySeverity: severityCounts, byCertainty: certaintyCounts, byCode: findingCounts, references: referenceCounts, incompleteTables: incomplete.length },
    findings, findingsTruncated: totalFindings > findings.length, findingsIncluded: findings.length,
    limitations: [
      "Missing or filtered tables are not empty tables. A completed workspace UI export can still omit ACL-protected records and combine several database versions.",
      "Scope declarations are operator assertions bound to the input hash, not independent proof of export provenance or live completeness.",
      "The schema's typed ID references and documented polymorphic links are checked. Arbitrary v.any content, JSON strings, free-text attendee names, external IDs and provider keys are not guessed as live database references.",
      "Historical snapshots and motion history can intentionally retain deleted IDs. Their missing targets require review, not automatic relinking or deletion.",
      "Matching titles/dates, legacy attendance or quorum flags do not prove duplicate legal records, actual attendance, legal quorum, or invalid adoption.",
      "Duplicate-meeting candidates use recorded meeting time zones, falling back to UTC when no time zone is recorded. The checker validates relationships, not every field against the current schema.",
      "External SharePoint/RustFS links and unbundled file bytes are not fetched. --verify-files checks bundled Societyer archive/attachment-manifest bytes only; native Convex storage bytes are not verified. Check the checksummedEntries count.",
      "No repair plan is executed. Preserve every source version and adopted record before a separately authorized cleanup.",
    ],
  };
}
