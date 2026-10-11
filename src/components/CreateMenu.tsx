import { ChevronDown, Plus } from "lucide-react";
import { Menu, type MenuItem } from "./Menu";

/**
 * The one "+ New" action a page header gets. With a single kind of record it
 * is a plain primary button; with several it opens a short popover listing
 * them, so a header never carries a row of "+" buttons. On phones the trigger
 * collapses to a bare "+" like every other create action.
 */
export function CreateMenu({
  items,
  label = "New",
  disabled,
  minWidth = 200,
}: {
  items: (MenuItem | false | null | undefined)[];
  label?: string;
  disabled?: boolean;
  minWidth?: number;
}) {
  const visible = items.filter(Boolean) as MenuItem[];
  if (!visible.length) return null;
  if (visible.length === 1) {
    const [only] = visible;
    return (
      <button
        type="button"
        className="btn-action btn-action--primary"
        onClick={only.onSelect}
        disabled={disabled || only.disabled}
      >
        <Plus size={12} /> {only.label}
      </button>
    );
  }
  return (
    <Menu
      align="right"
      minWidth={minWidth}
      trigger={
        <button
          type="button"
          className="btn-action btn-action--primary create-menu__trigger"
          aria-haspopup="menu"
          aria-label={label}
          disabled={disabled || visible.every((item) => item.disabled)}
        >
          <Plus size={12} /> {label}
          <ChevronDown size={12} className="create-menu__caret" aria-hidden="true" />
        </button>
      }
      sections={[{ id: "create", items: visible }]}
    />
  );
}
