"use node";
/** One-time streaming checksum verification; does not retain a whole taxonomy in memory. */
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { procurementTaxonomyIndexFields } from "./tables/procurement";

export const finishTaxonomy = internalAction({
  args: { societyId: v.id("societies"), ...procurementTaxonomyIndexFields }, returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(internal.procurementImport.taxonomyState, { societyId: args.societyId, releaseId: args.releaseId });
    if (!state || state.contentHash !== args.contentHash || state.count !== args.count) throw new Error("Taxonomy reservation mismatch.");
    if (state.status === "ready") return null;
    // Verify both unique ordered keys and the exact canonical content, once per release.
    const digest = createHash("sha256"); let total = 0; let cursor: string | null = null; let last = "";
    for (;;) {
      const page: { terms: { key: string; releaseId: string; scheme: string; version: string; code: string; title: string; parentKey: string | null }[]; cursor: string; done: boolean } = await ctx.runQuery(internal.procurementImport.termsPage, { societyId: args.societyId, releaseId: args.releaseId, cursor });
      for (const term of page.terms) {
        if (term.key <= last) throw new Error("Duplicate or unordered taxonomy keys.");
        last = term.key;
        digest.update(JSON.stringify(Object.fromEntries(Object.entries(term).sort(([a], [b]) => a.localeCompare(b)))) + "\n"); total++;
      }
      if (total > args.count) throw new Error("Taxonomy contains duplicate or unexpected rows.");
      if (page.done) break; cursor = page.cursor;
    }
    if (total !== args.count) throw new Error("Taxonomy import is incomplete.");
    const hash = digest.digest("hex");
    if (hash !== args.contentHash) throw new Error("Taxonomy content hash differs from the verified source.");
    await ctx.runMutation(internal.procurementImport.commitTaxonomy, args); return null;
  },
});

