import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { $prose, callCommand, replaceAll } from "@milkdown/kit/utils";
import { lift } from "@milkdown/kit/prose/commands";
import { TextSelection } from "@milkdown/kit/prose/state";
import { redoDepth, undoDepth } from "@milkdown/kit/prose/history";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Maximize2,
  Minimize2,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  FileCode2,
  Quote,
  Redo2,
  Search,
  Strikethrough,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import { getMarkRange, LinkPopover, linkTargetAt, normalizeHref, type LinkTarget } from "./MarkdownLinkPopover";
import { MarkdownFindBar, searchPlugin } from "./MarkdownFindBar";
import { linkifyPlugin } from "./markdownLinkify";
import { insertMention, matchPeople, MentionMenu, MentionPeopleContext, mentionQueryAt, type MentionQuery } from "./MarkdownMentions";
import { Tooltip } from "./Tooltip";
import { useToast } from "./Toast";
import { useIsMobile } from "../lib/useIsMobile";
import { useKeyboardInsetTracking } from "../lib/useVisualViewportBottomInset";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./MarkdownEditor.scss";


import type { MarkdownEditorHandle, MarkdownEditorProps } from "./MarkdownEditor";

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
  /** Whether Undo / Redo have anything to do. */
  canUndo: boolean;
  canRedo: boolean;
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
  /** Greys the button out (Undo with nothing to undo). */
  isDisabled?: ActiveCheck;
  /** Invoked on click. `isActive` reflects state at click time so the button
   *  can choose between, e.g., "wrap in blockquote" and "lift out of it".
   *  `openLink` opens the link popover (used by the link button). */
  // Returns `unknown` so the simple items can keep returning the command's
  // boolean directly. The result is never consumed.
  run: (args: {
    editor: Crepe["editor"];
    isActive: boolean;
    openLink: () => void;
  }) => unknown;
}

// Names below match the Milkdown schema for @milkdown/preset-commonmark and
// @milkdown/preset-gfm. We look up commands by their string registration name
// (`$command("ToggleStrong", …)`) because Crepe bundles its own copies of
// those plugins — the Slice Symbols differ between our import and the copy
// Crepe registers, but the names are stable.


/** The buttons a phone shows before "More formatting". */
const PHONE_TOOLBAR_IDS = new Set(["undo", "redo", "bold", "italic", "link", "bullet"]);

const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: "undo",
    label: "Undo",
    shortcut: "Ctrl+Z",
    icon: Undo2,
    isActive: () => false,
    isDisabled: ({ canUndo }) => !canUndo,
    run: ({ editor }) => editor.action(callCommand("Undo")),
  },
  {
    id: "redo",
    label: "Redo",
    shortcut: "Ctrl+Shift+Z",
    icon: Redo2,
    isActive: () => false,
    isDisabled: ({ canRedo }) => !canRedo,
    run: ({ editor }) => editor.action(callCommand("Redo")),
  },
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
    hint: "Select text to link it, or click in a link to change or remove it",
    shortcut: "Ctrl+K",
    icon: Link2,
    isActive: ({ marks }) => marks.has("link"),
    run: ({ openLink }) => openLink(),
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

/** Words in Markdown: link targets, images and syntax characters don't count. */
function countWords(markdown: string) {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>]+>/g, " ");
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)?.length ?? 0;
}

