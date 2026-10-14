import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** Delay before a hovered or keyboard-focused trigger shows its card. */
export const HOVER_CARD_OPEN_DELAY = 350;
/** Grace period that lets the pointer travel from the trigger into the card. */
export const HOVER_CARD_CLOSE_DELAY = 140;

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;

type Position = { top: number; left: number; placement: "below" | "above" };

/**
 * The trigger wrapper has no box (display: contents): anchor to the first
 * child element that has one, else to the nearest ancestor that does.
 */
function anchorRectOf(wrapper: HTMLElement | null) {
  if (!wrapper) return null;
  for (let element = wrapper.firstElementChild; element; element = element.firstElementChild) {
    const rect = element.getBoundingClientRect();
    if (rect.width || rect.height) return rect;
  }
  for (let element = wrapper.parentElement; element; element = element.parentElement) {
    const rect = element.getBoundingClientRect();
    if (rect.width || rect.height) return rect;
  }
  return null;
}

/** Below the trigger when it fits, else above; always inside the viewport. */
function useHoverCardPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement>,
  cardRef: RefObject<HTMLElement>,
) {
  const [position, setPosition] = useState<Position | null>(null);
  const place = useCallback(() => {
    const rect = anchorRectOf(triggerRef.current);
    const card = cardRef.current;
    if (!rect) return;
    const width = card?.offsetWidth ?? 320;
    const height = card?.offsetHeight ?? 160;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const placement: Position["placement"] =
      spaceBelow < height + TRIGGER_GAP + VIEWPORT_MARGIN && rect.top > spaceBelow ? "above" : "below";
    const top = placement === "below"
      ? Math.min(rect.bottom + TRIGGER_GAP, viewportHeight - height - VIEWPORT_MARGIN)
      : Math.max(VIEWPORT_MARGIN, rect.top - TRIGGER_GAP - height);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
    setPosition({ top: Math.max(VIEWPORT_MARGIN, top), left, placement });
  }, [triggerRef, cardRef]);

  // Measure after the card renders (its size depends on loaded content) and
  // again whenever that content changes size.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(card);
    return () => observer.disconnect();
  }, [open, place, cardRef]);

  return { position, place };
}

/**
 * A preview card that opens when a mouse rests on its trigger (after
 * ~350ms) or when the trigger receives keyboard focus, and closes when the
 * pointer leaves both trigger and card, focus leaves, or Esc is pressed.
 *
 * It never opens from touch: a tap goes straight to whatever the trigger
 * does (usually opening the record), because a card that needs a second tap
 * to dismiss gets in the way on phones.
 *
 * `content` is a function so the card's data hooks mount only while it is
 * open (lazy loading); the trigger is wrapped in a `display: contents` span,
 * so it can be any element without changing layout.
 */
export function HoverCard({
  content,
  children,
  disabled = false,
  openDelay = HOVER_CARD_OPEN_DELAY,
  closeDelay = HOVER_CARD_CLOSE_DELAY,
  label,
  className,
}: {
  content: () => ReactNode;
  children: ReactNode;
  disabled?: boolean;
  openDelay?: number;
  closeDelay?: number;
  /** Accessible name for the card, e.g. "Preview of Jane Doe". */
  label?: string;
  className?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const lastPointerType = useRef<string | null>(null);
  const cardId = `hover-card-${useId().replace(/:/g, "")}`;

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const scheduleOpen = useCallback(() => {
    if (disabled) return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (open || openTimer.current) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, openDelay);
  }, [disabled, open, openDelay]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (!open || closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, closeDelay);
  }, [closeDelay, open]);

  const closeNow = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => {
    if (disabled) closeNow();
  }, [disabled, closeNow]);

  const { position, place } = useHoverCardPosition(open, triggerRef, cardRef);

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      // Scrolling inside the card itself keeps it open.
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      place();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc dismisses the card first; the panel or dialog behind keeps
      // its own Esc for the next press.
      event.preventDefault();
      event.stopPropagation();
      closeNow();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, place, closeNow]);

  const isTouch = () => lastPointerType.current === "touch";

  return (
    <>
      <span
        ref={triggerRef}
        className="hover-card-trigger"
        aria-describedby={open ? cardId : undefined}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType;
          // A click opens whatever the trigger opens; the card would only cover it.
          closeNow();
        }}
        onPointerEnter={(event) => {
          lastPointerType.current = event.pointerType;
          if (event.pointerType === "touch") return;
          scheduleOpen();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          scheduleClose();
        }}
        onFocus={(event) => {
          // Only keyboard focus opens the card. Focus that follows a tap or a
          // click does not match :focus-visible.
          if (isTouch()) return;
          const target = event.target as HTMLElement;
          let keyboardFocus = false;
          try {
            keyboardFocus = target.matches(":focus-visible");
          } catch {
            keyboardFocus = false;
          }
          if (keyboardFocus) scheduleOpen();
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && (cardRef.current?.contains(next) || triggerRef.current?.contains(next))) return;
          closeNow();
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={cardId}
            role="tooltip"
            aria-label={label}
            className={`hover-card${position ? ` hover-card--${position.placement}` : ""}${className ? ` ${className}` : ""}`}
            data-ready={position ? "true" : "false"}
            style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch") scheduleOpen();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") scheduleClose();
            }}
          >
            {content()}
          </div>,
          document.body,
        )}
    </>
  );
}
