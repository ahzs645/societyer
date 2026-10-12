/**
 * PORTABLE FUNCTIONS: the corporation-settings domain (complianceDeadlines,
 * recordAnnualDeadlineCalendarReview, recordWrittenAnnualBusinessCompletion,
 * updateAnnualEvidenceSettings).
 *
 * Derives compliance deadlines (AGM / fiscal-year-end / annual report) from a
 * society's settings — the YCN Corporation_Settings → deadlines idea — through
 * the same evidence adapter as the Compliance settings page and annual cycle.
 * All date math lives in the pure, unit-tested shared/corporationSettings.ts.
 * The mutations record reviewed annual-deadline evidence on the societies row.
 * Runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  addComplianceDays,
  assessAnnualMeetingDeadline,
  assessAnnualReturnDeadline,
  complianceDateFromISO,
  deriveComplianceDeadlines,
  parseComplianceDate,
  type AnnualDeadlineCalendarReview,
} from "../corporationSettings";
import { annualGovernanceSettings } from "../annualGovernanceEvidence";
import { isAgmMeeting } from "../agmEvidence";
import { legalGovernanceProfile } from "../legalGovernanceProfiles";
import { cleanOperativeArticles, operativeArticlesProblems, type OperativeArticles } from "../operativeArticles";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { listPortable as listWrittenResolutionsPortable } from "./writtenResolutions";

async function canReadFilings(ctx: PortableQueryCtx, societyId: string): Promise<boolean> {
  try {
    await requirePermissionPortable(ctx, societyId, "filings:read");
    return true;
  } catch {
    return false;
  }
}

export async function complianceDeadlinesPortable(
  ctx: PortableQueryCtx,
  { societyId, fromISO }: { societyId: string; fromISO: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const today = complianceDateFromISO(fromISO);
  if (!today) return [];
  const society = await ctx.db.get(societyId, "societies");
  if (!society) return [];
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  // Filing evidence closes annual-return cycles. Without filing access it is
  // not read, and the annual-return deadline is reported as needing review,
  // exactly as on the Compliance settings page.
  const filingsReadable = await canReadFilings(ctx, societyId);
  const filings = filingsReadable
    ? await ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()
    : [];
  const agms = meetings.filter((meeting) => isAgmMeeting(meeting as any) && !/^cancel/i.test(String(meeting.status ?? "")));
  const settings = annualGovernanceSettings(society as any, agms as any[], filings, today);
  return deriveComplianceDeadlines(settings, today).map((deadline) =>
    deadline.key === "annual-report" && !filingsReadable
      ? { ...deadline, status: "review_required" as const, basis: `${deadline.basis} Filing evidence is not available in this view; completion and overdue status require someone with filing access to review the register.` }
      : deadline);
}

const OBLIGATIONS = ["annual_meeting", "annual_return"] as const;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const MIN_EVIDENCE = 12;

/**
 * Record a reviewed holiday/office calendar for one calculated annual boundary.
 * The review must match the boundary the engine currently calculates for that
 * Act, obligation and cycle; it cannot move a boundary earlier, be reused for
 * another cycle, or be dated in the future.
 */
