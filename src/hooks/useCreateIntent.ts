import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { usePermissions } from "./usePermissions";

/**
 * Opens a page's create form once when the URL carries `?intent=<intent>`
 * (from a ⌘K "New …" command), then drops the parameter so a reload or Back
 * does not reopen it. Waits for the viewer's permissions (and `ready`, for
 * pages that need data first); without `permission` the parameter is dropped
 * and nothing opens.
 */
export function useCreateIntent(intent: string, permission: string, open: () => void, ready = true) {
  const [params, setParams] = useSearchParams();
  const { loaded, can } = usePermissions();
  const requested = params.get("intent") === intent;
  const allowed = loaded && can(permission);
  const handled = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!requested) {
      handled.current = false;
      return;
    }
    if (handled.current || !loaded || !ready) return;
    handled.current = true;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    if (allowed) openRef.current();
  }, [allowed, loaded, ready, requested, setParams]);
}
