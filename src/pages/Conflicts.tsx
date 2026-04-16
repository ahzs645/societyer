import { useState, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { Plus, AlertTriangle, Tag, CheckCircle2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { useToast } from "../components/Toast";

type Augmented = any & { _directorName: string };

const CONFLICT_FIELDS: FilterField<Augmented>[] = [
  { id: "director", label: "Director", icon: <Tag size={14} />, match: (c, q) => c._directorName.toLowerCase().includes(q.toLowerCase()) },
  { id: "matter", label: "Contract / matter", icon: <Tag size={14} />, match: (c, q) => c.contractOrMatter.toLowerCase().includes(q.toLowerCase()) },
  { id: "abstained", label: "Abstained", icon: <CheckCircle2 size={14} />, options: ["Yes", "No"], match: (c, q) => (c.abstainedFromVote ? "Yes" : "No") === q },
  { id: "leftRoom", label: "Left room", icon: <CheckCircle2 size={14} />, options: ["Yes", "No"], match: (c, q) => (c.leftRoom ? "Yes" : "No") === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Open", "Resolved"], match: (c, q) => (c.resolvedAt ? "Resolved" : "Open") === q },
];

export function ConflictsPage() {
  const society = useSociety();
  const conflicts = useQuery(api.conflicts.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.conflicts.create);
  const resolve = useMutation(api.conflicts.resolve);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  const dirMap = useMemo(() => new Map<string, any>((directors ?? []).map((d: any) => [d._id, d])), [directors]);
  const augmented: Augmented[] = useMemo(() => (conflicts ?? []).map((c: any) => {
    const d = dirMap.get(c.directorId);
    return { ...c, _directorName: d ? `${d.firstName} ${d.lastName}` : "Unknown" };
  }), [conflicts, dirMap]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!directors || directors.length === 0) {
      toast.error("Add a director before recording a conflict disclosure.");
      return;
    }
    setForm({
      directorId: directors?.[0]?._id,
      declaredAt: new Date().toISOString().slice(0, 10),
      contractOrMatter: "",
      natureOfInterest: "",
      abstainedFromVote: true,
      leftRoom: true,
    });
    setOpen(true);
  };
  const save = async () => { await create({ societyId: society._id, ...form }); setOpen(false); };

  return (
    <div className="page">
      <PageHeader
        title="Conflicts of interest"
        icon={<AlertTriangle size={16} />}
        iconColor="red"
        subtitle="Disclosures under s.56. Directors & senior managers must disclose material interests, leave the room, and abstain."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New disclosure
          </button>
        }
      />

      <DataTable<Augmented>
        label="All disclosures"
        icon={<AlertTriangle size={14} />}
        data={augmented}
        rowKey={(r) => r._id}
        filterFields={CONFLICT_FIELDS}
        searchPlaceholder="Search director, contract, nature…"
        searchExtraFields={[(r) => r.natureOfInterest]}
        defaultSort={{ columnId: "declaredAt", dir: "desc" }}
        columns={[
          { id: "director", header: "Director", sortable: true, accessor: (r) => r._directorName, render: (r) => <strong>{r._directorName}</strong> },
          { id: "declaredAt", header: "Declared", sortable: true, accessor: (r) => r.declaredAt, render: (r) => <span className="mono">{formatDate(r.declaredAt)}</span> },
          { id: "contractOrMatter", header: "Contract / matter", sortable: true, accessor: (r) => r.contractOrMatter },
          { id: "natureOfInterest", header: "Nature of interest", render: (r) => <span className="muted">{r.natureOfInterest}</span> },
          { id: "abstained", header: "Abstained", sortable: true, accessor: (r) => (r.abstainedFromVote ? 1 : 0), render: (r) => r.abstainedFromVote ? <Badge tone="success">Yes</Badge> : <Badge tone="danger">No</Badge> },
          { id: "leftRoom", header: "Left room", sortable: true, accessor: (r) => (r.leftRoom ? 1 : 0), render: (r) => r.leftRoom ? <Badge tone="success">Yes</Badge> : <Badge tone="warn">No</Badge> },
          { id: "status", header: "Status", sortable: true, accessor: (r) => (r.resolvedAt ? "Resolved" : "Open"), render: (r) => r.resolvedAt ? <Badge tone="success">Resolved {formatDate(r.resolvedAt)}</Badge> : <Badge tone="warn">Open</Badge> },
        ]}
        renderRowActions={(r) => !r.resolvedAt ? (
          <button className="btn btn--sm" onClick={() => resolve({ id: r._id, resolvedAt: new Date().toISOString().slice(0, 10) })}>Resolve</button>
        ) : null}
      />

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Record disclosure"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && directors && (
          <div>
            <Field label="Director">
              <Select
                value={form.directorId}
                onChange={(v) => setForm({ ...form, directorId: v })}
                searchable
                options={directors.map((d: any) => ({
                  value: d._id,
                  label: `${d.firstName} ${d.lastName}`,
                  hint: d.position,
                }))}
              />
            </Field>
            <Field label="Declared on">
              <DatePicker value={form.declaredAt} onChange={(v) => setForm({ ...form, declaredAt: v })} />
            </Field>
            <Field label="Contract / matter"><input className="input" value={form.contractOrMatter} onChange={(e) => setForm({ ...form, contractOrMatter: e.target.value })} /></Field>
            <Field label="Nature of interest"><textarea className="textarea" value={form.natureOfInterest} onChange={(e) => setForm({ ...form, natureOfInterest: e.target.value })} /></Field>
            <Checkbox
              checked={!!form.abstainedFromVote}
              onChange={(v) => setForm({ ...form, abstainedFromVote: v })}
              label="Abstained from vote"
            />
            <Checkbox
              checked={!!form.leftRoom}
              onChange={(v) => setForm({ ...form, leftRoom: v })}
              label="Left room during discussion"
            />
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
