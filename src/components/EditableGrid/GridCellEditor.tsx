import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { DatePicker } from "../DatePicker";
import type { GridColumn, GridRow } from "./types";
import { columnOptions, searchOptions } from "./values";

/** Where the selection goes after a commit; "blur" means focus already left the cell. */
export type GridMove = "down" | "up" | "right" | "left" | "none" | "blur";

type EditorProps<R extends GridRow> = {
  col: GridColumn<R>;
  row: R;
  value: unknown;
  initialText: string;
  /** "replace" started by typing; "edit" by Enter/F2/double-click. */
  mode: "replace" | "edit";
  anchor: HTMLElement | null;
  label: string;
  onCommitText: (text: string, move: GridMove) => void;
  onCommitValue: (value: unknown, move: GridMove) => void;
  /** `fromBlur` when focus already moved elsewhere (do not pull it back). */
  onCancel: (fromBlur?: boolean) => void;
};

export function GridCellEditor<R extends GridRow>(props: EditorProps<R>) {
  if (props.col.type === "select") return <SelectEditor {...props} />;
  if (props.col.type === "date" && props.mode === "edit") return <DateEditor {...props} />;
  return <TextEditor {...props} />;
}

function moveForKey(event: KeyboardEvent, mode: "replace" | "edit"): GridMove | null {
  if (event.key === "Enter") return event.shiftKey ? "up" : "down";
  if (event.key === "Tab") return event.shiftKey ? "left" : "right";
  // Typing over a cell behaves like a spreadsheet: arrows commit and move.
  if (mode === "replace") {
    if (event.key === "ArrowDown") return "down";
    if (event.key === "ArrowUp") return "up";
    if (event.key === "ArrowLeft") return "left";
    if (event.key === "ArrowRight") return "right";
  }
  return null;
}

function TextEditor<R extends GridRow>({ col, initialText, mode, label, onCommitText, onCancel }: EditorProps<R>) {
  const [draft, setDraft] = useState(initialText);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);
  const finish = (move: GridMove) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommitText(draft, move);
  };
  const numeric = col.type === "money" || col.type === "number";
  return (
    <input
      ref={inputRef}
      className={`egrid__editor${numeric ? " egrid__editor--num" : ""}`}
      value={draft}
      aria-label={label}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={col.type === "date" ? "YYYY-MM-DD" : col.placeholder}
      autoComplete="off"
      spellCheck={col.type === "text"}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish("blur")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          doneRef.current = true;
          onCancel();
          return;
        }
        const move = moveForKey(event, mode);
        if (move) {
          event.preventDefault();
          finish(move);
        }
      }}
    />
  );
}

function DateEditor<R extends GridRow>({ value, onCommitValue, onCancel }: EditorProps<R>) {
  const doneRef = useRef(false);
  return (
    <div className="egrid__date-editor">
      <DatePicker
        value={typeof value === "string" ? value : ""}
        size="sm"
        defaultOpen
        onChange={(next) => {
          doneRef.current = true;
          onCommitValue(next, "none");
        }}
        onClose={() => {
          if (!doneRef.current) onCancel();
        }}
      />
    </div>
  );
}

function SelectEditor<R extends GridRow>({ col, row, value, initialText, mode, anchor, label, onCommitValue, onCancel }: EditorProps<R>) {
  const options = useMemo(() => columnOptions(col, row), [col, row]);
  // Opening with Enter/F2 shows the full list; typing starts a search.
  const [query, setQuery] = useState(mode === "replace" ? initialText : "");
  const visible = useMemo(() => searchOptions(query, options).slice(0, 200), [query, options]);
  const [active, setActive] = useState(() => Math.max(0, mode === "edit" ? visible.findIndex((o) => o.value === value) : 0));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const listId = useId();
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const end = inputRef.current?.value.length ?? 0;
    inputRef.current?.setSelectionRange(end, end);
  }, []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const preferBelow = below >= 220 || below >= above;
      const maxHeight = Math.max(140, Math.min(320, preferBelow ? below : above));
      const width = Math.max(rect.width, 260);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const listHeight = Math.min(maxHeight, listRef.current?.scrollHeight ?? maxHeight);
      setPos({ top: preferBelow ? rect.bottom + 2 : rect.top - 2 - listHeight, left, width, maxHeight });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, visible.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (index: number, move: GridMove) => {
    if (doneRef.current) return;
    const option = visible[index];
    doneRef.current = true;
    if (option) onCommitValue(option.value, move);
    else onCancel();
  };

  const activeId = visible[active] ? `${listId}-opt-${active}` : undefined;
  return (
    <>
      <input
        ref={inputRef}
        className="egrid__editor"
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={() => {
          if (!doneRef.current) {
            doneRef.current = true;
            onCancel(true);
          }
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            doneRef.current = true;
            onCancel();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(visible.length - 1, i + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(active, event.shiftKey ? "up" : "down");
          } else if (event.key === "Tab") {
            event.preventDefault();
            const move = event.shiftKey ? "left" : "right";
            if (query.trim() || mode === "edit") pick(active, move);
            else {
              doneRef.current = true;
              onCancel();
            }
          }
        }}
      />
      {createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`${col.header} options`}
          data-floating-layer=""
          className="menu egrid__listbox"
          style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { visibility: "hidden" }}
          // Keep focus in the input so blur does not cancel the pick.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="menu__list">
            {visible.length === 0 && <div className="menu__empty">No matches</div>}
            {visible.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-opt-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                className={`menu__item${index === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index, "none")}
              >
                <span className="menu__item-main">
                  <span className="menu__item-label">
                    {option.label}
                    {option.hint && <span className="menu__item-hint"><span className="menu__item-hint-sep"> · </span>{option.hint}</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
