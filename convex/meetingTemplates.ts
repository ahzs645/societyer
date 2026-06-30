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
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { templateId: v.id("meetingTemplates") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

export const duplicate = mutation({
  args: { templateId: v.id("meetingTemplates"), name: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => duplicatePortable(toPortableMutationCtx(ctx), args),
});

export const createFromMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
    name: v.string(),
    description: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args) => createFromMeetingPortable(toPortableMutationCtx(ctx), args),
});

export const seedDefaults = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => seedDefaultsPortable(toPortableMutationCtx(ctx), args),
});
