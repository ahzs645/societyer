import { calendarDateKey } from "../lib/calendarDates";
import { useMemo } from "react";
import { BookTemplate, CheckCircle2, ClipboardList, ExternalLink, Plus, RotateCcw, X } from "lucide-react";
import type { MenuItem } from "../components/Menu";
import { loadComplianceRulePacks } from "../lib/compliance/registry";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useOrganizationWorkspace } from "../hooks/useOrganizationWorkspace";
import { Badge } from "../components/ui";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { ExpandableText } from "../components/ExpandableText";
import { complianceFactsForOrganization, computeComplianceObligations, filterApplicableCompliancePacks } from "../lib/compliance";
import type { ComplianceFacts, ComplianceObligationStatus } from "../lib/compliance";
import { formatDate, relative } from "../lib/format";
import {
  jurisdictionDisplayCopy,
  jurisdictionModuleContract,
} from "../../shared/jurisdictionWorkspace";
import {
  homeJurisdictionCode,
  organizationEntityType,
  organizationLabel,
} from "../../shared/organizationDomain";
import { corporationPacketForComplianceObligation } from "../../shared/corporationDocumentPackets";
import { isCorporation } from "../../shared/organizationDomain";
import { annualReportForAgm, dateOnly, deriveAgmFacts, noAgmAnnualReportForYear } from "../../shared/agmEvidence";
import { useToast } from "../components/Toast";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { usePermissions } from "../hooks/usePermissions";
import { StatTile } from "../components/StatTile";
import { ORG_HUB_OPTION_SETS } from "../lib/orgHubOptions";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
} from "@/platform/record-engine";

type Obligation = ReturnType<typeof computeComplianceObligations>[number];

/** What the obligation's Status badge says: the filing or review outcome, else its calculated-date state. */
type ObligationDisplayStatus = ComplianceObligationStatus | "filed" | "filed_timing" | "dismissed" | "reviewed";

const OBLIGATION_STATUS_LABEL: Record<ObligationDisplayStatus, string> = {
  filed: "Filed",
  filed_timing: "Filed — timing review",
  dismissed: "Dismissed",
  reviewed: "Workflow reviewed",
  due_today: statusLabel("due_today"),
  overdue: statusLabel("overdue"),
  upcoming: statusLabel("upcoming"),
};
const OBLIGATION_STATUS_TONE: Record<ObligationDisplayStatus, "success" | "warn" | "info" | "neutral"> = {
  filed: "success",
  filed_timing: "warn",
  dismissed: "neutral",
  reviewed: "success",
  due_today: statusTone("due_today"),
  overdue: statusTone("overdue"),
  upcoming: statusTone("upcoming"),
};
const TONE_COLOR = { success: "green", warn: "amber", info: "blue", neutral: "gray" } as const;

type ObligationDecision = { status?: string; targetTable?: string; updatedAtISO?: string };
type ObligationFilingMatch = { filing: { _id?: string; status?: string } | null; nominalDaysPastDue: number; timingReviewRequired: boolean };

/** An obligation as the table reads it: its facts as columns, the computed obligation and its filing/decision for cells and actions. */
type ObligationRecord = {
  _id: string;
  title: string;
  dueDate: string;
  status: ObligationDisplayStatus;
  source: string;
  jurisdictionCode: string;
  contextKind: NonNullable<Obligation["contextKind"]>;
  ruleStatus: Obligation["ruleStatus"];
  filingKind: string | null;
  contextSummary: string | null;
  details: string;
  filingMatch: ObligationFilingMatch | null;
  decision: ObligationDecision | undefined;
  obligation: Obligation;
};

