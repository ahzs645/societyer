import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * The floating box an inline editor opens in, pinned over its cell (or, when
 * `expanded`, a wider panel beside it) and kept on it while the page, the
 * table or the phone keyboard moves.
 */
export function RecordTableCellEditorFrame({
  anchorRef,
  expanded = false,
  className,
  frameRef,
  children,
}: {
  anchorRef: RefObject<HTMLElement>;
  expanded?: boolean;
  className?: string;
  frameRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const next = anchorRef.current?.getBoundingClientRect();
      if (next) setRect(next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // The mobile keyboard pans/resizes the visual viewport without firing
    // window scroll/resize — re-measure so the editor stays on its anchor.
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [anchorRef]);

  if (!rect) return null;

  const editorWidth = expanded ? Math.min(360, window.innerWidth - 16) : rect.width + 4;
  const editorLeft = expanded
    ? Math.min(Math.max(8, rect.left - 2), Math.max(8, window.innerWidth - editorWidth - 8))
    : Math.max(8, rect.left - 2);
  const placeExpandedAbove = expanded && rect.top > window.innerHeight / 2;

  return createPortal(
    <div
      ref={frameRef}
      className={`record-table__cell-editor-popover${expanded ? " record-table__cell-editor-popover--expanded" : ""}${className ? ` ${className}` : ""}`}
      data-record-cell-editor-anchor
      style={{
        left: editorLeft,
        top: placeExpandedAbove ? undefined : Math.max(8, rect.top - 2),
        bottom: placeExpandedAbove ? Math.max(8, window.innerHeight - rect.bottom - 2) : undefined,
        minWidth: editorWidth,
        width: expanded ? editorWidth : undefined,
        height: expanded ? undefined : rect.height + 4,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
