/**
 * The opportunity list's view switcher, at the head of its toolbar: the queue
 * states with their counts (queue.ts), and the catalog's other views behind
 * "More views". It is the app's segmented control (as Transactions' To review
 * / Reviewed), so the queue reads like the rest of the app rather than a
 * second row of page tabs under Opportunities / Awards / Analytics.
 *
 * Where the row doesn't fit beside the toolbar's own buttons (Search, view
 * type, Ask, Filter, Sort, Options), it folds into one menu button showing the
 * state on show with its count, like other lists' view pickers; the menu holds
 * every state with its count and the other views. Phones always get the menu
 * button. To review also says how many of its notices are new since the
 * person's last visit (lastVisit.ts).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Menu, type MenuItem } from "../../../components/Menu";
import { createFitLatch } from "../../../lib/settledLayout";
import { Segmented, type SegmentedItem } from "../../../components/primitives";
import { noticeViewName, noticeViewShortName, type NoticeViewId } from "./queue";

const count = (value: number) => value.toLocaleString("en-CA");

export function QueueBar({
  primary,
  more,
  current,
  counts,
  fresh,
  onChange,
  onCompactTools,
}: {
  primary: readonly NoticeViewId[];
  more: readonly NoticeViewId[];
  current: NoticeViewId;
  /** Rows in each view; absent where the list can't count them (a server-paged list). */
  counts?: Partial<Record<NoticeViewId, number>>;
  /** To review's notices issued since the last visit. */
  fresh: number;
  onChange: (view: NoticeViewId) => void;
  /**
   * Told whether the row needs the toolbar's buttons shown as icons to fit
   * (RecordTableToolbar `compactTools`). Without it the row folds straight
   * into the menu.
   */
  onCompactTools?: (compact: boolean) => void;
}) {
  const inMore = more.includes(current);
  const slot = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const freshNote = (id: NoticeViewId) => (id === "review" && fresh > 0 ? `${count(fresh)} new` : null);
  const accessibleName = (id: NoticeViewId, name: string) => {
    const total = counts?.[id];
    return [name, total !== undefined ? count(total) : "", freshNote(id) ? `${freshNote(id)} since your last visit` : ""].filter(Boolean).join(", ");
  };
  const badge = (id: NoticeViewId) => {
    const note = freshNote(id);
    return note ? <span className="procurement-queue__fresh" aria-hidden="true" title="New since your last visit">{note}</span> : null;
  };
  const items: SegmentedItem<NoticeViewId>[] = primary.map((id) => ({
    id,
    label: noticeViewShortName(id),
    count: counts?.[id],
    badge: badge(id),
    ariaLabel: accessibleName(id, noticeViewShortName(id)),
  }));
  const moreLabel = inMore ? noticeViewName(current) : "More views";
  const moreButton = (props: { measuring?: true } = {}) => (
    <button
      type="button"
      className={`segmented__btn procurement-queue__more${inMore ? " is-active" : ""}`}
      aria-label={props.measuring ? undefined : inMore ? `More views: ${noticeViewName(current)}` : "More views"}
      tabIndex={props.measuring ? -1 : undefined}
    >
      <span className="procurement-queue__more-label">{moreLabel}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
  );
  const row = (trailing: ReactNode) => (
    <Segmented<NoticeViewId>
      className="procurement-queue__row"
      aria-label="Views"
      value={current}
      onChange={onChange}
      items={items}
      trailing={trailing}
    />
  );
  const fit = useQueueFit(slot, measure, onCompactTools);

  // Menu rows: a check beside the view on show, each view's count at the end.
  const menuItem = (id: NoticeViewId, label: ReactNode): MenuItem => ({
    id,
    icon: id === current ? <Check size={14} aria-label="Showing" /> : <span className="procurement-queue__menu-spacer" />,
    label,
    right: counts?.[id] !== undefined ? <span className="procurement-queue__menu-count">{count(counts[id] ?? 0)}</span> : undefined,
    onSelect: () => onChange(id),
  });
  const moreItems = more.map((id) => menuItem(id, noticeViewName(id)));
  const currentTotal = counts?.[current];

  return (
    <div ref={slot} className="procurement-queue" data-fit={fit}>
      {fit === "row" || fit === "row-compact" ? (
        row(
          more.length > 0 && (
            <Menu sheetTitle="More views" label="More views" align="right" sections={[{ id: "more", items: moreItems }]} trigger={moreButton()} />
          ),
        )
      ) : (
        <div className="record-table__view-switcher procurement-queue__picker">
          <Menu
            sheetTitle="Views"
            label="Views"
            minWidth={260}
            sections={[
              {
                id: "queue",
                items: primary.map((id) =>
                  menuItem(
                    id,
                    <span className="procurement-queue__menu-label">
                      {noticeViewName(id)}
                      {badge(id)}
                    </span>,
                  ),
                ),
              },
              ...(more.length > 0 ? [{ id: "more", label: "More views", items: moreItems }] : []),
            ]}
            trigger={
              <button
                type="button"
                className="record-table__view-button"
                aria-label={`View: ${accessibleName(current, noticeViewName(current))}`}
              >
                <span className="record-table__view-name">{noticeViewShortName(current)}</span>
                {currentTotal !== undefined && <span className="record-table__view-count">{count(currentTotal)}</span>}
                {badge(current)}
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            }
          />
        </div>
      )}
      {/* The row at its natural width, out of sight, so the fit is known whichever form shows. */}
      <div ref={measure} className="procurement-queue__measure" aria-hidden="true">
        {row(more.length > 0 && moreButton({ measuring: true }))}
      </div>
    </div>
  );
}

