/**
 * PORTABLE FUNCTIONS: the firm-wide (cross-entity) layer.
 *
 * `overviewPortable` rolls up each entity's open deadlines + post-incorporation
 * progress over `ctx.db`, running unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * `searchPortable` runs the firm-wide quick search over the portable
 * `withSearchIndex` contract (a tokenized prefix scan on the local adapters, the
 * real full-text index on Convex). `batchGeneratePacket` (raw-ctx packet
 * generation) stays in convex/firm.ts.
 */

import { documentAccessPredicate } from "./documents";
import { listAuthorizedSocietyRows } from "./society";
import { requirePermissionPortable, type Permission } from "./permissions";
import { visibleDirectoryRows } from "./peopleDirectory";
import type { PortableQueryCtx } from "../portable/ctx";
import { organizationKind, organizationLabel } from "../organizationDomain";
import { postIncorporationStepsForOrganization } from "../postIncorporationSteps";

async function permits(ctx: PortableQueryCtx, societyId: string, permission: Permission) {
  try { await requirePermissionPortable(ctx, societyId, permission); return true; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === `Permission ${permission} required.` || message === `Service scope ${permission} required.`) return false;
    throw error;
  }
}

function deadlineOpen(d: any): boolean {
  const status = d.status ?? (d.done ? "complete" : "open");
  return status === "open";
}

/** Resolve generated packet keys from a society's precedent runs. */
function generatedPacketKeysFromRuns(runs: any[]): Set<string> {
  const keys = new Set<string>();
  for (const run of runs) {
    for (const id of run.sourceExternalIds ?? []) {
      const match = /-packet-run:(.+)$/.exec(String(id));
      if (match) keys.add(match[1]);
    }
  }
  return keys;
}

export async function overviewPortable(ctx: PortableQueryCtx, { todayISO }: { todayISO?: string }) {
  const today = (todayISO ?? new Date().toISOString()).slice(0, 10);
  const societies = await listAuthorizedSocietyRows(ctx);

  const entities: any[] = [];
  for (const society of societies) {
    // Portfolio counts expose compliance and legal-operation records.
    if (!await permits(ctx, society._id, "deadlines:read") || !await permits(ctx, society._id, "documents:read")) continue;
    const [deadlines, runs] = await Promise.all([
      ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
      ctx.db.query("legalPrecedentRuns").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
    ]);
    const open = deadlines.filter(deadlineOpen);
    const overdue = open.filter((d: any) => String(d.dueDate ?? "") < today).length;

    const steps = postIncorporationStepsForOrganization(society as any);
    const packetSteps = steps.filter((s) => s.packetKey);
    const generated = generatedPacketKeysFromRuns(runs);
    const stepsDone = packetSteps.filter((s) => generated.has(s.packetKey as string)).length;

    entities.push({
      _id: society._id,
      name: organizationLabel(society as any),
      kind: organizationKind(society as any),
      incorporationNumber: society.incorporationNumber ?? null,
      status: society.organizationStatus ?? null,
      overdueDeadlines: overdue,
      upcomingDeadlines: open.length - overdue,
      openDeadlines: open.length,
      postIncorpTotal: packetSteps.length,
      postIncorpDone: stepsDone,
    });
  }
  entities.sort((a, b) => b.overdueDeadlines - a.overdueDeadlines || a.name.localeCompare(b.name));

  return {
    today,
    entities,
    totals: {
      entities: entities.length,
      corporations: entities.filter((e) => e.kind === "corporation").length,
      societies: entities.filter((e) => e.kind === "society").length,
      overdueDeadlines: entities.reduce((sum, e) => sum + e.overdueDeadlines, 0),
      upcomingDeadlines: entities.reduce((sum, e) => sum + e.upcomingDeadlines, 0),
    },
  };
}

export async function searchPortable(ctx: PortableQueryCtx, { query: term }: { query: string }) {
  const q = String(term ?? "").trim();
  if (q.length < 2) return [];
  const societies = await listAuthorizedSocietyRows(ctx);
  const results: any[] = [];
  const directory = new Map<string, any>();
  for (const society of societies) {
    const societyId = String(society._id);
    const societyName = organizationLabel(society as any);
    if (await permits(ctx, societyId, "deadlines:read")) {
      const deadlines = await ctx.db.query("deadlines").withSearchIndex("search_title", s => s.search("title", q).eq("societyId", societyId)).take(12);
      for (const row of deadlines) results.push({ kind: "deadline", id: String(row._id), title: row.title, societyId, societyName, to: "/app/deadlines" });
    }
    if (await permits(ctx, societyId, "documents:read")) {
      const allows = await documentAccessPredicate(ctx, societyId);
      const documents = await ctx.db.query("documents").withSearchIndex("search_title", s => s.search("title", q).eq("societyId", societyId)).filter(allows).take(12);
      for (const row of documents) results.push({ kind: "document", id: String(row._id), title: row.title, societyId, societyName, to: "/app/documents" });
    }
    if (await permits(ctx, societyId, "members:read")) {
      for (const row of await visibleDirectoryRows(ctx, societyId)) directory.set(String(row._id), row);
    }
  }
  // Preserve the full-text match behavior while filtering the complete result
  // set before limiting; foreign hits must neither leak nor hide owned hits.
  const people = await ctx.db.query("peopleDirectory").withSearchIndex("search_full_name", s => s.search("fullName", q)).filter(row => directory.has(String(row._id))).take(12);
  for (const person of people) results.push({ kind: "person", id: String(person._id), title: person.fullName, societyId: null, societyName: null, to: "/app/people-directory" });
  return results;
}
