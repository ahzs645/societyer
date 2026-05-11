import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, Badge } from "../components/ui";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
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

/**
 * PIPA + CASL training records. The record table shows the date
 * columns as plain ISO; the "next due" chip (overdue / in N days) is
 * kept as a `renderCell` override so the muted/warn/danger styling
 * continues to reflect the days-left heuristic.
 */
export function PipaTrainingPage() {
  const society = useSociety();
  const items = useQuery(api.pipaTraining.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.pipaTraining.create);
  const update = useMutation(api.pipaTraining.update);
  const remove = useMutation(api.pipaTraining.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "pipaTraining",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      participantName: "",
      role: "Staff",
      topic: "PIPA",
      completedAtISO: new Date().toISOString().slice(0, 10),
      nextDueAtISO: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  const records = (items ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="PIPA training"
        icon={<ShieldCheck size={16} />}
        iconColor="green"
        subtitle="PIPA + CASL training records for directors, staff, and volunteers. Annual renewal recommended."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Log training
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="PIPA-training" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="pipa-training"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={async ({ recordId, fieldName, value }) => {
            await update({
              id: recordId as Id<"pipaTrainings">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<ShieldCheck size={14} />}
            label="All training records"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderCell={({ field, value }) => {
              if (field.name === "nextDueAtISO") {
                if (!value) return <span className="muted">—</span>;
                const days = Math.floor(
                  (new Date(String(value)).getTime() - Date.now()) / 86_400_000,
                );
                return (
                  <span className="row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="mono">{formatDate(String(value))}</span>
                    <Badge tone={days < 0 ? "danger" : days <= 30 ? "warn" : "info"}>
                      {days < 0 ? `${-days}d overdue` : `in ${days}d`}
                    </Badge>
                  </span>
                );
              }
              return undefined;
            }}
            renderRowActions={(r) => (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete training record for ${r.participantName}`}
                onClick={() => remove({ id: r._id })}
              >
                <Trash2 size={12} />
              </button>
            )}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Log training"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Participant"><input className="input" value={form.participantName} onChange={(e) => setForm({ ...form, participantName: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={form.participantEmail ?? ""} onChange={(e) => setForm({ ...form, participantEmail: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Role">
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option>Director</option><option>Staff</option><option>Volunteer</option>
                </select>
              </Field>
              <Field label="Topic">
                <select className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
                  <option>PIPA</option><option>CASL</option><option>Privacy-refresh</option>
                </select>
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Completed"><input className="input" type="date" value={form.completedAtISO} onChange={(e) => setForm({ ...form, completedAtISO: e.target.value })} /></Field>
              <Field label="Next due"><input className="input" type="date" value={form.nextDueAtISO ?? ""} onChange={(e) => setForm({ ...form, nextDueAtISO: e.target.value })} /></Field>
            </div>
            <Field label="Trainer"><input className="input" value={form.trainer ?? ""} onChange={(e) => setForm({ ...form, trainer: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
