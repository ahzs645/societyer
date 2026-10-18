import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  ANCHOR_REVEAL_LOAD_WAIT_MS,
  anchorIdFromHash,
  installAnchorClickReveal,
  revealAnchor,
} from "../lib/anchorReveal";

/**
 * Mount once in the app shell. When the location's hash names an element
 * (a deep link, `href="#id"`, a Link to `/page#id`), opens the fold that
 * hides it and scrolls it into view; see src/lib/anchorReveal.ts.
 */
export function useAnchorReveal() {
  const { pathname, hash } = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => installAnchorClickReveal(), []);

  useEffect(() => {
    const pageChanged = lastPath.current !== pathname;
    lastPath.current = pathname;
    const id = anchorIdFromHash(hash);
    if (!id) return;
    // A new page waits for its data before the target exists.
    revealAnchor(id, pageChanged ? { waitMs: ANCHOR_REVEAL_LOAD_WAIT_MS } : undefined);
  }, [pathname, hash]);
}
