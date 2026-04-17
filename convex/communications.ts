// @ts-nocheck
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { sendEmail } from "./providers/email";
import { sendSms } from "./providers/sms";
import { requireEnabledModule } from "./lib/moduleSettings";

const DEFAULT_TEMPLATE_SLUGS = [
  {
    slug: "agm-notice",
    name: "AGM notice",
    kind: "notice",
    channel: "email",
    audience: "voting_members",
    subject: "{{societyName}} AGM notice — {{meetingTitle}} on {{meetingDate}}",
    bodyText:
      "Hello {{memberName}},\n\nThis is formal notice of {{societyName}}'s meeting: {{meetingTitle}}.\nDate: {{meetingDate}}\nLocation: {{meetingLocation}}\n\nIf electronic participation is allowed, the joining details must be included in the notice package.\n\nMember portal: {{portalUrl}}",
  },
  {
    slug: "renewal-reminder",
    name: "Renewal reminder",
    kind: "renewal",
    channel: "email",
    audience: "all_members",
    subject: "{{societyName}} membership renewal reminder",
    bodyText:
      "Hello {{memberName}},\n\nThis is a reminder that your membership or subscription with {{societyName}} may need attention. Please review the member portal and your billing details.\n\nPortal: {{portalUrl}}",
  },
  {
    slug: "member-newsletter",
    name: "Member newsletter",
    kind: "newsletter",
    channel: "email",
    audience: "all_members",
    subject: "{{societyName}} member update",
    bodyText:
      "Hello {{memberName}},\n\n{{customMessage}}\n\nPortal: {{portalUrl}}",
  },
];

type Audience =
  | "all_members"
  | "voting_members"
  | "directors"
  | "overdue_subscribers"
  | "volunteers"
  | `segment:${string}`
  | `committee:${string}`
  | `member_class:${string}`
  | `member_status:${string}`;

type Recipient = {
  memberId?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  role?: string;
};

function roleRank(role?: string | null) {
  switch (role) {
    case "Owner":
      return 5;
    case "Admin":
      return 4;
    case "Director":
      return 3;
    case "Member":
      return 2;
    default:
      return 1;
  }
}

async function assertCampaignRole(ctx: any, actingUserId?: string) {
  if (!actingUserId) return;
  const actor = await ctx.runQuery(api.users.get, { id: actingUserId as any });
  if (!actor || roleRank(actor.role) < roleRank("Director")) {
    throw new Error("Only directors or admins can send society communications.");
  }
}

function mergeRecipients(rows: Recipient[]) {
  const deduped = new Map<string, Recipient>();
  for (const row of rows) {
    const key =
      row.memberId ||
      row.email?.trim().toLowerCase() ||
      `${row.name.trim().toLowerCase()}:${row.role ?? ""}`;
    if (!key) continue;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  return [...deduped.values()];
}

function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return vars[key] ?? "";
  });
}

function defaultPortalUrl() {
  const base = (globalThis as any)?.process?.env?.APP_BASE_URL ?? "http://localhost:5173";
  return `${base.replace(/\/$/, "")}/#/portal`;
}

function defaultMemberPrefs(member: any) {
  return {
    email: member.email,
    phone: member.phone,
    postalAddress: member.address,
    transactionalEmailEnabled: true,
    noticeEmailEnabled: true,
    newsletterEmailEnabled: false,
    smsEnabled: false,
    mailEnabled: !!member.address,
    preferredChannel: "email",
  };
}

function canSendEmail(kind: string, pref: any) {
  if (kind === "newsletter") return !!pref.newsletterEmailEnabled;
  if (kind === "notice") return !!pref.noticeEmailEnabled;
  return !!pref.transactionalEmailEnabled;
}

function channelKind(channel?: string) {
  return (channel ?? "").toLowerCase();
}

function isPostalChannel(channel?: string) {
  return ["mail", "postal", "manual", "post"].includes(channelKind(channel));
}

