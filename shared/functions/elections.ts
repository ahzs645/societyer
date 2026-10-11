/**
 * PORTABLE FUNCTIONS: the elections domain (the pure `ctx.db` handlers).
 *
 * The handlers, including their role and workspace checks, run unchanged on
 * hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId, requireRolePortable, requireSocietyMembership } from "./access";
import { getActiveBylawRuleSet } from "./bylawRules";
import { normalizeElectionWindow, validateElectionQuestion, type ElectionQuestionInput } from "../electionValidation";
import { organizationRuleScope } from "../entityRuleScope";
import { corporateElectionPreview, electionRecordDateReference, validateCorporateElectionReview, type CorporateElectionReview } from "./electionElectorate";

function accountMayVote(row: Record<string, any>, actor: Record<string, any> | null) {
  if (!actor) return false;
  if (row.voterKind === "shareholder") return !!row.userId && row.userId === actor._id;
  return !!actor.memberId && row.memberId === actor.memberId && (!row.userId || row.userId === actor._id);
}

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
  const actor = await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db.query("elections").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return canActAs(actor?.role as any, "Director") ? rows : rows.map(({ corporateReview, ...row }) => row);
}

export async function getPortable(
  ctx: PortableQueryCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const election = await requireOwnedRow(ctx, "elections", id);
  const societyId = String(election.societyId);
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
  const actor = await requireSocietyMembership(ctx, societyId);
  const canSeeSensitive =
    !!actor &&
    actor.societyId === election.societyId &&
    canActAs(actor.role as any, "Director");
  const viewerEligibility = eligible.filter((row) => accountMayVote(row, actor));
  const society = await ctx.db.get(societyId, "societies");
  const isCorporation = organizationRuleScope(society).isCorporation;
  const corporatePreview = isCorporation && canSeeSensitive && election.status === "Draft"
    ? await corporateElectionPreview(ctx, societyId, election.corporateReview, await electionRecordDateReference(ctx, societyId, election)) : null;
  const visibleElection = !canSeeSensitive && election.corporateReview
    ? { ...election, corporateReview: { recordDateISO: election.corporateReview.recordDateISO, votingMethod: election.corporateReview.votingMethod } }
    : election;
  return {
    election: visibleElection,
    isCorporation,
    canNominate: isCorporation ? !!election.corporateReview?.representatives?.some((row: any) => row.userId === actor?._id) : !!actor?.memberId,
    corporatePreview,
    questions: questions.sort((a, b) => a.order - b.order),
    eligible: canSeeSensitive ? eligible : viewerEligibility,
    ballots: canSeeSensitive ? ballots : [],
    ballotCount: ballots.filter((row) => !row.spoiledAtISO).length,
    audit: canSeeSensitive ? audit.sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO)) : [],
    canSeeSensitive,
  };
}

export async function listNominationsPortable(
  ctx: PortableQueryCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await requireOwnedRow(ctx, "elections", electionId);
  const societyId = String(election.societyId);
  const actor = await requireSocietyMembership(ctx, societyId);
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
          row.submittedByUserId === actor._id || row.status === "OnBallot",
      );
  return visible.sort((a, b) => b.submittedAtISO.localeCompare(a.submittedAtISO));
}

export async function listMinePortable(
  ctx: PortableQueryCtx,
  { societyId, userId }: { societyId: string; userId?: string },
) {
  const user = await requireSocietyMembership(ctx, societyId);
  if (!user || (userId && userId !== user._id)) throw new Error("You can only read your own voting eligibility.");
  const [byUser, byMember] = await Promise.all([
    ctx.db.query("electionEligibleVoters").withIndex("by_user", (q) => q.eq("userId", user._id)).collect(),
    user.memberId ? ctx.db.query("electionEligibleVoters").withIndex("by_member", (q) => q.eq("memberId", user.memberId)).collect() : [],
  ]);
  const eligibility = [...new Map([...byUser, ...byMember].map((row) => [row._id, row])).values()]
    .filter((row) => row.societyId === societyId && accountMayVote(row, user));
  const result: { election: Record<string, any>; eligibility: Record<string, any> }[] = [];
  for (const entry of eligibility) {
    const election = await getOwned(ctx, "elections", String(entry.electionId), societyId);
    const { corporateReview, ...visibleElection } = election;
    result.push({ election: visibleElection, eligibility: entry });
  }
  return result;
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
  const election = await requireOwnedRow(ctx, "elections", args.electionId);
  const societyId = String(election.societyId);
  const actor = await requireSocietyMembership(ctx, societyId);
  if (args.actingUserId && args.actingUserId !== actor?._id) throw new Error("Authenticated actor does not match the current principal.");
  const society = await ctx.db.get(societyId, "societies");
  const corporation = organizationRuleScope(society).isCorporation;
  if (corporation) {
    const assignment = election.corporateReview?.representatives?.find((row: any) => row.userId === actor?._id);
    if (!assignment) throw new Error("Only a shareholder's verified authorized account can submit a nomination.");
    const register = await corporateElectionPreview(ctx, societyId, election.corporateReview);
    if (!register.complete || !register.votingHolders.some((holder) => holder.roleHolderId === assignment.roleHolderId)) throw new Error("The nomination account must represent an identified voting shareholder in the reviewed register.");
  } else {
    if (!actor?.memberId) throw new Error("Only confirmed members can submit nominations.");
    await getOwned(ctx, "members", actor.memberId, societyId);
  }
  if (!args.nomineeName.trim()) throw new Error("Enter the nominee's name.");
  if (args.questionId) {
    const question = await getOwned(ctx, "electionQuestions", args.questionId, societyId);
    if (question.electionId !== args.electionId) throw new Error("Election question not found.");
  }
  const nowISO = new Date().toISOString();
  if (!["Draft", "Open"].includes(election.status)) throw new Error("Nominations are closed.");
  if (Date.parse(nowISO) < Date.parse(election.nominationsOpenAtISO ?? election.createdAtISO)) {
    throw new Error("Nominations are not open yet.");
  }
  if (Date.parse(nowISO) > Date.parse(election.nominationsCloseAtISO ?? election.closesAtISO)) {
    throw new Error("Nominations are closed.");
  }
  const id = await ctx.db.insert("electionNominations", {
    societyId: election.societyId,
    electionId: args.electionId,
    questionId: args.questionId,
    memberId: actor.memberId,
    nomineeName: args.nomineeName.trim(),
    nomineeEmail: args.nomineeEmail,
    statement: args.statement,
    status: "Submitted",
    submittedByUserId: actor._id,
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
  { electionId, eligibilityId, choices, actingUserId }: {
    electionId: string;
    eligibilityId?: string;
    choices: { questionId: string; optionIds: string[]; allocations?: { optionId: string; votes: number }[] }[];
    actingUserId?: string;
  },
) {
  const election = await requireOwnedRow(ctx, "elections", electionId);
  const societyId = String(election.societyId);
  if (election.status !== "Open") {
    throw new Error("Election is not open for voting.");
  }
  const now = Date.now();
  if (now < Date.parse(election.opensAtISO) || now > Date.parse(election.closesAtISO)) {
    throw new Error("Voting is outside the election's opening and closing window.");
  }
  const user = await requireSocietyMembership(ctx, societyId);
  if (actingUserId && actingUserId !== user?._id) throw new Error("Authenticated actor does not match the current principal.");
  const society = await ctx.db.get(societyId, "societies");
  if (organizationRuleScope(society).isCorporation && election.eligibilityBasis !== "shareholder") {
    throw new Error("This legacy corporate election has a member-based electorate. Create a reviewed shareholder election before accepting ballots.");
  }
  const entries = await ctx.db.query("electionEligibleVoters").withIndex("by_election", (q) => q.eq("electionId", electionId)).collect();
  const mine = entries.filter((row) => row.societyId === societyId && accountMayVote(row, user));
  const eligibility = eligibilityId ? mine.find((row) => row._id === eligibilityId) : mine.length === 1 ? mine[0] : null;
  if (!eligibility || eligibility.revokedAtISO || eligibility.status === "Revoked") {
    throw new Error(mine.length > 1 && !eligibilityId ? "Select the shareholder whose ballot you are casting." : "This account is not eligible to vote in this election.");
  }
  if (eligibility.status === "Voted") throw new Error("A ballot has already been cast for this voter.");
  if (!["Eligible", "Confirmed"].includes(eligibility.status)) throw new Error("This voter is not eligible to cast a ballot.");
  const voteWeight = eligibility.voteWeight ?? 1;
  if (!Number.isFinite(voteWeight) || voteWeight <= 0 || voteWeight > Number.MAX_SAFE_INTEGER) throw new Error("The frozen voting weight is invalid; refer this election to its administrator.");
  const cumulative = election.corporateReview?.votingMethod === "cumulative";
  const questions = await ctx.db
    .query("electionQuestions")
    .withIndex("by_election", (q) => q.eq("electionId", electionId))
    .collect();
  if (!questions.length || choices.length !== questions.length || new Set(choices.map((choice) => choice.questionId)).size !== choices.length) {
    throw new Error("Submit exactly one response for every ballot question.");
  }
  for (const choice of choices) {
    const question = questions.find((row) => row._id === choice.questionId);
    if (!question) throw new Error("Election question not found.");
    if (choice.optionIds.length === 0) {
      throw new Error("Each question must have at least one selection.");
    }
    if (cumulative) {
      const allocations = choice.allocations ?? [];
      if (allocations.length !== choice.optionIds.length || new Set(allocations.map((row) => row.optionId)).size !== allocations.length || allocations.some((row) => !choice.optionIds.includes(row.optionId) || !Number.isFinite(row.votes) || row.votes <= 0)) throw new Error("Provide one positive vote allocation for each selected candidate.");
      const budget = voteWeight * question.maxSelections;
      if (!Number.isFinite(budget) || budget > Number.MAX_SAFE_INTEGER || allocations.reduce((sum, row) => sum + row.votes, 0) > budget) throw new Error("The cumulative allocation exceeds this shareholder's votes multiplied by the seats to be filled.");
    } else if (choice.allocations?.length) throw new Error("Vote allocations are only permitted for a reviewed cumulative election.");
    if (new Set(choice.optionIds).size !== choice.optionIds.length) throw new Error("A ballot option can only be selected once.");
    if (!cumulative && choice.optionIds.length > question.maxSelections) {
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
    voteWeight,
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
    detail: "Ballot stored separately from the voter eligibility ledger.",
  });
  return ballotId;
}

export async function tallyPortable(
  ctx: PortableQueryCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await requireOwnedRow(ctx, "elections", electionId);
  const societyId = String(election.societyId);
  const actor = await requireSocietyMembership(ctx, societyId);
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
      if (ballot.spoiledAtISO) continue;
      const choice = ballot.choices.find((row: Record<string, any>) => row.questionId === question._id);
      if (!choice) continue;
      for (const optionId of choice.optionIds) {
        const votes = election.corporateReview?.votingMethod === "cumulative"
          ? choice.allocations?.find((row: any) => row.optionId === optionId)?.votes ?? 0
          : ballot.voteWeight ?? 1;
        counts.set(optionId, (counts.get(optionId) ?? 0) + votes);
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
    corporateReview?: CorporateElectionReview;
    scrutineerUserIds?: string[];
    notes?: string;
    actingUserId?: string;
    initialQuestion?: ElectionQuestionInput;
  },
) {
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  if (!args.title.trim()) throw new Error("Enter an election title.");
  const votingWindow = normalizeElectionWindow(args.opensAtISO, args.closesAtISO, "Voting");
  const nominationsWindow = args.nominationsOpenAtISO || args.nominationsCloseAtISO
    ? normalizeElectionWindow(args.nominationsOpenAtISO ?? votingWindow.start, args.nominationsCloseAtISO ?? votingWindow.end, "Nominations")
    : undefined;
  if (args.initialQuestion) validateElectionQuestion(args.initialQuestion);
  await Promise.all([
    args.meetingId ? getOwned(ctx, "meetings", args.meetingId, args.societyId) : Promise.resolve(),
    ...(args.scrutineerUserIds ?? []).map((userId) =>
      getOwned(ctx, "users", userId, args.societyId)),
  ]);
  const rules = await getActiveBylawRuleSet(ctx, args.societyId);
  if (args.corporateReview) {
    const society = await ctx.db.get(args.societyId, "societies");
    if (!organizationRuleScope(society).isCorporation) throw new Error("A share-weighted review only applies to a share-capital corporation.");
    await validateCorporateElectionReview(ctx, args.societyId, args.corporateReview,
      await electionRecordDateReference(ctx, args.societyId, { meetingId: args.meetingId, opensAtISO: votingWindow.start }));
  }
  const id = await ctx.db.insert("elections", {
    societyId: args.societyId,
    meetingId: args.meetingId,
    title: args.title.trim(),
    description: args.description,
    status: "Draft",
    opensAtISO: votingWindow.start,
    closesAtISO: votingWindow.end,
    nominationsOpenAtISO: nominationsWindow?.start,
    nominationsCloseAtISO: nominationsWindow?.end,
    eligibilityCutoffISO: args.corporateReview?.recordDateISO ?? args.eligibilityCutoffISO,
    corporateReview: args.corporateReview,
    anonymousBallot: rules.ballotIsAnonymous,
    scrutineerUserIds: args.scrutineerUserIds,
    createdByUserId: await principalUserId(ctx, args.societyId),
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
  if (args.initialQuestion) await addQuestionPortable(ctx, { ...args.initialQuestion, electionId: id, actingUserId: args.actingUserId });
  return id;
}

export async function updateSettingsPortable(
  ctx: PortableMutationCtx,
  args: {
    electionId: string;
    corporateReview?: CorporateElectionReview;
    /** `null` clears a stored value; omitted leaves it unchanged. */
    nominationsOpenAtISO?: string | null;
    nominationsCloseAtISO?: string | null;
    scrutineerUserIds?: string[];
    resultsSummary?: string | null;
    evidenceDocumentId?: string | null;
    actingUserId?: string;
  },
) {
  const election = await requireOwnedRow(ctx, "elections", args.electionId);
  const societyId = String(election.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId,
    required: "Director",
  });
  const patch: Record<string, any> = { updatedAtISO: new Date().toISOString() };
  if (args.nominationsOpenAtISO || args.nominationsCloseAtISO) {
    const window = normalizeElectionWindow(args.nominationsOpenAtISO || election.createdAtISO, args.nominationsCloseAtISO || election.closesAtISO, "Nominations");
    patch.nominationsOpenAtISO = window.start;
    patch.nominationsCloseAtISO = window.end;
  } else if (args.nominationsOpenAtISO === null || args.nominationsCloseAtISO === null) {
    // Clearing either date clears the nomination window; voting dates then apply.
    patch.nominationsOpenAtISO = undefined;
    patch.nominationsCloseAtISO = undefined;
  }
  await Promise.all([
    ...(args.scrutineerUserIds ?? []).map((userId) =>
      getOwned(ctx, "users", userId, societyId)),
    args.evidenceDocumentId
      ? getOwned(ctx, "documents", args.evidenceDocumentId, societyId)
      : Promise.resolve(),
  ]);
  if (args.corporateReview) {
    const society = await ctx.db.get(societyId, "societies");
    if (!organizationRuleScope(society).isCorporation) throw new Error("A share-weighted review only applies to a share-capital corporation.");
    if (election.status !== "Draft") throw new Error("The electorate review is frozen after voting opens.");
    await validateCorporateElectionReview(ctx, societyId, args.corporateReview, await electionRecordDateReference(ctx, societyId, election));
  }
  if (args.scrutineerUserIds !== undefined) patch.scrutineerUserIds = args.scrutineerUserIds;
  for (const field of ["resultsSummary", "evidenceDocumentId"] as const) {
    // An empty value or null clears the field, as the settings form did before.
    if (args[field] === null || args[field] === "") patch[field] = undefined;
    else if (args[field] !== undefined) patch[field] = args[field];
  }
  // The electorate review is replaced only when one is supplied; it is never cleared here.
  if (args.corporateReview) {
    patch.corporateReview = args.corporateReview;
    patch.eligibilityCutoffISO = args.corporateReview.recordDateISO;
  }
  await ctx.db.patch(args.electionId, patch);
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId: args.electionId,
    actorName: user?.displayName ?? "System",
    action: "settings-updated",
  });
}

