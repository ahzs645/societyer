import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  buildQuorumSnapshot,
  getBylawRuleSetForDate,
} from "./lib/bylawRules";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("meetings")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const get = query({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    remoteUrl: v.optional(v.string()),
    remoteMeetingId: v.optional(v.string()),
    remotePasscode: v.optional(v.string()),
    remoteInstructions: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    meetingTemplateId: v.optional(v.id("meetingTemplates")),
    sourceReviewStatus: v.optional(v.string()),
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    packageReviewStatus: v.optional(v.string()),
    packageReviewNotes: v.optional(v.string()),
    packageReviewedAtISO: v.optional(v.string()),
    packageReviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rules = await getBylawRuleSetForDate(
      ctx,
      args.societyId,
      args.scheduledAt,
    );
    if (args.electronic && !rules.allowElectronicMeetings) {
      throw new Error(
        "Electronic participation is disabled by the bylaw rule set effective for this meeting date.",
      );
    }

    const snapshot = await buildQuorumSnapshot(ctx, {
      societyId: args.societyId,
      meetingDateISO: args.scheduledAt,
      meetingType: args.type,
      quorumRequiredOverride: args.quorumRequired,
    });

    const template = args.meetingTemplateId
      ? await ctx.db.get(args.meetingTemplateId)
      : null;
    if (args.meetingTemplateId && !template) {
      throw new Error("Meeting template not found.");
    }
    if (template && template.societyId !== args.societyId) {
      throw new Error("Meeting template belongs to a different society.");
    }
    const templateItems = template ? normalizeTemplateItems(template.items) : [];
    const templateContext = template
      ? await buildTemplateContext(ctx, args.societyId, args.scheduledAt)
      : {};
    const templateMotions = template
      ? await buildTemplateMotions(ctx, templateItems, templateContext)
      : [];
    const agendaJson =
      args.agendaJson ??
      (templateItems.length
        ? JSON.stringify(templateItems.map(({ title, depth }) => ({ title: resolveTemplateText(title, templateContext), depth })))
        : undefined);
    const templateSnapshotJson = template
      ? JSON.stringify({
          templateId: template._id,
          name: template.name,
          description: template.description,
          meetingType: template.meetingType,
          items: templateItems,
          capturedAtISO: new Date().toISOString(),
        })
      : undefined;

    const meetingId = await ctx.db.insert("meetings", {
      ...args,
      agendaJson,
      templateSnapshotJson,
      bylawRuleSetId: args.bylawRuleSetId ?? snapshot.bylawRuleSetId,
      quorumRuleVersion: args.quorumRuleVersion ?? snapshot.quorumRuleVersion,
      quorumRuleEffectiveFromISO:
        args.quorumRuleEffectiveFromISO ??
        snapshot.quorumRuleEffectiveFromISO,
      quorumSourceLabel: args.quorumSourceLabel ?? snapshot.quorumSourceLabel,
      quorumRequired: args.quorumRequired ?? snapshot.quorumRequired,
      quorumComputedAtISO:
        args.quorumComputedAtISO ?? snapshot.quorumComputedAtISO,
    });
    if (templateItems.length > 0 || args.agendaJson) {
      const agendaId = await ctx.db.insert("agendas", {
        societyId: args.societyId,
        meetingId,
        title: `${args.title} agenda`,
        status: "Draft",
        createdAtISO: new Date().toISOString(),
        updatedAtISO: new Date().toISOString(),
      });
      const initialAgendaItems = templateItems.length
        ? templateItems.map((item) => ({
            title: resolveTemplateText(item.title, templateContext),
            depth: item.depth,
            type: item.sectionType ?? inferAgendaSectionType(item.title),
            details: item.details ? resolveTemplateText(item.details, templateContext) : undefined,
            presenter: item.presenter || undefined,
            motionTemplateId: item.motionTemplateId,
            motionText: item.motionText ? resolveTemplateText(item.motionText, templateContext) : undefined,
          }))
        : normalizeAgendaJsonItems(args.agendaJson);
      for (let order = 0; order < initialAgendaItems.length; order++) {
        const item = initialAgendaItems[order];
        await ctx.db.insert("agendaItems", {
          societyId: args.societyId,
          agendaId,
          order,
          type: item.type ?? inferAgendaSectionType(item.title),
          title: item.title,
          depth: item.depth,
          details: item.details,
          presenter: item.presenter,
          motionTemplateId: item.motionTemplateId,
          motionText: item.motionText,
          createdAtISO: new Date().toISOString(),
        });
      }
    }
    if (template && templateItems.length > 0) {
      const attendees = Array.isArray(args.attendeeIds) ? args.attendeeIds.map(String) : [];
      const quorumRequired = args.quorumRequired ?? snapshot.quorumRequired;
      const minutesId = await ctx.db.insert("minutes", {
        societyId: args.societyId,
        meetingId,
        heldAt: args.scheduledAt,
        attendees,
        absent: [],
        quorumMet: quorumRequired == null ? false : attendees.length >= quorumRequired,
        quorumRequired: quorumRequired ?? undefined,
        bylawRuleSetId: args.bylawRuleSetId ?? snapshot.bylawRuleSetId,
        quorumRuleVersion: args.quorumRuleVersion ?? snapshot.quorumRuleVersion,
        quorumRuleEffectiveFromISO:
          args.quorumRuleEffectiveFromISO ??
          snapshot.quorumRuleEffectiveFromISO,
        quorumSourceLabel: args.quorumSourceLabel ?? snapshot.quorumSourceLabel,
        quorumComputedAtISO:
          args.quorumComputedAtISO ?? snapshot.quorumComputedAtISO,
        discussion: "",
        sections: templateItems.map((item) => ({
          title: resolveTemplateText(item.title, templateContext),
          type: item.sectionType ?? inferAgendaSectionType(item.title),
          presenter: item.presenter || undefined,
          discussion: item.details ? resolveTemplateText(item.details, templateContext) : "",
          decisions: [],
          actionItems: [],
          depth: item.depth,
        })),
        motions: templateMotions,
        decisions: [],
        actionItems: [],
      });
      await ctx.db.patch(meetingId, { minutesId });
    }
    return meetingId;
  },
});

