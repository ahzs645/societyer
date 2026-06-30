/**
 * PORTABLE FUNCTIONS: the service-providers domain
 * (list / functionsCatalog / activeAsOf / upsert).
 *
 * Reads/writes the `serviceProviders` table over `ctx.db`. Point-in-time and
 * validation logic comes from the dependency-free `../serviceProviders` helpers.
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  activeProvidersAsOf,
  validateServiceProvider,
  SERVICE_PROVIDER_FUNCTIONS,
  type ServiceProvider,
  type ServiceProviderFunction,
} from "../serviceProviders";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("serviceProviders")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function functionsCatalogPortable() {
  return SERVICE_PROVIDER_FUNCTIONS;
}

export async function activeAsOfPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
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
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  {
    id,
    nowISO,
    ...args
  }: {
    id?: string;
    societyId: string;
    function: string;
    firmName: string;
    contactName?: string;
    firmLocation?: string;
    appointedOn?: string;
    removedOn?: string;
    notes?: string;
    nowISO: string;
  },
) {
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
}
