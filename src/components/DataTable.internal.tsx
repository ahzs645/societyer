// Private sub-components for DataTable.tsx (popovers, editable cell, resize handle).
import type { Column, SortState, EditableCellConfig, BulkAction } from "./DataTable";

import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ViewBar } from "./primitives";
import {
  AppliedFilter,
  FilterChips,
  FilterField,
  FilterGroup,
  FilterPopover,
  applyFilters,
  evaluateGroup,
} from "./FilterBar";
import { AdvancedFilterModal } from "./AdvancedFilter";
import { MenuRow, MenuSectionLabel, Pill, Skeleton } from "./ui";
import { mobileCardMediaQuery } from "../lib/breakpoints";
import {
  makeViewId,
  readSavedViews,
  savedViewFromWorkspaceView,
  savedViewToWorkspacePayload,
  writeSavedViews,
  type SavedView,
  type SharedSavedViewsContext,
} from "../lib/savedViews";
import { useUIStore } from "../lib/store";
import { cellToText, copyAsTsv } from "../lib/clipboard";
import { useToast } from "./Toast";
import { api } from "../lib/convexApi";
import { Select } from "./Select";
import { NameAutocomplete } from "./NameAutocomplete";
import { useScrollEdgeShadows } from "../lib/useScrollEdgeShadows";


const EMPTY_ARR: string[] = [];


function SortPopover<T>({
  columns,
  anchorRef,
  current,
  onPick,
  onClose,
}: {
  columns: Column<T>[];
  anchorRef: React.RefObject<HTMLElement>;
  current: SortState;
  onPick: (s: SortState) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const POPOVER_W = 240;
  const POPOVER_H = 280;
  const margin = 8;
  const style = rect
    ? {
        top: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - POPOVER_H - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - POPOVER_W - margin)),
      }
    : { top: 48, left: 16 };

  return (
    <div className="popover" ref={ref} style={style}>
      <MenuSectionLabel>Sort ascending</MenuSectionLabel>
      {columns.map((c) => (
        <MenuRow
          key={c.id}
          label={typeof c.header === "string" ? c.header : c.id}
          hint="Ascending"
          right={current?.columnId === c.id && current?.dir === "asc" ? <Pill size="sm">Current</Pill> : null}
          onClick={() => onPick({ columnId: c.id, dir: "asc" })}
        />
      ))}
      <div className="menu__separator" />
      <MenuSectionLabel>Sort descending</MenuSectionLabel>
      {columns.map((c) => (
        <MenuRow
          key={c.id + "-d"}
          label={typeof c.header === "string" ? c.header : c.id}
          hint="Descending"
          right={current?.columnId === c.id && current?.dir === "desc" ? <Pill size="sm">Current</Pill> : null}
          onClick={() => onPick({ columnId: c.id, dir: "desc" })}
        />
      ))}
      {current && (
        <>
          <div className="menu__separator" />
          <MenuSectionLabel>Current</MenuSectionLabel>
          <MenuRow label="Clear sort" subtle onClick={() => onPick(null)} />
        </>
      )}
    </div>
  );
}


function OptionsPopover<T>({
  columns,
  hidden,
  onToggleColumn,
  onResetColumns,
  density,
  onDensity,
  anchorRef,
  onClose,
}: {
  columns: Column<T>[];
  hidden: Set<string>;
  onToggleColumn: (id: string) => void;
  onResetColumns: () => void;
  density: "compact" | "comfortable";
  onDensity: (d: "compact" | "comfortable") => void;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const margin = 8;
  const style = rect
    ? {
        top: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - 320 - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - 240 - margin)),
      }
    : { top: 48, left: 16 };

  const visibleCount = columns.length - hidden.size;
  const canHideMore = visibleCount > 1;

  return (
    <div className="popover" ref={ref} style={style}>
      <MenuSectionLabel>Density</MenuSectionLabel>
      <div className="options-popover__segmented" role="radiogroup" aria-label="Density">
        <button
          type="button"
          role="radio"
          aria-checked={density === "compact"}
          className={`options-popover__seg${density === "compact" ? " is-active" : ""}`}
          onClick={() => onDensity("compact")}
        >
          Compact
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={density === "comfortable"}
          className={`options-popover__seg${density === "comfortable" ? " is-active" : ""}`}
          onClick={() => onDensity("comfortable")}
        >
          Comfortable
        </button>
      </div>
      <div className="menu__separator" />
      <MenuSectionLabel>Columns</MenuSectionLabel>
      {columns.map((col) => {
        const isHidden = hidden.has(col.id);
        const label = typeof col.header === "string" ? col.header : col.id;
        return (
          <label key={col.id} className="options-popover__col-row">
            <input
              type="checkbox"
              checked={!isHidden}
              onChange={() => {
                // Keep at least one column visible.
                if (!isHidden && !canHideMore) return;
                onToggleColumn(col.id);
              }}
              disabled={!isHidden && !canHideMore}
            />
            <span>{label}</span>
          </label>
        );
      })}
      {hidden.size > 0 && (
        <>
          <div className="menu__separator" />
          <MenuRow label="Reset columns" subtle onClick={onResetColumns} />
        </>
      )}
    </div>
  );
}


