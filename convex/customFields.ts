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
  handler: (ctx, args) => listDefinitionsPortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createDefinitionPortable(toPortableMutationCtx(ctx), args),
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
  handler: (ctx, args) => updateDefinitionPortable(toPortableMutationCtx(ctx), args),
});

export const deleteDefinition = mutation({
  args: { id: v.id("customFieldDefinitions") },
  returns: v.any(),
  handler: (ctx, args) => deleteDefinitionPortable(toPortableMutationCtx(ctx), args),
});

export const listValues = query({
  args: {
    entityType: v.string(),
    entityId: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => listValuesPortable(toPortableQueryCtx(ctx), args),
});

export const setValue = mutation({
  args: {
    societyId: v.id("societies"),
    definitionId: v.id("customFieldDefinitions"),
    entityType: v.string(),
    entityId: v.string(),
    value: v.any(),
  },
  returns: v.any(),
  handler: (ctx, args) => setValuePortable(toPortableMutationCtx(ctx), args),
});

export const clearValue = mutation({
  args: {
    entityType: v.string(),
    entityId: v.string(),
    definitionId: v.id("customFieldDefinitions"),
  },
  returns: v.any(),
  handler: (ctx, args) => clearValuePortable(toPortableMutationCtx(ctx), args),
});
