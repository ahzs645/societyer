import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  runForMeeting as runForMeetingPortable,
  agmInit,
  agmMarkStep,
  logNoticeDelivery as logNoticeDeliveryPortable,
  noticeDeliveries as noticeDeliveriesPortable,
  queueNoticeToAllVotingMembers as queueNoticeToAllVotingMembersPortable,
} from "../shared/functions/agm";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const runForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => runForMeetingPortable(toPortableQueryCtx(ctx), args),
});

export const init = mutation({
  args: { societyId: v.id("societies"), meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => agmInit(toPortableMutationCtx(ctx), args),
});

export const markStep = mutation({
  args: {
    id: v.id("agmRuns"),
    step: v.string(),
    patch: v.optional(
      v.object({
        noticeSentAt: v.optional(v.string()),
        noticeRecipientCount: v.optional(v.number()),
        quorumCheckedAtISO: v.optional(v.string()),
        financialsPresentedAt: v.optional(v.string()),
        electionsCompletedAt: v.optional(v.string()),
        minutesApprovedAt: v.optional(v.string()),
        annualReportFiledAt: v.optional(v.string()),
        annualReportFilingId: v.optional(v.id("filings")),
      }),
    ),
  },
  returns: v.any(),
  handler: (ctx, args) => agmMarkStep(toPortableMutationCtx(ctx), args),
});

export const logNoticeDelivery = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    channel: v.string(),
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    status: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => logNoticeDeliveryPortable(toPortableMutationCtx(ctx), args),
});

export const noticeDeliveries = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => noticeDeliveriesPortable(toPortableQueryCtx(ctx), args),
});

/** Bulk-create notice delivery records for all voting members.
 *  There is no email-sending integration wired here, so email notices are
 *  recorded as "queued" with NO proof-of-notice rather than a fabricated
 *  "sent" — proof of notice is legally meaningful for an AGM and must reflect
 *  an actual delivery. Mail / in-person notices are human-actioned (the
 *  secretary confirmed sending via that channel), so they are recorded as
 *  delivered with a manual proof string. */
export const queueNoticeToAllVotingMembers = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    channel: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => queueNoticeToAllVotingMembersPortable(toPortableMutationCtx(ctx), args),
});
