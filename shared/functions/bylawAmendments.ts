/**
 * PORTABLE FUNCTIONS: the bylaw-amendments domain (list / get / createDraft /
 * updateDraft / sectionsForAmendment / remove).
 *
 * Reads/writes the `bylawAmendments` and `bylawSections` tables over `ctx.db`.
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 *
 * NOTE: the status-transition mutations (startConsultation, markResolutionPassed,
 * markFiled, withdraw, supersede) and materializeSections remain in the static
 * PENDING ledger — only the pure-ctx.db handlers are ported here.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

const nowEvent = (actor: string, action: string, note?: string) => ({
  atISO: new Date().toISOString(),
  actor,
  action,
  note,
});

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("bylawAmendments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function createDraftPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    baseText: string;
    proposedText: string;
    createdByName?: string;
    notes?: string;
  },
) {
  const now = new Date().toISOString();
  return ctx.db.insert("bylawAmendments", {
    ...args,
    status: "Draft",
    createdAtISO: now,
    updatedAtISO: now,
    history: [nowEvent(args.createdByName ?? "You", "created", "Draft started")],
  });
}

export async function updateDraftPortable(
  ctx: PortableMutationCtx,
  { id, patch, actor }: {
    id: string;
    patch: {
      title?: string;
      proposedText?: string;
      baseText?: string;
      notes?: string;
    };
    actor?: string;
  },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  if (row.status !== "Draft") {
    throw new Error("Only drafts can be edited — withdraw or supersede to change a non-draft amendment.");
  }
  const history = [...row.history, nowEvent(actor ?? "You", "edited")];
  await ctx.db.patch(id, {
    ...patch,
    updatedAtISO: new Date().toISOString(),
    history,
  });
}

export async function sectionsForAmendmentPortable(
  ctx: PortableQueryCtx,
  { amendmentId }: { amendmentId: string },
) {
  const rows = await ctx.db
    .query("bylawSections")
    .withIndex("by_amendment", (q) => q.eq("amendmentId", amendmentId))
    .collect();
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  // Clean up materialized section records when the amendment is deleted.
  const sections = await ctx.db
    .query("bylawSections")
    .withIndex("by_amendment", (q) => q.eq("amendmentId", id))
    .collect();
  for (const row of sections) await ctx.db.delete(row._id);
  await ctx.db.delete(id);
}
