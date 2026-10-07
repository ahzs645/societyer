/**
 * PORTABLE FUNCTION: minutes:repairImported — a one-off, idempotent repair of
 * meetings, minutes and motions produced by the earlier rule-based imports
 * (PGAIR audit). It only corrects data the old pipeline got wrong in a
 * deterministic way, keeps every original value in a source field or note, and
 * reports what it changed. Running it twice changes nothing the second time.
 *
 * Steps (each can be switched off):
 *  1. motions      — re-derive status/outcome from the stored raw outcome
 *                    ("legacy outcome: Passed" ⇒ Voted / Carried), keeping the
 *                    wording in `sourceOutcomeText`;
 *  2. embedded     — sync legacy embedded `minutes.motions[]` into the motions
 *                    table (append, de-duplicated by wording) and clear the
 *                    retired field;
 *  3. sections     — strip "| " table-pipe artifacts from section and agenda
 *                    item titles (original kept in `sourceTitle`);
 *  4. titles       — replace file-name / generic header titles with
 *                    "<Body> meeting — <date>" (original kept in
 *                    `meetings.sourceTitle`), optionally reclassifying a
 *                    Board-typed meeting whose source names a committee;
 *  5. datePrecision— mark noon-UTC placeholder dates as date-only;
 *  6. quorum       — where quorum is not recorded but the stored source text
 *                    states it, record the stated status with a pending,
 *                    cited checkpoint;
 *  7. attendance   — remove role words, organizations and headings from the
 *                    attendee lists, keeping them as source evidence.
 *
 * Approved (adopted) minutes are never changed; their meetings' titles and date
 * precision still are, since those are not part of the adopted record.
 */

import type { PortableMutationCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { syncMotionsForMinutes, resolveMinutesMotions } from "./minutes";
import { classifyMotionOutcome, storedRawMotionOutcome } from "../motionOutcome";
import { bodyKeyForMeeting, cleanMeetingTitle, inferMeetingBody, isFilenameOrGenericMeetingTitle, stripTablePipes } from "../meetingBody";
import { isDateOnlyPlaceholder } from "../meetingDates";
import { quorumStatementFromText } from "../quorumStatement";
import { screenAttendanceList } from "../attendanceNames";
import { resolveImportCommittee } from "./importSessionHelpers/importMeetingApply";

export type RepairImportedOptions = {
  motions?: boolean;
  embedded?: boolean;
  sections?: boolean;
  titles?: boolean;
  reclassifyBodies?: boolean;
  datePrecision?: boolean;
  quorum?: boolean;
  attendance?: boolean;
};

export type RepairImportedReport = {
  dryRun: boolean;
  meetingsScanned: number;
  minutesScanned: number;
  motionsScanned: number;
  motionsRederived: number;
  motionsOutcomeTextKept: number;
  motionsUnrecognized: number;
  embeddedMotionsSynced: number;
  legacyEmbeddedCleared: number;
  sectionTitlesCleaned: number;
  agendaTitlesCleaned: number;
  meetingTitlesCleaned: number;
  meetingBodiesReclassified: number;
  committeesCreated: number;
  datePrecisionMarked: number;
  quorumFromSource: number;
  attendeesScreened: number;
  minutesWithAttendanceScreened: number;
  skippedApprovedMinutes: number;
  sameDayDuplicateGroups: number;
  examples: Array<{ kind: string; id: string; before?: string; after?: string }>;
};

const DEFAULTS: Required<RepairImportedOptions> = {
  motions: true, embedded: true, sections: true, titles: true, reclassifyBodies: true, datePrecision: true, quorum: true, attendance: true,
};

function isAdopted(minutes: any) {
  return Boolean(minutes?.approvedAt || minutes?.adoptedSnapshot || Array.isArray(minutes?.motionSnapshots));
}

function wordingKey(text: unknown) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
}

function hasPipeArtifact(title: unknown) {
  return /^\s*\|/.test(String(title ?? "")) || /\s\|\s*$/.test(String(title ?? "")) || /\s\|\s/.test(String(title ?? ""));
}

