/**
 * In-page anchors (`href="#id"`, a deep link's hash) whose target sits in a
 * closed fold. Phone sections fold behind a title (MobileFold) and mount
 * their body only while open, and other sections use a plain <details>, so
 * the browser's own fragment scroll finds nothing, or a hidden box.
 *
 * `revealAnchor(id)` asks any fold that owns the id to open, then waits for
 * the target to mount, opens its closed <details> ancestors and scrolls it
 * into view inside the app's `.page` scroll container.
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

function anchorPageTop(target: HTMLElement, page: HTMLElement): number {
  // Native scrollIntoView also scrolls overflow:hidden layout ancestors.
  // On phones that can move .main while .page is scrolling, clipping the
  // page below the fixed navigation. Only the page owns this content scroll.
  const scrollMarginTop = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
  return target === page ? 0 : page.scrollTop
    + target.getBoundingClientRect().top - page.getBoundingClientRect().top
    - page.clientTop - scrollMarginTop;
}

let activeRevealCleanup: (() => void) | null = null;

/** Stop an outstanding reveal when leaving its page, including hashless navigation. */
export function cancelAnchorReveal(): void {
  activeRevealCleanup?.();
}

/** Open whatever hides `#id`, then scroll it into view once it is on the page. */
export function revealAnchor(id: string, { waitMs = CLICK_WAIT_MS }: { waitMs?: number } = {}): () => void {
  cancelAnchorReveal();
  if (typeof window === "undefined" || !id) return () => {};
  let pendingFrame: number | null = null;
  let observer: ResizeObserver | null = null;
  let stopped = false;
  const inputEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (pendingFrame != null) window.cancelAnimationFrame(pendingFrame);
    window.clearTimeout(timeout);
    observer?.disconnect();
    for (const event of inputEvents) window.removeEventListener(event, stop, true);
    if (activeRevealCleanup === stop) activeRevealCleanup = null;
  };
  const timeout = window.setTimeout(stop, waitMs);
  activeRevealCleanup = stop;
  for (const event of inputEvents) window.addEventListener(event, stop, { capture: true, passive: true });
  const deadline = performance.now() + waitMs;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
  const attempt = () => {
    pendingFrame = null;
    if (stopped) return;
    const target = document.getElementById(id);
    if (!target) {
      if (performance.now() < deadline) pendingFrame = window.requestAnimationFrame(attempt);
      else stop();
      return;
    }
    // Opening a MobileFold's <details> mounts its body on the next render;
    // wait a frame so the scroll measures the open section.
    if (openDetailsAncestors(target)) {
      pendingFrame = window.requestAnimationFrame(attempt);
      return;
    }
    const scrollTarget = scrollTargetFor(target);
    const page = scrollTarget.closest<HTMLElement>(".page");
    if (!page) {
      scrollTarget.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
      stop();
      return;
    }
    let top = anchorPageTop(scrollTarget, page);
    page.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
    if (typeof ResizeObserver === "undefined") {
      stop();
      return;
    }
    // Data panels and lazy editors can grow after the target first mounts.
    // Keep its content offset aligned during startup, without treating our
    // own smooth scroll as a layout change or fighting later user navigation.
    observer = new ResizeObserver(() => {
      if (stopped) return;
      if (performance.now() >= deadline || !page.isConnected || !scrollTarget.isConnected) {
        stop();
        return;
      }
      const nextTop = anchorPageTop(scrollTarget, page);
      if (Math.abs(nextTop - top) < 1) return;
      top = nextTop;
      page.scrollTo({ top, behavior: "instant" });
    });
    // .page has a fixed viewport: observe its content, including siblings
    // above the target and its inner containers, rather than only .page.
    for (const child of page.children) observer.observe(child);
    for (let node: HTMLElement | null = scrollTarget; node && node !== page; node = node.parentElement) observer.observe(node);
    observer.observe(page);
  };
  // Two frames: one for the folds' state update, one for their paint.
  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = window.requestAnimationFrame(attempt);
  });
  return stop;
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
  return () => {
    document.removeEventListener("click", onClick);
    cancelAnchorReveal();
  };
}

export const ANCHOR_REVEAL_LOAD_WAIT_MS = LOAD_WAIT_MS;
