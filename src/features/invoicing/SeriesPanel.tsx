import { useState } from "react";
import { useMutation } from "convex/react";
import { CalendarClock, FilePlus2, List, MoreHorizontal, Pause, Pencil, Play, Repeat } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, EmptyState, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { SERIES_FREQUENCIES, SERIES_FREQUENCY_LABEL, seriesSummary } from "../../../shared/invoicing";
import type { InvoiceSeriesRow } from "./types";
import { BillingScheduleForm } from "./BillingReportScheduleForm";

type Props = {
  series: InvoiceSeriesRow[];
  societyId: string;
  today: string;
  canWrite: boolean;
  focusId?: string | null;
  onShowInvoices: (series: InvoiceSeriesRow) => void;
  onOpenInvoice: (id: string) => void;
};

type ScheduleDraft = { row: InvoiceSeriesRow; frequency: string; startDate: string; endKind: string; endAfterCount: string; endDate: string; autoSend: boolean };

/** Recurring series: what's next, issue the next draft, pause, edit the schedule. */
export function SeriesPanel({ series, societyId, today, canWrite, focusId, onShowInvoices, onOpenInvoice }: Props) {
  const issue = useMutation(api.invoices.issueFromSeries);
  const setStatus = useMutation(api.invoices.setSeriesStatus);
  const upsertSeries = useMutation(api.invoices.upsertSeries);
  const toast = useToast();
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);
  const [deliverySeries, setDeliverySeries] = useState<InvoiceSeriesRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issueNext = async (row: InvoiceSeriesRow) => {
    try {
      const id: string = await issue({ id: row._id as any });
      toast.success(`Draft created for ${formatDate(row.nextIssueDate)}`, { description: "Review it, then mark it as sent.", action: { label: "Open", onClick: () => onOpenInvoice(id) } });
    } catch (err: any) {
      toast.error("Could not create the invoice", err?.message);
    }
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    const { row } = schedule;
    try {
      await upsertSeries({
        id: row._id as any,
        societyId: societyId as any,
        name: row.name,
        frequency: schedule.frequency,
        startDate: schedule.startDate,
        endKind: schedule.endKind,
        endAfterCount: schedule.endKind === "after_count" ? Number(schedule.endAfterCount) : undefined,
        endDate: schedule.endKind === "on_date" ? schedule.endDate : undefined,
        autoSend: schedule.autoSend,
        partyKind: row.partyKind,
        memberId: row.memberId as any,
        counterpartyId: row.counterpartyId as any,
        billToName: row.billToName,
        billToEmail: row.billToEmail,
        billToAddress: row.billToAddress,
        terms: row.terms,
        reference: row.reference,
        currency: row.currency,
        lines: row.lines,
        discount: row.discount as any,
        memo: row.memo,
      });
      toast.success("Schedule saved");
      setSchedule(null);
    } catch (err: any) {
      setError(err?.message ?? "Could not save the schedule.");
    }
  };

  if (series.length === 0) {
    return (
      <div className="card invoice-card">
        <div className="card__body">
          <EmptyState
            icon={<Repeat size={20} />}
            title="No recurring invoices"
            description="Turn on Repeat in the invoice builder for rentals, retainers or monthly dues. Create each next draft yourself or configure automatic delivery for the saved series."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="series-list">
      {series.map((row) => (
        <article key={row._id} className={`card series-card${focusId === row._id ? " is-focused" : ""}`} aria-labelledby={`series-${row._id}`}>
          <div className="series-card__head">
            <span className="series-card__icon" aria-hidden="true"><Repeat size={16} /></span>
            <div className="series-card__title">
              <h3 id={`series-${row._id}`}>{row.name}</h3>
              <span className="muted">{row.billToName} · {seriesSummary(row)}</span>
            </div>
            <Badge tone={row.status === "active" ? "success" : row.status === "paused" ? "warn" : "neutral"}>
              {row.status === "active" ? "Active" : row.status === "paused" ? "Paused" : "Ended"}
            </Badge>
            <Menu
              align="right"
              trigger={<button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${row.name}`}><MoreHorizontal size={14} /></button>}
              sections={[{
                id: "series",
                items: [
                  { id: "invoices", label: "View its invoices", icon: <List size={14} />, onSelect: () => onShowInvoices(row) },
                  { id: "schedule", label: "Edit schedule", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => { setError(null); setSchedule({ row, frequency: row.frequency, startDate: row.startDate, endKind: row.endKind, endAfterCount: String(row.endAfterCount ?? 12), endDate: row.endDate ?? "", autoSend: row.autoSend }); } },
                  ...(row.status === "active"
                    ? [{ id: "pause", label: "Pause", icon: <Pause size={14} />, disabled: !canWrite, onSelect: () => void setStatus({ id: row._id as any, status: "paused" }).then(() => toast.success("Series paused")) }]
                    : row.status === "paused"
                      ? [{ id: "resume", label: "Resume", icon: <Play size={14} />, disabled: !canWrite, onSelect: () => void setStatus({ id: row._id as any, status: "active" }).then(() => toast.success("Series resumed")).catch((err: any) => toast.error("Could not resume", err?.message)) }]
                      : []),
                ],
              }]}
            />
          </div>
          <dl className="series-card__figures">
            <div><dt>Each invoice</dt><dd><Money cents={row.totalCents} currency={row.currency} /></dd></div>
            <div><dt>Next issue</dt><dd>{row.nextIssueDate ? formatDate(row.nextIssueDate) : "—"}{row.due && <span className="series-card__due"> · due now</span>}</dd></div>
            <div><dt>Issued</dt><dd>{row.invoiceCount}</dd></div>
            <div><dt>Outstanding</dt><dd><Money cents={row.outstandingCents} currency={row.currency} /></dd></div>
          </dl>
          <div className="series-card__foot">
            <span className="muted series-card__note">
              <CalendarClock size={12} aria-hidden="true" />
              Manual issuance creates drafts. An automatic delivery schedule sends PDFs after sender and recipient setup.
            </span>
            <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => setDeliverySeries(row)}>Configure automatic delivery</button>
            {row.status !== "ended" && (
              <button type="button" className={`btn btn--sm${row.due ? " btn--accent" : ""}`} disabled={!canWrite || row.status === "paused" || !row.nextIssueDate} onClick={() => void issueNext(row)}>
                <FilePlus2 size={14} aria-hidden="true" /> {row.nextIssueDate && row.nextIssueDate > today ? `Create early (${formatDate(row.nextIssueDate)})` : "Create next invoice"}
              </button>
            )}
          </div>
        </article>
      ))}

      <Drawer
        open={Boolean(schedule)}
        onClose={() => setSchedule(null)}
        title="Edit schedule"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setSchedule(null)}>Cancel</button>
            <button type="button" className="btn btn--accent" onClick={() => void saveSchedule()}>Save</button>
          </>
        }
      >
        {schedule && (
          <div>
            {error && <p className="field__error" role="alert">{error}</p>}
            <p className="muted">{schedule.row.name} · {schedule.row.invoiceCount} issued so far. These changes set future issue dates. Issued invoices keep their saved customer, rates and document.</p>
            <Field label="Every">
              <Select value={schedule.frequency} onChange={(frequency) => setSchedule({ ...schedule, frequency })} options={SERIES_FREQUENCIES.map((f) => ({ value: f, label: SERIES_FREQUENCY_LABEL[f] }))} />
            </Field>
            <Field label="First issue date" hint="Later dates are counted from this one, so month-end dates don't drift.">
              <DatePicker value={schedule.startDate} clearable={false} onChange={(startDate) => startDate && setSchedule({ ...schedule, startDate })} />
            </Field>
            <Field label="Ends">
              <Select
                value={schedule.endKind}
                onChange={(endKind) => setSchedule({ ...schedule, endKind })}
                options={[{ value: "never", label: "Never" }, { value: "after_count", label: "After a number of invoices" }, { value: "on_date", label: "On a date" }]}
              />
            </Field>
            {schedule.endKind === "after_count" && (
              <Field label="Invoices in total">
                <input className="input num" inputMode="numeric" value={schedule.endAfterCount} onChange={(e) => setSchedule({ ...schedule, endAfterCount: e.target.value })} />
              </Field>
            )}
            {schedule.endKind === "on_date" && (
              <Field label="Last issue date">
                <DatePicker value={schedule.endDate} onChange={(endDate) => setSchedule({ ...schedule, endDate })} />
              </Field>
            )}
            <p><button type="button" className="btn btn--sm" disabled={!canWrite} onClick={() => setDeliverySeries(schedule.row)}>Configure automatic delivery</button></p>
          </div>
        )}
      </Drawer>
      <Drawer open={Boolean(deliverySeries)} title="Configure automatic delivery" onClose={() => setDeliverySeries(null)}>
        {deliverySeries && <BillingScheduleForm key={deliverySeries._id} societyId={societyId}
          schedule={{ kind: "recurring_invoice", sourceId: deliverySeries._id, name: `${deliverySeries.name} delivery`, recipients: deliverySeries.billToEmail ? [deliverySeries.billToEmail] : [], active: false, recipientsConfirmed: false }}
          onSaved={() => setDeliverySeries(null)} onCancel={() => setDeliverySeries(null)} />}
      </Drawer>
    </div>
  );
}
