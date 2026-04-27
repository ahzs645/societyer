import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { CalendarView } from "../components/CalendarView";
import { Segmented } from "../components/primitives";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { Plus, Trash2, Calendar } from "lucide-react";
import { patchInList } from "../lib/optimistic";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

export function DeadlinesPage() {
  const society = useSociety();
  const items = useQuery(api.deadlines.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.deadlines.create);
  const toggle = useMutation(api.deadlines.toggleDone).withOptimisticUpdate(
    (store, args) => {
      patchInList(store, api.deadlines.list, String(args.id), { done: args.done });
    },
  );
  const update = useMutation(api.deadlines.update);
  const remove = useMutation(api.deadlines.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "deadline",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ title: "", dueDate: new Date().toISOString().slice(0, 10), category: "Governance", recurrence: "None" });
    setOpen(true);
  };
  const save = async () => { await create({ societyId: society._id, ...form }); setOpen(false); };

  const now = Date.now();
  const records = (items ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Deadlines"
        icon={<Calendar size={16} />}
        iconColor="yellow"
        subtitle="Rolling calendar of compliance obligations — governance, tax, payroll, privacy."
        actions={
          <>
            <Segmented<"list" | "calendar">
              value={view}
              onChange={setView}
              items={[
                { id: "list", label: "List" },
                { id: "calendar", label: "Calendar" },
              ]}
            />
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New deadline
            </button>
          </>
        }
      />

      {view === "calendar" && (
        <CalendarView
          items={(items ?? []) as any[]}
          getId={(r) => r._id}
          getLabel={(r) => r.title}
          getDate={(r) => r.dueDate}
          getTone={(r) => {
            if (r.done) return "success";
            const overdue = new Date(r.dueDate).getTime() < now;
            return overdue ? "danger" : "info";
          }}
        />
      )}

      {view === "list" && (
        showMetadataWarning ? (
          <div className="record-table__empty">
            <div className="record-table__empty-title">Metadata not seeded</div>
            <div className="record-table__empty-desc">
              Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
              deadline object metadata + default view.
            </div>
          </div>
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="deadlines"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={records}
            onUpdate={async ({ recordId, fieldName, value }) => {
              await update({
                id: recordId as Id<"deadlines">,
                patch: { [fieldName]: value } as any,
              });
            }}
          >
            <RecordTableViewToolbar
              societyId={society._id}
              objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
              icon={<Calendar size={14} />}
              label="All deadlines"
              views={tableData.views}
              currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
              onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
              onOpenFilter={() => setFilterOpen((x) => !x)}
            />
            <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
            <RecordTableFilterChips />
            <RecordTable
              loading={tableData.loading || items === undefined}
              renderCell={({ record, field }) => {
                if (field.name === "done") {
                  return (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={!!record.done}
                        onChange={() => toggle({ id: record._id, done: !record.done })}
                        bare
                      />
                    </span>
                  );
                }
                if (field.name === "title") {
                  return (
                    <div>
                      <strong style={{ textDecoration: record.done ? "line-through" : "none", color: record.done ? "var(--text-tertiary)" : undefined }}>
                        {record.title}
                      </strong>
                      {record.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{record.description}</div>}
                    </div>
                  );
                }
                return undefined;
              }}
              renderRowActions={(r) => (
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete deadline ${r.title}`} onClick={() => remove({ id: r._id })}>
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
        )
      )}

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Add deadline"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(v) => setForm({ ...form, category: v })}
                  options={["Governance", "Tax", "Payroll", "Privacy", "Other"].map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Due date">
                <DatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
              </Field>
              <Field label="Recurrence">
                <Select
                  value={form.recurrence}
                  onChange={(v) => setForm({ ...form, recurrence: v })}
                  options={["None", "Monthly", "Quarterly", "Annual"].map((r) => ({ value: r, label: r }))}
                />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
