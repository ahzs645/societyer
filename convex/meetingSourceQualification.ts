import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { createDeploymentSharePointAdapter } from "../shared/storage/sharePointDeployment";

/** Operator-only, read-only probe in the actual Convex HTTP control-plane runtime. */
export const verifyConnection = internalAction({
  args: {}, returns: v.object({ tenantId: v.string(), siteId: v.string(), driveId: v.string() }),
  handler: async () => createDeploymentSharePointAdapter(process.env).verifyResource(),
});
