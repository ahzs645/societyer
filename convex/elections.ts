import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { canActAs, requireRole } from "./users";
import { getActiveBylawRuleSet } from "./lib/bylawRules";
import {
  listPortable,
  getPortable,
  listNominationsPortable,
  listMinePortable,
  submitNominationPortable,
  castBallotPortable,
  tallyPortable,
} from "../shared/functions/elections";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

function fullName(member: { firstName: string; lastName: string }) {
  return `${member.firstName} ${member.lastName}`.trim();
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
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: {
    id: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const listNominations = query({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => listNominationsPortable(toPortableQueryCtx(ctx), args),
});

export const listMine = query({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => listMinePortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    description: v.optional(v.string()),
    opensAtISO: v.string(),
    closesAtISO: v.string(),
    nominationsOpenAtISO: v.optional(v.string()),
    nominationsCloseAtISO: v.optional(v.string()),
    eligibilityCutoffISO: v.optional(v.string()),
    scrutineerUserIds: v.optional(v.array(v.id("users"))),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
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
  },
});

export const updateSettings = mutation({
  args: {
    electionId: v.id("elections"),
    nominationsOpenAtISO: v.optional(v.string()),
    nominationsCloseAtISO: v.optional(v.string()),
    scrutineerUserIds: v.optional(v.array(v.id("users"))),
    resultsSummary: v.optional(v.string()),
    evidenceDocumentId: v.optional(v.id("documents")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const election = await ctx.db.get(args.electionId);
    if (!election) throw new Error("Election not found.");
    const { user } = await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: election.societyId,
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
  returns: v.any(),
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

export const submitNomination = mutation({
  args: {
    electionId: v.id("elections"),
    questionId: v.optional(v.id("electionQuestions")),
    nomineeName: v.string(),
    nomineeEmail: v.optional(v.string()),
    statement: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => submitNominationPortable(toPortableMutationCtx(ctx), args),
});

export const reviewNomination = mutation({
  args: {
    id: v.id("electionNominations"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, actingUserId }) => {
    const nomination = await ctx.db.get(id);
    if (!nomination) throw new Error("Nomination not found.");
    const { user } = await requireRole(ctx, {
      actingUserId,
      societyId: nomination.societyId,
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
  },
});

export const publishNominationToBallot = mutation({
  args: {
    id: v.id("electionNominations"),
    questionId: v.id("electionQuestions"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, questionId, actingUserId }) => {
    const nomination = await ctx.db.get(id);
    if (!nomination) throw new Error("Nomination not found.");
    const question = await ctx.db.get(questionId);
    if (!question || question.electionId !== nomination.electionId) {
      throw new Error("Election question not found.");
    }
    const { user } = await requireRole(ctx, {
      actingUserId,
      societyId: nomination.societyId,
      required: "Director",
    });
    const optionId = `nomination-${id}`;
    const hasOption = question.options.some((option) => option.id === optionId);
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
  },
});

export const snapshotEligibleVoters = mutation({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
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
  returns: v.any(),
  handler: (ctx, args) => castBallotPortable(toPortableMutationCtx(ctx), args),
});

export const close = mutation({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
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

export const tallyElection = mutation({
  args: {
    electionId: v.id("elections"),
    resultsSummary: v.optional(v.string()),
    evidenceDocumentId: v.optional(v.id("documents")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { electionId, resultsSummary, evidenceDocumentId, actingUserId }) => {
    const election = await ctx.db.get(electionId);
    if (!election) throw new Error("Election not found.");
    const { user } = await requireRole(ctx, {
      actingUserId,
      societyId: election.societyId,
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
  },
});

export const tally = query({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => tallyPortable(toPortableQueryCtx(ctx), args),
});
