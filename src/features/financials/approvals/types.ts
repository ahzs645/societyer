import type { ApprovalRule, ApprovalRuleDiffLine, ApprovalVote, ApproverAccess } from "../../../../shared/expenseApprovals";
import type { ClaimPolicyIssue, ExpenseClaimPolicy, MileageDetails } from "../../../../shared/expensePolicy";

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
  /** Claim-policy checks the claim misses (open claims only). */
  policyIssues: ClaimPolicyIssue[];
  claimType: "expense" | "mileage";
  mileage: MileageDetails | null;
  /** The spend budget the claim is charged to, in the cycle containing its date. */
  spendBudget: { _id: string; name: string; limitCents: number; window: { start: string; end: string }; otherSpendCents: number; remainingAfterCents: number; exceeds: boolean } | null;
  policyException: { reason: string; at: string; by: string; byUserId?: string } | null;
  /** Same requester and amount within 14 days (open claims only). */
  possibleDuplicate: { _id: string; title: string; date: string } | null;
  lastReminderAtISO?: string;
  /** Set while the 24-hour reminder limit applies. */
  nextReminderAtISO?: string;
  canRemind: boolean;
};

export type PendingPolicyChange = {
  _id: string;
  kind: "rules" | "change_control_off";
  proposedByName: string;
  createdAtISO: string;
  restoresDefaults: boolean;
  diff: ApprovalRuleDiffLine[];
  isMine: boolean;
  canDecide: boolean;
  cannotDecideReason?: string;
};

export type ApprovalQueue = {
  rows: QueueRow[];
  counts: { awaiting: number; awaitingMe: number; approved: number; paid: number; closed: number; drafts: number };
  policy: {
    rules: ApprovalRule[];
    source: "configured" | "signing_authority" | "default";
    suggested: ApprovalRule[];
    signingAuthorityCount: number;
    approverAccess: ApproverAccess;
  };
  currentUser: { _id: string; role: string; name: string; hasFinanceWrite: boolean };
  /** Who may approve: finance edit access (default) or anyone named in the matching rule. */
  approverAccess: {
    value: ApproverAccess;
    isDefault: boolean;
    canChange: boolean;
    updatedAtISO?: string;
    updatedByName?: string;
  };
  approvers: { _id: string; name: string; role: string }[];
  claimPolicy: ExpenseClaimPolicy & {
    isActive: boolean;
    isSaved: boolean;
    canChange: boolean;
    updatedAtISO?: string;
    updatedByName?: string;
  };
  /** "Changes to approval rules need a second approver". */
  changeControl: { enabled: boolean; canChange: boolean; pending: PendingPolicyChange | null };
};

export type QueueTab = "awaiting" | "approved" | "paid" | "closed" | "drafts" | "rules" | "policy";