async function resolveAudienceRecipients(
  ctx: any,
  args: { societyId: string; audience: Audience },
): Promise<Recipient[]> {
  const [members, directors, subscriptions, volunteers, committees] = await Promise.all([
    ctx.runQuery(api.members.list, { societyId: args.societyId as any }),
    ctx.runQuery(api.directors.list, { societyId: args.societyId as any }),
    ctx.runQuery(api.subscriptions.allSubscriptions, { societyId: args.societyId as any }),
    ctx.runQuery(api.volunteers.list, { societyId: args.societyId as any }),
    ctx.runQuery(api.committees.list, { societyId: args.societyId as any }),
  ]);

  if (args.audience === "directors") {
    return mergeRecipients(
      (directors ?? [])
        .filter((director: any) => director.status === "Active")
        .map((director: any) => ({
          memberId: director.memberId,
          name: `${director.firstName} ${director.lastName}`,
          email: director.email,
          role: director.position,
        })),
    );
  }

  if (args.audience === "overdue_subscribers") {
    return mergeRecipients(
      (subscriptions ?? [])
        .filter((subscription: any) =>
          ["pending", "past_due"].includes(subscription.status),
        )
        .map((subscription: any) => ({
          memberId: subscription.memberId,
          name: subscription.fullName,
          email: subscription.email,
        })),
    );
  }

  if (args.audience === "volunteers") {
    return mergeRecipients(
      (volunteers ?? []).map((volunteer: any) => ({
        memberId: volunteer.memberId,
        name: `${volunteer.firstName} ${volunteer.lastName}`,
        email: volunteer.email,
        phone: volunteer.phone,
        role: volunteer.roleWanted ?? "Volunteer",
      })),
    );
  }

  if (args.audience.startsWith("segment:")) {
    const segmentId = args.audience.slice("segment:".length).trim();
    if (!segmentId) return [];
    const segment = await ctx.db.get(segmentId as any);
    if (!segment) return [];
    const baseAudience =
      segment.includeAudience === "custom"
        ? ("all_members" as Audience)
        : (segment.includeAudience as Audience);
    const baseRecipients = await resolveAudienceRecipients(ctx, {
      societyId: args.societyId,
      audience: baseAudience,
    });
    const membersById = new Map(
      (members ?? []).map((member: any) => [String(member._id), member]),
    );
    const volunteersByMemberId = new Map(
      (volunteers ?? [])
        .filter((volunteer: any) => volunteer.memberId)
        .map((volunteer: any) => [String(volunteer.memberId), volunteer]),
    );
    return mergeRecipients(
      baseRecipients.filter((recipient) => {
        const member = recipient.memberId
          ? membersById.get(String(recipient.memberId))
          : null;
        const volunteer = recipient.memberId
          ? volunteersByMemberId.get(String(recipient.memberId))
          : null;
        if (segment.memberStatus && String(member?.status ?? "") !== segment.memberStatus) {
          return false;
        }
        if (
          segment.membershipClass &&
          String(member?.membershipClass ?? "") !== segment.membershipClass
        ) {
          return false;
        }
        if (segment.votingRightsOnly && !member?.votingRights) return false;
        if (segment.hasEmail && !recipient.email) return false;
        if (segment.hasPhone && !recipient.phone) return false;
        if (
          segment.volunteerStatus &&
          String(volunteer?.status ?? "") !== segment.volunteerStatus
        ) {
          return false;
        }
        return true;
      }),
    );
  }

  if (args.audience.startsWith("committee:")) {
    const committeeId = args.audience.slice("committee:".length).trim();
    if (!committeeId) return [];
    const committee = (committees ?? []).find((row: any) => String(row._id) === committeeId);
    if (!committee) return [];
    const detail = await ctx.runQuery(api.committees.detail, {
      id: committeeId as any,
    });
    return mergeRecipients(
      (detail?.members ?? []).map((member: any) => ({
        memberId: member.memberId,
        name: member.name ?? "Committee member",
        email: member.email,
        role: member.role,
      })),
    );
  }

  const activeMembers = (members ?? []).filter((member: any) => member.status === "Active");
  let filtered = activeMembers;
  if (args.audience === "voting_members") {
    filtered = filtered.filter((member: any) => member.votingRights);
  } else if (args.audience.startsWith("member_class:")) {
    const className = args.audience.slice("member_class:".length).trim();
    filtered = filtered.filter((member: any) => String(member.membershipClass ?? "") === className);
  } else if (args.audience.startsWith("member_status:")) {
    const status = args.audience.slice("member_status:".length).trim();
    filtered = (members ?? []).filter((member: any) => String(member.status ?? "") === status);
  }

  return mergeRecipients(
    filtered.map((member: any) => ({
      memberId: member._id,
      name: `${member.firstName} ${member.lastName}`,
      email: member.email,
      phone: member.phone,
      address: member.address,
      role: member.membershipClass,
    })),
  );
}

