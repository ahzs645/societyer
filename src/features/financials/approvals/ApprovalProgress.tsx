import type { QueueRow } from "./types";

/** "1 of 2 approvals" with one dot per required approval. */
export function ApprovalProgress({ row }: { row: Pick<QueueRow, "approvals" | "requiredApprovals" | "status"> }) {
  const required = Math.max(1, row.requiredApprovals);
  const count = Math.min(row.approvals.length, required);
  const complete = row.status === "Approved" || row.status === "Paid" || count >= required;
  return (
    <span className={`approval-progress${complete ? " is-complete" : ""}`}>
      <span className="approval-progress__dots" aria-hidden="true">
        {Array.from({ length: required }).map((_, index) => (
          <span key={index} className={`approval-progress__dot${index < count ? " is-filled" : ""}`} />
        ))}
      </span>
      <span className="approval-progress__label">
        {count} of {required} approval{required === 1 ? "" : "s"}
      </span>
    </span>
  );
}

export const CLAIM_STATUS_TONE: Record<string, "neutral" | "info" | "accent" | "success" | "danger" | "warn"> = {
  Draft: "neutral",
  Submitted: "info",
  Approved: "accent",
  Paid: "success",
  Rejected: "danger",
  Recalled: "warn",
};

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Awaiting approval",
  Approved: "Approved, to pay",
  Paid: "Paid",
  Rejected: "Declined",
  Recalled: "Recalled",
};
