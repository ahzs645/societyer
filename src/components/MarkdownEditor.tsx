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
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./MarkdownEditor.scss";

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
   *  can choose between, e.g., "wrap in blockquote" and "lift out of it". */
  run: (args: { editor: Crepe["editor"]; isActive: boolean }) => void;
}

// Names below match the Milkdown schema for @milkdown/preset-commonmark and
// @milkdown/preset-gfm. We look up commands by their string registration name
// (`$command("ToggleStrong", …)`) because Crepe bundles its own copies of
// those plugins — the Slice Symbols differ between our import and the copy
// Crepe registers, but the names are stable.

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
];

const EMPTY_ACTIVE: ActiveState = {
  marks: new Set<string>(),
  blocks: new Set<string>(),
};

const TRACKED_MARK_NAMES = ["strong", "emphasis", "strike_through", "inlineCode"];
const TRACKED_BLOCK_NAMES = ["bullet_list", "ordered_list", "blockquote"];

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
          [CrepeFeature.Table]: false,
        },
        featureConfigs: {
          [CrepeFeature.Placeholder]: {
            text: placeholderRef.current ?? "",
            mode: "block",
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
        item.run({ editor: crepe.editor, isActive });
        // The wrapped view.dispatch already triggers a recompute, but call
        // through one more time so single-click feedback feels instant even
        // if the command bailed before dispatching.
        recomputeActive();
      },
      [recomputeActive],
    );

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
            const titleParts = [item.label];
            if (item.shortcut) titleParts[0] = `${item.label} (${item.shortcut})`;
            if (item.hint) titleParts.push(item.hint);
            const title = titleParts.join("\n");
            return (
              <button
                key={item.id}
                type="button"
                className={`markdown-editor__toolbar-button${isActive ? " is-active" : ""}`}
                title={title}
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
            );
          })}
        </div>
        <div
          ref={editorHostRef}
          className="markdown-editor__body"
          style={{ minHeight: computedMinHeight }}
        />
      </div>
    );
  },
);
