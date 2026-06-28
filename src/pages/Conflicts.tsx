import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { Plus, AlertTriangle } from "lucide-react";
import { formatDate } from "../lib/format";
import { useToast } from "../components/Toast";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

export function ConflictsPage() {
  const society = useSociety();
  const conflicts = useQuery(api.conflicts.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.conflicts.create);
  const resolve = useMutation(api.conflicts.resolve);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [params, setParams] = useSearchParams();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "conflict",
    viewId: currentViewId,
  });

  const dirMap = useMemo(() => new Map<string, any>((directors ?? []).map((d: any) => [d._id, d])), [directors]);
  // Augment records with the derived `director` name and `status` so the record
  // table renders them as plain columns.
  const records: any[] = useMemo(() => (conflicts ?? []).map((c: any) => {
    const d = dirMap.get(c.directorId);
    return {
      ...c,
      director: d ? `${d.firstName} ${d.lastName}` : "Unknown",
      status: c.resolvedAt ? "Resolved" : "Open",
    };
  }), [conflicts, dirMap]);
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

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

  useEffect(() => {
    if (!society || open || directors === undefined) return;
    if (params.get("intent") !== "disclose") return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    openNew();
  }, [directors, open, params, setParams, society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

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

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="conflict disclosure" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="conflicts"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<AlertTriangle size={14} />}
            label="All disclosures"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || conflicts === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "status") {
                return record.resolvedAt
                  ? <Badge tone="success">Resolved {formatDate(record.resolvedAt)}</Badge>
                  : <Badge tone="warn">Open</Badge>;
              }
              if (field.name === "director") return <strong>{record.director}</strong>;
              return undefined;
            }}
            renderRowActions={(r) => !r.resolvedAt ? (
              <button className="btn btn--sm" onClick={() => resolve({ id: r._id, resolvedAt: new Date().toISOString().slice(0, 10) })}>Resolve</button>
            ) : null}
          />
        </RecordTableScope>
      ) : null}

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
            <Field label="Nature of interest"><MarkdownEditor rows={4} value={form.natureOfInterest} onChange={(markdown) => setForm({ ...form, natureOfInterest: markdown })} /></Field>
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
            <Field label="Notes"><MarkdownEditor rows={4} value={form.notes ?? ""} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
