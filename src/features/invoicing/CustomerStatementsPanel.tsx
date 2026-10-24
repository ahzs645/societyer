import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Eye, Save } from "lucide-react";
import { api } from "@/lib/convexApi";
import { EmptyState, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { addDays, isCalendarDate, partyKey } from "../../../shared/invoicing";
import { INVOICE_CURRENCIES } from "../../../shared/invoiceCommerce";
import type { CustomerStatement } from "../../../shared/billingDocuments";
import { BillingDocumentPreview } from "./BillingDocumentPreview";
import { BillingDocumentPagination, useBillingDocumentPagination } from "./BillingDocumentPagination";
import { statementDocument } from "./billingDocuments";
import type { InvoiceWorkspace } from "./types";

type Props = { workspace: InvoiceWorkspace; societyId: string; canExport: boolean; initialCustomerKey?: string; initialCurrency?: string };
export function CustomerStatementsPanel({ workspace, societyId, canExport, initialCustomerKey, initialCurrency }: Props) {
  const [currency, setCurrency] = useState(initialCurrency ?? workspace.ledger.workspaceCurrency), [customerKey, setCustomerKey] = useState(initialCustomerKey ?? ""), [from, setFrom] = useState(addDays(workspace.today, -90)), [to, setTo] = useState(workspace.today), [templateId, setTemplateId] = useState(workspace.settings.defaultTemplateId ?? "");
  const [preview, setPreview] = useState<CustomerStatement | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const customers = [...new Map(workspace.invoices.filter((invoice) => invoice.currency === currency).map((invoice) => [partyKey(invoice), { key: partyKey(invoice), name: invoice.billToName }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const selectedKey = customers.some((customer) => customer.key === customerKey) ? customerKey : customers[0]?.key ?? "";
  const validDates = isCalendarDate(from) && isCalendarDate(to) && from <= to;
  const args = { societyId, customerKey: selectedKey, currency, from, to, ...(templateId ? { templateId } : {}) };
  const statement = useQuery(api.billingDocuments.customerStatement, selectedKey && validDates ? args : "skip") as CustomerStatement | undefined;
  const historyPagination = useBillingDocumentPagination(`${societyId}:${selectedKey}:${currency}`);
  const history = useQuery(api.billingDocuments.workspace, selectedKey ? { societyId, collection: "statements", customerKey: selectedKey, currency, cursor: historyPagination.cursor } : "skip") as { statements: Array<{ _id: string; customerKey: string; statement: CustomerStatement; createdAtISO: string }>; isDone: boolean; continueCursor: string } | undefined;
  const saveSnapshot = useMutation(api.billingDocuments.saveStatementSnapshot), toast = useToast();
  const save = async () => { if (!statement || !canExport || busy) return; setBusy(true); setError(""); try { await saveSnapshot(args); historyPagination.reset(); toast.success("Statement snapshot saved"); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save statement."); } finally { setBusy(false); } };
  return <div className="card invoice-card"><div className="card__head"><div><h2 className="card__title">Customer statements</h2><span className="card__subtitle">Dated invoices, payments, credit notes, write-offs and refunds with opening and running account balances.</span></div></div>
    <div className="card__body form-stack"><div className="invoice-commerce-grid"><Field label="Statement currency"><Select value={currency} onChange={(value) => { setCurrency(value); setCustomerKey(""); }} options={INVOICE_CURRENCIES.map((value) => ({ value, label: value }))} /></Field><Field label="Statement customer"><Select value={selectedKey} onChange={setCustomerKey} options={customers.map((customer) => ({ value: customer.key, label: customer.name }))} /></Field><Field label="Statement from"><DatePicker value={from} clearable={false} onChange={(value) => value && setFrom(value)} /></Field><Field label="Statement to"><DatePicker value={to} min={from} clearable={false} onChange={(value) => value && setTo(value)} /></Field><Field label="Statement template"><Select value={templateId} onChange={setTemplateId} options={[{ value: "", label: "Workspace default" }, ...(workspace.templates ?? []).filter((template) => template.active).map((template) => ({ value: template._id, label: template.config.name }))]} /></Field></div>
      {error && <p className="field__error" role="alert">{error}</p>}{!validDates && <p className="field__error" role="alert">Choose a date range with the start before the end.</p>}
      {!customers.length ? <EmptyState title="No invoices in this currency" description="Customer statements appear after creating customer invoices." /> : !statement ? <p className="muted">Loading statement…</p> : <><div className="invoice-commerce-grid"><div>Opening balance<br /><strong><Money cents={statement.openingCents} currency={currency} /></strong></div><div>Charges / refunds<br /><strong><Money cents={statement.chargeCents} currency={currency} /></strong></div><div>Payments / credits<br /><strong><Money cents={statement.creditCents} currency={currency} /></strong></div><div>Closing balance<br /><strong><Money cents={statement.closingCents} currency={currency} /> {currency}</strong></div></div><div className="invoice-commerce-actions"><button className="btn btn--sm" onClick={() => setPreview(statement)}><Eye size={14} />Preview statement</button><button className="btn btn--sm" disabled={!canExport || busy} onClick={() => void save()}><Save size={14} />Save statement snapshot</button></div>
        <div className="invoice-commerce-table"><table className="table table--comfortable invoice-table"><thead><tr><th>Date</th><th>Movement</th><th>Reference</th><th className="num">Charges</th><th className="num">Credits</th><th className="num">Balance</th></tr></thead><tbody>{statement.rows.map((row, index) => <tr key={index}><td>{row.date}</td><td>{row.kind}<span className="muted invoice-table__sub">{row.description}</span></td><td>{row.reference}</td><td className="num"><Money cents={row.chargeCents} currency={currency} /></td><td className="num"><Money cents={row.creditCents} currency={currency} /></td><td className="num"><Money cents={row.balanceCents} currency={currency} /></td></tr>)}</tbody></table></div>{!statement.rows.length && <p className="muted">No movements in this period. The opening balance carries forward.</p>}</>}
      <h3>Saved statement snapshots</h3>{history?.statements.map((saved) => <div key={saved._id}><button className="btn btn--sm" onClick={() => setPreview(saved.statement)}>{saved.statement.from} – {saved.statement.to} · Saved {saved.createdAtISO.slice(0, 10)}</button></div>)}{selectedKey && <BillingDocumentPagination label="statements" pagination={historyPagination} result={history} />}
    </div>
    {preview && <BillingDocumentPreview title={`Statement · ${preview.customerName}`} document={statementDocument(preview)} organization={workspace.organization} downloadLabel="Download statement PDF" canExport={canExport} onClose={() => setPreview(null)} />}
  </div>;
}
