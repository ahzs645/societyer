import { useSyncExternalStore } from "react";

const COARSE_POINTER_QUERY = "(hover: none), (pointer: coarse)";

let media: MediaQueryList | null = null;
function getMedia() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  media ??= window.matchMedia(COARSE_POINTER_QUERY);
  return media;
}

function subscribe(onChange: () => void) {
  const list = getMedia();
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/**
 * True on touch-first screens (no hover, or a coarse pointer), the same test
 * the table's CSS uses to hide hover-only cell actions. One shared media
 * query, so every cell can ask without adding its own listener.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getMedia()?.matches ?? false,
    () => false,
  );
}
