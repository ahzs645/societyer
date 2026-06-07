// Import-session helpers extracted from importSessions.ts: shared constants plus
// the pure + ctx-taking helper functions (normalization, hydration, evidence,
// summaries, payload parsing). The Convex query/mutation registrations that use
// them stay in importSessions.ts so all api.importSessions.* paths are unchanged.

import { invalidOptionIssue, invalidOptionListIssues } from "./lib/orgHubOptions";
import { transactionImportMappingCandidates } from "./providers/accounting";

import {
  HISTORY_TAG,
  HISTORY_SOURCE_TAG,
  REVIEW_STATUSES,
} from "./importSessionHelpers.part1";

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



export {
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
};
