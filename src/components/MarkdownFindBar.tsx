/**
 * Find and replace for the rich text editor (prosemirror-search). The plugin
 * highlights matches; this bar sets the query and moves between them.
 * Ctrl/Cmd+F opens it from the text, Enter / Shift+Enter step through, Esc closes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { findNext, findPrev, replaceAll, replaceNext, SearchQuery, setSearchState } from "prosemirror-search";

export { search as searchPlugin } from "prosemirror-search";

/** Matches counted for the "3 of 12" label; past this the label says "999+". */
const COUNT_LIMIT = 999;

function countMatches(state: EditorState, query: SearchQuery) {
  if (!query.valid) return { total: 0, current: 0 };
  const { from } = state.selection;
  let total = 0;
  let current = 0;
  let pos = 0;
  for (;;) {
    const match = query.findNext(state, pos);
    if (!match || total >= COUNT_LIMIT) break;
    total += 1;
    if (match.from === from && match.to === state.selection.to) current = total;
    // Empty matches can't happen for a non-empty plain query, but never loop.
    pos = Math.max(match.to, match.from + 1);
  }
  return { total, current };
}

export function MarkdownFindBar({ view, initial, readOnly, version, onClose }: {
  view: EditorView;
  /** Pre-filled from a short selection. */
  initial: string;
  readOnly: boolean;
  /** Bumped by the editor on every transaction, so the count follows edits. */
  version: number;
  onClose: () => void;
}) {
  const [find, setFind] = useState(initial);
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = useMemo(() => new SearchQuery({ search: find, replace, caseSensitive, literal: true }), [find, replace, caseSensitive]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Hand the query to the plugin (it paints the highlights).
  useEffect(() => {
    view.dispatch(setSearchState(view.state.tr, query));
  }, [view, query]);
  // Clear the highlights when the bar closes.
  useEffect(() => () => {
    if (!view.isDestroyed) view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: "" })));
  }, [view]);

  // `version` changes with every edit, so the count stays right.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { total, current } = useMemo(() => countMatches(view.state, query), [view, query, version]);
  const step = (back: boolean) => (back ? findPrev : findNext)(view.state, view.dispatch);
  const close = () => {
    onClose();
    view.focus();
  };
  const label = !find ? "" : total === 0 ? "No results" : `${current || "–"} of ${total >= COUNT_LIMIT ? `${COUNT_LIMIT}+` : total}`;

  return (
    <div
      className="markdown-find"
      role="search"
      aria-label="Find in text"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="markdown-find__row">
        <input
          ref={input}
          className="input markdown-find__input"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey);
            }
          }}
          placeholder="Find"
          aria-label="Find"
        />
        <span className="markdown-find__count" aria-live="polite">{label}</span>
        <button type="button" className="markdown-editor__toolbar-button" aria-label="Previous match" disabled={!total} onClick={() => step(true)}>
          <ChevronUp size={14} aria-hidden="true" />
        </button>
        <button type="button" className="markdown-editor__toolbar-button" aria-label="Next match" disabled={!total} onClick={() => step(false)}>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`markdown-editor__toolbar-button markdown-find__case${caseSensitive ? " is-active" : ""}`}
          aria-label="Match case"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((value) => !value)}
        >
          Aa
        </button>
        <button type="button" className="markdown-editor__toolbar-button" aria-label="Close find" onClick={close}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {!readOnly && (
        <div className="markdown-find__row">
          <input
            className="input markdown-find__input"
            value={replace}
            onChange={(event) => setReplace(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                replaceNext(view.state, view.dispatch);
              }
            }}
            placeholder="Replace with"
            aria-label="Replace with"
          />
          <button type="button" className="btn-action" disabled={!total} onClick={() => replaceNext(view.state, view.dispatch)}>Replace</button>
          <button type="button" className="btn-action" disabled={!total} onClick={() => replaceAll(view.state, view.dispatch)}>Replace all</button>
        </div>
      )}
    </div>
  );
}
