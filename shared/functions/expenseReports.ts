/**
 * PORTABLE FUNCTIONS: the expense-reports domain
 * (list / upsert / setStatus / remove).
 *
 * Reads/writes the `expenseReports` table over `ctx.db`, and on payment posts a
 * double-entry journal entry to `journalEntries`/`journalLines`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import { getPortable as getAccessibleDocument, requireDocumentAccess } from "./documents";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId, requireSocietyMembership } from "./access";
import { todayDateOnly } from "../dateOnly";
import {
  APPROVER_ROLES,
  DEFAULT_APPROVAL_RULES,
  approverEligibility,
  ruleForAmount,
  rulesFromSigningAuthorities,
  validateApprovalRules,
  type ApprovalRule,
} from "../expenseApprovals";

/** Statuses only the approval workflow may set (never a plain edit). */
const WORKFLOW_ONLY_STATUSES = new Set(["Approved", "Paid", "Rejected"]);

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const reports = await ctx.db
    .query("expenseReports")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const rows = await Promise.all(
    reports.map(async (report) => ({
      ...report,
      receiptDocument: report.receiptDocumentId
        ? await getAccessibleDocument(ctx, { id: String(report.receiptDocumentId) })
        : null,
      claimantUser: report.claimantUserId
        ? await getOwned(ctx, "users", report.claimantUserId, societyId)
        : null,
      approverUser: report.approverUserId
        ? await getOwned(ctx, "users", report.approverUserId, societyId)
        : null,
    })),
  );
  return rows.sort((a: any, b: any) => String(b.incurredAtISO).localeCompare(String(a.incurredAtISO)));
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    claimantName: string;
    claimantUserId?: string;
    title: string;
    category: string;
    amountCents: number;
    currency: string;
    incurredAtISO: string;
    submittedAtISO?: string;
    status: string;
    receiptDocumentId?: string;
    paymentReference?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const principalId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await Promise.all([
    args.id ? getOwned(ctx, "expenseReports", args.id, args.societyId) : Promise.resolve(),
    args.claimantUserId ? getOwned(ctx, "users", args.claimantUserId, args.societyId) : Promise.resolve(),
    args.receiptDocumentId ? requireDocumentAccess(ctx, args.receiptDocumentId) : Promise.resolve(),
  ]);
  if (!args.title.trim()) throw new Error("Expense title is required.");
  if (!args.claimantName.trim()) throw new Error("Claimant name is required.");
  if (args.amountCents < 0) throw new Error("Amount cannot be negative.");
  const existing: any = args.id ? await ctx.db.get(args.id, "expenseReports") : null;
  let status = args.status;
  if (WORKFLOW_ONLY_STATUSES.has(status) && existing?.status !== status) {
    throw new Error("Approve, decline or pay claims from the approvals queue so the approval rules are applied.");
  }
  const nowISO = new Date().toISOString();
  const actor = await actorFor(ctx, args.societyId);
  const workflow: Record<string, unknown> = {};
  if (existing && (existing.approvals?.length || existing.status === "Approved") && existing.amountCents !== args.amountCents && existing.status !== "Paid") {
    // A changed amount needs fresh approvals under the rule for the new amount.
    if (status === "Approved") status = "Submitted";
    workflow.approvals = [];
    workflow.approverUserId = undefined;
    workflow.approvedAtISO = undefined;
    workflow.approvalTrail = withTrail(existing, trailEntry(actor, "reset", "Amount changed; approvals cleared."));
  }
  if (status === "Submitted" && existing?.status !== "Submitted") {
    workflow.approvals = [];
    workflow.approvalTrail = withTrail({ approvalTrail: (workflow.approvalTrail as any[]) ?? existing?.approvalTrail }, trailEntry(actor, "submitted"));
  }
  const payload = {
    societyId: args.societyId,
    claimantName: args.claimantName,
    claimantUserId: args.claimantUserId,
    title: args.title,
    category: args.category,
    amountCents: args.amountCents,
    currency: args.currency,
    incurredAtISO: args.incurredAtISO,
    submittedAtISO: args.submittedAtISO,
    status,
    receiptDocumentId: args.receiptDocumentId,
    paymentReference: args.paymentReference,
    notes: args.notes,
    updatedAtISO: nowISO,
    ...workflow,
    ...(status === "Submitted" && !args.submittedAtISO && !existing?.submittedAtISO ? { submittedAtISO: nowISO } : {}),
  };
  if (args.id) {
    await ctx.db.patch(args.id, payload);
    return args.id;
  }
  return await ctx.db.insert("expenseReports", {
    ...payload,
    createdAtISO: nowISO,
  });
}

