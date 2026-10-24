import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useFinancePermissions } from "../../hooks/useFinancePermissions";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { useToast } from "../../components/Toast";
import type { BillingAutomationKind, BillingCadence } from "../../../shared/billingAutomation";
export function BillingScheduleForm({ societyId, definitionId, reportName, schedule, onSaved, onCancel }: { societyId: string; definitionId?: string; reportName?: string; schedule?: any; onSaved?: () => void; onCancel?: () => void }) {
  const permissions = useFinancePermissions();
  const save = useMutation(api.billingAutomation.saveSchedule), toast = useToast();
  const [draft, setDraft] = useState(() => ({ name: schedule?.name ?? (reportName ? `${reportName} delivery` : ""), kind: (schedule?.kind ?? (definitionId ? "report" : "recurring_invoice")) as BillingAutomationKind, sourceId: schedule?.sourceId ?? definitionId ?? "", templateId: schedule?.templateId ?? "", recipients: (schedule?.recipients ?? []).join(", "), recipientsConfirmed: schedule?.recipientsConfirmed ?? false, timezone: schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC", localTime: schedule?.localTime ?? "09:00", cadence: (schedule?.cadence ?? "monthly") as BillingCadence, startDate: schedule?.nextLocalDate ?? new Date().toISOString().slice(0, 10), active: schedule?.active ?? false }));
  const [editingId, setEditingId] = useState<string | undefined>(schedule?._id);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [sourceCursor, setSourceCursor] = useState<string | null>(null), [sourcePrior, setSourcePrior] = useState<any[]>([]), [templateCursor, setTemplateCursor] = useState<string | null>(null), [templatePrior, setTemplatePrior] = useState<any[]>([]);
  const sources = useQuery(api.billingAutomation.sourcePage, { societyId, kind: draft.kind, cursor: sourceCursor, selectedId: draft.sourceId || undefined }) as any;
  const templates = useQuery(api.billingAutomation.sourcePage, { societyId, kind: "template", cursor: templateCursor, selectedId: draft.templateId || undefined }) as any;
  const unique = (rows: any[]) => [...new Map(rows.map(row => [row.id, row])).values()];
  const choices = unique([...sourcePrior, ...(sources?.page ?? []), ...(sources?.selected ? [sources.selected] : [])]);
  const templateChoices = unique([...templatePrior, ...(templates?.page ?? []), ...(templates?.selected ? [templates.selected] : [])]);
  useEffect(() => {
    const existing = sources?.existingSchedule;
    if (!existing || editingId || draft.kind !== "recurring_invoice" || existing.sourceId !== draft.sourceId) return;
    setEditingId(existing._id);
    setDraft({ name: existing.name, kind: existing.kind, sourceId: existing.sourceId, templateId: existing.templateId ?? "", recipients: existing.recipients.join(", "), recipientsConfirmed: existing.recipientsConfirmed, timezone: existing.timezone, localTime: existing.localTime, cadence: existing.cadence, startDate: existing.nextLocalDate, active: existing.active });
  }, [sources?.existingSchedule, editingId, draft.kind, draft.sourceId]);
  const submit = async () => { setBusy(true); setError(""); try { await save({ societyId, id: editingId, ...draft, templateId: draft.templateId || undefined, recipients: draft.recipients.split(/[,;\n]/).map((r: string) => r.trim()).filter(Boolean) }); toast.success("Delivery schedule saved"); onSaved?.(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save schedule."); } finally { setBusy(false); } };
  return <div className="form-stack" aria-label="Delivery schedule settings">
    {editingId && !schedule?._id && <p className="muted">Editing the existing recurring delivery schedule.</p>}
    {error && <p role="alert" className="field__error">{error}</p>}
    <Field label="Schedule name"><input className="input" aria-label="Schedule name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
    {!definitionId && <Field label="Automation type"><select className="input" aria-label="Automation type" value={draft.kind} onChange={e => { setDraft({ ...draft, kind: e.target.value as BillingAutomationKind, sourceId: "" }); setSourceCursor(null); setSourcePrior([]); if (!schedule?._id) setEditingId(undefined); }}><option value="recurring_invoice">Recurring invoice creation and delivery</option><option value="invoice_reminder">Unpaid invoice reminder</option><option value="report">Saved financial report delivery</option></select></Field>}
    <Field label={draft.kind === "report" ? "Saved report" : draft.kind === "invoice_reminder" ? "Invoice to remind" : "Recurring series"}><select className="input" aria-label="Schedule source" disabled={Boolean(definitionId)} value={draft.sourceId} onChange={e => { if (!schedule?._id) setEditingId(undefined); const choice = choices?.find((c: any) => c.id === e.target.value); setDraft({ ...draft, sourceId: e.target.value, recipients: draft.recipients || choice?.email || "" }); }}><option value="">Choose a source</option>{draft.sourceId && !choices.some(row => row.id === draft.sourceId) && <option value={draft.sourceId}>{reportName ?? "Selected source (loading or unavailable)"}</option>}{choices.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
    {sources && !sources.isDone && <button className="btn btn--sm" onClick={() => { setSourcePrior(unique([...sourcePrior, ...sources.page])); setSourceCursor(sources.continueCursor); }}>Load more sources ({choices.length} available loaded)</button>}
    <Field label="PDF template"><select className="input" aria-label="Schedule PDF template" value={draft.templateId} onChange={e => setDraft({ ...draft, templateId: e.target.value })}><option value="">{draft.kind === "report" ? "Organization branding" : "Invoice’s saved design"}</option>{templateChoices.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
    {templates && !templates.isDone && <button className="btn btn--sm" onClick={() => { setTemplatePrior(unique([...templatePrior, ...templates.page])); setTemplateCursor(templates.continueCursor); }}>Load more templates ({templateChoices.length} available loaded)</button>}
    <Field label="Recipients"><textarea className="input" aria-label="Schedule recipients" value={draft.recipients} placeholder="billing@example.com, treasurer@example.com" onChange={e => setDraft({ ...draft, recipients: e.target.value })} /></Field>
    <Checkbox label="These recipients are authorized to receive this document" checked={draft.recipientsConfirmed} onChange={recipientsConfirmed => setDraft({ ...draft, recipientsConfirmed })} />
    <div className="invoice-view-grid"><Field label="Timezone"><input className="input" aria-label="Delivery timezone" value={draft.timezone} onChange={e => setDraft({ ...draft, timezone: e.target.value })} placeholder="America/Vancouver" /></Field><Field label="Local delivery time"><input className="input" aria-label="Local delivery time" type="time" value={draft.localTime} onChange={e => setDraft({ ...draft, localTime: e.target.value })} /></Field></div>
    {draft.kind !== "recurring_invoice" && <div className="invoice-view-grid"><Field label="First delivery date"><input className="input" aria-label="First delivery date" type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></Field><Field label="Repeat"><select className="input" aria-label="Delivery cadence" value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: e.target.value as BillingCadence })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field></div>}
    <p className="muted">{draft.kind === "recurring_invoice" ? "Issue dates and frequency come from the recurring series. Pausing the series also stops automatic issuance." : draft.kind === "report" ? "Each delivery uses this saved report’s exact filters, columns, calculations and graphs. Edit the saved report to change future deliveries." : "Reminders stop when the invoice is paid or void. A reminder before its due date is skipped."} PDFs and recipient delivery progress are retained for retries.</p>
    <Checkbox label="Enable this schedule" checked={draft.active} onChange={active => setDraft({ ...draft, active })} />
    {!permissions.canWrite && <p className="muted">Finance write permission is required to save a delivery schedule.</p>}
    <div className="btn-row">{onCancel && <button className="btn" disabled={busy} onClick={onCancel}>Cancel</button>}<button className="btn btn--accent" disabled={busy || !sources || !templates || !permissions.canWrite} onClick={() => void submit()}>{busy ? "Saving…" : "Save delivery schedule"}</button></div>
  </div>;
}
export function BillingReportScheduleForm({ societyId, definitionId, reportName }: { societyId: string; definitionId: string; reportName: string }) { return <BillingScheduleForm societyId={societyId} definitionId={definitionId} reportName={reportName} />; }
