import { useId } from "react";
import { useMutation } from "convex/react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../../components/Toast";
import { formatDate, formatDateTime } from "../../../lib/format";
import { appRouteAbsoluteHref } from "../../../lib/appRouteHref";
import { MIN_EXCEPTION_REASON_LENGTH, type ClaimPolicyEnforcement, type ClaimPolicyIssue } from "../../../../shared/expensePolicy";

/** What an approver sees: the policy checks a claim misses and any exception asked for. */
export function PolicyNotice({
  issues,
  exception,
}: {
  issues: readonly ClaimPolicyIssue[];
  exception: { reason: string; at: string; by: string } | null;
}) {
  if (!issues.length && !exception) return null;
  return (
    <div className={`claim-check claim-check--${exception ? "exception" : "warn"}`} role="note">
      <ShieldAlert size={14} aria-hidden="true" className="claim-check__icon" />
      <div className="claim-check__body">
        <div className="claim-check__title">
          {exception ? "Policy exception requested" : "Doesn't meet the claim policy"}
        </div>
        {issues.length > 0 && (
          <ul className="claim-check__list">
            {issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
          </ul>
        )}
        {exception && (
          <p className="claim-check__reason">
            <span className="claim-check__quote">“{exception.reason}”</span>
            <span className="muted"> · {exception.by}, {formatDateTime(exception.at)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** The soft duplicate hint: never blocks, offers a look and a way through. */
export function DuplicateNotice({
  duplicate,
  onView,
  onContinue,
  continueLabel = "Submit anyway",
}: {
  duplicate: { _id: string; title: string; date: string };
  onView?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  return (
    <div className="claim-check claim-check--duplicate" role="status">
      <AlertTriangle size={14} aria-hidden="true" className="claim-check__icon" />
      <div className="claim-check__body">
        <div className="claim-check__title">Looks like a duplicate of “{duplicate.title}” ({formatDate(duplicate.date)})</div>
        <p className="claim-check__hint muted">Same requester and amount within 14 days. Check it isn't the same expense.</p>
        {(onView || onContinue) && (
          <div className="claim-check__actions">
            {onView && <button type="button" className="btn btn--sm" onClick={onView}>View</button>}
            {onContinue && <button type="button" className="btn btn--sm btn--accent" onClick={onContinue}>{continueLabel}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Request an exception": the reason a claim that misses the policy should go ahead. */
export function ExceptionRequest({
  issues,
  enforcement,
  value,
  onChange,
  showError,
}: {
  issues: readonly ClaimPolicyIssue[];
  enforcement: ClaimPolicyEnforcement;
  value: string;
  onChange: (value: string) => void;
  /** Show the "reason needed" message (after a submit attempt). */
  showError?: boolean;
}) {
  const id = useId();
  if (!issues.length) return null;
  const blocking = enforcement === "block";
  const tooShort = value.trim().length < MIN_EXCEPTION_REASON_LENGTH;
  return (
    <div className={`claim-check claim-check--${blocking ? "block" : "warn"}`}>
      <ShieldAlert size={14} aria-hidden="true" className="claim-check__icon" />
      <div className="claim-check__body">
        <div className="claim-check__title">{blocking ? "This claim can't be submitted as is" : "This claim will be flagged for approvers"}</div>
        <ul className="claim-check__list">
          {issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
        <label className="claim-check__label" htmlFor={id}>
          {blocking ? "Request an exception" : "Request an exception (optional)"}
        </label>
        <textarea
          id={id}
          className="textarea claim-check__textarea"
          rows={2}
          placeholder="For example: the receipt was lost while travelling"
          value={value}
          aria-invalid={showError && blocking && tooShort ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {showError && blocking && tooShort && (
          <span className="claim-check__error" role="alert">Give a reason for the exception, or fix the claim.</span>
        )}
      </div>
    </div>
  );
}

/** "Remind approvers" and "Copy approval link" for a claim awaiting approval. */
export function useClaimShareActions() {
  const remind = useMutation(api.expenseReports.remindApprovers);
  const toast = useToast();
  return {
    remindApprovers: async (claimId: string) => {
      try {
        const result: any = await remind({ id: claimId as any });
        toast.success(
          `${result.notified} approver${result.notified === 1 ? "" : "s"} reminded`,
          result.emailDrafted ? "An email is waiting in the Outbox for you to send." : "They'll see it in their notifications.",
        );
      } catch (error: any) {
        toast.error("Could not remind approvers", error?.message);
      }
    },
    copyApprovalLink: async (claimId: string) => {
      const href = appRouteAbsoluteHref(`/app/approvals?claim=${encodeURIComponent(claimId)}`);
      try {
        await navigator.clipboard.writeText(href);
        toast.success("Approval link copied", "Anyone in this workspace who can approve it will land on the claim.");
      } catch {
        toast.error("Could not copy the link", href);
      }
    },
  };
}

export function ReminderMeta({ lastReminderAtISO, nextReminderAtISO }: { lastReminderAtISO?: string; nextReminderAtISO?: string }) {
  if (!lastReminderAtISO) return null;
  return (
    <p className="claim-drawer__reminded muted">
      Approvers reminded {formatDateTime(lastReminderAtISO)}.
      {nextReminderAtISO ? ` You can remind them again after ${formatDateTime(nextReminderAtISO)}.` : ""}
    </p>
  );
}

