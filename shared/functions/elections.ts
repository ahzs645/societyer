/**
 * PORTABLE FUNCTIONS: the elections domain (the pure `ctx.db` handlers).
 *
 * Only the handlers that depend solely on `ctx.db` live here; the role-gated
 * mutations (which call `requireRole` / `getActiveBylawRuleSet`) remain on
 * Convex. Each handler below runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { getActiveBylawRuleSet } from "./bylawRules";

// Portable, dep-free copy of the role hierarchy from `convex/users.ts`.
const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"] as const;
type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  Owner: 100,
  Admin: 80,
  Director: 60,
  Member: 40,
  Viewer: 20,
};

function canActAs(actual: Role | undefined | null, required: Role): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

function fullName(member: { firstName: string; lastName: string }) {
  return `${member.firstName} ${member.lastName}`.trim();
}

function receiptCode() {
  return `BAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function logAudit(
  ctx: PortableMutationCtx,
  args: {
    societyId: string | undefined;
    electionId: string;
    actorName: string;
    action: string;
    detail?: string;
  },
) {
  await ctx.db.insert("electionAuditEvents", {
    ...args,
    societyId: String(args.societyId),
    createdAtISO: new Date().toISOString(),
  });
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("elections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(
  ctx: PortableQueryCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const election = await ctx.db.get(id);
  if (!election) return null;
  const [questions, eligible, ballots, audit] = await Promise.all([
    ctx.db
      .query("electionQuestions")
      .withIndex("by_election", (q) => q.eq("electionId", id))
      .collect(),
    ctx.db
      .query("electionEligibleVoters")
      .withIndex("by_election", (q) => q.eq("electionId", id))
      .collect(),
    ctx.db
      .query("electionBallots")
      .withIndex("by_election", (q) => q.eq("electionId", id))
      .collect(),
    ctx.db
      .query("electionAuditEvents")
      .withIndex("by_election", (q) => q.eq("electionId", id))
      .collect(),
  ]);
  const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
  const canSeeSensitive =
    !!actor &&
    actor.societyId === election.societyId &&
    canActAs(actor.role as any, "Director");
  const viewerEligibility =
    actor?.memberId && !canSeeSensitive
      ? eligible.filter((row) => row.memberId === actor.memberId)
      : [];
  return {
    election,
    questions: questions.sort((a, b) => a.order - b.order),
    eligible: canSeeSensitive ? eligible : viewerEligibility,
    ballots: canSeeSensitive ? ballots : [],
    ballotCount: ballots.length,
    audit: canSeeSensitive ? audit.sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO)) : [],
    canSeeSensitive,
  };
}

export async function listNominationsPortable(
  ctx: PortableQueryCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await ctx.db.get(electionId);
  if (!election) return [];
  const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
  const canManage =
    !!actor &&
    actor.societyId === election.societyId &&
    canActAs(actor.role as any, "Director");
  const rows = await ctx.db
    .query("electionNominations")
    .withIndex("by_election", (q) => q.eq("electionId", electionId))
    .collect();
  const visible = canManage
    ? rows
    : rows.filter(
        (row) =>
          row.submittedByUserId === actingUserId || row.status === "OnBallot",
      );
  return visible.sort((a, b) => b.submittedAtISO.localeCompare(a.submittedAtISO));
}

export async function listMinePortable(
  ctx: PortableQueryCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
  if (!userId) return [];
  const user = await ctx.db.get(userId);
  if (!user?.memberId) return [];
  const eligibility = await ctx.db
    .query("electionEligibleVoters")
    .withIndex("by_member", (q) => q.eq("memberId", user.memberId!))
    .collect();
  const electionIds = [...new Set(eligibility.map((row) => row.electionId))];
  const elections = await Promise.all(electionIds.map((id) => ctx.db.get(id)));
  return elections
    .filter((row): row is NonNullable<typeof row> => !!row && row.societyId === societyId)
    .map((election) => ({
      election,
      eligibility:
        eligibility.find((row) => row.electionId === election._id) ?? null,
    }));
}

export async function submitNominationPortable(
  ctx: PortableMutationCtx,
  args: {
    electionId: string;
    questionId?: string;
    nomineeName: string;
    nomineeEmail?: string;
    statement?: string;
    actingUserId?: string;
  },
) {
  const election = await ctx.db.get(args.electionId);
  if (!election) throw new Error("Election not found.");
  if (!args.actingUserId) throw new Error("A signed-in member is required.");
  const actor = await ctx.db.get(args.actingUserId);
  if (!actor?.memberId) throw new Error("Only confirmed members can submit nominations.");
  const nowISO = new Date().toISOString();
  if (election.nominationsOpenAtISO && nowISO < election.nominationsOpenAtISO) {
    throw new Error("Nominations are not open yet.");
  }
  if (election.nominationsCloseAtISO && nowISO > election.nominationsCloseAtISO) {
    throw new Error("Nominations are closed.");
  }
  const id = await ctx.db.insert("electionNominations", {
    societyId: election.societyId,
    electionId: args.electionId,
    questionId: args.questionId,
    memberId: actor.memberId,
    nomineeName: args.nomineeName,
    nomineeEmail: args.nomineeEmail,
    statement: args.statement,
    status: "Submitted",
    submittedByUserId: args.actingUserId,
    submittedAtISO: nowISO,
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId: args.electionId,
    actorName: actor.displayName,
    action: "nomination-submitted",
    detail: args.nomineeName,
  });
  return id;
}

export async function castBallotPortable(
  ctx: PortableMutationCtx,
  { electionId, choices, actingUserId }: {
    electionId: string;
    choices: { questionId: string; optionIds: string[] }[];
    actingUserId?: string;
  },
) {
  const election = await ctx.db.get(electionId);
  if (!election) throw new Error("Election not found.");
  if (election.status !== "Open") {
    throw new Error("Election is not open for voting.");
  }
  if (!actingUserId) {
    throw new Error("Authentication is required to cast a ballot.");
  }
  const user = await ctx.db.get(actingUserId);
  if (!user?.memberId) {
    throw new Error("Only confirmed members can cast a ballot.");
  }

  const eligibility = (
    await ctx.db
      .query("electionEligibleVoters")
      .withIndex("by_election_member", (q) =>
        q.eq("electionId", electionId).eq("memberId", user.memberId!),
      )
      .collect()
  )[0];

  if (!eligibility || eligibility.revokedAtISO) {
    throw new Error("This member is not eligible to vote in this election.");
  }
  if (eligibility.status === "Voted") {
    throw new Error("A ballot has already been cast for this member.");
  }

  const questions = await ctx.db
    .query("electionQuestions")
    .withIndex("by_election", (q) => q.eq("electionId", electionId))
    .collect();
  for (const choice of choices) {
    const question = questions.find((row) => row._id === choice.questionId);
    if (!question) throw new Error("Election question not found.");
    if (choice.optionIds.length === 0) {
      throw new Error("Each question must have at least one selection.");
    }
    if (choice.optionIds.length > question.maxSelections) {
      throw new Error(
        `Question "${question.title}" allows at most ${question.maxSelections} selection(s).`,
      );
    }
    for (const optionId of choice.optionIds) {
      if (!question.options.some((option: Record<string, any>) => option.id === optionId)) {
        throw new Error("Invalid ballot selection.");
      }
    }
  }

  const submittedAtISO = new Date().toISOString();
  const ballotId = await ctx.db.insert("electionBallots", {
    societyId: election.societyId,
    electionId,
    receiptCode: receiptCode(),
    submittedAtISO,
    choices,
  });

  await ctx.db.patch(eligibility._id, {
    status: "Voted",
    confirmedAtISO: eligibility.confirmedAtISO ?? submittedAtISO,
    votedAtISO: submittedAtISO,
    userId: eligibility.userId ?? user._id,
  });
  await ctx.db.patch(electionId, {
    updatedAtISO: submittedAtISO,
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId,
    actorName: user.displayName,
    action: "ballot-cast",
    detail: "Anonymous ballot stored; voter linkage kept in eligibility ledger only.",
  });
  return ballotId;
}

export async function tallyPortable(
  ctx: PortableQueryCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await ctx.db.get(electionId);
  if (!election) return [];
  const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
  const canSeeLiveResults =
    !!actor &&
    actor.societyId === election.societyId &&
    canActAs(actor.role as any, "Director");
  if (election.status === "Open" && !canSeeLiveResults) {
    return [];
  }
  const [questions, ballots] = await Promise.all([
    ctx.db
      .query("electionQuestions")
      .withIndex("by_election", (q) => q.eq("electionId", electionId))
      .collect(),
    ctx.db
      .query("electionBallots")
      .withIndex("by_election", (q) => q.eq("electionId", electionId))
      .collect(),
  ]);
  return questions.map((question) => {
    const counts = new Map<string, number>();
    for (const option of question.options) counts.set(option.id, 0);
    for (const ballot of ballots) {
      const choice = ballot.choices.find((row: Record<string, any>) => row.questionId === question._id);
      if (!choice) continue;
      for (const optionId of choice.optionIds) {
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
      }
    }
    return {
      questionId: question._id,
      title: question.title,
      totals: question.options.map((option: Record<string, any>) => ({
        id: option.id,
        label: option.label,
        votes: counts.get(option.id) ?? 0,
      })),
    };
  });
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId?: string;
    title: string;
    description?: string;
    opensAtISO: string;
    closesAtISO: string;
    nominationsOpenAtISO?: string;
    nominationsCloseAtISO?: string;
    eligibilityCutoffISO?: string;
    scrutineerUserIds?: string[];
    notes?: string;
    actingUserId?: string;
  },
) {
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const rules = await getActiveBylawRuleSet(ctx, args.societyId);
  const id = await ctx.db.insert("elections", {
    societyId: args.societyId,
    meetingId: args.meetingId,
    title: args.title,
    description: args.description,
    status: "Draft",
    opensAtISO: args.opensAtISO,
    closesAtISO: args.closesAtISO,
    nominationsOpenAtISO: args.nominationsOpenAtISO,
    nominationsCloseAtISO: args.nominationsCloseAtISO,
    eligibilityCutoffISO: args.eligibilityCutoffISO,
    anonymousBallot: rules.ballotIsAnonymous,
    scrutineerUserIds: args.scrutineerUserIds,
    createdByUserId: args.actingUserId,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
    notes: args.notes,
  });
  await logAudit(ctx, {
    societyId: args.societyId,
    electionId: id,
    actorName: user?.displayName ?? "System",
    action: "created",
    detail: args.title,
  });
  return id;
}

export async function updateSettingsPortable(
  ctx: PortableMutationCtx,
  args: {
    electionId: string;
    nominationsOpenAtISO?: string;
    nominationsCloseAtISO?: string;
    scrutineerUserIds?: string[];
    resultsSummary?: string;
    evidenceDocumentId?: string;
    actingUserId?: string;
  },
) {
  const election = await ctx.db.get(args.electionId);
  if (!election) throw new Error("Election not found.");
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: String(election.societyId),
    required: "Director",
  });
  await ctx.db.patch(args.electionId, {
    nominationsOpenAtISO: args.nominationsOpenAtISO,
    nominationsCloseAtISO: args.nominationsCloseAtISO,
    scrutineerUserIds: args.scrutineerUserIds,
    resultsSummary: args.resultsSummary,
    evidenceDocumentId: args.evidenceDocumentId,
    updatedAtISO: new Date().toISOString(),
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId: args.electionId,
    actorName: user?.displayName ?? "System",
    action: "settings-updated",
  });
}

export async function addQuestionPortable(
  ctx: PortableMutationCtx,
  args: {
    electionId: string;
    title: string;
    description?: string;
    maxSelections: number;
    options: { id: string; label: string; memberId?: string; statement?: string }[];
    actingUserId?: string;
  },
) {
  const election = await ctx.db.get(args.electionId);
  if (!election) throw new Error("Election not found.");
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: String(election.societyId),
    required: "Director",
  });
  const existing = await ctx.db
    .query("electionQuestions")
    .withIndex("by_election", (q) => q.eq("electionId", args.electionId))
    .collect();
  const id = await ctx.db.insert("electionQuestions", {
    societyId: election.societyId,
    electionId: args.electionId,
    title: args.title,
    description: args.description,
    maxSelections: args.maxSelections,
    options: args.options,
    order: existing.length,
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId: args.electionId,
    actorName: user?.displayName ?? "System",
    action: "question-added",
    detail: args.title,
  });
  return id;
}

export async function reviewNominationPortable(
  ctx: PortableMutationCtx,
  { id, status, actingUserId }: { id: string; status: string; actingUserId?: string },
) {
  const nomination = await ctx.db.get(id);
  if (!nomination) throw new Error("Nomination not found.");
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(nomination.societyId),
    required: "Director",
  });
  await ctx.db.patch(id, {
    status,
    reviewedByUserId: actingUserId,
    reviewedAtISO: new Date().toISOString(),
  });
  await logAudit(ctx, {
    societyId: nomination.societyId,
    electionId: nomination.electionId,
    actorName: user?.displayName ?? "System",
    action: "nomination-reviewed",
    detail: `${nomination.nomineeName}: ${status}`,
  });
}

export async function publishNominationToBallotPortable(
  ctx: PortableMutationCtx,
  { id, questionId, actingUserId }: { id: string; questionId: string; actingUserId?: string },
) {
  const nomination = await ctx.db.get(id);
  if (!nomination) throw new Error("Nomination not found.");
  const question = await ctx.db.get(questionId);
  if (!question || question.electionId !== nomination.electionId) {
    throw new Error("Election question not found.");
  }
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(nomination.societyId),
    required: "Director",
  });
  const optionId = `nomination-${id}`;
  const hasOption = question.options.some((option: Record<string, any>) => option.id === optionId);
  if (!hasOption) {
    await ctx.db.patch(questionId, {
      options: [
        ...question.options,
        {
          id: optionId,
          label: nomination.nomineeName,
          memberId: nomination.memberId,
          statement: nomination.statement,
        },
      ],
    });
  }
  await ctx.db.patch(id, {
    questionId,
    status: "OnBallot",
    reviewedByUserId: actingUserId,
    reviewedAtISO: new Date().toISOString(),
    addedToBallotAtISO: new Date().toISOString(),
  });
  await logAudit(ctx, {
    societyId: nomination.societyId,
    electionId: nomination.electionId,
    actorName: user?.displayName ?? "System",
    action: "nomination-added-to-ballot",
    detail: nomination.nomineeName,
  });
}

export async function snapshotEligibleVotersPortable(
  ctx: PortableMutationCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await ctx.db.get(electionId);
  if (!election) throw new Error("Election not found.");
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(election.societyId),
    required: "Director",
  });
  const rules = await getActiveBylawRuleSet(ctx, String(election.societyId));
  const members = await ctx.db
    .query("members")
    .withIndex("by_society", (q) => q.eq("societyId", election.societyId))
    .collect();
  const users = await ctx.db
    .query("users")
    .withIndex("by_society", (q) => q.eq("societyId", election.societyId))
    .collect();
  const existing = await ctx.db
    .query("electionEligibleVoters")
    .withIndex("by_election", (q) => q.eq("electionId", electionId))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);

  const eligibleMembers = members.filter((member) =>
    rules.voterMustBeMemberAtRecordDate
      ? member.status === "Active" && member.votingRights
      : member.votingRights,
  );

  for (const member of eligibleMembers) {
    const linkedUser =
      users.find((candidate) => candidate.memberId === member._id) ??
      users.find(
        (candidate) =>
          candidate.email &&
          member.email &&
          candidate.email.toLowerCase() === member.email.toLowerCase(),
      );
    await ctx.db.insert("electionEligibleVoters", {
      societyId: election.societyId,
      electionId,
      memberId: member._id,
      userId: linkedUser?._id,
      email: member.email,
      fullName: fullName(member as any),
      status: "Eligible",
      eligibilityReason: "Active voting member at snapshot time",
      createdAtISO: new Date().toISOString(),
    });
  }

  await ctx.db.patch(electionId, {
    updatedAtISO: new Date().toISOString(),
    status: election.status === "Draft" ? "Open" : election.status,
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId,
    actorName: user?.displayName ?? "System",
    action: "eligibility-snapshotted",
    detail: `${eligibleMembers.length} eligible voters`,
  });
  return { eligibleCount: eligibleMembers.length };
}

export async function closePortable(
  ctx: PortableMutationCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await ctx.db.get(electionId);
  if (!election) throw new Error("Election not found.");
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(election.societyId),
    required: "Director",
  });
  await ctx.db.patch(electionId, {
    status: "Closed",
    updatedAtISO: new Date().toISOString(),
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId,
    actorName: user?.displayName ?? "System",
    action: "closed",
  });
}

export async function tallyElectionPortable(
  ctx: PortableMutationCtx,
  { electionId, resultsSummary, evidenceDocumentId, actingUserId }: {
    electionId: string;
    resultsSummary?: string;
    evidenceDocumentId?: string;
    actingUserId?: string;
  },
) {
  const election = await ctx.db.get(electionId);
  if (!election) throw new Error("Election not found.");
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(election.societyId),
    required: "Director",
  });
  if (election.status === "Open") {
    throw new Error("Close the election before publishing results.");
  }
  await ctx.db.patch(electionId, {
    status: "Tallied",
    talliedAtISO: new Date().toISOString(),
    resultsPublishedAtISO: new Date().toISOString(),
    resultsSummary,
    evidenceDocumentId,
    updatedAtISO: new Date().toISOString(),
  });
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId,
    actorName: user?.displayName ?? "System",
    action: "tallied",
    detail: "Election results marked as published.",
  });
}
