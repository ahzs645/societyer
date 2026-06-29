/**
 * PORTABLE FUNCTIONS: the firm-wide (cross-entity) layer.
 *
 * `overviewPortable` rolls up each entity's open deadlines + post-incorporation
 * progress over `ctx.db`, running unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * The `search` (search-index) and `batchGeneratePacket` (raw-ctx packet
 * generation) handlers stay in convex/firm.ts; they fall outside the portable
 * `ctx.db` contract.
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
