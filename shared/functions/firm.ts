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

import type { PortableQueryCtx } from "../portable/ctx";
import { organizationKind, organizationLabel } from "../organizationDomain";
import { postIncorporationStepsForOrganization } from "../postIncorporationSteps";

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
  const societies = await ctx.db.query("societies").collect();

  const entities: any[] = [];
  for (const society of societies) {
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
  const [deadlines, documents, people] = await Promise.all([
    ctx.db.query("deadlines").withSearchIndex("search_title", (s) => s.search("title", q)).take(12),
    ctx.db.query("documents").withSearchIndex("search_title", (s) => s.search("title", q)).take(12),
    ctx.db.query("peopleDirectory").withSearchIndex("search_full_name", (s) => s.search("fullName", q)).take(12),
  ]);

  const societyById = new Map<string, any>();
  for (const id of new Set<string>([...deadlines, ...documents].map((r: any) => String(r.societyId)))) {
    const s = await ctx.db.get(id);
    if (s) societyById.set(id, s);
  }
  const nameOf = (id: string) => {
    const s = societyById.get(id);
    return s ? organizationLabel(s as any) : "Unknown entity";
  };

  const results: any[] = [];
  for (const d of deadlines) {
    results.push({ kind: "deadline", id: String(d._id), title: d.title, societyId: String(d.societyId), societyName: nameOf(String(d.societyId)), to: "/app/deadlines" });
  }
  for (const d of documents) {
    results.push({ kind: "document", id: String(d._id), title: d.title, societyId: String(d.societyId), societyName: nameOf(String(d.societyId)), to: "/app/documents" });
  }
  for (const p of people) {
    results.push({ kind: "person", id: String(p._id), title: p.fullName, societyId: null, societyName: null, to: "/app/people-directory" });
  }
  return results;
}
