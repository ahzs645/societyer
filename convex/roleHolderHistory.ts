import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  revisionHistoryPortable,
  registerAsOfPortable,
  changesBetweenPortable,
} from "../shared/functions/roleHolderHistory";
import { toPortableQueryCtx } from "./lib/portable";

/**
 * Read-side of the role-holder edit history. The write path
 * (legalOperations.upsertRoleHolder / removeRoleHolder) appends a closed
 * revision per edit; these queries reconstruct timelines and as-of/diff views
 * via the pure shared/roleHolderHistory helpers.
 */

/** The full edit timeline for one role holder, with per-edit field changes. */
export const revisionHistory = query({
  args: { roleHolderId: v.id("roleHolders") },
  returns: v.any(),
  handler: (ctx, args) => revisionHistoryPortable(toPortableQueryCtx(ctx), args),
});

/** The whole register reconstructed as it stood at a past instant. */
export const registerAsOf = query({
  args: { societyId: v.id("societies"), asOfISO: v.string() },
  returns: v.any(),
  handler: (ctx, args) => registerAsOfPortable(toPortableQueryCtx(ctx), args),
});

/** What changed in the register between two instants (new/update/delete). */
export const changesBetween = query({
  args: { societyId: v.id("societies"), fromISO: v.string(), toISO: v.string() },
  returns: v.any(),
  handler: (ctx, args) => changesBetweenPortable(toPortableQueryCtx(ctx), args),
});
