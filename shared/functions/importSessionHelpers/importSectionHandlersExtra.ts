// C11: import-section handlers for the registers that had no bundle key
// (committees, committee members, members, directors and their terms, tasks,
// goals, commitments, funding sources, grant reports, meeting materials,
// organization seats, conflicts, proxies, bylaw rule sets, operating budgets),
// plus the meeting-reference resolver shared with C9 / C12.
//
// Every handler resolves references by name/date against the importing
// workspace (payload IDs are never trusted), writes review-pending rows where
// the register has a review state, and returns the inserted (or matched) id.

import { DEFAULT_BYLAW_RULES } from "../../bylawBaselines";
import { bodyQuorumRuleIssues } from "../../bodyQuorum";
import { actionStatusFromSource } from "../../actionItemStatus";
import { bodyKeyForMeeting, inferMeetingBody, meetingBodyFromImport, slugBody } from "../../meetingBody";
import { requirePermissionPortable } from "../permissions";
import { arrayOf, cleanDate, cleanText, compactRecord, numberOrUndefined, optionalBoolean, personKey, splitName, todayDate, unique } from "./importSessionUtils";
import { confidenceFor } from "./importSessionRecordKinds";
import { directoryPersonId, loadDirectoryIndex, resolveImportCommittee } from "./importMeetingApply";

type HandlerContext = {
  ctx: any;
  societyId: string;
  record: any;
  payload: any;
  sourceDocumentIds: any[];
  firstSourceDocumentId: any;
  sourceNote: any;
};

/** A meeting named by date (+ body / title) in an import payload. */
export async function resolveMeetingReference(ctx: any, societyId: string, ref: unknown): Promise<{ meetingId: any; minutesId?: any } | null> {
  const value: any = typeof ref === "string" ? { meetingDate: ref } : ref;
  if (!value || typeof value !== "object") return null;
  const date = cleanDate(value.meetingDate ?? value.date);
  if (!date) return null;
  const meetings = (await ctx.db.query("meetings").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect())
    .filter((meeting: any) => String(meeting.scheduledAt ?? "").slice(0, 10) === date);
  if (!meetings.length) return null;
  const named = value.body || value.bodyKey || value.committeeName || value.meetingType || value.meetingTitle;
  let candidates = meetings;
  if (named) {
    const body = meetingBodyFromImport({ body: value.body ?? value.bodyKey, committeeName: value.committeeName, meetingType: value.meetingType, meetingTitle: value.meetingTitle });
    if (body.basis !== "default") {
      const keyed: any[] = [];
      for (const meeting of meetings) {
        const committee = meeting.committeeId ? await ctx.db.get(meeting.committeeId) : null;
        if (bodyKeyForMeeting(meeting, committee) === body.bodyKey) keyed.push(meeting);
      }
      candidates = keyed;
    }
    if (candidates.length > 1 && value.meetingTitle) {
      const wanted = String(value.meetingTitle).trim().toLowerCase();
      candidates = candidates.filter((meeting: any) => [meeting.title, meeting.sourceTitle].some((title) => String(title ?? "").trim().toLowerCase() === wanted));
    }
  }
  if (candidates.length !== 1) return null;
  return { meetingId: candidates[0]._id, minutesId: candidates[0].minutesId };
}

function meetingRefFrom(payload: any, ...keys: string[]) {
  for (const key of keys) if (payload?.[key]) return payload[key];
  if (payload?.meetingDate) return { meetingDate: payload.meetingDate, body: payload.body ?? payload.meetingBody, committeeName: payload.committeeName, meetingTitle: payload.meetingTitle };
  return undefined;
}

async function resolveRegisterPerson(ctx: any, societyId: string, name: unknown) {
  const key = personKey(name);
  if (!key) return {};
  const [members, directors] = await Promise.all([
    ctx.db.query("members").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("directors").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
  ]);
  const match = (rows: any[]) => {
    const hits = rows.filter((row) => [`${row.firstName ?? ""} ${row.lastName ?? ""}`, ...arrayOf(row.aliases)].map(personKey).includes(key));
    return hits.length === 1 ? String(hits[0]._id) : undefined;
  };
  return { memberId: match(members), directorId: match(directors) };
}

