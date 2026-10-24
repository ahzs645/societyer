import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { calendarDate, calendarDateKey } from "../lib/calendarDates";
import { isPastDue } from "../../shared/dateOnly";
import { isPayrollRoeDeadline } from "../../shared/payrollDeadline";
import { Segmented } from "../components/primitives";
import { Select } from "../components/Select";
import { useIsBottomSheet } from "../lib/useSheetDrag";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { Plus, Trash2, Calendar, Archive, RotateCcw } from "lucide-react";
import { patchInList } from "../lib/optimistic";
import { organizationVocabulary } from "../lib/organizationVocabulary";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
  type RecordTableInlineEdit,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { MarkdownEditor, type MarkdownEditorHandle } from "../components/MarkdownEditor";

type DeadlineStatus = "open" | "complete" | "closed";
type StatusFilter = "open" | "complete" | "closed" | "all";
const STATUS_FILTER_ITEMS: { id: StatusFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "complete", label: "Complete" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

/**
 * Spreadsheet editing for the deadline list (RecordTable grid mode). Each
 * edit saves through the scope's `onUpdate` (deadlines.update); status keeps
 * its checkbox and completion workflow, so it is not a grid column.
 */
const DEADLINE_INLINE_EDIT: RecordTableInlineEdit = {
  columns: {
    title: { editor: "text", required: true, readOnly: isPayrollRoeDeadline },
    description: { editor: "text", readOnly: isPayrollRoeDeadline },
    dueDate: { editor: "date", required: true, readOnly: isPayrollRoeDeadline },
    category: { editor: "select", required: true, readOnly: isPayrollRoeDeadline },
    recurrence: { editor: "select", required: true, readOnly: isPayrollRoeDeadline },
  },
};

function statusLabel(status: StatusFilter) {
  return STATUS_FILTER_ITEMS.find((item) => item.id === status)?.label ?? status;
}

function statusOf(record: any): DeadlineStatus {
  if (record?.status === "open" || record?.status === "complete" || record?.status === "closed") {
    return record.status;
  }
  return record?.done ? "complete" : "open";
}
const canEditDeadlineRecord = (record: { sourceKey?: unknown }) => !isPayrollRoeDeadline(record);

export function DeadlinesPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canWrite = can("deadlines:write");
  const items = useQuery(api.deadlines.list, society ? { societyId: society._id } : "skip");
  const create = usePermissionedMutation(api.deadlines.create, canWrite);
  const setStatus = usePermissionedMutation(api.deadlines.setStatus, canWrite).withOptimisticUpdate(
    (store, args) => {
      patchInList(store, api.deadlines.list, String(args.id), {
        status: args.status,
        done: args.status === "complete",
      });
    },
  );
  const update = usePermissionedMutation(api.deadlines.update, canWrite);
  const remove = usePermissionedMutation(api.deadlines.remove, canWrite);
  const confirm = useConfirm();
  const toast = useToast();
  const undoable = useUndoableAction();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"deadlines"> | null>(null);
  const [saving, setSaving] = useState(false);
  const descriptionEditor = useRef<MarkdownEditorHandle>(null);
  const [form, setForm] = useState<any>(null);
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>("open");
  // Deadlines moved to a status this tab hides (a kanban drop, a status
  // edit) stay on screen until the tab changes, so they do not vanish
  // mid-gesture; the toast explains where they went.
  const [movedOutIds, setMovedOutIds] = useState<ReadonlySet<string>>(() => new Set());
  const setStatusFilter = (next: StatusFilter) => {
    setMovedOutIds(new Set());
    setStatusFilterState(next);
  };
  const isPhone = useIsBottomSheet();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "deadline",
    viewId: currentViewId,
  });

  const allRecords = (items ?? []) as any[];
  const editingDerived = !!editingId && isPayrollRoeDeadline(allRecords.find((row) => row._id === editingId) ?? {});
  const canEdit = canWrite && !editingDerived;
  const records = useMemo(() => {
    const visible = statusFilter === "all"
      ? allRecords
      : allRecords.filter((r) => statusOf(r) === statusFilter || movedOutIds.has(String(r._id)));
    // Soonest first by default (a sort chosen in the table still wins); undated last.
    return [...visible].sort((a, b) => String(a.dueDate || "\uffff").localeCompare(String(b.dueDate || "\uffff")));
  }, [allRecords, statusFilter, movedOutIds]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    setEditingId(null);
    setForm({ title: "", dueDate: calendarDateKey(new Date()), category: "Governance", recurrence: "None" });
    setOpen(true);
  };
  const openRecord = (record: any) => {
    setEditingId(record._id);
    setForm({ title: record.title, description: record.description, dueDate: record.dueDate,
      category: record.category, recurrence: record.recurrence ?? "None", recurrenceEndDate: record.recurrenceEndDate });
    setOpen(true);
  };
  const save = async () => {
    if (!canEdit || saving || !form.title?.trim()) return;
    setSaving(true);
    try {
      const { recurrenceEndDate, ...rest } = { ...form, description: descriptionEditor.current?.getMarkdown() ?? form.description };
      const values = { ...rest, title: rest.title.trim(),
        ...(editingId ? { recurrenceEndDate: rest.recurrence !== "None" ? recurrenceEndDate ?? "" : "" }
          : rest.recurrence && rest.recurrence !== "None" && recurrenceEndDate ? { recurrenceEndDate } : {}) };
      if (editingId) await update({ id: editingId, patch: values });
      else await create({ societyId: society._id, ...values });
      setOpen(false);
      toast.success(editingId ? "Deadline updated" : "Deadline created");
    } catch (error) {
      toast.error("Couldn't save deadline", error instanceof Error ? error.message : undefined);
    } finally { setSaving(false); }
  };

  const handleDelete = async (record: any) => {
    if (!canWrite || isPayrollRoeDeadline(record)) return;
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
  const completeAndNotify = async (record: any, moved?: { note: string; show: { label: string; onClick: () => void } }) => {
    if (!canWrite || isPayrollRoeDeadline(record)) return;
    const id = record._id as Id<"deadlines">;
    let res: any;
    try {
      res = await setStatus({ id, status: "complete" });
    } catch (error) {
      toast.error("Couldn't complete deadline", error instanceof Error ? error.message : undefined);
      return;
    }
    const spawnedDue: string | null = res?.spawnedDue ?? null;
    const spawnedId: string | null = res?.spawnedId ?? null;
    let description: string | undefined;
    if (spawnedDue) {
      const when = new Date(spawnedDue).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      description = `Next occurrence added for ${when}.`;
    } else if (String(record?.recurrence ?? "None") !== "None") {
      description = "This was the last occurrence — the recurrence has ended.";
    }
    // Every completion can be reopened; a recurring one also drops the
    // occurrence it spawned.
    await undoable({
      message: "Deadline completed",
      description: [description, moved?.note].filter(Boolean).join(" ") || undefined,
      secondaryAction: moved?.show,
      dedupeKey: `deadline-complete-${id}`,
      undo: () => undoComplete(id, spawnedId),
      undoneMessage: "Deadline reopened",
    });
  };

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Deadlines"
        icon={<Calendar size={16} />}
        iconColor="yellow"
        subtitle={`Dates set by law or regulation: filings, ${organizationVocabulary(society).isSociety ? "AGMs" : "annual meetings"} and renewals.`}
        info={
          <p>Internal work items belong in Tasks; promises made to funders or partners belong in Commitments.</p>
        }
        actions={
          <>
            {/* Phones: the status switch is a compact picker on the title row. */}
            {isPhone && (
              <Select<StatusFilter>
                size="sm"
                className="page-header-filter"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_FILTER_ITEMS.map((item) => ({ value: item.id, label: item.label }))}
                aria-label="Show deadlines"
              />
            )}
            <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
              <Plus size={12} /> New deadline
            </button>
          </>
        }
      />

        {!isPhone && (
        <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "var(--s-2)" }}>
          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            items={STATUS_FILTER_ITEMS}
          />
        </div>
        )}

      {(
        showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="deadline" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="deadlines"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={records}
            canEditRecord={canEditDeadlineRecord}
            onRecordClick={(_id, record) => openRecord(record)}
            onUpdate={canWrite ? async ({ recordId, fieldName, value }) => {
              const record = allRecords.find((row) => row._id === recordId);
              if (isPayrollRoeDeadline(record ?? {})) {
                toast.error("ROE deadlines are maintained by the payroll ROE workflow.");
                return;
              }
              if (fieldName === "status") {
                const nextStatus = value as DeadlineStatus;
                const rec = allRecords.find((r) => r._id === recordId);
                const previousStatus = rec ? statusOf(rec) : "open";
                // Moving a deadline out of the current tab (e.g. dropping an
                // Open card on Complete) keeps it visible here and says so,
                // with Undo and a way to follow it to its new tab.
                const leavesView = statusFilter !== "all" && nextStatus !== statusFilter && previousStatus !== nextStatus;
                if (leavesView) setMovedOutIds((current) => new Set(current).add(String(recordId)));
                const moved = leavesView ? {
                  note: `Not in ${statusLabel(statusFilter)} any more; shown here until you switch tabs.`,
                  show: { label: "Show", onClick: () => setStatusFilter(nextStatus) },
                } : undefined;
                if (nextStatus === "complete" && rec && previousStatus !== "complete") {
                  await completeAndNotify(rec, moved);
                } else {
                  await setStatus({ id: recordId as Id<"deadlines">, status: nextStatus });
                  if (moved) {
                    await undoable({
                      message: `Moved to ${statusLabel(nextStatus)}`,
                      description: moved.note,
                      secondaryAction: moved.show,
                      dedupeKey: `deadline-status-${recordId}`,
                      undo: () => setStatus({ id: recordId as Id<"deadlines">, status: previousStatus }),
                      undoneMessage: `Moved back to ${statusLabel(previousStatus)}`,
                    });
                  }
                }
                return;
              }
              await update({
                id: recordId as Id<"deadlines">,
                patch: { [fieldName]: value } as any,
              });
            } : undefined}
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
              inlineEdit={canWrite ? DEADLINE_INLINE_EDIT : undefined}
              canMoveRecord={canEditDeadlineRecord}
              renderCell={({ record, field }) => {
                if (field.name === "status") {
                  const s = statusOf(record);
                  if (s === "closed") {
                    return <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Closed</span>;
                  }
                  return (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        disabled={!canWrite || isPayrollRoeDeadline(record)}
                        checked={s === "complete"}
                        onChange={() => {
                          if (isPayrollRoeDeadline(record)) return;
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
                  const isOverdue = s === "open" && isPastDue(record.dueDate);
                  if (!record.dueDate) return <span className="record-cell__empty">—</span>;
                  return (
                    <span style={isOverdue ? { color: "var(--danger)", fontWeight: 600 } : undefined} title={isOverdue ? "Overdue" : undefined}>
                      {(calendarDate(record.dueDate) ?? new Date(record.dueDate)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      {isOverdue && <span className="sr-only"> (overdue)</span>}
                    </span>
                  );
                }
                if (field.name === "title") {
                  const s = statusOf(record);
                  const isComplete = s === "complete";
                  const isClosed = s === "closed";
                  return (
                    <div className="deadline-title-cell" title={record.description ? `${record.title}\n${record.description}` : undefined}>
                      <strong
                        style={{
                          textDecoration: isComplete ? "line-through" : "none",
                          color: isComplete || isClosed ? "var(--text-tertiary)" : undefined,
                          fontStyle: isClosed ? "italic" : undefined,
                        }}
                      >
                        {record.title}
                      </strong>
                      {record.description && <div className="deadline-title-cell__desc">{record.description}</div>}
                      {isPayrollRoeDeadline(record) && <a href="/app/payroll/calculator?tab=roe" onClick={(event) => event.stopPropagation()}>Managed by ROE workflow</a>}
                    </div>
                  );
                }
                return undefined;
              }}
              renderRowActions={(r) => {
                if (isPayrollRoeDeadline(r)) return <a className="btn btn--ghost btn--sm" href="/app/payroll/calculator?tab=roe">Open ROE workflow</a>;
                const s = statusOf(r);
                const isClosed = s === "closed";
                return (
                  <>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={isClosed ? `Reopen deadline ${r.title}` : `Mark deadline ${r.title} as closed`}
                      title={isClosed ? "Reopen" : "Mark as closed"}
                      onClick={() => setStatus({ id: r._id, status: isClosed ? "open" : "closed" })}
                    disabled={!canWrite}
                   >
                      {isClosed ? <RotateCcw size={12} /> : <Archive size={12} />}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Delete deadline ${r.title}`}
                      onClick={() => handleDelete(r)}
                    disabled={!canWrite}
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
        open={open} onClose={() => { if (!saving) setOpen(false); }} title={editingId ? canEdit ? "Edit deadline" : "View deadline" : "Add deadline"}
        footer={<><button className="btn" onClick={() => setOpen(false)} disabled={saving}>{editingDerived ? "Close" : "Cancel"}</button>{editingDerived ? <a className="btn btn--accent" href="/app/payroll/calculator?tab=roe">Open ROE workflow</a> : <button className="btn btn--accent" onClick={save} disabled={!canEdit || saving || !form?.title?.trim()}>{saving ? "Saving…" : "Save"}</button>}</>}
      >
        {form && (
          <fieldset disabled={!canEdit || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {editingDerived && <p role="status">This deadline is derived from retained ROE issuance and follow-up facts. Update those facts in the payroll ROE workflow.</p>}
            <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 0, marginBottom: 12 }}>
              Use a deadline for dates imposed by law or regulation. Internal work belongs in Tasks; promises to funders or partners belong in Commitments.
            </p>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><MarkdownEditor ref={descriptionEditor} readOnly={!canEdit || saving} rows={4} value={form.description ?? ""} onChange={(markdown) => setForm({ ...form, description: markdown })} /></Field>
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
          </fieldset>
        )}
      </Drawer>
    </div>
  );
}
