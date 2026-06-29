import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  canAccessMeetingMaterial,
  summarizeMeetingMaterials,
} from "./lib/access/materialAccess";
import { documentAccessContextForActor } from "./lib/access/documentAccess";
import { readMeetingAgendaEntries } from "./lib/agendaItems";
import {
  listForMeetingPortable,
  listForSocietyPortable,
  attachPortable,
  setAvailabilityPortable,
  removePortable,
} from "../shared/functions/meetingMaterials";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const accessGrantValidator = v.object({
  subjectType: v.string(),
  subjectId: v.optional(v.string()),
  subjectLabel: v.string(),
  access: v.string(),
  note: v.optional(v.string()),
});

export const listForMeeting = query({
  args: { meetingId: v.id("meetings"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => listForMeetingPortable(toPortableQueryCtx(ctx), args),
});

export const packageForMeeting = query({
  args: { meetingId: v.id("meetings"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { meetingId, actingUserId }) => {
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
    const accessContext = await documentAccessContextForActor(ctx, meeting.societyId, actingUserId);
    const visibleMaterials = accessContext
      ? materials.filter((material) => canAccessMeetingMaterial(material, accessContext))
      : materials;

    const materialRows = await Promise.all(
      visibleMaterials.map(async (material) => {
        const document = await ctx.db.get(material.documentId);
        const downloadUrl = document?.storageId
          ? await ctx.storage.getUrl(document.storageId)
          : null;
        return {
          ...material,
          document: document ? { ...document, downloadUrl } : document,
        };
      }),
    );

    const agenda = (await readMeetingAgendaEntries(ctx, meetingId)).map((entry) => entry.title);
    const visibleMaterialSummary = summarizeMeetingMaterials(visibleMaterials);
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
        visibleMaterials: visibleMaterials.length,
        requiredMaterials: visibleMaterials.filter((row) => row.requiredForMeeting).length,
        readyMaterials: visibleMaterialSummary.ready,
        attentionMaterials: visibleMaterialSummary.needsAttention,
        expiredMaterials: visibleMaterialSummary.expired,
        restrictedMaterials: visibleMaterialSummary.restricted,
        explicitGrantMaterials: visibleMaterialSummary.withExplicitGrants,
        openTasks: tasks.filter((task) => task.status !== "Done").length,
      },
    };
  },
});

export const listForSociety = query({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: (ctx, args) => listForSocietyPortable(toPortableQueryCtx(ctx), args),
});

export const attach = mutation({
  args: {
    id: v.optional(v.id("meetingMaterials")),
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    documentId: v.id("documents"),
    agendaLabel: v.optional(v.string()),
    label: v.optional(v.string()),
    order: v.optional(v.number()),
    requiredForMeeting: v.optional(v.boolean()),
    accessLevel: v.optional(v.string()),
    accessGrants: v.optional(v.array(accessGrantValidator)),
    availabilityStatus: v.optional(v.string()),
    syncStatus: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => attachPortable(toPortableMutationCtx(ctx), args),
});

export const setAvailability = mutation({
  args: {
    id: v.id("meetingMaterials"),
    availabilityStatus: v.string(),
    syncStatus: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => setAvailabilityPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("meetingMaterials") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

