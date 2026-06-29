/**
 * PORTABLE FUNCTIONS: the bylaw-amendments domain (list / get / createDraft /
 * updateDraft / sectionsForAmendment / remove).
 *
 * Reads/writes the `bylawAmendments` and `bylawSections` tables over `ctx.db`.
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 *
 * The status-transition mutations (startConsultation, markResolutionPassed,
 * markFiled, withdraw, supersede) and materializeSections are pure `ctx.db`
 * state transitions, so they are ported here too.
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

export async function startConsultationPortable(
  ctx: PortableMutationCtx,
  { id, actor }: { id: string; actor?: string },
) {
  const row = await ctx.db.get(id);
  if (!row || row.status !== "Draft") return;
  const now = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "Consultation",
    consultationStartedAtISO: now,
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "consultation_started", "Open for member consultation")],
  });
}

export async function markResolutionPassedPortable(
  ctx: PortableMutationCtx,
  { id, meetingId, votesFor, votesAgainst, abstentions, actor }: {
    id: string;
    meetingId?: string;
    votesFor?: number;
    votesAgainst?: number;
    abstentions?: number;
    actor?: string;
  },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  const now = new Date().toISOString();
  const note = votesFor != null
    ? `For ${votesFor} · Against ${votesAgainst ?? 0} · Abstain ${abstentions ?? 0}`
    : undefined;
  await ctx.db.patch(id, {
    status: "ResolutionPassed",
    resolutionMeetingId: meetingId,
    resolutionPassedAtISO: now,
    consultationEndedAtISO: row.consultationEndedAtISO ?? now,
    votesFor,
    votesAgainst,
    abstentions,
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "resolution_passed", note)],
  });
}

export async function markFiledPortable(
  ctx: PortableMutationCtx,
  { id, filingId, actor }: { id: string; filingId?: string; actor?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  const now = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "Filed",
    filingId,
    filedAtISO: now,
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "filed", "Filed via Societies Online")],
  });
}

export async function withdrawPortable(
  ctx: PortableMutationCtx,
  { id, actor, reason }: { id: string; actor?: string; reason?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  const now = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "Withdrawn",
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "withdrawn", reason)],
  });
}

/** Mark an amendment Superseded — the status the UI already renders but that no
 *  mutation produced. Used when a fresh draft replaces a non-draft amendment
 *  (e.g. a revised version supersedes one in consultation), optionally linking
 *  the superseding amendment. Withdrawn amendments are terminal. */
export async function supersedePortable(
  ctx: PortableMutationCtx,
  { id, supersededByAmendmentId, actor, reason }: {
    id: string;
    supersededByAmendmentId?: string;
    actor?: string;
    reason?: string;
  },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  if (row.status === "Withdrawn") {
    throw new Error("Withdrawn amendments cannot be superseded.");
  }
  if (supersededByAmendmentId) {
    const replacement = await ctx.db.get(supersededByAmendmentId);
    if (!replacement || replacement.societyId !== row.societyId) {
      throw new Error("Superseding amendment must belong to the same society.");
    }
  }
  const now = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "Superseded",
    supersededAtISO: now,
    supersededByAmendmentId,
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "superseded", reason)],
  });
}

// Persist an amendment's proposed text as structured section records (replacing
// any prior set for that amendment). The client parses the text with
// shared/bylawSections so the section model is identical to the diff view.
export async function materializeSectionsPortable(
  ctx: PortableMutationCtx,
  { amendmentId, sections }: {
    amendmentId: string;
    sections: { heading: string; key: string; level: number; body: string }[];
  },
) {
  const amendment = await ctx.db.get(amendmentId);
  if (!amendment) throw new Error("Amendment not found.");
  const existing = await ctx.db
    .query("bylawSections")
    .withIndex("by_amendment", (q) => q.eq("amendmentId", amendmentId))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);

  const now = new Date().toISOString();
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    await ctx.db.insert("bylawSections", {
      societyId: amendment.societyId,
      amendmentId,
      order: i,
      heading: s.heading,
      key: s.key,
      level: s.level,
      body: s.body,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  return { stored: sections.length };
}