const OBLIGATIONS = staticRecordTable({
  id: "compliance-obligations",
  nameSingular: "complianceObligation",
  namePlural: "complianceObligations",
  labelSingular: "Obligation",
  labelPlural: "Obligations",
  labelIdentifierFieldName: "title",
  density: "comfortable",
  fields: [
    { name: "title", label: "Obligation", fieldType: FIELD_TYPES.TEXT, size: 300, config: { groupable: false } },
    { name: "dueDate", label: "Calculated date", fieldType: FIELD_TYPES.DATE, size: 170 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 220,
      config: {
        options: (Object.keys(OBLIGATION_STATUS_LABEL) as ObligationDisplayStatus[]).map((value) => ({
          value,
          label: OBLIGATION_STATUS_LABEL[value],
          color: TONE_COLOR[OBLIGATION_STATUS_TONE[value]],
        })),
      },
    },
    { name: "source", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 300 },
    { name: "jurisdictionCode", label: "Jurisdiction", fieldType: FIELD_TYPES.TEXT, size: 140, isVisible: false },
    {
      name: "contextKind",
      label: "Context",
      fieldType: FIELD_TYPES.SELECT,
      size: 150,
      isVisible: false,
      config: {
        options: (["home", "extra_provincial", "branch", "business_name"] as const).map((value) => ({
          value,
          label: contextKindLabel(value),
          color: value === "home" ? "gray" : "purple",
        })),
      },
    },
    {
      name: "ruleStatus",
      label: "Rule status",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      isVisible: false,
      config: {
        options: (["draft", "reviewed", "accepted", "deprecated"] as const).map((value) => ({
          value,
          label: ruleStatusLabel(value),
          color: TONE_COLOR[ruleStatusTone(value)],
        })),
      },
    },
    { name: "filingKind", label: "Filing kind", fieldType: FIELD_TYPES.TEXT, size: 180, isVisible: false },
  ],
});

