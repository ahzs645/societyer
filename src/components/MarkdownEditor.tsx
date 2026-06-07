import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { callCommand, replaceAll } from "@milkdown/kit/utils";
import { lift } from "@milkdown/kit/prose/commands";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { MarkType, ResolvedPos } from "@milkdown/kit/prose/model";
import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from "lucide-react";
import { usePrompt } from "./Modal";
import { Tooltip } from "./Tooltip";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./MarkdownEditor.scss";

/** Modal URL prompt — the app's `usePrompt`, narrowed to what the link
 * toolbar button needs. */
type LinkPrompt = (opts: {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  required?: boolean;
}) => Promise<string | null>;

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Approximate height in textarea rows (matches the rows= prop on <textarea>). Defaults to 4. */
  rows?: number;
  /** Optional CSS-level min-height override (rarely needed; rows= is the normal knob). */
  minHeight?: string;
  readOnly?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  className?: string;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  /** Replace the editor's content imperatively. */
  setMarkdown: (markdown: string) => void;
}

/**
 * Predicate against the computed active set. Returning true marks the button
 * as currently applied to the cursor / selection.
 *
 * `marks` contains schema mark names ("strong", "emphasis", "strike_through",
 * "inlineCode"). `blocks` contains node names from the cursor's ancestors
 * ("bullet_list", "ordered_list", "blockquote") plus `heading:<level>` entries
 * for headings.
 */
interface ActiveState {
  marks: ReadonlySet<string>;
  blocks: ReadonlySet<string>;
}
type ActiveCheck = (state: ActiveState) => boolean;

interface ToolbarItem {
  id: string;
  label: string;
  /** Optional second line shown in the tooltip — used to hint click-to-exit on toggles. */
  hint?: string;
  shortcut?: string;
  icon: typeof Bold;
  isActive: ActiveCheck;
  /** Invoked on click. `isActive` reflects state at click time so the button
   *  can choose between, e.g., "wrap in blockquote" and "lift out of it".
   *  `prompt` opens the app's modal text prompt (used by the link button). */
  // Returns `unknown` so the simple items can keep returning the command's
  // boolean directly, while the link item can return a Promise (awaited in
  // runItem). The result is never consumed beyond `await`.
  run: (args: {
    editor: Crepe["editor"];
    isActive: boolean;
    prompt: LinkPrompt;
  }) => unknown;
}

// Names below match the Milkdown schema for @milkdown/preset-commonmark and
// @milkdown/preset-gfm. We look up commands by their string registration name
// (`$command("ToggleStrong", …)`) because Crepe bundles its own copies of
// those plugins — the Slice Symbols differ between our import and the copy
// Crepe registers, but the names are stable.

/**
 * Finds the contiguous range of `markType` (a link) around a collapsed cursor.
 * Checks the node on both sides of the caret so it works whether the cursor is
 * inside the link or sitting right at its trailing edge. Returns null if there
 * is no such mark adjacent to the position.
 */
function getMarkRange(
  $pos: ResolvedPos,
  markType: MarkType,
): { from: number; to: number } | null {
  const parent = $pos.parent;
  const offset = $pos.parentOffset;
  const after = parent.childAfter(offset);
  let index: number;
  let startPos: number;
  if (after.node && markType.isInSet(after.node.marks)) {
    index = after.index;
    startPos = $pos.start() + after.offset;
  } else {
    const before = parent.childBefore(offset);
    if (!before.node || !markType.isInSet(before.node.marks)) return null;
    index = before.index;
    startPos = $pos.start() + before.offset;
  }
  // Match the exact mark (type + href) so two adjacent but different links
  // aren't merged into one range.
  const mark = markType.isInSet(parent.child(index).marks);
  if (!mark) return null;

  let from = startPos;
  let startIndex = index;
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    from -= parent.child(startIndex).nodeSize;
  }
  let to = startPos + parent.child(index).nodeSize;
  let endIndex = index;
  while (endIndex + 1 < parent.childCount && mark.isInSet(parent.child(endIndex + 1).marks)) {
    endIndex += 1;
    to += parent.child(endIndex).nodeSize;
  }
  return { from, to };
}

