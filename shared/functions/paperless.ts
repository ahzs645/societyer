/**
 * PORTABLE FUNCTIONS: the Paperless-ngx connector read/record domain.
 *
 * Only the pure `ctx.db` handlers live here. Anything that reads the live
 * runtime status (connectionStatus, upsertConnection — they call
 * `paperlessRuntimeStatus`, which reads env), gates on native file storage
 * (recordPulledSourceDocument), or pulls over the network (pullSourceDocument,
 * disconnect) stays on Convex.
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

export async function tagProfilesPortable() {
  return [
    {
      scope: "Core record",
      tags: ["societyer", "category:<document category>", "local document tags"],
      usage: "Every synced document carries stable app-level context.",
    },
    {
      scope: "Governance",
      tags: ["constitution", "bylaws", "minutes", "election", "auditor"],
      usage: "Society profile, meetings, elections, bylaws, and auditor records.",
    },
    {
      scope: "Compliance",
      tags: ["filing", "filing:<kind>", "records-inspection", "pipa-training"],
      usage: "Filing evidence, retained records, inspections, and privacy training proof.",
    },
    {
      scope: "Finance and programs",
      tags: ["financial-statement", "grant-report", "grant-transaction", "volunteer-screening"],
      usage: "Financials, grants, donation evidence, and volunteer screening files.",
    },
  ];
}

export async function listConnectionPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("paperlessConnections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a: any, b: any) => b.connectedAtISO.localeCompare(a.connectedAtISO))[0] ?? null;
}

export async function recentSyncsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  const rows = await ctx.db
    .query("paperlessDocumentSyncs")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const sorted = rows
    .sort((a: any, b: any) => b.queuedAtISO.localeCompare(a.queuedAtISO))
    .slice(0, limit ?? 20);
  return await Promise.all(
    sorted.map(async (row: any) => {
      const document = await ctx.db.get(row.documentId);
      return {
        ...row,
        documentTitle: document?.title ?? row.title,
        documentCategory: document?.category,
      };
    }),
  );
}

export async function syncForDocumentPortable(ctx: PortableQueryCtx, { documentId }: { documentId: string }) {
  const rows = await ctx.db
    .query("paperlessDocumentSyncs")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect();
  return rows.sort((a: any, b: any) => b.queuedAtISO.localeCompare(a.queuedAtISO))[0] ?? null;
}

export async function sourcePullContextPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; documentId: string; actingUserId?: string },
) {
  if (args.actingUserId) {
    await requireRolePortable(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
  }
  const document = await ctx.db.get(args.documentId);
  if (!document || document.societyId !== args.societyId) {
    throw new Error("Document not found.");
  }
  return { document };
}

export async function authorizeMeetingImportPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; actingUserId: string },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  return true;
}

export async function getSyncPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function recordConnectionTestPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ok: boolean;
    baseUrl?: string;
    apiVersion?: string;
    serverVersion?: string;
    error?: string;
    demo: boolean;
  },
) {
  const connection = await ctx.db
    .query("paperlessConnections")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect()
    .then((rows: any[]) => rows[0] ?? null);
  if (!connection) return null;
  await ctx.db.patch(connection._id, {
    status: args.ok ? "connected" : "error",
    baseUrl: args.baseUrl,
    apiVersion: args.apiVersion,
    serverVersion: args.serverVersion,
    lastCheckedAtISO: new Date().toISOString(),
    lastError: args.error,
    demo: args.demo,
  });
  return connection._id;
}
