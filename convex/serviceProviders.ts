import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  activeProvidersAsOf,
  validateServiceProvider,
  SERVICE_PROVIDER_FUNCTIONS,
  type ServiceProvider,
  type ServiceProviderFunction,
} from "../shared/serviceProviders";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("serviceProviders")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const functionsCatalog = query({
  args: {},
  returns: v.any(),
  handler: async () => SERVICE_PROVIDER_FUNCTIONS,
});

export const activeAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("serviceProviders")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const providers: ServiceProvider[] = rows.map((row) => ({
      id: String(row._id),
      function: row.function as ServiceProviderFunction,
      firmName: row.firmName,
      contactName: row.contactName,
      firmLocation: row.firmLocation,
      appointedOn: row.appointedOn,
      removedOn: row.removedOn,
    }));
    return activeProvidersAsOf(providers, asOf);
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("serviceProviders")),
    societyId: v.id("societies"),
    function: v.string(),
    firmName: v.string(),
    contactName: v.optional(v.string()),
    firmLocation: v.optional(v.string()),
    appointedOn: v.optional(v.string()),
    removedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { id, nowISO, ...args }) => {
    const result = validateServiceProvider({
      function: args.function as ServiceProviderFunction,
      firmName: args.firmName,
      appointedOn: args.appointedOn,
      removedOn: args.removedOn,
    });
    if (!result.ok) {
      throw new Error(result.errors.join(" "));
    }
    if (id) {
      await ctx.db.patch(id, {
        societyId: args.societyId,
        function: args.function,
        firmName: args.firmName,
        contactName: args.contactName,
        firmLocation: args.firmLocation,
        appointedOn: args.appointedOn,
        removedOn: args.removedOn,
        notes: args.notes,
        updatedAtISO: nowISO,
      });
      return id;
    }
    return await ctx.db.insert("serviceProviders", {
      societyId: args.societyId,
      function: args.function,
      firmName: args.firmName,
      contactName: args.contactName,
      firmLocation: args.firmLocation,
      appointedOn: args.appointedOn,
      removedOn: args.removedOn,
      notes: args.notes,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
    });
  },
});
