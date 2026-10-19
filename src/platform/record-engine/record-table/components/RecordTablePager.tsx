import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableStoreHandle } from "../state/recordTableStore";
import type { RecordTablePage } from "../utils/viewDisplay";
import { lowerLabel } from "../utils/lowerLabel";

const formatCount = (value: number) => value.toLocaleString("en-CA");

/** Room left above the list when it is brought back into view (sticky page header). */
const TOP_MARGIN = 72;

function scrollParentOf(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/**
 * A new page starts at its first row: the table's own scroller goes back to
 * the top, and when the list's top has scrolled out of view the page (or the
 * window) scrolls back up to it.
 */
function revealListTop(list: Element | null) {
  if (!(list instanceof HTMLElement)) return;
  const inner = list.matches(".record-table__scroll") ? list : list.querySelector<HTMLElement>(".record-table__scroll");
  if (inner) inner.scrollTop = 0;
  const parent = scrollParentOf(list);
  const top = list.getBoundingClientRect().top;
  const viewportTop = parent ? parent.getBoundingClientRect().top : 0;
  if (top >= viewportTop) return;
  const delta = top - viewportTop - TOP_MARGIN;
  if (parent) parent.scrollTop += delta;
  else window.scrollBy({ top: delta });
}

/**
 * Previous / Next under a table shown in pages: "1–50 of 3,752" and the
 * page number. The search, filters and sort have already run over the whole
 * list; this only turns its pages. `RecordTable` draws it.
 */
export function RecordTablePager({ page }: { page: RecordTablePage }) {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const handle = useRecordTableStoreHandle();
  const plural = lowerLabel(objectMetadata.labelPlural);
  const navRef = useRef<HTMLElement>(null);
  const turn = (pageIndex: number) => {
    // A focused cell would stay behind on the page left; let it go.
    handle.set({ pageIndex, focusedCell: null, rangeAnchor: null });
    // The list is the pager's previous sibling (see RecordTable).
    window.requestAnimationFrame(() => revealListTop(navRef.current?.previousElementSibling ?? null));
  };
  const hasPrevious = page.index > 0;
  const hasNext = page.index < page.count - 1;
  const range = page.total === 0 ? "0" : `${formatCount(page.start + 1)}–${formatCount(page.end)}`;
  return (
    <nav ref={navRef} className="record-table__pager" aria-label={`${objectMetadata.labelPlural} pages`}>
      <span className="record-table__pager-range" aria-live="polite">
        {range} of {formatCount(page.total)} <span className="record-table__pager-noun">{plural}</span>
      </span>
      <div className="record-table__pager-controls">
        <button
          type="button"
          className="btn btn--sm"
          disabled={!hasPrevious}
          aria-label="Previous page"
          onClick={() => turn(page.index - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" /> <span className="record-table__pager-label">Previous</span>
        </button>
        <span className="record-table__pager-page">
          Page {formatCount(page.index + 1)} of {formatCount(page.count)}
        </span>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!hasNext}
          aria-label="Next page"
          onClick={() => turn(page.index + 1)}
        >
          <span className="record-table__pager-label">Next</span> <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
