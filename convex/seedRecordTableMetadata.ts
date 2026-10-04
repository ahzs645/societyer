import { authorizedMutation } from "./lib/authorizedServer";
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

export const run = authorizedMutation("seedRecordTableMetadata:run", mutation)({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ seededSocieties: v.number(), objects: v.number() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return runPortable(await toPortableMutationCtx(ctx), { objects: RECORD_TABLE_OBJECTS });
  },
});

export const runForSociety = authorizedMutation("seedRecordTableMetadata:runForSociety", mutation)({
  args: { societyId: v.id("societies"), serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean(), objects: v.number() }),
  handler: async (ctx, { societyId, serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return runForSocietyPortable(await toPortableMutationCtx(ctx), { societyId, objects: RECORD_TABLE_OBJECTS });
  },
});

/**
 * In-app metadata initialization requires the current principal's
 * settings:write permission in the supplied workspace. Idempotency prevents
 * duplicate rows; it does not grant authority to seed another workspace.
 * Society creation uses the separate internal seedSociety helper.
 */
export const ensureForSociety = authorizedMutation("seedRecordTableMetadata:ensureForSociety", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.object({ ok: v.boolean(), objects: v.number() }),
  handler: async (ctx, { societyId }) =>
    ensureForSocietyPortable(await toPortableMutationCtx(ctx), { societyId, objects: RECORD_TABLE_OBJECTS }),
});

export { seedSociety };

/**
 * Nukes metadata rows for testing. Leaves underlying record tables alone.
 */
export const wipe = authorizedMutation("seedRecordTableMetadata:wipe", mutation)({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return wipePortable(await toPortableMutationCtx(ctx));
  },
});
