/** Portable, tenant-scoped records of circulated resolutions and consent evidence. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { corporateElectionPreview } from "./electionElectorate";
import { legalGovernanceProfile, legalProfileRegistry, requiredWrittenConsents, validDirectorsOverride, writtenResolutionRule, type WrittenResolutionRoute } from "../legalGovernanceProfiles";
import { directorNoticeRecipients, directorRegisterComparison } from "../meetingNoticeAudience";
import { recordDateLimitFor, recordDateWindow, validElectorateDate } from "../shareholderElectorate";
import { noticeDueDateWindow, resolutionCalendarDate, resolutionConsentProgress, resolutionNoticeProgress, resolutionTimeZone, resolutionTimestamp, resolutionVoteProgress,
  validateCirculationRecordingWindow, validateResolutionConsent, validateResolutionEventTime, type ResolutionElector, type ResolutionNoticeEvidence } from "../writtenResolutionEvidence";

type ResolutionBody = "members" | "shareholders" | "directors";
type DirectorsOverride = { numerator: number; denominator: number };
type PreviewArgs = {
  societyId: string; body?: ResolutionBody; kind?: "Ordinary" | "Special"; recordDateISO?: string;
  specialMajority?: "two_thirds" | "three_quarters";
  /** Actual circulation time; the record date is compared with its local calendar date. */
  circulatedAtISO?: string;
  route?: WrittenResolutionRoute;
  directorsOverride?: DirectorsOverride;
};

const REGISTER_LIMIT = 5000;
const hasEvidence = (value: unknown) => typeof value === "string" && value.trim().length >= 12;
const votesCastRoute = (row: Record<string, any>) => row.votingRoute === "mail_electronic_vote" || row.approvalRule?.basis === "votes_cast";

/** All conclusions are derived from immutable electorate and individual event evidence. */
export function writtenResolutionState(row: Record<string, any>, nowISO: string) {
  const electorate: ResolutionElector[] = row.electorate ?? [];
  const chronology = { circulatedAtISO: row.circulatedAtISO, asOfISO: nowISO };
  const frozenRule = row.approvalRule;
  const votesCast = votesCastRoute(row);
  const vote = votesCast ? resolutionVoteProgress(electorate, row.signatures ?? [], frozenRule ?? { numerator: 1, denominator: 1, strict: false },
    { ...chronology, closesAtISO: row.votingClosesAtISO, countCertifiedAtISO: row.voteCountCertifiedAtISO }) : undefined;
  const progress = vote ?? resolutionConsentProgress(electorate, row.signatures ?? [], row.requiredCount, chronology);
  const statutoryProgress = vote ?? resolutionConsentProgress(electorate, row.signatures ?? [], row.statutoryRequiredCount, chronology);
  const circulated = resolutionTimestamp(row.circulatedAtISO);
  const recorded = resolutionTimestamp(row.circulationRecordedAtISO);
  const approved = resolutionTimestamp(row.authorityReviewedAtISO);
  const total = electorate.reduce((sum, elector) => sum + elector.weight, 0);
  const override = row.approvalOverride;
  const overrideReviewed = !override || (override.kind === "directors_governing_instrument" && row.body === "directors" && hasEvidence(override.evidence) &&
    frozenRule?.numerator === override.numerator && frozenRule?.denominator === override.denominator && validDirectorsOverride(override));
  const routeReviewed = !votesCast || (row.votingRoute === "mail_electronic_vote" && frozenRule?.basis === "votes_cast" && row.body === "members" &&
    hasEvidence(row.votingRouteEvidence) && !!resolutionTimestamp(row.votingClosesAtISO) && row.requiredCount === row.statutoryRequiredCount);
  const reviewed = row.evidenceVersion === 2 && !!circulated && !!recorded && !!approved &&
    circulated <= recorded && recorded <= nowISO && approved <= nowISO && !!row.circulationRecordedByUserId && !!row.authorityReviewedByUserId &&
    [row.governingInstrumentEvidence, row.electorateEvidence, row.circulationEvidence].every(hasEvidence) &&
    total === row.electorateTotal && !!frozenRule && frozenRule.unit === row.countUnit &&
    requiredWrittenConsents(total, frozenRule) === row.statutoryRequiredCount &&
    row.statutoryRequiredCount > 0 && row.requiredCount >= row.statutoryRequiredCount && overrideReviewed && routeReviewed;
  const supported = legalProfileRegistry.get(String(row.profileId))?.confidence === "verified_core";
  const legallyVerified = reviewed && supported && progress.valid && statutoryProgress.valid;
  const noticeTrigger = legallyVerified && row.nonSignerNoticeBusinessDays ? statutoryProgress.thresholdReachedAtISO : undefined;
  const noticeProgress = resolutionNoticeProgress(electorate, row.signatures ?? [], row.nonSignerNotices ?? [], noticeTrigger, {
    dueDateISO: row.nonSignerNoticeDueDateISO, triggerDateISO: row.nonSignerNoticeDeadlineTriggerDateISO,
    timeZone: row.nonSignerNoticeTimeZone, calendarEvidence: row.nonSignerNoticeCalendarEvidence, businessDays: row.nonSignerNoticeBusinessDays,
    reviewedByUserId: row.nonSignerNoticeDeadlineReviewedByUserId, reviewedAtISO: row.nonSignerNoticeDeadlineReviewedAtISO,
  }, nowISO);
  return { progress, statutoryProgress, vote, votesCast, reviewed, supported, legallyVerified, noticeProgress };
}