const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: "bold",
    label: "Bold",
    shortcut: "Ctrl+B",
    icon: Bold,
    isActive: ({ marks }) => marks.has("strong"),
    run: ({ editor }) => editor.action(callCommand("ToggleStrong")),
  },
  {
    id: "italic",
    label: "Italic",
    shortcut: "Ctrl+I",
    icon: Italic,
    isActive: ({ marks }) => marks.has("emphasis"),
    run: ({ editor }) => editor.action(callCommand("ToggleEmphasis")),
  },
  {
    id: "strike",
    label: "Strikethrough",
    icon: Strikethrough,
    isActive: ({ marks }) => marks.has("strike_through"),
    run: ({ editor }) => editor.action(callCommand("ToggleStrikeThrough")),
  },
  {
    id: "code",
    label: "Inline code",
    icon: Code,
    isActive: ({ marks }) => marks.has("inlineCode"),
    run: ({ editor }) => editor.action(callCommand("ToggleInlineCode")),
  },
  {
    id: "code-block",
    label: "Code block",
    hint: "Click again to turn back into paragraph",
    icon: Braces,
    isActive: ({ blocks }) => blocks.has("code_block"),
    run: ({ editor, isActive }) =>
      editor.action(callCommand(isActive ? "TurnIntoText" : "CreateCodeBlock", "")),
  },
  {
    id: "link",
    label: "Link",
    hint: "Click again on a link to remove it",
    icon: Link2,
    isActive: ({ marks }) => marks.has("link"),
    run: async ({ editor, isActive, prompt }) => {
      // Clicking while the cursor is in a link removes the whole link: expand a
      // collapsed cursor to the full link range first, then strip the mark and
      // leave that text selected.
      if (isActive) {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!view) return;
          const { state } = view;
          const linkType = state.schema.marks.link;
          if (!linkType) return;
          const { selection } = state;
          let from = selection.from;
          let to = selection.to;
          if (selection.empty) {
            const range = getMarkRange(selection.$from, linkType);
            if (!range) return;
            from = range.from;
            to = range.to;
          }
          const tr = state.tr.removeMark(from, to, linkType);
          tr.setSelection(TextSelection.create(tr.doc, from, to));
          view.dispatch(tr);
          view.focus();
        });
        return;
      }
      const input = await prompt({
        title: "Add link",
        placeholder: "https://example.com",
        confirmLabel: "Add link",
        required: true,
      });
      const raw = input?.trim();
      if (!raw) return;
      // Bare domains get https://; leave schemes (mailto:, https:), absolute
      // paths, and anchors as-is.
      const href = /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const { state } = view;
        const linkType = state.schema.marks.link;
        if (!linkType) return;
        const { from, to, empty } = state.selection;
        if (empty) {
          // No selection — drop the URL in as its own linked text.
          const tr = state.tr.insertText(raw, from);
          tr.addMark(from, from + raw.length, linkType.create({ href }));
          view.dispatch(tr);
        } else {
          view.dispatch(state.tr.addMark(from, to, linkType.create({ href })));
        }
        view.focus();
      });
    },
  },
  {
    id: "h1",
    label: "Heading 1",
    hint: "Click again to turn back into paragraph",
    icon: Heading1,
    isActive: ({ blocks }) => blocks.has("heading:1"),
    // payload=0 in `WrapInHeading` falls through to setBlockType(paragraph),
    // giving us "click on an active heading to turn it back into a paragraph".
    run: ({ editor, isActive }) =>
      editor.action(callCommand("WrapInHeading", isActive ? 0 : 1)),
  },
  {
    id: "h2",
    label: "Heading 2",
    hint: "Click again to turn back into paragraph",
    icon: Heading2,
    isActive: ({ blocks }) => blocks.has("heading:2"),
    run: ({ editor, isActive }) =>
      editor.action(callCommand("WrapInHeading", isActive ? 0 : 2)),
  },
  {
    id: "h3",
    label: "Heading 3",
    hint: "Click again to turn back into paragraph",
    icon: Heading3,
    isActive: ({ blocks }) => blocks.has("heading:3"),
    run: ({ editor, isActive }) =>
      editor.action(callCommand("WrapInHeading", isActive ? 0 : 3)),
  },
  {
    id: "bullet",
    label: "Bullet list",
    hint: "Click again to exit the list",
    icon: List,
    isActive: ({ blocks }) => blocks.has("bullet_list"),
    run: ({ editor, isActive }) => {
      if (isActive) {
        // LiftListItem pops one level out; calling it twice would leave the
        // list entirely. Once is the right behaviour for the common case of
        // a single-level list — repeat clicks keep peeling.
        editor.action(callCommand("LiftListItem"));
      } else {
        editor.action(callCommand("WrapInBulletList"));
      }
    },
  },
  {
    id: "ordered",
    label: "Numbered list",
    hint: "Click again to exit the list",
    icon: ListOrdered,
    isActive: ({ blocks }) => blocks.has("ordered_list"),
    run: ({ editor, isActive }) => {
      if (isActive) {
        editor.action(callCommand("LiftListItem"));
      } else {
        editor.action(callCommand("WrapInOrderedList"));
      }
    },
  },
  {
    id: "task",
    // GFM task lists are a `list_item` with a `checked` attr (null = regular,
    // false/true = unchecked/checked task). There's no first-class command,
    // so we toggle the attribute directly — wrapping into a bullet list first
    // if the cursor isn't already inside one.
    label: "Task list",
    hint: "Click again to convert back to a regular list",
    icon: ListChecks,
    isActive: ({ blocks }) => blocks.has("task_list"),
    run: ({ editor, isActive }) => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const setListItemChecked = (checked: boolean | null) => {
          const { state } = view;
          const $from = state.selection.$from;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth);
            if (node.type.name === "list_item") {
              const pos = $from.before(depth);
              view.dispatch(
                state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked }),
              );
              return true;
            }
          }
          return false;
        };
        if (isActive) {
          setListItemChecked(null);
          return;
        }
        if (!setListItemChecked(false)) {
          editor.action(callCommand("WrapInBulletList"));
          setListItemChecked(false);
        }
      });
    },
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Click again to exit the quote",
    icon: Quote,
    isActive: ({ blocks }) => blocks.has("blockquote"),
    run: ({ editor, isActive }) => {
      if (isActive) {
        // `WrapInBlockquote` only ever wraps — it has no "unwrap" mode and
        // would otherwise nest the quote infinitely. ProseMirror's generic
        // `lift` command moves the current block one level out of its
        // wrapper, which is the right behaviour for getting back to a plain
        // paragraph (or one level shallower when quotes are nested).
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!view) return;
          lift(view.state, view.dispatch);
        });
      } else {
        editor.action(callCommand("WrapInBlockquote"));
      }
    },
  },
  {
    id: "hr",
    label: "Horizontal rule",
    icon: Minus,
    // HR is a transient insertion, not a containing block — there's no
    // meaningful "active" state to highlight.
    isActive: () => false,
    run: ({ editor }) => editor.action(callCommand("InsertHr")),
  },
];

