import { useState } from "react";
import { useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { Check, ReceiptText, X } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { EmptyState } from "../../components/ui";
import { Money } from "../../components/Money";
import { usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate, pluralize } from "../../lib/format";
import { errorMessage, type BillRow, type BillsWorkspace } from "./types";

const BILL_APPROVALS_TABLE = staticRecordTable({
  id: "approvals:bills",
  nameSingular: "approvalQueueBill",
  namePlural: "approvalQueueBills",
  labelSingular: "Bill",
  labelPlural: "Bills",
  labelIdentifierFieldName: "vendorName",
  viewName: "Waiting for approval",
  density: "comfortable",
  fields: [
    { name: "vendorName", label: "Bill", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "billNumber", label: "Bill #", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "billDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "dueDate", label: "Due", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "totalCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true }, aggregate: "sum" },
    { name: "approvals", label: "Approvals", fieldType: FIELD_TYPES.TEXT, size: 200 },
  ],
});

type BillApprovalRecord = {
  _id: string;
  vendorName: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  totalCents: number;
  /** "1 of 2". */
  approvals: string;
  bill: BillRow;
};

function billApprovalRecord(bill: BillRow): BillApprovalRecord {
  return {
    _id: bill._id,
    vendorName: bill.vendorName ?? "",
    billNumber: bill.billNumber ?? "",
    billDate: bill.billDate,
    dueDate: bill.dueDate,
    totalCents: bill.totalCents,
    approvals: `${bill.approvals.length} of ${bill.requiredApprovals}`,
    bill,
  };
}

/** Bills waiting for approval, inside the Approvals queue (same rules as expense claims). */
export function useBillsAwaitingApproval(societyId: string | undefined) {
  const workspace = useQuery(api.bills.workspace, societyId ? { societyId: societyId as Id<"societies"> } : "skip") as BillsWorkspace | undefined;
  return { workspace, rows: (workspace?.bills ?? []).filter((bill) => bill.status === "awaiting_approval") };
}

/**
 * The Approvals page's Bills tab: every bill waiting for approval with its
 * progress, approve in place, or decline with a reason. Opening a bill goes
 * to its panel on the Bills page.
 */
export function BillApprovalsPanel({ rows, loading }: { rows: BillRow[]; loading: boolean }) {
  const decide = usePermissionedMutation(api.bills.decide, true);
  const prompt = usePrompt();
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (bill: BillRow, decision: "approve" | "decline") => {
    let reason: string | undefined;
    if (decision === "decline") {
      const answer = await prompt({ title: `Decline ${bill.vendorName ?? "this bill"}?`, message: <p>It goes back to draft with your reason.</p>, placeholder: "What needs to change", confirmLabel: "Decline", multiline: true, required: true });
      if (!answer) return;
      reason = answer;
    }
    setBusyId(bill._id);
    try {
      await decide({ id: bill._id as Id<"bills">, decision, reason });
      if (decision === "decline") toast.success("Bill declined", "It's back in drafts with your reason.");
      else toast.success(bill.approvalsRemaining <= 1 ? "Bill approved" : "Approval recorded", bill.approvalsRemaining <= 1 ? "It's posted to Accounts payable and ready to pay." : `${bill.approvalsRemaining - 1} more approval needed.`);
    } catch (error) {
      toast.error(decision === "approve" ? "Couldn't approve" : "Couldn't decline", errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const mine = rows.filter((bill) => bill.canApprove).length;
  const records = rows.map(billApprovalRecord);
  return (
    <>
      {!loading && rows.length > 0 && (
        <div className="approvals-policy">
          <span>{mine ? <><strong>{pluralize(mine, "bill")}</strong> {mine === 1 ? "needs" : "need"} your approval.</> : "Nothing needs your approval right now."}</span>
          <span className="muted approvals-policy__rules"><Link to="/app/bills?tab=approval">Open in Bills</Link></span>
        </div>
      )}
      <RecordListTable<BillApprovalRecord>
        variant="card"
        table={BILL_APPROVALS_TABLE}
        tableId="approvals-bills"
        label="Bills"
        icon={<ReceiptText size={14} />}
        records={records}
        loading={loading}
        onOpen={(record) => navigate(`/app/bills?bill=${encodeURIComponent(record._id)}`)}
        renderCell={({ record, field }) => {
          const { bill } = record;
          if (field.name === "vendorName" && !bill.vendorName) return <span className="muted">No vendor yet</span>;
          if (field.name === "billNumber" && !bill.billNumber) return <span className="muted">—</span>;
          if (field.name === "totalCents") return <Money cents={bill.totalCents} currency={bill.currency} />;
          if (field.name === "approvals")
            return (
              <>
                {record.approvals}
                {!bill.canApprove && bill.cannotApproveReason && <div className="muted approvals-table__category">{bill.cannotApproveReason}</div>}
              </>
            );
          return undefined;
        }}
        renderRowActions={(record) => {
          const { bill } = record;
          if (!bill.canApprove) return null;
          return (
            <>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busyId === bill._id} onClick={() => void run(bill, "decline")}>
                <X size={12} aria-hidden="true" /> Decline
              </button>
              <button type="button" className="btn btn--sm" disabled={busyId === bill._id} onClick={() => void run(bill, "approve")}>
                <Check size={12} aria-hidden="true" /> Approve
              </button>
            </>
          );
        }}
        renderPhoneCard={(record, { open, selecting }) => (
          <RecordTablePhoneCard
            title={record.vendorName || "Bill"}
            badge={<span className="muted">{record.approvals}</span>}
            meta={[<Money key="amount" cents={record.bill.totalCents} currency={record.bill.currency} />, `Due ${formatDate(record.dueDate)}`]}
            detail={[record.billNumber ? `Bill ${record.billNumber}` : "", record.bill.canApprove ? "" : record.bill.cannotApproveReason ?? ""]}
            onOpen={open}
            selecting={selecting}
          />
        )}
        emptyState={<EmptyState icon={<ReceiptText size={20} />} title="No bills waiting for approval" description="Bills sent for approval from the Bills page appear here until they have the approvals your rules require." />}
      />
    </>
  );
}
