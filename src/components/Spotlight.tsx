import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Tip, isAutomatedBrowser, resetTips, type TipPlacement } from "tourkit/tips";
import { useCurrentUserId } from "../hooks/useCurrentUser";

/**
 * Spotlights: small coachmarks that point at a feature once, drawn by
 * Tourkit's `tips` (modules/tourkit/tips) in Societyer's `.spotlight` styles.
 *
 * - Dismissal is remembered per user and per tip.
 * - Only one spotlight is ever on screen; after one is dismissed the next
 *   waits for a later page load.
 * - Anchored tips never show on phones (below 560px); inline ones can.
 * - Automated browsers get no tips unless localStorage
 *   `societyer.spotlights.force` is "1".
 */

function storageKey(userId: string | null | undefined) {
  return `societyer.spotlights.dismissed:${userId ?? "anonymous"}`;
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
  placement?: TipPlacement;
  title: ReactNode;
  children?: ReactNode;
  /** Optional illustration slot above the title. */
  image?: ReactNode;
  ctaLabel?: string;
  onCta?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const userId = useCurrentUserId();
  return (
    <Tip
      tipKey={spotlightKey}
      anchor={anchor}
      placement={placement}
      title={title}
      image={image}
      ctaLabel={ctaLabel}
      onCta={onCta}
      dismissLabel={dismissLabel}
      className={className}
      storageKey={storageKey(userId)}
      suppressed={isAutomatedBrowser("societyer.spotlights.force")}
      classPrefix="spotlight"
      closeIcon={<X size={14} />}
      ctaButtonClassName="btn btn--sm"
      dismissButtonClassName="btn btn--sm btn--accent"
    >
      {children}
    </Tip>
  );
}

/** Settings row: brings back every tip this user dismissed. */
export function ResetTipsButton({ onReset }: { onReset?: () => void }) {
  const userId = useCurrentUserId();
  return (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => {
        resetTips(storageKey(userId));
        onReset?.();
      }}
    >
      Reset tips
    </button>
  );
}
