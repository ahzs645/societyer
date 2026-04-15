import { ReactNode, useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { MenuRow, MenuSectionLabel } from "./ui";

export type FilterField<T = any> = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Given the record and a query string, decide if the record matches. */
  match: (record: T, query: string) => boolean;
  /** Optional list of preset values. If supplied, the popover shows a select instead of free-text. */
  options?: string[];
};

export type AppliedFilter = { fieldId: string; value: string };

export function applyFilters<T>(
  records: T[],
  filters: AppliedFilter[],
  fields: FilterField<T>[],
): T[] {
  if (filters.length === 0) return records;
  return records.filter((r) =>
    filters.every((f) => {
      const field = fields.find((x) => x.id === f.fieldId);
      if (!field) return true;
      return field.match(r, f.value);
    }),
  );
}

export function FilterPopover<T>({
  fields,
  anchorRef,
  onAdd,
  onClose,
}: {
  fields: FilterField<T>[];
  anchorRef: React.RefObject<HTMLElement>;
  onAdd: (f: AppliedFilter) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<FilterField<T> | null>(null);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const POPOVER_W = 240;
  const margin = 8;
  const style = rect
    ? {
        top: Math.min(rect.bottom + 4, window.innerHeight - 260),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - POPOVER_W - margin)),
      }
    : { top: 48, left: 16 };

  const commit = () => {
    if (!picked || !value.trim()) return;
    onAdd({ fieldId: picked.id, value: value.trim() });
    onClose();
  };

  return (
    <div className="popover" ref={ref} style={style}>
      {!picked ? (
        <>
          <MenuSectionLabel>Filter by field</MenuSectionLabel>
          {fields.map((f) => (
            <MenuRow
              key={f.id}
              icon={f.icon}
              label={f.label}
              onClick={() => {
                setPicked(f);
                setValue("");
              }}
            />
          ))}
        </>
      ) : (
        <>
          <MenuSectionLabel>{picked.label}{picked.options ? "" : " contains"}</MenuSectionLabel>
          {picked.options ? (
            <>
              {picked.options.map((option) => (
                <MenuRow
                  key={option}
                  label={option}
                  onClick={() => {
                    onAdd({ fieldId: picked.id, value: option });
                    onClose();
                  }}
                />
              ))}
              <div className="popover__footer">
                <button className="btn-action" onClick={() => setPicked(null)}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                className="popover__input"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                placeholder="Type and press Enter"
              />
              <div className="popover__footer">
                <button className="btn-action" onClick={() => setPicked(null)}>
                  Back
                </button>
                <button className="btn-action btn-action--primary" onClick={commit}>
                  Apply
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function FilterChips({
  filters,
  fields,
  onRemove,
}: {
  filters: AppliedFilter[];
  fields: FilterField<any>[];
  onRemove: (index: number) => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div className="filter-chips">
      {filters.map((f, i) => {
        const field = fields.find((x) => x.id === f.fieldId);
        return (
          <span className="filter-chip" key={i}>
            <span className="filter-chip__field">{field?.label ?? f.fieldId}</span>
            <span className="filter-chip__op">contains</span>
            <strong>{f.value}</strong>
            <button className="filter-chip__remove" onClick={() => onRemove(i)} aria-label="Remove filter">
              <X size={10} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
