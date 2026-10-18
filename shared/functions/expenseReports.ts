/**
 * PORTABLE FUNCTIONS: the expense-reports domain
 * (list / upsert / setStatus / remove).
 *
 * Reads/writes the `expenseReports` table over `ctx.db`, and on payment posts a
 * double-entry journal entry to `journalEntries`/`journalLines`. Approval votes
 * follow `expenseApprovalRules` and the workspace's approver-access setting
 * (`expenseApprovalSettings`; by default approving needs finance edit access). Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 *
 * Submitting a claim checks the workspace's expense-claim policy
 * (`expenseClaimPolicy`: receipt, note and timeliness thresholds; warn or
 * block, with an exception reason). When change control is on, approval-rule
 * edits wait in `approvalPolicyChanges` for a second approver.
 *
 * Mileage claims are priced on the server at the policy's mileage rate
 * (distance × rate) and need no receipt. A claim may be charged to a spend
 * budget its claimant is assigned to (shared/functions/spendBudgets.ts).
 */

import { getPortable as getAccessibleDocument, requireDocumentAccess } from "./documents";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId, requireSocietyMembership } from "./access";
import { hasPermission, requirePermissionPortable } from "./permissions";
import { todayDateOnly } from "../dateOnly";
import { assertBooksOpen } from "./booksLock";
import { prefAllows, type NotificationPrefRow } from "../notificationCatalog";
import {
  APPROVER_ACCESS_MODES,
  APPROVER_ROLES,
  DEFAULT_APPROVAL_RULES,
  DEFAULT_APPROVER_ACCESS,
  FINANCE_EDIT_REQUIRED_REASON,
  approverEligibility,
  diffApprovalRules,
  financeControlFindings,
  normalizeApproverAccess,
  ruleForAmount,
  rulesFromSigningAuthorities,
  validateApprovalRules,
  type ApprovalRule,
  type ApproverAccess,
  type ApproverAccessContext,
} from "../expenseApprovals";
import {
  CLAIM_POLICY_ENFORCEMENTS,
  claimPartyKey,
  claimPolicyIsActive,
  claimSubmissionDecision,
  describeClaimPolicy,
  evaluateClaimPolicy,
  findLikelyDuplicate,
  MIN_EXCEPTION_REASON_LENGTH,
  nextReminderAt,
  normalizeClaimPolicy,
  validateClaimPolicy,
  isMileageClaim,
  mileageAmountCents,
  validateMileage,
  MAX_MILEAGE_RATE_CENTS,
  type ClaimPolicyEnforcement,
  type ExpenseClaimPolicy,
  type MileageDetails,
} from "../expensePolicy";
import { cycleWindow, claimSpendEntries, type SpendBudgetLike } from "../spendBudgets";
import { loadSpendSources, requireBudgetForClaimant, type SpendBudgetRow } from "./spendBudgets";

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
    /** Why the claim should go ahead although it misses the claim policy. */
    policyExceptionReason?: string;
    /** "mileage" prices the claim at the policy's mileage rate. */
    claimType?: string;
    mileage?: { distanceKm: number; fromLocation?: string; toLocation?: string; tripDescription?: string; rateCentsPerKm?: number };
    spendBudgetId?: string;
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
  const pricing = await mileagePricing(ctx, args, existing);
  if (pricing) args = { ...args, amountCents: pricing.amountCents };
  if (args.spendBudgetId) await requireBudgetForClaimant(ctx, args.societyId, args.spendBudgetId, args.claimantUserId, args.incurredAtISO);
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
    const policy = await loadClaimPolicy(ctx, args.societyId);
    const exception = policyExceptionFor(policy.policy, args, args.policyExceptionReason, actor);
    workflow.approvals = [];
    workflow.approvalTrail = withTrail(
      { approvalTrail: (workflow.approvalTrail as any[]) ?? existing?.approvalTrail },
      trailEntry(actor, "submitted", exception ? `Policy exception: ${exception.reason}` : undefined),
    );
    if (exception) workflow.policyException = exception;
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
    claimType: pricing ? "mileage" : undefined,
    mileage: pricing?.mileage,
    spendBudgetId: args.spendBudgetId,
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

/**
 * A mileage claim's details and amount (distance × rate). New or changed
 * trips use the policy's current rate; an unchanged distance keeps the rate it
 * was claimed at, so a later rate change doesn't reprice old claims.
 */
