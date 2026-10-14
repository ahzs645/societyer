import type { ApprovalRule, ApprovalVote } from "../../../../shared/expenseApprovals";

export type TrailEntry = { atISO: string; action: string; actorName: string; actorUserId?: string; note?: string };

export type QueueRow = {
  _id: string;
  title: string;
  claimantName: string;
  claimantUserId?: string;
  category: string;
  amountCents: number;
  currency: string;
  status: "Draft" | "Submitted" | "Approved" | "Paid" | "Rejected" | "Recalled" | string;
  incurredAtISO: string;
  submittedAtISO?: string;
  approvedAtISO?: string;
  paidAtISO?: string;
  paymentReference?: string;
  notes?: string;
  declinedReason?: string;
  declinedAtISO?: string;
  journalEntryId?: string;
  receiptDocument?: { _id: string; title: string } | null;
  approvals: ApprovalVote[];
  requiredApprovals: number;
  approvalsRemaining: number;
  ruleThresholdCents: number;
  ruleLabel?: string;
  ruleBlocksSelfApproval: boolean;
  canApprove: boolean;
  cannotApproveReason?: string;
  isMine: boolean;
  trail: TrailEntry[];
};

export type ApprovalQueue = {
  rows: QueueRow[];
  counts: { awaiting: number; awaitingMe: number; approved: number; paid: number; closed: number; drafts: number };
  policy: {
    rules: ApprovalRule[];
    source: "configured" | "signing_authority" | "default";
    suggested: ApprovalRule[];
    signingAuthorityCount: number;
  };
  currentUser: { _id: string; role: string; name: string };
  approvers: { _id: string; name: string; role: string }[];
};

export type QueueTab = "awaiting" | "approved" | "paid" | "closed" | "drafts" | "rules";
