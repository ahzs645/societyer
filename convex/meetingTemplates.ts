import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  updatePortable,
  removePortable,
  duplicatePortable,
  createFromMeetingPortable,
  seedDefaultsPortable,
} from "../shared/functions/meetingTemplates";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const templateItem = v.object({
  title: v.string(),
  depth: v.optional(v.union(v.literal(0), v.literal(1))),
  sectionType: v.optional(v.string()),
  presenter: v.optional(v.string()),
  details: v.optional(v.string()),
  motionTemplateId: v.optional(v.id("motionTemplates")),
  motionText: v.optional(v.string()),
  adoptsPreviousMinutes: v.optional(v.boolean()),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { templateId: v.id("meetingTemplates") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const duplicate = mutation({
  args: { templateId: v.id("meetingTemplates"), name: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => duplicatePortable(await toPortableMutationCtx(ctx), args),
});

export const createFromMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
    name: v.string(),
    description: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createFromMeetingPortable(await toPortableMutationCtx(ctx), args),
});

export const seedDefaults = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedDefaultsPortable(await toPortableMutationCtx(ctx), args),
});
