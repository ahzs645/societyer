import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Receipt, Trash2, Tag, FileDown } from "lucide-react";
import { formatDate, money } from "../lib/format";
import { exportWordDoc, escapeHtml } from "../lib/exportWord";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";

const FIELDS: FilterField<any>[] = [
  { id: "nonCash", label: "Type", icon: <Tag size={14} />, options: ["Cash", "Non-cash"], match: (r, q) => (r.isNonCash ? "Non-cash" : "Cash") === q },
  { id: "voided", label: "Voided", options: ["Yes", "No"], match: (r, q) => (r.voidedAtISO ? "Yes" : "No") === q },
];

export function ReceiptsPage() {
  const society = useSociety();
  const items = useQuery(api.receipts.list, society ? { societyId: society._id } : "skip");
  const issue = useMutation(api.receipts.issue);
  const voidR = useMutation(api.receipts.voidReceipt);
  const remove = useMutation(api.receipts.remove);
  const prompt = usePrompt();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      charityNumber: "",
      donorName: "",
      donorEmail: "",
      donorAddress: "",
      amountCents: 0,
      eligibleAmountCents: 0,
      receivedOnISO: new Date().toISOString().slice(0, 10),
      location: society.registeredOfficeAddress ?? "Vancouver, BC",
      isNonCash: false,
    });
    setOpen(true);
  };
  const save = async () => {
    await issue({ societyId: society._id, ...form });
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
    exportWordDoc({ filename: `receipt-${r.receiptNumber}.doc`, title: `Receipt ${r.receiptNumber}`, bodyHtml });
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

      <DataTable
        label="All receipts"
        icon={<Receipt size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search donor, receipt #…"
        defaultSort={{ columnId: "issuedAtISO", dir: "desc" }}
        columns={[
          { id: "receiptNumber", header: "#", sortable: true, accessor: (r) => r.receiptNumber, render: (r) => <span className="mono">{r.receiptNumber}</span> },
          { id: "donorName", header: "Donor", sortable: true, accessor: (r) => r.donorName, render: (r) => <strong>{r.donorName}</strong> },
          { id: "receivedOnISO", header: "Received", sortable: true, accessor: (r) => r.receivedOnISO, render: (r) => <span className="mono">{formatDate(r.receivedOnISO)}</span> },
          { id: "amountCents", header: "Amount", sortable: true, align: "right", accessor: (r) => r.amountCents, render: (r) => <span className="mono">{money(r.amountCents)}</span> },
          { id: "eligibleAmountCents", header: "Eligible", align: "right", accessor: (r) => r.eligibleAmountCents, render: (r) => <span className="mono">{money(r.eligibleAmountCents)}</span> },
          { id: "status", header: "Status", render: (r) => r.voidedAtISO ? <Badge tone="danger">Voided</Badge> : <Badge tone="success">Issued</Badge> },
        ]}
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
            <button className="btn btn--ghost btn--sm btn--icon" onClick={() => remove({ id: r._id })}><Trash2 size={12} /></button>
          </>
        )}
      />

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
            <Field label="Donor address"><textarea className="textarea" value={form.donorAddress} onChange={(e) => setForm({ ...form, donorAddress: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Amount (cents)"><input className="input" type="number" value={form.amountCents} onChange={(e) => setForm({ ...form, amountCents: Number(e.target.value), eligibleAmountCents: Number(e.target.value) })} /></Field>
              <Field label="Eligible amount (cents)"><input className="input" type="number" value={form.eligibleAmountCents} onChange={(e) => setForm({ ...form, eligibleAmountCents: Number(e.target.value) })} /></Field>
              <Field label="Received on"><input className="input" type="date" value={form.receivedOnISO} onChange={(e) => setForm({ ...form, receivedOnISO: e.target.value })} /></Field>
            </div>
            <Field label="Location issued"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.isNonCash} onChange={(e) => setForm({ ...form, isNonCash: e.target.checked })} /> Non-cash gift
            </label>
            {form.isNonCash && (
              <>
                <Field label="Description"><textarea className="textarea" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <Field label="Appraiser"><input className="input" value={form.appraiserName ?? ""} onChange={(e) => setForm({ ...form, appraiserName: e.target.value })} /></Field>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
