/** Stage 11 (promotion) bundle builder: a reviewed minutes extraction becomes a
 * one-meeting import bundle (documentMap for the source files + one
 * meetingMinutes payload) that the existing import-session apply path writes
 * natively. Only accepted or edited fields carry values (see review.ts). Pure:
 * used by the portable `intake:promoteExtraction` mutation and the gates. */
import { minutesPayloadFromExtraction, type IntakeExtractionResult } from "./bundle";
import { applyReviews, isPromotedDecision, latestDecisions, patternOf, reviewFieldsForRecord, type AppliedReviews, type ReviewRow } from "./review";

export type PromotionFile = {
  fileKey: string;
  name: string;
  path?: string;
  sha256?: string;
  mimeType?: string;
  sizeBytes?: number;
  sensitivity?: string;
  docClass?: string;
  driveId?: string;
  url?: string;
  recordStatus?: string;
  /** Extracted text (omitted for restricted files). */
  text?: string;
  extractionMethod?: string;
};

export type PromotionMode = "auto" | "new" | "merge";
export type MergeTarget = { dateKey: string; meetingType: string; committeeName?: string };

export type PromotionInput = {
  extraction: { _id: string; fileKey: string; docClass: string; engine: string; model?: string; record: Record<string, any>; unsupported: any[]; references: any[]; warnings?: string[]; verification?: any; schemaVersion?: string };
  reviews: ReviewRow[];
  /** The extraction's own file first, then the other members of its version cluster. */
  files: PromotionFile[];
  runName: string;
  mode?: PromotionMode;
  mergeTarget?: MergeTarget;
};

export type PromotionBuild = {
  bundle: Record<string, unknown>;
  payload: Record<string, any>;
  applied: AppliedReviews;
  sourceExternalIds: string[];
  warnings: string[];
};

const COMMITTEE_DEFAULT: Record<string, string> = { executive: "Executive Committee", operations: "Operations Committee" };
const TYPE_FOR_BODY: Record<string, string> = { board: "Board", agm: "AGM", members: "AGM", sgm: "SGM", executive: "Committee", operations: "Committee", committee: "Committee", joint: "AGM" };

/** Mime type from a file name when the browser gave none. */
export function mimeTypeForName(name: string): string | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", msg: "application/vnd.ms-outlook", txt: "text/plain", md: "text/markdown", csv: "text/csv", rtf: "application/rtf", html: "text/html", htm: "text/html" } as Record<string, string>)[ext] : undefined;
}

/** The document-candidate payload for one source file. Deterministic per file so a
 * second promotion citing the same file reuses the document (import target identity). */
export function sourceDocumentPayload(file: PromotionFile): Record<string, unknown> {
  const restricted = file.sensitivity === "restricted";
  return {
    externalId: file.fileKey,
    externalSystem: file.driveId ? "google-drive" : "local-folder",
    sourceExternalIds: [file.fileKey],
    title: file.name,
    fileName: file.name,
    category: "Meeting Source",
    sections: ["meetings"],
    ...(file.mimeType ?? mimeTypeForName(file.name) ? { mimeType: file.mimeType ?? mimeTypeForName(file.name) } : {}),
    ...(file.sizeBytes !== undefined ? { fileSizeBytes: file.sizeBytes } : {}),
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
    ...(file.url ? { url: file.url } : {}),
    ...(file.path ? { localPath: file.path } : {}),
    ...(file.text && !restricted ? { extractedText: file.text.slice(0, 180000), extractionMethod: file.extractionMethod ?? "intake-extract" } : {}),
    confidence: "Review",
    sensitivity: restricted || file.sensitivity === "personal" ? "restricted" : "standard",
    tags: ["intake", "meeting-source"],
    why: "Source file of a reviewed intake extraction",
  };
}

