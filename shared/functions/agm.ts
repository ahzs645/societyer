/**
 * PORTABLE FUNCTIONS: the AGM domain
 * (runForMeeting / init / markStep / logNoticeDelivery / noticeDeliveries /
 * queueNoticeToAllVotingMembers).
 *
 * Reads/writes `agmRuns`, `noticeDeliveries`, and `members` over `ctx.db`. Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function runForMeeting(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
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
  return ctx.db.insert("noticeDeliveries", {
    ...args,
    sentAtISO: new Date().toISOString(),
  });
}

export async function noticeDeliveries(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  return ctx.db
    .query("noticeDeliveries")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

/** Bulk-create notice delivery records for all voting members.
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
  const members = await ctx.db
    .query("members")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const voting = members.filter((m) => m.votingRights && m.status === "Active");
  const now = new Date().toISOString();
  const isEmail = channel === "email";
  for (const m of voting) {
    await ctx.db.insert("noticeDeliveries", {
      societyId,
      meetingId,
      campaignId: undefined,
      recipientName: `${m.firstName} ${m.lastName}`,
      recipientEmail: m.email,
      memberId: m._id,
      channel,
      provider: isEmail ? "pending" : "manual",
      subject: undefined,
      sentAtISO: now,
      // No fabricated proof for un-dispatched email notices.
      proofOfNotice: isEmail ? undefined : `manual:${channel}:${now}`,
      status: isEmail ? "queued" : "sent",
    });
  }
  return {
    queued: isEmail ? voting.length : 0,
    recorded: isEmail ? 0 : voting.length,
    channel,
  };
}
