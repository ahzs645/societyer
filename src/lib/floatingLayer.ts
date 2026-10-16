/**
 * Outside-click handling for popovers that contain portaled controls.
 *
 * Select menus, date pickers, colour pickers and similar controls render their
 * panels into `document.body` (see `createPortal` in src/components). A popover
 * that closes on "pointer down outside my DOM node" would otherwise treat a
 * click on one of those portaled options as an outside click and close itself
 * mid-interaction (e.g. the record-table Filter popover closing the moment a
 * field is picked).
 *
 * Portaled panels opt in with `data-floating-layer`; the selector also covers
 * the established class names so third-party or older panels keep working.
 */
export const FLOATING_LAYER_ATTRIBUTE = "data-floating-layer";

export const FLOATING_LAYER_SELECTOR = [
  `[${FLOATING_LAYER_ATTRIBUTE}]`,
  ".menu",
  ".menu-backdrop",
  ".calendar",
  ".color-pop",
  ".mention-popover",
  ".record-table__cell-editor-popover",
].join(", ");

/** Spread onto a portaled panel: `<div {...floatingLayerProps} …>`. */
export const floatingLayerProps = { [FLOATING_LAYER_ATTRIBUTE]: "" } as Record<string, string>;

type Container = Element | null | undefined | { readonly current: Element | null | undefined };

function asElement(container: Container): Element | null {
  if (!container) return null;
  if (container instanceof Element) return container;
  return container.current ?? null;
}

/** True when the event target sits inside any portaled floating panel. */
export function isInsideFloatingLayer(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest(FLOATING_LAYER_SELECTOR) !== null;
}

/**
 * True when a pointer event happened outside every given container and outside
 * any portaled floating panel — i.e. the popover owning `containers` should close.
 */
export function isOutsidePointerEvent(event: Event, ...containers: Container[]): boolean {
  const target = event.target;
  if (typeof Node === "undefined" || !(target instanceof Node)) return false;
  for (const container of containers) {
    if (asElement(container)?.contains(target)) return false;
  }
  return !isInsideFloatingLayer(target);
}

/** Dimming layers whose click dismisses the overlay they belong to. */
export const OVERLAY_BACKDROP_SELECTOR = [
  ".modal-backdrop",
  ".drawer-backdrop",
  ".menu-backdrop",
  ".inspector-host__backdrop",
  ".global-ai-backdrop",
  "[data-overlay-backdrop]",
].join(", ");

/**
 * Swallow the click that follows a dismissing press, so one tap closes one
 * layer: the tap that dismisses a menu or calendar must not also land on the
 * dialog backdrop (closing the dialog and losing its form) or on a control in
 * the sheet underneath.
 *
 * `onlyBackdrops` limits it to clicks that would reach an overlay backdrop —
 * for anchored popovers, where an outside tap on a real control (another
 * field, a button) should still do what it says.
 */
export function swallowFollowingClick({ onlyBackdrops = false }: { onlyBackdrops?: boolean } = {}) {
  if (typeof window === "undefined") return;
  const onClick = (event: MouseEvent) => {
    cleanup();
    const target = event.target instanceof Element ? event.target : null;
    if (onlyBackdrops && !target?.closest(OVERLAY_BACKDROP_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  // A later press starts a new gesture; its click belongs to that gesture.
  const onNextPress = () => cleanup();
  const timer = window.setTimeout(cleanup, 700);
  // Registered after the current press finishes dispatching.
  const armTimer = window.setTimeout(() => window.addEventListener("pointerdown", onNextPress, true), 0);
  function cleanup() {
    window.clearTimeout(timer);
    window.clearTimeout(armTimer);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("pointerdown", onNextPress, true);
  }
  window.addEventListener("click", onClick, true);
}

/**
 * Props for a sheet's dimming backdrop: a press dismisses the layer, keeps
 * focus from dropping to <body> (the dismiss handler restores it to the
 * trigger), and the click that follows is swallowed so it can't reach the
 * layer underneath.
 */
export function backdropDismissProps(dismiss: () => void) {
  return {
    "aria-hidden": true as const,
    onMouseDown: (event: { preventDefault(): void }) => {
      event.preventDefault();
      swallowFollowingClick();
      dismiss();
    },
  };
}