export const listTemplates = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("communicationTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const getTemplate = query({
  args: { id: v.id("communicationTemplates") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const listCampaigns = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("communicationCampaigns")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 50),
});

export const listDeliveries = query({
  args: {
    societyId: v.id("societies"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    meetingId: v.optional(v.id("meetings")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, campaignId, meetingId, limit }) => {
    let rows = await ctx.db
      .query("communicationDeliveries")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 200);
    if (campaignId) rows = rows.filter((row) => row.campaignId === campaignId);
    if (meetingId) rows = rows.filter((row) => row.meetingId === meetingId);
    return rows;
  },
});

export const listMemberPrefs = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("memberCommunicationPrefs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const listSegments = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("communicationSegments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const upsertTemplate = mutation({
  args: {
    id: v.optional(v.id("communicationTemplates")),
    societyId: v.id("societies"),
    name: v.string(),
    slug: v.string(),
    kind: v.string(),
    channel: v.string(),
    audience: v.string(),
    subject: v.string(),
    bodyText: v.string(),
    bodyHtml: v.optional(v.string()),
    system: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const payload = { ...rest, updatedAtISO: new Date().toISOString() };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("communicationTemplates", payload);
  },
});

export const upsertSegment = mutation({
  args: {
    id: v.optional(v.id("communicationSegments")),
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    includeAudience: v.string(),
    memberStatus: v.optional(v.string()),
    membershipClass: v.optional(v.string()),
    votingRightsOnly: v.optional(v.boolean()),
    hasEmail: v.optional(v.boolean()),
    hasPhone: v.optional(v.boolean()),
    volunteerStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const payload = { ...rest, updatedAtISO: new Date().toISOString() };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("communicationSegments", payload);
  },
});

export const removeSegment = mutation({
  args: { id: v.id("communicationSegments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const ensureDefaultTemplates = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const existing = await ctx.db
      .query("communicationTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    let created = 0;
    for (const template of DEFAULT_TEMPLATE_SLUGS) {
      const match = existing.find((row) => row.slug === template.slug);
      if (match) continue;
      await ctx.db.insert("communicationTemplates", {
        societyId,
        ...template,
        bodyHtml: undefined,
        system: true,
        updatedAtISO: new Date().toISOString(),
      });
      created += 1;
    }
    return { created };
  },
});

export const upsertMemberPref = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    transactionalEmailEnabled: v.boolean(),
    noticeEmailEnabled: v.boolean(),
    newsletterEmailEnabled: v.boolean(),
    smsEnabled: v.boolean(),
    mailEnabled: v.optional(v.boolean()),
    preferredChannel: v.string(),
    newsletterConsentAtISO: v.optional(v.string()),
    smsConsentAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
    unsubscribeReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
  },
});

