import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { BellRing, Check, ClipboardCheck, Download, Landmark, Link2, MoreHorizontal } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import { Menu } from "../components/Menu";
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

const TAB_IDS: QueueTab[] = ["awaiting", "bills", "approved", "paid", "closed", "drafts", "rules", "policy"];

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (queue ? rowsForTab(queue.rows, tab) : []), [queue, tab]);
  const approvable = rows.filter((row) => row.canApprove);
  const selectedRows = approvable.filter((row) => selected.has(row._id));
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
    setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = approvable.length > 0 && selectedRows.length === approvable.length;

  const approveSelected = async () => {
    if (!selectedRows.length) return;
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
        </div>
      ),
      confirmLabel: `Approve ${formatMoney(total)}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result: any = await bulkApprove({ societyId: society._id, ids: selectedRows.map((row) => row._id) as any });
      const parts = [
        result.approved ? `${pluralize(result.approved, "claim")} approved` : "",
        result.recorded ? `${pluralize(result.recorded, "approval")} recorded` : "",
      ].filter(Boolean);
      toast.success(parts.join(", ") || "Nothing approved", result.skipped?.length ? `${result.skipped.length} skipped: ${result.skipped[0].error}` : undefined);
      setSelected(new Set());
    } catch (error: any) {
      toast.error("Could not approve claims", error?.message);
    } finally {
      setBusy(false);
    }
  };

  const quickApprove = async (row: QueueRow) => {
    try {
      await decide({ id: row._id as any, decision: "approve" });
      toast.success(row.approvalsRemaining <= 1 ? "Claim approved" : "Approval recorded", row.approvalsRemaining <= 1 ? "It's ready to pay." : `${row.approvalsRemaining - 1} more approval needed.`);
    } catch (error: any) {
      toast.error("Could not approve", error?.message);
    }
  };

  const counts = queue?.counts;
  const policyRules = queue?.policy.rules.filter((rule) => rule.enabled) ?? [];
  const dateColumn = tab === "approved" ? "Approved" : tab === "paid" ? "Paid" : tab === "drafts" ? "Incurred" : "Submitted";
  const dateFor = (row: QueueRow) =>
    tab === "approved" ? row.approvedAtISO : tab === "paid" ? row.paidAtISO : tab === "drafts" ? row.incurredAtISO : row.submittedAtISO ?? row.incurredAtISO;

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
          {tab === "awaiting" && selectedRows.length > 0 && (
            <div className="approvals-bulkbar" role="region" aria-label="Bulk actions">
              <span>
                <strong>{selectedRows.length}</strong> selected · <Money cents={selectedRows.reduce((sum, row) => sum + row.amountCents, 0)} />
              </span>
              <button type="button" className="btn btn--sm" onClick={() => setSelected(new Set())}>Clear</button>
              <button type="button" className="btn btn--sm btn--accent" disabled={busy} onClick={() => void approveSelected()}>
                <Check size={12} aria-hidden="true" /> Approve {selectedRows.length}
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="card__body">
              <EmptyState icon={<ClipboardCheck size={20} />} title={EMPTY_COPY[tab].title} description={EMPTY_COPY[tab].description} />
            </div>
          ) : (
            <table className="table table--comfortable approvals-table">
              <thead>
                <tr>
                  {tab === "awaiting" && (
                    <th className="approvals-table__check">
                      <input
                        type="checkbox"
                        aria-label="Select every claim you can approve"
                        checked={allSelected}
                        disabled={approvable.length === 0}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(approvable.map((row) => row._id)))}
                      />
                    </th>
                  )}
                  <th>Claim</th>
                  <th>Requester</th>
                  <th className="num">Amount</th>
                  <th>{dateColumn}</th>
                  <th>{tab === "closed" ? "Status" : tab === "paid" ? "Reference" : "Approvals"}</th>
                  <th className="approvals-table__actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id} className={selected.has(row._id) ? "is-selected" : undefined} onClick={() => setOpenId(row._id)}>
                    {tab === "awaiting" && (
                      <td className="approvals-table__check" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.title}`}
                          checked={selected.has(row._id)}
                          disabled={!row.canApprove}
                          title={row.canApprove ? undefined : row.cannotApproveReason}
                          onChange={() => toggle(row._id)}
                        />
                      </td>
                    )}
                    <td data-label="Claim" className="approvals-table__claim">
                      <button type="button" className="approvals-table__title" onClick={(event) => { event.stopPropagation(); setOpenId(row._id); }}>
                        {row.title}
                      </button>
                      <span className="muted approvals-table__category">
                        {row.claimType === "mileage" ? mileageSummary(row.mileage) : row.category}
                        {row.spendBudget ? ` · ${row.spendBudget.name}` : ""}
                      </span>
                      {(row.policyException || (row.status === "Submitted" && row.policyIssues.length > 0) || row.possibleDuplicate || row.spendBudget?.exceeds) && (
                        <span className="approvals-table__flags">
                          {row.policyException ? <Badge tone="warn">Policy exception</Badge> : row.status === "Submitted" && row.policyIssues.length > 0 ? <Badge tone="warn">Misses policy</Badge> : null}
                          {row.possibleDuplicate && <Badge tone="orange">Possible duplicate</Badge>}
                          {row.spendBudget?.exceeds && !["Paid", "Rejected", "Recalled"].includes(row.status) && <Badge tone="warn">Over budget</Badge>}
                        </span>
                      )}
                    </td>
                    <td data-label="Requester">{row.claimantName}{row.isMine ? <span className="muted"> (you)</span> : null}</td>
                    <td data-label="Amount" className="num"><Money cents={row.amountCents} currency={row.currency} /></td>
                    <td data-label={dateColumn}>{dateFor(row) ? formatDate(dateFor(row)) : <span className="muted">—</span>}</td>
                    <td data-label={tab === "closed" ? "Status" : tab === "paid" ? "Reference" : "Approvals"}>
                      {tab === "closed" ? (
                        <Badge tone={CLAIM_STATUS_TONE[row.status] ?? "neutral"}>{CLAIM_STATUS_LABEL[row.status] ?? row.status}</Badge>
                      ) : tab === "paid" ? (
                        row.paymentReference ?? <span className="muted">—</span>
                      ) : tab === "drafts" ? (
                        <span className="muted">Not submitted</span>
                      ) : (
                        <ApprovalProgress row={row} />
                      )}
                    </td>
                    <td className="approvals-table__actions" onClick={(event) => event.stopPropagation()}>
                      <span className="approvals-table__action-group">
                        {tab === "awaiting" && row.canApprove ? (
                          <button type="button" className="btn btn--sm" onClick={() => void quickApprove(row)}>
                            <Check size={12} aria-hidden="true" /> Approve
                          </button>
                        ) : (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpenId(row._id)}>
                            {tab === "approved" ? "Pay" : "Open"}
                          </button>
                        )}
                        {tab === "awaiting" && (
                          <Menu
                            align="right"
                            trigger={
                              <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`More actions for ${row.title}`}>
                                <MoreHorizontal size={14} />
                              </button>
                            }
                            sections={[
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
                            ]}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
