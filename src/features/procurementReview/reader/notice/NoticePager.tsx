/**
 * Previous and next within the list the notice was opened from, and the
 * keys that work while a notice is open.
 *
 * Stepping to a neighbour replaces the history entry rather than adding one
 * (routes.ts `update`), and the entry keeps the place it was opened from. So
 * Back, in the page or the browser, still returns to the list in one step,
 * at the rows it showed, however many notices were stepped through, and
 * still says "Opportunities". Stepping is reading the list in place, not
 * going somewhere new; a notice opened from inside another (a related award)
 * adds an entry as before.
 *
 * Only over the list: a notice opened from a buyer page or the analytics
 * isn't in the list's order, so it shows no previous and next.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip } from "../../../../components/Tooltip";
import { ShortcutHint } from "../../../../components/ShortcutHint";
import { isTypingTarget } from "../../../../lib/shortcutsRegistry";
import { TRIAGE_CLASSIFICATIONS } from "../../../../../shared/procurementTriage";
import { useAdjacentNotices } from "../listOrder";
import { NOTICE_PARAM, readerPlaces, useReaderNavigation } from "../routes";
import type { NoticeTriageControl } from "../NoticeTriageBar";

export type NoticeNeighbours = {
  previous: string | null;
  next: string | null;
  /** Null when the notice has just left the list (it was triaged out of the view) but keeps its neighbours. */
  position: number | null;
  total: number;
  go: (recordKey: string) => void;
};

export function useNoticeNeighbours(recordKey: string): NoticeNeighbours | null {
  const { params, update } = useReaderNavigation();
  const adjacent = useAdjacentNotices(recordKey);
  const { party, analytics } = readerPlaces(params);
  const go = useCallback((key: string) => update({ [NOTICE_PARAM]: key, tab: null }), [update]);
  if (party || analytics || (adjacent.position === null && !adjacent.previous && !adjacent.next)) return null;
  return { previous: adjacent.previous, next: adjacent.next, position: adjacent.position, total: adjacent.total, go };
}

/** The arrow pressed last, so the next notice's arrow takes the focus back (the page is new, and focus would fall to the body). */
let focusAfterStep: "previous" | "next" | null = null;

/** ‹ 3 of 7 ›; `compact` leaves out the position (the phone's app bar). */
export function NoticePager({ neighbours, compact = false }: { neighbours: NoticeNeighbours; compact?: boolean }) {
  const { previous, next, position, total, go } = neighbours;
  const previousButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = focusAfterStep === "previous" ? previousButton.current : focusAfterStep === "next" ? nextButton.current : null;
    focusAfterStep = null;
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }, []);
  const step = (direction: "previous" | "next", key: string | null) => {
    if (!key) return;
    focusAfterStep = direction;
    go(key);
  };
  return (
    <nav className="procurement-pager" aria-label="Notices in this list">
      <Tooltip content={<>Previous notice <ShortcutHint keys={["K"]} tone="inverse" /></>}>
        <button
          ref={previousButton}
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Previous notice"
          aria-keyshortcuts="K"
          disabled={!previous}
          onClick={() => step("previous", previous)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      <span className={compact ? "sr-only" : "procurement-pager__position"}>
        {position === null ? `${total} left` : `${position} of ${total}`}
      </span>
      <Tooltip content={<>Next notice <ShortcutHint keys={["J"]} tone="inverse" /></>}>
        <button
          ref={nextButton}
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Next notice"
          aria-keyshortcuts="J"
          disabled={!next}
          onClick={() => step("next", next)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </Tooltip>
    </nav>
  );
}

/** Open popups and dialogs own their keys. */
const ELSEWHERE = '[role="menu"], [role="listbox"], [role="combobox"], [aria-haspopup][aria-expanded="true"], dialog, [role="dialog"]';
const MODAL_OPEN = 'dialog[open], [role="dialog"][aria-modal="true"]';

/**
 * While the notice is open and focus isn't in a field: J and K step to the
 * next and previous notice, 1–4 classify it (in TRIAGE_CLASSIFICATIONS
 * order: Doable, Possible, Needs a partner, Not doable) and R ticks or
 * unticks Reviewed, when the triage can be changed. In the wide desktop's
 * split, J and K pressed in the list beside the notice stay the list's, while
 * 1–4 and R still act on the open notice. `announce`
 * says what a key did, for screen readers.
 */
export function useNoticeShortcuts({
  root,
  neighbours,
  triage,
  announce,
}: {
  root: HTMLElement | null;
  neighbours: NoticeNeighbours | null;
  triage: NoticeTriageControl | null;
  announce: (message: string) => void;
}) {
  const latest = useRef({ neighbours, triage, announce });
  useLayoutEffect(() => {
    latest.current = { neighbours, triage, announce };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (isTypingTarget(target)) return;
      // Focus on the notice, or on a container around it (clicking plain text focuses the app's
      // <main>), counts as on the notice. In the split view the list beside it keeps J and K for
      // its own rows, but the classify keys still act on the notice that's open.
      const inSplitList = target instanceof Element && Boolean(target.closest(".procurement-split__list"));
      if (target instanceof Element && !inSplitList && root && !root.contains(target) && !target.contains(root)) return;
      if (target instanceof Element && target.closest(ELSEWHERE)) return;
      if (document.querySelector(MODAL_OPEN)) return;
      const { neighbours: around, triage: control, announce: say } = latest.current;
      const key = event.key.toLowerCase();
      if ((key === "j" || key === "k") && around && !inSplitList) {
        const to = key === "j" ? around.next : around.previous;
        event.preventDefault();
        if (to) around.go(to);
        else say(key === "j" ? "This is the last notice in the list." : "This is the first notice in the list.");
        return;
      }
      if (event.repeat || !control?.editable) return;
      const index = ["1", "2", "3", "4"].indexOf(key);
      if (index >= 0) {
        const choice = TRIAGE_CLASSIFICATIONS[index];
        event.preventDefault();
        void control.save({ ...control.current, classification: choice.value });
        say(`Classified ${choice.label}.`);
      } else if (key === "r") {
        event.preventDefault();
        const reviewed = !control.current.reviewed;
        void control.save({ ...control.current, reviewed });
        say(reviewed ? "Marked reviewed." : "Marked not reviewed.");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}
