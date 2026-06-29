/**
 * PORTABLE FUNCTIONS: the API platform domain (clients, tokens, plugin
 * installations, integration catalog, integration sync states).
 *
 * Only the pure `ctx.db` handlers live here. Anything that hashes/verifies a
 * service token (crypto) stays on Convex (createToken, verifyToken, and the
 * webhook surfaces).
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { INTEGRATION_CATALOG, getIntegrationManifest } from "../integrationCatalog";

function nowISO() {
  return new Date().toISOString();
}

function redactToken(row: any) {
  const { tokenHash: _tokenHash, ...rest } = row;
  return rest;
}

function parseConfigJson(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function healthForInstallation(row: any | undefined, manifest: any) {
  if (!row) {
    return {
      status: "not_installed",
      messages: ["Install this integration to configure credentials, actions, and webhooks."],
    };
  }
  if (row.status !== "installed") {
    return {
      status: row.status,
      messages: [`Integration is ${row.status}.`],
      checkedAtISO: parseConfigJson(row.configJson).healthCheckedAtISO,
    };
  }
  const config = parseConfigJson(row.configJson);
  const missingSecrets = manifest.requiredSecrets.filter(
    (key: string) => !config.secretStatus?.[key] && !config.envStatus?.[key],
  );
  return {
    status: missingSecrets.length ? "needs_setup" : manifest.status === "planned" ? "planned" : "ready",
    checkedAtISO: config.healthCheckedAtISO,
    messages: [
      missingSecrets.length ? `Missing configured secret status: ${missingSecrets.join(", ")}` : "Required secret statuses are configured.",
      ...(Array.isArray(config.healthMessages) ? config.healthMessages : []),
    ],
  };
}

export async function listClientsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<any> {
  return ctx.db
    .query("apiClients")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createClientPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; name: string; description?: string; kind?: string; createdByUserId?: string },
): Promise<any> {
  const at = nowISO();
  return await ctx.db.insert("apiClients", {
    societyId: args.societyId,
    name: args.name,
    description: args.description,
    kind: args.kind ?? "plugin",
    status: "active",
    createdByUserId: args.createdByUserId,
    createdAtISO: at,
    updatedAtISO: at,
  });
}

export async function updateClientPortable(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: { name?: string; description?: string; kind?: string; status?: string } },
) {
  await ctx.db.patch(id, { ...patch, updatedAtISO: nowISO() });
  return null;
}

export async function listTokensPortable(
  ctx: PortableQueryCtx,
  { societyId, clientId }: { societyId: string; clientId?: string },
) {
  const rows = clientId
    ? await ctx.db
        .query("apiTokens")
        .withIndex("by_client", (q) => q.eq("clientId", clientId))
        .collect()
    : await ctx.db
        .query("apiTokens")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
  return rows.filter((row: any) => row.societyId === societyId).map(redactToken);
}

export async function listPluginInstallationsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<any> {
  return ctx.db
    .query("pluginInstallations")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function listIntegrationCatalogPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId?: string },
) {
  const installations = societyId
    ? await ctx.db
        .query("pluginInstallations")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()
    : [];
  const bySlug = new Map(installations.map((row: any) => [row.slug, row]));
  return INTEGRATION_CATALOG.map((manifest) => {
    const installation = bySlug.get(manifest.slug);
    return {
      ...manifest,
      installation,
      installed: installation?.status === "installed",
      health: healthForInstallation(installation, manifest),
    };
  });
}

export async function installIntegrationPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; slug: string; status?: string; installedByUserId?: string },
): Promise<any> {
  const manifest = getIntegrationManifest(args.slug);
  if (!manifest) throw new Error("Integration manifest not found.");
  if (args.installedByUserId) {
    await requireRolePortable(ctx, { societyId: args.societyId, actingUserId: args.installedByUserId, required: "Admin" });
  }
  const existing = (await ctx.db
    .query("pluginInstallations")
    .withIndex("by_society_slug", (q) => q.eq("societyId", args.societyId).eq("slug", manifest.slug))
    .collect())[0];
  const config = {
    manifestVersion: 1,
    kind: manifest.kind,
    category: manifest.category,
    requiredSecrets: manifest.requiredSecrets,
    dataMappings: manifest.dataMappings,
    auditEvents: manifest.auditEvents,
    healthChecks: manifest.healthChecks,
    actions: manifest.actions,
    healthMessages: [`Installed from integration catalog at ${nowISO()}.`],
  };
  const payload = {
    societyId: args.societyId,
    name: manifest.name,
    slug: manifest.slug,
    status: args.status ?? "installed",
    capabilities: manifest.capabilities,
    configJson: JSON.stringify(config, null, 2),
    installedByUserId: args.installedByUserId,
    updatedAtISO: nowISO(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }
  return await ctx.db.insert("pluginInstallations", {
    ...payload,
    createdAtISO: nowISO(),
  });
}

export async function updateIntegrationHealthPortable(
  ctx: PortableMutationCtx,
  {
    id,
    ...patch
  }: {
    id: string;
    secretStatus?: Record<string, boolean>;
    envStatus?: Record<string, boolean>;
    healthMessages?: string[];
    status?: string;
  },
) {
  const row = await ctx.db.get(id);
  if (!row) throw new Error("Integration installation not found.");
  const config = parseConfigJson(row.configJson);
  await ctx.db.patch(id, {
    status: patch.status ?? row.status,
    configJson: JSON.stringify({
      ...config,
      secretStatus: patch.secretStatus ?? config.secretStatus,
      envStatus: patch.envStatus ?? config.envStatus,
      healthMessages: patch.healthMessages ?? config.healthMessages ?? [],
      healthCheckedAtISO: nowISO(),
    }, null, 2),
    updatedAtISO: nowISO(),
  });
  return null;
}

export async function upsertPluginInstallationPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    clientId?: string;
    name: string;
    slug: string;
    status?: string;
    capabilities: string[];
    configJson?: string;
    installedByUserId?: string;
  },
): Promise<any> {
  const at = nowISO();
  const { id, ...rest } = args;
  if (id) {
    await ctx.db.patch(id, {
      ...rest,
      status: rest.status ?? "installed",
      updatedAtISO: at,
    });
    return id;
  }
  return await ctx.db.insert("pluginInstallations", {
    ...rest,
    status: rest.status ?? "installed",
    createdAtISO: at,
    updatedAtISO: at,
  });
}

export async function listIntegrationSyncStatesPortable(
  ctx: PortableQueryCtx,
  { societyId, provider, resourceType }: { societyId: string; provider?: string; resourceType?: string },
): Promise<any> {
  const rows = provider && resourceType
    ? await ctx.db
        .query("integrationSyncStates")
        .withIndex("by_society_provider_resource", (q) =>
          q.eq("societyId", societyId).eq("provider", provider).eq("resourceType", resourceType),
        )
        .collect()
    : provider
      ? await ctx.db
          .query("integrationSyncStates")
          .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", provider))
          .collect()
      : await ctx.db
          .query("integrationSyncStates")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect();
  return rows.sort((a: any, b: any) => String(b.updatedAtISO).localeCompare(String(a.updatedAtISO)));
}
