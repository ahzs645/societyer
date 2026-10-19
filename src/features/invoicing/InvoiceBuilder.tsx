import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { ArrowLeft, Copy, Eye, MoreHorizontal, Pencil, Printer, Repeat, Save, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Banner, Field } from "../../components/ui";
import { Checkbox, Toggle } from "../../components/Controls";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";
import { formatDate } from "../../lib/format";
import { parseMoneyInput } from "../../lib/money";
import {
  INVOICE_TERMS,
  INVOICE_TERMS_LABEL,
  SERIES_FREQUENCIES,
  SERIES_FREQUENCY_LABEL,
  computeInvoiceTotals,
  dueDateForTerms,
  validateInvoiceLines,
  type InvoiceLine,
} from "../../../shared/invoicing";
import { BillToPicker, type BillToValue } from "./BillToPicker";
import { InvoiceDocument, InvoicePrintPortal } from "./InvoiceDocument";
import { InvoiceStatusPill } from "./InvoiceStatusPill";
import { LineItemsEditor, blankLine, toLineDraft, type LineDraft } from "./LineItemsEditor";
import { useFinanceTags } from "../financials/transactions/useFinanceTags";
import { findLikelyDuplicate } from "../../../shared/expensePolicy";
import { appRouteHref } from "../../lib/appRouteHref";
import type { InvoiceRow, InvoiceWorkspace } from "./types";

type RepeatDraft = { enabled: boolean; frequency: string; endKind: string; endAfterCount: string; endDate: string; autoSend: boolean };
type Draft = BillToValue & {
  issueDate: string;
  terms: string;
  dueDate: string;
  reference: string;
  lines: LineDraft[];
  discountKind: "percent" | "amount";
  discountInput: string;
  memo: string;
  repeat: RepeatDraft;
};

function initialDraft(workspace: InvoiceWorkspace, invoice?: InvoiceRow | null, prefill?: BillToValue | null): Draft {
  const repeat: RepeatDraft = { enabled: false, frequency: "monthly", endKind: "never", endAfterCount: "12", endDate: "", autoSend: false };
  if (invoice) {
    return {
      partyKind: invoice.partyKind,
      memberId: invoice.memberId,
      counterpartyId: invoice.counterpartyId,
      billToName: invoice.billToName,
      billToEmail: invoice.billToEmail,
      billToAddress: invoice.billToAddress,
      issueDate: invoice.issueDate,
      terms: invoice.terms,
      dueDate: invoice.dueDate,
      reference: invoice.reference ?? "",
      lines: invoice.lines.map(toLineDraft),
      discountKind: invoice.discount?.kind ?? "percent",
      discountInput: invoice.discount ? (invoice.discount.kind === "amount" ? (invoice.discount.value / 100).toFixed(2) : String(invoice.discount.value)) : "",
      memo: invoice.memo ?? "",
      repeat,
    };
  }
  const terms = workspace.settings.defaultTerms || "net_30";
  return {
    partyKind: "custom",
    billToName: "",
    ...(prefill ?? {}),
    issueDate: workspace.today,
    terms,
    dueDate: dueDateForTerms(workspace.today, terms),
    reference: "",
    lines: [blankLine()],
    discountKind: "percent",
    discountInput: "",
    memo: workspace.settings.defaultMemo ?? "",
    repeat,
  };
}

function cleanLines(lines: LineDraft[]): InvoiceLine[] {
  return lines.map(({ qtyInput: _q, priceInput: _p, ...line }) => {
    const out: InvoiceLine = { ...line };
    if (!out.description) delete out.description;
    if (!out.taxRatePercent) {
      delete out.taxRatePercent;
      delete out.taxLabel;
    }
    if (!out.catalogItemId) delete out.catalogItemId;
    if (!out.tagIds?.length) delete out.tagIds;
    return out;
  });
}