async function mileagePricing(
  ctx: PortableQueryCtx,
  args: { societyId: string; claimType?: string; mileage?: { distanceKm: number; fromLocation?: string; toLocation?: string; tripDescription?: string } },
  existing: { mileage?: MileageDetails } | null,
): Promise<{ amountCents: number; mileage: MileageDetails } | null> {
  if (!isMileageClaim(args)) return null;
  const { policy } = await loadClaimPolicy(ctx, args.societyId);
  const keepRate = existing?.mileage && existing.mileage.distanceKm === args.mileage?.distanceKm ? existing.mileage.rateCentsPerKm : null;
  const rate = keepRate ?? policy.mileageRateCentsPerKm ?? null;
  const errors = validateMileage(args.mileage, rate);
  if (errors.length) throw new Error(errors[0]);
  const trim = (value: string | undefined) => (value?.trim() ? value.trim().slice(0, 200) : undefined);
  const mileage: MileageDetails = {
    distanceKm: args.mileage!.distanceKm,
    rateCentsPerKm: rate!,
    fromLocation: trim(args.mileage!.fromLocation),
    toLocation: trim(args.mileage!.toLocation),
    tripDescription: trim(args.mileage!.tripDescription),
  };
  return { amountCents: mileageAmountCents(mileage.distanceKm, mileage.rateCentsPerKm), mileage };
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
    policyExceptionReason,
  }: {
    id: string;
    status: string;
    actingUserId?: string;
    paymentReference?: string;
    expenseAccountId?: string;
    bankAccountId?: string;
    /** Why a claim that misses the claim policy should be submitted anyway. */
    policyExceptionReason?: string;
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
    await approveOne(ctx, report, actor, policy.rules, await approverAccessFor(ctx, societyId, policy.approverAccess));
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
  let exception: ReturnType<typeof policyExceptionFor> = null;
  if (status === "Submitted" && report.status !== "Submitted") {
    const { policy } = await loadClaimPolicy(ctx, societyId);
    exception = policyExceptionFor(policy, report as any, policyExceptionReason, actor);
    if (exception) patch.policyException = exception;
  }
  if (status !== report.status) {
    const action = status === "Submitted" ? "submitted" : status === "Paid" ? "paid" : status === "Recalled" ? "recalled" : status.toLowerCase();
    const note = status === "Paid" ? paymentReference ?? report.paymentReference : exception ? `Policy exception: ${exception.reason}` : undefined;
    patch.approvalTrail = withTrail(report, trailEntry(actor, action, note));
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
          await assertBooksOpen(ctx, societyId, [nowISO.slice(0, 10)], "posted");
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

export async function actorFor(ctx: PortableQueryCtx, societyId: string) {
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
export async function loadApprovalPolicy(ctx: PortableQueryCtx, societyId: string) {
  const [configured, authorities, settings] = await Promise.all([
    ctx.db.query<ApprovalRuleRow>("expenseApprovalRules").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("signingAuthorities").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadApprovalSettings(ctx, societyId),
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
  return {
    rules,
    source,
    suggested: fromSigning ?? DEFAULT_APPROVAL_RULES,
    signingAuthorityCount: authorities.length,
    approverAccess: normalizeApproverAccess(settings?.approverAccess),
    approverAccessUpdatedAtISO: settings?.updatedAtISO as string | undefined,
    approverAccessUpdatedByName: settings?.updatedByName as string | undefined,
    rulesChangeControl: settings?.rulesChangeControl === true,
  };
}

/**
 * Finance-control findings for the compliance checks (single approval for
 * large claims, self-approval, rules weaker than signing authority). The
 * caller decides who may see them.
 */
export async function financeControlFindingsFor(ctx: PortableQueryCtx, societyId: string) {
  const [policy, authorities] = await Promise.all([
    loadApprovalPolicy(ctx, societyId),
    ctx.db.query("signingAuthorities").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return financeControlFindings(policy.rules, { signingAuthorities: authorities as any[], asOf: todayDateOnly(), rulesAreConfigured: policy.source === "configured" });
}

/* ---------------------------------------------------------- claim policy */

async function loadClaimPolicy(ctx: PortableQueryCtx, societyId: string) {
  const rows = await ctx.db.query("expenseClaimPolicy").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const row: any = [...rows].sort((a: any, b: any) => String(b.updatedAtISO).localeCompare(String(a.updatedAtISO)))[0] ?? null;
  return { row, policy: normalizeClaimPolicy(row ?? null) };
}

/**
 * Checks a claim against the policy as it is submitted. Throws when the policy
 * blocks it and no exception reason is given; returns the exception to store
 * when the claim misses the policy and a reason was given (or null).
 */
function policyExceptionFor(
  policy: ExpenseClaimPolicy,
  claim: { amountCents: number; receiptDocumentId?: string | null; notes?: string | null; incurredAtISO?: string | null },
  reason: string | undefined,
  actor: { id?: string; name: string },
) {
  const issues = evaluateClaimPolicy(policy, claim, todayDateOnly());
  const decision = claimSubmissionDecision(policy, issues, reason);
  if (!decision.allowed) throw new Error(decision.reason);
  const text = String(reason ?? "").trim();
  if (!issues.length || !text) return null;
  if (text.length < MIN_EXCEPTION_REASON_LENGTH) throw new Error("Give a reason for the exception.");
  return { reason: text.slice(0, 500), at: new Date().toISOString(), by: actor.name, ...(actor.id ? { byUserId: actor.id } : {}) };
}

async function loadApprovalSettings(ctx: PortableQueryCtx, societyId: string): Promise<any | null> {
  const rows = await ctx.db.query("expenseApprovalSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  // At most one row is written; prefer the latest if an import ever left two.
  return [...rows].sort((a: any, b: any) => String(b.updatedAtISO).localeCompare(String(a.updatedAtISO)))[0] ?? null;
}

/** Finance edit access of the current principal, judged as the action policy would (role and service scopes). */
async function holdsFinanceWrite(ctx: PortableQueryCtx, societyId: string): Promise<boolean> {
  try {
    await requirePermissionPortable(ctx, societyId, "financials:write");
    return true;
  } catch {
    return false;
  }
}

export async function approverAccessFor(ctx: PortableQueryCtx, societyId: string, approverAccess: ApproverAccess): Promise<ApproverAccessContext> {
  return { approverAccess, hasFinanceWrite: await holdsFinanceWrite(ctx, societyId) };
}

export function ruleFor(rules: readonly ApprovalRule[], amountCents: number): ApprovalRule {
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
  const [reports, users, policy, hasFinanceWrite, claimPolicy, pendingChange, budgets, spendSources] = await Promise.all([
    ctx.db.query("expenseReports").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadApprovalPolicy(ctx, societyId),
    holdsFinanceWrite(ctx, societyId),
    loadClaimPolicy(ctx, societyId),
    loadPendingPolicyChange(ctx, societyId),
    ctx.db.query<SpendBudgetRow>("spendBudgets").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadSpendSources(ctx, societyId),
  ]);
  const budgetById = new Map(budgets.map((budget) => [String(budget._id), budget]));
  const spendEntries = spendSources.sources.flatMap((source) => source());
  const access: ApproverAccessContext = { approverAccess: policy.approverAccess, hasFinanceWrite };
  const me = { _id: String(actor.user._id), role: actor.role, status: actor.user.status };
  const today = todayDateOnly();
  // Duplicate hints compare open and settled claims, never declined or recalled ones.
  const duplicateCandidates = reports
    .filter((report: any) => !["Rejected", "Recalled"].includes(report.status))
    .map((report: any) => ({ _id: String(report._id), partyKey: claimPartyKey(report), amountCents: report.amountCents ?? 0, date: String(report.incurredAtISO ?? ""), title: String(report.title ?? "") }));
  const rows = await Promise.all(
    reports.map(async (report: any) => {
      const rule = ruleFor(policy.rules, report.amountCents ?? 0);
      const required = report.status === "Submitted" ? rule.requiredApprovals : report.requiredApprovals ?? rule.requiredApprovals;
      const approvals = report.approvals ?? [];
      const eligibility = report.status === "Submitted" ? approverEligibility(rule, me, report, access) : { eligible: false as const, reason: "Only submitted claims can be approved." };
      const open = report.status === "Submitted" || report.status === "Draft";
      const policyIssues = open
        ? evaluateClaimPolicy(claimPolicy.policy, report, report.status === "Submitted" && report.submittedAtISO ? String(report.submittedAtISO).slice(0, 10) : today)
        : [];
      const duplicate = open
        ? findLikelyDuplicate({ _id: String(report._id), partyKey: claimPartyKey(report), amountCents: report.amountCents ?? 0, date: String(report.incurredAtISO ?? "") }, duplicateCandidates)
        : null;
      const isMine = Boolean(report.claimantUserId && String(report.claimantUserId) === me._id);
      const nextReminder = report.status === "Submitted" ? nextReminderAt(report.lastReminderAtISO) : null;
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
        isMine,
        trail: report.approvalTrail ?? [],
        policyIssues,
        claimType: report.claimType === "mileage" ? "mileage" : "expense",
        mileage: report.mileage ?? null,
        spendBudget: report.spendBudgetId && budgetById.has(String(report.spendBudgetId))
          ? budgetStandingForClaim(budgetById.get(String(report.spendBudgetId))!, spendEntries, report)
          : null,
        policyException: report.policyException ?? null,
        possibleDuplicate: duplicate ? { _id: duplicate._id, title: duplicate.title, date: duplicate.date } : null,
        lastReminderAtISO: report.lastReminderAtISO,
        nextReminderAtISO: nextReminder ?? undefined,
        canRemind: report.status === "Submitted" && !nextReminder && (isMine || hasFinanceWrite),
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
    currentUser: { _id: me._id, role: me.role, name: actor.name, hasFinanceWrite },
    approverAccess: {
      value: policy.approverAccess,
      isDefault: policy.approverAccess === DEFAULT_APPROVER_ACCESS,
      canChange: hasFinanceWrite,
      updatedAtISO: policy.approverAccessUpdatedAtISO,
      updatedByName: policy.approverAccessUpdatedByName,
    },
    approvers: users
      .filter((u: any) => APPROVER_ROLES.includes(u.role) && (!u.status || u.status === "Active"))
      .map((u: any) => ({ _id: String(u._id), name: String(u.displayName ?? u.name ?? u.email ?? "Member"), role: u.role })),
    claimPolicy: {
      ...claimPolicy.policy,
      isActive: claimPolicyIsActive(claimPolicy.policy),
      isSaved: Boolean(claimPolicy.row),
      canChange: hasFinanceWrite,
      updatedAtISO: claimPolicy.row?.updatedAtISO as string | undefined,
      updatedByName: claimPolicy.row?.updatedByName as string | undefined,
    },
    changeControl: {
      enabled: policy.rulesChangeControl,
      canChange: hasFinanceWrite,
      pending: pendingChange ? describePendingChange(pendingChange, actor, users) : null,
    },
  };
}

/**
 * The claim's budget in the cycle containing its date: spend from other
 * entries, what this claim leaves, and whether it goes over the limit.
 */
function budgetStandingForClaim(
  budget: SpendBudgetLike & { name: string },
  entries: ReturnType<typeof claimSpendEntries>,
  claim: { _id: string; amountCents?: number; incurredAtISO?: string },
) {
  const window = cycleWindow(budget, String(claim.incurredAtISO ?? "").slice(0, 10) || todayDateOnly());
  const others = entries
    .filter((entry) => entry.budgetId === String(budget._id) && entry.sourceId !== String(claim._id))
    .filter((entry) => entry.date >= window.start && entry.date <= window.end)
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  const remainingAfterCents = budget.limitCents - others - Math.abs(claim.amountCents ?? 0);
  return { _id: String(budget._id), name: budget.name, limitCents: budget.limitCents, window, otherSpendCents: others, remainingAfterCents, exceeds: remainingAfterCents < 0 };
}

/* --------------------------------------------------- claim policy writes */

/**
 * Save the workspace's expense-claim policy. Thresholds left out are switched
 * off. Needs finance edit access and is recorded in the activity log.
 */
export async function saveClaimPolicyPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; receiptOverCents?: number; noteOverCents?: number; maxAgeDays?: number; enforcement: string; mileageRateCentsPerKm?: number },
) {
  await requirePermissionPortable(ctx, args.societyId, "financials:write");
  if (!CLAIM_POLICY_ENFORCEMENTS.includes(args.enforcement as ClaimPolicyEnforcement)) throw new Error("Choose whether the policy warns or blocks.");
  const next: ExpenseClaimPolicy = {
    receiptOverCents: args.receiptOverCents === undefined ? null : Math.round(Number(args.receiptOverCents)),
    noteOverCents: args.noteOverCents === undefined ? null : Math.round(Number(args.noteOverCents)),
    maxAgeDays: args.maxAgeDays === undefined ? null : Math.round(Number(args.maxAgeDays)),
    enforcement: args.enforcement as ClaimPolicyEnforcement,
    mileageRateCentsPerKm: args.mileageRateCentsPerKm === undefined ? null : Math.round(Number(args.mileageRateCentsPerKm)),
  };
  if ((next.mileageRateCentsPerKm ?? 0) > MAX_MILEAGE_RATE_CENTS) throw new Error("Enter a mileage rate between $0.01 and $5.00 per kilometre.");
  const errors = validateClaimPolicy(next);
  if (errors.length) throw new Error(errors[0]);
  const actor = await actorFor(ctx, args.societyId);
  const { row, policy: previous } = await loadClaimPolicy(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  const stored = {
    receiptOverCents: next.receiptOverCents ?? undefined,
    noteOverCents: next.noteOverCents ?? undefined,
    maxAgeDays: next.maxAgeDays ?? undefined,
    enforcement: next.enforcement,
    mileageRateCentsPerKm: next.mileageRateCentsPerKm ?? undefined,
    updatedByName: actor.name,
    updatedAtISO: nowISO,
    ...(actor.id ? { updatedByUserId: actor.id } : {}),
  };
  if (row) await ctx.db.patch(row._id, stored);
  else await ctx.db.insert("expenseClaimPolicy", { societyId: args.societyId, ...stored, createdAtISO: nowISO });
  const changed = describeClaimPolicy(previous) !== describeClaimPolicy(next);
  if (changed) {
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: actor.name,
      entityType: "expenseClaimPolicy",
      action: "claim-policy-changed",
      summary: `Changed the expense-claim policy from ${describeClaimPolicy(previous)} to ${describeClaimPolicy(next)}.`,
      createdAtISO: nowISO,
    });
  }
  return { changed };
}

/** Link an uploaded receipt to a claim without touching its approvals. */
export async function attachReceiptPortable(ctx: PortableMutationCtx, { id, receiptDocumentId }: { id: string; receiptDocumentId: string }) {
  const report: any = await requireOwnedRow(ctx, "expenseReports", id);
  const societyId = String(report.societyId);
  await requireDocumentAccess(ctx, receiptDocumentId);
  const document: any = await getOwned(ctx, "documents", receiptDocumentId, societyId);
  if (report.status === "Paid") throw new Error("Paid claims are closed; attach the receipt to the journal entry instead.");
  const actor = await actorFor(ctx, societyId);
  await ctx.db.patch(id, {
    receiptDocumentId,
    approvalTrail: withTrail(report, trailEntry(actor, "receipt", String(document?.title ?? "Receipt"))),
    updatedAtISO: new Date().toISOString(),
  });
  return { receiptDocumentId };
}

/* -------------------------------------------------------------- reminders */

/**
 * Remind the people who can still approve a submitted claim: an in-app
 * notification each and one Outbox email draft. At most once per claim per
 * 24 hours. The requester or anyone with finance edit access can send it.
 */
export async function remindApproversPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const report: any = await requireOwnedRow(ctx, "expenseReports", id);
  const societyId = String(report.societyId);
  const actor = await actorFor(ctx, societyId);
  if (report.status !== "Submitted") throw new Error("Only claims awaiting approval can be reminded.");
  const isRequester = Boolean(report.claimantUserId && actor.id && String(report.claimantUserId) === actor.id);
  if (!isRequester && !(await holdsFinanceWrite(ctx, societyId))) {
    throw new Error("Only the requester or someone with finance edit access can remind approvers.");
  }
  const next = nextReminderAt(report.lastReminderAtISO);
  if (next) throw new Error(`Approvers were already reminded in the last 24 hours. You can remind them again after ${next.slice(0, 16).replace("T", " ")} UTC.`);
  const [users, policy, organization] = await Promise.all([
    ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadApprovalPolicy(ctx, societyId),
    ctx.db.get(societyId, "societies"),
  ]);
  const rule = ruleFor(policy.rules, report.amountCents ?? 0);
  const recipients = users.filter((user: any) => {
    if (report.claimantUserId && String(user._id) === String(report.claimantUserId)) return false;
    // No reminding yourself.
    if (actor.id && String(user._id) === actor.id) return false;
    const candidate = { _id: String(user._id), role: user.role, status: user.status ?? "Active" };
    return approverEligibility(rule, candidate, report, {
      approverAccess: policy.approverAccess,
      hasFinanceWrite: hasPermission(String(user.role), "financials:write"),
    }).eligible;
  });
  if (!recipients.length) throw new Error("No one else can approve this claim under the current rules. Check the approval rules.");
  const nowISO = new Date().toISOString();
  const amount = `$${((report.amountCents ?? 0) / 100).toFixed(2)}`;
  const link = `/app/approvals?claim=${id}`;
  for (const user of recipients) {
    await ctx.db.insert("notifications", {
      societyId,
      userId: user._id,
      kind: "approval",
      severity: "info",
      title: `Claim waiting for your approval: ${report.title}`,
      body: `${report.claimantName} is waiting on approval for ${amount}. ${actor.name} sent this reminder.`,
      linkHref: link,
      createdAtISO: nowISO,
    });
  }
  // Email only approvers who haven't turned approval emails off.
  const emailRecipients: any[] = [];
  for (const user of recipients) {
    const prefs: NotificationPrefRow[] = (
      await ctx.db.query("notificationPrefs").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()
    ).map((row: any) => ({ channel: String(row.channel), kind: String(row.kind), enabled: row.enabled === true }));
    if (prefAllows(prefs, "email", "approval")) emailRecipients.push(user);
  }
  const emails = emailRecipients.map((user: any) => String(user.email ?? "").trim()).filter(Boolean);
  if (emails.length) {
    const organizationName = String((organization as any)?.name ?? "our organization");
    await ctx.db.insert("pendingEmails", {
      societyId,
      fromName: organizationName,
      to: emails.join(", "),
      subject: `Reminder: expense claim waiting for approval (${report.title})`,
      body: [
        "Hello,",
        "",
        `${report.claimantName}'s expense claim "${report.title}" for ${amount} is waiting for approval.`,
        `Open it in Societyer: ${link}`,
        "",
        "Thank you,",
        actor.name,
      ].join("\n"),
      attachments: [],
      status: "draft",
      createdAtISO: nowISO,
      ...(actor.id ? { createdByUserId: actor.id } : {}),
      notes: `Approval reminder for an expense claim. Review the recipients before sending.`,
    });
  }
  await ctx.db.patch(id, {
    lastReminderAtISO: nowISO,
    approvalTrail: withTrail(report, trailEntry(actor, "reminded", `${recipients.length} approver${recipients.length === 1 ? "" : "s"} reminded`)),
    updatedAtISO: nowISO,
  });
  return { notified: recipients.length, emailDrafted: emails.length > 0, nextReminderAtISO: nextReminderAt(nowISO) };
}

/* -------------------------------------------- approval-rule change control */

type RuleSnapshot = {
  minAmountCents: number;
  requiredApprovals: number;
  approverRoles: string[];
  approverUserIds: string[];
  blockSelfApproval: boolean;
  enabled: boolean;
  label?: string;
};

const snapshot = (rule: ApprovalRule): RuleSnapshot => ({
  minAmountCents: rule.minAmountCents,
  requiredApprovals: rule.requiredApprovals,
  approverRoles: [...(rule.approverRoles ?? [])],
  approverUserIds: (rule.approverUserIds ?? []).map(String),
  blockSelfApproval: rule.blockSelfApproval !== false,
  enabled: rule.enabled !== false,
  ...(rule.label ? { label: rule.label } : {}),
});

async function loadPendingPolicyChange(ctx: PortableQueryCtx, societyId: string): Promise<any | null> {
  const rows = await ctx.db
    .query("approvalPolicyChanges")
    .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "pending"))
    .collect();
  return [...rows].sort((a: any, b: any) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)))[0] ?? null;
}

const PENDING_CHANGE_MESSAGE = "This rule has a pending change. Approve, decline or withdraw it before editing the rules.";

/** Who may decide a pending change: another active owner, admin or director. */
function policyChangeEligibility(change: any, actor: Awaited<ReturnType<typeof actorFor>>): { eligible: true } | { eligible: false; reason: string } {
  if (actor.user.status && actor.user.status !== "Active") return { eligible: false, reason: "Your membership is not active." };
  if (!APPROVER_ROLES.includes(actor.role as any)) return { eligible: false, reason: "Only owners, admins and directors can approve changes to approval rules." };
  if (!actor.id || !change.proposedByUserId || String(change.proposedByUserId) === actor.id) {
    return { eligible: false, reason: "You proposed this change, so another owner, admin or director must approve it." };
  }
  return { eligible: true };
}

function describePendingChange(change: any, actor: Awaited<ReturnType<typeof actorFor>>, users: any[]) {
  const names = Object.fromEntries(users.map((user: any) => [String(user._id), String(user.displayName ?? user.name ?? "Member")]));
  const eligibility = policyChangeEligibility(change, actor);
  const isMine = Boolean(actor.id && change.proposedByUserId && String(change.proposedByUserId) === actor.id);
  const proposed: ApprovalRule[] = change.kind === "rules"
    ? ((change.proposedRules ?? []).length ? change.proposedRules : DEFAULT_APPROVAL_RULES)
    : [];
  return {
    _id: String(change._id),
    kind: change.kind as "rules" | "change_control_off",
    proposedByName: String(change.proposedByName),
    createdAtISO: String(change.createdAtISO),
    restoresDefaults: change.kind === "rules" && !(change.proposedRules ?? []).length,
    diff: change.kind === "rules" ? diffApprovalRules(change.previousRules ?? [], proposed, names) : [],
    isMine,
    canDecide: eligibility.eligible,
    cannotDecideReason: eligibility.eligible ? undefined : eligibility.reason,
  };
}

/** Replace the stored rules (an empty list restores the defaults). */
async function applyApprovalRules(ctx: PortableMutationCtx, societyId: string, rules: readonly ApprovalRule[]) {
  const existing = await ctx.db.query("expenseApprovalRules").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const nowISO = new Date().toISOString();
  const sorted = [...rules].sort((a, b) => a.minAmountCents - b.minAmountCents);
  for (const [order, rule] of sorted.entries()) {
    await ctx.db.insert("expenseApprovalRules", { societyId, order, ...snapshot(rule), createdAtISO: nowISO, updatedAtISO: nowISO });
  }
  return sorted.length;
}

/**
 * Turn change control on (immediately) or off. Turning it off is itself a
 * change that needs a second approver while it is on.
 */
export async function setRulesChangeControlPortable(ctx: PortableMutationCtx, { societyId, enabled }: { societyId: string; enabled: boolean }) {
  await requirePermissionPortable(ctx, societyId, "financials:write");
  const actor = await actorFor(ctx, societyId);
  const [settings, pending] = await Promise.all([loadApprovalSettings(ctx, societyId), loadPendingPolicyChange(ctx, societyId)]);
  const current = settings?.rulesChangeControl === true;
  if (current === enabled) return { enabled, pending: false };
  if (pending) throw new Error(PENDING_CHANGE_MESSAGE);
  const nowISO = new Date().toISOString();
  if (!enabled) {
    const changeId = await ctx.db.insert("approvalPolicyChanges", {
      societyId,
      kind: "change_control_off",
      status: "pending",
      proposedByName: actor.name,
      ...(actor.id ? { proposedByUserId: actor.id } : {}),
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
    });
    await logPolicyActivity(ctx, societyId, actor.name, "approval-change-proposed", "Proposed turning off second-approver review of approval-rule changes.");
    return { enabled: true, pending: true, changeId };
  }
  // The "last changed by" stamp belongs to the approver-access choice; this
  // setting is audited in the activity log instead.
  if (settings) await ctx.db.patch(settings._id, { rulesChangeControl: true });
  else await ctx.db.insert("expenseApprovalSettings", { societyId, approverAccess: DEFAULT_APPROVER_ACCESS, rulesChangeControl: true, createdAtISO: nowISO, updatedAtISO: nowISO });
  await logPolicyActivity(ctx, societyId, actor.name, "approval-change-control-on", "Changes to approval rules now need a second approver.");
  return { enabled: true, pending: false };
}

/** Approve or decline a pending approval-policy change, or withdraw your own. */
export async function decidePolicyChangePortable(
  ctx: PortableMutationCtx,
  { id, decision, reason }: { id: string; decision: string; reason?: string },
) {
  const change: any = await requireOwnedRow(ctx, "approvalPolicyChanges", id);
  const societyId = String(change.societyId);
  const actor = await actorFor(ctx, societyId);
  if (change.status !== "pending") throw new Error("This change has already been decided.");
  const nowISO = new Date().toISOString();
  const decided = { decidedByName: actor.name, decidedAtISO: nowISO, updatedAtISO: nowISO, ...(actor.id ? { decidedByUserId: actor.id } : {}) };
  const what = change.kind === "rules" ? "approval-rule change" : "turning off second-approver review";
  if (decision === "withdraw") {
    if (!actor.id || String(change.proposedByUserId ?? "") !== actor.id) throw new Error("Only the person who proposed this change can withdraw it.");
    await ctx.db.patch(id, { status: "withdrawn", ...decided });
    await logPolicyActivity(ctx, societyId, actor.name, "approval-change-withdrawn", `Withdrew the proposed ${what}.`);
    return { status: "withdrawn" };
  }
  if (decision !== "approve" && decision !== "decline") throw new Error("Choose approve, decline or withdraw.");
  const eligibility = policyChangeEligibility(change, actor);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  if (decision === "decline") {
    const text = String(reason ?? "").trim();
    await ctx.db.patch(id, { status: "declined", ...(text ? { declineReason: text.slice(0, 500) } : {}), ...decided });
    await logPolicyActivity(ctx, societyId, actor.name, "approval-change-declined", `Declined ${change.proposedByName}'s proposed ${what}${text ? `: ${text}` : "."}`);
    return { status: "declined" };
  }
  if (change.kind === "rules") {
    await applyApprovalRules(ctx, societyId, change.proposedRules ?? []);
  } else if (change.kind === "change_control_off") {
    const settings = await loadApprovalSettings(ctx, societyId);
    if (settings) await ctx.db.patch(settings._id, { rulesChangeControl: false });
  } else {
    throw new Error("Unknown change.");
  }
  await ctx.db.patch(id, { status: "approved", ...decided });
  await logPolicyActivity(ctx, societyId, actor.name, "approval-change-approved", `Approved ${change.proposedByName}'s proposed ${what}.`);
  return { status: "approved" };
}

async function logPolicyActivity(ctx: PortableMutationCtx, societyId: string, actorName: string, action: string, summary: string) {
  await ctx.db.insert("activity", { societyId, actor: actorName, entityType: "approvalPolicyChanges", action, summary, createdAtISO: new Date().toISOString() });
}

/** Records one approval vote. Every path that approves (decide, bulk approve, setStatus "Approved") goes through here. */
async function approveOne(
  ctx: PortableMutationCtx,
  report: any,
  actor: Awaited<ReturnType<typeof actorFor>>,
  rules: readonly ApprovalRule[],
  access: ApproverAccessContext,
) {
  if (report.status !== "Submitted") throw new Error("Only submitted claims can be approved.");
  const rule = ruleFor(rules, report.amountCents ?? 0);
  const me = { _id: String(actor.user._id), role: actor.role, status: actor.user.status };
  const eligibility = approverEligibility(rule, me, report, access);
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
  const access = await approverAccessFor(ctx, societyId, policy.approverAccess);
  if (decision === "approve") return approveOne(ctx, report, actor, policy.rules, access);
  if (decision !== "decline") throw new Error("Choose approve or decline.");
  if (report.status !== "Submitted" && report.status !== "Approved") throw new Error("Only submitted or approved claims can be declined.");
  const rule = ruleFor(policy.rules, report.amountCents ?? 0);
  // Anyone who could approve this claim may decline it.
  const eligibility = approverEligibility(rule, { _id: String(actor.user._id), role: actor.role, status: actor.user.status }, { ...report, approvals: [] }, access);
  if (!eligibility.eligible) throw new Error(eligibility.reason.replace("approve", "decline").replace("Approving", "Declining"));
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
  const access = await approverAccessFor(ctx, societyId, policy.approverAccess);
  // Refuse before looking up any claim, so the outcome never depends on (or
  // reveals) which of the requested ids exist.
  if (access.approverAccess === "finance_writers" && !access.hasFinanceWrite) throw new Error(FINANCE_EDIT_REQUIRED_REASON);
  const results: { id: string; status?: string; error?: string }[] = [];
  let notFound = 0;
  for (const id of [...new Set(ids)].slice(0, 200)) {
    let report: any;
    try {
      report = await getOwned(ctx, "expenseReports", id, societyId);
    } catch {
      // Never echo ids that don't belong to this workspace back to the caller.
      notFound += 1;
      continue;
    }
    try {
      const outcome = await approveOne(ctx, report, actor, policy.rules, access);
      results.push({ id, status: outcome.status });
    } catch (error: any) {
      results.push({ id, error: String(error?.message ?? error) });
    }
  }
  return {
    approved: results.filter((r) => r.status === "Approved").length,
    recorded: results.filter((r) => r.status === "Submitted").length,
    skipped: results.filter((r) => r.error),
    notFound,
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

/**
 * Replace the workspace's approval rules (an empty list restores the
 * defaults). With change control on, the change waits for a second approver
 * instead; while a change is pending the rules can't be edited.
 */
export async function saveApprovalRulesPortable(ctx: PortableMutationCtx, { societyId, rules }: { societyId: string; rules: ApprovalRuleInput[] }) {
  await requirePermissionPortable(ctx, societyId, "financials:write");
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
  const [policy, pending] = await Promise.all([loadApprovalPolicy(ctx, societyId), loadPendingPolicyChange(ctx, societyId)]);
  if (pending) throw new Error(PENDING_CHANGE_MESSAGE);
  if (policy.rulesChangeControl) {
    const actor = await actorFor(ctx, societyId);
    const nowISO = new Date().toISOString();
    const sorted = [...cleaned].sort((a, b) => a.minAmountCents - b.minAmountCents);
    const changeId = await ctx.db.insert("approvalPolicyChanges", {
      societyId,
      kind: "rules",
      status: "pending",
      proposedRules: sorted.map(snapshot),
      previousRules: policy.rules.map(snapshot),
      proposedByName: actor.name,
      ...(actor.id ? { proposedByUserId: actor.id } : {}),
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
    });
    await logPolicyActivity(ctx, societyId, actor.name, "approval-change-proposed", sorted.length ? "Proposed a change to the expense approval rules." : "Proposed restoring the default expense approval rules.");
    return { saved: 0, pending: true, changeId };
  }
  return { saved: await applyApprovalRules(ctx, societyId, cleaned), pending: false };
}

const APPROVER_ACCESS_LABEL: Record<ApproverAccess, string> = {
  finance_writers: "people with finance edit access",
  rule_roles: "anyone named in an approval rule",
};

/**
 * Choose who may approve claims in this workspace: people with finance edit
 * access (the default) or anyone named in the matching approval rule,
 * including directors with read-only finance access. Needs finance edit
 * access and is recorded in the workspace activity log.
 */
export async function saveApproverAccessPortable(ctx: PortableMutationCtx, { societyId, approverAccess }: { societyId: string; approverAccess: string }) {
  await requirePermissionPortable(ctx, societyId, "financials:write");
  if (!APPROVER_ACCESS_MODES.includes(approverAccess as ApproverAccess)) throw new Error("Choose who can approve claims.");
  const next = approverAccess as ApproverAccess;
  const actor = await actorFor(ctx, societyId);
  const existing = await loadApprovalSettings(ctx, societyId);
  const previous = normalizeApproverAccess(existing?.approverAccess);
  const nowISO = new Date().toISOString();
  const stamp = { approverAccess: next, updatedByName: actor.name, updatedAtISO: nowISO, ...(actor.id ? { updatedByUserId: actor.id } : {}) };
  if (existing) await ctx.db.patch(existing._id, stamp);
  else await ctx.db.insert("expenseApprovalSettings", { societyId, ...stamp, createdAtISO: nowISO });
  if (previous !== next) {
    await ctx.db.insert("activity", {
      societyId,
      actor: actor.name,
      entityType: "expenseApprovalSettings",
      action: "approver-access-changed",
      summary: `Changed who can approve expense claims from ${APPROVER_ACCESS_LABEL[previous]} to ${APPROVER_ACCESS_LABEL[next]}.`,
      createdAtISO: nowISO,
    });
  }
  return { approverAccess: next, changed: previous !== next };
}
