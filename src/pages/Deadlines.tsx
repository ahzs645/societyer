import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { CalendarView } from "../components/CalendarView";
import { Segmented } from "../components/primitives";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Trash2, Calendar, Archive, RotateCcw } from "lucide-react";
import { patchInList } from "../lib/optimistic";
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
import { MarkdownEditor } from "../components/MarkdownEditor";

type DeadlineStatus = "open" | "complete" | "closed";
type StatusFilter = "open" | "complete" | "closed" | "all";

function statusOf(record: any): DeadlineStatus {
  if (record?.status === "open" || record?.status === "complete" || record?.status === "closed") {
    return record.status;
  }
  return record?.done ? "complete" : "open";
}

export function DeadlinesPage() {
  const society = useSociety();
  const items = useQuery(api.deadlines.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.deadlines.create);
  const setStatus = useMutation(api.deadlines.setStatus).withOptimisticUpdate(
    (store, args) => {
      patchInList(store, api.deadlines.list, String(args.id), {
        status: args.status,
        done: args.status === "complete",
      });
    },
  );
  const update = useMutation(api.deadlines.update);
  const remove = useMutation(api.deadlines.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "deadline",
    viewId: currentViewId,
  });

  const allRecords = (items ?? []) as any[];
  const records = useMemo(() => {
    if (statusFilter === "all") return allRecords;
    return allRecords.filter((r) => statusOf(r) === statusFilter);
  }, [allRecords, statusFilter]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ title: "", dueDate: new Date().toISOString().slice(0, 10), category: "Governance", recurrence: "None" });
    setOpen(true);
  };
  const save = async () => {
    const { recurrenceEndDate, ...rest } = form;
    await create({
      societyId: society._id,
      ...rest,
      // Only send a bound when the deadline actually recurs and one was picked.
      ...(rest.recurrence && rest.recurrence !== "None" && recurrenceEndDate
        ? { recurrenceEndDate }
        : {}),
    });
    setOpen(false);
  };

  const handleDelete = async (record: any) => {
    const ok = await confirm({
      title: "Delete deadline?",
      message: `"${record.title}" will be permanently removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: record._id });
  };

  // Reopen the completed deadline and drop the occurrence its completion spawned.
  const undoComplete = async (id: Id<"deadlines">, spawnedId: string | null) => {
    await setStatus({ id, status: "open" });
    if (spawnedId) {
      try {
        await remove({ id: spawnedId as Id<"deadlines"> });
      } catch {
        // The spawned occurrence may already be gone; nothing to undo.
      }
    }
  };

  // Complete a deadline and make the outcome visible: a recurring one silently
  // rolls forward, so surface the next date (with an Undo) instead of it looking
  // like nothing changed.
  const completeAndNotify = async (record: any) => {
    const id = record._id as Id<"deadlines">;
    const res: any = await setStatus({ id, status: "complete" });
    const spawnedDue: string | null = res?.spawnedDue ?? null;
    const spawnedId: string | null = res?.spawnedId ?? null;
    if (spawnedDue) {
      const when = new Date(spawnedDue).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      toast.success("Deadline completed", {
        description: `Next occurrence added for ${when}.`,
        action: { label: "Undo", onClick: () => undoComplete(id, spawnedId) },
      });
    } else if (String(record?.recurrence ?? "None") !== "None") {
      toast.success("Deadline completed", {
        description: "This was the last occurrence — the recurrence has ended.",
      });
    } else {
      toast.success("Deadline completed");
    }
  };

  const now = Date.now();
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Deadlines"
        icon={<Calendar size={16} />}
        iconColor="yellow"
        subtitle="Dates imposed by law or regulation, like filings, AGMs, and renewals. For internal work items, use Tasks; for promises made to funders or partners, use Commitments."
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

      {view === "list" && (
        <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "var(--s-2)" }}>
          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              { id: "open", label: "Open" },
              { id: "complete", label: "Complete" },
              { id: "closed", label: "Closed" },
              { id: "all", label: "All" },
            ]}
          />
        </div>
      )}

      {view === "calendar" && (
        <CalendarView
          items={allRecords}
          getId={(r) => r._id}
          getLabel={(r) => r.title}
          getDate={(r) => r.dueDate}
          getTone={(r) => {
            const s = statusOf(r);
            if (s === "complete") return "success";
            if (s === "closed") return "neutral";
            const overdue = new Date(r.dueDate).getTime() < now;
            return overdue ? "danger" : "info";
          }}
        />
      )}

      {view === "list" && (
        showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="deadline" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="deadlines"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={records}
            onUpdate={async ({ recordId, fieldName, value }) => {
              if (fieldName === "status") {
                const nextStatus = value as DeadlineStatus;
                const rec = allRecords.find((r) => r._id === recordId);
                if (nextStatus === "complete" && rec && statusOf(rec) !== "complete") {
                  await completeAndNotify(rec);
                } else {
                  await setStatus({ id: recordId as Id<"deadlines">, status: nextStatus });
                }
                return;
              }
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
                if (field.name === "status") {
                  const s = statusOf(record);
                  if (s === "closed") {
                    return <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Closed</span>;
                  }
                  return (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={s === "complete"}
                        onChange={() => {
                          if (s === "complete") {
                            setStatus({ id: record._id, status: "open" });
                          } else {
                            completeAndNotify(record);
                          }
                        }}
                        bare
                      />
                    </span>
                  );
                }
                if (field.name === "dueDate") {
                  const s = statusOf(record);
                  const isOverdue = s === "open" && record.dueDate && new Date(record.dueDate).getTime() < Date.now();
                  if (!record.dueDate) return <span className="record-cell__empty">—</span>;
                  return (
                    <span style={isOverdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                      {new Date(record.dueDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      {isOverdue && " · Overdue"}
                    </span>
                  );
                }
                if (field.name === "title") {
                  const s = statusOf(record);
                  const isComplete = s === "complete";
                  const isClosed = s === "closed";
                  return (
                    <div>
                      <strong
                        style={{
                          textDecoration: isComplete ? "line-through" : "none",
                          color: isComplete || isClosed ? "var(--text-tertiary)" : undefined,
                          fontStyle: isClosed ? "italic" : undefined,
                        }}
                      >
                        {record.title}
                      </strong>
                      {record.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{record.description}</div>}
                    </div>
                  );
                }
                return undefined;
              }}
              renderRowActions={(r) => {
                const s = statusOf(r);
                const isClosed = s === "closed";
                return (
                  <>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={isClosed ? `Reopen deadline ${r.title}` : `Mark deadline ${r.title} as closed`}
                      title={isClosed ? "Reopen" : "Mark as closed"}
                      onClick={() => setStatus({ id: r._id, status: isClosed ? "open" : "closed" })}
                    >
                      {isClosed ? <RotateCcw size={12} /> : <Archive size={12} />}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Delete deadline ${r.title}`}
                      onClick={() => handleDelete(r)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                );
              }}
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
            <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 0, marginBottom: 12 }}>
              Use a deadline for dates imposed by law or regulation. Internal work belongs in Tasks; promises to funders or partners belong in Commitments.
            </p>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><MarkdownEditor rows={4} value={form.description ?? ""} onChange={(markdown) => setForm({ ...form, description: markdown })} /></Field>
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
                  onChange={(v) =>
                    setForm({
                      ...form,
                      recurrence: v,
                      recurrenceEndDate: v === "None" ? undefined : form.recurrenceEndDate,
                    })
                  }
                  options={["None", "Monthly", "Quarterly", "Annual"].map((r) => ({ value: r, label: r }))}
                />
              </Field>
            </div>
            {form.recurrence && form.recurrence !== "None" && (
              <Field label="Repeat until (optional)">
                <DatePicker
                  value={form.recurrenceEndDate ?? ""}
                  min={form.dueDate}
                  placeholder="No end date"
                  onChange={(v) => setForm({ ...form, recurrenceEndDate: v || undefined })}
                />
                <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>
                  After this date, completing the deadline won't create another occurrence. Leave
                  empty to repeat indefinitely.
                </p>
              </Field>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