const EMPTY_ACTIVE: ActiveState = {
  marks: new Set<string>(),
  blocks: new Set<string>(),
};

// Grid starts compact and grows as the user hovers toward the bottom-right
// corner — Google Docs style — so there's no hard cap visible up front but the
// initial footprint stays small. Hard cap protects against runaway growth from
// a stray hover on the edge.
const TABLE_PICKER_INITIAL_ROWS = 5;
const TABLE_PICKER_INITIAL_COLS = 5;
const TABLE_PICKER_MAX_ROWS = 20;
const TABLE_PICKER_MAX_COLS = 20;

function TableButton({
  onInsert,
  disabled,
}: {
  onInsert: (rows: number, cols: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [size, setSize] = useState<{ rows: number; cols: number }>({
    rows: TABLE_PICKER_INITIAL_ROWS,
    cols: TABLE_PICKER_INITIAL_COLS,
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setHover(null);
    setSize({ rows: TABLE_PICKER_INITIAL_ROWS, cols: TABLE_PICKER_INITIAL_COLS });
  }, [open]);

  const handleHover = (row: number, col: number) => {
    setHover({ row, col });
    setSize((current) => {
      let { rows, cols } = current;
      // Reach the last visible row/col -> grow by one (up to the cap) so the
      // user can keep dragging outward without hitting a wall.
      if (row >= rows - 1 && rows < TABLE_PICKER_MAX_ROWS) rows = Math.min(rows + 1, TABLE_PICKER_MAX_ROWS);
      if (col >= cols - 1 && cols < TABLE_PICKER_MAX_COLS) cols = Math.min(cols + 1, TABLE_PICKER_MAX_COLS);
      if (rows === current.rows && cols === current.cols) return current;
      return { rows, cols };
    });
  };

  return (
    <div className="markdown-editor__table-anchor">
      <Tooltip content="Insert table">
        <button
          ref={buttonRef}
          type="button"
          className={`markdown-editor__toolbar-button${open ? " is-active" : ""}`}
          aria-label="Insert table"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            setOpen((value) => !value);
          }}
        >
          <TableIcon size={14} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={popoverRef}
          className="markdown-editor__table-picker"
          role="dialog"
          aria-label="Choose table size"
          onMouseDown={(event) => event.preventDefault()}
          onMouseLeave={() => setHover(null)}
        >
          <div
            className="markdown-editor__table-picker-grid"
            style={{ gridTemplateColumns: `repeat(${size.cols}, 18px)` }}
          >
            {Array.from({ length: size.rows }, (_, r) =>
              Array.from({ length: size.cols }, (_, c) => {
                const active = !!hover && r <= hover.row && c <= hover.col;
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    className={`markdown-editor__table-picker-cell${active ? " is-active" : ""}`}
                    aria-label={`${r + 1} rows by ${c + 1} columns`}
                    onMouseEnter={() => handleHover(r, c)}
                    onFocus={() => handleHover(r, c)}
                    onClick={() => {
                      onInsert(r + 1, c + 1);
                      setOpen(false);
                    }}
                  />
                );
              }),
            )}
          </div>
          <div className="markdown-editor__table-picker-label">
            {hover ? `${hover.row + 1} × ${hover.col + 1}` : "Pick a size"}
          </div>
        </div>
      )}
    </div>
  );
}