/**
 * The displayed status and verified passage, shared by the Written resolutions
 * page and the minute book so they never disagree about a "Carried" record.
 */
export function writtenResolutionView(row: Record<string, any>, nowISO: string) {
  const state = writtenResolutionState(row, nowISO);
  if (state.vote) {
    const established = state.legallyVerified && state.vote.thresholdMet;
    const status = row.status === "Failed" ? "Failed"
      : !state.legallyVerified ? "Review required"
        : !state.vote.closed ? "Circulating"
          : !state.vote.countCertified ? "Count certification required"
            : established ? "Carried" : "Failed";
    return { state, status, establishedPassage: established };
  }
  const establishedPassage = state.legallyVerified && state.progress.thresholdMet && row.completedAtISO === state.progress.thresholdReachedAtISO;
  return { state, status: row.status === "Carried" && !establishedPassage ? "Review required" : row.status, establishedPassage };
}

async function directorElectorate(ctx: PortableQueryCtx, societyId: string, issues: string[]): Promise<ResolutionElector[]> {
  const [directors, roleHolders] = await Promise.all([
    ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(REGISTER_LIMIT + 1),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(REGISTER_LIMIT + 1),
  ]);
  if (directors.length > REGISTER_LIMIT || roleHolders.length > REGISTER_LIMIT) issues.push(`The register exceeds the ${REGISTER_LIMIT}-person snapshot limit; prepare a reviewed batch import.`);
  // The same two registers the meeting-notice audience uses, de-duplicated by directory link.
  const comparison = directorRegisterComparison(directors, roleHolders);
  if (!comparison.agree) {
    issues.push(`The directors register and the director role-holder register disagree: ${comparison.directorsOnly} active director entries appear only in the directors register and ${comparison.roleHoldersOnly} current director role holders appear only in the role-holder register. Link each director to the same directory person, or correct the registers, before freezing the board electorate.`);
  }
  return directorNoticeRecipients(directors, roleHolders).map((recipient) => recipient.directorId
    ? { key: `director:${recipient.directorId}`, name: recipient.name, weight: 1, directorId: recipient.directorId }
    : { key: `roleHolder:${recipient.roleHolderId}`, name: recipient.name, weight: 1, roleHolderId: recipient.roleHolderId });
}

