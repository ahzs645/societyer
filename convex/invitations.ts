import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  acceptPortable,
  createPortable,
  getByTokenPortable,
  listPortable,
  revokePortable,
  pendingForAccountPortable, acceptForAccountPortable, resendPortable,
} from "../shared/functions/invitations";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { findInvitation, hashInvitationToken, invitationAvailability, invitationIssuerAuthorized } from "../shared/functions/invitationTokens";
import { resolveConvexAuthSiteUrls } from "../shared/authConfiguration";
import { sendEmail } from "./providers/email";

export const list = authorizedQuery("invitations:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("invitations:create", mutation)({
  args: {
    societyId: v.id("societies"),
    email: v.optional(v.string()),
    role: v.string(),
    expiresInDays: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("email"), v.literal("link"))),
    label: v.optional(v.string()),
    targetUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const issued = await createPortable(await toPortableMutationCtx(ctx), args);
    if (args.kind !== "link") {
      await ctx.db.patch(issued.id as any, { emailStatus: "queued" });
      await ctx.scheduler.runAfter(0, internal.invitations.deliverEmail, { id: issued.id as any, token: issued.token });
    }
    return issued;
  },
});

export const revoke = authorizedMutation("invitations:revoke", mutation)({
  args: { id: v.id("invitations") },
  returns: v.any(),
  handler: async (ctx, args) => revokePortable(await toPortableMutationCtx(ctx), args),
});

export const getByToken = authorizedQuery("invitations:getByToken", query)({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => getByTokenPortable(await toPortableQueryCtx(ctx), args),
});

export const accept = authorizedMutation("invitations:accept", mutation)({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => acceptPortable(await toPortableMutationCtx(ctx), args),
});

export const pendingForAccount = authorizedQuery("invitations:pendingForAccount", query)({
  args: {}, returns: v.any(),
  handler: async ctx => pendingForAccountPortable(await toPortableQueryCtx(ctx)),
});

export const acceptForAccount = authorizedMutation("invitations:acceptForAccount", mutation)({
  args: { id: v.id("invitations") }, returns: v.any(),
  handler: async (ctx, args) => acceptForAccountPortable(await toPortableMutationCtx(ctx), args),
});

export const resend = authorizedMutation("invitations:resend", mutation)({
  args: { id: v.id("invitations") }, returns: v.any(),
  handler: async (ctx, args) => {
    const issued = await resendPortable(await toPortableMutationCtx(ctx), args);
    await ctx.scheduler.runAfter(0, internal.invitations.deliverEmail, { id: args.id, token: issued.token });
    return issued;
  },
});

export const emailContext = internalQuery({
  args: { id: v.id("invitations"), token: v.string() }, returns: v.any(),
  handler: async (ctx, { id, token }) => {
    const portable = await toPortableQueryCtx(ctx);
    const invitation = await findInvitation(portable, token);
    if (!invitation || invitation._id !== id || invitation.kind === "link" || invitationAvailability(invitation) || !await invitationIssuerAuthorized(portable, invitation)) return null;
    const society = await ctx.db.get(invitation.societyId as any);
    return society ? { email: invitation.email, role: invitation.role, workspaceName: String((society as any).name), expiresAtISO: invitation.expiresAtISO, demo: (society as any).isDemo === true } : null;
  },
});

export const recordEmail = internalMutation({
  args: { id: v.id("invitations"), tokenHash: v.string(), accepted: v.boolean(), provider: v.optional(v.string()), error: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.tokenHash !== args.tokenHash) return null;
    await ctx.db.patch(args.id, { emailStatus: args.accepted ? "accepted" : "failed", emailAcceptedAtISO: args.accepted ? new Date().toISOString() : undefined, emailProvider: args.provider, emailError: args.error });
    return null;
  },
});

export const deliverEmail = internalAction({
  args: { id: v.id("invitations"), token: v.string(), attempt: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.runQuery(internal.invitations.emailContext, { id: args.id, token: args.token });
    if (!invitation) return null;
    try {
      const url = `${resolveConvexAuthSiteUrls(process.env)[0]}/invite/${encodeURIComponent(args.token)}`;
      const sent = await sendEmail({ to: invitation.email, subject: `Join ${invitation.workspaceName} on Societyer`, text: `You have been invited to ${invitation.workspaceName} as ${invitation.role}.\n\n${url}\n\nSign in or create an account with ${invitation.email}. Verify your email, then join the invited workspace; you do not need to create an organization.\n\nThis invitation expires ${invitation.expiresAtISO}. If you were not expecting it, you can ignore this email.`, tag: "workspace-invitation", demo: invitation.demo });
      await ctx.runMutation(internal.invitations.recordEmail, { id: args.id, tokenHash: await hashInvitationToken(args.token), accepted: true, provider: sent.provider });
    } catch {
      const attempt = args.attempt ?? 0;
      if (attempt < 2) await ctx.scheduler.runAfter((attempt + 1) * 30_000, internal.invitations.deliverEmail, { ...args, attempt: attempt + 1 });
      else await ctx.runMutation(internal.invitations.recordEmail, { id: args.id, tokenHash: await hashInvitationToken(args.token), accepted: false, error: "The email provider did not confirm acceptance. Check the sender configuration and resend." });
    }
    return null;
  },
});
