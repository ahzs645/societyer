import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listForMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const materials = await ctx.db
      .query("meetingMaterials")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const rows = await Promise.all(
      materials.map(async (material) => ({
        ...material,
        document: await ctx.db.get(material.documentId),
      })),
    );
    return rows.sort((a, b) => a.order - b.order || String(a.createdAtISO).localeCompare(String(b.createdAtISO)));
  },
});

export const packageForMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) return null;

    const [materials, minutes, tasks] = await Promise.all([
      ctx.db
        .query("meetingMaterials")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .collect(),
      ctx.db
        .query("minutes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .first(),
      ctx.db
        .query("tasks")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .collect(),
    ]);

    const materialRows = await Promise.all(
      materials.map(async (material) => ({
        ...material,
        document: await ctx.db.get(material.documentId),
      })),
    );

    const agenda = parseAgenda(meeting.agendaJson);
    return {
      meeting,
      minutes,
      agenda,
      materials: materialRows
        .filter((row) => row.document)
        .sort((a, b) => a.order - b.order || String(a.createdAtISO).localeCompare(String(b.createdAtISO))),
      tasks: tasks.sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""))),
      counts: {
        agendaItems: agenda.length,
        materials: materials.length,
        requiredMaterials: materials.filter((row) => row.requiredForMeeting).length,
        openTasks: tasks.filter((task) => task.status !== "Done").length,
      },
    };
  },
});

export const listForSociety = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const materials = await ctx.db
      .query("meetingMaterials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const rows = await Promise.all(
      materials.map(async (material) => ({
        ...material,
        document: await ctx.db.get(material.documentId),
        meeting: await ctx.db.get(material.meetingId),
      })),
    );
    return rows.sort((a, b) => String(b.meeting?.scheduledAt ?? "").localeCompare(String(a.meeting?.scheduledAt ?? "")));
  },
});

export const attach = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    documentId: v.id("documents"),
    agendaLabel: v.optional(v.string()),
    label: v.optional(v.string()),
    order: v.optional(v.number()),
    requiredForMeeting: v.optional(v.boolean()),
    accessLevel: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [meeting, document] = await Promise.all([
      ctx.db.get(args.meetingId),
      ctx.db.get(args.documentId),
    ]);
    if (!meeting || meeting.societyId !== args.societyId) throw new Error("Meeting not found for this society.");
    if (!document || document.societyId !== args.societyId) throw new Error("Document not found for this society.");

    const existing = await ctx.db
      .query("meetingMaterials")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    const same = existing.find((row) => String(row.documentId) === String(args.documentId));
    const patch = {
      agendaLabel: args.agendaLabel || undefined,
      label: args.label || undefined,
      order: args.order ?? same?.order ?? existing.length + 1,
      requiredForMeeting: args.requiredForMeeting ?? same?.requiredForMeeting ?? true,
      accessLevel: args.accessLevel ?? same?.accessLevel ?? "board",
      notes: args.notes || undefined,
    };

    if (same) {
      await ctx.db.patch(same._id, patch);
      return same._id;
    }

    const id = await ctx.db.insert("meetingMaterials", {
      societyId: args.societyId,
      meetingId: args.meetingId,
      documentId: args.documentId,
      ...patch,
      createdAtISO: new Date().toISOString(),
    });
    await ctx.db.patch(args.documentId, {
      meetingId: args.meetingId,
      librarySection: document.librarySection ?? "meeting_material",
      reviewStatus: document.reviewStatus ?? "in_review",
    });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("meetingMaterials") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

function parseAgenda(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
}
