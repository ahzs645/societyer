import {profile as personProfile} from "./personHistory";
import {filterDocumentLinkedRows} from "./documents";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { isMemberEvidenceDate, validMemberSourceUrl, MEMBER_HISTORY_KINDS, MEMBER_HISTORY_REVIEW_STATUSES } from "../memberHistory";

export interface MemberHistoryEvent {
  effectiveDate: string;
  endDate?: string;
  kind: string;
  title: string;
  details?: string;
  reviewStatus: string;
  sourceUrl?: string;
  sourceReference?: string;
  sourceExternalId?: string;
}

export async function list(ctx: PortableQueryCtx, { societyId, memberId }: { societyId: string; memberId: string }) {
  await requirePermissionPortable(ctx, societyId, "members:read");
  const member=await getOwned(ctx, "members", memberId, societyId);
  const rows = await ctx.db.query("memberHistoryEvents").withIndex("by_member", q => q.eq("societyId", societyId).eq("memberId", memberId)).collect();
  // Existing evidence remains in its own register and keeps its read permission.
  for (const [permission, table, dateField, kind] of [
    ["directors:read", "boardRoleAssignments", "startDate", "Role"],
    ["directors:read", "boardRoleChanges", "effectiveDate", "Role"],
    ["meetings:read", "meetingAttendanceRecords", "meetingDate", "Attendance"],
  ] as const) {
    try { await requirePermissionPortable(ctx, societyId, permission); }
    catch (error) {
      if (error instanceof Error && /^(Permission|Service scope) .* required\.$/.test(error.message)) continue;
      throw error;
    }
    const allEvidence = await ctx.db.query(table).withIndex("by_society", q => q.eq("societyId", societyId)).collect();
    const evidence=await filterDocumentLinkedRows(ctx,societyId,allEvidence);
    for (const row of evidence.filter(row => row.memberId === memberId || (member.directoryPersonId&&row.directoryPersonId===member.directoryPersonId&&row.identityReviewStatus==='verified') || (table === "boardRoleChanges" && row.previousMemberId === memberId))) {
      rows.push({
        _id: `${table}:${row._id}`, effectiveDate: row[dateField], endDate: row.endDate,
        kind, title: kind === "Attendance" ? `${row.meetingTitle}: ${row.attendanceStatus}` : [row.roleTitle, row.changeType || row.roleGroup].filter(Boolean).join(" — "),
        details: row.notes, reviewStatus: ["Verified", "Rejected"].includes(row.status) ? row.status : "Observed", createdAtISO: row.createdAtISO,
        sourceReference: row.sourceExternalIds?.length ? row.sourceExternalIds.join(", ") : row.sourceDocumentIds?.length ? row.sourceDocumentIds.join(", ") : "Existing evidence register; review source provenance",
        evidenceRegister: table,
        ...(row.meetingId?{href:`/app/meetings/${row.meetingId}?tab=minutes`}:{}),
      });
    }
  }
  if(member.directoryPersonId){
    const connected=await personProfile(ctx,{societyId,personId:member.directoryPersonId});
    for(const e of (connected.events??[]).filter((e:any)=>!e.derived))rows.push({...e,_id:`person:${e._id}`,kind:['role','affiliation','appointment','departure'].includes(e.kind)?'Role':e.kind==='note'?'Other':'Attendance',reviewStatus:e.reviewStatus==='verified'?'Verified':e.reviewStatus==='rejected'?'Rejected':'Observed',href:`/app/people-directory/${member.directoryPersonId}`,evidenceRegister:'personHistoryEvents',...(e.meetingId?{meetingHref:`/app/meetings/${e.meetingId}?tab=minutes`}:{})});
  }
  return rows.sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)) || String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
}

/** Append historical evidence without overwriting the current member register. */
export async function add(ctx: PortableMutationCtx, args: { societyId: string; memberId: string; event: MemberHistoryEvent }) {
  const actor = await requirePermissionPortable(ctx, args.societyId, "members:write");
  await getOwned(ctx, "members", args.memberId, args.societyId);
  const event = Object.fromEntries(Object.entries(args.event).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as unknown as MemberHistoryEvent;
  if (!isMemberEvidenceDate(event.effectiveDate)) throw new Error("Effective date must be YYYY, YYYY-MM, or a real YYYY-MM-DD date.");
  // Compare known periods at their shared precision; do not fabricate a day.
  if (event.endDate && (!isMemberEvidenceDate(event.endDate) || event.endDate.slice(0, Math.min(event.endDate.length, event.effectiveDate.length)) < event.effectiveDate.slice(0, Math.min(event.endDate.length, event.effectiveDate.length)))) throw new Error("End date must be a valid period on or after the effective date.");
  if (!(MEMBER_HISTORY_KINDS as readonly string[]).includes(event.kind)) throw new Error("Unsupported member history kind.");
  if (!(MEMBER_HISTORY_REVIEW_STATUSES as readonly string[]).includes(event.reviewStatus)) throw new Error("Unsupported review status.");
  if (!event.title || event.title.length > 500) throw new Error("Provide a history title of at most 500 characters.");
  if (!validMemberSourceUrl(event.sourceUrl)) throw new Error("Source URL must use HTTP or HTTPS.");
  if (!event.sourceUrl && !event.sourceReference && !event.sourceExternalId) throw new Error("Provide a source URL, citation, or external source ID.");
  const rows = await ctx.db.query("memberHistoryEvents").withIndex("by_member", q => q.eq("societyId", args.societyId).eq("memberId", args.memberId)).collect();
  // Re-importing the same evidence is safe; a conflicting external event ID must be reviewed.
  const same = (row: any) => ["effectiveDate", "endDate", "kind", "title", "details", "reviewStatus", "sourceUrl", "sourceReference", "sourceExternalId"].every(key => (row[key] || "") === ((event as any)[key] || ""));
  const duplicate = rows.find(same);
  if (duplicate) return { id: duplicate._id, duplicate: true };
  if (event.sourceExternalId && rows.some(row => row.sourceExternalId === event.sourceExternalId)) throw new Error("This external event ID already exists with different values; review it before importing.");
  const id = await ctx.db.insert("memberHistoryEvents", {
    societyId: args.societyId, memberId: args.memberId,
    effectiveDate: event.effectiveDate, endDate: event.endDate || undefined,
    kind: event.kind, title: event.title, details: event.details || undefined,
    reviewStatus: event.reviewStatus, sourceUrl: event.sourceUrl || undefined,
    sourceReference: event.sourceReference || undefined, sourceExternalId: event.sourceExternalId || undefined,
    createdAtISO: new Date().toISOString(), createdByUserId: actor._id,
  });
  return { id, duplicate: false };
}
