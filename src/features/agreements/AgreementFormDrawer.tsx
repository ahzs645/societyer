import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { PersonPicker } from "../../components/PersonPicker";
import { usePermissions } from "../../hooks/usePermissions";
import { centsToDollarInput, dollarInputToCents } from "../../lib/format";
import {
  AGREEMENT_KINDS,
  AGREEMENT_KIND_LABELS,
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABELS,
  DELIVERABLE_STATUSES,
  DELIVERABLE_STATUS_LABELS,
  PARTY_ROLES,
  PARTY_ROLE_LABELS,
  REPORTING_RECURRENCES,
  REPORTING_RECURRENCE_LABELS,
  validateAgreementInput,
  type FieldErrors,
} from "../../../shared/agreements";

export type AgreementFormValue = {
  title: string;
  kind: string;
  status: string;
  agreementNumber: string;
  summary: string;
  parties: Array<{ name: string; role: string; contact?: string }>;
  ourSignatories: Array<{ name: string; title?: string; directoryPersonId?: string }>;
  counterpartySignatories: Array<{ name: string; title?: string }>;
  signedDate: string;
  effectiveDate: string;
  endDate: string;
  autoRenew: boolean;
  renewalTermMonths: string;
  renewalNoticeDays: string;
  terminationNoticeDays: string;
  terminationTerms: string;
  valueDollars: string;
  currency: string;
  paymentTerms: string;
  deliverables: Array<{ id?: string; text: string; dueDate?: string; owner?: string; status?: string }>;
  reportingObligations: Array<{ id?: string; text: string; dueDate?: string; recurrence?: string; recipient?: string; status?: string }>;
  confidential: boolean;
  governingLaw: string;
  linkedGrantId: string;
  linkedServiceProviderId: string;
  linkedCommitteeId: string;
  signedDocumentId: string;
  approvedAtMeetingId: string;
  approvalMotionId: string;
  approvalNote: string;
  reviewStatus: string;
  notes: string;
};

export function emptyAgreementForm(organizationName?: string, prefill: Partial<AgreementFormValue> = {}): AgreementFormValue {
  return {
    title: "", kind: "service", status: "draft", agreementNumber: "", summary: "",
    parties: [{ name: organizationName ?? "", role: "us" }, { name: "", role: "counterparty" }],
    ourSignatories: [], counterpartySignatories: [], signedDate: "", effectiveDate: "", endDate: "", autoRenew: false,
    renewalTermMonths: "", renewalNoticeDays: "", terminationNoticeDays: "", terminationTerms: "", valueDollars: "", currency: "CAD", paymentTerms: "",
    deliverables: [], reportingObligations: [], confidential: false, governingLaw: "", linkedGrantId: "", linkedServiceProviderId: "", linkedCommitteeId: "",
    signedDocumentId: "", approvedAtMeetingId: "", approvalMotionId: "", approvalNote: "", reviewStatus: "", notes: "",
    ...prefill,
  };
}

export function agreementToForm(row: any): AgreementFormValue {
  const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
  return {
    title: text(row.title), kind: text(row.kind) || "other", status: text(row.status) || "unknown", agreementNumber: text(row.agreementNumber), summary: text(row.summary),
    parties: (row.parties ?? []).map((party: any) => ({ name: text(party.name), role: text(party.role) || "counterparty", ...(party.contact ? { contact: party.contact } : {}) })),
    ourSignatories: (row.ourSignatories ?? []).map((item: any) => ({ name: text(item.name), title: text(item.title), ...(item.directoryPersonId ? { directoryPersonId: String(item.directoryPersonId) } : {}) })),
    counterpartySignatories: (row.counterpartySignatories ?? []).map((item: any) => ({ name: text(item.name), title: text(item.title) })),
    signedDate: text(row.signedDate), effectiveDate: text(row.effectiveDate), endDate: text(row.endDate), autoRenew: Boolean(row.autoRenew),
    renewalTermMonths: text(row.renewalTermMonths), renewalNoticeDays: text(row.renewalNoticeDays), terminationNoticeDays: text(row.terminationNoticeDays), terminationTerms: text(row.terminationTerms),
    valueDollars: centsToDollarInput(row.valueCents), currency: text(row.currency) || "CAD", paymentTerms: text(row.paymentTerms),
    deliverables: (row.deliverables ?? []).map((item: any) => ({ ...item })), reportingObligations: (row.reportingObligations ?? []).map((item: any) => ({ ...item })),
    confidential: Boolean(row.confidential), governingLaw: text(row.governingLaw), linkedGrantId: text(row.linkedGrantId), linkedServiceProviderId: text(row.linkedServiceProviderId),
    linkedCommitteeId: text(row.linkedCommitteeId), signedDocumentId: text(row.signedDocumentId), approvedAtMeetingId: text(row.approvedAtMeetingId), approvalMotionId: text(row.approvalMotionId),
    approvalNote: text(row.approvalNote), reviewStatus: text(row.reviewStatus), notes: text(row.notes),
  };
}