function personNames(payload: any) {
  const full = cleanText(payload.fullName) || cleanText(payload.name) || cleanText(payload.personName);
  const split = splitName(full);
  return {
    full: full || [payload.firstName, payload.lastName].map(cleanText).filter(Boolean).join(" ") || "Needs review",
    firstName: cleanText(payload.firstName) || split.firstName || "Needs",
    lastName: cleanText(payload.lastName) || split.lastName || "review",
  };
}

const TASK_STATUS_FROM_ACTION: Record<string, string> = {
  completed: "Done", in_progress: "InProgress", ongoing: "InProgress", on_hold: "Blocked", open: "Todo", cancelled: "Cancelled", unknown: "Unknown",
};

export const EXTRA_SECTION_RECORD_HANDLERS: Record<string, (h: HandlerContext) => Promise<any>> = {
  committee: async ({ ctx, societyId, payload }) => {
    const name = cleanText(payload.name) || cleanText(payload.committeeName) || "Imported committee";
    const inferred = inferMeetingBody(name);
    const bodyKey = cleanText(payload.bodyKey) || inferred.committeeKey || slugBody(name);
    const existing = await resolveImportCommittee(ctx, societyId, { type: "Committee", bodyKey: `committee:${bodyKey}`, committeeKey: bodyKey, committeeName: name }, { create: false });
    const quorumRule = payload.quorumRule && typeof payload.quorumRule === "object" ? compactRecord({
      quorumType: cleanText(payload.quorumRule.quorumType) || "fixed",
      quorumValue: numberOrUndefined(payload.quorumRule.quorumValue),
      quorumMinimumCount: numberOrUndefined(payload.quorumRule.quorumMinimumCount),
      countBasis: cleanText(payload.quorumRule.countBasis),
      notes: cleanText(payload.quorumRule.notes),
    }) : undefined;
    if (quorumRule) {
      const issues = bodyQuorumRuleIssues([{ body: "committee", ...quorumRule }]);
      if (issues.length) throw new Error(`Committee ${name}: ${issues.join("; ")}`);
    }
    if (existing.committeeId) {
      const row = await ctx.db.get(existing.committeeId);
      const patch = compactRecord({
        mission: row?.mission ? undefined : cleanText(payload.mission),
        description: row?.description ? undefined : cleanText(payload.description),
        quorumRule: row?.quorumRule ? undefined : quorumRule,
        bodyKey: row?.bodyKey ? undefined : bodyKey,
        cadenceNotes: row?.cadenceNotes ? undefined : cleanText(payload.cadenceNotes),
      });
      if (patch) await ctx.db.patch(existing.committeeId, patch);
      return existing.committeeId;
    }
    return await ctx.db.insert("committees", compactRecord({
      societyId,
      name,
      description: cleanText(payload.description) || "Imported committee. Review mandate, membership and quorum.",
      mission: cleanText(payload.mission),
      cadence: cleanText(payload.cadence) || "Unknown",
      cadenceNotes: cleanText(payload.cadenceNotes),
      quorumRule,
      bodyKey,
      color: cleanText(payload.color) || "gray",
      status: cleanText(payload.status) || "Active",
      createdAtISO: new Date().toISOString(),
    }));
  },

  committeeMember: async ({ ctx, societyId, payload }) => {
    const committeeName = cleanText(payload.committeeName) || cleanText(payload.committee);
    const inferred = inferMeetingBody(committeeName);
    const committeeKey = cleanText(payload.committeeBodyKey) || inferred.committeeKey || slugBody(committeeName);
    const { committeeId } = await resolveImportCommittee(ctx, societyId, { type: "Committee", bodyKey: `committee:${committeeKey}`, committeeKey, committeeName: inferred.committeeName ?? committeeName }, { create: true });
    if (!committeeId) throw new Error("A committee member needs a committee name.");
    const names = personNames(payload);
    const links = await resolveRegisterPerson(ctx, societyId, names.full);
    const directory = await loadDirectoryIndex(ctx, societyId);
    return await ctx.db.insert("committeeMembers", compactRecord({
      committeeId,
      societyId,
      name: names.full,
      email: cleanText(payload.email),
      role: cleanText(payload.role) || "Member",
      directorId: links.directorId,
      memberId: links.memberId,
      personId: directoryPersonId(directory, names.full),
      representedOrganization: cleanText(payload.representedOrganization) || cleanText(payload.organizationName),
      joinedAt: cleanDate(payload.joinedAt) || cleanDate(payload.startDate) || cleanDate(payload.sourceDate) || todayDate(),
      leftAt: cleanDate(payload.leftAt) || cleanDate(payload.endDate),
    }));
  },

  member: async ({ ctx, societyId, payload, sourceNote }) => {
    const names = personNames(payload);
    const directory = await loadDirectoryIndex(ctx, societyId);
    return await ctx.db.insert("members", compactRecord({
      societyId,
      directoryPersonId: directoryPersonId(directory, names.full),
      firstName: names.firstName,
      lastName: names.lastName,
      email: cleanText(payload.email),
      aliases: arrayOf(payload.aliases).map(String).map(cleanText).filter(Boolean),
      membershipClass: cleanText(payload.membershipClass) || "Regular",
      status: cleanText(payload.status) || "NeedsReview",
      joinedAt: cleanDate(payload.joinedAt) || cleanDate(payload.sourceDate) || todayDate(),
      leftAt: cleanDate(payload.leftAt),
      votingRights: optionalBoolean(payload.votingRights) ?? true,
      notes: [cleanText(payload.organizationName) ? `Represents ${cleanText(payload.organizationName)}.` : undefined, sourceNote].filter(Boolean).join("\n") || undefined,
    }));
  },

  director: async ({ ctx, societyId, payload, sourceDocumentIds, sourceNote }) => {
    const names = personNames(payload);
    const directory = await loadDirectoryIndex(ctx, societyId);
    const links = await resolveRegisterPerson(ctx, societyId, names.full);
    const terms = arrayOf(payload.terms);
    const firstTerm = terms[0] ?? {};
    const directorId = await ctx.db.insert("directors", compactRecord({
      societyId,
      directoryPersonId: directoryPersonId(directory, names.full),
      memberId: links.memberId,
      firstName: names.firstName,
      lastName: names.lastName,
      email: cleanText(payload.email),
      position: cleanText(payload.position) || cleanText(firstTerm.position) || "Director",
      isBCResident: optionalBoolean(payload.isBCResident) ?? false,
      termStart: cleanDate(payload.termStart) || cleanDate(firstTerm.termStart ?? firstTerm.startDate) || cleanDate(payload.sourceDate) || todayDate(),
      termEnd: cleanDate(payload.termEnd) || cleanDate(firstTerm.termEnd ?? firstTerm.endDate),
      consentOnFile: optionalBoolean(payload.consentOnFile) ?? false,
      resignedAt: cleanDate(payload.resignedAt),
      status: cleanText(payload.status) || "NeedsReview",
      notes: sourceNote,
    }));
    // Each recorded term becomes an observed role assignment (term history).
    for (const term of terms) {
      await ctx.db.insert("boardRoleAssignments", compactRecord({
        societyId,
        personName: names.full,
        personKey: personKey(names.full),
        directorId,
        memberId: links.memberId,
        roleTitle: cleanText(term.position) || cleanText(term.roleTitle) || "Director",
        roleGroup: cleanText(term.roleGroup),
        roleType: cleanText(term.roleType) || "director",
        startDate: cleanDate(term.termStart ?? term.startDate) || cleanDate(payload.sourceDate) || todayDate(),
        endDate: cleanDate(term.termEnd ?? term.endDate),
        status: "Observed",
        confidence: confidenceFor(payload),
        sourceDocumentIds,
        sourceExternalIds: unique([...arrayOf(payload.sourceExternalIds), ...arrayOf(term.sourceExternalIds)]),
        importedFrom: "Import session director term",
        notes: cleanText(term.notes),
        createdAtISO: new Date().toISOString(),
      }));
    }
    return directorId;
  },

  task: async ({ ctx, societyId, payload, firstSourceDocumentId, sourceNote }) => {
    const directory = await loadDirectoryIndex(ctx, societyId);
    const sourceAssignee = cleanText(payload.sourceAssignee) || cleanText(payload.assignee);
    const meeting = await resolveMeetingReference(ctx, societyId, meetingRefFrom(payload, "meeting"));
    const committeeName = cleanText(payload.committeeName);
    const committee = committeeName ? await resolveImportCommittee(ctx, societyId, { ...inferMeetingBody(committeeName), type: "Committee", committeeKey: inferMeetingBody(committeeName).committeeKey ?? slugBody(committeeName), bodyKey: `committee:${inferMeetingBody(committeeName).committeeKey ?? slugBody(committeeName)}`, committeeName }, { create: false }) : { committeeId: undefined };
    const actionStatus = actionStatusFromSource(payload.status ?? payload.sourceStatus);
    const status = ["Todo", "InProgress", "Blocked", "Done"].includes(cleanText(payload.status) ?? "") ? cleanText(payload.status)! : TASK_STATUS_FROM_ACTION[actionStatus];
    const now = new Date().toISOString();
    const statusHistory = arrayOf(payload.statusHistory).map((row: any) => compactRecord({
      from: cleanText(row?.from),
      to: TASK_STATUS_FROM_ACTION[actionStatusFromSource(row?.status ?? row?.to)] ?? cleanText(row?.to),
      sourceStatus: cleanText(row?.status ?? row?.to),
      recordedAtISO: cleanDate(row?.asOf ?? row?.date) || now,
      meetingDate: cleanDate(row?.meetingDate),
      note: cleanText(row?.note),
      source: "import",
    })).filter(Boolean);
    return await ctx.db.insert("tasks", compactRecord({
      societyId,
      title: cleanText(payload.title) || cleanText(payload.text) || "Imported action",
      description: [cleanText(payload.description), sourceNote].filter(Boolean).join("\n\n") || undefined,
      status,
      priority: cleanText(payload.priority) || "Medium",
      assignee: sourceAssignee,
      sourceAssignee,
      assigneePersonId: directoryPersonId(directory, sourceAssignee),
      dueDate: cleanDate(payload.dueDate),
      meetingId: meeting?.meetingId,
      committeeId: committee.committeeId,
      documentId: firstSourceDocumentId,
      externalActionId: cleanText(payload.externalActionId) || cleanText(payload.actionKey),
      sourceStatusDate: cleanDate(payload.statusAsOf),
      sourceStatusReview: actionStatus === "unknown" ? "status_not_stated" : undefined,
      statusHistory: statusHistory.length ? statusHistory : undefined,
      tags: unique(["imported-action", ...arrayOf(payload.tags).map(String)]),
      createdAtISO: now,
      completedAt: status === "Done" ? cleanDate(payload.completedAt) || cleanDate(payload.statusAsOf) || undefined : undefined,
    }));
  },

  goal: async ({ ctx, societyId, payload, sourceNote }) => {
    const committeeName = cleanText(payload.committeeName);
    const committee = committeeName ? await resolveImportCommittee(ctx, societyId, { type: "Committee", committeeKey: inferMeetingBody(committeeName).committeeKey ?? slugBody(committeeName), bodyKey: "", committeeName }, { create: false }) : { committeeId: undefined };
    return await ctx.db.insert("goals", compactRecord({
      societyId,
      committeeId: committee.committeeId,
      title: cleanText(payload.title) || "Imported goal",
      description: [cleanText(payload.description), sourceNote].filter(Boolean).join("\n\n") || undefined,
      category: cleanText(payload.category) || "Strategic",
      status: cleanText(payload.status) || "NeedsReview",
      startDate: cleanDate(payload.startDate) || cleanDate(payload.sourceDate) || todayDate(),
      targetDate: cleanDate(payload.targetDate) || cleanDate(payload.endDate) || cleanDate(payload.startDate) || todayDate(),
      progressPercent: Math.max(0, Math.min(100, numberOrUndefined(payload.progressPercent) ?? 0)),
      ownerName: cleanText(payload.ownerName),
      milestones: arrayOf(payload.milestones).map((row: any) => compactRecord({ title: cleanText(row?.title) || "Milestone", done: Boolean(row?.done), dueDate: cleanDate(row?.dueDate) })).filter(Boolean),
      keyResults: arrayOf(payload.keyResults).map((row: any) => ({ description: cleanText(row?.description) || "Key result", currentValue: numberOrUndefined(row?.currentValue) ?? 0, targetValue: numberOrUndefined(row?.targetValue) ?? 0, unit: cleanText(row?.unit) || "" })),
      createdAtISO: new Date().toISOString(),
    }));
  },

  commitment: async ({ ctx, societyId, payload, firstSourceDocumentId, sourceNote }) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("commitments", compactRecord({
      societyId,
      title: cleanText(payload.title) || "Imported commitment",
      category: cleanText(payload.category) || "Other",
      sourceDocumentId: firstSourceDocumentId,
      sourceLabel: cleanText(payload.sourceLabel),
      sourceExcerpt: cleanText(payload.sourceExcerpt),
      counterparty: cleanText(payload.counterparty),
      requirement: cleanText(payload.requirement) || cleanText(payload.title) || "Review source",
      cadence: cleanText(payload.cadence) || "Once",
      nextDueDate: cleanDate(payload.nextDueDate),
      dueDateBasis: cleanText(payload.dueDateBasis),
      noticeLeadDays: numberOrUndefined(payload.noticeLeadDays),
      owner: cleanText(payload.owner),
      status: cleanText(payload.status) || "Watching",
      reviewStatus: "NeedsReview",
      notes: sourceNote,
      createdAtISO: now,
      updatedAtISO: now,
    }));
  },

  fundingSource: async ({ ctx, societyId, payload, sourceNote }) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("fundingSources", compactRecord({
      societyId,
      name: cleanText(payload.name) || "Imported funding source",
      sourceType: cleanText(payload.sourceType) || "Other",
      status: cleanText(payload.status) || "Active",
      contactName: cleanText(payload.contactName),
      email: cleanText(payload.email),
      phone: cleanText(payload.phone),
      website: cleanText(payload.website),
      expectedAnnualCents: numberOrUndefined(payload.expectedAnnualCents),
      committedCents: numberOrUndefined(payload.committedCents),
      receivedToDateCents: numberOrUndefined(payload.receivedToDateCents),
      currency: cleanText(payload.currency) || "CAD",
      startDate: cleanDate(payload.startDate),
      endDate: cleanDate(payload.endDate),
      restrictedPurpose: cleanText(payload.restrictedPurpose),
      notes: sourceNote,
      createdAtISO: now,
      updatedAtISO: now,
    }));
  },

  grantReport: async ({ ctx, societyId, payload, firstSourceDocumentId, sourceNote }) => {
    const grant = await resolveGrant(ctx, societyId, payload);
    if (!grant) throw new Error("Grant report needs a grant that exists in this workspace (grantTitle).");
    return await ctx.db.insert("grantReports", compactRecord({
      societyId,
      grantId: grant,
      title: cleanText(payload.title) || "Imported funder report",
      dueAtISO: cleanDate(payload.dueAtISO) || cleanDate(payload.dueDate) || cleanDate(payload.sourceDate) || todayDate(),
      submittedAtISO: cleanDate(payload.submittedAtISO) || cleanDate(payload.submittedAt),
      status: cleanText(payload.status) || (cleanDate(payload.submittedAtISO ?? payload.submittedAt) ? "Submitted" : "Upcoming"),
      spendingToDateCents: numberOrUndefined(payload.spendingToDateCents),
      outcomeSummary: cleanText(payload.outcomeSummary),
      documentId: firstSourceDocumentId,
      notes: sourceNote,
    }));
  },

  meetingMaterial: async ({ ctx, societyId, payload, firstSourceDocumentId }) => {
    const meeting = await resolveMeetingReference(ctx, societyId, meetingRefFrom(payload, "meeting"));
    if (!meeting) throw new Error("Meeting material needs a meeting in this workspace (meetingDate + body).");
    if (!firstSourceDocumentId) throw new Error("Meeting material needs a source document.");
    const existing = await ctx.db.query("meetingMaterials").withIndex("by_meeting", (q: any) => q.eq("meetingId", meeting.meetingId)).collect();
    return await ctx.db.insert("meetingMaterials", compactRecord({
      societyId,
      meetingId: meeting.meetingId,
      documentId: firstSourceDocumentId,
      agendaLabel: cleanText(payload.agendaLabel) || cleanText(payload.itemNumber),
      label: cleanText(payload.label) || cleanText(payload.title),
      order: numberOrUndefined(payload.order) ?? existing.length,
      requiredForMeeting: optionalBoolean(payload.requiredForMeeting) ?? false,
      accessLevel: cleanText(payload.accessLevel) || "board",
      availabilityStatus: "available",
      notes: cleanText(payload.notes),
      createdAtISO: new Date().toISOString(),
    }));
  },

  organizationSeat: async ({ ctx, societyId, payload }) => {
    const organizationName = cleanText(payload.organizationName) || "Needs review";
    const seatKey = cleanText(payload.seatKey) || slugBody(organizationName) || "seat";
    const observations = arrayOf(payload.observations).length ? arrayOf(payload.observations) : [compactRecord({
      kind: cleanText(payload.kind) || "representative",
      personName: cleanText(payload.personName) || cleanText(payload.representativeName),
      termStart: cleanDate(payload.termStart),
      termEnd: cleanDate(payload.termEnd),
      seats: numberOrUndefined(payload.seats),
      observedAt: cleanDate(payload.sourceDate),
      sourceExternalIds: arrayOf(payload.sourceExternalIds),
    })].filter(Boolean);
    const existing = await ctx.db.query("organizationSeats").withIndex("by_seat", (q: any) => q.eq("societyId", societyId).eq("seatKey", seatKey)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { observations: [...arrayOf(existing.observations), ...observations] });
      return existing._id;
    }
    return await ctx.db.insert("organizationSeats", { societyId, seatKey, organizationName, observations, createdAtISO: new Date().toISOString() });
  },

  conflict: async ({ ctx, societyId, payload }) => {
    const name = cleanText(payload.personName) || cleanText(payload.directorName) || cleanText(payload.name);
    const links = await resolveRegisterPerson(ctx, societyId, name);
    const directory = await loadDirectoryIndex(ctx, societyId);
    const meeting = await resolveMeetingReference(ctx, societyId, meetingRefFrom(payload, "meeting"));
    let motionId: any;
    if (meeting && cleanText(payload.motionText)) {
      const wanted = String(payload.motionText).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
      const motions = await ctx.db.query("motions").withIndex("by_meeting", (q: any) => q.eq("primaryMeetingId", meeting.meetingId)).collect();
      const hits = motions.filter((row: any) => String(row.text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().startsWith(wanted));
      if (hits.length === 1) motionId = hits[0]._id;
    }
    return await ctx.db.insert("conflicts", compactRecord({
      societyId,
      directorId: links.directorId,
      personId: directoryPersonId(directory, name),
      personName: name,
      declaredAt: cleanDate(payload.declaredAt) || cleanDate(payload.meetingDate) || cleanDate(payload.sourceDate) || todayDate(),
      contractOrMatter: cleanText(payload.contractOrMatter) || cleanText(payload.matter) || "Needs review",
      natureOfInterest: cleanText(payload.natureOfInterest) || "Needs review",
      abstainedFromVote: optionalBoolean(payload.abstainedFromVote) ?? false,
      leftRoom: optionalBoolean(payload.leftRoom) ?? false,
      resolvedAt: cleanDate(payload.resolvedAt),
      notes: cleanText(payload.notes),
      meetingId: meeting?.meetingId,
      motionText: cleanText(payload.motionText),
      motionId,
    }));
  },

  proxy: async ({ ctx, societyId, payload }) => {
    const meeting = await resolveMeetingReference(ctx, societyId, meetingRefFrom(payload, "meeting"));
    if (!meeting) throw new Error("A proxy needs the meeting it was given for (meetingDate + body).");
    const grantor = await resolveRegisterPerson(ctx, societyId, payload.grantorName);
    const holder = await resolveRegisterPerson(ctx, societyId, payload.proxyHolderName);
    return await ctx.db.insert("proxies", compactRecord({
      societyId,
      meetingId: meeting.meetingId,
      grantorName: cleanText(payload.grantorName) || "Needs review",
      grantorMemberId: grantor.memberId,
      proxyHolderName: cleanText(payload.proxyHolderName) || "Needs review",
      proxyHolderMemberId: holder.memberId,
      instructions: cleanText(payload.instructions),
      signedAtISO: cleanDate(payload.signedAtISO) || cleanDate(payload.signedAt) || cleanDate(payload.sourceDate) || todayDate(),
      revokedAtISO: cleanDate(payload.revokedAtISO),
    }));
  },

  bylawRuleSet: async ({ ctx, societyId, payload, firstSourceDocumentId }) => {
    await requirePermissionPortable(ctx, societyId, "documents:write");
    const bodyQuorumRules = arrayOf(payload.bodyQuorumRules).map((row: any) => compactRecord({
      body: cleanText(row?.body),
      committeeName: cleanText(row?.committeeName),
      quorumType: cleanText(row?.quorumType),
      quorumValue: numberOrUndefined(row?.quorumValue),
      quorumMinimumCount: numberOrUndefined(row?.quorumMinimumCount),
      countBasis: cleanText(row?.countBasis),
      notes: cleanText(row?.notes),
    }));
    for (const row of bodyQuorumRules as any[]) {
      if (row?.body === "committee" && row.committeeName) {
        const key = inferMeetingBody(row.committeeName).committeeKey ?? slugBody(row.committeeName);
        const { committeeId } = await resolveImportCommittee(ctx, societyId, { type: "Committee", bodyKey: `committee:${key}`, committeeKey: key, committeeName: row.committeeName }, { create: false });
        if (committeeId) row.committeeId = committeeId;
      }
    }
    const issues = bodyQuorumRuleIssues(bodyQuorumRules);
    if (issues.length) throw new Error(`Bylaw rule set: ${issues.join("; ")}`);
    const rows = await ctx.db.query("bylawRuleSets").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const version = Math.max(0, ...rows.map((row: any) => Number(row.version) || 0)) + 1;
    const { societyId: _ignored, version: _v, status: _s, updatedAtISO: _u, ...defaults } = DEFAULT_BYLAW_RULES as any;
    const numeric = (key: string) => numberOrUndefined(payload[key]);
    const boolean = (key: string) => optionalBoolean(payload[key]);
    const overrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults)) {
      const next = typeof value === "number" ? numeric(key) : typeof value === "boolean" ? boolean(key) : cleanText(payload[key]);
      if (next !== undefined) overrides[key] = next;
    }
    // Imported rule sets are drafts: they never change the active rules
    // until a reviewer activates them in Bylaw rules.
    return await ctx.db.insert("bylawRuleSets", compactRecord({
      ...defaults,
      ...overrides,
      societyId,
      version,
      status: "Draft",
      effectiveFromISO: cleanDate(payload.effectiveFrom) || cleanDate(payload.effectiveFromISO),
      sourceBylawDocumentId: firstSourceDocumentId,
      bodyQuorumRules: bodyQuorumRules.length ? bodyQuorumRules : undefined,
      updatedAtISO: new Date().toISOString(),
    }));
  },

  operatingBudget: async ({ ctx, societyId, payload, sourceNote }) => {
    const lines = arrayOf(payload.lines).length ? arrayOf(payload.lines) : [payload];
    const fiscalYear = cleanText(payload.fiscalYear) || String(new Date().getUTCFullYear());
    let firstId: any;
    for (const line of lines) {
      const plannedCents = numberOrUndefined(line?.plannedCents ?? line?.amountCents);
      if (plannedCents == null) throw new Error("Budget lines need a planned amount in cents.");
      const id = await ctx.db.insert("budgets", compactRecord({
        societyId,
        fiscalYear: cleanText(line?.fiscalYear) || fiscalYear,
        category: cleanText(line?.category) || "Unclassified",
        plannedCents,
        programCode: cleanText(line?.programCode) || cleanText(payload.programCode),
        currency: cleanText(line?.currency) || cleanText(payload.currency) || "CAD",
        notes: [cleanText(line?.notes), sourceNote].filter(Boolean).join("\n") || undefined,
      }));
      firstId ??= id;
    }
    return firstId;
  },
};