export async function previewPortable(ctx: PortableQueryCtx, args: PreviewArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const organization = await ctx.db.get(args.societyId, "societies");
  const profile = legalGovernanceProfile(organization);
  const body = args.body ?? (profile?.kind === "corporation" ? "shareholders" : "members");
  if ((profile?.kind === "corporation" && body === "members") || (profile?.kind === "society" && body === "shareholders")) throw new Error("Choose the decision body that belongs to this legal entity.");
  const kind = args.kind ?? "Special";
  const issues: string[] = [];
  const reviewNotes: string[] = [];
  const timeZone = resolutionTimeZone(organization);
  const circulatedAtISO = args.circulatedAtISO ? resolutionTimestamp(args.circulatedAtISO) : undefined;
  if (args.circulatedAtISO && !circulatedAtISO) issues.push("Enter the actual circulation date and time as a valid UTC timestamp.");
  // The organization's local calendar date of circulation, not the UTC date.
  const circulationDateISO = resolutionCalendarDate(circulatedAtISO ?? new Date().toISOString(), timeZone)!;
  const recordDateISO = args.recordDateISO ?? circulationDateISO;
  const validRecordDate = /^\d{4}-\d{2}-\d{2}$/.test(recordDateISO) && validElectorateDate(recordDateISO);
  if (!validRecordDate) issues.push("Enter a valid electorate record date (YYYY-MM-DD).");
  else if (recordDateISO > circulationDateISO) issues.push(`The electorate record date cannot follow circulation on ${circulationDateISO} (${timeZone}).`);
  if (validRecordDate && body === "shareholders") {
    const window = recordDateWindow(recordDateISO, circulationDateISO, recordDateLimitFor(organization, "writtenResolution"), "circulation");
    if (window.issue) issues.push(window.issue);
    if (window.reviewNote) reviewNotes.push(window.reviewNote);
  }

  const route: WrittenResolutionRoute = args.route ?? "written_consent";
  if (route === "mail_electronic_vote" && (!profile?.resolutions.memberMailElectronicVote || body !== "members")) {
    issues.push("Voting by mail or electronic means under the Societies Act s. 1 (c) definitions applies only to BC society member resolutions.");
  }
  if (args.directorsOverride) {
    if (body !== "directors") issues.push("A governing-instrument threshold applies only to directors' written resolutions.");
    else if (!profile?.resolutions.directorsWrittenOverride) issues.push("This Act requires every director entitled to vote to consent in writing; no lesser bylaw or articles threshold is modelled.");
    else if (!validDirectorsOverride(args.directorsOverride)) issues.push("Enter the governing-instrument threshold as a fraction below unanimity, for example 3 of 4.");
  }
  const rule = writtenResolutionRule(organization, kind, body, { route, directorsOverride: body === "directors" ? args.directorsOverride : undefined });
  if (!profile) issues.push("The governing Act has no verified automated resolution profile. Evidence can be recorded, but the result requires legal review.");
  if (rule?.override) reviewNotes.push(`Reviewed departure from unanimity: ${rule.caveat} Record the bylaw or article clause. Unanimous consent remains the default.`);
  if (rule?.route === "mail_electronic_vote") reviewNotes.push(`${rule.caveat} The result is decided only after voting closes and an officer certifies the count of votes cast.`);
  if (rule?.usesSpecialMajority) {
    if (!args.specialMajority) issues.push("Confirm the special majority in the company's articles. Two-thirds is the statutory default when the articles are silent; the articles may set a higher majority up to three-quarters, and specified legacy companies use three-quarters.");
    else reviewNotes.push(args.specialMajority === "two_thirds"
      ? "Two-thirds is the statutory default special majority. Confirm that the articles do not set a higher majority (up to three-quarters) and that no legacy three-quarters rule applies."
      : "Three-quarters applies under the articles or the legacy-company rule. Retain the article clause or legacy status evidence.");
  }

  let electorate: ResolutionElector[] = [];
  if (body === "shareholders") {
    const result = await corporateElectionPreview(ctx, args.societyId, { recordDateISO, recordDateBasis: "", rightsBasis: "", ledgerBasis: "", votingMethod: "per_share", representatives: [] });
    issues.push(...result.issues.filter((issue) => !issues.includes(issue)));
    electorate = result.votingHolders.map((holder) => ({ key: `shareholder:${holder.roleHolderId}`, name: holder.fullName,
      roleHolderId: holder.roleHolderId, weight: rule?.unit === "votes" ? holder.totalVotes : rule?.unit === "shares" ? holder.classVotes.filter((entry) => entry.votesPerShare > 0).reduce((sum, entry) => sum + entry.quantity, 0) : 1 }));
  } else {
    if (validRecordDate && recordDateISO !== circulationDateISO) issues.push(`Member and director snapshots use the current register, so the record date must be the circulation date (${circulationDateISO}, ${timeZone}). Review a historical decision through its original signed records.`);
    if (body === "directors") electorate = await directorElectorate(ctx, args.societyId, issues);
    else {
      const rows = await ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).take(REGISTER_LIMIT + 1);
      if (rows.length > REGISTER_LIMIT) issues.push(`The register exceeds the ${REGISTER_LIMIT}-person snapshot limit; prepare a reviewed batch import.`);
      electorate = rows.filter((row) => row.status === "Active" && row.votingRights === true)
        .map((row) => ({ key: `member:${row._id}`, name: `${row.firstName} ${row.lastName}`.trim(), weight: 1, memberId: row._id }));
    }
  }
  if (!electorate.length) issues.push("The register has no eligible voters for this decision body.");
  const total = electorate.reduce((sum, elector) => sum + elector.weight, 0);
  if (!Number.isSafeInteger(total) || total < 1) issues.push("The electorate must have a positive, exact integer voting total.");
  const threshold = rule ? { ...rule } : { numerator: 1, denominator: 1, strict: false, unit: "people" as const, basis: "eligible" as const, route, override: undefined,
    unanimous: true, noticeBusinessDays: undefined, usesSpecialMajority: false, caveat: undefined, sourceIds: [] as readonly string[] };
  if (rule?.usesSpecialMajority && args.specialMajority === "three_quarters") { threshold.numerator = 3; threshold.denominator = 4; }
  const requiredCount = requiredWrittenConsents(total, threshold);
  return { body, recordDateISO, circulationDateISO, timeZone, profileId: profile?.id, electorate, total, requiredCount, rule: threshold, route,
    issues, reviewNotes, complete: issues.length === 0, caveat: profile?.resolutions.caveat };
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db.query("writtenResolutions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const nowISO = new Date().toISOString();
  return rows.map((row) => {
    const { state, status, establishedPassage } = writtenResolutionView(row, nowISO);
    return { ...row, originalStatus: row.status, status,
      nonSignerNoticeStatus: state.noticeProgress.status ?? (row.nonSignerNoticeStatus ? "Review required" : undefined),
      consentProgress: state.progress, statutoryConsentProgress: state.statutoryProgress, voteProgress: state.vote,
      noticeProgress: state.noticeProgress, legacyEvidence: !state.reviewed,
      passageDateVerified: establishedPassage };
  });
}