const LINK_FIELDS = ["linkedGrantId", "linkedServiceProviderId", "linkedCommitteeId", "signedDocumentId", "approvedAtMeetingId", "approvalMotionId"] as const;
const OPTIONAL_TEXT = ["agreementNumber", "summary", "signedDate", "effectiveDate", "endDate", "terminationTerms", "paymentTerms", "governingLaw", "approvalNote", "notes"] as const;

/** Form value → mutation payload, plus the optional fields the user cleared (for an update). */
export function formToPayload(form: AgreementFormValue): { payload: Record<string, any>; cleared: string[] } {
  const payload: Record<string, any> = {
    title: form.title.trim(),
    kind: form.kind,
    status: form.status,
    parties: form.parties.filter((party) => party.name.trim()).map((party) => ({ name: party.name.trim(), role: party.role, ...(party.contact?.trim() ? { contact: party.contact.trim() } : {}) })),
    ourSignatories: form.ourSignatories.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), ...(row.title?.trim() ? { title: row.title.trim() } : {}), ...(row.directoryPersonId ? { directoryPersonId: row.directoryPersonId } : {}) })),
    counterpartySignatories: form.counterpartySignatories.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), ...(row.title?.trim() ? { title: row.title.trim() } : {}) })),
    autoRenew: form.autoRenew,
    confidential: form.confidential,
    currency: (form.currency || "CAD").toUpperCase(),
    deliverables: form.deliverables.map((row) => ({ ...(row.id ? { id: row.id } : {}), text: row.text, ...(row.dueDate ? { dueDate: row.dueDate } : {}), ...(row.owner?.trim() ? { owner: row.owner.trim() } : {}), status: row.status || "not_started" })),
    reportingObligations: form.reportingObligations.map((row) => ({ ...(row.id ? { id: row.id } : {}), text: row.text, ...(row.dueDate ? { dueDate: row.dueDate } : {}), ...(row.recurrence ? { recurrence: row.recurrence } : {}), ...(row.recipient?.trim() ? { recipient: row.recipient.trim() } : {}), status: row.status || "not_started" })),
  };
  const cleared: string[] = [];
  for (const key of OPTIONAL_TEXT) {
    const value = form[key].trim();
    if (value) payload[key] = value;
    else cleared.push(key);
  }
  for (const key of LINK_FIELDS) {
    if (form[key]) payload[key] = form[key];
    else cleared.push(key);
  }
  for (const [key, source] of [["renewalTermMonths", form.renewalTermMonths], ["renewalNoticeDays", form.renewalNoticeDays], ["terminationNoticeDays", form.terminationNoticeDays]] as const) {
    if (source.trim() === "") cleared.push(key);
    else payload[key] = Number(source);
  }
  const cents = dollarInputToCents(form.valueDollars);
  if (form.valueDollars.trim() === "") cleared.push("valueCents");
  else payload.valueCents = cents === undefined ? Number.NaN : cents;
  if (form.reviewStatus) payload.reviewStatus = form.reviewStatus;
  return { payload, cleared };
}

export function validateAgreementForm(form: AgreementFormValue): FieldErrors {
  const { payload } = formToPayload(form);
  const errors = validateAgreementInput(payload);
  if (form.valueDollars.trim() && !Number.isFinite(payload.valueCents)) errors.valueCents = "Enter the value as a number.";
  return errors;
}

