/** Portable, tenant-scoped records of circulated resolutions and consent evidence. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { corporateElectionPreview } from "./electionElectorate";
import { legalGovernanceProfile, legalProfileRegistry, requiredWrittenConsents, writtenResolutionRule } from "../legalGovernanceProfiles";
import { resolutionCalendarDate, resolutionConsentProgress, resolutionNoticeProgress, resolutionTimestamp,
  validateResolutionConsent, validateResolutionEventTime, type ResolutionElector, type ResolutionNoticeEvidence } from "../writtenResolutionEvidence";

type ResolutionBody = "members" | "shareholders" | "directors";
type PreviewArgs = { societyId: string; body?: ResolutionBody; kind?: "Ordinary" | "Special"; recordDateISO?: string; specialMajority?: "two_thirds" | "three_quarters" };

/** All conclusions are derived from immutable electorate and individual event evidence. */
function resolutionState(row: Record<string, any>, nowISO: string) {
  const electorate: ResolutionElector[] = row.electorate ?? [];
  const chronology = { circulatedAtISO: row.circulatedAtISO, asOfISO: nowISO };
  const progress = resolutionConsentProgress(electorate, row.signatures ?? [], row.requiredCount, chronology);
  const statutoryProgress = resolutionConsentProgress(electorate, row.signatures ?? [], row.statutoryRequiredCount, chronology);
  const circulated = resolutionTimestamp(row.circulatedAtISO);
  const recorded = resolutionTimestamp(row.circulationRecordedAtISO);
  const approved = resolutionTimestamp(row.authorityReviewedAtISO);
  const total = electorate.reduce((sum, elector) => sum + elector.weight, 0);
  const frozenRule = row.approvalRule;
  const reviewed = row.evidenceVersion === 2 && !!circulated && !!recorded && !!approved &&
    circulated <= recorded && recorded <= nowISO && approved <= nowISO && !!row.circulationRecordedByUserId && !!row.authorityReviewedByUserId &&
    [row.governingInstrumentEvidence, row.electorateEvidence, row.circulationEvidence].every((evidence) => typeof evidence === "string" && evidence.trim().length >= 12) &&
    total === row.electorateTotal && !!frozenRule && frozenRule.unit === row.countUnit &&
    requiredWrittenConsents(total, frozenRule) === row.statutoryRequiredCount &&
    row.statutoryRequiredCount > 0 && row.requiredCount >= row.statutoryRequiredCount;
  const supported = legalProfileRegistry.get(String(row.profileId))?.confidence === "verified_core";
  const legallyVerified = reviewed && supported && progress.valid && statutoryProgress.valid;
  const noticeTrigger = legallyVerified && row.nonSignerNoticeBusinessDays ? statutoryProgress.thresholdReachedAtISO : undefined;
  const noticeProgress = resolutionNoticeProgress(electorate, row.signatures ?? [], row.nonSignerNotices ?? [], noticeTrigger, {
    dueDateISO: row.nonSignerNoticeDueDateISO, triggerDateISO: row.nonSignerNoticeDeadlineTriggerDateISO,
    timeZone: row.nonSignerNoticeTimeZone, calendarEvidence: row.nonSignerNoticeCalendarEvidence,
    reviewedByUserId: row.nonSignerNoticeDeadlineReviewedByUserId, reviewedAtISO: row.nonSignerNoticeDeadlineReviewedAtISO,
  }, nowISO);
  return { progress, statutoryProgress, reviewed, supported, legallyVerified, noticeProgress };
}