function EditableCell<T>({
  row,
  column,
  display,
}: {
  row: T;
  column: Column<T>;
  display: ReactNode;
}) {
  const config = column.editable!;
  const initialValue = String(
    (config.getValue ? config.getValue(row) : column.accessor?.(row)) ?? "",
  );
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!editing) return;
    const update = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editing]);

  const open = () => {
    setValue(initialValue);
    setError(null);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setError(null);
  };

  const commit = async (override?: string) => {
    if (saving) return;
    const final = override ?? value;
    if (final === initialValue) {
      close();
      return;
    }
    setSaving(true);
    try {
      await config.onCommit(row, final);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const options =
    typeof config.options === "function"
      ? config.options(row)
      : config.options ?? [];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="editable-cell"
        onClick={open}
        aria-label="Edit cell"
      >
        <span className="editable-cell__display">
          {display || <span className="editable-cell__placeholder">—</span>}
        </span>
      </button>
      {editing && rect && (
        config.type === "select" ? (
          <Select<string>
            triggerless
            defaultOpen
            anchorRect={{ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width }}
            value={value}
            onChange={(v) => { setValue(v); void commit(v); }}
            onClose={close}
            options={options.map((opt) => ({ value: opt, label: opt }))}
          />
        ) : (
          createPortal(
            <EditPopover
              rect={rect}
              onDismiss={close}
              onCommit={() => commit()}
            >
              {config.type === "autocomplete" ? (
                <NameAutocomplete
                  value={value}
                  onChange={setValue}
                  options={options}
                  onRemoveOption={config.onRemoveOption}
                  onCommit={(v) => { setValue(v); void commit(v); }}
                  placeholder={config.placeholder}
                  ariaLabel="Edit cell"
                  inputProps={{
                    autoFocus: true,
                    disabled: saving,
                    onKeyDown: (e) => {
                      if (e.key === "Escape") { e.preventDefault(); close(); }
                    },
                  }}
                />
              ) : (
                <input
                  className="editable-cell__input"
                  autoFocus
                  type={config.type === "number" ? "number" : config.type === "date" ? "date" : "text"}
                  value={value}
                  placeholder={config.placeholder}
                  disabled={saving}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commit(); }
                    if (e.key === "Escape") { e.preventDefault(); close(); }
                  }}
                />
              )}
              {saving && <span className="editable-cell__spinner" aria-label="Saving" />}
              {error && <div className="editable-cell__error" role="alert">{error}</div>}
            </EditPopover>,
            document.body,
          )
        )
      )}
    </>
  );
}


function EditPopover({
  rect,
  onDismiss,
  onCommit,
  children,
}: {
  rect: DOMRect;
  onDismiss: () => void;
  onCommit: () => void;
  children: ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (e.target instanceof Node && popoverRef.current.contains(e.target)) return;
      onCommit();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCommit]);

  useEffect(() => {
    const onScroll = () => onDismiss();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [onDismiss]);

  return (
    <div
      ref={popoverRef}
      className="editable-cell__popover"
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        minWidth: rect.width,
      }}
    >
      {children}
    </div>
  );
}


function ColumnResizeHandle({
  columnId,
  onResize,
}: {
  columnId: string;
  onResize: (width: number) => void;
}) {
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  const onMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const th = (event.currentTarget as HTMLElement).parentElement;
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;
    dragging.current = { startX: event.clientX, startWidth };

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - dragging.current.startX;
      const next = Math.max(60, Math.round(dragging.current.startWidth + delta));
      onResize(next);
    };
    const onUp = () => {
      dragging.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize column ${columnId}`}
      className="table__resize-handle"
      onMouseDown={onMouseDown}
    />
  );
}


function TableScrollWrap({
  stickyFirst,
  children,
}: {
  stickyFirst: boolean;
  children: ReactNode;
}) {
  const { edges, ref } = useScrollEdgeShadows();

  const classes = ["table-scroll"];
  if (stickyFirst) classes.push("table-scroll--sticky");
  if (edges.left) classes.push("is-scrolled-left");
  if (edges.right) classes.push("is-scrolled-right");

  return (
    <div ref={ref} className={classes.join(" ")}>
      {children}
    </div>
  );
}


export {
  EMPTY_ARR,
  SortPopover,
  OptionsPopover,
  EditableCell,
  EditPopover,
  ColumnResizeHandle,
  TableScrollWrap,
};
