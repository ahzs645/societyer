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
