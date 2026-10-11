/**
 * PORTABLE FUNCTIONS: the AGM domain
 * (runForMeeting / init / markStep / logNoticeDelivery / noticeDeliveries /
 * noticeCoverage / queueNoticeToAllVotingMembers).
 *
 * Reads/writes `agmRuns`, `noticeDeliveries`, and `members` over `ctx.db`; for a
 * corporation, notice audiences come from the share register and shareholder
 * role holders instead (shared/meetingNoticeAudience.ts). Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { organizationRuleScope } from "../entityRuleScope";
import {
  meetingNoticeCoverage,
  votingMemberNoticeRecipients,
  votingShareholderNoticeAudience,
  auditorNoticeRecipients,
  type NoticeRecipient,
} from "../meetingNoticeAudience";
import { readableRoleHolderTypes } from "./roleHolderReadAccess";
import { requirePermissionPortable, type Permission } from "./permissions";

/** Meeting access does not grant the director or auditor registers. */
async function canRead(ctx: PortableQueryCtx, societyId: string, permission: Permission) {
  try {
    await requirePermissionPortable(ctx, societyId, permission);
    return true;
  } catch (error) {
    if (error instanceof Error && [`Permission ${permission} required.`, `Service scope ${permission} required.`].includes(error.message)) return false;
    throw error;
  }
}

type RegisterAccess = { directors: boolean; auditors: boolean; roleType: (roleType: unknown) => boolean };
async function registerAccess(ctx: PortableQueryCtx, societyId: string): Promise<RegisterAccess> {
  const [roleType, auditors] = await Promise.all([readableRoleHolderTypes(ctx, societyId), canRead(ctx, societyId, "auditors:read")]);
  return { directors: roleType("director"), auditors, roleType };
}

/**
 * Voting shareholders from the share register / shareholder role holders, plus
 * directors and the auditor. Director and auditor rows are included only for a
 * caller who can read those registers (directors:read, auditors:read).
 */