/** Create / edit drawer for an agreement. Validation is shared with the server (shared/agreements.ts). */
export function AgreementFormDrawer({
  open,
  title,
  societyId,
  initial,
  saving,
  serverError,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  societyId: string;
  initial: AgreementFormValue;
  saving?: boolean;
  serverError?: string;
  onClose: () => void;
  onSubmit: (form: AgreementFormValue) => void;
}) {
  const { can } = usePermissions();
  const [form, setForm] = useState<AgreementFormValue>(initial);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setForm(initial); setTouched(false); } }, [open, initial]);
  const skip = !open ? "skip" : undefined;
  const grants = useQuery(api.grants.list, skip ?? (can("grants:read") ? { societyId } : "skip"));
  const committees = useQuery(api.committees.list, skip ?? (can("committees:read") ? { societyId } : "skip"));
  const providers = useQuery(api.serviceProviders.list, skip ?? (can("settings:read") ? { societyId } : "skip"));
  const meetings = useQuery(api.meetings.list, skip ?? (can("meetings:read") ? { societyId } : "skip"));
  const documents = useQuery(api.documents.list, skip ?? (can("documents:read") ? { societyId } : "skip"));
  const people = useQuery(api.peopleDirectory.list, skip ?? { societyId });
  const motions = useQuery(api.motions.listForMeeting, open && form.approvedAtMeetingId && can("motions:read") ? { meetingId: form.approvedAtMeetingId } : "skip");
  const errors = useMemo(() => validateAgreementForm(form), [form]);
  const show = (key: string) => (touched ? errors[key] : undefined);
  const set = (patch: Partial<AgreementFormValue>) => setForm((current) => ({ ...current, ...patch }));
  const rowError = (prefix: string, index: number) => (touched ? Object.entries(errors).find(([key]) => key.startsWith(`${prefix}.${index}.`))?.[1] : undefined);

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    onSubmit(form);
  };

  const option = (rows: any[] | undefined, label: (row: any) => string) => (rows ?? []).map((row) => ({ value: String(row._id), label: label(row) }));
  const meetingOptions = useMemo(() => [...(meetings ?? [])].sort((a: any, b: any) => String(b.scheduledAt ?? "").localeCompare(String(a.scheduledAt ?? ""))).map((row: any) => ({ value: String(row._id), label: `${String(row.scheduledAt ?? "").slice(0, 10)} · ${row.title ?? "Meeting"}` })), [meetings]);
  const documentOptions = useMemo(() => (documents ?? []).filter((row: any) => !row.importRecordKind).slice(0, 2000).map((row: any) => ({ value: String(row._id), label: String(row.title ?? row.fileName ?? "Document") })), [documents]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      size="wide"
      footer={
        <>
          {touched && Object.keys(errors).length > 0 && <span className="muted" role="status" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>Fix {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? "" : "s"} to save.</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={saving || (touched && Object.keys(errors).length > 0)} onClick={submit}>{saving ? "Saving…" : "Save agreement"}</button>
        </>
      }
    >
      <div className="col agreement-form" style={{ gap: 16 }}>
        {serverError && <div className="banner banner--danger" role="alert">{serverError}</div>}
        <section className="col" style={{ gap: 8 }}>
          <Field label="Title" required error={show("title")}>
            <input className="input" value={form.title} onChange={(event) => set({ title: event.target.value })} aria-invalid={Boolean(show("title"))} />
          </Field>
          <div className="agreement-form__grid">
            <Field label="Kind" error={show("kind")}>
              <Select value={form.kind} onChange={(kind) => set({ kind })} options={AGREEMENT_KINDS.map((kind) => ({ value: kind, label: AGREEMENT_KIND_LABELS[kind] }))} aria-label="Kind" />
            </Field>
            <Field label="Status" hint="Mark active only when it is signed and in force." error={show("status")}>
              <Select value={form.status} onChange={(status) => set({ status })} options={AGREEMENT_STATUSES.map((status) => ({ value: status, label: AGREEMENT_STATUS_LABELS[status] }))} aria-label="Status" />
            </Field>
            <Field label="Agreement number">
              <input className="input" value={form.agreementNumber} onChange={(event) => set({ agreementNumber: event.target.value })} />
            </Field>
          </div>
          <Field label="Summary">
            <textarea className="textarea" rows={2} value={form.summary} onChange={(event) => set({ summary: event.target.value })} />
          </Field>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Parties">
          <h3 className="agreement-form__heading">Parties</h3>
          {show("parties") && <div className="field__error" role="alert">{show("parties")}</div>}
          {form.parties.map((party, index) => (
            <div key={index} className="agreement-form__row">
              <input className="input" placeholder="Party name" aria-label={`Party ${index + 1} name`} value={party.name} onChange={(event) => set({ parties: form.parties.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)) })} />
              <Select value={party.role} onChange={(role) => set({ parties: form.parties.map((row, i) => (i === index ? { ...row, role } : row)) })} options={PARTY_ROLES.map((role) => ({ value: role, label: PARTY_ROLE_LABELS[role] }))} aria-label={`Party ${index + 1} role`} />
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove party ${index + 1}`} onClick={() => set({ parties: form.parties.filter((_, i) => i !== index) })}><Trash2 size={12} /></button>
              {rowError("parties", index) && <div className="field__error" style={{ gridColumn: "1 / -1" }}>{rowError("parties", index)}</div>}
            </div>
          ))}
          <div><button type="button" className="btn btn--sm" onClick={() => set({ parties: [...form.parties, { name: "", role: "counterparty" }] })}><Plus size={12} /> Add party</button></div>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Signatories">
          <h3 className="agreement-form__heading">Our signatories</h3>
          {form.ourSignatories.map((row, index) => (
            <div key={index} className="agreement-form__row agreement-form__row--3">
              <input className="input" placeholder="Name" aria-label={`Our signatory ${index + 1} name`} value={row.name} onChange={(event) => set({ ourSignatories: form.ourSignatories.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)) })} />
              <input className="input" placeholder="Title or office" aria-label={`Our signatory ${index + 1} title`} value={row.title ?? ""} onChange={(event) => set({ ourSignatories: form.ourSignatories.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)) })} />
              <PersonPicker people={people as any} value={row.directoryPersonId ?? ""} sourceName={row.name} ariaLabel={`Our signatory ${index + 1} person`} onChange={(personId) => {
                const person = (people ?? []).find((candidate: any) => String(candidate._id) === personId);
                set({ ourSignatories: form.ourSignatories.map((item, i) => (i === index ? { ...item, directoryPersonId: personId || undefined, name: item.name || person?.fullName || "" } : item)) });
              }} />
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove our signatory ${index + 1}`} onClick={() => set({ ourSignatories: form.ourSignatories.filter((_, i) => i !== index) })}><Trash2 size={12} /></button>
            </div>
          ))}
          <div><button type="button" className="btn btn--sm" onClick={() => set({ ourSignatories: [...form.ourSignatories, { name: "", title: "" }] })}><Plus size={12} /> Add our signatory</button></div>
          <h3 className="agreement-form__heading">Counterparty signatories</h3>
          {form.counterpartySignatories.map((row, index) => (
            <div key={index} className="agreement-form__row">
              <input className="input" placeholder="Name" aria-label={`Counterparty signatory ${index + 1} name`} value={row.name} onChange={(event) => set({ counterpartySignatories: form.counterpartySignatories.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)) })} />
              <input className="input" placeholder="Title" aria-label={`Counterparty signatory ${index + 1} title`} value={row.title ?? ""} onChange={(event) => set({ counterpartySignatories: form.counterpartySignatories.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)) })} />
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove counterparty signatory ${index + 1}`} onClick={() => set({ counterpartySignatories: form.counterpartySignatories.filter((_, i) => i !== index) })}><Trash2 size={12} /></button>
            </div>
          ))}
          <div><button type="button" className="btn btn--sm" onClick={() => set({ counterpartySignatories: [...form.counterpartySignatories, { name: "", title: "" }] })}><Plus size={12} /> Add counterparty signatory</button></div>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Term and renewal">
          <h3 className="agreement-form__heading">Term and renewal</h3>
          <div className="agreement-form__grid">
            <Field label="Effective date" error={show("effectiveDate")}><DatePicker id="agreement-effective-date" value={form.effectiveDate} onChange={(effectiveDate) => set({ effectiveDate })} aria-invalid={Boolean(show("effectiveDate"))} /></Field>
            <Field label="End date" error={show("endDate")}><DatePicker id="agreement-end-date" value={form.endDate} onChange={(endDate) => set({ endDate })} aria-invalid={Boolean(show("endDate"))} /></Field>
            <Field label="Signed on" error={show("signedDate")}><DatePicker id="agreement-signed-date" value={form.signedDate} onChange={(signedDate) => set({ signedDate })} /></Field>
            <Field label="Renewal notice (days)" hint="Days before the end date" error={show("renewalNoticeDays")}><input className="input" type="number" min="0" value={form.renewalNoticeDays} onChange={(event) => set({ renewalNoticeDays: event.target.value })} /></Field>
            <Field label="Termination notice (days)" error={show("terminationNoticeDays")}><input className="input" type="number" min="0" value={form.terminationNoticeDays} onChange={(event) => set({ terminationNoticeDays: event.target.value })} /></Field>
            <Field label="Renewal term (months)" hint="When it renews automatically" error={show("renewalTermMonths")}><input className="input" type="number" min="0" value={form.renewalTermMonths} onChange={(event) => set({ renewalTermMonths: event.target.value })} disabled={!form.autoRenew} /></Field>
          </div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.autoRenew} onChange={(event) => set({ autoRenew: event.target.checked })} /> Renews automatically unless notice is given</label>
          <Field label="Termination terms"><textarea className="textarea" rows={2} value={form.terminationTerms} onChange={(event) => set({ terminationTerms: event.target.value })} /></Field>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Money">
          <h3 className="agreement-form__heading">Money</h3>
          <div className="agreement-form__grid">
            <Field label="Value" hint="Total value in dollars" error={show("valueCents")}><input className="input" inputMode="decimal" value={form.valueDollars} onChange={(event) => set({ valueDollars: event.target.value })} aria-invalid={Boolean(show("valueCents"))} /></Field>
            <Field label="Currency" error={show("currency")}><input className="input" maxLength={3} value={form.currency} onChange={(event) => set({ currency: event.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label="Payment terms"><textarea className="textarea" rows={2} value={form.paymentTerms} onChange={(event) => set({ paymentTerms: event.target.value })} /></Field>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Deliverables">
          <h3 className="agreement-form__heading">Deliverables</h3>
          {form.deliverables.map((row, index) => (
            <div key={row.id ?? index} className="agreement-form__row agreement-form__row--4">
              <input className="input" placeholder="Deliverable" aria-label={`Deliverable ${index + 1}`} value={row.text} onChange={(event) => set({ deliverables: form.deliverables.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)) })} />
              <DatePicker value={row.dueDate ?? ""} onChange={(dueDate) => set({ deliverables: form.deliverables.map((item, i) => (i === index ? { ...item, dueDate } : item)) })} placeholder="Due" />
              <input className="input" placeholder="Owner" aria-label={`Deliverable ${index + 1} owner`} value={row.owner ?? ""} onChange={(event) => set({ deliverables: form.deliverables.map((item, i) => (i === index ? { ...item, owner: event.target.value } : item)) })} />
              <Select value={row.status ?? "not_started"} onChange={(status) => set({ deliverables: form.deliverables.map((item, i) => (i === index ? { ...item, status } : item)) })} options={DELIVERABLE_STATUSES.map((status) => ({ value: status, label: DELIVERABLE_STATUS_LABELS[status] }))} aria-label={`Deliverable ${index + 1} status`} />
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove deliverable ${index + 1}`} onClick={() => set({ deliverables: form.deliverables.filter((_, i) => i !== index) })}><Trash2 size={12} /></button>
              {rowError("deliverables", index) && <div className="field__error" style={{ gridColumn: "1 / -1" }}>{rowError("deliverables", index)}</div>}
            </div>
          ))}
          <div><button type="button" className="btn btn--sm" onClick={() => set({ deliverables: [...form.deliverables, { text: "", status: "not_started" }] })}><Plus size={12} /> Add deliverable</button></div>
          <h3 className="agreement-form__heading">Reporting obligations</h3>
          {form.reportingObligations.map((row, index) => (
            <div key={row.id ?? index} className="agreement-form__row agreement-form__row--4">
              <input className="input" placeholder="Report" aria-label={`Report ${index + 1}`} value={row.text} onChange={(event) => set({ reportingObligations: form.reportingObligations.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)) })} />
              <DatePicker value={row.dueDate ?? ""} onChange={(dueDate) => set({ reportingObligations: form.reportingObligations.map((item, i) => (i === index ? { ...item, dueDate } : item)) })} placeholder="Due" />
              <Select value={row.recurrence ?? "once"} onChange={(recurrence) => set({ reportingObligations: form.reportingObligations.map((item, i) => (i === index ? { ...item, recurrence } : item)) })} options={REPORTING_RECURRENCES.map((value) => ({ value, label: REPORTING_RECURRENCE_LABELS[value] }))} aria-label={`Report ${index + 1} recurrence`} />
              <Select value={row.status ?? "not_started"} onChange={(status) => set({ reportingObligations: form.reportingObligations.map((item, i) => (i === index ? { ...item, status } : item)) })} options={DELIVERABLE_STATUSES.map((status) => ({ value: status, label: DELIVERABLE_STATUS_LABELS[status] }))} aria-label={`Report ${index + 1} status`} />
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove report ${index + 1}`} onClick={() => set({ reportingObligations: form.reportingObligations.filter((_, i) => i !== index) })}><Trash2 size={12} /></button>
              {rowError("reportingObligations", index) && <div className="field__error" style={{ gridColumn: "1 / -1" }}>{rowError("reportingObligations", index)}</div>}
            </div>
          ))}
          <div><button type="button" className="btn btn--sm" onClick={() => set({ reportingObligations: [...form.reportingObligations, { text: "", recurrence: "once", status: "not_started" }] })}><Plus size={12} /> Add reporting obligation</button></div>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Links and approval">
          <h3 className="agreement-form__heading">Links and approval</h3>
          <div className="agreement-form__grid">
            {can("grants:read") && <Field label="Linked grant"><Select value={form.linkedGrantId} onChange={(linkedGrantId) => set({ linkedGrantId })} options={option(grants, (row) => row.title)} clearable searchable placeholder="No grant" aria-label="Linked grant" /></Field>}
            {can("settings:read") && <Field label="Service provider"><Select value={form.linkedServiceProviderId} onChange={(linkedServiceProviderId) => set({ linkedServiceProviderId })} options={option(providers, (row) => row.firmName)} clearable searchable placeholder="No provider" aria-label="Service provider" /></Field>}
            {can("committees:read") && <Field label="Committee"><Select value={form.linkedCommitteeId} onChange={(linkedCommitteeId) => set({ linkedCommitteeId })} options={option(committees, (row) => row.name)} clearable searchable placeholder="No committee" aria-label="Committee" /></Field>}
            {can("documents:read") && <Field label="Signed copy"><Select value={form.signedDocumentId} onChange={(signedDocumentId) => set({ signedDocumentId })} options={documentOptions} clearable searchable placeholder="No document" aria-label="Signed copy" /></Field>}
            {can("meetings:read") && <Field label="Approved at meeting"><Select value={form.approvedAtMeetingId} onChange={(approvedAtMeetingId) => set({ approvedAtMeetingId, approvalMotionId: "" })} options={meetingOptions} clearable searchable placeholder="No meeting" aria-label="Approved at meeting" /></Field>}
            {can("motions:read") && <Field label="Authorizing motion" hint={form.approvedAtMeetingId ? undefined : "Choose the meeting first"}><Select value={form.approvalMotionId} onChange={(approvalMotionId) => set({ approvalMotionId })} options={(motions ?? []).map((row: any) => ({ value: String(row._id), label: `${String(row.text ?? "Motion").slice(0, 120)}${row.outcome ? ` (${row.outcome})` : ""}` }))} clearable searchable disabled={!form.approvedAtMeetingId} placeholder="No motion" aria-label="Authorizing motion" /></Field>}
          </div>
          <Field label="Approval note"><input className="input" value={form.approvalNote} onChange={(event) => set({ approvalNote: event.target.value })} /></Field>
        </section>

        <section className="col" style={{ gap: 8 }} aria-label="Other details">
          <div className="agreement-form__grid">
            <Field label="Governing law"><input className="input" value={form.governingLaw} onChange={(event) => set({ governingLaw: event.target.value })} placeholder="British Columbia" /></Field>
            <Field label="Review"><Select value={form.reviewStatus} onChange={(reviewStatus) => set({ reviewStatus })} options={[{ value: "NeedsReview", label: "Needs review" }, { value: "Verified", label: "Verified" }, { value: "Rejected", label: "Rejected" }]} clearable placeholder="Not set" aria-label="Review" /></Field>
          </div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.confidential} onChange={(event) => set({ confidential: event.target.checked })} /> Confidential terms</label>
          <Field label="Notes"><textarea className="textarea" rows={3} value={form.notes} onChange={(event) => set({ notes: event.target.value })} /></Field>
        </section>
      </div>
    </Drawer>
  );
}