export const update = mutation({
  args: {
    id: v.id("meetings"),
    patch: v.object({
      type: v.optional(v.string()),
      title: v.optional(v.string()),
      scheduledAt: v.optional(v.string()),
      location: v.optional(v.string()),
      electronic: v.optional(v.boolean()),
      remoteUrl: v.optional(v.string()),
      remoteMeetingId: v.optional(v.string()),
      remotePasscode: v.optional(v.string()),
      remoteInstructions: v.optional(v.string()),
      noticeSentAt: v.optional(v.string()),
      quorumRequired: v.optional(v.number()),
      bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
      quorumRuleVersion: v.optional(v.number()),
      quorumRuleEffectiveFromISO: v.optional(v.string()),
      quorumSourceLabel: v.optional(v.string()),
      quorumComputedAtISO: v.optional(v.string()),
      status: v.optional(v.string()),
      attendeeIds: v.optional(v.array(v.string())),
      agendaJson: v.optional(v.string()),
      meetingTemplateId: v.optional(v.id("meetingTemplates")),
      templateSnapshotJson: v.optional(v.string()),
      minutesId: v.optional(v.id("minutes")),
      sourceReviewStatus: v.optional(v.string()),
      sourceReviewNotes: v.optional(v.string()),
      sourceReviewedAtISO: v.optional(v.string()),
      sourceReviewedByUserId: v.optional(v.id("users")),
      packageReviewStatus: v.optional(v.string()),
      packageReviewNotes: v.optional(v.string()),
      packageReviewedAtISO: v.optional(v.string()),
      packageReviewedByUserId: v.optional(v.id("users")),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

type TemplateItem = {
  title: string;
  depth: 0 | 1;
  sectionType?: string;
  presenter?: string;
  details?: string;
  motionTemplateId?: any;
  motionText?: string;
};

function normalizeTemplateItems(items: any[]): TemplateItem[] {
  const normalized: TemplateItem[] = [];
  let hasRoot = false;
  for (const item of items ?? []) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;
    const depth: 0 | 1 = item?.depth === 1 && hasRoot ? 1 : 0;
    normalized.push({
      title,
      depth,
      sectionType: item?.sectionType || undefined,
      presenter: item?.presenter || undefined,
      details: item?.details || undefined,
      motionTemplateId: item?.motionTemplateId,
      motionText: item?.motionText || undefined,
    });
    if (depth === 0) hasRoot = true;
  }
  return normalized;
}

function normalizeAgendaJsonItems(agendaJson?: string) {
  if (!agendaJson) return [];
  try {
    const parsed = JSON.parse(agendaJson);
    const values = Array.isArray(parsed) ? parsed : [];
    const items: Array<{ title: string; depth: 0 | 1; type?: string; details?: string; presenter?: string; motionTemplateId?: any; motionText?: string }> = [];
    let hasRoot = false;
    for (const value of values) {
      const title = typeof value === "string" ? value.trim() : String(value?.title ?? "").trim();
      if (!title) continue;
      const depth: 0 | 1 = typeof value === "object" && value?.depth === 1 && hasRoot ? 1 : 0;
      items.push({
        title,
        depth,
        type: typeof value === "object" ? value?.type ?? value?.sectionType : undefined,
        details: typeof value === "object" ? value?.details : undefined,
        presenter: typeof value === "object" ? value?.presenter : undefined,
        motionTemplateId: typeof value === "object" ? value?.motionTemplateId : undefined,
        motionText: typeof value === "object" ? value?.motionText : undefined,
      });
      if (depth === 0) hasRoot = true;
    }
    return items;
  } catch {
    return [];
  }
}

async function buildTemplateMotions(ctx: any, items: TemplateItem[], templateContext: Record<string, string>) {
  const motions: any[] = [];
  const now = new Date().toISOString();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    let text = item.motionText;
    let resolutionType = "Ordinary";
    if (item.motionTemplateId) {
      const template = await ctx.db.get(item.motionTemplateId);
      if (template) {
        text = text || template.body;
        resolutionType = template.requiresSpecialResolution ? "Special" : "Ordinary";
        await ctx.db.patch(template._id, {
          usageCount: (template.usageCount ?? 0) + 1,
          updatedAtISO: now,
        });
      }
    }
    text = resolveTemplateText(text, templateContext);
    if (!text?.trim()) continue;
    motions.push({
      text: text.trim(),
      outcome: "Pending",
      resolutionType,
      sectionIndex: index,
      sectionTitle: item.title,
    });
  }
  return motions;
}

async function buildTemplateContext(ctx: any, societyId: any, scheduledAt: string) {
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_society_date", (q: any) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
  const previous = meetings.find((meeting: any) => {
    if (meeting.status === "Cancelled") return false;
    if (!meeting.scheduledAt || meeting.scheduledAt >= scheduledAt) return false;
    return true;
  });
  return {
    previousMeetingTitle: previous?.title ?? "previous meeting",
    previousMeetingDate: previous?.scheduledAt ? formatLongDate(previous.scheduledAt) : "the previous meeting date",
    calledToOrderTime: "[time]",
    adjournedAt: "[time]",
  };
}

function resolveTemplateText(value: string | undefined, context: Record<string, string>) {
  if (!value) return "";
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => context[key] ?? "");
}

function formatLongDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Vancouver",
  });
}

