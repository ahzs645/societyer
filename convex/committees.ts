import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { quorumRuleValidator } from "./validators/meetingModel";
import {
  committeeUpdateMemberPortable,
  committeesListPortable,
  committeeGetPortable,
  committeeDetailPortable,
  committeeCreatePortable,
  committeeUpdatePortable,
  committeeRemovePortable,
  committeeAddMemberPortable,
  committeeRemoveMemberPortable,
  committeeUpdateStructurePortable,
} from "../shared/functions/committees";
import { cadenceRuleValidator, committeeMandateVersionValidator } from "./validators/gaps";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("committees:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => committeesListPortable(await toPortableQueryCtx(ctx), args),
});

export const get = authorizedQuery("committees:get", query)({
  args: { id: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => committeeGetPortable(await toPortableQueryCtx(ctx), args),
});

export const detail = authorizedQuery("committees:detail", query)({
  args: { id: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => committeeDetailPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("committees:create", mutation)({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    mission: v.optional(v.string()),
    cadence: v.string(),
    cadenceNotes: v.optional(v.string()),
    chairDirectorId: v.optional(v.id("directors")),
    quorumRule: v.optional(quorumRuleValidator),
    bodyKey: v.optional(v.string()),
    color: v.string(),
    kind: v.optional(v.string()),
    parentBody: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeCreatePortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("committees:update", mutation)({
  args: {
    id: v.id("committees"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      mission: v.optional(v.string()),
      cadence: v.optional(v.string()),
      cadenceNotes: v.optional(v.string()),
      nextMeetingAt: v.optional(v.string()),
      chairDirectorId: v.optional(v.id("directors")),
      color: v.optional(v.string()),
      status: v.optional(v.string()),
      quorumRule: v.optional(quorumRuleValidator),
      clearQuorumRule: v.optional(v.boolean()),
      bodyKey: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeUpdatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("committees:remove", mutation)({
  args: { id: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => committeeRemovePortable(await toPortableMutationCtx(ctx), args),
});

export const addMember = authorizedMutation("committees:addMember", mutation)({
  args: {
    committeeId: v.id("committees"),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    personId: v.optional(v.id("peopleDirectory")),
    representedOrganization: v.optional(v.string()),
    joinedAt: v.optional(v.string()),
    leftAt: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeAddMemberPortable(await toPortableMutationCtx(ctx), args),
});

export const removeMember = authorizedMutation("committees:removeMember", mutation)({
  args: { id: v.id("committeeMembers") },
  returns: v.any(),
  handler: async (ctx, args) => committeeRemoveMemberPortable(await toPortableMutationCtx(ctx), args),
});

export const updateStructure = authorizedMutation("committees:updateStructure", mutation)({
  args: {
    id: v.id("committees"),
    kind: v.optional(v.union(v.string(), v.null())),
    parentBody: v.optional(v.union(v.string(), v.null())),
    parentCommitteeId: v.optional(v.union(v.id("committees"), v.null())),
    cadenceRule: v.optional(v.union(cadenceRuleValidator, v.null())),
    mandateVersions: v.optional(v.array(committeeMandateVersionValidator)),
    cadenceLabel: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeUpdateStructurePortable(await toPortableMutationCtx(ctx), args),
});

export const updateMember = authorizedMutation("committees:updateMember", mutation)({
  args: {
    id: v.id("committeeMembers"),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.optional(v.string()),
      directorId: v.optional(v.union(v.id("directors"), v.null())),
      memberId: v.optional(v.union(v.id("members"), v.null())),
      personId: v.optional(v.union(v.id("peopleDirectory"), v.null())),
      representedOrganization: v.optional(v.string()),
      joinedAt: v.optional(v.string()),
      leftAt: v.optional(v.union(v.string(), v.null())),
      reviewStatus: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeUpdateMemberPortable(await toPortableMutationCtx(ctx), args),
});

export const buildRostersFromSeats = authorizedMutation("committees:buildRostersFromSeats", mutation)({
  args: { societyId: v.id("societies"), dryRun: v.optional(v.boolean()), createMissingCommittees: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => (await import("../shared/functions/rosterPromotion")).buildRostersFromSeats(await toPortableMutationCtx(ctx), args),
});
