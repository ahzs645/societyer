import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireRole, canActAs } from "./users";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function env(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

function localDevKey() {
  if (env("NODE_ENV") === "production") {
    throw new ConvexError({
      code: "VAULT_KEY_MISSING",
      message: "SECRET_VAULT_ENCRYPTION_KEY is required before storing secrets in production.",
    });
  }
  return "societyer-local-dev-vault-key";
}

function bytesToBase64Url(bytes: Uint8Array) {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function vaultKey() {
  const configured = env("SECRET_VAULT_ENCRYPTION_KEY") ?? env("API_SECRET_ENCRYPTION_KEY") ?? localDevKey();
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(configured));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await vaultKey(),
    textEncoder.encode(value),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptSecret(value: string) {
  const [version, ivText, encryptedText] = value.split(".");
  if (version !== "v1" || !ivText || !encryptedText) {
    throw new ConvexError({ code: "SECRET_DECRYPT_FAILED", message: "Unsupported encrypted secret format." });
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivText) },
    await vaultKey(),
    base64UrlToBytes(encryptedText),
  );
  return textDecoder.decode(decrypted);
}

function previewFor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const suffix = trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
  return `•••• ${suffix}`;
}

function publicSecret(row: any) {
  const { secretEncrypted, ...rest } = row;
  return {
    ...rest,
    hasSecretValue: Boolean(secretEncrypted),
  };
}

async function assertVaultWrite(ctx: any, societyId: any, actingUserId?: any) {
  if (!actingUserId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admin role required." });
  }
  return requireRole(ctx, { societyId, actingUserId, required: "Admin" });
}

async function assertCanReveal(ctx: any, row: any, actingUserId?: any) {
  if (!actingUserId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admin role required to reveal stored access values." });
  }
  const user = await ctx.db.get(actingUserId);
  if (!user || user.societyId !== row.societyId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "User is not part of this society." });
  }
  if (canActAs(user.role, "Owner")) return user;

  const policy = row.revealPolicy ?? "owner_admin_custodian";
  const authorizedUserIds = row.authorizedUserIds ?? [];
  const explicitlyAuthorized = authorizedUserIds.includes(actingUserId);
  const isCustodian = row.custodianUserId === actingUserId;

  if (policy === "owner_only") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Owner role required to reveal this value." });
  }
  if (policy === "owner_admin" && canActAs(user.role, "Admin")) return user;
  if (policy === "owner_admin_custodian" && (canActAs(user.role, "Admin") || isCustodian || explicitlyAuthorized)) {
    return user;
  }
  throw new ConvexError({ code: "FORBIDDEN", message: "You are not authorized to reveal this stored access value." });
}

