import { isPreparingIncorporation } from "../../shared/organizationDomain";
import { JURISDICTION_WORKSPACE_CONFIGS } from "../../shared/jurisdictionWorkspace";
import { formatMonthDay } from "../components/MonthDayPicker";
import { interfaceRouteReadPermission } from "../../shared/interfaceRouteAccess";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useState, type ReactNode } from "react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState, Flag } from "../components/ui";
import { formatDate, formatDateTime, formatShortDate, isPastDue, relative } from "../lib/format";
import { organizationTodayISO } from "../lib/dateRanges";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { Spotlight } from "../components/Spotlight";
import { TooltipCopyable } from "../components/TooltipCopyable";
import { CustomizeDashboardDrawer } from "../features/dashboard/CustomizeDashboardDrawer";
import { DASHBOARD_MODULES, DEFAULT_MODULE_ORDER, modulePlacement, useDashboardLayout, type DashboardLayout, type DashboardModuleId } from "../features/dashboard/dashboardLayout";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Users,
  UserCog,
} from "lucide-react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { jurisdictionDisplayCopy } from "../../shared/jurisdictionWorkspace";
import { organizationVocabulary } from "../lib/organizationVocabulary";
import { automatedComplianceChecksLabel } from "../../shared/entityRuleScope";
import { ContinuityChecksCard, type ContinuityCheck } from "../features/gaps/ContinuityChecksCard";
import { AgreementsExpiringCard } from "../features/agreements/AgreementsExpiringCard";
import { formatMeetingDate } from "../../shared/meetingDates";
import { RollingNumber } from "../components/RollingNumber";
import { InfoPopover } from "../components/InfoPopover";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { pluralizeCounts } from "../lib/pluralizeCounts";
import { DashboardFinanceSnapshotLazy } from "../features/financials/insights/lazy";
import { StatTile } from "../components/StatTile";
import { useIsMobile } from "../lib/useIsMobile";
import { useSetupGuideHidden } from "../hooks/useSetupProgress";
import { useOrganizationSetup } from "../features/organizationSetup/useOrganizationSetup";
import { SetupSummaryCard } from "../features/dashboard/SetupSummaryCard";
import { NeedsAttentionCard, buildAttentionItems } from "../features/dashboard/NeedsAttentionCard";
import { ATTENTION_MODULES, DashboardPhoneLayout, type DashboardDisclosure } from "../features/dashboard/DashboardPhoneLayout";
import { isModuleEnabled } from "../lib/modules";
import type { DashboardComplianceFlag, DashboardRemediationAction } from "../../shared/dashboardComplianceRules";
import { effectiveGoalStatus, goalTone, labelStatus } from "../lib/goalStatus";

