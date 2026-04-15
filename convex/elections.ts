import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import { getActiveBylawRuleSet } from "./lib/bylawRules";

function fullName(member: { firstName: string; lastName: string }) {
  return `${member.firstName} ${member.lastName}`.trim();
}

function receiptCode() {
  return `BAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function logAudit(
  ctx: any,
  args: {
    societyId: Id<"societies">;
    electionId: Id<"elections">;
    actorName: string;
    action: string;
    detail?: string;
  },
) {
  await ctx.db.insert("electionAuditEvents", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("elections")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("elections") },
  handler: async (ctx, { id }) => {
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
    return {
      election,
      questions: questions.sort((a, b) => a.order - b.order),
      eligible,
      ballots,
      audit: audit.sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO)),
    };
  },
});

export const listMine = query({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, { societyId, userId }) => {
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
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    description: v.optional(v.string()),
    opensAtISO: v.string(),
    closesAtISO: v.string(),
    eligibilityCutoffISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, {
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
      eligibilityCutoffISO: args.eligibilityCutoffISO,
      anonymousBallot: rules.ballotIsAnonymous,
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
  },
});

export const addQuestion = mutation({
  args: {
    electionId: v.id("elections"),
    title: v.string(),
    description: v.optional(v.string()),
    maxSelections: v.number(),
    options: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        memberId: v.optional(v.id("members")),
        statement: v.optional(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const election = await ctx.db.get(args.electionId);
    if (!election) throw new Error("Election not found.");
    const { user } = await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: election.societyId,
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
  },
});

export const snapshotEligibleVoters = mutation({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { electionId, actingUserId }) => {
    const election = await ctx.db.get(electionId);
    if (!election) throw new Error("Election not found.");
    const { user } = await requireRole(ctx, {
      actingUserId,
      societyId: election.societyId,
      required: "Director",
    });
    const rules = await getActiveBylawRuleSet(ctx, election.societyId);
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

    const eligibleMembers = members.filter(
      (member) =>
        rules.voterMustBeMemberAtRecordDate
          ? member.status === "Active" &&
            member.votingRights
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
        fullName: fullName(member),
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
  },
});

export const castBallot = mutation({
  args: {
    electionId: v.id("elections"),
    choices: v.array(
      v.object({
        questionId: v.id("electionQuestions"),
        optionIds: v.array(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { electionId, choices, actingUserId }) => {
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
        if (!question.options.some((option) => option.id === optionId)) {
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
  },
});

export const close = mutation({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { electionId, actingUserId }) => {
    const election = await ctx.db.get(electionId);
    if (!election) throw new Error("Election not found.");
    const { user } = await requireRole(ctx, {
      actingUserId,
      societyId: election.societyId,
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
  },
});

export const tally = query({
  args: { electionId: v.id("elections") },
  handler: async (ctx, { electionId }) => {
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
        const choice = ballot.choices.find((row) => row.questionId === question._id);
        if (!choice) continue;
        for (const optionId of choice.optionIds) {
          counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
        }
      }
      return {
        questionId: question._id,
        title: question.title,
        totals: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          votes: counts.get(option.id) ?? 0,
        })),
      };
    });
  },
});