export async function createPortable(ctx: PortableMutationCtx, args: PreviewArgs & {
  title: string; text: string; kind: "Ordinary" | "Special"; requiredCount?: number; notes?: string;
  governingInstrumentEvidence: string; electorateEvidence: string; circulationEvidence: string; authorityReviewed: boolean;
  circulatedAtISO: string;
  /** s. 1 (c) route: the bylaw provision authorizing mail or electronic voting, and when voting closes. */
  votingRouteEvidence?: string; votingClosesAtISO?: string;
  /** The bylaw or article clause setting a lesser directors' threshold. */
  directorsOverrideEvidence?: string;
}) {
  const actor = await requireSocietyMembership(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  const circulatedAtISO = validateResolutionEventTime(args.circulatedAtISO, "circulation", nowISO);
  validateCirculationRecordingWindow(circulatedAtISO, nowISO);
  if (!args.title.trim() || !args.text.trim()) throw new Error("Enter the resolution title and its complete operative text.");
  if (!["Ordinary", "Special"].includes(args.kind)) throw new Error("Choose an ordinary or special resolution.");
  for (const [label, value] of [["governing articles/bylaws and any higher threshold", args.governingInstrumentEvidence], ["eligible voters and applicable class rights", args.electorateEvidence], ["circulation to every eligible voter", args.circulationEvidence]]) {
    if (!hasEvidence(value)) throw new Error(`Record the evidence for ${label}.`);
  }
  const route: WrittenResolutionRoute = args.route ?? "written_consent";
  let votingClosesAtISO: string | undefined;
  if (route === "mail_electronic_vote") {
    if (!hasEvidence(args.votingRouteEvidence)) throw new Error("Record the bylaw provision that authorizes voting by mail or electronic means, and the voting procedure used.");
    votingClosesAtISO = resolutionTimestamp(args.votingClosesAtISO);
    if (!votingClosesAtISO || votingClosesAtISO <= circulatedAtISO) throw new Error("Enter when voting closes, as a valid UTC timestamp after circulation.");
    if (args.requiredCount !== undefined) throw new Error("Votes-cast thresholds are fixed by the Act; a higher bylaw threshold needs legal review outside this route.");
  } else if (args.votingRouteEvidence || args.votingClosesAtISO) throw new Error("Voting evidence and a closing time apply only to the mail or electronic voting route.");
  if (args.directorsOverride && !hasEvidence(args.directorsOverrideEvidence)) throw new Error("Record the bylaw or article clause that sets the lesser directors' threshold.");
  if (!args.directorsOverride && args.directorsOverrideEvidence) throw new Error("Enter the governing-instrument threshold that the override evidence supports.");
  if (!args.authorityReviewed) throw new Error("Confirm the legal electorate, decision rule, director conflicts, and any separate class or annual waiver requirements.");
  const preview = await previewPortable(ctx, { ...args, circulatedAtISO });
  const registerIssues = preview.issues.filter((issue) => !issue.startsWith("The governing Act"));
  if (registerIssues.length) throw new Error(registerIssues.join(" "));
  if (preview.recordDateISO > preview.circulationDateISO) throw new Error("The reviewed electorate record date cannot follow circulation.");
  const requiredCount = args.requiredCount ?? preview.requiredCount;
  if (!Number.isSafeInteger(requiredCount) || requiredCount < preview.requiredCount || requiredCount > preview.total) throw new Error(`The required count must be between the statutory baseline (${preview.requiredCount}) and the full electorate (${preview.total}).`);
  return ctx.db.insert("writtenResolutions", {
    societyId: args.societyId, title: args.title.trim(), text: args.text, kind: args.kind, notes: args.notes,
    body: preview.body, recordDateISO: preview.recordDateISO, profileId: preview.profileId,
    evidenceVersion: 2,
    legalRuleReviewedOnISO: "2026-10-11", citationIds: [...preview.rule.sourceIds],
    electorate: preview.electorate, electorateTotal: preview.total, countUnit: preview.rule.unit,
    requiredCount, statutoryRequiredCount: preview.requiredCount,
    approvalRule: { numerator: preview.rule.numerator, denominator: preview.rule.denominator, strict: preview.rule.strict, unit: preview.rule.unit, basis: preview.rule.basis },
    ...(preview.rule.override && args.directorsOverride ? { approvalOverride: { kind: preview.rule.override, numerator: args.directorsOverride.numerator, denominator: args.directorsOverride.denominator,
      evidence: args.directorsOverrideEvidence!.trim(), sourceIds: [...preview.rule.sourceIds] } } : {}),
    ...(route === "mail_electronic_vote" ? { votingRoute: route, votingRouteEvidence: args.votingRouteEvidence!.trim(), votingClosesAtISO } : {}),
    governingInstrumentEvidence: args.governingInstrumentEvidence, electorateEvidence: args.electorateEvidence,
    circulationEvidence: args.circulationEvidence, authorityReviewedByUserId: actor._id,
    authorityReviewedAtISO: nowISO,
    nonSignerNoticeBusinessDays: preview.rule.noticeBusinessDays,
    circulatedAtISO, circulationTimeZone: preview.timeZone, circulationRecordedAtISO: nowISO, circulationRecordedByUserId: actor._id,
    signatures: [], nonSignerNotices: [], status: preview.complete ? "Circulating" : "Review required",
  });
}

export async function signPortable(ctx: PortableMutationCtx, args: {
  id: string; electorKey: string; signedAtISO: string; consentEvidence: string; consentDocumentId?: string; signerName?: string; memberId?: string;
  /** Required on the mail or electronic voting route; consent records are always "for". */
  vote?: "for" | "against";
}) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", args.id);
  const societyId = String(row.societyId);
  const actor = await requireSocietyMembership(ctx, societyId);
  const nowISO = new Date().toISOString();
  const current = writtenResolutionState(row, nowISO);
  if (!["Circulating", "Review required", "Carried"].includes(row.status)) throw new Error("This resolution is no longer open for consent records.");
  if (!current.reviewed || !row.electorate) throw new Error("This legacy record has no verified electorate and actual event chronology. Retain its original signed evidence for a reviewed historical record.");
  if (!current.progress.valid) throw new Error("Existing consent evidence requires review before another consent can be recorded.");
  if (current.votesCast) {
    if (args.vote !== "for" && args.vote !== "against") throw new Error("Record whether this vote was cast for or against the resolution.");
    if (row.voteCountCertifiedAtISO) throw new Error("The count of votes cast is certified. Record a correction or superseding decision instead.");
  } else if (args.vote !== undefined && args.vote !== "for") throw new Error("A written consent route records consents only. Votes against apply to the mail or electronic voting route.");
  if (args.consentDocumentId) await getOwned(ctx, "documents", args.consentDocumentId, societyId);
  const elector = validateResolutionConsent(row.electorate, row.signatures, args.electorKey, args.consentEvidence);
  if ((args.memberId && args.memberId !== elector.memberId) || (args.signerName && args.signerName.trim() !== elector.name)) throw new Error("The signer identity must match the frozen legal electorate.");
  const signedAtISO = validateResolutionEventTime(args.signedAtISO, current.votesCast ? "vote" : "consent", nowISO, row.circulatedAtISO);
  if (current.votesCast && signedAtISO > row.votingClosesAtISO) throw new Error("This vote was cast after voting closed and cannot be counted.");
  const signatures = [...row.signatures, { signerName: elector.name, electorKey: elector.key, weight: elector.weight,
    memberId: elector.memberId, directorId: elector.directorId, roleHolderId: elector.roleHolderId,
    signedAtISO, consentEvidence: args.consentEvidence.trim(), consentDocumentId: args.consentDocumentId,
    ...(current.votesCast ? { vote: args.vote } : {}),
    recordedAtISO: nowISO, recordedByUserId: actor._id }];
  if (current.votesCast) {
    // The votes-cast result is decided only by certifyVoteCount after voting closes.
    await ctx.db.patch(args.id, { signatures, status: current.supported ? row.status : "Review required" });
    return;
  }
  const state = writtenResolutionState({ ...row, signatures }, nowISO);
  const carried = state.legallyVerified && state.progress.thresholdMet;
  const completedAtISO = carried ? state.progress.thresholdReachedAtISO : row.completedAtISO;
  const dateChanged = carried && completedAtISO !== row.completedAtISO;
  await ctx.db.patch(args.id, { signatures, status: carried ? "Carried" : current.supported ? row.status : "Review required",
    completedAtISO,
    ...(dateChanged ? { completionRecordedAtISO: nowISO, completionHistory: [...(row.completionHistory ?? []), { completedAtISO, recordedAtISO: nowISO, recordedByUserId: actor._id }] } : {}),
    nonSignerNoticeTriggeredAtISO: state.noticeProgress.triggeredAtISO,
    nonSignerNoticeStatus: state.noticeProgress.status,
  });
}

