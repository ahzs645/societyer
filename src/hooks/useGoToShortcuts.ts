import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GO_TO_SHORTCUTS, isTypingTarget } from "../lib/shortcutsRegistry";

/** How long after "g" the second key still counts as part of the sequence. */
const SEQUENCE_WINDOW_MS = 1200;

function overlayOpen() {
  return Boolean(document.querySelector('[aria-modal="true"], .kbar'));
}

/**
 * "g then d/t/m/f" jumps to the dashboard, tasks, meetings or financials
 * (Gmail/Linear convention). Ignored while typing, with modifiers held, or
 * while a modal/palette is open.
 */
export function useGoToShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    let pendingSince = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || overlayOpen()) {
        pendingSince = 0;
        return;
      }
      const key = event.key.toLowerCase();
      const now = Date.now();
      if (pendingSince && now - pendingSince <= SEQUENCE_WINDOW_MS) {
        pendingSince = 0;
        const target = GO_TO_SHORTCUTS[key];
        if (target && !event.shiftKey) {
          event.preventDefault();
          navigate(target.to);
        }
        return;
      }
      pendingSince = key === "g" && !event.shiftKey ? now : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
