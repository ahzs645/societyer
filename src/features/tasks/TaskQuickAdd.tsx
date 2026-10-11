import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

/**
 * "+ Add task" that turns into a title input. Enter saves and keeps the
 * composer open for the next one; Escape (or leaving it empty) closes it.
 */
export function TaskQuickAdd({
  open,
  onOpen,
  onClose,
  onSubmit,
  variant,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (title: string) => Promise<boolean>;
  variant: "row" | "card";
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className={`task-quick-add task-quick-add--${variant}`} onClick={onOpen}>
        <Plus size={13} aria-hidden="true" /> Add task
      </button>
    );
  }

  const submit = async () => {
    const value = title.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      if (await onSubmit(value)) setTitle("");
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className={`task-quick-add-form task-quick-add-form--${variant}`}>
      <input
        ref={inputRef}
        className="input"
        value={title}
        maxLength={300}
        disabled={saving}
        aria-label="New task title"
        placeholder="Task title — Enter to add, Esc to close"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void submit(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTitle(""); onClose(); }
        }}
        onBlur={() => { if (!title.trim() && !saving) onClose(); }}
      />
      {variant === "card" && (
        <div className="task-quick-add-form__actions">
          <button type="button" className="btn btn--sm" onMouseDown={(event) => event.preventDefault()} onClick={() => { setTitle(""); onClose(); }}>Cancel</button>
          <button type="button" className="btn btn--sm btn--accent" disabled={!title.trim() || saving} onMouseDown={(event) => event.preventDefault()} onClick={() => void submit()}>Add</button>
        </div>
      )}
    </div>
  );
}
