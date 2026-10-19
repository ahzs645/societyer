import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Building2, CalendarClock, FileUp, Plus, ReceiptText, Trash2, Wallet } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { ObjectRecordTable, RecordTableEmpty } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Tabs } from "../components/primitives";
import { StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { pluralize } from "../lib/format";
import { formatMoney } from "../lib/money";
import { BILL_TABS, billMatchesTab, type BillTab } from "../../shared/bills";
import { BillDrawer } from "../features/bills/BillDrawer";
import { BillDetailDrawer } from "../features/bills/BillDetailDrawer";
import { BillStatusPill } from "../features/bills/BillStatusPill";
import { BillsBulkBar } from "../features/bills/BillsBulkBar";
import { useCanUploadBill, useUploadBillDocument } from "../features/bills/BillDocumentDropZone";
import { errorMessage, type BillRecord, type BillRow, type BillsWorkspace } from "../features/bills/types";

const TAB_LABEL: Record<BillTab, string> = {
  drafts: "Drafts",
  approval: "Needs approval",
  open: "Open",
  overdue: "Overdue",
  paid: "Paid",
  all: "All",
};

const EMPTY: Record<BillTab, { title: string; description: string }> = {
  drafts: { title: "No drafts", description: "Bills you're still entering, and uploaded bills waiting for their details, stay here until you send them for approval." },
  approval: { title: "Nothing needs approval", description: "Bills sent for approval wait here until they have the approvals your rules require." },
  open: { title: "Nothing open", description: "Approved bills with a balance appear here until they're paid." },
  overdue: { title: "Nothing overdue", description: "No approved bill is past its due date." },
  paid: { title: "No paid bills yet", description: "Bills move here once their balance is zero." },
  all: { title: "No bills yet", description: "Enter a bill from a vendor, or upload the PDF and fill in the details, then send it for approval and record the payment." },
};

const ACCEPT = "image/*,application/pdf,.heic,.heif";
const MAX_BYTES = 25 * 1024 * 1024;

function toRecord(bill: BillRow): BillRecord {
  const accounts = [...new Set(bill.lines.map((line) => line.accountLabel).filter((label): label is string => Boolean(label)))];
  return {
    ...bill,
    accountSummary: accounts.length > 1 ? `${accounts[0]} +${accounts.length - 1}` : accounts[0] ?? "",
    approvalSummary: bill.status === "awaiting_approval" ? `${bill.approvals.length} of ${bill.requiredApprovals}` : bill.approvals.length ? `${bill.approvals.length} approved` : "",
    hasDocument: Boolean(bill.document),
  };
}

/**
 * Payables: what the organization owes. Summary tiles (outstanding, overdue,
 * due in the next 7 days), tabs from drafts to paid, a bills register with
 * search, filters and bulk actions (approve, mark paid, cancel, export),
 * the bill editor with an "Upload bill" quick start, and the bill panel for
 * approvals, payments and bank matches.
 */
export function BillsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const workspace = useQuery(api.bills.workspace, society ? { societyId: society._id } : "skip") as BillsWorkspace | undefined;
  const save = usePermissionedMutation(api.bills.upsert, canWrite);
  const remove = usePermissionedMutation(api.bills.remove, canWrite);
  const canUpload = useCanUploadBill();
  const uploadDocument = useUploadBillDocument(society?._id ?? "");
  const confirm = useConfirm();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") as BillTab | null;
  const tab: BillTab = rawTab && BILL_TABS.includes(rawTab) ? rawTab : "all";
  const openId = params.get("bill");
  const editId = params.get("edit");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const setParam = (changes: Record<string, string | null>, replace = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value == null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  };
  const setTab = (next: BillTab) => setParam({ tab: next === "all" ? null : next });

  const records = useMemo(() => (workspace ? workspace.bills.filter((bill) => billMatchesTab(bill.status, tab)).map(toRecord) : []), [workspace, tab]);
  const counts = useMemo(
    () => Object.fromEntries(BILL_TABS.map((id) => [id, workspace ? workspace.bills.filter((bill) => billMatchesTab(bill.status, id)).length : null])) as Record<BillTab, number | null>,
    [workspace],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openBill = (id: string) => {
    const bill = workspace?.bills.find((row) => row._id === id);
    if (bill?.lifecycle === "draft") setParam({ edit: id, bill: null }, false);
    else setParam({ bill: id, edit: null }, false);
  };
  const closeAll = () => setParam({ bill: null, edit: null });
  const openRow = openId ? workspace?.bills.find((row) => row._id === openId) ?? null : null;
  const editRow = editId && editId !== "new" ? workspace?.bills.find((row) => row._id === editId) ?? null : null;

  const startUpload = async (file: File | undefined) => {
    if (!file || !workspace) return;
    if (file.size > MAX_BYTES) return toast.error("That file is too large", "Upload a scan or PDF under 25 MB.");
    setUploading(true);
    try {
      const { documentId } = await uploadDocument(file);
      const result = (await save({ societyId: society._id, billDate: workspace.today, lines: [], documentId: documentId as Id<"documents">, source: "upload" })) as { id: string };
      toast.success("Draft created from the upload", "Fill in the vendor, dates and amounts from the file.");
      setParam({ tab: "drafts", edit: String(result.id), bill: null }, false);
    } catch (error) {
      toast.error("Couldn't upload the bill", errorMessage(error));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const deleteDraft = async (bill: BillRow) => {
    const ok = await confirm({ title: "Delete this draft?", message: <p>{bill.vendorName ?? "The draft"}{bill.billNumber ? ` ${bill.billNumber}` : ""} is removed. An attached file stays in Documents.</p>, confirmLabel: "Delete draft", tone: "danger" });
    if (!ok) return;
    try {
      await remove({ id: bill._id as Id<"bills"> });
      toast.success("Draft deleted");
    } catch (error) {
      toast.error("Couldn't delete the draft", errorMessage(error));
    }
  };

  const summary = workspace?.summary;
  return (
    <div className="page bills-page">
      <PageHeader
        title="Bills"
        icon={<ReceiptText size={16} />}
        iconColor="green"
        subtitle="Bills from vendors: approve them, track what's owed and record payments."
        info={
          <p>
            Enter each vendor bill (or upload the PDF and fill in the details), send it for approval under your expense approval
            rules, then record payments as they leave the bank. Approving posts the bill to Accounts payable; a payment clears it
            and can be matched to the bank transaction. Societyer records payments; it doesn't send them.
          </p>
        }
        actions={
          <>
            <Link className="btn-action" to="/app/bills/vendors">
              <Building2 size={12} aria-hidden="true" /> Vendors
            </Link>
            <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(event) => void startUpload(event.target.files?.[0])} />
            <button
              type="button"
              className="btn-action"
              disabled={!canWrite || !canUpload || !workspace || uploading}
              title={!canUpload ? "Uploading bills needs document edit access and file storage." : undefined}
              onClick={() => fileInput.current?.click()}
            >
              <FileUp size={12} aria-hidden="true" /> {uploading ? "Uploading…" : "Upload bill"}
            </button>
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={() => setParam({ edit: "new", bill: null }, false)}>
              <Plus size={12} aria-hidden="true" /> Create bill
            </button>
          </>
        }
      />

      <div className="stat-grid" role="group" aria-label="Payables summary">
        <StatTile
          label="Total outstanding"
          icon={<Wallet size={14} />}
          value={<Money variant="hero" cents={summary ? summary.outstandingCents : null} />}
          sub={summary ? `${pluralize(summary.outstandingCount, "approved bill")}${summary.awaitingCount ? ` · ${formatMoney(summary.awaitingCents, { trimWholeCents: true })} waiting for approval` : ""}` : undefined}
          onClick={() => setTab("open")}
          pressed={tab === "open"}
          actionLabel="Show open bills"
        />
        <StatTile
          label="Overdue"
          icon={<AlertTriangle size={14} />}
          value={<Money variant="hero" cents={summary ? summary.overdueCents : null} />}
          tone={summary?.overdueCount ? "danger" : "neutral"}
          sub={summary ? (summary.overdueCount ? `${pluralize(summary.overdueCount, "bill")} past due` : "Nothing past due") : undefined}
          subTone={summary?.overdueCount ? "danger" : undefined}
          onClick={() => setTab("overdue")}
          pressed={tab === "overdue"}
          actionLabel="Show overdue bills"
        />
        <StatTile
          label="Due in the next 7 days"
          icon={<CalendarClock size={14} />}
          value={<Money variant="hero" cents={summary ? summary.dueSoonCents : null} />}
          tone={summary?.dueSoonCount ? "warn" : "neutral"}
          sub={summary ? (summary.dueSoonCount ? pluralize(summary.dueSoonCount, "bill") : "Nothing due this week") : undefined}
          onClick={() => setTab("open")}
          actionLabel="Show open bills"
        />
      </div>

      <Tabs<BillTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Bill views"
        items={BILL_TABS.map((id) => ({ id, label: TAB_LABEL[id], count: counts[id] }))}
      />

      <ObjectRecordTable
        societyId={society._id}
        nameSingular="bill"
        tableId={`bills-${tab}`}
        label={TAB_LABEL[tab] === "All" ? "All bills" : TAB_LABEL[tab]}
        objectLabel="bill"
        icon={<ReceiptText size={14} />}
        records={records}
        loading={workspace === undefined}
        selectable={tab !== "drafts"}
        onRecordClick={(id) => openBill(id)}
        renderCell={({ record, field }) => {
          const bill = record as BillRecord;
          if (field.name === "status") return <BillStatusPill status={bill.status} daysOverdue={bill.daysOverdue} />;
          if (field.name === "billNumber") return bill.billNumber ? <span className="num">{bill.billNumber}</span> : <span className="muted">—</span>;
          if (field.name === "vendorName") return bill.vendorName ? undefined : <span className="muted">No vendor yet</span>;
          if (field.name === "balanceCents") return <Money cents={bill.balanceCents} currency={bill.currency} tone={bill.status === "overdue" ? "out" : "auto"} />;
          return undefined;
        }}
        renderRowActions={(record: BillRecord) => (
          <span className="bill-row-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={(event) => { event.stopPropagation(); openBill(record._id); }}>
              Review
            </button>
            {canWrite && record.lifecycle === "draft" && !record.submittedAtISO && (
              <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete draft ${record.vendorName ?? ""} ${record.billNumber ?? ""}`.trim()} onClick={(event) => { event.stopPropagation(); void deleteDraft(record); }}>
                <Trash2 size={12} aria-hidden="true" />
              </button>
            )}
          </span>
        )}
        emptyState={
          <RecordTableEmpty
            title={EMPTY[tab].title}
            description={EMPTY[tab].description}
            action={canWrite && (tab === "all" || tab === "drafts") ? <button className="btn btn--accent btn--sm" onClick={() => setParam({ edit: "new" }, false)}><Plus size={12} /> Create bill</button> : undefined}
          />
        }
      >
        {workspace && <BillsBulkBar societyId={society._id} workspace={workspace} canWrite={canWrite} exportName={`Bills - ${TAB_LABEL[tab]}`} />}
      </ObjectRecordTable>

      {workspace && (editId === "new" || editRow) && (
        <BillDrawer
          open
          onClose={closeAll}
          societyId={society._id}
          workspace={workspace}
          bill={editRow}
          canWrite={canWrite}
          onOpenBill={(id) => setParam({ bill: id, edit: null })}
        />
      )}
      {workspace && openRow && !editId && (
        <BillDetailDrawer
          bill={openRow}
          workspace={workspace}
          societyId={society._id}
          canWrite={canWrite}
          onClose={closeAll}
          onEdit={() => setParam({ edit: openRow._id, bill: null })}
          onOpenBill={openBill}
        />
      )}
    </div>
  );
}
