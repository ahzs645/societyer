import { ReactNode } from "react";
import { MinusCircle } from "lucide-react";

/**
 * Generic editable list shell shared by the meeting AttendanceRoster and the
 * Decisions LineListEditor — anything that's "a list of rows, each removable,
 * with an add footer." Callers supply the per-row content (`renderItem`), the
 * add UI (`footer`), and an optional `header`; this owns the list/row/remove
 * layout so the two stay visually and behaviourally in sync.
 *
 * `removeSide` places the remove button: "left" (Attendance) or "right"
 * (Decisions). `divided` draws separators between rows (Attendance's look).
 */
export function ListEditor<T>({
  items,
  onRemove,
  renderItem,
  removeSide = "left",
  divided = false,
  getRemoveLabel = () => "Remove item",
  header,
  footer,
  "aria-label": ariaLabel,
}: {
  items: T[];
  onRemove: (index: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
  removeSide?: "left" | "right";
  divided?: boolean;
  getRemoveLabel?: (item: T, index: number) => string;
  header?: ReactNode;
  footer?: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <div
      className={`list-editor${divided ? " list-editor--divided" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {header && <div className="list-editor__head">{header}</div>}
      {items.length > 0 && (
        <ul className="list-editor__list">
          {items.map((item, index) => {
            const removeButton = (
              <button
                type="button"
                className="list-editor__remove"
                onClick={() => onRemove(index)}
                aria-label={getRemoveLabel(item, index)}
                title={getRemoveLabel(item, index)}
              >
                <MinusCircle size={16} />
              </button>
            );
            return (
              <li key={index} className="list-editor__row">
                {removeSide === "left" && removeButton}
                {renderItem(item, index)}
                {removeSide === "right" && removeButton}
              </li>
            );
          })}
        </ul>
      )}
      {footer && <div className="list-editor__add">{footer}</div>}
    </div>
  );
}
