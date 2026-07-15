import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  listDefinitionsPortable,
  createDefinitionPortable,
  updateDefinitionPortable,
  deleteDefinitionPortable,
  listValuesPortable,
  setValuePortable,
  clearValuePortable,
} from "../shared/functions/customFields";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listDefinitions = query({
  args: {
    societyId: v.id("societies"),
    entityType: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => listDefinitionsPortable(await toPortableQueryCtx(ctx), args),
});

export const createDefinition = mutation({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    key: v.string(),
    label: v.string(),
    kind: v.string(),
    required: v.optional(v.boolean()),
    order: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createDefinitionPortable(await toPortableMutationCtx(ctx), args),
});

export const updateDefinition = mutation({
  args: {
    id: v.id("customFieldDefinitions"),
    label: v.optional(v.string()),
    kind: v.optional(v.string()),
    required: v.optional(v.boolean()),
    order: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateDefinitionPortable(await toPortableMutationCtx(ctx), args),
});

export const deleteDefinition = mutation({
  args: { id: v.id("customFieldDefinitions") },
  returns: v.any(),
  handler: async (ctx, args) => deleteDefinitionPortable(await toPortableMutationCtx(ctx), args),
});

export const listValues = query({
  args: {
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => listValuesPortable(await toPortableQueryCtx(ctx), args),
});

export const setValue = mutation({
  args: {
    societyId: v.id("societies"),
    definitionId: v.id("customFieldDefinitions"),
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    value: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => setValuePortable(await toPortableMutationCtx(ctx), args),
});

export const clearValue = mutation({
  args: {
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    definitionId: v.id("customFieldDefinitions"),
  },
  returns: v.any(),
  handler: async (ctx, args) => clearValuePortable(await toPortableMutationCtx(ctx), args),
});
