/** Record-level evidence rule for class records staged through import sessions
 * (policies, rule sets, insurance, filings, statements, budgets, grants, directors, and
 * meetings staged from agendas or packages …) and for their source documents.
 *
 * It applies the review screen's bulk-accept rule (stated, span-verified, at or above the
 * class threshold) to each record's key facts — its identity and its dates — and requires
 * that nothing in the source extraction failed re-verification or conflicts. Such records
 * are staged with `confidence: "High"` and an evidence marker (`evidenceVerified: true`, or
 * an "Evidence-verified" note for meeting payloads, whose normalization keeps only known
 * fields); everything else stays `Review`. Import sessions offer "Approve evidence-verified"
 * for the former. */
import { isBulkEligible, reviewFieldsForRecord } from "./review";
import { isFieldValue } from "./verify";

export type EvidenceExtraction = { docClass: string; record: unknown; verification?: { mismatched?: number; quoted?: number } };

function hasConflict(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasConflict);
  if (!node || typeof node !== "object") return false;
  if (isFieldValue(node)) return (node as { status?: string }).status === "conflicting";
  return Object.values(node).some(hasConflict);
}

const IDENTITY_FACTS = /^(?:title|policyName|name|subject|insurer|funder|vendor|filingType|kind)$/;
const DATE_FACTS = /^(?:date|meetingDate|periodEnd|periodStart|effective|expiry|effectiveDate|adoptedDate|filedDate|termStart|signedDate|startDate|endDate)$/;

/** The record's key facts are its identity (title, insurer, funder …) and its dates. A record is
 * evidence-verified when nothing in it failed re-verification or conflicts, at least one identity
 * fact and every stated date fact pass the bulk-accept rule. Other header values (heuristic
 * guesses such as an organization name read from a letterhead) do not block it; they stay
 * visible on the record for review. */
export function extractionEvidenceVerified(extraction: EvidenceExtraction): boolean {
  if (!extraction.verification || (extraction.verification.mismatched ?? 0) > 0) return false;
  if (hasConflict(extraction.record)) return false;
  const header = reviewFieldsForRecord(extraction.record).filter((field) => field.itemIndex === undefined && !field.path.includes("[") && field.field.status === "stated");
  if (!header.length) return false;
  const identity = header.filter((field) => IDENTITY_FACTS.test(field.pattern));
  const dates = header.filter((field) => DATE_FACTS.test(field.pattern));
  if (!identity.some((field) => isBulkEligible(field, extraction.docClass))) return false;
  return dates.every((field) => isBulkEligible(field, extraction.docClass));
}

export const EVIDENCE_NOTE = "Evidence-verified: key facts stated, re-found in the source and not in conflict.";
const NON_CLASS_KEYS = new Set(["metadata", "sources", "documentMap", "representationGaps"]);

/** Marks bundle class records whose every source extraction is evidence-verified. Returns how many were marked. */
export function markEvidenceVerified(bundle: Record<string, unknown>, extractions: Array<EvidenceExtraction & { fileKey: string; parentFileKey?: string }>): number {
  const verdict = new Map<string, boolean>();
  for (const extraction of extractions) {
    const key = extraction.parentFileKey ?? extraction.fileKey;
    const ok = extractionEvidenceVerified(extraction);
    verdict.set(key, (verdict.get(key) ?? true) && ok);
  }
  let marked = 0;
  const verifiedSources = new Set<string>();
  for (const [key, rows] of Object.entries(bundle)) {
    if (NON_CLASS_KEYS.has(key) || !Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, unknown>>) {
      const sources = (Array.isArray(row.sourceExternalIds) ? row.sourceExternalIds : []).map(String);
      if (!sources.length || !sources.every((source) => verdict.get(source) === true)) continue;
      row.confidence = "High";
      if (key === "meetingMinutes") row.notes = [row.notes, EVIDENCE_NOTE].filter(Boolean).join("\n");
      else row.evidenceVerified = true;
      for (const source of sources) verifiedSources.add(source);
      marked++;
    }
  }
  // The source documents of evidence-verified records are verified with them (they become
  // the records' linked documents when the session is applied).
  for (const row of (Array.isArray(bundle.documentMap) ? bundle.documentMap : []) as Array<Record<string, unknown>>) {
    if (!verifiedSources.has(String(row.externalId))) continue;
    row.confidence = "High";
    row.evidenceVerified = true;
  }
  return marked;
}
