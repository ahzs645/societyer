import { MoreHorizontal } from "lucide-react";
import { Menu, type MenuItem } from "./Menu";

/**
 * Standard "⋯ More" overflow for page-header secondary actions. Collapses
 * secondary actions (export, import, sync, etc.) into a dropdown so the header
 * keeps just its primary action visible — the de-bloated mobile header we
 * established on the Assets page. Used across list pages for consistency.
 *
 * Pass the secondary actions as `items`; render the primary action as a
 * sibling button next to <MoreActionsMenu />.
 */
export function MoreActionsMenu({
  items,
  label = "More",
  align = "right",
}: {
  items: MenuItem[];
  /** Trigger label next to the ⋯ icon. Empty renders a square icon button. */
  label?: string;
  align?: "left" | "right";
}) {
  if (!items.length) return null;
  return (
    <Menu
      align={align}
      trigger={
        <button
          type="button"
          className={label ? "btn-action" : "btn-action btn-action--icon"}
          aria-label="More actions"
          title={label ? undefined : "More actions"}
        >
          <MoreHorizontal size={14} />
          {label}
        </button>
      }
      sections={[{ id: "more", items }]}
    />
  );
}
