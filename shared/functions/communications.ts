/**
 * PORTABLE FUNCTIONS: the communications read/write domain (templates,
 * campaigns, deliveries, member prefs, segments).
 *
 * Only the pure `ctx.db` handlers live here. The send surface
 * (`sendCampaign` / `sendMeetingNotice` / `ensureDefaultTemplates`) talks to
 * email/sms providers and `ctx.runQuery`/`ctx.runMutation`, so it stays on
 * Convex.
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listTemplatesPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("communicationTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getTemplatePortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function listCampaignsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  return ctx.db
    .query("communicationCampaigns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 50);
}

export async function listDeliveriesPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    campaignId,
    meetingId,
    limit,
  }: { societyId: string; campaignId?: string; meetingId?: string; limit?: number },
) {
  let rows = await ctx.db
    .query("communicationDeliveries")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 200);
  if (campaignId) rows = rows.filter((row) => row.campaignId === campaignId);
  if (meetingId) rows = rows.filter((row) => row.meetingId === meetingId);
  return rows;
}

export async function listMemberPrefsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("memberCommunicationPrefs")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function listSegmentsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("communicationSegments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function upsertTemplatePortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    slug: string;
    kind: string;
    channel: string;
    audience: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    system: boolean;
  },
) {
  const { id, ...rest } = args;
  const payload = { ...rest, updatedAtISO: new Date().toISOString() };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("communicationTemplates", payload);
}

export async function upsertSegmentPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    description?: string;
    includeAudience: string;
    memberStatus?: string;
    membershipClass?: string;
    votingRightsOnly?: boolean;
    hasEmail?: boolean;
    hasPhone?: boolean;
    volunteerStatus?: string;
  },
) {
  const { id, ...rest } = args;
  const payload = { ...rest, updatedAtISO: new Date().toISOString() };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("communicationSegments", payload);
}

export async function removeSegmentPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

export async function upsertMemberPrefPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    memberId: string;
    email?: string;
    phone?: string;
    postalAddress?: string;
    transactionalEmailEnabled: boolean;
    noticeEmailEnabled: boolean;
    newsletterEmailEnabled: boolean;
    smsEnabled: boolean;
    mailEnabled?: boolean;
    preferredChannel: string;
    newsletterConsentAtISO?: string;
    smsConsentAtISO?: string;
    unsubscribedAtISO?: string;
    unsubscribeReason?: string;
  },
) {
  const existing = await ctx.db
    .query("memberCommunicationPrefs")
    .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
    .collect();
  const existingRow = existing[0] ?? null;
  const nowISO = new Date().toISOString();
  const payload = {
    ...args,
    mailEnabled: args.mailEnabled ?? existingRow?.mailEnabled ?? !!args.postalAddress,
    newsletterConsentAtISO:
      args.newsletterConsentAtISO ??
      (args.newsletterEmailEnabled
        ? existingRow?.newsletterConsentAtISO ?? nowISO
        : undefined),
    smsConsentAtISO:
      args.smsConsentAtISO ??
      (args.smsEnabled ? existingRow?.smsConsentAtISO ?? nowISO : undefined),
    updatedAtISO: nowISO,
  };
  if (existingRow) {
    await ctx.db.patch(existingRow._id, payload);
    return existingRow._id;
  }
  return await ctx.db.insert("memberCommunicationPrefs", payload);
}

export async function markDeliveryOpenedPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const delivery = await ctx.db.get(id);
  const alreadyOpened = delivery?.status === "opened";
  await ctx.db.patch(id, {
    status: "opened",
    openedAtISO: new Date().toISOString(),
  });
  // Roll the open up to the parent campaign so the campaign-level open rate is
  // not stuck at 0. Only count the first open of each delivery.
  if (delivery?.campaignId && !alreadyOpened) {
    const campaign = await ctx.db.get(delivery.campaignId);
    if (campaign) {
      await ctx.db.patch(delivery.campaignId, {
        openedCount: (campaign.openedCount ?? 0) + 1,
      });
    }
  }
}