export async function recordAnnualDeadlineCalendarReviewPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    obligation: AnnualDeadlineCalendarReview["obligation"];
    cycleYear: number;
    nominalDueDate: string;
    reviewedDueDate: string;
    calendarBasis: string;
    evidenceRef: string;
    channel?: string;
    reviewedOn?: string;
  },
) {
  const actor = await requireSocietyMembership(ctx, args.societyId);
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("societies not found.");
  const profile = legalGovernanceProfile(society);
  if (!profile) throw new Error("A reviewed governing-Act profile is required before a deadline calendar can be reviewed.");
  if (!OBLIGATIONS.includes(args.obligation)) throw new Error("Choose the annual meeting or annual return deadline.");
  if (!Number.isInteger(args.cycleYear) || args.cycleYear < 1 || args.cycleYear > 9999) throw new Error("The cycle year must be a four-digit year.");
  const today = new Date().toISOString().slice(0, 10);
  const reviewedOn = args.reviewedOn ?? today;
  if (!parseComplianceDate(args.nominalDueDate) || !parseComplianceDate(args.reviewedDueDate) || !parseComplianceDate(reviewedOn)) throw new Error("Enter valid calendar dates.");
  if (reviewedOn > today) throw new Error("A calendar review cannot be dated in the future.");
  if (args.reviewedDueDate < args.nominalDueDate) throw new Error("An annual expiry review cannot move the boundary earlier than the nominal date.");
  const latestAdjusted = addComplianceDays(args.nominalDueDate, 7);
  if (!latestAdjusted || args.reviewedDueDate > latestAdjusted) throw new Error("Holiday and office-closure adjustments move an annual boundary by a few days at most; a later date needs an extension, not a calendar review.");
  const calendarBasis = text(args.calendarBasis), evidenceRef = text(args.evidenceRef);
  if (calendarBasis.length < MIN_EVIDENCE) throw new Error("Describe the interpretation statute, holiday calendar, locality and filing office or channel reviewed.");
  if (evidenceRef.length < MIN_EVIDENCE) throw new Error("Identify the calendar evidence relied on.");
  // The review must address a boundary the engine calculates for that cycle
  // (the open cycle, or the selected cycle). A review for another boundary
  // would never apply, so it is rejected rather than stored as inert evidence.
  const [meetings, filings] = await Promise.all([
    ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
  ]);
  const agms = meetings.filter((meeting) => isAgmMeeting(meeting as any) && !/^cancel/i.test(String(meeting.status ?? "")));
  const settings = annualGovernanceSettings(society as any, agms as any[], filings, today);
  const candidates = args.obligation === "annual_meeting"
    ? [assessAnnualMeetingDeadline(settings, today), assessAnnualMeetingDeadline({ ...settings, annualMeetingAssessmentYear: args.cycleYear }, today),
      ...(profile.annualMeeting.first === "following_calendar_year" ? [] : [assessAnnualMeetingDeadline({ ...settings, annualMeetingCompletions: settings.annualMeetingCompletions?.filter((item) => Number(item.date.slice(0, 4)) < args.cycleYear), heldAgmYears: undefined, annualReferenceDate: settings.annualReferenceDate && Number(settings.annualReferenceDate.slice(0, 4)) < args.cycleYear ? settings.annualReferenceDate : undefined }, today)])]
    : [assessAnnualReturnDeadline(settings, today), assessAnnualReturnDeadline({ ...settings, annualReturnCycleYear: args.cycleYear }, today)];
  if (!candidates.some((assessment) => assessment.cycleYear === args.cycleYear && (assessment.nominalDueDate ?? assessment.dueDate) === args.nominalDueDate)) {
    throw new Error("The nominal date does not match a boundary calculated for this cycle. Review the boundary shown for the cycle.");
  }
  const existing = (Array.isArray(society.annualDeadlineCalendarReviews) ? society.annualDeadlineCalendarReviews : []) as Record<string, any>[];
  const same = (item: Record<string, any>) => item.profileId === profile.id && item.obligation === args.obligation && item.cycleYear === args.cycleYear && item.nominalDueDate === args.nominalDueDate;
  const nowISO = new Date().toISOString();
  const review = {
    profileId: profile.id, obligation: args.obligation, cycleYear: args.cycleYear,
    nominalDueDate: args.nominalDueDate, reviewedDueDate: args.reviewedDueDate, reviewedOn,
    verified: true, evidenceRef, calendarBasis,
    ...(text(args.channel) ? { channel: text(args.channel) } : {}),
    recordedAtISO: nowISO, recordedByUserId: String(actor._id),
  };
  // A corrected review supersedes the earlier one for the same boundary; the
  // superseded entry is kept in the activity history.
  await ctx.db.patch(args.societyId, { annualDeadlineCalendarReviews: [...existing.filter((item) => !same(item)), review], updatedAt: Date.now() });
  await ctx.db.insert("activity", {
    societyId: args.societyId, actor: String((actor as Record<string, any>).displayName ?? (actor as Record<string, any>).email ?? "Workspace user"), entityType: "society",
    action: "annual-deadline-calendar-reviewed",
    summary: `Calendar reviewed for the ${args.cycleYear} ${args.obligation === "annual_meeting" ? "annual meeting" : "annual return"} boundary ${args.nominalDueDate}: reviewed deadline ${args.reviewedDueDate}. ${existing.some(same) ? "Supersedes an earlier review. " : ""}Basis: ${calendarBasis}`.slice(0, 300),
    createdAtISO: nowISO,
  });
  return review;
}