export function Dashboard() {
  const society = useSociety();
  const { can } = usePermissions();
  const jurisdictionCopy = jurisdictionDisplayCopy(society);
  const entityCopy = organizationVocabulary(society);
  const corporation = entityCopy.isCorporation;
  const navigate = useNavigate();
  const toast = useToast();
  const undoable = useUndoableAction();
  const currentUserId = useCurrentUserId();
  const dashboardLayout = useDashboardLayout(currentUserId, society?._id);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const isMobile = useIsMobile();
  const data = useQuery(api.dashboard.summary, society ? { societyId: society._id } : "skip");
  const activity = useQuery(api.activity.list, society && can("audit:read") ? { societyId: society._id, limit: 10 } : "skip");
  // Corporations keep directors, officers and shareholders in the role-holder
  // register, not the society members table. The server filters the rows by
  // the caller's register permissions.
  const roleHolders = useQuery(api.legalOperations.listRoleHolders, society && corporation ? { societyId: society._id } : "skip") as any[] | undefined;
  const createPipaPolicyDraft = useMutation(api.documents.createPipaPolicyDraft);
  const createMemberDataGapMemoDraft = useMutation(api.documents.createMemberDataGapMemoDraft);
  const createPrivacyReviewTask = useMutation(api.dashboardRemediation.createPrivacyReviewTask);
  const createComplianceReviewTask = useMutation(api.dashboardRemediation.createComplianceReviewTask);
  const markPrivacyProgramReviewed = useMutation(api.dashboardRemediation.markPrivacyProgramReviewed);
  const markMemberDataAccessReviewed = useMutation(api.dashboardRemediation.markMemberDataAccessReviewed);
  const [showComplianceDetails, setShowComplianceDetails] = useState(false);
  const [busyRemediationAction, setBusyRemediationAction] = useState<string | null>(null);
  // Setup progress comes from the same source as the setup view and the
  // shell's setup pill; hiding the summary here hides the pill too, live.
  const { hidden: onboardingFlowHidden, setHidden: setOnboardingFlowHidden } = useSetupGuideHidden(society?._id ? String(society._id) : null);
  const setupProgress = useOrganizationSetup(society?._id && !onboardingFlowHidden ? String(society._id) : null);
  // Phones merge continuity checks into "Needs attention" and count expiring
  // agreements in a disclosure summary. Same queries and arguments as the
  // cards themselves, so Convex shares one subscription with them.
  const continuity = useQuery(
    api.continuity.dashboardChecks,
    society && isMobile && can("deadlines:read") ? { societyId: society._id } : "skip",
  ) as { checks: ContinuityCheck[] } | undefined;
  const agreementsEnabled = Boolean(society && can("agreements:read") && isModuleEnabled(society, "agreements"));
  const agreementsSummary = useQuery(
    api.agreements.summary,
    society && isMobile && agreementsEnabled ? { societyId: society._id, windowDays: 90 } : "skip",
  ) as { total?: number; expiring?: unknown[] } | undefined;

  if (society === undefined) return <PageLoading variant="cards" />;
  if (society === null) return <SeedPrompt />;
  if (!data) return <PageLoading variant="cards" />;

  const { counts, board, upcomingMeetings, upcomingFilings, overdueFilings, goals, complianceFlags, openTasks } = data;
  const todayISO = organizationTodayISO(society);
  const canRead = (permission: string) => data.readAccess?.includes(permission) ?? can(permission);
  const actionableComplianceFlags = complianceFlags.filter((flag: any) => flag.level !== "ok");
  const completeComplianceAccess = ["directors:read", "members:read", "documents:read"].every(canRead);
  const currentRoleHolders = (roleHolders ?? []).filter((row: any) => (row.status ?? "current") === "current");
  const roleHolderCounts = {
    directors: currentRoleHolders.filter((row: any) => row.roleType === "director").length,
    shareholders: currentRoleHolders.filter((row: any) => row.roleType === "shareholder").length,
  };
  const showSetupSummary = Boolean(setupProgress && !setupProgress.complete && setupProgress.counts.total > 0);

  const moduleLabel = (id: DashboardModuleId) => DASHBOARD_MODULES.find((module) => module.id === id)?.label ?? id;
  const isModuleHidden = (id: DashboardModuleId) => dashboardLayout.hiddenSet.has(id) || (id === "setup" && onboardingFlowHidden);
  const showModule = (id: DashboardModuleId) => {
    if (dashboardLayout.hiddenSet.has(id)) dashboardLayout.setHidden(id, false);
    if (id === "setup") setOnboardingFlowHidden(false);
  };
  // Hiding the setup card is a layout choice like any other module: the
  // shell's setup pill then comes back as the way into setup. The shared
  // per-organization flag (set from the pill's Hide) still hides the card,
  // and showing the card again clears both.
  const hideModule = (id: DashboardModuleId) =>
    void undoable({
      message: `${moduleLabel(id)} hidden`,
      description: id === "setup"
        ? `Setup progress stays ${isMobile ? "in the top bar" : "in the sidebar"}. Bring the card back any time from Customize.`
        : "Bring it back any time from Customize.",
      dedupeKey: `dashboard-hide-${id}`,
      run: () => dashboardLayout.setHidden(id, true),
      undo: () => showModule(id),
      undoneMessage: false,
    });

  const remediationPermission = (action: DashboardRemediationAction) =>
    action.intent === "createPipaPolicyDraft" || action.intent === "createMemberDataGapMemoDraft" ? "documents:write" : "deadlines:write";
  const visibleRemediationActions = (flag: DashboardComplianceFlag) =>
    (flag.remediationActions ?? []).filter((action) => {
      const permission = action.intent === "navigate" && action.to ? interfaceRouteReadPermission(action.to) : null;
      return !permission || canRead(permission);
    });
  const remediationActionDisabled = (flag: DashboardComplianceFlag, action: DashboardRemediationAction) =>
    busyRemediationAction === `${flag.ruleId}:${action.id}` || (action.intent !== "navigate" && !can(remediationPermission(action)));

  const runRemediationAction = async (flag: any, action: any) => {
    if (action.intent === "navigate") {
      navigate(action.to);
      return;
    }

    if (!can(action.intent === "createPipaPolicyDraft" || action.intent === "createMemberDataGapMemoDraft" ? "documents:write" : "deadlines:write")) {
      toast.error("Your current workspace role cannot perform this action.");
      return;
    }

    const actionKey = `${flag.ruleId}:${action.id}`;
    setBusyRemediationAction(actionKey);
    const payload = {
      societyId: society._id,
      ruleId: flag.ruleId,
      flagLevel: flag.level,
      flagText: flag.text,
      evidenceRequired: flag.evidenceRequired ?? [],
    };

    try {
      if (action.intent === "createPipaPolicyDraft") {
        const result = await createPipaPolicyDraft({ societyId: society._id });
        toast.success(result?.reused ? "Opened existing privacy policy draft" : "Privacy policy draft created");
        navigate("/app/privacy");
        return;
      }
      if (action.intent === "createMemberDataGapMemoDraft") {
        const result = await createMemberDataGapMemoDraft({ societyId: society._id });
        toast.success(result?.reused ? "Opened existing member-data memo" : "Member-data memo draft created");
        navigate("/app/privacy");
        return;
      }
      if (action.intent === "createPrivacyReviewTask") {
        const result = await createPrivacyReviewTask(payload);
        toast.success(result?.reused ? "Existing privacy review task reused" : "Privacy review task assigned");
        return;
      }
      if (action.intent === "createComplianceReviewTask") {
        const result = await createComplianceReviewTask(payload);
        toast.success(result?.reused ? "Existing review task reused" : "Compliance review task assigned");
        return;
      }
      if (action.intent === "markPrivacyProgramReviewed") {
        await markPrivacyProgramReviewed(payload);
        toast.success("Privacy program marked reviewed");
        return;
      }
      if (action.intent === "markMemberDataAccessReviewed") {
        await markMemberDataAccessReviewed(payload);
        toast.success("Member-data access marked reviewed");
        return;
      }
      toast.info("Open the linked workflow to continue");
    } catch (error: any) {
      toast.error(error?.message ?? "Remediation action failed");
    } finally {
      setBusyRemediationAction(null);
    }
  };

  const moduleContent: Partial<Record<DashboardModuleId, ReactNode>> = {
    setup: showSetupSummary && setupProgress ? (
      <SetupSummaryCard progress={setupProgress} organizationName={society.name} onHide={() => hideModule("setup")} />
    ) : null,
    stats: (
      <div className="stat-grid">
        {corporation
          ? roleHolders !== undefined && <StatTile label="Shareholders" value={<RollingNumber value={roleHolderCounts.shareholders} />} icon={<Users size={14} />} info="Current shareholders in the role-holder register" />
          : canRead("members:read") && <StatTile label="Active members" value={<RollingNumber value={counts.members} />} icon={<Users size={14} />} info="Members with voting rights are counted separately in the members list." />}
        {canRead("directors:read") && <StatTile label="Active directors" value={<RollingNumber value={counts.directors} />} icon={<UserCog size={14} />} info={!entityCopy.societyLaw ? jurisdictionCopy.directorResidencySubtext : society.isMemberFunded ? `${counts.bcResidents} BC residents (s.197 exception)` : `${counts.bcResidents} BC residents (s.40 requires >= 1)`} />}
        {canRead("meetings:read") && <StatTile label="Meetings this year" value={<RollingNumber value={counts.meetingsThisYear} />} icon={<Calendar size={14} />} />}
        {canRead("filings:read") && <StatTile label="Overdue filings" value={<RollingNumber value={counts.overdueFilings} />} tone={counts.overdueFilings ? "danger" : "neutral"} icon={<AlertTriangle size={14} />} />}
      </div>
    ),
    compliance: (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Compliance posture</h2>
          <InfoPopover label="About compliance posture">
            <p>{automatedComplianceChecksLabel(society)}. Citations and full detail are available on each item.</p>
          </InfoPopover>
        </div>
        <div className="card__body dashboard-compliance">
          <div className="dashboard-compliance__summary">
            <div>
              <div className="dashboard-compliance__count">
                {actionableComplianceFlags.length ? `${actionableComplianceFlags.length} item${actionableComplianceFlags.length === 1 ? "" : "s"} to resolve` : isPreparingIncorporation(society) ? "Checks start after incorporation" : completeComplianceAccess ? "All accessible checks satisfied" : "No issues in accessible checks"}
              </div>
              {!completeComplianceAccess && (
                <div className="muted">Some checks need an administrator. The items below use records available to your role.</div>
              )}
            </div>
            <button
              type="button"
              className="btn-action"
              onClick={() => setShowComplianceDetails((value) => !value)}
              aria-expanded={showComplianceDetails}
            >
              {showComplianceDetails ? "Hide details" : "View details"}
              {showComplianceDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          <ul className="dashboard-compliance__todo">
            {complianceFlags.slice(0, showComplianceDetails ? complianceFlags.length : 3).map((f: any, i: number) => (
              <li key={i}>{pluralizeCounts(f.text)}</li>
            ))}
          </ul>

          {!showComplianceDetails && complianceFlags.length > 3 && (
            <button
              type="button"
              className="dashboard-compliance__more"
              onClick={() => setShowComplianceDetails(true)}
            >
              Show {complianceFlags.length - 3} more
            </button>
          )}

          <div className={`dashboard-compliance__details${showComplianceDetails ? " is-open" : ""}`}>
            {complianceFlags.map((f: any, i: number) => (
              <div className="dashboard-remediation" key={f.ruleId ?? i}>
                <Flag
                  level={f.level}
                  citationId={(f as any).citationId}
                  citationIds={(f as any).citationIds}
                >
                  {pluralizeCounts(f.text)}
                </Flag>
                {f.remediationStatus && (
                  <div className="dashboard-remediation__meta">
                    <Badge tone={f.remediationStatus === "resolved" ? "success" : "info"}>
                      {f.remediationStatus === "open" ? "Workflow open" : f.remediationStatus}
                    </Badge>
                  </div>
                )}
                {(f.remediationActions?.length > 0 || f.evidenceRequired?.length > 0) && (() => {
                  const evidenceInfo = f.evidenceRequired?.length > 0 ? (
                    <InfoPopover label="Evidence that resolves this">
                      <p><strong>Evidence that resolves this</strong></p>
                      <ul style={{ margin: 0, paddingLeft: "1.1em" }}>
                        {f.evidenceRequired.map((item: string) => <li key={item}>{item}</li>)}
                      </ul>
                    </InfoPopover>
                  ) : null;
                  const visibleActions = visibleRemediationActions(f);
                  const actionDisabled = (action: any) => remediationActionDisabled(f, action);
                  const [primary, ...secondary] = visibleActions;
                  if (!primary) return evidenceInfo ? <div className="dashboard-remediation__actions">{evidenceInfo}</div> : null;
                  // One primary action per row; the rest sit in a ⋯ menu.
                  return (
                    <div className="dashboard-remediation__actions">
                      {primary.intent === "navigate" && primary.to ? (
                        <Link className="btn btn--sm" to={primary.to}>
                          {primary.label}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={actionDisabled(primary)}
                          onClick={() => runRemediationAction(f, primary)}
                        >
                          {busyRemediationAction === `${f.ruleId}:${primary.id}` ? "Working..." : primary.label}
                        </button>
                      )}
                      {secondary.length > 0 && (
                        <MoreActionsMenu
                          label=""
                          align="left"
                          items={secondary.map((action: any) => ({
                            id: action.id,
                            label: busyRemediationAction === `${f.ruleId}:${action.id}` ? "Working..." : action.label,
                            disabled: actionDisabled(action),
                            onSelect: () => runRemediationAction(f, action),
                          }))}
                        />
                      )}
                      {evidenceInfo}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    meetings: canRead("meetings:read") ? (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Upcoming meetings</h2>
          <Link to="/app/meetings" className="card__subtitle row" style={{ marginLeft: "auto" }}>
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="card__body col">
          {upcomingMeetings.length === 0 && (
            <div className="muted">No meetings scheduled.</div>
          )}
          {upcomingMeetings.map((m: any) => (
            <Link
              key={m._id}
              to={`/app/meetings/${m._id}`}
              className="col"
              style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6 }}
            >
              <div className="row">
                <Badge tone={m.type === "AGM" ? "accent" : "info"}>{m.type === "AGM" ? entityCopy.annualMeetingTitle : m.type}</Badge>
                <strong>{m.title}</strong>
              </div>
              <div className="muted">{formatMeetingDate(m)} · {relative(m.scheduledAt)}</div>
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{m.location}</div>
            </Link>
          ))}
        </div>
      </div>
    ) : null,
    continuity: (
      <>
        {/* Director consent already shows (with its actions) under Compliance
          * posture; don't repeat it under Record continuity. */}
        <ContinuityChecksCard
          societyId={society._id}
          hideCheckIds={complianceFlags.some((flag: any) => flag.ruleId === "BC-SOC-DIRECTOR-CONSENT") ? ["CONTINUITY-DIRECTOR-CONSENT"] : undefined}
        />
      </>
    ),
    organization: (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">{entityCopy.organizationTitle}</h2>
        </div>
        <div className="card__body col">
          <div><strong>{society.name}</strong></div>
          {society.incorporationNumber && (
          <div className="muted"><TooltipCopyable value={society.incorporationNumber} label={`${entityCopy.organizationNoun} number`} /></div>
        )}
          <div className="muted">Fiscal year end: {society.fiscalYearEnd ? formatMonthDay(society.fiscalYearEnd) : "—"}</div>
          <div className="muted">{society.registeredOfficeAddress}</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {!corporation && society.isCharity && <Badge tone="accent">CRA charity</Badge>}
            {entityCopy.societyLaw && society.isMemberFunded && <Badge tone="info">Member-funded</Badge>}
            {society.boardCadence && <Badge>Board meets {society.boardCadence.toLowerCase()}</Badge>}
          </div>
        </div>
      </div>
    ),
    agreements: (
      <AgreementsExpiringCard societyId={society._id} />
    ),
    board: canRead("directors:read") ? (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Board of directors</h2>
          <Link to="/app/directors" className="card__subtitle row" style={{ marginLeft: "auto" }}>
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="card__body col">
          {board.length === 0 && (
            <div className="muted">No active directors on record.</div>
          )}
          {board.map((d: any) => (
            <div
              key={d._id}
              className="row"
              style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6, gap: 8, alignItems: "center" }}
            >
              <span className="activity-item__avatar">
                {d.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <div className="col" style={{ gap: 2, flex: 1 }}>
                <strong>{d.name}</strong>
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{d.position}</div>
              </div>
              {d.isBCResident && <span title="BC resident" aria-label="BC resident"><Badge tone="info">BC</Badge></span>}
            </div>
          ))}
          {counts.directors > board.length && (
            <Link to="/app/directors" className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              +{counts.directors - board.length} more
            </Link>
          )}
        </div>
      </div>
    ) : null,
    filings: canRead("filings:read") ? (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Filings requiring attention</h2>
          <Link to="/app/filings" className="card__subtitle row" style={{ marginLeft: "auto" }}>
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Period</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {counts.overdueFilings > 0 && (
              <tr className="table__group-row table__group-row--danger">
                <td colSpan={4}>
                  Overdue · {counts.overdueFilings}
                </td>
              </tr>
            )}
            {overdueFilings.slice(0, 4).map((f: any) => renderFilingRow(f, todayISO))}
            {upcomingFilings.length > 0 && (
              <tr className="table__group-row">
                <td colSpan={4}>
                  Upcoming · {upcomingFilings.length}
                </td>
              </tr>
            )}
            {upcomingFilings.slice(0, overdueFilings.length > 0 ? 4 : 6).map((f: any) => renderFilingRow(f, todayISO))}
            {counts.overdueFilings + upcomingFilings.length === 0 && (
              <tr>
                <td colSpan={4} className="table__empty">
                  No overdue or upcoming filings.
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>
    ) : null,
    activity: canRead("audit:read") ? (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title"><Activity size={14} style={{ display: "inline-block", marginRight: 4, verticalAlign: -2 }} />Activity</h2>
        </div>
        <div className="card__body col" style={{ gap: 0 }}>
          {(activity ?? []).map((a: any) => (
            <div className="activity-item" key={a._id}>
              <span className="activity-item__avatar">
                {a.actor.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <div className="activity-item__text">
                <strong>{a.actor}</strong> {a.summary}
                <div className="activity-item__meta">{relativeShort(a.createdAtISO)}</div>
              </div>
            </div>
          ))}
          {(!activity || activity.length === 0) && <div className="muted">No activity yet.</div>}
        </div>
      </div>
    ) : null,
    // Finance snapshot slot: the finance chart card renders here when present.
    finance: <DashboardFinanceSnapshotLazy society={society} />,
    goals: canRead("commitments:read") ? (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Goals at a glance</h2>
          <Link to="/app/goals" className="card__subtitle row" style={{ marginLeft: "auto" }}>
            All goals <ArrowRight size={12} />
          </Link>
        </div>
        <div className="card__body col">
          {goals.map((g: any) => (
            <Link key={g._id} to={`/app/goals/${g._id}`} className="col" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6, gap: 6 }}>
              <div className="row">
                <strong>{g.title}</strong>
                <Badge tone={goalTone(effectiveGoalStatus(g))}>
                  {labelStatus(effectiveGoalStatus(g))}
                </Badge>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div className={`progress${effectiveGoalStatus(g) === "AtRisk" || effectiveGoalStatus(g) === "OffTrack" ? " progress--warn" : ""}`} style={{ flex: 1 }}>
                  <div className="progress__fill" style={{ width: `${g.progressPercent}%` }} />
                </div>
                <span className="num" style={{ minWidth: 40 }}>{g.progressPercent}%</span>
              </div>
            </Link>
          ))}
          {goals.length === 0 && <div className="muted">No goals yet.</div>}
        </div>
      </div>
    ) : null,
    tasks: canRead("tasks:read") ? (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Open tasks</h2>
          <Link to="/app/tasks" className="card__subtitle row" style={{ marginLeft: "auto" }}>
            All tasks <ArrowRight size={12} />
          </Link>
        </div>
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th scope="col" className="table__icon-col">
                <span className="sr-only">Priority</span>
              </th>
              <th scope="col">Task</th>
              <th scope="col">Assignee</th>
              <th scope="col">Due</th>
            </tr>
          </thead>
          <tbody>
            {openTasks.map((t: any) => (
              <tr key={t._id}>
                <td className="table__icon-col">
                  <span className={`priority-dot priority-${t.priority}`} />
                </td>
                <td>{t.title}</td>
                <td className="table__cell--muted">{t.assignee ?? "—"}</td>
                <td className="dashboard-table__date table__cell--muted" title={t.dueDate ? formatDate(t.dueDate, "EEEE, MMMM d, yyyy") : undefined}>
                  {t.dueDate ? formatShortDate(t.dueDate, todayISO) : ""}
                </td>
              </tr>
            ))}
            {openTasks.length === 0 && (
              <tr>
                <td colSpan={4} className="table__empty">Nothing open.</td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>
    ) : null,
  };

  const availableModules = DEFAULT_MODULE_ORDER.filter((id) => moduleContent[id] != null);
  const visibleModules = dashboardLayout.layout.order.filter((id) => moduleContent[id] != null && !isModuleHidden(id));

  // Phones: compliance, continuity and filings become one list, built from
  // the visible modules' data only (a hidden module adds nothing to it).
  const attentionVisible = isMobile && visibleModules.some((id) => ATTENTION_MODULES.has(id));
  const filingsVisible = visibleModules.includes("filings");
  const attentionItems = attentionVisible
    ? buildAttentionItems({
        flags: visibleModules.includes("compliance") ? complianceFlags : undefined,
        checks: visibleModules.includes("continuity") ? continuity?.checks : undefined,
        overdueFilings: filingsVisible ? overdueFilings : undefined,
        upcomingFilings: filingsVisible ? upcomingFilings : undefined,
        todayISO,
        filingLabel: kindLabel,
        canOpen: (to) => {
          const permission = interfaceRouteReadPermission(to.split(/[?#]/)[0]);
          return !permission || can(permission);
        },
        flagLink: (flag) => visibleRemediationActions(flag).find((action) => action.intent === "navigate" && action.to)?.to,
        flagActions: (flag, rowLink) => {
          const others = visibleRemediationActions(flag).filter((action) => !(action.intent === "navigate" && action.to === rowLink));
          if (!others.length) return null;
          return (
            <div className="attention-pop__actions">
              {others.map((action) =>
                action.intent === "navigate" && action.to ? (
                  <Link key={action.id} className="btn btn--sm" to={action.to}>{action.label}</Link>
                ) : (
                  <button
                    key={action.id}
                    type="button"
                    className="btn btn--sm"
                    disabled={remediationActionDisabled(flag, action)}
                    onClick={() => runRemediationAction(flag, action)}
                  >
                    {busyRemediationAction === `${flag.ruleId}:${action.id}` ? "Working..." : action.label}
                  </button>
                ),
              )}
            </div>
          );
        },
      })
    : [];
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const expiringAgreements = agreementsSummary?.expiring?.length;
  const disclosures: Partial<Record<DashboardModuleId, DashboardDisclosure>> = {
    meetings: {
      title: "Upcoming meetings",
      summary: upcomingMeetings.length
        ? `${upcomingMeetings.length} upcoming · next ${relative(upcomingMeetings[0].scheduledAt)}`
        : "None scheduled",
    },
    agreements: {
      title: "Agreements expiring",
      summary: expiringAgreements === undefined ? undefined : `${plural(expiringAgreements, "agreement")} ending within 90 days`,
    },
    goals: { title: "Goals", summary: `${counts.openGoals} open` },
    finance: { title: "Finances", summary: "Bank balance and this month's money in and out" },
    organization: { title: entityCopy.organizationTitle, summary: society.incorporationNumber || society.name },
    board: { title: "Board of directors", summary: plural(counts.directors, "active director") },
    activity: { title: "Recent activity", summary: activity === undefined ? undefined : activity.length ? plural(activity.length, "recent change") : "No activity yet" },
    tasks: { title: "Open tasks", summary: `${counts.openTasks} open` },
  };


  return (
    <div className="page dashboard-page">
      <PageHeader
        routeKey="/app"
        title="Dashboard"
        actions={
          <button type="button" className="btn-action" onClick={() => setCustomizeOpen(true)} data-dashboard-customize="">
            <LayoutGrid size={12} /> Customize
          </button>
        }
      />

      {isMobile ? (
        <DashboardPhoneLayout
          modules={visibleModules}
          content={moduleContent}
          disclosures={disclosures}
          attention={
            <NeedsAttentionCard
              items={attentionItems}
              note={visibleModules.includes("compliance") && !completeComplianceAccess
                ? "Some checks need an administrator. This list uses records your role can see."
                : undefined}
            />
          }
        />
      ) : (
        <DashboardModuleGrid modules={visibleModules} content={moduleContent} layout={dashboardLayout.layout} />
      )}

      {visibleModules.length === 0 && (
        <EmptyState
          icon={<LayoutGrid size={20} />}
          title="Every dashboard module is hidden"
          description="Choose the modules you want to see again."
          action={<button type="button" className="btn btn--accent btn--sm" onClick={() => setCustomizeOpen(true)}>Customize dashboard</button>}
        />
      )}

      <CustomizeDashboardDrawer
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        layout={{ ...dashboardLayout.layout, hidden: availableModules.filter((id) => isModuleHidden(id)) }}
        available={availableModules}
        isDefault={dashboardLayout.isDefault && !onboardingFlowHidden}
        onToggle={(id, visible) => (visible ? showModule(id) : hideModule(id))}
        onChange={(next) => dashboardLayout.replace({ ...next, hidden: dashboardLayout.layout.hidden })}
        onReset={() => {
          dashboardLayout.reset();
          if (onboardingFlowHidden) setOnboardingFlowHidden(false);
          toast.info("Dashboard reset to default");
        }}
      />

      <Spotlight
        spotlightKey="sidebar-favorites"
        anchor=".sidebar__item.is-active"
        placement="right"
        title="Pin pages to Favorites"
      >
        {isMobile
          ? "Open More, tap Edit beside Favorites, then tap the pin on any page to add it. The first four favorites fill the bottom bar."
          : "Hover any page in the sidebar and select the pin to keep it in Favorites at the top. Right-click a page for the same option."}
      </Spotlight>
      <Spotlight
        spotlightKey="command-palette"
        anchor="[data-command-palette-trigger]"
        placement="bottom"
        title="Jump anywhere with ⌘K"
      >
        Press ⌘K (Ctrl+K on Windows) or / to search pages, records and actions without leaving the keyboard.
      </Spotlight>
    </div>
  );
}

/**
 * Full-width modules first, then the main (wide) and side (narrow) columns
 * as independent stacks from 980px up, so hiding a module never reshuffles
 * the other column. Narrower, everything is one column: main, then side.
 */
function DashboardModuleGrid({
  modules,
  content,
  layout,
}: {
  modules: DashboardModuleId[];
  content: Partial<Record<DashboardModuleId, ReactNode>>;
  layout: DashboardLayout;
}) {
  const inPlacement = (placement: "full" | "main" | "side") => modules.filter((id) => modulePlacement(layout, id) === placement);
  const render = (id: DashboardModuleId) => (
    <div key={id} className="dashboard-module" data-dashboard-module={id}>
      {content[id]}
    </div>
  );
  const main = inPlacement("main");
  const side = inPlacement("side");
  return (
    <div className="dashboard-grid">
      {inPlacement("full").map(render)}
      {(main.length > 0 || side.length > 0) && (
        <div className={`dashboard-columns${!main.length || !side.length ? " dashboard-columns--single" : ""}`}>
          {main.length > 0 && <div className="dashboard-columns__main">{main.map(render)}</div>}
          {side.length > 0 && <div className="dashboard-columns__side">{side.map(render)}</div>}
        </div>
      )}
    </div>
  );
}

function relativeShort(iso: string) {
  try {
    const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
    return `${formatDistanceToNowStrict(d)} ago`;
  } catch {
    return "";
  }
}

function renderFilingRow(f: any, todayISO: string) {
  // Each row opens that filing (G-24: rows were not clickable).
  return (
    <tr key={f._id}>
      <td><Link to={`/app/filings?filing=${encodeURIComponent(String(f._id))}`}>{kindLabel(f.kind)}</Link></td>
      <td className="table__cell--muted">{f.periodLabel ?? "—"}</td>
      <td className="dashboard-table__date" title={formatDate(f.dueDate, "EEEE, MMMM d, yyyy")}>{formatShortDate(f.dueDate, todayISO)}</td>
      <td>{renderFilingStatus(f)}</td>
    </tr>
  );
}

export function kindLabel(k: string) {
  switch (k) {
    case "AnnualReport":
      return "BC Annual report";
    case "ChangeOfDirectors":
      return "Change of directors";
    case "ChangeOfAddress":
      return "Change of address";
    case "BylawAmendment":
      return "Bylaw amendment";
    case "T2":
      return "CRA T2";
    case "T1044":
      return "CRA T1044 (NPO)";
    case "T3010":
      return "CRA T3010 (charity)";
    case "T4":
      return "T4 / T4A";
    case "GSTHST":
      return "GST/HST return";
    default:
      return ALL_FILING_KIND_LABELS.get(k) ?? k;
  }
}

/** Every jurisdiction's filing kind code -> human label (e.g. BCSocietyAnnualReport). */
const ALL_FILING_KIND_LABELS = new Map(
  JURISDICTION_WORKSPACE_CONFIGS.flatMap((config) => config.module.filingKinds.map((definition) => [definition.kind, definition.label] as const)),
);

export function renderFilingStatus(f: any) {
  if (f.status === "Filed") return <Badge tone="success">Filed</Badge>;
  const overdue = isPastDue(f.dueDate);
  return overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="info">Upcoming</Badge>;
}
