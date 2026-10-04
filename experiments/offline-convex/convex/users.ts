// Pilot-only post-handler projection hooks. Reuse the production registration's
// validators and authorized handler so its identity, role and Owner policies
// remain authoritative. Refresh commits in the same transaction as the change.
import { mutationGeneric, type RegisteredMutation, type GenericMutationCtx } from "convex/server";
import * as productionUsers from "../../../convex/users";
import { rebuildMeetingDownloads } from "./offlineMeetings";

// These pinned-runtime registration fields are intentionally omitted from the
// public SDK declarations. Native and live checks verify the copied validators.
type RuntimeMutation<Args extends { id?: string; societyId?: string }, Returns> = RegisteredMutation<"public", Args, Returns> & {
  _handler: (ctx: GenericMutationCtx<any>, args: Args) => Returns;
  exportArgs: () => string;
  exportReturns: () => string;
};
function withProjectionRefresh<Args extends { id?: string; societyId?: string }, Returns>(registration: RegisteredMutation<"public", Args, Returns>) {
  const original = registration as RuntimeMutation<Args, Returns>;
  if (typeof original._handler !== "function" || typeof original.exportArgs !== "function" || typeof original.exportReturns !== "function") {
    throw new Error("Unsupported Convex registration runtime; refusing to alter authorization metadata.");
  }
  const wrapped = mutationGeneric({ handler: async (ctx, args: Args) => {
    // A removal loses its row, so retain the affected scope before the handler.
    // This read returns nothing to the caller; the original handler authorizes
    // every change before any materializer write is attempted.
    const previous = args.id ? await ctx.db.get(args.id as any) : undefined;
    const result = await original._handler(ctx, args);
    const societyId = previous?.societyId ?? args.societyId;
    if (societyId) await rebuildMeetingDownloads(ctx, societyId);
    return result;
  } }) as RuntimeMutation<Args, Promise<Awaited<Returns>>>;
  // Convex's registration metadata is also used by the native test oracle.
  wrapped.exportArgs = original.exportArgs;
  wrapped.exportReturns = original.exportReturns;
  return wrapped;
}

export const setRole = withProjectionRefresh(productionUsers.setRole);
export const remove = withProjectionRefresh(productionUsers.remove);
export const upsert = withProjectionRefresh(productionUsers.upsert);
export const securityDisable = withProjectionRefresh(productionUsers.securityDisable);