export const _createCampaign = internalMutation({
  args: {
    societyId: v.id("societies"),
    templateId: v.optional(v.id("communicationTemplates")),
    segmentId: v.optional(v.id("communicationSegments")),
    meetingId: v.optional(v.id("meetings")),
    kind: v.string(),
    channel: v.string(),
    audience: v.string(),
    customAudienceLabel: v.optional(v.string()),
    subject: v.string(),
    bodyText: v.string(),
    status: v.string(),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("communicationCampaigns", {
      ...args,
      memberCount: 0,
      deliveredCount: 0,
      openedCount: 0,
      bouncedCount: 0,
      createdAtISO: new Date().toISOString(),
    }),
});

export const _completeCampaign = internalMutation({
  args: {
    id: v.id("communicationCampaigns"),
    status: v.string(),
    memberCount: v.number(),
    deliveredCount: v.number(),
    openedCount: v.number(),
    bouncedCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      memberCount: args.memberCount,
      deliveredCount: args.deliveredCount,
      openedCount: args.openedCount,
      bouncedCount: args.bouncedCount,
      sentAtISO: new Date().toISOString(),
    });
  },
});

export const _recordDelivery = internalMutation({
  args: {
    societyId: v.id("societies"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    templateId: v.optional(v.id("communicationTemplates")),
    meetingId: v.optional(v.id("meetings")),
    memberId: v.optional(v.id("members")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    channel: v.string(),
    provider: v.string(),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.string(),
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    providerEventType: v.optional(v.string()),
    providerPayload: v.optional(v.string()),
    openedAtISO: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("communicationDeliveries", {
      ...args,
      sentAtISO: new Date().toISOString(),
    }),
});

export const markDeliveryOpened = mutation({
  args: { id: v.id("communicationDeliveries") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, {
      status: "opened",
      openedAtISO: new Date().toISOString(),
    });
  },
});

export const markDeliveryBounced = mutation({
  args: { id: v.id("communicationDeliveries"), errorMessage: v.optional(v.string()) },
  handler: async (ctx, { id, errorMessage }) => {
    await ctx.db.patch(id, {
      status: "bounced",
      bouncedAtISO: new Date().toISOString(),
      errorMessage,
    });
  },
});

async function recordManualDelivery(
  ctx: any,
  args: {
    societyId: string;
    campaignId: string;
    templateId?: string;
    meetingId?: string;
    memberId?: string;
    recipient: Recipient;
    channel: string;
    subject: string;
    bodyText: string;
    provider: string;
    status?: string;
    proofOfNotice?: string;
    errorMessage?: string;
  },
) {
  await ctx.runMutation(internal.communications._recordDelivery, {
    societyId: args.societyId as any,
    campaignId: args.campaignId as any,
    templateId: args.templateId as any,
    meetingId: args.meetingId as any,
    memberId: args.memberId as any,
    recipientName: args.recipient.name,
    recipientEmail: args.recipient.email,
    recipientPhone: args.recipient.phone,
    recipientAddress: args.recipient.address,
    channel: args.channel,
    provider: args.provider,
    subject: args.subject,
    status: args.status ?? "sent",
    proofOfNotice: args.proofOfNotice,
    errorMessage: args.errorMessage,
  });
}

async function sendCampaignInternal(
  ctx: any,
  args: {
    societyId: string;
    templateId?: string;
    meetingId?: string;
    actingUserId?: string;
    audience: Audience;
    kind: string;
    channel: string;
    subject?: string;
    bodyText?: string;
    customMessage?: string;
  },
) {
  await assertCampaignRole(ctx, args.actingUserId);

  const [societies, template, meeting, prefs, users] = await Promise.all([
    ctx.runQuery(api.society.list, {}),
    args.templateId
      ? ctx.runQuery(api.communications.getTemplate, { id: args.templateId as any })
      : null,
    args.meetingId
      ? ctx.runQuery(api.meetings.get, { id: args.meetingId as any })
      : null,
    ctx.runQuery(api.communications.listMemberPrefs, { societyId: args.societyId as any }),
    ctx.runQuery(api.users.list, { societyId: args.societyId as any }),
  ]);

  const society = (societies ?? []).find((row: any) => row._id === args.societyId);
  if (!society) throw new Error("Society not found.");

  const recipients = await resolveAudienceRecipients(ctx, {
    societyId: args.societyId,
    audience: args.audience,
  });
  const prefByMemberId = new Map(
    (prefs ?? []).map((pref: any) => [String(pref.memberId), pref]),
  );
  const userByMemberId = new Map<string, any>(
    (users ?? [])
      .filter((user: any) => user.memberId)
      .map((user: any) => [String(user.memberId), user]),
  );

  const subjectTemplate = args.subject ?? template?.subject ?? "";
  const bodyTemplate = args.bodyText ?? template?.bodyText ?? "";
  const normalizedChannel = channelKind(args.channel ?? template?.channel ?? "email");
  const campaignChannel = normalizedChannel === "inapp" ? "inApp" : normalizedChannel;
  const segmentId = args.audience.startsWith("segment:")
    ? args.audience.slice("segment:".length).trim()
    : undefined;
  const segment = segmentId ? await ctx.db.get(segmentId as any) : null;

  const campaignId = await ctx.runMutation(internal.communications._createCampaign, {
    societyId: args.societyId,
    templateId: args.templateId as any,
    segmentId: segment?._id as any,
    meetingId: args.meetingId as any,
    kind: args.kind ?? template?.kind ?? "general",
    channel: campaignChannel,
    audience: args.audience,
    customAudienceLabel: segment?.name,
    subject: subjectTemplate,
    bodyText: bodyTemplate,
    status: "sending",
    createdByUserId: args.actingUserId as any,
  });

  let deliveredCount = 0;
  let openedCount = 0;
  let bouncedCount = 0;

  for (const recipient of recipients) {
    const storedPref = recipient.memberId ? prefByMemberId.get(String(recipient.memberId)) : null;
    const pref: any = storedPref ?? defaultMemberPrefs(recipient);
    if (!storedPref && !recipient.memberId) {
      pref.transactionalEmailEnabled = true;
      pref.noticeEmailEnabled = true;
      pref.smsEnabled = !!recipient.phone;
    }
    const resolvedRecipient = {
      ...recipient,
      address: recipient.address ?? pref.postalAddress,
    };
    const vars = {
      memberName: resolvedRecipient.name,
      societyName: society.name,
      meetingTitle: meeting?.title,
      meetingDate: meeting?.scheduledAt ? meeting.scheduledAt.slice(0, 10) : undefined,
      meetingLocation: meeting?.location ?? (meeting?.electronic ? "Electronic / hybrid meeting" : ""),
      portalUrl: defaultPortalUrl(),
      customMessage: args.customMessage ?? "",
    };
    const subject = renderTemplate(subjectTemplate, vars).trim();
    const bodyText = renderTemplate(bodyTemplate, vars).trim();

    if (normalizedChannel === "inapp") {
      const user = recipient.memberId ? userByMemberId.get(String(recipient.memberId)) : null;
      await recordManualDelivery(ctx, {
        societyId: args.societyId,
        campaignId,
        templateId: args.templateId as any,
        meetingId: args.meetingId as any,
        memberId: recipient.memberId as any,
        recipient: resolvedRecipient,
        channel: "inApp",
        subject,
        bodyText,
        provider: "in-app",
        proofOfNotice: `in-app:${new Date().toISOString()}`,
      });
      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        userId: user?._id,
        kind: args.kind,
        severity: "info",
        title: subject,
        body: bodyText,
        linkHref: args.meetingId ? `/meetings/${args.meetingId}/agm` : "/notifications",
      });
      deliveredCount += 1;
      continue;
    }

    if (isPostalChannel(normalizedChannel)) {
      const hasAddress = !!resolvedRecipient.address?.trim() && pref.mailEnabled !== false;
      await recordManualDelivery(ctx, {
        societyId: args.societyId,
        campaignId,
        templateId: args.templateId as any,
        meetingId: args.meetingId as any,
        memberId: recipient.memberId as any,
        recipient: resolvedRecipient,
        channel: campaignChannel,
        subject,
        bodyText,
        provider: normalizedChannel === "postal" ? "postal" : "manual",
        status: hasAddress ? "sent" : "skipped",
        proofOfNotice: hasAddress ? `${normalizedChannel}:${new Date().toISOString()}` : undefined,
        errorMessage: hasAddress
          ? undefined
          : pref.mailEnabled === false
            ? "Member communication preferences suppress postal mail."
            : "Recipient has no mailing address.",
      });
      if (hasAddress) deliveredCount += 1;
      continue;
    }

    if (normalizedChannel === "sms") {
      if (!recipient.phone) {
        await recordManualDelivery(ctx, {
          societyId: args.societyId,
          campaignId,
          templateId: args.templateId as any,
          meetingId: args.meetingId as any,
          memberId: recipient.memberId as any,
          recipient: resolvedRecipient,
          channel: "sms",
          subject,
          bodyText,
          provider: "policy",
          status: "skipped",
          errorMessage: "Recipient has no phone number.",
        });
        continue;
      }

      if (!pref.smsEnabled) {
        await recordManualDelivery(ctx, {
          societyId: args.societyId,
          campaignId,
          templateId: args.templateId as any,
          meetingId: args.meetingId as any,
          memberId: recipient.memberId as any,
          recipient: resolvedRecipient,
          channel: "sms",
          subject,
          bodyText,
          provider: "policy",
          status: "skipped",
          errorMessage: "Member communication preferences suppress SMS.",
        });
        continue;
      }

      try {
        const sent = await sendSms({
          to: recipient.phone,
          body: bodyText,
          tag: args.kind,
        });
        await recordManualDelivery(ctx, {
          societyId: args.societyId,
          campaignId,
          templateId: args.templateId as any,
          meetingId: args.meetingId as any,
          memberId: recipient.memberId as any,
          recipient: resolvedRecipient,
          channel: "sms",
          subject,
          bodyText,
          provider: sent.provider,
          status: "sent",
          proofOfNotice: `${sent.provider}:${sent.id}:${sent.sentAtISO}`,
        });
        deliveredCount += 1;
      } catch (error: any) {
        await recordManualDelivery(ctx, {
          societyId: args.societyId,
          campaignId,
          templateId: args.templateId as any,
          meetingId: args.meetingId as any,
          memberId: recipient.memberId as any,
          recipient: resolvedRecipient,
          channel: "sms",
          subject,
          bodyText,
          provider: "twilio",
          status: "failed",
          errorMessage: error?.message ?? "SMS send failed.",
        });
        bouncedCount += 1;
      }
      continue;
    }

    if (!recipient.email) {
      await recordManualDelivery(ctx, {
        societyId: args.societyId,
        campaignId,
        templateId: args.templateId as any,
        meetingId: args.meetingId as any,
        memberId: recipient.memberId as any,
        recipient: resolvedRecipient,
        channel: campaignChannel,
        subject,
        bodyText,
        provider: "manual",
        status: "skipped",
        errorMessage: "Recipient has no email address.",
      });
      continue;
    }

    if (!canSendEmail(args.kind, pref)) {
      await recordManualDelivery(ctx, {
        societyId: args.societyId,
        campaignId,
        templateId: args.templateId as any,
        meetingId: args.meetingId as any,
        memberId: recipient.memberId as any,
        recipient: resolvedRecipient,
        channel: campaignChannel,
        subject,
        bodyText,
        provider: "policy",
        status: "skipped",
        errorMessage: "Member communication preferences suppress this message type.",
      });
      continue;
    }

    try {
      const sent = await sendEmail({
        to: recipient.email,
        subject,
        text: bodyText,
        tag: args.kind,
      });
      await recordManualDelivery(ctx, {
        societyId: args.societyId,
        campaignId,
        templateId: args.templateId as any,
        meetingId: args.meetingId as any,
        memberId: recipient.memberId as any,
        recipient: resolvedRecipient,
        channel: campaignChannel,
        subject,
        bodyText,
        provider: sent.provider,
        status: "sent",
        proofOfNotice: `${sent.provider}:${sent.id}:${sent.sentAtISO}`,
      });
      if (args.meetingId) {
        await ctx.runMutation(api.agm.logNoticeDelivery, {
          societyId: args.societyId,
          meetingId: args.meetingId as any,
          campaignId,
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          memberId: recipient.memberId as any,
          channel: campaignChannel,
          provider: sent.provider,
          providerMessageId: sent.id,
          subject,
          proofOfNotice: `${sent.provider}:${sent.id}:${sent.sentAtISO}`,
          status: "sent",
        });
      }
      deliveredCount += 1;
    } catch (error: any) {
      await recordManualDelivery(ctx, {
        societyId: args.societyId,
        campaignId,
        templateId: args.templateId as any,
        meetingId: args.meetingId as any,
        memberId: recipient.memberId as any,
        recipient: resolvedRecipient,
        channel: campaignChannel,
        subject,
        bodyText,
        provider: "resend",
        status: "failed",
        errorMessage: error?.message ?? "Email send failed.",
      });
      if (args.meetingId) {
        await ctx.runMutation(api.agm.logNoticeDelivery, {
          societyId: args.societyId,
          meetingId: args.meetingId as any,
          campaignId,
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          memberId: recipient.memberId as any,
          channel: campaignChannel,
          provider: "resend",
          subject,
          errorMessage: error?.message ?? "Email send failed.",
          status: "failed",
        });
      }
      bouncedCount += 1;
    }
  }

  const finalStatus =
    deliveredCount === 0
      ? "failed"
      : bouncedCount > 0
      ? "partial"
      : "sent";

  await ctx.runMutation(internal.communications._completeCampaign, {
    id: campaignId,
    status: finalStatus,
    memberCount: recipients.length,
    deliveredCount,
    openedCount,
    bouncedCount,
  });

  await ctx.runMutation(api.notifications.create, {
    societyId: args.societyId,
    kind: "general",
    severity: bouncedCount > 0 ? "warn" : "success",
    title: `Communication sent: ${subjectTemplate}`,
    body:
      bouncedCount > 0
        ? `${deliveredCount} sent, ${bouncedCount} failed or bounced.`
        : `${deliveredCount} delivery${deliveredCount === 1 ? "" : "ies"} recorded.`,
    linkHref: "/communications",
  });

  return {
    campaignId,
    recipients: recipients.length,
    deliveredCount,
    openedCount,
    bouncedCount,
    status: finalStatus,
  };
}

