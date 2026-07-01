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
import { useConfirm } from "../components/Modal";
import { AGM_STEP_ORDER, type AgmStep as Step } from "../features/meetings/components/MeetingDetailSupport";

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
  const sendMeetingNotice = useAction(api.communications.sendMeetingNotice);
  const actingUserId = useCurrentUserId() ?? undefined;
  const { rules } = useBylawRules();
  const communicationsEnabled = useModuleEnabled("communications");
  const confirm = useConfirm();

  const [noticeChannel, setNoticeChannel] = useState<"email" | "mail" | "in-person">("email");

  const currentIdx = useMemo(() => {
    if (!run) return 0;
    const idx = AGM_STEP_ORDER.indexOf(run.step as Step);
    return idx < 0 ? 0 : idx;
  }, [run]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!meeting) return <PageLoading />;
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

  const daysToMeeting = Math.floor(
    (new Date(meeting.scheduledAt).getTime() - Date.now()) / 86_400_000,
  );

  return (
    <div className="page">
      <Link to={`/app/meetings/${meeting._id}`} className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Back to meeting
      </Link>
      <PageHeader
        title={`AGM workflow · ${meeting.title}`}
        icon={<ClipboardCheck size={16} />}
        iconColor="orange"
        subtitle={`${formatDateTime(meeting.scheduledAt)} · ${daysToMeeting >= 0 ? `in ${daysToMeeting} days` : `${-daysToMeeting} days ago`}`}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Compliance posture</h2></div>
        <div className="card__body col" style={{ gap: 8 }}>
          <Item label="Notice window"
            value={
              daysToMeeting >= (rules?.generalNoticeMinDays ?? 14) &&
              daysToMeeting <= (rules?.generalNoticeMaxDays ?? 60)
                ? `Within ${rules?.generalNoticeMinDays ?? 14}–${rules?.generalNoticeMaxDays ?? 60} day range`
                : `Outside the ${rules?.generalNoticeMinDays ?? 14}–${rules?.generalNoticeMaxDays ?? 60} day range`
            }
            tone={
              daysToMeeting >= (rules?.generalNoticeMinDays ?? 14) &&
              daysToMeeting <= (rules?.generalNoticeMaxDays ?? 60)
                ? "success"
                : "warn"
            }
          />
          <Item label="Meeting electronic"
            value={meeting.electronic ? "Yes — notice must explain how to participate" : "No"}
            tone={meeting.electronic ? "info" : "neutral"}
          />
          <Item label="Quorum"
            value={minutes ? (minutes.quorumMet ? "Met" : "Not met") : "Not yet recorded"}
            tone={minutes ? (minutes.quorumMet ? "success" : "danger") : "warn"}
          />
        </div>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Steps</h2></div>
        <div className="card__body" style={{ padding: 0 }}>
          {STEP_ORDER.map((s, i) => {
            const done = i <= currentIdx && run != null;
            const active = run && s.id === (run.step as Step);
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
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Icon size={14} style={{ color: "var(--text-secondary)" }} />
                    <strong>{s.label}</strong>
                    {active && <Badge tone="accent">Up next</Badge>}
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>{s.sub}</div>
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    {s.id === "notice" && (
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
                            <button className="btn-action btn-action--primary" onClick={async () => {
                              const ok = await confirm({
                                title: "Send AGM notice?",
                                message: `This will send AGM notice by ${noticeChannel}. Confirm the notice window, participation details, agenda, and member recipient list are correct.`,
                                confirmLabel: "Send notice",
                                tone: "warn",
                              });
                              if (!ok) return;
                              const res = await sendMeetingNotice({
                                societyId: society._id,
                                meetingId: meeting._id,
                                channel: noticeChannel,
                                actingUserId,
                              });
                              await advance("notice", { noticeSentAt: new Date().toISOString(), noticeRecipientCount: res.deliveredCount });
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
                    {s.id === "held" && (
                      <button className="btn-action" onClick={() => advanceWithReview("held", { quorumCheckedAtISO: new Date().toISOString() }, "Confirm attendance, quorum, chair, voting rights, and electronic participation details have been recorded in the minutes.")}>
                        <CheckCircle2 size={12} /> Mark meeting held
                      </button>
                    )}
                    {s.id === "financialsPresented" && (
                      <button className="btn-action" onClick={() => advanceWithReview("financialsPresented", { financialsPresentedAt: new Date().toISOString() }, "Confirm the financial statements and any auditor or reviewer report were presented and are attached or referenced in the AGM record.")}>
                        <FileText size={12} /> Mark financials presented
                      </button>
                    )}
                    {s.id === "electionsHeld" && (
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
                    {s.id === "minutesApproved" && (
                      <>
                        <Link to={`/app/meetings/${meeting._id}/preview`} className="btn-action">
                          <FileText size={12} /> {minutes?.approvedAt ? "View approved minutes" : "Open minutes"}
                        </Link>
                        <button className="btn-action" onClick={() => advanceWithReview("minutesApproved", { minutesApprovedAt: new Date().toISOString() }, "Confirm the approved AGM minutes are saved with approval evidence or the approving meeting reference.")}>
                          <Flag size={12} /> Mark minutes approved
                        </button>
                      </>
                    )}
                    {s.id === "annualReportFiled" && (
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
    <div className="row">
      <span className="muted" style={{ minWidth: 160 }}>{label}</span>
      <Badge tone={tone as any}>{value}</Badge>
    </div>
  );
}