function inferAgendaSectionType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve") || lower.includes("adjourn")) return "motion";
  if (lower.includes("report") || lower.includes("financial statement")) return "report";
  if (lower.includes("decision") || lower.includes("resolution")) return "decision";
  return "discussion";
}

export const markSourceReview = mutation({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, notes, actingUserId }) => {
    const meeting = await ctx.db.get(id);
    if (!meeting) throw new Error("Meeting not found.");
    const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
    if (actor && actor.societyId !== meeting.societyId) {
      throw new Error("Reviewer is not part of this society.");
    }
    const now = new Date().toISOString();
    const patch: any = {
      sourceReviewStatus: status,
      sourceReviewNotes: notes || undefined,
    };
    if (status === "source_reviewed") {
      patch.sourceReviewedAtISO = now;
      patch.sourceReviewedByUserId = actingUserId;
    }
    await ctx.db.patch(id, patch);

    const minutes = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", id))
      .first();
    if (minutes) {
      await ctx.db.patch(minutes._id, {
        sourceReviewStatus: status,
        sourceReviewNotes: notes || undefined,
        sourceReviewedAtISO: status === "source_reviewed" ? now : undefined,
        sourceReviewedByUserId: status === "source_reviewed" ? actingUserId : undefined,
      });
    }

    await ctx.db.insert("activity", {
      societyId: meeting.societyId,
      actor: actor?.displayName ?? "You",
      entityType: "meeting",
      entityId: id,
      action: "source-review",
      summary: `Marked source review ${status.replace(/_/g, " ")} for ${meeting.title}`,
      createdAtISO: now,
    });
  },
});

