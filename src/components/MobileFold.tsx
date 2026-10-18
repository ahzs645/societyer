import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useIsMobile } from "../lib/useIsMobile";
import { currentAnchorId, onRevealAnchor } from "../lib/anchorReveal";

/**
 * Phones: a long section folds behind its title and a one-line summary, so
 * the page reads as a list of headlines and the reader opens what they need.
 * Wider screens render the section unchanged.
 *
 * The section's own card sits flush inside the fold, and its title and
 * subtitle are hidden there (the fold's summary already says them), while
 * its actions stay. The body mounts only while open, so charts measure a
 * visible box and closed folds cost nothing.
 *
 * Because a closed body isn't in the DOM, a link to an element inside it
 * can't find its target: list those ids in `anchors` and the fold opens when
 * the hash (or an in-page `href="#id"`) names one of them, or its own `id`;
 * src/lib/anchorReveal.ts then scrolls the target into view.
 */
export function MobileFold({
  title,
  summary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  id,
  anchors,
  className,
}: {
  title: string;
  /** One line under the title: the figure or fact that tells the reader whether to open it. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state, for a page control elsewhere that opens the fold. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  /** Ids of elements inside the body that in-page links or deep links target. */
  anchors?: readonly string[];
  className?: string;
}) {
  const isMobile = useIsMobile();
  const ownsAnchor = (target: string | null) => target != null && (target === id || (anchors?.includes(target) ?? false));
  const [uncontrolledOpen, setUncontrolledOpen] = useState(() => defaultOpen || ownsAnchor(currentAnchorId()));
  const open = controlledOpen ?? uncontrolledOpen;
  const latest = useRef({ ownsAnchor, open, onOpenChange });
  latest.current = { ownsAnchor, open, onOpenChange };
  useEffect(() => {
    // A controlled fold asked open by the initial hash: tell its owner.
    if (controlledOpen === false && ownsAnchor(currentAnchorId())) onOpenChange?.(true);
    return onRevealAnchor((target) => {
      const current = latest.current;
      if (!current.ownsAnchor(target) || current.open) return;
      setUncontrolledOpen(true);
      current.onOpenChange?.(true);
    });
    // Mount only: later renders read the latest props through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!isMobile) return <>{children}</>;
  return (
    <details
      id={id}
      className={`card mobile-fold${className ? ` ${className}` : ""}`}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setUncontrolledOpen(next);
        onOpenChange?.(next);
      }}
    >
      <summary className="mobile-fold__summary">
        <span className="mobile-fold__titles">
          <h2 className="mobile-fold__title">{title}</h2>
          {summary != null && summary !== "" && <span className="mobile-fold__meta">{summary}</span>}
        </span>
        <ChevronDown size={16} className="mobile-fold__chevron" aria-hidden="true" />
      </summary>
      {open && <div className="mobile-fold__body">{children}</div>}
    </details>
  );
}
