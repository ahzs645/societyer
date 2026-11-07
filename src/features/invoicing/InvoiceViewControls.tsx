import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { useToast } from "../../components/Toast";
import { parseMoneyInput } from "../../lib/money";
import { cleanInvoiceListView, DEFAULT_INVOICE_LIST_VIEW, type InvoiceListView } from "../../../shared/billingPricing";

type SavedView = { _id: string; name: string; config: InvoiceListView };
export function InvoiceViewControls({ societyId, value, onChange, compact = false }: {
  societyId: string;
  value: InvoiceListView;
  onChange: (value: InvoiceListView) => void;
  /** Phones: a single icon button in the tab row. Saved views move into its drawer. */
  compact?: boolean;
}) {
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
  const savedViews = data?.views ?? [];
  const activeFilters = [value.fromDate, value.toDate, value.dueFrom, value.dueTo, value.minimumBalanceCents, value.maximumBalanceCents].filter(entry => entry !== "" && entry != null).length;
  // Only worth showing once there is a saved view to switch to.
  const viewPicker = (savedViews.length > 0 || id) ? <label><span className="invoice-view-controls__label">Saved view</span> <select className="input" aria-label="Saved invoice view" value={id} onChange={event => {
      const found = savedViews.find(view => view._id === event.target.value);
      setId(found?._id ?? ""); setName(found?.name ?? ""); setError("");
      onChange(found ? cleanInvoiceListView(found.config) : cleanInvoiceListView(DEFAULT_INVOICE_LIST_VIEW));
    }}><option value="">Default view</option>{savedViews.map(view => <option key={view._id} value={view._id}>{view.name}</option>)}</select></label> : null;
  return <div className={`invoice-view-controls${compact ? " invoice-view-controls--compact" : ""}`}>
    {!compact && viewPicker}
    <button
      className={compact ? "btn btn--ghost btn--icon invoice-view-controls__toggle" : "btn btn--sm"}
      aria-label={activeFilters ? `Filters and columns, ${activeFilters} active` : "Filters and columns"}
      onClick={() => { setError(""); setOpen(true); }}
    >
      {compact ? <SlidersHorizontal size={15} aria-hidden="true" /> : "Filters and columns"}
      {compact && activeFilters > 0 && <span className="invoice-view-controls__dot" aria-hidden="true" />}
    </button>
    <Drawer title="Invoice view" open={open} onClose={() => !busy && setOpen(false)} footer={<button className="btn btn--accent" onClick={() => {try {onChange(cleanInvoiceListView(value));setOpen(false);}catch(e){setError(e instanceof Error ? e.message : "Choose a valid view.");}}}>Apply view</button>}>
      <div className="form-stack">
        {error && <p role="alert" className="field__error">{error}</p>}
        {compact && viewPicker}
        <p className="muted">Filters persist in the page address. Save named views to your own account for reuse.</p>
        <Field label="View name"><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={100} /></Field>
        <div className="invoice-view-actions"><button className="btn" disabled={busy || !name.trim()} onClick={() => void submit(false)}>{id ? "Update saved view" : "Save view"}</button>{id && <><button className="btn" disabled={busy || !name.trim()} onClick={() => void submit(true)}>Save copy</button><button className="btn btn--danger" disabled={busy} onClick={async () => { setBusy(true); try { await remove({ societyId, id }); setId(""); setName(""); toast.success("View removed"); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove view."); } finally { setBusy(false); } }}>Delete saved view</button></>}</div>
        <div className="invoice-view-grid">
          {([['fromDate', 'Issued from'], ['toDate', 'Issued to'], ['dueFrom', 'Due from'], ['dueTo', 'Due to']] as const).map(([key,label]) => <Field key={key} label={label}><input className="input" type="date" value={value[key]} onChange={e => change({ [key]: e.target.value })} /></Field>)}
          {([['minimumBalanceCents', 'Minimum balance'], ['maximumBalanceCents', 'Maximum balance']] as const).map(([key,label]) => <Field key={key} label={label}><input className="input" type="number" step="0.01" value={value[key] == null ? "" : value[key]! / 100} onChange={e => change({ [key]: e.target.value === "" ? null : parseMoneyInput(e.target.value) })} /></Field>)}
        </div>
        <h3 className="invoice-section-heading">Columns</h3><p className="muted">Visible columns, labels and order also control invoice list exports. Widths are in pixels.</p>
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