async function shareholderNoticeAudience(ctx: PortableQueryCtx, societyId: string, access: RegisterAccess) {
  const [classes, holdings, roleHolders, directors, auditors, organization] = await Promise.all([
    ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("rightsHoldings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    access.directors ? ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : Promise.resolve([]),
    access.auditors ? ctx.db.query("auditorAppointments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : Promise.resolve([]),
    ctx.db.get(societyId, "societies"),
  ]);
  return votingShareholderNoticeAudience({
    classes, holdings, roleHolders: roleHolders.filter((row) => access.roleType(row.roleType)), directors, auditors, organization,
  });
}

function restrictedAudienceNote(access: RegisterAccess, corporation: boolean) {
  const hidden = [corporation && !access.directors ? "directors" : "", !access.auditors ? "the auditor" : ""].filter(Boolean);
  return hidden.length ? `Coverage excludes ${hidden.join(" and ")} because this account cannot read ${hidden.length > 1 ? "those registers" : "that register"}; it is incomplete.` : "";
}

/** Delivery rows name their recipient, so director and auditor rows follow those registers' read permissions. */
async function visibleDeliveries(ctx: PortableQueryCtx, societyId: string, rows: Record<string, any>[], access: RegisterAccess) {
  if (access.directors && access.auditors) return rows;
  const roleHolders = rows.some((row) => row.roleHolderId)
    ? await ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : [];
  const roleType = new Map(roleHolders.map((row) => [String(row._id), row.roleType]));
  return rows.filter((row) => {
    const key = String(row.recipientKey ?? "");
    if (!access.directors && (row.directorId || key.startsWith("director:"))) return false;
    if (!access.auditors && (row.auditorAppointmentId || key.startsWith("auditor:"))) return false;
    if (row.roleHolderId && !access.roleType(roleType.get(String(row.roleHolderId)))) return false;
    return true;
  });
}

/**
 * The "Notice coverage" summary for an annual meeting: voting members for a
 * society (unchanged), voting shareholders for a corporation.
 */
export async function noticeCoverage(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const meeting = await requireOwnedRow(ctx, "meetings", meetingId);
  const societyId = String(meeting.societyId);
  const [society, deliveries, runs] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    ctx.db.query("noticeDeliveries").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect(),
    ctx.db.query("agmRuns").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect(),
  ]);
  const corporation = organizationRuleScope(society).isCorporation;
  const access = await registerAccess(ctx, societyId);
  const coverage = meetingNoticeCoverage({
    organization: society,
    members: corporation
      ? []
      : await ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    shareholders: corporation ? await shareholderNoticeAudience(ctx, societyId, access) : null,
    additionalRecipients: corporation || !access.auditors ? [] : auditorNoticeRecipients(await ctx.db.query("auditorAppointments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()),
    deliveries: await visibleDeliveries(ctx, societyId, deliveries, access),
    recordedRecipientCount: runs[0]?.noticeRecipientCount,
  });
  const note = restrictedAudienceNote(access, corporation);
  return note ? { ...coverage, detail: `${coverage.detail}; ${note}`, tone: "warn" as const, restricted: true } : coverage;
}

export async function runForMeeting(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  await requireOwnedRow(ctx, "meetings", meetingId);
  const rows = await ctx.db
    .query("agmRuns")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return rows[0] ?? null;
}

export async function agmInit(
  ctx: PortableMutationCtx,
  args: { societyId: string; meetingId: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const existing = await ctx.db
    .query("agmRuns")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  if (existing[0]) return existing[0]._id;
  return ctx.db.insert("agmRuns", {
    ...args,
    step: "notice",
    updatedAtISO: new Date().toISOString(),
  });
}

export async function agmMarkStep(
  ctx: PortableMutationCtx,
  { id, step, patch }: {
    id: string;
    step: string;
    patch?: {
      noticeSentAt?: string;
      noticeRecipientCount?: number;
      quorumCheckedAtISO?: string;
      financialsPresentedAt?: string;
      electionsCompletedAt?: string;
      minutesApprovedAt?: string;
      annualReportFiledAt?: string;
      annualReportFilingId?: string;
    };
  },
): Promise<void> {
  const authorizedRow = await requireOwnedRow(ctx, "agmRuns", id);
  const societyId = String(authorizedRow.societyId);
  if (patch?.annualReportFilingId) {
    await getOwned(ctx, "filings", patch.annualReportFilingId, societyId);
  }
  await ctx.db.patch(id, {
    step,
    ...(patch ?? {}),
    updatedAtISO: new Date().toISOString(),
  });
}

export async function logNoticeDelivery(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    campaignId?: string;
    recipientName: string;
    recipientEmail?: string;
    memberId?: string;
    recipientKey?: string;
    roleHolderId?: string;
    directorId?: string;
    auditorAppointmentId?: string;
    channel: string;
    provider?: string;
    providerMessageId?: string;
    subject?: string;
    proofOfNotice?: string;
    errorMessage?: string;
    bouncedAtISO?: string;
    status: string;
  },
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  if (args.campaignId) {
    await getOwned(ctx, "communicationCampaigns", args.campaignId, args.societyId);
  }
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  if (args.roleHolderId) await getOwned(ctx, "roleHolders", args.roleHolderId, args.societyId);
  if (args.directorId) await getOwned(ctx, "directors", args.directorId, args.societyId);
  if (args.auditorAppointmentId) await getOwned(ctx, "auditorAppointments", args.auditorAppointmentId, args.societyId);
  const validKeys = [args.memberId && `member:${args.memberId}`, args.roleHolderId && `roleHolder:${args.roleHolderId}`, args.directorId && `director:${args.directorId}`, args.auditorAppointmentId && `auditor:${args.auditorAppointmentId}`].filter(Boolean);
  if (args.recipientKey && !validKeys.includes(args.recipientKey)) throw new Error("The notice recipient key must match its verified register identity.");
  return ctx.db.insert("noticeDeliveries", {
    ...args,
    sentAtISO: new Date().toISOString(),
  });
}

export async function noticeDeliveries(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const meeting = await requireOwnedRow(ctx, "meetings", meetingId);
  const societyId = String(meeting.societyId);
  const rows = await ctx.db
    .query("noticeDeliveries")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return visibleDeliveries(ctx, societyId, rows, await registerAccess(ctx, societyId));
}

/** Bulk-create notice delivery records for all voting members (voting
 *  shareholders for a corporation).
 *  There is no email-sending integration wired here, so email notices are
 *  recorded as "queued" with NO proof-of-notice rather than a fabricated
 *  "sent" — proof of notice is legally meaningful for an AGM and must reflect
 *  an actual delivery. Mail / in-person notices are human-actioned (the
 *  secretary confirmed sending via that channel), so they are recorded as
 *  delivered with a manual proof string. */
export async function queueNoticeToAllVotingMembers(
  ctx: PortableMutationCtx,
  { societyId, meetingId, channel }: { societyId: string; meetingId: string; channel: string },
) {
  await requireSocietyMembership(ctx, societyId);
  await getOwned(ctx, "meetings", meetingId, societyId);
  const society = await ctx.db.get(societyId, "societies");
  const corporation = organizationRuleScope(society).isCorporation;
  const auditorRows = await ctx.db.query("auditorAppointments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  // A notice must reach every director and the auditor. The sender must be able to read those
  // registers, rather than silently sending an incomplete notice or reading names it cannot see.
  if (corporation) await requirePermissionPortable(ctx, societyId, "directors:read");
  if (auditorNoticeRecipients(auditorRows).length) await requirePermissionPortable(ctx, societyId, "auditors:read");
  const access = await registerAccess(ctx, societyId);
  const voting: NoticeRecipient[] = corporation
    ? (await shareholderNoticeAudience(ctx, societyId, access)).recipients
    : votingMemberNoticeRecipients(
      await ctx.db
        .query("members")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    );
  if (!corporation) voting.push(...auditorNoticeRecipients(auditorRows));
  if (!["email", "mail", "in-person"].includes(channel)) throw new Error("Choose email, mail or in-person notice.");
  const now = new Date().toISOString();
  const isEmail = channel === "email";
  for (const m of voting) {
    await ctx.db.insert("noticeDeliveries", {
      societyId,
      meetingId,
      campaignId: undefined,
      recipientName: m.name,
      recipientEmail: m.email,
      memberId: m.memberId,
      recipientKey: m.recipientKey,
      roleHolderId: m.roleHolderId,
      directorId: m.directorId,
      auditorAppointmentId: m.auditorAppointmentId,
      channel,
      provider: isEmail ? "pending" : "manual",
      subject: undefined,
      sentAtISO: now,
      // No fabricated proof for un-dispatched email notices.
      proofOfNotice: isEmail ? undefined : `manual:${channel}:${now}`,
      status: isEmail ? (m.email ? "queued" : "skipped") : "sent",
      errorMessage: isEmail && !m.email ? "No email address; arrange notice by another lawful method." : undefined,
    });
  }
  return {
    queued: isEmail ? voting.filter((row) => row.email).length : 0,
    missingEmail: isEmail ? voting.filter((row) => !row.email).length : 0,
    recorded: isEmail ? 0 : voting.length,
    channel,
  };
}
