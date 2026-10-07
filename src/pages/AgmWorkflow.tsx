import { minutesQuorumLabel, recordedMinutesQuorum } from "../../shared/minutesQuorum";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../components/Toast";
import { noticeWindowSatisfied } from "../features/meetings/lib/noticeWindow";
import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { Select } from "../components/Select";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Send,
  FileText,
  Users as UsersIcon,
  ClipboardCheck,
  Flag,
  FileDown,
} from "lucide-react";
import { formatDateTime, formatDate } from "../lib/format";
import { useBylawRules } from "../hooks/useBylawRules";
import { useModuleEnabled } from "../hooks/useModules";
import { useConfirm, usePrompt } from "../components/Modal";
import { AGM_STEP_ORDER, type AgmStep as Step } from "../features/meetings/components/MeetingDetailSupport";
import { calendarDaysBetween, daysUntil, pastNoticeDateValue } from "../features/meetings/lib/noticeWindow";
import { formatMeetingDate } from "../../shared/meetingDates";
import { annualReportForAgm, dateOnly as agmDateOnly } from "../../shared/agmEvidence";
import { Undo2 } from "lucide-react";

const STEP_ORDER: { id: Step; label: string; sub: string; icon: any }[] = [
  { id: "notice", label: "Send notice", sub: "14–60 days before meeting (7–60 if bylaws permit)", icon: Send },
  { id: "held", label: "Hold meeting", sub: "Record quorum, attendees, and any electronic participation", icon: UsersIcon },
  { id: "financialsPresented", label: "Present financial statements", sub: "Board-approved FS + auditor's report if applicable", icon: FileText },
  { id: "electionsHeld", label: "Hold elections", sub: "If bylaws require elections at AGM", icon: ClipboardCheck },
  { id: "minutesApproved", label: "Approve minutes", sub: "Usually at next meeting; then circulate to members", icon: Flag },
  { id: "annualReportFiled", label: "File annual report", sub: "Within the configured post-AGM filing window via Societies Online", icon: FileDown },
];

// Keep STEP_ORDER's ids in lockstep with the shared AGM_STEP_ORDER at module
// load time, so this page and the overview AGM checklist can never silently
// diverge on what "done" means for a given step.
if (STEP_ORDER.map((s) => s.id).join(",") !== AGM_STEP_ORDER.join(",")) {
  throw new Error("AgmWorkflow STEP_ORDER has drifted from the shared AGM_STEP_ORDER.");
}