export async function setStatusPortable(
  ctx: PortableMutationCtx,
  {
    id,
    status,
    actingUserId,
    paymentReference,
    expenseAccountId,
    bankAccountId,
  }: {
    id: string;
    status: string;
    actingUserId?: string;
    paymentReference?: string;
    expenseAccountId?: string;
    bankAccountId?: string;
  },
) {
  const report = await requireOwnedRow(ctx, "expenseReports", id);
  const societyId = String(report.societyId);
  const principalId = await principalUserId(ctx, societyId);
  if (actingUserId && actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await Promise.all([
    expenseAccountId
      ? getOwned(ctx, "financialAccounts", expenseAccountId, societyId)
      : Promise.resolve(),
    bankAccountId
      ? getOwned(ctx, "financialAccounts", bankAccountId, societyId)
      : Promise.resolve(),
  ]);
  const actor = await actorFor(ctx, societyId);
  if (status === "Approved") {
    // An approval is a vote under the approval rules, not a status edit.
    const policy = await loadApprovalPolicy(ctx, societyId);
    await approveOne(ctx, report, actor, policy.rules);
    return;
  }
  if (status === "Rejected") throw new Error("Decline claims from the approvals queue so a reason is recorded.");
  if (status === "Paid" && report.status !== "Approved") throw new Error("Only approved claims can be marked paid.");
  if (status === "Recalled" && !["Submitted", "Approved"].includes(report.status)) throw new Error("Only submitted or approved claims can be recalled.");
  if (status === "Submitted" && !["Draft", "Recalled", "Rejected", "Submitted"].includes(report.status)) throw new Error("This claim can't be resubmitted.");
  const nowISO = new Date().toISOString();
  const patch: any = {
    status,
    updatedAtISO: nowISO,
  };
  if (status !== report.status) {
    const action = status === "Submitted" ? "submitted" : status === "Paid" ? "paid" : status === "Recalled" ? "recalled" : status.toLowerCase();
    patch.approvalTrail = withTrail(report, trailEntry(actor, action, status === "Paid" ? paymentReference ?? report.paymentReference : undefined));
  }
  if (status === "Submitted") {
    if (!report.submittedAtISO || report.status !== "Submitted") patch.submittedAtISO = nowISO;
    patch.approvals = [];
    patch.declinedReason = undefined;
    patch.declinedByUserId = undefined;
    patch.declinedAtISO = undefined;
  }
  if (status === "Recalled" || status === "Draft") {
    patch.approvals = [];
    patch.approverUserId = undefined;
    patch.approvedAtISO = undefined;
  }
  if (status === "Paid") {
    patch.paidAtISO = nowISO;
    patch.paymentReference = paymentReference ?? report.paymentReference;

    // Post to the ledger once, only when both accounts are explicitly chosen
    // (never guess accounts for a money posting).
    if (expenseAccountId && bankAccountId && !report.journalEntryId) {
      const [expenseAccount, bankAccount] = await Promise.all([
        getOwned(ctx, "financialAccounts", expenseAccountId, societyId),
        getOwned(ctx, "financialAccounts", bankAccountId, societyId),
      ]);
      if (
        expenseAccount?.societyId === report.societyId &&
        bankAccount?.societyId === report.societyId
      ) {
        const amount = Math.abs(report.amountCents ?? 0);
        if (amount > 0) {
          const entryId = await ctx.db.insert("journalEntries", {
            societyId: report.societyId,
            date: nowISO.slice(0, 10),
            memo: `Reimbursement: ${report.title} (${report.claimantName})`,
            source: "expenseReport",
            status: "posted",
            createdByUserId: await principalUserId(ctx, societyId),
            postedAtISO: nowISO,
            sourceDocumentIds: report.receiptDocumentId ? [report.receiptDocumentId] : undefined,
            createdAtISO: nowISO,
            updatedAtISO: nowISO,
          });
          const common = { societyId: report.societyId, journalEntryId: entryId, amountCents: amount, createdAtISO: nowISO, updatedAtISO: nowISO };
          await ctx.db.insert("journalLines", { ...common, accountId: expenseAccountId, lineOrder: 0, side: "debit", description: report.title });
          await ctx.db.insert("journalLines", { ...common, accountId: bankAccountId, lineOrder: 1, side: "credit", description: report.paymentReference ?? "Reimbursement payment" });
          patch.journalEntryId = entryId;
        }
      }
    }
  }
  await ctx.db.patch(id, patch);
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "expenseReports", id);
  await ctx.db.delete(id);
}

