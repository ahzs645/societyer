/**
 * The opportunity list's view switcher, at the head of its toolbar: the queue
 * states with their counts (queue.ts), and the catalog's other views behind
 * "More views". Wider screens show a segmented row; phones a row of pills
 * that scrolls sideways beside the toolbar's buttons. To review also says how
 * many of its notices are new since the person's last visit (lastVisit.ts).
 */
import { useEffect, useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Menu } from "../../../components/Menu";
import { useScrollOverflow } from "../../../hooks/useScrollOverflow";
import { noticeViewName, noticeViewShortName, type NoticeViewId } from "./queue";

const count = (value: number) => value.toLocaleString("en-CA");

export function QueueBar({
  primary,
  more,
  current,
  counts,
  fresh,
  onChange,
}: {
  primary: readonly NoticeViewId[];
  more: readonly NoticeViewId[];
  current: NoticeViewId;
  /** Rows in each view; absent where the list can't count them (a server-paged list). */
  counts?: Partial<Record<NoticeViewId, number>>;
  /** To review's notices issued since the last visit. */
  fresh: number;
  onChange: (view: NoticeViewId) => void;
}) {
  const inMore = more.includes(current);
  // Phones (and the split view's narrow list) scroll the row sideways; the cut-off edge fades.
  const row = useRef<HTMLDivElement>(null);
  const overflow = useScrollOverflow(row, [primary.length, more.length, counts]);
  // Keep the state on show in sight (a link to a view under "More views" lands at the row's end).
  useEffect(() => {
    const list = row.current;
    const active = list?.querySelector<HTMLElement>(".procurement-queue__state.is-active");
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const left = active.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    if (left < list.scrollLeft || left + active.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 24) });
    }
    // Again when the row starts to overflow (the split view narrows the list).
  }, [current, overflow === "none"]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={row} className="procurement-queue" role="group" aria-label="Views" data-overflow={overflow}>
      {primary.map((id) => {
        const active = id === current;
        const total = counts?.[id];
        const name = noticeViewShortName(id);
        const showFresh = id === "review" && fresh > 0;
        return (
          <button
            key={id}
            type="button"
            className={`procurement-queue__state${active ? " is-active" : ""}`}
            aria-pressed={active}
            aria-label={[name, total !== undefined ? count(total) : "", showFresh ? `${count(fresh)} new since your last visit` : ""].filter(Boolean).join(", ")}
            onClick={() => onChange(id)}
          >
            <span className="procurement-queue__label">{name}</span>
            {total !== undefined && <span className="procurement-queue__count" aria-hidden="true">{count(total)}</span>}
            {showFresh && (
              <span className="procurement-queue__fresh" aria-hidden="true" title="New since your last visit">
                {count(fresh)} new
              </span>
            )}
          </button>
        );
      })}
      {more.length > 0 && (
        <Menu
          sheetTitle="More views"
          label="More views"
          trigger={
            <button
              type="button"
              className={`procurement-queue__state procurement-queue__more${inMore ? " is-active" : ""}`}
              aria-label={inMore ? `More views: ${noticeViewName(current)}` : "More views"}
            >
              <span className="procurement-queue__label">{inMore ? noticeViewName(current) : "More views"}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          }
          sections={[
            {
              id: "more",
              items: more.map((id) => ({
                id,
                label: noticeViewName(id),
                hint: id === current ? <Check size={14} aria-label="Showing" /> : counts?.[id] !== undefined ? count(counts[id] ?? 0) : undefined,
                onSelect: () => onChange(id),
              })),
            },
          ]}
        />
      )}
    </div>
  );
}
