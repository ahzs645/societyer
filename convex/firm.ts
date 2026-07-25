import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { organizationKind, organizationLabel } from "../shared/organizationDomain";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { generatePacketForSociety } from "./legalOperations";
import { overviewPortable, searchPortable } from "../shared/functions/firm";
import { toPortableQueryCtx } from "./lib/portable";

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

export const overview = query({
  args: { todayISO: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => overviewPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => searchPortable(await toPortableQueryCtx(ctx), args),
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