export function AgmWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const { can } = usePermissions();
  const toast = useToast();
  const canSendNotice = !isLocalDataRuntime() && can("communications:write");
  const [sendingNotice, setSendingNotice] = useState(false);
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const run = useQuery(api.agm.runForMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const deliveries = useQuery(api.agm.noticeDeliveries, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const allElections = useQuery(api.elections.list, society ? { societyId: society._id } : "skip");
  const meetingElections = useMemo(
    () => (allElections ?? []).filter((e: any) => String(e.meetingId) === String(id)),
    [allElections, id],
  );
  const init = useMutation(api.agm.init);
  const markStep = useMutation(api.agm.markStep);
  const updateMeeting = useMutation(api.meetings.update);
  const prompt = usePrompt();
  const sendMeetingNotice = useAction(api.communications.sendMeetingNotice);
  const actingUserId = useCurrentUserId() ?? undefined;
  const { rules: activeRules } = useBylawRules();
  // Evaluate the meeting against the bylaw rules in force ON the meeting date,
  // not today's active version: a later rule change never re-grades an AGM
  // that was already held (BC Societies Act s.17 — bylaw changes are prospective).
  const rulesAtMeeting = useQuery(
    api.bylawRules.getForDate,
    society && meeting?.scheduledAt ? { societyId: society._id, dateISO: meeting.scheduledAt } : "skip",
  );
  const rules = rulesAtMeeting ?? activeRules;
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const communicationsEnabled = useModuleEnabled("communications");
  const confirm = useConfirm();

  const [noticeChannel, setNoticeChannel] = useState<"email" | "mail" | "in-person">("email");

  const currentIdx = useMemo(() => {
    if (!run) return -1;
    return AGM_STEP_ORDER.indexOf(run.step as Step);
  }, [run]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (meeting === undefined) return <PageLoading />;
  if (meeting === null) {
    return (
      <div className="page">
        <EmptyState
          icon={<ClipboardCheck size={18} />}
          title="Meeting not found"
          description="This meeting may have been deleted, or the link is out of date."
          action={
            <Link className="btn btn--accent" to="/app/meetings">
              Back to meetings
            </Link>
          }
        />
      </div>
    );
  }
  if (meeting.type !== "AGM")
    return (
      <div className="page">
        <Link to={`/app/meetings/${meeting._id}`} className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
          <ArrowLeft size={12} /> Back to meeting
        </Link>
        <PageHeader
          title="AGM workflow not available"
          icon={<ClipboardCheck size={16} />}
          iconColor="orange"
          subtitle="This workflow only applies to AGM-type meetings."
        />
        <div className="card">
          <div className="card__body">
            <EmptyState
              icon={<ClipboardCheck size={20} />}
              title="Not an AGM meeting"
              description={`"${meeting.title}" is a ${meeting.type} meeting, so it doesn't use the AGM workflow.`}
              action={
                <Link className="btn btn--accent" to={`/app/meetings/${meeting._id}`}>
                  <ArrowLeft size={14} /> Back to meeting
                </Link>
              }
            />
          </div>
        </div>
      </div>
    );

  const ensureInit = async () => {
    if (!run) await init({ societyId: society._id, meetingId: meeting._id });
  };

  const advance = async (step: Step, patch?: Record<string, any>) => {
    await ensureInit();
    const currentId = run?._id;
    if (!currentId) {
      const id2 = await init({ societyId: society._id, meetingId: meeting._id });
      await markStep({ id: id2, step, patch: patch as any });
    } else {
      await markStep({ id: currentId, step, patch: patch as any });
    }
  };
  const advanceWithReview = async (step: Step, patch: Record<string, any>, message: string) => {
    const ok = await confirm({
      title: "Complete AGM step?",
      message,
      confirmLabel: "Complete step",
      tone: "warn",
    });
    if (!ok) return;
    await advance(step, patch);
  };

  const daysToMeeting = daysUntil(meeting.scheduledAt) ?? 0;
  // A held AGM is being documented, not run: notice is recorded with its real
  // date (or as not recorded), never "sent" today.
  const meetingHeld = daysToMeeting < 0 || meeting.status === "Held";
  const recordedNoticeAt: string | undefined = meeting.noticeSentAt ?? run?.noticeSentAt ?? undefined;
  const recordPastNotice = async () => {
    const typed = await prompt({
      title: "When was notice of this AGM sent?",
      message: "Enter the date from your records (YYYY-MM-DD). If no record of the notice survives, cancel and choose “No notice record”.",
      placeholder: "YYYY-MM-DD",
      confirmLabel: "Record notice date",
      required: true,
    });
    if (typed == null) return;
    const parsed = pastNoticeDateValue(typed, agmDateOnly(meeting.scheduledAt) ?? String(meeting.scheduledAt).slice(0, 10));
    if (!parsed.iso) {
      toast.error("Notice date not recorded", parsed.error);
      return;
    }
    if (can("meetings:write")) await updateMeeting({ id: meeting._id, patch: { noticeSentAt: parsed.iso } });
    await advance("notice", { noticeSentAt: parsed.iso, noticeRecipientCount: 0 });
  };
  const noticeDaysBeforeMeeting = calendarDaysBetween(
    meeting.scheduledAt,
    recordedNoticeAt ?? new Date(),
  ) ?? 0;
  const noticeMinDays = rules?.generalNoticeMinDays ?? 14;
  const noticeMaxDays = rules?.generalNoticeMaxDays ?? 60;
  const noticeWithinWindow = noticeWindowSatisfied(recordedNoticeAt ?? (meetingHeld ? meeting.scheduledAt : new Date()), meeting.scheduledAt, noticeMinDays, noticeMaxDays, rules) && !(meetingHeld && !recordedNoticeAt);
  const meetingDate = agmDateOnly(meeting.scheduledAt);
  const annualReport = meetingDate ? annualReportForAgm(filings ?? [], meetingDate, { dueDays: rules?.annualReportDueDaysAfterMeeting ?? 30 }) : null;
  const votingMemberCount = (members ?? []).filter((member: any) => member.status === "Active" && member.votingRights).length;
  const deliveredCount = (deliveries ?? []).filter((delivery: any) => delivery.status !== "bounced" && delivery.status !== "failed").length;
  const recordedRecipientCount = Number(run?.noticeRecipientCount ?? 0);
  const noticeCoverage = Math.max(deliveredCount, recordedRecipientCount);
  const undoLastStep = async () => {
    if (!run || currentIdx < 0) return;
    const step = STEP_ORDER[currentIdx];
    const ok = await confirm({
      title: `Undo "${step?.label ?? run.step}"?`,
      message: "The workflow step is reopened. Records already saved elsewhere (notice deliveries, minutes, filings) are not changed.",
      confirmLabel: "Undo step",
      tone: "warn",
    });
    if (!ok) return;
    await markStep({ id: run._id, step: currentIdx > 0 ? AGM_STEP_ORDER[currentIdx - 1] : "pending" });
    toast.info("Step reopened", step?.label);
  };

  return (
    <div className="page">
      <Link to={`/app/meetings/${meeting._id}`} className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Back to meeting
      </Link>
      <PageHeader
        title={`AGM workflow · ${meeting.title}`}
        icon={<ClipboardCheck size={16} />}
        iconColor="orange"
        subtitle={`${formatMeetingDate(meeting)} · ${daysToMeeting >= 0 ? `in ${daysToMeeting} days` : `${-daysToMeeting} days ago`}`}
      />

      {isLocalDataRuntime() && !meetingHeld && <p className="muted" role="status">Sending meeting notices requires a connected server. Prepare the notice and retain evidence of any delivery made outside the app.</p>}

      <div className="card">
        <div className="card__head"><h2 className="card__title">Compliance posture</h2></div>
        <div className="card__body col" style={{ gap: 8 }}>
          <Item label="Notice window"
            value={
              meetingHeld && !recordedNoticeAt
                ? "Notice date not recorded"
                : rules?.governanceAutomationBlocked
                  ? `${recordedNoticeAt ? `Sent ${noticeDaysBeforeMeeting} days before · ` : ""}not checked: the notice rules wait on a bylaw review`
                  : noticeWithinWindow
                  ? `Within ${noticeMinDays}–${noticeMaxDays} day range${recordedNoticeAt ? ` · sent ${noticeDaysBeforeMeeting} days before` : ""}`
                  : `Outside the ${noticeMinDays}–${noticeMaxDays} day range`
            }
            tone={noticeWithinWindow ? "success" : "warn"}
          />
          <Item label="Notice coverage"
            value={[
              `${deliveredCount} delivery record${deliveredCount === 1 ? "" : "s"} logged`,
              votingMemberCount ? `${votingMemberCount} voting member${votingMemberCount === 1 ? "" : "s"}` : "no voting member register",
              recordedRecipientCount ? `workflow records ${recordedRecipientCount} recipient${recordedRecipientCount === 1 ? "" : "s"}` : "",
            ].filter(Boolean).join(" · ")}
            tone={votingMemberCount > 0 && noticeCoverage >= votingMemberCount ? (deliveredCount >= votingMemberCount ? "success" : "info") : "warn"}
          />
          <Item label="Annual report"
            value={
              annualReport?.filed
                ? annualReport.late
                  ? `Filed ${formatDate(String(annualReport.filing.filedAt))} · ${annualReport.daysLate} days late (due ${formatDate(annualReport.dueDate)})`
                  : `Filed ${formatDate(String(annualReport.filing.filedAt))}`
                : annualReport
                  ? `Tracked · due ${formatDate(annualReport.dueDate)}`
                  : meetingDate
                    ? `Not filed · due ${formatDate(agmDueDate(meetingDate, rules?.annualReportDueDaysAfterMeeting ?? 30))}`
                    : "Not filed"
            }
            tone={annualReport?.filed ? (annualReport.late ? "warn" : "success") : "warn"}
          />
          {rulesAtMeeting && !rulesAtMeeting.isFallback && rulesAtMeeting.version != null && (
            <Item label="Bylaw rules applied"
              value={`v${rulesAtMeeting.version} (in force on ${formatDate(meeting.scheduledAt)})`}
              tone="info"
            />
          )}
          <Item label="Meeting electronic"
            value={meeting.electronic ? "Yes — notice must explain how to participate" : "No"}
            tone={meeting.electronic ? "info" : "neutral"}
          />
          <Item label="Quorum"
            value={minutes ? minutesQuorumLabel(minutes) : "Not yet recorded"}
            tone={recordedMinutesQuorum(minutes ?? {}) === true ? "success" : recordedMinutesQuorum(minutes ?? {}) === false ? "danger" : "warn"}
          />
        </div>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Steps</h2></div>
        <div className="card__body" style={{ padding: 0 }}>
          {STEP_ORDER.map((s, i) => {
            const doneFromRun = i <= currentIdx && run != null;
            const doneFromRecord =
              (s.id === "notice" && Boolean(meeting.noticeSentAt)) ||
              (s.id === "held" && meeting.status === "Held") ||
              (s.id === "financialsPresented" && minutes?.agmDetails?.financialStatementsPresented === true) ||
              (s.id === "electionsHeld" && meetingElections.some((e: any) => ["Closed", "Tallied"].includes(e.status))) ||
              (s.id === "minutesApproved" && Boolean(minutes?.approvedAt)) ||
              (s.id === "annualReportFiled" && Boolean(annualReport?.filed));
            const done = doneFromRun || doneFromRecord;
            const active = !done && ((!run && i === 0) || (run != null && i === currentIdx + 1));
            const Icon = s.icon;
            return (
              <div key={s.id} style={{
                display: "flex", gap: 12, padding: "14px 16px",
                borderBottom: i < STEP_ORDER.length - 1 ? "1px solid var(--border)" : "none",
                background: active ? "var(--accent-soft)" : undefined,
              }}>
                <div style={{ marginTop: 2 }}>
                  {done
                    ? <CheckCircle2 size={18} style={{ color: "var(--success)" }} />
                    : <Circle size={18} style={{ color: "var(--text-tertiary)" }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Icon size={14} style={{ color: "var(--text-secondary)" }} />
                    <strong>{s.label}</strong>
                    {active && <Badge tone="accent">Up next</Badge>}
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>{s.sub}</div>
                  <div className="row agm-workflow__step-actions" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {done && <Badge tone="success">Completed</Badge>}
                    {done && doneFromRun && i === currentIdx && !doneFromRecord && (
                      <button className="btn-action" onClick={undoLastStep}>
                        <Undo2 size={12} /> Undo
                      </button>
                    )}
                    {!done && s.id === "notice" && meetingHeld && (
                      <>
                        <button className="btn-action btn-action--primary" onClick={() => { void recordPastNotice(); }}>
                          <CheckCircle2 size={12} /> Record notice date…
                        </button>
                        <button
                          className="btn-action"
                          onClick={() => advanceWithReview("notice", { noticeRecipientCount: 0 }, "Close this step without a notice date: no record of the notice for this past AGM survives. The compliance posture keeps showing the notice date as not recorded.")}
                        >
                          No notice record
                        </button>
                      </>
                    )}
                    {!done && s.id === "notice" && !meetingHeld && (
                      <>
                        {communicationsEnabled ? (
                          <>
                            <Select
                              style={{ height: 24, fontSize: 12 }}
                              value={noticeChannel}
                              onChange={(value) => setNoticeChannel(value as any)}
                              options={[
                                { value: "email", label: "Email" },
                                { value: "mail", label: "Postal mail" },
                                { value: "in-person", label: "In person" },
                              ]}
                            />
                            <button className="btn-action btn-action--primary" disabled={!canSendNotice || sendingNotice} onClick={async () => {
                              if (!canSendNotice || sendingNotice) return;
                              const ok = await confirm({
                                title: "Send AGM notice?",
                                message: `This will send AGM notice by ${noticeChannel}. Confirm the notice window, participation details, agenda, and member recipient list are correct.`,
                                confirmLabel: "Send notice",
                                tone: "warn",
                              });
                              if (!ok) return;
                              setSendingNotice(true);
                              try {
                              const res = await sendMeetingNotice({
                                societyId: society._id,
                                meetingId: meeting._id,
                                channel: noticeChannel,
                              });
                              await advance("notice", { noticeSentAt: new Date().toISOString(), noticeRecipientCount: res.deliveredCount });
                              } catch (error) { toast.error("Notice could not be sent", error instanceof Error ? error.message : "Please try again."); }
                              finally { setSendingNotice(false); }
                            }}>
                              <Send size={12} /> Send notice to all voting members
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn-action"
                            onClick={() =>
                              advanceWithReview("notice", {
                                noticeSentAt: new Date().toISOString(),
                                noticeRecipientCount: 0,
                              }, "Record this only after the AGM notice, recipient list, delivery method, and any non-email evidence are saved outside Societyer.")
                            }
                          >
                            <CheckCircle2 size={12} /> Mark notice handled outside Societyer
                          </button>
                        )}
                      </>
                    )}
                    {!done && s.id === "held" && (
                      <button className="btn-action" onClick={() => advanceWithReview("held", { quorumCheckedAtISO: new Date().toISOString() }, "Confirm attendance, quorum, chair, voting rights, and electronic participation details have been recorded in the minutes.")}>
                        <CheckCircle2 size={12} /> Mark meeting held
                      </button>
                    )}
                    {!done && s.id === "financialsPresented" && (
                      <button className="btn-action" onClick={() => advanceWithReview("financialsPresented", { financialsPresentedAt: new Date().toISOString() }, "Confirm the financial statements and any auditor or reviewer report were presented and are attached or referenced in the AGM record.")}>
                        <FileText size={12} /> Mark financials presented
                      </button>
                    )}
                    {!done && s.id === "electionsHeld" && (
                      <div className="col" style={{ gap: 8, width: "100%" }}>
                        {meetingElections.length > 0 && (
                          <div className="col" style={{ gap: 4 }}>
                            {meetingElections.map((e: any) => (
                              <div key={e._id} className="row" style={{ gap: 8 }}>
                                <Link to={`/app/elections/${e._id}`}>{e.title}</Link>
                                <Badge tone={e.status === "Tallied" ? "success" : e.status === "Closed" ? "info" : "warn"}>{e.status}</Badge>
                                {e.talliedAtISO && <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>tallied {formatDate(e.talliedAtISO)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="row" style={{ gap: 6 }}>
                          <Link to="/app/elections" className="btn-action">
                            <ClipboardCheck size={12} /> {meetingElections.length ? "Manage elections" : "Set up election"}
                          </Link>
                          <button className="btn-action" onClick={() => advanceWithReview("electionsHeld", { electionsCompletedAt: new Date().toISOString() }, "Confirm election results, acclamations, vacancies, and director eligibility evidence are captured before completing this step.")}>
                            <CheckCircle2 size={12} /> Mark elections complete
                          </button>
                        </div>
                      </div>
                    )}
                    {!done && s.id === "minutesApproved" && (
                      <>
                        <Link to={`/app/meetings/${meeting._id}/preview`} className="btn-action">
                          <FileText size={12} /> {minutes?.approvedAt ? "View approved minutes" : "Open minutes"}
                        </Link>
                        <button className="btn-action" onClick={() => advanceWithReview("minutesApproved", { minutesApprovedAt: new Date().toISOString() }, "Confirm the approved AGM minutes are saved with approval evidence or the approving meeting reference.")}>
                          <Flag size={12} /> Mark minutes approved
                        </button>
                      </>
                    )}
                    {!done && s.id === "annualReportFiled" && (
                      <>
                        <Link to="/app/filings" className="btn-action">Go to filings</Link>
                        <button className="btn-action btn-action--primary" onClick={() => advanceWithReview("annualReportFiled", { annualReportFiledAt: new Date().toISOString() }, `Only complete this after the annual report filing record has the filed date, confirmation number or evidence, and the ${rules?.annualReportDueDaysAfterMeeting ?? 30}-day post-AGM deadline has been checked.`)}>
                          <Flag size={12} /> Mark annual report filed ({rules?.annualReportDueDaysAfterMeeting ?? 30} day rule)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="spacer-6" />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Notice delivery log</h2>
          <span className="card__subtitle">{deliveries?.length ?? 0} delivery record(s)</span>
        </div>
        <table className="table">
          <thead><tr><th>Recipient</th><th>Channel</th><th>Sent</th><th>Status</th></tr></thead>
          <tbody>
            {(deliveries ?? []).map((d: any) => (
              <tr key={d._id}>
                <td>{d.recipientName}{d.recipientEmail && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{d.recipientEmail}</div>}</td>
                <td><Badge>{d.channel}</Badge></td>
                <td className="mono">{formatDate(d.sentAtISO)}</td>
                <td><Badge tone={d.status === "sent" ? "success" : d.status === "bounced" ? "danger" : "warn"}>{d.status}</Badge></td>
              </tr>
            ))}
            {(deliveries ?? []).length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>
                {communicationsEnabled
                  ? "No deliveries logged yet."
                  : "Communications module is disabled, so notice delivery is being tracked outside Societyer."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Item({ label, value, tone }: { label: string; value: string; tone: "success" | "warn" | "danger" | "info" | "neutral" }) {
  return (
    <div className="row agm-workflow__posture-item" style={{ flexWrap: "wrap", gap: 6 }}>
      <span className="muted" style={{ minWidth: 160 }}>{label}</span>
      <Badge tone={tone as any}>{value}</Badge>
    </div>
  );
}

function agmDueDate(meetingDate: string, days: number): string {
  const parsed = new Date(`${meetingDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
