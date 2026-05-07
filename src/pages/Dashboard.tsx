import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Flag } from "../components/ui";
import { formatDate, formatDateTime, relative } from "../lib/format";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  LayoutDashboard,
  Link2,
  ShieldCheck,
  UploadCloud,
  UserRoundCheck,
  Users,
  UserCog,
  X,
} from "lucide-react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";

const HIDDEN_ONBOARDING_FLOW_KEY = "societyer.dashboard.hiddenOnboardingFlowSocietyIds";

function readHiddenOnboardingFlowSocietyIds(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_ONBOARDING_FLOW_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeHiddenOnboardingFlowSocietyIds(ids: string[]) {
  window.localStorage.setItem(HIDDEN_ONBOARDING_FLOW_KEY, JSON.stringify(ids));
}

export function Dashboard() {
  const society = useSociety();
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery(api.dashboard.summary, society ? { societyId: society._id } : "skip");
  const activity = useQuery(api.activity.list, society ? { societyId: society._id, limit: 10 } : "skip");
  const createPipaPolicyDraft = useMutation(api.documents.createPipaPolicyDraft);
  const createMemberDataGapMemoDraft = useMutation(api.documents.createMemberDataGapMemoDraft);
  const createPrivacyReviewTask = useMutation(api.dashboardRemediation.createPrivacyReviewTask);
  const createComplianceReviewTask = useMutation(api.dashboardRemediation.createComplianceReviewTask);
  const markPrivacyProgramReviewed = useMutation(api.dashboardRemediation.markPrivacyProgramReviewed);
  const markMemberDataAccessReviewed = useMutation(api.dashboardRemediation.markMemberDataAccessReviewed);
  const [showComplianceDetails, setShowComplianceDetails] = useState(false);
  const [busyRemediationAction, setBusyRemediationAction] = useState<string | null>(null);
  const [hiddenOnboardingFlowSocietyIds, setHiddenOnboardingFlowSocietyIds] = useState(readHiddenOnboardingFlowSocietyIds);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!data) return <div className="page">Loading…</div>;

  const { counts, upcomingMeetings, upcomingFilings, overdueFilings, goals, complianceFlags, openTasks, evidenceChains } = data;
  const onboardingSteps = getOnboardingSteps({ society, counts, upcomingMeetings, upcomingFilings, overdueFilings });
  const completedOnboardingSteps = onboardingSteps.filter((step) => step.complete).length;
  const nextOnboardingStep = onboardingSteps.find((step) => !step.complete) ?? onboardingSteps[onboardingSteps.length - 1];
  const onboardingProgress = Math.round((completedOnboardingSteps / onboardingSteps.length) * 100);
  const onboardingFlowHidden = hiddenOnboardingFlowSocietyIds.includes(society._id);

  const setOnboardingFlowHidden = (hidden: boolean) => {
    const nextIds = hidden
      ? Array.from(new Set([...hiddenOnboardingFlowSocietyIds, society._id]))
      : hiddenOnboardingFlowSocietyIds.filter((id) => id !== society._id);

    setHiddenOnboardingFlowSocietyIds(nextIds);
    writeHiddenOnboardingFlowSocietyIds(nextIds);
  };

  const hideOnboardingFlow = () => {
    setOnboardingFlowHidden(true);
    toast.info("Setup guide hidden", {
      action: {
        label: "Undo",
        onClick: () => setOnboardingFlowHidden(false),
      },
    });
  };

  const runRemediationAction = async (flag: any, action: any) => {
    if (action.intent === "navigate") {
      navigate(action.to);
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
        toast.success(result?.reused ? "Opened existing PIPA policy draft" : "PIPA policy draft created");
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
        toast.success(result?.reused ? "Existing PIPA review task reused" : "PIPA review task assigned");
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

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        icon={<LayoutDashboard size={16} />}
        iconColor="blue"
        subtitle="Compliance posture, upcoming obligations, and governance snapshot."
      />

      {!onboardingFlowHidden && (
        <section className="onboarding-flow" aria-labelledby="onboarding-flow-title">
          <div className="onboarding-flow__story">
            <div>
              <h2 id="onboarding-flow-title">Keep your BC society in good standing.</h2>
              <p>
                Societyer tells you what is due, gathers the evidence, prepares the records,
                and keeps an audit trail.
              </p>
            </div>
            <div className="onboarding-flow__actions">
              <div className="onboarding-flow__status">
                <span className="mono">{completedOnboardingSteps}/{onboardingSteps.length}</span>
                <span>setup checks complete</span>
              </div>
              <button
                type="button"
                className="onboarding-flow__dismiss"
                onClick={hideOnboardingFlow}
                title="Hide setup guide"
                aria-label="Hide setup guide"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="onboarding-flow__bar" aria-hidden="true">
            <span style={{ width: `${onboardingProgress}%` }} />
          </div>

          <div className="onboarding-flow__next">
            <div>
              <span className="onboarding-flow__eyebrow">Next action</span>
              <strong>{nextOnboardingStep.title}</strong>
              <span>{nextOnboardingStep.description}</span>
            </div>
            <Link to={nextOnboardingStep.to} className="btn-action btn-action--primary">
              Open <ArrowRight size={12} />
            </Link>
          </div>

          <div className="onboarding-flow__grid">
            {onboardingSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <Link
                  key={step.id}
                  to={step.to}
                  className={`onboarding-step${step.complete ? " is-complete" : ""}${step.id === nextOnboardingStep.id ? " is-next" : ""}`}
                >
                  <span className="onboarding-step__index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="onboarding-step__icon"><Icon size={16} /></span>
                  <span className="onboarding-step__main">
                    <strong>{step.title}</strong>
                    <span>{step.description}</span>
                  </span>
                  <span className="onboarding-step__state">
                    {step.complete ? <CheckCircle2 size={16} /> : <ArrowRight size={14} />}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="stat-grid">
        <Stat
          label="Active members"
          value={counts.members}
          icon={<Users size={14} />}
          sub="with voting rights counted separately in members list"
        />
        <Stat
          label="Active directors"
          value={counts.directors}
          icon={<UserCog size={14} />}
          sub={
            society.isMemberFunded
              ? `${counts.bcResidents} BC resident${counts.bcResidents === 1 ? "" : "s"} (s.197 exception)`
              : `${counts.bcResidents} BC resident${counts.bcResidents === 1 ? "" : "s"} (s.40 requires >= 1)`
          }
        />
        <Stat
          label="Meetings this year"
          value={counts.meetingsThisYear}
          icon={<Calendar size={14} />}
        />
        <Stat
          label="Overdue filings"
          value={counts.overdueFilings}
          tone={counts.overdueFilings ? "danger" : "ok"}
          icon={<AlertTriangle size={14} />}
        />
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Compliance posture</h2>
              <span className="card__subtitle">Automated checks against the Societies Act</span>
            </div>
            <div className="card__body dashboard-compliance">
              <div className="dashboard-compliance__summary">
                <div>
                  <div className="dashboard-compliance__count">
                    {complianceFlags.length} item{complianceFlags.length === 1 ? "" : "s"} to resolve
                  </div>
                  <div className="muted">
                    Start with the operational gaps below. Citations and full detail are available when needed.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-action"
                  onClick={() => setShowComplianceDetails((value) => !value)}
                  aria-expanded={showComplianceDetails}
                >
                  {showComplianceDetails ? "Hide details" : "View details"}
                </button>
              </div>

              <ul className="dashboard-compliance__todo">
                {complianceFlags.slice(0, showComplianceDetails ? complianceFlags.length : 3).map((f: any, i: number) => (
                  <li key={i}>{f.text}</li>
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
                      {f.text}
                    </Flag>
                    <div className="dashboard-remediation__meta">
                      {f.evidenceRequired?.length > 0 && (
                        <span>Evidence: {f.evidenceRequired.join(", ")}</span>
                      )}
                      {f.remediationStatus && (
                        <Badge tone={f.remediationStatus === "resolved" ? "success" : "info"}>
                          {f.remediationStatus === "open" ? "Workflow open" : f.remediationStatus}
                        </Badge>
                      )}
                    </div>
                    {f.remediationActions?.length > 0 && (
                      <div className="dashboard-remediation__actions">
                        {f.remediationActions.map((action: any) => {
                          const disabled = busyRemediationAction === `${f.ruleId}:${action.id}`;
                          return action.intent === "navigate" ? (
                            <Link key={action.id} className="btn btn--ghost btn--sm" to={action.to}>
                              {action.label}
                            </Link>
                          ) : (
                            <button
                              key={action.id}
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={disabled}
                              onClick={() => runRemediationAction(f, action)}
                            >
                              {disabled ? "Working..." : action.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Why this is green</h2>
              <span className="card__subtitle">Proof chains for completed compliance work</span>
            </div>
            <div className="card__body evidence-chains">
              {(evidenceChains ?? []).map((chain: any) => (
                <article className="evidence-chain" key={chain.id}>
                  <div className="evidence-chain__head">
                    <span className={`evidence-chain__status evidence-chain__status--${chain.status}`}>
                      {chain.status === "verified" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    </span>
                    <div>
                      <h3>{chain.title}</h3>
                      <p>{chain.summary}</p>
                    </div>
                    {chain.actionHref && (
                      <Link to={chain.actionHref} className="btn-action">
                        Open <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                  <ol className="evidence-chain__nodes">
                    {chain.nodes.map((node: any, index: number) => (
                      <li className={`evidence-chain__node evidence-chain__node--${node.status}`} key={`${chain.id}-${node.label}-${index}`}>
                        <span className="evidence-chain__dot"><Link2 size={12} /></span>
                        <div>
                          <span>{node.label}</span>
                          {node.href ? <Link to={node.href}>{node.value}</Link> : <strong>{node.value}</strong>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
              {(!evidenceChains || evidenceChains.length === 0) && (
                <div className="muted">
                  No completed filing proof chains yet. Mark a filing as filed with a filed date, confirmation/evidence document, responsible person, and audit entry to light this up.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Filings requiring attention</h2>
              <Link to="/app/filings" className="card__subtitle row" style={{ marginLeft: "auto" }}>
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <table className="table">
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
                  <tr>
                    <td colSpan={4} className="table__cell--muted" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 700 }}>
                      Overdue · {counts.overdueFilings}
                    </td>
                  </tr>
                )}
                {overdueFilings.slice(0, 4).map((f: any) => renderFilingRow(f))}
                {upcomingFilings.length > 0 && (
                  <tr>
                    <td colSpan={4} className="table__cell--muted" style={{ background: "var(--bg-subtle)", fontWeight: 700 }}>
                      Upcoming · {upcomingFilings.length}
                    </td>
                  </tr>
                )}
                {upcomingFilings.slice(0, overdueFilings.length > 0 ? 4 : 6).map((f: any) => renderFilingRow(f))}
                {counts.overdueFilings + upcomingFilings.length === 0 && (
                  <tr>
                    <td colSpan={4} className="table__cell--muted" style={{ textAlign: "center", padding: 24 }}>
                      No overdue or upcoming filings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
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
                    <Badge tone={m.type === "AGM" ? "accent" : "info"}>{m.type}</Badge>
                    <strong>{m.title}</strong>
                  </div>
                  <div className="muted">{formatDateTime(m.scheduledAt)} · {relative(m.scheduledAt)}</div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{m.location}</div>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Society</h2>
            </div>
            <div className="card__body col">
              <div><strong>{society.name}</strong></div>
              <div className="muted mono">{society.incorporationNumber}</div>
              <div className="muted">Fiscal year end: {society.fiscalYearEnd ?? "—"}</div>
              <div className="muted">{society.registeredOfficeAddress}</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {society.isCharity && <Badge tone="accent">CRA charity</Badge>}
                {society.isMemberFunded && <Badge tone="info">Member-funded</Badge>}
                {society.boardCadence && <Badge>Board meets {society.boardCadence.toLowerCase()}</Badge>}
              </div>
            </div>
          </div>

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
        </div>
      </div>

      <div className="spacer-6" />

      <div className="two-col">
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
                  <Badge tone={g.status === "OnTrack" ? "success" : g.status === "AtRisk" ? "warn" : g.status === "OffTrack" ? "danger" : "neutral"}>
                    {g.status}
                  </Badge>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="progress" style={{ flex: 1 }}>
                    <div className="progress__fill" style={{ width: `${g.progressPercent}%`, background: g.status === "AtRisk" || g.status === "OffTrack" ? "var(--warn)" : undefined }} />
                  </div>
                  <span className="mono" style={{ minWidth: 40, textAlign: "right" }}>{g.progressPercent}%</span>
                </div>
              </Link>
            ))}
            {goals.length === 0 && <div className="muted">No goals yet.</div>}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Open tasks</h2>
            <Link to="/app/tasks" className="card__subtitle row" style={{ marginLeft: "auto" }}>
              All tasks <ArrowRight size={12} />
            </Link>
          </div>
          <table className="table">
            <tbody>
              {openTasks.map((t: any) => (
                <tr key={t._id}>
                  <td style={{ width: 12 }}><span className={`priority-dot priority-${t.priority}`} /></td>
                  <td>{t.title}</td>
                  <td className="muted">{t.assignee ?? "—"}</td>
                  <td className="table__cell--mono muted">{t.dueDate ? formatDate(t.dueDate) : ""}</td>
                </tr>
              ))}
              {openTasks.length === 0 && (
                <tr><td className="muted" style={{ textAlign: "center", padding: 24 }}>Nothing open.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function getOnboardingSteps({
  society,
  counts,
  upcomingMeetings,
  upcomingFilings,
  overdueFilings,
}: {
  society: any;
  counts: any;
  upcomingMeetings: any[];
  upcomingFilings: any[];
  overdueFilings: any[];
}) {
  const hasSocietyProfile = Boolean(
    society?.name && society?.incorporationNumber && society?.registeredOfficeAddress,
  );
  const hasPeople = counts.members > 0 && counts.directors > 0;
  const hasCoreDocuments = Boolean(society?.constitutionDocId && society?.bylawsDocId);
  const hasAgmTiming = Boolean(
    society?.fiscalYearEnd && upcomingMeetings.some((meeting) => meeting.type === "AGM"),
  );
  const hasComplianceCalendar = upcomingFilings.length > 0 || overdueFilings.length > 0 || counts.openDeadlines > 0;
  const hasMeetings = counts.meetingsThisYear > 0;
  const hasFilingsEvidence = upcomingFilings.length > 0 || overdueFilings.length > 0;
  const hasPrivacyRecords = Boolean(society?.privacyPolicyDocId || society?.privacyProgramStatus === "Ready");

  return [
    {
      id: "profile",
      title: "Set up society profile",
      description: hasSocietyProfile ? "Legal identity and registered office are recorded." : "Add the legal name, incorporation number, and registered office.",
      to: "/app/society",
      complete: hasSocietyProfile,
      icon: Building2,
    },
    {
      id: "people",
      title: "Import members/directors",
      description: hasPeople ? "Member and director registers have active records." : "Bring in current member and director registers.",
      to: "/app/imports",
      complete: hasPeople,
      icon: UserRoundCheck,
    },
    {
      id: "documents",
      title: "Upload constitution/bylaws",
      description: hasCoreDocuments ? "Core governing documents are attached." : "Attach the filed constitution and current bylaws.",
      to: "/app/documents",
      complete: hasCoreDocuments,
      icon: UploadCloud,
    },
    {
      id: "timing",
      title: "Confirm fiscal year and AGM timing",
      description: hasAgmTiming ? "Fiscal year and the next AGM are visible." : "Set the fiscal year end and schedule the next AGM.",
      to: "/app/meetings",
      complete: hasAgmTiming,
      icon: CalendarClock,
    },
    {
      id: "calendar",
      title: "Create annual compliance calendar",
      description: hasComplianceCalendar ? "Filing and deadline dates are being tracked." : "Create deadline and filing reminders for the year.",
      to: "/app/deadlines",
      complete: hasComplianceCalendar,
      icon: Calendar,
    },
    {
      id: "meetings",
      title: "Run meetings and minutes",
      description: hasMeetings ? "This year's meeting record is underway." : "Schedule meetings and capture minutes, motions, and decisions.",
      to: "/app/meetings",
      complete: hasMeetings,
      icon: ClipboardCheck,
    },
    {
      id: "filings",
      title: "Track filings and evidence",
      description: hasFilingsEvidence ? "Filing work is visible on the dashboard." : "Track annual reports, changes, confirmations, and evidence.",
      to: "/app/filings",
      complete: hasFilingsEvidence,
      icon: FileCheck2,
    },
    {
      id: "records",
      title: "Keep privacy/records inspection-ready",
      description: hasPrivacyRecords ? "Privacy or inspection readiness is documented." : "Record privacy controls, retention, and inspection readiness.",
      to: "/app/privacy",
      complete: hasPrivacyRecords,
      icon: ShieldCheck,
    },
  ];
}

function relativeShort(iso: string) {
  try {
    const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
    return `${formatDistanceToNowStrict(d)} ago`;
  } catch {
    return "";
  }
}

function Stat({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "danger" | "ok";
  icon?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  // The description (`sub`) is hidden on mobile by CSS and revealed when the
  // user taps the cell. Desktop users see it inline as before — the handler
  // still toggles `.is-expanded` but has no visual effect above 760px.
  const expandable = Boolean(sub);
  const handleToggle = expandable ? () => setExpanded((v) => !v) : undefined;
  return (
    <div
      className={`stat${expandable ? " stat--expandable" : ""}${expanded ? " is-expanded" : ""}`}
      onClick={handleToggle}
      onKeyDown={expandable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); }
      } : undefined}
      role={expandable ? "button" : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
    >
      <div className="stat__label">
        {icon} {label}
      </div>
      <div
        className="stat__value"
        style={{ color: tone === "danger" ? "var(--danger)" : undefined }}
      >
        {value}
      </div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function renderFilingRow(f: any) {
  return (
    <tr key={f._id}>
      <td>{kindLabel(f.kind)}</td>
      <td className="table__cell--muted">{f.periodLabel ?? "—"}</td>
      <td className="table__cell--mono">{formatDate(f.dueDate)}</td>
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
      return k;
  }
}

export function renderFilingStatus(f: any) {
  if (f.status === "Filed") return <Badge tone="success">Filed</Badge>;
  const overdue = new Date(f.dueDate).getTime() < Date.now();
  return overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="info">Upcoming</Badge>;
}