/* ------------------------------ approvals ------------------------------ */

type ApprovalRuleRow = ApprovalRule & { _id: string; societyId: string; order: number };

const TRAIL_LIMIT = 50;

async function actorFor(ctx: PortableQueryCtx, societyId: string) {
  const user: any = await requireSocietyMembership(ctx, societyId);
  const row: any = typeof user?._id === "string" && !String(user._id).startsWith("local-workspace-owner:")
    ? await ctx.db.get(user._id, "users").catch(() => null)
    : null;
  return {
    user,
    id: row ? String(row._id) : undefined,
    name: String(row?.displayName ?? row?.name ?? "Workspace owner"),
    role: String(user?.role ?? ""),
  };
}

function trailEntry(actor: { id?: string; name: string }, action: string, note?: string) {
  return {
    atISO: new Date().toISOString(),
    action,
    actorName: actor.name,
    ...(actor.id ? { actorUserId: actor.id } : {}),
    ...(note ? { note } : {}),
  };
}

function withTrail(report: any, entry: ReturnType<typeof trailEntry>) {
  return [...(report.approvalTrail ?? []), entry].slice(-TRAIL_LIMIT);
}

/** The effective approval rules: configured rows, else rules derived from the
 * recorded signing-authority tiers, else the built-in defaults. */
