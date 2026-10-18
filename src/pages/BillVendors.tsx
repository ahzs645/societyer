import { useMemo } from "react";
import { useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Building2, CheckCircle2, Plus, ReceiptText, Wallet } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable, RecordTableEmpty } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { pluralize } from "../lib/format";
import { BILL_PAYMENT_METHOD_LABEL, isBillPaymentMethod } from "../../shared/bills";
import { VendorDrawer } from "../features/bills/VendorDrawer";
import type { BillsWorkspace, BillVendor } from "../features/bills/types";

type VendorRecord = BillVendor & { paymentMethodLabel: string };

/**
 * Vendors the organization pays: what's outstanding and overdue with each and
 * how much has been paid, with the vendor panel for bill history, payments
 * and the details bills use. Vendors are the accounting counterparties of
 * kind "vendor".
 */
export function BillVendorsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const workspace = useQuery(api.bills.workspace, society ? { societyId: society._id } : "skip") as BillsWorkspace | undefined;
  const [params, setParams] = useSearchParams();
  const openId = params.get("vendor");
  const setOpen = (id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("vendor", id);
      else next.delete("vendor");
      return next;
    }, { replace: !id });
  };
  const records = useMemo<VendorRecord[]>(
    () => (workspace?.vendors ?? []).map((vendor) => ({ ...vendor, paymentMethodLabel: isBillPaymentMethod(vendor.paymentMethod) ? BILL_PAYMENT_METHOD_LABEL[vendor.paymentMethod] : "" })),
    [workspace?.vendors],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const totals = records.reduce((sum, vendor) => ({ outstanding: sum.outstanding + vendor.outstandingCents, overdue: sum.overdue + vendor.overdueCents, paid: sum.paid + vendor.paidCents }), { outstanding: 0, overdue: 0, paid: 0 });
  const owed = records.filter((vendor) => vendor.outstandingCents > 0).length;
  const active = openId && openId !== "new" ? workspace?.vendors.find((vendor) => vendor._id === openId) ?? null : null;

  return (
    <div className="page bills-page">
      <PageHeader
        title="Vendors"
        icon={<Building2 size={16} />}
        iconColor="green"
        subtitle="Who the organization pays, what's owed to each and what's been paid."
        info={<p>Vendors keep the default account and terms new bills start from, and how to pay them. They're shared with the chart of accounts as counterparties.</p>}
        actions={
          <>
            <Link className="btn-action" to="/app/bills">
              <ReceiptText size={12} aria-hidden="true" /> Bills
            </Link>
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={() => setOpen("new")}>
              <Plus size={12} aria-hidden="true" /> New vendor
            </button>
          </>
        }
      />

      <div className="stat-grid" role="group" aria-label="Vendor summary">
        <StatTile label="Outstanding" icon={<Wallet size={14} />} value={<Money variant="hero" cents={workspace ? totals.outstanding : null} />} sub={workspace ? `Owed to ${pluralize(owed, "vendor")}` : undefined} href="/app/bills?tab=open" actionLabel="Show open bills" />
        <StatTile label="Overdue" icon={<AlertTriangle size={14} />} value={<Money variant="hero" cents={workspace ? totals.overdue : null} />} tone={totals.overdue ? "danger" : "neutral"} href="/app/bills?tab=overdue" actionLabel="Show overdue bills" />
        <StatTile label="Total paid" icon={<CheckCircle2 size={14} />} value={<Money variant="hero" cents={workspace ? totals.paid : null} />} sub="Across every bill" href="/app/bills?tab=paid" actionLabel="Show paid bills" />
      </div>

      <ObjectRecordTable
        societyId={society._id}
        nameSingular="billVendor"
        label="All vendors"
        objectLabel="vendor"
        icon={<Building2 size={14} />}
        records={records}
        loading={workspace === undefined}
        onRecordClick={(id) => setOpen(id)}
        renderCell={({ record, field }) => {
          const vendor = record as VendorRecord;
          if (field.name === "overdueCents") return <Money cents={vendor.overdueCents} tone={vendor.overdueCents ? "out" : "auto"} />;
          if (field.name === "defaultAccountLabel") return vendor.defaultAccountLabel ? undefined : <span className="muted">—</span>;
          return undefined;
        }}
        emptyState={
          <RecordTableEmpty
            title="No vendors yet"
            description="Add the utilities, landlords, printers and contractors you pay, with the account their bills usually go to."
            action={canWrite ? <button className="btn btn--accent btn--sm" onClick={() => setOpen("new")}><Plus size={12} /> New vendor</button> : undefined}
          />
        }
      />

      {workspace && (openId === "new" || active) && (
        <VendorDrawer open onClose={() => setOpen(null)} societyId={society._id} workspace={workspace} vendor={active} canWrite={canWrite} />
      )}
    </div>
  );
}