async function resolveGrant(ctx: any, societyId: string, payload: any) {
  const title = cleanText(payload.grantTitle) || cleanText(payload.grant);
  if (!title) return undefined;
  const grants = await ctx.db.query("grants").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const key = title.toLowerCase();
  const hits = grants.filter((row: any) => String(row.title ?? "").toLowerCase() === key || String(row.program ?? "").toLowerCase() === key);
  return hits.length === 1 ? hits[0]._id : undefined;
}

/** Promotion blockers for the new kinds (checked before any write). */
export async function extraPromotionIssues(ctx: any, societyId: string, record: any): Promise<string[]> {
  const payload = record.payload ?? {};
  const issues: string[] = [];
  switch (record.recordKind) {
    case "committeeMember":
      if (!cleanText(payload.committeeName) && !cleanText(payload.committee)) issues.push("Name the committee this person sits on (committeeName).");
      break;
    case "grantReport":
      if (!(await resolveGrant(ctx, societyId, payload))) issues.push("Grant report must name exactly one existing grant (grantTitle).");
      break;
    case "meetingMaterial":
      if (!(await resolveMeetingReference(ctx, societyId, meetingRefFrom(payload, "meeting")))) issues.push("Meeting material must identify exactly one existing meeting (meetingDate + body).");
      if (!arrayOf(record.sourceExternalIds).length && !arrayOf(payload.sourceExternalIds).length) issues.push("Meeting material needs its source document.");
      break;
    case "proxy":
      if (!(await resolveMeetingReference(ctx, societyId, meetingRefFrom(payload, "meeting")))) issues.push("Proxy must identify exactly one existing meeting (meetingDate + body).");
      break;
    case "operatingBudget":
      for (const line of arrayOf(payload.lines).length ? arrayOf(payload.lines) : [payload]) {
        if (numberOrUndefined(line?.plannedCents ?? line?.amountCents) == null) { issues.push("Every budget line needs plannedCents."); break; }
      }
      break;
    case "bylawRuleSet": {
      const problems = bodyQuorumRuleIssues(arrayOf(payload.bodyQuorumRules).map((row: any) => ({ ...row, committeeId: undefined })));
      issues.push(...problems);
      break;
    }
  }
  return issues;
}

export const EXTRA_SECTION_KINDS = Object.keys(EXTRA_SECTION_RECORD_HANDLERS);