export const sendCampaign = action({
  args: {
    societyId: v.id("societies"),
    templateId: v.optional(v.id("communicationTemplates")),
    audience: v.string(),
    kind: v.string(),
    channel: v.string(),
    subject: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    customMessage: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireEnabledModule(ctx, args.societyId, "communications");
    return sendCampaignInternal(ctx, {
      societyId: args.societyId as any,
      templateId: args.templateId as any,
      actingUserId: args.actingUserId as any,
      audience: args.audience as Audience,
      kind: args.kind,
      channel: args.channel,
      subject: args.subject,
      bodyText: args.bodyText,
      customMessage: args.customMessage,
    });
  },
});

export const sendMeetingNotice = action({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    channel: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireEnabledModule(ctx, args.societyId, "communications");
    const templates = await ctx.runQuery(api.communications.listTemplates, {
      societyId: args.societyId,
    });
    const template = templates.find((row: any) => row.slug === "agm-notice");
    return sendCampaignInternal(ctx, {
      societyId: args.societyId as any,
      meetingId: args.meetingId as any,
      templateId: template?._id as any,
      actingUserId: args.actingUserId as any,
      audience: "voting_members",
      kind: template?.kind ?? "notice",
      channel: args.channel,
      subject: template?.subject,
      bodyText: template?.bodyText,
    });
  },
});
