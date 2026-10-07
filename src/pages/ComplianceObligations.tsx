import { useMemo } from "react";
import { BookTemplate, CheckCircle2, ClipboardList, ExternalLink, Plus, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useOrganizationWorkspace } from "../hooks/useOrganizationWorkspace";
import { Badge } from "../components/ui";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
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
import { annualReportForAgm, deriveAgmFacts, noAgmAnnualReportForYear } from "../../shared/agmEvidence";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { usePermissions } from "../hooks/usePermissions";

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
  const confirm = useConfirm();
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

  if (isLoading) return <PageLoading />;
  if (missingWorkspace || !organization || !society) return <SeedPrompt />;

  const today = facts?.asOfDate ?? new Date().toISOString().slice(0, 10);
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
  // Annual reports are matched to the AGM they follow, not only by an exact
  // due-date key, so a filing tracked with a slightly different due date (or a
  // late filing) still discharges the obligation and is shown as late.
  const filingForObligation = (obligation: (typeof obligations)[number]): { filing: any; late: boolean } | null => {
    const filingKind = obligation.creates?.filingKind;
    if (!filingKind) return null;
    const exact = filingMatches.get(filingMatchKey(filingKind, obligation.dueDate, obligation.sourceRegistrationId));
    if (exact) return { filing: exact, late: Boolean(exact.filedAt && String(exact.filedAt).slice(0, 10) > obligation.dueDate) };
    if (obligation.ruleId === "compliance-ca-bc-societies-annual-report" && agmFacts.annualMeetingDate) {
      const match = annualReportForAgm(filings ?? [], agmFacts.annualMeetingDate);
      return match ? { filing: match.filing, late: match.late } : null;
    }
    if (obligation.ruleId === "compliance-ca-bc-societies-no-agm-annual-report") {
      const match = noAgmAnnualReportForYear(filings ?? [], Number(obligation.dueDate.slice(0, 4)) - 1);
      return match ? { filing: match.filing, late: match.late } : null;
    }
    return null;
  };
  const filingIsComplete = (obligation: (typeof obligations)[number]) => filingForObligation(obligation)?.filing?.status === "Filed";
  const decisionsByRuleId = new Map((decisions ?? []).map((decision) => [decision.ruleId, decision]));
  // Dismissed obligations no longer count toward the overdue/due-today tiles.
  const isDismissedObligation = (obligation: (typeof obligations)[number]) => decisionsByRuleId.get(obligation.occurrenceKey)?.status === "dismissed";
  const countable = (obligation: (typeof obligations)[number]) => !filingIsComplete(obligation) && !isDismissedObligation(obligation);
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
    toast.success("Packet staged", `${obligation.title} is ready in Template Engine.`);
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
      toast.success("Obligation reviewed", obligation.title);
    } catch (error) {
      toast.error("Could not review obligation", error instanceof Error ? error.message : String(error));
    }
  };

  const dismissObligation = async (obligation: (typeof obligations)[number]) => {
    const ok = await confirm({
      title: `Dismiss "${obligation.title}"?`,
      message: `The ${formatDate(obligation.dueDate)} occurrence will be hidden from the overdue and due-today counts. The statutory duty itself is not waived; you can reopen it later.`,
      confirmLabel: "Dismiss",
      tone: "warn",
    });
    if (!ok) return;
    await dismissDecision({
      ...decisionPayload(society._id, obligation),
      notes: `Dismissed compliance obligation ${obligation.obligationKey}.`,
    });
    toast.info("Obligation dismissed", obligation.title);
  };

  const reopenObligation = async (obligation: (typeof obligations)[number]) => {
    await reopenDecision(decisionPayload(society._id, obligation));
    toast.success("Obligation reopened", obligation.title);
  };

  return (
    <div className="page">
      <PageHeader
        title="Compliance obligations"
        icon={<ClipboardList size={16} />}
        iconColor="green"
        subtitle={`Computed from draft rule packs for ${jurisdictionCopy.entityLabel} workspaces.`}
        actions={
          <Link className="btn-action" to="/app/filings">
            <ExternalLink size={12} /> Open filings
          </Link>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat">
          <span className="stat__label">Active packs</span>
          <strong className="stat__value">{packs.length}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Computed obligations</span>
          <strong className="stat__value">{obligations.length}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Due today</span>
          <strong className="stat__value">{dueToday}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Overdue</span>
          <strong className="stat__value">{overdue}</strong>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">{organizationLabel(organization)}</h2>
            <span className="card__subtitle">
              {jurisdictionModule.registryPortalLabel} · {jurisdictionCode} · {organizationEntityType(organization)}
            </span>
          </div>
          <Badge tone={packs.length ? "success" : "warn"}>
            {packs.length ? "Rule pack matched" : "No executable pack"}
          </Badge>
        </div>
        <div className="card__body">
          {facts?.formationInferredFromRecords ? (
            <p className="muted" style={{ marginTop: 0 }} role="status">
              The profile says this {jurisdictionCopy.entityLabel} is still being formed, but {agmFacts.agmDates.length} held AGM
              {agmFacts.agmDates.length === 1 ? " is" : "s are"} on record (latest {formatDate(agmFacts.annualMeetingDate ?? "")}).
              Obligations below are computed provisionally from those meeting records.{" "}
              <Link to="/app/society">Confirm the formation status and incorporation date</Link> to remove this caveat.
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
              Required date facts are present for the first draft obligation checks.
            </p>
          )}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {jurisdictionModule.compliancePackIds.map((packId) => (
              <Badge key={packId} tone="info"><span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{packId}</span></Badge>
            ))}
            {!jurisdictionModule.compliancePackIds.length && <Badge tone="neutral">No configured pack</Badge>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Obligation results</h2>
            <span className="card__subtitle">Draft operational dates with source-backed guide references.</span>
          </div>
        </div>
        {obligations.length ? (
          <div className="table-wrap" style={{ marginInline: 0, maxWidth: "100%" }}>
            <table className="table table--stack-mobile">
              <thead>
                <tr>
                  <th>Obligation</th>
                  <th>Due date</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th className="table__actions-col">Action</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((obligation) => {
                  const filingKind = obligation.creates?.filingKind;
                  const filingMatch = filingForObligation(obligation);
                  const existingFiling = filingMatch?.filing ?? null;
                  // Corporation packets do not apply to societies (staging one
                  // throws), so only offer Packet where the catalog applies.
                  const packet = corporate ? corporationPacketForComplianceObligation({
                    filingKind,
                    obligationKey: obligation.obligationKey,
                    ruleId: obligation.ruleId,
                  }) : undefined;
                  const decision = decisionsByRuleId.get(obligation.occurrenceKey);
                  const isDismissed = decision?.status === "dismissed";
                  const isReviewed = decision?.status === "resolved" || Boolean(existingFiling);
                  const hasStagedPacket = decision?.targetTable === "legalPrecedentRuns";
                  const contextSummary = obligation.contextLabel && obligation.contextKey !== obligation.ruleId
                    ? `${obligation.contextLabel} · ${obligation.jurisdictionCode}`
                    : `${contextKindLabel(obligation.contextKind)} · ${obligation.jurisdictionCode}`;
                  const obligationDetails = [
                    `Context: ${contextKindLabel(obligation.contextKind)}`,
                    `Jurisdiction: ${obligation.jurisdictionCode}`,
                    `Obligation key: ${obligation.obligationKey}`,
                    obligation.windowStartDate ? `Window opens: ${formatDate(obligation.windowStartDate)}` : "",
                    filingKind ? `Filing kind: ${filingKind}` : "",
                    obligation.caveat ? `Rule limits: ${obligation.caveat}` : "",
                    obligation.creates?.requiredEvidence?.length
                      ? `Evidence: ${obligation.creates.requiredEvidence.join(", ")}`
                      : "",
                  ].filter(Boolean).join("\n");
                  return (
                    <tr key={obligation.occurrenceKey}>
                      <td data-label="Obligation">
                        <strong>{obligation.title}</strong>
                        <div className="muted" style={{ fontSize: 12 }} title={obligationDetails}>
                          {contextSummary}
                        </div>
                      </td>
                      <td className="table__cell--mono" data-label="Due date">
                        {formatDate(obligation.dueDate)}
                        <div className="muted" style={{ fontSize: 12 }}>{relative(obligation.dueDate)}</div>
                      </td>
                      <td data-label="Status">
                        <Badge tone={existingFiling?.status === "Filed" ? (filingMatch?.late ? "warn" : "success") : isDismissed ? "neutral" : statusTone(obligation.status)}>
                          {existingFiling?.status === "Filed" ? (filingMatch?.late ? "Filed late" : "Filed") : isDismissed ? "Dismissed" : statusLabel(obligation.status)}
                        </Badge>
                        {isDismissed || isReviewed ? <div className="muted" style={{ fontSize: 12 }}>{isDismissed ? "Workflow dismissed" : "Workflow reviewed"}</div> : null}
                        {decision?.updatedAtISO ? (
                          <div className="muted" style={{ fontSize: 12 }}>{relative(decision.updatedAtISO)}</div>
                        ) : null}
                      </td>
                      <td data-label="Source" className="obligations__source">
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span>{obligation.authority.displayCitation}</span>
                          <Badge tone={ruleStatusTone(obligation.ruleStatus)}>{ruleStatusLabel(obligation.ruleStatus)}</Badge>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {obligation.authority.guideRuleIds.join(", ")}
                        </div>
                        {obligation.sources.length ? (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {obligation.sources.slice(0, 2).map((source, index) => (
                              <span key={source.sourceId}>
                                {index > 0 ? " · " : ""}
                                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="table__actions" data-label="Action">
                        <div className="table__actions-inner">
                          {isDismissed ? (
                            <button className="btn btn--sm" disabled={!canReview} onClick={() => reopenObligation(obligation)}>
                              <RotateCcw size={12} /> Reopen
                            </button>
                          ) : (
                            <>
                              {existingFiling ? (
                                <Link className="btn btn--sm" to="/app/filings">Tracked</Link>
                              ) : filingKind ? (
                                <button className="btn btn--sm" disabled={!canTrack} onClick={() => trackFiling(obligation)}>
                                  <Plus size={12} /> Track
                                </button>
                              ) : isReviewed ? (
                                <Badge tone="success">Workflow</Badge>
                              ) : (
                                <button className="btn btn--sm" disabled={!canReview} onClick={() => acknowledgeWorkflow(obligation)}>
                                  <CheckCircle2 size={12} /> Review
                                </button>
                              )}
                              {hasStagedPacket ? (
                                <Link className="btn btn--sm" to="/app/template-engine">Packet</Link>
                              ) : packet ? (
                                <button className="btn btn--sm" disabled={!canStage} onClick={() => stageDocumentPacket(obligation, existingFiling?._id)}>
                                  <BookTemplate size={12} /> Packet
                                </button>
                              ) : null}
                              {!isReviewed && (
                                <button className="btn btn--sm" disabled={!canReview} onClick={() => dismissObligation(obligation)}>
                                  <X size={12} /> Dismiss
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No computed obligations yet</h3>
            <p>
              This jurisdiction/entity pair does not have a matching executable pack yet, or the
              workspace is missing the date facts needed by the draft rules.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function filingMatchKey(kind: string, dueDate: string, sourceRegistrationId?: string | null) {
  return `${kind}\u0000${dueDate}\u0000${sourceRegistrationId ?? "home"}`;
}

function decisionPayload(societyId: any, obligation: ReturnType<typeof computeComplianceObligations>[number]) {
  return {
    societyId,
    ruleId: obligation.occurrenceKey,
    flagLevel: obligation.status === "overdue" ? "err" : obligation.status === "due_today" ? "warn" : "info",
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
  if (facts.entityType !== "society" && !facts.annualReferenceDate) missing.push("last AGM/annual reference date for subsequent meetings");
  return missing;
}

function statusTone(status: ComplianceObligationStatus) {
  if (status === "overdue") return "danger";
  if (status === "due_today") return "warn";
  return "info";
}

function statusLabel(status: ComplianceObligationStatus) {
  if (status === "due_today") return "Due today";
  return status[0].toUpperCase() + status.slice(1);
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