export function ComplianceObligationsPage() {
  const { organization, society, isLoading, missingWorkspace } = useOrganizationWorkspace();
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const detail = useQuery(api.organizationDetails.overview, society ? { societyId: society._id } : "skip") as any | undefined;
  const decisions = useQuery(
    api.complianceObligations.listDecisions,
    society ? { societyId: society._id } : "skip",
  ) as any[] | undefined;
  const createFiling = useMutation(api.filings.create);
  const stagePacket = useMutation(api.legalOperations.stageCorporationDocumentPacket);
  const markReviewed = useMutation(api.complianceObligations.markReviewed);
  const dismissDecision = useMutation(api.complianceObligations.dismissDecision);
  const reopenDecision = useMutation(api.complianceObligations.reopenDecision);
  const toast = useToast();
  const navigate = useNavigate();
  const undoable = useUndoableAction();
  const permissions = usePermissions();
  const canReview = permissions.loaded && permissions.can("deadlines:write");
  const canTrack = canReview && permissions.can("filings:write");
  const canStage = canReview && permissions.can("documents:write");

  const factsList = useMemo(
    () => (organization ? complianceFactsForOrganization(organization, { registrations: detail?.registrations ?? [], meetings: meetings ?? [] }) : []),
    [detail?.registrations, meetings, organization],
  );
  const facts = factsList[0] ?? null;
  const obligations = useMemo(() => factsList.flatMap((item) => computeComplianceObligations(item)), [factsList]);
  const packs = useMemo(() => factsList.flatMap((item) => filterApplicableCompliancePacks(item)), [factsList]);
  const packTitles = useMemo(() => new Map(loadComplianceRulePacks().map((pack) => [pack.packId, pack.title])), []);

  if (isLoading) return <PageLoading />;
  if (missingWorkspace || !organization || !society) return <SeedPrompt />;

  const today = facts?.asOfDate ?? calendarDateKey(new Date());
  const agmFacts = deriveAgmFacts(organization, meetings ?? [], today);
  const corporate = isCorporation(organization);
  const jurisdictionCode = homeJurisdictionCode(organization);
  const jurisdictionCopy = jurisdictionDisplayCopy(organization);
  const jurisdictionModule = jurisdictionModuleContract(organization);
  const missingFacts = [
    ...requiredFactLabels(facts),
    ...(!facts?.formationInferredFromRecords && (["preparing", "submitted", "unverified_existing"].includes(organization.formationStatus ?? "") || organization.organizationStatus === "pre_incorporation") ? ["verified certificate evidence before legal duties activate"] : []),
    ...factsList.filter(item => item.contextKind === "extra_provincial").flatMap(item => item.jurisdictionCode === "CA-ON-OBCA" && !item.commencedBusinessDate
      ? [`Ontario business commencement date (${item.contextLabel ?? "registration"})`]
      : item.jurisdictionCode === "CA-BC" && !item.registrationDate ? [`BC registration date (${item.contextLabel ?? "registration"})`] : []),
    ...(facts?.legalSubtype && ["unlimited_liability_company", "community_contribution_company", "benefit_company", "other"].includes(facts.legalSubtype) ? ["reviewed subtype rule pack before automated deadlines"] : []),
  ];
  const filingMatches = new Map(
    (filings ?? []).map((filing) => [filingMatchKey(filing.kind, filing.dueDate, filing.sourceRegistrationId), filing]),
  );
  // Filing completion is factual. This compatibility schedule does not decide
  // statutory timeliness from an unreviewed calendar-date comparison.
  const filingForObligation = (obligation: (typeof obligations)[number]): { filing: any; late?: boolean; nominalDaysPastDue: number; timingReviewRequired: boolean } | null => {
    const filingKind = obligation.creates?.filingKind;
    if (!filingKind) return null;
    const exact = filingMatches.get(filingMatchKey(filingKind, obligation.dueDate, obligation.sourceRegistrationId));
    if (exact) {
      const filedAt = dateOnly(exact.filedAt);
      const nominalDaysPastDue = exact.status === "Filed" && filedAt
        ? Math.max(0, Math.round((Date.parse(`${filedAt}T00:00:00Z`) - Date.parse(`${obligation.dueDate}T00:00:00Z`)) / 86_400_000)) : 0;
      return { filing: exact, late: filedAt && nominalDaysPastDue === 0 ? false : undefined, nominalDaysPastDue,
        timingReviewRequired: exact.status === "Filed" && (!filedAt || nominalDaysPastDue > 0) };
    }
    if (obligation.ruleId === "compliance-ca-bc-societies-annual-report" && agmFacts.annualMeetingDate) {
      const match = annualReportForAgm(filings ?? [], agmFacts.annualMeetingDate);
      return match;
    }
    if (obligation.ruleId === "compliance-ca-bc-societies-no-agm-annual-report") {
      const match = noAgmAnnualReportForYear(filings ?? [], Number(obligation.dueDate.slice(0, 4)) - 1);
      return match;
    }
    return null;
  };
  const filingIsComplete = (obligation: (typeof obligations)[number]) => filingForObligation(obligation)?.filing?.status === "Filed";
  const decisionsByRuleId = new Map((decisions ?? []).map((decision) => [decision.ruleId, decision]));
  // Dismissed obligations no longer count toward the calculated-date tiles.
  const isDismissedObligation = (obligation: (typeof obligations)[number]) => decisionsByRuleId.get(obligation.occurrenceKey)?.status === "dismissed";
  // A review-only obligation (no filing to submit) is done once someone records
  // the review; it leaves the open-workflow count. Filing obligations stay open
  // until the filing itself is marked filed.
  const isReviewedWorkflow = (obligation: (typeof obligations)[number]) => !obligation.creates?.filingKind && decisionsByRuleId.get(obligation.occurrenceKey)?.status === "resolved";
  const countable = (obligation: (typeof obligations)[number]) => !filingIsComplete(obligation) && !isDismissedObligation(obligation) && !isReviewedWorkflow(obligation);
  const ruleStatuses = [...new Set(obligations.map((obligation) => obligation.ruleStatus))];
  // Every row usually shares one rule status ("Draft rule"); say it once in the section header.
  const sharedRuleStatus = ruleStatuses.length === 1 ? ruleStatuses[0] : null;
  const overdue = obligations.filter((obligation) => obligation.status === "overdue" && countable(obligation)).length;
  const dueToday = obligations.filter((obligation) => obligation.status === "due_today" && countable(obligation)).length;

  const trackFiling = async (obligation: (typeof obligations)[number]) => {
    const filingKind = obligation.creates?.filingKind;
    if (!filingKind) return;
    const existing = filingForObligation(obligation)?.filing;
    if (existing) {
      await markObligationReviewed(obligation, {
        targetTable: "filings",
        targetId: existing._id,
        notes: `Filing linked from compliance obligation ${obligation.obligationKey}.`,
      });
      toast.info("Filing already tracked", `${existing.kind} is already scheduled for ${formatDate(existing.dueDate)}.`);
      return;
    }
    const filingId = await createFiling({
      societyId: society._id,
      kind: filingKind,
      jurisdictionCode: obligation.jurisdictionCode,
      contextKind: obligation.contextKind,
      sourceRegistrationId: obligation.sourceRegistrationId,
      periodLabel: obligation.title,
      dueDate: obligation.dueDate,
      status: "Upcoming",
      submissionChecklist: obligation.creates?.checklist?.length ? obligation.creates.checklist : undefined,
      notes: [
        `Created from compliance obligation ${obligation.obligationKey}.`,
        `Rule: ${obligation.ruleId}`,
        obligation.sourceRegistrationId ? `Registration: ${obligation.sourceRegistrationId}` : "",
        `Source: ${obligation.authority.displayCitation}`,
        "This is a nominal calculated date. Review statutory holidays, location, filing-office closures and submission-channel rules before treating it as the final deadline.",
      ].filter(Boolean).join("\n"),
    });
    await markObligationReviewed(obligation, {
      targetTable: "filings",
      targetId: filingId,
      notes: `Filing created from compliance obligation ${obligation.obligationKey}.`,
    });
    toast.success("Filing created", `${obligation.title} is now tracked in Filings.`);
  };

  const stageDocumentPacket = async (obligation: (typeof obligations)[number], filingId?: string) => {
    try {
    const result = await stagePacket({
      societyId: society._id,
      obligationKey: obligation.obligationKey,
      obligationRuleId: obligation.ruleId,
      obligationTitle: obligation.title,
      filingKind: obligation.creates?.filingKind,
      dueDate: obligation.dueDate,
      filingId,
      sourceRegistrationId: obligation.sourceRegistrationId,
      notes: [
        `Staged from compliance obligation ${obligation.obligationKey}.`,
        `Rule: ${obligation.ruleId}`,
        `Source: ${obligation.authority.displayCitation}`,
      ].join("\n"),
    }) as any;
    await markObligationReviewed(obligation, {
      targetTable: "legalPrecedentRuns",
      targetId: result.runId,
      notes: `Document packet staged from compliance obligation ${obligation.obligationKey}.`,
    });
    toast.success("Packet staged", `Open ${obligation.title} in Template Engine to review the documents.`);
    } catch (error) {
      toast.error("Could not stage the document packet", error instanceof Error ? error.message : String(error));
    }
  };

  const markObligationReviewed = async (
    obligation: (typeof obligations)[number],
    target?: { targetTable?: string; targetId?: string; notes?: string },
  ) => {
    await markReviewed({
      ...decisionPayload(society._id, obligation),
      targetTable: target?.targetTable,
      targetId: target?.targetId,
      notes: target?.notes ?? `Reviewed compliance workflow ${obligation.obligationKey}.`,
    });
  };

  const acknowledgeWorkflow = async (obligation: (typeof obligations)[number]) => {
    try {
      await markObligationReviewed(obligation);
      toast.success("Workflow reviewed", obligation.title);
    } catch (error) {
      toast.error("Could not review obligation", error instanceof Error ? error.message : String(error));
    }
  };

  const dismissObligation = async (obligation: (typeof obligations)[number]) => {
    // Dismissing only hides this occurrence and reopening is one call, so
    // act straight away and offer Undo instead of a confirmation.
    await undoable({
      message: "Obligation dismissed",
      description: `${obligation.title} (${formatDate(obligation.dueDate)}) is hidden from the counts. The statutory duty itself is not waived.`,
      errorMessage: "Could not dismiss obligation",
      dedupeKey: `obligation-dismiss-${obligation.obligationKey}`,
      run: () => dismissDecision({
        ...decisionPayload(society._id, obligation),
        notes: `Dismissed compliance obligation ${obligation.obligationKey}.`,
      }),
      undo: () => reopenDecision(decisionPayload(society._id, obligation)),
      undoneMessage: "Obligation reopened",
    });
  };

  const reopenObligation = async (obligation: (typeof obligations)[number]) => {
    await reopenDecision(decisionPayload(society._id, obligation));
    toast.success("Obligation reopened", obligation.title);
  };

  const obligationRecords: ObligationRecord[] = obligations.map((obligation) => {
    const filingKind = obligation.creates?.filingKind;
    const filingMatch = filingForObligation(obligation);
    const existingFiling = filingMatch?.filing ?? null;
    const decision: ObligationDecision | undefined = decisionsByRuleId.get(obligation.occurrenceKey);
    // The home registration is the default; only name other contexts (extra-provincial, branch…).
    const contextSummary = obligation.contextLabel && obligation.contextKey !== obligation.ruleId
      ? obligation.contextLabel
      : contextKindLabel(obligation.contextKind) !== "Home" ? contextKindLabel(obligation.contextKind) : null;
    const details = [
      `Context: ${contextKindLabel(obligation.contextKind)}`,
      `Jurisdiction: ${obligation.jurisdictionCode}`,
      `Obligation key: ${obligation.obligationKey}`,
      obligation.windowStartDate ? `Window opens: ${formatDate(obligation.windowStartDate)}` : "",
      filingKind ? `Filing kind: ${filingKind}` : "",
      obligation.caveat ? `Rule limits: ${obligation.caveat}` : "",
      obligation.creates?.requiredEvidence?.length
        ? `Evidence: ${obligation.creates.requiredEvidence.join(", ")}`
        : "",
      obligation.authority.guideRuleIds.length ? `Guide rules: ${obligation.authority.guideRuleIds.join(", ")}` : "",
    ].filter(Boolean).join("\n");
    const status: ObligationDisplayStatus = existingFiling?.status === "Filed"
      ? (filingMatch?.timingReviewRequired ? "filed_timing" : "filed")
      : decision?.status === "dismissed" ? "dismissed"
        : isReviewedWorkflow(obligation) ? "reviewed"
          : obligation.status;
    return {
      _id: obligation.occurrenceKey,
      title: obligation.title,
      dueDate: obligation.dueDate,
      status,
      source: obligation.authority.displayCitation,
      jurisdictionCode: obligation.jurisdictionCode,
      contextKind: obligation.contextKind ?? "home",
      ruleStatus: obligation.ruleStatus,
      filingKind: filingKind ?? null,
      contextSummary,
      details,
      filingMatch,
      decision,
      obligation,
    };
  });

  /** What a row offers: its one main action inline, the rest in its "…" menu. */
  const obligationActions = ({ obligation, filingMatch, decision }: ObligationRecord) => {
    const filingKind = obligation.creates?.filingKind;
    const existingFiling = filingMatch?.filing ?? null;
    // Corporation packets do not apply to societies (staging one
    // throws), so only offer Packet where the catalog applies.
    const packet = corporate ? corporationPacketForComplianceObligation({
      filingKind,
      obligationKey: obligation.obligationKey,
      ruleId: obligation.ruleId,
      organization,
    }) : undefined;
    const isDismissed = decision?.status === "dismissed";
    const isReviewed = decision?.status === "resolved" || Boolean(existingFiling);
    const hasStagedPacket = decision?.targetTable === "legalPrecedentRuns";
    const secondaryActions: MenuItem[] = isDismissed ? [] : [
      ...(hasStagedPacket
        ? [{ id: "packet", label: "Open document packet", icon: <BookTemplate size={14} />, onSelect: () => navigate("/app/template-engine") }]
        : packet
          ? [{ id: "packet", label: "Stage document packet", icon: <BookTemplate size={14} />, disabled: !canStage, onSelect: () => void stageDocumentPacket(obligation, existingFiling?._id) }]
          : []),
      ...(!isReviewed ? [{ id: "dismiss", label: "Dismiss", icon: <X size={14} />, disabled: !canReview, onSelect: () => void dismissObligation(obligation) }] : []),
    ];
    return { filingKind, existingFiling, isDismissed, isReviewed, secondaryActions };
  };

  return (
    <div className="page">
      <PageHeader
        title="Compliance obligations"
        icon={<ClipboardList size={16} />}
        iconColor="green"
        subtitle={`Nominal dates computed from draft rule packs for ${jurisdictionCopy.entityLabel} workspaces.`}
        actions={
          <Link className="btn-action" to="/app/filings">
            <ExternalLink size={12} /> Open filings
          </Link>
        }
      />

      <p className="muted" role="status">
        <ExpandableText lines={6} phoneLines={2} label="the review note">
          These calculated dates require review of statutory holidays, the applicable location, filing-office closures and submission-channel rules.
          A rule-pack or workflow review does not establish the final legal deadline. Filing completion is recorded separately from its timeliness.
        </ExpandableText>
      </p>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatTile label="Active packs" value={packs.length} />
        <StatTile label="Computed obligations" value={obligations.length} />
        <StatTile label="Calculated for today" value={dueToday} />
        <StatTile label="Past calculated date" value={overdue} />
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">{organizationLabel(organization)}</h2>
            <span className="card__subtitle">
              {jurisdictionModule.registryPortalLabel} · {entityTypeLabel(organizationEntityType(organization))}
            </span>
          </div>
          <Badge tone={packs.length ? "success" : "warn"}>
            {packs.length ? "Rule pack matched" : "No executable pack"}
          </Badge>
        </div>
        <div className="card__body">
          {facts?.formationInferredFromRecords ? (
            <p className="muted" style={{ marginTop: 0 }} role="status">
              {organization.formationStatus === "unverified_existing"
                ? <>The profile records this {jurisdictionCopy.entityLabel} as an existing organization whose incorporation evidence is not verified yet. {agmFacts.agmDates.length} held AGM</>
                : <>The profile says this {jurisdictionCopy.entityLabel} is still being formed, but {agmFacts.agmDates.length} held AGM</>}
              {agmFacts.agmDates.length === 1 ? " is" : "s are"} on record (latest {formatDate(agmFacts.annualMeetingDate ?? "")}).
              Obligations below are computed provisionally from those meeting records.{" "}
              <Link to="/app/society">{organization.formationStatus === "unverified_existing" ? "Verify the incorporation certificate and date" : "Confirm the formation status and incorporation date"}</Link> to remove this caveat.
            </p>
          ) : null}
          {agmFacts.annualMeetingDate ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Latest AGM on record: <strong>{formatDate(agmFacts.annualMeetingDate)}</strong>
              {agmFacts.source === "meetings" ? " (from meeting records)" : " (from the society profile)"}.
            </p>
          ) : null}
          {missingFacts.length ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Missing facts: {missingFacts.join("; ")}. Add them to compute more obligations.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              The date inputs for this schedule are recorded. The legal calendar boundary still requires review.
            </p>
          )}
          {jurisdictionModule.compliancePackIds.length ? (
            <details className="disclosure obligations-packs">
              <summary>Rule packs ({jurisdictionModule.compliancePackIds.length})</summary>
              <ul>
                {jurisdictionModule.compliancePackIds.map((packId) => (
                  <li key={packId} title={`${jurisdictionCode} · ${packId}`}>{packTitles.get(packId) ?? packId}</li>
                ))}
              </ul>
            </details>
          ) : <Badge tone="neutral">No configured pack</Badge>}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Obligation results</h2>
            <span className="card__subtitle">Nominal dates and sources; legal calendar review is separate.</span>
          </div>
          {sharedRuleStatus && <Badge tone={ruleStatusTone(sharedRuleStatus)}>{sharedRuleStatus === "draft" ? "Draft rules" : ruleStatusLabel(sharedRuleStatus)}</Badge>}
        </div>
        <RecordListTable<ObligationRecord>
          variant="card"
          table={OBLIGATIONS}
          tableId="compliance-obligations"
          label="Obligations"
          icon={<ClipboardList size={14} />}
          records={obligationRecords}
          renderCell={({ record: row, field }) => {
            const { obligation } = row;
            if (field.name === "title") return (
              <div className="record-table__identifier-lines" title={row.details}>
                <strong className="record-table__identifier-primary">{obligation.title}</strong>
                {row.contextSummary && <div className="record-table__identifier-secondary muted">{row.contextSummary}</div>}
              </div>
            );
            if (field.name === "dueDate") return (
              <div className="record-table__identifier-lines">
                <span className="record-table__identifier-primary">{formatDate(obligation.dueDate)}</span>
                <div className="record-table__identifier-secondary muted">Nominal · {relative(obligation.dueDate)}</div>
              </div>
            );
            if (field.name === "status") {
              const notes = [
                row.filingMatch?.timingReviewRequired && row.filingMatch.nominalDaysPastDue > 0
                  ? `${row.filingMatch.nominalDaysPastDue} days after the nominal date; legal calendar review required.`
                  : "",
                row.decision?.updatedAtISO ? relative(row.decision.updatedAtISO) : "",
              ].filter(Boolean).join(" · ");
              const badge = <Badge tone={OBLIGATION_STATUS_TONE[row.status]}>{OBLIGATION_STATUS_LABEL[row.status]}</Badge>;
              if (!notes) return badge;
              return (
                <div className="record-table__identifier-lines" title={notes}>
                  <span className="record-table__identifier-primary">{badge}</span>
                  <div className="record-table__identifier-secondary muted">{notes}</div>
                </div>
              );
            }
            if (field.name === "source") return (
              <div className="record-table__identifier-lines" title={obligation.authority.displayCitation}>
                <span className="record-table__identifier-primary row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <span>{obligation.authority.displayCitation}</span>
                  {!sharedRuleStatus && <Badge tone={ruleStatusTone(obligation.ruleStatus)}>{ruleStatusLabel(obligation.ruleStatus)}</Badge>}
                </span>
                {obligation.sources.length ? (
                  <div className="record-table__identifier-secondary muted">
                    {obligation.sources.slice(0, 2).map((source, index) => (
                      <span key={source.sourceId}>
                        {index > 0 ? " · " : ""}
                        <a href={source.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{source.title}</a>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
            return undefined;
          }}
          renderPhoneCard={(row, { field, selecting }) => {
            return (
              <RecordTablePhoneCard
                title={row.obligation.title}
                wrapTitle
                badge={field("status")}
                meta={[formatDate(row.obligation.dueDate), `Nominal · ${relative(row.obligation.dueDate)}`]}
                detail={[row.contextSummary ?? "", row.obligation.authority.displayCitation]}
                selecting={selecting}
              />
            );
          }}
          renderRowActions={(record) => {
            const { obligation } = record;
            const { filingKind, existingFiling, isDismissed, isReviewed } = obligationActions(record);
            if (isDismissed) return (
              <button className="btn btn--sm" disabled={!canReview} onClick={() => reopenObligation(obligation)}>
                <RotateCcw size={12} /> Reopen
              </button>
            );
            if (existingFiling) return <Link className="btn btn--sm" to="/app/filings">Tracked</Link>;
            if (filingKind) return (
              <button className="btn btn--sm" disabled={!canTrack} onClick={() => trackFiling(obligation)}>
                <Plus size={12} /> Track
              </button>
            );
            if (isReviewed) return null;
            return (
              <button className="btn btn--sm" disabled={!canReview} onClick={() => acknowledgeWorkflow(obligation)}>
                <CheckCircle2 size={12} /> Review
              </button>
            );
          }}
          rowMenuSections={(record) => [{ id: "actions", items: obligationActions(record).secondaryActions }]}
          emptyState={
            <RecordTableEmpty
              title="No computed obligations yet"
              description="This jurisdiction/entity pair does not have a matching executable pack yet, or the workspace is missing the date facts needed by the draft rules."
            />
          }
        />
      </section>
    </div>
  );
}

// Entity types are stored as option keys ("corporation__business_"); show their label.
function entityTypeLabel(value: string) {
  return ORG_HUB_OPTION_SETS.entityTypes.find((option) => option.value === value)?.label ?? capitalize(value);
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function filingMatchKey(kind: string, dueDate: string, sourceRegistrationId?: string | null) {
  return `${kind}\u0000${dueDate}\u0000${sourceRegistrationId ?? "home"}`;
}

function decisionPayload(societyId: any, obligation: ReturnType<typeof computeComplianceObligations>[number]) {
  return {
    societyId,
    ruleId: obligation.occurrenceKey,
    flagLevel: obligation.status === "overdue" || obligation.status === "due_today" ? "warn" : "info",
    flagText: obligation.title,
    evidenceRequired: obligation.creates?.requiredEvidence ?? [],
  };
}

function requiredFactLabels(facts: ComplianceFacts | null) {
  if (!facts) return [];
  const missing: string[] = [];
  if (!facts.incorporationDate) missing.push("incorporation date");
  if (!facts.anniversaryDate) missing.push("anniversary date");
  if (!facts.fiscalYearEnd) missing.push("fiscal year end");
  if (facts.entityType === "society" && !facts.annualMeetingDate) missing.push("the date of the last AGM held (record it as a held AGM meeting or on the society profile) to compute the annual report deadline");
  if (facts.entityType !== "society" && !facts.annualReferenceDate) missing.push("last annual meeting/annual reference date for subsequent meetings");
  return missing;
}

function statusTone(status: ComplianceObligationStatus) {
  if (status === "overdue") return "warn";
  if (status === "due_today") return "warn";
  return "info";
}

function statusLabel(status: ComplianceObligationStatus) {
  if (status === "due_today") return "Calculated for today";
  if (status === "overdue") return "Past calculated date";
  return "Upcoming calculated date";
}

function ruleStatusTone(status: ReturnType<typeof computeComplianceObligations>[number]["ruleStatus"]) {
  if (status === "accepted") return "success";
  if (status === "reviewed") return "info";
  if (status === "deprecated") return "neutral";
  return "warn";
}

function ruleStatusLabel(status: ReturnType<typeof computeComplianceObligations>[number]["ruleStatus"]) {
  if (status === "accepted") return "Accepted";
  if (status === "reviewed") return "Reviewed rule";
  if (status === "deprecated") return "Deprecated";
  return "Draft rule";
}

function contextKindLabel(contextKind: ReturnType<typeof computeComplianceObligations>[number]["contextKind"]) {
  if (contextKind === "extra_provincial") return "Extra-provincial";
  if (contextKind === "branch") return "Branch";
  if (contextKind === "business_name") return "Business name";
  return "Home";
}
