/**
 * CitationTooltip
 * ---------------
 * Hover/focus popover that surfaces a regulatory citation — the rule's
 * source label, the exact quoted text of the section, a caveat where one
 * applies, and a deep link out to the authoritative source (BC Laws,
 * justice.gc.ca, CRA, etc.).
 *
 * Designed to live next to compliance UI like <Flag>, where the surface
 * copy summarises an issue ("No PIPA privacy policy on file.") and the
 * citation chip lets the user jump from "what is wrong" to "here is the
 * rule that says so."
 *
 * Why not reuse <Tooltip>?
 *   The shared <Tooltip> uses `pointer-events: none` so content is read-only
 *   — you can't click a link inside it. This component uses a portal
 *   popover with a close timer, matching the hoverable "Cite" pattern from
 *   the nutrition webapp at /Users/ahmadjalil/Downloads/home-project/webapp.
 */

import {
  forwardRef,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { BookMarked, ExternalLink } from "lucide-react";
import {
  getRegulatoryCitation,
  type RegulatoryCitation,
} from "../lib/regulatoryCitations";

const VIEWPORT_MARGIN = 8;
const TOOLTIP_GAP = 8;
const HIDE_DELAY_MS = 250;

interface PopoverPosition {
  top: number;
  left: number;
  bridge?: HoverBridge;
}

interface HoverBridge {
  top: number;
  left: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function computePosition(
  anchorRect: DOMRect,
  popoverRect: DOMRect,
): PopoverPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    vw - popoverRect.width - VIEWPORT_MARGIN,
  );
  const maxTop = Math.max(
    VIEWPORT_MARGIN,
    vh - popoverRect.height - VIEWPORT_MARGIN,
  );

  const centeredLeft =
    anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
  const left = clamp(centeredLeft, VIEWPORT_MARGIN, maxLeft);

  const aboveTop = anchorRect.top - popoverRect.height - TOOLTIP_GAP;
  const belowTop = anchorRect.bottom + TOOLTIP_GAP;
  const fitsAbove = aboveTop >= VIEWPORT_MARGIN;
  const fitsBelow =
    belowTop + popoverRect.height <= vh - VIEWPORT_MARGIN;
  const hasMoreRoomAbove = anchorRect.top > vh - anchorRect.bottom;
  const preferredTop =
    fitsAbove || (!fitsBelow && hasMoreRoomAbove) ? aboveTop : belowTop;
  const top = clamp(preferredTop, VIEWPORT_MARGIN, maxTop);

  // Build an invisible "bridge" rectangle between the trigger and the
  // popover so the popover stays open while the cursor crosses the gap.
  const popoverBottom = top + popoverRect.height;
  let bridge: HoverBridge | undefined;
  if (popoverBottom <= anchorRect.top || anchorRect.bottom <= top) {
    const gapTop =
      popoverBottom <= anchorRect.top ? popoverBottom : anchorRect.bottom;
    const gapBottom =
      popoverBottom <= anchorRect.top ? anchorRect.top : top;
    const bridgeLeft = clamp(
      Math.min(anchorRect.left, left) - VIEWPORT_MARGIN,
      0,
      vw,
    );
    const bridgeRight = clamp(
      Math.max(anchorRect.right, left + popoverRect.width) + VIEWPORT_MARGIN,
      0,
      vw,
    );
    bridge = {
      top: gapTop,
      left: bridgeLeft,
      width: Math.max(0, bridgeRight - bridgeLeft),
      height: Math.max(0, gapBottom - gapTop),
    };
  }

  return { top, left, bridge };
}

type CitationInput =
  | { citationId: string; citation?: never }
  | { citation: RegulatoryCitation; citationId?: never };

type CitationBadgeProps = CitationInput & {
  /** Custom trigger label. Defaults to the section or source label. */
  label?: ReactNode;
  /** Compact mode — icon only. */
  iconOnly?: boolean;
  className?: string;
};

/**
 * Inline badge that reveals a citation popover on hover / focus.
 */
export function CitationBadge(props: CitationBadgeProps) {
  const citation =
    props.citation ?? getRegulatoryCitation(props.citationId);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverId = useId();

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const show = () => {
    clearCloseTimer();
    if (!open) setPosition(null);
    setOpen(true);
  };

  const scheduleHide = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  };

  useEffect(() => clearCloseTimer, []);

  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      if (!anchorRef.current || !popoverRef.current) return;
      setPosition(
        computePosition(
          anchorRef.current.getBoundingClientRect(),
          popoverRef.current.getBoundingClientRect(),
        ),
      );
    };

    const frameId = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, citation?.id]);

  if (!citation) {
    // Unknown id — fail soft with a subtle marker so pages don't break.
    return (
      <span
        className="citation-badge citation-badge--missing"
        title={`Missing citation: ${props.citationId ?? "unknown"}`}
      >
        <BookMarked size={11} aria-hidden="true" />
        <span>citation?</span>
      </span>
    );
  }

  const label =
    props.label ??
    (citation.section
      ? `${citation.instrument} ${citation.section}`
      : citation.instrument);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      clearCloseTimer();
      setOpen(false);
    }
  };

  const classes = ["citation-badge"];
  if (props.iconOnly) classes.push("citation-badge--icon-only");
  if (props.className) classes.push(props.className);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className={classes.join(" ")}
        aria-describedby={open ? popoverId : undefined}
        aria-label={
          props.iconOnly ? `Citation: ${citation.source}` : undefined
        }
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={() => {
          window.open(citation.url, "_blank", "noopener,noreferrer");
        }}
        onKeyDown={onKeyDown}
      >
        <BookMarked size={11} aria-hidden="true" />
        {!props.iconOnly && <span>{label}</span>}
      </button>
      {open &&
        createPortal(
          <CitationPopover
            id={popoverId}
            ref={popoverRef}
            citation={citation}
            position={position}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
          />,
          document.body,
        )}
    </>
  );
}

interface CitationPopoverProps {
  id: string;
  citation: RegulatoryCitation;
  position: PopoverPosition | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CitationPopover = forwardRef<HTMLDivElement, CitationPopoverProps>(
  function CitationPopover(
    { id, citation, position, onMouseEnter, onMouseLeave },
    ref,
  ) {
    return (
      <>
        {position?.bridge &&
        position.bridge.width > 0 &&
        position.bridge.height > 0 ? (
          <div
            aria-hidden="true"
            className="citation-popover__bridge"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{
              top: position.bridge.top,
              left: position.bridge.left,
              width: position.bridge.width,
              height: position.bridge.height,
            }}
          />
        ) : null}
        <div
          id={id}
          ref={ref}
          role="tooltip"
          className="citation-popover"
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? "visible" : "hidden",
          }}
        >
          <div className="citation-popover__source">
            <BookMarked size={12} aria-hidden="true" />
            <span>{citation.source}</span>
          </div>
          <blockquote className="citation-popover__quote">
            &ldquo;{citation.quote}&rdquo;
          </blockquote>
          {citation.caveat && (
            <div className="citation-popover__caveat">{citation.caveat}</div>
          )}
          <div className="citation-popover__meta">{citation.fullCitation}</div>
          <div className="citation-popover__actions">
            <a
              className="citation-popover__link"
              href={citation.url}
              target="_blank"
              rel="noreferrer"
            >
              Open source
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            {citation.pointInTimeUrl &&
              citation.pointInTimeUrl !== citation.url && (
                <a
                  className="citation-popover__link citation-popover__link--muted"
                  href={citation.pointInTimeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Point-in-time
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
          </div>
        </div>
      </>
    );
  },
);
