/**
 * PORTABLE FUNCTIONS: the meeting-templates domain
 * (list / create / update / remove / duplicate / createFromMeeting).
 *
 * Reads/writes the `meetingTemplates` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function seedDefaultsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
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
      {
        title: "Indigenous acknowledgement",
        depth: 0,
        sectionType: "discussion",
        details: "Acknowledgement that the meeting is taking place on the unceded and ancestral territory of the Lheidli T'enneh, part of the Dakelh (Carrier) First Nations.",
      },
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
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("meetingTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  rows.sort((a: any, b: any) => {
    if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    name: string;
    description?: string;
    meetingType?: string;
    isDefault?: boolean;
    items: any[];
  },
) {
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
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { templateId, ...patch }: {
    templateId: string;
    name?: string;
    description?: string;
    meetingType?: string;
    isDefault?: boolean;
    items?: any[];
  },
) {
  const existing = await ctx.db.get(templateId);
  if (!existing) throw new Error("Meeting template not found.");
  if (patch.isDefault) await clearDefault(ctx, String(existing.societyId), templateId);
  const clean: Record<string, unknown> = { updatedAtISO: new Date().toISOString() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    clean[key] = key === "items" ? cleanItems(value as any[]) : value;
  }
  await ctx.db.patch(templateId, clean);
  return templateId;
}

export async function removePortable(ctx: PortableMutationCtx, { templateId }: { templateId: string }) {
  const existing = await ctx.db.get(templateId);
  if (!existing) return null;
  await ctx.db.delete(templateId);
  return templateId;
}

export async function duplicatePortable(
  ctx: PortableMutationCtx,
  { templateId, name }: { templateId: string; name?: string },
) {
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
}

export async function createFromMeetingPortable(
  ctx: PortableMutationCtx,
  { meetingId, name, description, isDefault }: {
    meetingId: string;
    name: string;
    description?: string;
    isDefault?: boolean;
  },
) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error("Meeting not found.");
  const minutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .first();
  const motions = minutes?.motions ?? [];
  const agenda = await getCanonicalAgendaEntries(ctx, meetingId);
  const items = agenda.map((entry, index) => {
    const motion = motions.find((candidate: any) => candidate.sectionIndex === index);
    return {
      title: entry.title,
      depth: entry.depth,
      sectionType: minutes?.sections?.[index]?.type,
      presenter: minutes?.sections?.[index]?.presenter,
      details: minutes?.sections?.[index]?.discussion,
      motionText: motion?.text,
    };
  });
  if (items.length === 0) throw new Error("Meeting does not have agenda items to save.");
  if (isDefault) await clearDefault(ctx, String(meeting.societyId));
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
}

async function clearDefault(ctx: PortableMutationCtx, societyId: string, exceptId?: string) {
  const existing = await ctx.db
    .query("meetingTemplates")
    .withIndex("by_society_default", (q) => q.eq("societyId", societyId).eq("isDefault", true))
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
      details: item?.details || undefined,
      motionTemplateId: item?.motionTemplateId || undefined,
      motionText: item?.motionText || undefined,
    });
    if (depth === 0) hasRoot = true;
  }
  return cleaned;
}

async function getCanonicalAgendaEntries(ctx: PortableQueryCtx, meetingId: string) {
  return await readMeetingAgendaEntries(ctx, meetingId);
}

type AgendaEntry = { title: string; depth: 0 | 1 };

async function readMeetingAgendaItems(ctx: PortableQueryCtx, meetingId: string): Promise<any[]> {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a: any, b: any) => a.createdAtISO.localeCompare(b.createdAtISO));
  const agenda = agendas[0];
  if (!agenda) return [];
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
    .collect();
  items.sort((a: any, b: any) => a.order - b.order);
  return items;
}

async function readMeetingAgendaEntries(ctx: PortableQueryCtx, meetingId: string): Promise<AgendaEntry[]> {
  const items = await readMeetingAgendaItems(ctx, meetingId);
  return items
    .map((item: any) => ({
      title: String(item.title ?? "").trim(),
      depth: item.depth === 1 ? (1 as const) : (0 as const),
    }))
    .filter((entry: AgendaEntry) => entry.title);
}
