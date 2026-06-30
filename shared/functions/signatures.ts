/**
 * PORTABLE FUNCTIONS: the signatures domain
 * (listForEntity / listProfilesForSociety / saveProfile / sign / revoke).
 *
 * Reads/writes signatures + signatureProfiles (and logs activity/notifications)
 * over `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle. The actor-permission helpers and the
 * profile upsert are pure (`ctx.db`-only) helpers shared by the mutations.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

// Role-rank check, copied (pure) from convex/users.ts so this file stays free of
// the Convex-coupled users module. Logic preserved exactly.
type Role = "Owner" | "Admin" | "Director" | "Member" | "Viewer";

const ROLE_RANK: Record<Role, number> = {
  Owner: 100,
  Admin: 80,
  Director: 60,
  Member: 40,
  Viewer: 20,
};

function canActAs(actual: Role | undefined | null, required: Role): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

function normalizeSignerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

async function assertSignatureActor(
  ctx: PortableMutationCtx,
  args: { societyId: string; actingUserId?: string; userId?: string },
) {
  if (!args.actingUserId) return;
  const actor = await ctx.db.get(args.actingUserId);
  if (!actor || actor.societyId !== args.societyId) throw new Error("Signature actor is not part of this society.");
  if (args.userId && args.userId !== args.actingUserId && !canActAs(actor.role as Role, "Admin")) {
    throw new Error("Only an admin can sign on behalf of another user.");
  }
}

async function findExistingProfile(
  ctx: PortableMutationCtx,
  args: {
    societyId: any;
    userId?: any;
    directorId?: any;
    memberId?: any;
    normalizedSignerName: string;
  },
) {
  const profiles = await ctx.db
    .query("signatureProfiles")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  return (
    profiles.find((profile: Record<string, any>) => args.userId && profile.userId === args.userId) ??
    profiles.find((profile: Record<string, any>) => args.directorId && profile.directorId === args.directorId) ??
    profiles.find((profile: Record<string, any>) => args.memberId && profile.memberId === args.memberId) ??
    profiles.find((profile: Record<string, any>) => profile.normalizedSignerName === args.normalizedSignerName) ??
    null
  );
}

async function upsertSignatureProfile(
  ctx: PortableMutationCtx,
  args: {
    societyId: any;
    userId?: any;
    directorId?: any;
    memberId?: any;
    signerName: string;
    signerRole?: string;
    method: string;
    typedName?: string;
    imageDataUrl?: string;
    imageMimeType?: string;
    actingUserId?: any;
  },
) {
  const normalizedSignerName = normalizeSignerName(args.signerName);
  const now = new Date().toISOString();
  const existing = await findExistingProfile(ctx, {
    societyId: args.societyId,
    userId: args.userId,
    directorId: args.directorId,
    memberId: args.memberId,
    normalizedSignerName,
  });
  const patch = {
    societyId: args.societyId,
    userId: args.userId,
    directorId: args.directorId,
    memberId: args.memberId,
    signerName: args.signerName,
    normalizedSignerName,
    signerRole: args.signerRole,
    method: args.method,
    typedName: args.typedName,
    imageDataUrl: args.imageDataUrl,
    imageMimeType: args.imageMimeType,
    updatedAtISO: now,
    updatedByUserId: args.actingUserId,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return ctx.db.insert("signatureProfiles", {
    ...patch,
    createdAtISO: now,
    createdByUserId: args.actingUserId,
  });
}

export async function listForEntityPortable(
  ctx: PortableQueryCtx,
  { entityType, entityId }: { entityType: string; entityId: string },
) {
  return ctx.db
    .query("signatures")
    .withIndex("by_entity", (q) => q.eq("entityType", entityType).eq("entityId", entityId))
    .collect();
}

export async function listProfilesForSocietyPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  return ctx.db
    .query("signatureProfiles")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function saveProfilePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    userId?: string;
    directorId?: string;
    memberId?: string;
    signerName: string;
    signerRole?: string;
    method: string;
    typedName?: string;
    imageDataUrl?: string;
    imageMimeType?: string;
    actingUserId?: string;
  },
) {
  await assertSignatureActor(ctx, args);
  return upsertSignatureProfile(ctx, args);
}

export async function signPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    entityType: string;
    entityId: string;
    userId?: string;
    directorId?: string;
    memberId?: string;
    signatureProfileId?: string;
    signerName: string;
    signerRole?: string;
    method: string;
    typedName?: string;
    imageDataUrl?: string;
    imageMimeType?: string;
    saveToProfile?: boolean;
    demo?: boolean;
    actingUserId?: string;
  },
) {
  // Signatures are kiosk-style: anyone can type/draw their own name. We only
  // enforce the actor check when one is provided AND a userId link is being
  // claimed — that's where the "admin can sign for another user" rule matters.
  await assertSignatureActor(ctx, args);

  let signatureProfileId = args.signatureProfileId;
  if (args.saveToProfile) {
    signatureProfileId = await upsertSignatureProfile(ctx, args);
  }

  const id = await ctx.db.insert("signatures", {
    societyId: args.societyId,
    entityType: args.entityType,
    entityId: args.entityId,
    userId: args.userId,
    directorId: args.directorId,
    memberId: args.memberId,
    signatureProfileId,
    signerName: args.signerName,
    signerRole: args.signerRole,
    method: args.method,
    typedName: args.typedName,
    imageDataUrl: args.imageDataUrl,
    imageMimeType: args.imageMimeType,
    signedAtISO: new Date().toISOString(),
    demo: args.demo ?? true,
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: args.signerName,
    entityType: args.entityType,
    entityId: args.entityId,
    action: "signed",
    summary: `Signed ${args.entityType} via ${args.method}${args.demo ? " (demo)" : ""}`,
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("notifications", {
    societyId: args.societyId,
    kind: "signature",
    severity: "success",
    title: `Signature captured on ${args.entityType}`,
    body: `${args.signerName} signed via ${args.method}.`,
    linkHref: args.entityType === "minutes" ? `/minutes` : `/${args.entityType}s`,
    createdAtISO: new Date().toISOString(),
  });
  return { signatureId: id, signatureProfileId };
}

export async function revokePortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const sig = await ctx.db.get(id);
  if (!sig) return;
  // Symmetric with sign(): only enforce the actor check when one is given
  // AND the signature is linked to a specific user. Without an actor we
  // assume kiosk-style usage where revoking is local-session housekeeping.
  if (actingUserId) {
    const actor = await ctx.db.get(actingUserId);
    if (!actor || actor.societyId !== sig.societyId) throw new Error("Signature actor is not part of this society.");
    if (sig.userId && sig.userId !== actingUserId && !canActAs(actor.role as Role, "Admin")) {
      throw new Error("Only an admin can revoke another user's signature.");
    }
  }
  await ctx.db.delete(id);
  await ctx.db.insert("activity", {
    societyId: sig.societyId,
    actor: sig.signerName,
    entityType: sig.entityType,
    entityId: sig.entityId,
    action: "signature-revoked",
    summary: `Revoked signature on ${sig.entityType}`,
    createdAtISO: new Date().toISOString(),
  });
}