/** After voting closes, an officer certifies that every vote cast by mail or electronic means is recorded. */
export async function certifyVoteCountPortable(ctx: PortableMutationCtx, args: { id: string; evidence: string }) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", args.id);
  const actor = await requireSocietyMembership(ctx, String(row.societyId));
  const nowISO = new Date().toISOString();
  const state = writtenResolutionState(row, nowISO);
  if (!state.vote) throw new Error("Only a mail or electronic vote has a count of votes cast to certify.");
  if (!state.reviewed) throw new Error("This vote has no verified electorate, route evidence and chronology.");
  if (row.status === "Failed" || row.voteCountCertifiedAtISO) throw new Error("This vote count is already decided.");
  if (!state.vote.closed) throw new Error("Certify the count only after voting closes.");
  if (!state.vote.valid) throw new Error("Existing vote evidence requires review before the count can be certified.");
  if (!hasEvidence(args.evidence)) throw new Error("Record the scrutineer or officer report confirming every vote cast, including rejected or late votes.");
  const patch: Record<string, any> = { voteCountCertifiedAtISO: nowISO, voteCountCertifiedByUserId: actor._id, voteCountEvidence: args.evidence.trim() };
  const view = writtenResolutionView({ ...row, ...patch }, nowISO);
  const status = view.establishedPassage ? "Carried" : view.state.legallyVerified ? "Failed" : "Review required";
  await ctx.db.patch(args.id, { ...patch, status,
    ...(view.establishedPassage ? { completedAtISO: row.votingClosesAtISO, completionRecordedAtISO: nowISO,
      completionHistory: [...(row.completionHistory ?? []), { completedAtISO: row.votingClosesAtISO, recordedAtISO: nowISO, recordedByUserId: actor._id }] } : {}) });
  return { status };
}

