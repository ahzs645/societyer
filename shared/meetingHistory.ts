/** Historical observations; never infer current status or identity by text similarity. */
export type ActionObservationStatus = "unknown" | "open" | "in_progress" | "ongoing" | "on_hold" | "completed" | "cancelled";
export type ActionObservation = {
  entryId: string; actionKey: string; sourceActionId?: string; text: string; assignee?: string;
  dateAssigned?: string; dueDate?: string; status: ActionObservationStatus; statusAsOf?: string; sourceStatus?: string;
  carriedFromMinutesId?: string; carriedFromEntryId?: string; sourceExternalIds?: string[];
  sourceLocator?: string; evidence?: string; notes?: string;
};
export type ImportedSourceVersion = {
  versionId: string; label: string; status: "unknown" | "draft" | "revised" | "adopted";
  sourceExternalIds: string[]; sourceDate?: string; supersedesVersionId?: string; adoptedAt?: string;
  adoptedInMeetingId?: string; adoptionMotionId?: string; adoptionEvidence?: string; notes?: string; contentJson?: string;
};
export type MeetingHistory = { actionObservations?: ActionObservation[]; importedSourceVersions?: ImportedSourceVersion[] };
export const MEETING_HISTORY_FIELDS = ["actionObservations", "importedSourceVersions"] as const;
const actionKeys = ["entryId", "actionKey", "sourceActionId", "text", "assignee", "dateAssigned", "dueDate", "status", "statusAsOf", "sourceStatus", "carriedFromMinutesId", "carriedFromEntryId", "sourceExternalIds", "sourceLocator", "evidence", "notes"];
const versionKeys = ["versionId", "label", "status", "sourceExternalIds", "sourceDate", "supersedesVersionId", "adoptedAt", "adoptedInMeetingId", "adoptionMotionId", "adoptionEvidence", "notes", "contentJson"];
function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected an object`);
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) if (!keys.includes(key)) throw new Error(`${path}.${key}: unsupported history field`);
  return row;
}
function text(value: unknown, path: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path}: expected a nonempty string`);
  return value;
}
function date(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`${path}: expected a valid YYYY-MM-DD date`);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${path}: expected ${choices.join(" | ")}`);
  return value as T;
}
function ids(value: unknown, path: string, required = false): string[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || (required && value.length === 0)) throw new Error(`${path}: expected ${required ? "a nonempty" : "an"} array`);
  const result = value.map((v, i) => text(v, `${path}[${i}]`, true)!);
  if (new Set(result).size !== result.length) throw new Error(`${path}: duplicate source IDs`);
  return result;
}
function compact<T>(row: Record<string, unknown>): T { return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T; }
function optionalStrings(row: Record<string, unknown>, keys: string[], path: string) { return Object.fromEntries(keys.map((key) => [key, text(row[key], `${path}.${key}`)])); }
function uniqueRows<T extends object>(value: unknown, field: string, idKey: string, normalize: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${field}: expected an array`);
  const seen = new Set();
  return value.map((raw, i) => {
    const row = normalize(raw, `${field}[${i}]`); const id = (row as Record<string, unknown>)[idKey];
    if (seen.has(id)) throw new Error(`${field}: duplicate ${idKey} ${id}`);
    seen.add(id); return row;
  });
}
export function normalizeActionObservations(value: unknown): ActionObservation[] {
  return uniqueRows(value, "actionObservations", "entryId", (value, p) => {
    const row = object(value, actionKeys, p);
    const result = compact<ActionObservation>({
      ...optionalStrings(row, ["sourceActionId", "assignee", "sourceStatus", "carriedFromMinutesId", "carriedFromEntryId", "sourceLocator", "evidence", "notes"], p),
      entryId: text(row.entryId, `${p}.entryId`, true), actionKey: text(row.actionKey, `${p}.actionKey`, true), text: text(row.text, `${p}.text`, true),
      status: choice(row.status, ["unknown", "open", "in_progress", "ongoing", "on_hold", "completed", "cancelled"], `${p}.status`),
      dateAssigned: date(row.dateAssigned, `${p}.dateAssigned`), dueDate: date(row.dueDate, `${p}.dueDate`), statusAsOf: date(row.statusAsOf, `${p}.statusAsOf`),
      sourceExternalIds: ids(row.sourceExternalIds, `${p}.sourceExternalIds`),
    });
    if (!!result.carriedFromMinutesId !== !!result.carriedFromEntryId) throw new Error(`${p}: carry provenance requires both minutes ID and entry ID`);
    return result;
  });
}
export function normalizeImportedSourceVersions(value: unknown): ImportedSourceVersion[] {
  const result = uniqueRows(value, "importedSourceVersions", "versionId", (value, p) => {
    const row = object(value, versionKeys, p);
    const out = compact<ImportedSourceVersion>({
      ...optionalStrings(row, ["supersedesVersionId", "adoptedInMeetingId", "adoptionMotionId", "adoptionEvidence", "notes", "contentJson"], p),
      versionId: text(row.versionId, `${p}.versionId`, true), label: text(row.label, `${p}.label`, true),
      status: choice(row.status, ["unknown", "draft", "revised", "adopted"], `${p}.status`), sourceExternalIds: ids(row.sourceExternalIds, `${p}.sourceExternalIds`, true),
      sourceDate: date(row.sourceDate, `${p}.sourceDate`), adoptedAt: date(row.adoptedAt, `${p}.adoptedAt`),
    });
    if (out.contentJson !== undefined) { try { JSON.parse(out.contentJson); } catch { throw new Error(`${p}.contentJson: invalid JSON source content`); } }
    if (out.status === "adopted" && (!out.adoptedAt || !(out.adoptionEvidence || out.adoptedInMeetingId || out.adoptionMotionId))) throw new Error(`${p}: adopted versions require adoptedAt and adoption evidence or a validated adoption link`);
    if (out.status !== "adopted" && (out.adoptedAt || out.adoptedInMeetingId || out.adoptionMotionId)) throw new Error(`${p}: adoption fields require adopted status`);
    return out;
  });
  const byId = new Map(result.map((row) => [row.versionId, row]));
  for (const row of result) {
    const seen = new Set([row.versionId]); let parent = row.supersedesVersionId;
    while (parent) {
      if (seen.has(parent)) throw new Error(`importedSourceVersions: supersedes cycle at ${parent}`);
      seen.add(parent); const prior = byId.get(parent);
      if (!prior) throw new Error(`importedSourceVersions: missing supersedes version ${parent}`);
      parent = prior.supersedesVersionId;
    }
  }
  return result;
}
export function normalizeMeetingHistory(fields: Record<string, unknown>): MeetingHistory {
  const out: MeetingHistory = {};
  if (fields.actionObservations !== undefined) out.actionObservations = normalizeActionObservations(fields.actionObservations);
  if (fields.importedSourceVersions !== undefined) out.importedSourceVersions = normalizeImportedSourceVersions(fields.importedSourceVersions);
  return out;
}
const stable = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
export function assertMeetingHistoryMutable(existing: Record<string, unknown>, patch: MeetingHistory, clearApproval = false): void {
  for (const field of MEETING_HISTORY_FIELDS) {
    if (patch[field] !== undefined && existing.approvedAt && !clearApproval && stable(existing[field] ?? []) !== stable(patch[field])) throw new Error("Approved minutes history is frozen; clear approval explicitly before revising it");
  }
  if (patch.importedSourceVersions !== undefined) for (const prior of normalizeMeetingHistory(existing).importedSourceVersions ?? []) {
    if (prior.status !== "adopted") continue;
    const next = patch.importedSourceVersions.find((row) => row.versionId === prior.versionId);
    if (!next || stable(prior) !== stable(next)) throw new Error(`Adopted source version ${prior.versionId} is immutable; append a revised version instead`);
  }
}
/** Merge explicit observation identities only; contradictions stop promotion. */
export function mergeMeetingHistory(existing: Record<string, unknown>, incoming: MeetingHistory): MeetingHistory {
  const out: Record<string, unknown> = {};
  for (const field of MEETING_HISTORY_FIELDS) {
    if (incoming[field] === undefined) continue;
    const rows = [...(normalizeMeetingHistory(existing)[field] ?? [])];
    for (const row of incoming[field]!) {
      const prior = rows.find((item) => historyIdentity(item) === historyIdentity(row));
      if (prior && stable(prior) !== stable(row)) throw new Error(`${field}: conflicting historical identity ${historyIdentity(row)}`);
      if (!prior) rows.push(row);
    }
    out[field] = rows;
  }
  const normalized = normalizeMeetingHistory(out); assertMeetingHistoryMutable(existing, normalized); return normalized;
}

function historyIdentity(row: ActionObservation | ImportedSourceVersion): string {
  return "entryId" in row ? row.entryId : row.versionId;
}
