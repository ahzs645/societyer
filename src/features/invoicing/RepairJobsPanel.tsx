import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Eye, Plus, Wrench } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, EmptyState, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { INVOICE_CURRENCIES, REPAIR_STATUS_LABEL, REPAIR_TRANSITIONS, type RepairStatus } from "../../../shared/invoiceCommerce";
import { BillToPicker, type BillToValue } from "./BillToPicker";
import { LineItemsEditor, toLineDraft, type LineDraft } from "./LineItemsEditor";
import { BillingDocumentPreview } from "./BillingDocumentPreview";
import { defaultDocumentTemplate, repairWorkOrderDocument } from "./billingDocuments";
import { RepairOperationsPanel, RepairWorkloadBoard } from "./RepairOperationsPanel";
import type { InvoiceWorkspace, RepairJob } from "./types";

type Draft = BillToValue & { id?: string; asset: string; serialNumber: string; problem: string; notes: string; receivedDate: string; targetDate: string; currency: string; lines: LineDraft[] };
export function RepairJobsPanel({ workspace, societyId, canWrite, canExport, logoUrl, onOpenInvoice, focusId }: { workspace: InvoiceWorkspace; societyId: string; canWrite: boolean; canExport: boolean; logoUrl?: string | null; onOpenInvoice: (id: string) => void; focusId?: string | null }) {
  const save = useMutation(api.invoices.upsertRepairJob);
  const createCounterparty = useMutation(api.accounting.upsertCounterparty);
  const setStatus = useMutation(api.billingDocuments.setRepairStatus);
  const invoiceRepair = useMutation(api.billingDocuments.invoiceRepair);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("open");
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const update = (patch: Partial<Draft>) => setDraft((current) => current && ({ ...current, ...patch }));
  const jobs = workspace.repairJobs ?? [];
  const detail = jobs.find((job) => job._id === detailId);
  const workOrder = jobs.find((job) => job._id === workOrderId);
  const workOrderData = useQuery(api.billingDocuments.repairOperations, workOrder ? { societyId, repairJobId: workOrder._id } : "skip") as { operations: Array<{ technicianUserId?: string; scheduledDate?: string; approvalRequired: boolean; approvalStatus: string; approvalStale?: boolean; approvalCustomerName?: string }>; technicians: Array<{ _id: string; name: string }>; entries: Array<{ durationMinutes?: number }> } | undefined;
  const workOrderOperation = workOrderData?.operations[0];
  const workOrderDetails = workOrderData ? [
    ...(workOrderOperation?.technicianUserId ? [{ label: "Assigned technician", value: workOrderData.technicians.find((person) => person._id === workOrderOperation.technicianUserId)?.name ?? workOrderOperation.technicianUserId }] : []),
    ...(workOrderOperation?.scheduledDate ? [{ label: "Scheduled date", value: workOrderOperation.scheduledDate }] : []),
    { label: "Customer approval", value: workOrderOperation?.approvalRequired ? workOrderOperation.approvalStale ? "Required for current scope" : `${workOrderOperation.approvalStatus}${workOrderOperation.approvalCustomerName ? ` · ${workOrderOperation.approvalCustomerName}` : ""}` : "Not required" },
    { label: "Logged labour", value: `${workOrderData.entries.reduce((sum, entry) => sum + (entry.durationMinutes ?? 0), 0).toFixed(1)} minutes` },
  ] : [];
  const templates = (workspace.templates ?? []).filter((template) => template.active);
  const workOrderTemplate = templates.find((template) => template._id === templateId)?.config ?? defaultDocumentTemplate(workspace);
  const editing = jobs.find((job) => job._id === draft?.id);
  const billed = Boolean(editing?.invoice);
  const open = (job?: RepairJob) => { setError(""); setDetailId(null); setDraft({ id: job?._id, partyKind: job?.partyKind ?? "custom", memberId: job?.memberId, counterpartyId: job?.counterpartyId, billToName: job?.billToName ?? "", billToEmail: job?.billToEmail, billToAddress: job?.billToAddress, asset: job?.asset ?? "", serialNumber: job?.serialNumber ?? "", problem: job?.problem ?? "", notes: job?.notes ?? "", receivedDate: job?.receivedDate ?? workspace.today, targetDate: job?.targetDate ?? "", currency: job?.currency ?? workspace.ledger.workspaceCurrency, lines: (job?.lines ?? []).map(toLineDraft) }); };
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update repair."); } finally { setBusy(false); } };
  const createCustomer = async (name: string) => {
    try { return await createCounterparty({ societyId, name, kind: "customer", provider: "societyer" }) as string; }
    catch (e) { toast.error("Could not save customer", e instanceof Error ? e.message : undefined); return undefined; }
  };
  const submit = () => run(async () => {
    if (!draft) return;
    const id = await save({ ...draft, societyId, targetDate: draft.targetDate || undefined, lines: draft.lines.map(({ qtyInput: _q, priceInput: _p, ...line }) => line) });
    setDraft(null); setDetailId(id); toast.success("Repair saved");
  });
  const bill = (job: RepairJob) => run(async () => { const id = await invoiceRepair({ id: job._id }); setDetailId(null); onOpenInvoice(id); });
  const visible = jobs.filter((job) => filter === "all" || (filter === "open" ? !["completed", "cancelled"].includes(job.status) : job.status === filter));
  return <div className="card invoice-card">
    <div className="card__head"><div><h2 className="card__title">Repairs</h2><span className="card__subtitle">Track intake, diagnosis, approval, work, and pickup. Parts and labour become a linked invoice.</span></div><button className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => open()}><Plus size={14} /> New repair</button></div>
    <RepairWorkloadBoard societyId={societyId} jobs={jobs} onOpenRepair={(id) => { setError(""); setDetailId(id); }} />
    <div className="card__body"><Select aria-label="Repair status filter" value={filter} onChange={setFilter} options={[{ value: "open", label: "Open repairs" }, { value: "all", label: "All repairs" }, ...Object.entries(REPAIR_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} /></div>
    {!visible.length ? <EmptyState icon={<Wrench size={20} />} title="No repairs in this view" description="Create a repair to record the customer, equipment, problem, parts, and service rates." /> : <div className="invoice-commerce-table"><table className="table table--comfortable invoice-table"><thead><tr><th>Repair</th><th>Customer / equipment</th><th>Status</th><th>Target</th><th className="num">Estimate</th><th>Invoice</th></tr></thead><tbody>
      {visible.map((job) => <tr key={job._id}><td data-label="Repair"><button className="invoice-table__link" onClick={() => { setError(""); setDetailId(job._id); }}>{job.number}</button></td><td data-label="Customer">{job.billToName}<span className="muted invoice-table__sub">{job.asset}{job.serialNumber ? ` · ${job.serialNumber}` : ""}</span></td><td data-label="Status"><Badge>{REPAIR_STATUS_LABEL[job.status]}</Badge></td><td data-label="Target">{job.targetDate ? formatDate(job.targetDate) : "—"}</td><td data-label="Estimate" className="num"><Money cents={job.totalCents} currency={job.currency} /> {job.currency}</td><td data-label="Invoice">{job.invoice ? <button className="invoice-table__link" onClick={() => onOpenInvoice(job.invoice!._id)}>{job.invoice.number} · {job.invoice.status}</button> : "Not invoiced"}</td></tr>)}
    </tbody></table></div>}
    <Drawer open={Boolean(detail)} title={detail?.number ?? "Repair"} onClose={() => !busy && setDetailId(null)} footer={detail && <><button className="btn" disabled={!canWrite || busy} onClick={() => open(detail)}>Edit repair</button><button className="btn btn--accent" disabled={busy || (!detail.invoice && (!canWrite || detail.status === "cancelled" || !detail.lines.length))} onClick={() => detail.invoice ? onOpenInvoice(detail.invoice._id) : void bill(detail)}>{detail.invoice ? "View invoice" : "Create invoice"}</button></>}>
      {error && <p className="field__error" role="alert">{error}</p>}{detail && <div className="form-stack"><h3>{detail.asset}</h3><p>{detail.billToName}{detail.serialNumber ? ` · Serial ${detail.serialNumber}` : ""}</p><p className="invoice-commerce-notes">{detail.problem}</p>
        <div><button type="button" className="btn btn--sm" onClick={() => { setTemplateId(workspace.settings.defaultTemplateId ?? ""); setWorkOrderId(detail._id); }}><Eye size={14} aria-hidden="true" />Preview work order</button></div>
        <Field label="Status"><Select value={detail.status} disabled={!canWrite || busy} onChange={(status) => void run(() => setStatus({ id: detail._id, status: status as RepairStatus }))} options={[detail.status, ...REPAIR_TRANSITIONS[detail.status]].map((value) => ({ value, label: REPAIR_STATUS_LABEL[value] }))} /></Field>
        <p>Received {formatDate(detail.receivedDate)}{detail.targetDate ? ` · Target ${formatDate(detail.targetDate)}` : ""}</p><p className="invoice-commerce-notes">{detail.notes}</p>
        <h3>Parts and services</h3>{detail.lines.map((line) => <p key={line.key}>{line.item} · {line.quantity} {line.unit ?? "each"} × <Money cents={line.unitPriceCents} currency={detail.currency} /></p>)}
        <strong>Estimate <Money cents={detail.totalCents} currency={detail.currency} /> {detail.currency}</strong>
        {detail.invoice && <p>Invoice {detail.invoice.number} · {detail.invoice.status} · Balance <Money cents={detail.invoice.balanceCents} currency={detail.invoice.currency} /></p>}
        <RepairOperationsPanel societyId={societyId} job={detail} today={workspace.today} canWrite={canWrite} />
        <h3>History</h3>{detail.timeline.map((event, i) => <p key={`${event.atISO}-${i}`} className="muted">{formatDate(event.atISO.slice(0, 10))} · {event.label}{event.actorName ? ` · ${event.actorName}` : ""}</p>)}
      </div>}
    </Drawer>
    <Drawer open={Boolean(draft)} title={draft?.id ? "Edit repair" : "New repair"} onClose={() => !busy && setDraft(null)} footer={<><button className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void submit()}>Save repair</button></>}>
      {error && <p className="field__error" role="alert">{error}</p>}{draft && <div className="form-stack">
        <BillToPicker value={draft} onChange={(party) => update({ ...party })} members={workspace.parties.members} organizations={workspace.parties.organizations} showMembers={workspace.parties.members.length > 0} onCreateOrganization={canWrite ? createCustomer : undefined} disabled={billed} />
        <Field label="Equipment / item"><input className="input" value={draft.asset} onChange={(e) => update({ asset: e.target.value })} /></Field>
        <Field label="Serial number"><input className="input" value={draft.serialNumber} onChange={(e) => update({ serialNumber: e.target.value })} /></Field>
        <Field label="Problem reported"><textarea className="input textarea" rows={3} value={draft.problem} onChange={(e) => update({ problem: e.target.value })} /></Field>
        <Field label="Received"><DatePicker value={draft.receivedDate} clearable={false} onChange={(receivedDate) => receivedDate && update({ receivedDate })} /></Field>
        <Field label="Target date"><DatePicker value={draft.targetDate} min={draft.receivedDate} onChange={(targetDate) => update({ targetDate })} /></Field>
        <Field label="Currency"><Select value={draft.currency} disabled={billed || draft.lines.length > 0} onChange={(currency) => update({ currency })} options={INVOICE_CURRENCIES.map((value) => ({ value, label: value }))} /></Field>
        {billed && <p className="muted">Billing is on the linked invoice. You can continue updating repair notes and status here.</p>}
        <LineItemsEditor lines={draft.lines} onChange={(lines) => update({ lines })} catalog={workspace.catalog.filter((item) => item.active && (item.currency ?? workspace.ledger.workspaceCurrency) === draft.currency)} currency={draft.currency} readOnly={billed} gstHint={false} />
        <Field label="Work notes"><textarea className="input textarea" rows={4} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} /></Field>
      </div>}
    </Drawer>
    {workOrder && <BillingDocumentPreview title={`Work order ${workOrder.number}`} document={repairWorkOrderDocument(workOrder, workOrderTemplate, workOrderDetails)} organization={{ ...workspace.organization, logoUrl }} downloadLabel="Download work order PDF" canExport={canExport && Boolean(workOrderData)} onClose={() => setWorkOrderId(null)} controls={<><Field label="Document template"><Select value={templates.some((template) => template._id === templateId) ? templateId : ""} onChange={setTemplateId} options={[{ value: "", label: "Workspace default" }, ...templates.map((template) => ({ value: template._id, label: template.config.name }))]} /></Field>{!workOrderData && <p role="status">Loading dispatch and approval details…</p>}</>} />}
  </div>;
}