export async function recordNoticePortable(ctx: PortableMutationCtx, args: {
  id: string;
  notices: Array<{ electorKey: string; givenAtISO: string; evidence: string; documentId?: string }>;
  dueDateISO?: string; calendarEvidence?: string; timeZone?: "America/Toronto" | "America/Winnipeg";
}) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", args.id);
  const actor = await requireSocietyMembership(ctx, String(row.societyId));
  const nowISO = new Date().toISOString();
  const state = writtenResolutionState(row, nowISO);
  const trigger = state.noticeProgress.triggeredAtISO;
  if (!state.legallyVerified || !trigger || !state.noticeProgress.required) throw new Error("This resolution has no verified notice obligation to non-signing shareholders.");
  const patch: Record<string, any> = {};
  if (args.dueDateISO !== undefined || args.calendarEvidence !== undefined || args.timeZone !== undefined) {
    const timeZone = args.timeZone ?? row.nonSignerNoticeTimeZone ?? "America/Toronto";
    if (!["America/Toronto", "America/Winnipeg"].includes(timeZone)) throw new Error("Choose the reviewed Ontario time zone for this notice deadline.");
    const triggerDate = resolutionCalendarDate(trigger, timeZone)!;
    const businessDays = row.nonSignerNoticeBusinessDays ?? 10;
    const window = noticeDueDateWindow(triggerDate, businessDays);
    if (!args.dueDateISO || !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDateISO) || !resolutionTimestamp(`${args.dueDateISO}T00:00:00Z`) || !window ||
        args.dueDateISO < window.earliestISO || args.dueDateISO > window.latestISO) {
      throw new Error(`Enter the reviewed deadline: the ${businessDays}th business day after the statutory-majority date ${triggerDate}. It falls between ${window?.earliestISO ?? "the weekday deadline"} (no holidays) and ${window?.latestISO ?? "the holiday allowance"} (allowing for statutory holidays).`);
    }
    if (!args.calendarEvidence || args.calendarEvidence.trim().length < 12) throw new Error("Record the Ontario business-day and holiday calendar used to review the 10-business-day deadline.");
    Object.assign(patch, { nonSignerNoticeDueDateISO: args.dueDateISO, nonSignerNoticeCalendarEvidence: args.calendarEvidence.trim(),
      nonSignerNoticeTimeZone: timeZone, nonSignerNoticeDeadlineTriggerDateISO: triggerDate,
      nonSignerNoticeDeadlineReviewedAtISO: nowISO, nonSignerNoticeDeadlineReviewedByUserId: actor._id });
  }
  if (!args.notices.length && !Object.keys(patch).length) throw new Error("Record individual notice evidence or review the notice deadline.");
  const requiredKeys = new Set(state.noticeProgress.recipients.map((elector) => elector.key));
  const batchKeys = new Set<string>();
  const notices: ResolutionNoticeEvidence[] = [...(row.nonSignerNotices ?? [])];
  for (const notice of args.notices) {
    if (!requiredKeys.has(notice.electorKey)) throw new Error("Choose a non-signing shareholder from the frozen notice audience.");
    if (batchKeys.has(notice.electorKey)) throw new Error("Record each recipient only once in this notice batch.");
    batchKeys.add(notice.electorKey);
    const givenAtISO = validateResolutionEventTime(notice.givenAtISO, "notice", nowISO, trigger);
    if (notice.evidence.trim().length < 12) throw new Error("Retain evidence that this shareholder was given the written resolution, business description and reasons required by OBCA s.104(4).");
    if (notice.documentId) await getOwned(ctx, "documents", notice.documentId, String(row.societyId));
    if (notices.some((prior) => prior.electorKey === notice.electorKey && prior.givenAtISO === givenAtISO && prior.evidence === notice.evidence.trim())) throw new Error("This notice evidence is already recorded.");
    notices.push({ electorKey: notice.electorKey, givenAtISO, evidence: notice.evidence.trim(), documentId: notice.documentId,
      recordedAtISO: nowISO, recordedByUserId: actor._id });
  }
  const updated = writtenResolutionState({ ...row, ...patch, nonSignerNotices: notices }, nowISO);
  await ctx.db.patch(args.id, { ...patch, nonSignerNotices: notices, nonSignerNoticeStatus: updated.noticeProgress.status,
    nonSignerNoticeRecordedAtISO: nowISO, nonSignerNoticeRecordedByUserId: actor._id });
}

export async function markFailedPortable(ctx: PortableMutationCtx, { id, note }: { id: string; note?: string }) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", id);
  if (row.status === "Carried") throw new Error("A carried resolution cannot be failed retrospectively. Record a separate corrective resolution.");
  await ctx.db.patch(id, { status: "Failed", ...(note ? { notes: note } : {}) });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", id);
  if (row.signatures?.length) throw new Error("Keep resolutions with consent evidence in the minute book. Record a correction or superseding decision instead.");
  await ctx.db.delete(id);
}
