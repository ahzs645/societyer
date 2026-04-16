import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, InspectorNote } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useToast } from "../components/Toast";
import { Plus, Check, ClipboardList, Tag, Calendar, Bot } from "lucide-react";
import { centsToDollarInput, dollarInputToCents, formatDate, money } from "../lib/format";
import { kindLabel, renderFilingStatus } from "./Dashboard";
import { FilingBotRunner } from "../components/FilingBotRunner";

const KINDS = ["AnnualReport", "ChangeOfDirectors", "ChangeOfAddress", "BylawAmendment", "T2", "T1044", "T3010", "T4", "GSTHST"] as const;

const FILING_FIELDS: FilterField<any>[] = [
  { id: "kind", label: "Kind", icon: <Tag size={14} />, options: KINDS.map(kindLabel), match: (r, q) => kindLabel(r.kind) === q },
  {
    id: "status", label: "Status", icon: <Tag size={14} />, options: ["Filed", "Upcoming", "Overdue"],
    match: (r, q) => {
      if (r.status === "Filed") return q === "Filed";
      const overdue = new Date(r.dueDate).getTime() < Date.now();
      return q === (overdue ? "Overdue" : "Upcoming");
    },
  },
  { id: "period", label: "Period label", icon: <Tag size={14} />, match: (r, q) => (r.periodLabel ?? "").toLowerCase().includes(q.toLowerCase()) },
  { id: "dueYear", label: "Due in year", icon: <Calendar size={14} />, match: (r, q) => (r.dueDate ?? "").startsWith(q) },
];

