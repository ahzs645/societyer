import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const ACTION_TASK_PARAM = "actionTask";

export function meetingActionHref(meetingId: string, taskId: string, tab: "notes" | "minutes") {
  const params = new URLSearchParams({ tab, [ACTION_TASK_PARAM]: taskId });
  if (tab === "notes") params.set("view", "actions");
  return `/app/meetings/${encodeURIComponent(meetingId)}?${params}`;
}

/** Focus the linked action once its row has rendered, including on a cold load. */
export function useLinkedActionFocus<Row extends HTMLElement>() {
  const [params] = useSearchParams();
  const taskId = params.get(ACTION_TASK_PARAM);
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    if (!row) return;
    // On phones the task sheet keeps the page inert until it closes.
    const focusRow = () => {
      const inertAncestor = row.closest("[inert]");
      if (inertAncestor) {
        observer.observe(inertAncestor, { attributeFilter: ["inert"] });
        return;
      }
      observer.disconnect();
      if (!row.getClientRects().length) return;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "center" });
    };
    const observer = new MutationObserver(focusRow);
    const frame = window.requestAnimationFrame(focusRow);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [row, taskId]);

  return { taskId, ref: setRow };
}
