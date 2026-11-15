/**
 * Previous and next within the list the notice was opened from, and the
 * keys that work while a notice is open.
 *
 * Stepping to a neighbour replaces the history entry rather than adding one
 * (routes.ts `update`), and the entry keeps the place it was opened from. So
 * closing the panel, or Back in the browser, still returns to the list in one
 * step, at the rows it showed, however many notices were stepped through.
 * Stepping is reading the list in place, not going somewhere new; a notice
 * opened from inside another (a related award) adds an entry as before.
 *
 * Only over the list: a notice opened from a buyer page or the analytics
 * isn't in the list's order, so it shows no previous and next.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  const { party, commodity, analytics } = readerPlaces(params);
  const go = useCallback((key: string) => update({ [NOTICE_PARAM]: key, tab: null }), [update]);
  if (party || commodity || analytics || (adjacent.position === null && !adjacent.previous && !adjacent.next)) return null;
  return { previous: adjacent.previous, next: adjacent.next, position: adjacent.position, total: adjacent.total, go };
}

/** "3 of 7", or "7 left" for a notice that has just left the list. */
export const positionText = ({ position, total }: NoticeNeighbours) => (position === null ? `${total} left` : `${position} of ${total}`);

/** The arrow used last, so the next notice's arrow takes the focus back (the panel's card is new, and focus would fall out of it). */
let focusAfterStep: "previous" | "next" | null = null;

/**
 * ↑ and ↓ in the panel's header, as the transactions panel has them. J and K
 * do the same (useNoticeShortcuts); the tooltips say so.
 */
export function NoticeStepper({ neighbours }: { neighbours: NoticeNeighbours }) {
  const { previous, next, go } = neighbours;
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
    <div className="procurement-stepper" role="group" aria-label={`Notices in this list, ${positionText(neighbours)}`}>
      <Tooltip content={<span className="procurement-pager__tip">Previous notice <ShortcutHint keys={["↑"]} tone="inverse" /> or <ShortcutHint keys={["K"]} tone="inverse" /></span>} placement="bottom">
        <button
          ref={previousButton}
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Previous notice"
          aria-keyshortcuts="ArrowUp K"
          disabled={!previous}
          onClick={() => step("previous", previous)}
        >
          <ChevronUp size={15} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content={<span className="procurement-pager__tip">Next notice <ShortcutHint keys={["↓"]} tone="inverse" /> or <ShortcutHint keys={["J"]} tone="inverse" /></span>} placement="bottom">
        <button
          ref={nextButton}
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Next notice"
          aria-keyshortcuts="ArrowDown J"
          disabled={!next}
          onClick={() => step("next", next)}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

/** Open popups and other dialogs own their keys. */
const ELSEWHERE = '[role="menu"], [role="listbox"], [role="combobox"], [aria-haspopup][aria-expanded="true"], dialog, [role="dialog"]';
const MODAL_OPEN = 'dialog[open], [role="dialog"][aria-modal="true"]';
/** Where the arrows keep their own meaning: tabs, the table's cells and editors. */
const OWN_ARROWS = '[role="tablist"], [role="grid"], .record-table__cell, .record-cell__editor, .record-table__cell-editor-popover';

/**
 * While the notice is open, and focus is on it or on the page around it (not
 * in a field, a popup or another dialog): J and K step to the next and
 * previous notice, ↑ and ↓ too from the panel itself (or with nothing
 * focused; in the list they move its cells), 1–4 classify it (in
 * TRIAGE_CLASSIFICATIONS order: Doable, Possible, Needs a partner, Not
 * doable) and R ticks or unticks Reviewed, when the triage can be changed.
 * `announce` says what a key did, for screen readers. `enabled` is false
 * while the panel is minimised.
 */
export function useNoticeShortcuts({
  root,
  enabled,
  neighbours,
  triage,
  announce,
}: {
  root: HTMLElement | null;
  enabled: boolean;
  neighbours: NoticeNeighbours | null;
  triage: NoticeTriageControl | null;
  announce: (message: string) => void;
}) {
  const latest = useRef({ neighbours, triage, announce });
  useLayoutEffect(() => {
    latest.current = { neighbours, triage, announce };
  });
  useEffect(() => {
    if (!enabled || !root) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTypingTarget(target)) return;
      // The panel is a dialog itself; only a popup or dialog other than the one holding the notice takes the keys.
      const popup = target?.closest(ELSEWHERE);
      if (popup && !popup.contains(root)) return;
      if ([...document.querySelectorAll(MODAL_OPEN)].some((modal) => !modal.contains(root))) return;
      const { neighbours: around, triage: control, announce: say } = latest.current;
      const key = event.key.toLowerCase();
      const arrow = key === "arrowdown" || key === "arrowup";
      if (arrow) {
        const panel = root.closest('[role="dialog"]') ?? root;
        const fromPanel = Boolean(target && panel.contains(target));
        const fromNowhere = !target || target === document.body || target === document.documentElement;
        if ((!fromPanel && !fromNowhere) || target?.closest(OWN_ARROWS)) return;
      }
      if ((key === "j" || key === "k" || arrow) && around) {
        const to = key === "j" || key === "arrowdown" ? around.next : around.previous;
        event.preventDefault();
        if (to) around.go(to);
        else say(key === "j" || key === "arrowdown" ? "This is the last notice in the list." : "This is the first notice in the list.");
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
  }, [root, enabled]);
}
