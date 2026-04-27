// @ts-nocheck
import { query } from "./_generated/server";
import { v } from "convex/values";
import { getActiveBylawRuleSet } from "./lib/bylawRules";

type ItemStatus = "complete" | "attention" | "blocked" | "upcoming";

type CycleItem = {
  id: string;
  phase: "before" | "during" | "after" | "ongoing";
  title: string;
  detail: string;
  status: ItemStatus;
  evidence: string[];
  dueDate?: string;
  to: string;
  actionLabel: string;
};

const DAY_MS = 86_400_000;

export const summary = query({
  args: {
    societyId: v.id("societies"),
    year: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, year }) => {
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
      ctx.db.get(societyId),
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
    const agms = meetings
      .filter((meeting) => meeting.type === "AGM" && inYear(meeting.scheduledAt, cycleYear))
      .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
    const selectedAgm =
      agms.find((meeting) => new Date(meeting.scheduledAt).getTime() >= now.getTime()) ??
      agms[agms.length - 1] ??
      null;
    const minutes = selectedAgm
      ? minutesRows.find((row) => String(row.meetingId) === String(selectedAgm._id)) ?? null
      : null;
    const agmRun = selectedAgm
      ? agmRuns.find((row) => String(row.meetingId) === String(selectedAgm._id)) ?? null
      : null;
    const annualReport = filings
      .filter((filing) => filing.kind === "AnnualReport" && filingMatchesYear(filing, cycleYear))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0] ?? null;
    const annualMaintenance = annualMaintenanceRecords
      .filter((row) => row.yearFilingFor === String(cycleYear) || inYear(row.lastAgmDate, cycleYear) || inYear(row.filingDate, cycleYear))
      .sort((a, b) => String(b.updatedAtISO).localeCompare(String(a.updatedAtISO)))[0] ?? null;
    const selectedFinancial = financials
      .filter((row) => inYear(row.periodEnd, cycleYear) || row.fiscalYear === String(cycleYear))
      .sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0] ?? null;

    const annualReportDueDate = selectedAgm
      ? addDays(dateOnly(selectedAgm.scheduledAt), rules?.annualReportDueDaysAfterMeeting ?? 30)
      : annualReport?.dueDate;
    const noticeMinDays = rules?.generalNoticeMinDays ?? 14;
    const noticeMaxDays = rules?.generalNoticeMaxDays ?? 60;
    const noticeWindowOpen = selectedAgm ? addDays(dateOnly(selectedAgm.scheduledAt), -noticeMaxDays) : undefined;
    const noticeWindowClose = selectedAgm ? addDays(dateOnly(selectedAgm.scheduledAt), -noticeMinDays) : undefined;
    const noticeSent = Boolean(selectedAgm?.noticeSentAt || agmRun?.noticeSentAt);
    const agmHeld = Boolean(minutes || (selectedAgm && new Date(selectedAgm.scheduledAt).getTime() < now.getTime()));
    const currentStage = deriveStage({
      selectedAgm,
      annualReport,
      annualReportDueDate,
      agmHeld,
      noticeSent,
      today,
    });

    const overdueDeadlines = deadlines.filter((deadline) => !deadline.done && deadline.dueDate < today);
    const dueSoonDeadlines = deadlines.filter((deadline) => !deadline.done && deadline.dueDate >= today && daysBetween(today, deadline.dueDate) <= 45);
    const openConflicts = conflicts.filter((conflict) => !conflict.resolvedAt);
    const policiesDue = policies.filter((policy) => policy.status !== "Ceased" && policy.reviewDate && policy.reviewDate <= addDays(today, 45));
    const currentDirectorAttestations = directorAttestations.filter((row) => row.year === cycleYear);
    const pipaTrainingThisYear = pipaTrainings.filter((row) => inYear(row.completedAtISO, cycleYear));
    const directorElection = selectedAgm
      ? elections.find((row) => String(row.meetingId) === String(selectedAgm._id)) ?? null
      : null;
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

    const items: CycleItem[] = [
      {
        id: "agm-scheduled",
        phase: "before",
        title: "Schedule the AGM",
        detail: selectedAgm
          ? `${selectedAgm.title} is on ${dateOnly(selectedAgm.scheduledAt)}.`
          : "No AGM is scheduled for this cycle year.",
        status: selectedAgm ? "complete" : today > endISO ? "blocked" : "attention",
        evidence: ["AGM meeting record", "Active bylaw rule set"],
        dueDate: selectedAgm?.scheduledAt,
        to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/meetings",
        actionLabel: selectedAgm ? "Open AGM" : "Schedule AGM",
      },
      {
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
          : "No financial statement record is linked to this cycle yet.",
        status: selectedFinancial?.statementsDocId && selectedFinancial?.approvedByBoardAt ? "complete" : selectedFinancial ? "attention" : "blocked",
        evidence: ["Financial statement document", "Board approval", "Auditor or reviewer report if applicable"],
        dueDate: selectedAgm?.scheduledAt,
        to: selectedFinancial ? `/financials/fy/${encodeURIComponent(selectedFinancial.fiscalYear)}` : "/financials",
        actionLabel: selectedFinancial ? "Open financials" : "Add financials",
      },
      {
        id: "director-readiness",
        phase: "before",
        title: "Check directors and terms",
        detail: `${activeDirectors.length} active director${activeDirectors.length === 1 ? "" : "s"}; ${currentDirectorAttestations.length} annual attestation${currentDirectorAttestations.length === 1 ? "" : "s"} for ${cycleYear}.`,
        status: activeDirectors.length > 0 && currentDirectorAttestations.length >= activeDirectors.length ? "complete" : "attention",
        evidence: ["Director register", "Consents and annual eligibility attestations", "Term and vacancy review"],
        to: "/directors",
        actionLabel: "Review directors",
      },
      {
        id: "notice-package",
        phase: "before",
        title: "Send member notice package",
        detail: selectedAgm
          ? noticeSent
            ? "Notice is recorded for the AGM."
            : `Notice window: ${noticeWindowOpen} to ${noticeWindowClose}.`
          : "Schedule the AGM before sending notice.",
        status: !selectedAgm ? "blocked" : noticeSent ? "complete" : today > (noticeWindowClose ?? endISO) ? "blocked" : "attention",
        evidence: ["Notice delivery log", "Agenda", "Motions and special resolutions", "Electronic participation instructions"],
        dueDate: noticeWindowClose,
        to: selectedAgm ? `/meetings/${selectedAgm._id}/agm` : "/meetings",
        actionLabel: noticeSent ? "Open AGM workflow" : "Handle notice",
      },
      {
        id: "agenda-motions",
        phase: "before",
        title: "Finalize agenda, motions, and proposals",
        detail: selectedAgm
          ? `${selectedAgm.agendaJson ? "Agenda is drafted" : "Agenda not yet recorded"}; ${meetingProposals.length} linked member proposal${meetingProposals.length === 1 ? "" : "s"}.`
          : "No AGM selected for agenda planning.",
        status: selectedAgm?.agendaJson ? "complete" : selectedAgm ? "attention" : "blocked",
        evidence: ["Agenda", "Motion text", "Member proposals", "Proxy and voting rules"],
        to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/agendas",
        actionLabel: "Open agenda",
      },
      {
        id: "attendance-quorum",
        phase: "during",
        title: "Record attendance and quorum",
        detail: minutes
          ? `${minutes.attendees?.length ?? 0} attendee${(minutes.attendees?.length ?? 0) === 1 ? "" : "s"}; quorum ${minutes.quorumMet ? "met" : "not met"}.`
          : selectedAgm
            ? "Minutes have not captured attendance and quorum yet."
            : "Schedule the AGM before tracking attendance.",
        status: minutes ? (minutes.quorumMet ? "complete" : "blocked") : agmHeld ? "blocked" : "upcoming",
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
          ? `${minutes.motions?.length ?? 0} motion${(minutes.motions?.length ?? 0) === 1 ? "" : "s"} and ${minutes.decisions?.length ?? 0} decision${(minutes.decisions?.length ?? 0) === 1 ? "" : "s"} recorded.`
          : "No AGM minutes are linked yet.",
        status: minutes ? ((minutes.motions?.length ?? 0) > 0 || (minutes.decisions?.length ?? 0) > 0 ? "complete" : "attention") : agmHeld ? "blocked" : "upcoming",
        evidence: ["Draft minutes", "Motion outcomes", "Vote tallies and abstentions", "Election evidence"],
        to: selectedAgm ? `/meetings/${selectedAgm._id}` : "/minutes",
        actionLabel: "Open minutes",
      },
      {
        id: "financials-presented",
        phase: "during",
        title: "Present financial statements",
        detail: minutes?.agmDetails?.financialStatementsPresented || selectedFinancial?.presentedAtMeetingId
          ? "Financial presentation evidence is linked to the AGM."
          : "Financial presentation has not been confirmed.",
        status: minutes?.agmDetails?.financialStatementsPresented || selectedFinancial?.presentedAtMeetingId ? "complete" : agmHeld ? "blocked" : "upcoming",
        evidence: ["AGM minutes reference", "Financial statements", "Auditor report if any"],
        dueDate: selectedAgm?.scheduledAt,
        to: selectedFinancial ? `/financials/fy/${encodeURIComponent(selectedFinancial.fiscalYear)}` : "/financials",
        actionLabel: "Review presentation",
      },
      {
        id: "elections",
        phase: "during",
        title: "Record director elections",
        detail: directorElection
          ? `${directorElection.status} election record linked to the AGM.`
          : minutes?.agmDetails?.directorAppointments?.length
            ? `${minutes.agmDetails.directorAppointments.length} director appointment${minutes.agmDetails.directorAppointments.length === 1 ? "" : "s"} in AGM minutes.`
            : "No AGM election or director appointment evidence is linked.",
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
            ? `Approved ${minutes.approvedAt}.`
            : "Minutes exist but are not approved yet."
          : "No AGM minutes are linked yet.",
        status: minutes?.approvedAt ? "complete" : minutes ? "attention" : agmHeld ? "blocked" : "upcoming",
        evidence: ["Approved minutes", "Approval meeting or written resolution", "Appendices"],
        to: "/minutes",
        actionLabel: "Review minutes",
      },
      {
        id: "annual-report",
        phase: "after",
        title: "File annual report",
        detail: annualReport
          ? annualReport.status === "Filed"
            ? `Filed ${annualReport.filedAt ?? "with evidence"}.`
            : `Due ${annualReport.dueDate}.`
          : annualReportDueDate
            ? `No annual report filing record; expected due date ${annualReportDueDate}.`
            : "Schedule the AGM to compute the annual report filing deadline.",
        status: annualReport?.status === "Filed" ? "complete" : annualReportDueDate && today > annualReportDueDate ? "blocked" : annualReport ? "attention" : "upcoming",
        evidence: ["Annual report filing", "Confirmation number", "Receipt or submission evidence"],
        dueDate: annualReport?.dueDate ?? annualReportDueDate,
        to: annualReport ? "/filings" : "/formation-maintenance",
        actionLabel: annualReport?.status === "Filed" ? "Open filing" : "Prepare filing",
      },
      {
        id: "minute-book",
        phase: "after",
        title: "Update minute book evidence",
        detail: `${officialRecordEvidenceCount} core evidence link${officialRecordEvidenceCount === 1 ? "" : "s"} found for AGM, financials, filings, and governing documents.`,
        status: officialRecordEvidenceCount >= 4 ? "complete" : officialRecordEvidenceCount > 0 ? "attention" : "blocked",
        evidence: ["Notice", "Minutes", "Financial statements", "Annual report evidence", "Director consents"],
        to: "/minute-book",
        actionLabel: "Open minute book",
      },
      {
        id: "post-agm-directors",
        phase: "after",
        title: "Reflect director and registry changes",
        detail: `${activeDirectors.length} active director${activeDirectors.length === 1 ? "" : "s"}; ${activeDirectors.filter((director) => director.isBCResident).length} BC resident director${activeDirectors.filter((director) => director.isBCResident).length === 1 ? "" : "s"}.`,
        status: activeDirectors.length > 0 && activeDirectors.some((director) => director.isBCResident) ? "complete" : "blocked",
        evidence: ["Director register", "AGM election result", "Registry filing evidence if changed"],
        to: "/directors",
        actionLabel: "Review directors",
      },
      {
        id: "pipa-review",
        phase: "ongoing",
        title: "Review PIPA privacy program",
        detail: `${society?.privacyProgramStatus ?? "Unknown"} privacy program; ${pipaTrainingThisYear.length} PIPA training record${pipaTrainingThisYear.length === 1 ? "" : "s"} this cycle.`,
        status: society?.privacyPolicyDocId && society?.privacyProgramStatus === "Documented" ? "complete" : "attention",
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
        "Notice, quorum, proxy, electronic voting, and director term rules depend on the active bylaw rule set.",
        "BC annual reports, CRA charity returns, payroll, GST/HST, funder reports, and federal annual returns are separate obligations.",
      ],
    };
  },
});

function deriveStage(args: {
  selectedAgm: any;
  annualReport: any;
  annualReportDueDate?: string;
  agmHeld: boolean;
  noticeSent: boolean;
  today: string;
}) {
  if (args.annualReport?.status === "Filed") return "Annual report filed";
  if (args.annualReportDueDate && args.today > args.annualReportDueDate) return "Overdue post-AGM work";
  if (args.agmHeld) return "Post-AGM work";
  if (args.noticeSent) return "Ready for AGM";
  if (args.selectedAgm) return "Planning and notice";
  return "Not scheduled";
}

function dateOnly(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function inYear(value: unknown, year: number) {
  return typeof value === "string" && value.slice(0, 4) === String(year);
}

function filingMatchesYear(filing: any, year: number) {
  const label = String(filing.periodLabel ?? "");
  return label.includes(String(year)) || inYear(filing.dueDate, year) || inYear(filing.filedAt, year);
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
