import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const runForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { meetingId }) => {
    const rows = await ctx.db
      .query("agmRuns")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return rows[0] ?? null;
  },
});

export const init = mutation({
  args: { societyId: v.id("societies"), meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
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
  handler: async (ctx, { id, step, patch }) => {
    await ctx.db.patch(id, {
      step,
      ...(patch ?? {}),
      updatedAtISO: new Date().toISOString(),
    });
  },
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
  handler: async (ctx, args) =>
    ctx.db.insert("noticeDeliveries", {
      ...args,
      sentAtISO: new Date().toISOString(),
    }),
});

export const noticeDeliveries = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { meetingId }) =>
    ctx.db
      .query("noticeDeliveries")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
});

/** Bulk-queue notice deliveries for all voting members — demo stub. */
export const queueNoticeToAllVotingMembers = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    channel: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, meetingId, channel }) => {
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const voting = members.filter((m) => m.votingRights && m.status === "Active");
    const now = new Date().toISOString();
    for (const m of voting) {
      await ctx.db.insert("noticeDeliveries", {
        societyId,
        meetingId,
        campaignId: undefined,
        recipientName: `${m.firstName} ${m.lastName}`,
        recipientEmail: m.email,
        memberId: m._id,
        channel,
        provider: channel === "email" ? "demo" : "manual",
        subject: undefined,
        sentAtISO: now,
        proofOfNotice: channel === "email" ? `demo:queued:${now}` : `${channel}:${now}`,
        status: "sent",
      });
    }
    return { queued: voting.length };
  },
});
