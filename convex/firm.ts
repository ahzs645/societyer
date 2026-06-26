import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { organizationKind, organizationLabel } from "../shared/organizationDomain";
import { postIncorporationStepsForOrganization } from "../shared/postIncorporationSteps";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { generatePacketForSociety } from "./legalOperations";

/** The entity kind a packet applies to ("corporation" | "society"), or null. */
function packetKindFor(packetKey: string): string | null {
  if (CORPORATION_DOCUMENT_PACKETS.some((p) => p.key === packetKey)) return "corporation";
  if (SOCIETY_DOCUMENT_PACKETS.some((p) => p.key === packetKey)) return "society";
  return null;
}

/**
 * Firm-wide (cross-entity) layer — the "manage all my corporations at once"
 * surface the per-entity views can't give. `overview` rolls up each entity's
 * open deadlines + post-incorporation progress; `batchGeneratePacket` is the
 * Multiple_Copy analogue: generate one document packet across many entities.
 */

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

export const overview = query({
  args: { todayISO: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { todayISO }) => {
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
  },
});

/**
 * Cross-entity full-text search over deadlines, documents, and people. Fans out
 * the per-table search indexes globally (no society filter) so one query spans
 * every entity, then resolves each hit's entity name. Powers the command
 * palette's "Across entities" group.
 */
export const search = query({
  args: { query: v.string() },
  returns: v.any(),
  handler: async (ctx, { query: term }) => {
    const q = String(term ?? "").trim();
    if (q.length < 2) return [];
    const [deadlines, documents, people] = await Promise.all([
      ctx.db.query("deadlines").withSearchIndex("search_title", (s: any) => s.search("title", q)).take(12),
      ctx.db.query("documents").withSearchIndex("search_title", (s: any) => s.search("title", q)).take(12),
      ctx.db.query("peopleDirectory").withSearchIndex("search_full_name", (s: any) => s.search("fullName", q)).take(12),
    ]);

    const societyById = new Map<string, any>();
    for (const id of new Set<string>([...deadlines, ...documents].map((r: any) => String(r.societyId)))) {
      const s = await ctx.db.get(id as any);
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
  },
});

export const batchGeneratePacket = mutation({
  args: {
    societyIds: v.array(v.id("societies")),
    packetKey: v.string(),
    effectiveDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { societyIds, packetKey, effectiveDate }) => {
    const wantKind = packetKindFor(packetKey);
    const results: Array<{ societyId: string; ok: boolean; runId?: string; error?: string }> = [];
    for (const societyId of societyIds) {
      const society = await ctx.db.get(societyId);
      if (society && wantKind && organizationKind(society as any) !== wantKind) {
        results.push({ societyId: String(societyId), ok: false, error: `skipped: ${packetKey} applies to ${wantKind} entities` });
        continue;
      }
      try {
        const result = await generatePacketForSociety(ctx, { societyId, packetKey, effectiveDate });
        results.push({ societyId: String(societyId), ok: true, runId: String(result.runId) });
      } catch (err: any) {
        results.push({ societyId: String(societyId), ok: false, error: err?.message ?? String(err) });
      }
    }
    return {
      packetKey,
      generated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  },
});