/**
 * Record a written resolution that disposed of the annual meeting's business
 * (BC Societies Act s. 72, BC Business Corporations Act s. 182, CBCA s. 142,
 * OBCA s. 104) as a completion of the annual-meeting obligation. The linked
 * resolution must be an established member/shareholder written resolution in
 * this workspace; a reviewer confirms that it covered all required annual
 * business. A bare waiver is accepted only where the Act provides one.
 */
export async function recordWrittenAnnualBusinessCompletionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    writtenResolutionId: string;
    kind: "written_annual_business" | "written_waiver";
    completedOn: string;
    cycleYear?: number;
    annualReferenceDate?: string;
    financialYearEnd?: string;
    annualBusinessEvidence: string;
    annualBusinessReviewed: boolean;
  },
) {
  const actor = await requireSocietyMembership(ctx, args.societyId);
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("societies not found.");
  const resolution = await getOwned(ctx, "writtenResolutions", args.writtenResolutionId, args.societyId);
  const profile = legalGovernanceProfile(society);
  if (!profile) throw new Error("A reviewed governing-Act profile is required before annual business can be completed in writing.");
  if (!["written_annual_business", "written_waiver"].includes(args.kind)) throw new Error("Choose written annual business or, where the Act allows it, a written waiver.");
  if (args.kind === "written_waiver" && profile.id !== "bc_company") throw new Error("Only the BC Business Corporations Act provides a written waiver of the annual meeting; record the written disposal of annual business instead.");
  if (resolution.body === "directors") throw new Error("Annual business is disposed of by the members or shareholders, not by a directors' resolution.");
  // Reuse the written-resolution evaluation: only a resolution whose passage is
  // established from its own evidence can complete annual business.
  const listed = (await listWrittenResolutionsPortable(ctx, { societyId: args.societyId })).find((row: any) => String(row._id) === String(args.writtenResolutionId)) as Record<string, any> | undefined;
  if (!listed || listed.status !== "Carried" || listed.passageDateVerified !== true || !listed.completedAtISO) {
    throw new Error("The written resolution must be carried, with its passage established from recorded consent evidence, before it can complete annual business.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const completedOn = args.completedOn;
  if (!parseComplianceDate(completedOn) || completedOn > today) throw new Error("Enter the date the resolution took effect; it cannot be in the future.");
  const passage = String(listed.completedAtISO).slice(0, 10);
  const earliest = addComplianceDays(passage, -1), latest = addComplianceDays(passage, 1);
  if (!earliest || !latest || completedOn < earliest || completedOn > latest) throw new Error(`The completion date must be the date the resolution took effect (recorded passage ${passage}).`);
  const start = society.recognitionDate ?? society.incorporationDate;
  if (parseComplianceDate(start) && completedOn < start) throw new Error("Annual business cannot be completed before recognition.");
  const cycleYear = args.cycleYear ?? Number(completedOn.slice(0, 4));
  if (!Number.isInteger(cycleYear) || cycleYear !== Number(completedOn.slice(0, 4))) throw new Error("A written completion covers the calendar year in which it took effect.");
  if (args.annualReferenceDate !== undefined && (!parseComplianceDate(args.annualReferenceDate) || args.annualReferenceDate > today || (parseComplianceDate(start) && args.annualReferenceDate < start))) throw new Error("Enter a valid annual reference date, on or after recognition and not in the future.");
  if (profile.id === "bc_company" && !args.annualReferenceDate) throw new Error("A BC written alternative must state the annual reference date selected under s. 182.");
  if (args.financialYearEnd !== undefined && (!parseComplianceDate(args.financialYearEnd) || args.financialYearEnd > completedOn)) throw new Error("The financial year dealt with must end on or before the completion.");
  const evidence = text(args.annualBusinessEvidence);
  if (!args.annualBusinessReviewed || evidence.length < MIN_EVIDENCE) {
    throw new Error("Confirm and describe how the resolution disposed of all required annual business, including financial statements, director elections and auditor matters, and any written statements the Act requires.");
  }
  const existing = (Array.isArray(society.annualMeetingCompletions) ? society.annualMeetingCompletions : []) as Record<string, any>[];
  if (existing.some((item) => String(item.writtenResolutionId ?? "") === String(args.writtenResolutionId))) throw new Error("This written resolution is already recorded as an annual-business completion.");
  const nowISO = new Date().toISOString();
  const completion = {
    date: completedOn, kind: args.kind, cycleYear, verified: true,
    evidenceRef: `writtenResolution:${args.writtenResolutionId} — ${evidence}`,
    writtenResolutionId: args.writtenResolutionId,
    ...(args.annualReferenceDate ? { annualReferenceDate: args.annualReferenceDate } : {}),
    ...(args.financialYearEnd ? { financialYearEnd: args.financialYearEnd } : {}),
    recordedAtISO: nowISO, recordedByUserId: String(actor._id),
  };
  await ctx.db.patch(args.societyId, {
    annualMeetingCompletions: [...existing, completion],
    // CBCA: the next meeting's six-month limit runs from the following financial year-end.
    ...(args.financialYearEnd && profile.annualMeeting.afterFiscalYearEndMonths && (!society.annualMeetingFinancialYearEnd || society.annualMeetingFinancialYearEnd <= args.financialYearEnd)
      ? { annualMeetingFinancialYearEnd: undefined } : {}),
    updatedAt: Date.now(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId, actor: String((actor as Record<string, any>).displayName ?? (actor as Record<string, any>).email ?? "Workspace user"), entityType: "writtenResolution",
    subjectId: args.writtenResolutionId, entityId: args.writtenResolutionId,
    action: "annual-business-completed-in-writing",
    summary: `Written resolution "${String(resolution.title ?? "")}" recorded as ${args.kind === "written_waiver" ? "a written annual-meeting waiver" : "written disposal of annual business"} for ${cycleYear}, effective ${completedOn}.`.slice(0, 300),
    createdAtISO: nowISO,
  });
  return completion;
}

/** Actual periods the annual engine needs when the recurring calendar is not enough. */
export async function updateAnnualEvidenceSettingsPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; annualMeetingFinancialYearEnd?: string | null; annualReturnPeriodEnd?: string | null },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const patch: Record<string, string | undefined> = {};
  for (const field of ["annualMeetingFinancialYearEnd", "annualReturnPeriodEnd"] as const) {
    const value = args[field];
    if (value === undefined) continue;
    if (value !== null && value !== "" && !parseComplianceDate(value)) throw new Error("Enter a valid date.");
    patch[field] = value || undefined;
  }
  await ctx.db.patch(args.societyId, { ...patch, updatedAt: Date.now() });
  return args.societyId;
}

/**
 * Record which articles a BC company adopted (Table 1 version or custom),
 * its custom Parts and the article overrides. `operativeArticles: null`
 * clears the record. Only BC companies may record articles here; the linked
 * articles document must belong to the same workspace.
 */
export async function updateOperativeArticlesPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; operativeArticles: OperativeArticles | null },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("societies not found.");
  if (args.operativeArticles === null) {
    await ctx.db.patch(args.societyId, { operativeArticles: undefined, updatedAt: Date.now() });
    return args.societyId;
  }
  const problems = operativeArticlesProblems(args.operativeArticles, society);
  if (problems.length) throw new Error(problems.join(" "));
  const cleaned = cleanOperativeArticles(args.operativeArticles);
  if (cleaned.sourceDocumentId) {
    const document = await ctx.db.get(cleaned.sourceDocumentId).catch(() => null);
    if (!document || String(document.societyId) !== String(args.societyId)) throw new Error("The articles document was not found in this workspace.");
  }
  await ctx.db.patch(args.societyId, { operativeArticles: { ...cleaned, recordedAtISO: new Date().toISOString() }, updatedAt: Date.now() });
  return args.societyId;
}
