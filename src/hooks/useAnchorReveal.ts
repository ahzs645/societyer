import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  ANCHOR_REVEAL_LOAD_WAIT_MS,
  anchorIdFromHash,
  cancelAnchorReveal,
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

  useEffect(() => installAnchorClickReveal(), []);

  useEffect(() => {
    // Navigation also cancels imperative same-page reveals started by buttons.
    cancelAnchorReveal();
    const id = anchorIdFromHash(hash);
    // Routed hashes wait for page data, including a StrictMode effect replay.
    // Direct buttons and same-page clicks retain revealAnchor's shorter window.
    if (id) return revealAnchor(id, { waitMs: ANCHOR_REVEAL_LOAD_WAIT_MS });
  }, [pathname, hash]);
}
