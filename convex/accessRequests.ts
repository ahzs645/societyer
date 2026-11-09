/**
 * Self-service workspace access requests. Handlers check the signed-in identity
 * and, for decisions and settings, Owner/Admin authority themselves.
 * See docs/shared-workspaces/architecture.md ("Access requests").
 */
import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { convexPortableDb, toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  activeApprovers, approvePortable, availabilityPortable, declinePortable, getSettingsPortable, listForWorkspacePortable,
  minePortable, setSettingsPortable, submitPortable, withdrawPortable,
} from "../shared/functions/accessRequests";
import { resolveConvexAuthSiteUrls } from "../shared/authConfiguration";
import { chooseLinkOrigin, primaryWorkspaceOrigin } from "../shared/workspaceDomains";
import { sendEmail } from "./providers/email";

/** Parsed SITE_URL, or none when it is missing or malformed: requests then stay closed. */
function trustedSiteOrigins(): string[] {
  try { return resolveConvexAuthSiteUrls(process.env); } catch { return []; }
}

export const availability = authorizedQuery("accessRequests:availability", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => availabilityPortable(await toPortableQueryCtx(ctx), args, trustedSiteOrigins()),
});

export const submit = authorizedMutation("accessRequests:submit", mutation)({
  args: { societyId: v.id("societies"), note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const result = await submitPortable(await toPortableMutationCtx(ctx), args, trustedSiteOrigins());
    if (result.status === "requested") await ctx.scheduler.runAfter(0, internal.accessRequests.deliverEmail, { id: result.id });
    return result;
  },
});

export const withdraw = authorizedMutation("accessRequests:withdraw", mutation)({
  args: { id: v.id("workspaceAccessRequests") },
  returns: v.any(),
  handler: async (ctx, args) => withdrawPortable(await toPortableMutationCtx(ctx), args),
});

export const mine = authorizedQuery("accessRequests:mine", query)({
  args: {},
  returns: v.any(),
  handler: async (ctx) => minePortable(await toPortableQueryCtx(ctx)),
});

export const listForWorkspace = authorizedQuery("accessRequests:listForWorkspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listForWorkspacePortable(await toPortableQueryCtx(ctx), args),
});

export const approve = authorizedMutation("accessRequests:approve", mutation)({
  args: { id: v.id("workspaceAccessRequests"), role: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => approvePortable(await toPortableMutationCtx(ctx), args),
});

export const decline = authorizedMutation("accessRequests:decline", mutation)({
  args: { id: v.id("workspaceAccessRequests") },
  returns: v.any(),
  handler: async (ctx, args) => declinePortable(await toPortableMutationCtx(ctx), args),
});

export const getSettings = authorizedQuery("accessRequests:getSettings", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => getSettingsPortable(await toPortableQueryCtx(ctx), args, trustedSiteOrigins()),
});

export const setSettings = authorizedMutation("accessRequests:setSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    enabled: v.boolean(),
    defaultRole: v.union(v.literal("Viewer"), v.literal("Member")),
    message: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => setSettingsPortable(await toPortableMutationCtx(ctx), args),
});

/** Recipients and wording for one still-pending request; null once it's decided. */
export const emailContext = internalQuery({
  args: { id: v.id("workspaceAccessRequests") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const request = await ctx.db.get(id);
    if (!request || request.status !== "pending") return null;
    const society = await ctx.db.get(request.societyId);
    if (!society) return null;
    const db = convexPortableDb(ctx.db);
    const recipients = [...new Set((await activeApprovers(db, request.societyId))
      .map((user) => String(user.email ?? "").trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
    return {
      recipients,
      workspaceName: society.name,
      requesterEmail: request.emailVerified ? request.email : undefined,
      canonicalOrigin: await primaryWorkspaceOrigin(db, request.societyId),
      // Same flag invitation emails use.
      demo: (society as { isDemo?: unknown }).isDemo === true,
    };
  },
});

/** Best effort: the in-app notice written with the request is the durable record. */
export const deliverEmail = internalAction({
  args: { id: v.id("workspaceAccessRequests") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const context = await ctx.runQuery(internal.accessRequests.emailContext, { id });
    if (!context?.recipients.length) return null;
    const siteUrls = trustedSiteOrigins();
    if (!siteUrls.length) return null;
    const url = `${chooseLinkOrigin(context.canonicalOrigin, siteUrls)}/app/users`;
    const who = context.requesterEmail ?? "Someone";
    for (const to of context.recipients as string[]) {
      try {
        await sendEmail({
          to, subject: `Access request for ${context.workspaceName}`, tag: "workspace-access-request", demo: context.demo,
          text: `${who} asked to join ${context.workspaceName} on Societyer.\n\nApprove or decline it under Users & access:\n${url}\n\nYou get this email because you're an Owner or Admin of ${context.workspaceName}.`,
        });
      } catch {
        // One failed recipient doesn't stop the others.
      }
    }
    return null;
  },
});