export async function previewPortable(ctx: PortableQueryCtx, args: PreviewArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const organization = await ctx.db.get(args.societyId, "societies");
  const profile = legalGovernanceProfile(organization);
  const body = args.body ?? (profile?.kind === "corporation" ? "shareholders" : "members");
  if ((profile?.kind === "corporation" && body === "members") || (profile?.kind === "society" && body === "shareholders")) throw new Error("Choose the decision body that belongs to this legal entity.");
  const recordDateISO = args.recordDateISO ?? new Date().toISOString().slice(0, 10);
  const issues: string[] = [];
  let electorate: ResolutionElector[] = [];
  const rule = writtenResolutionRule(organization, args.kind ?? "Special", body);
  if (!profile) issues.push("The governing Act has no verified automated resolution profile. Evidence can be recorded, but the result requires legal review.");
  if (body === "shareholders") {
    const result = await corporateElectionPreview(ctx, args.societyId, { recordDateISO, recordDateBasis: "", rightsBasis: "", ledgerBasis: "", votingMethod: "per_share", representatives: [] });
    issues.push(...result.issues);
    electorate = result.votingHolders.map((holder) => ({ key: `shareholder:${holder.roleHolderId}`, name: holder.fullName,
      roleHolderId: holder.roleHolderId, weight: rule?.unit === "votes" ? holder.totalVotes : rule?.unit === "shares" ? holder.classVotes.filter((entry) => entry.votesPerShare > 0).reduce((sum, entry) => sum + entry.quantity, 0) : 1 }));
  } else {
    if (recordDateISO !== new Date().toISOString().slice(0, 10)) issues.push("Member and director snapshots use the current register. Review a historical decision through its original signed records.");
    const table = body === "directors" ? "directors" : "members";
    const rows = await ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", args.societyId)).take(5001);
    if (rows.length > 5000) issues.push("The register exceeds the 5,000-person snapshot limit; prepare a reviewed batch import.");
    electorate = rows.filter((row) => row.status === "Active" && (body === "directors" || row.votingRights === true))
      .map((row) => ({ key: `${body === "directors" ? "director" : "member"}:${row._id}`, name: `${row.firstName} ${row.lastName}`.trim(), weight: 1,
        ...(body === "directors" ? { directorId: row._id } : { memberId: row._id }) }));
  }
  if (!electorate.length) issues.push("The register has no eligible voters for this decision body.");
  const total = electorate.reduce((sum, elector) => sum + elector.weight, 0);
  if (!Number.isSafeInteger(total) || total < 1) issues.push("The electorate must have a positive, exact integer voting total.");
  const threshold = rule ? { ...rule } : { numerator: 1, denominator: 1, strict: false, unit: "people" as const, sourceIds: [] as readonly string[] };
  if (rule?.usesSpecialMajority && args.specialMajority === "three_quarters") { threshold.numerator = 3; threshold.denominator = 4; }
  const requiredCount = requiredWrittenConsents(total, threshold);
  return { body, recordDateISO, profileId: profile?.id, electorate, total, requiredCount, rule: threshold, issues,
    complete: issues.length === 0, caveat: profile?.resolutions.caveat };
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db.query("writtenResolutions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const nowISO = new Date().toISOString();
  return rows.map((row) => {
    const state = resolutionState(row, nowISO);
    const establishedPassage = state.legallyVerified && state.progress.thresholdMet && row.completedAtISO === state.progress.thresholdReachedAtISO;
    return { ...row, originalStatus: row.status,
      status: row.status === "Carried" && !establishedPassage ? "Review required" : row.status,
      nonSignerNoticeStatus: state.noticeProgress.status ?? (row.nonSignerNoticeStatus ? "Review required" : undefined),
      consentProgress: state.progress, statutoryConsentProgress: state.statutoryProgress,
      noticeProgress: state.noticeProgress, legacyEvidence: !state.reviewed,
      passageDateVerified: establishedPassage };
  });
}

export async function createPortable(ctx: PortableMutationCtx, args: PreviewArgs & {
  title: string; text: string; kind: "Ordinary" | "Special"; requiredCount?: number; notes?: string;
  governingInstrumentEvidence: string; electorateEvidence: string; circulationEvidence: string; authorityReviewed: boolean;
  circulatedAtISO: string;
}) {
  const actor = await requireSocietyMembership(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  const circulatedAtISO = validateResolutionEventTime(args.circulatedAtISO, "circulation", nowISO);
  if (circulatedAtISO.slice(0, 10) !== nowISO.slice(0, 10)) throw new Error("Create a new circulation record on the UTC calendar date when circulation occurred. Historical signed resolutions need their original reviewed electorate and supporting records; today's register cannot establish that history.");
  if (!args.title.trim() || !args.text.trim()) throw new Error("Enter the resolution title and its complete operative text.");
  if (!["Ordinary", "Special"].includes(args.kind)) throw new Error("Choose an ordinary or special resolution.");
  for (const [label, value] of [["governing articles/bylaws and any higher threshold", args.governingInstrumentEvidence], ["eligible voters and applicable class rights", args.electorateEvidence], ["circulation to every eligible voter", args.circulationEvidence]]) {
    if (!value || value.trim().length < 12) throw new Error(`Record the evidence for ${label}.`);
  }
  if (!args.authorityReviewed) throw new Error("Confirm the legal electorate, decision rule, director conflicts, and any separate class or annual waiver requirements.");
  const preview = await previewPortable(ctx, args);
  if (preview.recordDateISO > circulatedAtISO.slice(0, 10)) throw new Error("The reviewed electorate record date cannot follow circulation.");
  const registerIssues = preview.issues.filter((issue) => !issue.startsWith("The governing Act"));
  if (registerIssues.length) throw new Error(registerIssues.join(" "));
  const requiredCount = args.requiredCount ?? preview.requiredCount;
  if (!Number.isSafeInteger(requiredCount) || requiredCount < preview.requiredCount || requiredCount > preview.total) throw new Error(`The required count must be between the statutory baseline (${preview.requiredCount}) and the full electorate (${preview.total}).`);
  return ctx.db.insert("writtenResolutions", {
    societyId: args.societyId, title: args.title.trim(), text: args.text, kind: args.kind, notes: args.notes,
    body: preview.body, recordDateISO: preview.recordDateISO, profileId: preview.profileId,
    evidenceVersion: 2,
    legalRuleReviewedOnISO: "2026-10-11", citationIds: [...preview.rule.sourceIds],
    electorate: preview.electorate, electorateTotal: preview.total, countUnit: preview.rule.unit,
    requiredCount, statutoryRequiredCount: preview.requiredCount,
    approvalRule: { numerator: preview.rule.numerator, denominator: preview.rule.denominator, strict: preview.rule.strict, unit: preview.rule.unit },
    governingInstrumentEvidence: args.governingInstrumentEvidence, electorateEvidence: args.electorateEvidence,
    circulationEvidence: args.circulationEvidence, authorityReviewedByUserId: actor._id,
    authorityReviewedAtISO: nowISO,
    nonSignerNoticeBusinessDays: "noticeBusinessDays" in preview.rule ? preview.rule.noticeBusinessDays : undefined,
    circulatedAtISO, circulationRecordedAtISO: nowISO, circulationRecordedByUserId: actor._id,
    signatures: [], nonSignerNotices: [], status: preview.complete ? "Circulating" : "Review required",
  });
}

export async function signPortable(ctx: PortableMutationCtx, args: {
  id: string; electorKey: string; signedAtISO: string; consentEvidence: string; consentDocumentId?: string; signerName?: string; memberId?: string;
}) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", args.id);
  const societyId = String(row.societyId);
  const actor = await requireSocietyMembership(ctx, societyId);
  const nowISO = new Date().toISOString();
  const current = resolutionState(row, nowISO);
  if (!["Circulating", "Review required", "Carried"].includes(row.status)) throw new Error("This resolution is no longer open for consent records.");
  if (!current.reviewed || !row.electorate) throw new Error("This legacy record has no verified electorate and actual event chronology. Retain its original signed evidence for a reviewed historical record.");
  if (!current.progress.valid) throw new Error("Existing consent evidence requires review before another consent can be recorded.");
  if (args.consentDocumentId) await getOwned(ctx, "documents", args.consentDocumentId, societyId);
  const elector = validateResolutionConsent(row.electorate, row.signatures, args.electorKey, args.consentEvidence);
  if ((args.memberId && args.memberId !== elector.memberId) || (args.signerName && args.signerName.trim() !== elector.name)) throw new Error("The signer identity must match the frozen legal electorate.");
  const signedAtISO = validateResolutionEventTime(args.signedAtISO, "consent", nowISO, row.circulatedAtISO);
  const signatures = [...row.signatures, { signerName: elector.name, electorKey: elector.key, weight: elector.weight,
    memberId: elector.memberId, directorId: elector.directorId, roleHolderId: elector.roleHolderId,
    signedAtISO, consentEvidence: args.consentEvidence.trim(), consentDocumentId: args.consentDocumentId,
    recordedAtISO: nowISO, recordedByUserId: actor._id }];
  const state = resolutionState({ ...row, signatures }, nowISO);
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

export async function recordNoticePortable(ctx: PortableMutationCtx, args: {
  id: string;
  notices: Array<{ electorKey: string; givenAtISO: string; evidence: string; documentId?: string }>;
  dueDateISO?: string; calendarEvidence?: string; timeZone?: "America/Toronto" | "America/Winnipeg";
}) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", args.id);
  const actor = await requireSocietyMembership(ctx, String(row.societyId));
  const nowISO = new Date().toISOString();
  const state = resolutionState(row, nowISO);
  const trigger = state.noticeProgress.triggeredAtISO;
  if (!state.legallyVerified || !trigger || !state.noticeProgress.required) throw new Error("This resolution has no verified notice obligation to non-signing shareholders.");
  const patch: Record<string, any> = {};
  if (args.dueDateISO !== undefined || args.calendarEvidence !== undefined || args.timeZone !== undefined) {
    const timeZone = args.timeZone ?? row.nonSignerNoticeTimeZone ?? "America/Toronto";
    if (!["America/Toronto", "America/Winnipeg"].includes(timeZone)) throw new Error("Choose the reviewed Ontario time zone for this notice deadline.");
    const triggerDate = resolutionCalendarDate(trigger, timeZone)!;
    if (!args.dueDateISO || !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDateISO) || !resolutionTimestamp(`${args.dueDateISO}T00:00:00Z`) || args.dueDateISO < triggerDate) throw new Error("Enter a valid reviewed notice deadline on or after the statutory-majority date.");
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
  const updated = resolutionState({ ...row, ...patch, nonSignerNotices: notices }, nowISO);
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