type QueueFit = "row" | "row-compact" | "menu" | "menu-compact";
/** About the picker's width ("To review 1,644 ▾") before it has shown and can be measured. */
const PICKER_WIDTH = 150;

/**
 * How the switcher fits in the toolbar: the segmented row (measured at its
 * natural width in `measure`) beside the toolbar's labelled buttons, beside
 * the same buttons as icons ("row-compact", reported through
 * `onCompactTools`), or not at all: the picker beside labelled buttons
 * ("menu"), or beside icons where even that won't fit ("menu-compact"). The toolbar's other groups are
 * counted at the width they ask for (a growing search field at its basis,
 * filter chips at their minimum, buttons with their words), not the width
 * they were squeezed to, so the answer doesn't depend on which form is
 * showing. A toolbar stacked into a column (tablets) gives the row a line of
 * its own.
 *
 * Where that estimate still comes out differently in each form (the view
 * type buttons, say, hide their names in the icon form), a fit latch keeps
 * the choice from flipping back and forth on every frame: it may always get
 * more compact, but gets roomier only once the toolbar has more room than
 * when it last shrank, or its other contents change.
 */
function useQueueFit(
  slot: RefObject<HTMLElement>,
  measure: RefObject<HTMLElement>,
  onCompactTools: ((compact: boolean) => void) | undefined,
): QueueFit {
  const [fit, setFit] = useState<QueueFit>("row");
  const latch = useRef(createFitLatch<QueueFit>(["row", "row-compact", "menu", "menu-compact"]));
  useLayoutEffect(() => {
    const element = slot.current;
    const measured = measure.current?.firstElementChild;
    const toolbar = element?.closest<HTMLElement>(".record-table__toolbar");
    const leading = element?.closest<HTMLElement>(".record-table__toolbar-left");
    if (!element || !(measured instanceof HTMLElement) || !toolbar || !leading) return;
    let contents = "";
    const check = () => {
      // A few pixels' slack, so a row that only just fits doesn't flicker as counts change.
      const needed = measured.getBoundingClientRect().width + 4;
      const room = toolbarRoom(toolbar, leading);
      // The picker as it shows, or about its usual width before it has shown.
      const picker = element.querySelector<HTMLElement>(".procurement-queue__picker");
      const pickerNeeded = (picker ? picker.getBoundingClientRect().width : PICKER_WIDTH) + 4;
      const wanted: QueueFit = needed <= room.labelled ? "row"
        : onCompactTools && needed <= room.compact ? "row-compact"
        : !onCompactTools || pickerNeeded <= room.labelled ? "menu"
        : "menu-compact";
      // The toolbar's other groups and how many items each lays out, which the
      // form shown doesn't change; a change there (search opened) is news.
      const next = Array.from(toolbar.children)
        .filter((child): child is HTMLElement => child !== leading && child instanceof HTMLElement)
        .map((child) => `${child.className}:${flexItems(child).length}`)
        .join("|");
      if (next !== contents) latch.current.reset();
      contents = next;
      setFit(latch.current.decide(wanted, toolbar.clientWidth - needed));
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(toolbar);
    observer.observe(measured);
    for (const child of Array.from(toolbar.children)) if (child !== leading) observer.observe(child);
    return () => observer.disconnect();
  }, [slot, measure, onCompactTools]);
  const report = useRef(onCompactTools);
  report.current = onCompactTools;
  useLayoutEffect(() => report.current?.(fit === "row-compact" || fit === "menu-compact"), [fit]);
  useLayoutEffect(() => () => report.current?.(false), []);
  return fit;
}

type Room = { labelled: number; compact: number };

/** The width left for the toolbar's leading group once the others have what they ask for, with the buttons labelled and as icons. */
function toolbarRoom(toolbar: HTMLElement, leading: HTMLElement): Room {
  const style = getComputedStyle(toolbar);
  const inner = toolbar.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  if (style.flexDirection === "column") return { labelled: inner, compact: inner };
  const gap = parseFloat(style.columnGap) || 0;
  const room = { labelled: inner, compact: inner };
  for (const child of Array.from(toolbar.children)) {
    if (child === leading || !(child instanceof HTMLElement)) continue;
    const asked = child.classList.contains("record-table__toolbar-right") ? buttonsWidth(child) : askedWidth(child);
    if (!asked) continue;
    room.labelled -= asked.labelled + gap;
    room.compact -= asked.compact + gap;
  }
  return room;
}

/** The flex items an element lays out, looking through `display: contents` wrappers; floating and hidden ones take no room. */
function flexItems(element: HTMLElement): HTMLElement[] {
  return Array.from(element.children).flatMap((child) => {
    if (!(child instanceof HTMLElement)) return [];
    const style = getComputedStyle(child);
    if (style.display === "contents") return flexItems(child);
    if (style.display === "none" || style.position === "absolute" || style.position === "fixed") return [];
    return [child];
  });
}

/** A toolbar item's width in the row; null when it takes none there (floating, hidden, or a line of its own). */
function askedWidth(element: HTMLElement): Room | null {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.position === "absolute" || style.position === "fixed") return null;
  if (style.display === "contents") return buttonsWidth(element);
  if (style.flexBasis.endsWith("%") && parseFloat(style.flexBasis) >= 100) return null;
  let width = element.getBoundingClientRect().width;
  if (parseFloat(style.flexGrow) > 0) {
    width = Math.max(style.flexBasis.endsWith("px") ? parseFloat(style.flexBasis) : 0, parseFloat(style.minWidth) || 0);
  }
  return { labelled: width, compact: width };
}

