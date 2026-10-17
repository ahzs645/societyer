import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The top of a phone bottom sheet opened from a field (Select, Menu, the
 * date pickers): grabber, the field's label as the sheet's title, a close
 * button, and an optional pinned control under them (the search field).
 * The whole block sticks to the top of the sheet while its list scrolls.
 * The sheet points `aria-labelledby` at `id`.
 */
export function SheetHeader({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  /** Pinned under the title (e.g. the search field). */
  children?: ReactNode;
}) {
  return (
    <div className="sheet-head">
      <div className="sheet-grabber" aria-hidden="true" />
      <div className="sheet-head__bar">
        <h2 className="sheet-head__title" id={id}>{title}</h2>
        <button type="button" className="sheet-head__close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}
