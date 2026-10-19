import { useId } from "react";
import { useRecordTableDisplay } from "../hooks/useRecordTableDisplay";
import { RECORD_TABLE_PAGE_SIZES } from "../utils/viewDisplay";

/**
 * "Rows": continuous scroll or pages, and the page size. A view setting,
 * saved and reverted with the rest of the view. Sits in the desktop Options
 * menu (`variant="menu"`) and the phone View options sheet (`"sheet"`).
 */
export function RecordTableDisplayOptions({ variant }: { variant: "menu" | "sheet" }) {
  const { mode, pageSize, choose } = useRecordTableDisplay();
  const labelId = useId();
  const sizeId = useId();
  const sizes: readonly number[] = RECORD_TABLE_PAGE_SIZES.includes(pageSize as (typeof RECORD_TABLE_PAGE_SIZES)[number])
    ? RECORD_TABLE_PAGE_SIZES
    : [...RECORD_TABLE_PAGE_SIZES, pageSize].sort((a, b) => a - b);

  const choices = (
    <div
      className={`record-table__density-options${variant === "sheet" ? " record-view-sheet__choices" : ""}`}
      role="radiogroup"
      aria-labelledby={labelId}
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "continuous"}
        className={mode === "continuous" ? "is-active" : ""}
        onClick={() => choose({ mode: "continuous", pageSize })}
      >
        Continuous
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "pages"}
        className={mode === "pages" ? "is-active" : ""}
        onClick={() => choose({ mode: "pages", pageSize })}
      >
        Pages
      </button>
    </div>
  );

  const sizePicker = mode === "pages" && (
    <div className="record-table__page-size">
      <label className="record-table__menu-label" htmlFor={sizeId}>
        Rows per page
      </label>
      <select
        id={sizeId}
        className="record-table__menu-select"
        value={pageSize}
        onChange={(event) => choose({ mode: "pages", pageSize: Number(event.target.value) })}
      >
        {sizes.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </div>
  );

  if (variant === "sheet") {
    return (
      <section className="record-view-sheet__section" aria-labelledby={labelId}>
        <h3 className="record-view-sheet__label" id={labelId}>Rows</h3>
        {choices}
        {sizePicker}
      </section>
    );
  }
  return (
    <div className="record-table__menu-section">
      <span className="record-table__menu-label" id={labelId}>Rows</span>
      {choices}
      {sizePicker}
    </div>
  );
}
