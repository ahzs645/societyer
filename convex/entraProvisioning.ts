/** Deployment-operator tooling. No browser or unauthenticated public endpoint. */
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createAuth } from "./hostedAuth";
import { hostedEntraConfig } from "../shared/hostedMicrosoftSso";
import { createRemoteJWKSet } from "jose";
import { toPortableQueryCtx } from "./lib/portable";
import { activePersonLinks, membershipsForIdentities, personLinkState } from "../shared/functions/identity";
import { bindTransferredMembership } from "./workspaceTransfer";

/** Checks the public signing-key endpoint without collecting a user's token. */
export const checkSigningKeys = internalAction({
  args: {},
  returns: v.object({ timeoutSupported: v.boolean(), fetchOk: v.boolean(), resolverOk: v.boolean(), now: v.number(), constructedNow: v.number(), remoteDate: v.optional(v.string()), errorType: v.optional(v.string()), errorCode: v.optional(v.string()) }),
  handler: async () => {
    const config = hostedEntraConfig();
    if (!config) throw new Error("Entra login is not configured.");
    const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`);
    let fetchOk = false;
    const clock = { now: Date.now(), constructedNow: new Date().getTime() };
    let remoteDate: string | undefined;
    try {
      const response = await fetch(url);
      remoteDate = response.headers.get("date") ?? undefined;
      const body = await response.json() as { keys?: unknown[] };
      fetchOk = response.ok && Array.isArray(body.keys) && body.keys.length > 0;
      await createRemoteJWKSet(url).reload();
      return { ...clock, remoteDate, timeoutSupported: typeof AbortSignal.timeout === "function", fetchOk, resolverOk: true };
    } catch (error) {
      const failure = error as { name?: unknown; code?: unknown };
      return { ...clock, remoteDate, timeoutSupported: typeof AbortSignal.timeout === "function", fetchOk, resolverOk: false,
        errorType: typeof failure.name === "string" && /^[A-Za-z]+$/.test(failure.name) ? failure.name : undefined,
        errorCode: typeof failure.code === "string" && /^ERR_[A-Z_]+$/.test(failure.code) ? failure.code : undefined };
    }
  },
});

export const registerDirectoryMember = internalAction({
  args: {
    societyId: v.id("societies"), objectId: v.string(), email: v.string(), name: v.string(),
    existingAuthUserId: v.optional(v.string()),
    // Bind this membership imported by a workspace transfer instead of adding a Viewer.
    transferredMembership: v.optional(v.object({ runId: v.id("workspaceTransferRuns"), userId: v.id("users"), reason: v.string() })),
  },
  returns: v.object({ authUserId: v.string(), membershipId: v.id("users"), role: v.string() }),
  handler: async (ctx, args): Promise<{ authUserId: string; membershipId: Id<"users">; role: string }> => {
    if (!hostedEntraConfig()) throw new Error("Configure the approved Entra application before provisioning.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.objectId)) throw new Error("Use the directory user's immutable Object ID.");
    const email = args.email.trim().toLowerCase();
    const objectId = args.objectId.toLowerCase();
    const { internalAdapter } = await createAuth(ctx).$context;
    let user = args.existingAuthUserId ? await internalAdapter.findUserById(args.existingAuthUserId) : null;
    if (args.existingAuthUserId && (!user || user.email.toLowerCase() !== email)) throw new Error("The operator-selected existing account does not match the directory user.");
    const existingAccount = await internalAdapter.findAccountByKey({ providerId: "microsoft", accountId: objectId });
    if (existingAccount) {
      const owner = await internalAdapter.findUserById(existingAccount.userId);
      if (!owner || owner.email.toLowerCase() !== email || (user && user.id !== owner.id)) throw new Error("That directory identity is already bound to another account.");
      user = owner;
    }
    if (!user) {
      if (await internalAdapter.findUserByEmail(email)) throw new Error("Explicitly select the existing auth account; accounts are never merged by email.");
      user = await internalAdapter.createUser({ email, name: args.name.trim(), emailVerified: false }, { method: "admin" });
    }
    if (!existingAccount) {
      await internalAdapter.createAccount({ providerId: "microsoft", accountId: objectId, userId: user.id, scope: "openid profile email" });
    }
    const membership = await ctx.runMutation(internal.entraProvisioning.ensureDirectoryMembership, {
      societyId: args.societyId, authUserId: user.id, email, name: args.name.trim(),
      ...(args.transferredMembership ? { transferredMembership: args.transferredMembership } : {}),
    });
    console.info("Entra operator provisioning completed", { objectId: args.objectId, authUserId: user.id, membershipId: membership.membershipId });
    return { authUserId: user.id, ...membership };
  },
});

export const ensureDirectoryMembership = internalMutation({
  args: {
    societyId: v.id("societies"), authUserId: v.string(), email: v.string(), name: v.string(),
    transferredMembership: v.optional(v.object({ runId: v.id("workspaceTransferRuns"), userId: v.id("users"), reason: v.string() })),
  },
  returns: v.object({ membershipId: v.id("users"), role: v.string() }),
  handler: async (ctx, args) => {
    const society = await ctx.db.get(args.societyId);
    if (!society) throw new Error("Workspace not found.");
    if (society.transferQuarantinedAtISO) throw new Error("This workspace is still being transferred; finalize the transfer first.");
    const issuer = process.env.CONVEX_SITE_URL;
    if (!issuer) throw new Error("Convex issuer is missing.");
    if (args.transferredMembership) {
      const imported = await ctx.db.get(args.transferredMembership.userId);
      if (!imported || imported.societyId !== args.societyId || imported.email.trim().toLowerCase() !== args.email.trim().toLowerCase()) {
        throw new Error("The transferred membership is not this directory user's membership in this workspace.");
      }
      const bound = await bindTransferredMembership(ctx, { ...args.transferredMembership, authIssuer: issuer, authSubject: args.authUserId,
        actor: "Deployment operator (Entra provisioning)" });
      return { membershipId: bound.userId, role: bound.role };
    }
    const memberships = await ctx.db.query("users").withIndex("by_auth_identity", q => q.eq("authIssuer", issuer).eq("authSubject", args.authUserId)).take(100);
    const existing = memberships.find(user => user.societyId === args.societyId);
    if (existing) {
      if (existing.status !== "Active") throw new Error("Disabled memberships are never reactivated by provisioning.");
      return { membershipId: existing._id, role: existing.role };
    }
    // A second membership through a linked identity would make the workspace
    // ambiguous for this person, which denies both.
    const db = (await toPortableQueryCtx(ctx)).db;
    const link = await personLinkState(db, { issuer, subject: args.authUserId });
    if (link.kind === "linked") {
      const linked = await membershipsForIdentities(db, await activePersonLinks(db, link.person._id));
      if (linked.some(user => user.societyId === args.societyId)) {
        throw new Error("This person already has a membership in this workspace through a linked account.");
      }
    }
    let identity = await ctx.db.query("externalIdentities").withIndex("by_issuer_subject", q => q.eq("issuer", issuer).eq("subject", args.authUserId)).unique();
    if (identity && identity.status !== "Active") throw new Error("Disabled identities are never reactivated by provisioning.");
    const now = new Date().toISOString();
    const identityId = identity?._id ?? await ctx.db.insert("externalIdentities", { issuer, subject: args.authUserId, status: "Active", createdAtISO: now });
    const membershipId = await ctx.db.insert("users", {
      societyId: args.societyId, email: args.email, displayName: args.name, role: "Viewer", status: "Active",
      authIssuer: issuer, authProvider: "convex", authSubject: args.authUserId, externalIdentityId: identityId, createdAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId, actor: "Deployment operator", entityType: "user", entityId: membershipId,
      subjectId: membershipId, action: "entra-provisioned", summary: "Provisioned an approved directory identity as Viewer", createdAtISO: now,
    });
    return { membershipId, role: "Viewer" };
  },
});

/** Revoke at most 100 sessions per call. Repeat if `more` is true. */
export const revokeMemberSessions = internalAction({
  args: { objectId: v.string() },
  returns: v.object({ revoked: v.number(), more: v.boolean() }),
  handler: async (ctx, { objectId }) => {
    const { adapter, internalAdapter } = await createAuth(ctx).$context;
    const account = await internalAdapter.findAccountByKey({ providerId: "microsoft", accountId: objectId.toLowerCase() });
    if (!account) throw new Error("Directory identity is not provisioned.");
    const sessions = await adapter.findMany<{ token: string }>({ model: "session", where: [{ field: "userId", value: account.userId }], limit: 100 });
    for (const session of sessions) await internalAdapter.deleteSession(session.token);
    return { revoked: sessions.length, more: sessions.length === 100 };
  },
});