export function buildPromotionBundle(input: PromotionInput): PromotionBuild {
  const { extraction } = input;
  if (extraction.docClass !== "meetingMinutes") throw new Error(`Promotion of ${extraction.docClass} extractions is not supported yet; mark the facts as gaps instead.`);
  const decisions = latestDecisions(input.reviews);
  const applied = applyReviews(extraction.record, decisions);
  const warnings: string[] = [];
  const fields = reviewFieldsForRecord(extraction.record);
  const unreviewed = fields.filter((field) => !decisions.has(field.path)).length;
  if (unreviewed) warnings.push(`${unreviewed} unreviewed field${unreviewed === 1 ? " is" : "s are"} not promoted.`);
  const ownFile = input.files.find((file) => file.fileKey === extraction.fileKey);
  const sourceExternalIds = [...new Set([extraction.fileKey, ...input.files.map((file) => file.fileKey)])];
  const versions = input.files.length > 1 ? input.files.map((file) => ({ fileKey: file.fileKey, name: file.name, recordStatus: file.recordStatus ?? "unknown" })) : undefined;
  const reviewed: IntakeExtractionResult = {
    fileId: extraction.fileKey,
    fileKey: extraction.fileKey,
    docClass: "meetingMinutes",
    schemaVersion: extraction.schemaVersion ?? "meetingMinutes/1",
    engine: (["deterministic", "llm", "human"].includes(extraction.engine) ? extraction.engine : "human") as IntakeExtractionResult["engine"],
    ...(extraction.model ? { model: extraction.model } : {}),
    record: applied.record,
    unsupported: [],
    references: [],
    ...(extraction.warnings ? { warnings: extraction.warnings } : {}),
    ...(extraction.verification ? { verification: extraction.verification } : {}),
  };
  const payload = minutesPayloadFromExtraction(reviewed, sourceExternalIds, { versions });
  if (!payload) throw new Error("Accept an exact meeting date (YYYY-MM-DD) before promoting.");

  // Attendance whose category was not accepted is "unknown", never assumed present (C8).
  const attendance = payload.detailedAttendance as Array<Record<string, any>> | undefined;
  if (attendance) {
    for (const [original, index] of Object.entries(applied.indexMap.attendance ?? {})) {
      if (!isPromotedDecision(decisions.get(`attendance[${original}].category`)?.decision) && attendance[index]) attendance[index].status = "unknown";
    }
    payload.attendees = attendance.filter((entry) => !["regrets", "absent", "unknown"].includes(entry.status)).map((entry) => entry.name);
    payload.absent = attendance.filter((entry) => ["regrets", "absent"].includes(entry.status)).map((entry) => entry.name);
  }
  // Body → committee / meeting type in the import contract's terms.
  const body = String(applied.record.body?.value ?? "");
  const bodyLabel = typeof applied.record.bodyLabel?.value === "string" ? applied.record.bodyLabel.value.trim() : "";
  if (body === "board") payload.body = "board";
  else if (["executive", "operations", "committee"].includes(body)) {
    const committeeName = bodyLabel && !/^(?:board|directors?|board of directors)$/i.test(bodyLabel) ? bodyLabel : COMMITTEE_DEFAULT[body];
    if (committeeName) payload.committeeName = committeeName;
  }
  if (TYPE_FOR_BODY[body]) payload.meetingType = TYPE_FOR_BODY[body];
  const start = applied.record.startTime?.value;
  const end = applied.record.endTime?.value;
  if (typeof start === "string") payload.localStartText = start;
  if (typeof end === "string") payload.localEndText = end;
  if (input.mode === "new") payload.meetingIdentityKey = `intake:${extraction._id}`;
  if (input.mode === "merge" && input.mergeTarget) {
    payload.meetingDate = input.mergeTarget.dateKey;
    payload.meetingType = input.mergeTarget.meetingType;
    delete payload.body;
    delete payload.committeeName;
    if (input.mergeTarget.committeeName) payload.committeeName = input.mergeTarget.committeeName;
    else if (/^board$/i.test(input.mergeTarget.meetingType)) payload.body = "board";
  }
  payload.sourceDocumentTitle = ownFile?.name ?? extraction.fileKey;
  const promoted = applied.promotedPaths.length;
  const edited = [...decisions.values()].filter((review) => review.decision === "edit" && applied.promotedPaths.includes(review.fieldPath)).length;
  payload.notes = [
    `Promoted from the intake run "${input.runName}" after field-level review: ${promoted} field${promoted === 1 ? "" : "s"} accepted${edited ? ` (${edited} edited)` : ""}. Each promoted field has a source locator (View source).`,
    ...warnings,
    String(payload.notes ?? ""),
  ].filter(Boolean).join("\n");

  const bundle: Record<string, unknown> = {
    metadata: {
      name: `Intake review: ${ownFile?.name ?? extraction.fileKey}`,
      createdFrom: "intake-review",
      intakeExtractionId: extraction._id,
      sourceSystem: "local-folder",
      reviewOnly: false,
      note: "Created by promoting a reviewed intake extraction. Only reviewer-accepted fields are included.",
    },
    documentMap: input.files.map(sourceDocumentPayload),
    meetingMinutes: [payload],
  };
  return { bundle, payload, applied, sourceExternalIds, warnings };
}

/** Default representation-gap info type for a field the reviewer says the app cannot hold. */
export function defaultInfoTypeForPath(path: string): string {
  const pattern = patternOf(path);
  if (pattern === "motions.movedBy" || pattern === "motions.secondedBy") return "motion.person_link";
  if (pattern === "motions.votes" || pattern === "motions.resolutionType" || pattern === "motions.byConsensus") return "motion.vote_detail";
  if (pattern === "motions.conditional") return "motion.conditional";
  if (pattern === "motions.adoptsMinutesOf") return "motion.adopts_minutes";
  if (pattern.startsWith("motions.")) return "decision.non_motion";
  if (pattern === "attendance.affiliation") return "attendance.affiliation";
  if (pattern === "attendance.role") return "person.role";
  if (pattern.startsWith("attendance.")) return "attendance.person_link";
  if (pattern.startsWith("quorum.")) return "quorum.mid_meeting";
  if (pattern.startsWith("actionItems.")) return "action.status";
  if (pattern.startsWith("sections.")) return "agenda.item_detail";
  if (pattern === "decisions") return "decision.non_motion";
  if (pattern === "body" || pattern === "bodyLabel") return "meeting.body";
  if (pattern === "sessionSegments" || pattern === "attachmentsReferenced") return "meeting.package";
  return "meeting.header";
}

/** Gap locator (representationGaps shape) from an intake locator. */
export function gapLocatorFrom(locator: { page?: number; blockIndex?: number; sheet?: string; cell?: string; charStart?: number; charEnd?: number } | undefined, sha256?: string, path?: string): Record<string, unknown> {
  return {
    ...(locator?.page ? { page: String(locator.page) } : {}),
    ...(locator?.blockIndex !== undefined ? { blockIndex: locator.blockIndex, section: `block ${locator.blockIndex}` } : {}),
    ...(locator?.sheet ? { sheet: locator.sheet } : {}),
    ...(locator?.cell ? { cellRange: locator.cell } : {}),
    ...(typeof locator?.charStart === "number" ? { charStart: locator.charStart } : {}),
    ...(typeof locator?.charEnd === "number" ? { charEnd: locator.charEnd } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(path ? { path } : {}),
  };
}

/** Normalised comparison key for names and wording when matching promoted items to native rows. */
export function matchKey(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