/**
 * The right-hand group on one line, with its buttons labelled and as icons
 * (RecordTableToolbar `compactTools` hides the words but keeps them
 * measurable). Only the group's own buttons fold; unsaved-view ones keep
 * their words.
 */
function buttonsWidth(group: HTMLElement): Room {
  const items = flexItems(group);
  const gaps = (parseFloat(getComputedStyle(group).columnGap) || 0) * Math.max(0, items.length - 1);
  const total = { labelled: gaps, compact: gaps };
  for (const item of items) {
    const width = item.getBoundingClientRect().width;
    const button = item.parentElement !== group ? null
      : item.matches(".record-table__toolbar-button") ? item
      : item.querySelector<HTMLElement>(":scope > .record-table__toolbar-button");
    const label = button?.querySelector<HTMLElement>(":scope > span");
    if (!button || !label) {
      total.labelled += width;
      total.compact += width;
      continue;
    }
    // Built up from the button's parts, so both forms come out the same whichever is showing.
    const style = getComputedStyle(button);
    const parts = Array.from(button.children).filter((child): child is HTMLElement | SVGElement =>
      child !== label && (child instanceof HTMLElement || child instanceof SVGElement) && getComputedStyle(child).position !== "absolute");
    const gap = parseFloat(style.columnGap) || 0;
    const px = (value: string) => parseFloat(value) || 0;
    const bare = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
      + parts.reduce((sum, part) => sum + part.getBoundingClientRect().width, 0)
      + gap * Math.max(0, parts.length - 1);
    const floor = px(style.minWidth);
    // Whatever wraps the button (the view switcher around Options) is counted as it is.
    const frame = width - button.getBoundingClientRect().width;
    total.labelled += frame + Math.max(floor, bare + (parts.length ? gap : 0) + label.scrollWidth);
    total.compact += frame + Math.max(floor, bare);
  }
  return total;
}
