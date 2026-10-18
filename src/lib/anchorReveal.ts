/**
 * In-page anchors (`href="#id"`, a deep link's hash) whose target sits in a
 * closed fold. Phone sections fold behind a title (MobileFold) and mount
 * their body only while open, and other sections use a plain <details>, so
 * the browser's own fragment scroll finds nothing, or a hidden box.
 *
 * `revealAnchor(id)` asks any fold that owns the id to open, then waits for
 * the target to mount, opens its closed <details> ancestors and scrolls it
 * into view (pages scroll inside `.page`, which scrollIntoView handles).
 * `useAnchorReveal()` (src/hooks) runs it whenever the routed location's hash
 * names an element, and for same-page anchor clicks the location can't see.
 */

const REVEAL_EVENT = "societyer:reveal-anchor";
/** Frames to wait for the target: a fold mounts its body on the next render;
 * a deep link waits for the page's data as well. */
const CLICK_WAIT_MS = 1500;
const LOAD_WAIT_MS = 8000;

/** The element id a hash names, or null for an empty hash or a hash route (`#/members`). */
export function anchorIdFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.startsWith("/") || raw.startsWith("!")) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The id the current location's hash targets, if any. */
export function currentAnchorId(): string | null {
  if (typeof window === "undefined") return null;
  return anchorIdFromHash(window.location.hash);
}

/** Subscribe to reveal requests; folds open when the id is theirs. */
export function onRevealAnchor(listener: (id: string) => void): () => void {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") listener(event.detail);
  };
  window.addEventListener(REVEAL_EVENT, handler);
  return () => window.removeEventListener(REVEAL_EVENT, handler);
}

function openDetailsAncestors(target: HTMLElement): boolean {
  let opened = false;
  // A link to a collapsed section (`<details id>`) means "show me it".
  if (target instanceof HTMLDetailsElement && !target.open) {
    target.open = true;
    opened = true;
  }
  for (let node = target.parentElement; node; node = node.parentElement) {
    // A <details> hides everything but its <summary>; the target in the
    // summary is already visible.
    if (node instanceof HTMLDetailsElement && !node.open) {
      const summary = node.querySelector(":scope > summary");
      if (!summary || !summary.contains(target)) {
        node.open = true;
        opened = true;
      }
    }
  }
  return opened;
}

/**
 * A MobileFold hides its section's own title, so when the target is the
 * section itself the fold's summary line is the title to land on.
 */
function scrollTargetFor(target: HTMLElement): HTMLElement {
  const fold = target.closest<HTMLElement>("details.mobile-fold");
  const section = fold?.querySelector(":scope > .mobile-fold__body")?.firstElementChild;
  return fold && section === target ? fold : target;
}

let pendingReveal: number | null = null;

/** Open whatever hides `#id`, then scroll it into view once it is on the page. */
export function revealAnchor(id: string, { waitMs = CLICK_WAIT_MS }: { waitMs?: number } = {}): void {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
  if (pendingReveal != null) window.cancelAnimationFrame(pendingReveal);
  const deadline = performance.now() + waitMs;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const attempt = () => {
    pendingReveal = null;
    const target = document.getElementById(id);
    if (!target) {
      if (performance.now() < deadline) pendingReveal = window.requestAnimationFrame(attempt);
      return;
    }
    // Opening a MobileFold's <details> mounts its body on the next render;
    // wait a frame so the scroll measures the open section.
    if (openDetailsAncestors(target)) {
      pendingReveal = window.requestAnimationFrame(attempt);
      return;
    }
    scrollTargetFor(target).scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
  };
  // Two frames: one for the folds' state update, one for their paint.
  pendingReveal = window.requestAnimationFrame(() => {
    pendingReveal = window.requestAnimationFrame(attempt);
  });
}

function sameDocumentAnchorId(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("#")) return null;
  return anchorIdFromHash(href);
}

/**
 * Same-page anchor clicks the location can't report: the hash is already
 * this one (no navigation happens), or hash routing (the desktop app) would
 * read it as a route. Returns a cleanup.
 */
export function installAnchorClickReveal(): () => void {
  if (typeof window === "undefined") return () => {};
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return;
    const id = sameDocumentAnchorId(anchor);
    if (!id) return;
    if (window.location.hash.startsWith("#/")) {
      event.preventDefault();
      revealAnchor(id);
    } else if (currentAnchorId() === id) {
      revealAnchor(id);
    }
  };
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}

export const ANCHOR_REVEAL_LOAD_WAIT_MS = LOAD_WAIT_MS;