export function FilingsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [botFor, setBotFor] = useState<{ id: any; label: string } | null>(null);
  const [completeDraft, setCompleteDraft] = useState<any | null>(null);
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const filingGuidance = useQuery(
    api.filings.guidance,
    completeDraft?.kind ? { kind: completeDraft.kind } : "skip",
  );
  const create = useMutation(api.filings.create);
  const markFiled = useMutation(api.filings.markFiled);
  const toast = useToast();

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ kind: "AnnualReport", periodLabel: "", dueDate: new Date().toISOString().slice(0, 10), status: "Upcoming" });
    setOpen(true);
  };
  const save = async () => { await create({ societyId: society._id, ...form, submittedByUserId: actingUserId }); setOpen(false); };

  return (
    <div className="page">
      <PageHeader
        title="Filings"
        icon={<ClipboardList size={16} />}
        iconColor="orange"
        subtitle="BC Societies Online filings, CRA returns, payroll & GST/HST."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New filing
          </button>
        }
      />

      <DataTable
        label="All filings"
        icon={<ClipboardList size={14} />}
        data={(filings ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FILING_FIELDS}
        searchPlaceholder="Search kind, period, confirmation #…"
        defaultSort={{ columnId: "dueDate", dir: "asc" }}
        columns={[
          { id: "kind", header: "Kind", sortable: true, accessor: (r) => kindLabel(r.kind), render: (r) => <strong>{kindLabel(r.kind)}</strong> },
          { id: "periodLabel", header: "Period", sortable: true, accessor: (r) => r.periodLabel ?? "", render: (r) => <span className="muted">{r.periodLabel ?? "—"}</span> },
          { id: "dueDate", header: "Due", sortable: true, accessor: (r) => r.dueDate, render: (r) => <span className="mono">{formatDate(r.dueDate)}</span> },
          { id: "filedAt", header: "Filed", sortable: true, accessor: (r) => r.filedAt ?? "", render: (r) => <span className="mono">{r.filedAt ? formatDate(r.filedAt) : "—"}</span> },
          { id: "confirmationNumber", header: "Confirmation #", accessor: (r) => r.confirmationNumber ?? "", render: (r) => <span className="mono">{r.confirmationNumber ?? "—"}</span> },
          { id: "submissionMethod", header: "Method", sortable: true, accessor: (r) => r.submissionMethod ?? "", render: (r) => <span className="muted">{r.submissionMethod ?? "—"}</span> },
          { id: "fee", header: "Fee", sortable: true, align: "right", accessor: (r) => r.feePaidCents ?? 0, render: (r) => <span className="mono">{money(r.feePaidCents)}</span> },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => renderFilingStatus(r) },
        ]}
        renderRowActions={(r) =>
          r.status !== "Filed" ? (
            <>
              {["AnnualReport", "BylawAmendment", "ChangeOfDirectors"].includes(r.kind) && (
                <button
                  className="btn btn--sm"
                  onClick={() => setBotFor({ id: r._id, label: `${r.kind}: ${r.periodLabel ?? r.dueDate}` })}
                  title="Run the Societies Online filing bot"
                >
                  <Bot size={12} /> Bot
                </button>
              )}
              <button
                className="btn btn--sm"
                onClick={() =>
                  setCompleteDraft({
                    id: r._id,
                    kind: r.kind,
                    filedAt: new Date().toISOString().slice(0, 10),
                    submissionMethod: r.submissionMethod ?? "ManualPortal",
                    confirmationNumber: r.confirmationNumber ?? "",
                    feePaidDollars: centsToDollarInput(r.feePaidCents),
                    receiptDocumentId: r.receiptDocumentId ?? "",
                    stagedPacketDocumentId: r.stagedPacketDocumentId ?? "",
                    evidenceNotes: r.evidenceNotes ?? "",
                    submissionChecklist: r.submissionChecklist ?? [],
                    registryUrl: r.registryUrl ?? "",
                  })
                }
              >
                <Check size={12} /> Mark filed
              </button>
            </>
          ) : null
        }
      />

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Add filing"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <InspectorNote title="Create the obligation first">
              Use this when a filing obligation exists and you want it tracked in the workspace
              before submission evidence is available.
            </InspectorNote>
            <Field label="Kind">
              <Select
                value={form.kind}
                onChange={(v) => setForm({ ...form, kind: v })}
                options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
              />
            </Field>
            <Field label="Period / label"><input className="input" value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} /></Field>
            <Field label="Due date">
              <DatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
            </Field>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <FilingBotRunner
        open={!!botFor}
        onClose={() => setBotFor(null)}
        filingId={botFor?.id ?? null}
        societyId={society._id}
        filingLabel={botFor?.label ?? ""}
      />

      <Drawer
        open={!!completeDraft}
        onClose={() => setCompleteDraft(null)}
        title="Mark filing as filed"
        footer={
          <>
            <button className="btn" onClick={() => setCompleteDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                const hasEvidence =
                  !!completeDraft.confirmationNumber?.trim() ||
                  !!completeDraft.receiptDocumentId ||
                  !!completeDraft.stagedPacketDocumentId ||
                  !!completeDraft.evidenceNotes?.trim();
                if (!completeDraft.filedAt || !completeDraft.submissionMethod || !hasEvidence) {
                  toast.error("Add filed date, method, and at least one evidence item before marking filed");
                  return;
                }
                await markFiled({
                  id: completeDraft.id,
                  filedAt: completeDraft.filedAt,
                  submissionMethod: completeDraft.submissionMethod || undefined,
                  submittedByUserId: actingUserId,
                  confirmationNumber: completeDraft.confirmationNumber || undefined,
                  feePaidCents: dollarInputToCents(completeDraft.feePaidDollars),
                  receiptDocumentId: completeDraft.receiptDocumentId || undefined,
                  stagedPacketDocumentId: completeDraft.stagedPacketDocumentId || undefined,
                  evidenceNotes: completeDraft.evidenceNotes || undefined,
                  submissionChecklist: completeDraft.submissionChecklist?.filter(Boolean) ?? undefined,
                  attestedByUserId: actingUserId,
                });
                toast.success("Filing marked as filed");
                setCompleteDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {completeDraft && (
          <div>
            <InspectorNote tone="warn" title="Only mark filed with evidence">
              Capture the filed date, method, confirmation number, and receipt once the submission
              is actually complete so audit trails stay defensible.
            </InspectorNote>
            {(completeDraft.registryUrl || filingGuidance?.registryUrl) && (
              <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Registry / filing portal:{" "}
                <a href={completeDraft.registryUrl || filingGuidance?.registryUrl} target="_blank" rel="noreferrer">
                  {completeDraft.registryUrl || filingGuidance?.registryUrl}
                </a>
              </div>
            )}
            <Field label="Filed date"><input className="input" type="date" value={completeDraft.filedAt} onChange={(e) => setCompleteDraft({ ...completeDraft, filedAt: e.target.value })} /></Field>
            <Field label="Submission method">
              <select className="input" value={completeDraft.submissionMethod ?? ""} onChange={(e) => setCompleteDraft({ ...completeDraft, submissionMethod: e.target.value })}>
                <option value="ManualPortal">Manual portal</option>
                <option value="BotAssisted">Bot-assisted</option>
                <option value="CRAOnline">CRA online</option>
              </select>
            </Field>
            <Field label="Submission checklist" hint="One step per line">
              <textarea
                className="textarea"
                rows={5}
                value={(completeDraft.submissionChecklist?.length ? completeDraft.submissionChecklist : filingGuidance?.checklist ?? []).join("\n")}
                onChange={(e) => setCompleteDraft({
                  ...completeDraft,
                  submissionChecklist: e.target.value.split("\n").map((row) => row.trim()).filter(Boolean),
                })}
              />
            </Field>
            <Field label="Confirmation number"><input className="input" value={completeDraft.confirmationNumber ?? ""} onChange={(e) => setCompleteDraft({ ...completeDraft, confirmationNumber: e.target.value })} /></Field>
            <Field label="Fee paid" hint="Dollars">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={completeDraft.feePaidDollars ?? ""}
                onChange={(e) => setCompleteDraft({ ...completeDraft, feePaidDollars: e.target.value })}
              />
            </Field>
            <Field label="Staged packet / pre-fill document">
              <select className="input" value={completeDraft.stagedPacketDocumentId ?? ""} onChange={(e) => setCompleteDraft({ ...completeDraft, stagedPacketDocumentId: e.target.value })}>
                <option value="">None</option>
                {(documents ?? []).map((document) => (
                  <option key={document._id} value={document._id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Receipt / evidence document">
              <select className="input" value={completeDraft.receiptDocumentId ?? ""} onChange={(e) => setCompleteDraft({ ...completeDraft, receiptDocumentId: e.target.value })}>
                <option value="">None</option>
                {(documents ?? []).map((document) => (
                  <option key={document._id} value={document._id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evidence notes">
              <textarea className="textarea" value={completeDraft.evidenceNotes ?? ""} onChange={(e) => setCompleteDraft({ ...completeDraft, evidenceNotes: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
