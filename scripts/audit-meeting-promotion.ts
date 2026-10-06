import type { PortableDoc } from "../shared/portable/ctx";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildIntakeBackup } from "./build-intake-backup";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { structuredEditFromMinutes, structuredPatchFromEdit } from "../src/features/meetings/lib/structuredMinutes";

function differences(expected: unknown, actual: unknown, path = ""): { path: string; expected: unknown; actual: unknown }[] {
  if (expected === undefined) return [];
  if (Array.isArray(expected)) {
    const result = expected.flatMap((value, index) => differences(value, Array.isArray(actual) ? actual[index] : undefined, `${path}[${index}]`));
    if (expected.length !== (Array.isArray(actual) ? actual.length : undefined)) result.push({ path: `${path}.length`, expected: expected.length, actual: (Array.isArray(actual) ? actual.length : undefined) ?? null });
    return result;
  }
  if (expected && typeof expected === "object") return Object.entries(expected).flatMap(([key, value]) => differences(value, actual && typeof actual === "object" ? (actual as Record<string, unknown>)[key] : undefined, path ? `${path}.${key}` : key));
  return expected === actual ? [] : [{ path, expected, actual: actual ?? null }];
}

/** Approvals exist only inside a fresh in-memory verification runtime. Never exports an approved backup. */
export async function auditMeetingPromotion(organization: Record<string, unknown>, bundle: Record<string, unknown> & { meetingMinutes?: Record<string, unknown>[] }) {
  const built = await buildIntakeBackup(organization, [bundle]);
  const client = new StaticConvexClient({ seed: { societies: [] }, databaseName: `audit-only-${randomUUID()}` });
  await client.importLocalWorkspaceSnapshot(JSON.parse(JSON.stringify(built.snapshot)));
  const sessionId = built.sessionIds[0];
  const session = await client.query("importSessions:get", { sessionId });
  const records = session.records.filter((record: PortableDoc) => record.recordKind === "meetingMinutes");
  if (!records.length) throw new Error("No meeting-minutes candidates to audit.");
  const sourceKey = (value: Record<string, unknown>) => JSON.stringify([String(value.meetingDate ?? "").trim(), String(value.meetingTitle ?? "").trim(), [...(Array.isArray(value.sourceExternalIds) ? value.sourceExternalIds : [])].sort()]);
  const sources = new Map<string, Record<string, unknown>>();
  for (const source of bundle.meetingMinutes ?? []) {
    const key = sourceKey(source);
    if (sources.has(key)) throw new Error("Ambiguous duplicate meeting source identity; reconcile before auditing.");
    sources.set(key, source);
  }
  for (const record of records) await client.mutation("importSessions:updateRecord", { recordId: record._id, status: "Approved", reviewNotes: "Isolated promotion verification only; not a human source approval." });
  const result = await client.mutation("importSessions:applyApprovedMeetings", { sessionId });
  const tables = client.exportLocalWorkspaceSnapshot().tables;
  const promotedSession = await client.query("importSessions:get", { sessionId });
  const reports = records.map((record: PortableDoc) => {
    const source = sources.get(sourceKey(record.payload));
    if (!source) throw new Error(`Cannot match staged meeting to source: ${record.title}`);
    const imported = promotedSession.records.find((row) => row._id === record._id);
    const target = imported.importedTargets?.meetings;
    const minutes = tables.minutes?.find((row) => row._id === target?.minutesId);
    const meeting = tables.meetings?.find((row) => row._id === target?.meetingId);
    if (!minutes || !meeting) throw new Error(`Missing native promotion target for ${record.title}`);
    const fields = ["chairName", "secretaryName", "recorderName", "calledToOrderAt", "adjournedAt", "remoteParticipation", "detailedAttendance", "attendees", "absent", "quorumStatus", "discussion", "sections", "decisions", "actionItems", "nextMeetingAt", "nextMeetingLocation", "nextMeetingNotes", "sessionSegments", "appendices", "agmDetails", "historicalActions", "quorumEvents", "sourceVersions", "sourceExternalIds"];
    const nativeDifferences = fields.flatMap((key) => differences(source[key], minutes[key], key));
    for (const [sourceKey, nativeKey] of [["meetingTitle", "title"], ["meetingType", "type"], ["location", "location"], ["electronic", "electronic"]]) nativeDifferences.push(...differences(source[sourceKey], meeting[nativeKey], `meeting.${nativeKey}`));
    const nativeMotions = (minutes.motionIds ?? []).map((id: string) => tables.motions?.find((row) => row._id === id));
    const motions = Array.isArray(source.motions) ? source.motions as Record<string, unknown>[] : [];
    for (let i = 0; i < motions.length; i++) {
      const motion = motions[i];
      for (const [sourceKey, nativeKey] of [["motionText", "text"], ["movedByName", "movedBy"], ["secondedByName", "secondedBy"], ["outcome", "outcome"], ["votesFor", "votesFor"], ["votesAgainst", "votesAgainst"], ["abstentions", "abstentions"]]) nativeDifferences.push(...differences(motion[sourceKey], nativeMotions[i]?.[nativeKey], `motions[${i}].${nativeKey}`));
    }
    const editPatch = structuredPatchFromEdit(structuredEditFromMinutes(minutes));
    const editorDifferences = Object.keys(editPatch).flatMap((key) => differences(minutes[key], editPatch[key as keyof typeof editPatch], key));
    return { title: source.meetingTitle, date: source.meetingDate, sourceExternalIds: source.sourceExternalIds, nativeMeeting: !!meeting, nativeMinutes: !!minutes, nativeMotionCount: nativeMotions.length, nativeDifferences, editorDifferences, sourceReviewStatus: minutes.sourceReviewStatus, sourceApproved: !!minutes.approvedAt };
  });
  return { purpose: "Isolated candidate-to-native promotion and editor fidelity audit; no approved backup exported", testedAt: new Date().toISOString(), promotion: result, meetingCount: reports.length, nativeDifferenceCount: reports.reduce((sum, report) => sum + report.nativeDifferences.length, 0), editorDifferenceCount: reports.reduce((sum, report) => sum + report.editorDifferences.length, 0), limitations: ["Checks supplied native fields; absence of differences does not establish extraction completeness or historical accuracy.", "Unknown action completion still defaults to false in the native schema.", "Source-only evidence fields and unsupported fields are not native-field assertions.", "StructuredMinutes helper fidelity is verified; this is not a browser UI end-to-end test."], meetings: reports };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [organizationPath, bundlePath, outputPath] = process.argv.slice(2);
  if (!organizationPath || !bundlePath || !outputPath) throw new Error("Usage: node --import tsx scripts/audit-meeting-promotion.ts organization.json bundle.json audit.json");
  const report = await auditMeetingPromotion(JSON.parse(await readFile(organizationPath, "utf8")), JSON.parse(await readFile(bundlePath, "utf8")));
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ meetings: report.meetingCount, nativeDifferences: report.nativeDifferenceCount, editorDifferences: report.editorDifferenceCount }));
}
