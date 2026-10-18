/**
 * Procurement review (hosted only): which SharePoint folder this workspace
 * reads its published Zoer snapshot from. The snapshot files themselves come
 * through convex/procurementReviewHttp.ts. The local and desktop runtimes have
 * no route to SharePoint, so these functions have no portable twin.
 * See zoer/docs/societyer-review-contract.md.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { requireEnabledModule } from "./lib/moduleSettings";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";

function requireDeploymentSupport() {
  if (!deploymentCapabilities(process.env).procurementReview) throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
}

/** The configured folder, for members who can read documents while the module is on. */
export const folder = authorizedQuery("procurementReview:folder", query)({
  args: { societyId: v.id("societies") },
  returns: v.object({ folder: v.union(v.string(), v.null()) }),
  handler: async (ctx, { societyId }) => {
    requireDeploymentSupport();
    const society: Doc<"societies"> = await requireEnabledModule(ctx, societyId, "procurementReview");
    const folder = society.integrationSettings?.procurementReviewFolder;
    return { folder: folder ? validateWorkspaceProcurementReviewFolder(societyId, folder) : null };
  },
});

/** Point the workspace at its snapshot folder (or clear it with ""). Settings editors only; never stores credentials. */
export const setFolder = authorizedMutation("procurementReview:setFolder", mutation)({
  args: { societyId: v.id("societies"), folder: v.string() },
  returns: v.null(),
  handler: async (ctx, { societyId, folder }) => {
    requireDeploymentSupport();
    const society: Doc<"societies"> = await requireEnabledModule(ctx, societyId, "procurementReview");
    const procurementReviewFolder = folder.trim() ? validateWorkspaceProcurementReviewFolder(societyId, folder) : "";
    await ctx.db.patch(societyId, {
      integrationSettings: { ...defaultIntegrationSettings(), ...society.integrationSettings, procurementReviewFolder },
      updatedAt: Date.now(),
    });
    return null;
  },
});