const EMPTY_ACTIVE: ActiveState = {
  marks: new Set<string>(),
  blocks: new Set<string>(),
  canUndo: false,
  canRedo: false,
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
                    // Use mouseup instead of click so drag-to-size works:
                    // pressing on one cell and releasing on another (different
                    // mousedown/mouseup targets) does not fire `click`, which
                    // would leave the picker open with no insertion. mouseup
                    // fires on whichever cell the cursor is over at release.
                    onMouseUp={() => {
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

/** Generous: cold dev-server chunk loads on a busy machine can take seconds. */
const EDITOR_MOUNT_TIMEOUT_MS = 20_000;

/** Per-browser escape hatch (and test hook): `localStorage["societyer:plain-markdown-editor"] = "1"`
 * always uses the plain Markdown textarea. */
function plainEditorRequested() {
  try {
    return window.localStorage.getItem("societyer:plain-markdown-editor") === "1";
  } catch {
    return false;
  }
}

/**
 * Replace the document with text the person typed into the stand-in field while the editor loaded.
 * Markdown parsing drops a paragraph's trailing spaces, which would glue the next typed word onto
 * the last one ("Early words" + "then" → "Early wordsthen"), so put them back at the end.
 */
function replaceWithTypedText(editor: Crepe["editor"], markdown: string) {
  editor.action(replaceAll(markdown));
  restoreTrailingSpace(editor, markdown);
  // Typing continues from the end, wherever replaceAll left the caret.
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view || !view.hasFocus()) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  });
}

