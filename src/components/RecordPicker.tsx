import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, EmptyState } from "./ui";

export type RecordPickerItem = {
  id: string;
  label: string;
  description?: string;
  objectLabel?: string;
  icon?: React.ReactNode;
  searchText?: string;
};

export function RecordPicker({
  items,
  value,
  values,
  multiple = false,
  placeholder = "Search records...",
  emptyLabel = "No records found.",
  onChange,
  onChangeMany,
}: {
  items: RecordPickerItem[];
  value?: string | null;
  values?: string[];
  multiple?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  onChange?: (id: string | null, item?: RecordPickerItem) => void;
  onChangeMany?: (ids: string[], items: RecordPickerItem[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedIds = useMemo(
    () => new Set(multiple ? (values ?? []) : value ? [value] : []),
    [multiple, value, values],
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 25);
    return items
      .map((item) => ({
        item,
        score: scoreRecordPickerItem(item, q),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((entry) => entry.item);
  }, [items, query]);

  const toggle = (item: RecordPickerItem) => {
    if (!multiple) {
      onChange?.(item.id, item);
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    const ids = Array.from(next);
    onChangeMany?.(ids, items.filter((candidate) => next.has(candidate.id)));
  };

  const remove = (id: string) => {
    if (!multiple) {
      onChange?.(null);
      return;
    }
    const next = (values ?? []).filter((candidate) => candidate !== id);
    onChangeMany?.(next, items.filter((item) => next.includes(item.id)));
  };

  return (
    <div className="record-picker">
      {selectedItems.length > 0 && (
        <div className="record-picker__selected">
          {selectedItems.map((item) => (
            <span key={item.id} className="record-picker__pill">
              {item.label}
              <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.label}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="record-picker__search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      </label>
      <div className="record-picker__list" role="listbox" aria-multiselectable={multiple || undefined}>
        {filtered.length === 0 ? (
          <EmptyState title={emptyLabel} />
        ) : (
          filtered.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`record-picker__option${selected ? " is-selected" : ""}`}
                onClick={() => toggle(item)}
              >
                {item.icon && <span className="record-picker__icon">{item.icon}</span>}
                <span className="record-picker__main">
                  <span className="record-picker__label">{item.label}</span>
                  {(item.description || item.objectLabel) && (
                    <span className="record-picker__description">
                      {[item.objectLabel, item.description].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
      {multiple && selectedItems.length > 0 && (
        <Button size="sm" onClick={() => onChangeMany?.([], [])}>
          Clear selection
        </Button>
      )}
    </div>
  );
}

function scoreRecordPickerItem(item: RecordPickerItem, query: string) {
  const haystack = `${item.label} ${item.description ?? ""} ${item.objectLabel ?? ""} ${item.searchText ?? ""}`.toLowerCase();
  if (haystack.includes(query)) return query.length / Math.max(haystack.length, 1) + 0.8;
  return query
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 0.25 : 0), 0);
}