async function logActivity(ctx: any, row: any, actorName: string, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId: row.societyId,
    actor: actorName,
    entityType: "secretVaultItem",
    entityId: String(row._id),
    action,
    summary,
    createdAtISO: new Date().toISOString(),
  });
}

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("secretVaultItems")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.map(publicSecret);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    name: v.string(),
    service: v.string(),
    credentialType: v.string(),
    ownerRole: v.optional(v.string()),
    custodianUserId: v.optional(v.id("users")),
    custodianPersonName: v.optional(v.string()),
    custodianEmail: v.optional(v.string()),
    backupCustodianName: v.optional(v.string()),
    backupCustodianEmail: v.optional(v.string()),
    username: v.optional(v.string()),
    accessUrl: v.optional(v.string()),
    storageMode: v.optional(v.string()),
    externalLocation: v.optional(v.string()),
    secretValue: v.optional(v.string()),
    revealPolicy: v.optional(v.string()),
    authorizedUserIds: v.optional(v.array(v.id("users"))),
    lastVerifiedAtISO: v.optional(v.string()),
    rotationDueAtISO: v.optional(v.string()),
    status: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    accessLevel: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await assertVaultWrite(ctx, args.societyId, args.actingUserId);
    const now = new Date().toISOString();
    const { secretValue, actingUserId, ...rest } = args;
    const secretPatch = secretValue
      ? {
          secretEncrypted: await encryptSecret(secretValue),
          secretPreview: previewFor(secretValue),
          secretUpdatedAtISO: now,
          secretUpdatedByUserId: actingUserId,
        }
      : {};
    const id = await ctx.db.insert("secretVaultItems", {
      ...rest,
      ...secretPatch,
      storageMode: rest.storageMode ?? (secretValue ? "stored_encrypted" : "external_reference"),
      revealPolicy: rest.revealPolicy ?? "owner_admin_custodian",
      status: rest.status ?? "NeedsReview",
      sensitivity: rest.sensitivity ?? "high",
      accessLevel: rest.accessLevel ?? "restricted",
      createdAtISO: now,
      updatedAtISO: now,
    });
    await logActivity(ctx, { ...rest, _id: id }, user.displayName, "created", `Created access vault record "${rest.name}".`);
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("secretVaultItems"),
    actingUserId: v.optional(v.id("users")),
    patch: v.object({
      name: v.optional(v.string()),
      service: v.optional(v.string()),
      credentialType: v.optional(v.string()),
      ownerRole: v.optional(v.string()),
      custodianUserId: v.optional(v.id("users")),
      custodianPersonName: v.optional(v.string()),
      custodianEmail: v.optional(v.string()),
      backupCustodianName: v.optional(v.string()),
      backupCustodianEmail: v.optional(v.string()),
      username: v.optional(v.string()),
      accessUrl: v.optional(v.string()),
      storageMode: v.optional(v.string()),
      externalLocation: v.optional(v.string()),
      secretValue: v.optional(v.string()),
      revealPolicy: v.optional(v.string()),
      authorizedUserIds: v.optional(v.array(v.id("users"))),
      lastVerifiedAtISO: v.optional(v.string()),
      rotationDueAtISO: v.optional(v.string()),
      status: v.optional(v.string()),
      sensitivity: v.optional(v.string()),
      accessLevel: v.optional(v.string()),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      sourceExternalIds: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, actingUserId, patch }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND", message: "Access vault record not found." });
    const { user } = await assertVaultWrite(ctx, existing.societyId, actingUserId);
    const now = new Date().toISOString();
    const { secretValue, ...rest } = patch;
    const secretPatch = secretValue
      ? {
          secretEncrypted: await encryptSecret(secretValue),
          secretPreview: previewFor(secretValue),
          secretUpdatedAtISO: now,
          secretUpdatedByUserId: actingUserId,
          storageMode: rest.storageMode ?? "stored_encrypted",
        }
      : {};
    await ctx.db.patch(id, { ...rest, ...secretPatch, updatedAtISO: now });
    await logActivity(ctx, existing, user.displayName, "updated", `Updated access vault record "${existing.name}".`);
  },
});

export const revealSecret = mutation({
  args: {
    id: v.id("secretVaultItems"),
    actingUserId: v.id("users"),
  },
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new ConvexError({ code: "NOT_FOUND", message: "Access vault record not found." });
    const user = await assertCanReveal(ctx, row, actingUserId);
    if (!row.secretEncrypted) {
      throw new ConvexError({ code: "NO_SECRET_VALUE", message: "No encrypted value is stored for this record." });
    }
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      secretLastRevealedAtISO: now,
      secretLastRevealedByUserId: actingUserId,
      updatedAtISO: now,
    });
    await logActivity(ctx, row, user.displayName, "revealed", `Revealed stored access value for "${row.name}".`);
    return { value: await decryptSecret(row.secretEncrypted), revealedAtISO: now };
  },
});

export const remove = mutation({
  args: { id: v.id("secretVaultItems"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const existing = await ctx.db.get(id);
    if (!existing) return;
    const { user } = await assertVaultWrite(ctx, existing.societyId, actingUserId);
    await ctx.db.delete(id);
    await logActivity(ctx, existing, user.displayName, "deleted", `Deleted access vault record "${existing.name}".`);
  },
});
