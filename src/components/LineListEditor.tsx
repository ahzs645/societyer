import { useState } from "react";
import { Plus } from "lucide-react";
import { ListEditor } from "./ListEditor";

/**
 * Edits a list of short text lines — one editable item per row with a remove
 * button (on the right), plus an input to append new items. A structured
 * replacement for a newline-delimited `<textarea>`: callers hold a `string[]`
 * instead of parsing/joining a blob. Built on the shared {@link ListEditor}
 * shell, same as the meeting AttendanceRoster.
 */
export function LineListEditor({
  items,
  onChange,
  placeholder,
  addLabel = "Add",
  "aria-label": ariaLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setDraft("");
  };

  return (
    <ListEditor
      items={items}
      aria-label={ariaLabel}
      removeSide="right"
      onRemove={(index) => onChange(items.filter((_, i) => i !== index))}
      renderItem={(item, index) => (
        <input
          className="input list-editor__grow"
          value={item}
          onChange={(event) =>
            onChange(items.map((it, i) => (i === index ? event.target.value : it)))
          }
        />
      )}
      footer={
        <>
          <input
            className="input list-editor__grow"
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
          />
          <button
            type="button"
            className="btn-action"
            onClick={commit}
            disabled={!draft.trim()}
          >
            <Plus size={12} /> {addLabel}
          </button>
        </>
      }
    />
  );
}
