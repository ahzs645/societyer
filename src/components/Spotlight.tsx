import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useCurrentUserId } from "../hooks/useCurrentUser";

/**
 * Spotlights: small coachmarks that point at a feature once.
 *
 * - Dismissal is remembered per user and per tip (localStorage, guarded).
 * - Only one spotlight is ever on screen. Tips queue in mount order, and after
 *   one is dismissed the next waits for a later page load rather than
 *   chaining.
 * - Anchored tips never show on phones (below 560px); inline ones can.
 * - Non-modal: focus is never moved or trapped. Esc or "Got it" dismisses;
 *   if focus was inside the tip it goes back to the anchor.
 */

const STORAGE_PREFIX = "societyer.spotlights.dismissed";
const PHONE_QUERY = "(max-width: 559px)";

type StoreState = {
  /** Keys asking to be shown, in mount order. */
  queue: string[];
  /** Set after a dismissal so a second tip waits for the next page load. */
  cooledDown: boolean;
  /** Bumped whenever persisted dismissals change. */
  version: number;
};

let state: StoreState = { queue: [], cooledDown: false, version: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<StoreState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storageKey(userId: string | null | undefined) {
  return `${STORAGE_PREFIX}:${userId ?? "anonymous"}`;
}

function readDismissed(userId: string | null | undefined): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(userId: string | null | undefined, keys: string[]) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(keys));
  } catch {
    // Storage blocked (private mode, quota): the tip simply shows again next time.
  }
}

/** Forget every dismissed tip for this user so they show again. */
export function resetSpotlights(userId: string | null | undefined) {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Nothing persisted to clear.
  }
  emit({ cooledDown: false, version: state.version + 1 });
}

/**
 * Whether the tip `key` should show now, and a `dismiss` that remembers it.
 * Pass `enabled: false` while the tip has nothing to point at.
 */
export function useSpotlight(key: string, { enabled = true }: { enabled?: boolean } = {}) {
  const userId = useCurrentUserId();
  const snapshot = useSyncExternalStore(subscribe, () => state);
  // Dismissals are re-read when the user or `version` changes.
  const dismissed = readDismissed(userId).includes(key);
  void snapshot.version;
  const wants = enabled && !dismissed;

  useEffect(() => {
    if (!wants) return;
    if (!state.queue.includes(key)) emit({ queue: [...state.queue, key] });
    return () => {
      emit({ queue: state.queue.filter((queued) => queued !== key) });
    };
  }, [key, wants]);

  const dismiss = useCallback(() => {
    const keys = readDismissed(userId);
    if (!keys.includes(key)) writeDismissed(userId, [...keys, key]);
    emit({
      queue: state.queue.filter((queued) => queued !== key),
      cooledDown: true,
      version: state.version + 1,
    });
  }, [key, userId]);

  const open = wants && !snapshot.cooledDown && snapshot.queue[0] === key;
  return { open, dismiss };
}

function useMediaQuery(query: string) {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Rendered, inside the viewport, and not in a closed off-canvas drawer. */
function isOnScreen(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** Finds the anchor, waiting briefly for it to mount (sidebars and toolbars load late). */
function useAnchor(selector: string | undefined) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!selector) return;
    let tries = 0;
    let timer: number | undefined;
    const find = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isOnScreen);
      if (found) {
        setElement(found);
        return;
      }
      tries += 1;
      if (tries < 20) timer = window.setTimeout(find, 250);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [selector]);
  return element;
}

type Placement = "top" | "bottom" | "left" | "right";

const GAP = 12;
const MARGIN = 12;

function placeNear(anchor: DOMRect, card: { width: number; height: number }, placement: Placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0;
  let left = 0;
  if (placement === "right") {
    left = anchor.right + GAP;
    top = anchor.top + anchor.height / 2 - 28;
  } else if (placement === "left") {
    left = anchor.left - GAP - card.width;
    top = anchor.top + anchor.height / 2 - 28;
  } else if (placement === "bottom") {
    top = anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - 28;
  } else {
    top = anchor.top - GAP - card.height;
    left = anchor.left + anchor.width / 2 - 28;
  }
  left = Math.max(MARGIN, Math.min(left, vw - card.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - card.height - MARGIN));
  // Keep the tail pointing at the anchor's centre even after clamping.
  const tail = placement === "left" || placement === "right"
    ? Math.max(16, Math.min(anchor.top + anchor.height / 2 - top, card.height - 16))
    : Math.max(16, Math.min(anchor.left + anchor.width / 2 - left, card.width - 16));
  return { top, left, tail };
}

export function Spotlight({
  spotlightKey,
  anchor,
  placement = "bottom",
  title,
  children,
  image,
  ctaLabel,
  onCta,
  dismissLabel = "Got it",
  className,
}: {
  /** Stable id for remembering dismissal, e.g. "sidebar-favorites". */
  spotlightKey: string;
  /** CSS selector of the element to point at. Omit to render inline. */
  anchor?: string;
  placement?: Placement;
  title: ReactNode;
  children?: ReactNode;
  /** Optional illustration slot above the title. */
  image?: ReactNode;
  ctaLabel?: string;
  onCta?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const inline = !anchor;
  const isPhone = useMediaQuery(PHONE_QUERY);
  const anchorEl = useAnchor(inline || isPhone ? undefined : anchor);
  const { open, dismiss } = useSpotlight(spotlightKey, { enabled: inline || (!isPhone && Boolean(anchorEl)) });
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [position, setPosition] = useState<{ top: number; left: number; tail: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || inline || !anchorEl) return;
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      // The anchor scrolled away or its drawer closed: hide rather than point at nothing.
      if (!anchorEl.isConnected || !isOnScreen(anchorEl)) {
        setPosition(null);
        return;
      }
      setPosition(placeNear(anchorEl.getBoundingClientRect(), { width: card.offsetWidth, height: card.offsetHeight }, placement));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(anchorEl);
    // Content loading above the anchor moves it without resizing it.
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [open, inline, anchorEl, placement]);

  const close = useCallback(() => {
    const hadFocus = cardRef.current?.contains(document.activeElement);
    dismiss();
    if (hadFocus) anchorEl?.focus?.();
  }, [dismiss, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Let an open dialog or menu take Esc first.
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]')) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) return null;

  const card = (
    <div
      ref={cardRef}
      className={`spotlight${inline ? " spotlight--inline" : ` spotlight--${placement}`}${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-spotlight={spotlightKey}
      style={inline ? undefined : {
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? undefined : "hidden",
        ["--spotlight-tail" as string]: position ? `${position.tail}px` : undefined,
      }}
    >
      {!inline && <span className="spotlight__tail" aria-hidden="true" />}
      {image && <div className="spotlight__image">{image}</div>}
      <div className="spotlight__head">
        <h2 className="spotlight__title" id={titleId}>{title}</h2>
        <button type="button" className="spotlight__close" onClick={close} aria-label="Dismiss tip">
          <X size={14} />
        </button>
      </div>
      {children && <div className="spotlight__body">{children}</div>}
      <div className="spotlight__actions">
        {ctaLabel && onCta && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              onCta();
              close();
            }}
          >
            {ctaLabel}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--accent" onClick={close}>
          {dismissLabel}
        </button>
      </div>
    </div>
  );

  return inline ? card : createPortal(card, document.body);
}

/** Settings row: brings back every tip this user dismissed. */
export function ResetTipsButton({ onReset }: { onReset?: () => void }) {
  const userId = useCurrentUserId();
  return (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => {
        resetSpotlights(userId);
        onReset?.();
      }}
    >
      Reset tips
    </button>
  );
}
