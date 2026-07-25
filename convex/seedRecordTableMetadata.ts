/**
 * Seeds objectMetadata + fieldMetadata + a default "All records" view for
 * each Twenty-style object. Idempotent — re-running tops up missing rows
 * instead of creating duplicates.
 *
 * Run with: `node scripts/convex-maintenance.mjs seedRecordTableMetadata:run`
 * Or per-society: `npx convex run seedRecordTableMetadata:runForSociety '{"societyId":"...","serviceToken":"..."}'`
 */

import { mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { assertMaintenanceToken, serviceTokenValidator } from "./lib/serviceAuth";

import { RECORD_TABLE_OBJECTS } from "./recordTableMetadataDefinitions";
import {
  seedSocietyPortable,
  runPortable,
  runForSocietyPortable,
  ensureForSocietyPortable,
  wipePortable,
} from "../shared/functions/seedRecordTableMetadata";
import { toPortableMutationCtx } from "./lib/portable";

/* ----------------------------- Seed operations ---------------------------- */

async function seedSociety(ctx: any, societyId: any) {
  await seedSocietyPortable(await toPortableMutationCtx(ctx), societyId, RECORD_TABLE_OBJECTS);
}

export const run = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ seededSocieties: v.number(), objects: v.number() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return runPortable(await toPortableMutationCtx(ctx), { objects: RECORD_TABLE_OBJECTS });
  },
});

export const runForSociety = mutation({
  args: { societyId: v.id("societies"), serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean(), objects: v.number() }),
  handler: async (ctx, { societyId, serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return runForSocietyPortable(await toPortableMutationCtx(ctx), { societyId, objects: RECORD_TABLE_OBJECTS });
  },
});

/**
 * Public, no-token version of `runForSociety`. Safe because seeding is
 * idempotent (only inserts missing object/field/view rows) and scoped to
 * the supplied society. Used by the in-app "Seed metadata" empty-state
 * button so users don't have to drop to the CLI when a society is missing
 * its metadata. Also called automatically when a new society is created.
 */
export const ensureForSociety = mutation({
  args: { societyId: v.id("societies") },
  returns: v.object({ ok: v.boolean(), objects: v.number() }),
  handler: async (ctx, { societyId }) =>
    ensureForSocietyPortable(await toPortableMutationCtx(ctx), { societyId, objects: RECORD_TABLE_OBJECTS }),
});

export { seedSociety };

/**
 * Nukes metadata rows for testing. Leaves underlying record tables alone.
 */
export const wipe = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return wipePortable(await toPortableMutationCtx(ctx));
  },
});
