/**
 * Operator-installed defaults for one workspace on a shared deployment, where
 * deployment-wide defaults such as SOCIETYER_INITIAL_INVOICE_TEMPLATE stay unset.
 *
 *   npx convex run workspaceDefaults:installInvoiceTemplate '{"societyId":"…","template":"firstform"}'
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { convexPortableDb } from "./lib/portable";
import { installInvoiceTemplate as install } from "./lib/initialInvoiceTemplate";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";

const TEMPLATE_NAMES = { firstform: "First Form" } as const;

export const installInvoiceTemplate = internalMutation({
  args: { societyId: v.id("societies"), template: v.literal("firstform") },
  returns: v.object({ templateId: v.string(), replaced: v.boolean() }),
  handler: async (ctx, { societyId, template }) => {
    if (!await ctx.db.get(societyId)) throw new Error("Workspace not found.");
    // Run the same member-checked write as workspace creation, on behalf of
    // the workspace's longest-standing Active Owner (as billing automation does).
    const owners = (await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect())
      .filter((user) => user.role === "Owner" && (!user.status || user.status === "Active"))
      .sort((a, b) => a._creationTime - b._creationTime);
    if (!owners.length) throw new Error("The workspace has no Active Owner to install the template for.");
    const portable: PortableMutationCtx = {
      db: convexPortableDb(ctx.db),
      principal: {
        kind: "service", runtime: "convex-hosted", assurance: "trusted-internal", subject: "workspace-defaults",
        societyId, actorUserId: owners[0]._id, scopes: ["settings:write"],
      },
      capabilities: makeCapabilities({}),
      runQuery: async () => { throw new Error("Nested queries are not supported here."); },
      runMutation: async () => { throw new Error("Nested mutations are not supported here."); },
    };
    const existing = (await ctx.db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect())
      .find((row) => row.config.name === TEMPLATE_NAMES[template]);
    const templateId = await install(portable, societyId, template, existing?._id);
    return { templateId: String(templateId), replaced: Boolean(existing) };
  },
});