function discountFrom(draft: Draft): { kind: "percent" | "amount"; value: number } | undefined {
  if (!draft.discountInput.trim()) return undefined;
  if (draft.discountKind === "percent") {
    const value = Number(draft.discountInput.replace("%", ""));
    return Number.isFinite(value) && value > 0 ? { kind: "percent", value } : undefined;
  }
  const cents = parseMoneyInput(draft.discountInput);
  return cents && cents > 0 ? { kind: "amount", value: cents } : undefined;
}

type Props = {
  workspace: InvoiceWorkspace;
  invoice?: InvoiceRow | null;
  /** Bill-to for a new invoice started from a customer. */
  prefill?: BillToValue | null;
  societyId: string;
  logoUrl?: string | null;
  showMembers: boolean;
  canWrite: boolean;
  onClose: () => void;
  /** Called after the first save so the URL can point at the saved invoice. */
  onSaved: (id: string) => void;
  onOpenBuilder: (id: string) => void;
};

/** Full-page invoice builder with a live, printable preview. */
export function InvoiceBuilder({ workspace, invoice, prefill, societyId, logoUrl, showMembers, canWrite, onClose, onSaved, onOpenBuilder }: Props) {
  const upsert = useMutation(api.invoices.upsert);
  const markSent = useMutation(api.invoices.markSent);
  const duplicate = useMutation(api.invoices.duplicate);
  const remove = useMutation(api.invoices.remove);
  const upsertSeries = useMutation(api.invoices.upsertSeries);
  const upsertCounterparty = useMutation(api.accounting.upsertCounterparty);
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(workspace, invoice, prefill));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  // Soft duplicate check for a new invoice: same customer and total within 14 days.
  const [duplicateOk, setDuplicateOk] = useState(false);
  const [duplicateRetry, setDuplicateRetry] = useState<null | (() => void)>(null);

  const readOnly = !canWrite || invoice?.lifecycle === "void";
  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setError(null);
  };

  const lines = useMemo(() => cleanLines(draft.lines), [draft.lines]);
  const financeTags = useFinanceTags(societyId);
  const discount = discountFrom(draft);
  const totals = computeInvoiceTotals(lines, discount);
  const dueDate = draft.terms === "custom" ? draft.dueDate || draft.issueDate : dueDateForTerms(draft.issueDate, draft.terms);
  const number = invoice?.number ?? workspace.settings.nextNumberPreview;
  const activeCatalog = workspace.catalog.filter((item) => item.active);
  const hasTax = totals.taxes.length > 0;

  const previewData = {
    number,
    issueDate: draft.issueDate,
    dueDate,
    terms: draft.terms,
    reference: draft.reference || undefined,
    currency: invoice?.currency ?? "CAD",
    billToName: draft.billToName,
    billToEmail: draft.billToEmail,
    billToAddress: draft.billToAddress,
    lines,
    discount,
    memo: draft.memo || undefined,
    payments: invoice?.payments,
    status: invoice?.status ?? "draft",
  };
  const organization = { ...workspace.organization, logoUrl };
  const partyKey = (party: { partyKind: string; memberId?: string; counterpartyId?: string; billToName: string }) =>
    party.partyKind === "member" && party.memberId ? `member:${party.memberId}` : party.partyKind === "organization" && party.counterpartyId ? `org:${party.counterpartyId}` : `name:${party.billToName.trim().toLowerCase()}`;
  const likelyDuplicate = invoice ? null : findLikelyDuplicate(
    { partyKey: draft.billToName.trim() ? partyKey(draft) : "", amountCents: totals.totalCents, date: draft.issueDate },
    workspace.invoices.filter((row) => row.lifecycle !== "void").map((row) => ({ _id: row._id, partyKey: partyKey(row), amountCents: row.totalCents, date: row.issueDate, title: `${row.number} · ${row.billToName}` })),
  );
  const guardDuplicate = (retry: () => void) => {
    if (!likelyDuplicate || duplicateOk) return false;
    setDuplicateRetry(() => retry);
    return true;
  };

  const validate = () => {
    if (!draft.billToName.trim()) return "Choose who to bill.";
    const problem = validateInvoiceLines(lines);
    if (problem) return problem;
    if (totals.totalCents < 0) return "The discount is larger than the invoice.";
    if (draft.repeat.enabled && draft.repeat.endKind === "on_date" && !draft.repeat.endDate) return "Choose when the series ends.";
    return null;
  };

  const save = async (): Promise<string | null> => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy(true);
    try {
      const id: string = await upsert({
        id: invoice?._id as any,
        societyId: societyId as any,
        partyKind: draft.partyKind,
        memberId: draft.partyKind === "member" ? (draft.memberId as any) : undefined,
        counterpartyId: draft.partyKind === "organization" ? (draft.counterpartyId as any) : undefined,
        billToName: draft.billToName,
        billToEmail: draft.billToEmail || undefined,
        billToAddress: draft.billToAddress || undefined,
        issueDate: draft.issueDate,
        terms: draft.terms,
        dueDate: draft.terms === "custom" ? draft.dueDate : undefined,
        reference: draft.reference || undefined,
        lines,
        discount,
        memo: draft.memo || undefined,
      });
      if (draft.repeat.enabled && !invoice?.seriesId) {
        await upsertSeries({
          societyId: societyId as any,
          name: `${draft.billToName} · ${lines[0]?.item ?? "Invoice"}`.slice(0, 200),
          frequency: draft.repeat.frequency,
          startDate: draft.issueDate,
          endKind: draft.repeat.endKind,
          endAfterCount: draft.repeat.endKind === "after_count" ? Number(draft.repeat.endAfterCount) : undefined,
          endDate: draft.repeat.endKind === "on_date" ? draft.repeat.endDate : undefined,
          autoSend: draft.repeat.autoSend,
          partyKind: draft.partyKind,
          memberId: draft.partyKind === "member" ? (draft.memberId as any) : undefined,
          counterpartyId: draft.partyKind === "organization" ? (draft.counterpartyId as any) : undefined,
          billToName: draft.billToName,
          billToEmail: draft.billToEmail || undefined,
          billToAddress: draft.billToAddress || undefined,
          terms: draft.terms === "custom" ? "net_30" : draft.terms,
          reference: draft.reference || undefined,
          lines,
          discount,
          memo: draft.memo || undefined,
          fromInvoiceId: id as any,
        });
        setDraft((current) => ({ ...current, repeat: { ...current.repeat, enabled: false } }));
      }
      setDirty(false);
      if (!invoice) onSaved(id);
      return id;
    } catch (err: any) {
      setError(err?.message ?? "Could not save the invoice.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (force = false) => {
    if (!force && guardDuplicate(() => void saveDraft(true))) return;
    const id = await save();
    if (id) toast.success(invoice ? "Invoice saved" : `Draft ${number} saved`);
  };

  const sendNow = async (draftEmail: boolean, force = false) => {
    if (!force && guardDuplicate(() => void sendNow(draftEmail, true))) return;
    const id = await save();
    if (!id) return;
    try {
      const result: any = await markSent({ societyId: societyId as any, ids: [id as any], draftEmail });
      toast.success(
        `${number} marked as sent`,
        result.emailed ? "An email is waiting in the Outbox for you to send." : draftEmail ? "No email address, so no Outbox draft was made." : undefined,
      );
      onClose();
    } catch (err: any) {
      toast.error("Could not mark as sent", err?.message);
    }
  };

  const doDuplicate = async () => {
    if (!invoice) return;
    try {
      const id: string = await duplicate({ id: invoice._id as any });
      toast.success(`Duplicated ${invoice.number}`, "You're editing the copy.");
      onOpenBuilder(id);
    } catch (err: any) {
      toast.error("Could not duplicate", err?.message);
    }
  };

  const doDelete = async () => {
    if (!invoice) return;
    const ok = await confirm({ title: `Delete draft ${invoice.number}?`, message: "The draft is removed and its number is not reused.", confirmLabel: "Delete draft", tone: "danger" });
    if (!ok) return;
    try {
      await remove({ id: invoice._id as any });
      toast.success("Draft deleted");
      onClose();
    } catch (err: any) {
      toast.error("Could not delete", err?.message);
    }
  };

  const back = async () => {
    if (dirty && !readOnly) {
      const ok = await confirm({ title: "Leave without saving?", message: "Your changes to this invoice will be lost.", confirmLabel: "Leave", tone: "warn" });
      if (!ok) return;
    }
    onClose();
  };

  const createOrganization = canWrite
    ? async (name: string) => {
        try {
          const id: string = await upsertCounterparty({ societyId: societyId as any, name, kind: "customer", provider: "societyer" });
          toast.success(`${name} added as a customer`);
          return id;
        } catch (err: any) {
          toast.error("Could not add the customer", err?.message);
          return undefined;
        }
      }
    : undefined;

  const title = invoice ? `${invoice.lifecycle === "draft" ? "Edit draft" : "Edit invoice"} ${invoice.number}` : `New invoice ${number}`;

  return (
    <div className="invoice-builder">
      <div className="invoice-builder__bar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void back()}>
          <ArrowLeft size={14} aria-hidden="true" /> Invoices
        </button>
        <h1 className="invoice-builder__title">
          {title}
          {invoice && <InvoiceStatusPill status={invoice.status} daysOverdue={invoice.daysOverdue} />}
        </h1>
        <div className="invoice-builder__actions">
          {!readOnly && (
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void saveDraft()}>
              <Save size={14} aria-hidden="true" /> {invoice && invoice.lifecycle !== "draft" ? "Save" : "Save draft"}
            </button>
          )}
          {!readOnly && (!invoice || invoice.lifecycle === "draft") && (
            <button type="button" className="btn btn--sm btn--accent" disabled={busy} onClick={() => void sendNow(false)}>
              <Send size={14} aria-hidden="true" /> Mark as sent
            </button>
          )}
          <Menu
            align="right"
            trigger={
              <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="More invoice actions">
                <MoreHorizontal size={14} />
              </button>
            }
            sections={[
              {
                id: "main",
                items: [
                  { id: "print", label: "Print / Save as PDF", icon: <Printer size={14} />, onSelect: () => window.print() },
                  ...(!readOnly && (!invoice || invoice.lifecycle === "draft")
                    ? [{ id: "send-email", label: "Mark as sent and draft email", icon: <Send size={14} />, disabled: !draft.billToEmail, hint: draft.billToEmail ? "Outbox" : "Needs an email", onSelect: () => void sendNow(true) }]
                    : []),
                  ...(invoice ? [{ id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, disabled: !canWrite, onSelect: () => void doDuplicate() }] : []),
                  ...(invoice?.lifecycle === "draft" && !invoice.payments.length
                    ? [{ id: "delete", label: "Delete draft", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => void doDelete() }]
                    : []),
                ],
              },
            ]}
          />
        </div>
      </div>

      <div className="invoice-builder__toggle" role="tablist" aria-label="Builder view">
        <button type="button" role="tab" aria-selected={mobileView === "edit"} className={mobileView === "edit" ? "is-active" : ""} onClick={() => setMobileView("edit")}>
          <Pencil size={14} aria-hidden="true" /> Edit
        </button>
        <button type="button" role="tab" aria-selected={mobileView === "preview"} className={mobileView === "preview" ? "is-active" : ""} onClick={() => setMobileView("preview")}>
          <Eye size={14} aria-hidden="true" /> Preview
        </button>
      </div>

      <div className={`invoice-builder__grid is-${mobileView}`}>
        <div className="invoice-builder__form">
          {invoice?.lifecycle === "void" && <Banner tone="warn" title="This invoice is void">Restore it from the invoice panel to make changes.</Banner>}
          {invoice && invoice.payments.length > 0 && invoice.lifecycle !== "void" && (
            <Banner tone="info" title="Payments recorded">The total can't drop below the <Money cents={invoice.paidCents} /> already paid.</Banner>
          )}
          {error && <Banner tone="danger" title="Check the invoice">{error}</Banner>}
          {duplicateRetry && likelyDuplicate && (
            <Banner tone="warn" title={`Looks like a duplicate of ${likelyDuplicate.title} (${formatDate(likelyDuplicate.date)})`}>
              Same customer and total within 14 days.{" "}
              <span className="invoice-builder__duplicate-actions">
                <a className="btn btn--sm" href={appRouteHref(`/app/invoices?invoice=${encodeURIComponent(likelyDuplicate._id)}`)} target="_blank" rel="noopener noreferrer">View</a>
                <button type="button" className="btn btn--sm btn--accent" onClick={() => { const retry = duplicateRetry; setDuplicateOk(true); setDuplicateRetry(null); retry(); }}>Save anyway</button>
              </span>
            </Banner>
          )}

          <section className="invoice-builder__section" aria-labelledby="ib-billto">
            <h2 id="ib-billto" className="invoice-builder__heading">Bill to</h2>
            <BillToPicker
              value={draft}
              onChange={(party) => update(party)}
              members={workspace.parties.members}
              organizations={workspace.parties.organizations}
              showMembers={showMembers}
              onCreateOrganization={createOrganization}
              disabled={readOnly}
            />
          </section>

          <section className="invoice-builder__section invoice-builder__dates" aria-labelledby="ib-dates">
            <h2 id="ib-dates" className="invoice-builder__heading">Dates and terms</h2>
            <div className="invoice-builder__row">
              <Field label="Issue date">
                <DatePicker value={draft.issueDate} clearable={false} disabled={readOnly} onChange={(value) => value && update({ issueDate: value })} />
              </Field>
              <Field label="Terms">
                <Select
                  value={draft.terms}
                  disabled={readOnly}
                  onChange={(value) => update({ terms: value, dueDate: value === "custom" ? dueDate : draft.dueDate })}
                  options={INVOICE_TERMS.map((terms) => ({ value: terms, label: INVOICE_TERMS_LABEL[terms] }))}
                />
              </Field>
              {draft.terms === "custom" ? (
                <Field label="Due date">
                  <DatePicker value={draft.dueDate} min={draft.issueDate} clearable={false} disabled={readOnly} onChange={(value) => value && update({ dueDate: value })} />
                </Field>
              ) : (
                <div className="invoice-builder__due">
                  <span className="field__label">Due</span>
                  <span>{formatDate(dueDate)}</span>
                </div>
              )}
              <Field label="PO or reference">
                <input className="input" value={draft.reference} disabled={readOnly} placeholder="Optional" onChange={(e) => update({ reference: e.target.value })} />
              </Field>
            </div>
          </section>

          <LineItemsEditor
            lines={draft.lines}
            onChange={(next) => update({ lines: next })}
            catalog={activeCatalog}
            readOnly={readOnly}
            gstHint={hasTax && !workspace.organization.gstNumber}
            tags={financeTags}
          />

          <section className="invoice-builder__section invoice-builder__summary" aria-labelledby="ib-totals">
            <h2 id="ib-totals" className="invoice-builder__heading">Discount and totals</h2>
            <div className="invoice-builder__discount">
              <Field label="Discount">
                <div className="invoice-builder__discount-input">
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={draft.discountInput}
                    disabled={readOnly}
                    placeholder={draft.discountKind === "percent" ? "0" : "0.00"}
                    onChange={(e) => update({ discountInput: e.target.value })}
                  />
                  <Select
                    value={draft.discountKind}
                    disabled={readOnly}
                    aria-label="Discount type"
                    onChange={(value) => update({ discountKind: value as "percent" | "amount" })}
                    options={[{ value: "percent", label: "%" }, { value: "amount", label: "$" }]}
                  />
                </div>
              </Field>
            </div>
            <dl className="invoice-builder__totals" aria-live="polite">
              <div><dt>Subtotal</dt><dd><Money cents={totals.subtotalCents} /></dd></div>
              {totals.discountCents > 0 && <div><dt>Discount</dt><dd><Money cents={-totals.discountCents} /></dd></div>}
              {totals.taxes.map((tax) => (
                <div key={`${tax.label}-${tax.ratePercent}`}><dt>{tax.label} {tax.ratePercent}%</dt><dd><Money cents={tax.cents} /></dd></div>
              ))}
              <div className="invoice-builder__total"><dt>Total</dt><dd><Money cents={totals.totalCents} /></dd></div>
            </dl>
          </section>

          <section className="invoice-builder__section" aria-labelledby="ib-memo">
            <h2 id="ib-memo" className="invoice-builder__heading">Notes</h2>
            <Field label="Memo shown on the invoice">
              <textarea className="input textarea" rows={3} value={draft.memo} disabled={readOnly} placeholder="A thank-you, what the invoice covers, or anything else the customer should know" onChange={(e) => update({ memo: e.target.value })} />
            </Field>
            <p className="invoice-builder__hint">
              Payment instructions come from invoice settings{workspace.settings.paymentInstructions ? "" : " (none set yet)"}.
            </p>
          </section>

          {!readOnly && !invoice?.seriesId && (
            <section className="invoice-builder__section" aria-labelledby="ib-repeat">
              <div className="invoice-builder__heading-row">
                <h2 id="ib-repeat" className="invoice-builder__heading"><Repeat size={14} aria-hidden="true" /> Repeat</h2>
                <Toggle size="sm" checked={draft.repeat.enabled} onChange={(enabled) => update({ repeat: { ...draft.repeat, enabled } })} label="Make this a recurring series" />
              </div>
              {draft.repeat.enabled && (
                <div className="invoice-builder__row">
                  <Field label="Every">
                    <Select value={draft.repeat.frequency} onChange={(value) => update({ repeat: { ...draft.repeat, frequency: value } })} options={SERIES_FREQUENCIES.map((f) => ({ value: f, label: SERIES_FREQUENCY_LABEL[f] }))} />
                  </Field>
                  <Field label="Ends">
                    <Select
                      value={draft.repeat.endKind}
                      onChange={(value) => update({ repeat: { ...draft.repeat, endKind: value } })}
                      options={[{ value: "never", label: "Never" }, { value: "after_count", label: "After a number of invoices" }, { value: "on_date", label: "On a date" }]}
                    />
                  </Field>
                  {draft.repeat.endKind === "after_count" && (
                    <Field label="Invoices in total">
                      <input className="input num" inputMode="numeric" value={draft.repeat.endAfterCount} onChange={(e) => update({ repeat: { ...draft.repeat, endAfterCount: e.target.value } })} />
                    </Field>
                  )}
                  {draft.repeat.endKind === "on_date" && (
                    <Field label="Last issue date">
                      <DatePicker value={draft.repeat.endDate} min={draft.issueDate} onChange={(value) => update({ repeat: { ...draft.repeat, endDate: value } })} />
                    </Field>
                  )}
                  <div className="invoice-builder__autosend">
                    <Checkbox checked={draft.repeat.autoSend} onChange={(autoSend) => update({ repeat: { ...draft.repeat, autoSend } })} label="Send automatically once email sending is connected" hint="Until then each invoice waits as a draft for you to mark as sent." />
                  </div>
                  <p className="invoice-builder__hint">
                    This invoice is the first in the series. Later invoices are created as drafts on their issue date from the Recurring tab, ready for you to review and mark as sent.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="invoice-builder__preview" aria-label="Invoice preview">
          <div className="invoice-builder__preview-head">
            <span>Preview</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => window.print()}>
              <Printer size={14} aria-hidden="true" /> Print / Save as PDF
            </button>
          </div>
          <div className="invoice-paper">
            <InvoiceDocument invoice={previewData} organization={organization} paymentInstructions={workspace.settings.paymentInstructions} />
          </div>
        </aside>
      </div>
      <InvoicePrintPortal invoice={previewData} organization={organization} paymentInstructions={workspace.settings.paymentInstructions} />
    </div>
  );
}
