import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Banner, Field } from "../../../components/ui";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { formatDateTime } from "../../../lib/format";

type ScheduleStatus = {
  supported: boolean;
  reason?: string;
  state: "not_authorized" | "authorized" | "expired" | "revoked" | "configuration_changed" | "paused" | "blocked";
  authorizerName?: string;
  authorizedAtISO?: string;
  expiresAtISO?: string;
  nextRunAtISO?: string;
  definitionFingerprint?: string;
  definition?: { name: string; recipe: string; cron: string };
};

const STATE_LABELS: Record<ScheduleStatus["state"], string> = {
  not_authorized: "Schedule needs authorization",
  authorized: "Schedule authorized",
  expired: "Schedule authorization expired",
  revoked: "Schedule authorization revoked",
  configuration_changed: "Workflow changed; review the schedule again",
  paused: "Schedule paused",
  blocked: "Automatic runs blocked",
};

type Workflow = {
  _id: Id<"workflows">;
  name: string;
  recipe: string;
  status: string;
  trigger: { kind: string; cron?: string };
};

/** Scheduling has its own explicit consent, separate from an active workflow. */
export function WorkflowScheduleAuthorization({ workflow, canManage }: { workflow: Workflow; canManage: boolean }) {
  const local = isLocalDataRuntime();
  const serverStatus = useQuery(api.workflows.scheduleStatus,
    !local && workflow.trigger.kind !== "manual" ? { id: workflow._id } : "skip") as ScheduleStatus | undefined;
  const authorize = useMutation(api.workflows.authorizeSchedule);
  const revoke = useMutation(api.workflows.revokeSchedule);
  const toast = useToast();
  const [review, setReview] = useState<{ fingerprint: string; name: string; recipe: string; cron: string } | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (serverStatus?.state !== "authorized" || !serverStatus.expiresAtISO) return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [serverStatus?.state, serverStatus?.expiresAtISO]);
  // A Convex query does not rerun just because a grant's expiry passes.
  // This affects presentation only; the internal runner checks server time.
  const status: ScheduleStatus | undefined = serverStatus?.state === "authorized" && serverStatus.expiresAtISO && Date.parse(serverStatus.expiresAtISO) <= clock
    ? { ...serverStatus, state: "expired", reason: "Review and renew authorization before automatic runs can resume." }
    : serverStatus;

  if (workflow.trigger.kind === "manual") return null;
  if (local) {
    return <Banner className="workflow-schedule-notice" title="Automatic runs need a connected server">
      Review and authorize this schedule from the connected workspace before it can run automatically.
    </Banner>;
  }
  if (!status) return <Banner className="workflow-schedule-notice">Checking schedule authorization…</Banner>;

  const changedSinceReview = Boolean(review && review.fingerprint !== status.definitionFingerprint);
  const canAuthorize = canManage && status.supported && workflow.status === "active" && Boolean(status.definitionFingerprint && status.definition);
  const hasGrant = Boolean(status.authorizedAtISO) && status.state !== "revoked";

  const submit = async () => {
    if (!review || !canAuthorize || changedSinceReview || busy) return;
    setBusy(true);
    try {
      await authorize({
        id: workflow._id,
        expectedDefinitionFingerprint: review.fingerprint,
        expiresAtISO: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
      });
      setReview(null);
      toast.success("Scheduled runs authorized");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not authorize the schedule");
    } finally { setBusy(false); }
  };

  return <>
    <Banner className="workflow-schedule-notice" tone={status.state === "authorized" ? "success" : "warn"} title={status.supported ? STATE_LABELS[status.state] : "Automatic scheduling unavailable"}>
      <p className="workflow-schedule-notice__description">
        {status.reason ?? (status.state === "authorized"
          ? "Automatic runs use the authorizer’s current workspace permissions. A changed workflow must be reviewed again."
          : "Review the workflow and authorize scheduled runs before this workflow can run automatically.")}
      </p>
      {workflow.trigger.kind === "cron" && <p className="workflow-schedule-notice__description">
        Schedule: <code>{workflow.trigger.cron}</code> (UTC). Due work is checked every 15 minutes; missed occurrences are combined into one run.
      </p>}
      {status.authorizerName && <p className="workflow-schedule-notice__description">
        Authorized by {status.authorizerName}{status.expiresAtISO ? ` until ${formatDateTime(status.expiresAtISO)}` : ""}.
      </p>}
      {status.state === "authorized" && status.nextRunAtISO && <p className="workflow-schedule-notice__description">
        Next due: {formatDateTime(status.nextRunAtISO)}. The scan may start it later.
      </p>}
      {!canManage && <p className="workflow-schedule-notice__description">An owner or admin with workflow edit access can authorize or revoke this schedule.</p>}
      <div className="workflow-schedule-notice__actions">
        <button className="btn btn--sm btn--accent" disabled={!canAuthorize || busy} onClick={() => {
          if (status.definitionFingerprint && status.definition) setReview({ fingerprint: status.definitionFingerprint, ...status.definition });
        }}>{status.state === "authorized" ? "Review and renew" : "Review and authorize"}</button>
        {hasGrant && <button className="btn btn--sm" disabled={!canManage || busy} onClick={async () => {
          if (!canManage || busy) return;
          setBusy(true);
          try {
            await revoke({ id: workflow._id });
            setReview(null);
            toast.success("Scheduled runs revoked");
          } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "Could not revoke the schedule");
          } finally { setBusy(false); }
        }}>Revoke scheduled runs</button>}
      </div>
    </Banner>
    <Modal open={Boolean(review)} onClose={() => { if (!busy) setReview(null); }} title="Authorize scheduled runs" footer={<>
      <button className="btn" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
      <button className="btn btn--accent" disabled={!canAuthorize || changedSinceReview || busy} onClick={submit}>
        {busy ? "Authorizing…" : `Authorize for ${days} days`}
      </button>
    </>}>
      <p><strong>{review?.name}</strong> will run on <code>{review?.cron}</code> in UTC, using your current workspace permissions.</p>
      {review?.recipe === "insurance_renewal" && <p>Insurance review creates tasks for the 60-, 30- and 7-day renewal checkpoints, assigns them to you, and adds an in-app notification. Existing review tasks are reused.</p>}
      {review?.recipe !== "insurance_renewal" && <p>This recipe records a review run and adds an in-app notification for you.</p>}
      <p>The current supported recipes prepare review work. They do not send meeting notices or file reports automatically. Any required manual actions remain visible in the run history.</p>
      <p>You can revoke scheduled runs here. Access is checked again at execution, and editing the workflow’s steps or configuration requires fresh authorization.</p>
      <Field label="Authorization duration">
        <select className="input" value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </Field>
      {changedSinceReview && <Banner tone="warn">The workflow changed while this review was open. Close this review and inspect the updated workflow before authorizing it.</Banner>}
    </Modal>
  </>;
}
