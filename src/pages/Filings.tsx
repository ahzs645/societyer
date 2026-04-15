import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Check, ClipboardList, Tag, Calendar, Bot } from "lucide-react";
import { formatDate, money } from "../lib/format";
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
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.filings.create);
  const markFiled = useMutation(api.filings.markFiled);
  const prompt = usePrompt();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [botFor, setBotFor] = useState<{ id: any; label: string } | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ kind: "AnnualReport", periodLabel: "", dueDate: new Date().toISOString().slice(0, 10), status: "Upcoming" });
    setOpen(true);
  };
  const save = async () => { await create({ societyId: society._id, ...form }); setOpen(false); };

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
                onClick={async () => {
                  const conf = await prompt({
                    title: "Mark filing as filed",
                    message: "Enter the confirmation number from Societies Online / CRA (optional).",
                    placeholder: "e.g. SO-2026-A12345",
                    confirmLabel: "Mark filed",
                  });
                  if (conf === null) return;
                  await markFiled({
                    id: r._id,
                    filedAt: new Date().toISOString().slice(0, 10),
                    confirmationNumber: conf || undefined,
                  });
                  toast.success("Filing marked as filed");
                }}
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
    </div>
  );
}