export const setPackageReviewStatus = mutation({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, notes, actingUserId }) => {
    const meeting = await ctx.db.get(id);
    if (!meeting) throw new Error("Meeting not found.");
    const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
    if (actor && actor.societyId !== meeting.societyId) {
      throw new Error("Reviewer is not part of this society.");
    }
    const now = new Date().toISOString();
    const patch: any = {
      packageReviewStatus: status,
      packageReviewNotes: notes || undefined,
    };
    if (status === "ready" || status === "released") {
      patch.packageReviewedAtISO = now;
      patch.packageReviewedByUserId = actingUserId;
    }
    await ctx.db.patch(id, patch);
    await ctx.db.insert("activity", {
      societyId: meeting.societyId,
      actor: actor?.displayName ?? "You",
      entityType: "meeting",
      entityId: id,
      action: "package-review",
      summary: `Marked board package ${status.replace(/_/g, " ")} for ${meeting.title}`,
      createdAtISO: now,
    });
  },
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const meeting = await ctx.db.get(id);
    if (!meeting) return null;
    const snapshot = await buildQuorumSnapshot(ctx, {
      societyId: meeting.societyId,
      meetingDateISO: meeting.scheduledAt,
      meetingType: meeting.type,
      quorumRequiredOverride: meeting.quorumRequired,
    });
    const patch: any = {};
    if (meeting.quorumRequired == null && snapshot.quorumRequired != null) {
      patch.quorumRequired = snapshot.quorumRequired;
    }
    if (!meeting.bylawRuleSetId && snapshot.bylawRuleSetId) {
      patch.bylawRuleSetId = snapshot.bylawRuleSetId;
    }
    if (meeting.quorumRuleVersion == null && snapshot.quorumRuleVersion != null) {
      patch.quorumRuleVersion = snapshot.quorumRuleVersion;
    }
    if (!meeting.quorumRuleEffectiveFromISO && snapshot.quorumRuleEffectiveFromISO) {
      patch.quorumRuleEffectiveFromISO = snapshot.quorumRuleEffectiveFromISO;
    }
    if (!meeting.quorumSourceLabel) {
      patch.quorumSourceLabel = snapshot.quorumSourceLabel;
    }
    if (!meeting.quorumComputedAtISO) {
      patch.quorumComputedAtISO = snapshot.quorumComputedAtISO;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }
    return { patched: Object.keys(patch) };
  },
});

export const remove = mutation({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
