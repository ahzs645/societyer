import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  listNominationsPortable,
  listMinePortable,
  submitNominationPortable,
  castBallotPortable,
  tallyPortable,
  createPortable,
  updateSettingsPortable,
  addQuestionPortable,
  reviewNominationPortable,
  publishNominationToBallotPortable,
  snapshotEligibleVotersPortable,
  closePortable,
  tallyElectionPortable,
} from "../shared/functions/elections";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: {
    id: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const listNominations = query({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => listNominationsPortable(await toPortableQueryCtx(ctx), args),
});

export const listMine = query({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => listMinePortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => updateSettingsPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => addQuestionPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => submitNominationPortable(await toPortableMutationCtx(ctx), args),
});

export const reviewNomination = mutation({
  args: {
    id: v.id("electionNominations"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => reviewNominationPortable(await toPortableMutationCtx(ctx), args),
});

export const publishNominationToBallot = mutation({
  args: {
    id: v.id("electionNominations"),
    questionId: v.id("electionQuestions"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => publishNominationToBallotPortable(await toPortableMutationCtx(ctx), args),
});

export const snapshotEligibleVoters = mutation({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => snapshotEligibleVotersPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => castBallotPortable(await toPortableMutationCtx(ctx), args),
});

export const close = mutation({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => closePortable(await toPortableMutationCtx(ctx), args),
});

export const tallyElection = mutation({
  args: {
    electionId: v.id("elections"),
    resultsSummary: v.optional(v.string()),
    evidenceDocumentId: v.optional(v.id("documents")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => tallyElectionPortable(await toPortableMutationCtx(ctx), args),
});

export const tally = query({
  args: {
    electionId: v.id("elections"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => tallyPortable(await toPortableQueryCtx(ctx), args),
});
