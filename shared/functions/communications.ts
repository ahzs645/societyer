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
import { getOwned, requireSocietyMembership } from "./access";

export async function listTemplatesPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("communicationTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getTemplatePortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "communicationTemplates");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("communicationTemplates not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  return getOwned(ctx, "communicationTemplates", id, candidate.societyId);
}

export async function listCampaignsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, societyId);
  if (campaignId) await getOwned(ctx, "communicationCampaigns", campaignId, societyId);
  if (meetingId) await getOwned(ctx, "meetings", meetingId, societyId);
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
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("memberCommunicationPrefs")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function listSegmentsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  const { id, ...rest } = args;
  const payload = { ...rest, updatedAtISO: new Date().toISOString() };
  if (id) {
    await getOwned(ctx, "communicationTemplates", id, args.societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  const { id, ...rest } = args;
  const payload = { ...rest, updatedAtISO: new Date().toISOString() };
  if (id) {
    await getOwned(ctx, "communicationSegments", id, args.societyId);
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("communicationSegments", payload);
}

export async function removeSegmentPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "communicationSegments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("communicationSegments not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "communicationSegments", id, candidate.societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "members", args.memberId, args.societyId);
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

export async function markDeliveryBouncedPortable(
  ctx: PortableMutationCtx,
  { id, errorMessage }: { id: string; errorMessage?: string },
) {
  const candidate = await ctx.db.get(id, "communicationDeliveries");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("communicationDeliveries not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "communicationDeliveries", id, candidate.societyId);
  await ctx.db.patch(id, {
    status: "bounced",
    bouncedAtISO: new Date().toISOString(),
    errorMessage,
  });
}

export async function markDeliveryOpenedPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "communicationDeliveries");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("communicationDeliveries not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const delivery = await getOwned(ctx, "communicationDeliveries", id, candidate.societyId);
  const alreadyOpened = delivery?.status === "opened";
  await ctx.db.patch(id, {
    status: "opened",
    openedAtISO: new Date().toISOString(),
  });
  // Roll the open up to the parent campaign so the campaign-level open rate is
  // not stuck at 0. Only count the first open of each delivery.
  if (delivery?.campaignId && !alreadyOpened) {
    const campaign = await getOwned(ctx, "communicationCampaigns", String(delivery.campaignId), candidate.societyId);
    await ctx.db.patch(String(delivery.campaignId), {
      openedCount: (campaign.openedCount ?? 0) + 1,
    });
  }
}
