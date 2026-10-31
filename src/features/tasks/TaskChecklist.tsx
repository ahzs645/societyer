import { useState } from "react";
import { X } from "lucide-react";
import { newTaskChecklistId, taskChecklistProgress, type TaskChecklistItem } from "../../../shared/taskChecklist";

/**
 * Steps inside a task. Ticking, renaming, removing and adding a step call
 * `onChange` with the whole list. The task editor stages it with the form;
 * even an unfinished add/rename buffer belongs to the recoverable draft.
 */
export function TaskChecklist({
  items,
  onChange,
  readOnly,
  draft: controlledDraft,
  onDraftChange,
}: {
  items: TaskChecklistItem[];
  onChange: (items: TaskChecklistItem[]) => void;
  readOnly?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const { done, total } = taskChecklistProgress(items);
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onChange([...items, { id: newTaskChecklistId(), title, done: false }]);
    setDraft("");
  };
  return (
    <section className="task-checklist" aria-label="Checklist">
      <div className="task-checklist__head">
        <span className="task-checklist__title">Checklist</span>
        {total > 0 && (
          <>
            <span className="task-checklist__count">{done}/{total}</span>
            <span className="task-checklist__bar" aria-hidden="true"><span style={{ width: `${(done / total) * 100}%` }} /></span>
          </>
        )}
      </div>
      {items.length > 0 && (
        <ul className="task-checklist__items">
          {items.map((item) => (
            <li key={item.id} className={`task-checklist__item${item.done ? " is-done" : ""}`}>
              <input
                type="checkbox"
                className="check-anim"
                checked={item.done}
                disabled={readOnly}
                aria-label={`${item.done ? "Untick" : "Tick"} ${item.title}`}
                onChange={() => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)))}
              />
              {/* The strike-through is drawn on a text-sized copy of the title
                  laid over the field (inputs have no ::after). */}
              <span className="task-checklist__label">
                <input
                  className="task-checklist__text check-anim-label"
                  value={item.title}
                  readOnly={readOnly}
                  maxLength={300}
                  aria-label="Checklist step"
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry))}
                />
                <span className="task-checklist__strike check-anim-label" aria-hidden="true">{item.title}</span>
              </span>
              {!readOnly && (
                <button type="button" className="task-icon-button task-checklist__remove" aria-label={`Remove ${item.title}`} onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <input
          className="input task-checklist__add"
          value={draft}
          maxLength={300}
          aria-label="Add a checklist step"
          placeholder="Add a step and press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
        />
      )}
      {readOnly && items.length === 0 && <p className="muted task-checklist__empty">No steps.</p>}
    </section>
  );
}
