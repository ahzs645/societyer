import { bylawBaselineForOrganization, contextualBylawRules } from "../bylawBaselines";
import { humanDate } from "../humanDate";
import { minutesQuorumLabel, recordedMinutesQuorum } from "../minutesQuorum";
/**
 * PORTABLE FUNCTIONS: the annual-cycle domain (summary).
 *
 * Derives the annual governance cycle dashboard (AGM planning, notice, financial
 * statements, elections, post-AGM filings, ongoing obligations) from live tables
 * over `ctx.db`. Runs unchanged on hosted Convex, the local Dexie runtime, and
 * the convex-test oracle.
 *
 * The bylaw rule-resolution helpers (`getActiveBylawRuleSet` +
 * `getBylawRuleSetForDate` + `getDefaultBylawRules`) are portable copies of
 * `convex/lib/bylawRules.ts`: that module imports `_generated`, so its pure
 * `ctx.db`-only logic is inlined here on the portable contract. The agenda
 * reader (`readMeetingAgendaItems`) is a portable copy of
 * `convex/lib/agendaItems.ts`.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import { minutesMotionsForDisplay } from "../minutesMotions";
import { resolveMinutesMotions } from "./minutes";
import { annualReportForAgm, isAgmMeeting, isHeldMeeting, noAgmAnnualReportForYear } from "../agmEvidence";
import { localDateKey } from "../dateOnly";
import { organizationRuleScope } from "../entityRuleScope";
import { entityMeetingWording } from "../entityMeetingWording";
import { legalGovernanceProfile, minimumLegalDirectors, requiredResidentCanadianDirectors } from "../legalGovernanceProfiles";
import { resolvePrivacyProfile } from "../privacyRuleProfiles";
import { earliestPermittedNoticeDate, latestPermittedNoticeDate, NOTICE_CALENDAR_REVIEW_CAVEAT } from "../legalMeetingNotice";
import { annualGovernanceSettings, assessAnnualGovernanceReturnCycle } from "../annualGovernanceEvidence";
import { assessAnnualMeetingDeadline, withAnnualMeetingCompletion, type DeadlineAssessment } from "../corporationSettings";

type ItemStatus = "complete" | "attention" | "blocked" | "upcoming";

type CycleItem = {
  id: string;
  phase: "before" | "during" | "after" | "ongoing";
  title: string;
  detail: string;
  status: ItemStatus;
  evidence: string[];
  sourceIds?: readonly string[];
  dueDate?: string;
  to: string;
  actionLabel: string;
};

const DAY_MS = 86_400_000;

export async function summaryPortable(
  ctx: PortableQueryCtx,
  { societyId, year }: { societyId: string; year?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  const cycleYear = year ?? new Date().getFullYear();
  const now = new Date();
  const today = dateOnly(now);
  const startISO = `${cycleYear}-01-01`;
  const endISO = `${cycleYear}-12-31`;

  const [
    society,
    meetings,
    minutesRows,
    filings,
    deadlines,
    financials,
    directors,
    members,
    policies,
    conflicts,
    annualMaintenanceRecords,
    directorAttestations,
    pipaTrainings,
    agmRuns,
    elections,
    proxies,
    memberProposals,
  ] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financials").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("policies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("conflicts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("annualMaintenanceRecords").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("directorAttestations").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("pipaTrainings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("agmRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("elections").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("proxies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("memberProposals").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);

  const rules = await getActiveBylawRuleSet(ctx, societyId);
  // Society-only steps (member register, BC-resident director, AGM-anchored
  // annual report) and BC PIPA wording are gated on the workspace's entity
  // type and home jurisdiction.
  const scope = organizationRuleScope(society);
  const profile = legalGovernanceProfile(society);
  const privacy = resolvePrivacyProfile(society);
  const corporation = scope.isCorporation;
  const holderNoun = corporation ? "shareholder" : "member";
  // "AGM" for societies; "annual meeting" for corporations and custom entities.
  const wording = entityMeetingWording(society);
  const am = wording.annualMeeting;
  const amTitle = wording.annualMeetingTitle;
  const requiresBcResidentDirector = scope.isBcSociety && !society?.isMemberFunded;
  const activeMembers = members.filter((member) => member.status === "Active");
  const votingMembers = activeMembers.filter((member) => member.votingRights);
  const memberDataStatus = society?.memberDataAccessStatus ?? "Unknown";
  const memberRegisterIsInstitutionHeld =
    memberDataStatus === "Institution-held" ||
    memberDataStatus === "Partially available" ||
    memberDataStatus === "Not applicable";
  const memberRegisterDocumented =
    votingMembers.length > 0 ||
    (memberRegisterIsInstitutionHeld && Boolean(society?.memberDataGapDocumented));
  const activeDirectors = directors.filter((director) => director.status === "Active" && !director.resignedAt);
  const minimumDirectors = minimumLegalDirectors(society);
  const canadianResidencyRequired = profile?.directors.residency === "canadian_25_percent";
  const canadianDirectors = activeDirectors.filter((director) => director.residentCanadianStatus === "yes").length;
  const requiredCanadianDirectors = requiredResidentCanadianDirectors(activeDirectors.length);
  const directorsCompositionReady = minimumDirectors !== undefined && activeDirectors.length >= minimumDirectors &&
    (!requiresBcResidentDirector || activeDirectors.some((director) => director.isBCResident)) &&
    (!canadianResidencyRequired || canadianDirectors >= requiredCanadianDirectors);
  const allAgms = meetings
    .filter((meeting) => isAgmMeeting(meeting as any) && !/^cancel/i.test(String(meeting.status ?? "")))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const annualSettings = annualGovernanceSettings(society ?? {}, allAgms as any[], filings, today);
  const completionYear = (meeting: any) => annualSettings.annualMeetingCompletions?.find(item => item.date === dateOnly(meeting.heldAt ?? meeting.scheduledAt))?.cycleYear ?? Number(dateOnly(meeting.heldAt ?? meeting.scheduledAt).slice(0, 4));
  const agms = allAgms.filter((meeting) => isHeldMeeting(meeting as any, today) ? completionYear(meeting) === cycleYear : inYear(meeting.scheduledAt, cycleYear));
  const selectedAgm =
    agms.find((meeting) => new Date(meeting.scheduledAt).getTime() >= now.getTime()) ??
    agms[agms.length - 1] ??
    null;
  const heldAgmForCycle = agms.filter((meeting) => isHeldMeeting(meeting as any, today)).at(-1);
  const heldAgmDate = heldAgmForCycle ? dateOnly(heldAgmForCycle.heldAt ?? heldAgmForCycle.scheduledAt) : "";
  const firstCompletion = annualSettings.annualMeetingCompletions?.find(item => (item.cycleYear ?? Number(item.date.slice(0, 4))) === cycleYear);
  const priorCutoff = firstCompletion?.date ?? `${cycleYear + 1}-01-01`;
  const meetingAssessmentBase = assessAnnualMeetingDeadline({ ...annualSettings, annualMeetingAssessmentYear: cycleYear,
    ...(scope.isBcSociety ? {} : { annualMeetingCompletions: annualSettings.annualMeetingCompletions?.filter(item => item.date < priorCutoff), heldAgmYears: undefined,
      annualReferenceDate: annualSettings.annualReferenceDate && annualSettings.annualReferenceDate < priorCutoff ? annualSettings.annualReferenceDate : undefined }),
  }, today);
  const meetingAssessment: DeadlineAssessment = firstCompletion && !scope.isBcSociety && (meetingAssessmentBase.status !== "review_required" || meetingAssessmentBase.timingReviewRequired)
    ? { ...withAnnualMeetingCompletion(meetingAssessmentBase, firstCompletion.date), basis: `${meetingAssessmentBase.basis} ${firstCompletion.kind === "held" ? "Held annual meeting" : "Reviewed written annual-business completion"} evidenced on ${firstCompletion.date}; the remaining annual-business records are checked separately.` }
    : meetingAssessmentBase;
  const reportAssessment = assessAnnualGovernanceReturnCycle(annualSettings, cycleYear, today);
  const requiresAnnualCycle = meetingAssessment.status !== "not_applicable";
  const extensionDate = scope.isBcSociety && society?.agmExtensionEvidence && Number(String(society.agmExtensionDate).slice(0, 4)) === cycleYear + 1 ? dateOnly(society.agmExtensionDate) : undefined;
  const minutesRaw = selectedAgm
    ? minutesRows.find((row) => String(row.meetingId) === String(selectedAgm._id)) ?? null
    : null;
  // Flip the AGM-cycle motion reads onto the first-class table (Phase 2C): attach
  // resolved displayMotions so the minutesMotionsForDisplay() counts below read the
  // table. No-op on data without motionIds (falls back to the embedded array).
  const minutes: any = minutesRaw
    ? { ...minutesRaw, displayMotions: await resolveMinutesMotions(ctx, minutesRaw) }
    : null;
  const agmRun = selectedAgm
    ? agmRuns.find((row) => String(row.meetingId) === String(selectedAgm._id)) ?? null
    : null;
  // Annual reports belong to one cycle only (G-12): the report that follows
  // this cycle's held AGM (BC Societies Act s.73(1): within 30 days after the
  // AGM), or — for a past year with no AGM — the no-AGM report due January 31
  // of the following year (s.73(2)); s.73(3) handles a missed extension.
  // cycles because it must fall between this AGM and the next one.
  const dueDays = scope.isBcSociety ? 30 : rules?.annualReportDueDaysAfterMeeting ?? 0;
  const selectedAgmDate = selectedAgm ? dateOnly(selectedAgm.scheduledAt) : "";
  const nextAgmAfterSelected = heldAgmForCycle
    ? allAgms.find((meeting) => dateOnly(meeting.scheduledAt) > heldAgmDate && isHeldMeeting(meeting as any, today))
    : undefined;
  // BC societies use s.73(1), (2) or (3). Corporate filings follow their
  // own recognition-anniversary or taxation-period deadline.
  const annualReportMatch = heldAgmForCycle && scope.isBcSociety
    ? annualReportForAgm(filings as any[], heldAgmDate, { nextAgmDate: nextAgmAfterSelected?.scheduledAt, dueDays, cycleYear, asOfISO: today })
    : !heldAgmForCycle && scope.isBcSociety && requiresAnnualCycle && today > (extensionDate ?? endISO)
      ? noAgmAnnualReportForYear(filings as any[], cycleYear, { extensionDate, asOfISO: today })
      : null;
  const annualReport: any = annualReportMatch?.filing ?? (reportAssessment.status === "satisfied" ? filings.find(row =>
    annualSettings.annualReturnFilings?.some(evidence => evidence.evidenceRef === String(row._id) && evidence.cycleYear === cycleYear && evidence.filedAt === reportAssessment.filedAt)) : null) ?? null;
  const noAgmReportDueDate = !heldAgmForCycle && scope.isBcSociety && requiresAnnualCycle ? extensionDate ? addDays(extensionDate, 30) : `${cycleYear + 1}-01-31` : undefined;
  // Presentation evidence must point at THIS cycle's AGM: a statement record
  // presented at last year's AGM is not evidence for this cycle (G-12).
  const presentedFinancial = selectedAgm
    ? financials.find((row) => String(row.presentedAtMeetingId ?? "") === String(selectedAgm._id))
    : undefined;
  const statementsPresentedAtAgm = Boolean(selectedAgm && (minutes?.agmDetails?.financialStatementsPresented || presentedFinancial));
  const annualMaintenance = annualMaintenanceRecords
    .filter((row) => row.yearFilingFor === String(cycleYear) || inYear(row.lastAgmDate, cycleYear) || inYear(row.filingDate, cycleYear))
    .sort((a, b) => String(b.updatedAtISO).localeCompare(String(a.updatedAtISO)))[0] ?? null;
  const selectedFinancial = presentedFinancial ?? financials
    .filter((row) => row.periodEnd && dateOnly(row.periodEnd) <= (selectedAgmDate || endISO) && dateOnly(row.periodEnd) >= `${cycleYear - 1}-01-01`)
    .sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0] ?? null;

  // A society's annual report follows its AGM. A corporation's annual report or
  // return follows the registry anniversary (compliance obligations), not the AGM.
  const annualReportDueDate = reportAssessment.dueDate ?? annualReportMatch?.dueDate ?? noAgmReportDueDate;
  const annualReportTimingReview = Boolean(reportAssessment.timingReviewRequired || (reportAssessment.calendarReviewStatus !== "reviewed" && annualReportMatch?.timingReviewRequired));
  const noticeMinDays = rules?.generalNoticeMinDays ?? 14;
  const noticeMaxDays = rules?.generalNoticeMaxDays ?? 60;
  const noticeWindowOpen = selectedAgm ? earliestPermittedNoticeDate(dateOnly(selectedAgm.scheduledAt), noticeMaxDays, rules.noticeUsesCalendarMonthsMaximum ? 2 : undefined) ?? undefined : undefined;
  const noticeWindowClose = selectedAgm ? latestPermittedNoticeDate(dateOnly(selectedAgm.scheduledAt), noticeMinDays, rules.noticeRequiresClearDays) ?? undefined : undefined;
  const noticeSent = Boolean(selectedAgm?.noticeSentAt || agmRun?.noticeSentAt);
  const agmHeld = Boolean(selectedAgm && isHeldMeeting(selectedAgm as any, today));
  const currentStage = deriveStage({
    selectedAgm,
    annualReport,
    annualReportLate: Boolean(reportAssessment.late),
    annualReportTimingReview,
    annualReportOverdue: reportAssessment.status === "overdue",
    annualReportDueDate,
    agmHeld,
    noticeSent,
    today,
    annualMeeting: am,
  });

  const isOpen = (d: any) => {
    const status = d.status ?? (d.done ? "complete" : "open");
    return status === "open";
  };
  const overdueDeadlines = deadlines.filter((deadline) => isOpen(deadline) && deadline.dueDate < today);
  const dueSoonDeadlines = deadlines.filter((deadline) => isOpen(deadline) && deadline.dueDate >= today && daysBetween(today, deadline.dueDate) <= 45);
  const openConflicts = conflicts.filter((conflict) => !conflict.resolvedAt);
  const policiesDue = policies.filter((policy) => policy.status !== "Ceased" && policy.reviewDate && policy.reviewDate <= addDays(today, 45));
  const currentDirectorAttestations = directorAttestations.filter((row) => row.year === cycleYear);
  // Mandates that lapse on/before the AGM (or cycle end when no AGM is set yet)
  // must be re-elected at that meeting — surface them in director readiness.
  const directorTermDeadline = selectedAgm ? dateOnly(selectedAgm.scheduledAt) : endISO;
  const directorsTermExpiring = activeDirectors.filter(
    (director) => director.termEnd && director.termEnd <= directorTermDeadline,
  );
  const directorAttestationsComplete =
    activeDirectors.length > 0 && currentDirectorAttestations.length >= activeDirectors.length;
  const directorReadinessStatus: ItemStatus =
    directorsTermExpiring.length > 0
      ? (today > directorTermDeadline ? "blocked" : "attention")
      : directorsCompositionReady && activeDirectors.every((director) => director.consentOnFile) ? "complete" : "attention";
  const pipaTrainingThisYear = pipaTrainings.filter((row) => inYear(row.completedAtISO, cycleYear));
  const directorElection = selectedAgm
    ? elections.find((row) => String(row.meetingId) === String(selectedAgm._id)) ?? null
    : null;
  const selectedAgmHasAgenda = selectedAgm
    ? (await readMeetingAgendaItems(ctx, selectedAgm._id)).length > 0
    : false;
  const meetingProxies = selectedAgm ? proxies.filter((row) => String(row.meetingId) === String(selectedAgm._id)) : [];
  const meetingProposals = selectedAgm ? memberProposals.filter((row) => String(row.meetingId) === String(selectedAgm._id)) : [];
  const officialRecordEvidenceCount = [
    society?.constitutionDocId,
    society?.bylawsDocId,
    selectedFinancial?.statementsDocId,
    annualReport?.receiptDocumentId,
    annualReport?.stagedPacketDocumentId,
    ...(minutes?.sourceDocumentIds ?? []),
    ...(annualMaintenance?.sourceDocumentIds ?? []),
  ].filter(Boolean).length;

  const cycleItems: (CycleItem | null)[] = [
    {
      id: "agm-scheduled",
      phase: "before",
      title: `Schedule the ${am}`,
      detail: selectedAgm
        ? `${selectedAgm.title} ${isHeldMeeting(selectedAgm as any, today) ? "was held" : "is planned"} on ${dateOnly(selectedAgm.heldAt ?? selectedAgm.scheduledAt)}. ${meetingAssessment.basis}${meetingAssessment.late ? " The held date was after the reviewed deadline." : ""}${meetingAssessment.timingReviewRequired ? " Completion timing requires calendar review." : ""}`
        : `${meetingAssessment.basis}${meetingAssessment.issues.length ? ` Review: ${meetingAssessment.issues.join(" ")}` : ""}`,
      status: meetingAssessment.status === "not_applicable" ? "upcoming" : meetingAssessment.status === "overdue" ? "blocked" : meetingAssessment.status === "review_required" || meetingAssessment.late || meetingAssessment.timingReviewRequired ? "attention" : selectedAgm || meetingAssessment.status === "satisfied" ? "complete" : "attention",
      sourceIds: meetingAssessment.sourceIds,
      evidence: wording.isSociety
        ? ["AGM meeting record", "Active bylaw rule set"]
        : ["Annual meeting record", `Meeting rules from the ${wording.governingDocuments}`],
      dueDate: meetingAssessment.dueDate ?? selectedAgm?.scheduledAt,
      to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/meetings",
      actionLabel: selectedAgm ? `Open ${am}` : `Schedule ${am}`,
    },
    corporation ? null : {
      id: "member-register",
      phase: "before",
      title: "Confirm voting member register",
      detail: votingMembers.length > 0
        ? `${votingMembers.length} active voting member${votingMembers.length === 1 ? "" : "s"} found for notice and quorum planning.`
        : memberRegisterIsInstitutionHeld
          ? `${memberDataStatus} member data. Keep a memo for the student-population basis, university-controlled list, and how notice/quorum evidence will be handled.`
          : "No named voting members are recorded, and the member-data access basis is not documented yet.",
      status: memberRegisterDocumented ? "complete" : "attention",
      evidence: memberRegisterIsInstitutionHeld
        ? ["Member-data access memo", "Student-population basis", "Notice recipient source"]
        : ["Active member register", "Voting rights and contact details"],
      to: memberRegisterIsInstitutionHeld ? "/privacy" : "/members",
      actionLabel: memberRegisterIsInstitutionHeld ? "Document access basis" : "Review members",
    },
    {
      id: "financial-statements",
      phase: "before",
      title: "Prepare financial statements",
      detail: selectedFinancial
        ? `${selectedFinancial.fiscalYear} statements end ${selectedFinancial.periodEnd}; board approval ${selectedFinancial.approvedByBoardAt ? "recorded" : "not recorded"}.`
        : statementsPresentedAtAgm
          ? `The ${am} minutes record that statements were presented, but no financial statement record is linked to this cycle.`
          : "No financial statement record is linked to this cycle yet.",
      status: selectedFinancial?.statementsDocId && selectedFinancial?.approvedByBoardAt ? "complete" : selectedFinancial || statementsPresentedAtAgm ? "attention" : "blocked",
      evidence: ["Financial statement document", "Board approval", "Auditor or reviewer report if applicable"],
      dueDate: selectedAgm?.scheduledAt,
      to: selectedFinancial ? `/financials/fy/${encodeURIComponent(selectedFinancial.fiscalYear)}` : "/financials",
      actionLabel: selectedFinancial ? "Open financials" : "Add financials",
    },
    {
      id: "director-readiness",
      phase: "before",
      title: "Check directors and terms",
      detail: `${activeDirectors.length} active director${activeDirectors.length === 1 ? "" : "s"}; ${currentDirectorAttestations.length} optional annual attestation${currentDirectorAttestations.length === 1 ? "" : "s"} for ${cycleYear}${directorsTermExpiring.length > 0 ? `; ${directorsTermExpiring.length} term${directorsTermExpiring.length === 1 ? "" : "s"} expire on/before the ${am}` : ""}.`,
      status: directorReadinessStatus,
      evidence: ["Director register", "Consent or other lawful appointment evidence", "Term, qualifications and vacancy review"],
      to: "/directors",
      actionLabel: "Review directors",
    },
    {
      id: "notice-package",
      phase: "before",
      title: `Send ${holderNoun} notice package`,
      detail: selectedAgm
        ? noticeSent
          ? `Notice is recorded for the ${am}. ${NOTICE_CALENDAR_REVIEW_CAVEAT}`
          : `Nominal notice window: ${noticeWindowOpen} to ${noticeWindowClose}. ${NOTICE_CALENDAR_REVIEW_CAVEAT}`
        : `Schedule the ${am} before sending notice.`,
      status: !selectedAgm ? "blocked" : "attention",
      evidence: ["Notice delivery log", "Agenda", "Motions and special resolutions", "Electronic participation instructions"],
      dueDate: noticeWindowClose,
      to: selectedAgm ? `/meetings/${selectedAgm._id}/agm` : "/meetings",
      actionLabel: noticeSent ? `Open ${am} workflow` : "Handle notice",
    },
    {
      id: "agenda-motions",
      phase: "before",
      title: "Finalize agenda, motions, and proposals",
      detail: selectedAgm
        ? `${selectedAgmHasAgenda ? "Agenda is drafted" : "Agenda not yet recorded"}; ${meetingProposals.length} linked ${holderNoun} proposal${meetingProposals.length === 1 ? "" : "s"}.`
        : `No ${am} selected for agenda planning.`,
      status: selectedAgmHasAgenda ? "complete" : selectedAgm ? "attention" : "blocked",
      evidence: ["Agenda", "Motion text", corporation ? "Shareholder proposals" : "Member proposals", "Proxy and voting rules"],
      to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/agendas",
      actionLabel: "Open agenda",
    },
    {
      id: "attendance-quorum",
      phase: "during",
      title: "Record attendance and quorum",
      detail: minutes
        ? `${minutes.attendees?.length ?? 0} attendee${(minutes.attendees?.length ?? 0) === 1 ? "" : "s"}; quorum ${minutesQuorumLabel(minutes).toLowerCase()}.`
        : selectedAgm
          ? "Minutes have not captured attendance and quorum yet."
          : `Schedule the ${am} before tracking attendance.`,
      status: minutes ? (recordedMinutesQuorum(minutes) === true ? "complete" : "blocked") : agmHeld ? "blocked" : "upcoming",
      evidence: ["Attendance list", "Quorum snapshot", "Proxy evidence if used"],
      dueDate: selectedAgm?.scheduledAt,
      to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/meetings",
      actionLabel: "Open meeting",
    },
    {
      id: "votes-minutes",
      phase: "during",
      title: "Capture votes and minutes",
      detail: minutes
        ? `${minutesMotionsForDisplay(minutes as any).length} motion${(minutesMotionsForDisplay(minutes as any).length) === 1 ? "" : "s"} and ${minutes.decisions?.length ?? 0} decision${(minutes.decisions?.length ?? 0) === 1 ? "" : "s"} recorded.`
        : `No ${am} minutes are linked yet.`,
      status: minutes ? ((minutesMotionsForDisplay(minutes as any).length) > 0 || (minutes.decisions?.length ?? 0) > 0 ? "complete" : "attention") : agmHeld ? "blocked" : "upcoming",
      evidence: ["Draft minutes", "Motion outcomes", "Vote tallies and abstentions", "Election evidence"],
      to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/minutes",
      actionLabel: "Open minutes",
    },
    {
      id: "financials-presented",
      phase: "during",
      title: "Present financial statements",
      detail: statementsPresentedAtAgm
        ? `Financial presentation evidence is linked to the ${am}.`
        : selectedAgm
          ? "Financial presentation has not been confirmed."
          : `No ${am} in this cycle to present financial statements at.`,
      status: statementsPresentedAtAgm ? "complete" : agmHeld ? "blocked" : !selectedAgm && today > endISO ? "blocked" : "upcoming",
      evidence: [`${amTitle} minutes reference`, "Financial statements", "Auditor report if any"],
      dueDate: selectedAgm?.scheduledAt,
      to: selectedFinancial ? `/financials/fy/${encodeURIComponent(selectedFinancial.fiscalYear)}` : "/financials",
      actionLabel: "Review presentation",
    },
    {
      id: "elections",
      phase: "during",
      title: "Record director elections",
      detail: directorElection
        ? `${directorElection.status} election record linked to the ${am}.`
        : minutes?.agmDetails?.directorAppointments?.length
          ? `${minutes.agmDetails.directorAppointments.length} director appointment${minutes.agmDetails.directorAppointments.length === 1 ? "" : "s"} in ${am} minutes.`
          : `No ${am} election or director appointment evidence is linked.`,
      status: directorElection || minutes?.agmDetails?.directorAppointments?.length ? "complete" : rules?.requireAgmElections ? (agmHeld ? "blocked" : "upcoming") : "attention",
      evidence: ["Election record", "Director appointments", "Consents", "Vote or acclamation evidence"],
      to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/elections",
      actionLabel: "Open elections",
    },
    {
      id: "minutes-approval",
      phase: "after",
      title: "Approve and store minutes",
      detail: minutes
        ? minutes.approvedAt
          ? `Approved ${humanDate(minutes.approvedAt)}.`
          : "Minutes exist but are not approved yet."
        : `No ${am} minutes are linked yet.`,
      status: minutes?.approvedAt ? "complete" : minutes ? "attention" : agmHeld ? "blocked" : "upcoming",
      evidence: ["Approved minutes", "Approval meeting or written resolution", "Appendices"],
      to: "/minutes",
      actionLabel: "Review minutes",
    },
    {
      id: "annual-report",
      phase: "after",
      title: `File ${profile?.annualReturn.label.toLowerCase() ?? "annual registry return"}`,
      sourceIds: reportAssessment.sourceIds,
      detail: `${reportAssessment.basis}${reportAssessment.filedAt || annualReportMatch?.filed ? ` Filed ${reportAssessment.filedAt ?? dateOnly(annualReport?.filedAt)}${reportAssessment.late ? " after the reviewed deadline" : ""}.` : annualReport ? ` Filing tracked; completion evidence remains outstanding.` : ""}${reportAssessment.issues.length ? ` Review: ${reportAssessment.issues.join(" ")}` : ""}${annualReportTimingReview ? " Review the applicable calendar before assessing filing timeliness." : ""}`,
      status: reportAssessment.status === "satisfied" || annualReportMatch?.filed ? (annualReportTimingReview || reportAssessment.late ? "attention" : "complete") : reportAssessment.status === "review_required" ? "attention" : reportAssessment.status === "overdue" ? "blocked" : annualReport ? "attention" : "upcoming",
      evidence: ["Annual report filing", "Confirmation number", "Receipt or submission evidence"],
      dueDate: annualReportDueDate,
      to: annualReport ? "/filings" : scope.isSociety ? "/formation-maintenance" : "/compliance-obligations",
      actionLabel: annualReport?.status === "Filed" ? "Open filing" : "Prepare filing",
    },
    {
      id: "minute-book",
      phase: "after",
      title: "Update minute book evidence",
      detail: `${officialRecordEvidenceCount} core evidence link${officialRecordEvidenceCount === 1 ? "" : "s"} found for ${am}, financials, filings, and governing documents.`,
      status: officialRecordEvidenceCount >= 4 ? "complete" : officialRecordEvidenceCount > 0 ? "attention" : "blocked",
      evidence: ["Notice", "Minutes", "Financial statements", "Annual report evidence", "Director consents"],
      to: "/minute-book",
      actionLabel: "Open minute book",
    },
    {
      id: "post-agm-directors",
      phase: "after",
      title: "Reflect director and registry changes",
      detail: `${activeDirectors.length} active directors; ${minimumDirectors === undefined ? "minimum requires governing-Act review" : `minimum ${minimumDirectors}`}${requiresBcResidentDirector ? `; ${activeDirectors.filter(director => director.isBCResident).length} BC residents, at least one required` : ""}${canadianResidencyRequired ? `; ${canadianDirectors} of ${requiredCanadianDirectors} required resident Canadian directors confirmed` : ""}.`,
      sourceIds: profile?.directors.sourceIds,
      status: directorsCompositionReady ? "complete" : "attention",
      evidence: ["Director register", `${amTitle} election result`, "Registry filing evidence if changed"],
      to: "/directors",
      actionLabel: "Review directors",
    },
    {
      id: "pipa-review",
      phase: "ongoing",
      title: `Review ${privacy.applicableLawIds.length ? privacy.label : "privacy applicability"}`,
      detail: `${privacy.label}; ${society?.privacyProgramStatus ?? "Unknown"} privacy program; ${pipaTrainingThisYear.length} privacy training record${pipaTrainingThisYear.length === 1 ? "" : "s"} this cycle.`,
      status: privacy.status === "assessed" && society?.privacyPolicyDocId && society?.privacyProgramStatus === "Documented" && society?.privacyOfficerName ? "complete" : "attention",
      evidence: ["Privacy policy evidence", "Privacy officer", "Complaint process", "Training or review record"],
      to: "/privacy",
      actionLabel: "Open privacy",
    },
    {
      id: "conflicts",
      phase: "ongoing",
      title: "Refresh conflict disclosures",
      detail: `${openConflicts.length} open conflict disclosure${openConflicts.length === 1 ? "" : "s"}.`,
      status: openConflicts.length === 0 ? "complete" : "attention",
      evidence: ["Conflict register", "Abstention and room-leaving record", "Resolution notes"],
      to: "/conflicts",
      actionLabel: "Open conflicts",
    },
    {
      id: "policy-reviews",
      phase: "ongoing",
      title: "Review policies and retention",
      detail: `${policiesDue.length} policy review${policiesDue.length === 1 ? "" : "s"} due within 45 days. Use Records retention for document-level review queues.`,
      status: policiesDue.length === 0 ? "complete" : "attention",
      evidence: ["Policy review dates", "Retention rules", "Document review flags"],
      to: "/policies",
      actionLabel: "Review policies",
    },
    {
      id: "open-deadlines",
      phase: "ongoing",
      title: "Clear deadlines and recurring obligations",
      detail: `${overdueDeadlines.length} overdue and ${dueSoonDeadlines.length} due soon.`,
      status: overdueDeadlines.length > 0 ? "blocked" : dueSoonDeadlines.length > 0 ? "attention" : "complete",
      evidence: ["Deadline register", "Completion notes", "Linked filings"],
      to: "/deadlines",
      actionLabel: "Open deadlines",
    },
  ];
  const items = cycleItems.filter((item): item is CycleItem => item !== null);

  const completedCount = items.filter((item) => item.status === "complete").length;
  const blockedCount = items.filter((item) => item.status === "blocked").length;
  const attentionCount = items.filter((item) => item.status === "attention").length;
  const nextItem = items.find((item) => item.status === "blocked") ??
    items.find((item) => item.status === "attention") ??
    items.find((item) => item.status === "upcoming") ??
    items[0];

  return {
    cycleYear,
    currentStage,
    society: society
      ? {
          _id: society._id,
          name: society.name,
          fiscalYearEnd: society.fiscalYearEnd,
          isCharity: society.isCharity,
          jurisdictionCode: society.jurisdictionCode,
        }
      : null,
    agm: selectedAgm,
    agmRun,
    minutes,
    annualReport,
    annualMaintenance,
    annualReportDueDate,
    meetingAssessment,
    reportAssessment,
    noticeWindowOpen,
    noticeWindowClose,
    counts: {
      completed: completedCount,
      total: items.length,
      blocked: blockedCount,
      attention: attentionCount,
      activeMembers: activeMembers.length,
      votingMembers: votingMembers.length,
      activeDirectors: activeDirectors.length,
      openConflicts: openConflicts.length,
      meetingProxies: meetingProxies.length,
    },
    nextItem,
    phases: {
      before: items.filter((item) => item.phase === "before"),
      during: items.filter((item) => item.phase === "during"),
      after: items.filter((item) => item.phase === "after"),
      ongoing: items.filter((item) => item.phase === "ongoing"),
    },
    caveats: [
      "Compliance status means evidence readiness in Societyer, not a legal opinion.",
      wording.isSociety
        ? "Notice, quorum, proxy, electronic voting, and director term rules depend on the active bylaw rule set."
        : `Notice, quorum, proxy, electronic voting, and director term rules depend on the governing Act and the ${wording.governingDocuments}.`,
      corporation
        ? "Registry annual reports or returns, ownership-register updates, CRA returns, payroll, and GST/HST are separate obligations."
        : "BC annual reports, CRA charity returns, payroll, GST/HST, funder reports, and federal annual returns are separate obligations.",
    ],
  };
}

function deriveStage(args: {
  selectedAgm: any;
  annualReport: any;
  annualReportLate?: boolean;
  annualReportTimingReview?: boolean;
  annualReportOverdue?: boolean;
  annualReportDueDate?: string;
  agmHeld: boolean;
  noticeSent: boolean;
  today: string;
  annualMeeting: string;
}) {
  if (/^(filed|accepted)$/i.test(String(args.annualReport?.status ?? ''))) return args.annualReportTimingReview ? "Annual report filed; timing review" : args.annualReportLate ? "Annual report filed late" : "Annual report filed";
  if (args.annualReportOverdue) return `Overdue post-${args.annualMeeting} work`;
  if (args.annualReportTimingReview) return "Annual filing deadline review";
  if (args.agmHeld) return `Post-${args.annualMeeting} work`;
  if (args.noticeSent) return `Ready for ${args.annualMeeting}`;
  if (args.selectedAgm) return "Planning and notice";
  return "Not scheduled";
}

function dateOnly(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) return localDateKey(value);
  return String(value).slice(0, 10);
}

function inYear(value: unknown, year: number) {
  return typeof value === "string" && value.slice(0, 4) === String(year);
}

function addDays(date: string, days: number) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  if (!start || !end) return Number.POSITIVE_INFINITY;
  return Math.round((new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) / DAY_MS);
}

// --- Portable copy of convex/lib/bylawRules.ts rule resolution (ctx.db-only) ---


export function getDefaultBylawRules(societyId: string, organization?: any) {
  return bylawBaselineForOrganization(organization, societyId);
}

async function getActiveBylawRuleSet(ctx: PortableQueryCtx, societyId: string) {
  return getBylawRuleSetForDate(ctx, societyId, new Date().toISOString());
}

async function getBylawRuleSetForDate(
  ctx: PortableQueryCtx,
  societyId: string,
  dateISO: string,
): Promise<Record<string, any>> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
  const organization = await ctx.db.get(societyId);
  return contextualBylawRules(organization, societyId, selected);
}

function compareRuleSetsDesc(a: any, b: any) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

function effectiveTimestamp(row: any) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

// --- Portable copy of convex/lib/agendaItems.ts readMeetingAgendaItems (ctx.db-only) ---

async function readMeetingAgendaItems(ctx: PortableQueryCtx, meetingId: any): Promise<any[]> {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a: any, b: any) => a.createdAtISO.localeCompare(b.createdAtISO));
  const agenda = agendas[0];
  if (!agenda) return [];
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
    .collect();
  items.sort((a: any, b: any) => a.order - b.order);
  return items;
}