/** Remove a ballot question while the election is still a draft (G-16). */
export async function removeQuestionPortable(
  ctx: PortableMutationCtx,
  args: { questionId: string; actingUserId?: string },
) {
  const question = await requireOwnedRow(ctx, "electionQuestions", args.questionId);
  const election = await requireOwnedRow(ctx, "elections", String(question.electionId));
  const societyId = String(election.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId,
    required: "Director",
  });
  if (election.status !== "Draft") throw new Error("Ballot questions can only be changed while the election is a draft.");
  await ctx.db.delete(args.questionId);
  const remaining = await ctx.db
    .query("electionQuestions")
    .withIndex("by_election", (q) => q.eq("electionId", String(question.electionId)))
    .collect();
  remaining.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (let index = 0; index < remaining.length; index += 1) {
    if (remaining[index].order !== index) await ctx.db.patch(remaining[index]._id, { order: index });
  }
  await logAudit(ctx, {
    societyId: election.societyId,
    electionId: String(question.electionId),
    actorName: user?.displayName ?? "System",
    action: "question-removed",
    detail: question.title,
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
  const election = await requireOwnedRow(ctx, "elections", args.electionId);
  const societyId = String(election.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId,
    required: "Director",
  });
  if (election.status !== "Draft") throw new Error("Ballot questions can only be changed while the election is a draft.");
  validateElectionQuestion(args);
  await Promise.all(args.options.flatMap((option) => option.memberId
    ? [getOwned(ctx, "members", option.memberId, societyId)]
    : []));
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
  const nomination = await requireOwnedRow(ctx, "electionNominations", id);
  const societyId = String(nomination.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId,
    required: "Director",
  });
  if (!["Accepted", "Rejected"].includes(status)) throw new Error("Choose Accepted or Rejected for a nomination review.");
  if (nomination.status === "OnBallot") throw new Error("A nomination already on the ballot cannot be reviewed again.");
  await ctx.db.patch(id, {
    status,
    reviewedByUserId: await principalUserId(ctx, societyId),
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
  const nomination = await requireOwnedRow(ctx, "electionNominations", id);
  const societyId = String(nomination.societyId);
  const question = await getOwned(ctx, "electionQuestions", questionId, societyId);
  if (!question || question.electionId !== nomination.electionId) {
    throw new Error("Election question not found.");
  }
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId,
    required: "Director",
  });
  const optionId = `nomination-${id}`;
  const hasOption = question.options.some((option: Record<string, any>) => option.id === optionId);
  const election = await getOwned(ctx, "elections", nomination.electionId, societyId);
  if (election.status !== "Draft") throw new Error("Ballot options can only be changed while the election is a draft.");
  if (!["Accepted", "OnBallot"].includes(nomination.status)) throw new Error("Accept the nomination before adding it to the ballot.");
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
    reviewedByUserId: await principalUserId(ctx, societyId),
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
  const election = await requireOwnedRow(ctx, "elections", electionId);
  const societyId = String(election.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId,
    required: "Director",
  });
  if (election.status !== "Draft") throw new Error("Eligibility can only be snapshotted before the election opens.");
  const questions = await ctx.db.query("electionQuestions").withIndex("by_election", (q) => q.eq("electionId", electionId)).collect();
  if (!questions.length) throw new Error("Add a ballot question before opening the election.");
  questions.forEach((question) => validateElectionQuestion({ title: question.title, maxSelections: question.maxSelections, options: question.options }));
  const society = await ctx.db.get(societyId, "societies");
  const corporation = organizationRuleScope(society).isCorporation;
  const nowISO = new Date().toISOString();
  const snapshot: Record<string, any>[] = [];
  if (corporation) {
    const review = election.corporateReview as CorporateElectionReview | undefined;
    if (!review) throw new Error("Review the record date, share rights and authorized shareholder accounts before opening this election.");
    const reference = await electionRecordDateReference(ctx, societyId, election);
    await validateCorporateElectionReview(ctx, societyId, review, reference);
    const electorate = await corporateElectionPreview(ctx, societyId, review, reference);
    if (!electorate.complete) throw new Error(electorate.issues.join(" "));
    for (const holder of electorate.votingHolders) {
      const assignment = review.representatives.find((row) => row.roleHolderId === holder.roleHolderId);
      if (!assignment) throw new Error(`Assign and verify an authorized voting account for ${holder.fullName}.`);
      snapshot.push({
        voterKind: "shareholder", holderKey: holder.holderKey, roleHolderId: holder.roleHolderId,
        userId: assignment.userId, email: holder.email, fullName: holder.fullName,
        voteWeight: holder.totalVotes, classVotes: holder.classVotes,
        // A record date of today freezes the live register now, not at the end of the day.
        eligibilityReason: `${electorate.registerBasis === "live_at_snapshot" ? `Live share register at snapshot time on ${review.recordDateISO}` : `Share register reconstructed to the end of ${review.recordDateISO}`}; ${holder.totalVotes} votes before any cumulative multiplier`,
      });
    }
  } else {
    const rules = await getActiveBylawRuleSet(ctx, societyId);
    const [members, users] = await Promise.all([
      ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    const eligibleMembers = members.filter((member) => rules.voterMustBeMemberAtRecordDate ? member.status === "Active" && member.votingRights : member.votingRights);
    for (const member of eligibleMembers) {
      const linkedUsers = users.filter((candidate) => candidate.memberId === member._id && candidate.status === "Active");
      if (linkedUsers.length > 1) throw new Error(`More than one active account is linked to ${fullName(member as any)}; resolve its voting identity before opening.`);
      snapshot.push({ voterKind: "member", memberId: member._id, userId: linkedUsers[0]?._id,
        email: member.email, fullName: fullName(member as any), voteWeight: 1, eligibilityReason: "Voting member in the reviewed member register at snapshot time" });
    }
  }
  if (!snapshot.length) throw new Error("The reviewed register contains no eligible voters.");
  const existing = await ctx.db.query("electionEligibleVoters").withIndex("by_election", (q) => q.eq("electionId", electionId)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  for (const row of snapshot) await ctx.db.insert("electionEligibleVoters", { ...row, societyId, electionId, status: "Eligible", createdAtISO: nowISO });
  const totalEligibleVotes = snapshot.reduce((sum, row) => sum + row.voteWeight, 0);
  await ctx.db.patch(electionId, {
    updatedAtISO: nowISO, status: "Open", eligibilityBasis: corporation ? "shareholder" : "member",
    eligibilityReviewedByUserId: user?._id, eligibilitySnapshottedAtISO: nowISO, totalEligibleVotes,
    ...(corporation ? { anonymousBallot: false } : {}),
  });
  await logAudit(ctx, { societyId, electionId, actorName: user?.displayName ?? "System", action: "eligibility-snapshotted", detail: `${snapshot.length} eligible ${corporation ? "shareholders" : "members"}; ${totalEligibleVotes} base votes; record and authority review frozen` });
  return { eligibleCount: snapshot.length, totalEligibleVotes };
}

export async function closePortable(
  ctx: PortableMutationCtx,
  { electionId, actingUserId }: { electionId: string; actingUserId?: string },
) {
  const election = await requireOwnedRow(ctx, "elections", electionId);
  const societyId = String(election.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId,
    required: "Director",
  });
  if (election.status !== "Open") throw new Error("Only an open election can be closed.");
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
  const election = await requireOwnedRow(ctx, "elections", electionId);
  const societyId = String(election.societyId);
  const { user } = await requireRolePortable(ctx, {
    actingUserId,
    societyId,
    required: "Director",
  });
  if (evidenceDocumentId) await getOwned(ctx, "documents", evidenceDocumentId, societyId);
  if (election.status !== "Closed") {
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
