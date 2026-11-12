import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { BellRing, Check, ClipboardCheck, Download, Landmark, Link2 } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableBulkBar, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import type { MenuSection } from "../components/Menu";
import { Money } from "../components/Money";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatDate, pluralize } from "../lib/format";
import { formatMoney } from "../lib/money";
import { ApprovalProgress, CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from "../features/financials/approvals/ApprovalProgress";
import { ApprovalRulesEditor } from "../features/financials/approvals/ApprovalRulesEditor";
import { ApproverAccessSetting } from "../features/financials/approvals/ApproverAccessSetting";
import { ClaimDetailDrawer } from "../features/financials/approvals/ClaimDetailDrawer";
import { ClaimPolicyCard } from "../features/financials/approvals/ClaimPolicyCard";
import { useClaimShareActions } from "../features/financials/approvals/ClaimChecks";
import type { ApprovalQueue, QueueRow, QueueTab } from "../features/financials/approvals/types";
import { BillApprovalsPanel, useBillsAwaitingApproval } from "../features/bills/BillApprovalsPanel";
import { exportClaimsCsv } from "../features/financials/approvals/claimExport";
import { mileageSummary } from "../../shared/expensePolicy";
import type { Id } from "../../convex/_generated/dataModel";

const TAB_IDS: QueueTab[] = ["awaiting", "bills", "approved", "paid", "closed", "drafts", "rules", "policy"];

/** The tabs that list expense claims. */
type ClaimTab = Exclude<QueueTab, "bills" | "rules" | "policy">;

const CLAIM_FLAG_OPTIONS = [
  { value: "policy_exception", label: "Policy exception", color: "amber" },
  { value: "misses_policy", label: "Misses policy", color: "amber" },
  { value: "possible_duplicate", label: "Possible duplicate", color: "orange" },
  { value: "over_budget", label: "Over budget", color: "amber" },
];

const CLAIM_STATUS_COLOR: Record<string, string> = { Draft: "gray", Submitted: "blue", Approved: "purple", Paid: "green", Rejected: "red", Recalled: "amber" };

/** One table per claim tab: the date column and the last column change with the tab. */
function claimQueueTable(tab: ClaimTab) {
  const dateLabel = tab === "approved" ? "Approved" : tab === "paid" ? "Paid" : tab === "drafts" ? "Incurred" : "Submitted";
  const progress =
    tab === "closed"
      ? {
          name: "status",
          label: "Status",
          fieldType: FIELD_TYPES.SELECT,
          size: 150,
          config: { options: Object.entries(CLAIM_STATUS_LABEL).map(([value, label]) => ({ value, label, color: CLAIM_STATUS_COLOR[value] ?? "gray" })) },
        }
      : tab === "paid"
        ? { name: "paymentReference", label: "Reference", fieldType: FIELD_TYPES.TEXT, size: 160 }
        : { name: "approvals", label: "Approvals", fieldType: FIELD_TYPES.TEXT, size: 160 };
  return staticRecordTable({
    id: `approvals:${tab}`,
    nameSingular: "approvalQueueClaim",
    namePlural: "approvalQueueClaims",
    labelSingular: "Claim",
    labelPlural: "Claims",
    labelIdentifierFieldName: "title",
    viewName: "All claims",
    density: "comfortable",
    fields: [
      { name: "title", label: "Claim", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
      { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, size: 160 },
      { name: "claimantName", label: "Requester", fieldType: FIELD_TYPES.TEXT, size: 160 },
      { name: "amountCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 120, config: { isCents: true }, aggregate: "sum" },
      { name: "date", label: dateLabel, fieldType: FIELD_TYPES.DATE, size: 120 },
      progress,
      { name: "flags", label: "Flags", fieldType: FIELD_TYPES.MULTI_SELECT, size: 200, config: { options: CLAIM_FLAG_OPTIONS } },
      { name: "spendBudget", label: "Spend budget", fieldType: FIELD_TYPES.TEXT, size: 160 },
    ],
  });
}

const CLAIM_QUEUE_TABLES: Record<ClaimTab, ReturnType<typeof claimQueueTable>> = {
  awaiting: claimQueueTable("awaiting"),
  approved: claimQueueTable("approved"),
  paid: claimQueueTable("paid"),
  closed: claimQueueTable("closed"),
  drafts: claimQueueTable("drafts"),
};

type ClaimRecord = {
  _id: string;
  title: string;
  /** Its expense category, or "Mileage · 12 km". */
  category: string;
  claimantName: string;
  amountCents: number;
  /** The date the tab is about: submitted, approved, paid or incurred. */
  date: string | null;
  approvals: string;
  paymentReference: string;
  status: string;
  flags: string[];
  spendBudget: string;
  row: QueueRow;
};

function claimDate(row: QueueRow, tab: ClaimTab) {
  const date = tab === "approved" ? row.approvedAtISO : tab === "paid" ? row.paidAtISO : tab === "drafts" ? row.incurredAtISO : row.submittedAtISO ?? row.incurredAtISO;
  return date ?? null;
}

function claimFlags(row: QueueRow): string[] {
  const flags: string[] = [];
  if (row.policyException) flags.push("policy_exception");
  else if (row.status === "Submitted" && row.policyIssues.length > 0) flags.push("misses_policy");
  if (row.possibleDuplicate) flags.push("possible_duplicate");
  if (row.spendBudget?.exceeds && !["Paid", "Rejected", "Recalled"].includes(row.status)) flags.push("over_budget");
  return flags;
}

function claimRecord(row: QueueRow, tab: ClaimTab): ClaimRecord {
  const required = Math.max(1, row.requiredApprovals);
  return {
    _id: row._id,
    title: row.title,
    category: row.claimType === "mileage" ? mileageSummary(row.mileage) : row.category,
    claimantName: row.claimantName,
    amountCents: row.amountCents,
    date: claimDate(row, tab),
    approvals: tab === "drafts" ? "Not submitted" : `${Math.min(row.approvals.length, required)} of ${required}`,
    paymentReference: row.paymentReference ?? "",
    status: row.status,
    flags: claimFlags(row),
    spendBudget: row.spendBudget?.name ?? "",
    row,
  };
}

const FLAG_BADGE: Record<string, { label: string; tone: "warn" | "orange" }> = {
  policy_exception: { label: "Policy exception", tone: "warn" },
  misses_policy: { label: "Misses policy", tone: "warn" },
  possible_duplicate: { label: "Possible duplicate", tone: "orange" },
  over_budget: { label: "Over budget", tone: "warn" },
};

type BulkApproveResult = { approved?: number; recorded?: number; skipped?: Array<{ error?: string }> };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function rowsForTab(rows: QueueRow[], tab: QueueTab): QueueRow[] {
  switch (tab) {
    case "awaiting": return rows.filter((row) => row.status === "Submitted");
    case "approved": return rows.filter((row) => row.status === "Approved");
    case "paid": return rows.filter((row) => row.status === "Paid");
    case "closed": return rows.filter((row) => row.status === "Rejected" || row.status === "Recalled");
    case "drafts": return rows.filter((row) => row.status === "Draft" && (row.isMine || !row.claimantUserId));
    default: return [];
  }
}

const EMPTY_COPY: Record<Exclude<QueueTab, "bills" | "rules" | "policy">, { title: string; description: string }> = {
  awaiting: { title: "Nothing waiting for approval", description: "Submitted expense claims appear here until they have the approvals your rules require." },
  approved: { title: "Nothing to pay", description: "Approved claims wait here until someone records the payment." },
  paid: { title: "No paid claims yet", description: "Reimbursed claims are kept here with their payment reference." },
  closed: { title: "No declined or recalled claims", description: "Declined claims keep the reason so the requester can fix and resubmit." },
  drafts: { title: "No drafts", description: "Claims you start in the Treasurer dashboard stay here until you submit them." },
};

/**
 * Expense-claim approvals queue with tabs and counts, a detail drawer
 * (approve, decline with a reason, mark paid, activity trail), bulk approve,
 * and the approval rules that the server enforces.
 */
export function ApprovalsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const queue = useQuery(api.expenseReports.approvalQueue, society ? { societyId: society._id } : "skip") as ApprovalQueue | undefined;
  const bulkApprove = useMutation(api.expenseReports.bulkApprove);
  const billApprovals = useBillsAwaitingApproval(society?._id);
  const decide = useMutation(api.expenseReports.decide);
  const confirm = useConfirm();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") as QueueTab | null;
  const tab: QueueTab = requestedTab && TAB_IDS.includes(requestedTab) ? requestedTab : "awaiting";
  // The open claim lives in the URL (?claim=<id>), so "Copy approval link" lands on it.
  const openId = searchParams.get("claim");
  const setOpenId = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set("claim", id);
    else params.delete("claim");
    setSearchParams(params, { replace: !id });
  };
  const share = useClaimShareActions();

  const rows = useMemo(() => (queue ? rowsForTab(queue.rows, tab) : []), [queue, tab]);
  const claimTab: ClaimTab | null = tab === "bills" || tab === "rules" || tab === "policy" ? null : tab;
  const records = useMemo(() => (claimTab ? rows.map((row) => claimRecord(row, claimTab)) : []), [rows, claimTab]);
  const approvable = rows.filter((row) => row.canApprove);
  const openRow = queue?.rows.find((row) => row._id === openId) ?? null;
  const missingClaim = Boolean(queue && openId && !openRow);
  useEffect(() => {
    if (!missingClaim) return;
    toast.info("That claim isn't available", "It may have been deleted, or it belongs to another workspace.");
    const params = new URLSearchParams(searchParams);
    params.delete("claim");
    setSearchParams(params, { replace: true });
    // Only when a linked claim turns out to be missing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingClaim]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const setTab = (next: QueueTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "awaiting") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  /** Bulk approve from the selection bar: only the selected claims you may approve. */
  const approveSelected = async (selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const selectedRows = approvable.filter((row) => selected.has(row._id));
    const notYours = selectedIds.length - selectedRows.length;
    if (!selectedRows.length) {
      toast.info("Nothing you can approve", "The selected claims need someone else's approval.");
      return;
    }
    const total = selectedRows.reduce((sum, row) => sum + row.amountCents, 0);
    const completing = selectedRows.filter((row) => row.approvalsRemaining <= 1).length;
    const ok = await confirm({
      title: `Approve ${pluralize(selectedRows.length, "claim")}?`,
      message: (
        <div className="bulk-approve-confirm">
          <ul>
            {selectedRows.map((row) => (
              <li key={row._id}>
                <span>{row.title} <span className="muted">· {row.claimantName}</span></span>
                <Money cents={row.amountCents} currency={row.currency} />
              </li>
            ))}
          </ul>
          <div className="bulk-approve-confirm__total">
            <span>Total</span>
            <Money cents={total} />
          </div>
          {completing < selectedRows.length && (
            <p className="muted">{pluralize(selectedRows.length - completing, "claim")} still need{selectedRows.length - completing === 1 ? "s" : ""} another approval after yours.</p>
          )}
          {notYours > 0 && (
            <p className="muted">{pluralize(notYours, "selected claim")} you can't approve {notYours === 1 ? "is" : "are"} left out.</p>
          )}
        </div>
      ),
      confirmLabel: `Approve ${formatMoney(total)}`,
    });
    if (!ok) return;
    try {
      const result = (await bulkApprove({ societyId: society._id, ids: selectedRows.map((row) => row._id as Id<"expenseReports">) })) as BulkApproveResult;
      const parts = [
        result.approved ? `${pluralize(result.approved, "claim")} approved` : "",
        result.recorded ? `${pluralize(result.recorded, "approval")} recorded` : "",
      ].filter(Boolean);
      toast.success(parts.join(", ") || "Nothing approved", result.skipped?.length ? `${result.skipped.length} skipped: ${result.skipped[0].error}` : undefined);
    } catch (error: unknown) {
      toast.error("Could not approve claims", errorText(error));
    }
  };

  const quickApprove = async (row: QueueRow) => {
    try {
      await decide({ id: row._id as Id<"expenseReports">, decision: "approve" });
      toast.success(row.approvalsRemaining <= 1 ? "Claim approved" : "Approval recorded", row.approvalsRemaining <= 1 ? "It's ready to pay." : `${row.approvalsRemaining - 1} more approval needed.`);
    } catch (error: unknown) {
      toast.error("Could not approve", errorText(error));
    }
  };

  const claimMenu = (row: QueueRow): MenuSection[] =>
    tab === "awaiting"
      ? [
          {
            id: "share",
            items: [
              {
                id: "remind",
                label: "Remind approvers",
                icon: <BellRing size={14} />,
                disabled: !row.canRemind,
                hint: row.nextReminderAtISO ? "Once a day" : undefined,
                onSelect: () => void share.remindApprovers(row._id),
              },
              { id: "copy-link", label: "Copy approval link", icon: <Link2 size={14} />, onSelect: () => void share.copyApprovalLink(row._id) },
            ],
          },
        ]
      : [];

  const counts = queue?.counts;
  const policyRules = queue?.policy.rules.filter((rule) => rule.enabled) ?? [];

  return (
    <div className="page approvals-page">
      <PageHeader
        title="Approvals"
        icon={<ClipboardCheck size={16} />}
        iconColor="green"
        subtitle="Review, approve and pay expense claims and vendor bills."
        info={
          <p>
            Approval rules decide how many people must approve a claim of a given size and who may approve it.
            They are enforced when an approval is recorded, so they also apply to approvals made from the
            Treasurer dashboard.
          </p>
        }
        actions={
          <>
            <button type="button" className="btn-action" disabled={!queue?.rows.length} onClick={() => queue && toast.success("Claims exported", exportClaimsCsv(queue.rows))}>
              <Download size={12} aria-hidden="true" /> Export all
            </button>
            <Link className="btn-action" to="/app/treasurer">
              <Landmark size={12} aria-hidden="true" /> Treasurer dashboard
            </Link>
          </>
        }
      />

      <Tabs<QueueTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Approval queues"
        items={[
          { id: "awaiting", label: "Awaiting approval", count: counts?.awaiting ?? null },
          { id: "bills", label: "Bills", count: billApprovals.workspace ? billApprovals.rows.length : null },
          { id: "approved", label: "Approved, to pay", count: counts?.approved ?? null },
          { id: "paid", label: "Paid", count: counts?.paid ?? null },
          { id: "closed", label: "Declined & recalled", count: counts?.closed ?? null },
          { id: "drafts", label: "My drafts", count: counts?.drafts ?? null },
          { id: "rules", label: "Approval rules" },
          { id: "policy", label: "Claim policy" },
        ]}
      />

      {queue === undefined ? (
        <div className="card"><div className="card__body"><div className="record-table__loading">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div></div>
      ) : tab === "bills" ? (
        <div className="card approvals-card">
          <BillApprovalsPanel rows={billApprovals.rows} loading={billApprovals.workspace === undefined} />
        </div>
      ) : tab === "policy" ? (
        <div className="approvals-settings">
          <ClaimPolicyCard queue={queue} societyId={society._id} />
        </div>
      ) : tab === "rules" ? (
        <div className="approvals-settings">
          <ApproverAccessSetting queue={queue} societyId={society._id} />
          <div className="card">
            <div className="card__head">
              <div>
                <h2 className="card__title">Approval rules</h2>
                <span className="card__subtitle">The rule with the highest threshold a claim meets applies.</span>
              </div>
            </div>
            <div className="card__body">
              <ApprovalRulesEditor queue={queue} societyId={society._id} canWrite={canWrite} />
            </div>
          </div>
        </div>
      ) : (
        <div className="card approvals-card">
          {tab === "awaiting" && (
            <div className="approvals-policy">
              <span>
                {counts?.awaitingMe
                  ? <><strong>{pluralize(counts.awaitingMe, "claim")}</strong> {counts.awaitingMe === 1 ? "needs" : "need"} your approval.</>
                  : queue.approverAccess.value === "finance_writers" && !queue.currentUser.hasFinanceWrite
                    ? "You can review claims here. Approving requires finance edit access in this workspace."
                    : "Nothing needs your approval right now."}
              </span>
              <span className="muted approvals-policy__rules">
                {policyRules.map((rule) => `${formatMoney(rule.minAmountCents, { trimWholeCents: true })}+ needs ${rule.requiredApprovals}`).join(" · ")}
                {" · "}
                <button type="button" className="link-button" onClick={() => setTab("rules")}>Edit rules</button>
              </span>
            </div>
          )}
          <RecordListTable<ClaimRecord>
            key={tab}
            variant="card"
            table={CLAIM_QUEUE_TABLES[claimTab ?? "awaiting"]}
            tableId={`approvals-${tab}`}
            label="Claims"
            icon={<ClipboardCheck size={14} />}
            records={records}
            selectable={tab === "awaiting" && approvable.length > 0}
            onOpen={(record) => setOpenId(record._id)}
            renderCell={({ record, field }) => {
              const { row } = record;
              if (field.name === "claimantName") return <>{row.claimantName}{row.isMine ? <span className="muted"> (you)</span> : null}</>;
              if (field.name === "amountCents") return <Money cents={row.amountCents} currency={row.currency} />;
              if (field.name === "status") return <Badge tone={CLAIM_STATUS_TONE[row.status] ?? "neutral"}>{CLAIM_STATUS_LABEL[row.status] ?? row.status}</Badge>;
              if (field.name === "approvals") return tab === "drafts" ? <span className="muted">Not submitted</span> : <ApprovalProgress row={row} />;
              if (field.name === "flags")
                return record.flags.length ? (
                  <span className="approvals-table__flags">
                    {record.flags.map((flag) => <Badge key={flag} tone={FLAG_BADGE[flag].tone}>{FLAG_BADGE[flag].label}</Badge>)}
                  </span>
                ) : <span className="muted">—</span>;
              return undefined;
            }}
            renderRowActions={(record) => {
              const { row } = record;
              if (tab === "awaiting" && row.canApprove)
                return (
                  <button type="button" className="btn btn--sm" onClick={() => void quickApprove(row)}>
                    <Check size={12} aria-hidden="true" /> Approve
                  </button>
                );
              if (tab === "approved")
                return <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpenId(row._id)}>Pay</button>;
              return null;
            }}
            rowMenuSections={(record) => claimMenu(record.row)}
            renderPhoneCard={(record, { open, selecting }) => {
              const { row } = record;
              return (
                <RecordTablePhoneCard
                  title={row.title}
                  badge={tab === "closed" ? <Badge tone={CLAIM_STATUS_TONE[row.status] ?? "neutral"}>{CLAIM_STATUS_LABEL[row.status] ?? row.status}</Badge> : tab === "drafts" || tab === "paid" ? undefined : <ApprovalProgress row={row} />}
                  meta={[<Money key="amount" cents={row.amountCents} currency={row.currency} />, `${row.claimantName}${row.isMine ? " (you)" : ""}`]}
                  detail={[record.category, record.spendBudget, record.date ? formatDate(record.date) : "", ...record.flags.map((flag) => FLAG_BADGE[flag].label)]}
                  onOpen={open}
                  selecting={selecting}
                />
              );
            }}
            emptyState={<EmptyState icon={<ClipboardCheck size={20} />} title={EMPTY_COPY[claimTab ?? "awaiting"].title} description={EMPTY_COPY[claimTab ?? "awaiting"].description} />}
            bulkActions={tab === "awaiting" && approvable.length > 0 ? [{ id: "approve", label: "Approve", icon: <Check size={12} aria-hidden="true" />, onRun: (ids) => approveSelected(ids) }] : undefined}
            bulkSummary={(selected) => <Money cents={selected.reduce((sum, record) => sum + (typeof record.amountCents === "number" ? record.amountCents : 0), 0)} />}
          />
        </div>
      )}

      {openRow && (
        <ClaimDetailDrawer
          row={openRow}
          rows={queue?.rows}
          policy={queue?.claimPolicy}
          societyId={society._id}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onOpenClaim={(id) => setOpenId(id)}
        />
      )}
    </div>
  );
}
