import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Plus, Receipt, FileDown } from "lucide-react";
import { dollarInputToCents, formatDate, money } from "../lib/format";
import { exportWordDocx } from "../lib/docx";
import { escapeHtml } from "../lib/html";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { StructuredAddressTextFields } from "../components/StructuredAddressFields";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
import { useMemo } from "react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

export function ReceiptsPage() {
  const society = useSociety();
  const items = useQuery(api.receipts.list, society ? { societyId: society._id } : "skip");
  const issue = useMutation(api.receipts.issue);
  const voidR = useMutation(api.receipts.voidReceipt);
  const prompt = usePrompt();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "donationReceipt",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const records = useMemo(
    () => (items ?? []).map((r: any) => ({ ...r, status: r.voidedAtISO ? "Voided" : "Issued" })),
    [items],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      charityNumber: "",
      donorName: "",
      donorEmail: "",
      donorAddress: "",
      amountDollars: "",
      eligibleAmountDollars: "",
      receivedOnISO: new Date().toISOString().slice(0, 10),
      location: society.registeredOfficeAddress ?? "Vancouver, BC",
      isNonCash: false,
    });
    setOpen(true);
  };
  const save = async () => {
    const amountCents = dollarInputToCents(form.amountDollars);
    const eligibleAmountCents = dollarInputToCents(form.eligibleAmountDollars);
    if (!amountCents || !eligibleAmountCents) {
      toast.error("Enter receipt amounts in dollars before issuing");
      return;
    }
    const { amountDollars, eligibleAmountDollars, ...rest } = form;
    await issue({ societyId: society._id, ...rest, amountCents, eligibleAmountCents });
    setOpen(false);
  };

  const exportReceipt = (r: any) => {
    const eh = escapeHtml;
    const bodyHtml = `
      <h1>Official Donation Receipt</h1>
      <p class="meta">Receipt no. <strong>${eh(r.receiptNumber)}</strong> · Issued ${eh(formatDate(r.issuedAtISO))} · ${eh(r.location)}</p>
      <p>${eh(society.name)}<br/>Charity registration number: <strong>${eh(r.charityNumber)}</strong></p>
      <h2>Donor</h2>
      <p>${eh(r.donorName)}${r.donorEmail ? `<br/>${eh(r.donorEmail)}` : ""}${r.donorAddress ? `<br/>${eh(r.donorAddress)}` : ""}</p>
      <h2>Gift</h2>
      <table>
        <tr><th>Date received</th><td>${eh(formatDate(r.receivedOnISO))}</td></tr>
        <tr><th>Total amount</th><td>${eh(money(r.amountCents))}</td></tr>
        <tr><th>Eligible amount for tax purposes</th><td>${eh(money(r.eligibleAmountCents))}</td></tr>
        ${r.isNonCash ? `<tr><th>Non-cash gift</th><td>${eh(r.description ?? "—")}${r.appraiserName ? ` · Appraised by ${eh(r.appraiserName)}` : ""}</td></tr>` : ""}
      </table>
      <p class="meta">Canada Revenue Agency: <a href="https://www.canada.ca/charities-giving">canada.ca/charities-giving</a></p>
      <p class="meta">Authorized signatory _______________________</p>
    `;
    void exportWordDocx({ filename: `receipt-${r.receiptNumber}.docx`, title: `Receipt ${r.receiptNumber}`, bodyHtml });
  };

  return (
    <div className="page">
      <PageHeader
        title="Donation receipts"
        icon={<Receipt size={16} />}
        iconColor="pink"
        subtitle={society.isCharity ? "CRA-compliant official donation receipts with serial numbering." : "Your society isn't flagged as a registered charity. Receipts are for reference only and won't be tax-deductible."}
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Issue receipt
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="donation receipt" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="receipts"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Receipt size={14} />}
            label="All receipts"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "receiptNumber") return <span className="mono">{record.receiptNumber}</span>;
              if (field.name === "receivedOnISO") return <span className="mono">{formatDate(record.receivedOnISO)}</span>;
              if (field.name === "amountCents") return <span className="mono">{money(record.amountCents)}</span>;
              if (field.name === "eligibleAmountCents") return <span className="mono">{money(record.eligibleAmountCents)}</span>;
              if (field.name === "status") return record.voidedAtISO ? <Badge tone="danger">Voided</Badge> : <Badge tone="success">Issued</Badge>;
              return undefined;
            }}
            renderRowActions={(r) => (
              <>
                <button className="btn btn--ghost btn--sm" onClick={() => exportReceipt(r)}>
                  <FileDown size={12} /> Export
                </button>
                {!r.voidedAtISO && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      const reason = await prompt({
                        title: "Void receipt",
                        message: "A voided receipt stays on file for the CRA audit trail but is marked as not issued.",
                        placeholder: "Reason (required)",
                        confirmLabel: "Void receipt",
                        required: true,
                      });
                      if (!reason) return;
                      await voidR({ id: r._id, reason });
                      toast.success("Receipt voided");
                    }}
                  >
                    Void
                  </button>
                )}
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Issue donation receipt"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Issue</button></>}
      >
        {form && (
          <div>
            <Field label="Charity registration #"><input className="input" value={form.charityNumber} onChange={(e) => setForm({ ...form, charityNumber: e.target.value })} /></Field>
            <Field label="Donor name"><input className="input" value={form.donorName} onChange={(e) => setForm({ ...form, donorName: e.target.value })} /></Field>
            <Field label="Donor email"><input className="input" value={form.donorEmail} onChange={(e) => setForm({ ...form, donorEmail: e.target.value })} /></Field>
            <StructuredAddressTextFields value={form.donorAddress} onChange={(donorAddress) => setForm({ ...form, donorAddress })} />
            <div className="row" style={{ gap: 12 }}>
              <Field label="Amount" hint="Dollars">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.amountDollars}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      amountDollars: e.target.value,
                      eligibleAmountDollars: form.eligibleAmountDollars || e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Eligible amount" hint="Dollars">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.eligibleAmountDollars}
                  onChange={(e) => setForm({ ...form, eligibleAmountDollars: e.target.value })}
                />
              </Field>
              <Field label="Received on"><DatePicker value={form.receivedOnISO} onChange={(value) => setForm({ ...form, receivedOnISO: value })} /></Field>
            </div>
            <Field label="Location issued"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.isNonCash} onChange={(e) => setForm({ ...form, isNonCash: e.target.checked })} /> Non-cash gift
            </label>
            {form.isNonCash && (
              <>
                <Field label="Description"><MarkdownEditor rows={4} value={form.description ?? ""} onChange={(markdown) => setForm({ ...form, description: markdown })} /></Field>
                <Field label="Appraiser"><input className="input" value={form.appraiserName ?? ""} onChange={(e) => setForm({ ...form, appraiserName: e.target.value })} /></Field>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
