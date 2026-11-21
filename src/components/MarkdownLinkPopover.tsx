/**
 * Link editing for the rich text editor: a popover at the text instead of a
 * dialog. On selected text, type or paste an address; on an existing link, the
 * address is filled in with Open and Remove; with nothing selected, the address
 * goes in as its own linked text.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Unlink } from "lucide-react";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { MarkType, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { ViewportPopover } from "./ViewportPopover";

/** What the popover edits: a document range and the link already on it, if any. */
export type LinkTarget = { from: number; to: number; href: string };

/**
 * Finds the contiguous range of `markType` (a link) around a collapsed cursor.
 * Checks the node on both sides of the caret so it works whether the cursor is
 * inside the link or sitting right at its trailing edge. Returns null if there
 * is no such mark adjacent to the position.
 */
export function getMarkRange(
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

/** The selection, or the whole link around a bare cursor, and its current address. */
export function linkTargetAt(view: EditorView): LinkTarget | null {
  const { state } = view;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  let { from, to } = state.selection;
  if (state.selection.empty) {
    const range = getMarkRange(state.selection.$from, linkType);
    if (range) ({ from, to } = range);
  }
  let href = "";
  if (to > from) {
    state.doc.nodesBetween(from, to, (node) => {
      const mark = linkType.isInSet(node.marks);
      if (mark && !href) href = String(mark.attrs.href ?? "");
    });
  }
  return { from, to, href };
}

/** Bare domains get https://; schemes (mailto:, https:), absolute paths and anchors stay as typed. */
export function normalizeHref(raw: string) {
  return /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
}

/** Puts `raw` on the target (replacing any link there), or inserts it as linked text at a bare cursor. */
function setLink(view: EditorView, target: LinkTarget, raw: string) {
  const { state } = view;
  const linkType = state.schema.marks.link;
  if (!linkType) return;
  const size = state.doc.content.size;
  const from = Math.min(target.from, size);
  const to = Math.min(target.to, size);
  const mark = linkType.create({ href: normalizeHref(raw) });
  const tr = state.tr;
  if (from === to) {
    tr.insertText(raw, from).addMark(from, from + raw.length, mark);
    tr.setSelection(TextSelection.create(tr.doc, from + raw.length));
  } else {
    tr.removeMark(from, to, linkType).addMark(from, to, mark);
    tr.setSelection(TextSelection.create(tr.doc, to));
  }
  view.dispatch(tr);
}

/** Strips the link and leaves its text selected. */
function unsetLink(view: EditorView, target: LinkTarget) {
  const { state } = view;
  const linkType = state.schema.marks.link;
  if (!linkType) return;
  const tr = state.tr.removeMark(target.from, target.to, linkType);
  tr.setSelection(TextSelection.create(tr.doc, target.from, target.to));
  view.dispatch(tr);
}

/**
 * Where the target sits, as a box inside the editor's body. The anchor lives in
 * the body, so it scrolls with the text and the popover follows it.
 */
function anchorStyle(view: EditorView, target: LinkTarget, body: HTMLElement): CSSProperties {
  const start = view.coordsAtPos(target.from);
  const end = view.coordsAtPos(target.to, -1);
  const box = body.getBoundingClientRect();
  const oneLine = Math.abs(end.top - start.top) < 4;
  return {
    position: "absolute",
    left: start.left - box.left + body.scrollLeft,
    top: start.top - box.top + body.scrollTop,
    width: oneLine ? Math.max(1, end.right - start.left) : 1,
    height: Math.max(1, end.bottom - start.top),
    pointerEvents: "none",
  };
}

export function LinkPopover({ view, target, body, onClose }: {
  view: EditorView;
  target: LinkTarget;
  /** The editor's body (`.markdown-editor__body`), which holds the anchor. */
  body: HTMLElement;
  onClose: () => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<CSSProperties>(() => anchorStyle(view, target, body));
  const [value, setValue] = useState(target.href);
  const existing = Boolean(target.href);
  // The text being linked comes into view first, so the popover opens beside
  // it: a cursor can sit off screen or under the page's floating bars (the
  // pinned toolbar above, the Ask bar and phone navigation below), so text
  // near either edge is brought to the middle.
  useLayoutEffect(() => {
    const node = anchor.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (box.top < 140 || box.bottom > window.innerHeight - 200) node.scrollIntoView({ block: "center" });
  }, []);
  useEffect(() => {
    // Text reflows with the window; the body's scroll moves the anchor on its own.
    const update = () => setPosition(anchorStyle(view, target, body));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [view, target, body]);
  const done = (change?: () => void) => {
    change?.();
    onClose();
    view.focus();
  };
  const raw = value.trim();
  return (
    <>
      {createPortal(<span ref={anchor} aria-hidden="true" style={position} />, body)}
      {/* On the page body, so a drawer or dialog around the editor can't offset it. */}
      {createPortal(
        <ViewportPopover open onClose={() => done()} anchorRef={anchor} align="start" label={existing ? "Edit link" : "Add link"} className="info-popover markdown-link-popover">
          <form
            className="markdown-link-popover__row"
            onSubmit={(event) => {
              event.preventDefault();
              if (raw) done(() => setLink(view, target, raw));
            }}
          >
            <input
              className="input"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Paste or type a link"
              aria-label="Link address"
              data-autofocus
            />
            <button type="submit" className="btn-action btn-action--primary" disabled={!raw}>
              {existing ? "Save" : "Link"}
            </button>
          </form>
          {existing && (
            <div className="markdown-link-popover__actions">
              <a className="btn-action" href={normalizeHref(target.href)} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} aria-hidden="true" /> Open
              </a>
              <button type="button" className="btn-action" onClick={() => done(() => unsetLink(view, target))}>
                <Unlink size={13} aria-hidden="true" /> Remove link
              </button>
            </div>
          )}
        </ViewportPopover>,
        document.body,
      )}
    </>
  );
}
