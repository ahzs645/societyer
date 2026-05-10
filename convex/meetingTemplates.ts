import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";

const templateItem = v.object({
  title: v.string(),
  depth: v.optional(v.union(v.literal(0), v.literal(1))),
  sectionType: v.optional(v.string()),
  presenter: v.optional(v.string()),
  motionTemplateId: v.optional(v.id("motionTemplates")),
  motionText: v.optional(v.string()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("meetingTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    rows.sort((a, b) => {
      if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return rows;
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    items: v.array(templateItem),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    if (args.isDefault) await clearDefault(ctx, args.societyId);
    return await ctx.db.insert("meetingTemplates", {
      societyId: args.societyId,
      name: args.name,
      description: args.description,
      meetingType: args.meetingType,
      isDefault: args.isDefault ?? false,
      items: cleanItems(args.items),
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    templateId: v.id("meetingTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    items: v.optional(v.array(templateItem)),
  },
  returns: v.any(),
  handler: async (ctx, { templateId, ...patch }) => {
    const existing = await ctx.db.get(templateId);
    if (!existing) throw new Error("Meeting template not found.");
    if (patch.isDefault) await clearDefault(ctx, existing.societyId, templateId);
    const clean: Record<string, unknown> = { updatedAtISO: new Date().toISOString() };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      clean[key] = key === "items" ? cleanItems(value as any[]) : value;
    }
    await ctx.db.patch(templateId, clean);
    return templateId;
  },
});

export const remove = mutation({
  args: { templateId: v.id("meetingTemplates") },
  returns: v.any(),
  handler: async (ctx, { templateId }) => {
    const existing = await ctx.db.get(templateId);
    if (!existing) return null;
    await ctx.db.delete(templateId);
    return templateId;
  },
});

export const duplicate = mutation({
  args: { templateId: v.id("meetingTemplates"), name: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { templateId, name }) => {
    const existing = await ctx.db.get(templateId);
    if (!existing) throw new Error("Meeting template not found.");
    const now = new Date().toISOString();
    return await ctx.db.insert("meetingTemplates", {
      societyId: existing.societyId,
      name: name || `${existing.name} copy`,
      description: existing.description,
      meetingType: existing.meetingType,
      isDefault: false,
      items: existing.items,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const createFromMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
    name: v.string(),
    description: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { meetingId, name, description, isDefault }) => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) throw new Error("Meeting not found.");
    const minutes = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .first();
    const motions = minutes?.motions ?? [];
    const items = parseAgenda(meeting.agendaJson).map((entry, index) => {
      const motion = motions.find((candidate: any) => candidate.sectionIndex === index);
      return {
        title: entry.title,
        depth: entry.depth,
        sectionType: minutes?.sections?.[index]?.type,
        presenter: minutes?.sections?.[index]?.presenter,
        motionText: motion?.text,
      };
    });
    if (items.length === 0) throw new Error("Meeting does not have agenda items to save.");
    if (isDefault) await clearDefault(ctx, meeting.societyId);
    const now = new Date().toISOString();
    return await ctx.db.insert("meetingTemplates", {
      societyId: meeting.societyId,
      name,
      description,
      meetingType: meeting.type,
      isDefault: isDefault ?? false,
      items: cleanItems(items),
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const seedDefaults = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const existing = await ctx.db
      .query("meetingTemplates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (existing.length > 0) return { inserted: 0, existing: existing.length };
    const now = new Date().toISOString();
    await ctx.db.insert("meetingTemplates", {
      societyId,
      name: "Regular board meeting",
      description: "Baseline recurring board agenda with standard procedural motions.",
      meetingType: "Board",
      isDefault: true,
      items: [
        { title: "Welcome and call to order", depth: 0, sectionType: "discussion" },
        { title: "Indigenous acknowledgement", depth: 0, sectionType: "discussion" },
        {
          title: "Adopt agenda",
          depth: 0,
          sectionType: "motion",
          motionText: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented.",
        },
        {
          title: "Adopt previous minutes",
          depth: 0,
          sectionType: "motion",
          motionText: "BE IT RESOLVED THAT the minutes of the previous meeting, as circulated, be approved.",
        },
        { title: "Reports", depth: 0, sectionType: "report" },
        { title: "Chair report", depth: 1, sectionType: "report" },
        { title: "Treasurer report", depth: 1, sectionType: "report" },
        { title: "New business", depth: 0, sectionType: "discussion" },
        {
          title: "Adjournment",
          depth: 0,
          sectionType: "motion",
          motionText: "BE IT RESOLVED THAT the meeting be adjourned.",
        },
      ],
      createdAtISO: now,
      updatedAtISO: now,
    });
    return { inserted: 1, existing: 0 };
  },
});

async function clearDefault(ctx: any, societyId: string, exceptId?: string) {
  const existing = await ctx.db
    .query("meetingTemplates")
    .withIndex("by_society_default", (q: any) => q.eq("societyId", societyId).eq("isDefault", true))
    .collect();
  for (const template of existing) {
    if (String(template._id) !== String(exceptId)) {
      await ctx.db.patch(template._id, { isDefault: false, updatedAtISO: new Date().toISOString() });
    }
  }
}

function cleanItems(items: any[]) {
  const cleaned: any[] = [];
  let hasRoot = false;
  for (const item of items ?? []) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;
    const depth = item?.depth === 1 && hasRoot ? 1 : 0;
    cleaned.push({
      title,
      depth,
      sectionType: item?.sectionType || undefined,
      presenter: item?.presenter || undefined,
      motionTemplateId: item?.motionTemplateId || undefined,
      motionText: item?.motionText || undefined,
    });
    if (depth === 0) hasRoot = true;
  }
  return cleaned;
}

function parseAgenda(raw: string | undefined) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return { title: entry.trim(), depth: 0 as const };
        return {
          title: String(entry?.title ?? "").trim(),
          depth: entry?.depth === 1 ? 1 as const : 0 as const,
        };
      })
      .filter((entry) => entry.title);
  } catch {
    return raw
      .split(/\r?\n/)
      .map((title) => ({ title: title.trim(), depth: 0 as const }))
      .filter((entry) => entry.title);
  }
}
