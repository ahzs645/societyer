import { useMemo } from "react";
import { BookTemplate, CheckCircle2, ClipboardList, ExternalLink, Plus, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useOrganizationWorkspace } from "../hooks/useOrganizationWorkspace";
import { Badge } from "../components/ui";
import { PageHeader, SeedPrompt } from "./_helpers";
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
import { useToast } from "../components/Toast";

export function ComplianceObligationsPage() {
  const { organization, society, isLoading, missingWorkspace } = useOrganizationWorkspace();
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
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

  const factsList = useMemo(
    () => (organization ? complianceFactsForOrganization(organization, { registrations: detail?.registrations ?? [] }) : []),
    [detail?.registrations, organization],
  );
  const facts = factsList[0] ?? null;
  const obligations = useMemo(() => factsList.flatMap((item) => computeComplianceObligations(item)), [factsList]);
  const packs = useMemo(() => factsList.flatMap((item) => filterApplicableCompliancePacks(item)), [factsList]);

  if (isLoading) return <div className="page">Loading...</div>;
  if (missingWorkspace || !organization || !society) return <SeedPrompt />;

  const jurisdictionCode = homeJurisdictionCode(organization);
  const jurisdictionCopy = jurisdictionDisplayCopy(jurisdictionCode);
  const jurisdictionModule = jurisdictionModuleContract(jurisdictionCode);
  const missingFacts = requiredFactLabels(facts);
  const overdue = obligations.filter((obligation) => obligation.status === "overdue").length;
  const dueToday = obligations.filter((obligation) => obligation.status === "due_today").length;
  const filingMatches = new Map(
    (filings ?? []).map((filing) => [filingMatchKey(filing.kind, filing.dueDate), filing]),
  );
  const decisionsByRuleId = new Map((decisions ?? []).map((decision) => [decision.ruleId, decision]));

  const trackFiling = async (obligation: (typeof obligations)[number]) => {
    const filingKind = obligation.creates?.filingKind;
    if (!filingKind) return;
    const existing = filingMatches.get(filingMatchKey(filingKind, obligation.dueDate));
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
    await markObligationReviewed(obligation);
    toast.success("Obligation reviewed", obligation.title);
  };

  const dismissObligation = async (obligation: (typeof obligations)[number]) => {
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
        <div className="stat-card">
          <span className="stat-card__label">Active packs</span>
          <strong>{packs.length}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Computed obligations</span>
          <strong>{obligations.length}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Due today</span>
          <strong>{dueToday}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Overdue</span>
          <strong>{overdue}</strong>
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
          {missingFacts.length ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Add {missingFacts.join(", ")} to compute more obligations.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              Required date facts are present for the first draft obligation checks.
            </p>
          )}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {jurisdictionModule.compliancePackIds.map((packId) => (
              <Badge key={packId} tone="info">{packId}</Badge>
            ))}
            {!jurisdictionModule.compliancePackIds.length && <Badge tone="neutral">No configured pack</Badge>}
          </div>
        </div>
      </section>

      <section className="table-card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Obligation results</h2>
            <span className="card__subtitle">Draft operational dates with source-backed guide references.</span>
          </div>
        </div>
        {obligations.length ? (
          <div className="table">
            <div className="table__head" style={{ gridTemplateColumns: "minmax(220px, 1.5fr) 140px 130px minmax(220px, 1fr) 240px" }}>
              <span>Obligation</span>
              <span>Due date</span>
              <span>Status</span>
              <span>Source</span>
              <span>Action</span>
            </div>
            {obligations.map((obligation) => {
              const filingKind = obligation.creates?.filingKind;
              const existingFiling = filingKind ? filingMatches.get(filingMatchKey(filingKind, obligation.dueDate)) : null;
              const packet = corporationPacketForComplianceObligation({
                filingKind,
                obligationKey: obligation.obligationKey,
                ruleId: obligation.ruleId,
              });
              const decision = decisionsByRuleId.get(obligation.contextKey);
              const isDismissed = decision?.status === "dismissed";
              const isReviewed = decision?.status === "resolved" || Boolean(existingFiling);
              const hasStagedPacket = decision?.targetTable === "legalPrecedentRuns";
              return (
                <div
                  className="table__row"
                  key={obligation.contextKey}
                  style={{ gridTemplateColumns: "minmax(220px, 1.5fr) 140px 130px minmax(220px, 1fr) 240px" }}
                >
                  <div>
                    <strong>{obligation.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {obligation.contextLabel && obligation.contextKey !== obligation.ruleId ? `${obligation.contextLabel} · ` : ""}{obligation.obligationKey}
                      {obligation.windowStartDate ? ` · window opens ${formatDate(obligation.windowStartDate)}` : ""}
                    </div>
                    {obligation.creates?.requiredEvidence?.length ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Evidence: {obligation.creates.requiredEvidence.join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    {formatDate(obligation.dueDate)}
                    <div className="muted" style={{ fontSize: 12 }}>{relative(obligation.dueDate)}</div>
                  </div>
                  <div>
                    <Badge tone={isDismissed ? "neutral" : isReviewed ? "success" : statusTone(obligation.status)}>
                      {isDismissed ? "Dismissed" : isReviewed ? "Reviewed" : statusLabel(obligation.status)}
                    </Badge>
                    {decision?.updatedAtISO ? (
                      <div className="muted" style={{ fontSize: 12 }}>{relative(decision.updatedAtISO.slice(0, 10))}</div>
                    ) : null}
                  </div>
                  <div>
                    <span>{obligation.authority.displayCitation}</span>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {obligation.authority.guideRuleIds.join(", ")}
                    </div>
                  </div>
                  <div>
                    {isDismissed ? (
                      <button className="btn btn--sm" onClick={() => reopenObligation(obligation)}>
                        <RotateCcw size={12} /> Reopen
                      </button>
                    ) : (
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        {existingFiling ? (
                          <Link className="btn btn--sm" to="/app/filings">Tracked</Link>
                        ) : filingKind ? (
                          <button className="btn btn--sm" onClick={() => trackFiling(obligation)}>
                            <Plus size={12} /> Track
                          </button>
                        ) : isReviewed ? (
                          <Badge tone="success">Workflow</Badge>
                        ) : (
                          <button className="btn btn--sm" onClick={() => acknowledgeWorkflow(obligation)}>
                            <CheckCircle2 size={12} /> Review
                          </button>
                        )}
                        {hasStagedPacket ? (
                          <Link className="btn btn--sm" to="/app/template-engine">Packet</Link>
                        ) : packet ? (
                          <button className="btn btn--sm" onClick={() => stageDocumentPacket(obligation, existingFiling?._id)}>
                            <BookTemplate size={12} /> Packet
                          </button>
                        ) : null}
                        {!isReviewed && (
                          <button className="btn btn--sm" onClick={() => dismissObligation(obligation)}>
                            <X size={12} /> Dismiss
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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

function filingMatchKey(kind: string, dueDate: string) {
  return `${kind}\u0000${dueDate}`;
}

function decisionPayload(societyId: any, obligation: ReturnType<typeof computeComplianceObligations>[number]) {
  return {
    societyId,
    ruleId: obligation.contextKey,
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