function restoreTrailingSpace(editor: Crepe["editor"], markdown: string) {
  const trailing = /[ \t]+$/.exec(markdown)?.[0];
  if (!trailing) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return;
    const end = TextSelection.atEnd(view.state.doc);
    const tr = view.state.tr.insertText(trailing, end.from);
    view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)));
  });
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
      toolbarEnd,
      mentionPeople,
      onReady,
    },
    ref,
  ) {
    const editorHostRef = useRef<HTMLDivElement | null>(null);
    // Full screen: the editor fills the window where it sits (moving it would
    // restart Milkdown and lose undo). Escape or the button leaves.
    const [fullscreen, setFullscreen] = useState(false);
    useKeyboardInsetTracking(fullscreen);
    useEffect(() => {
      if (!fullscreen) return;
      const root = document.documentElement;
      root.classList.add("has-fullscreen-editor");
      return () => root.classList.remove("has-fullscreen-editor");
    }, [fullscreen]);
    // Phones show the everyday buttons; the rest open on a second row.
    const isMobile = useIsMobile();
    const [moreOpen, setMoreOpen] = useState(false);
    const crepeRef = useRef<Crepe | null>(null);
    const pendingFocusRef = useRef(false);
    const pendingMarkdownRef = useRef<string | undefined>(undefined);
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;
    const onChangeRef = useRef(onChange);
    // Text we pushed in ourselves (typed into the stand-in field during load). Milkdown reports
    // changes on a delay, so its echo can arrive after newer typing; never re-emit it as an edit.
    const externalMarkdownRef = useRef<string | undefined>(undefined);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const lastEmittedRef = useRef(value);
    const initialValueRef = useRef(value);
    const placeholderRef = useRef(placeholder);

    const [active, setActive] = useState<ActiveState>(EMPTY_ACTIVE);
    const [ready, setReadyState] = useState(false);
    const [failure, setFailure] = useState<Error | null>(null);
    // A failed mount is re-thrown here so MarkdownEditor's error boundary
    // renders the plain-textarea fallback.
    if (failure) throw failure;
    // The link popover: the range it edits, and the view it edits it in.
    const [link, setLink] = useState<{ view: EditorView; target: LinkTarget } | null>(null);
    const openLinkRef = useRef<() => void>(() => undefined);
    const viewRef = useRef<EditorView | null>(null);
    // Find and replace: open with the text to look for; `findVersion` moves on
    // with each edit while the bar is open so its match count stays right.
    const [find, setFind] = useState<{ initial: string } | null>(null);
    const [findVersion, setFindVersion] = useState(0);
    const findOpenRef = useRef(false);
    findOpenRef.current = find !== null;
    const openFind = useCallback(() => {
      const view = viewRef.current;
      const { from, to } = view?.state.selection ?? { from: 0, to: 0 };
      const selected = view ? view.state.doc.textBetween(from, to, " ") : "";
      setFind({ initial: selected.length <= 80 && !selected.includes("\n") ? selected : "" });
    }, []);
    // @mentions: the people offered (prop, else the page's context), the
    // "@query" being typed, and the highlighted row.
    const contextPeople = useContext(MentionPeopleContext);
    const people = mentionPeople ?? contextPeople;
    const peopleRef = useRef(people);
    peopleRef.current = people;
    const [mention, setMentionState] = useState<MentionQuery | null>(null);
    const mentionRef = useRef<MentionQuery | null>(null);
    const [mentionActive, setMentionActive] = useState(0);
    const setMention = useCallback((next: MentionQuery | null) => {
      const previous = mentionRef.current;
      if (previous?.from === next?.from && previous?.to === next?.to && previous?.query === next?.query) return;
      if (previous?.from !== next?.from || previous?.query !== next?.query) setMentionActive(0);
      mentionRef.current = next;
      setMentionState(next);
    }, []);
    // Esc closes the list for that "@" until the "@" itself is gone, so a
    // literal "@something" can be typed on.
    const dismissedRef = useRef<number | null>(null);
    const mentionListId = useId();
    const mentionResults = mention && people ? matchPeople(people, mention.query) : [];
    const afterTransactionRef = useRef<(view: EditorView) => void>(() => undefined);
    afterTransactionRef.current = (view) => {
      if (findOpenRef.current) setFindVersion((value) => value + 1);
      const next = peopleRef.current?.length && view.hasFocus() ? mentionQueryAt(view.state) : null;
      if (dismissedRef.current !== null && next?.from !== dismissedRef.current) dismissedRef.current = null;
      setMention(next && next.from !== dismissedRef.current ? next : null);
    };
    const setMentionRef = useRef(setMention);
    setMentionRef.current = setMention;
    const mentionKeyRef = useRef<(event: KeyboardEvent, view: EditorView) => void>(() => undefined);
    mentionKeyRef.current = (event, view) => {
      if (!mention || !mentionResults.length) return;
      const pick = () => insertMention(view, mention, mentionResults[Math.min(mentionActive, mentionResults.length - 1)]);
      const handled = ({
        ArrowDown: () => setMentionActive((index) => (index + 1) % mentionResults.length),
        ArrowUp: () => setMentionActive((index) => (index - 1 + mentionResults.length) % mentionResults.length),
        Enter: pick,
        Tab: pick,
        Escape: () => {
          dismissedRef.current = mention.from;
          setMention(null);
        },
      } as Record<string, (() => void) | undefined>)[event.key];
      if (!handled || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      handled();
    };
    // The editable announces the open list to screen readers.
    useEffect(() => {
      const dom = viewRef.current?.dom;
      if (!dom) return;
      if (mention && mentionResults.length) {
        dom.setAttribute("aria-controls", mentionListId);
        dom.setAttribute("aria-activedescendant", `${mentionListId}-${Math.min(mentionActive, mentionResults.length - 1)}`);
      } else {
        dom.removeAttribute("aria-controls");
        dom.removeAttribute("aria-activedescendant");
      }
    }, [mention, mentionResults.length, mentionActive, mentionListId]);
    const toast = useToast();
    const notifyImageRef = useRef(() => undefined as void);
    notifyImageRef.current = () => toast.info("Images can't be added here yet", "Add the file as a document or attachment, and link to it.");
    // Markdown source: a plain field showing the Markdown; edits go out through
    // onChange, and the value sync below carries them into the rich editor.
    const [source, setSource] = useState<string | null>(null);
    const words = fullscreen ? countWords(value ?? "") : 0;
    const openLink = useCallback(() => {
      const crepe = crepeRef.current;
      if (!crepe || readOnlyRef.current) return;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const target = view && linkTargetAt(view);
        if (view && target) setLink({ view, target });
      });
    }, []);
    openLinkRef.current = openLink;

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

        const canUndo = undoDepth(state) > 0;
        const canRedo = redoDepth(state) > 0;
        setActive((prev) => {
          if (
            prev.canUndo === canUndo &&
            prev.canRedo === canRedo &&
            prev.marks.size === marks.size &&
            prev.blocks.size === blocks.size &&
            [...marks].every((m) => prev.marks.has(m)) &&
            [...blocks].every((b) => prev.blocks.has(b))
          ) {
            return prev;
          }
          return { marks, blocks, canUndo, canRedo };
        });
      });
    }, []);

    useEffect(() => {
      const host = editorHostRef.current;
      if (!host) return;
      let disposed = false;
      let ready = false;
      let crepe: Crepe | null = null;
      // Each Crepe instance renders into its own container so an instance that
      // is still tearing down can never clear (or share) the live one's DOM.
      const container = document.createElement("div");
      container.className = "markdown-editor__instance";

      const fail = (error: unknown) => {
        if (disposed || ready) return;
        disposed = true;
        // Re-thrown during render so MarkdownEditor's error boundary swaps in
        // the plain-textarea fallback with the current value.
        setFailure(error instanceof Error ? error : new Error(String(error)));
      };
      // Milkdown reports some plugin failures asynchronously, outside the
      // create() promise. While this instance is starting, treat those as a
      // failed mount instead of leaving an empty, inert box.
      const isMilkdownFailure = (reason: unknown) =>
        reason instanceof Error && (reason.name === "MilkdownError" || /^Context ".+" not found/.test(reason.message));
      const onWindowError = (event: ErrorEvent) => {
        if (isMilkdownFailure(event.error)) fail(event.error);
      };
      const onRejection = (event: PromiseRejectionEvent) => {
        if (isMilkdownFailure(event.reason)) fail(event.reason);
      };
      let watchdog = 0;
      const stopWatching = () => {
        window.removeEventListener("error", onWindowError);
        window.removeEventListener("unhandledrejection", onRejection);
        window.clearTimeout(watchdog);
      };

      const mount = async () => {
        if (disposed) return;
        if (plainEditorRequested()) throw new Error("Rich editing is turned off for this browser.");
        host.appendChild(container);
        window.addEventListener("error", onWindowError);
        window.addEventListener("unhandledrejection", onRejection);
        // A create() that never settles must not leave an inert box forever.
        watchdog = window.setTimeout(() => fail(new Error("The rich text editor took too long to load.")), EDITOR_MOUNT_TIMEOUT_MS);
        const instance = new Crepe({
          root: container,
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
            // The slash (/) menu and the block handle (+ and drag). The menu is
            // pinned to the window (position: fixed, floating-ui's fixed
            // strategy) so a scrolling editor body or dialog can't clip it; the
            // handle shows only in document-sized editors with a mouse.
            [CrepeFeature.BlockEdit]: true,
            // The floating toolbar on selected text (mouse and trackpad only;
            // touch devices have the system's own selection menu).
            [CrepeFeature.Toolbar]: true,
          },
          featureConfigs: {
            [CrepeFeature.BlockEdit]: {
              // Window coordinates (floating-ui's fixed strategy) to match the
              // menu's position: fixed in MarkdownEditor.scss.
              slashMenu: { floatingUIOptions: { strategy: "fixed" } },
              // Only what this editor supports: H1–H3, no images or math.
              textGroup: { h4: null, h5: null, h6: null },
              advancedGroup: { image: null, math: null },
              // The grip sits close to the text, in a narrow left gutter.
              blockHandle: { getOffset: () => 4 },
            },
            [CrepeFeature.Toolbar]: {
              // Its link button opens our link popover, not Crepe's own editor.
              buildToolbar: (builder) => {
                try {
                  const link = builder.getGroup("function").group.items.find((item) => item.key === "link");
                  // After the pointerdown that ran it: opened during that event, the
                  // popover's outside-click check would see it and close at once.
                  if (link) link.onRun = () => { window.setTimeout(() => openLinkRef.current(), 0); };
                } catch {
                  // No function group in this Crepe version; its own link editor stays.
                }
              },
            },
            [CrepeFeature.Placeholder]: {
              text: placeholderRef.current ?? "",
              // "doc" shows the placeholder only when the whole document is
              // empty. "block" paints it on every empty paragraph, so it
              // reappeared on each new line as the user pressed Enter.
              mode: "doc",
            },
          },
        });
        crepe = instance;

        // Crepe saves a pasted or dropped image as a `blob:` address, which only
        // works in this tab and breaks once saved. Until images can be uploaded,
        // turn image files away and say so (pasted text and image links are kept).
        instance.editor.config((ctx) => {
          ctx.update(uploadConfig.key, (prev) => ({
            ...prev,
            uploader: async (files) => {
              if (Array.from(files).some((file) => file.type.startsWith("image/"))) notifyImageRef.current();
              return [];
            },
          }));
        });

        // Find and replace (highlights; MarkdownFindBar drives it) and typed
        // addresses turning into links (markdownLinkify).
        instance.editor.use($prose(() => searchPlugin())).use($prose(() => linkifyPlugin()));

        instance.on((listener) => {
          listener.markdownUpdated((_ctx, markdown) => {
            if (disposed) return;
            const external = externalMarkdownRef.current;
            if (external !== undefined && markdown.trimEnd() === external.trimEnd()) {
              lastEmittedRef.current = external;
              return;
            }
            externalMarkdownRef.current = undefined;
            lastEmittedRef.current = markdown;
            onChangeRef.current(markdown);
          });
        });

        await instance.create();
        if (disposed) return;
        if (!container.querySelector(".ProseMirror")) throw new Error("The rich text editor did not render.");
        ready = true;
        stopWatching();
        crepeRef.current = instance;
        instance.setReadonly(readOnlyRef.current);
        const pending = pendingMarkdownRef.current;
        pendingMarkdownRef.current = undefined;
        // The instance already starts from the initial value; only replay
        // content that changed while it was loading (avoids a spurious onChange).
        if (pending !== undefined && pending !== (initialValueRef.current ?? "")) {
          externalMarkdownRef.current = pending;
          replaceWithTypedText(instance.editor, pending);
        } else {
          restoreTrailingSpace(instance.editor, initialValueRef.current ?? "");
        }

        // Wrap the editor view's dispatch so we recompute toolbar state on
        // *every* transaction — including ones that only change `storedMarks`
        // (e.g. Ctrl+B with an empty selection). The built-in listener API
        // exposes `selectionUpdated` and `updated`, but neither fires for a
        // pure storedMarks change, which is what made the Bold button appear
        // stale until the user typed a character.
        instance.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!view) return;
          viewRef.current = view;
          const originalDispatch = view.dispatch.bind(view);
          view.dispatch = (tr) => {
            originalDispatch(tr);
            recomputeActive();
            afterTransactionRef.current(view);
          };
          // Mention keys come before ProseMirror's own (Enter would split the line).
          container.addEventListener("keydown", (event: KeyboardEvent) => mentionKeyRef.current(event, view), true);
          view.dom.addEventListener("blur", () => setMentionRef.current(null));

          // Pasting a web address over selected text links that text instead
          // of replacing it. Capture on the host runs before ProseMirror's own
          // paste handling on the editable.
          container.addEventListener("paste", (event: ClipboardEvent) => {
            if (readOnlyRef.current) return;
            const { state } = view;
            const linkType = state.schema.marks.link;
            const pasted = event.clipboardData?.getData("text/plain").trim() ?? "";
            if (!linkType || state.selection.empty || !/^(https?:\/\/|mailto:|www\.)\S+$/i.test(pasted)) return;
            if (state.doc.textBetween(state.selection.from, state.selection.to).trim() === pasted) return;
            event.preventDefault();
            event.stopPropagation();
            const { from, to } = state.selection;
            view.dispatch(state.tr.removeMark(from, to, linkType).addMark(from, to, linkType.create({ href: normalizeHref(pasted) })));
          }, true);

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
        setReadyState(true);
        // The wrapper swaps its stand-in plain field for this editor now.
        onReadyRef.current?.();
        if (pendingFocusRef.current) {
          pendingFocusRef.current = false;
          container.querySelector<HTMLElement>(".ProseMirror")?.focus();
        }
      };

      // React StrictMode mounts, unmounts and remounts effects synchronously.
      // Starting on the next task means that throwaway first pass never builds
      // an editor, so two Crepe instances never initialise against one host
      // (the race behind `MilkdownError: Context "nodes" not found`).
      const start = window.setTimeout(() => {
        mount().catch(fail);
      }, 0);

      return () => {
        disposed = true;
        window.clearTimeout(start);
        stopWatching();
        crepeRef.current = null;
        const instance = crepe;
        if (!instance) {
          container.remove();
          return;
        }
        // Milkdown waits for an in-flight create() before tearing down.
        instance.destroy().catch(() => undefined).finally(() => container.remove());
      };
      // Editor is created once on mount; updates flow through other effects.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const crepe = crepeRef.current;
      const next = value ?? "";
      if (!crepe) { pendingMarkdownRef.current = next; lastEmittedRef.current = next; return; }
      if (next === lastEmittedRef.current) return;
      externalMarkdownRef.current = next;
      replaceWithTypedText(crepe.editor, next);
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
          if (editable) editable.focus();
          else pendingFocusRef.current = true;
        },
        setMarkdown: (markdown: string) => {
          const crepe = crepeRef.current;
          if (!crepe) { pendingMarkdownRef.current = markdown; lastEmittedRef.current = markdown; return; }
          crepe.editor.action(replaceAll(markdown));
          lastEmittedRef.current = markdown;
        },
        getMarkdown: () => {
          const crepe = crepeRef.current;
          if (!crepe) return lastEmittedRef.current;
          return crepe.getMarkdown();
        },
        focusEnd: () => {
          const crepe = crepeRef.current;
          if (!crepe) { pendingFocusRef.current = true; return; }
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            if (!view) return;
            const endPos = view.state.doc.content.size;
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(endPos), -1)));
            view.focus();
          });
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
        // The wrapped view.dispatch also recomputes on every transaction.
        item.run({ editor: crepe.editor, isActive, openLink });
        recomputeActive();
      },
      [recomputeActive, openLink],
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
        className={`markdown-editor${readOnly ? " markdown-editor--readonly" : ""}${fullscreen ? " is-fullscreen" : ""}${source !== null ? " is-source" : ""}${className ? ` ${className}` : ""}`}
        role="group"
        onKeyDown={(event) => {
          // Keys from the link popover reach here through its React portal.
          if (!event.currentTarget.contains(event.target as Node)) return;
          // Ctrl/Cmd+K links (in place of the command palette while you write).
          if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k" && (event.target as Element).closest(".ProseMirror")) {
            event.preventDefault();
            event.stopPropagation();
            openLink();
            return;
          }
          // ProseMirror's own Escape ("select the parent node") marks the event
          // handled, so leaving full screen doesn't wait on defaultPrevented.
          // Ctrl/Cmd+F finds in this text (in place of the browser's page find).
          if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f" && source === null) {
            event.preventDefault();
            event.stopPropagation();
            openFind();
            return;
          }
          if (!fullscreen || event.key !== "Escape") return;
          // An open table picker closes first.
          if (event.currentTarget.querySelector(".markdown-editor__table-picker")) return;
          // Handled here, so a dialog around the editor stays open.
          event.preventDefault();
          event.stopPropagation();
          setFullscreen(false);
        }}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
      >
        <div className="markdown-editor__toolbar" role="toolbar" aria-label="Formatting">
          {(() => {
          const renderItem = (item: ToolbarItem) => {
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
                  disabled={readOnly || source !== null || Boolean(item.isDisabled?.(active))}
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
          };
          const table = <TableButton onInsert={insertTable} disabled={readOnly || source !== null} />;
          const sourceButton = (
            <Tooltip content={source !== null ? "Back to formatted text" : "Markdown source"}>
              <button
                type="button"
                className={`markdown-editor__toolbar-button${source !== null ? " is-active" : ""}`}
                aria-label="Markdown source"
                aria-pressed={source !== null}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (source !== null) {
                    setSource(null);
                    window.setTimeout(() => editorHostRef.current?.querySelector<HTMLElement>(".ProseMirror")?.focus(), 0);
                  } else {
                    setSource(crepeRef.current?.getMarkdown() ?? value ?? "");
                  }
                }}
              >
                <FileCode2 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          );
          const findButton = (
            <Tooltip content="Find and replace (Ctrl+F)">
              <button
                type="button"
                className={`markdown-editor__toolbar-button${find ? " is-active" : ""}`}
                aria-label="Find and replace"
                aria-pressed={find !== null}
                disabled={source !== null}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => (find ? setFind(null) : openFind())}
              >
                <Search size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          );
          const trailing = (
            <div className="markdown-editor__toolbar-trailing">
              {fullscreen && <span className="markdown-editor__count" aria-live="off">{words.toLocaleString()} {words === 1 ? "word" : "words"}</span>}
              {toolbarEnd && <div className="markdown-editor__toolbar-end">{toolbarEnd}</div>}
              {!isMobile && findButton}
              {!isMobile && sourceButton}
              <Tooltip content={fullscreen ? "Exit full screen (Esc)" : "Full screen"}>
                <button
                  type="button"
                  className={`markdown-editor__toolbar-button${fullscreen ? " is-active" : ""}`}
                  aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                  aria-pressed={fullscreen}
                  // Keep the selection, like the formatting buttons.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setFullscreen((value) => !value)}
                >
                  {fullscreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
                </button>
              </Tooltip>
            </div>
          );
          if (!isMobile) {
            return (
              <>
                {TOOLBAR_ITEMS.map((item) => (
                  item.id === "redo"
                    ? [renderItem(item), <span key="history-sep" className="markdown-editor__toolbar-sep" aria-hidden="true" />]
                    : renderItem(item)
                ))}
                {table}
                {trailing}
              </>
            );
          }
          const extras = TOOLBAR_ITEMS.filter((item) => !PHONE_TOOLBAR_IDS.has(item.id));
          return (
            <>
              {TOOLBAR_ITEMS.filter((item) => PHONE_TOOLBAR_IDS.has(item.id)).map(renderItem)}
              <button
                type="button"
                className={`markdown-editor__toolbar-button${moreOpen || extras.some((item) => item.isActive(active)) ? " is-active" : ""}`}
                aria-label="More formatting"
                aria-expanded={moreOpen}
                disabled={readOnly}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setMoreOpen((open) => !open);
                }}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
              {/* Status and full screen stay on the first row; the extras wrap below. */}
              {trailing}
              {moreOpen && <span className="markdown-editor__toolbar-break" aria-hidden="true" />}
              {moreOpen && extras.map(renderItem)}
              {moreOpen && table}
              {moreOpen && findButton}
              {moreOpen && sourceButton}
            </>
          );
          })()}
          {/* Inside the toolbar, so it stays pinned with it. */}
          {find && viewRef.current && (
            <MarkdownFindBar view={viewRef.current} initial={find.initial} readOnly={readOnly} version={findVersion} onClose={() => setFind(null)} />
          )}
        </div>
        <div
          ref={editorHostRef}
          className="markdown-editor__body"
          style={{ minHeight: computedMinHeight }}
          // Until Crepe has mounted, paint the stored Markdown (via CSS) so
          // the field never looks empty while the editor initialises.
          aria-busy={ready ? undefined : true}
          data-loading-preview={ready ? undefined : (value || placeholder || "Loading editor…")}
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
        {source !== null && (
          <textarea
            className="markdown-editor__source"
            value={source}
            readOnly={readOnly}
            spellCheck
            aria-label={`${ariaLabel ?? "Text"}, Markdown source`}
            style={{ minHeight: computedMinHeight }}
            onChange={(event) => {
              setSource(event.target.value);
              onChange(event.target.value);
            }}
          />
        )}
        {mention && mentionResults.length > 0 && viewRef.current && (
          <MentionMenu
            view={viewRef.current}
            at={mention}
            people={mentionResults}
            active={Math.min(mentionActive, mentionResults.length - 1)}
            listId={mentionListId}
            onHover={setMentionActive}
            onPick={(person) => { if (viewRef.current) insertMention(viewRef.current, mention, person); }}
          />
        )}
        {link && editorHostRef.current && (
          <LinkPopover view={link.view} target={link.target} body={editorHostRef.current} onClose={() => setLink(null)} />
        )}
      </div>
    );
  },
);
