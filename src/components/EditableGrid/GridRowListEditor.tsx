import { useState } from "react";
import { AlertCircle, ChevronRight, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { Modal } from "../Modal";
import { Field } from "../ui";
import { Select } from "../Select";
import { DatePicker } from "../DatePicker";
import { useToast } from "../Toast";
import { formatMoney } from "../../lib/money";
import type { EditableGridProps, GridColumn, GridRow } from "./types";
import {
  cellDisplay,
  cellError,
  cellText,
  cellValue,
  columnOptions,
  columnTotal,
  isBlankRow,
  isInvalidCell,
  isMoneyColumn,
  isReadOnlyColumn,
  parseCellText,
} from "./values";

type Draft = Record<string, string>;

/**
 * Phone fallback for EditableGrid: no cell grid on touch. Rows are a tappable
 * list; each opens a form sheet. Same changeset, history and validation.
 */
export function GridRowListEditor<R extends GridRow>({
  label,
  columns,
  rows,
  onRowsChange,
  createRow,
  history,
  allowAddRows = true,
  allowDeleteRows = true,
  minRows = 0,
  rowErrors,
  toolbar,
  summary,
  rowLabel,
  readOnly,
  rowNoun = "row",
  className,
}: EditableGridProps<R>) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ index: number; row: R; isNew: boolean } | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canEdit = !readOnly;
  const titleColumn = columns[0];
  const totals = columns.filter((col) => col.total);

  const open = (index: number, row: R, isNew = false) => {
    const next: Draft = {};
    for (const col of columns) {
      const value = row[col.key];
      next[col.key] = col.type === "select" || col.type === "date" ? (typeof value === "string" ? value : "") : cellText(value, col, row);
    }
    setDraft(next);
    setErrors({});
    setEditing({ index, row, isNew });
  };

  const save = () => {
    if (!editing) return;
    let row = { ...editing.row } as R;
    const nextErrors: Record<string, string> = {};
    for (const col of columns) {
      if (isReadOnlyColumn(col, row)) continue;
      const text = draft[col.key] ?? "";
      if (col.type === "select" || col.type === "date") {
        row = { ...row, [col.key]: text };
        continue;
      }
      const parsed = parseCellText(text, col, row);
      if (parsed.ok) row = { ...row, [col.key]: parsed.value };
      else nextErrors[col.key] = parsed.error;
    }
    // Text that cannot be read blocks Done; rule errors (a missing account,
    // an unbalanced line) are kept and flagged on the row, like the grid.
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const all = editing.isNew ? [...rows, row] : rows.map((r, i) => (i === editing.index ? row : r));
    if (editing.isNew && isBlankRow(row, columns)) { setEditing(null); return; }
    onRowsChange(all, editing.isNew ? `Add ${rowNoun}` : `Edit ${rowNoun}`);
    setEditing(null);
  };

  const remove = () => {
    if (!editing || editing.isNew) { setEditing(null); return; }
    const index = editing.index;
    let next = rows.filter((_, i) => i !== index);
    while (next.length < minRows) next = [...next, createRow()];
    onRowsChange(next, `Delete ${rowNoun}`);
    setEditing(null);
    toast.info(`Deleted ${rowNoun} ${index + 1}`, history ? { action: { label: "Undo", onClick: () => { history.undo(); } } } : undefined);
  };

  const titleFor = (row: R, index: number) =>
    rowLabel?.(row, index) || cellDisplay(cellValue(row, titleColumn), titleColumn, row) || `${rowNoun[0].toUpperCase()}${rowNoun.slice(1)} ${index + 1}`;

  return (
    <div className={`egrid egrid--list${className ? ` ${className}` : ""}`}>
      <div className="egrid__toolbar" role="toolbar" aria-label={`${label} tools`}>
        {canEdit && allowAddRows && (
          <button type="button" className="btn btn--sm" onClick={() => open(rows.length, createRow(), true)}>
            <Plus size={14} /> Add {rowNoun}
          </button>
        )}
        {history && (
          <span className="egrid__toolbar-group">
            <button type="button" className="btn btn--sm btn--ghost btn--icon" aria-label="Undo" disabled={!history.canUndo} onClick={() => history.undo()}>
              <Undo2 size={14} />
            </button>
            <button type="button" className="btn btn--sm btn--ghost btn--icon" aria-label="Redo" disabled={!history.canRedo} onClick={() => history.redo()}>
              <Redo2 size={14} />
            </button>
          </span>
        )}
        {toolbar}
      </div>

      <ul className="egrid-list" aria-label={label}>
        {rows.map((row, index) => {
          const rowError = rowErrors?.[row.key] ?? columns.map((col) => cellError(row, col, rows, columns)).find(Boolean);
          const blank = isBlankRow(row, columns);
          const details = columns.slice(1)
            .map((col) => {
              const text = cellDisplay(cellValue(row, col), col, row);
              return text ? { key: col.key, label: col.header, text, money: isMoneyColumn(col) } : null;
            })
            .filter(Boolean) as Array<{ key: string; label: string; text: string; money: boolean }>;
          return (
            <li key={row.key}>
              <button
                type="button"
                className={`egrid-list__row${rowError ? " is-invalid" : ""}${blank ? " is-blank" : ""}`}
                onClick={() => canEdit && open(index, row)}
                disabled={!canEdit}
              >
                <span className="egrid-list__main">
                  <span className="egrid-list__title">{blank ? `Empty ${rowNoun} — tap to fill in` : titleFor(row, index)}</span>
                  {details.length > 0 && (
                    <span className="egrid-list__meta">
                      {details.map((d) => (
                        <span key={d.key} className={d.money ? "money" : undefined}>{d.label} {d.text}</span>
                      ))}
                    </span>
                  )}
                  {rowError && <span className="egrid-list__error"><AlertCircle size={12} aria-hidden="true" /> {rowError}</span>}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="egrid-list__empty">No {rowNoun}s yet.</li>}
      </ul>

      {totals.length > 0 && (
        <dl className="egrid-list__totals">
          {totals.map((col) => (
            <div key={col.key}>
              <dt>{col.header} total</dt>
              <dd className="money">{isMoneyColumn(col) ? formatMoney(columnTotal(rows, col), { currency: col.currency }) : columnTotal(rows, col).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary && <div className="egrid__status">{summary}</div>}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? (editing.isNew ? `New ${rowNoun}` : `${rowNoun[0].toUpperCase()}${rowNoun.slice(1)} ${editing.index + 1}`) : ""}
        footer={
          <>
            {editing && !editing.isNew && allowDeleteRows && (
              <button type="button" className="btn btn--ghost egrid-list__delete" onClick={remove}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn btn--accent" onClick={save}>Done</button>
          </>
        }
      >
        {editing && (
          <div className="col egrid-list__form">
            {columns.map((col) => (
              <RowField
                key={col.key}
                col={col}
                row={editing.row}
                value={draft[col.key] ?? ""}
                error={errors[col.key] ?? invalidError(editing.row[col.key]) ?? (editing.isNew ? null : cellError(editing.row, col, rows, columns))}
                onChange={(value) => setDraft((d) => ({ ...d, [col.key]: value }))}
              />
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function invalidError(value: unknown) {
  return isInvalidCell(value) ? value.error : null;
}

function RowField<R extends GridRow>({ col, row, value, error, onChange }: {
  col: GridColumn<R>;
  row: R;
  value: string;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  if (col.type === "computed" || isReadOnlyColumn(col, row)) {
    return (
      <Field label={col.header}>
        <div className="egrid-list__readonly">{cellDisplay(cellValue(row, col), col, row) || "—"}</div>
      </Field>
    );
  }
  if (col.type === "select") {
    return (
      <Field label={col.header} required={col.required} error={error ?? undefined}>
        <Select
          value={value}
          onChange={onChange}
          searchable
          clearable={!col.required}
          clearLabel={col.placeholder ?? "None"}
          placeholder={col.placeholder ?? `Choose ${col.header.toLowerCase()}`}
          options={columnOptions(col, row).map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
        />
      </Field>
    );
  }
  if (col.type === "date") {
    return (
      <Field label={col.header} required={col.required} error={error ?? undefined}>
        <DatePicker value={value} onChange={onChange} />
      </Field>
    );
  }
  const numeric = col.type === "money" || col.type === "number";
  return (
    <Field label={col.header} required={col.required} error={error ?? undefined}>
      <input
        className="input"
        value={value}
        inputMode={numeric ? "decimal" : undefined}
        placeholder={col.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