function sourceTextForQuorum(minutes: any): string {
  const parts: string[] = [];
  for (const document of Array.isArray(minutes?.sourceMeetingRecord?.documents) ? minutes.sourceMeetingRecord.documents : []) {
    for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
      if (typeof block?.text === "string") parts.push(block.text);
    }
  }
  if (!parts.length) {
    if (typeof minutes?.discussion === "string") parts.push(minutes.discussion);
    for (const section of Array.isArray(minutes?.sections) ? minutes.sections : []) if (typeof section?.discussion === "string") parts.push(section.discussion);
  }
  return parts.join("\n");
}

export async function repairImportedPortable(
  ctx: PortableMutationCtx,
  { societyId, dryRun, options }: { societyId: string; dryRun?: boolean; options?: RepairImportedOptions },
): Promise<RepairImportedReport> {
  await requireSocietyMembership(ctx, societyId);
  for (const permission of ["minutes:write", "meetings:write", "motions:write", "agendas:write"] as const) {
    await requirePermissionPortable(ctx, societyId, permission);
  }
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  if (opts.titles && opts.reclassifyBodies && !dryRun) await requirePermissionPortable(ctx, societyId, "committees:write");
  const write = !dryRun;
  const now = new Date().toISOString();
  const report: RepairImportedReport = {
    dryRun: Boolean(dryRun), meetingsScanned: 0, minutesScanned: 0, motionsScanned: 0, motionsRederived: 0, motionsOutcomeTextKept: 0,
    motionsUnrecognized: 0, embeddedMotionsSynced: 0, legacyEmbeddedCleared: 0, sectionTitlesCleaned: 0, agendaTitlesCleaned: 0,
    meetingTitlesCleaned: 0, meetingBodiesReclassified: 0, committeesCreated: 0, datePrecisionMarked: 0, quorumFromSource: 0,
    attendeesScreened: 0, minutesWithAttendanceScreened: 0, skippedApprovedMinutes: 0, sameDayDuplicateGroups: 0, examples: [],
  };
  const example = (kind: string, id: unknown, before?: unknown, after?: unknown) => {
    if (report.examples.length < 25) report.examples.push({ kind, id: String(id), before: before == null ? undefined : String(before).slice(0, 160), after: after == null ? undefined : String(after).slice(0, 160) });
  };

  const meetings = await ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const minutesRows = await ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const minutesById = new Map(minutesRows.map((row: any) => [String(row._id), row]));
  report.meetingsScanned = meetings.length;
  report.minutesScanned = minutesRows.length;

  // 1. Motion status/outcome from the stored raw wording.
  if (opts.motions) {
    const motions = await ctx.db.query("motions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    report.motionsScanned = motions.length;
    for (const row of motions as any[]) {
      if (row.minutesId && isAdopted(minutesById.get(String(row.minutesId)))) continue;
      const raw = storedRawMotionOutcome(row);
      if (!raw) continue;
      const classified = classifyMotionOutcome(raw);
      const patch: Record<string, unknown> = {};
      if (!row.sourceOutcomeText && !classified.canonical) patch.sourceOutcomeText = raw;
      const undecided = row.status === "Moved" && !row.outcome && !row.statusIsManual;
      if (undecided && classified.recognized && classified.status !== "Moved") {
        patch.status = classified.status;
        if (classified.outcome) patch.outcome = classified.outcome;
        if (!row.decidedBy && classified.decidedBy) patch.decidedBy = classified.decidedBy;
        patch.history = [...(row.history ?? []), {
          at: now, minutesId: row.minutesId, meetingId: row.primaryMeetingId, status: classified.status, outcome: classified.outcome,
          note: `Repair: outcome re-derived from the source wording "${raw}".`,
        }];
        report.motionsRederived += 1;
        example("motion", row._id, `${row.status}`, `${classified.status}${classified.outcome ? `/${classified.outcome}` : ""} (${raw})`);
      } else if (undecided && classified.needsReview) {
        report.motionsUnrecognized += 1;
      }
      if (patch.sourceOutcomeText && !patch.status) report.motionsOutcomeTextKept += 1;
      if (Object.keys(patch).length && write) await ctx.db.patch(row._id, { ...patch, updatedAtISO: now });
    }
  }

  // 2. Legacy embedded motions into the table.
  if (opts.embedded) {
    for (const minutes of minutesRows as any[]) {
      const embedded = Array.isArray(minutes.motions) ? minutes.motions : [];
      if (!embedded.length) continue;
      if (isAdopted(minutes)) { report.skippedApprovedMinutes += 1; continue; }
      const existing = await resolveMinutesMotions(ctx, minutes);
      const existingIds = new Set(existing.map((motion: any) => String(motion.motionId)));
      const known = new Set(existing.map((motion: any) => wordingKey(motion.text)));
      const toAppend: any[] = [];
      for (const motion of embedded) {
        if (motion?.motionId && existingIds.has(String(motion.motionId))) continue;
        const key = wordingKey(motion?.text);
        if (!key || known.has(key)) continue;
        known.add(key);
        const { motionId: _staleId, ...rest } = motion;
        toAppend.push(rest);
      }
      report.embeddedMotionsSynced += toAppend.length;
      report.legacyEmbeddedCleared += 1;
      if (toAppend.length) example("embeddedMotions", minutes._id, `${embedded.length} embedded / ${existing.length} in table`, `+${toAppend.length}`);
      if (write) {
        if (toAppend.length) await syncMotionsForMinutes(ctx, { societyId, minutesId: minutes._id, meetingId: minutes.meetingId, motions: toAppend, mode: "append" });
        await ctx.db.patch(minutes._id, { motions: undefined });
      }
    }
  }

  // 3. Table-pipe artifacts in section and agenda item titles.
  if (opts.sections) {
    for (const minutes of minutesRows as any[]) {
      if (!Array.isArray(minutes.sections) || !minutes.sections.some((section: any) => hasPipeArtifact(section?.title))) continue;
      if (isAdopted(minutes)) { report.skippedApprovedMinutes += 1; continue; }
      let changed = 0;
      const sections = minutes.sections.map((section: any) => {
        if (!hasPipeArtifact(section?.title)) return section;
        const title = stripTablePipes(section.title);
        if (!title || title === section.title) return section;
        changed += 1;
        if (changed === 1) example("sectionTitle", minutes._id, section.title, title);
        return { ...section, title, sourceTitle: section.sourceTitle ?? section.title };
      });
      report.sectionTitlesCleaned += changed;
      if (changed && write) await ctx.db.patch(minutes._id, { sections });
    }
    const agendaItems = await ctx.db.query("agendaItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    for (const item of agendaItems as any[]) {
      if (!hasPipeArtifact(item.title)) continue;
      const title = stripTablePipes(item.title);
      if (!title || title === item.title) continue;
      report.agendaTitlesCleaned += 1;
      if (write) await ctx.db.patch(item._id, { title });
    }
  }

  // 4 + 5. Meeting titles, bodies and date precision.
  const committees = new Map<string, any>();
  for (const row of await ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) committees.set(String(row._id), row);
  const byDayBody = new Map<string, number>();
  const plannedCommittees = new Set<string>();
  for (const meeting of meetings as any[]) {
    const patch: Record<string, unknown> = {};
    let committee = meeting.committeeId ? committees.get(String(meeting.committeeId)) : null;
    let type = meeting.type;
    let committeeId = meeting.committeeId;
    const original = meeting.sourceTitle ?? meeting.title;
    if (opts.titles && opts.reclassifyBodies && !meeting.committeeId && String(type).toLowerCase() === "board") {
      const inferred = inferMeetingBody(original);
      if (inferred.type === "Committee" && inferred.committeeKey) {
        const resolved = write
          ? await resolveImportCommittee(ctx, societyId, inferred, { create: true })
          : await resolveImportCommittee(ctx, societyId, inferred, { create: false });
        if (resolved.created) report.committeesCreated += 1;
        if (!write && !resolved.committeeId && !plannedCommittees.has(inferred.committeeKey)) report.committeesCreated += 1;
        plannedCommittees.add(inferred.committeeKey);
        type = "Committee";
        committeeId = resolved.committeeId;
        committee = committeeId ? (committees.get(String(committeeId)) ?? await ctx.db.get(committeeId)) : { name: inferred.committeeName, bodyKey: inferred.committeeKey };
        if (committeeId && committee) committees.set(String(committeeId), committee);
        patch.type = "Committee";
        if (committeeId) patch.committeeId = committeeId;
        report.meetingBodiesReclassified += 1;
        example("meetingBody", meeting._id, `Board`, inferred.committeeName);
      } else if (inferred.type === "AGM" || inferred.type === "SGM") {
        // A Board-typed meeting whose source says AGM keeps its type: merges
        // of AGM and Board meetings need a human split, not a relabel.
      }
    }
    const date = String(meeting.scheduledAt ?? "").slice(0, 10);
    const bodyKey = bodyKeyForMeeting({ ...meeting, type, committeeId }, committee);
    const groupKey = `${date}::${bodyKey}`;
    byDayBody.set(groupKey, (byDayBody.get(groupKey) ?? 0) + 1);
    if (opts.titles && isFilenameOrGenericMeetingTitle(meeting.title)) {
      const title = cleanMeetingTitle({
        bodyKey,
        committeeName: committee?.name ?? (bodyKey.startsWith("committee:") ? inferMeetingBody(original).committeeName : undefined),
        special: /\bspecial\b/i.test(String(original).replace(/_/g, " ")),
        date,
        external: meeting.hostBody === "external" ? meeting.externalOrganization : undefined,
      });
      if (title !== meeting.title) {
        patch.title = title;
        if (!meeting.sourceTitle) patch.sourceTitle = meeting.title;
        report.meetingTitlesCleaned += 1;
        example("meetingTitle", meeting._id, meeting.title, title);
      }
    }
    if (opts.datePrecision && !meeting.scheduledAtPrecision && isDateOnlyPlaceholder(meeting.scheduledAt)) {
      patch.scheduledAtPrecision = "date";
      report.datePrecisionMarked += 1;
    }
    if (Object.keys(patch).length && write) await ctx.db.patch(meeting._id, patch);
  }
  report.sameDayDuplicateGroups = [...byDayBody.values()].filter((count) => count > 1).length;

  // 6 + 7. Quorum stated in the stored source text; attendance screening.
  // A linked source document is only read when it backs exactly one minutes
  // record (a meeting package can hold several meetings' minutes).
  const documentUse = new Map<string, number>();
  for (const minutes of minutesRows as any[]) for (const id of minutes.sourceDocumentIds ?? []) documentUse.set(String(id), (documentUse.get(String(id)) ?? 0) + 1);
  let canReadDocuments = false;
  if (opts.quorum) { try { await requirePermissionPortable(ctx, societyId, "documents:read"); canReadDocuments = true; } catch { canReadDocuments = false; } }
  for (const minutes of minutesRows as any[]) {
    if (isAdopted(minutes)) continue;
    const patch: Record<string, unknown> = {};
    if (opts.quorum && (minutes.quorumStatus ?? "not_recorded") === "not_recorded" && !minutes.quorumMet) {
      let statement = quorumStatementFromText(sourceTextForQuorum(minutes));
      if (statement.quorumStatus === "not_recorded" && canReadDocuments) {
        for (const id of minutes.sourceDocumentIds ?? []) {
          if (documentUse.get(String(id)) !== 1) continue;
          const document: any = await ctx.db.get(id).catch(() => null);
          if (!document || String(document.societyId) !== societyId) continue;
          let text = "";
          try { text = String(JSON.parse(document.content ?? "{}")?.extractedText ?? ""); } catch { text = ""; }
          const fromDocument = quorumStatementFromText(text);
          if (fromDocument.quorumStatus !== "not_recorded") { statement = fromDocument; break; }
        }
      }
      const sourceExternalIds = Array.isArray(minutes.sourceExternalIds) ? [...new Set(minutes.sourceExternalIds.map(String))] : [];
      if (statement.quorumStatus !== "not_recorded" && statement.quote && sourceExternalIds.length) {
        const checkpoints = Array.isArray(minutes.quorumCheckpoints) ? minutes.quorumCheckpoints : [];
        if (!checkpoints.some((row: any) => row?.id === "repair-source-quorum")) {
          patch.quorumStatus = statement.quorumStatus;
          patch.quorumMet = statement.quorumMet;
          patch.quorumCheckpoints = [...checkpoints, {
            id: "repair-source-quorum", scope: "meeting", boundary: "Meeting", assertion: statement.quorumStatus,
            ...(statement.presentCount != null ? { eligibleCount: statement.presentCount } : {}),
            sourceReference: statement.quote, sourceExternalIds, reviewStatus: "pending",
          }];
          report.quorumFromSource += 1;
          example("quorum", minutes._id, "not_recorded", `${statement.quorumStatus}: ${statement.quote}`);
        }
      }
    }
    if (opts.attendance) {
      const present = screenAttendanceList(Array.isArray(minutes.attendees) ? minutes.attendees : []);
      const absent = screenAttendanceList(Array.isArray(minutes.absent) ? minutes.absent : []);
      const rejected = [...present.rejected.map((row) => ({ ...row, list: "attendees" })), ...absent.rejected.map((row) => ({ ...row, list: "absent" }))];
      if (rejected.length) {
        const keep = (list: unknown[], rejectedRows: any[]) => {
          const drop = new Set(rejectedRows.map((row) => row.original));
          return (list as string[]).filter((name) => !drop.has(name));
        };
        patch.attendees = keep(minutes.attendees ?? [], present.rejected);
        patch.absent = keep(minutes.absent ?? [], absent.rejected);
        let transcript: any = {};
        try { transcript = minutes.draftTranscript ? JSON.parse(minutes.draftTranscript) : {}; } catch { transcript = { originalDraftTranscript: minutes.draftTranscript }; }
        const prior = Array.isArray(transcript.nonPersonAttendance) ? transcript.nonPersonAttendance : [];
        transcript.nonPersonAttendance = [...prior, ...rejected.map((row) => ({ name: row.original, kind: row.kind, list: row.list, removedBy: "repairImported", at: now }))];
        patch.draftTranscript = JSON.stringify(transcript);
        const note = `Repair: ${rejected.length} attendance entr${rejected.length === 1 ? "y" : "ies"} (role words, organizations or headings) moved to source evidence.`;
        patch.sourceReviewNotes = [minutes.sourceReviewNotes, note].filter(Boolean).join("\n");
        report.attendeesScreened += rejected.length;
        report.minutesWithAttendanceScreened += 1;
        example("attendance", minutes._id, rejected.map((row) => row.original).join(", "), "evidence only");
      }
    }
    if (Object.keys(patch).length && write) await ctx.db.patch(minutes._id, patch);
  }

  const changed = report.motionsRederived + report.motionsOutcomeTextKept + report.embeddedMotionsSynced + report.legacyEmbeddedCleared + report.sectionTitlesCleaned
    + report.agendaTitlesCleaned + report.meetingTitlesCleaned + report.meetingBodiesReclassified + report.datePrecisionMarked + report.quorumFromSource + report.attendeesScreened;
  if (write && changed > 0) {
    await ctx.db.insert("activity", {
      societyId,
      actor: "You",
      entityType: "minutes",
      subjectId: societyId,
      entityId: societyId,
      action: "repaired",
      summary: `Repaired imported minutes: ${report.motionsRederived} motion outcomes, ${report.embeddedMotionsSynced} embedded motions, ${report.meetingTitlesCleaned} titles, ${report.sectionTitlesCleaned + report.agendaTitlesCleaned} pipe titles, ${report.quorumFromSource} quorum statements, ${report.attendeesScreened} non-person attendees`,
      createdAtISO: now,
    });
  }
  return report;
}
