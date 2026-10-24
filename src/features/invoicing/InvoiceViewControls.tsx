import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { useToast } from "../../components/Toast";
import { parseMoneyInput } from "../../lib/money";
import { cleanInvoiceListView, DEFAULT_INVOICE_LIST_VIEW, type InvoiceListView } from "../../../shared/billingPricing";

type SavedView = { _id: string; name: string; config: InvoiceListView };
export function InvoiceViewControls({ societyId, value, onChange }: { societyId: string; value: InvoiceListView; onChange: (value: InvoiceListView) => void }) {
  const data = useQuery(api.invoicePreferences.workspace, { societyId }) as { views: SavedView[] } | undefined;
  const save = useMutation(api.invoicePreferences.saveView), remove = useMutation(api.invoicePreferences.removeView);
  const toast = useToast();
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [id, setId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const change = (patch: Partial<InvoiceListView>) => onChange({ ...value, ...patch });
  const submit = async (copy: boolean) => {
    setBusy(true); setError("");
    try { const config = cleanInvoiceListView(value); const savedId = await save({ societyId, id: copy ? undefined : id || undefined, name, config }); setId(savedId); toast.success("Invoice view saved"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save view."); }
    finally { setBusy(false); }
  };
  const move = (index: number, delta: number) => {
    const columns = value.columns.map(column => ({ ...column })), next = index + delta;
    if (next < 0 || next >= columns.length) return;
    [columns[index], columns[next]] = [columns[next], columns[index]]; change({ columns });
  };
  return <div className="invoice-view-controls">
    <label>Saved view <select className="input" aria-label="Saved invoice view" value={id} onChange={event => {
      const found = data?.views.find(view => view._id === event.target.value);
      setId(found?._id ?? ""); setName(found?.name ?? ""); setError("");
      onChange(found ? cleanInvoiceListView(found.config) : cleanInvoiceListView(DEFAULT_INVOICE_LIST_VIEW));
    }}><option value="">Default view</option>{data?.views.map(view => <option key={view._id} value={view._id}>{view.name}</option>)}</select></label>
    <button className="btn btn--sm" onClick={() => { setError(""); setOpen(true); }}>Filters and columns</button>
    <Drawer title="Invoice view" open={open} onClose={() => !busy && setOpen(false)} footer={<button className="btn btn--accent" onClick={() => {try {onChange(cleanInvoiceListView(value));setOpen(false);}catch(e){setError(e instanceof Error ? e.message : "Choose a valid view.");}}}>Apply view</button>}>
      <div className="form-stack">
        {error && <p role="alert" className="field__error">{error}</p>}
        <p className="muted">Filters persist in the page address. Save named views to your own account for reuse.</p>
        <Field label="View name"><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={100} /></Field>
        <div className="invoice-view-actions"><button className="btn" disabled={busy || !name.trim()} onClick={() => void submit(false)}>{id ? "Update saved view" : "Save view"}</button>{id && <><button className="btn" disabled={busy || !name.trim()} onClick={() => void submit(true)}>Save copy</button><button className="btn btn--danger" disabled={busy} onClick={async () => { setBusy(true); try { await remove({ societyId, id }); setId(""); setName(""); toast.success("View removed"); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove view."); } finally { setBusy(false); } }}>Delete saved view</button></>}</div>
        <div className="invoice-view-grid">
          {([['fromDate', 'Issued from'], ['toDate', 'Issued to'], ['dueFrom', 'Due from'], ['dueTo', 'Due to']] as const).map(([key,label]) => <Field key={key} label={label}><input className="input" type="date" value={value[key]} onChange={e => change({ [key]: e.target.value })} /></Field>)}
          {([['minimumBalanceCents', 'Minimum balance'], ['maximumBalanceCents', 'Maximum balance']] as const).map(([key,label]) => <Field key={key} label={label}><input className="input" type="number" step="0.01" value={value[key] == null ? "" : value[key]! / 100} onChange={e => change({ [key]: e.target.value === "" ? null : parseMoneyInput(e.target.value) })} /></Field>)}
        </div>
        <h3>Columns</h3><p className="muted">Visible columns, labels and order also control invoice list exports. Widths are in pixels.</p>
        {value.columns.map((column,index) => <div className="invoice-view-column" key={column.key}>
          <Checkbox checked={column.visible} label={DEFAULT_INVOICE_LIST_VIEW.columns.find(c => c.key === column.key)!.label} onChange={visible => change({ columns: value.columns.map(c => c.key === column.key ? { ...c, visible } : c) })} />
          <input className="input" aria-label={`${column.key} column label`} value={column.label} maxLength={80} onChange={e => change({ columns: value.columns.map(c => c.key === column.key ? { ...c, label: e.target.value } : c) })} />
          <input className="input" aria-label={`${column.key} column width`} type="number" min="60" max="600" value={column.width} onChange={e => change({ columns: value.columns.map(c => c.key === column.key ? { ...c, width: Number(e.target.value) } : c) })} />
          <button className="btn btn--sm" aria-label={`Move ${column.key} up`} disabled={index === 0} onClick={() => move(index,-1)}>↑</button><button className="btn btn--sm" aria-label={`Move ${column.key} down`} disabled={index === value.columns.length-1} onClick={() => move(index,1)}>↓</button>
        </div>)}
        <button className="btn" onClick={() => onChange(cleanInvoiceListView(DEFAULT_INVOICE_LIST_VIEW))}>Reset filters and columns</button>
      </div>
    </Drawer>
  </div>;
}