const TRACKED_MARK_NAMES = ["strong", "emphasis", "strike_through", "inlineCode", "link"];
const TRACKED_BLOCK_NAMES = ["bullet_list", "ordered_list", "blockquote", "code_block"];

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      onChange,
      placeholder,
      rows = 4,
      minHeight,
      readOnly = false,
      id,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      "aria-label": ariaLabel,
      className,
    },
    ref,
  ) {
    const editorHostRef = useRef<HTMLDivElement | null>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);
    const lastEmittedRef = useRef(value);
    const initialValueRef = useRef(value);
    const placeholderRef = useRef(placeholder);

    const [active, setActive] = useState<ActiveState>(EMPTY_ACTIVE);
    const prompt = usePrompt();

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      placeholderRef.current = placeholder;
    }, [placeholder]);

    const recomputeActive = useCallback(() => {
      const crepe = crepeRef.current;
      if (!crepe) return;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const { state } = view;
        const { from, to, empty, $from } = state.selection;
        const marks = new Set<string>();
        const blocks = new Set<string>();

        for (const name of TRACKED_MARK_NAMES) {
          const markType = state.schema.marks[name];
          if (!markType) continue;
          let isActive = false;
          if (empty) {
            // With a collapsed cursor, "active" is driven by the
            // soon-to-be-applied marks: storedMarks (set by Ctrl+B etc.) take
            // priority, falling back to the marks on the character to the
            // left of the cursor.
            const storedOrInline = state.storedMarks ?? $from.marks();
            isActive = !!markType.isInSet(storedOrInline);
          } else {
            isActive = state.doc.rangeHasMark(from, to, markType);
          }
          if (isActive) marks.add(name);
        }

        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (!node) continue;
          const typeName = node.type.name;
          if (TRACKED_BLOCK_NAMES.includes(typeName)) {
            blocks.add(typeName);
          } else if (typeName === "heading") {
            blocks.add(`heading:${node.attrs.level}`);
          } else if (typeName === "list_item" && node.attrs.checked != null) {
            // GFM tasks are list_items with a non-null `checked` attr.
            blocks.add("task_list");
          }
        }

        setActive((prev) => {
          if (
            prev.marks.size === marks.size &&
            prev.blocks.size === blocks.size &&
            [...marks].every((m) => prev.marks.has(m)) &&
            [...blocks].every((b) => prev.blocks.has(b))
          ) {
            return prev;
          }
          return { marks, blocks };
        });
      });
    }, []);

    useEffect(() => {
      if (!editorHostRef.current) return;
      let disposed = false;
      const crepe = new Crepe({
        root: editorHostRef.current,
        defaultValue: initialValueRef.current ?? "",
        features: {
          [CrepeFeature.AI]: false,
          [CrepeFeature.TopBar]: false,
          [CrepeFeature.Latex]: false,
          [CrepeFeature.CodeMirror]: false,
          [CrepeFeature.ImageBlock]: false,
          // Tables are inserted via the toolbar's grid picker; once present,
          // Crepe's in-cell handles handle add/remove rows + cols.
          [CrepeFeature.Table]: true,
          // The slash (/) menu + block drag-handle. Disabled because the menu
          // gets clipped by the scrollable editor body when it flips upward,
          // and the toolbar already exposes the formatting we need here.
          [CrepeFeature.BlockEdit]: false,
          // The on-selection floating toolbar. Its only unique action was
          // links, which the top toolbar's Link button now provides.
          [CrepeFeature.Toolbar]: false,
        },
        featureConfigs: {
          [CrepeFeature.Placeholder]: {
            text: placeholderRef.current ?? "",
            // "doc" shows the placeholder only when the whole document is
            // empty. "block" paints it on every empty paragraph, so it
            // reappeared on each new line as the user pressed Enter.
            mode: "doc",
          },
        },
      });

      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          lastEmittedRef.current = markdown;
          onChangeRef.current(markdown);
        });
      });

      crepe.create().then(() => {
        if (disposed) {
          crepe.destroy();
          return;
        }
        crepeRef.current = crepe;
        crepe.setReadonly(readOnly);

        // Wrap the editor view's dispatch so we recompute toolbar state on
        // *every* transaction — including ones that only change `storedMarks`
        // (e.g. Ctrl+B with an empty selection). The built-in listener API
        // exposes `selectionUpdated` and `updated`, but neither fires for a
        // pure storedMarks change, which is what made the Bold button appear
        // stale until the user typed a character.
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!view) return;
          const originalDispatch = view.dispatch.bind(view);
          view.dispatch = (tr) => {
            originalDispatch(tr);
            recomputeActive();
          };

          // Links delete as a unit at their boundary: backspacing right after a
          // link (or forward-deleting right before one) removes the whole link
          // in one keystroke. Editing *inside* the link text deletes character
          // by character as normal — the whole-link delete only fires when the
          // cursor sits at the link's edge.
          view.dom.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Backspace" && event.key !== "Delete") return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const { state } = view;
            if (!state.selection.empty) return; // ranged deletes behave normally
            const linkType = state.schema.marks.link;
            if (!linkType) return;
            const $pos = state.selection.$from;
            const backspace = event.key === "Backspace";
            // `inner` is the node toward the deletion direction (where the link
            // would be); `outer` is the node on the far side of the cursor.
            const inner = backspace ? $pos.nodeBefore : $pos.nodeAfter;
            const outer = backspace ? $pos.nodeAfter : $pos.nodeBefore;
            const mark = inner && linkType.isInSet(inner.marks);
            if (!mark) return;
            // Cursor is *inside* the link if the same link also continues on the
            // far side — let those keystrokes edit normally.
            if (outer && mark.isInSet(outer.marks)) return;
            const range = getMarkRange($pos, linkType);
            if (!range) return;
            event.preventDefault();
            view.dispatch(state.tr.delete(range.from, range.to));
          });
        });

        recomputeActive();
      });

      return () => {
        disposed = true;
        crepeRef.current = null;
        crepe.destroy();
      };
      // Editor is created once on mount; updates flow through other effects.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const crepe = crepeRef.current;
      if (!crepe) return;
      const next = value ?? "";
      if (next === lastEmittedRef.current) return;
      crepe.editor.action(replaceAll(next));
      lastEmittedRef.current = next;
    }, [value]);

    useEffect(() => {
      crepeRef.current?.setReadonly(readOnly);
    }, [readOnly]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const editable = editorHostRef.current?.querySelector<HTMLElement>(".ProseMirror");
          editable?.focus();
        },
        setMarkdown: (markdown: string) => {
          const crepe = crepeRef.current;
          if (!crepe) return;
          crepe.editor.action(replaceAll(markdown));
          lastEmittedRef.current = markdown;
        },
      }),
      [],
    );

    const runItem = useCallback(
      (item: ToolbarItem, isActive: boolean) => {
        const crepe = crepeRef.current;
        if (!crepe) return;
        // Keep focus inside the editor so the command operates on the current
        // selection rather than the (now-blurred) toolbar button.
        const editable = editorHostRef.current?.querySelector<HTMLElement>(".ProseMirror");
        editable?.focus();
        // run() may be async (the link button awaits a modal prompt); recompute
        // once it resolves. The wrapped view.dispatch also recomputes on any
        // transaction, so synchronous commands feel instant either way.
        void Promise.resolve(item.run({ editor: crepe.editor, isActive, prompt })).then(
          () => recomputeActive(),
        );
      },
      [recomputeActive, prompt],
    );

    const insertTable = useCallback((rows: number, cols: number) => {
      const crepe = crepeRef.current;
      if (!crepe) return;
      const editable = editorHostRef.current?.querySelector<HTMLElement>(".ProseMirror");
      editable?.focus();
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const { schema } = view.state;
        const tableType = schema.nodes.table;
        const rowType = schema.nodes.table_row;
        const cellType = schema.nodes.table_cell;
        const headerType = schema.nodes.table_header ?? cellType;
        const paragraph = schema.nodes.paragraph;
        if (!tableType || !rowType || !cellType || !paragraph) return;
        const safeRows = Math.max(1, rows);
        const safeCols = Math.max(1, cols);
        const headerCells = Array.from({ length: safeCols }, () =>
          headerType.create(null, paragraph.create()),
        );
        const headerRow = rowType.create(null, headerCells);
        const bodyRows = Array.from({ length: safeRows - 1 }, () => {
          const cells = Array.from({ length: safeCols }, () =>
            cellType.create(null, paragraph.create()),
          );
          return rowType.create(null, cells);
        });
        const tableNode = tableType.create(null, [headerRow, ...bodyRows]);
        view.dispatch(view.state.tr.replaceSelectionWith(tableNode));
        view.focus();
      });
      recomputeActive();
    }, [recomputeActive]);

    const computedMinHeight = minHeight ?? `calc(${rows} * 1.55em + 28px)`;

    return (
      <div
        id={id}
        className={`markdown-editor${readOnly ? " markdown-editor--readonly" : ""}${className ? ` ${className}` : ""}`}
        role="group"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
      >
        <div className="markdown-editor__toolbar" role="toolbar" aria-label="Formatting">
          {TOOLBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.isActive(active);
            const headline = item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
            const tooltip = (
              <>
                <div>{headline}</div>
                {item.hint && <div className="markdown-editor__tooltip-hint">{item.hint}</div>}
              </>
            );
            return (
              <Tooltip key={item.id} content={tooltip}>
                <button
                  type="button"
                  className={`markdown-editor__toolbar-button${isActive ? " is-active" : ""}`}
                  aria-label={item.label}
                  aria-pressed={isActive}
                  disabled={readOnly}
                  // Use onMouseDown so the editor selection isn't lost before
                  // the command fires (default button focus would blur the doc).
                  onMouseDown={(event) => {
                    event.preventDefault();
                    runItem(item, isActive);
                  }}
                >
                  <Icon size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
          <TableButton onInsert={insertTable} disabled={readOnly} />
        </div>
        <div
          ref={editorHostRef}
          className="markdown-editor__body"
          style={{ minHeight: computedMinHeight }}
          onMouseDown={(event) => {
            if (readOnly) return;
            const target = event.target as Element | null;
            if (!target || target.closest(".ProseMirror")) return;
            event.preventDefault();
            const crepe = crepeRef.current;
            if (!crepe) return;
            crepe.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              if (!view) return;
              const endPos = view.state.doc.content.size;
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.near(view.state.doc.resolve(endPos), -1),
                ),
              );
              view.focus();
            });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </div>
    );
  },
);