async function loadApprovalPolicy(ctx: PortableQueryCtx, societyId: string) {
  const [configured, authorities] = await Promise.all([
    ctx.db.query<ApprovalRuleRow>("expenseApprovalRules").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("signingAuthorities").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const ordered = [...configured].sort((a, b) => a.order - b.order || a.minAmountCents - b.minAmountCents);
  const fromSigning = rulesFromSigningAuthorities(authorities as any[], todayDateOnly());
  const source: "configured" | "signing_authority" | "default" = ordered.length ? "configured" : fromSigning ? "signing_authority" : "default";
  const rules: ApprovalRule[] = ordered.length
    ? ordered.map((row) => ({
        _id: String(row._id),
        minAmountCents: row.minAmountCents,
        requiredApprovals: row.requiredApprovals,
        approverRoles: row.approverRoles ?? [],
        approverUserIds: (row.approverUserIds ?? []).map(String),
        blockSelfApproval: row.blockSelfApproval !== false,
        enabled: row.enabled !== false,
        label: row.label,
      }))
    : fromSigning ?? DEFAULT_APPROVAL_RULES;
  return { rules, source, suggested: fromSigning ?? DEFAULT_APPROVAL_RULES, signingAuthorityCount: authorities.length };
}

function ruleFor(rules: readonly ApprovalRule[], amountCents: number): ApprovalRule {
  return ruleForAmount(rules, amountCents) ?? DEFAULT_APPROVAL_RULES[0];
}

const QUEUE_TABS = {
  awaiting: ["Submitted"],
  approved: ["Approved"],
  paid: ["Paid"],
  closed: ["Rejected", "Recalled"],
} as const;

/**
 * The approvals queue: every claim with the rule that applies, approval
 * progress and whether the current person may approve it (and why not).
 */
export async function approvalQueuePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const actor = await actorFor(ctx, societyId);
  const [reports, users, policy] = await Promise.all([
    ctx.db.query("expenseReports").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadApprovalPolicy(ctx, societyId),
  ]);
  const me = { _id: String(actor.user._id), role: actor.role, status: actor.user.status };
  const rows = await Promise.all(
    reports.map(async (report: any) => {
      const rule = ruleFor(policy.rules, report.amountCents ?? 0);
      const required = report.status === "Submitted" ? rule.requiredApprovals : report.requiredApprovals ?? rule.requiredApprovals;
      const approvals = report.approvals ?? [];
      const eligibility = report.status === "Submitted" ? approverEligibility(rule, me, report) : { eligible: false as const, reason: "Only submitted claims can be approved." };
      return {
        _id: String(report._id),
        title: report.title,
        claimantName: report.claimantName,
        claimantUserId: report.claimantUserId ? String(report.claimantUserId) : undefined,
        category: report.category,
        amountCents: report.amountCents,
        currency: report.currency ?? "CAD",
        status: report.status,
        incurredAtISO: report.incurredAtISO,
        submittedAtISO: report.submittedAtISO,
        approvedAtISO: report.approvedAtISO,
        paidAtISO: report.paidAtISO,
        paymentReference: report.paymentReference,
        notes: report.notes,
        declinedReason: report.declinedReason,
        declinedAtISO: report.declinedAtISO,
        journalEntryId: report.journalEntryId,
        receiptDocument: report.receiptDocumentId ? await getAccessibleDocument(ctx, { id: String(report.receiptDocumentId) }) : null,
        approvals,
        requiredApprovals: required,
        approvalsRemaining: Math.max(0, required - approvals.length),
        ruleThresholdCents: rule.minAmountCents,
        ruleLabel: rule.label,
        ruleBlocksSelfApproval: rule.blockSelfApproval,
        canApprove: eligibility.eligible,
        cannotApproveReason: eligibility.eligible ? undefined : eligibility.reason,
        isMine: Boolean(report.claimantUserId && String(report.claimantUserId) === me._id),
        trail: report.approvalTrail ?? [],
      };
    }),
  );
  rows.sort((a, b) => String(b.submittedAtISO ?? b.incurredAtISO).localeCompare(String(a.submittedAtISO ?? a.incurredAtISO)));
  const counts = {
    awaiting: rows.filter((r) => (QUEUE_TABS.awaiting as readonly string[]).includes(r.status)).length,
    awaitingMe: rows.filter((r) => r.status === "Submitted" && r.canApprove).length,
    approved: rows.filter((r) => (QUEUE_TABS.approved as readonly string[]).includes(r.status)).length,
    paid: rows.filter((r) => (QUEUE_TABS.paid as readonly string[]).includes(r.status)).length,
    closed: rows.filter((r) => (QUEUE_TABS.closed as readonly string[]).includes(r.status)).length,
    drafts: rows.filter((r) => r.status === "Draft" && (r.isMine || !r.claimantUserId)).length,
  };
  return {
    rows,
    counts,
    policy,
    currentUser: { _id: me._id, role: me.role, name: actor.name },
    approvers: users
      .filter((u: any) => APPROVER_ROLES.includes(u.role) && (!u.status || u.status === "Active"))
      .map((u: any) => ({ _id: String(u._id), name: String(u.displayName ?? u.name ?? u.email ?? "Member"), role: u.role })),
  };
}

async function approveOne(ctx: PortableMutationCtx, report: any, actor: Awaited<ReturnType<typeof actorFor>>, rules: readonly ApprovalRule[]) {
  if (report.status !== "Submitted") throw new Error("Only submitted claims can be approved.");
  const rule = ruleFor(rules, report.amountCents ?? 0);
  const me = { _id: String(actor.user._id), role: actor.role, status: actor.user.status };
  const eligibility = approverEligibility(rule, me, report);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  const nowISO = new Date().toISOString();
  const approvals = [...(report.approvals ?? []), { userId: me._id, name: actor.name, role: actor.role || undefined, atISO: nowISO }];
  const complete = approvals.length >= rule.requiredApprovals;
  const note = `${approvals.length} of ${rule.requiredApprovals} approval${rule.requiredApprovals === 1 ? "" : "s"}`;
  await ctx.db.patch(report._id, {
    approvals,
    requiredApprovals: rule.requiredApprovals,
    approvalTrail: withTrail(report, trailEntry(actor, "approved", note)),
    updatedAtISO: nowISO,
    ...(complete ? { status: "Approved", approverUserId: actor.id, approvedAtISO: nowISO } : {}),
  });
  return { status: complete ? "Approved" : "Submitted", approvals: approvals.length, required: rule.requiredApprovals };
}

/** Approve or decline a submitted claim. Enforces the approval rules. */
export async function decidePortable(
  ctx: PortableMutationCtx,
  { id, decision, reason }: { id: string; decision: string; reason?: string },
) {
  const report: any = await requireOwnedRow(ctx, "expenseReports", id);
  const societyId = String(report.societyId);
  const actor = await actorFor(ctx, societyId);
  const policy = await loadApprovalPolicy(ctx, societyId);
  if (decision === "approve") return approveOne(ctx, report, actor, policy.rules);
  if (decision !== "decline") throw new Error("Choose approve or decline.");
  if (report.status !== "Submitted" && report.status !== "Approved") throw new Error("Only submitted or approved claims can be declined.");
  const rule = ruleFor(policy.rules, report.amountCents ?? 0);
  // Anyone who could approve this claim may decline it.
  const eligibility = approverEligibility(rule, { _id: String(actor.user._id), role: actor.role, status: actor.user.status }, { ...report, approvals: [] });
  if (!eligibility.eligible) throw new Error(eligibility.reason.replace("approve", "decline"));
  const text = String(reason ?? "").trim();
  if (text.length < 3) throw new Error("Give a reason for declining.");
  const nowISO = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "Rejected",
    declinedReason: text,
    declinedByUserId: actor.id,
    declinedAtISO: nowISO,
    approvalTrail: withTrail(report, trailEntry(actor, "declined", text)),
    updatedAtISO: nowISO,
  });
  return { status: "Rejected" };
}

