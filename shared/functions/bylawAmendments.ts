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
import { getOwned, requireSocietyMembership } from "./access";
import { evaluateSpecialResolution, SPECIAL_RESOLUTION_CITATION, voteCountProblems } from "../bylawGovernance";
import { getActiveBylawRuleSet } from "./bylawRules";

const nowEvent = (actor: string, action: string, note?: string) => ({
  atISO: new Date().toISOString(),
  actor,
  action,
  note,
});

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("bylawAmendments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const row = await ctx.db.get(id, "bylawAmendments");
  if (!row) return null;
  await requireSocietyMembership(ctx, String(row.societyId));
  return getOwned(ctx, "bylawAmendments", id, String(row.societyId));
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
  await requireSocietyMembership(ctx, args.societyId);
  if (!String(args.title ?? "").trim()) throw new Error("Add a title for this amendment first.");
  const now = new Date().toISOString();
  return ctx.db.insert("bylawAmendments", {
    ...args,
    title: args.title.trim(),
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
  const candidate = await ctx.db.get(id, "bylawAmendments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "bylawAmendments", id, String(candidate.societyId));
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
  const amendment = await ctx.db.get(amendmentId, "bylawAmendments");
  if (!amendment) throw new Error("bylawAmendments not found.");
  await requireSocietyMembership(ctx, String(amendment.societyId));
  await getOwned(ctx, "bylawAmendments", amendmentId, String(amendment.societyId));
  const rows = await ctx.db
    .query("bylawSections")
    .withIndex("by_amendment", (q) => q.eq("amendmentId", amendmentId))
    .collect();
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const amendment = await ctx.db.get(id, "bylawAmendments");
  if (!amendment) return;
  await requireSocietyMembership(ctx, String(amendment.societyId));
  await getOwned(ctx, "bylawAmendments", id, String(amendment.societyId));
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
  const candidate = await ctx.db.get(id, "bylawAmendments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "bylawAmendments", id, String(candidate.societyId));
  if (!row || row.status !== "Draft") return;
  const now = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "Consultation",
    consultationStartedAtISO: now,
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "consultation_started", "Open for member consultation")],
  });
}

/**
 * Record the special-resolution vote on a bylaw amendment (G-05).
 *
 * A bylaw alteration needs a special resolution (BC Societies Act s.17(1)): at
 * least two-thirds of the votes cast, or the higher majority in the society's
 * bylaw rules (s.1(1)). Counts must be whole and non-negative. A vote below the
 * threshold is recorded as a failed resolution (history event, status stays in
 * consultation) and never marks the amendment "ResolutionPassed".
 */
export async function markResolutionPassedPortable(
  ctx: PortableMutationCtx,
  { id, meetingId, votesFor, votesAgainst, abstentions, actor, resolutionDateISO }: {
    id: string;
    meetingId?: string;
    votesFor?: number;
    votesAgainst?: number;
    abstentions?: number;
    actor?: string;
    resolutionDateISO?: string;
  },
) {
  const candidate = await ctx.db.get(id, "bylawAmendments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "bylawAmendments", id, String(candidate.societyId));
  if (!row) return;
  if (row.status !== "Consultation" && row.status !== "Draft") {
    throw new Error(`A resolution can only be recorded for an amendment in consultation (this one is ${row.status}).`);
  }
  let meeting: any = null;
  if (meetingId) meeting = await getOwned(ctx, "meetings", meetingId, String(row.societyId));
  const problems = voteCountProblems({ votesFor, votesAgainst, abstentions }, { requireVotesFor: true });
  if (problems.length) throw new Error(`Resolution vote not recorded: ${problems.join(" ")}`);
  const now = new Date().toISOString();
  const resolutionDate = String(resolutionDateISO ?? meeting?.scheduledAt ?? "").slice(0, 10);
  // Allow one day of clock skew: a user ahead of UTC may legitimately be on
  // "tomorrow" relative to the server's UTC date.
  const latestAllowed = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (resolutionDate && (!/^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) || resolutionDate > latestAllowed)) {
    throw new Error("The resolution date must be a valid date that is not in the future.");
  }
  const rules = await getActiveBylawRuleSet(ctx, String(row.societyId));
  const result = evaluateSpecialResolution({ votesFor, votesAgainst }, rules?.specialResolutionThresholdPct);
  const note = `For ${votesFor} · Against ${votesAgainst ?? 0} · Abstain ${abstentions ?? 0}. ${result.summary}`;
  if (!result.passed) {
    await ctx.db.patch(id, {
      updatedAtISO: now,
      history: [...row.history, nowEvent(actor ?? "You", "resolution_failed", `${note} Not passed as a special resolution (${SPECIAL_RESOLUTION_CITATION}).`)],
    });
    return { ...result, passed: false };
  }
  const passedAtISO = resolutionDate ? `${resolutionDate}T00:00:00.000Z` : now;
  await ctx.db.patch(id, {
    status: "ResolutionPassed",
    resolutionMeetingId: meetingId,
    resolutionPassedAtISO: passedAtISO,
    consultationEndedAtISO: row.consultationEndedAtISO ?? passedAtISO,
    votesFor,
    votesAgainst,
    abstentions,
    updatedAtISO: now,
    history: [...row.history, nowEvent(actor ?? "You", "resolution_passed", note)],
  });
  return { ...result, passed: true };
}

export async function markFiledPortable(
  ctx: PortableMutationCtx,
  { id, filingId, actor }: { id: string; filingId?: string; actor?: string },
) {
  const candidate = await ctx.db.get(id, "bylawAmendments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "bylawAmendments", id, String(candidate.societyId));
  if (filingId) await getOwned(ctx, "filings", filingId, String(row.societyId));
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
  const candidate = await ctx.db.get(id, "bylawAmendments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "bylawAmendments", id, String(candidate.societyId));
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
  const candidate = await ctx.db.get(id, "bylawAmendments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const row = await getOwned(ctx, "bylawAmendments", id, String(candidate.societyId));
  if (!row) return;
  if (row.status === "Withdrawn") {
    throw new Error("Withdrawn amendments cannot be superseded.");
  }
  if (supersededByAmendmentId) {
    await getOwned(
      ctx,
      "bylawAmendments",
      supersededByAmendmentId,
      String(row.societyId),
    );
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
  const candidate = await ctx.db.get(amendmentId, "bylawAmendments");
  if (!candidate) throw new Error("bylawAmendments not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  const amendment = await getOwned(
    ctx,
    "bylawAmendments",
    amendmentId,
    String(candidate.societyId),
  );
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