/** Approve several claims at once. Claims the current person may not approve are skipped with a reason. */
export async function bulkApprovePortable(ctx: PortableMutationCtx, { societyId, ids }: { societyId: string; ids: string[] }) {
  const actor = await actorFor(ctx, societyId);
  const policy = await loadApprovalPolicy(ctx, societyId);
  const results: { id: string; status?: string; error?: string }[] = [];
  for (const id of [...new Set(ids)].slice(0, 200)) {
    try {
      const report: any = await getOwned(ctx, "expenseReports", id, societyId);
      const outcome = await approveOne(ctx, report, actor, policy.rules);
      results.push({ id, status: outcome.status });
    } catch (error: any) {
      results.push({ id, error: String(error?.message ?? error) });
    }
  }
  return {
    approved: results.filter((r) => r.status === "Approved").length,
    recorded: results.filter((r) => r.status === "Submitted").length,
    skipped: results.filter((r) => r.error),
  };
}

type ApprovalRuleInput = {
  minAmountCents: number;
  requiredApprovals: number;
  approverRoles?: string[];
  approverUserIds?: string[];
  blockSelfApproval?: boolean;
  enabled?: boolean;
  label?: string;
};

/** Replace the workspace's approval rules (an empty list restores the defaults). */
export async function saveApprovalRulesPortable(ctx: PortableMutationCtx, { societyId, rules }: { societyId: string; rules: ApprovalRuleInput[] }) {
  await requireSocietyMembership(ctx, societyId);
  const cleaned: ApprovalRule[] = rules.map((rule) => ({
    minAmountCents: Math.round(Number(rule.minAmountCents)),
    requiredApprovals: Math.round(Number(rule.requiredApprovals)),
    approverRoles: [...new Set((rule.approverRoles ?? []).map(String))],
    approverUserIds: [...new Set((rule.approverUserIds ?? []).map(String))],
    blockSelfApproval: rule.blockSelfApproval !== false,
    enabled: rule.enabled !== false,
    label: rule.label?.trim() || undefined,
  }));
  const errors = validateApprovalRules(cleaned);
  if (errors.length) throw new Error(errors[0]);
  for (const rule of cleaned) {
    for (const userId of rule.approverUserIds) await getOwned(ctx, "users", userId, societyId);
  }
  const existing = await ctx.db.query("expenseApprovalRules").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const nowISO = new Date().toISOString();
  const sorted = [...cleaned].sort((a, b) => a.minAmountCents - b.minAmountCents);
  for (const [order, rule] of sorted.entries()) {
    await ctx.db.insert("expenseApprovalRules", { societyId, order, ...rule, createdAtISO: nowISO, updatedAtISO: nowISO });
  }
  return { saved: sorted.length };
}
